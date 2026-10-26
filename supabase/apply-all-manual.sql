-- ==============================================================================
-- Mim · 一键补齐脚本（供 Supabase Dashboard → SQL Editor 粘贴执行）
-- 生成时间：2026-10-26T14:38:49.920Z
-- 生成命令：npm run db:gen-manual（与本仓库 CI 迁移计划同源，顺序一致）
--
-- 用途：无需数据库密码 / 无需本地 SUPABASE_DB_URL，直接补齐线上缺失内容。
-- 内容：0000_schema.sql → 0001_iam_phase1.sql → 0002_storage_media.sql → 0003_account_bridge.sql → 0004_post_rich_fields.sql → 0005_mall_catalog.sql
--
-- 典型补齐项：
--   ① 基线 20 张业务表（posts / profiles / articles / snippets / topics / hot_searches …）
--   ② IAM 权限中心（roles / permissions / user_roles / role_permissions / audit_logs）
--   ③ 商城目录（products 商品模型字段；不含任何商品数据）
--   ④ 对象存储私有桶 mim-media（迁移 0002）
--   ⑤ 账号桥（account_bridge + username_taken / claim_username RPC，迁移 0003）
--
-- 执行方式（二选一）：
--   ① 推荐：Dashboard → SQL Editor → 粘贴本文件全部内容 → Run（无需密码）
--   ② 命令行：设好 SUPABASE_DB_URL 后 npm run db:apply
--
-- 幂等：全部使用 create table if not exists / add column if not exists /
--       insert ... on conflict do nothing，可重复执行，不会产生重复数据。
-- ==============================================================================

-- 迁移跟踪表（与 CI 共用：手工执行过的版本，CI 下次会自动跳过）
create table if not exists public.schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

-- ==============================================================================
-- 基线结构
-- ==============================================================================

-- ============================================================================
-- Mim · Supabase 数据库结构（轮 1 基建）
-- 目标平台：supabase.com 国际版（火山引擎 Supabase 版同样兼容）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴全量执行
-- 说明：
--   · 不含演示 seed 数据（轮 4 接入读路径时再灌入）
--   · 内容表主键为 text（default gen_random_uuid()::text），兼容应用层固定 id
--   · likes/follows 用计数触发器维护父表冗余计数，likedByMe 由关联表推导
--   · 私信采用双行模型（发送方/接收方各一行），经 send_message RPC 安全写入
-- ============================================================================

-- ---------- 1. profiles 用户档案（1:1 auth.users） ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text    not null,
  emoji      text    not null default '🙂',
  color      text    not null default '#ff8200',
  bio        text    not null default '',
  verified   boolean not null default false,
  followers  int     not null default 0,
  following  int     not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 2. posts 动态 ----------
create table if not exists public.posts (
  id             text primary key default gen_random_uuid()::text,
  author_id      uuid not null references auth.users(id) on delete cascade,
  content        text not null,
  images         text[] not null default '{}',
  created_at     timestamptz not null default now(),
  repost_of_id   text references public.posts(id) on delete set null,
  repost_comment text not null default '',
  reposts        int not null default 0,
  topic          text,
  source         text not null default '来自 网页版',
  likes          int not null default 0
);

-- ---------- 3. post_comments 动态评论 ----------
create table if not exists public.post_comments (
  id         text primary key default gen_random_uuid()::text,
  post_id    text not null references public.posts(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now(),
  likes      int not null default 0
);

-- ---------- 4. articles 文章 ----------
create table if not exists public.articles (
  id         text primary key default gen_random_uuid()::text,
  author_id  uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  summary    text not null default '',
  content    text not null,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  views      int not null default 0,
  likes      int not null default 0
);

-- ---------- 5. article_comments 文章评论 ----------
create table if not exists public.article_comments (
  id         text primary key default gen_random_uuid()::text,
  article_id text not null references public.articles(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

-- ---------- 6. snippets 代码片段 ----------
create table if not exists public.snippets (
  id         text primary key default gen_random_uuid()::text,
  author_id  uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  language   text not null default 'text',
  code       text not null,
  created_at timestamptz not null default now(),
  likes      int not null default 0
);

-- ---------- 7. 点赞关联表（likedByMe 推导源 + 计数触发器） ----------
create table if not exists public.post_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  post_id    text not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.comment_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  comment_id text not null references public.post_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create table if not exists public.article_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  article_id text not null references public.articles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create table if not exists public.snippet_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  snippet_id text not null references public.snippets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, snippet_id)
);

-- ---------- 8. resources 资源库（演示世界观数据，写仅 service role） ----------
create table if not exists public.resources (
  id          text primary key default gen_random_uuid()::text,
  title       text not null,
  description text not null default '',
  category    text not null default '通用',
  uploader    text not null default '官方',
  size        text not null default '0KB',
  downloads   int not null default 0,
  type        text not null default 'doc' check (type in ('pdf', 'video', 'code', 'doc'))
);

-- ---------- 9. topics 超话 / hot_searches 热搜（同上，写仅 service role） ----------
create table if not exists public.topics (
  id   text primary key default gen_random_uuid()::text,
  name text not null unique,
  heat int not null default 0,
  "desc" text not null default ''
);

create table if not exists public.hot_searches (
  id   text primary key default gen_random_uuid()::text,
  rank int not null,
  text text not null,
  heat int not null default 0,
  tag  text check (tag in ('热', '新', '爆', '沸'))
);

-- ---------- 10. notifications 通知（全私有） ----------
create table if not exists public.notifications (
  id           text primary key default gen_random_uuid()::text,
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null check (type in ('like', 'comment', 'repost', 'follow', 'mention')),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  content      text not null default '',
  post_id      text,
  created_at   timestamptz not null default now(),
  read         boolean not null default false
);

-- ---------- 11. messages 私信（双行模型：owner_id = 行所属用户） ----------
create table if not exists public.messages (
  id         text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  peer_id    uuid not null references auth.users(id) on delete cascade,
  from_me    boolean not null,
  content    text not null,
  created_at timestamptz not null default now(),
  read       boolean not null default false,
  primary key (id, owner_id)
);

-- ---------- 12. favorites 收藏 ----------
create table if not exists public.favorites (
  id         text primary key default gen_random_uuid()::text,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('post', 'article')),
  target_id  text not null,
  created_at timestamptz not null default now(),
  unique (user_id, type, target_id)
);

