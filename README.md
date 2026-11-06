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
```

- `version-check.mjs`：铁律四版本规约校验（退出码 0 / 1）
- `env-check.mjs`：09 清单 §0 密钥治理校验——`.env.example` ↔ 09 清单 ↔ `.gitignore` 一致性（退出码 0 / 1）

## 项目铁律

所有 AI 协作者必须遵守 [AGENTS.md](./AGENTS.md) 中的八条铁律：

1. **铁律一**：AI 负责执行，不把任务丢回用户，全权接管浏览器等一切可自动化环境（最高优先级）。
2. **铁律二**：可逆操作直接做，不可逆操作先授权。
3. **铁律三**：基于证据，不空口断言。
4. **铁律四**：版本号规约（与本文件同步）。
5. **铁律五**：必须引入所有第三方依赖，不得重复造轮子。
6. **铁律六**：全角色全流程自动化——AI 承担所有人员职责，每轮交付前必须 BUG/代码检查。
7. **铁律七**：功能模块增删必须全量同步，交付报告附同步清单。
8. **铁律八**：任务完成后必须全自动化部署到远程生产环境（前后端 + 数据库），**禁止以本地预览作为交付终点**。

## 仓库结构

pnpm workspace Monorepo（`pnpm-workspace.yaml` 纳入 `apps/*`、`services/*`、`packages/*`）：

```
apps/web/            # Web 端薄壳（React 18 + Vite 6，端口 5173）
services/mim-api/    # 后端 API（Express 5 + SQLite，端口 8787，前缀 /api/v1）
packages/core-domain/# 共享领域层（错误码/套餐/金额/UUIDv7）
packages/i18n/       # 双语文案（zh-CN / en-US）与货币格式化
scripts/             # build / version-check / env-check
deploy/              # 生产部署工件（bootstrap / deploy / nginx / systemd / backup-db）
.github/workflows/   # CI/CD（push main 自动上线生产）
site/                # PRD 可视化阅读载体（离线副本，非生产站点）
docs/wiki/           # 结构化文档（01~09）
```

## 开发与运行

前置：Node >= 20（实测 v22.23.3）、pnpm 9.12.0。

```bash
pnpm install                              # 安装全部 workspace 依赖
pnpm -r typecheck                         # 全仓库类型检查
pnpm --filter @mim/api test               # API 契约测试（vitest + supertest，57 例）
pnpm --filter @mim/web build              # 前端类型检查 + 产物构建
pnpm --filter @mim/api dev                # 启动后端（http://127.0.0.1:8787）
pnpm --filter @mim/web dev                # 启动前端（http://127.0.0.1:5173，/api 代理到 8787）
npm run check                             # 版本规约 + 密钥模板校验
```

其他：`pnpm build`（`site/` → `dist/` 本地预览）、`pnpm test`（等价 `@mim/api test`）。

## 文档索引

| 入口 | 内容 |
|---|---|
| [docs/wiki/README.md](./docs/wiki/README.md) | Wiki 首页：01 架构 / 02 模块 / 03 代码参考 / 04 依赖 / 05 运行 / 06 治理 / 07 功能 / 08 开发实现 / 09 第三方 SDK 清单 |
| [docs/wiki/07-functional-modules.md](./docs/wiki/07-functional-modules.md) | FR-01~06 功能规格与实现状态（实况） |
| [docs/wiki/08-dev-implementation.md](./docs/wiki/08-dev-implementation.md) | 开发实现全景与「已实现 vs 规划」对照（§1.1） |
| [Mim-PRD.html](./Mim-PRD.html) | 产品需求文档（V0.0.0-preview，仅含登录交互演示；支付演示随 FR-02 于 2026-11-05 下线） |
| [team-hiring-plan.md](./team-hiring-plan.md) | 技术架构约束与团队分阶段配置规划 |

## 站点与部署

> **生产环境已上线**：`https://mim.mixm.top`（前端 `apps/web` + 后端 `services/mim-api` + SQLite 持久化数据库）。遵循 [铁律八](./AGENTS.md)，任务完成后由 CI 自动发布，**不以本地预览作为交付终点**。

| 项 | 说明 |
|---|---|
| 生产域名 | `https://mim.mixm.top`（HTTPS，Let's Encrypt；nginx 托管静态产物并反代 `/api/v1`） |
| 服务器布局 | `/opt/mim/app`（git 仓库）+ `/opt/mim/web`（静态根）+ systemd `mim-api`（端口 8787） |
| 数据库 | `/opt/mim/app/services/mim-api/data/mim.db`（SQLite WAL，持久化磁盘） |
| 自动部署 | push `main` → GitHub Actions `.github/workflows/deploy.yml` → SSH 执行 `deploy/deploy.sh` → 服务器 HEAD 校验 → 线上 `/health` 取证 |
| 生产登录入口 | 登录页默认「密码登录」：`POST /api/v1/auth/password`，口令取自 `MIM_AUTH_ADMIN_PASSWORD`（`deploy/deploy.sh` §5 幂等写入 `mim-api.env`，默认 `Mim@Admin2026`）；验证码通道已支持阿里云短信（`MIM_SMS_ALIYUN_*`）与 AWS SES 邮件（`MIM_EMAIL_SES_*`），CI Secret 配置后由 `deploy.yml` 透传写入即生效，未配置时 `auth/code` 在生产返回 503 `AUTH_CHANNEL_NOT_CONFIGURED` |
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
| 腾讯云 EdgeOne Pages | 静态站 `site/` | EdgeOne 控制台已连接仓库（构建 `npm install && npm run build`，输出 `dist`） | ✅ 已同步（`data.mixm.top`） |
| Cloudflare Pages / Workers | 前端 + `/api` 反代 | `wrangler.toml` + `functions/api/[[path]].js`，`https://mim-8ah.pages.dev` | ✅ CI 自动发布（`CLOUDFLARE_API_TOKEN` 已配置） |
| Vercel | 前端 + `/api` rewrite | `vercel.json`（rewrites 反代 `https://mim.mixm.top`），`https://mim-puce.vercel.app` | ✅ CI 自动发布（`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` 已配置） |
| Render | 静态站 + Node 服务 | `render.yaml`（`mim-web` + `mim-api` + 1GiB 持久盘） | ⛔ **不纳入（免费范围不可用）**：账号需绑定银行卡完成 $1 验证（`need_payment_info`），免费层亦要求支付方式。同等能力已由 Cloudflare Pages + Vercel（前端）+ Sealos（容器 + PVC + 后端）免费覆盖 |
| Sealos | 容器 + PVC | `deploy/sealos/mim.yaml`（Deployment/Service/Ingress/PVC），命名空间 `ns-i3ywsdfn`，`https://mim-i3ywsdfn.cloud.sealos.io` | ✅ CI 自动发布（`SEALOS_KUBECONFIG` / `SEALOS_DOMAIN` / `SEALOS_NAMESPACE` / `MIM_JWT_SECRET` 已配置） |
| veFaaS | 容器函数 | `deploy/vefaas/deploy.sh`（`vefaas login` → `vefaas deploy --appId` / `--newApp`） | ⛔ **不纳入（免费范围不可用）**：函数创建返回 `AccountInArrears`（requestId `202611062101255AE8FB00A8E8F86CD652`），公网入口依赖 APIG 网关且要求余额 + 代金券 ≥ 100 元（`BalanceNotEnough`，requestId `2026110620572774941322BC88983082E9`）。同等能力已由 IGA Pages（前端）+ Sealos（容器 + 后端）免费覆盖 |
| IGA Pages | 前端静态站 | `deploy/iga/deploy.sh`（`iga login` → `iga pages deploy --name mim --scope domestic`） | ✅ 已部署（Project `fr95fuwu57`，Deploy `p4f5a4svqm`）；`preview.iga-pages.com` 带 `iga_token` 访问 200，自有域名需控制台绑定 |
| 腾讯云自建服务器 | 前后端 + SQLite | `deploy/deploy.sh`（nginx + systemd + certbot） | ✅ 生产 `https://mim.mixm.top` |

托管平台以独立域名直连 API 时，需在生产 `mim-api.env` 配置跨域白名单 `MIM_CORS_ORIGINS`（`deploy/deploy.sh` 已幂等补齐 `https://afdk1991.github.io,https://mim.mixm.top,https://data.mixm.top`）。

本地构建（可选）：`npm run build`（site → dist）；前端产物：`npm run build:web`；校验：`npm run check`。


