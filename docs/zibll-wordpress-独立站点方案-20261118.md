# Zibll 子比主题独立 WordPress 站点方案（2026-11-18 立，2026-11-19 落裸域）

> 配套：前端外观对齐缺口清单 [`../2026-11-16/zibll-alignment/gap-inventory-20261118.md`](../2026-11-16/zibll-alignment/gap-inventory-20261118.md)；建站脚本生成器 [`../tools/quick-build-wp`](../tools/quick-build-wp)。

## 一、结论与边界

- `E:\迅雷下载\zibll-V9.2(1651)\zibll` 是一套 **WordPress 主题**（Requires WP ≥5.0、PHP 7.0–8.5，848 个 PHP 文件），运行前提是 PHP + WordPress 核心 + MySQL；Mim 仓库是 Node/TypeScript + Express + SQLite 的 Vite/React monorepo，仓库内 0 个 `.php`、0 个 WP 核心文件，**主题不能装进 Mim 运行时，也不能把 PHP 源码剥离进 Node 工程**。
- 可行路径是**另起一套与 Mim 平行的 WordPress 站点**：独立 PHP-FPM + MySQL + WP 核心，子比主题作为 WP 主题安装；两套系统进程、数据库、目录完全隔离，互不混入对方仓库。
- **落点决策（2026-11-19 用户拍板）**：WP 站落在裸域 **`laal.top`**（授权域名本体），复用主机既有 WP（目录 `/var/www/bbs.laal.top`、库 `bbs_wp`、主题 `zibll` V9.2），**不另建** `blog.laal.top` 共存站。
- 授权口径：授权码 + 域名验证，绑 `laal.top`；**2026-11-20 已激活闭环**（探针 `is_aut=1`，授权服务器回写到期 **2026-12-16 16:00:00**）。授权码只存 WP 库与主机侧凭证文件，**不写入 Mim 仓库、不进任何公开远端**；主题 PHP 源码不 vendor 进 Node 工程。

## 二、架构分流（生产 CVM：115.159.159.11，与 MixmAPP / Mim 同机共存）

| 入口 | 归属 | 运行时 | 数据 |
| --- | --- | --- | --- |
| `zy.laal.top` `/`、`/admin/` | Mim 用户端 + 管理后台（现状不变） | 静态产物 + systemd `mim-api`（Node，127.0.0.1:8787） | SQLite WAL |
| `api.laal.top` | Mim API 网关（现状不变） | 反代 `mim-api` | SQLite WAL |
| `laal.top`（canonical） | 独立 WordPress + 子比主题 | PHP 8.1-FPM（socket `/run/php/php8.1-fpm.sock`）+ nginx 站点块 | MySQL 库 `bbs_wp` |
| `www.laal.top` | 301 规范化到 `https://laal.top/` | nginx 跳转块 | — |
| `bbs.laal.top` | 旧 WP 域名，301 规范化到 `https://laal.top/` | nginx 跳转块（保留既有独立证书做握手） | — |

- WP 站只占 `laal.top` 一个独立 `server_name`，**不写 `default_server`**，不吸收未登记主机名；与 Mim 既有 nginx 共存约定一致（见 `deploy/nginx-mim.conf` 文件头注释）。
- Mim 的 CI 生产发布作业（`.github/workflows/deploy.yml` → `deploy/deploy.sh`）**只重装 `mim.conf`，不触碰** WP 独立站点块；WP 站的安装与后续更新走独立脚本 / WP 后台，避免 PHP 栈污染 Mim 发布链路。

## 三、部署物清单

| 物 | 路径 | 说明 |
| --- | --- | --- |
| 裸域 WP nginx 站点块（入库） | `deploy/wp-blog/laal-top-wp.conf` | 独立于 `mim.conf`：80 裸域/www → 301 HTTPS 裸域；443 www → 301 裸域；443 裸域 `root /var/www/bbs.laal.top` + PHP 8.1-FPM socket + WP 伪静态 + 上传目录禁 PHP / 配置文件拒访；复用泛域名证书，不抢占默认站点 |
| 兜底建站脚本（生成器产出，未在本次生产执行） | `deploy/wp-blog/install-blog.laal.top.sh` | 幂等 bash：环境自检 → 确认既有 Nginx → MySQL → PHP 8.1-FPM → 建库建账号 → 下载 WP → 共存站点 nginx 块 → 可选 SSL；`--dry-run`；自检 22/22 PASS。仅作为全新重建兜底，本次生产走复用迁移路径 |
| 生成器 | `tools/quick-build-wp` | 纯 Node 内置模块零依赖；`node --test` 8/8 通过；`--coexist` 模式复用既有 Nginx / FPM socket / 泛域名证书变量 |
| 主题包（本地，不入库） | `E:\迅雷下载\zibll-V9.2(1651)\zibll` | 已在主机 `<WP_ROOT>/wp-content/themes/zibll`，1480 文件 Version 9.2 |

