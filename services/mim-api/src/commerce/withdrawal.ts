/**
 * 提现分成（钱包结算层）：可提现余额口径 + 提现申请 / 审核 / 到账状态机。
 *
 * ── 可提现口径（与充值余额严格分开）─────────────────────────────────
 *   balance_cents       钱包总余额，可消费（付费帖 / VIP / 商城 / 社区商城）；
 *   withdrawable_cents  其中「可提现」的部分，只能由分成类收入累积。
 *   计入可提现：推广佣金（referral_commissions 结算）、创作分成（creator_earnings 结算）；
 *   不计入：平台充值 / 卡密兑换 / 退款 / 签到积分 —— 这些只增加 balance_cents。
 *   不变式：0 <= withdrawable_cents <= balance_cents。
 *   钱包消费可能吃掉可提现部分，因此读取时统一夹紧为 min(withdrawable, balance)。
 *
 * ── 提现流程 ────────────────────────────────────────────────────
 *   pending  → 用户提交，冻结金额（reserved = SUM(pending)），不动余额；
 *   approved → 审核通过，立即扣减 balance 与 withdrawable，并写一条 withdraw 流水；
 *   paid     → 运营标记已打款，记录 payout_ref，不再动账；
 *   rejected → 驳回；若此前已 approved，则原路退回余额与可提现额度并写 refund 流水；
 *   cancelled→ 用户自行撤销，仅 pending 可撤。
 *   可用额度 = withdrawable - reserved（reserved 只统计 pending）。
 *
 * ── 幂等与并发 ─────────────────────────────────────────────────
 *   1) 所有金额均为整数分，入参显式校验 Number.isInteger；
 *   2) 状态迁移一律条件 UPDATE（WHERE status='...'），重复调用不会二次出账；
 *   3) 扣款 UPDATE 同时校验 balance 与 withdrawable，余额不足时整笔事务回滚；
 *   4) 出账 / 退款流水使用确定性主键（wt-wd-<id> / wt-wdr-<id>）+ INSERT OR IGNORE，
 *      数据库层再兜一层防重复；
 *   5) 「同一用户只能有一笔处理中申请」由部分唯一索引兜底，并发重复提交直接 409。
 */

import { uuidv7 } from '@mim/core-domain'; // 事件主键，时间有序
import { AppError } from '@mim/core-domain'; // 统一业务异常
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与数据库类型
import { clockOf } from '../domain.js'; // 可注入时钟
import { readReferralConfig } from './referral-settlement.js'; // 复用返佣保护期配置

/** 提现方式：支付宝 / 微信 / 银行卡 */
export const WITHDRAW_METHODS = ['alipay', 'wechat', 'bank'] as const;
export type WithdrawMethod = (typeof WITHDRAW_METHODS)[number];

/** 方式中文名：写流水备注与后台展示共用，避免多处字面量漂移 */
export const WITHDRAW_METHOD_LABEL: Record<WithdrawMethod, string> = {
  alipay: '支付宝',
  wechat: '微信',
  bank: '银行卡',
};

/** 单笔最低提现金额（分）：10 元；低于此额度的申请直接拒绝，避免小额打款成本 */
export const MIN_WITHDRAW_CENTS = 1000;

/** 提现状态：与 withdrawal_requests.status CHECK 保持一致 */
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';

/** 提现申请行（不含用户资料） */
export interface WithdrawalRow {
  id: string;
  user_id: string;
  amount_cents: number;
  status: WithdrawalStatus;
  method: WithdrawMethod;
  account_name: string;
  account_no: string;
  review_note: string;
  reviewer: string | null;
  payout_ref: string | null;
  created_at: string;
  reviewed_at: string | null;
  paid_at: string | null;
  updated_at: string;
}

/** 后台队列行：附带用户展示名与 Mim ID，便于运营核对打款对象 */
export interface AdminWithdrawalRow extends WithdrawalRow {
  display_name: string;
  member_no: string | null;
}

