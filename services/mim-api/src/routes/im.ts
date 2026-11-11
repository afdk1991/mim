/** IM HTTP 路由：会话管理、消息历史与搜索、撤回、群成员管理、已读标记。
 *
 * 实时消息走 WebSocket（见 im/ws.ts），HTTP 仅负责：
 *   - 会话列表与创建（direct/group）、改名、置顶/免打扰、删除或退群
 *   - 历史消息分页拉取与会话内搜索
 *   - 发送消息的 HTTP 兜底通道（前端可选用 HTTP 发，再由 WS 推送给对方）
 *   - 消息撤回（2 分钟内、仅发送者本人），成功后可经 imHub 广播给同会话在线成员
 *   - 群成员列表、加人、踢人/退群
 *   - 标记已读
 *   - 搜索用户（用于创建会话时选人）
 */

import { Router } from 'express'; // Express 路由
import { z } from 'zod'; // 参数校验
import { parse } from '../validate.js'; // 统一校验包装
import { requireAuth } from '../middleware.js'; // 鉴权中间件
import type { ApiDeps } from '../types.js'; // 依赖注入
import {
  addConversationMembers,
  createConversation,
  createMessage,
  deleteConversationForUser,
  getConversation,
  getMemberRole,
  getMemberUserIds,
  getOrCreateDirectConversation,
  getQuotedMessage,
  isMember,
  listConversations,
  listMembers,
  listMessages,
  listMessagesAround,
  markConversationRead,
  recallMessage,
  removeConversationMember,
  renameConversation,
  searchMessages,
  searchUsers,
  setConversationPreference,
  setMemberRole,
  transferOwnership,
} from '../im/db.js'; // 数据访问层
import type { MessageContentType } from '../im/protocol.js'; // 消息内容类型

/** 撤回窗口：2 分钟，与主流 IM 一致；超时由数据层拒绝 */
const RECALL_WINDOW_MS = 120000; // 毫秒

