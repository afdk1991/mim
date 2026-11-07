# Mim

> Mim 项目仓库。协作铁律见 [AGENTS.md](./AGENTS.md)。

## 版本

当前版本：**V0.0.0-preview**

版本号规约（与 [AGENTS.md 铁律四](./AGENTS.md#铁律四版本号每次添加功能模块更新等等规约与-readme-同步) 同步）：

- 首个对外正式发布版本 = **V0.0.0**，此后按 V0.0.1、V0.0.2… 递增，发布前不得占用。
- 内部 / 预览 / 草稿构建用 `RELEASE_CHANNEL`（`preview` / `draft` / `test`）区分，展示为 `V0.0.0-preview` 等，**不改 semver 数字**。
- 内部 git tag 命名为 `draft-*` / `pre-*`，不得为 `V<semver>` 形态。
- 校验由 `scripts/version-check.mjs` 强制。

### 校验命令

```bash
node scripts/version-check.mjs
RELEASE_CHANNEL=preview node scripts/version-check.mjs
node scripts/env-check.mjs
node scripts/comment-check.mjs
```

- `version-check.mjs`：铁律四版本规约校验（退出码 0 / 1）
- `env-check.mjs`：09 清单 §0 密钥治理校验——`.env.example` ↔ 09 清单 ↔ `.gitignore` 一致性（退出码 0 / 1）
- `comment-check.mjs`：铁律十一注释覆盖率校验——逐文件统计「可注释行 / 已解释行」，默认基线模式（退出码恒 0），`--strict` 为 CI 门禁模式（低于阈值退出 1）

## 项目铁律

所有 AI 协作者必须遵守 [AGENTS.md](./AGENTS.md) 中的十一条铁律：

1. **铁律一**：AI 负责执行，不把任务丢回用户，全权接管浏览器等一切可自动化环境（最高优先级）。
2. **铁律二**：可逆操作直接做，不可逆操作先授权。
3. **铁律三**：基于证据，不空口断言。
4. **铁律四**：版本号规约（与本文件同步）。
5. **铁律五**：必须引入所有第三方依赖，不得重复造轮子。
6. **铁律六**：全角色全流程自动化——AI 承担所有人员职责，每轮交付前必须 BUG/代码检查。
7. **铁律七**：功能模块增删必须全量同步，交付报告附同步清单。
8. **铁律八**：任务完成后必须全自动化部署到远程生产环境（前后端 + 数据库），**禁止以本地预览作为交付终点**。
9. **铁律九**：多平台部署矩阵只走免费方案（9 个平台），每轮部署必须逐平台刷新 HTTP / 耗时 / 连接取证；本机不可达须附网络侧证据与替代取证。
10. **铁律十**：免费平台额度矩阵与选型路由——远程仓库 4 个（GitHub / GitLab / Bitbucket / Gitee）、纯静态 5 个（GitHub Pages / Cloudflare Pages / Vercel / Netlify / Azure Static Web Apps）、后端动态 2 个（Render / Cloudflare Workers）的免费额度为准入依据；新平台须过「长期免费层 / 额度可承载 / 是否实名绑卡 / 复核日期与来源」四要件并季度复核。
11. **铁律十一**：全仓库逐行注释与解释——业务代码、脚本、CSS、HTML 每行须有中文解释；`scripts/comment-check.mjs` 为校验器（`--strict` 为 CI 门禁）；未全量达标时不得声称「已全量注释完成」。

## 仓库结构

pnpm workspace Monorepo（`pnpm-workspace.yaml` 纳入 `apps/*`、`services/*`、`packages/*`）：

```
apps/web/            # Web 端薄壳（React 18 + Vite 6，端口 5173；视图：功能模块 / 漫剧 AI 剧 / 站点地图 / 设置）
apps/web/src/views/  # Login / Store / ComicWorkbench / SiteMap / Settings 五个视图组件
apps/admin/          # 独立管理后台（React 18 + Vite 6，端口 5174，生产入口 /admin/；视图：概览 / 功能模块 / 权益管理 / 角色与权限 / 用户）
services/mim-api/    # 后端 API（Express 5 + SQLite WAL + JWT + zod，端口 8787，前缀 /api/v1）
services/mim-api/src/routes/  # auth / catalog / site / me / comic / media / ai / admin 八个路由模块
packages/core-domain/# 共享领域层（错误码 ERROR_CODES / UUIDv7）
packages/i18n/       # 双语文案（zh-CN / en-US）、t() 回退链与货币格式化
scripts/             # build / version-check / env-check / comment-check
deploy/              # 生产部署工件（bootstrap / deploy / backup-db / nginx / systemd / migrations / sealos / iga）
.github/workflows/   # CI/CD（deploy.yml 五作业：verify / deploy / pages / packages / platforms）
site/                # PRD 可视化阅读载体（`npm run build:site` 离线副本，非生产站点）
docs/wiki/           # 结构化文档（01~10 + 首页 README）
```

## 功能与接口

### 前端视图（`apps/web/src/views`）

无 URL 路由，视图由 [App.tsx](./apps/web/src/App.tsx) 的 `View` 状态切换；功能模块与站点地图免登录可浏览，漫剧与设置未登录时内容区内嵌登录卡片。

独立管理后台见 [apps/admin](./apps/admin)：独立构建、独立静态根（生产 `/admin/`），承载角色 / 权限 / 用户角色 / 模块状态流转 / 权益发放与回收。

| 视图 | 组件 | 说明 |
|---|---|---|
| 登录 | `Login.tsx` | 管理员口令登录 `POST /auth/password` 与验证码登录 `/auth/code` + `/auth/login` |
| 功能模块 | `Store.tsx` | 模块目录浏览（匿名可看）与一次性解锁（`/modules`、`/entitlements`、`/me/entitlements`；解锁需登录） |
| 漫剧 AI 剧 | `ComicWorkbench.tsx` | 工程 / 角色 / 分镜 / 生成任务 / 成片与版本全流程 |
| 站点地图 | `SiteMap.tsx` | DNSPod 备注结构化的站点模块检索（`/site/*`，匿名可访问） |
| 设置 | `Settings.tsx` | 资料、区域、语言与注销冷静期 |

### 后端接口（`services/mim-api`，前缀 `/api/v1`）

| 分组 | 端点 | 鉴权 |
|---|---|---|
| 健康 | `GET /health` | 公开 |
| 鉴权 | `POST /auth/code`、`/auth/login`、`/auth/password`、`/auth/refresh`、`/auth/logout` | 公开（`logout` 需登录） |
| 商城 | `GET /modules`、`GET /modules/:code` | 公开 |
| 权益 | `POST /entitlements`、`GET /me/entitlements` | 登录 + 幂等 |
| 账号 | `GET /me`、`PATCH /me`、`POST /me/deletion`、`POST /me/cancel-deletion` | 登录 |
| 漫剧工程 | `GET/POST /comic/projects`、`GET/PATCH/DELETE /comic/projects/:id`、`POST /comic/projects/:id/{storyboard,characters,suggest}` | 登录 |
| 生成任务 | `GET/POST /comic/projects/:id/jobs`、`GET /comic/jobs/:id`、`POST /comic/jobs/:id/{start,complete,fail,cancel,retry}` | 登录 |
| 成片 | `GET/POST /comic/projects/:id/films`、`GET /comic/films/:id`、`POST /comic/films/:id/{versions,submit-review,publish,reject,archive}` | 登录 |
| 媒体 | `PUT/GET /media/objects/*`（URL 签名）、`POST /media/presign/upload`、`GET /media/presign/download`、`GET /media/assets` | 对象端点凭签名免鉴权 |
| AI 编排 | `GET /ai/capabilities`、`POST /ai/jobs/:id/run` | 登录 |
| 站点地图 | `GET /site/overview`、`GET /site/modules`、`GET /site/modules/:host` | 公开只读 |
| 管理 RBAC | `GET /admin/me`、`GET /admin/permissions`、`GET /admin/roles`、`POST /admin/roles`、`PATCH/DELETE /admin/roles/:code`、`GET/PUT /admin/roles/:code/permissions`、`GET /admin/users`、`GET/POST /admin/users/:userId/roles`、`DELETE /admin/users/:userId/roles/:roleCode` | Bearer + `rbac:read` / `rbac:write`（`x-admin-token` 为超管引导通道） |

除 `auth/*` 外的写接口强制 `Idempotency-Key`（同键同体重放首次结果、同键异体 409）；错误统一信封携带 `requestId`。

## 开发与运行

前置：Node >= 20（实测 v22.23.3）、pnpm 9.12.0。

```bash
pnpm install                              # 安装全部 workspace 依赖
pnpm -r typecheck                         # 全仓库类型检查
pnpm --filter @mim/api test               # API 契约测试（vitest + supertest，10 个测试文件 / 120 例）
pnpm --filter @mim/web build              # 前端类型检查 + 产物构建
pnpm --filter @mim/admin build            # 管理后台类型检查 + 产物构建
pnpm --filter @mim/api dev                # 启动后端（http://127.0.0.1:8787）
pnpm --filter @mim/web dev                # 启动前端（http://127.0.0.1:5173，/api 代理到 8787）
pnpm --filter @mim/admin dev              # 启动管理后台（http://127.0.0.1:5174，/api 代理到 8787）
npm run check                             # 版本规约 + 密钥模板校验 + 注释覆盖率（CI 以 --strict 执行）
```

其他：`npm run build`（构建真实前端 `apps/web/dist` → 根 `dist/`，EdgeOne Pages 等 OutputDir=dist 的托管平台同款）、`npm run build:admin`（构建管理后台 `apps/admin/dist`）、`npm run build:site`（PRD 阅读页 `site/` → `dist/` 离线预览）、`npm test`（等价 `@mim/api test`）。

## 文档索引

| 入口 | 内容 |
|---|---|
| [docs/wiki/README.md](./docs/wiki/README.md) | Wiki 首页：01 架构 / 02 模块 / 03 代码参考 / 04 依赖 / 05 运行 / 06 治理 / 07 功能 / 08 开发实现 / 09 第三方 SDK 清单 / 10 漫剧状态机 |
| [docs/wiki/07-functional-modules.md](./docs/wiki/07-functional-modules.md) | FR-01~06 功能规格与实现状态（实况） |
| [docs/wiki/08-dev-implementation.md](./docs/wiki/08-dev-implementation.md) | 开发实现全景与「已实现 vs 规划」对照（§1.1） |
| [docs/wiki/10-comic-state-machines.md](./docs/wiki/10-comic-state-machines.md) | 漫剧工程 / 生成任务 / 成片版本的状态机与迁移约束 |
| [Mim-PRD.html](./Mim-PRD.html) | 产品需求文档（V0.0.0-preview，仅含登录交互演示；支付演示随 FR-02 于 2026-11-05 下线） |
| [team-hiring-plan.md](./team-hiring-plan.md) | 技术架构约束与团队分阶段配置规划 |

## 站点与部署

> **生产环境已上线**：`https://mim.mixm.top`（前端 `apps/web` + 后端 `services/mim-api` + SQLite 持久化数据库）。遵循 [铁律八](./AGENTS.md)，任务完成后由 CI 自动发布，**不以本地预览作为交付终点**。

| 项 | 说明 |
|---|---|
| 生产域名 | `https://mim.mixm.top`（HTTPS，Let's Encrypt；nginx 托管静态产物并反代 `/api/v1`） |
| 服务器布局 | `/opt/mim/app`（git 仓库）+ `/opt/mim/web`（用户端静态根）+ `/opt/mim/admin`（管理后台静态根）+ systemd `mim-api`（端口 8787） |
| 管理后台入口 | `https://mim.mixm.top/admin/`（`apps/admin` 构建产物；nginx `/admin/` location 独立 alias，与用户端静态根隔离；页面声明 `noindex, nofollow`） |
| 数据库 | `/opt/mim/app/services/mim-api/data/mim.db`（SQLite WAL，持久化磁盘） |
| 数据库迁移 | `deploy/migrations/*.cjs`（`2026-11-04-drop-fr03.cjs`、`2026-11-05-drop-billing-audit.cjs`）：`deploy/deploy.sh` 发布前先用 `better-sqlite3` backup 再幂等执行 |
| 运行期配置 | 生产写入 `/opt/mim/mim-api.env`：`MIM_JWT_SECRET`（≥32 字符，生产缺失直接拒绝启动）、`MIM_AUTH_ADMIN_PASSWORD`、`MIM_CORS_ORIGINS`、`MIM_STORAGE_DRIVER`（`local` / `s3`）+ `MIM_STORAGE_*`、`MIM_AI_PROVIDER`（`mock` / `openai`）与 `MIM_AI_*` 成本上限 / 产物保留期、`MIM_AI_WORKER`、`MIM_PUBLIC_BASE_URL`、`PORT`（缺省 8787）；完整清单见 [.env.example](./.env.example) 与 [09 清单](./docs/wiki/09-third-party-sdk-inventory.md) |
| 自动部署 | push `main` → GitHub Actions `.github/workflows/deploy.yml` → SSH 执行 `deploy/deploy.sh` → 服务器 HEAD 校验 → 线上 `/health` 取证 |
| 生产登录入口 | 未登录可浏览功能模块与站点地图；漫剧、设置与解锁操作需登录。登录页默认「密码登录」：`POST /api/v1/auth/password`，口令取自 `MIM_AUTH_ADMIN_PASSWORD`（`deploy/deploy.sh` §5 幂等写入 `mim-api.env`；优先保留已有值 / CI Secret 同名变量，均未配置时现场生成随机口令且不回显日志，**不再有公开默认口令**，运维须从服务器 env 文件读取）；验证码通道已支持阿里云短信（`MIM_SMS_ALIYUN_*`）与 AWS SES 邮件（`MIM_EMAIL_SES_*`），CI Secret 配置后由 `deploy.yml` 透传写入即生效，未配置时 `auth/code` 在生产返回 503 `AUTH_CHANNEL_NOT_CONFIGURED` |
| 站点模块地图 | `GET /api/v1/site/overview`、`GET /api/v1/site/modules?zone=&category=&q=`、`GET /api/v1/site/modules/:host`（公开只读，无鉴权）。数据源为 DNSPod 导出 `dnspod_records_2026-11-05_21-42-26.xls` 的「备注」列，45 条主机 × 单 zone（`mixm.top`）、8 个分类；解析目标（IP / CNAME 目标值）不对外暴露，记录仅含类型 / 域名 / TTL；前端入口「站点地图 / Site Map」 |
| 代码同步通道 | 服务器访问 `https://github.com` 被阻断，改走 `git@github.com`（`/opt/mim/.ssh/deploy_key` 只读 Deploy Key，22 端口） |
| 一次性引导 | `sudo bash deploy/bootstrap.sh`（apt 依赖 / pnpm / nginx / systemd / certbot） |
| 手动重放 | `bash deploy/deploy.sh`（幂等）；`bash deploy/backup-db.sh`（在线备份 SQLite） |
| `site/index.html` / `site/prd.html` | PRD 可视化入口与副本，仅离线阅读，**不参与生产** |

### 多平台部署矩阵

一套代码、一份前端产物（`vite base: './'`，可挂任意子路径），后端统一由 `services/mim-api` 提供。CI 在 push `main` 时并行触发下列链路；缺凭证的平台以 `SKIP` 跳过，不阻断主链路。

| 平台 | 载体 | 入口 / 配置 | 状态 |
|---|---|---|---|
| GitHub 仓库 | 源码主仓 | `https://github.com/afdk1991/mim` | ✅ 已同步 |
| GitHub Pages | 前端静态站 | CI job `pages`（`configure-pages` + `upload-pages-artifact` + `deploy-pages`），`https://afdk1991.github.io/mim/` | ✅ CI 自动发布 |
| GitHub Packages | 容器镜像（ghcr） | CI job `packages` → `ghcr.io/afdk1991/mim-api:{latest,sha}`；npm registry 受「包 scope 必须等于仓库 owner」限制，故 `@mim/*` 不发 npm | ✅ CI 自动推送 |
| 腾讯云 EdgeOne Pages | 真实前端 `apps/web/dist` | `edgeone makers deploy apps/web/dist -n mim-app --env production` 本地直传（direct upload 型，非仓库连接；最近一次 Deployment `dpbspulwd0nd`，2026-11-07）；`apps/web/index.html` `<head>` 已内置 `?tads` / 裸问号归一化脚本；`data.mixm.top` 对 `curl` / 无头 UA 返回 WAF 混淆 JS，对**无头浏览器与全新 profile 的有头 Edge** 返回验证码页（`TEOCaptchaWidgetV1`），真实内容须复用**已通过过校验的** Edge user-data-dir + 有头模式 + CDP 取证（判定正则含 `EO_Bot_Ssid\|_0x649a\|TEOCaptchaWidgetV1\|正在验证连接安全性`） | ✅ 已同步（`data.mixm.top`：最近一次有头 Edge + CDP 取证（2026-11-06）`title=Mim — 跨端任务与轻协作` + `assets/index-cpYhbG3w.js`；2026-11-07 01:48 复测时放行凭证过期回落验证码页，CDP 合成点击 ×15 未通过，需人工勾选一次复选框后恢复） |
| Cloudflare Pages / Workers | 前端 + `/api` 反代 | `wrangler.toml` + `functions/api/[[path]].js`，`https://mim-8ah.pages.dev` | ✅ CI 自动发布（`CLOUDFLARE_API_TOKEN` 已配置） |
| Vercel | 前端 + `/api` rewrite | `vercel.json`（rewrites 反代 `https://mim.mixm.top`），`https://mim-puce.vercel.app` | ✅ CI 自动发布（`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` 已配置） |
| Sealos | 容器 + PVC | `deploy/sealos/mim.yaml`（Deployment/Service/Ingress/PVC），命名空间 `ns-i3ywsdfn`，`https://mim-i3ywsdfn.cloud.sealos.io`（纯 API 容器：根路径 `/` 返回 404 `route GET / not found`，`/health` 返回 200） | ✅ CI 自动发布（`SEALOS_KUBECONFIG` / `SEALOS_DOMAIN` / `SEALOS_NAMESPACE` / `MIM_JWT_SECRET` 已配置） |
| IGA Pages | 前端静态站 | `deploy/iga/deploy.sh`（`iga login` → `iga pages deploy --name mim --scope domestic`） | ✅ 已部署（Project `fr95fuwu57`，Deploy `p4f5a4svqm`）；`preview.iga-pages.com` 带 `iga_token` 访问 200，自有域名需控制台绑定 |
| 腾讯云自建服务器 | 前后端 + SQLite | `deploy/deploy.sh`（nginx + systemd + certbot） | ✅ 生产 `https://mim.mixm.top` |

托管平台以独立域名直连 API 时，需在生产 `mim-api.env` 配置跨域白名单 `MIM_CORS_ORIGINS`（`deploy/deploy.sh` 已幂等补齐 `https://afdk1991.github.io,https://mim.mixm.top,https://data.mixm.top`）。

> **取证口径说明（2026-11-07 23:49 核对）**：下方一段为 **2026-11-07 01:48 的历史实测快照**（对应 commit `7e4e3e9`），数值按铁律三保留原样留痕，**不冒充本轮结果**。仓库当前 HEAD 已推进至 `41a871d`（CI run `42387996107` 五作业全绿）；**最新一轮逐平台取证见 [AGENTS.md 铁律九表格](./AGENTS.md)（2026-11-07 23:49:38 +0800，commit `41a871d`，含 `/admin/` 新产物上线证据与三平台 `?tads` / 裸问号归一化脚本 `rs=True` 取证）**，本页与 `docs/wiki/05-runbook.md §7.1.3` 的 01:48 数值待下一轮独立 curl 后再同步。

> **2026-11-07 01:48:24 +08:00 本机实测（中国网络，commit `7e4e3e9`，历史快照）**：9 个免费平台全部接入或已取证上线——自建 `mim.mixm.top` 200/0.065s 最快（`/health` 200/0.070s），且首页已引用本轮新产物 `assets/index-B15IIvsS.js` + `assets/index-Dxv4qrxj.css`（证明「整站强制登录改为公开视图免登录」已上线）；EdgeOne `data.mixm.top` curl 200/0.062s 但**响应体仅 986B，为 EdgeOne WAF 机器校验页（`EO_Bot_Ssid` / `_0x649a`），属假阳性**——本轮复用 profile 的 WAF 放行凭证已过期（约 17h），回落层 2 验证码页，CDP 合成点击 ×15 未通过，真实内容本轮未复验（最近一次有头取证 2026-11-06：`title=Mim — 跨端任务与轻协作`、`assets/index-cpYhbG3w.js`、`isWafChallenge=false`）；GitHub Pages 200/0.225s、Cloudflare Pages 200/1.172s、Sealos `/health` 200/0.283s（根路径 `/` 404 `route GET / not found` 属正常）、ghcr 未鉴权 401/0.745s（正常）。Vercel 与 github.com 本机不可达属网络侧限制（Vercel DNS 污染至 162.125.2.5（Dropbox 段地址）/ github.com TLS 握手阻断 exit 35、TCP 0.019s 可连），CI 与 git/gh 侧取证正常（HEAD `7e4e3e9`）。逐平台 HTTP / 耗时 / 连接明细见 [05-runbook.md §7.1.3](./docs/wiki/05-runbook.md)；DNSPod 记录与功能模块对应见同页 §7.6。

> **`?tads` 注入机制与本轮修复（2026-11-07 定性）**：EdgeOne Bot 挑战脚本会给地址栏附加 `?tads`，其清理逻辑为字符串表内的 `location.href=location.href.replace(/[?|&]tads/, '')`——只匹配 `?tads` 本体、不匹配清理后残留的裸问号，故地址栏留下 `https://data.mixm.top/?`。**项目侧修复**：`apps/web/index.html` 的 `<head>` 内置归一化脚本（`history.replaceState` 原地清掉空查询串 / 裸问号，不新增历史、不触发跳转）。**上线验证（2026-11-07）**：`mim.mixm.top/`、`mim-8ah.pages.dev/`、`afdk1991.github.io/mim/` 响应均含该归一化脚本；`data.mixm.top` 因 WAF 全路径挑战无法用 curl 复验内容层（如实记录），已用 `edgeone makers deploy apps/web/dist -n mim-app --env production` 直传 Deployment `dpbspulwd0nd`。
>
> **EdgeOne WAF 拦截面（2026-11-07 补充实测）**：层 1 —— `curl` / 无头 UA 拿到约 986B 混淆 JS（`EO_Bot_Ssid` / `_0x649a`）；层 2 —— **无头浏览器（`--headless=new`）与全新 `user-data-dir` 的有头 Edge 都会落入验证码页**（`title=Security Verification`、`https://captcha.eo.gtimg.com/TEOCaptchaWidgetV1.js`、`htmlLen≈16419`、文案「正在验证连接安全性」）。**可通过方式与其失效边界**：复用**已通过过校验的** `user-data-dir`（本机 `$env:TEMP\edge-cdp-profile`）+ 有头模式 + CDP（`--remote-debugging-port=9333`）——2026-11-06 以此读得 `title=Mim — 跨端任务与轻协作`、`htmlLen=1553`、`isWafChallenge=false`，截图存 [.screenshots/data-mixm-top-e2e.png](./.screenshots/data-mixm-top-e2e.png)；但**放行凭证会过期（实测约 17h 后失效：2026-11-07 01:48 复用该 profile 仍回落层 2）；层 2 的 TEOCaptcha 对 CDP 合成鼠标事件（`Input.dispatchMouseEvent`，×15 次点击）不放行；凭证过期后唯一出路是人工在有头浏览器勾选一次复选框，放行会回写 profile，后续 CDP 即可复用**。

本地构建：`npm run build`（真实前端 → 根 `dist/`，与 EdgeOne Pages 同款链路）；PRD 阅读页：`npm run build:site`（`site/` → `dist/`）；前端单独产物：`npm run build:web`；校验：`npm run check`。


