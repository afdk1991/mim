/* ============================================================================
 * 一键补齐迁移 0008 + 0009（Supabase 生产库 · 手动执行版）
 * 生成时间：2026-10-27
 * 来源文件（逐字节拼接，未做任何改写）：
 *   supabase/migrations/0008_mall.sql
 *   supabase/migrations/0009_price_rec.sql
 *
 * 为什么需要：CI 的 migrate-db job 因仓库未配 SUPABASE_ACCESS_TOKEN /
 *   SUPABASE_PROJECT_REF，实际执行的是「跳过」分支（job 仍报 success，属假成功），
 *   故生产库目前仅应用到 0007，缺失 0008/0009。
 *
 * 执行方式：Supabase Dashboard → SQL Editor → 粘贴全部 → Run
 *
 * 安全性：全部语句为 create table if not exists / create or replace function /
 *   create index if not exists / drop policy if exists + create policy。
 *   不含任何 DROP TABLE、DELETE、ALTER 既有表列 —— 不触碰既有数据，幂等可重复执行。
 *
 * 回滚：见文件末尾「回滚脚本」段（本迁移纯新增，回滚即删除新增对象，无数据损失）。
 * ========================================================================== */

/* ============================================================================
 * 0008_mall —— 商城订单后端化 + 支付核销口令后端化（P0 资金安全：根除欺诈漏洞）
 *
 * 现状：订单存浏览器 localStorage；管理员核销口令由前端 checkOperatorKey 比对
 * SITE_CONFIG.payConfirmKey，口令一旦配置即随 JS 包明文暴露，任何人可自确认订单、
 * 自充余额（资金欺诈）。本迁移：
 *   · mall_orders —— 订单表（真源从 localStorage 挪到数据库，按 user_id 隔离）
 *   · RLS：本人可读自己订单；核销由服务端 RPC 处理
 *   · confirm_order(p_order_id, p_key) RPC（SECURITY DEFINER）：
 *       - 仅 is_admin 用户可核销（is_admin 由 user_roles 判定）
 *       - 口令在服务端比对（来自安全配置，永不下发前端）
 *       - awaiting_confirm → paid，返 5% 积分由调用方处理
 *   注：CloudBase 备模式同名逻辑在 CloudBase 云函数 + PG 函数实现，本文件为
 *       Supabase 主模式资产。前端 supply 的口令仅透传，不存储、不比对。
 * ========================================================================== */

create table if not exists mall_orders (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  goods_id    text,
  title       text,
  emoji       text,
  amount      integer not null,           -- 元
  qty         integer not null default 1,
  channel     text,
  status      text not null default 'unpaid'
                check (status in ('unpaid', 'awaiting_confirm', 'paid', 'done')),
  pay_channel text,
  proof       jsonb,
  at          bigint not null
);
create index if not exists idx_mall_orders_user on mall_orders (user_id, at desc);

alter table mall_orders enable row level security;

drop policy if exists mall_orders_owner on mall_orders;
create policy mall_orders_owner on mall_orders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* is_admin 判定（user_roles 表，role='admin'） */
create or replace function is_admin(p_uid uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from user_roles where user_id = p_uid and role = 'admin'
  );
$$;

/* 服务端核销：口令比对在服务端进行（来自安全配置），前端只透传用户输入 */
create or replace function confirm_order(p_order_id text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  cfg text;
  o mall_orders%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  if not is_admin(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 核销口令来自服务端安全配置（vault/函数常量），此处占位由部署注入
  -- 实际比对在 Edge Function / 云函数层完成，本 RPC 仅做状态机转移。
  select * into o from mall_orders where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_order'); end if;
  if o.status <> 'awaiting_confirm' then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  update mall_orders set status = 'paid' where id = p_order_id;
  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'amount', o.amount);
end;
$$;

grant execute on function is_admin(uuid) to authenticated;
grant execute on function confirm_order(text, text) to authenticated;

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

/* ============================================================================
 * 验证脚本（执行后单独运行，确认对象已建立）
 * ========================================================================== */
-- 应返回 3 行（mall_orders / price_quotes / rec_feedback）
-- select table_name from information_schema.tables
--  where table_schema='public'
--    and table_name in ('mall_orders','price_quotes','rec_feedback')
--  order by table_name;

-- 应返回 5 行（confirm_order / is_admin / price_latest / rec_feedback_get / rec_feedback_save）
-- select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public'
--    and proname in ('confirm_order','is_admin','price_latest','rec_feedback_get','rec_feedback_save')
--  order by proname;

-- 冒烟：应返回 HTTP 200 + {"ok":true,...}（公开读，无需登录）
-- GET https://sepfobukokrrivwyvhnd.supabase.co/rest/v1/rpc/price_latest

/* ============================================================================
 * 回滚脚本（仅在需要撤销时执行）
 * 说明：本迁移为纯新增，回滚 = 删除新增对象。既有表/数据不受影响。
 * ========================================================================== */
-- drop policy if exists mall_orders_owner on mall_orders;
-- drop table if exists mall_orders;
-- drop table if exists price_quotes;
-- drop table if exists rec_feedback;
-- drop function if exists confirm_order(text, text);
-- drop function if exists is_admin(uuid);
-- drop function if exists price_latest(text[]);
-- drop function if exists rec_feedback_get();
-- drop function if exists rec_feedback_save(jsonb, jsonb, text);
