# 08 · 开发实现全景（数据库 / 前端 / 后端 / 存储 / 后台管理平台）

> **状态声明（证据）**：截至 V0.0.0-preview，仓库内已落地 `apps/web`（React + Vite）、`packages/core-domain`、`packages/i18n`、`services/mim-api`（Express + SQLite），包管理器 pnpm workspace；`pnpm -w typecheck` / `pnpm -w test`（12 例）/ `pnpm -w build` / `node scripts/version-check.mjs` 均已通过并有命令输出留档。
> **2026-11-04 变更**：FR-03 核心 SaaS 工作区（项目/任务/成员/邀请/仪表盘/增量同步/CSV 导出）已按用户指令整体移除，本页 §2 的 content 域表结构与后续同步/导出规则仅作历史参考，不再对应仓库实况。
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
│    im · rtc · ai-orchestrator · notification · openapi · admin-api · jobs
├── 数据层
│    PostgreSQL（按 region 物理分库，按域分 schema）
│    Redis（会话/频控/缓存/锁）· OpenSearch（检索）
│    对象存储 + CDN（媒体/附件/导出）· MQ（异步与事件）
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
| 部署形态 | 12 个独立服务 + gateway | 单服务 `services/mim-api`（模块化单体，路由按域分文件） | P0 先单体；路由边界已按域切分（`routes/auth|me|billing|audit.ts`）；原 FR-03 五条路由已于 2026-11-04 删除 |
| 数据库 | PostgreSQL 按 region 物理分库 + Redis + OpenSearch + MQ | SQLite 单库（`better-sqlite3`，WAL），进程内无外部依赖 | 降低本地/CI 启动成本；表结构（UUIDv7、`bigint` 金额、`deleted_at`、`version` 乐观锁、`idempotency_keys`）已按 PostgreSQL 可迁移口径设计 |
| 支付 | `payment-driver` 多通道 + 回调验签 | 仅 `mock` 驱动：checkout 即置 `paid` 并激活订阅；其余 driver 返回 `PAYMENT_DRIVER_UNAVAILABLE` | 无持牌通道凭证；接入真实 driver 时只替换 `billing.ts` 内驱动分支 |
| 实时同步 | WebSocket + MQ 推送，5 秒内到达 | **已移除（2026-11-04）**：原 4s 轮询 `GET /sync/changes` 随 FR-03 一并删除，当前无同步需求 |
| 客户端 | web / mini / mobile / desktop / admin 五端 | 仅 `apps/web`（React 18 + Vite 6），`/api` 与 `/health` 由 Vite 代理到 8787 | 先打通契约与核心流程；其余端复用同一 `/api/v1` 契约与 `packages/core-domain` |
| 共享包 | core-sdk / ui-kit / platform-adapter / observability / testing-utils | 仅 `packages/core-domain`（错误码/套餐/金额/ID）与 `packages/i18n`（zh-CN/en-US + 货币格式化） | 按需引入，未使用的能力不提前抽象；原 `permissions.ts` / `tasks.ts` 随 FR-03 删除 |
| 存储 | 对象存储 + CDN（附件/媒体/导出） | 无对象存储（原 CSV 导出随 FR-03 于 2026-11-04 删除） | 当前无导出需求；恢复导出能力时按对象存储 + 预签名 URL 方案实现 |
| 后台管理 | `admin-api` + RBAC 后台 | 未实现；审计数据已落 `audit_logs` 表 | P1 |
| 鉴权 | gateway 验签 + Redis 会话 | 进程内 JWT（`jsonwebtoken`）+ refresh 轮换；Bearer 中间件在 `middleware.ts` | 单实例即可；横向扩展时 refresh 存储换 Redis |
| 契约先行 | OpenAPI/proto 生成 `core-sdk` | 手写 `apps/web/src/api.ts` + zod 校验（`validate.ts`）+ snake_case 响应 + 错误信封 | P0 以契约测试（`test/api.test.ts` 12 例）保障字段一致性；后续补 OpenAPI 导出 |
| 仪表盘切日 | 展示端负责时区转换 | **已移除（2026-11-04）**：`routes/dashboard.ts` 随 FR-03 删除，服务端不再按用户时区切日；用户 `timezone` 字段与设置入口保留 | 恢复仪表盘能力时按原口径（`Intl.DateTimeFormat('sv-SE')` + 时区过滤）重新实现 |

