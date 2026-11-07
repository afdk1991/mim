# 08 · 开发实现全景（数据库 / 前端 / 后端 / 存储 / 后台管理平台）

> **状态声明（证据）**：截至 V0.0.0-preview（2026-11-05），仓库内已落地 `apps/web`（React 18 + Vite 6）、`packages/core-domain`、`packages/i18n`、`services/mim-api`（Express 5 + SQLite/better-sqlite3），包管理器 pnpm workspace；`pnpm -r typecheck` / `pnpm --filter @mim/api test`（5 文件 40 例全通过）/ `pnpm -w build` / `node scripts/version-check.mjs` / `node scripts/env-check.mjs`（138 = 138）均已通过并有命令输出留档。
> **2026-11-04 变更（两次）**：① FR-03 旧范围（项目/任务/成员/邀请/仪表盘/增量同步/CSV 导出）已按用户指令整体移除，§3.2「content 域（已移除）」与同步/导出规则仅作历史参考，不再对应仓库实况；② FR-03 已**重定义为「功能模块商城 + 漫剧 AI 剧」**，新增 `catalog` / `comic` / `media` 三域与配套表；实现拆分清单见 [07-functional-modules.md](./07-functional-modules.md) §12。
> **2026-11-05 变更**：① FR-02（订阅与支付）与审计域（`routes/audit.ts` + `audit_logs`）整域删除，生产库 9 张表 DROP（迁移 `deploy/migrations/2026-11-05-drop-billing-audit.cjs`）；② 漫剧第 1/2 期后端已落地——`comic` 域 7 表 + 24 条路由 + `src/orchestrator.ts` + `src/storage.ts` 均已装配进 `app.ts`/`index.ts`；③ 受保护 router 的 `requireAuth` / `requireEntitlement` 改为按命名空间生效（`/me`、`/comic`、`/media`、`/ai`），未匹配路径落到统一 404，不再被鉴权误拦成 401（契约测试「已下线与未知路径返回 404」锁定）；④ 错误信封归一——`errorHandler` 识别 body-parser 的 `entity.parse.failed`（非法 JSON 请求体），返回 400 `VALIDATION_FAILED` 而非 500 `INTERNAL_ERROR`（契约测试新增 1 例，测试总数 39 → 40）。本页 §2 / §3 / §4 / §5 / §6 / §8 / §9 / §10 已按此同步。
> **2026-11-07 变更**：① `catalog` 补三条管理写路由（`PATCH /modules/:code/status`、`POST /entitlements/grant`、`POST /entitlements/:id/revoke`），鉴权由 `middleware.ts` 的 `requireAdmin` 承担（环境变量 `MIM_ADMIN_TOKEN`，常量时间比对），未配置时 403 `FEATURE_NOT_AVAILABLE`；② 新增 `services/mim-api/src/jobs.ts`——成本告警 / 成片审核超时 / 权益到期扫描三定时任务 + `start`/`stop` 生命周期，复用 `idempotency_keys`（`user_id='system'`、`method='JOB'`），`index.ts` 按 `MIM_JOBS_ENABLED` 装配与优雅退出；③ 契约测试新增 `test/catalog.test.ts`（18 例）与 `test/jobs.test.ts`（9 例），全仓测试 64 → **91 例**；④ `apps/web` 整站强制登录改为两级门禁——`store` / `sitemap` 匿名可访问，`comic` / `settings` 未登录时内嵌 `<Login embedded />`。本页 §1.1 / §2 / §3 / §8 / §10 已按此同步。
> 本页为**目标架构全量设计**，与当前代码的差异逐条记录在 §1.1「已实现 vs 规划」；§2 及之后各节凡标「规划」者尚未落地，落地时须随代码同步修订（铁律七）。
>
> 产品功能视角见 [07-functional-modules.md](./07-functional-modules.md)；目标架构分层见 [01-architecture.md](./01-architecture.md) §2。

## 1. 开发分层总览

```
┌── 客户端 apps/*（薄壳：UI + platform-adapter）
│    web · mini · mobile · desktop · admin
├── 共享包 packages/*（无 UI 依赖，可被任何端引用）
│    core-domain · core-sdk · ui-kit · i18n
│    platform-adapter · capability-client · observability · testing-utils
├── 服务端 services/*（Headless，无 UI）
│    gateway · identity · billing · payment-driver · content
│    catalog · comic · media · im · rtc · ai-orchestrator
│    notification · openapi · admin-api · jobs
├── 数据层
│    PostgreSQL（按 region 物理分库，按域分 schema）
│    Redis（会话/频控/缓存/锁）· OpenSearch（检索）
│    对象存储 + CDN（漫剧关键帧/片段/成片、发票）· MQ（异步与事件）
└── 基础设施 infra/*
     Terraform（cn/global 双套）· K8s · CI/CD · 监控告警 · 密钥管理
```

三条跨层纪律（PRD 已定，开发必须遵守）：

| 纪律 | 含义 | 违反后果 |
|---|---|---|
| 契约先行 | 所有能力先写 OpenAPI/proto，`packages/core-sdk` 由契约生成，禁止手写接口 | 多端字段漂移 |
| 业务下沉 | 业务规则只存在于 `packages/core-domain` 与后端领域服务，端上不复制 | 各端行为不一致 |
| 端只做适配 | 登录/支付/推送/存储/分享差异封装在 `IPlatformAdapter` | 每加一端成本线性上升 |

### 1.1 已实现 vs 规划（当前代码实况）

