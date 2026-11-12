# 01 · 项目整体架构

## 1. 仓库现状架构（当前实际形态）

仓库当前是 **pnpm workspace Monorepo**，可运行产品代码 + 治理/规划文档并存，分四层：

```
┌─────────────────────────────────────────────────────────┐
│ 产品代码层（可运行）                                       │
│   apps/web            React 18 + Vite 6 薄壳端（商城/统一入口配置清单/漫剧/IM/设置）│
│   services/mim-api    Express 5 + better-sqlite3 后端（8787） │
│   packages/core-domain 错误码/UUIDv7/统一入口配置清单（errors/ids/siteModules）│
│   packages/i18n       zh-CN / en-US 文案与货币格式化        │
├─────────────────────────────────────────────────────────┤
│ 治理层（强制约束）                                        │
│   AGENTS.md          十二条铁律（执行/授权/证据/版本/依赖/自动化/同步/部署/矩阵/额度/注释/生产）│
│   README.md          项目入口 + 版本规约摘要               │
│   scripts/version-check.mjs   铁律四的版本规约校验器       │
│   scripts/env-check.mjs       09 清单 §0 密钥治理校验器    │
├─────────────────────────────────────────────────────────┤
│ 交付层（生产链路）                                        │
│   deploy/            bootstrap / deploy / nginx / systemd / backup-db / migrations│
│   .github/workflows/deploy.yml  push main 自动上线         │
├─────────────────────────────────────────────────────────┤
│ 规划/参考层                                               │
│   Mim-PRD.html       产品需求文档 V0.0.0-preview（草案）   │
│   team-hiring-plan.md 技术约束分析 + 团队分阶段配置         │
│   docs/wiki/         01~10 项目文档                        │
└─────────────────────────────────────────────────────────┘
```

特征：

- **pnpm workspace Monorepo**（`apps/*` + `services/*` + `packages/*`），根 `package.json` 统一编排 `dev/test/typecheck/build/check` 脚本
- 后端 `services/mim-api`：Express 5 + `better-sqlite3`（WAL）+ JWT + zod，前缀 `/api/v1`，端口 8787
- 前端 `apps/web`：React 18 + Vite 6，`src/api.ts` 统一 HTTP 契约；2026-11-04 已移除 FR-03 全部视图
- 密钥治理载体为根目录 `.env.example`（全空占位）+ `.gitignore`（忽略 `.env`、反向豁免 `.env.example`），一致性由 `env-check.mjs` 自动校验
- 版本号来源：根 `package.json` 的 `version` + `RELEASE_CHANNEL`（预览通道展示 `V0.0.0-preview`，见 [03-code-reference.md](./03-code-reference.md)）

## 2. 目标产品架构（PRD 定义）

PRD（Mim-PRD.html，V0.0.0-preview 草案）确定的核心产品决策是 **「Headless 中台 + 多端薄壳」**：

```
        Web     微信小程序    iOS App   Android App   PC(Win/macOS)
          \        |            |           |             /
           └───────┴──── 薄壳端（仅 UI + 平台 API 适配）──┘
                                  │
              ┌───────────────────┴───────────────────┐
              │        能力网关 / 统一接口层            │
              │  IM · 音视频 · AI · 推送 · 存储         │
              ├───────────────────────────────────────┤
              │        共享业务层（Headless 中台）       │
              │  账号身份 · 数据模型 · 模块权益          │
              ├───────────────────────────────────────┤
              │        驱动层（第三方能力采购）          │
              │  推送通道 · IM · 音视频 · AI 驱动…       │
              └───────────────────────────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │   Region 隔离：国内(cn) / 海外(global)  │
              │   数据物理隔离、分库、数据不出境          │
              └───────────────────────────────────────┘
```

架构要点：

| 维度 | 决策 |
|---|---|
| 业务逻辑归属 | 全部下沉共享层，各端不重复实现业务逻辑 |
| 端侧职责 | 仅 UI 渲染与平台 API 适配（登录/推送/存储/分享 SDK 封装） |
| 旗舰产品形态 | SaaS 工具型 — **功能模块商城 + 漫剧 AI 剧工作室**（OQ-01 已于 2026-11-04 重定义；当前无订阅制计费能力） |
| 首发端 | Web + 微信小程序（国内）；出海以 App + Web 切入 |
| 平台兼容下限 | P0：iOS 15.0+、Android 9.0+、微信小程序、Windows 10/11、macOS 12+；P1：支付宝/抖音/百度/QQ 小程序、Ubuntu 20.04+（PRD §3「平台兼容性要求」矩阵） |
| 重资产能力 | IM/音视频/AI **P0 全部采购第三方驱动**，不自研 SFU 与 AI 推理 |
| 双市场 | 国内/海外双登录体系、region 维度数据物理隔离 |
| 一致性契约 | 账号跨端实时同步、统一 i18n 文案、统一错误码映射、Design Token 统一设计系统 |

