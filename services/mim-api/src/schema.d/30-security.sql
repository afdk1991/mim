-- 安全加固与性能包（2026-11-13）：举报滑动窗口 / 验证码题目清理所需索引。
-- 幂等约定：全部 CREATE INDEX IF NOT EXISTS；本文件不含 DROP / DELETE / 无条件 UPDATE。

-- 举报按「用户 + 目标类型 + 目标 ID」做滑动窗口限频，复合索引避免回表扫描全量举报记录。
CREATE INDEX IF NOT EXISTS idx_content_reports_scope
  ON content_reports(reporter_id, target_type, target_id, created_at DESC);

-- 验证码题目批次清理：按创建时间辅助扫描过期 / 已消费题目（expires_at 已有单列索引）。
CREATE INDEX IF NOT EXISTS idx_captchas_created
  ON captchas(created_at);
