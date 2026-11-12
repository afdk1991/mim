-- 01-identity.sql —— 登录与身份包：跨站 SSO 票据 / 实名审核 / 邀请码与核销记录
-- 全部语句幂等（CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS），可重复执行。
-- 本包不写 DROP / DELETE；证件号与姓名一律不落明文，只存 HMAC 摘要与脱敏片段。

-- ---------- 跨站 SSO 一次性票据 ----------
-- 票据明文只在站点间跳转时出现一次，库内只存 sha256 摘要；consumed_at 非空即已兑换，防重放。
CREATE TABLE IF NOT EXISTS sso_tickets (
  ticket_hash  TEXT PRIMARY KEY,                        -- sha256(ticket)，回传时按摘要查找
  user_id      TEXT NOT NULL REFERENCES users(id),      -- 票据归属的正式用户（访客账号不可换 SSO 会话）
  site         TEXT NOT NULL,                           -- 目标站点标识（白名单内的 origin 或站点键）
  expires_at   TEXT NOT NULL,                            -- 过期时间（ISO-8601）
  consumed_at  TEXT,                                     -- 兑换时间，非空即一次性消费完成
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sso_tickets_expiry ON sso_tickets(expires_at);

-- ---------- 实名审核记录 ----------
-- name_hash / id_hash 为 HMAC-SHA256 摘要（密钥取 JWT/SSO 机密）；name_masked 为展示用脱敏名，
-- id_last4 只存证件号后四位；表内不存在任何可还原的姓名 / 证件号明文列。
CREATE TABLE IF NOT EXISTS realname_records (
  id            TEXT PRIMARY KEY,                        -- 记录主键（uuidv7）
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id), -- 一人一条；驳回后重新提交走同一行更新
  id_type       TEXT NOT NULL CHECK (id_type IN ('id_card','passport','other')), -- 证件类型
  name_hash     TEXT NOT NULL,                           -- 姓名 HMAC 摘要
  name_masked   TEXT NOT NULL DEFAULT '',                -- 脱敏展示名（如 张**），不含明文
  id_hash       TEXT NOT NULL,                           -- 证件号 HMAC 摘要
  id_last4      TEXT NOT NULL,                           -- 证件号后四位，仅用于核对展示
  provider      TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','third_party')), -- 审核通道：人工 / 第三方核验
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), -- 审核状态机
  reject_reason TEXT,                                    -- 驳回原因（rejected 时回填）
  reviewed_by   TEXT,                                    -- 审核操作人（管理端用户 ID）
  reviewed_at   TEXT,                                    -- 审核时间
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_realname_records_status ON realname_records(status);

-- ---------- 邀请码 ----------
-- 注册门槛开启（MIM_REGISTER_INVITE_REQUIRED=1）时，新账号必须凭有效邀请码注册。
-- max_uses 为可用次数，used_count 为已核销次数；核销与建号在同一事务内完成，并发下不超发。
CREATE TABLE IF NOT EXISTS invitations (
  id              TEXT PRIMARY KEY,                      -- 邀请码记录主键（uuidv7）
  code            TEXT NOT NULL UNIQUE,                 -- 邀请码明文（展示给受邀人；本包无明文证件级敏感信息）
  created_by      TEXT REFERENCES users(id),            -- 创建人；系统 / 管理员生成时可空
  max_uses        INTEGER NOT NULL DEFAULT 1,           -- 可用次数
  used_count      INTEGER NOT NULL DEFAULT 0,           -- 已核销次数
  expires_at      TEXT,                                  -- 有效期截止，NULL 表示长期有效
  bound_identifier TEXT,                                -- 可选绑定手机 / 邮箱归一化标识，仅该身份可核销
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','exhausted')), -- active/disabled/exhausted
  note            TEXT,                                 -- 备注（渠道、活动名等）
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status, expires_at);

-- ---------- 邀请码核销记录 ----------
-- 每次核销落一行，供管理端追溯；与 invitations 计数在同一事务内写入。
CREATE TABLE IF NOT EXISTS invitation_redemptions (
  id            TEXT PRIMARY KEY,                        -- 核销记录主键（uuidv7）
  invitation_id TEXT NOT NULL REFERENCES invitations(id), -- 被核销的邀请码
  user_id       TEXT NOT NULL REFERENCES users(id),      -- 注册成功的新用户
  identifier    TEXT,                                    -- 归一化注册标识（手机 / 邮箱），便于核对绑定关系
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_invite ON invitation_redemptions(invitation_id);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_user ON invitation_redemptions(user_id);
