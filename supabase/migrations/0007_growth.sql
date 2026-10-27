/* ============================================================================
 * 0007_growth —— 统一成长引擎后端化（P0 资金/安全：防作弊）
 *
 * 现状：成长值/签到/徽章仅存浏览器 localStorage（src/growth.tsx），可改系统时钟
 * 伪造签到连击、改 localStorage 刷分。本迁移把真相挪到数据库：
 *   · growth_events   —— 不可篡改的行为事件账本（计分唯一真源）
 *   · growth_checkins —— 签到（last 日期 + 连续天数），服务端校时防作弊
 *   · growth_badges   —— 徽章首次达成时刻（独立于 events，便于前端展示）
 *   · growth_rules    —— 规则配置表（值/日上限/质量门），运营可改、代码不硬编码
 *   · RLS：仅本人可读写
 *   · 原子 RPC（SECURITY DEFINER，内部 auth.uid()）：
 *       growth_record  —— 校验规则/质量门/日上限后写事件，返回 ok/reason
 *       growth_checkin —— 服务端计算连击（断签重置），返回 streak
 *       growth_state   —— 返回 events/checkin/badges 派生
 * ========================================================================== */

create table if not exists growth_rules (
  action       text primary key,
  value        integer not null,
  daily_cap    integer,               -- null = 无上限
  quality_gate boolean not null default false
);

insert into growth_rules (action, value, daily_cap, quality_gate) values
  ('publish_dynamic',     2,   10,  false),
  ('dynamic_liked',       1,  200, false),
  ('live_open',          50,    1, false),
  ('follow_gained',       1,   50, false),
  ('publish_article',    10,    5, true),
  ('article_collected',   3, null, false),
  ('answer_adopted',     20, null, false),
  ('resource_downloaded', 5, null, false),
  ('column_finished',    30, null, false),
  ('course_review_good',  5, null, false),
  ('anti_spam_penalty', -50, null, false)
on conflict (action) do nothing;

create table if not exists growth_events (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  action    text not null,
  at        bigint not null
);
create index if not exists idx_growth_events_user on growth_events (user_id, at desc);

create table if not exists growth_checkins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  last       date not null default current_date,
  streak     integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists growth_badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  code    text not null,
  at      bigint not null,
  primary key (user_id, code)
);

/* ---------- RLS ---------- */
alter table growth_events     enable row level security;
alter table growth_checkins   enable row level security;
alter table growth_badges     enable row level security;
alter table growth_rules      enable row level security;

drop policy if exists growth_events_owner on growth_events;
create policy growth_events_owner on growth_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists growth_checkins_owner on growth_checkins;
create policy growth_checkins_owner on growth_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists growth_badges_owner on growth_badges;
create policy growth_badges_owner on growth_badges
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists growth_rules_read on growth_rules;
create policy growth_rules_read on growth_rules for select using (true);

/* ---------- 原子 RPC ---------- */
create or replace function growth_record(p_action text, p_quality boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r growth_rules%rowtype;
  used int;
  day_start bigint := extract(epoch from date_trunc('day', now()))::bigint * 1000;
  new_id bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select * into r from growth_rules where action = p_action;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_rule'); end if;
  if r.quality_gate and not p_quality then
    return jsonb_build_object('ok', false, 'reason', 'quality');
  end if;
  if r.daily_cap is not null and r.value > 0 then
    select count(*)::int into used from growth_events
     where user_id = v_uid and action = p_action and at >= day_start;
    if used >= r.daily_cap then
      return jsonb_build_object('ok', false, 'reason', 'cap');
    end if;
  end if;
  insert into growth_events (user_id, action, at)
   values (v_uid, p_action, extract(epoch from now())::bigint * 1000)
   returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'value', r.value);
end;
$$;

create or replace function growth_checkin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c growth_checkins%rowtype;
  new_streak int;
  today date := current_date;
  yest  date := current_date - 1;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select * into c from growth_checkins where user_id = v_uid;
  if not found then
    insert into growth_checkins (user_id, last, streak) values (v_uid, today, 1);
    return jsonb_build_object('ok', true, 'streak', 1);
  end if;
  if c.last = today then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  new_streak := case when c.last = yest then c.streak + 1 else 1 end;
  update growth_checkins set last = today, streak = new_streak, updated_at = now()
   where user_id = v_uid;
  return jsonb_build_object('ok', true, 'streak', new_streak);
end;
$$;

create or replace function growth_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  ev jsonb;
  ck jsonb;
  bd jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'action', action, 'at', at)), '[]'::jsonb)
   into ev from (select id, action, at from growth_events where user_id = v_uid order by at desc) t;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'at', at)), '[]'::jsonb)
   into bd from (select code, at from growth_badges where user_id = v_uid) t;
  select jsonb_build_object('last', to_char(last, 'YYYY-M-D'), 'streak', streak)
   into ck from growth_checkins where user_id = v_uid;
  return jsonb_build_object(
    'ok', true,
    'events', ev,
    'checkin', coalesce(ck, jsonb_build_object('last', '', 'streak', 0)),
    'badges', bd
  );
end;
$$;

grant execute on function growth_record(text, boolean) to authenticated;
grant execute on function growth_checkin() to authenticated;
grant execute on function growth_state() to authenticated;