-- ---------- 13. follows 关注关系 ----------
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- ---------- 14. 草稿箱（全私有） ----------
create table if not exists public.post_drafts (
  id         text primary key default gen_random_uuid()::text,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null default '',
  topic      text,
  images     text[] not null default '{}',
  saved_at   timestamptz not null default now()
);

create table if not exists public.article_drafts (
  id       text primary key default gen_random_uuid()::text,
  user_id  uuid not null references auth.users(id) on delete cascade,
  title    text not null default '',
  content  text not null default '',
  tags     text[] not null default '{}',
  saved_at timestamptz not null default now()
);

-- documents（轮 6）：通用键值文档层——工具台等本地状态整体迁移云端的通用存储。
-- 每用户每 key 一行，data 为任意 jsonb 快照（各模块整存整取，无需按模块建表）。
create table if not exists public.documents (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ============================================================================
-- 索引
-- ============================================================================
create index if not exists idx_posts_author_created    on public.posts (author_id, created_at desc);
create index if not exists idx_posts_created           on public.posts (created_at desc);
create index if not exists idx_posts_topic             on public.posts (topic) where topic is not null;
create index if not exists idx_post_comments_post      on public.post_comments (post_id, created_at);
create index if not exists idx_articles_author_created on public.articles (author_id, created_at desc);
create index if not exists idx_articles_created        on public.articles (created_at desc);
create index if not exists idx_article_comments_article on public.article_comments (article_id, created_at);
create index if not exists idx_snippets_author         on public.snippets (author_id, created_at desc);
create index if not exists idx_notifications_user      on public.notifications (user_id, created_at desc);
create index if not exists idx_messages_owner_peer     on public.messages (owner_id, peer_id, created_at);
create index if not exists idx_favorites_user          on public.favorites (user_id);
create index if not exists idx_follows_followee        on public.follows (followee_id);

-- ============================================================================
-- 触发器：注册自动建档（auth.users → profiles）
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  emojis text[] := array['😀','😎','🦊','🐼','🐙','🦉','🐳','🦖','🐧','🐱'];
  colors text[] := array['#ff8200','#409eff','#8bc34a','#e91e63','#795548','#00bcd4','#673ab7','#ff5722'];
begin
  insert into public.profiles (id, name, emoji, color, bio)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', '新用户'),
    emojis[1 + floor(random() * 10)::int],
    colors[1 + floor(random() * 8)::int],
    ''
  );
  return null;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 触发器：点赞 / 关注计数维护
-- ============================================================================
create or replace function public.bump_post_likes()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts set likes = likes + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts set likes = greatest(0, likes - 1) where id = old.post_id;
  end if;
  return null;
end $$;

drop trigger if exists post_likes_count on public.post_likes;
create trigger post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.bump_post_likes();

create or replace function public.bump_comment_likes()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.post_comments set likes = likes + 1 where id = new.comment_id;
  elsif (tg_op = 'DELETE') then
    update public.post_comments set likes = greatest(0, likes - 1) where id = old.comment_id;
  end if;
  return null;
end $$;

drop trigger if exists comment_likes_count on public.comment_likes;
create trigger comment_likes_count
  after insert or delete on public.comment_likes
  for each row execute function public.bump_comment_likes();

create or replace function public.bump_article_likes()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.articles set likes = likes + 1 where id = new.article_id;
  elsif (tg_op = 'DELETE') then
    update public.articles set likes = greatest(0, likes - 1) where id = old.article_id;
  end if;
  return null;
