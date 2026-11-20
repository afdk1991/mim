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

// 引入 uuidv7：生成时间有序的事件主键
import { uuidv7 } from '@mim/core-domain'; // 事件主键，时间有序
// 引入统一业务异常：金额 / 状态 / 权限类错误统一信封
import { AppError } from '@mim/core-domain'; // 统一业务异常
// 引入依赖容器与数据库类型：约束入参结构
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与数据库类型
// 引入可注入时钟：取当前时间，便于测试冻结
import { clockOf } from '../domain.js'; // 可注入时钟
// 引入返佣配置读取：复用分成保护期天数
import { readReferralConfig } from './referral-settlement.js'; // 复用返佣保护期配置

/** 提现方式：支付宝 / 微信 / 银行卡 */
export const WITHDRAW_METHODS = ['alipay', 'wechat', 'bank'] as const;
// 方式联合类型：从常量元组推导，避免字面量漂移
export type WithdrawMethod = (typeof WITHDRAW_METHODS)[number];

/** 方式中文名：写流水备注与后台展示共用，避免多处字面量漂移 */
export const WITHDRAW_METHOD_LABEL: Record<WithdrawMethod, string> = {
  alipay: '支付宝', // 支付宝提现
  wechat: '微信', // 微信提现
  bank: '银行卡', // 银行卡提现
};

/** 单笔最低提现金额（分）：10 元；低于此额度的申请直接拒绝，避免小额打款成本 */
export const MIN_WITHDRAW_CENTS = 1000;

/** 提现状态：与 withdrawal_requests.status CHECK 保持一致 */
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';

/** 提现申请行（不含用户资料） */
export interface WithdrawalRow {
  id: string; // 申请主键 wd-<uuidv7>
  user_id: string; // 申请人主键
  amount_cents: number; // 提现金额（整数分）
  status: WithdrawalStatus; // 当前状态机档位
  method: WithdrawMethod; // 收款方式
  account_name: string; // 收款人姓名
  account_no: string; // 收款账号
  review_note: string; // 审核 / 驳回备注
  reviewer: string | null; // 审核人标识
  payout_ref: string | null; // 打款凭证
  created_at: string; // 申请创建时间
  reviewed_at: string | null; // 审核时间
  paid_at: string | null; // 标记到账时间
  updated_at: string; // 最近更新时间
}

/** 后台队列行：附带用户展示名与 Mim ID，便于运营核对打款对象 */
export interface AdminWithdrawalRow extends WithdrawalRow {
  display_name: string; // 用户展示名
  member_no: string | null; // 对外 Mim ID
}

/** 钱包可提现快照：available = withdrawable - reserved */
export interface WithdrawableSnapshot {
  balance_cents: number; // 钱包总余额（分）
  withdrawable_cents: number; // 可提现额度（分，已夹紧）
  reserved_cents: number; // 冻结额度（分，仅 pending）
  available_cents: number; // 当前可用可提现额度（分）
}

/** 创建申请入参 */
export interface CreateWithdrawalInput {
  amountCents: number; // 提现金额（分）
  method: WithdrawMethod; // 收款方式
  accountName: string; // 收款人姓名
  accountNo: string; // 收款账号
}

/** 创作分成结算结果 */
export interface CreatorSettleResult {
  settled: number; // 本次结算笔数
  totalCents: number; // 本次结算金额合计（分）
}

/** 读取单笔申请（内部复用） */
function getWithdrawalRow(db: Db, id: string): WithdrawalRow | undefined {
  // 按主键取申请行，未命中返回 undefined 供上层判 NOT_FOUND
  return db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(id) as WithdrawalRow | undefined;
}