## 2. 后端服务模块清单

| 服务 | 职责 | 对外接口（前缀 `/api/v1`） | 关键依赖 | region |
|---|---|---|---|---|
| `gateway` | 统一入口：鉴权、限流、灰度、region 路由、错误码归一、多语言注入 | 全部流量入口 | Redis（限流）、identity（验签） | cn / global |
| `identity` | 注册登录、第三方登录绑定、会话与设备、账号合并、注销 | `/auth/*`、`/accounts/*`、`/devices/*` | 短信/邮件通道、Redis | 分库 |
| `billing` | 计划与定价、订阅生命周期、续费、升降级、发票、对账 | `/plans`、`/subscriptions/*`、`/invoices/*` | payment-driver、MQ | 分库 |
| `payment-driver` | 支付编排 + 通道驱动（wechat / alipay / unionpay / stripe / paypal / apple-iap / google-play），统一回调 | `/payments/*`、`/callbacks/{driver}` | 各持牌通道、商店服务端 API | 按通道 |
| `content` | **P0 任务与协作域已整体移除（2026-11-04，本页保留为历史设计）**：原含项目/任务/子任务、列表/今日/日历/看板视图、个人仪表盘、成员邀请与两档权限、增量同步、CSV 导出；**P1 通用内容管理域**：内容/资源元数据、审核流、检索索引、推荐候选 | P1：`/contents/*`、`/search`（原 P0 的 `/projects/*`、`/tasks/*`、`/dashboard`、`/sync/*`、`/exports/*` 已删除） | P1：对象存储、OpenSearch、审核服务 | 分库 |
| `im` | 会话、消息可靠性、已读回执、在线状态、离线推送、审核 | `/im/*`（HTTP + WebSocket） | MQ、推送通道、审核服务 | 分库 |
| `rtc` | 信令、房间编排、录制、转码、质量监测 | `/rtc/*` | RTC 第三方、对象存储 | 分集群 |
| `ai-orchestrator` | 模型路由、Prompt 版本、输出审核、配额与成本核算 | `/ai/*` | 大模型供应商、审核服务 | 按合规域 |
| `notification` | 站内信、邮件、短信、推送编排与模板 | `/notifications/*` | 邮件/短信/推送通道 | 分库 |
| `openapi` | 开放平台：OAuth2、API Key、Webhook 投递、限流 | `/open/*` | gateway | 分库 |
| `admin-api` | 运营后台 BFF：聚合查询、写操作审批、审计埋点 | `/admin/*` | 各域服务、admin 库 | 分库 |
| `jobs` | 定时任务与队列消费者（见 §8） | 无 HTTP | MQ、全部域库 | 双区各一套 |

服务拆分原则：**先单体后拆分**。P0 允许 `identity + billing + payment-driver` 合为一个部署单元（模块化单体），但代码边界仍按上表分目录，避免后期拆分时重构业务逻辑。

各服务所需的第三方提供方、SDK/API 形态与密钥命名见 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)；密钥按 region 独立、不入库，仅存环境变量或 KMS。

## 3. 数据库设计

### 3.1 全局约束