## 3. 核心领域模型（PRD §4）

共享业务对象：`User`（用户）、`Account`（账号）、`Module`（功能模块）、`Entitlement`（模块权益）、`ComicProject`（漫剧工程）、`GenerationJob`（生成任务）、`ComicFilm`（成片）。


**角色**：访客 / 免费用户 / 运营管理员（RBAC 管理后台属 P1）。

## 4. P0 范围与边界（PRD §3）

- **P0 必须交付**：账号与身份（双登录体系）、核心 SaaS 工作区（2026-11-04 重定义为**功能模块商城 + 漫剧 AI 剧**，拆分见 [07-functional-modules.md](./07-functional-modules.md) §12）、多端一致性、i18n 基础、合规与隐私；兼容性下限 iOS 15.0+ / Android 9.0+ / Windows 10–11 / macOS 12+。
- **P1 后续迭代**：IM、音视频、AI 编排、内容管理、开放平台、管理后台、更多小程序平台（支付宝、抖音、百度、QQ 等）/鸿蒙/Linux（Ubuntu 20.04+）
- **明确排除**：社交关系链、电商交易系统、硬件 IoT（Assumption）、自研音视频 SFU 与 AI 推理

## 5. 团队与落地阶段（team-hiring-plan.md）

技术约束（原生端重度交互 + 音视频 + 硬件 + 中台）决定的规模测算：

| 阶段 | 时间窗 | 人数 | 关键动作 |
|---|---|---|---|
| 跑通一端 | 0–6 月 | 8–10 | 中台**只做规范不做团队**（API/错误码/账号模型/埋点四份文档） |
| 补平台与第二入口 | 6–15 月 | 14–18 | 抽 2 人转岗成立平台组（账号中心 + 网关 + 组件库） |
| 中台正式化 | 15 月+ | 22+ | 第二条业务线出现时中台扩至 4–6 人 |

核心告诫：中台可以安全延后 6–12 个月；硬件与音视频一天都不能延后。中台失败三死法：空转、错位（KPI 冲突）、过度抽象。

## 6. 参考调研文档定位

- **全平台小程序开发与分发**：分层架构、全平台边界、合规资质前置项、工程化发布；含 Monorepo（pnpm + Turborepo）目录结构、能力网关接口定义、`IPlatformAdapter` 契约与契约测试、Web/微信小程序双端实现骨架
- **全栈项目人员配置指南**：岗位三档清单、分阶段配置、成本粗估、CTO 90 天交付清单与不可委托决策清单

## 7. 开发实现视图（规划口径）

架构的「怎么落地」单独成页，避免与产品需求文档混淆口径：

| 文档 | 覆盖 |
|---|---|
| [08-dev-implementation.md](./08-dev-implementation.md) | 开发分层、后端 12 个服务、数据库表结构与约束、多端前端模块、存储分级、后台管理平台 RBAC（**规划草案，非已实现代码**） |
| [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) | 第三方 SDK / 开放 API / 密钥命名全量清单（含北斗卫星导航专项） |
| [07-functional-modules.md](./07-functional-modules.md) | 产品功能视角（FR-01~06、状态机、共享规则、开放问题） |

以上两页均为规划口径，落地时必须随代码同步修订（铁律七）。

## 8. 部署汇总（2026-11-09 新增）

架构定位：**只读运维视图**，不属于业务领域模型，不新增数据库表、不产生写操作。链路为「单一事实源 → 共享包 → 后端 API → 前端视图 / 结构化产物」：

