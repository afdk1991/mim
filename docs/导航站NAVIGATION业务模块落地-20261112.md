# 导航站（NAVIGATION）业务模块落地 — 2026-11-12

## 1. 背景与目标

用户对 `/entry-catalog` 提出「建业务模块」，并在后续两轮明确：**不是建目录条目**（「没有实现」），并指定实现对象按「最容易实现闭环的」自选。据此选定统一入口清单里的 **NAVIGATION（全站资源导航站）**：链路最短、无外部凭证依赖，且模板备注本身给出了三项可判定功能点——全站资源链接目录与分类、入口可达性检测与失效标记、导航检索与推荐位。

本轮把它落成**真实可运行功能**：链接目录 + 服务端可达性探测 + 失效标记 + 推荐位 + 检索，落库、上线并取得线上取证。

## 2. 交付清单

| 层 | 工件 | 内容 |
|---|---|---|
| 共享契约 | `packages/core-domain/src/navigation.ts`（新增） | 三态枚举、7 条站内视图种子 `NAV_LINK_SEEDS`、`normalizeNavUrl`（只接受 http(s) / 站内相对路径）、`resolveProbeTarget`、`classifyProbe`（2xx/3xx 判可达）、`summarizeNavLinks`、`NavLinkView` / `NavLinkSummary` |
| 共享包导出 | `packages/core-domain/src/index.ts` | 新增 `export * from './navigation.js'` |
| 数据表 | `services/mim-api/src/schema.sql` | `nav_links`（`id/name/url/group_name/description/recommended/status/http_status/latency_ms/last_checked_at/created_by/created_at/updated_at`，`status` 带 `CHECK(ok|broken|unknown)`）+ 索引 `(group_name, recommended, name)`、`(status, last_checked_at DESC)`；启动 `CREATE TABLE IF NOT EXISTS` 幂等建表，存量生产库自动补表，无需列迁移 |
| 种子 | `services/mim-api/src/db.ts` | `seedNavLinks`：主键 `nav-seed-<n>`，`INSERT OR IGNORE` 不覆盖用户改写与已探测状态；按主键前缀 + `created_by='system'` 幂等清理已移除种子行 |
| 后端 | `services/mim-api/src/routes/navigation.ts`（新增） | 6 个端点（见 §3），`probeLink` 探测实现、`BATCH_LIMIT=50`、`PROBE_TIMEOUT_MS=8000` |
| 挂载 | `services/mim-api/src/app.ts` | `app.use('/api/v1', createNavigationRouter(resolved))`，排在部署汇总之后、全局 `requireAuth` 之前（浏览类端点需匿名可读） |
| 前端客户端 | `apps/web/src/api.ts` | `api.navigation` 分组（summary / links / create / update / check / checkAll）+ `NavLink` / `NavSummary` / `NavStatus` 类型 |
| 路由 | `apps/web/src/router.ts` | `AppView` 加 `navigation`，`VIEW_SEGMENTS` 加 `/navigation` |
| 布局 | `apps/web/src/App.tsx` | 侧栏新增「导航站 / Navigation」，渲染 `{route.view === 'navigation' && <Navigation />}` |
| 视图 | `apps/web/src/views/Navigation.tsx`（新增） | 三态概览、关键词检索、分组筛选、分组列表、单条与全量「检测」、推荐位切换、收录表单、错误与忙碌态 |
| 落地状态 | `packages/core-domain/src/entryImplementation.ts` | `NAVIGATION` 由 `partial`（view `store`）改为 `implemented`（view `navigation`），登记三项真实能力与新边界说明；四态计数变为 已落地 5 / 部分相邻 18 / 规划中 19 / 语义冲突 2 |
| 契约测试 | `services/mim-api/test/navigation.test.ts`（新增） | 9 例，探测目标用本地 `node:http` 服务，不依赖外网 |
| 计数对齐 | `services/mim-api/test/sites.test.ts`、`test/entries.test.ts` | 四态断言与注释同步为 5/18/19/2（首轮 CI 因这两处仍写 4/19 而红，已修复） |

## 3. 接口契约（前缀 `/api/v1`）