| 维度 | 规划口径（本页 §2+） | 当前已实现（证据位置） | 差异原因 / 后续 |
|---|---|---|---|
| 部署形态 | 12 个独立服务 + gateway | 单服务 `services/mim-api`（模块化单体，路由按域分文件） | P0 先单体；路由边界已按域切分（`routes/auth|me|comic|media|ai|site.ts`）；原 FR-03 五条路由已于 2026-11-04 删除；`billing` / `audit` 路由已于 2026-11-05 删除 |
| 数据库 | PostgreSQL 按 region 物理分库 + Redis + OpenSearch + MQ | SQLite 单库（`better-sqlite3`，WAL），进程内无外部依赖 | 降低本地/CI 启动成本；表结构（UUIDv7、`bigint` 金额、`deleted_at`、`version` 乐观锁、`idempotency_keys`）已按 PostgreSQL 可迁移口径设计 |
| 支付 | `payment-driver` 多通道 + 回调验签 | **已删除（2026-11-05）**：`routes/billing.ts`、驱动分支与 9 张财务表整体移除，`/api/v1/plans` 等端点现返回 404（CI 断言） | 当前无任何支付能力；如需恢复须重新设计并引入持牌通道凭证 |
| 实时同步 | WebSocket + MQ 推送，5 秒内到达 | **已移除（2026-11-04）**：原 4s 轮询 `GET /sync/changes` 随 FR-03 一并删除，当前无同步需求 |
| 客户端 | web / mini / mobile / desktop / admin 五端 | 仅 `apps/web`（React 18 + Vite 6），`/api` 与 `/health` 由 Vite 代理到 8787 | 先打通契约与核心流程；其余端复用同一 `/api/v1` 契约与 `packages/core-domain` |
| 共享包 | core-sdk / ui-kit / platform-adapter / observability / testing-utils | 仅 `packages/core-domain`（错误码/金额/UUIDv7）与 `packages/i18n`（zh-CN/en-US + 货币格式化） | 按需引入，未使用的能力不提前抽象；原 `permissions.ts` / `tasks.ts` 随 FR-03 删除；`plans.ts` / `subscription.ts` / `order.ts` 随 FR-02 于 2026-11-05 删除 |
| 存储 | 对象存储 + CDN（附件/媒体/导出） | `src/storage.ts` 已实现 `LocalDiskStorage`（HMAC-SHA256 预签名，落盘 `data/media`）与 `S3Storage`（AWS SDK 预签名），`/api/v1/media/*` 已装配（2026-11-05） | 生产可选 S3 桶；漫剧关键帧/分镜片段/成片经预签名 URL 分发（见 §6） |
| 后台管理 | `admin-api` + RBAC 后台 | **最小管理面已落地（2026-11-07）**：`middleware.ts` 的 `requireAdmin` 以环境变量 `MIM_ADMIN_TOKEN` 做常量时间比对（`timingSafeEqual` + sha256），未配置时返回 403 `FEATURE_NOT_AVAILABLE`；三条写路由 `PATCH /modules/:code/status`、`POST /entitlements/grant`、`POST /entitlements/:id/revoke` 已挂载；**审计仍下线（2026-11-05 删除 `routes/audit.ts` + `audit_logs`）** | 完整 `admin-api` + 多角色 RBAC + 独立 `apps/admin` 仍为 P1；当前为单令牌最小管理面 |
| 鉴权 | gateway 验签 + Redis 会话 | 进程内 JWT（`jsonwebtoken`）+ refresh 轮换；Bearer 中间件在 `middleware.ts` | 单实例即可；横向扩展时 refresh 存储换 Redis |
| 契约先行 | OpenAPI/proto 生成 `core-sdk` | 手写 `apps/web/src/api.ts` + zod 校验（`validate.ts`）+ snake_case 响应 + 错误信封 | P0 以契约测试保障字段一致性：`test/*.test.ts` 共 **9 文件 91 例**（`api` 19 / `comic` 10 / `comic-phase2` 10 / `orchestrator` 10 / `catalog` 18 / `jobs` 9 / `site` 7 / `ai-routes` 5 / `media` 3）；后续补 OpenAPI 导出 |
| 仪表盘切日 | 展示端负责时区转换 | **已移除（2026-11-04）**：`routes/dashboard.ts` 随 FR-03 删除，服务端不再按用户时区切日；用户 `timezone` 字段与设置入口保留 | 恢复仪表盘能力时按原口径（`Intl.DateTimeFormat('sv-SE')` + 时区过滤）重新实现 |

## 2. 后端服务模块清单

| 服务 | 职责 | 对外接口（前缀 `/api/v1`） | 关键依赖 | region |
|---|---|---|---|---|
| `gateway` | 统一入口：鉴权、限流、灰度、region 路由、错误码归一、多语言注入 | 全部流量入口 | Redis（限流）、identity（验签） | cn / global |
| `identity` | 注册登录、第三方登录绑定、会话与设备、账号合并、注销 | `/auth/*`、`/accounts/*`、`/devices/*` | 短信/邮件通道、Redis | 分库 |
| ~~`billing`~~ | **已删除（2026-11-05）**：`routes/billing.ts` 与 `packages/core-domain/{plans,subscription,order}.ts` 移除，生产库 5 张计费表 DROP；当前无计划/订阅/发票/对账能力 | 无（原 `/plans`、`/subscriptions/*`、`/invoices/*` 现均 404） | 无 | — |
| ~~`payment-driver`~~ | **已删除（2026-11-05）**：原 7 通道驱动与统一回调随 FR-02 一并移除，`/payments/*`、`/callbacks/{driver}` 现均 404 | 无 | 无 | — |
| `catalog` | **（已落地，2026-11-07 补管理写面）** 功能模块目录、模块定价、解锁发放与回收、解锁鉴权；`modules`/`module_prices`/`entitlements`/`entitlement_events` 四表已建，`requireEntitlement` 门禁 + 公开只读 `GET /modules`、`GET /modules/:code` + 三条管理写路由（状态迁移 / 发放 / 回收）均已实现；`order_items` 随订单域于 2026-11-05 取消，**不建表** | `GET /modules`、`GET /modules/{code}`、`GET /entitlements`、`POST /entitlements`（普通用户自领）、`GET /entitlements/{code}/check`、`PATCH /modules/{code}/status`、`POST /entitlements/grant`、`POST /entitlements/{id}/revoke`（后三条需 `x-admin-token`） | admin-api（订单/退款依赖已于 2026-11-05 随 FR-02 移除） | 分库 |
| `comic` | **（第 1 期已落地 2026-11-04；第 2 期路由骨架已落地 2026-11-05）** 工程/角色/分镜（`/comic/projects/*` 8 条）与生成任务编排、成片合成与版本、审核发布（`/comic/jobs/*`、`/comic/films/*` 16 条）均已实现（共 24 条路由）；任务编排与队列消费（`src/orchestrator.ts` → `/api/v1/ai/*`）、对象存储（`src/storage.ts` → `/api/v1/media/*`）**已于 2026-11-05 装配进 `app.ts`/`index.ts`，`MIM_AI_WORKER` 默认随进程自动消费；openai 兼容提供方已接入 text/image（2026-11-06，video/tts/compose 诚实失败 `PROVIDER_NOT_CONFIGURED`），更多真实厂商模型调用待 OQ-08 凭证** | `/comic/projects/*`、`/comic/jobs/*`、`/comic/films/*`（24 条已实现，骨架） | ai-orchestrator、media、对象存储、审核服务、MQ | 分库 |
| `media` | **（已落地并装配上线，2026-11-05）** `src/storage.ts` 实现 `LocalDiskStorage`（HMAC-SHA256 预签名 URL，落盘 `data/media`）与 `S3Storage`（AWS SDK 预签名）；`/media/presign/*`、`/media/assets`、免鉴权对象收发端点均已挂载；`generation_assets` 表已建 | `/media/presign/upload`、`/media/presign/download`、`/media/assets`、`/media/objects/*`（已上线） | 对象存储、CDN | 按 region 桶 |
| `content` | **P0 任务与协作域已整体移除（2026-11-04，本页保留为历史设计）**：原含项目/任务/子任务、列表/今日/日历/看板视图、个人仪表盘、成员邀请与两档权限、增量同步、CSV 导出；**P1 通用内容管理域**：内容/资源元数据、审核流、检索索引、推荐候选 | P1：`/contents/*`、`/search`（原 P0 的 `/projects/*`、`/tasks/*`、`/dashboard`、`/sync/*`、`/exports/*` 已删除） | P1：对象存储、OpenSearch、审核服务 | 分库 |
| `im` | 会话、消息可靠性、已读回执、在线状态、离线推送、审核 | `/im/*`（HTTP + WebSocket） | MQ、推送通道、审核服务 | 分库 |
| `rtc` | 信令、房间编排、录制、转码、质量监测 | `/rtc/*` | RTC 第三方、对象存储 | 分集群 |
| `ai-orchestrator` | 模型路由、Prompt 版本、输出审核、配额与成本核算；**漫剧生成**（文生图 / 图生视频 / TTS / 合成）的模型路由、成本预检与配额扣减在此编排 | `/ai/*`、内部消费 `generation_jobs` 队列 | 大模型供应商、审核服务、MQ | 按合规域 |
| `notification` | 站内信、邮件、短信、推送编排与模板 | `/notifications/*` | 邮件/短信/推送通道 | 分库 |
| `openapi` | 开放平台：OAuth2、API Key、Webhook 投递、限流 | `/open/*` | gateway | 分库 |
| `admin-api` | 运营后台 BFF：聚合查询、写操作审批、审计埋点 | `/admin/*` | 各域服务、admin 库 | 分库 |
| `jobs` | **（已落地，2026-11-07）** `src/jobs.ts` 提供三个定时任务（成本告警 / 成片审核超时 / 权益到期扫描）+ `start`/`stop` 生命周期，复用 `idempotency_keys`（`user_id='system'`、`method='JOB'`）做抢占与结算；`index.ts` 按 `MIM_JOBS_ENABLED`（默认开）装配并在优雅退出时 `stop()`（见 §8） | 无 HTTP | 全部域库（当前仅 SQLite 单库） | 双区各一套 |
| `site` | **（已落地，2026-11-06）** 站点模块地图：把 DNSPod 导出 `dnspod_records_2026-11-05_21-42-26.xls` 的「备注」列结构化为 45 个主机模块 × 2 zone × 8 分类，纯静态常量（`src/site.ts`），**无数据表、无迁移、无第三方依赖**；前端 `views/SiteMap.tsx` | `/site/overview`、`/site/modules`、`/site/modules/:host`（公开免鉴权，3 条） | 无 | 不分库（多区共用同一份解析数据） |

