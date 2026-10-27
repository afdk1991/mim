CREATE TABLE IF NOT EXISTS wallet_balances (user_id text PRIMARY KEY, balance_fen bigint NOT NULL DEFAULT 0 CHECK (balance_fen >= 0), plan text NOT NULL DEFAULT 'BASIC', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wallet_txns (id bigserial PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('recharge','consume','income')), fen bigint NOT NULL CHECK (fen > 0), note text, snapshot jsonb, at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_user ON wallet_txns(user_id, at DESC);
CREATE OR REPLACE FUNCTION wallet_debit(p_uid text, p_fen bigint, p_note text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_bal bigint;
BEGIN
  IF p_fen <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_amount'); END IF;
  UPDATE wallet_balances SET balance_fen = balance_fen - p_fen, updated_at = now() WHERE user_id = p_uid AND balance_fen >= p_fen RETURNING balance_fen INTO v_bal;
  IF v_bal IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'insufficient'); END IF;
  INSERT INTO wallet_txns(user_id, kind, fen, note, at) VALUES (p_uid, 'consume', p_fen, COALESCE(p_note,''), extract(epoch from now())::bigint*1000);
  RETURN jsonb_build_object('ok', true, 'balance_fen', v_bal);
END;
$$;
CREATE OR REPLACE FUNCTION wallet_credit(p_uid text, p_fen bigint, p_note text, p_kind text, p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_bal bigint;
BEGIN
  IF p_fen <= 0 OR p_kind NOT IN ('recharge','income') THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_amount'); END IF;
  INSERT INTO wallet_balances(user_id, balance_fen) VALUES (p_uid, p_fen) ON CONFLICT (user_id) DO UPDATE SET balance_fen = wallet_balances.balance_fen + p_fen, updated_at = now() RETURNING balance_fen INTO v_bal;
  INSERT INTO wallet_txns(user_id, kind, fen, note, snapshot, at) VALUES (p_uid, p_kind, p_fen, COALESCE(p_note,''), p_snapshot, extract(epoch from now())::bigint*1000);
  RETURN jsonb_build_object('ok', true, 'balance_fen', v_bal);
END;
$$;
CREATE OR REPLACE FUNCTION wallet_state(p_uid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_bal bigint := 0; v_plan text := 'BASIC'; v_txns jsonb;
BEGIN
  SELECT balance_fen, plan INTO v_bal, v_plan FROM wallet_balances WHERE user_id = p_uid;
  IF NOT FOUND THEN INSERT INTO wallet_balances(user_id) VALUES (p_uid); v_bal := 0; v_plan := 'BASIC'; END IF;
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_txns FROM (SELECT id, kind, fen, note, at FROM wallet_txns WHERE user_id = p_uid ORDER BY at DESC LIMIT 50) t;
  RETURN jsonb_build_object('ok', true, 'balance_fen', v_bal, 'plan', v_plan, 'txns', v_txns);
END;
$$;
CREATE TABLE IF NOT EXISTS growth_rules (action text PRIMARY KEY, value integer NOT NULL, daily_cap integer, quality_gate boolean NOT NULL DEFAULT false);
INSERT INTO growth_rules(action, value, daily_cap, quality_gate) VALUES ('publish_dynamic',2,10,false),('dynamic_liked',1,200,false),('live_open',50,1,false),('follow_gained',1,50,false),('publish_article',10,5,true),('article_collected',3,NULL,false),('answer_adopted',20,NULL,false),('resource_downloaded',5,NULL,false),('column_finished',30,NULL,false),('course_review_good',5,NULL,false),('anti_spam_penalty',-50,NULL,false) ON CONFLICT (action) DO NOTHING;
CREATE TABLE IF NOT EXISTS growth_events (id bigserial PRIMARY KEY, user_id text NOT NULL, action text NOT NULL, at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS idx_growth_events_user ON growth_events(user_id, at DESC);
CREATE TABLE IF NOT EXISTS growth_checkins (user_id text PRIMARY KEY, last date NOT NULL DEFAULT current_date, streak integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS growth_badges (user_id text NOT NULL, code text NOT NULL, at bigint NOT NULL, PRIMARY KEY (user_id, code));
CREATE OR REPLACE FUNCTION growth_record(p_uid text, p_action text, p_quality boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r growth_rules%rowtype; used int; day_start bigint := extract(epoch from date_trunc('day', now()))::bigint*1000; new_id bigint;
BEGIN
  SELECT * INTO r FROM growth_rules WHERE action = p_action;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_rule'); END IF;
  IF r.quality_gate AND NOT p_quality THEN RETURN jsonb_build_object('ok', false, 'reason', 'quality'); END IF;
  IF r.daily_cap IS NOT NULL AND r.value > 0 THEN SELECT count(*)::int INTO used FROM growth_events WHERE user_id = p_uid AND action = p_action AND at >= day_start; IF used >= r.daily_cap THEN RETURN jsonb_build_object('ok', false, 'reason', 'cap'); END IF; END IF;
  INSERT INTO growth_events(user_id, action, at) VALUES (p_uid, p_action, extract(epoch from now())::bigint*1000) RETURNING id INTO new_id;
  RETURN jsonb_build_object('ok', true, 'id', new_id, 'value', r.value);
END;
$$;
CREATE OR REPLACE FUNCTION growth_checkin(p_uid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c growth_checkins%rowtype; new_streak int; today date := current_date; yest date := current_date - 1;
BEGIN
  SELECT * INTO c FROM growth_checkins WHERE user_id = p_uid;
  IF NOT FOUND THEN INSERT INTO growth_checkins(user_id, last, streak) VALUES (p_uid, today, 1); RETURN jsonb_build_object('ok', true, 'streak', 1); END IF;
  IF c.last = today THEN RETURN jsonb_build_object('ok', false, 'reason', 'already'); END IF;
  new_streak := CASE WHEN c.last = yest THEN c.streak + 1 ELSE 1 END;
  UPDATE growth_checkins SET last = today, streak = new_streak, updated_at = now() WHERE user_id = p_uid;
  RETURN jsonb_build_object('ok', true, 'streak', new_streak);
END;
$$;
CREATE OR REPLACE FUNCTION growth_state(p_uid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE ev jsonb; ck jsonb; bd jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'action', action, 'at', at)), '[]'::jsonb) INTO ev FROM (SELECT id, action, at FROM growth_events WHERE user_id = p_uid ORDER BY at DESC) t;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'at', at)), '[]'::jsonb) INTO bd FROM (SELECT code, at FROM growth_badges WHERE user_id = p_uid) t;
  SELECT jsonb_build_object('last', to_char(last, 'YYYY-M-D'), 'streak', streak) INTO ck FROM growth_checkins WHERE user_id = p_uid;
  RETURN jsonb_build_object('ok', true, 'events', ev, 'checkin', COALESCE(ck, jsonb_build_object('last','', 'streak',0)), 'badges', bd);
END;
$$;
CREATE TABLE IF NOT EXISTS mall_orders (id text PRIMARY KEY, user_id text NOT NULL, goods_id text, title text, emoji text, amount integer NOT NULL, qty integer NOT NULL DEFAULT 1, channel text, status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','awaiting_confirm','paid','done')), pay_channel text, proof jsonb, at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mall_orders_user ON mall_orders(user_id, at DESC);
CREATE OR REPLACE FUNCTION mall_confirm(p_order_id text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o mall_orders%rowtype;
BEGIN
  SELECT * INTO o FROM mall_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_order'); END IF;
  IF o.status <> 'awaiting_confirm' THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_status'); END IF;
  UPDATE mall_orders SET status = 'paid' WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'amount', o.amount);
END;
$$;
