# Mim Code Wiki

> Mim 全平台产品底座仓库的结构化文档。本 Wiki 基于仓库当前实际内容生成，覆盖整体架构、模块职责、代码说明、依赖关系与运行方式。

## 项目一句话概述

Mim 是一个**已具备 P0 可运行功能**的全平台产品底座仓库：目标架构为「Headless 中台 + 多端薄壳」，当前已落地 **pnpm Monorepo**（`apps/web` React 端 + `services/mim-api` Express/SQLite 后端 + `packages/core-domain` / `packages/i18n` 共享包），实现 FR-01 账号身份与漫剧 AI 剧工作台（FR-03 重定义版）的 P0 最小集（原 FR-03 工作区已于 2026-11-04 按用户指令整体移除，套餐 / 订阅 / 支付 / 审计模块于 2026-11-05 随 OQ-01 定案下线）；同时保留协作治理体系（AGENTS.md 八条铁律）、版本规约校验脚本与产品需求文档。

- 当前版本：**V0.0.0-preview**（预览通道，正式版 V0.0.0 未发布）
- 仓库性质：**pnpm workspace Monorepo**（`apps/*` + `services/*` + `packages/*`）
- 第三方运行时依赖：React / Express / zod / jsonwebtoken / bcryptjs / better-sqlite3 等（完整清单与版本见 [04-dependencies.md](./04-dependencies.md) §1；规划中的 SDK 见 [09](./09-third-party-sdk-inventory.md)）

## Wiki 地图

| 文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 项目整体架构：仓库现状分层 + PRD 目标产品架构 |
| [02-modules.md](./02-modules.md) | 主要模块/文件职责清单（含 apps/services/packages 实况） |
| [03-code-reference.md](./03-code-reference.md) | 仓库级脚本说明：`scripts/version-check.mjs`（§1–§6）与 `scripts/env-check.mjs`（§7）；业务代码见 08 |
| [04-dependencies.md](./04-dependencies.md) | 依赖关系（已安装依赖 / 工具链 / 规划中能力） |
| [05-runbook.md](./05-runbook.md) | 运行方式：启动 API/Web、测试、构建、校验命令 |
| [06-governance.md](./06-governance.md) | 治理规约：八条铁律与版本号规则详解 |
| [07-functional-modules.md](./07-functional-modules.md) | 功能模块：PRD FR-01~06 需求、状态机、共享规则、实现状态 |
| [08-dev-implementation.md](./08-dev-implementation.md) | 开发实现全景：目标架构 + §1.1「已实现 vs 规划」对照 |
| [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) | 第三方 SDK / API / API Key 全量清单（含北斗卫星导航专项） |

## 仓库速览

```
f:\合并项目\Mim
├── AGENTS.md                      # 协作铁律（8 条，最高优先级约束）
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
│   └── web/                       # Web 端（React 18 + Vite 6，5173）
├── services/
│   └── mim-api/                   # 后端 API（Express 5 + SQLite，8787）+ test/
├── packages/
│   ├── core-domain/               # 错误码/状态机/UUIDv7
│   └── i18n/                      # zh-CN / en-US 文案与货币格式化
├── docs/wiki/                     # 本 Wiki 全部文档（01~09）
├── deploy/                        # 生产部署工件（bootstrap / deploy / nginx / systemd / backup-db）
├── .github/workflows/deploy.yml   # CI/CD：push main 自动上线 https://mim.mixm.top
├── scripts/
│   ├── version-check.mjs          # 铁律四版本规约校验器
│   ├── env-check.mjs              # 09 清单 §0 密钥模板校验器
│   └── build.mjs                  # site/ → dist/ 离线阅读构建（非生产）
└── site/                          # PRD 可视化载体（离线副本，非生产站点）
```

## 阅读建议

- 想了解**项目要做什么** → 先读 [01-architecture.md](./01-architecture.md) 的「目标产品架构」一节
- 想了解**产品要交付哪些功能、已实现到什么程度** → 读 [07-functional-modules.md](./07-functional-modules.md)
- 想了解**开发怎么落地 / 当前代码与规划差在哪** → 读 [08-dev-implementation.md](./08-dev-implementation.md) §1.1
- 想了解**仓库里现在有什么** → 读 [02-modules.md](./02-modules.md)
- 想**启动应用 / 跑测试 / 跑校验** → 读 [05-runbook.md](./05-runbook.md) §6
- 想**部署上线 / 查生产状态** → 读 [05-runbook.md](./05-runbook.md) §7（生产：<https://mim.mixm.top>）
- 要**修改或运行校验脚本** → 读 [03-code-reference.md](./03-code-reference.md) + [05-runbook.md](./05-runbook.md)
- 要**查第三方 SDK / API / Key** → 读 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)（占位模板见根目录 `.env.example`；改完跑 `node scripts/env-check.mjs` 校验一致性）
- 在本仓库内**做任何协作改动前** → 必读 [06-governance.md](./06-governance.md)
