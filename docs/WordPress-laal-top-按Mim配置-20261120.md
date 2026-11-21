# WordPress（`https://laal.top`）按 Mim 口径配置 — 2026-11-20

> 背景：此前 `AGENTS.md` 把 `laal.top` 记为「同机另一套 WordPress（zibll 主题）、不作为 Mim、只读参照面」。用户本轮明确要求「整个 wp 根据项目来设置」，因此本文记录按 Mim 口径落地的实际改动。**站点仍不是 Mim 前端（Mim 前端为 `https://zy.laal.top`），也没有改成 Mim**，只是把它的标识、配色、命名、导航与安全默认值对齐到 Mim 品牌。

## 1. 已落地的设置（均在 wp-admin 内保存并回读核验）

### 1.1 站点标识（常规设置 / 阅读 / 站点图标）
| 项 | 原值 | 现值 |
|---|---|---|
| 站点标题 `blogname` | `laal 社区` | `Mim` |
| 副标题 `blogdescription` | 空 | `内容、社区与交易一体化 ｜ Mim` |
| 站点图标 `site_icon` | `0`（无） | 附件 `10`（`mim-icon-180.png`） |
| 搜索引擎索引 `blog_public` | 勾选「不索引」 | 放行索引 |

### 1.2 讨论（与 Mim 的匿名可读 / 登录后写入口径对齐）
- 关闭 pingback（`default_pingback_flag=0`）
- 评论需人工批准（`comment_moderation=1`）
- 评论必须注册并登录（`comment_registration=1`）

> `users_can_register` 保持关闭，与 Mim 的 `MIM_REGISTRATION_ENABLED`（只认 `1`、默认关闭）一致。

### 1.3 主题品牌（zibll 主题设置）
| 项 | 现值 |
|---|---|
| `favicon` / `iconpng` | `…/uploads/2026/11/mim-icon-180.png` |
| `logo_src` / `logo_src_dark` | `…/uploads/2026/11/mim-logo-512.png` |
| `hometitle` | `Mim — 内容、社区与交易一体化` |
| `keywords` | `Mim,社区,内容,商城,交易,圈子,漫剧` |
| `description` | Mim 平台一句话简介 |
| `theme_skin_custom` | `#3d8bff`（Mim 品牌蓝） |
| `dark_theme_skin_custom` | `#6c5ce7`（Mim 品牌靛紫） |
| `theme_mode` | `white-theme`（浅色默认，与 Mim 彩色浅色 UI 一致） |
| `theme_main_radius` | `12` |

> **踩坑**：zibll 的自定义主色字段对输入做 `substr(1)` 处理，必须带 `#`；写成 `3d8bff` 会被截成 `d8bff`，前台 `--theme-color` 变成非法值 `#d8bff`。改回 `#3d8bff` 后前台实测 `--theme-color:#3d8bff`。

### 1.4 命名与文案
| 项 | 原值 | 现值 |
|---|---|---|
| `bbs_forum_display_name` | `论坛` | `社区` |
| `bbs_plate_display_name` | `版块` | `圈子` |
| `bbs_plate_moderator_name` | `版主` | `圈主` |
| `bbs_cat_moderator_name` | `分区版主` | `分区管理员` |
| `mail_showname` / `mail_title_prefix` | `laal 社区` / `[laal 社区]` | `Mim` / `[Mim]` |
| `fcode_t2_code_2`（页脚版权） | `Copyright © 2026 · laal 社区 …` | `Copyright © 2026 · Mim · 内容、社区与交易一体化` |
| `fcode_t1_code`（页脚简介） | zibll 主题演示文案 | `Mim · 内容、社区与交易一体化平台。` |
| `footer_t1_t` | 空 | Mim 平台简介 |
| `footer_t1_img` / `footer_t1_img_dark` | 主题自带 logo | `mim-logo-512.png` |
| `system_notice_s` / `system_notice_content` | 开启且内容为子比主题推广 | 关闭并清空 |

### 1.5 导航菜单（外观 → 菜单）
新建菜单 **主导航**（`menu_id=2`），已绑定 `topmenu` 与 `mobilemenu` 两个位置，菜单项依次为：

1. 首页 → `https://laal.top/`
2. 社区 → `https://laal.top/forums/`
3. 登录/注册 → `https://laal.top/user-sign/`
4. 隐私政策 → `https://laal.top/privacy-policy/`

