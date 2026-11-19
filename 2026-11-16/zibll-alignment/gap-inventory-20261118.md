# Zibll V9.2 → apps/web 对齐缺口清单（2026-11-18）

> 上游映射：[`structure-map.md`](./structure-map.md)（2026-11-16 立）。
> 素材：`E:\迅雷下载\zibll-V9.2(1651)\zibll`（WordPress 主题包，**不做运行时移植**）。
> 原则不变：只学结构、样式与交互；不引入 PHP / jQuery / WP 钩子 / 授权校验；品牌蓝与全彩体系保留。

## 一、取证基线（本轮实测）

| 项 | 实测结果 | 取证 |
| --- | --- | --- |
| 素材性质 | WordPress 子比主题 V9.2：Requires WP ≥5.0、PHP 7.0–8.5；848 个 `.php`、31.7MB；`functions.php` 调用 `get_theme_file_path()`，`zib-author.php` 依赖 `$wp_query` / `add_filter` / `apply_filters` / `is_super_admin` | 本地包 `style.css` 头部、`functions.php`、`inc/functions/zib-author.php` |
| Mim 栈 | Node/TS monorepo：`@mim/api` Express + better-sqlite3；`apps/web` Vite + React；仓库内 **0 个 `.php`、0 个 WP 核心文件**；本机无 `php` 命令 | 根 `package.json` `mim@0.0.12`；`services/mim-api/package.json` 依赖清单；递归扫描 |
| 已复用素材 | `apps/web/public/zib/`：图标字体 4 个 + 空态 / 缩略图 / 头像 / VIP / 等级 / 消息分类 SVG·PNG 共 40 余件 | `apps/web/public/zib/` 目录清单 |
| 已接线素材 | `avatar-default.png`（`Shell.tsx`）；空态 `null-*.svg` 经 `EmptyState` 接 25 处 / 9 视图；`msg-*.svg` 接通知类别徽章；`vip-1/vip-2.svg` 接社区 VIP 胶囊等级徽章。缩略图占位、`user-level-*.png` 等级图、草稿/待审徽章仍已复制未接线 | 全仓 `zib/img` / `zib/fonts` 引用检索 |
| 授权边界 | 授权码 + 域名验证，绑 `laal.top`，有效期至 2026-12-16 24:00；授权码全仓 0 命中，未入库；不移植授权校验代码 | 全仓检索授权码；映射文档第五节 |

## 二、已落地项（无需返工）

| 映射项 | 现状 | 落点 |
| --- | --- | --- |
| 外壳：吸顶横导航 + 1200px 两栏 + 多列页脚 + 移动端底 Tab | 已落地，滚动阴影 / 毛玻璃 / 右栏挂件齐备 | `Shell.tsx`、`styles.css` 外壳段 |
| 设计令牌：8px 圆角、弥散阴影、字号 / 节奏阶梯、明暗双套派生 | 已落地并由 `appearance.ts` 运行期覆写 | `tokens.css`、`appearance.ts` |
| 社区页头：kicker + 标题 + 描述 + 四格统计 + 两组页签 + chips 筛选 | 已落地 | `Community.tsx` `community-hero` / `community-tabs` / `community-chips` |
| 第三方登录按钮行：已配置提供方等宽排列 + 字母标 + 忙碌徽标 | 已落地 | `Login.tsx` `oauth-grid` / `oauth-btn` |
| 登录内嵌左引导区：价值清单 + 安全说明卡 | 已落地 | `Login.tsx` `auth-intro` / `auth-extras` |
| 通知类别徽章图标：reply / accept / like / favorite / report 映射 `msg-*.svg` | 已落地（2026-11-19）：铃铛列表类别 chip 前置 16px 圆形徽章，未知类别回退系统图标 | `CommunityMore.tsx` `NOTIFY_ICON` / `.mim-cm-notify-icon` |
| VIP 等级徽章：`vip-1.svg`（金）/ `vip-2.svg`（紫） | 已落地（2026-11-19）：社区 VIP 胶囊已开通时前置 16px 徽章，等级 ≥2 取紫色 vip-2，其余金色 vip-1；未开通不渲染 | `Community.tsx` `vipBadge` / `.community-vip-badge` |
| 登录下划线输入 + 纯圆形社交按钮 | 已落地（2026-11-19）：`.auth-form` 作用域下划线输入；`.auth-card .oauth-btn` 44px 正圆、文字隐藏 + `aria-label` | `Login.tsx` `auth-form` / `oauth-name`；`styles.css` 登录作用域变体段 |
| 社区列表横排形态 + 三分栏锁宽 | 已落地（2026-11-19）：工具栏网格/列表切换并 `localStorage` 持久化；列表态左图 190px 右文横排；网格态三分栏锁宽，中屏两列、手机单列 | `Community.tsx` `threadLayout` / `community-layout-toggle`；`styles.css` `.community-list.is-grid/.is-list` |

## 三、缺口清单与分批归属

