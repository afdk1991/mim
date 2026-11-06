# 05 · 项目运行方式

> 仓库已是可运行的 pnpm Monorepo：`services/mim-api`（后端，8787）与 `apps/web`（Web 端，5173）构成 P0 功能产品；另有 `scripts/` 下四项仓库级脚本（版本校验、密钥模板校验、注释覆盖率校验、站点构建）。本页覆盖启动、测试、构建与校验的完整命令。

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
npm run check                           # 版本规约 + 密钥模板校验 + 注释覆盖率门禁（CI 以 --strict 执行）
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

站点模块地图（公开只读，**免鉴权**，数据源 = DNSPod 导出备注）：

`GET /api/v1/site/overview`（200，`total=45`、2 个 zone、8 个分类）→ `GET /api/v1/site/modules`（200，45 模块 × 2 records）→
`GET /api/v1/site/modules?zone=mixm.top&category=tools`（200，`gy` 为 CNAME → `gale-engine-landing-6j02gsvv.edgeone.cool.`）→
`GET /api/v1/site/modules/gy`（200）→ `GET /api/v1/site/modules/unknown-host`（必须 404）→
`GET /api/v1/site/modules?zone=bad`（必须 400 `VALIDATION_FAILED`）

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
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/api/v1/site/overview（必须 200）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/api/v1/site/modules（必须 200）
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
| `packages` | `docker/build-push-action` 推 `ghcr.io/afdk1991/mim-api:latest` 与 `:${GITHUB_SHA}` | 无（`GITHUB_TOKEN` + `packages: write`） | 直接推送；镜像供 Sealos 等容器平台复用 |
| `platforms` | Cloudflare / Vercel / Sealos / IGA 依次同步 | 见下表 | 每个 step `[ -z "$TOKEN" ] && exit 0`，打印 SKIP |

| 平台 | 配置文件 | secret |
|---|---|---|
| Cloudflare Pages | `wrangler.toml` + `functions/api/[[path]].js` | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |
| Vercel | `vercel.json` | `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` |
| Sealos | `deploy/sealos/mim.yaml` | `SEALOS_KUBECONFIG`、`SEALOS_DOMAIN`、`SEALOS_NAMESPACE`、`MIM_JWT_SECRET` |
| IGA Pages | `deploy/iga/deploy.sh`（`iga login` + `iga pages deploy --name`） | `IGA_ACCESS_KEY`、`IGA_SECRET_KEY`、`IGA_PROJECT_NAME`（可选 `IGA_SCOPE`，默认 `domestic`） |

**当前实况（2026-11-06）**：

| 平台 | 状态 | 取证 / 阻塞原因 |
|---|---|---|
| IGA Pages | ✅ 已部署 | `iga login`（本机 SSO）→ `iga pages deploy --name mim --scope domestic` → Project ID `fr95fuwu57`、Deploy `p4f5a4svqm`；preview 域名为 token 门禁（307 下发 `iga_token` Cookie 后可达），`curl -c/-b` 带 Cookie 实测 200 / 476 字节；自有域名需控制台绑定（domestic scope 需 ICP 备案） |

> IGA 脚本支持「本机 SSO 登录态复用」：CI 用 AK/SK，本机执行前只需 `iga login`，脚本内以 `whoami` 探测登录态；CLI 由脚本在缺省时自装（`@iga-pages/cli`），首建应用后把项目名写入 secret 即可自动发布。

```bash
# 一次性注入（有凭证时）
gh secret set CLOUDFLARE_API_TOKEN --body "<token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account id>"
gh secret set VERCEL_TOKEN --body "<token>"
gh secret set SEALOS_KUBECONFIG --body "$(cat ~/.kube/config)"
gh secret set SEALOS_DOMAIN --body "mim-<ns>.cloud.sealos.io"
gh secret set SEALOS_NAMESPACE --body "ns-<xxxx>"
gh secret set MIM_JWT_SECRET --body "<64 位 hex>"
gh secret set IGA_ACCESS_KEY --body "<volcengine ak>"
gh secret set IGA_SECRET_KEY --body "<volcengine sk>"
gh secret set IGA_PROJECT_NAME --body "mim"
```

