/**
 * 邀请码管理路由：生成 / 批量生成、禁用、统计与核销记录查询。
 *
 * 端点一览（统一挂在 /api/v1 下，管理端点走 RBAC 门禁）：
 *   POST   /admin/invites                 生成一枚或批量生成邀请码（权限：rbac:write）
 *   GET    /admin/invites                 邀请码列表 + 汇总统计（权限：user:read）
 *   GET    /admin/invites/redemptions      核销记录，可按码过滤（权限：user:read）
 *   PATCH  /admin/invites/:code/disable   禁用邀请码（权限：rbac:write）
 *
 * 注册门槛的实际拦截在 routes/auth.ts 建号路径内完成；本路由只负责运营管理。
 */

import { Router } from 'express'; // 独立路由实例
import { z } from 'zod'; // 请求体校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { parse } from '../validate.js'; // zod 校验包装
import { requirePermission } from '../middleware.js'; // 管理端点 RBAC 门禁
import { clockOf } from '../domain.js'; // 可注入时钟
import { addDays } from '../utils.js'; // 有效期按天换算
import {
  createInvite, // 建码
  disableInvite, // 禁用
  invitationStats, // 汇总统计
  listInvitations, // 列表
  listRedemptions, // 核销记录
} from '../invitations.js'; // 邀请码数据层
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 生成请求体：数量与配额可选，缺省单枚、单次有效、长期有效 */
const createBody = z.object({ // 字段白名单
  count: z.number().int().min(1).max(100).optional(), // 批量上限 100
  max_uses: z.number().int().min(1).max(10_000).optional(), // 可用次数
  expires_in_days: z.number().int().min(1).max(365).optional(), // 有效期天数
  bound_identifier: z.string().max(120).optional(), // 绑定手机 / 邮箱（归一化标识）
  note: z.string().max(200).optional(), // 备注
}); // createBody 结束

/** 组装邀请码管理路由工厂：测试自建 mini app 时直接挂载本路由 */
export function createInviteAdminRouter(deps: ApiDeps): Router { // 依赖显式注入
  const router = Router(); // 独立路由实例

  router.post('/admin/invites', requirePermission('rbac:write'), (req, res) => { // 生成 / 批量生成
    const body = parse(createBody, req.body ?? {}); // 校验请求体
    const now = clockOf(deps); // 统一取时
    const count = body.count ?? 1; // 缺省一枚
    const maxUses = body.max_uses ?? 1; // 缺省单次有效
    const expiresAt = body.expires_in_days ? addDays(now, body.expires_in_days) : null; // 有效期或长期
    const createdBy = req.adminBootstrap === true ? null : req.user!.id; // 引导通道无用户主体，记空
    const codes: Array<{ code: string; max_uses: number; expires_at: string | null }> = []; // 本次生成清单
    for (let i = 0; i < count; i += 1) { // 逐枚生成
      const row = createInvite(deps.db, { // 建码
        createdBy, // 创建人
        maxUses, // 可用次数
        expiresAt, // 过期时间
        boundIdentifier: body.bound_identifier?.trim() || null, // 绑定标识
        note: body.note?.trim() || null, // 备注
      }, now); // 时间
      codes.push({ code: row.code, max_uses: row.max_uses, expires_at: row.expires_at }); // 收集回显
    } // 循环结束
    res.status(201).json({ count: codes.length, invites: codes }); // 回显生成结果
  }); // 结束 POST /admin/invites

  router.get('/admin/invites', requirePermission('user:read'), (_req, res) => { // 列表 + 统计
    const invites = listInvitations(deps.db); // 全量列表
    const stats = invitationStats(deps.db); // 汇总
    res.json({ invites, stats }); // 一并回传
  }); // 结束 GET /admin/invites

  router.get('/admin/invites/redemptions', requirePermission('user:read'), (req, res) => { // 核销记录
    const code = typeof req.query.code === 'string' ? req.query.code : undefined; // 可选过滤码
    const redemptions = listRedemptions(deps.db, code); // 查询记录
    res.json({ redemptions }); // 回显
  }); // 结束 GET /admin/invites/redemptions

  router.patch('/admin/invites/:code/disable', requirePermission('rbac:write'), (req, res) => { // 禁用
    const code = String(req.params.code ?? '').trim(); // 路径参数收敛
    const found = disableInvite(deps.db, code); // 执行禁用
    if (!found) throw new AppError('NOT_FOUND', 'invitation code not found', { code }); // 不存在 404
    res.json({ ok: true, code: code.toUpperCase() }); // 幂等返回
  }); // 结束 PATCH /admin/invites/:code/disable

  return router; // 交出可挂载路由
} // createInviteAdminRouter 结束