end $$;

drop trigger if exists article_likes_count on public.article_likes;
create trigger article_likes_count
  after insert or delete on public.article_likes
  for each row execute function public.bump_article_likes();

create or replace function public.bump_snippet_likes()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.snippets set likes = likes + 1 where id = new.snippet_id;
  elsif (tg_op = 'DELETE') then
    update public.snippets set likes = greatest(0, likes - 1) where id = old.snippet_id;
  end if;
  return null;
end $$;

drop trigger if exists snippet_likes_count on public.snippet_likes;
create trigger snippet_likes_count
  after insert or delete on public.snippet_likes
  for each row execute function public.bump_snippet_likes();

create or replace function public.bump_follow_counts()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.profiles set following = following + 1 where id = new.follower_id;
    update public.profiles set followers = followers + 1 where id = new.followee_id;
  elsif (tg_op = 'DELETE') then
    update public.profiles set following = greatest(0, following - 1) where id = old.follower_id;
    update public.profiles set followers = greatest(0, followers - 1) where id = old.followee_id;
  end if;
  return null;
end $$;

drop trigger if exists follows_count on public.follows;
create trigger follows_count
  after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

-- ============================================================================
-- RPC：私信写入（security definer，一次写双方两行）
-- ============================================================================
create or replace function public.send_message(p_peer uuid, p_content text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  msg_id text := 'm' || replace(gen_random_uuid()::text, '-', '');
begin
  if me is null or me = p_peer or coalesce(trim(p_content), '') = '' then
    raise exception 'invalid message';
  end if;
  insert into public.messages (id, owner_id, peer_id, from_me, content, read)
  values (msg_id, me, p_peer, true, p_content, true);
  insert into public.messages (id, owner_id, peer_id, from_me, content, read)
  values (msg_id, p_peer, me, false, p_content, false);
end $$;

-- ============================================================================
-- RPC：文章阅读数自增（匿名可调，绕过 update 权限）
-- ============================================================================
create or replace function public.bump_article_views(p_id text)
returns int
language sql security definer
set search_path = public
as $$
  update public.articles set views = views + 1 where id = p_id returning views;
$$;

-- ============================================================================
-- RLS：全表启用行级安全（静态托管无服务端，安全完全由 RLS 承担）
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.posts            enable row level security;
alter table public.post_comments    enable row level security;
alter table public.post_likes       enable row level security;
alter table public.comment_likes    enable row level security;
alter table public.article_likes    enable row level security;
alter table public.snippet_likes    enable row level security;
alter table public.articles         enable row level security;
alter table public.article_comments enable row level security;
alter table public.snippets         enable row level security;
alter table public.resources        enable row level security;
alter table public.topics           enable row level security;
alter table public.hot_searches     enable row level security;
alter table public.notifications    enable row level security;
alter table public.messages         enable row level security;
alter table public.favorites        enable row level security;
alter table public.follows          enable row level security;
alter table public.post_drafts      enable row level security;
alter table public.article_drafts   enable row level security;
alter table public.documents        enable row level security;

-- ---------- profiles：公开读，本人改 ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------- 内容表：公开读，本人写 ----------
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select using (true);
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert with check (author_id = auth.uid());
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete using (author_id = auth.uid());

drop policy if exists articles_select on public.articles;
create policy articles_select on public.articles for select using (true);
drop policy if exists articles_insert on public.articles;
create policy articles_insert on public.articles for insert with check (author_id = auth.uid());
drop policy if exists articles_update on public.articles;
create policy articles_update on public.articles for update using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists articles_delete on public.articles;
create policy articles_delete on public.articles for delete using (author_id = auth.uid());

drop policy if exists snippets_select on public.snippets;
create policy snippets_select on public.snippets for select using (true);
drop policy if exists snippets_insert on public.snippets;
create policy snippets_insert on public.snippets for insert with check (author_id = auth.uid());
drop policy if exists snippets_update on public.snippets;
create policy snippets_update on public.snippets for update using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists snippets_delete on public.snippets;
create policy snippets_delete on public.snippets for delete using (author_id = auth.uid());

-- ---------- 评论：公开读，本人写 ----------
drop policy if exists post_comments_select on public.post_comments;
create policy post_comments_select on public.post_comments for select using (true);
drop policy if exists post_comments_insert on public.post_comments;
create policy post_comments_insert on public.post_comments for insert with check (author_id = auth.uid());
drop policy if exists post_comments_delete on public.post_comments;
create policy post_comments_delete on public.post_comments for delete using (author_id = auth.uid());

drop policy if exists article_comments_select on public.article_comments;
create policy article_comments_select on public.article_comments for select using (true);
drop policy if exists article_comments_insert on public.article_comments;
create policy article_comments_insert on public.article_comments for insert with check (author_id = auth.uid());
drop policy if exists article_comments_delete on public.article_comments;
create policy article_comments_delete on public.article_comments for delete using (author_id = auth.uid());

-- ---------- 点赞 / 收藏 / 关注：仅本人操作 ----------
drop policy if exists post_likes_all on public.post_likes;
create policy post_likes_all on public.post_likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists comment_likes_all on public.comment_likes;
create policy comment_likes_all on public.comment_likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists article_likes_all on public.article_likes;
create policy article_likes_all on public.article_likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists snippet_likes_all on public.snippet_likes;
create policy snippet_likes_all on public.snippet_likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists favorites_all on public.favorites;
create policy favorites_all on public.favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists follows_all on public.follows;
create policy follows_all on public.follows for all using (follower_id = auth.uid()) with check (follower_id = auth.uid());

-- ---------- 通知：仅接收者读 / 标记，写入限发起者（from_user_id = auth.uid()） ----------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert with check (from_user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete using (user_id = auth.uid());

-- ---------- 私信：仅 owner 读写（跨用户写入走 send_message RPC） ----------
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (owner_id = auth.uid());
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete using (owner_id = auth.uid());

-- ---------- 草稿：全私有 ----------
drop policy if exists post_drafts_all on public.post_drafts;
create policy post_drafts_all on public.post_drafts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists article_drafts_all on public.article_drafts;
create policy article_drafts_all on public.article_drafts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- documents（轮 6）：全私有（通用键值文档层） ----------
drop policy if exists documents_all on public.documents;
create policy documents_all on public.documents for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- resources / topics / hot_searches：公开读，写入仅 service role（不建写策略） ----------
drop policy if exists resources_select on public.resources;
create policy resources_select on public.resources for select using (true);
drop policy if exists topics_select on public.topics;
create policy topics_select on public.topics for select using (true);
drop policy if exists hot_searches_select on public.hot_searches;
create policy hot_searches_select on public.hot_searches for select using (true);

-- ============================================================================
-- Realtime（轮 5）：把 messages 表加入 supabase_realtime publication，
-- 使 RLS 过滤后的 INSERT 事件可推送给登录客户端（私信实时收发）。
-- 幂等：已存在则跳过，可重复执行。
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ==============================================================================
-- 迁移 0001_iam_phase1.sql
-- ==============================================================================

-- ============================================================================
-- Mim · Phase1 迁移 0001：IAM 账号权限中心（L1）+ L2/L3/L4 schema 骨架
-- 依据《全栈全平台项目 Phase1 团队配置方案》4.2：
--   IAM Phase1 验收 = 统一注册登录（JWT）、RBAC（菜单+按钮级）、接口鉴权 100%、
--   设备绑定、统一审计日志。明确不做：SSO 复杂实现、行级权限、组织架构树、自建 OAuth2。
-- 用法：Supabase Dashboard → SQL Editor → 全量执行（幂等，可重复执行）
-- 范围说明（用户指令「全部并行实现」）：
--   §1 L1 IAM          —— 完整实现（四表 + 审计 + RLS + 种子角色/权限）
--   §2 L2 商城交易     —— schema 骨架（微信/支付宝商户号到位前不接支付闭环）
--   §3 L3 直播音视频   —— schema 骨架（声网/ZEGO 资源到位前不接推拉流）
--   §4 L4 IoT 设备     —— 设备绑定属 IAM 验收项，本轮完整；遥测为骨架
-- ============================================================================

-- ============================================================================
-- §1 L1 IAM：角色 / 权限 / 用户角色 / 角色权限 / 审计日志
-- ============================================================================

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  description text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- 统一审计日志：append-only，改/删不开放（审计不可篡改）
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text not null default '',
  target_id   text not null default '',
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_actor   on public.audit_logs (actor_id, created_at desc);
create index if not exists idx_user_roles_user    on public.user_roles (user_id);

-- roles.updated_at 自动维护
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists roles_touch on public.roles;
create trigger roles_touch
  before update on public.roles
  for each row execute function public.touch_updated_at();

-- 管理员判定（security definer：绕过 RLS，避免 user_roles 策略自引用递归）
create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.name = 'admin'
  );
$$;

-- 权限判定（security definer：绕过 RLS，避免 user_roles/role_permissions 策略递归）
-- 用于把后端 RLS 与前端 RBAC 的权限点（permissions.key）对齐，例如 audit:view / role:manage
create or replace function public.has_perm(perm_key text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.key = perm_key
  );
$$;

-- ---------- 种子：四角色 + 权限点（菜单+按钮级，Phase1 粒度） ----------
insert into public.roles (name, description) values
  ('admin',        '超级管理员：全部权限'),
  ('operator',     '运营：后台查看 + 审计只读'),
  ('user',         '普通注册用户（默认角色）'),
  ('device_admin', '设备管理员：IoT 设备绑定/管理')
on conflict (name) do nothing;

insert into public.permissions (key, description) values
  ('admin:access',  '进入管理后台（菜单级）'),
  ('audit:view',    '查看审计日志'),
  ('role:manage',   '角色与权限管理（按钮级）'),
  ('user:manage',   '用户管理（按钮级）'),
  ('device:bind',   '绑定/解绑本人设备'),
  ('device:manage', '管理全部设备（按钮级）')
on conflict (key) do nothing;

-- admin 授予全部权限；operator 授予后台查看+审计；device_admin 授予设备管理；
-- user 无后台权限（默认角色，仅显式登记，便于后续分配）
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on (
  (r.name = 'admin')
  or (r.name = 'operator'     and p.key in ('admin:access', 'audit:view'))
  or (r.name = 'device_admin' and p.key in ('device:bind', 'device:manage'))
)
on conflict do nothing;

-- 新注册用户自动分配默认角色 user（挂在既有 handle_new_user 之后，独立触发器互不影响）
create or replace function public.handle_new_user_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role_id)
  select new.id, r.id from public.roles r where r.name = 'user'
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists on_auth_user_created_role on auth.users;
create trigger on_auth_user_created_role
  after insert on auth.users
  for each row execute function public.handle_new_user_role();