/** 读取钱包可提现快照：withdrawable 夹紧到 [0, balance]，reserved 只算 pending */
export function readWithdrawableSnapshot(db: Db, userId: string): WithdrawableSnapshot {
  // 取钱包总余额与可提现额度
  const wallet = db
    .prepare('SELECT balance_cents, withdrawable_cents FROM wallets WHERE user_id = ?')
    .get(userId) as { balance_cents: number; withdrawable_cents: number } | undefined;
  // 统计处理中申请冻结金额（仅 pending）
  const reservedRow = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM withdrawal_requests WHERE user_id = ? AND status = 'pending'")
    .get(userId) as { total: number };
  const balance = wallet?.balance_cents ?? 0; // 总余额，缺省 0
  // 历史消费可能让可提现列高于当前余额，展示与校验统一夹紧，避免口径超过真实余额
  const withdrawable = Math.max(0, Math.min(wallet?.withdrawable_cents ?? 0, balance));
  const reserved = Math.max(0, reservedRow.total); // 冻结额非负
  return {
    balance_cents: balance, // 回传总余额
    withdrawable_cents: withdrawable, // 回传夹紧后的可提现额度
    reserved_cents: reserved, // 回传冻结额度
    available_cents: Math.max(0, withdrawable - reserved), // 可用额度 = 可提现 - 冻结
  };
}

/**
 * 确保钱包行存在。
 * 新用户见面礼（100 积分 + points 流水）与社区钱包首次打开保持一致：
 * 分成先到账的用户不会因为本模块提前建行而丢掉新人积分。
 */
function ensureSettlementWallet(db: Db, userId: string, now: string): void {
  // 已存在钱包行则直接返回，避免重复发见面礼
  const existing = db.prepare('SELECT user_id FROM wallets WHERE user_id = ?').get(userId) as { user_id: string } | undefined;
  if (existing) return;
  // 建行：总余额 0、积分 100（新人见面礼）
  db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now);
  // 同步写一条积分流水留痕
  db.prepare("INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', 100, '新用户见面礼', ?)").run(
    `wt-${uuidv7()}`, // 流水主键
    userId, // 归属用户
    now, // 入账时间
  );
}

/** 金额必须是正整数分：任何浮点 / 字符串 / 负数都在此拦截，杜绝浮点误差 */
function assertIntegerCents(value: number, fieldLabel: string): void {
  // 非整数或非正数一律抛校验错误
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError('VALIDATION_FAILED', `${fieldLabel}必须为正整数（单位：分）`, { field: fieldLabel });
  }
}

/** 创建提现申请：冻结额度，不动余额 */
export function createWithdrawal(deps: ApiDeps, userId: string, input: CreateWithdrawalInput, now: string = clockOf(deps)): WithdrawalRow {
  const amountCents = input.amountCents; // 提现金额（分）
  assertIntegerCents(amountCents, '提现金额'); // 先校验正整数分
  // 低于单笔最低额度直接拒绝
  if (amountCents < MIN_WITHDRAW_CENTS) {
    throw new AppError('VALIDATION_FAILED', `单笔提现不得低于 ${(MIN_WITHDRAW_CENTS / 100).toFixed(2)} 元`, {
      reason: 'BELOW_MINIMUM', // 低于门槛原因码
      min_withdraw_cents: MIN_WITHDRAW_CENTS, // 门槛值回传
    });
  }
  const accountName = input.accountName.trim(); // 收款人姓名去空白
  const accountNo = input.accountNo.trim(); // 收款账号去空白
  // 姓名长度 2–40 校验
  if (accountName.length < 2 || accountName.length > 40) {
    throw new AppError('VALIDATION_FAILED', '收款人姓名需 2–40 个字符', { field: 'account_name' });
  }
  // 账号长度 4–64 校验
  if (accountNo.length < 4 || accountNo.length > 64) {
    throw new AppError('VALIDATION_FAILED', '收款账号需 4–64 个字符', { field: 'account_no' });
  }

  const db = deps.db; // 取数据库句柄
  try {
    // 快照读取与插入放在同一事务，避免「读到可用额度后被另一笔申请抢占」
    return db.transaction(() => {
      const snapshot = readWithdrawableSnapshot(db, userId); // 读当前可提现快照
      // 可用额度不足：整笔事务回滚，不落申请
      if (snapshot.available_cents < amountCents) {
        throw new AppError('VALIDATION_FAILED', '可提现余额不足', {
          reason: 'INSUFFICIENT_WITHDRAWABLE', // 额度不足原因码
          available_cents: snapshot.available_cents, // 可用额度回传
          withdrawable_cents: snapshot.withdrawable_cents, // 可提现总额回传
          reserved_cents: snapshot.reserved_cents, // 冻结额回传
        });
      }
      const id = `wd-${uuidv7()}`; // 申请主键
      // 插入 pending 申请行，收款信息与时间一并落库
      db.prepare(
        `INSERT INTO withdrawal_requests
           (id, user_id, amount_cents, status, method, account_name, account_no, review_note, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, '', ?, ?)`,
      ).run(id, userId, amountCents, input.method, accountName, accountNo, now, now);
      return getWithdrawalRow(db, id)!; // 回读新申请行
    })();
  } catch (error) {
    // 部分唯一索引冲突：已有处理中的申请（并发重复提交会走到这里）
    const code = (error as { code?: string }).code ?? '';
    if (code.startsWith('SQLITE_CONSTRAINT')) {
      throw new AppError('CONFLICT', '已有处理中的提现申请，请等待处理或先撤销');
    }
    throw error; // 其余错误原样上抛
  }
}