服务拆分原则：**先单体后拆分**。P0 实际为单个部署单元 `services/mim-api`（模块化单体，按域分路由文件：`auth` / `me` / `comic` / `media` / `ai`），但代码边界仍按上表分目录，避免后期拆分时重构业务逻辑。原「`identity + billing + payment-driver` 合一」的设想随 FR-02 于 2026-11-05 失效。

各服务所需的第三方提供方、SDK/API 形态与密钥命名见 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)；密钥按 region 独立、不入库，仅存环境变量或 KMS。

## 3. 数据库设计

### 3.1 全局约束

| 约束 | 规则 |
|---|---|
| 分库 | `cn` 与 `global` **物理独立集群**，不共用实例；跨区只同步匿名聚合指标，不同步个人数据 |
| 分 schema | 按域：`identity` / `catalog` / `comic` / `media` / `content` / `im` / `ai` / `admin` / `ops`（`billing` schema 已于 2026-11-05 随 FR-02 删除） |
| 主键 | `id` 使用 UUIDv7（时间有序，便于索引与分片） |
| 金额 | 一律 `bigint` 整数**最小货币单位**（人民币=分，美元=分），配 `currency char(3)` |
| 时间 | `timestamptz`，统一 UTC 存储，展示端负责时区转换 |
| 软删除 | 业务表带 `deleted_at timestamptz NULL`；已发布成片与事件/版本表**禁止软删除或覆盖**，只能追加新版本或记录 |
| 并发 | 带 `version int` 乐观锁；一切状态变更必须走对应状态机校验（漫剧三套状态机见 [07](./07-functional-modules.md) §2.2） |
| 幂等 | 独立表 `ops.idempotency_keys(idempotency_key, scope, request_hash, response_json, created_at)`，唯一索引 `(scope, idempotency_key)` |
| 分区 | 原 `orders` / `payments` / `audit_logs` 按月 RANGE 分区设计随 FR-02 / 审计域于 2026-11-05 取消；现 `im.messages` 按会话哈希分片 |
| 迁移 | 所有变更走版本化迁移脚本（`infra/migrations/{version}_{desc}.sql`），禁止手改生产库 |

### 3.2 核心表清单

**identity 域**

| 表 | 关键字段 | 说明 / 索引 |
|---|---|---|
| `users` | `id`、`region`、`status(active/blocked/deleting/deleted)`、`created_at`、`deleted_at` | 账号主体；索引 `(region, status)` |
| `identities` | `id`、`user_id`、`type(phone/email/wechat/alipay/google/apple)`、`identifier_hash`、`verified_at` | 登录方式绑定；唯一索引 `(region, type, identifier_hash)`，**同一方式不得绑两个账号** |
| `credentials` | `id`、`user_id`、`password_hash`、`updated_at` | 仅邮箱密码登录使用；Argon2id |
| `sessions` | `id`、`user_id`、`device_id`、`refresh_token_hash`、`expires_at`、`revoked_at` | 刷新令牌哈希存储；索引 `(user_id, expires_at)` |
| `devices` | `id`、`user_id`、`platform(web/mini/ios/android/desktop)`、`push_token`、`last_seen_at` | 多端在线与推送路由 |
| `account_merges` | `id`、`source_user_id`、`target_user_id`、`status`、`approved_by`、`executed_at` | OQ-05 落地；执行前校验登录方式绑定与风控状态（订阅/订单归并依赖已于 2026-11-05 随 FR-02 移除） |

**billing 域（已删除，2026-11-05）**

> 原 10 张表（`plans`、`plan_prices`、`subscriptions`、`subscription_events`、`orders`、`payments`、`refunds`、`invoices`、`reconciliation_batches`、`reconciliation_diffs`）随 FR-02 整域下线。**生产库实际 DROP 9 张**：其中 `reconciliation_*` 两表从未在 SQLite 中建过，故迁移脚本 `deploy/migrations/2026-11-05-drop-billing-audit.cjs` 覆盖 `plans` / `plan_prices` / `subscriptions` / `subscription_events` / `orders` / `payments` / `refunds` / `invoices` / `audit_logs`（含 `audit` 1 张）。以下仅为历史设计留痕，**不得**作为当前实现依据。

| 表（已 DROP） | 原关键字段 | 原设计说明 |
|---|---|---|
| `plans` | `id`、`code`、`name_i18n`、`billing_cycle`、`region`、`status` | 计划定义；`code` 唯一 |
| `plan_prices` | `id`、`plan_id`、`currency`、`amount_minor`、`effective_from/to` | 价格与计划解耦，改价不改历史订单 |
| `subscriptions` | `id`、`user_id`、`plan_id`、`status(active/past_due/canceled/expired)`、`current_period_*`、`version` | 订阅主体；状态机经事件表推进 |
| `subscription_events` | `id`、`subscription_id`、`from_status`、`to_status`、`reason`、`source` | 只追加，禁止 UPDATE |
| `orders` | `id`、`user_id`、`plan_id`、`amount_minor`、`currency`、`status`、`idempotency_key`、`region` | 月分区；`refunded` 只能由退款执行触发 |
| `payments` | `id`、`order_id`、`driver`、`channel_txn_id`、`status`、`paid_at`、`raw_callback` | 唯一索引 `(driver, channel_txn_id)` 防重复入账 |
| `refunds` | `id`、`payment_id`、`amount_minor`、`status`、`reviewer_id`、`executed_at` | 与 `orders` 分离，支持部分退款 |
| `invoices` | `id`、`order_id`、`title`、`tax_no`、`file_url`、`issued_at` | 发票/税务 |
| `reconciliation_batches` | `id`、`driver`、`biz_date`、`matched_count`、`diff_count`、`status` | 每日对账批次（未建表，仅设计） |
| `reconciliation_diffs` | `id`、`batch_id`、`payment_id`、`type`、`resolved_by` | 差异处理留痕（未建表，仅设计） |

