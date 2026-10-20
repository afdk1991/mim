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

-- ---------- resources / topics / hot_searches：公开读，写入仅 service role（不建写策略） ----------
drop policy if exists resources_select on public.resources;
create policy resources_select on public.resources for select using (true);
drop policy if exists topics_select on public.topics;
create policy topics_select on public.topics for select using (true);
drop policy if exists hot_searches_select on public.hot_searches;
create policy hot_searches_select on public.hot_searches for select using (true);
