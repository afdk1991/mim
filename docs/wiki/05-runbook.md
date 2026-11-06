# 05 · 项目运行方式

> 仓库已是可运行的 pnpm Monorepo：`services/mim-api`（后端，8787）与 `apps/web`（Web 端，5173）构成 P0 功能产品；另有 `scripts/` 下三项仓库级脚本（版本校验、密钥模板校验、站点构建）。本页覆盖启动、测试、构建与校验的完整命令。

## 1. 前置条件

| 依赖 | 必要性 | 检查命令 |
|---|---|---|
| Node.js（≥ 20，实测 v22.23.3） | **必需** | `node --version` |
| pnpm 9.12.0（`packageManager` 已锁定） | **必需**（`corepack enable` 或 `npm i -g pnpm@9.12.0`） | `pnpm --version` |
| git CLI | 可选（仅 tag 校验段需要） | `git --version` |

首次使用须 `pnpm install`（安装 workspace 全部依赖；锁文件 `pnpm-lock.yaml` 已入库）。

## 2. 运行版本校验

### 基本用法（README.md §校验命令）

```bash
node scripts/version-check.mjs
RELEASE_CHANNEL=preview node scripts/version-check.mjs
```

Windows PowerShell 5.1 环境变量写法：

```powershell
$env:RELEASE_CHANNEL = 'preview'; node scripts/version-check.mjs
# 用毕清除，避免污染后续命令
Remove-Item Env:RELEASE_CHANNEL
```

### 退出码契约

| 退出码 | 含义 | CI 语义 |
|---|---|---|
| `0` | 校验通过（含「全跳过」情形） | 门禁绿 |
| `1` | 存在违规（版本格式错 / 通道非法 / 预览通道有正式 tag） | 门禁红 |

### 三种典型场景

| 场景 | 预期输出要点 | 退出码 |
|---|---|---|
| 当前仓库现状（`package.json` 版本 `0.0.0`、无正式 tag） | `✅ 版本号 0.0.0 合法（V0.0.0）` + tag 段通过 | 0 |
| `package.json` 写 `"version": "0.0.0-preview"` | ❌ 版本号不符合 semver（预发行后缀只允许走 RELEASE_CHANNEL，不进版本数字） | 1 |
| `RELEASE_CHANNEL=preview` 且仓库已有 `V0.0.0` tag | ❌ 预览通道下已存在正式 tag | 1 |

完整判定逻辑与输出样例见 [03-code-reference.md](./03-code-reference.md)。

### 运行密钥模板校验（09 清单 §0）

把 `.env.example` 与 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) §0 的密钥治理硬约束做自动比对：

```bash
node scripts/env-check.mjs
```

| 检查项 | 判定 |
|---|---|
| 模板 ↔ 清单双向对齐 | 清单登记的变量未落位到模板 → ❌；模板出现清单外变量 → ❌；由清单通配符覆盖的项 → ⚠️ |
| 空值占位 | 任一变量存在非空值 → ❌（只打印变量名，不回显值） |
| `MIM_` 前缀 | 变量名不符合 `MIM_<领域>_<提供方>_<密钥类型>` → ❌ |
| 变量重复 | 同名变量出现多次 → ❌ |
| `.gitignore` 覆盖 | `.env` 未被忽略 → ❌；缺少 `!.env.example` 反向豁免 → ⚠️ |
| 本地 `.env` | 存在则提示（仅探测存在性，绝不读取内容） |

退出码契约与版本校验一致：`0` = 通过；`1` = 存在违规。检查清单与实现细节见 [03-code-reference.md](./03-code-reference.md) §7。

## 3. 版本号操作规约（铁律四）

