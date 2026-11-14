/**
 * 返佣佣金状态机：下单记 pending → 保护期到期批量结算入余额 → 退款冲正。
 *
 * 与既有 referrals 表的分工：
 *   - referrals 保持原语义（bound / settled），commission_cents 为累计承诺佣金快照；
 *   - referral_commissions 承担三态明细（pending / settled / reversed）、可结算时间、
 *     分级（1 直邀 / 2 二级）与对账流水；
 *   - 结算幂等：状态迁移用条件 UPDATE（WHERE status='pending'），重复调用不会二次入账；
 *   - 比例全部走环境变量，缺省 L1=5%、L2=0（关闭二级）、保护期 7 天。
 */

import { uuidv7 } from '@mim/core-domain'; // 事件主键，时间有序
import type { ApiDeps } from '../types.js'; // 依赖容器
import { clockOf } from '../domain.js'; // 可注入时钟

/** 返佣运行配置（金额单位：分；比例为 0–1 小数） */
export interface ReferralConfig {
  rate: number; // 一级直邀佣金比例
  l2Rate: number; // 二级佣金比例（0 表示关闭）
  protectDays: number; // 退款保护期天数，期内 pending 不可结算
}

/** 解析 0–1 比例环境变量；非法 / 越界回落默认值 */
function readRate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim()); // 容忍空串与非数字
  if (!Number.isFinite(parsed)) return fallback; // 非法形态回落默认
  return Math.min(1, Math.max(0, parsed)); // 夹到 [0,1]
}

/** 解析正整数天数；非法回落默认值 */
function readDays(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10); // 十进制解析
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; // 负数回落默认
}

/** 读取返佣配置；env 缺省取 process.env，测试可注入替身环境 */
export function readReferralConfig(env: Record<string, string | undefined> = process.env): ReferralConfig {
  return {
    rate: readRate(env.MIM_REFERRAL_RATE, 0.05), // 一级缺省 5%
    l2Rate: readRate(env.MIM_REFERRAL_L2_RATE, 0), // 二级缺省关闭
    protectDays: readDays(env.MIM_REFERRAL_PROTECT_DAYS, 7), // 保护期缺省 7 天
  };
}

/** 确保钱包行存在；首次入账不会因缺行 UPDATE 静默落空 */
function ensureWallet(db: ApiDeps['db'], userId: string, now: string): void {
  const existing = db.prepare('SELECT user_id FROM wallets WHERE user_id = ?').get(userId) as { user_id: string } | undefined;
  if (existing) return; // 已有钱包行
  db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 0, ?)').run(userId, now); // 佣金入账不送积分
}

/** 入账钱包并写一条 commission 流水；amountCents 为正（结算）或负（冲正扣回） */
function postWalletTransaction(
  db: ApiDeps['db'],
  userId: string,
  amountCents: number,
  refType: string,
  refId: string,
  note: string,
  now: string,
): void {
  ensureWallet(db, userId, now); // 先建行
  db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(amountCents, now, userId); // 余额变动
  db
    .prepare(
      `INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at)
       VALUES (?, ?, 'commission', ?, ?, ?, ?, ?)`,
    )
    .run(`wt-${uuidv7()}`, userId, amountCents, refType, refId, note, now); // 佣金流水
}

/** accrueCommission 入参 */
export interface AccrueInput {
  inviteeId: string; // 下单人（被邀请人）
  orderId: string; // 订单号，佣金明细对账键
  payableCents: number; // 实付金额（分），佣金按此计提
}

/** accrueCommission 出参 */
export interface AccrueResult {
  accrued: number; // 本次新增佣金明细条数
  commissions: Array<{ id: string; level: number; amountCents: number; inviterId: string }>; // 明细回显
}

/**
 * 下单记佣：被邀请人存在 bound 邀请关系时，按比例生成 pending 佣金；
 * 同一订单重复进入由 UNIQUE(order_id, inviter_id, level) 兜底，不重复计提。
 */
