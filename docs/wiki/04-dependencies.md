# 04 · 依赖关系

## 1. 当前实际依赖（证据：各 workspace 的 `package.json` + `pnpm-lock.yaml`）

Monorepo 由 **pnpm workspace** 管理（`pnpm-workspace.yaml` 覆盖 `apps/*`、`services/*`、`packages/*`）。根 `package.json` **零 `dependencies`**，只承担脚本入口与版本号来源；依赖按包就近声明，锁文件为根目录 `pnpm-lock.yaml`（唯一锁文件，原有 npm `package-lock.json` 已删除）。

### 1.1 后端 `services/mim-api`

| 依赖 | 版本 | 类型 | 用途 |
|---|---|---|---|
| `express` | ^5.3.0 | 运行时 | HTTP 服务与路由（`/api/v1`） |
| `zod` | ^4.6.7 | 运行时 | 请求体/查询参数校验（`validate.ts` 统一 `parse`） |
| `jsonwebtoken` | ^9.0.3 | 运行时 | JWT 访问令牌 + refresh 轮换 |
| `bcryptjs` | ^3.0.2 | 运行时 | 密码哈希（global 邮箱密码登录） |
| `better-sqlite3` | ^13.0.3 | 运行时 | 嵌入式 SQLite 持久化（单库替代 PostgreSQL 规划） |
| `@mim/core-domain` | workspace:* | 运行时 | 领域层：套餐、状态机、权限、任务层级、金额、错误码 |
| `@mim/i18n` | workspace:* | 运行时 | 错误码与文案的双语映射 |
| `vitest` | ^2.1.9 | 开发 | 测试框架 |
| `supertest` | ^7.1.4 | 开发 | HTTP 契约测试 |
| `tsx` | ^4.20.6 | 开发 | TS 直接运行（`dev` / `start`） |
| `typescript` | ^5.6.3 | 开发 | 类型检查（`tsc --noEmit`） |
| `@types/better-sqlite3` / `@types/express` / `@types/jsonwebtoken` / `@types/node` / `@types/supertest` | 见 package.json | 开发 | 类型声明 |

### 1.2 前端 `apps/web`

| 依赖 | 版本 | 类型 | 用途 |
|---|---|---|---|
| `react` / `react-dom` | ^18.3.1 | 运行时 | 工作区 UI |
| `@mim/core-domain` | workspace:* | 运行时 | 套餐 features 与金额格式化复用 |
| `@mim/i18n` | workspace:* | 运行时 | 双语文案与 `formatCurrency` |
| `vite` | ^5.4.11 | 开发 | 构建与 dev server（端口 5173，代理 `/api` `/health` → 8787） |
| `@vitejs/plugin-react` | ^4.3.4 | 开发 | React 插件 |
| `typescript` | ^5.6.3 | 开发 | 类型检查 |
| `@types/react` / `@types/react-dom` | 见 package.json | 开发 | 类型声明 |

### 1.3 共享包 `packages/*`

| 包 | 运行时依赖 | 开发依赖 | 说明 |
|---|---|---|---|
| `@mim/core-domain` | 无 | `typescript` ^5.6.3 | 纯 TS 源码，经 `exports` 直接引用，不产出构建物 |
| `@mim/i18n` | 无 | `typescript` ^5.6.3 | 同上；词典内置，无 i18n 第三方框架 |

### 1.4 根工具链

| 项 | 版本 | 用途 |
|---|---|---|
| `pnpm` | `9.12.0`（`packageManager` 固定） | workspace 安装/过滤运行；锁文件 `pnpm-lock.yaml` |
| Node.js | 声明 `>=18`（实测 `v22.23.3`） | 运行与测试 |
| `git` CLI | 可选 | 仅 `scripts/version-check.mjs` 的 tag 校验段需要；缺失时该段降级跳过 |

两个校验脚本（`version-check.mjs` / `env-check.mjs`）仍只使用 Node 内置模块：