| 动作 | 规则 |
|---|---|
| 对外正式发布 | 首版 `V0.0.0`，此后 `V0.0.1`… 递增；发布前不得占用 |
| 内部/预览/草稿构建 | 设 `RELEASE_CHANNEL=preview/draft/test`，展示为 `V0.0.0-preview`，**不改 semver 数字** |
| 内部 git tag | 仅允许 `draft-*` / `pre-*` 前缀；`V<semver>`（大写 V）保留给正式发布 |
| 版本号落盘位置 | `package.json` 的 `version` 字段（优先）或根目录 `VERSION` 文件 |

## 4. 环境变量与密钥模板

| 项 | 说明 |
|---|---|
| 占位模板 | 根目录 `.env.example`（138 个 `MIM_*` 空值变量，按领域分组，含北斗专项；订阅与支付的 23 个 `MIM_PAY_*` / `MIM_IAP_*` 变量已于 2026-11-05 随模块下线删除） |
| 本地使用 | 复制为 `.env` 后按需填写；根目录 `.gitignore` 已忽略 `.env`，禁止提交 |
| 生产使用 | CI Secret / 云 KMS / Secret Manager，不落盘、不入库 |
| 清单来源 | [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)（变量名与提供方一一对应） |
| 核对方式 | `node scripts/env-check.mjs` 自动校验（见 §2「运行密钥模板校验」），失败即退出码 1 |

## 5. 查看产品规划文档

| 文档 | 打开方式 |
|---|---|
| `Mim-PRD.html` | 浏览器直接打开（自包含、零依赖，仅含 FR-01 登录交互演示；原 FR-02 订阅计划与支付演示已随模块于 2026-11-05 下线） |
| `team-hiring-plan.md`、两份调研 txt | 任意 Markdown/文本编辑器 |

## 6. 启动功能应用（P0）

### 6.1 一键命令

```bash
pnpm install                       # 首次
pnpm --filter @mim/api dev         # 后端（tsx watch），http://127.0.0.1:8787
pnpm --filter @mim/web dev         # 前端（Vite），http://127.0.0.1:5173
```

前端 Vite 已把 `/api` 与 `/health` 代理到 `http://127.0.0.1:8787`，因此浏览器只需访问 5173，无需配置跨域。

### 6.2 质量门禁命令

```bash
pnpm -r typecheck                       # 四个 workspace 包类型检查
pnpm --filter @mim/api test             # vitest + supertest，5 个测试文件 43 例全通过
pnpm --filter @mim/web build            # 前端 tsc --noEmit + vite build
npm run check                           # 版本规约 + 密钥模板校验
```

### 6.3 数据结构与运行形态