| 层 | 工件 | 职责 |
|---|---|---|
| 数据 | `packages/core-domain/src/deploymentRegistry.json` | 9 矩阵平台 / 11 规范部署项 / 5 CI 作业 / 2 git 远端 / 6 候选排除项；统一 `snake_case` 字段 |
| 共享包 | `packages/core-domain/src/deploymentRegistry.ts` | 类型约束、id 索引、五类过滤、`deploymentSummary()` 分布统计 |
| 后端 | `services/mim-api/src/routes/deployments.ts` | `GET /deployments/overview`、`GET /deployments`、`GET /deployments/:id`，全部公开只读 |
| 前端 | `apps/web/src/views/Deployments.tsx` | 只保留 8 列核对表（规范 ID / 名称 · 仓库标识 · 平台 / 层级 · 交付链路 · 访问域名 · 部署状态 · 部署结果 · 异常说明）；总览统计卡、分布图、筛选与展开详情已按用户指令删除；空数据 / 失败 / 缺失分别标识 |
| 脚本 | `scripts/deployment-summary.mjs` / `verify-deployments.mjs` | 真实采集（git / 工件 / CI / 矩阵行数，可选 `--live` curl）→ 结构化产物；52 项一致性断言 |
| 产物 | `docs/deployment-summary.{json,md}` | 机器可核对 JSON + 人工核对表 |

设计约束：① 所有同类项共用同一组字段，别名归并到 `aliases` 而非另起一行；② `result = null` 表示空数据，不以 0 或历史 200 填充；③ 工件区分 `artifact_in_head`（远端 HEAD）与 `artifact_in_worktree`（本地工作树）两个口径；④ 汇总 `PASS` 不等于生产「已上线」，生产唯一权威终点仍为 `https://mim.mixm.top`（铁律十二）。详见 [AGENTS.md §13](../../AGENTS.md)。

## 9. 导航站 NAVIGATION（2026-11-12 新增）

架构定位：**有状态业务模块**，是统一入口清单里 NAVIGATION 的真实落地——链接目录 + 服务端可达性探测 + 失效标记 + 推荐位 + 检索。职责边界：只维护目录与可达性状态，不承载被链系统内容，不负责 DNS 解析或跳转决策（跳转由浏览器直接发起）。

| 层 | 工件 | 职责 |
|---|---|---|
| 数据表 | `services/mim-api/src/schema.sql` 的 `nav_links` | `id / name / url / group_name / description / recommended / status(ok\|broken\|unknown) / http_status / latency_ms / last_checked_at / created_by / created_at / updated_at`；两个索引：`(group_name, recommended, name)`、`(status, last_checked_at DESC)`；启动时 `CREATE TABLE IF NOT EXISTS` 幂等建表，存量库自动补齐 |
| 共享包 | `packages/core-domain/src/navigation.ts` | 7 条站内视图种子 `NAV_LINK_SEEDS`、`normalizeNavUrl`（只接受 http(s) 或站内相对路径）、`resolveProbeTarget`（相对路径按 origin 补齐）、`classifyProbe`（2xx/3xx 可达）、`summarizeNavLinks`（三态 + 分组汇总） |
| 种子 | `services/mim-api/src/db.ts` 的 `seedNavLinks` | 主键 `nav-seed-<n>`，`INSERT OR IGNORE` 不覆盖已探测状态；按主键前缀幂等清理已移除的种子行，只删 `created_by = system` |
| 后端 | `services/mim-api/src/routes/navigation.ts` | `GET /navigation/summary`、`GET /navigation/links`（`q` / `group` / `status` / `recommended`）、`POST /navigation/links`、`PATCH /navigation/links/:id`、`POST /navigation/links/:id/check`、`POST /navigation/check`（上限 50 条、逐条串行） |
| 探测口径 | 同上 `probeLink` | GET + `redirect: 'manual'` + 8 秒超时 + `user-agent: mim-navigation-probe/1.0`；2xx/3xx 记 `ok`，4xx/5xx 与网络异常记 `broken`，回写 HTTP 码 / 耗时 / 探测时间；origin 取 `MIM_PUBLIC_ORIGIN`，缺省 `https://mim.mixm.top` |
| 前端 | `apps/web/src/views/Navigation.tsx` | `/navigation` 视图：三态概览、关键词检索、分组筛选、分组列表、单条与全量检测、推荐位切换、收录表单；写操作复用运行时访客 / 正式会话，目录公开可浏览 |
| 契约测试 | `services/mim-api/test/navigation.test.ts` | 9 例：公开目录与过滤、鉴权与非法地址、PATCH 校验、命中 / 未命中探测（本地 `node:http` 服务，不依赖外网）、全目录探测、种子重跑不重置状态 |

设计约束：① 三态只允许 `ok` / `broken` / `unknown`，未探测不冒充可达；② 探测失败不抛 5xx，而是把失败写进 `status = broken` 供页面标记；③ 全目录探测串行执行并限量，避免对第三方站点并发轰炸；④ 种子只补缺，不覆盖用户改写与已有探测结果。