/** 钱包可提现快照：available = withdrawable - reserved */
export interface WithdrawableSnapshot {
  balance_cents: number;
  withdrawable_cents: number;
  reserved_cents: number;
  available_cents: number;
}

/** 创建申请入参 */
export interface CreateWithdrawalInput {
  amountCents: number;
  method: WithdrawMethod;
  accountName: string;
  accountNo: string;
}

/** 创作分成结算结果 */
export interface CreatorSettleResult {
  settled: number;
  totalCents: number;
}

/** 读取单笔申请（内部复用） */
function getWithdrawalRow(db: Db, id: string): WithdrawalRow | undefined {
  return db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(id) as WithdrawalRow | undefined;
}

/** 读取钱包可提现快照：withdrawable 夹紧到 [0, balance]，reserved 只算 pending */
export function readWithdrawableSnapshot(db: Db, userId: string): WithdrawableSnapshot {
  const wallet = db
    .prepare('SELECT balance_cents, withdrawable_cents FROM wallets WHERE user_id = ?')
    .get(userId) as { balance_cents: number; withdrawable_cents: number } | undefined;
  const reservedRow = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM withdrawal_requests WHERE user_id = ? AND status = 'pending'")
    .get(userId) as { total: number };
  const balance = wallet?.balance_cents ?? 0;
  // 历史消费可能让可提现列高于当前余额，展示与校验统一夹紧，避免口径超过真实余额
  const withdrawable = Math.max(0, Math.min(wallet?.withdrawable_cents ?? 0, balance));
  const reserved = Math.max(0, reservedRow.total);
  return {
    balance_cents: balance,
    withdrawable_cents: withdrawable,
    reserved_cents: reserved,
    available_cents: Math.max(0, withdrawable - reserved),
  };
}

/**
 * 确保钱包行存在。
 * 新用户见面礼（100 积分 + points 流水）与社区钱包首次打开保持一致：
 * 分成先到账的用户不会因为本模块提前建行而丢掉新人积分。
 */
function ensureSettlementWallet(db: Db, userId: string, now: string): void {
  const existing = db.prepare('SELECT user_id FROM wallets WHERE user_id = ?').get(userId) as { user_id: string } | undefined;
  if (existing) return;
  db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now);
  db.prepare("INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', 100, '新用户见面礼', ?)").run(
    `wt-${uuidv7()}`,
    userId,
    now,
  );
}

/** 金额必须是正整数分：任何浮点 / 字符串 / 负数都在此拦截，杜绝浮点误差 */
function assertIntegerCents(value: number, fieldLabel: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError('VALIDATION_FAILED', `${fieldLabel}必须为正整数（单位：分）`, { field: fieldLabel });
  }
}

