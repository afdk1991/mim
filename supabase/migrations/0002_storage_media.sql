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
