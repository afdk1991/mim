/* ============================================================================
 * 0002_content —— 内容域：动态 / 文章 / 片段 / 评论 / 关注 / 收藏 / 私信 / 通知 / 草稿
 *
 * 列名与 src/domain/content/model.ts 严格一一对应（驼峰 → 下划线）：
 *   Post.authorId → posts.author_id，Post.createdAt → posts.created_at
 * 时间统一 bigint 毫秒（与前端模型一致，避免「秒 / 毫秒」二次换算错位）；
 * 富字段（media / vote / lottery）用 jsonb，缺列的旧行反序列化时按可选缺省处理。
 *
 * 幂等：create table if not exists / create index if not exists，可重复执行。
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 1. 动态
 * ------------------------------------------------------------------------ */

create table if not exists posts (
  id             text primary key default gen_random_uuid()::text,
  author_id      uuid not null references users (id) on delete cascade,
  content        text not null default '',
  images         jsonb not null default '[]'::jsonb,
  created_at     bigint not null,
  repost_of_id   text,
  repost_comment text not null default '',
  likes          int not null default 0,
  reposts        int not null default 0,
  topic          text,
  source         text not null default '',
  visibility     text not null default 'public' check (visibility in ('public', 'self')),
  views          int not null default 0,
  story          boolean not null default false,
  expires_at     bigint,
  pinned         boolean not null default false,
  media          jsonb,
  vote           jsonb,
  lottery        jsonb,
  location       text
);
create index if not exists idx_posts_author   on posts (author_id, created_at desc);
create index if not exists idx_posts_created  on posts (created_at desc);
create index if not exists idx_posts_topic    on posts (topic, created_at desc) where topic is not null;

create table if not exists post_comments (
  id         text primary key default gen_random_uuid()::text,
  post_id    text not null references posts (id) on delete cascade,
  author_id  uuid not null references users (id) on delete cascade,
  content    text not null default '',
  created_at bigint not null,
  likes      int not null default 0,
  reply_to   text
);
create index if not exists idx_post_comments_post on post_comments (post_id, created_at);

/* --------------------------------------------------------------------------
 * 2. 文章与片段
 * ------------------------------------------------------------------------ */

create table if not exists articles (
  id         text primary key default gen_random_uuid()::text,
  author_id  uuid not null references users (id) on delete cascade,
  title      text not null default '',
  summary    text not null default '',
  content    text not null default '',
  tags       jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  views      int not null default 0,
  likes      int not null default 0
);
create index if not exists idx_articles_author  on articles (author_id, created_at desc);
create index if not exists idx_articles_created on articles (created_at desc);

create table if not exists article_comments (
  id         text primary key default gen_random_uuid()::text,
  article_id text not null references articles (id) on delete cascade,
  author_id  uuid not null references users (id) on delete cascade,
  content    text not null default '',
  created_at bigint not null
);
create index if not exists idx_article_comments_article on article_comments (article_id, created_at);

create table if not exists snippets (
  id         text primary key default gen_random_uuid()::text,
  author_id  uuid not null references users (id) on delete cascade,
  title      text not null default '',
  language   text not null default 'TypeScript',
  code       text not null default '',
  created_at bigint not null,
  likes      int not null default 0
);
create index if not exists idx_snippets_author on snippets (author_id, created_at desc);

/* --------------------------------------------------------------------------
 * 3. 社交关系：关注 / 收藏
 * ------------------------------------------------------------------------ */

create table if not exists follows (
  id          text primary key default gen_random_uuid()::text,
  follower_id uuid not null references users (id) on delete cascade,
  followee_id uuid not null references users (id) on delete cascade,
  created_at  bigint not null,
  unique (follower_id, followee_id)
);
create index if not exists idx_follows_follower on follows (follower_id, created_at desc);
create index if not exists idx_follows_followee on follows (followee_id, created_at desc);

create table if not exists favorites (
  id         text primary key default gen_random_uuid()::text,
  user_id    uuid not null references users (id) on delete cascade,
  kind       text not null default 'post' check (kind in ('post', 'article')),
  target_id  text not null,
  created_at bigint not null,
  unique (user_id, kind, target_id)
);
create index if not exists idx_favorites_user on favorites (user_id, created_at desc);

/* --------------------------------------------------------------------------
 * 4. 私信 / 通知（各自持一份副本：owner 列即 owner，天然隔离会话）
 * ------------------------------------------------------------------------ */

create table if not exists messages (
  id         text primary key default gen_random_uuid()::text,
  user_id    uuid not null references users (id) on delete cascade,
  peer_id    uuid not null references users (id) on delete cascade,
  from_me    boolean not null default false,
  content    text not null default '',
  created_at bigint not null,
  read       boolean not null default false
);
create index if not exists idx_messages_owner on messages (user_id, peer_id, created_at);

create table if not exists notifications (
  id           text primary key default gen_random_uuid()::text,
  user_id      uuid not null references users (id) on delete cascade,
  type         text not null default 'like'
                 check (type in ('like', 'comment', 'repost', 'follow', 'mention')),
  from_user_id uuid references users (id) on delete set null,
  content      text not null default '',
  post_id      text,
  created_at   bigint not null,
  read         boolean not null default false
);
create index if not exists idx_notifications_user on notifications (user_id, created_at desc);

/* --------------------------------------------------------------------------
 * 5. 草稿箱
 * ------------------------------------------------------------------------ */

create table if not exists post_drafts (
  id       text primary key default gen_random_uuid()::text,
  user_id  uuid not null references users (id) on delete cascade,
  content  text not null default '',
  topic    text not null default '',
  images   jsonb not null default '[]'::jsonb,
  saved_at bigint not null
);
create index if not exists idx_post_drafts_user on post_drafts (user_id, saved_at desc);

create table if not exists article_drafts (
  id       text primary key default gen_random_uuid()::text,
  user_id  uuid not null references users (id) on delete cascade,
  title    text not null default '',
  content  text not null default '',
  tags     jsonb not null default '[]'::jsonb,
  saved_at bigint not null
);
create index if not exists idx_article_drafts_user on article_drafts (user_id, saved_at desc);
