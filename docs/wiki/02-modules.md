# 02 · 主要模块职责

> 按仓库当前实际文件逐一说明。仓库已是 pnpm workspace Monorepo：`apps/web`（Web 端）、`services/mim-api`（后端 API）、`packages/core-domain` 与 `packages/i18n`（共享包）、`scripts/`（校验与构建脚本）、`site/`（PRD 可视化载体）。本页侧重资产与职责全景，业务代码细节见 [08-dev-implementation.md](./08-dev-implementation.md)。

## 模块清单总表

| 模块 | 类型 | 职责 | 关键产出 |
|---|---|---|---|
| `AGENTS.md` | 治理 | 定义 7 条协作铁律，对所有 AI 协作者与 CI 有强制约束力 | 行为边界与优先级冲突裁决规则 |
| `README.md` | 治理 | 项目入口；版本号规约、仓库结构、运行命令 | 版本展示约定 `V0.0.0-preview` + Monorepo 运行指引 |
| `services/mim-api` | 业务代码（后端） | Express 5 + SQLite（WAL）+ JWT + zod 的 Headless API（`/api/v1`）；**功能模块清单见 [07 §11](./07-functional-modules.md#11-功能模块落地对照表p0仓库实况)** | 18 例契约测试通过；端口 8787 |
| `apps/web` | 业务代码（前端） | React 18 + Vite 5 的 Web 端薄壳（4s 轮询增量同步 + 401 自动刷新）；**功能模块清单见 [07 §11](./07-functional-modules.md#11-功能模块落地对照表p0仓库实况)** | 端口 5173；`vite build` 产物 |
| `packages/core-domain` | 共享包 | 错误码、套餐与 features、权限、任务层级、金额、UUIDv7 | 前后端共用单一事实源 |
| `packages/i18n` | 共享包 | zh-CN / en-US 文案、`t()` 回退链、`formatCurrency` | 双语与货币格式化 |
| `scripts/version-check.mjs` | 可执行代码 | 铁律四（版本规约）的强制校验器 | 退出码 0/1，供人工与 CI 调用 |
| `scripts/env-check.mjs` | 可执行代码 | 09 清单 §0（密钥治理硬约束）的自动校验器 | 退出码 0/1；校验 `.env.example` ↔ 09 清单 ↔ `.gitignore` 一致性 |
| `scripts/build.mjs` | 可执行代码 | 静态站点构建脚本：把 `site/` 递归复制到 `dist/`（本地预览） | `dist/index.html` + `dist/prd.html`，供 `npm run build` 调用 |
| `package.json`（根） | 配置 | workspace 脚本入口（`dev` / `test` / `typecheck` / `build` / `check`）；`packageManager: pnpm@9.12.0`；版本号 `0.0.0` 为 `version-check.mjs` 的校验源 | 零 dependencies，脚本转发到各 workspace |
| `pnpm-workspace.yaml` / `pnpm-lock.yaml` / `tsconfig.base.json` | 配置 | 声明 `apps/*`、`services/*`、`packages/*`；锁定依赖版本；共享 TS 编译基线 | 可复现安装与类型检查 |
| `Mim-PRD.html` | 产品规划 | 全平台产品底座 PRD（草案） | FR-01~06 功能需求、对象模型、开放问题 |
| `team-hiring-plan.md` | 技术/组织规划 | 约束→编制→分阶段落地→风险→成本 | 22–32 人全配 / 14–18 人最小可行方案 |
| `.env.example` | 配置模板 | 第三方 SDK / API 密钥占位模板（全空值，禁止填入真实密钥后提交） | `MIM_<领域>_<提供方>_<密钥类型>` 命名基线，与 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) 一一对应 |
| `.gitignore` | 配置 | 版本库忽略规则：确保含真实密钥的 `.env` 永不入库，同时反向豁免 `.env.example` | `.env` / `.env.local` / `.env.*.local` 忽略 + `!.env.example` 豁免 |
| `全平台小程序开发与分发-20261028181941.txt` | 参考调研 | 小程序全平台架构、合规、分发、Monorepo 骨架 | IPlatformAdapter 契约设计参考 |
| `全栈项目人员配置指南-20261022184502.txt` | 参考调研 | 岗位清单、JD、负责人方法论 | 岗位三档与 CTO 仪表盘参考 |
| `site/index.html` | 静态站点（本地预览） | Mim 落地页（零外部依赖，内联 CSS/JS） | 本地预览产物 |
| `site/prd.html` | 静态站点（本地预览） | `Mim-PRD.html` 的站点副本，供浏览器直接查阅 PRD | 本地预览 `/prd.html` |
| `.screenshots/` | 资产暂存 | 截图存放（当前为空，仅含 `.tmp`） | — |
| `docs/wiki/*.md` | 文档 | 结构化 Wiki（01~09 共 9 篇 + 首页 README）：架构、模块、代码参考、依赖、运行、治理、功能、开发实现、第三方清单 | 与仓库资产一一对应的唯一文档入口 |

## 1. AGENTS.md — 协作铁律（最高优先级）

七条铁律的层级关系：

1. **铁律一（最高位）**：AI 负责执行，不得把「请你提供/请你操作」作为唯一推进路径；说「不可达」必须附取证证据。仅当外部服务需用户私有 OAuth/SSH 凭证时才可请求用户提供，且须附已尝试证据
2. **铁律二**：可逆操作直接做；不可逆/结构性操作先出计划 + 影响清单，获授权后执行
3. **铁律三**：一切结论基于命令输出/文件改动证据
4. **铁律四**：版本号规约（详见 [06-governance.md](./06-governance.md)），由 `version-check.mjs` 强制
5. **铁律五**：通用能力优先引入成熟第三方依赖，禁止 vendor 复制源码；依赖须登记名称/版本/用途
6. **铁律六**：全角色全流程自动化——AI 承担所有人员职责，覆盖写码/补全/修复/梳理/BUG 排查/代码检查，每轮交付前必须检查
7. **铁律七**：功能模块增删必须全量同步全部受影响工件，交付报告附同步清单

**冲突裁决**：铁律五与铁律一冲突时（如沙箱无网络），执行优先，允许本地实现但必须在交付报告标注「已偏离铁律五」及理由。

## 2. scripts/ 下的可执行脚本

除业务代码（`services/mim-api`、`apps/web`）外的仓库级脚本，均零第三方依赖、仅用 Node 内置模块，以退出码或产物供人工与 CI 调用。

### 2.1 scripts/version-check.mjs — 版本校验器

铁律四的落地工具，四项检查：

1. 版本号来源探测与 semver 格式校验（`package.json` → `VERSION` 文件）
2. `RELEASE_CHANNEL` 环境变量合法性（仅 `preview` / `draft` / `test`）
3. git tag 命名规范（正式 `V<semver>` vs 内部 `draft-*` / `pre-*`）
4. 通道感知：预览通道下若已存在正式 `V<semver>` tag 则判违规

完整函数级说明见 [03-code-reference.md](./03-code-reference.md)，运行方式见 [05-runbook.md](./05-runbook.md)。

### 2.2 scripts/env-check.mjs — 密钥模板校验器

09 清单 §0（密钥治理三条硬约束）的落地工具，八项检查：

1. `.env.example` 存在性 + 变量去重
2. 模板全部为空值占位（只打印变量名，不回显值）
3. 清单 → 模板：09 清单登记的 `MIM_*` 变量是否全部落位
4. 通配符项（如 `MIM_PAY_STRIPE_PRICE_ID_*`）是否被模板中的展开项覆盖
5. 模板 → 清单：是否存在清单外的「先接入后登记」违规变量
6. `MIM_` 命名前缀合规
7. `.gitignore` 是否忽略 `.env`，且保留 `!.env.example` 反向豁免
8. 本地 `.env` 存在性探测（只探测存在性，绝不读取内容）

与 `version-check.mjs` 的差异：本脚本**不调用 git**，只读三个本地文件（`.env.example`、09 清单、`.gitignore`）。完整说明见 [03-code-reference.md](./03-code-reference.md) §7。

## 3. Mim-PRD.html — 产品需求文档

自包含 HTML（含交互演示控件），结构：

| 章节 | 内容 |
|---|---|
| §1–2 背景与产品契约 | 问题观察 →「Headless 中台 + 多端薄壳」决策；用户/任务/完成条件/共享对象/信任基础 |
| §3 范围 | P0 / P1 / 明确排除三档 + 平台兼容性要求矩阵（三端最低版本） |
| §4 角色与对象模型 | 4 角色；Subscription 与 Order 状态机 |
| §5 功能需求 | FR-01 账号身份、FR-02 订阅支付、FR-03 核心 SaaS 工作区（跨端任务与轻协作工具，OQ-01 已定案）、FR-04 多端一致性、FR-05 国际化、FR-06 合规隐私 |
| §6 共享规则 | Region 隔离、幂等性（request_id）、审计日志（180 天）、通知规则 |
| §7 开放问题 | OQ-01~06（OQ-01 已定案为跨端任务与轻协作工具；余项：国内 Android IAP、首批市场、退款窗口、账号合并、IoT） |

内置两个交互演示：FR-01 登录流程演示、FR-02 订阅计划与支付演示（基础版 ¥29/月、专业版 ¥99/月）。

## 4. team-hiring-plan.md — 技术与团队规划

- 三条硬约束的成本解读（原生端/音视频/硬件各为独立工种；后端自研 4–7 人；中台三死法与正确顺序）
- 编制表：全配 22–32 人、最小可行 14–18 人；配比红线（开发:测试 ≥ 5:1，前端:后端 ≈ 1.8:1，中台:前台 ≤ 1:3）
- 分阶段落地（8–10 → 14–18 → 22+）
- 五个特有坑：音视频合规牌照、硬件认证周期、四套发布管道兼容性契约、带宽成本指标归属、中台 KPI 定义
- 成本：最小版月 40–60 万、全配月 70–110 万；省钱杠杆五条

## 5. 两份参考调研 txt

均为多轮问答沉淀的调研记录（`## user` / `## assistant` 分段），作为 PRD 与团队规划的论据来源，**不承担可执行职能**：

- **小程序开发与分发**：分层架构 → 全平台边界 → 合规资质 → 工程化发布 → Monorepo（pnpm + Turborepo）→ 能力网关接口 → 多端 Adapter → 双环境部署拓扑 → 12 个月里程碑 → 契约测试代码骨架
- **人员配置指南**：岗位三档 → 分阶段配置 → 成本粗估 → CTO 评价标准/90 天清单/不可委托清单/风险登记册 → 各岗位 JD

## 6. 模块间依赖关系

```
AGENTS.md (铁律四) ──强制──> scripts/version-check.mjs ──校验──> package.json / VERSION(未来) + git tags
AGENTS.md (铁律七) + 09清单§0 ──强制──> scripts/env-check.mjs ──校验──> .env.example ↔ 09清单 ↔ .gitignore
README.md ──引用──> AGENTS.md + version-check.mjs + env-check.mjs
Mim-PRD.html ◂──论据── 两份 txt 调研
team-hiring-plan.md ◂──论据── 全栈项目人员配置指南 txt
docs/wiki/README.md ──索引──> docs/wiki/01~09（其中 08 引用 07/01，09 引用 04）
09-third-party-sdk-inventory.md ──密钥占位──> .env.example（变量名一一对应）
package.json (build) ──调用──> scripts/build.mjs ──复制──> dist/（本地预览，非生产部署）
```

代码层依赖已按 `packages/*` / `services/*` / `apps/*` 分层落地，唯一必须遵守的方向约束是「共享包不反向依赖应用」。依赖清单与版本见 [04-dependencies.md](./04-dependencies.md) §1。

## 7. site/、构建脚本与业务代码 — 本地预览 vs 功能产品

> 本仓库已是**可运行的功能产品底座**（`apps/web` + `services/mim-api`）。`site/` 与构建脚本仅用于本地预览 PRD，**不作为线上产品部署、不绑定生产域名**。

| 文件 | 说明 |
|---|---|
| `apps/web` + `services/mim-api` | 实际功能代码，运行方式见 [05-runbook.md](./05-runbook.md) §6 |
| `site/index.html` | Mim 落地页（PRD 的可视化入口），单文件自包含，本地双击可打开 |
| `site/prd.html` | `Mim-PRD.html` 的站点副本，供浏览器阅读，内容与根目录 PRD 一致 |
| `package.json` | 版本号 `0.0.0`（`version-check.mjs` 校验源）；`build` 脚本调用 `scripts/build.mjs`；`dev` / `test` / `typecheck` 转发到 workspace |
| `scripts/build.mjs` | 把 `site/` 递归复制到 `dist/`，零依赖，仅用于本地构建验证 |

两个 HTML 均**不含业务密钥**。生产域名（如 `data.mixm.top`）不归本仓库所有，线上功能代码的部署由独立应用仓库负责。
