/** 企业应用（5）+ 建站系统（9）+ 应用工具（4）三组共 18 条未绑定条目的起盘蓝图。 */
import { B, type ModuleBlueprint } from './types.js'; // 蓝图构造函数与类型

export const ENTERPRISE_STORE_BLUEPRINTS: readonly ModuleBlueprint[] = [ // 数组顺序：enterprise → store → tools
  // enterprise-01 任务/项目管理：看板表结构
  B('cat.enterprise-01', '任务/项目管理：看板三态（todo/doing/done）表结构与状态聚合查询。', 'SQL / REST', "-- 看板表结构\nCREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT);\nCREATE TABLE cards (id TEXT PRIMARY KEY, board_id TEXT, title TEXT, status TEXT CHECK (status IN ('todo','doing','done')), assignee_id TEXT, due_at TEXT);\n-- 视图：SELECT status, COUNT(*) FROM cards GROUP BY status;"),
  // enterprise-02 企业应用系统：多租户隔离
  B('cat.enterprise-02', '企业应用系统：多租户隔离方案——业务表带 tenant_id，查询层强制注入。', 'SQL / 多租户', "-- 租户与用户\nCREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);\nALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id);\n-- 每次查询强制：WHERE tenant_id = :current_tenant（缺注入即报错，不做默认放宽）"),
  // enterprise-03 BI：指标聚合 SQL
  B('cat.enterprise-03', 'BI 商业智能：近 30 天订单量与营收的按日聚合指标查询。', 'SQL / BI', "SELECT date(created_at) AS day, COUNT(*) AS orders, SUM(amount_minor) / 100.0 AS revenue\nFROM module_orders WHERE status = 'paid' AND created_at >= date('now', '-30 day')\nGROUP BY day ORDER BY day;"),
  // enterprise-04 财务/金融/股票证券：持仓收益
  B('cat.enterprise-04', '财务/金融/股票证券：持仓市值、浮动盈亏与盈亏比例的确定性计算口径。', 'Python / 金融数据', "# 持仓收益\nvalue = qty * price\npnl = value - cost\npnl_pct = pnl / cost * 100\n# 行情字段：symbol, name, price, prev_close, volume, market_cap"),
  // enterprise-05 GIS/地图/导航/定位：GeoJSON 点位
  B('cat.enterprise-05', 'GIS/地图/导航/定位：GeoJSON 点位集合 + 两点路线查询接口约定。', 'GeoJSON / 地图服务', "{ \"type\": \"FeatureCollection\", \"features\": [ { \"type\": \"Feature\", \"properties\": { \"name\": \"Mim 办公\" }, \"geometry\": { \"type\": \"Point\", \"coordinates\": [121.55, 29.87] } } ] }\n// 路线：GET /api/v1/route?from=29.87,121.55&to=29.90,121.60"),
  // store-01 CMS建站系统：内容模型与发布流
  B('cat.store-01', 'CMS 建站系统：文章内容模型与 draft→review→published 发布回滚流程。', 'CMS / 内容模型', "# 内容模型\ncontentType: article { title, slug, body(rich), cover, tags[], status }\n# 路由：/article/:slug 静态生成，sitemap 自动更新\n# 发布：draft → review → published，保留最近 5 个版本可回滚"),
  // store-02 新零售/网店/商城：商品订单模型
  B('cat.store-02', '新零售/网店/商城：商品、订单、订单行三表结构与金额最小单位口径。', 'SQL / 电商', "CREATE TABLE products (id TEXT PRIMARY KEY, title TEXT, price_minor INTEGER, stock INTEGER);\nCREATE TABLE orders (id TEXT PRIMARY KEY, total_minor INTEGER, status TEXT, created_at TEXT);\nCREATE TABLE order_items (order_id TEXT, product_id TEXT, qty INTEGER, unit_minor INTEGER, PRIMARY KEY (order_id, product_id));"),
  // store-03 BBS论坛/问答：帖子与采纳
  B('cat.store-03', 'BBS 论坛/问答：主题与回复表结构，含「采纳答案」标记字段。', 'SQL / 论坛', "CREATE TABLE topics (id TEXT PRIMARY KEY, title TEXT, body TEXT, author_id TEXT, created_at TEXT);\nCREATE TABLE replies (id TEXT PRIMARY KEY, topic_id TEXT, body TEXT, author_id TEXT, accepted INTEGER DEFAULT 0);\n-- 采纳：UPDATE replies SET accepted = 1 WHERE id = :id"),
  // store-04 博客系统：Hugo 站点配置
  B('cat.store-04', '博客系统：Hugo 站点配置与「新建-本地预览-构建」三步命令。', 'Hugo / Markdown', "# hugo.toml\ntitle = 'Mim Blog'\nbaseURL = 'https://mim.mixm.top/blog/'\ntheme = 'paper'\n[taxonomies]\n  tag = 'tags'\n# 新建：hugo new posts/hello.md → hugo server -D → hugo --minify"),
  // store-05 问卷调查/表单系统：表单 schema 与提交
  B('cat.store-05', '问卷调查/表单系统：表单 schema 定义、提交接口与统计口径（分布 + 均值 + 词频）。', 'JSON Schema / 表单', "const form = { id: 'nps-2026', fields: [ { key: 'score', type: 'rating', min: 1, max: 10, required: true }, { key: 'comment', type: 'textarea' } ] }\n// 提交：POST /api/v1/forms/nps-2026/submissions { answers: { score: 9 } }\n// 统计：分数分布 + 平均分 + 开放题词频"),
  // store-06 SNS社交系统：关注与时间线
  B('cat.store-06', 'SNS 社交系统：关注关系表与「关注者时间线」查询（倒序 50 条）。', 'SQL / 社交', "CREATE TABLE follows (follower_id TEXT, followee_id TEXT, PRIMARY KEY (follower_id, followee_id));\n-- 时间线\nSELECT p.* FROM posts p JOIN follows f ON f.followee_id = p.author_id\nWHERE f.follower_id = :me ORDER BY p.created_at DESC LIMIT 50;"),
  // store-07 学校/教学管理：排课与成绩
  B('cat.store-07', '学校/教学管理：课程、选课与成绩表结构，附班级均分查询。', 'SQL / 教务', "CREATE TABLE courses (id TEXT PRIMARY KEY, name TEXT, teacher_id TEXT, term TEXT);\nCREATE TABLE enrollments (course_id TEXT, student_id TEXT, score REAL, PRIMARY KEY (course_id, student_id));\n-- 班级均分：SELECT course_id, AVG(score) FROM enrollments GROUP BY course_id;"),
  // store-08 相册/画廊/照片：缩略图管线
  B('cat.store-08', '相册/画廊/照片：sharp 生成 320/1080 两档 WebP 缩略图并保留 EXIF 方向。', 'Node / sharp', "sharp(src).resize(320).webp({ quality: 72 }).toFile('thumb-320.webp')\nsharp(src).resize(1080).webp({ quality: 82 }).toFile('thumb-1080.webp')\n// 列表按拍摄时间倒序，原图单独放私有桶，缩略图走 CDN"),
  // store-09 RSS/Atom工具：feed 生成
  B('cat.store-09', 'RSS/Atom 工具：用 feed 库生成 RSS2 / Atom / JSON Feed 三种格式。', 'Node / feed', "import { Feed } from 'feed'\nconst feed = new Feed({ title: 'Mim 模块更新', id: 'https://mim.mixm.top/', link: 'https://mim.mixm.top/', updated: new Date() })\nfeed.addItem({ title: '新增 62 条能力', link: 'https://mim.mixm.top/marketplace', date: new Date(), description: '模块商城能力扩容' })\n// 输出：feed.rss2() / feed.atom1() / feed.json1()"),
  // tools-02 多媒体：ffmpeg 转码
  B('cat.tools-02', '多媒体：ffmpeg 转码、抽帧与音轨提取三条常用命令。', 'ffmpeg', "ffmpeg -i input.mov -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k -vf scale=1280:-2 output.mp4\n# 抽帧：ffmpeg -i input.mp4 -vf fps=1 frame-%03d.jpg\n# 提音轨：ffmpeg -i input.mp4 -vn -acodec copy audio.m4a"),
  // tools-04 IM即时通讯/聊天：WebSocket 帧协议
  B('cat.tools-04', 'IM 即时通讯/聊天：WebSocket 帧协议（send/ack/new/read/recall）与客户端接入。', 'WebSocket / JSON', "// 帧格式：{ id, type, payload }\n// 客户端→服务端：message.send { conversation_id, content_type, content }\n// 服务端→客户端：ack { message_id, ok } / message.new / typing / message.read / message.recall\nconst ws = new WebSocket('wss://mim.mixm.top/api/v1/im/ws')\nws.onmessage = (e) => { const f = JSON.parse(e.data); if (f.type === 'ack') console.log(f.id, f.payload?.message_id) }"),
  // tools-05 应用软件：Electron 桌面骨架
  B('cat.tools-05', '应用软件：Electron 主进程最小骨架与 Windows/macOS 双平台打包命令。', 'Electron / Node', "const { app, BrowserWindow } = require('electron')\napp.whenReady().then(() => new BrowserWindow({ width: 1200, height: 800 }).loadURL('https://mim.mixm.top'))\n// 打包：electron-builder --win nsis --mac dmg"),
  // tools-06 RPA：Playwright 流程
  B('cat.tools-06', 'RPA 机器人过程自动化：Playwright 登录、导出下载与本地落盘。', 'Python / Playwright', "from playwright.sync_api import sync_playwright\nwith sync_playwright() as p:\n    page = p.chromium.launch(headless=False).new_page()\n    page.goto('https://mim.mixm.top/signin')\n    page.fill('input[name=email]', 'ops@mim'); page.click('button[type=submit]')\n    page.goto('https://mim.mixm.top/settings')\n    page.expect_download().save_as('orders.csv')"),
]; // 企业/建站/工具蓝图结束：18 条