/** 创建提现申请：冻结额度，不动余额 */
export function createWithdrawal(deps: ApiDeps, userId: string, input: CreateWithdrawalInput, now: string = clockOf(deps)): WithdrawalRow {
  const amountCents = input.amountCents;
  assertIntegerCents(amountCents, '提现金额');
  if (amountCents < MIN_WITHDRAW_CENTS) {
    throw new AppError('VALIDATION_FAILED', `单笔提现不得低于 ${(MIN_WITHDRAW_CENTS / 100).toFixed(2)} 元`, {
      reason: 'BELOW_MINIMUM',
      min_withdraw_cents: MIN_WITHDRAW_CENTS,
    });
  }
  const accountName = input.accountName.trim();
  const accountNo = input.accountNo.trim();
  if (accountName.length < 2 || accountName.length > 40) {
    throw new AppError('VALIDATION_FAILED', '收款人姓名需 2–40 个字符', { field: 'account_name' });
  }
  if (accountNo.length < 4 || accountNo.length > 64) {
    throw new AppError('VALIDATION_FAILED', '收款账号需 4–64 个字符', { field: 'account_no' });
  }

  const db = deps.db;
  try {
    // 快照读取与插入放在同一事务，避免「读到可用额度后被另一笔申请抢占」
    return db.transaction(() => {
      const snapshot = readWithdrawableSnapshot(db, userId);
      if (snapshot.available_cents < amountCents) {
        throw new AppError('VALIDATION_FAILED', '可提现余额不足', {
          reason: 'INSUFFICIENT_WITHDRAWABLE',
          available_cents: snapshot.available_cents,
          withdrawable_cents: snapshot.withdrawable_cents,
          reserved_cents: snapshot.reserved_cents,
        });
      }
      const id = `wd-${uuidv7()}`;
      db.prepare(
        `INSERT INTO withdrawal_requests
           (id, user_id, amount_cents, status, method, account_name, account_no, review_note, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, '', ?, ?)`,
      ).run(id, userId, amountCents, input.method, accountName, accountNo, now, now);
      return getWithdrawalRow(db, id)!;
    })();
  } catch (error) {
    // 部分唯一索引冲突：已有处理中的申请（并发重复提交会走到这里）
    const code = (error as { code?: string }).code ?? '';
    if (code.startsWith('SQLITE_CONSTRAINT')) {
      throw new AppError('CONFLICT', '已有处理中的提现申请，请等待处理或先撤销');
    }
    throw error;
  }
}

/** 用户撤销申请：仅 pending 可撤，撤销后立即释放冻结额度 */
export function cancelWithdrawal(deps: ApiDeps, userId: string, id: string, now: string = clockOf(deps)): WithdrawalRow {
  const db = deps.db;
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id);
    if (!row || row.user_id !== userId) throw new AppError('NOT_FOUND', '提现申请不存在');
    if (row.status !== 'pending') throw new AppError('CONFLICT', `当前状态（${row.status}）不可撤销`);
    const changed = db
      .prepare("UPDATE withdrawal_requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(now, id).changes;
    if (changed !== 1) throw new AppError('CONFLICT', '该申请状态已变化，请刷新后重试');
    return getWithdrawalRow(db, id)!;
  })();
}

/** 审核通过：条件迁移 + 条件扣款 + 确定性流水，重复调用不会二次出账 */
export function approveWithdrawal(
  deps: ApiDeps,
  id: string,
  reviewer: string,
  note: string = '',
  now: string = clockOf(deps),
): WithdrawalRow {
  const db = deps.db;
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id);
    if (!row) throw new AppError('NOT_FOUND', '提现申请不存在');
    if (row.status !== 'pending') throw new AppError('CONFLICT', `当前状态（${row.status}）不可审核通过`);

    const snapshot = readWithdrawableSnapshot(db, row.user_id);
    if (snapshot.withdrawable_cents < row.amount_cents || snapshot.balance_cents < row.amount_cents) {
      throw new AppError('VALIDATION_FAILED', '可提现余额不足，无法通过该申请', {
        reason: 'INSUFFICIENT_WITHDRAWABLE',
        withdrawable_cents: snapshot.withdrawable_cents,
        balance_cents: snapshot.balance_cents,
      });
    }

    // 状态迁移先行：并发审核时只有一个请求能把 pending 改成 approved
    const changed = db
      .prepare("UPDATE withdrawal_requests SET status = 'approved', reviewer = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(reviewer, note.trim(), now, now, id).changes;
    if (changed !== 1) throw new AppError('CONFLICT', '该申请已被其他审核人处理');

    // 扣款：同时校验余额与可提现额度，任一不足则整笔事务回滚（含上面的状态迁移）
    const debited = db
      .prepare(
        `UPDATE wallets SET
           balance_cents = balance_cents - ?,
           withdrawable_cents = MAX(0, MIN(withdrawable_cents - ?, balance_cents - ?)),
           updated_at = ?
         WHERE user_id = ? AND balance_cents >= ? AND withdrawable_cents >= ?`,
      )
      .run(row.amount_cents, row.amount_cents, row.amount_cents, now, row.user_id, row.amount_cents, row.amount_cents).changes;
    if (debited !== 1) throw new AppError('VALIDATION_FAILED', '可提现余额不足，审核未生效');

    // 出账流水：确定性主键 + INSERT OR IGNORE，数据库层兜底防重复扣款
    db.prepare(
      `INSERT OR IGNORE INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at)
       VALUES (?, ?, 'withdraw', ?, 'withdrawal', ?, ?, ?)`,
    ).run(`wt-wd-${id}`, row.user_id, -row.amount_cents, id, `提现审核通过（${WITHDRAW_METHOD_LABEL[row.method]}）`, now);

    return getWithdrawalRow(db, id)!;
  })();
}

