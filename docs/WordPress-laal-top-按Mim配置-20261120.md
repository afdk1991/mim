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

### 1.6 页脚二维码占位
zibll 页脚自带的「扫码加 QQ 群 / 扫码加微信」用的是主题演示二维码，无法通过开关（`footer_mini_img_m_s` 取 `0` / 空均仍渲染）隐藏，两处图片与文案已替换为 Mim 品牌图（`mim-logo-512.png`，标题 `Mim 社区` / `Mim 商城`）。页脚「联系方式」模块（`footer_contact_m_s`）已置空、演示 QQ / 微博 / 邮箱已清空。

## 2. 取证

- 前台标题：`Mim — 内容、社区与交易一体化`
- 前台 `<head>`：`<link rel="icon" href="…mim-icon-180-150x150.png">`、`apple-touch-icon` / `msapplication-TileImage` 均为 Mim 图标、`apple-mobile-web-app-title='Mim'`
- 前台 CSS 变量：`--theme-color:#3d8bff`、`--main-radius:12px`
- 顶部导航：`["首页","社区","登录/注册","隐私政策"]`
- 页脚图片：`["mim-logo-512.png","thumbnail-sm.svg","mim-logo-512.png","mim-logo-512.png"]`
- 截图：`wp-laal-top-final4.png`（仓库根目录）

## 3. 未做（需用户拍板或客观前提）

1. **内容仍是 WordPress 演示内容**：只有默认文章「世界，您好！」与「示例页面」。是否把历史内容重写/清空、是否新建 Mim 公告与社区帖，需用户确认（删除内容不可逆）。
2. **首页形态**：现为「最新文章」列表；要让首页直接呈现社区，需要把固定首页指向 `Forum Homepage` 页面（`post=6`），但该页由区块编辑器创建、模板未知，改动会影响站点结构，未擅自动手。
3. **商城入口**：zibll 商城（`product` 文章类型）归档地址未探明（`/shop/`、`/products/`、`/mall/` 均 404），因此主导航暂不挂商城项。
4. **注册与登录方式**：站点注册保持关闭；如需与 Mim 的 Mim ID / 手机号 / 邮箱通道对齐，需要另配短信与邮件服务，未在无凭据情况下开启。
5. **`AGENTS.md` 旧口径**：已追加本轮覆盖段说明 `laal.top` 已按用户指令配置，不再是「禁止改动」的只读参照面；历史段落按铁律三保留。
