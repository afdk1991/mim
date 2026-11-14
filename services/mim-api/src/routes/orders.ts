/**
 * 统一订单只读接口（2026-11-14 P0-A 第 1 步）
 *
 * 为什么要有这一层：项目里三套订单（module / shop / asset）此前只能由前端分别调用三个路由再手工合并，
 * 退款 / 对账 / GMV 统计同样要写三段。本路由把「统一视图」先建起来，旧路由一律保留不动，
 * 后续提交再把写路径逐条迁到这里（届时旧路由改为适配器，不再直接写订单表）。
 *
 * 为什么挂在 /commerce/orders 而不是 /orders：商城路由已占用 GET /orders（返回模块订单），
 * 直接同路径会造成两个处理器抢同一路由——这正是「三套订单」的副作用。统一视图用独立命名空间，
 * 旧接口零改动、前端可并行迁移，迁移完成后再把旧路径改为 301 / 适配器。
 *
 * 路由一览（全部需要登录，只读，不引入写操作）：
 *   GET /commerce/orders            我的统一订单列表（倒序，默认 50 条，可用 limit 调整）
 *   GET /commerce/orders/summary    我的订单汇总（总数 / 已支付 / 待支付 / 已退款 / 实付合计）
 *   GET /commerce/orders/:id        单笔订单详情（跨用户一律 404，不泄露存在性）
 *
 * 注意：/commerce/orders/summary 必须先于 /commerce/orders/:id 注册，否则 summary 会被当成订单 id。
 */

import { Router } from 'express'; // 路由容器，按前缀挂到 /api/v1
import { AppError } from '@mim/core-domain'; // 统一业务异常，找不到订单回 404 信封
import { requireAuth } from '../middleware.js'; // 登录态校验：订单属于个人数据，不对外开放
import { getUnifiedOrder, listUnifiedOrders, summarizeUnifiedOrders } from '../commerce/unified.js'; // 统一交易域查询
import type { ApiDeps } from '../types.js'; // 依赖注入：只需要 db
import type { UnifiedOrderSource } from '../commerce/unified.js'; // 来源产线枚举，用于校验查询参数

/** limit 解析：非法值回落到默认 50，上限 200，避免一次拉出全库订单 */
function parseLimit(raw: unknown): number {
  const value = Number(raw ?? 50); // 缺省 50
  if (!Number.isFinite(value) || value <= 0) return 50; // 非法输入用默认值，不抛错
  return Math.min(Math.floor(value), 200); // 封顶 200
}

/** source 过滤解析：缺省返回三源全部；非法产线值回 400，避免静默放宽过滤口径 */
function parseSource(raw: unknown): UnifiedOrderSource | undefined {
  if (raw === undefined || raw === '') return undefined; // 未传不过滤
  if (raw === 'module' || raw === 'shop' || raw === 'asset') return raw; // 合法产线原样返回
  throw new AppError('VALIDATION_FAILED', 'source must be one of module/shop/asset', { source: raw }); // 非法值显式拒绝
}

export function createOrdersRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立 router，便于在 app 层按前缀挂载
  router.use('/commerce/orders', requireAuth); // 统一订单全部要求登录；旧 /orders 仍由商城路由服务，不改动

  router.get('/commerce/orders', (req, res) => {
    const user = req.user!; // requireAuth 已注入登录态
    const limit = parseLimit(req.query.limit); // 分页大小
    const source = parseSource(req.query.source); // 可选产线过滤：迁移期各页面保留原产线口径
    const items = listUnifiedOrders(deps.db, user.id, { source, limit }); // 统一视图（含明细）
    res.json({ items, total: items.length, limit }); // 返回列表与条数，前端不必再合并三源
  });

  router.get('/commerce/orders/summary', (req, res) => {
    const user = req.user!; // 登录用户
    res.json({ summary: summarizeUnifiedOrders(deps.db, user.id) }); // 单一口径汇总
  });

  router.get('/commerce/orders/:id', (req, res) => {
    const user = req.user!; // 登录用户
    const order = getUnifiedOrder(deps.db, req.params.id, user.id); // 越权查询在这里被 user_id 过滤
    if (!order) throw new AppError('NOT_FOUND', '订单不存在', { id: req.params.id }); // 统一 404 信封
    res.json({ order }); // 返回详情与明细
  });

  return router; // 交回 app 装配
}