**catalog 域（部分落地：4 表已建 + `requireEntitlement` 已落地，2026-11-04）**

> 功能模块商城（FR-03.1）。模块目录与定价、解锁发放与回收；解锁鉴权只认服务端 `entitlements`。原「与 `billing.orders` 同事务挂载 `order_items`」的设计随订单域于 2026-11-05 取消——**当前无订单载体，解锁记录直接落 `entitlements`**。

| 表 | 关键字段 | 说明 / 索引 |
|---|---|---|
| `modules` | `id`、`code`、`name_i18n`、`summary_i18n`、`unlock_mode(one_time)`、`entitlements_required`、`region`、`status(draft/active/archived)`、`sort_order` | 模块目录；**唯一索引 `(region, code)`**（支持 cn/global 双区同 code 各一行），`code` 在区内不复用；索引 `(region, status, sort_order)`。JSON 字段在 SQLite 以 TEXT 存。`unlock_mode` 当前唯一有效值 `one_time`；原 `subscription` 随 FR-02 于 2026-11-05 下线，DB CHECK 约束已收敛为仅 `one_time` |
| `module_prices` | `id`、`module_id`、`currency`、`amount_minor`、`effective_from`、`effective_to` | 定价与模块解耦，改价不改历史解锁记录 |
| `entitlements` | `id`、`user_id`、`module_id`、`source(admin)`、`source_id`、`status(active/expired/revoked)`、`expires_at`、`version` | **服务端解锁鉴权唯一依据**；唯一索引 `(user_id, module_id)`（一次性解锁）。原 `source(order/subscription)` 与订阅型唯一索引随 FR-02 于 2026-11-05 下线，DB CHECK 已收敛为仅 `admin` |
| `entitlement_events` | `id`、`entitlement_id`、`from_status`、`to_status`、`reason`、`actor(job/admin/system)`、`created_at` | 只追加，禁止 UPDATE |
| ~~`order_items`~~ | — | **已取消（2026-11-05）**：随订单域下线，**本表不建**；解锁直接落 `entitlements` |

**comic 域（第 1 期三表 2026-11-04 已建；第 2 期 `generation_jobs` / `generation_assets` / `comic_films` / `film_versions` 四表 2026-11-05 已建）**

> 漫剧 AI 剧（FR-03.2）。工程/角色/分镜/生成任务/产物/成片/版本七表**已全部建齐**（第 1 期 3 表 2026-11-04；第 2 期新增 `generation_jobs`/`generation_assets`/`comic_films`/`film_versions` 4 表 2026-11-05），四种交付形态共用同一对象模型，差异仅在人工确认点与是否全自动。

| 表 | 关键字段 | 说明 / 索引 |
|---|---|---|
| `comic_projects` | `id`、`owner_user_id`、`region`、`title`、`synopsis`、`status(draft/storyboarded/generating/rendered/published/archived)`、`version`、`deleted_at` | 漫剧工程；索引 `(owner_user_id, status)`；软删除但已发布成片保留 |
| `comic_characters` | `id`、`project_id`、`name`、`appearance_prompt`、`seed`、`reference_asset_ids jsonb`、`voice_profile jsonb`、`version` | character bible，跨镜头一致性唯一来源 |
| `storyboards` | `id`、`project_id`、`version_no`、`shots jsonb`、`confirmed_at`、`created_by` | 分镜表；只追加，确认后旧版本不被覆盖 |
| `generation_jobs` | `id`、`project_id`、`storyboard_id`、`job_type(text/image/video/tts/compose)`、`status(queued/running/succeeded/failed/canceled)`、`retry_of`、`cost_estimate_minor`、`error_code`、`started_at`、`finished_at` | 生成任务；索引 `(project_id, created_at)`、`(status, job_type)`；失败重试新建 job |
| `generation_assets` | `id`、`job_id`、`asset_type(image/video/audio/final)`、`object_key`、`mime`、`duration_ms`、`checksum`、`expires_at` | 产物登记，文件在对象存储，库里只存 `object_key` |
| `comic_films` | `id`、`project_id`、`title`、`status(draft/reviewing/published/archived)`、`current_version_id` | 成片主体；`current_version_id` 指向最新已发布版本 |
| `film_versions` | `id`、`film_id`、`version_no`、`object_key`、`duration_ms`、`resolution`、`composed_from_job_id`、`created_at` | 只追加；已发布版本不可覆盖，只能发新版 |

**content 域（已移除，2026-11-04）**

> 下表 8 张表（`projects`、`project_members`、`project_invitations`、`tasks`、`task_tags`、`task_events`、`sync_cursors`、`content_exports`）已从 `schema.sql` 删除，生产库同步 DROP。保留为历史设计记录。

| 表 | 关键字段 | 说明 / 索引 |
|---|---|---|
| `projects`（已删除） | `id`、`owner_user_id`、`region`、`name`、`description`、`status(active/archived/deleted)`、`version`、`created_at`、`updated_at`、`deleted_at` | 项目主体 |
| `project_members`（已删除） | `id`、`project_id`、`user_id`、`role(editor/viewer)`、`invited_by`、`joined_at`、`revoked_at` | 两档权限 |
| `project_invitations`（已删除） | `id`、`project_id`、`invite_type(phone/email)`、`invitee_hash`、`token_hash`、`status`、`expires_at`、`invited_by` | 邀请加入项目 |
| `tasks`（已删除） | `id`、`project_id`、`parent_task_id`、`title`、`description`、`due_date`、`status`、`completed_at`、`client_updated_at`、`version`、`sort_order`、`deleted_at` | 两层任务 |
| `task_tags`（已删除） | `id`、`task_id`、`tag` | 标签 |
| `task_events`（已删除） | `id`、`task_id`、`project_id`、`actor_id`、`action`、`changed_fields`、`client_ts`、`server_ts`、`seq` | 增量同步与审计源 |
| `sync_cursors`（已删除） | `id`、`user_id`、`device_id`、`last_seq`、`updated_at` | 离线增量游标 |
| `content_exports`（已删除） | `id`、`user_id`、`project_id`、`format(csv)`、`status`、`object_key`、`expires_at` | CSV 导出 |

原同步落库规则（已失效）：`tasks` 更新与 `task_events` 插入同事务，`/api/v1/sync/changes` 增量拉取，LWW 冲突裁决。当前无增量同步实现。

**content 域（P1 通用内容管理）**

| 表 | 关键字段 | 说明 / 索引 |
|---|---|---|
| `contents` | `id`、`author_user_id`、`type`、`title`、`status(draft/published/blocked/deleted)`、`region`、`deleted_at` | 内容主体（仅 P1，任务数据不进此表） |
| `content_versions` | `id`、`content_id`、`version_no`、`body`、`created_by`、`created_at` | 历史版本，只追加 |
| `audit_records` | `id`、`content_id`、`stage(machine/manual/appeal)`、`result(pass/reject)`、`reason`、`reviewer_id` | 审核留痕，状态只能由此推进 |
| `search_index_queue` | `id`、`content_id`、`op(upsert/delete)`、`status`、`retry_count` | 检索索引投递，失败可重放 |