-- ---------- RLS ----------
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.user_roles       enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_logs       enable row level security;

-- 参考数据（角色/权限/映射）：登录用户可读（RBAC 菜单渲染需要），写仅 admin
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);
drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write on public.roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select to authenticated using (true);
drop policy if exists permissions_admin_write on public.permissions;
create policy permissions_admin_write on public.permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
drop policy if exists role_permissions_admin_write on public.role_permissions;
create policy role_permissions_admin_write on public.role_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- user_roles：本人可读自己的角色（前端拉取 RBAC），写仅 admin
drop policy if exists user_roles_owner_read on public.user_roles;
create policy user_roles_owner_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists user_roles_admin_write on public.user_roles;
create policy user_roles_admin_write on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 审计日志：admin 或持有 audit:view 权限者（如 operator）可读；
-- 登录用户可写且 actor 必须是本人（记录自己的操作轨迹）
drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (public.is_admin() or public.has_perm('audit:view'));
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid());

-- ============================================================================
-- §2 L2 商城交易（schema 骨架；支付闭环待微信/支付宝商户号）
-- ============================================================================

create table if not exists public.products (
  id          text primary key default gen_random_uuid()::text,
  title       text not null,
  price_cents int  not null default 0 check (price_cents >= 0),
  currency    text not null default 'CNY',
  status      text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at  timestamptz not null default now()
);

