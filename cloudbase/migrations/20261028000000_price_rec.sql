-- P1 后端化增量迁移：价格行情快照 + 推荐负反馈真源
-- 依赖：20261027220449_wallet_growth_mall.sql（钱包/成长/商城原子函数）

-- ---------------------------------------------------------------------------
-- 价格行情快照（P1-1）
-- 由服务端 priceRefresh() 回源 CoinGecko 写入；前端只读快照，杜绝浏览器直连
-- 的 CORS / 限流 / 行情被篡改问题。定时采集（CloudBase 定时器）复用同一函数。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_quotes (
  coin_id    text PRIMARY KEY,
  price_cny  numeric(24,8) NOT NULL,
  change_24h numeric(12,4) NOT NULL DEFAULT 0,
  at         bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_quotes_at ON price_quotes (at DESC);

-- ---------------------------------------------------------------------------
-- 推荐负反馈 / 同城定位（P1-2）
-- 云端真源：用户在任一端「不感兴趣 / 屏蔽作者 / 切换城市」后，其它端自动一致。
-- authors / topics 为被屏蔽的作者名与话题数组；city 为当前同城定位。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rec_feedback (
  user_id text PRIMARY KEY,
  authors jsonb NOT NULL DEFAULT '[]'::jsonb,
  topics  jsonb NOT NULL DEFAULT '[]'::jsonb,
  city    text   NOT NULL DEFAULT '北京市',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_city ON rec_feedback (city);

CREATE OR REPLACE FUNCTION rec_feedback_get(p_uid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE fb rec_feedback%rowtype;
BEGIN
  SELECT * INTO fb FROM rec_feedback WHERE user_id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'authors', '[]'::jsonb, 'topics', '[]'::jsonb, 'city', '北京市');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'authors', COALESCE(fb.authors, '[]'::jsonb),
    'topics',  COALESCE(fb.topics, '[]'::jsonb),
    'city',    fb.city
  );
END;
$$;

CREATE OR REPLACE FUNCTION rec_feedback_save(p_uid text, p_authors jsonb, p_topics jsonb, p_city text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rec_feedback(user_id, authors, topics, city, updated_at)
  VALUES (
    p_uid,
    COALESCE(p_authors, '[]'::jsonb),
    COALESCE(p_topics, '[]'::jsonb),
    COALESCE(NULLIF(btrim(p_city), ''), '北京市'),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET authors = EXCLUDED.authors,
        topics  = EXCLUDED.topics,
        city    = EXCLUDED.city,
        updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;
