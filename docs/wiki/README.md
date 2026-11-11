# Mim Code Wiki

> Mim 全平台产品底座仓库的结构化文档。本 Wiki 基于仓库当前实际内容生成，覆盖整体架构、模块职责、代码说明、依赖关系与运行方式。

## 项目一句话概述

Mim 是一个**已具备 P0 可运行功能**的全平台产品底座仓库：目标架构为「Headless 中台 + 多端薄壳」，当前已落地 **pnpm Monorepo**（`apps/web` React 端 + `services/mim-api` Express/SQLite 后端 + `packages/core-domain` / `packages/i18n` 共享包），实现 FR-01 账号身份与漫剧 AI 剧工作台（FR-03 重定义版）的 P0 最小集；同时保留协作治理体系（AGENTS.md 十二条铁律；项目名称 Mim）、版本规约校验脚本与产品需求文档。

- 当前版本：**V0.0.0-preview**（预览通道，正式版 V0.0.0 未发布）
- 仓库性质：**pnpm workspace Monorepo**（`apps/*` + `services/*` + `packages/*`）
- 第三方运行时依赖：React / Express / zod / jsonwebtoken / bcryptjs / better-sqlite3 等（完整清单与版本见 [04-dependencies.md](./04-dependencies.md) §1；规划中的 SDK 见 [09](./09-third-party-sdk-inventory.md)）

## Wiki 地图

| 文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 项目整体架构：仓库现状分层 + PRD 目标产品架构 |
| [02-modules.md](./02-modules.md) | 主要模块/文件职责清单（含 apps/services/packages 实况） |
| [03-code-reference.md](./03-code-reference.md) | 仓库级脚本说明：`scripts/version-check.mjs`（§1–§6）与 `scripts/env-check.mjs`（§7）；另有 `serve-local.mjs` / `verify-film-export.mjs` 本地浏览器真渲染验证链（见 [08 §1.2](./08-dev-implementation.md)）；业务代码见 08 |
| [04-dependencies.md](./04-dependencies.md) | 依赖关系（已安装依赖 / 工具链 / 规划中能力） |
| [05-runbook.md](./05-runbook.md) | 运行方式：启动 API/Web、测试、构建、校验命令 |
| [06-governance.md](./06-governance.md) | 治理规约：十二条铁律与版本号规则详解（含铁律十二远程仓库 / 生产终点） |
| [07-functional-modules.md](./07-functional-modules.md) | 功能模块：PRD FR-01~06 需求、状态机、共享规则、实现状态 |
| [08-dev-implementation.md](./08-dev-implementation.md) | 开发实现全景：目标架构 + §1.1「已实现 vs 规划」对照 |
| [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) | 第三方 SDK / API / API Key 全量清单（含北斗卫星导航专项） |
| [10-comic-state-machines.md](./10-comic-state-machines.md) | 漫剧模块完整状态机：comic_projects / generation_jobs / comic_films 三套状态机、24 条路由转移对照、冒烟链路 |
| [../security-default-config-audit-20261108.md](../security-default-config-audit-20261108.md) | 后台默认配置安全自查（2026-11-08）：G1–G14 逐项、六类分系统、资产台账、P0/P1/P2、留档模板 |
| [../routing-url-hash-audit-20261108.md](../routing-url-hash-audit-20261108.md) | 线上域名访问地址与路由模式诊断（2026-11-08）：为何所有功能模块统一带 `/#`、四层根因取证、13 项域名台账、路径差异对照、改造清单与 V1–V12 验证标准 |
| [../rewrite-vs-refactor-decision.md](../rewrite-vs-refactor-decision.md) | 现有模块「重新开发 vs 保留结构梳理」决策与实施方案（2026-11-09）：六维判定框架与硬门槛、模块 A 完整实现、B1–B14 行为冻结清单、调整项与验证矩阵、缺失上下文清单 |
| [../站点模块开发落地说明-20261109.md](../站点模块开发落地说明-20261109.md) | v1「站点模块矩阵」开发交付说明（2026-11-09）：45 模块 / 135 功能点 / 7 端点 / 14 例测试 / 43 项校验、U1–U8 未决项 |
| [../统一入口配置清单与模块化实现说明-20261109.md](../统一入口配置清单与模块化实现说明-20261109.md) | **本轮**统一入口配置清单交付说明（2026-11-09 23:35）：去重整理 / 可配置占位标识 / 19 业务域 / 职责边界与关联 / 79+23 项校验 / 15 文件 211 例测试 / U1–U7 未决项 |
| [../统一入口配置清单-20261109.md](../统一入口配置清单-20261109.md) | 可读清单全表：44 入口 × 9 列（核心功能 / 职责边界 / 后台接口职责 / 相似模块关联与区分），另附落地状态四态（已落地 / 部分相邻 / 规划中 / 语义冲突） |
| [../站点入口契约落地说明-20261109.md](../站点入口契约落地说明-20261109.md) | 上一轮「站点入口契约」交付说明（仅登记、43 类未决），与本轮开发成果并存 |

