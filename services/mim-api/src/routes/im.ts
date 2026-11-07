/** IM HTTP 路由：会话管理、消息历史、用户搜索、已读标记。
 *
 * 实时消息走 WebSocket（见 im/ws.ts），HTTP 仅负责：
 *   - 会话列表与创建（direct/group）
 *   - 历史消息分页拉取
 *   - 标记已读
 *   - 搜索用户（用于创建会话时选人）
 *   - 发消息的 HTTP 兜底通道（前端可选用 HTTP 发，再由 WS 推送给对方）
 */

import { Router } from 'express'; // Express 路由
import { z } from 'zod'; // 参数校验
import { parse } from '../validate.js'; // 统一校验包装
import { requireAuth } from '../middleware.js'; // 鉴权中间件
import type { ApiDeps } from '../types.js'; // 依赖注入
import {
  createConversation,
  createMessage,
  getOrCreateDirectConversation,
  isMember,
  listConversations,
  listMessages,
  markConversationRead,
  searchUsers,
} from '../im/db.js'; // 数据访问层
import type { MessageContentType } from '../im/protocol.js'; // 消息内容类型

/** 创建 IM 路由 */
export function createImRouter(deps: ApiDeps): Router {
  const router = Router(); // 新建路由实例

  // 所有 IM 路由均需登录；必须限定 /im 前缀，否则会拦截同挂载点下的 admin 等其他路由
  router.use('/im', requireAuth);

  /** GET /im/conversations — 当前用户的会话列表（含最后消息与未读数） */
  router.get('/im/conversations', (req, res) => {
    const userId = req.user!.id; // 从鉴权中间件取当前用户 ID
    const items = listConversations(deps.db, userId); // 拉取列表
    res.json({ items }); // 返回列表
  });

  /** POST /im/conversations — 创建会话
   *  body: { type:'direct', target_user_id } 或 { type:'group', name, member_user_ids }
   */
  router.post('/im/conversations', (req, res) => {
    const userId = req.user!.id; // 当前用户 ID
    // 校验请求体
    const body = parse(
      z.object({
        type: z.enum(['direct', 'group']), // 会话类型
        target_user_id: z.string().optional(), // direct 时的对方 ID
        name: z.string().min(1).max(50).optional(), // group 时的群名
        member_user_ids: z.array(z.string()).min(1).max(499).optional(), // group 时的成员列表
      }),
      req.body,
    );
    let conversationId: string; // 最终会话 ID
    if (body.type === 'direct') {
      // 私聊：必须有 target_user_id，且不能是自己
      if (!body.target_user_id) return res.status(400).json({ error: 'direct 会话需要 target_user_id' });
      if (body.target_user_id === userId) return res.status(400).json({ error: '不能与自己创建私聊' });
      // 复用已有会话或新建
      conversationId = getOrCreateDirectConversation(deps.db, userId, body.target_user_id);
    } else {
      // 群聊：成员列表必须包含自己，去重
      const memberIds = Array.from(new Set([userId, ...(body.member_user_ids ?? [])]));
      if (memberIds.length < 2) return res.status(400).json({ error: '群聊至少需要 2 人' });
      conversationId = createConversation(deps.db, {
        type: 'group',
        memberUserIds: memberIds,
        title: body.name,
        ownerUserId: userId,
      });
    }
    // 返回会话 ID 与完整列表项
    const items = listConversations(deps.db, userId);
    const item = items.find((c) => c.id === conversationId);
    res.status(201).json({ conversation_id: conversationId, conversation: item });
  });

  /** GET /im/conversations/:id/messages — 分页拉取历史消息
   *  query: before?（消息 ID 游标） limit?（1-200，默认 50）
   */
  router.get('/im/conversations/:id/messages', (req, res) => {
    const userId = req.user!.id;
    const conversationId = req.params.id;
    // 非成员拒绝访问
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    // 解析分页参数
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const items = listMessages(deps.db, conversationId, { before, limit });
    res.json({ items }); // 返回消息列表（正序）
  });

  /** POST /im/conversations/:id/messages — HTTP 方式发消息（兜底，前端也可用 WS 发） */
  router.post('/im/conversations/:id/messages', (req, res) => {
    const userId = req.user!.id;
    const conversationId = req.params.id;
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    // 校验消息体
    const body = parse(
      z.object({
        content_type: z.enum(['text', 'image', 'file']), // 内容类型
        content: z.string().max(10000).optional(), // 文本内容
        object_key: z.string().optional(), // 媒体对象键
        object_mime: z.string().optional(), // 媒体 MIME
        object_name: z.string().optional(), // 原始文件名
        object_size: z.number().int().nonnegative().optional(), // 文件大小
      }),
      req.body,
    );
    // 文本不能为空
    if (body.content_type === 'text' && !body.content?.trim()) {
      return res.status(400).json({ error: '文本消息不能为空' });
    }
    // 图片/文件必须有 object_key
    if ((body.content_type === 'image' || body.content_type === 'file') && !body.object_key) {
      return res.status(400).json({ error: '图片/文件消息必须携带 object_key' });
    }
    // 落库
    const message = createMessage(deps.db, {
      conversationId,
      senderUserId: userId,
      contentType: body.content_type as MessageContentType,
      content: body.content,
      objectKey: body.object_key,
      objectMime: body.object_mime,
      objectName: body.object_name,
      objectSize: body.object_size,
    });
    // 实时推送走 WebSocket 通道（见 im/ws.ts），HTTP 兜底仅落库并返回消息对象
    res.status(201).json({ message });
  });

  /** POST /im/conversations/:id/read — 标记会话已读到指定消息 */
  router.post('/im/conversations/:id/read', (req, res) => {
    const userId = req.user!.id;
    const conversationId = req.params.id;
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    const body = parse(z.object({ message_id: z.string() }), req.body); // 已读到的消息 ID
    markConversationRead(deps.db, conversationId, userId, body.message_id);
    res.json({ ok: true });
  });

  /** GET /im/users?q= — 搜索用户（用于创建会话选人），排除自己 */
  router.get('/im/users', (req, res) => {
    const userId = req.user!.id;
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) return res.json({ items: [] }); // 空查询返回空
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;
    const items = searchUsers(deps.db, q, limit, userId);
    res.json({ items });
  });

  return router; // 返回路由
} // createImRouter 结束