> 建设过程中曾重复生成一个「首页」项，已删除（`menu-item-16`），最终 4 项；前台顶部导航实测显示「首页 / 社区 / 登录/注册 / 隐私政策」。

### 1.6 第二轮「全部设置」补充项（2026-11-20 续）

| 项 | 现值 | 说明 |
|---|---|---|
| `layout_max_width` | `1200` | 与 Mim 前端 `--page-max:1200px` 一致（原 1250） |
| `search_placeholder` | `搜索社区帖子、圈子、商品` | 原「开启精彩搜索」 |
| `user_sign_type` | `page` | 登录由弹层改为独立页，对应 `/user-sign/` |
| `bbs_home_tab[plate][title]` | `圈子` | 社区首页 Tab 与「圈子」命名一致 |
| `footer_tabbar[0..4][text]` | `首页 / 社区 / 发布 / 消息 / 我的` | 手机底部 Tab |
| `footer_tabbar[1][link]` | `https://laal.top/forums/` | 原指向 `author/1` |
| 欢迎帖（`post-1`） | 标题 `欢迎来到 Mim：内容、社区与交易一体化`，正文改写为 Mim 定位 + 四条使用说明 + 账号规则 | 原为 WordPress 默认「世界，您好！」 |
| 文章分类 | 新增 `公告` / `产品更新` / `社区动态`，欢迎帖归入「公告」 | 原仅「未分类」 |

### 1.7 页脚二维码占位
zibll 页脚自带的「扫码加 QQ 群 / 扫码加微信」用的是主题演示二维码，无法通过开关（`footer_mini_img_m_s` 取 `0` / 空均仍渲染）隐藏，两处图片与文案已替换为 Mim 品牌图（`mim-logo-512.png`，标题 `Mim 社区` / `Mim 商城`）。页脚「联系方式」模块（`footer_contact_m_s`）已置空、演示 QQ / 微博 / 邮箱已清空。

## 2. 取证

- 前台标题：`Mim — 内容、社区与交易一体化`
- 前台 `<head>`：`<link rel="icon" href="…mim-icon-180-150x150.png">`、`apple-touch-icon` / `msapplication-TileImage` 均为 Mim 图标、`apple-mobile-web-app-title='Mim'`
- 前台 CSS 变量：`--theme-color:#3d8bff`、`--main-radius:12px`、`--mian-max-width:1200px`
- 顶部导航：`["首页","社区","登录/注册","隐私政策"]`
- 页脚图片：`["mim-logo-512.png","thumbnail-sm.svg","mim-logo-512.png","mim-logo-512.png"]`
- 欢迎帖分类：`公告`（后台 inline edit 回读）
- 截图：`wp-laal-top-final4.png`（仓库根目录；第二轮取景时浏览器截图接口报 `Could not retrieve RenderWidgetHostView`，未生成新图，前台 DOM 变量已按上列回读）

## 3. 未做（需用户拍板或客观前提）

1. **历史内容**：`示例页面`（`post=2`）与默认评论仍是演示内容，是否清空需用户确认（删除不可逆）；欢迎帖已改写为 Mim 文案，未删除任何文章。
2. **社区圈子（plate）尚未创建**：`社区圈子 → 创建新的圈子` 使用区块编辑器，本轮发布面板的「发布」按钮在无头环境反复不可见 / 浏览器执行通道超时（`GAC pipe read timed out`、`another page operation is already running`），未强行绕过。草稿 `post=27` 已生成但未发布，可后台一句话发布或由用户在 `/forums/` 前台创建。
3. **首页形态**：现为「最新文章」列表；要让首页直接呈现社区，需要把固定首页指向 `Forum Homepage`（`post=6`），该页模板未知，未擅自动手。
4. **商城入口**：zibll 商城（`product`）归档地址未探明（`/shop/`、`/products/`、`/mall/` 均 404），主导航暂不挂商城项。
5. **注册与登录方式**：站点注册保持关闭；如需与 Mim 的 Mim ID / 手机号 / 邮箱通道对齐，需要另配短信与邮件服务，未在无凭据情况下开启。
6. **`AGENTS.md` 旧口径**：已追加本轮覆盖段说明 `laal.top` 已按用户指令配置，不再是「禁止改动」的只读参照面；历史段落按铁律三保留。
## 4. 2026-11-20 深夜第三轮：遗留项收口（用户「全部实现落实」指令后执行）

> 本节为**新追加**，不修改上文任何历史结论；上文 §3「未做」1–4 项在本轮已全部处理，逐项结果见下。

