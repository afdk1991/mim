-- 80-audit.sql —— 管理端审计留痕
-- 表结构沿用 ops 域既有 audit_logs；存量库缺 result 列，由 ALTER_ADD 补齐。
-- 本脚本不写 DROP / DELETE，可重复执行。

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,                       -- 审计主键（uuidv7）
  user_id      TEXT,                                   -- 操作人；引导令牌记 admin-bootstrap
  region       TEXT,                                   -- 操作人区域
  action       TEXT NOT NULL,                          -- 动作码，如 admin.user.role_grant
  target       TEXT,                                   -- 操作对象，格式 `类型:主键`
  request_id   TEXT,                                   -- 请求链路 ID
  payload      TEXT,                                   -- 已脱敏明细 JSON
  created_at   TEXT NOT NULL,                           -- 审计时间（UTC ISO-8601）
  result       TEXT NOT NULL DEFAULT 'success'          -- 结果：success / failure
);

-- 存量库补列：旧表没有 result，补上后新旧库同一结构
ALTER_ADD: audit_logs.result TEXT NOT NULL DEFAULT 'success'

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
