/* ============================================================================
 * 0006_wallet —— 统一钱包后端化（P0 资金安全）
 *
 * 现状：钱包余额/流水仅存浏览器 localStorage（src/wallet.tsx），可任意篡改，
 * 且跨设备不互通。本迁移把真源挪到数据库：
 *   · wallet_balances：每用户一行余额（分整数）+ 当前套餐
 *   · wallet_txns：所有流水（充值/消费/收益），不可篡改的账本
 *   · RLS：用户只能读写自己的余额与流水
 *   · 原子 RPC（SECURITY DEFINER，内部用 auth.uid()）：
 *       wallet_debit  —— 原子扣费，余额不足返回 insufficient（防负余额竞态）
 *       wallet_credit —— 原子入账（充值/收益），首笔自动建余额行
 *       wallet_state  —— 返回余额/套餐/最近流水
 * 注：CloudBase 备模式使用同名 PG 函数（见 CloudBase 云函数部署），本文件为
 *      Supabase 主模式资产，apply 后前端主模式即生效。
 * ========================================================================== */

create table if not exists wallet_balances (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  balance_fen  bigint not null default 0 check (balance_fen >= 0),
  plan         text   not null default 'BASIC',
  updated_at   timestamptz not null default now()
);

create table if not exists wallet_txns (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users (id) on delete cascade,
  kind     text not null check (kind in ('recharge', 'consume', 'income')),
  fen      bigint not null check (fen > 0),
  note     text,
  snapshot jsonb,
  at       bigint not null
);
create index if not exists idx_wallet_txns_user on wallet_txns (user_id, at desc);

/* ---------- RLS ---------- */
alter table wallet_balances enable row level security;
alter table wallet_txns enable row level security;

drop policy if exists wallet_balances_owner on wallet_balances;
create policy wallet_balances_owner on wallet_balances
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists wallet_txns_owner on wallet_txns;
create policy wallet_txns_owner on wallet_txns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ---------- 原子 RPC ---------- */
create or replace function wallet_debit(p_fen bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  if p_fen <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  update wallet_balances set balance_fen = balance_fen - p_fen, updated_at = now()
   where user_id = v_uid and balance_fen >= p_fen
   returning balance_fen into v_bal;
  if v_bal is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient');
  end if;
  insert into wallet_txns (user_id, kind, fen, note, at)
   values (v_uid, 'consume', p_fen, coalesce(p_note, ''), extract(epoch from now())::bigint * 1000);
  return jsonb_build_object('ok', true, 'balance_fen', v_bal);
end;
$$;

create or replace function wallet_credit(p_fen bigint, p_note text, p_kind text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  if p_fen <= 0 or p_kind not in ('recharge', 'income') then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  insert into wallet_balances (user_id, balance_fen)
   values (v_uid, p_fen)
   on conflict (user_id) do update set balance_fen = wallet_balances.balance_fen + p_fen, updated_at = now()
   returning balance_fen into v_bal;
  insert into wallet_txns (user_id, kind, fen, note, snapshot, at)
   values (v_uid, p_kind, p_fen, coalesce(p_note, ''), p_snapshot, extract(epoch from now())::bigint * 1000);
  return jsonb_build_object('ok', true, 'balance_fen', v_bal);
end;
$$;

create or replace function wallet_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row wallet_balances%rowtype;
  v_txns jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select * into v_row from wallet_balances where user_id = v_uid;
  if not found then
    insert into wallet_balances (user_id) values (v_uid);
    v_row := (v_uid, 0, 'BASIC', now());
  end if;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_txns
   from (
     select id, kind, fen, note, at from wallet_txns
      where user_id = v_uid order by at desc limit 50
   ) t;
  return jsonb_build_object(
    'ok', true,
    'balance_fen', v_row.balance_fen,
    'plan', v_row.plan,
    'txns', v_txns
  );
end;
$$;

grant execute on function wallet_debit(bigint, text) to authenticated;
grant execute on function wallet_credit(bigint, text, text, jsonb) to authenticated;
grant execute on function wallet_state() to authenticated;