/** 驳回：pending 直接驳回；approved 驳回需原路退回并写 refund 流水 */
export function rejectWithdrawal(
  deps: ApiDeps,
  id: string,
  reviewer: string,
  reason: string,
  now: string = clockOf(deps),
): WithdrawalRow {
  const trimmed = reason.trim();
  if (trimmed.length < 2 || trimmed.length > 200) {
    throw new AppError('VALIDATION_FAILED', '驳回原因需 2–200 个字符', { field: 'reason' });
  }
  const db = deps.db;
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id);
    if (!row) throw new AppError('NOT_FOUND', '提现申请不存在');
    if (row.status !== 'pending' && row.status !== 'approved') {
      throw new AppError('CONFLICT', `当前状态（${row.status}）不可驳回`);
    }
    const changed = db
      .prepare(
        "UPDATE withdrawal_requests SET status = 'rejected', reviewer = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .run(reviewer, trimmed, now, now, id, row.status).changes;
    if (changed !== 1) throw new AppError('CONFLICT', '该申请状态已变化，请刷新后重试');

    if (row.status === 'approved') {
      // 已扣过款：余额与可提现额度原路退回，保证两边口径同步恢复
      db.prepare(
        `UPDATE wallets SET
           balance_cents = balance_cents + ?,
           withdrawable_cents = MAX(0, MIN(withdrawable_cents + ?, balance_cents + ?)),
           updated_at = ?
         WHERE user_id = ?`,
      ).run(row.amount_cents, row.amount_cents, row.amount_cents, now, row.user_id);
      db.prepare(
        `INSERT OR IGNORE INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at)
         VALUES (?, ?, 'refund', ?, 'withdrawal', ?, ?, ?)`,
      ).run(`wt-wdr-${id}`, row.user_id, row.amount_cents, id, `提现驳回退回：${trimmed}`, now);
    }

    return getWithdrawalRow(db, id)!;
  })();
}

/** 标记已打款：仅 approved 可流转，只记录打款凭证，不再动账 */
export function markWithdrawalPaid(
  deps: ApiDeps,
  id: string,
  reviewer: string,
  payoutRef: string,
  now: string = clockOf(deps),
): WithdrawalRow {
  const ref = payoutRef.trim();
  if (ref.length < 2 || ref.length > 120) {
    throw new AppError('VALIDATION_FAILED', '打款凭证需 2–120 个字符', { field: 'payout_ref' });
  }
  const db = deps.db;
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id);
    if (!row) throw new AppError('NOT_FOUND', '提现申请不存在');
    if (row.status !== 'approved') throw new AppError('CONFLICT', `当前状态（${row.status}）不可标记到账`);
    const changed = db
      .prepare(
        "UPDATE withdrawal_requests SET status = 'paid', reviewer = ?, payout_ref = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'",
      )
      .run(reviewer, ref, now, now, id).changes;
    if (changed !== 1) throw new AppError('CONFLICT', '该申请状态已变化，请刷新后重试');
    return getWithdrawalRow(db, id)!;
  })();
}