/** 用户撤销申请：仅 pending 可撤，撤销后立即释放冻结额度 */
export function cancelWithdrawal(deps: ApiDeps, userId: string, id: string, now: string = clockOf(deps)): WithdrawalRow {
  const db = deps.db; // 取数据库句柄
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id); // 取申请行
    // 不存在或非本人申请：按不存在处理，避免泄露他人申请存在性
    if (!row || row.user_id !== userId) throw new AppError('NOT_FOUND', '提现申请不存在');
    // 仅 pending 可撤销，其余状态拒绝
    if (row.status !== 'pending') throw new AppError('CONFLICT', `当前状态（${row.status}）不可撤销`);
    // 条件更新：WHERE status='pending' 兜底并发撤销
    const changed = db
      .prepare("UPDATE withdrawal_requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(now, id).changes;
    if (changed !== 1) throw new AppError('CONFLICT', '该申请状态已变化，请刷新后重试');
    return getWithdrawalRow(db, id)!; // 回读撤销后申请行
  })();
}

/** 审核通过：条件迁移 + 条件扣款 + 确定性流水，重复调用不会二次出账 */
export function approveWithdrawal(
  deps: ApiDeps, // 依赖容器
  id: string, // 申请主键
  reviewer: string, // 审核人标识
  note: string = '', // 审核备注
  now: string = clockOf(deps), // 审核时间
): WithdrawalRow {
  const db = deps.db; // 取数据库句柄
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id); // 取申请行
    if (!row) throw new AppError('NOT_FOUND', '提现申请不存在'); // 不存在
    // 仅 pending 可审核通过
    if (row.status !== 'pending') throw new AppError('CONFLICT', `当前状态（${row.status}）不可审核通过`);

    const snapshot = readWithdrawableSnapshot(db, row.user_id); // 复核当前额度
    // 可提现或总余额不足：不通过，整笔回滚
    if (snapshot.withdrawable_cents < row.amount_cents || snapshot.balance_cents < row.amount_cents) {
      throw new AppError('VALIDATION_FAILED', '可提现余额不足，无法通过该申请', {
        reason: 'INSUFFICIENT_WITHDRAWABLE', // 额度不足原因码
        withdrawable_cents: snapshot.withdrawable_cents, // 可提现额回传
        balance_cents: snapshot.balance_cents, // 总余额回传
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

    return getWithdrawalRow(db, id)!; // 回读审核后申请行
  })();
}