| 约束 | 规则 |
|---|---|
| 分库 | `cn` 与 `global` **物理独立集群**，不共用实例；跨区只同步匿名聚合指标，不同步个人数据 |
| 分 schema | 按域：`identity` / `billing` / `content` / `im` / `ai` / `admin` / `ops` |
| 主键 | `id` 使用 UUIDv7（时间有序，便于索引与分片） |
| 金额 | 一律 `bigint` 整数**最小货币单位**（人民币=分，美元=分），配 `currency char(3)` |
| 时间 | `timestamptz`，统一 UTC 存储，展示端负责时区转换 |
| 软删除 | 业务表带 `deleted_at timestamptz NULL`；财务表**禁止软删除**，只能追加冲正记录 |
| 并发 | 带 `version int` 乐观锁；订阅状态变更必须走状态机校验 |
| 幂等 | 独立表 `ops.idempotency_keys(idempotency_key, scope, request_hash, response_json, created_at)`，唯一索引 `(scope, idempotency_key)` |
| 分区 | `orders` / `payments` / `audit_logs` 按月 RANGE 分区；`im.messages` 按会话哈希分片 |
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
| `account_merges` | `id`、`source_user_id`、`target_user_id`、`status`、`approved_by`、`executed_at` | OQ-05 落地；执行前必须校验订阅/订单归属 |

**billing 域**

| 表 | 关键字段 | 说明 / 索引 |
|---|---|---|
| `plans` | `id`、`code`、`name_i18n jsonb`、`billing_cycle(month/quarter/year)`、`region`、`status` | 计划定义；`code` 唯一。原 `features jsonb` 已于 2026-11-04 随 FR-03 删除 |
| `plan_prices` | `id`、`plan_id`、`currency`、`amount_minor`、`effective_from`、`effective_to` | **价格与计划解耦**，改价不改历史订单 |
| `subscriptions` | `id`、`user_id`、`plan_id`、`status(active/past_due/canceled/expired)`、`current_period_start/end`、`cancel_at_period_end`、`version` | 索引 `(user_id, status)`；状态机见 §3.3 |
| `subscription_events` | `id`、`subscription_id`、`from_status`、`to_status`、`reason`、`source(payment/refund/admin/job)`、`created_at` | 只追加，禁止 UPDATE |
| `orders` | `id`、`user_id`、`plan_id`、`amount_minor`、`currency`、`status(pending/paid/failed/closed)`、`idempotency_key`、`region` | 月分区；`(user_id, created_at)` 索引 |
| `payments` | `id`、`order_id`、`driver(wechat/alipay/.../apple_iap)`、`channel_txn_id`、`status`、`paid_at`、`raw_callback jsonb` | 唯一索引 `(driver, channel_txn_id)`——**防重复入账** |
| `refunds` | `id`、`payment_id`、`amount_minor`、`status(pending/approved/rejected/executed)`、`reviewer_id`、`executed_at` | 与 `orders` 分离，支持部分退款 |
| `invoices` | `id`、`order_id`、`title`、`tax_no`、`file_url`、`issued_at` | 发票/税务（出海 VAT 另立 `tax_rules`） |
| `reconciliation_batches` | `id`、`driver`、`biz_date`、`matched_count`、`diff_count`、`status` | 每日对账批次 |
| `reconciliation_diffs` | `id`、`batch_id`、`payment_id`、`type(missing_local/missing_channel/amount_mismatch)`、`resolved_by` | 差异处理留痕 |

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
| `ops` | `idempotency_keys`、`outbox_events`、`dead_letters`、`job_runs`、`audit_logs`（分区） | 幂等、事务性发件箱、失败队列、任务记录、审计 |

### 3.3 状态机落库规则

- `subscriptions.status` 只能经 `subscription_events` 追加推进，服务层用 `UPDATE ... WHERE version = ?` 乐观锁；非法跃迁（如 `expired → past_due`）直接拒绝并记审计。
- `orders.status` 单向：`pending → paid | failed | closed`；`paid → refunded` 由 `refunds.executed` 触发，不允许直接改 `orders` 金额。
- 所有状态写入必须携带 `idempotency_key`，重复请求返回首次结果（PRD §6 幂等规则）。
- ~~`tasks.status`~~：已移除（2026-11-04，FR-03 删除，`tasks` 表同步 DROP）。
- ~~`projects.status`~~：已移除（2026-11-04，FR-03 删除，`projects` 表同步 DROP）。
- ~~`project_invitations.status`~~：已移除（2026-11-04，FR-03 删除，`project_invitations` 表同步 DROP）。
- ~~任务写操作幂等与 LWW~~：已移除（2026-11-04，随 FR-03 删除；订阅域仍强制 `Idempotency-Key` + `version` 乐观锁）。
- `contents.status`（P1）：`draft → published ⇄ blocked`、`published → deleted`；任何机审/人审结论只能经 `audit_records` 追加，不允许直接改 `contents.status` 跳过审核。

