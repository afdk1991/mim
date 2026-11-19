# Zibll 子比主题独立 WordPress 站点方案（2026-11-18）

> 配套：前端外观对齐缺口清单 [`../2026-11-16/zibll-alignment/gap-inventory-20261118.md`](../2026-11-16/zibll-alignment/gap-inventory-20261118.md)；建站脚本生成器 [`../tools/quick-build-wp`](../tools/quick-build-wp)。

## 一、结论与边界

- `E:\迅雷下载\zibll-V9.2(1651)\zibll` 是一套 **WordPress 主题**（Requires WP ≥5.0、PHP 7.0–8.5，848 个 PHP 文件），运行前提是 PHP + WordPress 核心 + MySQL；Mim 仓库是 Node/TypeScript + Express + SQLite 的 Vite/React monorepo，仓库内 0 个 `.php`、0 个 WP 核心文件，**主题不能装进 Mim 运行时，也不能把 PHP 源码剥离进 Node 工程**。
- 可行路径是**另起一套与 Mim 平行的 WordPress 站点**：独立 PHP-FPM + MySQL + WP 核心，子比主题作为 WP 主题安装；两套系统进程、数据库、目录完全隔离，互不混入对方仓库。
- 授权口径：授权码 + 域名验证，绑 `laal.top`，有效期至 **2026-12-16 24:00:00**。授权码只在 WP 后台授权页填写，**不写入 Mim 仓库、不进任何公开远端**；主题 PHP 源码不 vendor 进 Node 工程。

## 二、架构分流（生产 CVM：115.159.159.11，与 MixmAPP 同机共存）

| 入口 | 归属 | 运行时 | 数据 |
| --- | --- | --- | --- |
| `zy.laal.top` `/`、`/admin/` | Mim 用户端 + 管理后台（现状不变） | 静态产物 + systemd `mim-api`（Node，127.0.0.1:8787） | SQLite WAL |
| `api.laal.top` | Mim API 网关（现状不变） | 反代 `mim-api` | SQLite WAL |
| `blog.laal.top`（规划） | 独立 WordPress + 子比主题 | PHP-FPM 8.2 + nginx 站点块 | 独立 MySQL 库 `wp_blog_laal_top` |

- WP 站只占 `blog.laal.top` 一个独立 `server_name`，**不写 `default_server`**，不吸收未登记主机名；与 Mim 既有 nginx 共存约定一致（见 `deploy/nginx-mim.conf` 文件头注释）。
- Mim 的 CI 生产发布作业（`.github/workflows/deploy.yml` → `deploy/deploy.sh`）**不接入** WP 站；WP 站的安装与后续更新走独立脚本 / WP 后台，避免 PHP 栈污染 Mim 发布链路。

## 三、本轮已产出的部署物

| 物 | 路径 | 说明 |
| --- | --- | --- |
| 建站脚本（生成器产出，共存模式） | `deploy/wp-blog/install-blog.laal.top.sh` | 幂等 bash：环境自检 → 确认既有 Nginx 在位（不装第二套）→ MySQL → PHP 8.2-FPM → 建库建账号 → 下载 WP → 共存站点 nginx 块（80 精确匹配 301 → 443 独立 `server_name`，FPM socket，不抢占默认站点）→ 可选 SSL；支持 `--dry-run`；变量均可环境变量覆盖 |
| 脚本自检 | `node tools/quick-build-wp/cli.mjs --verify deploy/wp-blog/install-blog.laal.top.sh` | **22/22 PASS**：6 项必需能力命中、4 类危险命令未检出、1 项 `default_server` 禁止项未检出、10 个变量带默认值、写操作全部走 dry-run 封装（unrouted=0） |
| 主题包（本地，不入库） | `E:\迅雷下载\zibll-V9.2(1651)\zibll` | 服务器侧放置到 `<WP_ROOT>/wp-content/themes/zibll` |

脚本内默认值：`DOMAIN=blog.laal.top`、`PHP_VERSION=8.2`、`WP_VERSION=latest`、`WEB_ROOT=/var/www/blog.laal.top`；`DB_PASS` 仅为 dry-run 占位，真实执行必须用环境变量传入强密码；`SSL_CERT` / `SSL_KEY` 留空时由步骤 8 certbot 接管 TLS，传入既有泛域名证书 pem / key 路径则复用、跳过 certbot。

## 四、前置条件与客观缺口（执行前必须逐项确认）

