-- ============================================================
-- 清空所有业务表数据，保留表结构/触发器/RPC/RLS 策略
-- 执行位置：Supabase Dashboard → SQL Editor → New query
-- 注意：此操作不可逆，执行前请确认已备份重要数据
-- ============================================================

TRUNCATE TABLE
  posts, post_comments,
  articles, article_comments,
  snippets,
  follows, favorites,
  messages, notifications,
  post_drafts, article_drafts,
  post_likes, comment_likes, article_likes, snippet_likes,
  documents, profiles
  CASCADE;