## 4. 前端（多端）模块清单

### 4.1 端划分与职责

| 端 | 技术栈（规划） | 入口/路由 | P0 页面 |
|---|---|---|---|
| `apps/web` | Next.js（SSR + PWA） | `/`（营销）、`/app/*`（工作区）、`/[locale]/*` | 登录、计划与支付、工作区、账号设置、订阅管理、协议页 |
| `apps/mini` | uni-app 或 Taro（多编译目标、分包） | 首页、我的、订阅 | 微信授权登录、支付、订阅状态、设置 |
| `apps/mobile` | Flutter（iOS/Android/鸿蒙 ArkTS 适配层） | 同上 | 登录、IAP 支付、工作区、推送设置 |
| `apps/desktop` | Tauri（Win/macOS/Linux） | 同上 | 登录（浏览器回调）、工作区、更新提示 |
| `apps/admin` | React + Ant Design Pro | `/admin/*` | 见 §5 后台管理平台 |

### 4.2 共享包职责

| 包 | 职责 | 禁止事项 |
|---|---|---|
| `core-domain` | 类型、状态机、校验规则（纯函数，可单测）；当前含错误码/套餐/订阅/订单/金额/UUIDv7 | 禁止 import 任何端 SDK；原权限判断与任务层级已于 2026-11-04 随 FR-03 删除 |
| `core-sdk` | 由 OpenAPI 生成的请求客户端 + 类型 + 错误码 | 禁止手写接口与字段 |
| `ui-kit` | Design Token（颜色/间距/字号/圆角）+ 基础组件 | 禁止写业务逻辑 |
| `i18n` | 文案资源、复数规则、货币/时区格式化、RTL 预留 | 禁止硬编码文案 |
| `platform-adapter` | `IPlatformAdapter` 及子接口（auth/pay/push/storage/share） | 业务层禁止 `if (platform)` 判断 |
| `capability-client` | 能力网关客户端（payment/im/rtc/ai/push/storage 的统一调用与降级） | 禁止直连第三方 SDK |
| `observability` | 埋点、日志、错误上报、性能指标 | 禁止输出 PII 明文 |
| `testing-utils` | 契约测试夹具、e2e helper | 禁止依赖生产数据 |

### 4.3 页面级模块（P0 可交付集合）

| 模块 | 关键交互 | 涉及 FR |
|---|---|---|
| 登录/注册 | 手机号验证码、邮箱密码/验证码、微信/支付宝/Google/Apple 登录；频控与错误提示 | FR-01 |
| 计划与支付 | 计划对比、周期切换、拉起支付、结果轮询、失败重试 | FR-02 |
| ~~工作区框架/项目/任务/今日/日历/看板/协作/导出~~ | 已随 FR-03 于 2026-11-04 整体移除；当前 P0 页面仅剩登录、计划与支付、账号设置、订阅管理、协议与隐私、语言与地区 | FR-03（已移除） |
| 账号设置 | 资料、绑定管理、设备列表、注销（7 天冷静期可撤销） | FR-01 / FR-06 |
| 订阅管理 | 查看周期、取消续费、更换支付方式、发票申请、退款入口 | FR-02 |
| 协议与隐私 | 首次强制勾选、政策更新后重新确认、SDK 清单展示 | FR-06 |
| 语言与地区 | 语言切换、币种展示、时区设置 | FR-05 |

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
| 运营 | 用户、计划、内容（P1）、公告 | 计划配置、公告发布、内容处置（仅 P1） |
| 财务 | 订单、支付、退款、对账、发票 | 退款审核、对账差异核销、发票开具 |
| 客服 | 用户、订单、工单 | 工单处理、补偿期发放（需审批） |
| 内容审核 | 内容（P1）、审核队列 | 审核通过/驳回/下架（仅 P1 `contents`） |
| 只读审计 | 全部（只读） | 无 |