create table if not exists public.orders (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'unpaid'
              check (status in ('unpaid', 'paid', 'shipped', 'done', 'cancelled', 'refunded')),
  total_cents int  not null default 0 check (total_cents >= 0),
  currency    text not null default 'CNY',
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

create table if not exists public.order_items (
  id          bigint generated always as identity primary key,
  order_id    text not null references public.orders(id) on delete cascade,
  product_id  text not null references public.products(id),
  quantity    int not null default 1 check (quantity > 0),
  price_cents int not null default 0 check (price_cents >= 0)
);

-- 支付流水：写路径仅 service role / RPC（骨架期不开放客户端写），channel=mock 占位
create table if not exists public.payment_records (
  id          text primary key default gen_random_uuid()::text,
  order_id    text not null references public.orders(id) on delete cascade,
  channel     text not null default 'mock' check (channel in ('mock', 'wechat', 'alipay')),
  amount_cents int not null check (amount_cents >= 0),
  status      text not null default 'pending' check (status in ('pending', 'success', 'failed', 'refunded')),
  external_id text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_orders_user_created on public.orders (user_id, created_at desc);
create index if not exists idx_order_items_order   on public.order_items (order_id);
create index if not exists idx_payment_records_order on public.payment_records (order_id);

alter table public.products        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.payment_records enable row level security;

-- 商品：上架商品公开读；写仅 admin（运营后台后续接入）
drop policy if exists products_select on public.products;
create policy products_select on public.products for select using (status = 'active' or public.is_admin());
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 订单：本人读；创建限本人（支付状态流转走后续 RPC，不开放 update/delete）
drop policy if exists orders_owner_read on public.orders;
create policy orders_owner_read on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists orders_owner_insert on public.orders;
create policy orders_owner_insert on public.orders for insert to authenticated
  with check (user_id = auth.uid());

-- 订单明细：随订单归属（本人订单的明细可读可随单写入）
drop policy if exists order_items_owner_read on public.order_items;
create policy order_items_owner_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
drop policy if exists order_items_owner_insert on public.order_items;
create policy order_items_owner_insert on public.order_items for insert to authenticated
  with check (exists (select 1 from public.orders o
                      where o.id = order_id and o.user_id = auth.uid()));

-- 支付流水：本人订单可读；写不开放（等支付回调 RPC）
drop policy if exists payment_records_owner_read on public.payment_records;
create policy payment_records_owner_read on public.payment_records for select to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));