**im / ai / admin / ops 域**（同样按上表格式落地，此处列核心表名与用途）

| schema | 表 | 用途 |
|---|---|---|
| `im` | `conversations`、`conversation_members`、`messages`、`message_receipts`、`attachments` | 会话与消息（P1） |
| `ai` | `prompt_templates`、`ai_requests`、`usage_quotas`、`model_routes` | Prompt 版本、调用流水、配额、模型路由 |
| `admin` | `admin_users`、`roles`、`permissions`、`role_bindings`、`operation_logs`、`tickets`、`feature_flags`、`announcements` | RBAC、操作审计、工单、开关、公告 |
| `ops` | `idempotency_keys`、`outbox_events`、`dead_letters`、`job_runs` | 幂等、事务性发件箱、失败队列、任务记录（`audit_logs` 已于 2026-11-05 随审计域删除） |

### 3.3 状态机落库规则

- ~~`subscriptions.status`~~：已移除（2026-11-05，FR-02 整域删除，`subscriptions` / `subscription_events` 同步 DROP）。
- ~~`orders.status`~~：已移除（2026-11-05，FR-02 整域删除，`orders` / `payments` / `refunds` / `invoices` 同步 DROP）。
- 所有状态写入必须携带 `idempotency_key`，重复请求返回首次结果（PRD §6 幂等规则）；同键同体重放首次响应，同键异体返回 `409`。
- ~~`tasks.status`~~：已移除（2026-11-04，FR-03 删除，`tasks` 表同步 DROP）。
- ~~`projects.status`~~：已移除（2026-11-04，FR-03 删除，`projects` 表同步 DROP）。
- ~~`project_invitations.status`~~：已移除（2026-11-04，FR-03 删除，`project_invitations` 表同步 DROP）。
- ~~任务写操作幂等与 LWW~~：已移除（2026-11-04，随 FR-03 删除；本仓库所有写操作仍强制 `Idempotency-Key`，`auth` 路由豁免）。
- `contents.status`（P1）：`draft → published ⇄ blocked`、`published → deleted`；任何机审/人审结论只能经 `audit_records` 追加，不允许直接改 `contents.status` 跳过审核。
- `modules.status`（**写路径已实现，2026-11-07**：`PATCH /modules/:code/status` + 状态机校验 + 契约测试 7 例）：只能 `draft → active → archived` 单向；`archived` 后不可新购，已购 `entitlements` 不受影响；`code` 一旦分配在区内永不复用（唯一约束为 `(region, code)`）。
- `entitlements.status`（**发放/回收写路径已实现，2026-11-07**：`POST /entitlements/grant` / `POST /entitlements/:id/revoke` 与 `entitlement_events` 同事务写入；到期由 `src/jobs.ts` 的 `entitlement-expiry` 任务扫描迁移）：只能经 `entitlement_events` 追加推进；`revoked`（风控回收）与 `expired`（时效到期）必须与触发动作**同事务**写入，不允许事后异步补写。原「由 `refunds.executed` 或订阅状态机触发」的路径已随 FR-02 于 2026-11-05 下线。当前只读门禁 `requireEntitlement` 已按 `status='active' AND (expires_at IS NULL OR expires_at > now)` 判定。
- `comic_projects.status`（**第 1 期已实现 `draft ⇄ storyboarded`；第 2 期骨架已实现 `storyboarded → generating → rendered → published`**，`archived` 保留给归档流）：进入 `storyboarded` 必须有对应 `storyboards` 已确认版本（`confirmed_at` 非空），且仅 `draft`/`storyboarded` 两种状态允许编辑与写分镜；首个 `generation_jobs` 派发驱动 `storyboarded → generating`，`compose` 任务成功驱动 `generating → rendered`（骨架口径；`orchestrator.ts` 已于 2026-11-05 装配进 `app.ts`/`index.ts`，接入真实厂商模型后收紧为「产物覆盖全部分镜」）；成片 `publish` 驱动 `rendered → published`，不得跳级。
- `comic_films.status`（**第 2 期骨架已实现**）：`draft → reviewing → published → archived`；提交审核要求最新版本已登记 `object_key`；驳回回到 `draft` 并留原因（`review_note`）；`published` 只能由 `current_version_id` 指向的 `film_versions` 支撑，版本只追加不覆盖，发新版回到 `draft` 待重审。
- `generation_jobs.status`（**第 2 期骨架已实现**）：`queued → running → succeeded | failed | canceled` 单向；失败重试**新建** job（`retry_of` 指向原 job），历史 job 与产物永不覆盖；额度在 `succeeded` 时结算（`src/orchestrator.ts` 已内置单任务/当日成本预检，并已于 2026-11-05 装配进 `app.ts`/`index.ts`）。状态迁移既可由编排控制面端点驱动，也可由 worker 轮询队列自动消费（`MIM_AI_WORKER` 默认 `1`，置 `0` 关闭）。

## 4. 前端（多端）模块清单

### 4.1 端划分与职责

| 端 | 技术栈（规划） | 入口/路由 | P0 页面 |
|---|---|---|---|
| `apps/web` | Next.js（SSR + PWA） | `/`（营销）、`/app/*`（工作区）、`/[locale]/*` | **当前实况**：登录、账号设置（含地区信息）、协议页；~~计划与支付、订阅管理~~ 已随 FR-02 于 2026-11-05 删除。规划新增：商城、漫剧工作台、成片管理 |
| `apps/mini` | uni-app 或 Taro（多编译目标、分包） | 首页、我的、设置 | 微信授权登录、设置（原「订阅」入口随 FR-02 下线） |
| `apps/mobile` | Flutter（iOS/Android/鸿蒙 ArkTS 适配层） | 同上 | 登录、工作区、推送设置（IAP 支付随 FR-02 下线） |
| `apps/desktop` | Tauri（Win/macOS/Linux） | 同上 | 登录（浏览器回调）、工作区、更新提示 |
| `apps/admin` | React + Ant Design Pro | `/admin/*` | 见 §5 后台管理平台 |

### 4.2 共享包职责

| 包 | 职责 | 禁止事项 |
|---|---|---|
| `core-domain` | 类型、状态机、校验规则（纯函数，可单测）；当前仅含错误码/金额/UUIDv7 | 禁止 import 任何端 SDK；原权限判断与任务层级已于 2026-11-04 随 FR-03 删除，套餐/订阅/订单模型已于 2026-11-05 随 FR-02 删除 |
| `core-sdk` | 由 OpenAPI 生成的请求客户端 + 类型 + 错误码 | 禁止手写接口与字段 |
| `ui-kit` | Design Token（颜色/间距/字号/圆角）+ 基础组件 | 禁止写业务逻辑 |
| `i18n` | 文案资源、复数规则、货币/时区格式化、RTL 预留 | 禁止硬编码文案 |
| `platform-adapter` | `IPlatformAdapter` 及子接口（auth/push/storage/share；`pay` 随 FR-02 于 2026-11-05 删除） | 业务层禁止 `if (platform)` 判断 |
| `capability-client` | 能力网关客户端（im/rtc/ai/push/storage 的统一调用与降级；`payment` 已随 FR-02 删除） | 禁止直连第三方 SDK |
| `observability` | 埋点、日志、错误上报、性能指标 | 禁止输出 PII 明文 |
| `testing-utils` | 契约测试夹具、e2e helper | 禁止依赖生产数据 |