## 四、2026-11-19 裸域迁移取证（已执行）

### 4.1 迁移前只读核查

- DNS：`laal.top`、`www.laal.top`、`bbs.laal.top`、`zy.laal.top`、`api.laal.top` 均解析 `115.159.159.11`；裸域无需新增 DNS 记录。
- 证书：泛域名 `/etc/letsencrypt/live/laal.top` SAN `DNS:*.laal.top, DNS:laal.top`，覆盖裸域，有效期至 2027-02-12；既有 `bbs.laal.top` 独立证书有效期至 2027-02-16。
- WP 配置：`wp-config.php` 无 `WP_HOME` / `WP_SITEURL` 硬编码，站点 URL 只存库；表前缀 `wp_`；库 `bbs_wp`；4 篇 publish + 1 草稿；无启用插件；`uploads` 属主 `www-data:www-data`。
- 库内旧域名引用（迁移前）：`posts.post_content` 0、`posts.guid` 2、`postmeta` 0、`options` 1（即 `siteurl` 自身）。

### 4.2 变更项（均有备份，可回滚）

1. 备份目录 `/root/wp-bare-migrate-20261119-235028/`：`mim.conf`、`bbs.laal.top.conf`、`bbs_wp.sql`（412 行 dump）。
2. 安装独立站点块 `laal-top-wp.conf`（available + enabled 软链）。
3. 摘除 `mim.conf` 尾部两个 retired-hosts 410 块；仓库模板 `deploy/nginx-mim.conf` 同步删除，避免下次 CI 重装 `mim.conf` 把 410 带回裸域。
4. `bbs.laal.top.conf` 两个 server 块改为 301 → `https://laal.top$request_uri`。
5. 库更新：`wp_options.siteurl` / `home` = `https://laal.top`；`wp_posts.guid` 中 `https://bbs.laal.top` 替换为 `https://laal.top`（相对 `/?p=` 形式 guid 不动）。

### 4.3 迁移后线上探测（本机公网，2026-11-19 23:51 +08）

| 入口 | 结果 |
| --- | --- |
| `https://laal.top/` | **200**，37276B，zibll 主题特征命中，9 件 zibll css/js 资源，`http://` 混合资源 0 |
| `https://laal.top/wp-login.php` | **200**，6149B |
| `https://laal.top/wp-json/` | **200**，213961B |
| `https://www.laal.top/` | **301** → `https://laal.top/` |
| `https://bbs.laal.top/` | **301** → `https://laal.top/` |
| `https://zy.laal.top/` | **200**，3873B（Mim SPA，未受影响） |
| `https://api.laal.top/api/v1/healthz` | **200**，15B |

- `nginx -t` syntax ok；nginx journal 无 conflict / duplicate server_name 告警。
- 库内 `bbs.laal.top` 残留：选项 0；首页 HTML 旧域名出现 0 次。

### 4.4 授权核验与激活取证

**迁移前只读探针（2026-11-19 基线，历史留痕）**

- 主题一致性 ✅：`stylesheet=template=zibll`，V9.2，与本地包同包。
- **授权未激活 ❌（基线）**：探针反射 `ZibAut`：`is_aut=0`、`get_aut_time=false`、`get_aut_url='bbs.laal.top'`（迁移前取值）；选项表仅存 `zibll_code`（32 位已录入码），无授权结束时间 / 签名 / 激活记录选项；前台页脚仍渲染未激活提示（tooltip「完成主题授权后，此处内容会自动消失」+ 红色「购买正版授权」按钮，激活后该提示消失）。
- 激活入口：后台 AJAX `admin_curl_aut`（回调 `zib_admin_curl_aut`，仅 `wp_ajax_` 注册、无 `nopriv`）→ `ZibAut::curl_aut($code)`，需管理员会话 + nonce `zibll_theme_admin`；授权核心 `inc/code/code.php` / `update.php` 为加密防篡改文件。

**激活执行（2026-11-20，合法后台会话流程）**