| 内置模块 | 引入处 | 用途 |
|---|---|---|
| `node:child_process` | `version-check.mjs` 的 `execSync` | 调用 `git rev-parse` / `git tag`（`env-check.mjs` 不使用） |
| `node:fs` | 两个脚本共用 | `version-check.mjs` 探测并读取 `package.json` / `VERSION`；`env-check.mjs` 读取 `.env.example` / 09 清单 / `.gitignore` 并探测 `.env` 存在性 |
| `node:path` | 两个脚本共用 | `join` / `dirname` 拼接定位仓库根与文件路径 |
| `node:url` | 两个脚本共用 | `fileURLToPath` 在 ESM 下还原 `__dirname` |

### 1.5 未引入的依赖（避免误判为已接入）

- **真实支付驱动**：`wechat` / `alipay` / `stripe` 仅存在于接口枚举，未引入任何通道 SDK；P0 只有 `mock` 驱动可用。
- **短信/邮件通道**：验证码走 dev 通道（响应回传 `dev_code`），未接入真实网关。
- **i18n 框架**（如 i18next）、**UI 组件库**、**Turborepo**：均未引入，原因见 §4。
- 规划清单（Appium、Playwright、Ant Design Pro、内容审核服务等）仍为路线图，详见 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)。

## 2. 运行时要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | `>= 18`（根 `engines` 声明；实测 `v22.23.3`） | Express 5 / better-sqlite3 / Vite 5 的最低要求 |
| 包管理器 | `pnpm 9.12.0`（`packageManager` 固定） | 必须使用 pnpm；`pnpm install` 生成 `pnpm-lock.yaml` |
| 操作系统 | 跨平台 | Windows / macOS / Linux 均可；`better-sqlite3` 为原生模块，首次安装需可编译环境（prebuilt 可用时自动下载） |
| 数据库 | 无外部服务 | SQLite 文件随服务启动自动创建（默认落本地 `.data/`，测试用内存库） |
| 端口 | API `PORT`（默认 `8787`）、Web `5173` | 不新增任何 `MIM_*` 环境变量，避免与 09 清单校验冲突 |

## 3. 依赖治理规约（铁律五）

仓库对**未来引入依赖**有强制规则（AGENTS.md 铁律五）：

1. 通用能力（HTTP、日期、加密、日志、测试、UI 组件、解析等）**必须优先引入成熟第三方库**，禁止重复造轮子
2. 所有依赖**显式声明在依赖清单**（`package.json` 等）并同步提交锁文件
3. **禁止 vendor**：不得把第三方源码复制进仓库
4. 交付报告须登记：依赖名称、版本号、用途
5. 例外：确需自研（性能/许可证/环境限制）须说明理由并经用户确认；与铁律一（执行优先）冲突时可临时偏离，但必须在报告中标注「已偏离铁律五」

## 4. 依赖方向：已落地 vs 规划

| 领域 | 规划方案 | 当前状态 | 来源 |
|---|---|---|---|
| Monorepo | pnpm + Turborepo | **pnpm workspace 已落地**；Turborepo **暂缓**（P0 仅 4 个包，无需远端缓存与任务图编排；`pnpm -r typecheck` / `--filter` 已满足） | 小程序调研 txt 第三部分 |
| 端侧架构 | `IPlatformAdapter` 契约 + 契约测试套件，业务层禁止平台判断 | **未落地**：P0 仅 Web 单端，尚无多端差异需要封装 | 小程序调研 txt 第四部分 |
| 支付 | 国内：微信支付/支付宝/银联；海外：Stripe/PayPal；App 数字商品：Apple IAP / Google Play Billing（商店强制） | **仅 `mock` 驱动**；真实通道 SDK 未引入，`driver !== 'mock'` 返回 `PAYMENT_DRIVER_UNAVAILABLE` | PRD FR-02 |
| IM / 音视频 / AI | P0 全部采购第三方驱动，不自研 SFU 与 AI 推理 | **未落地**（P1） | PRD §3 排除项 |
| 推送 | APNs / FCM / 国内厂商通道，平台适配层封装 | **未落地**（截止提醒 `reminders` 仅在 features 中声明） | PRD FR-04 |
| 管理后台 | 直接用 Ant Design Pro / Arco Pro 模板，不定制设计 | **未落地**；仓库无 `apps/admin` | team-hiring-plan.md 省钱杠杆 |
| 测试自动化 | Appium + Playwright | **部分落地**：后端 vitest + supertest 契约测试（18 例）；端到端 UI 自动化未落地 | team-hiring-plan.md |
| 内容审核 | 第三方服务（数美、网易易盾等） | **未落地**（P1） | team-hiring-plan.md 坑 #1 |
| 实时同步 | WebSocket 推送 | **改为 4s 增量轮询**：避免引入 WS 依赖，仍满足「5 秒内可见」；断线由下次轮询补齐 | PRD FR-03 |