| 端点 | 鉴权 | 行为 |
|---|---|---|
| `GET /navigation/summary` | 公开 | `{schema:'mim.navigation.v1', summary:{total,ok,broken,unknown,groups[],last_checked_at}}` |
| `GET /navigation/links` | 公开 | 支持 `q`（名称 / 地址 / 说明）、`group`、`status`（非法值 400 并回显允许值）、`recommended=1`；返回过滤后集合 + 该集合汇总 |
| `POST /navigation/links` | 登录 + `Idempotency-Key` | body `{name,url,group?,description?,recommended?}`；地址非法 400；新行 `status='unknown'`；201 返回 `{item}` |
| `PATCH /navigation/links/:id` | 登录 + `Idempotency-Key` | 至少一个字段，空 body 400；可改名称 / 地址 / 分组 / 说明 / 推荐位 |
| `POST /navigation/links/:id/check` | 登录 + `Idempotency-Key` | 服务端探测单条并回写状态、HTTP 码、耗时、探测时间 |
| `POST /navigation/check` | 登录 + `Idempotency-Key` | 全目录探测（`LIMIT 50`，逐条串行避免并发轰炸第三方），返回本批 `items` 与全量 `summary` |

## 4. 探测口径与三态判定

- 请求：`GET`，`redirect: 'manual'`（不跟随跳转，3xx 本身即证明目标存在），`AbortSignal.timeout(8000)`，`user-agent: mim-navigation-probe/1.0`；主动 `res.body.cancel()` 丢弃正文，探测只关心可达性。
- 判定：2xx / 3xx → `ok`；4xx / 5xx → `broken`；网络异常（超时 / DNS / TLS）→ `broken` 且 `http_status = null`；未探测 → `unknown`。**未探测不冒充可达**。
- 站内相对路径：按 `MIM_PUBLIC_ORIGIN` 补齐 origin，缺省 `https://mim.mixm.top`（去尾斜杠）。
- 探测失败不抛 5xx：把失败写进 `status='broken'` 供页面标记，接口本身仍 200。

## 5. 前端视图 `/navigation`

目录概览（总数 / 可达 / 失效 / 未探测 / 分组数 + 最近探测时间 + 「检测全部」）→ 关键词检索（提交制）→ 分组筛选按钮（带计数，可再点取消）→ 按分组渲染链接列表（名称可点击、`target=_blank`；三态徽标 + HTTP 码 + 耗时 + 探测时间；单条「检测」、「设为推荐 / 取消推荐」）→ 收录入口表单。三种忙碌标记（`all` / `check:<id>` / `rec:<id>` / `create`）彼此不互斥，写操作复用运行时访客会话（免登录体验下同样可写）。

## 6. 本地门禁（2026-11-12 实测）

| 门禁 | 结果 |
|---|---|
| `pnpm -r typecheck` | 0（5/6 项目，根无 typecheck） |
| `pnpm --filter @mim/api test` | **26 文件 / 383 例全过**（新增 9 例导航站） |
| `pnpm --filter @mim/web build` | 0（`assets/index-Ct4arGDo.js` 3,379.55 kB；3604 回退页生成） |
| `pnpm --filter @mim/admin build` | 0 |
| `pnpm --filter @mim/api build` | 0（`dist/index.js` + `dist/schema.sql`） |
| `node scripts/version-check.mjs` | 0（`0.0.3`，展示 `V0.0.3`） |
| `node scripts/env-check.mjs` | 0 |
| `verify-site-modules` | 83/83 |
| `verify-entry-manifest` | 23/23 |
| `verify-deployments` | 55/55 |
| `verify-site-directory` | PASS |
| `verify-custom-domains` | 20/20 |
| `comment-check --strict` | 通过 |

## 7. 部署与线上取证