托管平台以独立域名直连 API 时，`MIM_CORS_ORIGINS` 必须包含其域名（`deploy/deploy.sh` 幂等补齐
`https://afdk1991.github.io,https://mim.mixm.top,https://data.mixm.top`；Cloudflare / Vercel 使用
`functions` / `rewrites` 同源反代时无需额外配置）。

容器镜像说明：本机与 CI 均不使用 `pnpm deploy`（pnpm 9.12 实测报 `Unknown option: 'legacy'` 且目标路径拼接异常），
`Dockerfile` 运行阶段直接搬运 pnpm 相对符号链接依赖树（builder 与 runtime 的 `WORKDIR` 同为 `/app`）。

### 7.1.3 多平台实测汇总（2026-11-07 00:13:32 +08:00，本机中国网络）

结论：**9 个免费平台全部接入或已取证上线；状态码与 2026-11-06 基线一致，仅耗时刷新，无渠道新增或失效。**

| 平台 | 免费 | 状态 | 域名 | HTTP / 总耗时 / 连接 |
|---|---|---|---|---|
| 腾讯云自建服务器 | ✅（自有服务器） | ✅ 已上线（前后端 + SQLite） | `https://mim.mixm.top` | 200 / **0.068s** / 0.028s ⚡最快 |
| 腾讯云 EdgeOne Pages | ✅ | ✅ 已同步（真实前端 `apps/web/dist`） | `https://data.mixm.top` | 200 / **0.094s** / 0.039s ⚡次快 |
| GitHub Pages | ✅ | ✅ CI 自动发布 | `https://afdk1991.github.io/mim/` | 200 / 2.425s / 0.152s |
| Sealos | ✅ | ✅ CI 自动发布（容器 + PVC；纯 API 容器，根路径 `/` 404 无路由，`/health` 200） | `https://mim-i3ywsdfn.cloud.sealos.io` | `/` **404**（`route GET / not found`，属正常非故障）/ 0.643s / 0.101s；`/health` 200 / 0.243s |
| Cloudflare Pages | ✅ | ✅ CI 自动发布（含 /api 反代） | `https://mim-8ah.pages.dev` | 200 / 0.549s / 0.175s |
| GitHub Packages (ghcr) | ✅ | ✅ CI 自动推送镜像 | `ghcr.io/afdk1991/mim-api` | 401 / 1.192s / 0.124s（未鉴权 401 属正常） |
| IGA Pages | ✅ | ✅ 已部署（Project `fr95fuwu57` / Deploy `p4f5a4svqm`） | `preview.iga-pages.com`（带 `iga_token` 访问 200） | 200（需 token）/ 未纳入本机 curl 批次 |
| Vercel | ✅ | ✅ CI 取证通过（2026-11-06T13:15:10Z） | `https://mim-puce.vercel.app` | CI 记录 200；本机 000 / ≥12s（`--max-time 12` 截断）/ 0.000s（DNS 污染到 108.160.169.37，TCP 连接即失败） |
| GitHub 仓库 | ✅ | ✅ 已同步（HEAD `9bdf69c`，2026-11-07 00:20 +0800 提交） | `https://github.com/afdk1991/mim` | 本机 000 / 0.026s / 0.018s（curl exit 35：TLS 握手阻断，TCP 可连；仓库操作经 git push / gh CLI 取证 ✅） |

> 以上矩阵已升格为项目规则：[AGENTS.md 铁律九](../../AGENTS.md)——免费是硬约束，每轮部署须刷新本表取证。

> 候选平台的免费额度与选型路由见 [AGENTS.md 铁律十](../../AGENTS.md)：远程仓库 4 个（GitHub / GitLab / Bitbucket / Gitee）、纯静态 5 个（GitHub Pages / Cloudflare Pages / Vercel / Netlify / Azure Static Web Apps）、后端动态 2 个（Render 750 实例小时/月、Cloudflare Workers 10 万请求/天）。**本表为已落地的 9 平台矩阵，铁律十为候选池与选型依据**；新增平台须先过「长期免费层 / 额度可承载 / 是否实名绑卡 / 复核日期与来源」四要件。

