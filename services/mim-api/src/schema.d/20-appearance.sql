-- 外观域：主题 / 导航 / 配色 / 页面区块的兜底结构与默认种子（2026-11-13）
-- 约束：仅 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / 幂等 INSERT OR IGNORE；
--       无 DROP / DELETE / 无条件 UPDATE；默认种子只在配置缺失时写入，不覆盖运营已编辑内容。
-- 边界：site_settings / page_blocks 主表在 schema.sql 已建，本脚本只补索引与兜底默认值。

-- 区块按页面、启停状态与排序检索：前台渲染器按 sort_order 升序消费。
CREATE INDEX IF NOT EXISTS idx_page_blocks_page_sort ON page_blocks(page, enabled, sort_order ASC);

-- 兜底默认主题：缺主题配置时前台回落这套外观（主色 / 背景 / 导航布局 / 列表样式 / 圆角 / 字体）。
-- 与 db.ts 种子同口径；INSERT OR IGNORE 保证重复启动与存量库都不会覆盖运营已改主题。
INSERT OR IGNORE INTO site_settings (key, value, updated_at)
VALUES (
  'theme',
  '{"accent":"#0f766e","background":"#f8fafc","nav_layout":"top","list_style":"card","radius":14,"font":"system-ui"}',
  '2026-11-13T00:00:00.000Z'
);

-- 兜底站点信息：品牌名 / 副标题 / 页脚，前台品牌区在配置缺失时回落。
INSERT OR IGNORE INTO site_settings (key, value, updated_at)
VALUES (
  'site',
  '{"title":"Mim","subtitle":"跨平台商业级项目","footer":"Mim · 开源与商业化并行"}',
  '2026-11-13T00:00:00.000Z'
);
