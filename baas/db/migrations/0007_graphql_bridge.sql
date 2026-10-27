-- =============================================================================
-- 0007 GraphQL 桥接：把 pg_graphql 的解析能力挂到 PostgREST 的 RPC 上
-- 为什么这么绕：
--   pg_graphql 只提供库内函数 graphql.resolve()，本身不开 HTTP 端口。
--   经 PostgREST 的 /rest/v1/rpc/graphql 暴露，可以完整复用「JWT → 切换 PG 角色
--   → RLS 在库内裁决」这条链路，与 REST 完全同一套权限语义，也免去了额外网关插件。
--   网关侧：/graphql/v1  →  rewrite  →  /rpc/graphql（见 envoy/envoy.yaml）
-- =============================================================================

create schema if not exists graphql_public;
grant usage on schema graphql_public to anon, authenticated, service_role;

create or replace function public.graphql(
  query          text,
  variables      jsonb default '{}'::jsonb,
  operation_name text  default null
)
returns jsonb
language plpgsql
stable
-- security invoker（默认）：以调用者角色解析，pg_graphql 生成的 SQL 同样受 RLS 约束
as $$
begin
  if to_regprocedure('graphql.resolve(text, jsonb, text, jsonb)') is null then
    raise exception 'pg_graphql 未安装，GraphQL 不可用'
      using hint = '在数据库中执行 create extension pg_graphql（supabase/postgres 镜像已内置）';
  end if;

  return graphql.resolve(
    query,
    coalesce(variables, '{}'::jsonb),
    operation_name,
    null::jsonb
  );
end $$;

grant execute on function public.graphql(text, jsonb, text)
  to anon, authenticated, service_role;

comment on function public.graphql(text, jsonb, text) is
  'GraphQL 入口；经 PostgREST RPC 暴露，权限语义与 REST 完全一致（RLS 在库内裁决）';