| # | 映射项 | 现状缺口 | 本轮（批次 2026-11-18） | 延期 / 前置依赖 |
| --- | --- | --- | --- | --- |
| 1 | 空态插图：null-*.svg 接入各空态面 | 9 个视图共 29 处 `.community-empty` / 同类空态均为纯文字；素材闲置 | 批次 2026-11-18：新增 `EmptyState` 共享组件，先接社区页 8 处。批次 2026-11-19：再接 Circles / ContentDetail / AnnouncementsPanel / CommunityGallery / CommunityAssets / MyAssets / CommunityMore 共 14 处。同日补接 Chat 视图 3 处（用户搜索无结果 / 会话列表空 / 消息区空），并清理不再使用的 `.chat-empty` 样式 | **已清零**：`EmptyState` 累计 25 处 / 9 个视图；剩余外观缺口见 #2–#13 |
| 2 | 卡片标题等高 | 标题两行截断但未锁最小高度，摘要长短不齐时标题基线错落 | **已落地**：`community-card h3` `min-height: 2.8em` + 两行 clamp | — |
| 3 | 卡片悬停反馈 | 仅阴影加深，卡片不抬升；封面已有 1.02 缩放 | **已落地**：卡片 hover `translateY(-2px)`，过渡集合纳入 transform；封面 1.02 缩放保留 | — |
| 4 | 按钮四档层级 | 现有 primary / danger / ghost / small / block；缺描边档 `outline` 与药丸档 `pill` | **样式已落地**：`.btn.outline` / `.btn.pill` 两个纯样式档位已补，既有按钮不改类名 | 各页按需换用，下一批按场景落位 |
| 5 | 列表横排形态（左图 190px + 右文三行） | 现仅上图下文网格 | **已落地**（2026-11-19）：工具栏加网格/列表切换（`localStorage` 持久化，默认网格）；列表态卡片改左图 190px + 右文横排，标题 18px 档，窄屏封面收 120px；后端排序口径未改动 | — |
| 6 | 卡片三分栏锁宽 + 标题等高 | 网格 `auto-fill minmax(300px,1fr)`，未锁三分栏 | **已落地**（2026-11-19）：网格态 `repeat(3, minmax(0,1fr))` 三等分栏，≤1024px 回落两列、≤640px 单列；标题等高沿用既有 `min-height: 2.8em` | — |
| 7 | 详情页右栏 + 作者卡 | 详情单列；个人中心为表单页，无头图 / 头像 / 等级徽章 / 三列统计 / 内容列表 | — | 依赖后端资料字段（等级 / 徽章 / 统计）与 `Profile.tsx` 重构，单列一批 |
| 8 | 数字分页 + 加载更多 | 仅「加载更多」 | — | 依赖后端分页游标 / 总页数口径确认 |
| 9 | 头像 18/24/32/40 四档 + 角标槽 | 单尺寸圆形 | — | 随作者卡 / 评论项一批落地 |
| 10 | 小号方标签 11px | 现标签偏胶囊 | — | 随列表项 / 徽章一批调 |
| 11 | 登录下划线输入 + 纯圆形社交按钮 | 输入为盒式；社交按钮带文字标签 | **已落地**（2026-11-19）：`.auth-form` 作用域内输入框透明底、仅底边、聚焦主色下划线，不改动全站共享 `.form input`；`.auth-card .oauth-btn` 改 44px 正圆钮，文字隐藏经 `aria-label` 供读屏，字母标同成圆形；Profile 绑定区不在作用域内、不受影响 | — |
| 12 | 首页独立 hero / 板块入口卡 / 精选卡 | 与社区页混排，无独立首页视图 | — | 需产品确认首页信息架构（现行根路径回落社区） |
| 13 | 右栏挂件：热门帖 / 板块导航 / 作者榜 | 右栏仅账号卡 + 站点信息 | — | 依赖聚合接口数据 |

## 四、本轮不改项（边界）

- 不新增第三方 UI 库、不复制 PHP / jQuery / WP 授权校验代码；
- 不动版本号：本轮为外观与组件补齐，无新功能模块（铁律四）；
- 不改既有按钮 / 输入框类名与行为，只追加可选档位；
- 未跟踪草稿（`*.xlsx`、`新建 文本文档.txt`、`gw.txt`）保持原样，不纳入提交。

## 五、路线 2：独立 WordPress 站点（与 Mim 平行，不进本仓库运行时）

- 前提：独立 PHP-FPM 8.2 + MySQL/MariaDB + WordPress 核心；主题目录放置 `wp-content/themes/zibll`，后台输授权码做域名绑定。
- 部署位置：`zy.laal.top` 现已是 Mim 生产唯一权威终点（`/` 前端、`/admin/` 后台、`api.laal.top` API）；WP 站建议用子域名（如 `blog.laal.top`）独立 `server_name` 分流，不与 Node 站点同进程混跑。
- 现状约束：`deploy/nginx-mim.conf` 明确 `blog.laal.top` 无实现、保持 NXDOMAIN；本机无 SSH 私钥，主机侧安装动作只能经 CI secrets（`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY`）通道执行。
- 待核实：子域名是否被授权校验接受为 `laal.top` 授权范围；2026-12-16 到期后授权与在线更新状态。
- 工具：`tools/quick-build-wp` 可生成幂等建站脚本（PHP 8.2 + MySQL + WP latest + nginx 伪静态 + 可选 SSL）；`--coexist` 模式按同机共存口径生成站点块（复用既有 Nginx、精确 `server_name`、80 301、FPM socket、复用泛域名证书变量、不抢占默认站点），自检 22/22 PASS。