| 项 | 本轮动作 | 回读取证 |
|---|---|---|
| 社区圈子（plate） | 草稿 `post=27`「综合讨论」用列表页**快速编辑**改状态 `draft → publish`（区块编辑器「发布」按钮在无头环境仍不可见，改走 inline-save，绕开编辑器） | 后台 `edit.php?post_type=plate`：`全部（1）` / `已发布（1）`，状态「已发布 2026-11-20 11:08」；前台 `/?index=3` 渲染圈子卡片「综合讨论」 |
| 首页形态 | `设置 → 阅读`：主页显示由「最新文章」改为「一个静态页面」，主页选 `Forum Homepage`（`show_on_front=page` / `page_on_front=6`） | 保存提示「设置已保存」；`https://laal.top/` 直接渲染 zibll 论坛首页（发布框 + 关注/综合/圈子/热门… Tab + 「内容空空如也」+ 创建圈子/发布帖子） |
| 商城归档 | 探明：商城 CPT 为 `shop_product`（后台菜单 `edit.php?post_type=shop_product`），zibll「实物商城」开关 `zibll_options[shop_s]=1` 已启用；但该 CPT **无公开归档**——同步 XHR 实测 `/shop/` `/shop-product/` `/shop_product/` `/product/` `/products/` `/mall/` `/store/` 均 404（刷新固定链接后仍 404）。zibll 官方口径为「新建一个页面作为商城首页，并把链接填入 `商城首页链接`（`zibll_options[shop_home_url]`）」 | 新建页面 `post=33` 标题「商城」、别名 `shop`、状态已发布，正文写入商城说明；`shop_home_url=https://laal.top/shop/` 保存后重新加载仍为该值；前台 `https://laal.top/shop/` 200，标题「商城-Mim」，正文可读 |
| 示例页面 | `post=2`（`Sample Page`）移至回收站 | 页面列表已不再出现「示例页面」 |
| 默认评论 | `comment-1`（「一位 WordPress 评论者」）移至回收站 | 评论列表「无评论。」，仪表盘评论计数 0 |
| 欢迎帖别名 | `post-1` 别名 `hello-world → welcome`（快速编辑） | 列表「查看」链接变为 `https://laal.top/welcome/` |
| 隐私政策页 | `post=3` 原为草稿（导航已挂 `/privacy-policy/` 但前台打不开）→ 快速编辑改为已发布 | 前台 `https://laal.top/privacy-policy/` 200，标题「隐私政策-Mim」；正文仍为 WordPress 默认隐私政策模板文本（含「推荐的文本：」提示句），**建议后续替换为 Mim 正式隐私政策正文** |

### 4.1 本轮暴露的真实缺陷：zibll 主题下后台内容编辑器不可用

- 现象：zibll 子比主题激活时，`post-new.php`（写文章 / 添加页面）与 `post.php?post=<id>&action=edit` 一律弹出「警告通知：您试图编辑一个不存在的项目。也许该项目已被删除？」，Gutenberg 画布不加载（`window.wp` 未定义、无 `editor-canvas` iframe）。
- 对照实验：同一 URL 在 **Twenty Twenty-Five** 下正常加载编辑器并可保存发布（商城页 `post=33` 的标题 / 别名 / 正文 / 发布即在该主题下完成）；切回 zibll 后前台与设置页均正常，仅编辑器坏。
- 结论：**不是权限、不是数据库、不是固定链接**，而是 zibll 主题与 WordPress 7.1.5 的后台编辑器兼容问题（主题在 admin 侧接管/改写了编辑页初始化）。
- 本轮处置：以「临时切默认主题 → 写入并发布 → 切回 zibll」的方式完成内容落地，未删除或改动 zibll 任何设置；切换窗口内前台短暂使用默认主题，已回切并回读确认（首页仍为 zibll 论坛首页、`/shop/` 为「商城-Mim」）。
- 待修（需服务器侧或主题升级）：把 zibll 升级到与 WP 7.1.5 兼容版本，或在服务器上定位 zibll 的 admin 钩子；修好之前，**后台新建/编辑文章与页面仍不可用**，只能用列表页「快速编辑」改标题 / 别名 / 状态。

### 4.2 截图取证（本轮截图接口已恢复）

