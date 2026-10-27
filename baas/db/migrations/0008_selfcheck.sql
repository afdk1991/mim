-- =============================================================================
-- 0008 自检：库内一键体检（scripts/healthcheck.mjs 会调用同名 RPC）
-- 用法：select * from public.baas_selfcheck();
-- =============================================================================

create or replace function public.baas_selfcheck()
returns table (check_name text, status text, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_missing_tables int;
  v_pub_tables     int;
  v_slot_lag       text;
begin
  -- 1. 必装扩展
  return query
    select 'extension:pgcrypto',
           case when exists (select 1 from pg_extension where extname = 'pgcrypto')
                then 'ok' else 'missing' end,
           '加解密与 gen_random_uuid 依赖';

  return query
    select 'extension:vector',
           case when exists (select 1 from pg_extension where extname = 'vector')
                then 'ok' else 'missing' end,
           'pgvector：缺失则向量检索不可用';

  return query
    select 'extension:pg_graphql',
           case when exists (select 1 from pg_extension where extname = 'pg_graphql')
                then 'ok' else 'missing' end,
           '缺失则 /graphql/v1 不可用';

  -- 2. 角色
  return query
    select 'roles',
           case when (
                  select count(*) from pg_roles
                  where rolname in ('anon','authenticated','service_role','authenticator')
                ) = 4 then 'ok' else 'missing' end,
           'anon / authenticated / service_role / authenticator';

  -- 3. RLS 漏开（上线前必须为 0）
  select count(*) into v_missing_tables from public.rls_missing;
  return query
    select 'rls_missing',
           case when v_missing_tables = 0 then 'ok' else 'fail' end,
           format('未启用 RLS 的表：%s 张', v_missing_tables);

  -- 4. Realtime publication
  select count(*) into v_pub_tables
  from pg_publication_tables
  where pubname = 'supabase_realtime';
  return query
    select 'realtime_publication',
           case when v_pub_tables > 0 then 'ok' else 'missing' end,
           format('supabase_realtime 已订阅 %s 张表', v_pub_tables);

  -- 5. 复制槽滞后（Realtime 断连会导致 WAL 堆积）
  begin
    select coalesce(
             pg_size_pretty(max(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn))),
             '0 bytes'
           )
      into v_slot_lag
    from pg_replication_slots
    where slot_name like 'supabase_realtime%';
  exception when others then
    v_slot_lag := 'unknown';
  end;
  return query
    select 'realtime_slot_lag',
           case when v_slot_lag in ('unknown') then 'unknown'
                when pg_size_bytes(v_slot_lag) > 512 * 1024 * 1024 then 'fail'
                else 'ok' end,
           format('复制槽滞后：%s（>512MB 视为异常）', v_slot_lag);

  -- 6. 关键 RPC
  return query
    select 'rpc:' || f.proname,
           case when f.oid is null then 'missing' else 'ok' end,
           'GraphQL/向量检索入口'
    from (values ('graphql'), ('match_chunks'), ('hybrid_search'), ('ping')) as want(name)
    left join pg_proc f
      on f.proname = want.name
     and f.pronamespace = 'public'::regnamespace;
end $$;

grant execute on function public.baas_selfcheck() to authenticated, service_role;

comment on function public.baas_selfcheck() is
  '库内一键体检：扩展 / 角色 / RLS 漏开 / Realtime publication 与复制槽滞后 / 关键 RPC';