### 4.3 页面级模块（P0 可交付集合）

| 模块 | 关键交互 | 涉及 FR |
|---|---|---|
| 登录/注册 | 手机号验证码、邮箱密码/验证码、微信/支付宝/Google/Apple 登录；频控与错误提示 | FR-01 |
| ~~计划与支付~~ | **已删除（2026-11-05）**：计划对比/周期切换/拉起支付/结果轮询等入口随 FR-02 整域移除 | FR-02（已下线） |
| ~~工作区框架/项目/任务/今日/日历/看板/协作/导出~~ | 已随 FR-03 于 2026-11-04 整体移除；当前 P0 页面仅剩登录、账号设置、协议与隐私、语言与地区 | FR-03（已移除） |
| 账号设置 | 资料、绑定管理、设备列表、注销（7 天冷静期可撤销） | FR-01 / FR-06 |
| ~~订阅管理~~ | **已删除（2026-11-05）**：周期查看/取消续费/换支付方式/发票/退款入口随 FR-02 整域移除 | FR-02（已下线） |
| 协议与隐私 | 首次强制勾选、政策更新后重新确认、SDK 清单展示 | FR-06 |
| 语言与地区 | 语言切换、币种展示、时区设置 | FR-05 |
| 功能模块商城（**🟡 后端建表 + 门禁，前端 0 代码**） | 模块列表（按 region/status 过滤）、模块详情（能力/价格/前置依赖）、解锁（校验前置依赖后直接落 `entitlements`，原「加入订单」已随 FR-02 下线）、解锁状态与到期展示 | FR-03.1 |
| 漫剧 AI 剧工作台（**🟢 后端第 1/2 期已落地（`comic` 域 7 表 + 24 条路由 + `orchestrator.ts`/`storage.ts` 已装配）；前端三标签页已落地**——创作（工程/角色/AI 建议）、生成任务（capabilities 横幅 / 派发 / 手动运行 / 失败透传 / 产物下载 / 3s 轮询）、成片（工程产物面板 / 版本面板下载播放 / 审核发布），2026-11-06） | 工程列表/详情、剧本与角色设定（character bible）、分镜表（镜头序列/台词/时长）、单镜头重生成、生成任务进度与失败重试 | FR-03.2（形态②④①） |
| 成片管理（**🟢 后端已落地（第 2 期 `comic_films`/`film_versions` + `/comic/films/*`）；前端已落地**——工作台成片标签页：列表/版本面板（预签名下载/播放）/提交审核/发布/驳回/归档，2026-11-06） | 成片列表、版本列表、审核状态、发布/归档、导出（分辨率/格式，预签名 URL 下载） | FR-03.2（形态③） |
| 站点地图（**🟢 前后端已落地，2026-11-06**） | 45 个主机模块按 8 分类分组展示；zone 切换（全部 / `laal.top` / `mixm.top`）、分类筛选、关键词搜索（覆盖 host / 备注 / 记录值）；每条记录展示 `record_type` + `record_value` 并外链 `https://{fqdn}`。数据源为 DNSPod 导出备注（`services/mim-api/src/site.ts` 静态常量，无数据表） | 非 PRD FR（站点运维可视化，随备注结构化新增） |

任务写操作统一交互规则（历史，已随 FR-03 移除）：客户端先行乐观更新并在本地维护待同步队列；离线变更恢复连接后按 `task_events.seq` 增量合并；冲突由服务端 last-write-wins 裁决。当前无任务写操作，`features` 鉴权亦一并移除。

### 4.4 多端一致性检查点（进 CI）

1. 同一条文案在任意端出现两次硬编码 → 失败；
2. 同一错误码在不同端映射到不同提示 → 失败；
3. `IPlatformAdapter` 契约测试未覆盖新增平台方法 → 失败；
4. Design Token 外出现硬编码色值（如 `#2563eb`）→ 警告；
5. ~~任务状态判断或项目权限判断未复用 `core-domain`~~ → 已失效（FR-03 移除，`core-domain` 不再含权限/任务模块）；
6. ~~同一视图能力按端类型而非 `features` 显隐~~ → 已失效（`features` 已随 FR-03 移除）；
7. ~~任务乐观更新与服务端权威行一致性夹具~~ → 已失效（无任务写操作）。

## 5. 后台管理平台（apps/admin + services/admin-api）

### 5.1 角色与权限（RBAC）

| 角色 | 可见域 | 可写操作 |
|---|---|---|
| 超级管理员 | 全部 | 全部（含角色分配） |
| 运营 | 用户、模块（`catalog`）、内容（P1）、公告 | 模块上架/定价配置、解锁发放与回收、公告发布、内容处置（仅 P1） |
| ~~财务~~ | **已删除（2026-11-05）**：订单/支付/退款/对账/发票可见域不再存在 | 无（原退款审核、对账差异核销、发票开具随 FR-02 移除） |
| 客服 | 用户、工单 | 工单处理（原「订单检索」与「补偿期发放」随 FR-02 于 2026-11-05 移除） |
| 内容审核 | 内容（P1）、审核队列 | 审核通过/驳回/下架（仅 P1 `contents`） |
| 只读审计 | 全部（只读） | 无（原「审计日志归档」已随审计域删除） |

硬规则：**任何写操作必须写 `admin.operation_logs`**（操作人、对象、前后值、IP、时间）；跨 region 查询需显式切换且留痕。原「金额相关写操作需第二人复核（四眼原则）」**当前无适用对象**——所有金额写操作（订单/支付/退款/发票）已于 2026-11-05 随 FR-02 整域下线，未来若重开计费能力须同步恢复该规则。

原「P0 任务与协作数据后台默认只读」规则已失效（2026-11-04，FR-03 项目/任务数据整体移除；审核队列仅服务 P1 `contents`）。

### 5.2 功能模块

| 模块 | 功能点 | 关联后端 |
|---|---|---|
| 用户管理 | 检索、详情（账号/设备/解锁时间线，原「订阅/订单时间线」随 FR-02 下线）、封禁/解封、注销协助、账号合并审批 | identity |
| 模块与解锁（`catalog`） | 模块检索/上下架（`draft`/`active`/`archived`）、定价与生效期配置、解锁记录查询、手工发放/回收（经 `entitlement_events` 留痕） | catalog |
| ~~订单与支付~~ | **已删除（2026-11-05）**：订单检索、支付流水、掉单补发、重试、通道状态对照随 FR-02 整域移除 | ~~billing / payment-driver~~ |
| ~~退款工单~~ | **已删除（2026-11-05）**：申请→审核→执行→结果回写全流程随 FR-02 整域移除 | ~~billing~~ |
| ~~订阅管理~~ | **已删除（2026-11-05）**：计划/价格配置、升降级、补偿期、批量导出随 FR-02 整域移除 | ~~billing~~ |
| ~~对账中心~~ | **已删除（2026-11-05）**：批次列表、差异清单、核销、财务凭证导出随 FR-02 整域移除 | ~~billing~~ |
| ~~任务与项目运维（P0）~~ | ~~项目/任务检索、只读详情（成员、协作者数、配额超限提示）、导出异常排查~~ | ~~content~~ —— 已移除（2026-11-04，FR-03 删除） |
| 内容审核（P1） | 机审结果、人审队列、处置动作、申诉（仅 P1 `contents`） | content |
| 工单系统 | 客服工单、SLA、内部备注、用户可见回复 | admin / notification |
| 经营看板 | **待重新定义**：原 MRR/ARR、ARPU、续费率、流失率、退款率、支付成功率等订阅制指标随 FR-02 于 2026-11-05 失效；当前可观测口径为解锁数、生成任务量与成本、region 拆分 | 数仓/只读副本 |
| 配置中心 | Feature Flag、灰度比例、公告、通知模板 | admin / notification |
| ~~审计查询~~ | **已删除（2026-11-05）**：管理端操作日志 + 业务审计日志查询随审计域（`routes/audit.ts` + `audit_logs`）整域移除 | ~~ops~~ |