-- ============================================================================
-- §3 L3 直播音视频（schema 骨架；推拉流待声网/ZEGO 资源）
-- ============================================================================

create table if not exists public.live_rooms (
  id          text primary key default gen_random_uuid()::text,
  host_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  status      text not null default 'idle' check (status in ('idle', 'live', 'ended')),
  provider    text not null default 'mock' check (provider in ('mock', 'agora', 'zego')),
  channel_key text,
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.live_messages (
  id         bigint generated always as identity primary key,
  room_id    text not null references public.live_rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null default 'chat' check (kind in ('chat', 'gift', 'system')),
  content    text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.gift_records (
  id          bigint generated always as identity primary key,
  room_id     text not null references public.live_rooms(id) on delete cascade,
  sender_id   uuid references auth.users(id) on delete set null,
  gift_key    text not null,
  quantity    int not null default 1 check (quantity > 0),
  cost_points int not null default 0 check (cost_points >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists idx_live_rooms_status     on public.live_rooms (status, created_at desc);
create index if not exists idx_live_messages_room    on public.live_messages (room_id, created_at);
create index if not exists idx_gift_records_room     on public.gift_records (room_id, created_at desc);

alter table public.live_rooms    enable row level security;
alter table public.live_messages enable row level security;
alter table public.gift_records  enable row level security;

-- 直播间：公开读；主播写自己的房间
drop policy if exists live_rooms_select on public.live_rooms;
create policy live_rooms_select on public.live_rooms for select using (true);
drop policy if exists live_rooms_host_insert on public.live_rooms;
create policy live_rooms_host_insert on public.live_rooms for insert to authenticated
  with check (host_id = auth.uid());
drop policy if exists live_rooms_host_update on public.live_rooms;
create policy live_rooms_host_update on public.live_rooms for update to authenticated
  using (host_id = auth.uid() or public.is_admin()) with check (host_id = auth.uid() or public.is_admin());

-- 弹幕：房间公开读；登录用户发言（user_id=本人）
drop policy if exists live_messages_select on public.live_messages;
create policy live_messages_select on public.live_messages for select using (true);
drop policy if exists live_messages_insert on public.live_messages;
create policy live_messages_insert on public.live_messages for insert to authenticated
  with check (user_id = auth.uid());

-- 礼物：房间公开读；登录用户送礼（sender=本人；积分扣减走后续 RPC）
drop policy if exists gift_records_select on public.gift_records;
create policy gift_records_select on public.gift_records for select using (true);
drop policy if exists gift_records_insert on public.gift_records;
create policy gift_records_insert on public.gift_records for insert to authenticated
  with check (sender_id = auth.uid());

-- ============================================================================
-- §4 L4 IoT：设备 / 设备绑定（IAM 验收项，完整）/ 遥测（骨架）
-- ============================================================================

create table if not exists public.devices (
  id         text primary key default gen_random_uuid()::text,
  serial     text not null unique,
  model      text not null default '',
  firmware   text not null default '',
  status     text not null default 'offline' check (status in ('offline', 'online', 'disabled')),
  created_at timestamptz not null default now()
);

-- 设备绑定：用户 ↔ 设备（unbound_at 非空 = 已解绑，保留历史）
create table if not exists public.device_bindings (
  user_id    uuid not null references auth.users(id) on delete cascade,
  device_id  text not null references public.devices(id) on delete cascade,
  bound_at   timestamptz not null default now(),
  unbound_at timestamptz,
  primary key (user_id, device_id)
);

-- 遥测：骨架（MQTT Broker 到位前写入仅 service role，不开放客户端写）
create table if not exists public.device_telemetry (
  id        bigint generated always as identity primary key,
  device_id text not null references public.devices(id) on delete cascade,
  metric    text not null,
  value     numeric not null,
  ts        timestamptz not null default now()
);

create index if not exists idx_device_telemetry_device on public.device_telemetry (device_id, ts desc);

alter table public.devices          enable row level security;
alter table public.device_bindings  enable row level security;
alter table public.device_telemetry enable row level security;

-- 设备：已绑定用户或 device_admin/admin 可读；登记/管理限 device_admin 或 admin
drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = auth.uid() and r.name = 'device_admin')
    or exists (select 1 from public.device_bindings b
               where b.device_id = id and b.user_id = auth.uid() and b.unbound_at is null)
  );
drop policy if exists devices_admin_write on public.devices;
create policy devices_admin_write on public.devices for all to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = auth.uid() and r.name = 'device_admin')
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = auth.uid() and r.name = 'device_admin')
  );

