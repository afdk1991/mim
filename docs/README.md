# docs/ · 文档索引

> 本目录索引按子目录分组。**现行开发以 `rebuild/` 为准**；`archive/`、`superpowers/` 内均为历史存档，不再作为执行依据。
> 最近整理：2026-10-28。

## 一、rebuild/ —— 现行开发规范（权威口径）

| 文件 | 一句话说明 | 更新日期 |
| --- | --- | --- |
| [rebuild/启动说明.md](rebuild/启动说明.md) | 第一次拿到仓库的 step by step：环境 → 前端 5173 → 后端 8787 → 迁移 → 首个管理员 → 常见问题 | 2026-10-28 |
| [rebuild/路由清单.md](rebuild/路由清单.md) | 全站 57 条 hash 路由表（路径 / 页面组件 / 所属域 / 是否需登录 / 功能说明），唯一真源 `src/app/routes.tsx` | 2026-10-28 |
| [rebuild/迁移说明.md](rebuild/迁移说明.md) | 从旧双后端（Supabase + CloudBase）收敛到自托管 `server/` 的表对照、行为差异、数据搬迁与回滚；含 0001~0006 迁移 | 2026-10-28 |
| [rebuild/页面实现规范.md](rebuild/页面实现规范.md) | 页面开发契约基线：分层方向、别名、`useApp`/`useMall` API、红线、状态分支与验收标准 | 2026-10-28 |

## 二、analysis/ —— 专项分析（证据型报告，附 文件:行号）

| 文件 | 一句话说明 | 更新日期 |
| --- | --- | --- |
| [analysis/平台适配层契约分析.md](analysis/平台适配层契约分析.md) | `src/platform/` 多端适配层（web/capacitor/miniprogram/mock）契约与测试覆盖分析 | 2026-10-28 |
| [analysis/商城四业务并发与退款分析.md](analysis/商城四业务并发与退款分析.md) | 秒杀/本地生活/直播/出行四业务端到端链路、并发正确性（防超卖）与退款闭环分析 | 2026-10-28 |

## 三、review/ —— 代码审查报告

| 文件 | 一句话说明 | 更新日期 |
| --- | --- | --- |
| [review/后端-审查.md](review/后端-审查.md) | `server/` 全量静态走读：HTTP 契约、REST/RPC 注册、金额分口径、迁移 SQL 核对 | 2026-10-28 |
| [review/前端-审查.md](review/前端-审查.md) | `src/**` 约 110 个源文件的分层、状态、数据访问与红线执行情况审查 | 2026-10-28 |
| [review/脚本部署-审查.md](review/脚本部署-审查.md) | `scripts/` 15 个脚本与 `deploy/`（install.sh / systemd / nginx / logrotate）审查清单 | 2026-10-28 |

## 四、archive/ —— 历史文档归档（不再执行，仅存档）

| 文件 | 一句话说明 | 更新日期 |
| --- | --- | --- |
| [archive/README.md](archive/README.md) | 归档清单：原文件名、归档原因、移动方式、引用核对（2026-10-28 自根目录迁入） | 2026-10-28 |
| [archive/开发吧.md](archive/开发吧.md) | 早期双态架构时期的规划讨论长文（其约束已被 `项目规则边界.md` 作废） | 2026-10-28（归档） |
| [archive/漫剧片单更新变更总结.md](archive/漫剧片单更新变更总结.md) | 漫剧片单功能某次变更的过程记录 | 2026-10-26（原文日期） |
| [archive/全平台.md](archive/全平台.md) | 外来 AI 问答对话记录（多端/分发平台外部方案参考，非项目规格） | 2026-10-28（归档） |
| [archive/全栈全站全平台技术方案.md](archive/全栈全站全平台技术方案.md) | 「全平台铺开」外部技术方案讨论，与现收敛路线脱钩 | 2026-10-28（归档） |
| [archive/阅读理解与实施规划报告.md](archive/阅读理解与实施规划报告.md) | 重建前一次性摸底调研报告，结论已落地为 rebuild/ 体系 | 2026-10-28（归档） |

## 五、superpowers/ —— 历史实施计划与设计（已部分作废，勿据此执行）

| 文件 | 一句话说明 | 更新日期 |
| --- | --- | --- |
| [superpowers/plans/2026-10-22-clear-seed-and-full-supabase-storage-plan.md](superpowers/plans/2026-10-22-clear-seed-and-full-supabase-storage-plan.md) | 「清空演示数据 + Supabase 存储」实施计划；2026-10-26 复核声明已部分作废，仅留档 | 2026-10-26 |
| [superpowers/specs/2026-10-22-clear-seed-and-full-supabase-storage-design.md](superpowers/specs/2026-10-22-clear-seed-and-full-supabase-storage-design.md) | 与上计划配套的设计文档（Supabase 托管时代产物，现后端已自托管化） | 2026-10-22 |

## 六、docs/ 根下散落文档

| 文件 | 一句话说明 | 更新日期 |
| --- | --- | --- |
| [商城四业务融合方案.md](商城四业务融合方案.md) | 秒杀/本地生活/直播尖货/出行服务如何接入同一套商城的融合设计（统一基座 + OrderExt 外挂） | 2026-10-28 |
| [selfhosted-baas-blueprint.md](selfhosted-baas-blueprint.md) | 自建类 Supabase BaaS 平台的通用架构参考（**历史方案**，不代表当前 `server/` 实现） | 2026-10-28 |