- 提交：`7e1e87c`（22 files，+1010/−15，功能主体）→ `25d6f43`（2 files，四态计数对齐）。
- 双远端：`origin` / `gitee` 均 `c4d91a8..7e1e87c`、`7e1e87c..25d6f43`，`git ls-remote` 两端均 `25d6f431…`（0 ahead / 0 behind）。
- CI：Deploy run **43234540307**（@ `25d6f43`）。首轮「质量门禁」红于 `sites.test.ts` / `entries.test.ts` 的四态断言（仍写 4/19），已改为 5/18 后重跑；「发布到生产服务器」首轮在「管理后台路由断言」以 `curl exit 28`（5 秒超时）失败，本机复验 `/admin` = 301、`/admin/` = 200 且 `noindex` 与 `assets/index-` 均命中，判定为 runner 侧网络抖动；`gh run rerun --failed` 后**五作业全 success**：质量门禁 / 托管平台同步 / 发布到生产服务器 / GitHub Pages / GitHub Packages。
- 线上（2026-11-12 22:1x +08:00，本机直连）：

| 取证项 | 结果 |
|---|---|
| `GET https://mim.mixm.top/health` | 200 `{"status":"ok","service":"mim-api","version":"0.0.3"}` |
| `GET /navigation` | 200，LEN=3389，bundle `assets/index-CgJoRRfT.js` |
| bundle 字符串核对 | 3,314,435 B；`导航站` 13 次、`检测全部` 1、`设为推荐` 1、`navigation/check` 1、`全站资源链接目录` 3 |
| `GET /api/v1/navigation/summary`（首次部署后） | `total=7 / ok=0 / broken=0 / unknown=7`，分组 业务入口 3 + 交易链路 1 + 创作工具 1 + 协作 1 + 运维 1 |
| `POST /api/v1/auth/guest` | 200，`MIM-10000035`，`is_guest=true` |
| `POST /api/v1/navigation/check`（访客令牌 + 幂等键） | `checked=7 / ok=7 / broken=0 / unknown=0`，7 条站内路径全部 HTTP 200 |
| 探测后 `GET /api/v1/navigation/summary` | `total=7 / ok=7 / broken=0 / unknown=0`，`last_checked_at=2026-11-12T14:16:02.699Z` |
| `GET /api/v1/sites/overview` | `implementation = {implemented:5, partial:18, planned:19, conflict:2}` |

**未做**：本机无 Chrome / Edge 可执行文件（既有事实），故没有页面截图级取证，线上取证以 HTML 200 + bundle 字符串 + 真实接口调用为准。

## 8. 铁律七同步清单

| 工件 | 状态 |
|---|---|
| 源代码（共享包 / 后端 / 前端） | ✅ 本轮新增与修改 |
| 依赖清单 + 锁文件 | 不涉及（无新增第三方依赖，探测用 Node 内置 `fetch`；测试用既有 `supertest`，本地目标用 `node:http`） |
| 版本号（铁律四） | ✅ `0.0.2 → 0.0.3`，6 个 `package.json` 同步，`version-check` 0 |
| README | ✅ 版本行、功能变更条目、前端视图路径段、视图表新增「导航站」行、接口表新增「导航站」行 |
| Wiki | ✅ `docs/wiki/01-architecture.md` 新增 §9 导航站架构段（数据表 / 共享包 / 种子 / 后端 / 探测口径 / 前端 / 测试 / 约束） |
| PRD | ✅ `Mim-PRD.html` 新增「导航站（NAVIGATION 业务模块）」小节（需求 / 交付物 / 边界） |
| 入口落地状态层 | ✅ `NAVIGATION` → `implemented`，view `/navigation` |
| 交付记录 | ✅ 本文件 |
| 部署矩阵 / DNSPod | 不涉及（未新增平台或域名） |

## 9. 边界与未做

- 只维护目录与可达性状态：**不承载被链系统内容**，**不负责 DNS 解析或跳转决策**（跳转由浏览器直接发起）。
- 探测结果是运行时刻快照，不等于 SLA；全目录探测上限 50 条，超出部分需分批。
- 44 个模块本轮只落地 NAVIGATION 一个闭环，其余模块的落地顺序与范围未定，不臆造。
- CI 首轮的两处红均为可复现判定的非功能问题：四态断言口径（已修）+ runner 到自建的 5 秒超时（重跑后绿）；Cloudflare Worker 首轮报 API 权限错误，重跑后通过，若后续复现将按平台 token 权限单独排查，与本模块无关。