硬规则：**任何写操作必须写 `admin.operation_logs`**（操作人、对象、前后值、IP、时间）；金额相关写操作需第二人复核（四眼原则）；跨 region 查询需显式切换且留痕。

原「P0 任务与协作数据后台默认只读」规则已失效（2026-11-04，FR-03 项目/任务数据整体移除；审核队列仅服务 P1 `contents`）。

### 5.2 功能模块

| 模块 | 功能点 | 关联后端 |
|---|---|---|
| 用户管理 | 检索、详情（账号/设备/订阅/订单时间线）、封禁/解封、注销协助、账号合并审批 | identity |
| 订单与支付 | 订单检索、支付流水、掉单补发、重试、通道状态对照 | billing / payment-driver |
| 退款工单 | 申请→审核→执行→结果回写；IAP 单标注「走商店流程」并只做记录 | billing |
| 订阅管理 | 计划/价格配置（含生效时间）、升降级、补偿期、批量导出 | billing |
| 对账中心 | 批次列表、差异清单、核销、导出财务凭证 | billing |
| ~~任务与项目运维（P0）~~ | ~~项目/任务检索、只读详情（成员、协作者数、配额超限提示）、导出异常排查~~ | ~~content~~ —— 已移除（2026-11-04，FR-03 删除） |
| 内容审核（P1） | 机审结果、人审队列、处置动作、申诉（仅 P1 `contents`） | content |
| 工单系统 | 客服工单、SLA、内部备注、用户可见回复 | admin / notification |
| 经营看板 | MRR/ARR、ARPU、续费率、流失率、退款率、支付成功率、region 拆分 | 数仓/只读副本 |
| 配置中心 | Feature Flag、灰度比例、公告、通知模板 | admin / notification |
| 审计查询 | 管理端操作日志 + 业务审计日志（180 天在线，冷存归档） | ops |

### 5.3 后台不得做的事

- 不得直接改账：金额调整只能通过「冲正/退款/补偿」三类受控动作；
- 不得绕过状态机改订阅状态；
- 不得导出含 PII 的明文报表（导出需脱敏 + 审批 + 水印）；
- 不得跨 region 合并数据。

## 6. 存储设计

| 存储 | 用途 | 关键配置 |
|---|---|---|
| PostgreSQL | 主业务库（按 region 分集群、按域分 schema） | 主从 + 只读副本（供 admin 看板）；PITR 备份；连接池上限按服务配额 |
| Redis | 会话/刷新令牌黑名单、验证码、频控计数、订阅状态缓存（TTL 5 分钟）、分布式锁、轻量队列 | 开启持久化用于锁场景；key 前缀按域隔离 |
| OpenSearch | P1 内容与后台检索、日志检索；P0 无检索需求（原项目/任务检索随 FR-03 移除） | 按 region 独立索引；索引按天滚动 |
| 对象存储 | 头像、附件、发票 PDF、音视频录制 | 私有桶 + 预签名 URL；发票 10 年、录制按套餐。原 CSV 导出产物随 FR-03 移除 |
| CDN | 静态资源、媒体分发 | 国内/海外分开加速域；回源鉴权 |
| MQ（Kafka/RabbitMQ） | 领域事件、异步任务、事务性发件箱（原 P0 `task.changed` 事件随 FR-03 移除） | `outbox_events → MQ`，消费失败进 `dead_letters` 并可重放 |

数据分级：