### 4.1 规划引入清单的展开位置（与运行实况区分）

> **重要区分**：本文件 §1 记录的是「**已经装进 `package.json` / `pnpm-lock.yaml` 的依赖**」（实况）；§4 记录的是「**能力方向与落地状态**」。**每个具体 SDK / 开放 API / 密钥的提供方、接入形态、用途、env 变量名、优先级与合规要求**，统一登记在 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)，密钥占位模板为仓库根目录 `.env.example`。

- 新增任何第三方能力：先更新 09 清单，再在对应模块编码时按铁律五写入 `package.json` + 锁文件，并回填本文件 §1。
- 北斗卫星导航系统（L1 系统定位 / L2 高精度 / L3 短报文）的接入边界与 PRD IoT 排除口径的处理，见 09 清单 §11。
- 因此「§1 只列已安装依赖」与「09 已有全量规划清单」并不矛盾：前者是实况，后者是待接入基线；`MIM_PAY_WECHAT_*` 等变量存在但对应 SDK 未安装，属预期状态。

## 5. 模块内部依赖图

### 5.1 Monorepo 包依赖（方向 = 上层依赖下层，无环）

```
apps/web (@mim/web)
  ├── react / react-dom
  ├── @mim/core-domain（workspace）
  └── @mim/i18n（workspace）
        └── dev: vite / @vitejs/plugin-react / typescript

services/mim-api (@mim/api)
  ├── express / zod / jsonwebtoken / bcryptjs / better-sqlite3
  ├── @mim/core-domain（workspace）
  └── @mim/i18n（workspace）
        └── dev: vitest / supertest / tsx / typescript / @types/*

packages/core-domain（零运行时依赖，纯 TS 源码）
packages/i18n（零运行时依赖，纯 TS 源码）
```

约束：`packages/*` **不得反向依赖** `apps/*` 或 `services/*`（业务下沉纪律）；`apps/web` 只依赖两个共享包，不直接引入后端依赖。

前端与后端的唯一耦合点是 **HTTP 契约 `/api/v1`**（Vite dev 代理 `/api` → `127.0.0.1:8787`），无共享数据库访问代码，避免绕过服务端鉴权。

### 5.2 校验脚本与文档（工具链层）

```
scripts/version-check.mjs
  ├── node:child_process ──> git CLI（可选，缺失时降级跳过）
  ├── node:fs ──> package.json（可选）/ VERSION（可选）
  ├── node:path / node:url
  └── AGENTS.md 铁律四（规则来源，文档级依赖）

scripts/env-check.mjs
  ├── node:fs ──> .env.example / docs/wiki/09-third-party-sdk-inventory.md / .gitignore
  │               （另以 existsSync 探测本地 .env，只判存在性不读内容）
  ├── node:path / node:url
  ├── AGENTS.md 铁律七 + 09 清单 §0（规则来源，文档级依赖）
  └── 不调用外部进程（无 git 依赖）

README.md ──文档引用──> AGENTS.md, scripts/version-check.mjs, scripts/env-check.mjs
Mim-PRD.html ──论据引用──> 两份调研 txt（单向参考，无代码耦合）
```