> **本机不可达两项属网络侧限制，不代表部署失败**：Vercel 存在 DNS 污染、github.com 存在 HTTPS 阻断；两者均有 CI 日志与 git/gh 侧取证。

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

### 7.5 根级构建（生产前端 / PRD 离线阅读）

```bash
npm run build        # scripts/build.mjs：构建真实前端 apps/web/dist → 根 dist/（EdgeOne Pages OutputDir=dist 同款链路）
npm run build:site   # scripts/build.mjs --site：仅把 site/ 复制到 根 dist/（PRD 阅读页离线预览）
npm run build:web    # 仅构建 apps/web → apps/web/dist
npm run check        # version-check + env-check + comment-check（退出码 0 = 通过）
```

`site/` **不参与任何生产托管**；生产前端与 EdgeOne Pages（`data.mixm.top`）前端**只来自 `apps/web` 构建产物**——根 `dist/` 由 `scripts/build.mjs` 从 `apps/web/dist` 复制而来。`.edgeone/` 配置已移除。

## 7.6 DNS 资产（DNSPod mixm.top）与功能模块对应

来源：`dnspod_records_2026-11-05_21-42-26.xls`（197 条，含 GBK 中文备注）。结论（2026-11-06 全仓比对）：

- **项目实际使用 3 条**：`mim`（生产主域）、`data`（EdgeOne Pages 真实前端站）、`_dnsauth.mim`（证书签发校验）；`cloud.mixm.top` DNS 在线但项目零引用；其余 193 条未使用。
- **备注 ↔ 模块对应（40 种备注）**：仅 3 类直接命中——`auth` / `login` / `api` → FR-01 账号与身份 + `mim-api`；10 类部分沾边（`admin` / `center` / `user` / `dy` / `sp` / `video` / `yy` / `img` / `secure` / `portal`）；27 类无对应（`pay` 属 FR-02 已删除域；电商 7 类、资讯 4 类、工具 4 类、移动端 3 类等与当前「功能模块商城 + 漫剧 AI 剧」范围无关）。

### 部署平台 ↔ DNSPod 记录对应（2026-11-06 实测）

§7.1.3 的 9 个免费平台中，仅 2 个平台经 DNSPod `mixm.top` 自有域解析，其余 7 个使用平台方域名、不经 DNSPod：

| 部署平台 | 域名 | DNSPod 记录（类型 \| 主机记录 \| 记录值） | 记录状态 |
|---|---|---|---|
| 腾讯云自建服务器（生产） | `mim.mixm.top` | `A \| mim \| 115.159.159.11`（TTL 600） | 正常（2026-11-01 16:44:49） |
| 生产证书签发校验（Let's Encrypt DNS-01） | —（校验用，不提供访问） | `TXT \| _dnsauth.mim \| 20261101085017crjbxlenk4ad73ctm41heelf10vswxc`（TTL 600） | 正常（2026-11-01 16:50:18） |
| 腾讯云 EdgeOne Pages | `data.mixm.top` | `CNAME \| data \| data.mixm.top.pages.dnsoe5.com.`（TTL 600） | 正常（2026-11-01 21:18:09） |
| GitHub Pages / Sealos / Cloudflare Pages / ghcr / IGA Pages / Vercel / GitHub 仓库 | 平台方域名（`*.github.io` / `*.cloud.sealos.io` / `*.pages.dev` / `ghcr.io` / `*.iga-pages.com` / `*.vercel.app` / `github.com`） | 不经 DNSPod，`mixm.top` 下无对应记录 | — |

补充说明：

- `cloud`（`A \| cloud \| 115.159.159.11`，正常，2026-11-01 21:08:13）DNS 在线但项目零引用，未指向任何部署平台功能。
- `@` 根域及旧 `cloud` / `data` A 记录（103.0.113.20）状态为「暂停」，不参与服务。
- 另有 `_dnsauth.gy`（CNAME → `gy.mixm.top.eoacme0.com.`）属 EdgeOne 证书校验，与 `gy.mixm.top` 子站相关，当前项目未使用。