| 文件 | 内容 |
|---|---|
| `wp-home.png` | 前台根路径 = zibll 论坛首页（发布框 + Tab + 「内容空空如也」+ 创建圈子/发布帖子 + Mim 页脚） |
| `wp-home-circles.png` | `/?index=3`：圈子 Tab 渲染「综合讨论」卡片（关注按钮 + 0 热度） |
| `wp-admin-plates.png` | 后台社区圈子列表：`全部（1）` / `已发布（1）`，`综合讨论` 已发布 2026-11-20 11:08 |

> 三张图为本轮真实浏览器截图；上一轮 `Could not retrieve RenderWidgetHostView` 的截图通道故障在本轮已消失。

## 5. 2026-11-21 第四轮：编辑器缺陷处置（升级无效 → 经典编辑器）+ 隐私政策正文 + 导航商城 + 首页标题

### 5.1 先把「升级」这条路走到底：已是最新版，升级修不了

- 后台 `zibll主题设置 → 文档&更新 → 检测更新` 回读原文：「**当前主题已经是最新版啦** / 当前主题版本：**V9.2** / 暂无更新，您当前的版本已是最新版」。即 2026-11-20 记录的「升级 zibll 到兼容 WP 7.1.5 的版本」**客观上没有可升的目标**，缺陷属 zibll V9.2 与 WordPress 7.1.5 的现行兼容 bug。
- 顺带取到的诊断证据（`post.php?post=3&action=edit` 白屏时）：
  - `typeof window.wp === "undefined"`、`wpApiSettings` 未定义、无 `iframe[name="editor-canvas"]`、无 `#content` —— Gutenberg 根本没初始化。
  - Console 出现多条 `Uncaught SyntaxError: Invalid or unexpected token`，其中两条来自页面内联脚本（`zib_admin_man_var` 段 6615 字符、`wp-api-fetch-js-after` 段 150944 字符）；核心包 `wp-includes/js/dist/api-fetch|element|data|block-editor|blocks.min.js` 实测均完整、纯 ASCII、尾部正常 —— 不是文件损坏，是内联脚本在该环境解析失败。
  - Gutenberg 的 REST 请求打到 `https://laal.top/wp/v2/types`、`/wp/v2/users/me` 等前缀（**6 条 404**），而正确前缀 `https://laal.top/wp-json/wp/v2/types` 实测 **200 / 6815B**；页面内 `createRootURLMiddleware` 注入的 root 却是 `https://laal.top/wp-json/`，两者不一致，说明路径在中途被改写。

### 5.2 处置：装 WordPress 官方「经典编辑器」恢复可编辑能力（可逆）

| 步骤 | 动作 | 回读结果 |
|---|---|---|
| 1 | 插件目录搜索 `classic editor`，安装「经典编辑器」（`classic-editor`） | 安装页出现「启用插件」链接 |
| 2 | 启用插件（`plugins.php?action=activate&plugin=classic-editor%2Fclassic-editor.php`） | 插件列表：`全部（3）\| 已启用（1）| 未启用（2）`，「经典编辑器 1.7.0」为已启用 |
| 3 | 重开 `post.php?post=3&action=edit` | `hasTinyMCE=true`、`hasGutenberg=false`、页面 3736px 有内容、**无「您试图编辑一个不存在的项目」提示** |

- 影响面：文章 / 页面 / 商品均改用经典编辑器编辑，前台渲染不变；zibll 的 Gutenberg 区块编辑体验暂不使用。
- 可逆：停用该插件即回到 Gutenberg（缺陷会原样复现）。若日后 zibll 修复该 bug，停用插件即可。
- 未改 zibll 任何设置、未改主题文件、未降级 WordPress。

### 5.3 隐私政策正文（`post=3`）

- 正文替换为 Mim 实际情况的中文草案，开头明确标注：`版本 2026-11-21 ｜ 本页为运营方草案，正式对外生效前建议经法务审核。`
- 九节结构：一、我们收集的信息（账号 / 内容 / 交易 / 设备与日志 / Cookie）；二、如何使用；三、共享、委托处理与公开（含「匿名可读、写操作需登录」口径）；四、保存期限与安全（HTTPS、口令哈希、最小权限）；五、你的权利；六、未成年人保护（不面向未满 14 周岁）；七、第三方链接；八、政策更新；九、联系我们。
- 前台取证：`https://laal.top/privacy-policy/` **200 / 52531B**；命中「版本 2026」「法务」「草案」「我们收集的信息」「第三方登录」「未成年人保护」；原模板句「推荐的文本：」「我们是谁」**已消失**；`<title>隐私政策-Mim</title>`。

