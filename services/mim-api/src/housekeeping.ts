/** 易失凭证与幂等键清扫：过期验证码 / 题目 / 超期幂等键一次性 DELETE，幂等可重复执行。 */

import type { Db } from './types.js'; // 仅引入数据库连接类型，编译期擦除不产生运行时代码

/** 幂等键重放保护窗口：24h；超过该窗口的重复提交不再需要回放旧响应 */
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000; // 常量：保留窗口（毫秒）
/** 宽限 1h：避免在窗口边界上仍在途的请求被误清 */
const IDEMPOTENCY_GRACE_MS = 60 * 60 * 1000; // 常量：宽限时长（毫秒）

/** 一轮清扫回收的行数，按表分组，便于启动日志留痕 */
export interface SweepEphemeralResult { // 声明类型：清扫结果跨模块传递
  verificationCodes: number; // 过期验证码回收行数
  captchas: number; // 过期题目回收行数
  idempotencyKeys: number; // 超期幂等键回收行数
}

/**
 * 清扫过期易失数据（启动期调用一次；重复执行幂等，第二次命中 0 行）：
 *  - verification_codes / captchas：按 expires_at 早于当前时间删除；
 *  - idempotency_keys：表内无 expires_at 列，按 created_at 超过「保留窗口 + 宽限」截断。
 * 清扫只在运行期执行，不在迁移脚本里做破坏性删除；不触碰用户内容与交易记录。
 */
export function sweepExpiredEphemeral(db: Db, now: Date = new Date()): SweepEphemeralResult { // 函数体：接收连接与可选时钟，便于测试注入固定时间
  const nowIso = now.toISOString(); // 当前时刻，验证码 / 题目按 expires_at 比较
  const keyCutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS - IDEMPOTENCY_GRACE_MS).toISOString(); // 幂等键截断时刻：保留窗口 + 宽限
  const verificationCodes = db.prepare('DELETE FROM verification_codes WHERE expires_at < ?').run(nowIso).changes; // 过期验证码
  const captchas = db.prepare('DELETE FROM captchas WHERE expires_at < ?').run(nowIso).changes; // 过期题目
  const idempotencyKeys = db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(keyCutoff).changes; // 超期幂等键
  return { verificationCodes, captchas, idempotencyKeys }; // 返回分组回收行数
} // sweepExpiredEphemeral 结束