-- 绑定：本人读写自己的绑定关系（绑定/解绑 = device:bind 权限，Phase1 简化为登录即可）
drop policy if exists device_bindings_owner_read on public.device_bindings;
create policy device_bindings_owner_read on public.device_bindings for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists device_bindings_owner_insert on public.device_bindings;
create policy device_bindings_owner_insert on public.device_bindings for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists device_bindings_owner_update on public.device_bindings;
create policy device_bindings_owner_update on public.device_bindings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 遥测：已绑定用户可读自己设备的数据；写不开放（等 MQTT → service role 管道）
drop policy if exists device_telemetry_read on public.device_telemetry;
create policy device_telemetry_read on public.device_telemetry for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.device_bindings b
               where b.device_id = device_id and b.user_id = auth.uid() and b.unbound_at is null)
  );

-- ==============================================================================
-- 迁移 0002_storage_media.sql
-- ==============================================================================

-- ============================================================================
-- Mim · Phase1 迁移 0002：对象存储（私有桶 mim-media + RLS 前缀隔离）
-- 目标平台：supabase.com 国际版
-- 用法：Supabase Dashboard → SQL Editor → 粘贴全量执行（幂等，可重复执行）
--
-- 与 CloudBase 侧存储契约保持一致（前端 src/lib/cloud-storage.ts 双端通用）：
--   · 桶私有（public=false）：文件只能通过签名链接访问，不支持公开 URL
--   · 对象 key = <uid>/<yyyy-mm>/<uuid>.<ext>：首段目录即所有者 uid
--   · RLS 限定 (storage.foldername(name))[1] = auth.uid()::text ⇒ 无法读写他人文件
--   · 单文件上限 3MB（3145728 字节，与前端 MAX_UPLOAD_BYTES / 云函数一致）
--   · MIME 白名单与云函数 MIME_ALLOW 一致（显式排除 svg：可内嵌脚本，XSS 面）
-- ============================================================================

-- ---------- 1. 桶（幂等：已存在则同步限制项） ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mim-media',
  'mim-media',
  false,
  3145728,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- 2. RLS：仅本人文件夹可读 / 写 / 改 / 删 ----------
-- storage.objects 默认启用 RLS；未登录（anon）一律不可见，
-- 签名链接（createSignedUrls）由 Storage 服务签发，不受策略影响。

drop policy if exists mim_media_own_select on storage.objects;
create policy mim_media_own_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists mim_media_own_insert on storage.objects;
create policy mim_media_own_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists mim_media_own_update on storage.objects;
create policy mim_media_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists mim_media_own_delete on storage.objects;
create policy mim_media_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ==============================================================================
-- 迁移 0003_account_bridge.sql
-- ==============================================================================

-- ============================================================================
-- Mim · Phase1 迁移 0003：CloudBase ↔ Supabase 账号桥（account bridge）
-- 目标平台：supabase.com 国际版
-- 用法：Supabase Dashboard → SQL Editor → 粘贴全量执行（幂等，可重复执行）
--
-- 背景：项目双后端（Supabase 主 / CloudBase 备），两套账号体系原本互相不可见：
--   · CloudBase app_users：uid = u_xxx，密码 PBKDF2-SHA512(100k, 64B) + 独立 salt
--   · Supabase auth.users：uuid，GoTrue bcrypt，用户名映射合成邮箱 <username>@mim.app
-- 本迁移把两者在「用户名」维度桥接：
--   ① account_bridge 表：登记 CloudBase 侧已注册的用户名 + 密码哈希（仅服务端可读）
--   ② username_taken()：注册前全局查重（auth.users + bridge 合并视图）
--   ③ claim_username()：CloudBase mim-api 注册成功后把账号登记进 bridge
--   ④ bridge 登录升级由 Edge Function /auth/bridge-login 完成（验 PBKDF2 →
--      Admin API 自动落户 Supabase），见 supabase/functions/mim-api/index.ts
--
-- 安全模型：
--   · account_bridge 禁一切客户端 select（password_hash 泄漏 = 密码泄漏）；
--     anon 仅可 insert（与开放注册同暴露面：抢注用户名本就是开放注册允许的）
--   · service_role（Edge Function）绕过 RLS，是唯一读者
--   · 两个 RPC 均为 security definer，内部自行收敛权限
-- ============================================================================

