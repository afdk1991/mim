/** 扩展渠道意图落库、幂等履约与退款记录（与主库 fulfillIntent 同口径，作用于 payment_ext_* 表） */

import { randomUUID } from 'node:crypto'; // 引入依赖：声明本文件使用的外部能力
import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import type { ApiDeps } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import type { ExtChannelId, ExtIntentRow } from './types.js'; // 引入依赖：声明本文件使用的外部能力
import { recordEarning, type PayPurpose } from '../payments.js'; // 引入依赖：声明本文件使用的外部能力

const now = (deps: ApiDeps): string => deps.now?.() ?? new Date().toISOString(); // 保存 now：承载本步骤的计算结果供后续使用

/** 确保钱包行存在（与主库 ensureWallet 同口径） */
function ensureWallet(deps: ApiDeps, userId: string): void { // 定义函数 ensureWallet：封装可复用业务步骤
  const existing = deps.db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(userId) as // 保存 existing：承载本步骤的计算结果供后续使用
    | { balance_cents: number } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (existing) return; // 条件分支：仅在满足业务前置条件时继续
  deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now(deps)); // 预编译 SQL：固定语句结构后绑定参数执行
} // 结束函数体：本层作用域收尾

/** 创建扩展渠道支付意图（pending） */
export function createExtIntent( // 定义函数 createExtIntent：封装可复用业务步骤
  deps: ApiDeps, // 对象字段：声明结构中的一项数据
  input: { userId: string; purpose: PayPurpose; refId: string; provider: ExtChannelId; amountCents: number; currency: string }, // 对象字段：声明结构中的一项数据
): ExtIntentRow { // 调用结束：参数列表与链式调用收尾
  if (input.amountCents <= 0) throw new AppError('VALIDATION_FAILED', '支付金额必须大于 0'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
  const id = `pext-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
  const ts = now(deps); // 保存 ts：承载本步骤的计算结果供后续使用
  const expires = new Date(Date.now() + 30 * 60000).toISOString(); // 保存 expires：承载本步骤的计算结果供后续使用
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `INSERT INTO payment_ext_intents
         (id, user_id, purpose, ref_id, provider, amount_cents, currency, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ) // 调用结束：参数列表与链式调用收尾
    .run(id, input.userId, input.purpose, input.refId, input.provider, input.amountCents, input.currency, expires, ts); // 执行写入：把参数落库并返回影响结果
  return getExtIntent(deps, id)!; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 按 id 取扩展渠道意图 */
export function getExtIntent(deps: ApiDeps, id: string): ExtIntentRow | undefined { // 定义函数 getExtIntent：封装可复用业务步骤
  return deps.db.prepare('SELECT * FROM payment_ext_intents WHERE id = ?').get(id) as ExtIntentRow | undefined; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 落一条回调审计事件 */
export function recordExtEvent(deps: ApiDeps, intentId: string, provider: string, event: string, payload: unknown): void { // 定义函数 recordExtEvent：封装可复用业务步骤
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare('INSERT INTO payment_ext_events (id, intent_id, provider, event, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
    .run(`pee-${randomUUID()}`, intentId, provider, event, JSON.stringify(payload ?? {}), now(deps)); // 执行写入：把参数落库并返回影响结果
} // 结束代码块：本层作用域收尾

/**
 * 幂等履约：已 paid 直接返回 replayed=true，重复回调不重复加钱 / 发权益。
 * 业务分支与主库 fulfillIntent 同口径：recharge 入钱包、asset 发资产、vip 续会员、shop_order 置已支付。
 */
export function fulfillExtIntent(deps: ApiDeps, intent: ExtIntentRow, providerTxnId: string | null): { replayed: boolean } { // 定义函数 fulfillExtIntent：封装可复用业务步骤
  if (intent.status === 'paid') return { replayed: true }; // 条件分支：仅在满足业务前置条件时继续
  const ts = now(deps); // 保存 ts：承载本步骤的计算结果供后续使用
  const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare('UPDATE payment_ext_intents SET status = \'paid\', provider_txn_id = ?, paid_at = ? WHERE id = ? AND status = \'pending\'') // 预编译 SQL：固定语句结构后绑定参数执行
      .run(providerTxnId, ts, intent.id); // 执行写入：把参数落库并返回影响结果

    if (intent.purpose === 'recharge') { // 条件分支：仅在满足业务前置条件时继续
      ensureWallet(deps, intent.user_id); // 业务步骤：推进当前流程的下一项处理
      deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(intent.amount_cents, ts, intent.user_id); // 预编译 SQL：固定语句结构后绑定参数执行
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'recharge', ?, 'payment', ?, '在线充值', ?)") // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`wt-${randomUUID()}`, intent.user_id, intent.amount_cents, intent.id, ts); // 执行写入：把参数落库并返回影响结果
    } else if (intent.purpose === 'asset') { // 其他分支：处理不满足前置条件的路径
      const asset = deps.db.prepare("SELECT id, author_id, price_cents FROM paid_assets WHERE code = ? AND status = 'published'").get(intent.ref_id) as // 保存 asset：承载本步骤的计算结果供后续使用
        | { id: string; author_id: string | null; price_cents: number } // 业务步骤：推进当前流程的下一项处理
        | undefined; // 业务步骤：推进当前流程的下一项处理
      if (!asset) throw new AppError('NOT_FOUND', '资产不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare('INSERT OR IGNORE INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`ap-${randomUUID()}`, intent.user_id, asset.id, intent.amount_cents, ts); // 执行写入：把参数落库并返回影响结果
      deps.db.prepare('UPDATE paid_assets SET sales = sales + 1 WHERE id = ?').run(asset.id); // 预编译 SQL：固定语句结构后绑定参数执行
      recordEarning(deps, asset.author_id, 'asset', asset.id, intent.amount_cents); // 业务步骤：推进当前流程的下一项处理
    } else if (intent.purpose === 'vip') { // 其他分支：处理不满足前置条件的路径
      const plan = deps.db.prepare('SELECT id, level, duration_days FROM vip_plans WHERE code = ? AND active = 1').get(intent.ref_id) as // 保存 plan：承载本步骤的计算结果供后续使用
        | { id: string; level: number; duration_days: number } // 业务步骤：推进当前流程的下一项处理
        | undefined; // 业务步骤：推进当前流程的下一项处理
      if (!plan) throw new AppError('NOT_FOUND', 'VIP 套餐不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
      const current = deps.db // 保存 current：承载本步骤的计算结果供后续使用
        .prepare("SELECT expires_at FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1") // 预编译 SQL：固定语句结构后绑定参数执行
        .get(intent.user_id, ts) as { expires_at: string } | undefined; // 查询单行：读取一条记录供判定使用
      const start = current ? new Date(current.expires_at) : new Date(); // 保存 start：承载本步骤的计算结果供后续使用
      const expires = new Date(start.getTime() + plan.duration_days * 86400000).toISOString(); // 保存 expires：承载本步骤的计算结果供后续使用
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare("INSERT INTO vip_memberships (id, user_id, plan_id, level, starts_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)") // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`vip-${randomUUID()}`, intent.user_id, plan.id, plan.level, ts, expires, ts); // 执行写入：把参数落库并返回影响结果
    } else if (intent.purpose === 'shop_order') { // 其他分支：处理不满足前置条件的路径
      const order = deps.db.prepare('SELECT status, payable_cents FROM shop_orders WHERE id = ?').get(intent.ref_id) as // 保存 order：承载本步骤的计算结果供后续使用
        | { status: string; payable_cents: number } // 业务步骤：推进当前流程的下一项处理
        | undefined; // 业务步骤：推进当前流程的下一项处理
      if (!order) throw new AppError('NOT_FOUND', '订单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
      if (order.payable_cents !== intent.amount_cents) throw new AppError('CONFLICT', '支付金额与订单不一致'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
      deps.db.prepare("UPDATE shop_orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'").run(ts, intent.ref_id); // 预编译 SQL：固定语句结构后绑定参数执行
    } // 结束条件分支：本层作用域收尾
    recordExtEvent(deps, intent.id, intent.provider, 'paid', { providerTxnId }); // 业务步骤：推进当前流程的下一项处理
  }); // 结束函数体：本层作用域收尾
  tx(); // 业务步骤：推进当前流程的下一项处理
  return { replayed: false }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 记一条退款记录；渠道退款单号已存在则返回已有行（退款幂等） */
export function recordRefund( // 定义函数 recordRefund：封装可复用业务步骤
  deps: ApiDeps, // 对象字段：声明结构中的一项数据
  input: { intentId: string; provider: ExtChannelId; amountCents: number; status: 'pending' | 'processed' | 'failed'; providerRefundId: string | null; reason: string; payload: unknown }, // 对象字段：声明结构中的一项数据
): { id: string; replayed: boolean } { // 调用结束：参数列表与链式调用收尾
  const existing = input.providerRefundId // 保存 existing：承载本步骤的计算结果供后续使用
    ? (deps.db.prepare('SELECT id FROM payment_ext_refunds WHERE provider_refund_id = ?').get(input.providerRefundId) as { id: string } | undefined) // 预编译 SQL：固定语句结构后绑定参数执行
    : undefined; // 业务步骤：推进当前流程的下一项处理
  if (existing) return { id: existing.id, replayed: true }; // 条件分支：仅在满足业务前置条件时继续
  const id = `prf-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
  const ts = now(deps); // 保存 ts：承载本步骤的计算结果供后续使用
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `INSERT INTO payment_ext_refunds (id, intent_id, provider, amount_cents, status, provider_refund_id, reason, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ) // 调用结束：参数列表与链式调用收尾
    .run(id, input.intentId, input.provider, input.amountCents, input.status, input.providerRefundId, input.reason, JSON.stringify(input.payload ?? {}), ts, ts); // 执行写入：把参数落库并返回影响结果
  return { id, replayed: false }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 标记意图退款状态；首次处理成功时落退款时间，失败不覆盖已有时间 */
export function markIntentRefunded(deps: ApiDeps, intentId: string, status: 'processed' | 'failed'): void { // 定义函数 markIntentRefunded：封装可复用业务步骤
  const ts = now(deps); // 保存 ts：承载本步骤的计算结果供后续使用
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare('UPDATE payment_ext_intents SET refund_status = ?, refunded_at = COALESCE(refunded_at, ?) WHERE id = ?') // 预编译 SQL：固定语句结构后绑定参数执行
    .run(status, ts, intentId); // 执行写入：把参数落库并返回影响结果
} // 结束函数体：本层作用域收尾
