/**
 * 统一内容与消息只读接口（2026-11-14 P0-B 第 1 步）
 *
 * 与 P0-A 同样的策略：新开独立命名空间，旧路由（/community/*、/circles/*、/im/*、/community/dm/*）一份不动。
 *   GET /content/items                          全站统一内容流（公开只读）
 *   GET /messaging/conversations                我的会话（登录，IM 会话 + 私信合并）
 *   GET /messaging/conversations/:id/messages   会话内消息（登录 + 必须是会话成员）
 */

import { Router } from 'express'; // 路由容器
import { AppError } from '@mim/core-domain'; // 统一错误信封
import { requireAuth } from '../middleware.js'; // 登录校验
import { listContentItems, listConversationMessages, listConversations } from '../content/unified.js'; // 统一查询
import type { ApiDeps } from '../types.js'; // 依赖注入

export function createContentUnifiedRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立 router

  router.get('/content/items', (req, res) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined; // 形态过滤（text / video / notice …）
    const containerId = typeof req.query.container_id === 'string' ? req.query.container_id : undefined; // 板块 / 圈子过滤
    const limit = Number(req.query.limit ?? 50); // 分页参数
    const items = listContentItems(deps.db, { kind, containerId, limit: Number.isFinite(limit) ? limit : 50 }); // 公开查询
    res.json({ items, total: items.length }); // 返回统一内容流
  });

  router.use('/messaging', requireAuth); // 消息属个人数据，必须先登录

  router.get('/messaging/conversations', (req, res) => {
    const user = req.user!; // 当前用户
    const limit = Number(req.query.limit ?? 50); // 分页
    const items = listConversations(deps.db, user.id, Number.isFinite(limit) ? limit : 50); // 合并 IM + 私信
    res.json({ items, total: items.length }); // 返回会话列表
  });

  router.get('/messaging/conversations/:id/messages', (req, res) => {
    const user = req.user!; // 当前用户
    const limit = Number(req.query.limit ?? 100); // 分页
    const items = listConversationMessages(deps.db, req.params.id, user.id, Number.isFinite(limit) ? limit : 100); // 成员校验在查询内完成
    if (!items) throw new AppError('NOT_FOUND', '会话不存在', { id: req.params.id }); // 非成员与不存在同响应
    res.json({ items, total: items.length }); // 返回消息
  });

  return router; // 交回 app 装配
}
