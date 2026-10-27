/* ============================================================================
 * 0005_growth —— 成长引擎（事件账本 / 签到 / 徽章 / 规则）
 *
 * 整合自历史迁移 0007_growth.sql，表与列完全一致：
 *   · growth_events —— 不可篡改的行为流水，计分唯一真源（服务端校时防刷）
 *   · growth_checkins —— 服务端计算连击，改系统时钟无效
 *   · growth_badges —— 徽章首次达成时刻
 *   · growth_rules —— 规则可运营配置，代码不硬编码分数与日上限
 *
 * 幂等：create table if not exists / on conflict 种子，可重复执行。
 * ========================================================================== */

create table if not exists growth_rules (
  action       text primary key,
  value        integer not null,
  daily_cap    integer,
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
  id      bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  action  text not null,
  at      bigint not null
);
create index if not exists idx_growth_events_user on growth_events (user_id, at desc);

create table if not exists growth_checkins (
  user_id    uuid primary key references users (id) on delete cascade,
  last       date not null default current_date,
  streak     integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists growth_badges (
  user_id uuid not null references users (id) on delete cascade,
  code    text not null,
  at      bigint not null,
  primary key (user_id, code)
);
