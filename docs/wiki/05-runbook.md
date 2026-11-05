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
| 占位模板 | 根目录 `.env.example`（140 个 `MIM_*` 空值变量，按领域分组，含北斗专项） |
| 本地使用 | 复制为 `.env` 后按需填写；根目录 `.gitignore` 已忽略 `.env`，禁止提交 |
| 生产使用 | CI Secret / 云 KMS / Secret Manager，不落盘、不入库 |
| 清单来源 | [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)（变量名与提供方一一对应） |
| 核对方式 | `node scripts/env-check.mjs` 自动校验（见 §2「运行密钥模板校验」），失败即退出码 1 |

## 5. 查看产品规划文档

| 文档 | 打开方式 |
|---|---|
| `Mim-PRD.html` | 浏览器直接打开（自包含、零依赖，含 FR-01 登录 / FR-02 支付两个交互演示） |
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
pnpm --filter @mim/api test             # vitest + supertest，12 例契约测试
pnpm --filter @mim/web build            # 前端 tsc --noEmit + vite build
npm run check                           # 版本规约 + 密钥模板校验
```

### 6.3 数据结构与运行形态

| 项 | 实况 |
|---|---|
| 数据库 | SQLite（`better-sqlite3`，WAL），首次启动自动建表；测试使用内存库 |
| 端口 | API `8787`（读标准环境变量 `PORT`，默认 8787）；Web `5173` |
| 环境变量 | 不新增 `MIM_*`；`.env.example` 仅登记第三方密钥占位（P0 无真实密钥需求） |
| 支付 | 仅 `mock` 驱动：`POST /api/v1/subscriptions/checkout` 传 `driver: 'mock'` 即置 `paid` 并激活订阅 |
| 验证码 | 开发通道在响应中回传 `dev_code`（未接短信/邮件通道） |
| 前端视图 | 仅「套餐」「设置」两页；原 FR-03 项目/任务/仪表盘已于 2026-11-04 移除。重定义后：`catalog` 域 4 表 + `comic` 域 **7 表**（第 1 期 3 表 + 第 2 期 `generation_jobs`/`generation_assets`/`comic_films`/`film_versions` 4 表）已建、`/api/v1/comic/*` 24 条路由已上线（第 1 期 8 条 + 第 2 期任务编排与成片 16 条，拆分见 `docs/wiki/07-functional-modules.md` §12）；第 2 期**已装配上线（2026-11-05）**：`app.ts` 已 import 并挂载 `/api/v1/media/*`（`createMediaRouter` + 免鉴权对象收发 `createMediaObjectRouter`，后者先于全局 `express.json`）与 `/api/v1/ai/*`（`createAiRouter`），`index.ts` 构造 `storage` + `orchestrator` 并在 `MIM_AI_WORKER` 默认开启时 `orchestrator.start()` 自动消费 `generation_jobs`；商城与漫剧前端视图 **0 代码** |
| 模块解锁 | `comic.workbench` 种子行随 `createDatabase()` 自动写入 cn/global 两区；`requireEntitlement('comic.workbench')` 无权益返回 **403 `FEATURE_NOT_AVAILABLE`**，`details` 含 `module_code`、`region` |
| 授权命令 | 生产授予权益：`sqlite3 /opt/mim/app/services/mim-api/data/mim.db "INSERT INTO entitlements (id,user_id,module_id,source,source_id,status,version,created_at,updated_at) VALUES ('ent:<uid>:comic','<uid>',(SELECT id FROM modules WHERE code='comic.workbench' AND region='cn'),'admin',NULL,'active',1,datetime('now'),datetime('now'));"` |

### 6.4 冒烟顺序（HTTP 全链路）

`auth/code → login → me → plans → subscriptions/checkout(basic,mock) → subscriptions/current → orders → invoices → audit`

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
deploy:  scp deploy/deploy.sh → ssh ubuntu@<host> "sudo -n bash /opt/mim/app/deploy/deploy.sh"
         → 校验服务器 HEAD == 本次提交 SHA（不一致即失败）
         → curl https://mim.mixm.top/health（必须 200）
         → curl https://mim.mixm.top/api/v1/plans
```

所需 GitHub Actions secrets：`DEPLOY_SSH_KEY`（部署私钥）、`DEPLOY_HOST`、`DEPLOY_USER`。

```bash
gh secret set DEPLOY_SSH_KEY --body "$(cat ~/.ssh/mim_deploy)"
gh secret set DEPLOY_HOST --body "115.159.159.11"
gh secret set DEPLOY_USER --body "ubuntu"
gh run watch          # 观察最近一次运行
```

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
sudo -n bash /opt/mim/app/deploy/deploy.sh     # 手动重放发布（git reset → install → build → 发布 → 健康轮询）
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
