-- 成长私信：复用现有 IM 会话/消息表，新增系统会话标记、消息跳转字段与群发幂等台账。
-- im_conversations.system_kind：标记系统会话（普通私聊为 NULL，成长私信为 growth），
--   使系统会话在会话列表中走系统身份标题，并在前端隐藏通话等普通私聊操作。
ALTER_ADD: im_conversations.system_kind TEXT
-- im_messages.link_url / link_label：系统私信附带的跳转地址与按钮文案（普通消息为 NULL）。
ALTER_ADD: im_messages.link_url TEXT
ALTER_ADD: im_messages.link_label TEXT

-- 群发批次台账：dedupe_key 唯一约束承担「同一请求重复触发只发一次」的幂等语义。
CREATE TABLE IF NOT EXISTS growth_dm_campaigns (
  id            TEXT PRIMARY KEY,              -- 批次主键（uuidv7）
  dedupe_key    TEXT NOT NULL UNIQUE,          -- 幂等键：同一运营请求重复提交只会命中同一批次
  title         TEXT NOT NULL,                 -- 批次标题（仅后台展示与审计）
  body          TEXT NOT NULL,                 -- 私信正文
  link_url      TEXT,                          -- 跳转地址（可空）
  link_label    TEXT,                          -- 跳转按钮文案（可空）
  audience_json TEXT NOT NULL DEFAULT '{}',    -- 本次筛选条件的原始快照，便于复盘
  status        TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  target_count  INTEGER NOT NULL DEFAULT 0,    -- 命中的目标人数
  sent_count    INTEGER NOT NULL DEFAULT 0,    -- 实际投递成功人数
  skipped_count INTEGER NOT NULL DEFAULT 0,    -- 因重复投递等原因跳过的人数
  operator_id   TEXT,                          -- 发起人（管理员 ID；引导令牌为 admin-token）
  error_message TEXT,                          -- 失败原因（仅 failed 时有值）
  created_at    TEXT NOT NULL,                 -- 创建时间
  sent_at       TEXT                           -- 完成时间
);

-- 逐用户投递台账：(campaign_id, user_id) 主键保证同一批次对同一用户最多一条，
-- 即使筛选项重叠或重试也不会重复发信。
CREATE TABLE IF NOT EXISTS growth_dm_deliveries (
  campaign_id     TEXT NOT NULL,               -- 所属批次
  user_id         TEXT NOT NULL,               -- 目标用户
  conversation_id TEXT NOT NULL,               -- 落在哪个系统会话
  message_id      TEXT NOT NULL,               -- 实际写入的消息 ID
  created_at      TEXT NOT NULL,               -- 投递时间
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_growth_dm_deliveries_user ON growth_dm_deliveries (user_id);
