-- =============================================================================
-- 0005 Storage 桥接：业务侧文件引用表 + storage.objects 上的示例策略
-- 分工：字节流在对象存储（本地卷 / S3），元数据在 Postgres；
--       权限判定统一落在库内 RLS，Storage 服务只做代理与签名。
-- =============================================================================

-- ---------- 业务侧引用 ----------
create table if not exists public.file_refs (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default public.jwt_uid(),
  bucket      text not null,
  object_path text not null,
  mime_type   text,
  size_bytes  bigint,
  document_id uuid references public.documents (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (bucket, object_path)
);

create index if not exists file_refs_owner_idx on public.file_refs (owner, created_at desc);

alter table public.file_refs enable row level security;

drop policy if exists "file_refs 本人可读" on public.file_refs;
create policy "file_refs 本人可读" on public.file_refs
  for select to authenticated
  using (public.jwt_uid() = owner);

drop policy if exists "file_refs 本人可写" on public.file_refs;
create policy "file_refs 本人可写" on public.file_refs
  for all to authenticated
  using (public.jwt_uid() = owner)
  with check (public.jwt_uid() = owner);

-- ---------- storage.objects 上的示例策略（avatars 桶：仅本人可写，公开可读） ----------
-- storage schema 由 storage-api 首次启动时创建，因此这里做存在性判断，
-- 未就绪时跳过；容器起来后再跑一次 `make migrate` 即会自动补上。
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '[0005] storage.objects 尚不存在（storage-api 未初始化），跳过对象策略';
    return;
  end if;

  execute $policy$
    drop policy if exists "avatars 公开可读" on storage.objects;
    create policy "avatars 公开可读" on storage.objects
      for select using (bucket_id = 'avatars');
  $policy$;

  execute $policy$
    drop policy if exists "avatars 本人可写" on storage.objects;
    create policy "avatars 本人可写" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'avatars' and owner = public.jwt_uid());
  $policy$;

  execute $policy$
    drop policy if exists "avatars 本人可改删" on storage.objects;
    create policy "avatars 本人可改删" on storage.objects
      for update to authenticated
      using (bucket_id = 'avatars' and owner = public.jwt_uid())
      with check (bucket_id = 'avatars' and owner = public.jwt_uid());
  $policy$;

  execute $policy$
    create policy "avatars 本人可删" on storage.objects
      for delete to authenticated
      using (bucket_id = 'avatars' and owner = public.jwt_uid());
  $policy$;

  raise notice '[0005] storage.objects 策略已就位';
end $$;

-- ---------- 便捷视图 ----------
create or replace view public.my_files as
select f.*, d.title as attached_document_title
from public.file_refs f
left join public.documents d on d.id = f.document_id
where f.owner = public.jwt_uid();

-- PG15+：让视图以调用者身份执行（否则会绕过调用者的 RLS）
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.my_files set (security_invoker = true)';
  end if;
end $$;
