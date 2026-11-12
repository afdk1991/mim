/** 资金路由：余额提现申请与审核、创作者收益结算、平台资金汇总 */

import { Router } from 'express'; // 路由容器
import { randomUUID } from 'node:crypto'; // 主键
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 鉴权与运营权限
import { parse } from '../validate.js'; // 校验错误翻译
import type { ApiDeps } from '../types.js'; // 依赖容器

const now = () => new Date().toISOString(); // UTC 时间
const MIN_WITHDRAW_CENTS = 1000; // 最低 10 元起提

/** 取钱包；不存在时按 0 余额开户，避免首次提现读空。 */
function walletOf(deps: ApiDeps, userId: string): { balance_cents: number; points: number } {
  const row = deps.db.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as { balance_cents: number; points: number } | undefined;
  if (row) return row;
  deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now());
  return { balance_cents: 0, points: 100 };
}

/** 余额变动并写一条流水，提现申请时为负数。 */
function moveBalance(deps: ApiDeps, userId: string, amount: number, kind: 'withdraw' | 'commission', note: string, refId: string): void {
  deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(amount, now(), userId);
  deps.db
    .prepare('INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(`wt-${randomUUID()}`, userId, kind, amount, kind, refId, note, now());
}

export function createFinanceRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use('/wallet/withdrawals', requireAuth); // 提现读写都需会话
  router.use('/earnings', requireAuth); // 收益查询与结算

  /** 申请提现：先冻结扣减余额，驳回再退回。 */
  router.post('/wallet/withdrawals', requireAuth, idempotency, (req, res) => {
    const userId = req.user!.id;
    const body = parse(
      z.object({
        amount_cents: z.number().int().min(MIN_WITHDRAW_CENTS).max(1000000),
        channel: z.enum(['alipay', 'wechat', 'bank']),
        account: z.string().min(4).max(80),
      }),
      req.body,
    );
    const wallet = walletOf(deps, userId);
    if (wallet.balance_cents < body.amount_cents) throw new AppError('VALIDATION_FAILED', '可提现余额不足', { reason: 'INSUFFICIENT_BALANCE', balance_cents: wallet.balance_cents });
    const id = `wd-${randomUUID()}`;
    const tx = deps.db.transaction(() => {
      moveBalance(deps, userId, -body.amount_cents, 'withdraw', '提现申请冻结', id);
      deps.db
        .prepare("INSERT INTO withdrawals (id, user_id, amount_cents, channel, account, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
        .run(id, userId, body.amount_cents, body.channel, body.account, now(), now());
    });
    tx();
    res.status(201).json({ ok: true, id, status: 'pending', amount_cents: body.amount_cents });
  });

  /** 我的提现记录。 */
  router.get('/wallet/withdrawals', requireAuth, (req, res) => {
    const items = deps.db
      .prepare('SELECT id, amount_cents, channel, account, status, admin_note, created_at, processed_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(req.user!.id);
    res.json({ items, balance_cents: walletOf(deps, req.user!.id).balance_cents });
  });

  /** 运营审核：approve 进入待打款，paid 标记已打款，reject 退回余额。 */
  router.post('/withdrawals/:id/review', requirePermission('commerce:write'), idempotency, (req, res) => {
    const body = parse(z.object({ action: z.enum(['approve', 'paid', 'reject']), note: z.string().max(200).default('') }), req.body);
    const row = deps.db.prepare('SELECT id, user_id, amount_cents, status FROM withdrawals WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string; amount_cents: number; status: string }
      | undefined;
    if (!row) throw new AppError('NOT_FOUND', '提现单不存在');
    if (row.status === 'rejected' || row.status === 'paid') throw new AppError('CONFLICT', '提现单已终结');
    if (body.action === 'paid' && row.status !== 'approved') throw new AppError('CONFLICT', '需先审核通过再标记打款');
    const ts = now();
    const tx = deps.db.transaction(() => {
      if (body.action === 'reject') {
        moveBalance(deps, row.user_id, row.amount_cents, 'commission', '提现驳回退回', row.id);
        deps.db.prepare("UPDATE withdrawals SET status = 'rejected', admin_note = ?, updated_at = ?, processed_at = ? WHERE id = ?").run(body.note, ts, ts, row.id);
      } else {
        deps.db.prepare('UPDATE withdrawals SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?').run(body.action === 'paid' ? 'paid' : 'approved', body.note, ts, row.id);
      }
    });
    tx();
    res.json({ ok: true, status: body.action === 'reject' ? 'rejected' : body.action === 'paid' ? 'paid' : 'approved' });
  });

  /** 创作者收益：明细与待结算汇总。 */
  router.get('/earnings', (req, res) => {
    const userId = req.user!.id;
    const items = deps.db
      .prepare('SELECT source_type, source_id, gross_cents, platform_fee_cents, net_cents, status, created_at, settled_at FROM creator_earnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(userId);
    const summary = deps.db
      .prepare("SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN net_cents ELSE 0 END), 0) AS pending, COALESCE(SUM(CASE WHEN status = 'settled' THEN net_cents ELSE 0 END), 0) AS settled FROM creator_earnings WHERE user_id = ?")
      .get(userId);
    res.json({ items, summary });
  });

  /** 结算待入账收益：把 pending 全部转为余额，事务内逐条标记防重复。 */
  router.post('/earnings/settle', idempotency, (req, res) => {
    const userId = req.user!.id;
    const pending = deps.db.prepare("SELECT id, net_cents FROM creator_earnings WHERE user_id = ? AND status = 'pending'").all(userId) as Array<{ id: string; net_cents: number }>;
    if (pending.length === 0) return res.json({ ok: true, settled_cents: 0, count: 0 });
    const total = pending.reduce((sum, row) => sum + row.net_cents, 0);
    const ts = now();
    const tx = deps.db.transaction(() => {
      for (const row of pending) {
        const changed = deps.db.prepare("UPDATE creator_earnings SET status = 'settled', settled_at = ? WHERE id = ? AND status = 'pending'").run(ts, row.id);
        if (changed.changes === 1) moveBalance(deps, userId, row.net_cents, 'commission', '创作收益结算', row.id);
      }
    });
    tx();
    res.json({ ok: true, settled_cents: total, count: pending.length });
  });

  /** 平台资金汇总：运营看板用。 */
  router.get('/admin/finance/summary', requirePermission('commerce:write'), (_req, res) => {
    const wallets = deps.db.prepare('SELECT COUNT(*) AS users, COALESCE(SUM(balance_cents), 0) AS balance FROM wallets').get();
    const withdrawals = deps.db.prepare("SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount FROM withdrawals GROUP BY status").all();
    const earnings = deps.db.prepare("SELECT status, COUNT(*) AS count, COALESCE(SUM(net_cents), 0) AS amount FROM creator_earnings GROUP BY status").all();
    const orders = deps.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(payable_cents), 0) AS amount FROM shop_orders WHERE status IN ('paid','delivered')").get();
    res.json({ wallets, withdrawals, earnings, orders });
  });

  return router;
}