/** 驳回：pending 直接驳回；approved 驳回需原路退回并写 refund 流水 */
export function rejectWithdrawal(
  deps: ApiDeps, // 依赖容器
  id: string, // 申请主键
  reviewer: string, // 审核人标识
  reason: string, // 驳回原因
  now: string = clockOf(deps), // 驳回时间
): WithdrawalRow {
  const trimmed = reason.trim(); // 驳回原因去空白
  // 驳回原因长度 2–200 校验
  if (trimmed.length < 2 || trimmed.length > 200) {
    throw new AppError('VALIDATION_FAILED', '驳回原因需 2–200 个字符', { field: 'reason' });
  }
  const db = deps.db; // 取数据库句柄
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id); // 取申请行
    if (!row) throw new AppError('NOT_FOUND', '提现申请不存在'); // 不存在
    // pending / approved 才可驳回，其余状态拒绝
    if (row.status !== 'pending' && row.status !== 'approved') {
      throw new AppError('CONFLICT', `当前状态（${row.status}）不可驳回`);
    }
    // 条件更新为 rejected，WHERE 限定原状态兜底并发处理
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
      // 退回流水：确定性主键 + INSERT OR IGNORE 防重复退款
      db.prepare(
        `INSERT OR IGNORE INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at)
         VALUES (?, ?, 'refund', ?, 'withdrawal', ?, ?, ?)`,
      ).run(`wt-wdr-${id}`, row.user_id, row.amount_cents, id, `提现驳回退回：${trimmed}`, now);
    }

    return getWithdrawalRow(db, id)!; // 回读驳回后申请行
  })();
}

/** 标记已打款：仅 approved 可流转，只记录打款凭证，不再动账 */
export function markWithdrawalPaid(
  deps: ApiDeps, // 依赖容器
  id: string, // 申请主键
  reviewer: string, // 操作人标识
  payoutRef: string, // 打款凭证
  now: string = clockOf(deps), // 到账时间
): WithdrawalRow {
  const ref = payoutRef.trim(); // 凭证去空白
  // 凭证长度 2–120 校验
  if (ref.length < 2 || ref.length > 120) {
    throw new AppError('VALIDATION_FAILED', '打款凭证需 2–120 个字符', { field: 'payout_ref' });
  }
  const db = deps.db; // 取数据库句柄
  return db.transaction(() => {
    const row = getWithdrawalRow(db, id); // 取申请行
    if (!row) throw new AppError('NOT_FOUND', '提现申请不存在'); // 不存在
    // 仅 approved 可标记到账
    if (row.status !== 'approved') throw new AppError('CONFLICT', `当前状态（${row.status}）不可标记到账`);
    // 条件更新为 paid，WHERE status='approved' 兜底重复标记
    const changed = db
      .prepare(
        "UPDATE withdrawal_requests SET status = 'paid', reviewer = ?, payout_ref = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'",
      )
      .run(reviewer, ref, now, now, id).changes;
    if (changed !== 1) throw new AppError('CONFLICT', '该申请状态已变化，请刷新后重试');
    return getWithdrawalRow(db, id)!; // 回读到账后申请行
  })();
}

