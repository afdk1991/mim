-- ============================================================================
-- Mim · 迁移 0004：posts 富媒体 / 互动扩展字段
-- 目的：前端本地已支持「视频/GIF、投票、抽奖、定位、仅自己可见、24h 快拍、置顶」
--       等富帖能力，但云端 posts 表此前缺列，导致登录后拉取的云端帖子被静默降级为纯文本。
--       本迁移补齐列，使富帖能力可正常上云 / 回拉。
-- 幂等：add column if not exists；约束用 DO 块 + duplicate_object 异常捕获（PG 不支持 ADD CONSTRAINT IF NOT EXISTS）。
-- ============================================================================

alter table if exists public.posts
  add column if not exists media      jsonb,
  add column if not exists vote       jsonb,
  add column if not exists lottery    jsonb,
  add column if not exists location   text,
  add column if not exists story      boolean not null default false,
  add column if not exists visibility text    not null default 'public',
  add column if not exists expires_at timestamptz,
  add column if not exists pinned     boolean not null default false;

-- visibility 取值约束（与前端 Post.visibility 对齐）
-- 注意：PostgreSQL 的 ADD CONSTRAINT 不支持 IF NOT EXISTS，
--       用 DO 块 + 异常处理实现幂等（已存在则跳过）。
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'posts') then
    begin
      alter table public.posts
        add constraint posts_visibility_check
        check (visibility in ('public', 'self'));
    exception
      when duplicate_object then null;  -- 约束已存在，跳过
    end;
  end if;
end $$;