- 凭据复核：主机根目录凭证文件 `/root/.bbs-wp-credentials` 留存安装时原始 `ADMIN_PASS`，PHP `wp_check_password()` 与库内 `bbsadmin` 哈希比对 **match=YES**；**未重置 WP 管理员口令**，生产凭证原值不变。库内仅 `bbsadmin` 一个管理员（ID 1，`administrator`），激活前无残留会话令牌。
- 流程：服务器侧以真实 `wp-login.php` 登录拿到登录态 cookie → 拉取后台主题设置页 `admin.php?page=zibll_options` 解析页面内 nonce `zibll_theme_admin` → 带 `X-Requested-With: XMLHttpRequest` 与 Referer 向 `admin-ajax.php` 提交 `action=admin_curl_aut` + `aut_code` + `_wpnonce`。**未绕过后台 AJAX guard、未直调加密类方法、未改动任何加密主题文件**；授权码取自库内 `zibll_code`，全程不回显、不入库、不入文档 / 脚本 / secrets。
- 握手结果：AJAX 返回 `{"error":0,"reload":true,"msg":"恭喜您，授权验证成功"}`；PHP 引导复核 `is_aut=1`、`get_aut_time='2026-12-16 16:00:00'`；库内新增激活记录选项 `post_autkey`（含激活时间戳）。
- 前台复核（2026-11-20 公网）：`https://laal.top/` 200，页脚「购买正版授权」未激活标记 **0 处**；激活后本次脚本登录留下的 1 条 `session_tokens` 已用 `WP_Session_Tokens::destroy_all()` 回收（sessions 1 → 0），复核 `is_aut=1` 保持不变。

## 五、服务器侧后续步骤（2026-11-20 已闭环）

1. **进入后台**：✅ 已完成。复用主机凭证文件留存的原始 `bbsadmin` 口令（`wp_check_password` 比对通过），未重置口令；服务器侧走真实 `wp-login.php` 登录态。
2. **提交授权码**：✅ 已完成。后台主题设置页取 nonce 后经 `admin-ajax.php` 的 `admin_curl_aut` 提交，官方授权服务器域名验证通过，返回「授权验证成功」。
3. **复核取证**：✅ 已完成。探针 `is_aut=1`、授权结束时间 `2026-12-16 16:00:00` 落库、激活记录选项 `post_autkey` 写入；前台页脚未激活提示与「购买正版授权」按钮消失；脚本登录会话令牌已回收。
4. **互测不串站**：✅ 保持。`zy.laal.top` 仍回 Mim SPA，`api.laal.top` 仍回 Mim API；WP 站不暴露 Mim 的 `/api/v1/*` 路径。

## 六、合规与到期风险

- **到期时间**：授权 2026-12-16 16:00:00 到期（授权服务器激活时回写值）；到期后主题在线更新、授权校验相关功能可能受限，需在到期前续费或评估停用主题的影响。
- **授权码保管**：只存在于 WP 后台授权状态与服务器侧环境，不提交 git、不写进 CI secrets 明文日志；仓库检索授权码当前 0 命中。
- **素材复用边界**：已复制进 `apps/web/public/zib/` 的静态素材（字体 / SVG / 头像 / 角标）按正版授权域名在 Mim 前端复用；PHP 主题逻辑、授权校验代码不移植。
- **数据隔离**：WP 的 MySQL 库 `bbs_wp` 与 Mim 的 SQLite 互不相通；两套用户体系不做自动打通，后续如需单点登录需另立接口方案。

## 七、回滚方案

- 摘除 WP 站点块：`rm /etc/nginx/sites-enabled/laal-top-wp.conf` → `nginx -t` → reload；从备份还原 `mim.conf` 与 `bbs.laal.top.conf`。
- 库回滚：用 `/root/wp-bare-migrate-<时间戳>/bbs_wp.sql` 还原 `bbs_wp`；站点目录与库保留备查，确认无流量后再删除（删除库与目录属不可逆操作，需单独授权）。
- 回滚不影响 Mim 主站：WP 站独立目录、独立库、独立 server 块，Mim 的 `/opt/mim` 产物与 `mim-api` 服务不被触碰。

## 八、本轮未执行项与原因

- **授权激活已闭环（2026-11-20）**：裸域迁移完成后，经真实后台登录态 + 页面 nonce 走合法 `admin_curl_aut` AJAX 流程激活，`is_aut=1`、到期 `2026-12-16 16:00:00`；复用主机留存的原始管理员口令，**未重置 WP 管理员口令**、未绕过后台 AJAX guard、未直调加密类方法；授权码未入库 / 入文档 / 入脚本 / 入 secrets / 入命令回显。脚本登录会话令牌已回收。
- **未另建第二套 WP**：`blog.laal.top` 无 DNS 记录，且按拍板复用既有 WP 落裸域；兜底建站脚本保留但未在本次生产执行。
- 前端对齐批次（空态插图、按钮档位、卡片等高与悬停、数字分页、右栏挂件、作者卡、共享头像、门户首页）的门禁结果见缺口清单第三节。