| 项 | 实况 |
|---|---|
| 数据库 | SQLite（`better-sqlite3`，WAL），首次启动自动建表；测试使用内存库 |
| 端口 | API `8787`（读标准环境变量 `PORT`，默认 8787）；Web `5173` |
| 环境变量 | `.env.example` 登记第三方密钥占位（P0 无真实密钥需求）；应用自有 `MIM_JWT_SECRET`（生产必配）与 `MIM_AUTH_ADMIN_PASSWORD`（生产密码登录口令，由 `deploy/deploy.sh` §5 幂等写入） |
| 套餐/订阅/支付 | **已下线（2026-11-05）**：`/api/v1/plans`、`/api/v1/subscriptions/*`、`/api/v1/orders`、`/api/v1/invoices`、`/api/v1/audit/*` 路由与 9 张数据表均已移除，请求应返回 404 |
| 验证码 | 开发/测试环境未配置通道时在响应中回传 `dev_code`；**生产环境（`NODE_ENV=production`）强制走第三方通道，不回传 `dev_code`**。通道已支持：国内手机号 → 阿里云短信（`@alicloud/dysmsapi20170525`，需 `MIM_SMS_ALIYUN_ACCESS_KEY_ID` / `MIM_SMS_ALIYUN_ACCESS_KEY_SECRET` / `MIM_SMS_ALIYUN_SIGN_NAME` / `MIM_SMS_ALIYUN_TEMPLATE_CODE` 四项齐备），海外邮箱 → AWS SES（`@aws-sdk/client-ses`，需 `MIM_EMAIL_SES_ACCESS_KEY_ID` / `MIM_EMAIL_SES_SECRET_ACCESS_KEY` / `MIM_EMAIL_SES_FROM_ADDRESS`，`MIM_EMAIL_SES_REGION` 缺省回退 us-east-1）。通道未配置时合法请求返回 503 `AUTH_CHANNEL_NOT_CONFIGURED`；供应商发送失败返回 502 `AUTH_CODE_DELIVERY_FAILED` |
| 生产登录入口 | 短信/邮件通道未接入期间，生产使用 `POST /api/v1/auth/password`（`{region,identifier,password}`，口令取自 `MIM_AUTH_ADMIN_PASSWORD`，由 `deploy/deploy.sh` 幂等写入 `/opt/mim/mim-api.env`）。口令错误 401 `AUTH_PASSWORD_INVALID`，未配置 503 `AUTH_PASSWORD_NOT_CONFIGURED`，连续失败 5 次锁定 15 分钟（423 `AUTH_ACCOUNT_LOCKED`）。前端登录页默认「密码登录」模式 |
| 前端视图 | 仅「设置」一页；原「套餐」页随套餐/订阅模块于 2026-11-05 删除，原 FR-03 项目/任务/仪表盘已于 2026-11-04 移除。重定义后：`catalog` 域 4 表 + `comic` 域 **7 表**（第 1 期 3 表 + 第 2 期 `generation_jobs`/`generation_assets`/`comic_films`/`film_versions` 4 表）已建、`/api/v1/comic/*` 24 条路由已上线（第 1 期 8 条 + 第 2 期任务编排与成片 16 条，拆分见 `docs/wiki/07-functional-modules.md` §12）；第 2 期**已装配上线（2026-11-05）**：`app.ts` 已 import 并挂载 `/api/v1/media/*`（`createMediaRouter` + 免鉴权对象收发 `createMediaObjectRouter`，后者先于全局 `express.json`）与 `/api/v1/ai/*`（`createAiRouter`），`index.ts` 构造 `storage` + `orchestrator` 并在 `MIM_AI_WORKER` 默认开启时 `orchestrator.start()` 自动消费 `generation_jobs`；商城与漫剧前端视图 **0 代码** |
| 模块解锁 | `comic.workbench` 种子行随 `createDatabase()` 自动写入 cn/global 两区；`requireEntitlement('comic.workbench')` 无权益返回 **403 `FEATURE_NOT_AVAILABLE`**，`details` 含 `module_code`、`region` |
| 授权命令 | 生产授予权益：`sqlite3 /opt/mim/app/services/mim-api/data/mim.db "INSERT INTO entitlements (id,user_id,module_id,source,source_id,status,version,created_at,updated_at) VALUES ('ent:<uid>:comic','<uid>',(SELECT id FROM modules WHERE code='comic.workbench' AND region='cn'),'admin',NULL,'active',1,datetime('now'),datetime('now'));"` |

### 6.4 冒烟顺序（HTTP 全链路）

生产冒烟顺序：`auth/password → me → comic/projects`（验证码 `auth/code` 在生产必回 503，仅开发/测试环境用 `auth/code → auth/login`）；`plans` / `subscriptions` / `orders` / `invoices` / `audit` 已下线，冒烟时断言 404。

漫剧工作台（第 1 期）：

`GET /api/v1/comic/projects`（无权益 → 403 `FEATURE_NOT_AVAILABLE`）→ 授予 `comic.workbench` 权益 →
`POST /api/v1/comic/projects`（带 `Idempotency-Key`）→ `POST /api/v1/comic/projects/:id/characters` →
`POST /api/v1/comic/projects/:id/storyboard`（`confirm:true`，工程转 `storyboarded`）→ `GET /api/v1/comic/projects/:id` → `POST /api/v1/comic/projects/:id/suggest`