| 级别 | 数据 | 处理 |
|---|---|---|
| L1 敏感 | 手机号、邮箱、密码哈希、支付凭证 | 加密存储、展示脱敏、禁止进日志与埋点 |
| L2 业务 | 订单、订阅、内容正文（P1） | 按 region 隔离、按角色授权、审计访问 |
| L3 公开 | 计划价格、公开内容 | 可缓存、可 CDN |

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
| 订阅到期扣款 | 每小时 | 以 `subscription_id + period` 幂等 |
| 到期提醒（7/3/1 天） | 每日 | 通知去重键 |
| 支付对账 | 每日 | 批次号唯一，可重跑 |
| 掉单补发扫描 | 每 15 分钟 | 状态机校验，不重复发放 |
| `past_due` 重试扣款 | 按退避策略 | 上限次数后置 `expired` |
| 注销冷静期到期清理 | 每日 | 只处理到期且未撤销 |
| 审计日志归档 | 每日 | 180 天在线，之后冷存 |
| 搜索索引投递（P1） | 持续消费 | 仅 P1 `contents`；失败进死信，可重放 |
| 配额重置（AI/存储） | 每月 1 日 | 按 `quota_id + period` 幂等 |
| 截止日提醒推送 | — | 已移除（FR-03 删除；`features` 套餐能力校验与 `task_events` 提醒源同步取消） |
| 项目邀请过期 | — | 已移除（FR-03 删除，随 `project_invitations` 表清理） |
| CSV 导出生成 | — | 已移除（FR-03 删除，随 `content_exports` 表清理） |
| 同步事件与游标清理 | — | 已移除（FR-03 删除，随 `task_events` / `sync_cursors` 表清理） |

## 9. 可观测性与安全

- **链路**：`request_id` 贯穿 gateway → 服务 → MQ → jobs；结构化日志（JSON），禁止打印 PII；
- **指标**：支付成功率（按 driver/region）、订阅续费率、掉单数、对账差异数、接口 P95、错误码 TopN；
- **告警**：支付成功率骤降、对账差异超阈值、死信堆积、登录失败率异常；
- **安全**：全链路 TLS；密钥托管（KMS/Vault），禁止硬编码；WAF + 限流；后台管理端独立域名与二次认证；依赖漏洞扫描进 CI。

## 10. 落地顺序（与 PRD 优先级对齐）

| 阶段 | 交付物 | 对应 |
|---|---|---|
| 第 1 步 | monorepo 骨架、`identity`、`billing`、`payment-driver`（国内通道）、`apps/web`（~~`content` P0 任务与协作最小集~~ 已移除，FR-03） | P0 |
| 第 2 步 | `admin-api` + `apps/admin` 最小集（用户/订单/退款/审计）、`jobs`（续费/对账/掉单）（~~协作邀请与两档权限~~、~~同步通道~~、~~截止日提醒~~ 已随 FR-03 移除） | P0 运营闭环 |
| 第 3 步 | `apps/mobile` + IAP、`notification`、i18n 首批语种（~~日历/看板视图~~、~~CSV 导出~~ 已随 FR-03 移除） | P0 完成 |
| 第 4 步 | `content`（P1 通用内容管理：内容/审核/检索）、`im`、`rtc`、`ai-orchestrator`、`openapi`、`apps/desktop` | P1 |

**未决阻塞**：原「工作区实体设计」相关阻塞已随 FR-03 于 2026-11-04 整体移除而**失效**（8 张 content 表、两层任务限制、同步事务与 LWW 裁决、同步游标保留期、软删物理清理保留期均不再适用）。仍需确认：外部依赖 OQ-02 / OQ-04（支付通道细节）、OQ-03（首批语种）、OQ-05（账号合并）见 [07-functional-modules.md](./07-functional-modules.md) §10。P1 通用内容管理（`contents` / 审核 / 检索）不阻塞 P0。

---

_本页为开发实现规划草案，随代码落地逐节替换为「已实现」描述；修订时必须同步 [02-modules.md](./02-modules.md)、[04-dependencies.md](./04-dependencies.md)、[README.md](./README.md) 与根 README（铁律七）。_