### 5.3 后台不得做的事

- 不得直接改账：金额调整只能通过「冲正/退款/补偿」三类受控动作（**当前无计费写操作，规则随 FR-02 于 2026-11-05 暂停生效**）；
- 不得绕过状态机改解锁状态（原「改订阅状态」随 FR-02 下线；`entitlements` 的状态变更须经 `entitlement_events` 追加）；
- 不得导出含 PII 的明文报表（导出需脱敏 + 审批 + 水印）；
- 不得跨 region 合并数据。

## 6. 存储设计

| 存储 | 用途 | 关键配置 |
|---|---|---|
| PostgreSQL | 主业务库（按 region 分集群、按域分 schema） | 主从 + 只读副本（供 admin 看板）；PITR 备份；连接池上限按服务配额 |
| Redis | 会话/刷新令牌黑名单、验证码、频控计数、解锁状态缓存（TTL 5 分钟，原「订阅状态缓存」随 FR-02 于 2026-11-05 下线）、分布式锁、轻量队列 | 开启持久化用于锁场景；key 前缀按域隔离 |
| OpenSearch | P1 内容与后台检索、日志检索；**P1 漫剧工程/成片与生成产物的元数据检索**（P0 无检索需求，原项目/任务检索随 FR-03 移除） | 按 region 独立索引；索引按天滚动 |
| 对象存储 | 头像、音视频录制；**漫剧关键帧、分镜片段、TTS 音频、成片**（`generation_assets` / `film_versions` 仅存 `object_key`） | 私有桶 + 预签名 URL；录制保留期按业务配置；漫剧原始产物保留 90 天、已发布成片按版权要求长期保留。原「发票 PDF」10 年保留要求随 FR-02 移除，原 CSV 导出产物随 FR-03 移除 |
| CDN | 静态资源、媒体分发（含漫剧成片播放） | 国内/海外分开加速域；回源鉴权 |
| MQ（Kafka/RabbitMQ） | 领域事件、异步任务、事务性发件箱（原 P0 `task.changed` 事件随 FR-03 移除）；**`generation.job.*`（入队/状态变更/完成/失败）与 `entitlement.*`（发放/回收）事件** | `outbox_events → MQ`，消费失败进 `dead_letters` 并可重放；生成任务队列与业务事件队列分 topic |

数据分级：

| 级别 | 数据 | 处理 |
|---|---|---|
| L1 敏感 | 手机号、邮箱、密码哈希、支付凭证（**当前无支付能力，凭证类型随 FR-02 于 2026-11-05 移除**） | 加密存储、展示脱敏、禁止进日志与埋点 |
| L2 业务 | 内容正文（P1）、**漫剧工程与成片、解锁与回收记录**（原「订单/订阅」随 FR-02 移除） | 按 region 隔离、按角色授权、审计访问 |
| L3 公开 | 模块价格（原「计划价格」随 FR-02 改名）、公开内容 | 可缓存、可 CDN |

## 7. API 契约规范

| 项 | 规则 |
|---|---|
| 风格 | REST + OpenAPI 3.1（实时能力另用 WebSocket/proto） |
| 版本 | 路径前缀 `/api/v1`；破坏性变更走 `/v2` 并保留过渡期 |
| 鉴权 | `Authorization: Bearer <access_token>`；刷新令牌轮换；服务间用 mTLS/签名 |
| 幂等 | 写接口支持 `Idempotency-Key` 头，落 `ops.idempotency_keys` |
| 分页 | 游标分页（`cursor` + `limit`），禁止 offset 深翻页 |
| 错误 | 统一信封 `{ code, message, request_id, details? }`；`request_id` 全链路透传 |
| 时间/金额 | ISO8601 UTC 字符串；金额整数 + `currency` |
| 多语言 | 错误 `code` 与文案分离，`Accept-Language` 由 gateway 注入 |
| 限流 | 按 `user_id`/IP/API Key 三档，阈值按端点配置 |

## 8. 定时任务与队列（services/jobs）

| 任务 | 频率 | 幂等/补偿 |
|---|---|---|
| ~~订阅到期扣款~~ | — | **已删除（2026-11-05）**：随 FR-02 整域移除，无订阅扣款 |
| ~~到期提醒（7/3/1 天）~~ | — | **已删除（2026-11-05）**：订阅续费提醒随 FR-02 移除 |
| ~~支付对账~~ | — | **已删除（2026-11-05）**：随 FR-02 整域移除 |
| ~~掉单补发扫描~~ | — | **已删除（2026-11-05）**：随 FR-02 整域移除 |
| ~~`past_due` 重试扣款~~ | — | **已删除（2026-11-05）**：随 FR-02 整域移除 |
| 注销冷静期到期清理 | 每日 | 只处理到期且未撤销 |
| ~~审计日志归档~~ | — | **已删除（2026-11-05）**：`audit_logs` 表随审计域 DROP |
| 搜索索引投递（P1） | 持续消费 | 仅 P1 `contents`；失败进死信，可重放 |
| 配额重置（AI/存储） | 每月 1 日 | 按 `quota_id + period` 幂等（原「订阅计划额度」口径随 FR-02 下线；当前以 `MIM_AI_JOB_COST_LIMIT_MINOR` / `MIM_AI_DAILY_COST_LIMIT_MINOR` 成本上限落地） |
| **AI 生成任务队列消费**（**已落地，2026-11-05**） | 持续消费 | `src/orchestrator.ts` 消费 `generation_jobs`（`text`/`image`/`video`/`tts`/`compose`）；`MIM_AI_WORKER` 默认 `1` 随进程启动；同工程串行、跨工程并行；失败进死信可重放；重试新建 job（`retry_of`）不覆盖历史 |
| **生成成本告警**（**已落地，2026-11-07**：`src/jobs.ts` `runCostAlert`） | 每小时（`DEFAULT_INTERVALS['cost-alert'] = 3600_000`） | 近一小时 `generation_jobs.cost_estimate_minor` 之和对比小时上限（`MIM_AI_HOURLY_COST_LIMIT_MINOR`，缺省按 `MIM_AI_DAILY_COST_LIMIT_MINOR / 24` 向上取整，日上限缺省 500000），越线即告警；幂等键 `job:cost-alert:<YYYY-MM-DDTHH>`（`idempotency_keys` 中 `user_id='system'`、`method='JOB'`） |
| **成片审核超时提醒**（**已落地，2026-11-07**：`src/jobs.ts` `runFilmReviewSla`） | 每 6 小时（`DEFAULT_INTERVALS['film-review-sla'] = 21600_000`） | `comic_films.status = 'reviewing'` 且 `updated_at` 早于 `now - SLA` 的条目计数告警；SLA 由 `MIM_FILM_REVIEW_SLA_HOURS` 配置（缺省 48）；幂等键 `job:film-review-sla:<YYYY-MM-DDTHH>` |
| **解锁到期扫描**（**已落地，2026-11-07**：`src/jobs.ts` `runEntitlementExpiry`） | 每日（`DEFAULT_INTERVALS['entitlement-expiry'] = 86400_000`） | 时效型 `entitlements`（`status='active' AND expires_at <= now`）转 `expired`，UPDATE 与 `entitlement_events` 追加（`actor='job'`、`reason='expires_at reached'`）**同事务**；原「订阅 `expired` → 订阅型 entitlement 转 `expired`」随 FR-02 于 2026-11-05 下线；逐条幂等键 `job:entitlement-expiry:<entitlement_id>:<expires_at>` |
| 截止日提醒推送 | — | 已移除（FR-03 删除；`features` 套餐能力校验与 `task_events` 提醒源同步取消） |
| 项目邀请过期 | — | 已移除（FR-03 删除，随 `project_invitations` 表清理） |
| CSV 导出生成 | — | 已移除（FR-03 删除，随 `content_exports` 表清理） |
| 同步事件与游标清理 | — | 已移除（FR-03 删除，随 `task_events` / `sync_cursors` 表清理） |

