/**
 * 积分抵扣消费（商业化三期）
 *
 * 组合顺序（与既有结算链路对齐）：
 *   商品原价 → 优惠码折扣（community 商城既有逻辑）→ 积分抵扣 → 余额 / 渠道支付。
 * 本模块只负责「优惠码之后」的积分段：按可配置比例把积分折成金额，
 * 受单笔上限百分比与积分余额双重约束；扣减积分必须与订单写入同事务。
 *
 * 边界口径：
 *   - 0 元订单 / 免费商品：不抵扣、不消耗积分；
 *   - 积分不足：按余额可折上限抵扣；客户端指定积分不足则报错；
 *   - 超额（超过单笔上限百分比）：截断到上限；客户端指定超限则报错；
 *   - 抵扣后应付为 0：调用方按「全额抵扣」走即时结算，不再生成待付单。
 */

import { AppError } from '@mim/core-domain'; // 统一业务异常
import { uuidv7 } from '@mim/core-domain'; // 流水主键
import type { Db } from '../types.js'; // 数据库连接类型
import type { PointsConfig } from './config.js'; // 积分配置类型

/** 抵扣计算入参 */
export interface DeductionInput {
  amountCents: number; // 优惠码之后的应付金额（分）
  pointsBalance: number; // 当前积分余额
  config: PointsConfig; // 兑换比例与上限配置
  pointsToUse?: number; // 客户端指定使用积分；缺省按可抵扣上限最大化使用
} // 代码块结束

/** 抵扣计算结果 */
export interface DeductionResult {
  deduct_cents: number; // 折抵金额（分）
  points_spent: number; // 实际扣减积分
  payable_cents: number; // 抵扣后应付金额（分）
  capped_by: 'ratio' | 'balance' | 'none'; // 抵扣额受哪一项约束
} // 代码块结束

/** 读取用户积分余额；无钱包行视为 0（不在这里发见面礼，那是注册/社区链路的职责） */
export function getPointsBalance(db: Db, userId: string): number {
  const row = db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number } | undefined; // 常量 row：保存固定配置或一次性派生值
  return row?.points ?? 0; // 缺行回落 0，避免首次消费的 UPDATE 静默落空
} // 代码块结束

/**
 * 纯函数：按比例与上限计算积分抵扣额，不写库。
 * 金额全程整数（分），兑换与取整规则集中在此，便于单测穷举边界。
 */
export function computeDeduction(input: DeductionInput): DeductionResult {
  const { amountCents, pointsBalance, config, pointsToUse } = input; // 解构入参
  const zero: DeductionResult = { deduct_cents: 0, points_spent: 0, payable_cents: Math.max(0, amountCents), capped_by: 'none' }; // 不抵扣的统一结果
  if (!config.enabled) return zero; // 总开关关闭：整段跳过，保持现网行为
  if (amountCents <= 0) return zero; // 0 元 / 免费订单不消耗积分
  if (pointsBalance <= 0) return zero; // 无积分可抵

  const maxByRatio = Math.floor((amountCents * config.maxRatioPercent) / 100); // 单笔上限：应付金额 × 上限百分比
  const maxByBalanceCents = Math.floor((pointsBalance * 100) / config.pointsPerYuan); // 余额可折金额：积分 × 100 分 / 每元积分
  const budgetCents = Math.min(maxByRatio, maxByBalanceCents, amountCents); // 三重约束取最小

  if (pointsToUse === undefined) { // 未指定积分：按预算最大化抵扣
    const deduct = budgetCents; // 预算内全额使用
    const pointsSpent = Math.ceil((deduct * config.pointsPerYuan) / 100); // 积分向上取整，避免少扣导致平台贴钱
    const cappedBy: DeductionResult['capped_by'] = budgetCents === maxByRatio ? 'ratio' : budgetCents === maxByBalanceCents ? 'balance' : 'none'; // 记录约束来源便于排查
    return { deduct_cents: deduct, points_spent: pointsSpent, payable_cents: amountCents - deduct, capped_by: cappedBy }; // 返回当前函数的处理结果
  } // 代码块结束

  // 客户端指定积分：先校验余额与上限，再折算金额
  if (!Number.isInteger(pointsToUse) || pointsToUse <= 0) {
    throw new AppError('VALIDATION_FAILED', 'points_to_use must be a positive integer', { field: 'points_to_use' }); // 入参非法
  } // 代码块结束
  if (pointsToUse > pointsBalance) { // 积分不足
    throw new AppError('VALIDATION_FAILED', 'insufficient points balance', { // 抛出错误：中断当前流程并向上层传递
      reason: 'INSUFFICIENT_POINTS', // 前端据此提示积分不足
      balance: pointsBalance, // 当前余额
      requested: pointsToUse, // 请求使用量
    }); // 代码块结束
  } // 代码块结束
  const requestedCents = Math.floor((pointsToUse * 100) / config.pointsPerYuan); // 指定积分可折金额
  if (requestedCents > maxByRatio) { // 超过单笔上限百分比
    throw new AppError('VALIDATION_FAILED', 'points deduction exceeds per-order cap', { // 抛出错误：中断当前流程并向上层传递
      reason: 'POINTS_CAP_EXCEEDED', // 前端提示可抵扣上限
      max_deduct_cents: maxByRatio, // 上限金额
      requested_cents: requestedCents, // 请求折抵金额
    }); // 代码块结束
  } // 代码块结束
  const deduct = Math.min(requestedCents, budgetCents); // 兜底再截一次预算
  return { deduct_cents: deduct, points_spent: pointsToUse, payable_cents: amountCents - deduct, capped_by: deduct === maxByRatio ? 'ratio' : deduct === maxByBalanceCents ? 'balance' : 'none' }; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 在调用方事务内扣减积分并写一条负向积分流水。
 * 调用方必须把本函数与订单 / 权益写入包在同一个 db.transaction 里；
 * UPDATE 带 points >= ? 守卫，并发超扣时 changes=0 直接抛错回滚整笔。
 */
export function deductPoints(
  db: Db, // 对象字段 db：记录一项配置或数据
  input: { userId: string; points: number; deductCents: number; refType: string; refId: string; note: string; now: string }, // 对象字段 input：记录一项配置或数据
): void { // 执行当前业务步骤
  const { userId, points, deductCents, refType, refId, note, now } = input; // 解构
  if (points <= 0) return; // 无抵扣不写流水，保持与纯积分流水口径一致
  const result = db // 带余额守卫的扣减：余额不足时影响 0 行
    .prepare('UPDATE wallets SET points = points - ?, updated_at = ? WHERE user_id = ? AND points >= ?') // 执行当前业务步骤
    .run(points, now, userId, points); // 绑定扣减量、时间、用户与守卫阈值
  if (result.changes === 0) { // 并发下余额被抢先扣光：整笔事务回滚
    throw new AppError('VALIDATION_FAILED', 'insufficient points balance', { reason: 'INSUFFICIENT_POINTS' }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  db.prepare( // 写积分消费流水：points 记负向积分，amount_cents 记折抵金额便于对账
    `INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, points, ref_type, ref_id, note, created_at)
     VALUES (?, ?, 'points', ?, ?, ?, ?, ?, ?)`,
  ).run(`wt-${uuidv7()}`, userId, -deductCents, -points, refType, refId, note, now); // 绑定流水字段
} // 代码块结束