/** 用户侧申请列表：按创建时间倒序，只返回自己的记录 */
export function listUserWithdrawals(db: Db, userId: string, limit = 50): WithdrawalRow[] {
  return db
    .prepare('SELECT * FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, Math.min(Math.max(limit, 1), 200)) as WithdrawalRow[];
}

/** 后台队列：可按状态过滤，附带用户展示名与 Mim ID；offset 用于真分页 */
export function listAdminWithdrawals(db: Db, status: WithdrawalStatus | '', limit = 100, offset = 0): AdminWithdrawalRow[] {
  const capped = Math.min(Math.max(limit, 1), 300);
  const start = Math.max(offset, 0);
  if (status) {
    return db
      .prepare(
        `SELECT w.*, u.display_name, u.member_no
         FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
         WHERE w.status = ? ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(status, capped, start) as AdminWithdrawalRow[];
  }
  return db
    .prepare(
      `SELECT w.*, u.display_name, u.member_no
       FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
       ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(capped, start) as AdminWithdrawalRow[];
}

/** 后台队列计数：各状态待处理量，用于顶部分类标签 */
export function withdrawalStatusSummary(db: Db): Record<WithdrawalStatus, number> {
  const rows = db.prepare('SELECT status, COUNT(*) AS total FROM withdrawal_requests GROUP BY status').all() as Array<{
    status: WithdrawalStatus;
    total: number;
  }>;
  const summary: Record<WithdrawalStatus, number> = { pending: 0, approved: 0, rejected: 0, paid: 0, cancelled: 0 };
  for (const row of rows) summary[row.status] = row.total;
  return summary;
}

/**
 * 创作分成结算：把保护期已过的 pending 分成转成可提现余额。
 * 与推广佣金共用 MIM_REFERRAL_PROTECT_DAYS 保护期（缺省 7 天），避免两套时间口径。
 * 每笔独立事务 + 条件 UPDATE，重复调用不会二次入账。
 */
export function settleCreatorEarnings(deps: ApiDeps, userId?: string, now: string = clockOf(deps)): CreatorSettleResult {
  const db = deps.db;
  const protectDays = readReferralConfig(deps.env).protectDays;
  const cutoff = new Date(Date.parse(now) - protectDays * 86400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT id, user_id, net_cents, source_type FROM creator_earnings
       WHERE status = 'pending' AND created_at <= ? AND (? IS NULL OR user_id = ?)
       ORDER BY created_at ASC LIMIT 500`,
    )
    .all(cutoff, userId ?? null, userId ?? null) as Array<{ id: string; user_id: string; net_cents: number; source_type: string }>;

  const settleOne = db.transaction((row: { id: string; user_id: string; net_cents: number; source_type: string }): number => {
    if (row.net_cents <= 0) return 0; // 非正分成不入账，避免产生负余额
    const changed = db
      .prepare("UPDATE creator_earnings SET status = 'settled', settled_at = ? WHERE id = ? AND status = 'pending'")
      .run(now, row.id).changes;
    if (changed !== 1) return 0; // 已被其他进程结算
    ensureSettlementWallet(db, row.user_id, now);
    // 分成同时进入总余额与可提现余额：这是「可提现」的唯一来源之一
    db.prepare(
      'UPDATE wallets SET balance_cents = balance_cents + ?, withdrawable_cents = withdrawable_cents + ?, updated_at = ? WHERE user_id = ?',
    ).run(row.net_cents, row.net_cents, now, row.user_id);
    db.prepare(
      `INSERT OR IGNORE INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at)
       VALUES (?, ?, 'commission', ?, 'creator_earning', ?, ?, ?)`,
    ).run(`wt-ce-${row.id}`, row.user_id, row.net_cents, row.id, `创作分成结算（${row.source_type}）`, now);
    return row.net_cents;
  });

  let settled = 0;
  let totalCents = 0;
  for (const row of rows) {
    const credited = settleOne(row);
    if (credited > 0) {
      settled += 1;
      totalCents += credited;
    }
  }
  return { settled, totalCents };
}