## 9. 可观测性与安全

- **链路**：`request_id` 贯穿 gateway → 服务 → MQ → jobs；结构化日志（JSON），禁止打印 PII；
- **指标**：**当前口径为生成任务成功率/失败原因分布、单任务与当日 AI 成本、解锁发放/回收数、接口 P95、错误码 TopN**；原「支付成功率（按 driver/region）、订阅续费率、掉单数、对账差异数」随 FR-02 于 2026-11-05 失效；
- **告警**：死信堆积、生成任务失败率异常、AI 单日成本逼近上限（`MIM_AI_DAILY_COST_LIMIT_MINOR`）、登录失败率异常；原「支付成功率骤降、对账差异超阈值」随 FR-02 移除；
- **安全**：全链路 TLS；密钥托管（KMS/Vault），禁止硬编码；WAF + 限流；后台管理端独立域名与二次认证；依赖漏洞扫描进 CI。

## 10. 落地顺序（与 PRD 优先级对齐）

| 阶段 | 交付物 | 对应 |
|---|---|---|
| 第 1 步 | monorepo 骨架、`identity`、`apps/web`（~~`billing` / `payment-driver` 已于 2026-11-05 随 FR-02 删除~~；~~`content` P0 任务与协作最小集~~ 已移除，FR-03） | P0 |
| 第 2 步 | `admin-api` 最小管理面（**已落地，2026-11-07**：`MIM_ADMIN_TOKEN` + `requireAdmin`，三条管理写路由；`apps/admin` 独立端未建）、`jobs`（~~续费/对账/掉单~~ 已删除；注销冷静期清理、AI 队列消费；**三定时任务已落地，2026-11-07**：成本告警 / 成片审核超时 / 权益到期扫描）（~~协作邀请与两档权限~~、~~同步通道~~、~~截止日提醒~~ 已随 FR-03 移除） | P0 运营闭环 |
| 第 3 步 | `apps/mobile`（~~IAP~~ 已随 FR-02 删除）、`notification`、i18n 首批语种（~~日历/看板视图~~、~~CSV 导出~~ 已随 FR-03 移除） | P0 完成 |
| 第 4 步 | `content`（P1 通用内容管理：内容/审核/检索）、`im`、`rtc`、`ai-orchestrator`、`openapi`、`apps/desktop` | P1 |

**FR-03 新范围（功能模块商城 + 漫剧 AI 剧）落地顺序**（与 [07-functional-modules.md](./07-functional-modules.md) §12 一致，四期串行）：

| 期次 | 交付物 | 对应形态 | 依赖前置 |
|---|---|---|---|
| 基座 | `catalog` 域 4 表已建（`modules`/`module_prices`/`entitlements`/`entitlement_events`）+ `/modules` `/entitlements` 路由**已实现（2026-11-07 补三条管理写路由）**；`requireEntitlement` 门禁已落地。~~`order_items` 挂载 `billing` 同事务~~、~~`entitlements` 发放/回收与退款同事务~~ 随 FR-02 于 2026-11-05 取消；`entitlements` 现由后台/风控动作直接写入并追加 `entitlement_events` | 商城（FR-03.1） | 无（复用现有 identity） |
| 第 1 期 | `comic` 域工程/角色/分镜三表；工作台的工程 CRUD、character bible、分镜编辑与人工确认 | ② AI 辅助创作工作台 | 第 1 期仅工程，不产出成片 |
| 第 2 期 | `generation_jobs` / `generation_assets` + `ai-orchestrator` 生成编排；文生图/图生视频/TTS/合成队列；工作台内单镜头生成与导出成片。**代码状态（2026-11-05）**：路由骨架 16 条已上线；`src/orchestrator.ts`（mock 产物真实落盘 + 成本预检 + compose 联动工程 `rendered`）与 `src/storage.ts`（local/S3 预签名）**已于 2026-11-05 装配进 `app.ts`/`index.ts`（`/api/v1/ai/*`、`/api/v1/media/*`，`MIM_AI_WORKER` 默认自动消费）**；openai 兼容提供方已接入 text/image（2026-11-06），video/tts/compose 诚实失败，更多真实模型调用待 OQ-08 凭证 | ④ 创作工作台 + 导出成片 | 模型供应商凭证（OQ-08）、对象存储 |
| 第 3 期 | 全自动流水线：题材/大纲一次输入跑完整条链（无人工确认点） | ① AI 全自动生成成片 | 第 2 期全链路稳定 |
| 第 4 期 | `comic_films` / `film_versions` + 审核发布 + 导出；成片列表/版本/浏览 | ③ 漫剧作品管理与分发 | 审核口径（OQ-07） |

**未决阻塞**：原「工作区实体设计」相关阻塞已随 FR-03 于 2026-11-04 整体移除而**失效**（8 张 content 表、两层任务限制、同步事务与 LWW 裁决、同步游标保留期、软删物理清理保留期均不再适用）；原 **OQ-02 / OQ-04（支付通道与退款窗口）已于 2026-11-05 随 FR-02 整域删除而失效**。仍需确认：OQ-03（首批语种）、OQ-05（账号合并）、**OQ-07（漫剧版权与审核口径）**、**OQ-08（生成模型供应商与成本上限）**、**OQ-09（模块定价模式与一次性购买退款窗口）**，见 [07-functional-modules.md](./07-functional-modules.md) §10。P1 通用内容管理（`contents` / 审核 / 检索）不阻塞 P0；FR-03 新范围的商城基座不依赖 OQ-07/08/09，漫剧第 1 期（工作台）亦不依赖 OQ-08（无真实模型调用），第 2 期起被 OQ-07 / OQ-08 阻塞。

---

_本页为开发实现规划草案，随代码落地逐节替换为「已实现」描述；修订时必须同步 [02-modules.md](./02-modules.md)、[04-dependencies.md](./04-dependencies.md)、[README.md](./README.md) 与根 README（铁律七）。_