1. **DNS**：`blog.laal.top` 当前在 `deploy/nginx-mim.conf` 中属「无实现、保持 NXDOMAIN」。需先在 DNSPod 加 A 记录 → `115.159.159.11`；本机无 DNS 控制台凭据，此步需在域名侧完成后取证。
2. **SSH 通道**：本机无私钥；Mim 生产发布只走 CI secrets `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY`。WP 站安装要么经同一 SSH 通道在服务器侧执行脚本，要么在服务器控制台手工执行；本机无法直连主机验证。
3. **主机资源**：同机现跑 Mim Node 服务 + MixmAPP；新增 MySQL 服务端 + PHP-FPM 需先评估内存 / 磁盘余量（MySQL 空闲约占数百 MB 常驻）。
4. **授权子域接受度（待实测）**：授权绑定域名为 `laal.top`，`blog.laal.top` 子域名是否被主题授权校验接受为同一授权域，需在 WP 后台授权页实测；若校验只认裸域，则需改用独立域名或裸域路径方案，不能假定子域可用。
5. **证书**：主机已有 `*.laal.top` 泛域名证书（`deploy/nginx-mim.conf` help 站注释已载明覆盖子域），WP 站复用该证书即可：执行前把 pem / key 路径经 `SSL_CERT` / `SSL_KEY` 环境变量传入，脚本跳过 certbot；留空则由脚本步骤 8 调 certbot 为子域单独申请。泛域名证书到期 / 续期口径沿用 Mim 现有方案。
6. **PHP 版本兼容**：脚本按 PHP 8.2 装包；子比主题声明兼容 PHP 7.0–8.5，若主机 apt 源无 `php8.2-fpm`，需按发行版可用版本调整 `PHP_VERSION` 并重生成脚本。

## 五、服务器侧执行步骤（授权后执行，本轮未动主机）

1. **预演**：`sudo bash install-blog.laal.top.sh --dry-run`，核对 26 个写操作与目标路径。
2. **安装**：带环境变量执行——`DB_PASS=<强密码> INSTALL_SSL=0 sudo bash install-blog.laal.top.sh`；脚本幂等，重复执行已存在项自动跳过。
3. **上传主题**：把本地 `zibll` 目录传到 `/var/www/blog.laal.top/wp-content/themes/zibll`，属主 `www-data:www-data`；不上传任何授权码到仓库。
4. **WP 初始化**：浏览器访问 `https://blog.laal.top` 走 WP 安装向导（站点名 / 管理员账号 / 密码，管理员口令不入库）。
5. **启用主题与授权**：后台「外观 → 主题」启用子比主题；进入主题授权页填授权码，完成域名验证；记录授权状态截图 / 页面文案作为取证。
6. **nginx 分流复核**：脚本共存站点块已按同机共存口径生成——`server_name blog.laal.top` 精确匹配、80 301 到 HTTPS、复用泛域名证书片段、`fastcgi_pass` 指向本机 PHP-FPM socket、不抢占默认站点；主机侧执行后仍需 `nginx -t` 通过再 reload。
7. **上线取证**：`https://blog.laal.top/` 200、主题前台渲染正常、后台授权状态有效、匿名可读首页；与 Mim 主站互测不串站（`zy.laal.top` 仍回 Mim SPA）。

## 六、合规与到期风险

- **到期时间**：授权 2026-12-16 24:00:00 到期；到期后主题在线更新、授权校验相关功能可能受限，需在到期前续费或评估停用主题的影响。
- **授权码保管**：只存在于 WP 后台授权状态与服务器侧环境，不提交 git、不写进 CI secrets 明文日志；仓库检索授权码当前 0 命中。
- **素材复用边界**：已复制进 `apps/web/public/zib/` 的静态素材（字体 / SVG / 头像 / 角标）按正版授权域名在 Mim 前端复用；PHP 主题逻辑、授权校验代码不移植。
- **数据隔离**：WP 的 MySQL 库与 Mim 的 SQLite 互不相通；两套用户体系不做自动打通，后续如需单点登录需另立接口方案。

## 七、回滚方案

- 停用 WP 站：摘除 `blog.laal.top` 的 nginx 站点软链 → `nginx -t` → reload；站点目录与 MySQL 库保留备查，确认无流量后再删除（删除库与目录属不可逆操作，需单独授权）。
- 回滚不影响 Mim 主站：WP 站独立目录、独立库、独立 server 块，Mim 的 `/opt/mim` 产物与 `mim-api` 服务不被脚本触碰。

## 八、本轮未执行项与原因

- 未在生产主机安装 MySQL / PHP-FPM / WP：本机无 SSH 私钥，且在同机生产环境新增数据库与运行时属结构性变更，需先确认第四节前置条件并获授权。
- 未提交授权码、未把主题 PHP 源码纳入仓库；Mim 主站 CI 已随本轮前端批次正常发布（Deploy run `44349557983` 五作业全绿），但 **WP 站本身未在主机安装**——`blog.laal.top` 仍保持 NXDOMAIN，未新增 MySQL / PHP-FPM / WP 目录。
- 前端对齐批次（空态插图、按钮档位、卡片等高与悬停）的门禁结果见本轮交付记录；其余延期项见缺口清单第三节。
