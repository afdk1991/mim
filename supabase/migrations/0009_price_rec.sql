-- P1 后端化增量迁移（Supabase 源码资产 · 与 cloudbase/migrations/20261028000000_price_rec.sql 同构）
-- 主后端为 CloudBase；本文件为 supabase 备后端的同源实现，使用 auth.uid() 取当前用户。
-- price 回源 cron 在 supabase 侧需经 pg_cron + Edge Function 实现，本 RPC 仅提供读取快照。

-- ---------------------------------------------------------------------------
-- 价格行情快照（P1-1）：服务端回源写入，前端只读
-- ---------------------------------------------------------------------------
create table if not exists price_quotes (
  coin_id    text primary key,
  price_cny  numeric(24,8) not null,
  change_24h numeric(12,4) not null default 0,
  at         bigint not null
);
create index if not exists idx_price_quotes_at on price_quotes (at desc);

-- 读取行情快照（公开读，不依赖登录）
create or replace function price_latest(p_ids text[] default null)
returns jsonb language plpgsql security definer as $$
declare
  rows record;
  out jsonb := '{}'::jsonb;
begin
  if p_ids is null then
    for rows in select coin_id, price_cny, change_24h, at from price_quotes loop
      out := jsonb_set(out, array[rows.coin_id],
        jsonb_build_object('price', rows.price_cny, 'change', rows.change_24h, 'at', rows.at));
    end loop;
  else
    for rows in select coin_id, price_cny, change_24h, at from price_quotes
               where coin_id = any(p_ids) loop
      out := jsonb_set(out, array[rows.coin_id],
        jsonb_build_object('price', rows.price_cny, 'change', rows.change_24h, 'at', rows.at));
    end loop;
  end if;
  return out;
end;
$$;
grant execute on function price_latest(text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 推荐负反馈 / 同城定位（P1-2）：云端真源，auth.uid() 隔离
-- ---------------------------------------------------------------------------
create table if not exists rec_feedback (
  user_id text primary key,
  authors jsonb not null default '[]'::jsonb,
  topics  jsonb not null default '[]'::jsonb,
  city    text   not null default '北京市',
  updated_at timestamptz not null default now()
);

create or replace function rec_feedback_get()
returns jsonb language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  fb rec_feedback%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select * into fb from rec_feedback where user_id = v_uid::text;
  if not found then
    return jsonb_build_object('ok', true, 'exists', false, 'authors', '[]'::jsonb, 'topics', '[]'::jsonb, 'city', '北京市');
  end if;
  return jsonb_build_object(
    'ok', true, 'exists', true,
    'authors', coalesce(fb.authors, '[]'::jsonb),
    'topics',  coalesce(fb.topics, '[]'::jsonb),
    'city',    fb.city
  );
end;
$$;

create or replace function rec_feedback_save(p_authors jsonb, p_topics jsonb, p_city text)
returns jsonb language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  insert into rec_feedback(user_id, authors, topics, city, updated_at)
  values (
    v_uid::text,
    coalesce(p_authors, '[]'::jsonb),
    coalesce(p_topics, '[]'::jsonb),
    coalesce(nullif(btrim(p_city), ''), '北京市'),
    now()
  )
  on conflict (user_id) do update
    set authors = excluded.authors,
        topics  = excluded.topics,
        city    = excluded.city,
        updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function rec_feedback_get() to authenticated;
grant execute on function rec_feedback_save(jsonb, jsonb, text) to authenticated;