export function accrueCommission(deps: ApiDeps, input: AccrueInput, now: string = clockOf(deps)): AccrueResult {
  const config = readReferralConfig(deps.env); // 读比例与保护期
  const payable = Math.max(0, Math.round(input.payableCents)); // 实付归一非负分
  const commissions: AccrueResult['commissions'] = []; // 本轮明细
  if (payable <= 0) return { accrued: 0, commissions }; // 0 元单不计佣

  const referral = deps.db
    .prepare("SELECT id, inviter_id FROM referrals WHERE invitee_id = ? AND status = 'bound'")
    .get(input.inviteeId) as { id: string; inviter_id: string } | undefined; // 直邀关系
  if (!referral) return { accrued: 0, commissions }; // 无邀请关系，不计佣

  const settleAt = new Date(Date.parse(now) + config.protectDays * 86400_000).toISOString(); // 保护期到期时刻
  const insertOne = (inviterId: string, level: 1 | 2, rate: number, referralId: string): void => {
    const amount = Math.round(payable * rate); // 按比例取整分
    if (amount <= 0) return; // 比例或金额为 0 不落明细
    const id = `rc-${uuidv7()}`; // 佣金明细主键
    deps.db
      .prepare(
        `INSERT OR IGNORE INTO referral_commissions
           (id, referral_id, inviter_id, invitee_id, order_id, level, rate, amount_cents, status, settle_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(id, referralId, inviterId, input.inviteeId, input.orderId, level, rate, amount, settleAt, `订单 ${input.orderId} ${level === 1 ? '直邀' : '二级'}佣金`, now);
    commissions.push({ id, level, amountCents: amount, inviterId }); // 回显明细
  };

  insertOne(referral.inviter_id, 1, config.rate, referral.id); // 一级直邀佣金
  // 二级：直邀人自己的邀请人；比例为 0 或不存在上级时自动跳过
  if (config.l2Rate > 0) {
    const parent = deps.db
      .prepare("SELECT id, inviter_id FROM referrals WHERE invitee_id = ? AND status = 'bound'")
      .get(referral.inviter_id) as { id: string; inviter_id: string } | undefined; // 上级关系
    if (parent && parent.inviter_id !== referral.inviter_id) { // 防止自环
      insertOne(parent.inviter_id, 2, config.l2Rate, parent.id); // 二级佣金
    }
  }

  if (commissions.length > 0) { // 有计提才回写 referrals 累计快照
    const total = commissions.reduce((sum, c) => sum + c.amountCents, 0); // 本轮承诺佣金合计
    deps.db.prepare('UPDATE referrals SET commission_cents = commission_cents + ? WHERE id = ?').run(total, referral.id);
  }
  return { accrued: commissions.length, commissions }; // 交出结果
}

/** 结算结果汇总 */
export interface SettleResult {
  settled: number; // 本轮真正结算的明细条数
  totalCents: number; // 本轮入账佣金合计（分）
}

/**
 * 到期批量结算：把保护期已满的 pending 佣金转 settled，并入邀请人余额并写 commission 流水。
 * 每条明细用条件 UPDATE 抢占（status='pending'），多副本 / 重复调用都不会二次入账。
 */
export function settleDueCommissions(deps: ApiDeps, now: string = clockOf(deps)): SettleResult {
  const due = deps.db
    .prepare("SELECT id, inviter_id, referral_id, amount_cents, order_id FROM referral_commissions WHERE status = 'pending' AND settle_at <= ? ORDER BY created_at ASC")
    .all(now) as Array<{ id: string; inviter_id: string; referral_id: string; amount_cents: number; order_id: string }>; // 候选清单

  let settled = 0; // 实际结算条数
  let totalCents = 0; // 入账合计
  for (const row of due) { // 逐条结算，单条失败不阻断其余
    const tx = deps.db.transaction(() => { // 状态迁移 + 入账同事务
      const claimed = deps.db
        .prepare("UPDATE referral_commissions SET status = 'settled', settled_at = ? WHERE id = ? AND status = 'pending'")
        .run(now, row.id); // 条件抢占：仅 pending 可被结算
      if (claimed.changes !== 1) return false; // 已被其他副本结算，跳过
      postWalletTransaction(deps.db, row.inviter_id, row.amount_cents, 'referral', row.id, `推广佣金结算（订单 ${row.order_id}）`, now); // 入账 + 流水
      deps.db.prepare("UPDATE referrals SET status = 'settled' WHERE id = ? AND status = 'bound'").run(row.referral_id); // 邀请关系标记已结算（兼容原语义）
      return true;
    });
    if (tx()) { // 本条真正结算成功
      settled += 1; // 计数
      totalCents += row.amount_cents; // 累加金额
    }
  }
  return { settled, totalCents }; // 交出汇总
}

/** 冲正结果 */
export interface ReverseResult {
  reversed: number; // 本次冲正条数
  clawedBackCents: number; // 已结算扣回金额（分）；未结算冲正不计入
}

/**
 * 退款冲正：按订单回滚全部关联佣金。
 *   - pending：直接置 reversed，不入过账，无需扣回；
 *   - settled：从余额扣回等额佣金并写负向 commission 流水，置 reversed。
 */
export function reverseCommission(deps: ApiDeps, orderId: string, now: string = clockOf(deps)): ReverseResult {
  const rows = deps.db
    .prepare('SELECT id, inviter_id, status, amount_cents FROM referral_commissions WHERE order_id = ?')
    .all(orderId) as Array<{ id: string; inviter_id: string; status: 'pending' | 'settled' | 'reversed'; amount_cents: number }>; // 关联明细
  let reversed = 0; // 冲正条数
  let clawedBackCents = 0; // 已结算扣回合计

  for (const row of rows) {
    if (row.status === 'reversed') continue; // 已冲正幂等跳过
    const tx = deps.db.transaction(() => {
      if (row.status === 'pending') { // 未结算：只翻状态
        deps.db.prepare("UPDATE referral_commissions SET status = 'reversed', reversed_at = ? WHERE id = ? AND status = 'pending'").run(now, row.id);
        return { claw: 0 };
      }
      // 已结算：条件抢占后扣回，避免重复冲正
      const claimed = deps.db
        .prepare("UPDATE referral_commissions SET status = 'reversed', reversed_at = ? WHERE id = ? AND status = 'settled'")
        .run(now, row.id);
      if (claimed.changes !== 1) return { claw: 0 }; // 已被并发冲正
      postWalletTransaction(deps.db, row.inviter_id, -row.amount_cents, 'referral_reversal', row.id, `退款冲正佣金（订单 ${orderId}）`, now); // 负向流水
      return { claw: row.amount_cents };
    });
    const { claw } = tx();
    reversed += 1; // 计入冲正条数（两种状态都算）
    clawedBackCents += claw; // 仅已结算部分计入扣回
  }
  return { reversed, clawedBackCents }; // 交出结果
}

/** 我的佣金明细 + 汇总（GET /referral/commissions） */
export interface CommissionSummary {
  pending_cents: number; // 待结算佣金合计
  settled_cents: number; // 已结算佣金合计
  reversed_cents: number; // 已冲正佣金合计
  pending_count: number;
  settled_count: number;
}

/** 按邀请人查询佣金明细与汇总；明细按创建时间倒序 */
export function listCommissions(db: ApiDeps['db'], inviterId: string): { items: Array<Record<string, unknown>>; summary: CommissionSummary } {
  const items = db
    .prepare(
      `SELECT id, order_id, level, rate, amount_cents, status, settle_at, settled_at, reversed_at, note, created_at
       FROM referral_commissions WHERE inviter_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .all(inviterId) as Array<Record<string, unknown>>;
  const summaryRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END), 0) AS pending_cents,
         COALESCE(SUM(CASE WHEN status = 'settled' THEN amount_cents ELSE 0 END), 0) AS settled_cents,
         COALESCE(SUM(CASE WHEN status = 'reversed' THEN amount_cents ELSE 0 END), 0) AS reversed_cents,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END) AS settled_count
       FROM referral_commissions WHERE inviter_id = ?`,
    )
    .get(inviterId) as CommissionSummary;
  return { items, summary: summaryRow };
}