## 仓库速览

> **现状标注（2026-11-09）**：下方树中的 `deploy/`、`site/` 已于 2026-11-08 从工作树移除（删除未提交），保留原树形作历史留痕；`.github/workflows/deploy.yml` 仍在库且引用已删脚本。当前状态基线见 [AGENTS.md §0](../../AGENTS.md)，CI 悬空引用清单见 [梳理决策文档](../rewrite-vs-refactor-decision.md) §2.3-C。

```
f:\合并项目\Mim
├── AGENTS.md                      # 协作铁律（12 条，最高优先级约束）
├── README.md                      # 项目入口、版本规约、运行命令
├── Mim-PRD.html                   # 产品需求文档（V0.0.0-preview 草案，含交互演示）
├── team-hiring-plan.md            # 技术架构约束分析与团队分阶段配置规划
├── package.json                   # 根 workspace 脚本（dev/test/typecheck/build/check）
├── pnpm-workspace.yaml            # workspace 边界（apps/* services/* packages/*）
├── pnpm-lock.yaml                 # 依赖锁文件
├── tsconfig.base.json             # 共享 TypeScript 编译基线
├── .env.example                   # 第三方 SDK / API 密钥占位模板（仅空值）
├── .gitignore                     # .env 永不入库，.env.example 反向豁免
├── 全平台小程序开发与分发-*.txt    # 参考调研：小程序全平台开发与分发
├── 全栈项目人员配置指南-*.txt      # 参考调研：全栈团队岗位与编制
├── apps/
│   └── web/                       # Web 端（React 18 + Vite 6，5173；views/ 六个视图，含 Sites.tsx 统一入口配置清单）
├── services/
│   └── mim-api/                   # 后端 API（Express 5 + SQLite WAL + JWT + zod，8787）+ test/（15 文件）
├── packages/
│   ├── core-domain/               # 错误码 / UUIDv7 / 统一入口配置清单（errors.ts / ids.ts / siteModules.*）
│   └── i18n/                      # zh-CN / en-US 文案与货币格式化
├── docs/wiki/                     # 本 Wiki 全部文档（01~10）
├── deploy/                        # 生产部署工件（bootstrap / deploy / nginx / systemd / backup-db / migrations / sealos / iga）
├── .github/workflows/deploy.yml   # CI/CD：push main 自动上线 https://mim.mixm.top
├── scripts/
│   ├── version-check.mjs          # 铁律四版本规约校验器
│   ├── env-check.mjs              # 09 清单 §0 密钥模板校验器
│   ├── comment-check.mjs          # 铁律十一注释覆盖率校验器（基线 / --strict）
│   └── build.mjs                  # 默认：apps/web/dist → dist/（真实前端）；--site：site/ → dist/（PRD 离线。
└── site/                          # PRD 可视化载体（离线副本，非生产站点）
```

## 阅读建议

- 想了解**项目要做什么** → 先读 [01-architecture.md](./01-architecture.md) 的「目标产品架构」一节
- 想了解**产品要交付哪些功能、已实现到什么程度** → 读 [07-functional-modules.md](./07-functional-modules.md)
- 想了解**漫剧工作台三套状态机与 24 条路由转移** → 读 [10-comic-state-machines.md](./10-comic-state-machines.md)
- 想了解**开发怎么落地 / 当前代码与规划差在哪** → 读 [08-dev-implementation.md](./08-dev-implementation.md) §1.1
- 想了解**仓库里现在有什么** → 读 [02-modules.md](./02-modules.md)
- 想**启动应用 / 跑测试 / 跑校验** → 读 [05-runbook.md](./05-runbook.md) §6
- 想**部署上线 / 查生产状态** → 读 [05-runbook.md](./05-runbook.md) §7（生产：<https://mim.mixm.top>）
- 想**一次性核对所有部署仓库与部署项的效果 / 结果 / 异常** → 读 [../deployment-summary.md](../deployment-summary.md) 与 [05-runbook.md](./05-runbook.md) §8（生成器 + 52 项校验 + `/deployments` 视图）
- 要**修改或运行校验脚本** → 读 [03-code-reference.md](./03-code-reference.md) + [05-runbook.md](./05-runbook.md)
- 要**查第三方 SDK / API / Key** → 读 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)（占位模板见根目录 `.env.example`；改完跑 `node scripts/env-check.mjs` 校验一致性）
- 在本仓库内**做任何协作改动前** → 必读 [06-governance.md](./06-governance.md)