/** 创建 IM 路由 */
export function createImRouter(deps: ApiDeps): Router {
  const router = Router(); // 新建路由实例

  // 所有 IM 路由均需登录；必须限定 /im 前缀，否则会拦截同挂载点下的 admin 等其他路由
  router.use('/im', requireAuth);

  /** 广播群成员变化：加人 / 踢人 / 设管理员 / 转让群主后，在线成员据此刷新群面板 */
  function pushMembersChanged(conversationId: string): void {
    const members = getMemberUserIds(deps.db, conversationId); // 取当前成员（含刚加入的人）
    deps.imHub?.broadcastToUsers(members, { type: 'conversation.members', payload: { conversation_id: conversationId } }); // 复用 WS 广播通道
  } // pushMembersChanged 结束

  /** GET /im/conversations — 当前用户的会话列表（含最后消息、未读数、置顶与成员数） */
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

  /** GET /im/conversations/:id — 会话详情（含成员列表，前端群信息面板使用） */
  router.get('/im/conversations/:id', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    const conversation = getConversation(deps.db, conversationId); // 基础信息
    if (!conversation) return res.status(404).json({ error: '会话不存在' });
    res.json({ conversation, members: listMembers(deps.db, conversationId) }); // 一并返回成员，减少前端请求次数
  });

  /** PATCH /im/conversations/:id — 群改名（仅群主/管理员） */
  router.patch('/im/conversations/:id', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    const body = parse(z.object({ title: z.string().min(1).max(50) }), req.body); // 新群名
    const info = getConversation(deps.db, conversationId); // 会话信息
    if (!info) return res.status(404).json({ error: '会话不存在' });
    if (info.type !== 'group') return res.status(400).json({ error: '只有群聊可以改名' });
    const role = getMemberRole(deps.db, conversationId, userId); // 角色
    if (role !== 'owner' && role !== 'admin') return res.status(403).json({ error: '只有群主或管理员可以改名' });
    renameConversation(deps.db, conversationId, body.title.trim()); // 落库
    res.json({ ok: true, title: body.title.trim() }); // 回包
  });

  /** GET /im/conversations/:id/members — 群成员列表 */
  router.get('/im/conversations/:id/members', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    res.json({ items: listMembers(deps.db, conversationId) }); // 成员清单
  });

  /** POST /im/conversations/:id/members — 邀请入群（仅群主/管理员，单次最多 50 人） */
  router.post('/im/conversations/:id/members', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    const body = parse(z.object({ user_ids: z.array(z.string()).min(1).max(50) }), req.body); // 待邀请用户
    const info = getConversation(deps.db, conversationId); // 会话信息
    if (!info) return res.status(404).json({ error: '会话不存在' });
    if (info.type !== 'group') return res.status(400).json({ error: '只有群聊可以加人' });
    const role = getMemberRole(deps.db, conversationId, userId); // 角色
    if (role !== 'owner' && role !== 'admin') return res.status(403).json({ error: '只有群主或管理员可以加人' });
    const added = addConversationMembers(deps.db, conversationId, Array.from(new Set(body.user_ids))); // 批量入群
    if (added > 0) pushMembersChanged(conversationId); // 有新人入群才广播
    res.status(201).json({ ok: true, added }); // 返回实际新增人数
  });

  /** DELETE /im/conversations/:id/members/:userId — 退群或群主踢人 */
  router.delete('/im/conversations/:id/members/:userId', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    const targetId = req.params.userId; // 被移除的成员
    const info = getConversation(deps.db, conversationId); // 会话信息
    if (!info) return res.status(404).json({ error: '会话不存在' });
    if (info.type !== 'group') return res.status(400).json({ error: '私聊不支持移除成员' });
    const role = getMemberRole(deps.db, conversationId, userId); // 自己的角色
    if (!role) return res.status(403).json({ error: '非会话成员' });
    if (targetId === info.owner_user_id) return res.status(400).json({ error: '不能移除群主' }); // 群主不能被踢
    if (targetId !== userId && role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: '只有群主或管理员可以踢人' }); // 其余人只能自己退
    }
    const removed = removeConversationMember(deps.db, conversationId, targetId); // 移除
    if (removed) pushMembersChanged(conversationId); // 移除成功则广播
    res.json({ ok: removed }); // 回包
  });

  /** PATCH /im/conversations/:id/members/:userId — 设 / 撤管理员（仅群主） */
  router.patch('/im/conversations/:id/members/:userId', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    const targetId = req.params.userId; // 目标成员
    const body = parse(z.object({ role: z.enum(['admin', 'member']) }), req.body); // 只接受两种角色
    const info = getConversation(deps.db, conversationId); // 会话信息
    if (!info) return res.status(404).json({ error: '会话不存在' }); // 不存在
    if (info.type !== 'group') return res.status(400).json({ error: '只有群聊有管理员角色' }); // 私聊无角色
    if (getMemberRole(deps.db, conversationId, userId) !== 'owner') return res.status(403).json({ error: '只有群主可以设置管理员' }); // 群主专属
    if (targetId === info.owner_user_id) return res.status(400).json({ error: '群主角色不可更改' }); // 群主不能被降级
    const changed = setMemberRole(deps.db, conversationId, targetId, body.role); // 落库
    if (!changed) return res.status(404).json({ error: '成员不存在' }); // 目标非成员
    pushMembersChanged(conversationId); // 广播角色变化
    res.json({ ok: true, role: body.role }); // 回包
  });

  /** POST /im/conversations/:id/transfer — 转让群主（仅群主，目标必须是现有成员） */
  router.post('/im/conversations/:id/transfer', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    const body = parse(z.object({ user_id: z.string().min(1) }), req.body); // 接任者
    const info = getConversation(deps.db, conversationId); // 会话信息
    if (!info) return res.status(404).json({ error: '会话不存在' }); // 不存在
    if (info.type !== 'group') return res.status(400).json({ error: '只有群聊可以转让群主' }); // 私聊无群主
    if (getMemberRole(deps.db, conversationId, userId) !== 'owner') return res.status(403).json({ error: '只有群主可以转让群主' }); // 群主专属
    if (body.user_id === userId) return res.status(400).json({ error: '不能转让给自己' }); // 语义拒绝
    const ok = transferOwnership(deps.db, conversationId, userId, body.user_id); // 落库
    if (!ok) return res.status(404).json({ error: '目标成员不存在' }); // 目标非成员
    pushMembersChanged(conversationId); // 广播群主变更
    res.json({ ok: true, owner_user_id: body.user_id }); // 回包
  });

  /** PATCH /im/conversations/:id/preferences — 置顶 / 免打扰（按人独立） */
  router.patch('/im/conversations/:id/preferences', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    const body = parse(z.object({ pinned: z.boolean().optional(), muted: z.boolean().optional() }), req.body); // 两个开关都可选
    if (body.pinned === undefined && body.muted === undefined) return res.status(400).json({ error: '至少提供一个开关' });
    setConversationPreference(deps.db, conversationId, userId, body); // 写入成员表
    res.json({ ok: true, pinned: body.pinned, muted: body.muted }); // 回包
  });

  /** DELETE /im/conversations/:id — 删除会话：群主解散 / 成员退群 / 私聊移除自己 */
  router.delete('/im/conversations/:id', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    const result = deleteConversationForUser(deps.db, conversationId, userId); // 按角色决定处理方式
    if (result === 'not_found') return res.status(404).json({ error: '会话不存在' });
    res.json({ ok: true, result }); // dissolved 或 left
  });

  /** GET /im/conversations/:id/messages — 分页拉取历史消息
   *  query: before?（消息 ID 游标） around?（定位消息 ID） limit?（1-200，默认 50）
   */
  router.get('/im/conversations/:id/messages', (req, res) => {
    const userId = req.user!.id;
    const conversationId = req.params.id;
    // 非成员拒绝访问
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    // 解析分页参数
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const around = typeof req.query.around === 'string' ? req.query.around : undefined; // 定位：搜索结果点击跳转
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const items = around ? listMessagesAround(deps.db, conversationId, around, limit) : listMessages(deps.db, conversationId, { before, limit }); // 定位模式取目标前后各半页
    res.json({ items }); // 返回消息列表（正序）
  });

  /** GET /im/conversations/:id/messages/search?q= — 会话内消息搜索（按内容模糊匹配） */
  router.get('/im/conversations/:id/messages/search', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; // 搜索词
    if (!q) return res.json({ items: [] }); // 空词返回空结果
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 30; // 条数
    res.json({ items: searchMessages(deps.db, conversationId, q, limit) }); // 结果按时间倒序
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
        reply_to_id: z.string().optional(), // 引用回复的目标消息 ID
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
    // 引用回复：必须引用同会话且未撤回的消息，摘要在此固化
    const quoted = body.reply_to_id ? getQuotedMessage(deps.db, conversationId, body.reply_to_id) : undefined; // 解析被引用消息
    if (body.reply_to_id && !quoted) return res.status(400).json({ error: '被引用的消息不存在或已撤回' }); // 非法引用直接拒绝
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
      replyToId: quoted?.id, // 引用目标 ID
      replyExcerpt: quoted?.excerpt, // 引用摘要快照
    });
    // 实时推送走 WebSocket 通道（见 im/ws.ts），HTTP 兜底仅落库并返回消息对象
    res.status(201).json({ message });
  });

  /** POST /im/conversations/:id/messages/:messageId/recall — 撤回消息（2 分钟内，仅本人） */
  router.post('/im/conversations/:id/messages/:messageId/recall', (req, res) => {
    const userId = req.user!.id; // 当前用户
    const conversationId = req.params.id; // 会话 ID
    const messageId = req.params.messageId; // 目标消息
    if (!isMember(deps.db, conversationId, userId)) return res.status(403).json({ error: '非会话成员' });
    const result = recallMessage(deps.db, { conversationId, messageId, userId, windowMs: RECALL_WINDOW_MS }); // 数据层判定
    if (!result.ok) {
      // 不同失败原因给不同状态码，前端可据此提示「已超时」「不是你的消息」等
      const status = result.reason === 'not_found' ? 404 : result.reason === 'not_owner' ? 403 : 400;
      const message = {
        not_found: '消息不存在',
        not_owner: '只能撤回自己发送的消息',
        expired: '超过 2 分钟，无法撤回',
        already_deleted: '消息已撤回',
      }[result.reason ?? 'not_found'];
      return res.status(status).json({ error: message, reason: result.reason });
    }
    // 广播给同会话在线成员：客户端据此把该消息从界面移除
    const members = getMemberUserIds(deps.db, conversationId);
    deps.imHub?.broadcastToUsers(members, {
      type: 'message.recall',
      payload: { conversation_id: conversationId, message_id: messageId, operator_user_id: userId },
    });
    res.json({ ok: true }); // 撤回成功
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
