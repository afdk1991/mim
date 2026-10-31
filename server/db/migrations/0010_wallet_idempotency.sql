/* ============================================================================
 * 0010 · 钱包扣款业务幂等键
 *
 * 为什么需要（R8）：
 *   wallet_debit 原来没有任何业务幂等键，只有「余额充足就扣」的原子条件更新。
 *   网络重试 / 用户双击会让同一笔业务触发两次扣款，而条件是「余额够」——
 *   余额够的情况下第二次照样成功，用户被多扣一次钱。
 *
 * 幂等键怎么选：
 *   选业务单据号（订单号 order_id），而不是请求级 nonce。
 *   请求级 nonce 挡不住「同一个业务动作被重试」（重试会带新的 nonce，照样穿透）。
 *   业务幂等键要求：同一 (用户, 业务单据) 的扣款流水全表唯一。
 *
 * 落在 jsonb 而不是加新列的原因：
 *   wallet_txs 已有 snapshot jsonb（原用于退款去重 refund_order_id），
 *   继续用它承载 debit_order_id 可以零表结构变更、且与历史数据兼容；
 *   下面是表达式索引 + 部分索引，只索引「consume 且有业务键」的流水，
 *   既省空间、又避免给 recharge 等无业务键的流水造成唯一冲突。
 *
 * 幂等 —— create unique index if not exists，可重复执行。
 * ========================================================================== */
create unique index if not exists uq_wallet_txs_consume_bizkey
  on wallet_txs ((snapshot ->> 'debit_order_id'))
  where kind = 'consume' and snapshot ->> 'debit_order_id' is not null;
