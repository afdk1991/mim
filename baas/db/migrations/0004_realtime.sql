-- =============================================================================
-- 0004 Realtime：逻辑复制 publication 白名单 + 副本标识
-- 关键约束（踩坑点，务必知悉）：
--   1) 只把真正需要推送的表放进 publication —— 每张表都会让 WAL 变胖，
--      且 Realtime 掉线时复制槽会一直保留 WAL，必须配 max_slot_wal_keep_size
--   2) UPDATE / DELETE 要做 RLS 复算时必须能拿到旧行 → replica identity full
--   3) 事务连接池下 LISTEN/NOTIFY 会失效，Realtime 走的是逻辑复制，不依赖 LISTEN
-- =============================================================================

-- ---------- publication ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['todos', 'documents', 'profiles'] loop
    if to_regclass(format('public.%I', t)) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice '[0004] 已加入 publication：public.%', t;
    end if;
  end loop;
end $$;

-- ---------- 副本标识：推送旧行，供 RLS 复算 ----------
alter table public.todos replica identity full;
alter table public.documents replica identity full;

-- ---------- 复制槽治理提示（参数在容器级设置，这里只做可见性检查） ----------
do $$
declare
  keep_size text;
begin
  keep_size := current_setting('max_slot_wal_keep_size', true);
  if coalesce(nullif(keep_size, ''), '-1') in ('-1', '0') then
    raise notice '[0004] max_slot_wal_keep_size=%（未限制），建议设为 1024 之类的有限值，否则 Realtime 断连会撑爆磁盘', keep_size;
  end if;
end $$;

-- ---------- Presence / Broadcast 约定（无需建表） ----------
comment on publication supabase_realtime is
  'Realtime 变更推送白名单：仅放需要实时订阅的表；新增表请走新迁移 add table';
