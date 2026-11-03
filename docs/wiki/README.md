# Mim Code Wiki

> Mim 全平台产品底座仓库的结构化文档。本 Wiki 基于仓库当前实际内容生成，覆盖整体架构、模块职责、代码说明、依赖关系与运行方式。

## 项目一句话概述

Mim 是一个处于**治理与规划阶段**的全平台产品底座仓库：目标架构为「Headless 中台 + 多端薄壳」（Web / 小程序 / iOS / Android / PC，国内 + 出海双市场），当前仓库内已落地的是**协作治理体系（AGENTS.md 七条铁律）+ 版本规约强制校验脚本 + 产品需求文档（PRD）+ 团队与技术规划文档**，产品业务代码尚未开始编写。

- 当前版本：**V0.0.0-preview**（预览通道，正式版 V0.0.0 未发布）
- 仓库性质：单包仓库（尚无 monorepo 结构，无 package.json）
- 第三方运行时依赖：**零**（计划引入的 SDK / API 清单见 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)）

## Wiki 地图

| 文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 项目整体架构：仓库现状分层 + PRD 目标产品架构 |
| [02-modules.md](./02-modules.md) | 主要模块/文件职责清单 |
| [03-code-reference.md](./03-code-reference.md) | 关键代码说明：`scripts/version-check.mjs`（§1–§6）与 `scripts/env-check.mjs`（§7）全部函数与流程 |
| [04-dependencies.md](./04-dependencies.md) | 依赖关系（运行时 / 工具链 / 规划中） |
| [05-runbook.md](./05-runbook.md) | 项目运行方式：校验命令、环境变量、退出码 |
| [06-governance.md](./06-governance.md) | 治理规约：七条铁律与版本号规则详解 |
| [07-functional-modules.md](./07-functional-modules.md) | 功能模块：PRD FR-01~06 需求、状态机、共享规则与开放问题 |
| [08-dev-implementation.md](./08-dev-implementation.md) | 开发实现全景（规划草案）：数据库表、前后端服务、存储、后台管理平台 |
| [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) | 第三方 SDK / API / API Key 全量清单（含北斗卫星导航专项） |

## 仓库速览

```
f:\合并项目\Mim
├── AGENTS.md                      # 协作铁律（7 条，最高优先级约束）
├── README.md                      # 项目入口、版本规约摘要
├── Mim-PRD.html                   # 产品需求文档（V0.0.0-preview 草案，含交互演示）
├── team-hiring-plan.md            # 技术架构约束分析与团队分阶段配置规划
├── .env.example                   # 第三方 SDK / API 密钥占位模板（仅空值，密钥不入库）
├── .gitignore                     # 版本库忽略规则（.env 永不入库，.env.example 反向豁免）
├── 全平台小程序开发与分发-*.txt    # 参考调研：小程序全平台开发与分发
├── 全栈项目人员配置指南-*.txt      # 参考调研：全栈团队岗位与编制
├── docs/wiki/                     # 本 Wiki 全部文档（01~09）
├── scripts/
│   ├── version-check.mjs          # 铁律四版本规约校验器
│   └── env-check.mjs              # 09 清单 §0 密钥模板校验器
└── .screenshots/                  # 截图暂存目录（当前为空）
```

## 阅读建议

- 想了解**项目要做什么** → 先读 [01-architecture.md](./01-architecture.md) 的「目标产品架构」一节
- 想了解**产品要交付哪些功能** → 读 [07-functional-modules.md](./07-functional-modules.md)
- 想了解**开发怎么落地（数据库表 / 后端服务 / 多端前端 / 存储 / 后台管理平台）** → 读 [08-dev-implementation.md](./08-dev-implementation.md)（规划草案）
- 想了解**仓库里现在有什么** → 读 [02-modules.md](./02-modules.md)
- 要**修改或运行校验脚本** → 读 [03-code-reference.md](./03-code-reference.md) + [05-runbook.md](./05-runbook.md)
- 要**查第三方 SDK / API / Key** → 读 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)（占位模板见根目录 `.env.example`；改完跑 `node scripts/env-check.mjs` 校验一致性）
- 在本仓库内**做任何协作改动前** → 必读 [06-governance.md](./06-governance.md)
