/**
 * 提现分成 · 用户申请 + 后台审核端点。
 *
 *   GET  /api/v1/wallet/withdrawals                 — 登录；可提现余额快照 + 我的申请列表
 *   POST /api/v1/wallet/withdrawals                 — 登录 + 幂等键；提交提现申请
 *   POST /api/v1/wallet/withdrawals/:id/cancel      — 登录 + 幂等键；撤销 pending 申请
 *
 *   GET  /api/v1/admin/withdrawals?status=          — commerce:write；后台申请队列
 *   POST /api/v1/admin/withdrawals/:id/approve      — commerce:write；审核通过（扣款出账）
 *   POST /api/v1/admin/withdrawals/:id/reject       — commerce:write；驳回（已扣款则原路退回）
 *   POST /api/v1/admin/withdrawals/:id/paid         — commerce:write；标记已打款 + 到账凭证
 *   POST /api/v1/admin/earnings/settle              — commerce:write；结算保护期已满的创作分成
 *
 * 挂载顺序注意：本路由必须在 createCommunityRouter 之前挂到 app 上，
 * 否则社区路由的 /wallet 前缀中间件会先跑一遍幂等，造成重复包装响应。
 */

import { Router } from 'express'; // 路由容器
import { z } from 'zod'; // 入参校验
import { parse } from '../validate.js'; // 统一校验入口
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 登录 / 幂等 / RBAC
import {
  MIN_WITHDRAW_CENTS,
  WITHDRAW_METHODS,
  approveWithdrawal,
  cancelWithdrawal,
  createWithdrawal,
  listAdminWithdrawals,
  listUserWithdrawals,
  markWithdrawalPaid,
  readWithdrawableSnapshot,
  rejectWithdrawal,
  settleCreatorEarnings,
  withdrawalStatusSummary,
} from '../commerce/withdrawal.js'; // 结算与状态机
import type { WithdrawalStatus } from '../commerce/withdrawal.js'; // 状态联合类型
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 提交申请请求体 */
const createBody = z.object({
  amount_cents: z.number().int().positive('提现金额必须为正整数（分）'),
  method: z.enum(WITHDRAW_METHODS),
  account_name: z.string().trim().min(2).max(40),
  account_no: z.string().trim().min(4).max(64),
});

/** 后台审核请求体：通过可附备注，驳回必须给原因，打款必须给凭证 */
const approveBody = z.object({ note: z.string().trim().max(200).optional() });
const rejectBody = z.object({ reason: z.string().trim().min(2).max(200) });
const paidBody = z.object({ payout_ref: z.string().trim().min(2).max(120) });

/** 状态过滤参数：空串表示全部 */
const STATUS_VALUES: WithdrawalStatus[] = ['pending', 'approved', 'rejected', 'paid', 'cancelled'];

/** 解析状态查询参数，非法值按「全部」处理，避免后台筛选手抖直接 400 */
function readStatusFilter(value: unknown): WithdrawalStatus | '' {
  const raw = typeof value === 'string' ? value.trim() : '';
  return (STATUS_VALUES as string[]).includes(raw) ? (raw as WithdrawalStatus) : '';
}

/** 操作人标识：引导令牌没有用户主体，统一记为 admin-bootstrap */
function actorOf(req: { adminBootstrap?: boolean; user?: { id: string } | null }): string {
  return req.adminBootstrap === true ? 'admin-bootstrap' : req.user!.id;
}

export function createWalletWithdrawalRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  // 用户侧：仅对提现前缀挂登录 + 幂等，避免影响其他 /wallet 端点
  router.use('/wallet/withdrawals', requireAuth, idempotency);

  // 后台侧：队列与审核统一 commerce:write
  router.use('/admin/withdrawals', requirePermission('commerce:write'));
  router.use('/admin/earnings/settle', requirePermission('commerce:write'));

  // ── 用户端 ────────────────────────────────────────────────────────

  router.get('/wallet/withdrawals', (req, res) => {
    const userId = req.user!.id;
    const snapshot = readWithdrawableSnapshot(deps.db, userId);
    res.json({
      ...snapshot,
      min_withdraw_cents: MIN_WITHDRAW_CENTS,
      methods: WITHDRAW_METHODS,
      items: listUserWithdrawals(deps.db, userId),
    });
  });

  router.post('/wallet/withdrawals', (req, res) => {
    const body = parse(createBody, req.body);
    const row = createWithdrawal(deps, req.user!.id, {
      amountCents: body.amount_cents,
      method: body.method,
      accountName: body.account_name,
      accountNo: body.account_no,
    });
    res.status(201).json({ request: row });
  });

  router.post('/wallet/withdrawals/:id/cancel', (req, res) => {
    const row = cancelWithdrawal(deps, req.user!.id, String(req.params.id));
    res.json({ request: row });
  });

  // ── 后台审核 ──────────────────────────────────────────────────────

  router.get('/admin/withdrawals', (req, res) => {
    const status = readStatusFilter(req.query.status);
    res.json({
      items: listAdminWithdrawals(deps.db, status),
      summary: withdrawalStatusSummary(deps.db),
    });
  });

  router.post('/admin/withdrawals/:id/approve', (req, res) => {
    const body = parse(approveBody, req.body);
    const row = approveWithdrawal(deps, String(req.params.id), actorOf(req), body.note ?? '');
    res.json({ request: row });
  });

  router.post('/admin/withdrawals/:id/reject', (req, res) => {
    const body = parse(rejectBody, req.body);
    const row = rejectWithdrawal(deps, String(req.params.id), actorOf(req), body.reason);
    res.json({ request: row });
  });

  router.post('/admin/withdrawals/:id/paid', (req, res) => {
    const body = parse(paidBody, req.body);
    const row = markWithdrawalPaid(deps, String(req.params.id), actorOf(req), body.payout_ref);
    res.json({ request: row });
  });

  // 创作分成结算：运营在后台手动触发，也可由定时任务复用同一函数
  router.post('/admin/earnings/settle', (_req, res) => {
    const result = settleCreatorEarnings(deps);
    res.json({ ok: true, settled: result.settled, total_cents: result.totalCents });
  });

  return router; // 交出可挂载路由
}
