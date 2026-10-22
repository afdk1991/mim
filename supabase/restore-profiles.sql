-- ============================================================
-- 补齐缺失的用户档案（auth.users → profiles）
-- 背景：clear-data.sql 会 TRUNCATE profiles，而 handle_new_user 触发器
--       只在「新用户注册」时触发，已注册的老账号档案不会自动重建。
-- 影响：发帖/评论不受影响（外键指向 auth.users），但头像/昵称会落「新用户」，
--       且修改昵称/bio 的 update 影响 0 行、静默不生效。
-- 执行位置：Supabase Dashboard → SQL Editor → New query
-- 说明：可重复执行，只插入缺失行，不覆盖已有档案。
-- ============================================================

insert into public.profiles (id, name, emoji, color, bio)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data->>'name', ''),
    split_part(u.email, '@', 1),
    '新用户'
  ),
  '🙂',
  '#4f7cff',
  ''
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