/** 用户侧申请列表：按创建时间倒序，只返回自己的记录 */
export function listUserWithdrawals(db: Db, userId: string, limit = 50): WithdrawalRow[] {
  // 分页上限夹在 1–200，按创建时间倒序取本人记录
  return db
    .prepare('SELECT * FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, Math.min(Math.max(limit, 1), 200)) as WithdrawalRow[];
}

/** 后台队列：可按状态过滤，附带用户展示名与 Mim ID；offset 用于真分页 */
export function listAdminWithdrawals(db: Db, status: WithdrawalStatus | '', limit = 100, offset = 0): AdminWithdrawalRow[] {
  const capped = Math.min(Math.max(limit, 1), 300); // 分页上限夹在 1–300
  const start = Math.max(offset, 0); // 偏移非负
  if (status) {
    // 按状态过滤：关联 users 表带出展示名与 Mim ID
    return db
      .prepare(
        `SELECT w.*, u.display_name, u.member_no
         FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
         WHERE w.status = ? ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(status, capped, start) as AdminWithdrawalRow[];
  }
  // 不限状态：全量后台队列真分页
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
  // 按状态分组统计申请数量
  const rows = db.prepare('SELECT status, COUNT(*) AS total FROM withdrawal_requests GROUP BY status').all() as Array<{
    status: WithdrawalStatus; // 状态档位
    total: number; // 该档位数
  }>;
  // 初始化五类状态计数为 0，避免缺档位返回 undefined
  const summary: Record<WithdrawalStatus, number> = { pending: 0, approved: 0, rejected: 0, paid: 0, cancelled: 0 };
  for (const row of rows) summary[row.status] = row.total; // 回填各状态计数
  return summary; // 返回汇总对象
}

/**
 * 创作分成结算：把保护期已过的 pending 分成转成可提现余额。
 * 与推广佣金共用 MIM_REFERRAL_PROTECT_DAYS 保护期（缺省 7 天），避免两套时间口径。
 * 每笔独立事务 + 条件 UPDATE，重复调用不会二次入账。
 */
export function settleCreatorEarnings(deps: ApiDeps, userId?: string, now: string = clockOf(deps)): CreatorSettleResult {
  const db = deps.db; // 取数据库句柄
  const protectDays = readReferralConfig(deps.env).protectDays; // 读保护期天数
  const cutoff = new Date(Date.parse(now) - protectDays * 86400_000).toISOString(); // 保护期截止时间
  // 捞取已过保护期的 pending 分成；可按用户过滤，单次最多 500 笔
  const rows = db
    .prepare(
      `SELECT id, user_id, net_cents, source_type FROM creator_earnings
       WHERE status = 'pending' AND created_at <= ? AND (? IS NULL OR user_id = ?)
       ORDER BY created_at ASC LIMIT 500`,
    )
    .all(cutoff, userId ?? null, userId ?? null) as Array<{ id: string; user_id: string; net_cents: number; source_type: string }>;

  // 单笔结算事务：条件转 settled → 建行 → 加余额与可提现 → 写分成流水
  const settleOne = db.transaction((row: { id: string; user_id: string; net_cents: number; source_type: string }): number => {
    if (row.net_cents <= 0) return 0; // 非正分成不入账，避免产生负余额
    // 条件更新：仅 pending 可被本进程结算
    const changed = db
      .prepare("UPDATE creator_earnings SET status = 'settled', settled_at = ? WHERE id = ? AND status = 'pending'")
      .run(now, row.id).changes;
    if (changed !== 1) return 0; // 已被其他进程结算
    ensureSettlementWallet(db, row.user_id, now); // 确保钱包行存在
    // 分成同时进入总余额与可提现余额：这是「可提现」的唯一来源之一
    db.prepare(
      'UPDATE wallets SET balance_cents = balance_cents + ?, withdrawable_cents = withdrawable_cents + ?, updated_at = ? WHERE user_id = ?',
    ).run(row.net_cents, row.net_cents, now, row.user_id);
    // 写分成入账流水：确定性主键 + INSERT OR IGNORE 防重复入账
    db.prepare(
      `INSERT OR IGNORE INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at)
       VALUES (?, ?, 'commission', ?, 'creator_earning', ?, ?, ?)`,
    ).run(`wt-ce-${row.id}`, row.user_id, row.net_cents, row.id, `创作分成结算（${row.source_type}）`, now);
    return row.net_cents; // 返回本笔入账金额
  });

  let settled = 0; // 成功结算笔数
  let totalCents = 0; // 成功结算金额合计（分）
  for (const row of rows) {
    const credited = settleOne(row); // 逐笔结算
    if (credited > 0) {
      settled += 1; // 累计笔数
      totalCents += credited; // 累计金额
    }
  }
  return { settled, totalCents }; // 返回结算汇总
}
