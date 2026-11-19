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
| 7 | 详情页右栏 + 作者卡 | 详情单列；个人中心为表单页，无头图 / 头像 / 等级徽章 / 三列统计 / 内容列表 | **部分落地**（2026-11-19）：详情作者卡已接入共享 `Avatar`（40px）+ 昵称 + 本帖浏览 / 赞 / 回复 | 后端未暴露其他作者头像 / 等级 / 徽章 / 公开统计字段，`/growth/*` 为 requireAuth 自读；待后端公开作者档案接口与 `Profile.tsx` 重构后补齐等级 / 徽章 / 头像与三列统计 |
| 8 | 数字分页 + 加载更多 | 仅「加载更多」 | **已落地**（2026-11-19）：页长 20，页码窗口（≤7 全列，否则首末 + 邻页 + 省略号），按 offset 拉取；`GET /community/threads` 已返回 `total` 真分页计数，替换旧追加「加载更多」 | — |
| 9 | 头像 18/24/32/40 四档 + 角标槽 | 单尺寸圆形 | **已落地**（2026-11-19）：共享 `Avatar` 组件四档（18/24/32/40px）+ 右下角标槽，首字符兜底；详情作者卡已接入。顶栏 / 通知 / 评论项等既有头像渲染点待后续批次迁移到该组件 | — |
| 10 | 小号方标签 11px | 现标签偏胶囊 | **已落地**（2026-11-19）：`.tag-sm` 小号方标签挂到列表卡片板块名与首页精选卡 | — |
| 11 | 登录下划线输入 + 纯圆形社交按钮 | 输入为盒式；社交按钮带文字标签 | **已落地**（2026-11-19）：`.auth-form` 作用域内输入框透明底、仅底边、聚焦主色下划线，不改动全站共享 `.form input`；`.auth-card .oauth-btn` 改 44px 正圆钮，文字隐藏经 `aria-label` 供读屏，字母标同成圆形；Profile 绑定区不在作用域内、不受影响 | — |
| 12 | 首页独立 hero / 板块入口卡 / 精选卡 | 与社区页混排，无独立首页视图 | **已落地**（2026-11-19）：新增门户首页视图 `home`（hero + 三张入口卡 community/chat/account + 热门精选 6 帖）；根路径 / 未知路径回落由社区改为 `home`；「论坛设为首页」时仍由 App 内 effect 跳社区 | — |
| 13 | 右栏挂件：热门帖 / 板块导航 / 作者榜 | 右栏仅账号卡 + 站点信息 | **已落地**（2026-11-19）：社区双栏右栏三挂件 —— 热门帖（`sort=hot` 前 5）/ 板块导航（`/community/boards`）/ 作者榜（前端按点赞 + 回复聚合前 5，列表项无作者 ID，按昵称兜底）；独立 effect 拉取、卸载后拒绝回写、失败不阻断主列表 | 作者榜为前端侧口径；待后端公开作者聚合接口后替换 |

## 四、本轮不改项（边界）

- 不新增第三方 UI 库、不复制 PHP / jQuery / WP 授权校验代码；
- 不动版本号：本轮为外观与组件补齐，无新功能模块（铁律四）；
- 不改既有按钮 / 输入框类名与行为，只追加可选档位；
- 未跟踪草稿（`*.xlsx`、`新建 文本文档.txt`、`gw.txt`）保持原样，不纳入提交。

## 五、路线 2：独立 WordPress 站点（与 Mim 平行，不进本仓库运行时）

- 前提：独立 PHP-FPM + MySQL/MariaDB + WordPress 核心；主题目录放置 `wp-content/themes/zibll`，后台输授权码做域名绑定。
- **部署位置（2026-11-19 拍板）**：WP 站落裸域 **`laal.top`**，复用既有 WP（目录 `/var/www/bbs.laal.top`、库 `bbs_wp`、主题 `zibll` V9.2），不另建 `blog.laal.top`；与 Mim 主站 `zy.laal.top` / `api.laal.top` 按 `server_name` 精确分流，不与 Node 站点同进程混跑。
- **2026-11-19 主机实测**：SSH 通道可用，`root@115.159.159.11`（hostname `VM-0-13-ubuntu`）以本机私钥 `~/.ssh/mim_deploy_20261114` 直连成功；主机 PHP 8.1-FPM（socket `/run/php/php8.1-fpm.sock`）、MariaDB 10.6.23 active、nginx 1.18.0；泛域名证书 `/etc/letsencrypt/live/laal.top`（SAN `*.laal.top, laal.top`）覆盖裸域。
- **迁移取证（2026-11-19 23:51 +08）**：`https://laal.top/` 200 / 37276B（zibll 特征命中、9 件主题资源、零 http 混合内容），`/wp-login.php` 200、`/wp-json/` 200；`www.laal.top` 与 `bbs.laal.top` 均 301 → `https://laal.top/`；`zy.laal.top` 200、API healthz 200，Mim 未受影响；`nginx -t` ok 无重复 server_name 告警。库内旧域 `bbs.laal.top` 残留 0；备份 `/root/wp-bare-migrate-20261119-235028/`（conf + `bbs_wp.sql`）。
- **授权核验结论（迁移前只读探针）**：主题一致性 ✅（`stylesheet=template=zibll`，V9.2，与本地包同包）；**授权未激活 ❌**。探针反射 `ZibAut`：`is_aut=0`、`get_aut_time=false`、`get_aut_url='bbs.laal.top'`；选项表仅存 `zibll_code`（32 位已录入码），无授权结束时间 / 签名 / 激活记录选项；前台页脚仍渲染未激活提示。
- **激活入口与阻断点**：后台 AJAX `admin_curl_aut`（回调 `zib_admin_curl_aut`，仅 `wp_ajax_` 注册、无 `nopriv`）→ `ZibAut::curl_aut($code)`，需管理员会话 + nonce `zibll_theme_admin`；授权核心 `inc/code/code.php` / `update.php` 为加密防篡改文件。落点改为裸域后，站点域名与授权域名一致，**子域接受度风险已消除**；剩余唯一阻断：缺 `bbsadmin` 后台口令（仓库 / env 全量检索 0 命中，本机无该凭据）。主机 PHP 8.1 CLI 在位、无 wp-cli；SSH root 通道可用。
- 工具：`tools/quick-build-wp` 与兜底脚本 `deploy/wp-blog/install-blog.laal.top.sh` 保留为全新重建用途（自检 22/22 PASS、生成器 `node --test` 8/8）；本次生产走复用迁移路径，未执行该脚本。独立站点块工件 `deploy/wp-blog/laal-top-wp.conf`。
