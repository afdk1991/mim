/* ============================================================================
 * 0006 —— 为 posts 增加增量同步水位
 *
 * 背景：posts 原本只有 created_at（毫秒 epoch），没有「最后修改时间」，
 *      外部镜像/静态站想按增量拉取公开动态时只能全量重扫。
 *      这里补一列 updated_at 并让它由触发器自动维护。
 *
 * 语句顺序有讲究：先补列 → 回填历史行 → 再建触发器。
 * 若先建触发器，回填那次 UPDATE 会触发 NEW.updated_at = now()，
 * 把所有历史行的水位刷成同一时刻，首轮增量同步就会变成全量。
 * ========================================================================== */

alter table posts add column if not exists updated_at bigint;

update posts set updated_at = created_at where updated_at is null;

create or replace function mim_touch_updated_at() returns trigger as $$
begin
  -- clock_timestamp() 而非 now()：同一事务内多行写入时 now() 是相同的，
  -- 会导致增量游标无法区分先后，极端情况下漏掉行。
  new.updated_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_posts_touch_updated_at on posts;
create trigger trg_posts_touch_updated_at
  before insert or update on posts
  for each row execute function mim_touch_updated_at();

-- 与查询里的 coalesce(updated_at, created_at) 并存：走 updated_at 单列索引已足够，
-- 未回填的行（理论上不存在）只是退化成顺序扫描，不影响正确性。
create index if not exists idx_posts_updated on posts (updated_at);
