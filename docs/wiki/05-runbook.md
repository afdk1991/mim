# 05 · 项目运行方式

> 仓库已是可运行的 pnpm Monorepo：`services/mim-api`（后端，8787）与 `apps/web`（Web 端，5173）构成 P0 功能产品；另有 `scripts/` 下三项仓库级脚本（版本校验、密钥模板校验、站点构建）。本页覆盖启动、测试、构建与校验的完整命令。

## 1. 前置条件

| 依赖 | 必要性 | 检查命令 |
|---|---|---|
| Node.js（≥ 18，实测 v22.23.3） | **必需** | `node --version` |
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
pnpm --filter @mim/api test             # vitest + supertest，18 例契约测试
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
| 增量同步 | 前端每 4 秒 `GET /api/v1/sync/changes?project_id=&since_seq=` |

### 6.4 冒烟顺序（HTTP 全链路）

`auth/code → login → projects → tasks → dashboard → sync → checkout(basic,mock) → subscriptions/current → exports(csv) → orders → invoices`。CSV 导出需 `basic` 及以上套餐（免费版返回 `FEATURE_NOT_AVAILABLE`），因此必须先 checkout。

## 7. 站点与构建（PRD 可视化，本地预览）

> **定位**：`apps/web` + `services/mim-api` 是功能产品；`site/` 仍只是 PRD 的可视化阅读载体，**不作为线上产品部署、不绑定生产域名**。

### 7.1 本地构建（可选）

```bash
npm run build    # scripts/build.mjs 把 site/ 复制到 dist/
npm run check    # version-check + env-check（退出码 0 = 通过）
```

构建产物 `dist/index.html` + `dist/prd.html` 可本地双击打开，或用任意静态服务器预览。

### 7.2 不涉及的动作

- 不把 `site/` 部署到线上静态托管（`.edgeone/` 配置已移除）；功能前端用 `apps/web` 的 Vite 产物另行部署。
- 不绑定 `data.mixm.top` 等生产域名（当前无生产部署）。
- 线上域名归属与实际功能代码的部署由独立的应用仓库负责，不在本仓库范围内。
