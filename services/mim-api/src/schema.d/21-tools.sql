-- 自研工具发布域：工具清单 / 详情 / 版本记录 / 下载与文档链接 / 标签（2026-11-13）
-- 约束：仅 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / 幂等 INSERT OR IGNORE；
--       无 DROP / DELETE / 无条件 UPDATE；种子按稳定 slug 幂等，重复启动不覆盖运营已编辑内容。

-- ===== 一、自研工具 mim_tools =====
-- 公开列表只回 status='active'；草稿 / 归档仅管理端可见。版本记录与标签以 JSON 字符串落库。
CREATE TABLE IF NOT EXISTS mim_tools (
  id            TEXT PRIMARY KEY, -- 内部主键（与 slug 同值，便于外链与审计对齐）
  slug          TEXT NOT NULL UNIQUE, -- 对外短标识：详情页 /tools/:slug 使用
  name          TEXT NOT NULL, -- 工具名称
  summary       TEXT NOT NULL DEFAULT '', -- 一句话简介，列表卡片展示
  version_notes TEXT NOT NULL DEFAULT '[]', -- 版本记录：JSON 数组 [{version, title, notes, released_at}]
  download_url  TEXT NOT NULL DEFAULT '', -- 下载地址（站内相对路径或外链）
  doc_url       TEXT NOT NULL DEFAULT '', -- 文档地址（站内相对路径或外链）
  tags          TEXT NOT NULL DEFAULT '[]', -- 标签：JSON 字符串数组
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  sort_order    INTEGER NOT NULL DEFAULT 100, -- 展示顺序，数字越小越靠前
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mim_tools_public ON mim_tools(status, sort_order ASC, created_at DESC);

-- ===== 二、幂等种子（INSERT OR IGNORE：重复启动不覆盖运营已编辑内容）=====
-- 三条首发自研工具：WordPress 快速搭建、数据库批量替换 / 换域名、流盾 WAF。
INSERT OR IGNORE INTO mim_tools (id, slug, name, summary, version_notes, download_url, doc_url, tags, status, sort_order, created_at, updated_at)
VALUES
  (
    'tool-quick-build-wp',
    'quick-build-wp',
    'Quick Build WP',
    'WordPress 一键快速搭建插件：环境自检、主题与常用套件向导式安装，新手也能在几分钟内拉起可用站点。',
    '[{"version":"1.0.0","title":"首发版本","notes":"环境自检 + 主题向导安装 + 常用套件一键启用","released_at":"2026-11-10T00:00:00.000Z"}]',
    '/tools/quick-build-wp/download',
    '/docs/quick-build-wp',
    '["wordpress","建站","插件"]',
    'active',
    10,
    '2026-11-10T00:00:00.000Z',
    '2026-11-10T00:00:00.000Z'
  ),
  (
    'tool-db-replace-domain',
    'db-replace-domain',
    '数据库批量替换 / 换域名插件',
    'MySQL 数据库批量查找替换，安全处理序列化数据与 JSON 字段，支持站点域名一键更换与替换前备份。',
    '[{"version":"2.1.0","title":"换域名向导","notes":"修复序列化 JSON 替换边界；新增换域名向导与替换前备份","released_at":"2026-11-08T00:00:00.000Z"}]',
    '/tools/db-replace-domain/download',
    '/docs/db-replace-domain',
    '["database","wordpress","迁移"]',
    'active',
    20,
    '2026-11-08T00:00:00.000Z',
    '2026-11-08T00:00:00.000Z'
  ),
  (
    'tool-liudun-waf',
    'liudun-waf',
    '流盾 WAF',
    'Web 应用防火墙：恶意请求拦截、规则白名单与攻击日志查看，为站点入口提供基础防护。',
    '[{"version":"0.9.2","title":"Beta 公测","notes":"基础规则集 + 访问日志 + 白名单配置","released_at":"2026-11-05T00:00:00.000Z"}]',
    '/tools/liudun-waf/download',
    '/docs/liudun-waf',
    '["waf","安全","防护"]',
    'active',
    30,
    '2026-11-05T00:00:00.000Z',
    '2026-11-05T00:00:00.000Z'
  );
