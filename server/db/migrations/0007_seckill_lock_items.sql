/* ============================================================================
 * 0007_seckill_lock_items —— 秒杀锁按「订单」粒度（BE-002 修复）
 *
 * 背景（BE-002）：
 *   旧表 seckill_locks 主键 (session_id, user_id)，一人一场一行、qty 随多次
 *   grab 累计、order_id 只保留首个。同用户同场先抢 A 单再抢 B 单时，锁行 qty=2；
 *   取消 A 单会整行删除并整体回补 2，而 B 单仍真实占着 1 —— 多回补库存 → 超卖。
 *
 * 修复：锁改为「一单一行」。新表主键 (session_id, user_id, order_id)，
 *   取消一单只删该订单那一行、只回补那一单的 qty，不再误伤其它在途单。
 *   限购额度仍按 (session, user) 聚合 sum(qty) 计算，口径与旧表一致。
 *
 * 旧表 seckill_locks 保留不动（绝不改旧迁移）：grab/release 不再写它，
 *   仅 sweepSeckillLocks 在定时器兜底时清理其中已过期的幽灵行并回补。
 *   迁移边界上残留的未过期旧行会在 15 分钟内过期并由定时器回补，可接受。
 *
 * 幂等：create table / create index if not exists，可重复执行。
 * ========================================================================== */

create table if not exists seckill_lock_items (
  session_id text not null,
  user_id    uuid not null references users (id) on delete cascade,
  order_id   text not null,
  qty        int not null default 1 check (qty >= 1),
  expire_at  bigint not null,
  created_at bigint not null,
  primary key (session_id, user_id, order_id)
);

create index if not exists idx_seckill_lock_items_expire on seckill_lock_items (expire_at);
