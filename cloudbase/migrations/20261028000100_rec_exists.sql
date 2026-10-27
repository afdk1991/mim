-- P1-2 补丁：rec_feedback_get 增加 exists 标志，便于前端在「无云端记录」时
-- 保留本地负反馈（不反向覆盖），仅在确实存在云端记录时才以云端覆盖本地。
CREATE OR REPLACE FUNCTION rec_feedback_get(p_uid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE fb rec_feedback%rowtype;
BEGIN
  SELECT * INTO fb FROM rec_feedback WHERE user_id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'exists', false, 'authors', '[]'::jsonb, 'topics', '[]'::jsonb, 'city', '北京市');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'exists', true,
    'authors', COALESCE(fb.authors, '[]'::jsonb),
    'topics',  COALESCE(fb.topics, '[]'::jsonb),
    'city',    fb.city
  );
END;
$$;
