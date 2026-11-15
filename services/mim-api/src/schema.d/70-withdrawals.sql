-- 提现分成（钱包结算层）：
--   1) 钱包新增「可提现余额」独立列，与充值余额分开核算（口径见 commerce/withdrawal.ts 文件头）；
--   2) 提现申请 / 审核 / 到账记录表，金额一律整数分；
--   3) 同一用户同时只允许一笔处理中的申请（pending / approved），既防重复提交，也保证可用额度不被叠加占用。
-- 存量库由加载器先补列再执行其余语句；全新库同样走这条路径，结构完全一致。

ALTER_ADD: wallets.withdrawable_cents INTEGER NOT NULL DEFAULT 0

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid','cancelled')),
  method        TEXT NOT NULL CHECK (method IN ('alipay','wechat','bank')),
  account_name  TEXT NOT NULL,
  account_no    TEXT NOT NULL,
  review_note   TEXT NOT NULL DEFAULT '',
  reviewer      TEXT,
  payout_ref    TEXT,
  created_at    TEXT NOT NULL,
  reviewed_at   TEXT,
  paid_at       TEXT,
  updated_at    TEXT NOT NULL
);

-- 后台队列按状态 + 时间倒序分页；用户侧按 user_id 查自己的申请
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id, created_at DESC);

-- 处理中申请唯一：并发提交时由数据库兜底，重复插入直接冲突而不是产生两笔冻结
CREATE UNIQUE INDEX IF NOT EXISTS ux_withdrawal_requests_open ON withdrawal_requests(user_id) WHERE status IN ('pending','approved');