漫剧工作台（第 2 期骨架：任务编排 + 成片合成）：

`POST /api/v1/comic/projects/:id/jobs`（`job_type:"compose"`，工程转 `generating`）→ `POST /api/v1/comic/jobs/:id/start` →
`POST /api/v1/comic/jobs/:id/complete`（compose 成功，工程转 `rendered`）→ `POST /api/v1/comic/projects/:id/films`（建 `draft` 成片 + v1）→
`POST /api/v1/comic/films/:id/submit-review`（最新版本须带 `object_key`）→ `POST /api/v1/comic/films/:id/publish`（工程转 `published`）；
失败链路：`POST /api/v1/comic/jobs/:id/fail` → `POST /api/v1/comic/jobs/:id/retry`（新建 job，`retry_of` 指向原 job）

## 7. 生产部署（铁律八）

> **生产环境已上线**：`https://mim.mixm.top`（前端 `apps/web` + 后端 `services/mim-api` + SQLite 持久化数据库）。本地预览不是交付终点。

### 7.1 自动部署（默认路径）

push 到 `main` 即触发 `.github/workflows/deploy.yml`：

```
verify:  pnpm install --frozen-lockfile → pnpm -r typecheck → @mim/api test → @mim/web build
deploy:  scp deploy/deploy.sh → ssh ubuntu@<host> "sudo -n bash /opt/mim/app/deploy/deploy.sh $GITHUB_SHA"
         → 脚本 reset --hard 到该 SHA（而非 origin/main，避免连续 push 时先跑的 Run 部署到后推的提交）
         → 校验服务器 HEAD == 本次提交 SHA（不一致即失败）
         → curl https://mim.mixm.top/health（必须 200，最多重试 10 次）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/api/v1/plans（必须 404）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/api/v1/audit/logs（必须 404）
         → curl -X POST -H 'Content-Type: application/json' -d '{}'
           https://mim.mixm.top/api/v1/auth/code（空体必须 400）
         → curl -X POST -H 'Content-Type: application/json' --data-binary '{"region":'
           https://mim.mixm.top/api/v1/auth/code（非法 JSON 必须 400，不得回 500）
```

生产安全开关与登录入口（CI 不跑，需合法请求体）：

- `POST /api/v1/auth/code` 传 `{"region":"cn","provider":"phone","identifier":"13800000000"}`：通道未配置应返回 503 `AUTH_CHANNEL_NOT_CONFIGURED`；已配置阿里云短信后返回 201 `delivery:"phone"` 且响应无 `dev_code`（真实短信下发，供应商失败返回 502 `AUTH_CODE_DELIVERY_FAILED`）。任何情况下不得回 200 带 `dev_code` 或 500。
- `POST /api/v1/auth/password` 传 `{"region":"cn","identifier":"13800000000","password":"<MIM_AUTH_ADMIN_PASSWORD>"}` 应返回 200 并带 `access_token` / `refresh_token` / `user`；口令错误应 401 `AUTH_PASSWORD_INVALID`。生产口令由 `deploy/deploy.sh` §5 幂等写入 `/opt/mim/mim-api.env`（默认 `Mim@Admin2026`，可用 CI Secret 同名变量覆盖）。

所需 GitHub Actions secrets：`DEPLOY_SSH_KEY`（部署私钥）、`DEPLOY_HOST`、`DEPLOY_USER`；可选通道 secrets（配置后由 `deploy.yml` 经 `sudo env` 透传写入 `mim-api.env`，即配即生效）：`MIM_SMS_ALIYUN_ACCESS_KEY_ID` / `MIM_SMS_ALIYUN_ACCESS_KEY_SECRET` / `MIM_SMS_ALIYUN_SIGN_NAME` / `MIM_SMS_ALIYUN_TEMPLATE_CODE`（阿里云短信）、`MIM_EMAIL_SES_ACCESS_KEY_ID` / `MIM_EMAIL_SES_SECRET_ACCESS_KEY` / `MIM_EMAIL_SES_REGION` / `MIM_EMAIL_SES_FROM_ADDRESS`（AWS SES）。

