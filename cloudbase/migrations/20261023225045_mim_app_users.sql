create table if not exists public.app_users (id text primary key default gen_random_uuid()::text, uid text not null unique, username text not null unique, password_hash text not null, salt text not null, name text not null default '', emoji text not null default '🙂', created_at timestamptz not null default now());
create index if not exists idx_app_users_username on public.app_users (username);
create index if not exists idx_app_users_uid on public.app_users (uid);
alter table public.app_users enable row level security;
revoke all on public.app_users from anon, authenticated;
grant select, insert, update on public.app_users to service_role;
