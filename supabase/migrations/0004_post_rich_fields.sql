-- ============================================================================
-- Mim · 迁移 0004：posts 富媒体 / 互动扩展字段
-- 目的：前端本地已支持「视频/GIF、投票、抽奖、定位、仅自己可见、24h 快拍、置顶」
--       等富帖能力，但云端 posts 表此前缺列，导致登录后拉取的云端帖子被静默降级为纯文本。
--       本迁移补齐列，使富帖能力可正常上云 / 回拉。
-- 幂等：全部使用 add column if not exists / add constraint if not exists。
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
alter table if exists public.posts
  add constraint if not exists posts_visibility_check
  check (visibility in ('public', 'self'));