```bash
gh secret set DEPLOY_SSH_KEY --body "$(cat ~/.ssh/mim_deploy)"
gh secret set DEPLOY_HOST --body "115.159.159.11"
gh secret set DEPLOY_USER --body "ubuntu"
gh run watch          # 观察最近一次运行
```

### 7.1.2 多平台同步（GitHub Pages / Packages / 托管平台）

同一次 push 还会并行触发 3 个 job（均 `needs: verify`，失败不影响自建服务器发布）：

| job | 做什么 | 需要的 secret | 缺失时行为 |
|---|---|---|---|
| `pages` | `pnpm --filter @mim/web build`（注入 `VITE_API_ORIGIN=https://mim.mixm.top`）→ `upload-pages-artifact` → `deploy-pages` | 无（用 `GITHUB_TOKEN` + `pages: write` / `id-token: write`） | 直接发布 `https://afdk1991.github.io/mim/` |
| `packages` | `docker/build-push-action` 推 `ghcr.io/afdk1991/mim-api:latest` 与 `:${GITHUB_SHA}` | 无（`GITHUB_TOKEN` + `packages: write`） | 直接推送；镜像供 Render / Sealos / veFaaS 复用 |
| `platforms` | Cloudflare / Vercel / Render / Sealos / veFaaS / IGA 依次同步 | 见下表 | 每个 step `[ -z "$TOKEN" ] && exit 0`，打印 SKIP |

| 平台 | 配置文件 | secret |
|---|---|---|
| Cloudflare Pages | `wrangler.toml` + `functions/api/[[path]].js` | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |
| Vercel | `vercel.json` | `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` |
| Render | `render.yaml` | `RENDER_DEPLOY_HOOK` |
| Sealos | `deploy/sealos/mim.yaml` | `SEALOS_KUBECONFIG`、`SEALOS_DOMAIN`、`MIM_JWT_SECRET` |
| veFaaS | `deploy/vefaas/deploy.sh`（`vefaas login` + `vefaas deploy --appId`） | `VE_ACCESS_KEY`、`VE_SECRET_KEY`、`VEFAAS_APP_ID` |
| IGA Pages | `deploy/iga/deploy.sh`（`iga login` + `iga pages deploy --name`） | `IGA_ACCESS_KEY`、`IGA_SECRET_KEY`、`IGA_PROJECT_NAME` |

> veFaaS 与 IGA Pages 同属火山引擎，共用一套 AK/SK；CLI 均由脚本在缺省时自装
> （`@volcengine/vefaas-cli` / `@iga-pages/cli`），首建应用后把 ID / 项目名写入 secret 即可自动发布。

```bash
# 一次性注入（有凭证时）
gh secret set CLOUDFLARE_API_TOKEN --body "<token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account id>"
gh secret set VERCEL_TOKEN --body "<token>"
gh secret set RENDER_DEPLOY_HOOK --body "<hook url>"
gh secret set SEALOS_KUBECONFIG --body "$(cat ~/.kube/config)"
gh secret set VE_ACCESS_KEY --body "<volcengine ak>"
gh secret set VE_SECRET_KEY --body "<volcengine sk>"
gh secret set VEFAAS_APP_ID --body "app-xxxxx"
gh secret set IGA_ACCESS_KEY --body "<volcengine ak>"
gh secret set IGA_SECRET_KEY --body "<volcengine sk>"
gh secret set IGA_PROJECT_NAME --body "mim"
```

托管平台以独立域名直连 API 时，`MIM_CORS_ORIGINS` 必须包含其域名（`deploy/deploy.sh` 幂等补齐
`https://afdk1991.github.io,https://mim.mixm.top,https://data.mixm.top`；Cloudflare / Vercel / Render 使用
`functions` / `rewrites` 同源反代时无需额外配置）。