### 5.4 主导航挂「商城」入口

- 方式：`nav-menus.php?action=edit&menu=2`（菜单「主导航」，绑定 topmenu / mobilemenu）→「自定义链接」面板 → URL `https://laal.top/shop/`、链接文字「商城」→ 添加（提示「已添加」，新项 `menu-item-40`）→ 保存菜单（`save_menu_header`）。
- 回读：重载后菜单项 **5** 条：首页 / 社区 / 登录/注册 / 隐私政策 / 商城（商城排在末尾）。
- 前台取证（抓 `https://laal.top/` 首页 HTML）：导航输出 `首页 → /`、`社区 → /forums/`、`登录/注册 → /user-sign/`、`隐私政策 → /privacy-policy/`、`商城 → /shop/`。

### 5.5 静态首页 `<title>` 补回副标题

- 静态首页（`page_on_front=6`）下 zibll 只输出 `bloginfo('name')`，故 `<title>` 只剩 `Mim`。
- 处置：在页面 `post=6` 的「独立SEO」元框（`#posts_seo`）写入 title `Mim — 内容、社区与交易一体化` 与 description，保存（提示「页面已更新」）。
- 前台取证：`<title>Mim — 内容、社区与交易一体化</title>`；`<meta name="description" content="Mim 是内容、社区与交易一体化的站点：社区帖子与圈子、图库与视频、商城与会员服务。">`。未改主题模板、未加钩子代码。

### 5.6 截图取证（第四轮）

| 文件 | 内容 |
|---|---|
| `wp-privacy-policy.png` | 前台 `/privacy-policy/`：新正文（版本 2026-11-21 / 待法务审核 / 一、我们收集的信息…），导航已含「商城」 |
| `wp-plugins.png` | 后台插件列表：经典编辑器 1.7.0 已启用（全部 3 / 已启用 1 / 未启用 2） |
| `wp-menu.png` | 后台菜单「主导航」：5 项含「商城」 |
| `wp-edit-post3.png` | （诊断留痕）经典编辑器启用前的白屏 + 「您试图编辑一个不存在的项目」提示 |
| `wp-zibll-options.png` | （诊断留痕）zibll 主题设置「全局&功能」面板 |

### 5.7 仍未做 / 待你定

- `shop_product` 仍为 0 商品：编辑器已恢复，可随时新建商品（需商品名、价格、图片、库存等资料）。
- 主导航「商城」排在末尾（首页 / 社区 / 登录/注册 / 隐私政策 / 商城），如需前移需再调一次排序。
- zibll 后台偶见未本地化的占位 key 直出（如菜单页 `admin_menu_pc_warning` / `admin_menu_mobile_hint`），属主题翻译缺失，不影响功能。
- Gutenberg 缺陷本身（内联脚本解析失败 + REST 前缀漂移）未在服务器侧定位，本机仍无 SSH 权限；当前以经典编辑器绕开。

### 5.8 2026-11-22：导航顺序调整（商城移到社区之后）+ i18n 占位 key 定性

- **导航顺序**：在菜单编辑页 `#menu-to-edit` 内把「商城」`li` 移到「社区」之后（DOM 顺序 首页 > 社区 > 商城 > 登录/注册 > 隐私政策），点「保存菜单」（`save_menu_header`）；重载后顺序保持。
- **前台取证**：抓 `https://laal.top/` 首页 HTML，四处导航链接出现位置依次为 `/forums/` 27173 之前 → `/forums/` **26990** → `/shop/` **27173** → `/user-sign/` **27354** → `/privacy-policy/` **27564**，即 社区 → 商城 → 登录注册 → 隐私政策。
- **占位 key 定性（第 3 项）**：菜单页实测 `typeof window.zib_admin_man_var === "undefined"`，页面直接显示 `admin_menu_pc_warning` / `admin_menu_mobile_hint` 原始 key。即 **zibll 的 i18n 内联脚本（`var zib_admin_man_var = {...}`）未成功执行**，主题 JS 在取不到翻译时回退显示 key —— 与 5.1 的 Gutenberg 白屏**同一根因**（内联脚本解析失败），不是翻译文件缺失，也不影响功能，无需单独修。
- **截图更新**：`wp-menu.png` 已用新顺序重拍（首页 / 社区 / 商城 / 登录注册 / 隐私政策，并可见上述两个占位 key）。
