-- =============================================================================
-- 0010 用量配额：按「用户 × 指标 × 时间窗」计数，供 Edge Functions / 网关限流判定
-- 说明：计数在库内，避免引入 Redis 等额外组件；周期用 date_trunc 对齐，
--       天然可聚合、可按月清理。网关层限流（令牌桶）与这里是互补关系：
--       网关挡瞬时洪峰，这里做「按业务量」的配额（如每日上传数、每小时 RPC 次数）。
-- =============================================================================

create table if not exists public.usage_counters (
  subject      uuid not null,
  metric       text not null,
  period_start timestamptz not null,
  hits         bigint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (subject, metric, period_start)
);

create index if not exists usage_counters_period_idx
  on public.usage_counters (metric, period_start);

alter table public.usage_counters enable row level security;

drop policy if exists "usage 本人或管理员可读" on public.usage_counters;
create policy "usage 本人或管理员可读" on public.usage_counters
  for select using (public.jwt_uid() = subject or public.jwt_has_role('admin'));

-- ---------- 计数累加 ----------
-- security definer：调用者不能伪造 subject（subject 恒为 JWT 的 sub）
create or replace function public.bump_usage(
  metric text,
  amount int default 1,
  period text default 'hour'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject uuid := public.jwt_uid();
  v_start   timestamptz := date_trunc(period, now());
  v_hits    bigint;
begin
  if v_subject is null then
    raise exception '未登录，不能计量用量';
  end if;
  if period not in ('minute', 'hour', 'day', 'month') then
    raise exception 'period 只支持 minute/hour/day/month，收到：%', period;
  end if;

  insert into public.usage_counters (subject, metric, period_start, hits)
  values (v_subject, metric, v_start, coalesce(amount, 1))
  on conflict (subject, metric, period_start)
  do update set hits = public.usage_counters.hits + excluded.hits,
                updated_at = now()
  returning hits into v_hits;

  return v_hits;
end $$;

-- ---------- 配额判定 ----------
create or replace function public.within_quota(
  metric text,
  limit_per_period int,
  period text default 'hour'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hits bigint;
begin
  if coalesce(limit_per_period, 0) <= 0 then
    return true;   -- <=0 表示不限
  end if;

  select hits into v_hits
  from public.usage_counters
  where subject = public.jwt_uid()
    and metric = within_quota.metric
    and period_start = date_trunc(period, now());

  return coalesce(v_hits, 0) < limit_per_period;
end $$;

-- ---------- 当前用量 ----------
create or replace function public.usage_in_period(
  metric text,
  period text default 'hour'
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select hits from public.usage_counters
     where subject = public.jwt_uid()
       and metric = usage_in_period.metric
       and period_start = date_trunc(period, now())),
    0)
$$;

grant execute on function public.bump_usage(text, int, text) to authenticated, service_role;
grant execute on function public.within_quota(text, int, text) to authenticated, service_role;
grant execute on function public.usage_in_period(text, text) to authenticated, service_role;

comment on function public.within_quota(text, int, text) is
  '配额判定：limit<=0 视为不限；调用前先判定、调用后再 bump_usage，避免超额一次';