容器镜像说明：本机与 CI 均不使用 `pnpm deploy`（pnpm 9.12 实测报 `Unknown option: 'legacy'` 且目标路径拼接异常），
`Dockerfile` 运行阶段直接搬运 pnpm 相对符号链接依赖树（builder 与 runtime 的 `WORKDIR` 同为 `/app`）。

### 7.1.1 服务器出网限制（重要）

生产服务器 **访问 `https://github.com` 超时**（`curl: (28) SSL timeout`），但 `github.com:22` 可达，
因此代码同步走 **SSH + 只读 deploy key**，不走 HTTPS：

| 项 | 值 |
|---|---|
| 仓库地址 | `git@github.com:afdk1991/mim.git`（`deploy.sh` 内 `REPO_URL` 默认值） |
| 私钥（服务器） | `/opt/mim/.ssh/deploy_key`（root 600，仅服务器持有） |
| 公钥（GitHub） | 仓库 Settings → Deploy keys，标题 `mim-prod-deploy (115.159.159.11)`，**read-only** |
| 连通性取证 | `sudo env GIT_SSH_COMMAND='ssh -i /opt/mim/.ssh/deploy_key -o BatchMode=yes -o StrictHostKeyChecking=accept-new' git ls-remote git@github.com:afdk1991/mim.git HEAD` |

`deploy.sh` 会用该私钥设置 `GIT_SSH_COMMAND`，并对 `git fetch` 做 3 次重试；私钥缺失时直接报错退出。

### 7.2 服务器一次性引导（仅首次 / 重建机器）

```bash
ssh ubuntu@115.159.159.11
sudo -n bash /opt/mim/app/deploy/bootstrap.sh   # 需仓库已在 /opt/mim/app
```

`bootstrap.sh` 幂等完成：apt 依赖（git/nginx/rsync/curl/certbot）→ corepack + pnpm 9.12.0 → 系统用户 `mim` → `/opt/mim/{app,web}` → **生成/复用 SSH deploy key 并验证可读仓库** → nginx 站点 → systemd `mim-api` → Let's Encrypt 证书（仅对已解析域名申请）→ 首发布。首次执行若提示 `deploy key 未授权`，把打印出的公钥加为仓库 Deploy Key（只读）后重跑即可。

### 7.3 幂等重放与运维

```bash
sudo -n bash /opt/mim/app/deploy/deploy.sh              # 手动重放发布（origin/main → install → build → 发布 → 健康轮询）
sudo -n bash /opt/mim/app/deploy/deploy.sh <commit-sha>  # 精确重放到指定提交（CI 同款行为）
bash /opt/mim/app/deploy/backup-db.sh          # SQLite 在线热备份（默认 /var/backups/mim，保留 14 份）
systemctl status mim-api; journalctl -u mim-api -n 50    # 服务状态与日志
```

### 7.4 生产布局

| 项 | 路径 |
|---|---|
| 仓库 | `/opt/mim/app`（git，`mim` 用户所有） |
| 静态根 | `/opt/mim/web`（`apps/web/dist` 同步而来，nginx `root`） |
| 数据库 | `/opt/mim/app/services/mim-api/data/mim.db`（WAL，持久化） |
| JWT 密钥 | `/opt/mim/app/.mim-dev-secret/jwt.key`（首次启动自动生成，不入库） |
| 站点配置 | `/etc/nginx/sites-available/mim.conf`（源模板 `deploy/nginx-mim.conf`） |

### 7.5 离线阅读构建（非生产）

```bash
npm run build    # scripts/build.mjs 把 site/ 复制到 dist/，仅用于本地阅读 PRD
npm run check    # version-check + env-check（退出码 0 = 通过）
```

`site/` **不参与生产部署**；生产前端只来自 `apps/web` 构建产物。`.edgeone/` 配置已移除。
