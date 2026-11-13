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
  const row = deps.db.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as { balance_cents: number; points: number } | undefined; // 常量 row：保存固定配置或一次性派生值
  if (row) return row; // 条件分支：按判断结果选择后续处理路径
  deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now()); // 执行当前业务步骤
  return { balance_cents: 0, points: 100 }; // 返回当前函数的处理结果
} // 代码块结束

/** 余额变动并写一条流水，提现申请时为负数。 */
function moveBalance(deps: ApiDeps, userId: string, amount: number, kind: 'withdraw' | 'commission', note: string, refId: string): void {
  deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(amount, now(), userId); // 执行当前业务步骤
  deps.db // 执行当前业务步骤
    .prepare('INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)') // 执行当前业务步骤
    .run(`wt-${randomUUID()}`, userId, kind, amount, kind, refId, note, now()); // 执行当前业务步骤
} // 代码块结束

export function createFinanceRouter(deps: ApiDeps): Router { // 导出函数 createFinanceRouter：对外暴露的调用入口
  const router = Router(); // 常量 router：保存固定配置或一次性派生值
  router.use('/wallet/withdrawals', requireAuth); // 提现读写都需会话
  router.use('/earnings', requireAuth); // 收益查询与结算

  /** 申请提现：先冻结扣减余额，驳回再退回。 */
  router.post('/wallet/withdrawals', requireAuth, idempotency, (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const body = parse( // 常量 body：保存固定配置或一次性派生值
      z.object({ // 执行当前业务步骤
        amount_cents: z.number().int().min(MIN_WITHDRAW_CENTS).max(1000000), // 对象字段 amount_cents：记录一项配置或数据
        channel: z.enum(['alipay', 'wechat', 'bank']), // 对象字段 channel：记录一项配置或数据
        account: z.string().min(4).max(80), // 对象字段 account：记录一项配置或数据
      }), // 代码块结束
      req.body, // 执行当前业务步骤
    ); // 执行当前业务步骤
    const wallet = walletOf(deps, userId); // 常量 wallet：保存固定配置或一次性派生值
    if (wallet.balance_cents < body.amount_cents) throw new AppError('VALIDATION_FAILED', '可提现余额不足', { reason: 'INSUFFICIENT_BALANCE', balance_cents: wallet.balance_cents }); // 条件分支：按判断结果选择后续处理路径
    const id = `wd-${randomUUID()}`; // 常量 id：保存固定配置或一次性派生值
    const tx = deps.db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
      moveBalance(deps, userId, -body.amount_cents, 'withdraw', '提现申请冻结', id); // 调用 moveBalance 并处理其返回结果
      deps.db // 执行当前业务步骤
        .prepare("INSERT INTO withdrawals (id, user_id, amount_cents, channel, account, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)") // 执行当前业务步骤
        .run(id, userId, body.amount_cents, body.channel, body.account, now(), now()); // 执行当前业务步骤
    }); // 代码块结束
    tx(); // 调用 tx 并处理其返回结果
    res.status(201).json({ ok: true, id, status: 'pending', amount_cents: body.amount_cents }); // 执行当前业务步骤
  }); // 代码块结束

  /** 我的提现记录。 */
  router.get('/wallet/withdrawals', requireAuth, (req, res) => {
    const items = deps.db // 常量 items：保存固定配置或一次性派生值
      .prepare('SELECT id, amount_cents, channel, account, status, admin_note, created_at, processed_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 30') // 执行当前业务步骤
      .all(req.user!.id); // 注册 ALL 路由 / 中间件处理器
    res.json({ items, balance_cents: walletOf(deps, req.user!.id).balance_cents }); // 执行当前业务步骤
  }); // 代码块结束

  /** 运营审核：approve 进入待打款，paid 标记已打款，reject 退回余额。 */
  router.post('/withdrawals/:id/review', requirePermission('commerce:write'), idempotency, (req, res) => {
    const body = parse(z.object({ action: z.enum(['approve', 'paid', 'reject']), note: z.string().max(200).default('') }), req.body); // 常量 body：保存固定配置或一次性派生值
    const row = deps.db.prepare('SELECT id, user_id, amount_cents, status FROM withdrawals WHERE id = ?').get(req.params.id) as // 常量 row：保存固定配置或一次性派生值
      | { id: string; user_id: string; amount_cents: number; status: string } // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (!row) throw new AppError('NOT_FOUND', '提现单不存在'); // 条件分支：按判断结果选择后续处理路径
    if (row.status === 'rejected' || row.status === 'paid') throw new AppError('CONFLICT', '提现单已终结'); // 条件分支：按判断结果选择后续处理路径
    if (body.action === 'paid' && row.status !== 'approved') throw new AppError('CONFLICT', '需先审核通过再标记打款'); // 条件分支：按判断结果选择后续处理路径
    const ts = now(); // 常量 ts：保存固定配置或一次性派生值
    const tx = deps.db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
      if (body.action === 'reject') { // 条件分支：按判断结果选择后续处理路径
        moveBalance(deps, row.user_id, row.amount_cents, 'commission', '提现驳回退回', row.id); // 调用 moveBalance 并处理其返回结果
        deps.db.prepare("UPDATE withdrawals SET status = 'rejected', admin_note = ?, updated_at = ?, processed_at = ? WHERE id = ?").run(body.note, ts, ts, row.id); // 执行当前业务步骤
      } else { // 代码块结束
        deps.db.prepare('UPDATE withdrawals SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?').run(body.action === 'paid' ? 'paid' : 'approved', body.note, ts, row.id); // 执行当前业务步骤
      } // 代码块结束
    }); // 代码块结束
    tx(); // 调用 tx 并处理其返回结果
    res.json({ ok: true, status: body.action === 'reject' ? 'rejected' : body.action === 'paid' ? 'paid' : 'approved' }); // 执行当前业务步骤
  }); // 代码块结束

  /** 创作者收益：明细与待结算汇总。 */
  router.get('/earnings', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const items = deps.db // 常量 items：保存固定配置或一次性派生值
      .prepare('SELECT source_type, source_id, gross_cents, platform_fee_cents, net_cents, status, created_at, settled_at FROM creator_earnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50') // 执行当前业务步骤
      .all(userId); // 注册 ALL 路由 / 中间件处理器
    const summary = deps.db // 常量 summary：保存固定配置或一次性派生值
      .prepare("SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN net_cents ELSE 0 END), 0) AS pending, COALESCE(SUM(CASE WHEN status = 'settled' THEN net_cents ELSE 0 END), 0) AS settled FROM creator_earnings WHERE user_id = ?") // 执行当前业务步骤
      .get(userId); // 注册 GET 路由 / 中间件处理器
    res.json({ items, summary }); // 执行当前业务步骤
  }); // 代码块结束

  /** 结算待入账收益：把 pending 全部转为余额，事务内逐条标记防重复。 */
  router.post('/earnings/settle', idempotency, (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const pending = deps.db.prepare("SELECT id, net_cents FROM creator_earnings WHERE user_id = ? AND status = 'pending'").all(userId) as Array<{ id: string; net_cents: number }>; // 常量 pending：保存固定配置或一次性派生值
    if (pending.length === 0) return res.json({ ok: true, settled_cents: 0, count: 0 }); // 条件分支：按判断结果选择后续处理路径
    const total = pending.reduce((sum, row) => sum + row.net_cents, 0); // 常量 total：保存固定配置或一次性派生值
    const ts = now(); // 常量 ts：保存固定配置或一次性派生值
    const tx = deps.db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
      for (const row of pending) { // 循环：逐项遍历集合并执行相同处理
        const changed = deps.db.prepare("UPDATE creator_earnings SET status = 'settled', settled_at = ? WHERE id = ? AND status = 'pending'").run(ts, row.id); // 常量 changed：保存固定配置或一次性派生值
        if (changed.changes === 1) moveBalance(deps, userId, row.net_cents, 'commission', '创作收益结算', row.id); // 条件分支：按判断结果选择后续处理路径
      } // 代码块结束
    }); // 代码块结束
    tx(); // 调用 tx 并处理其返回结果
    res.json({ ok: true, settled_cents: total, count: pending.length }); // 执行当前业务步骤
  }); // 代码块结束

  /** 平台资金汇总：运营看板用。 */
  router.get('/admin/finance/summary', requirePermission('commerce:write'), (_req, res) => {
    const wallets = deps.db.prepare('SELECT COUNT(*) AS users, COALESCE(SUM(balance_cents), 0) AS balance FROM wallets').get(); // 常量 wallets：保存固定配置或一次性派生值
    const withdrawals = deps.db.prepare("SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount FROM withdrawals GROUP BY status").all(); // 常量 withdrawals：保存固定配置或一次性派生值
    const earnings = deps.db.prepare("SELECT status, COUNT(*) AS count, COALESCE(SUM(net_cents), 0) AS amount FROM creator_earnings GROUP BY status").all(); // 常量 earnings：保存固定配置或一次性派生值
    const orders = deps.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(payable_cents), 0) AS amount FROM shop_orders WHERE status IN ('paid','delivered')").get(); // 常量 orders：保存固定配置或一次性派生值
    res.json({ wallets, withdrawals, earnings, orders }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