-- ---------- 1. 账号桥表 ----------
create table if not exists public.account_bridge (
  username        text primary key,
  cloudbase_uid   text not null default '',
  password_hash   text not null,
  salt            text not null,
  source          text not null default 'cloudbase' check (source in ('cloudbase', 'import')),
  migrated        boolean not null default false,
  failed_attempts int     not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_account_bridge_migrated on public.account_bridge (migrated);

-- updated_at 自动维护（复用 0001 的 touch_updated_at；若 0001 未执行则补建）
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists account_bridge_touch on public.account_bridge;
create trigger account_bridge_touch
  before update on public.account_bridge
  for each row execute function public.touch_updated_at();

-- ---------- 2. RLS：禁客户端读，anon 可 insert ----------
alter table public.account_bridge enable row level security;

drop policy if exists bridge_anon_insert on public.account_bridge;
create policy bridge_anon_insert on public.account_bridge
  for insert to anon, authenticated
  with check (true);

-- 不建 select / update / delete 策略 ⇒ 客户端一律拒绝；service_role 绕过 RLS
-- （显式 revoke，防止默认 grant 把表整体敞开）
revoke all on public.account_bridge from anon, authenticated;
grant insert on public.account_bridge to anon, authenticated;

-- ---------- 3. RPC：全局用户名查重（注册前预检，anon 可调） ----------
-- 同时覆盖：GoTrue 合成邮箱账号、邮箱直通账号、CloudBase 桥接账号
create or replace function public.username_taken(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(p_username) || '@mim.app'
       or lower(email) = lower(p_username)
  )
  or exists (
    select 1
    from public.account_bridge
    where username = p_username
  );
$$;

revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- ---------- 4. RPC：用户名占用登记（CloudBase mim-api 注册成功后调用，anon 可调） ----------
-- 返回 true = 本次新占用；false = 该用户名已被占用（先到先得）
create or replace function public.claim_username(
  p_username      text,
  p_password_hash text,
  p_salt          text,
  p_uid           text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_bridge (username, cloudbase_uid, password_hash, salt, source)
  values (p_username, p_uid, p_password_hash, p_salt, 'cloudbase')
  on conflict (username) do nothing;
  return exists (
    select 1 from public.account_bridge
    where username = p_username and cloudbase_uid = p_uid
  );
end $$;

revoke all on function public.claim_username(text, text, text, text) from public;
grant execute on function public.claim_username(text, text, text, text) to anon, authenticated;

-- ==============================================================================
-- 迁移 0004_post_rich_fields.sql
-- ==============================================================================

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

-- ==============================================================================
-- 迁移 0005_mall_catalog.sql
-- ==============================================================================

-- ============================================================================
-- Mim · 迁移 0005：商城目录（products 商品模型扩展 + 五频道商品种子）
--
-- 背景（前后端数据模型断点）：
--   前端 src/mall/store.tsx 的 MallGoods = { id, channel, emoji, title, price,
--   origPrice?, desc }，五个频道（youxuan / gexm / mix / live / laal）；
--   而 0001 建的 public.products 仅有 (id, title, price_cents, currency,
--   status, created_at) 六个字段，缺 channel / emoji / description / 原价，
--   导致商城在云端模式下无法承载任何商品（MALL_GOODS 恒为 [] → 商城为空态，
--   前端只能显示「发布自己的商品」引导）。
--
-- 本迁移仅补齐商品模型字段；不写入任何商品数据（商品唯一来源为用户/运营上架）。
--
-- 幂等：add column if not exists / DO 块约束 / create index if not exists，可重复执行。
-- ============================================================================

-- ---------- 1. 商品模型字段扩展 ----------

alter table if exists public.products
  add column if not exists channel              text not null default 'youxuan',
  add column if not exists emoji                text not null default '📦',
  add column if not exists description          text,
  add column if not exists original_price_cents int,
  add column if not exists stock                int  not null default 0,
  add column if not exists sales                int  not null default 0,
  add column if not exists sort                 int  not null default 0;

-- 频道取值约束（与前端 MallChannel 联合类型对齐；
-- 0001 建表后从未写入数据，故历史行不会违反该约束）
-- 注意：PostgreSQL 的 ADD CONSTRAINT 不支持 IF NOT EXISTS，用 DO 块实现幂等。
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'products') then
    begin
      alter table public.products
        add constraint products_channel_check
        check (channel in ('youxuan', 'gexm', 'mix', 'live', 'laal'));
    exception
      when duplicate_object then null;  -- 约束已存在，跳过
    end;
  end if;
end $$;

-- 频道 + 上架状态联合索引：商城按频道筛选商品的主查询路径
create index if not exists products_channel_status_idx
  on public.products (channel, status, sort);

-- ---------- 2. 校验输出（供 CI 迁移日志核对） ----------
-- select channel, count(*) from public.products where status='active' group by channel order by channel;

-- ==============================================================================
-- 记录已应用版本（使 CI 后续自动跳过，避免重复执行）
-- ==============================================================================

insert into public.schema_migrations (version) values ('0000_schema.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0001_iam_phase1.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0002_storage_media.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0003_account_bridge.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0004_post_rich_fields.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0005_mall_catalog.sql') on conflict (version) do nothing;

-- ==============================================================================
-- 执行后自检（四条均应有返回且不报错）：
--   select count(*) from public.roles;                                    -- 应 > 0（系统基础权限）
--   select count(*) from public.products where status = 'active';         -- 应 = 0（无演示商品）
--   select count(*) from public.topics;                                   -- 应 = 0（无演示话题）
--   select count(*) from public.hot_searches;                             -- 应 = 0（无演示热搜）
--   select public.username_taken('probe_name');                           -- 应 true/false，不再报 PGRST202
-- ==============================================================================
