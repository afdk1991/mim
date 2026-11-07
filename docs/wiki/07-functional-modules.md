# 07 · 功能模块

> 本页从 [Mim-PRD.html](file:///f:/合并项目/Mim/Mim-PRD.html)（V0.0.0-preview 草案）§3–§7 提取产品功能模块全景。所有条目均锚定 PRD 原文，`TBD` / `Assumption` 标注与 PRD 保持一致。技术/架构视角的模块清单见 [02-modules.md](./02-modules.md)，本页为产品功能视角。

## 1. 模块全景

| 模块 | PRD 锚点 | 优先级 | 状态（证据见 [08](./08-dev-implementation.md) §1.1） |
|---|---|---|---|
| FR-01 账号与身份 | §5 FR-01 | P0 | **已实现（P0 最小集）**：cn 手机号验证码、global 邮箱密码/验证码；JWT access + refresh 轮换；region 强隔离。未实现：微信/支付宝/Google/Apple 第三方登录、账号合并（OQ-05）、新设备登录保护 |
| FR-02 订阅与支付 | §5 FR-02 | P0 | **已下线（2026-11-05）**：套餐/订阅/订单/支付/退款/发票/对账整域已按用户指令删除（后端 `routes/billing.ts`、`packages/core-domain` 的 plans/subscription/order、前端 `Plans.tsx`、生产库 9 张表），取证见本页 §11.2 与 `deploy/migrations/2026-11-05-drop-billing-audit.cjs` |
| FR-03 核心 SaaS 工作区 | §5 FR-03 | P0 | **已重定义（2026-11-04）为「功能模块商城 + 漫剧 AI 剧」**：原项目/任务/成员/邀请/仪表盘/增量同步/CSV 导出已从前后端与生产库删除。新范围 **部分落地（2026-11-04，第 1 期）**：`catalog` 域 4 表（`modules`/`module_prices`/`entitlements`/`entitlement_events`）与 `comic` 域 3 表（`comic_projects`/`comic_characters`/`storyboards`）已建；`requireEntitlement` 门禁与 `/api/v1/comic/*` 8 条路由已落地；生成队列、成片与导出未落地。实现拆分见本页 §12 |
| FR-04 多端体验一致性 | §5 FR-04 | P0 | **部分实现**：`packages/core-domain`（领域/权限/错误码）+ `packages/i18n`（双语文案/货币格式化）+ 统一 HTTP 契约已落地；仅 Web 一端，`IPlatformAdapter` 未落地 |
| FR-05 国际化与本地化 | §5 FR-05 | P0 | **部分实现**：zh-CN / en-US 文案包、未命中回退链、`formatCurrency`、UTC 存储；未实现：语言切换 UI 持久化、RTL、时区设置 UI |
| FR-06 合规与隐私 | §5 FR-06 | P0 | **部分实现**：手机号/邮箱规范化与脱敏、账号注销 + 7 天冷静期（`POST /me/deletion`）。**审计日志已下线（2026-11-05）**：`routes/audit.ts` 与 `audit_logs` 表已删除。未实现：隐私政策强制勾选、数据导出/GDPR 请求 |
| IM / 音视频 / AI 编排 / 内容管理 / 开放平台 / 管理后台 | §3 P1 清单 | P1 | 后续迭代，仅列名 |
| 平台兼容性要求（三端最低版本矩阵） | §3 平台兼容性要求 | P0/P1 分列 | 规格已定义，未实现（当前仅 Web，浏览器环境下运行） |
| IoT 硬件接入 | §3 排除项 / OQ-06 | 排除 | Assumption：P0 不支持 |

旗舰产品形态于 **2026-11-04 重定义为 SaaS 工具型（订阅制）— 功能模块商城 + 漫剧 AI 剧工作室**（OQ-01 已重定义），首端为 Web + 微信小程序（国内），出海以 App + Web 切入（PRD 文首 callout）。工作区由两域构成：**功能模块商城**负责模块上架、定价与解锁；**漫剧 AI 剧**覆盖 AI 全自动成片、AI 辅助创作工作台、作品管理与分发、工作台+导出成片四种交付形态。

## 2. 角色与对象模型（PRD §4）

### 2.1 角色

| 角色 | 定义 | 核心权限 |
|---|---|---|
| 访客 | 未登录用户 | 浏览公开内容、注册/登录 |
| 注册用户 | 已注册（**当前无订阅体系，2026-11-05 已下线**） | 使用已解锁/免费功能、跨端登录 |
| 运营管理员 | 内部运营人员 | **完整 RBAC + 独立后台已落地（2026-11-07）**：8 个权限点（`module:read` / `module:write` / `entitlement:read` / `entitlement:grant` / `entitlement:revoke` / `user:read` / `rbac:read` / `rbac:write`）、3 个内置角色（`superadmin` 8 项 / `operator` 7 项，不含 `rbac:write` / `viewer` 4 项）、`user_roles` 绑定表、`requirePermission` 逐请求实时查库鉴权；`x-admin-token` 保留为超管引导通道；独立后台 `apps/admin` 已上线，生产入口 `/admin/`（角色权限 / 用户角色 / 模块状态流转 / 权益发放回收 / 概览） |

> **订阅角色已下线（2026-11-05）**：原「免费用户 / 订阅用户 / 运营管理员（管理计划、订单、退款）」随 FR-02 整域删除，账号不再有订阅状态。

### 2.2 核心对象状态机

**Subscription / Order / Refund（订阅 / 订单 / 退款）— 已下线（2026-11-05）**：

> 三套状态机（订阅 `active/past_due/canceled/expired`、订单 `pending→paid/failed/closed→refunded`、退款 `pending→approved/rejected→executed`）随 FR-02 整域删除，对应代码文件与 9 张生产表均已移除。本节仅作历史留痕，**不得**作为当前实现依据。

**Module（功能模块）**：`draft`（运营草稿，不可购买）→ `active`（上架可售）→ `archived`（下架，已购用户解锁不受影响）。

**Entitlement（模块解锁）**：`active`（有效）→ `expired`（时效到期）→ `revoked`（风控回收；退款触发路径已随 FR-02 下线）。**服务端为解锁鉴权唯一依据**，端上不得缓存判定结果。

**ComicProject（漫剧工程）**：`draft`（剧本/角色编辑中）→ `storyboarded`（分镜表确认）→ `generating`（生成任务进行中）→ `rendered`（关键帧/片段就绪）→ `published`（已产出成片并发布）→ `archived`。

**ComicFilm（成片）**：`draft`（合成完成待审）→ `reviewing`（审核中）→ `published`（可浏览/导出）→ `archived`。

**GenerationJob（生成任务）**：`queued` → `running` → `succeeded` / `failed` / `canceled`。失败可重试但生成新 job，不覆盖历史。

> 通用约束（PRD §4.2）：状态变更只写事件表、不 UPDATE 历史；金额对象禁软删除，只能冲正；解锁发放/回收与触发事务**同事务**（订单/退款域已于 2026-11-05 下线，回收现仅由风控动作触发）。

## 3. FR-01 账号与身份

**目的**：用户在任意端完成注册/登录后，账号状态（基础资料、地区、登录方式绑定）在所有端实时同步；国内与海外登录方式不同，底层账号体系统一。~~订阅状态跨端同步~~ 已随 FR-02 于 2026-11-05 下线，账号不再携带订阅维度。

**注册与登录方式**：

| 市场 | 方式 | 说明 |
|---|---|---|
| 国内 | 手机号 + 验证码、微信登录、支付宝登录 | 手机号为主，第三方为辅 |
| 海外 | 邮箱 + 密码/验证码、Google Sign-In、Apple Sign-In | App 端提供第三方登录时必须同时提供 Apple Sign-In（App Store 要求） |

**跨端打通规则**：
- 同一手机号/邮箱在国内与海外视为**不同账号**（region 物理隔离）
- 同一市场内多种登录方式可绑定至同一账号；绑定需二次验证（已登录方式确认 + 新方式验证码）
- 账号可申请合并，合并后身份绑定与历史业务数据归并至保留账号（策略 TBD = OQ-05；原「订阅与订单归并」随 FR-02 于 2026-11-05 下线，不再涉及）

**异常与边界**：
- 验证码频控：同一标识 60 秒内 1 次，1 小时内 ≤ 5 次；验证码 5 分钟有效，错 5 次失效
- 登录失败 5 次锁定 15 分钟（仅该端，不影响其他端在线会话）
- 新设备登录保护：已登录用户在新设备登录需邮件/短信确认

PRD 内含交互演示（登录流程）：`showLogin(type)` 切换手机号/邮箱/微信（微信禁用输入框），`submitLogin()` 空值报错、非空显示演示成功文案。

## 4. FR-02 订阅与支付 — 已下线（2026-11-05）

> **本模块已按用户指令整体删除，当前无任何订阅、订单、支付、退款、发票、对账能力。** 删除范围与取证：
>
> - 后端：`services/mim-api/src/routes/billing.ts` 删除；`packages/core-domain/src/{plans,subscription,order}.ts` 删除；`app.ts` 解除挂载。
> - 前端：`apps/web/src/views/Plans.tsx` 删除；`api.ts` / `App.tsx` / `Settings.tsx` 清除订阅与订单调用；套餐入口移除，工作区仅剩「设置」。
> - 数据：生产库 `plans` / `plan_prices` / `subscriptions` / `subscription_events` / `orders` / `payments` / `refunds` / `invoices` / `audit_logs` 共 9 张表 DROP，迁移脚本 `deploy/migrations/2026-11-05-drop-billing-audit.cjs`（默认 DRY-RUN，`APPLY=1` 才执行）。
> - 配置：`.env.example` 移除 23 个支付/订阅/IAP 变量；`scripts/env-check.mjs` 与 `09-third-party-sdk-inventory.md` 同步（138 = 138 通过）。
> - 门禁：`.github/workflows/deploy.yml` 将 `GET /api/v1/plans` 断言为 404，防止回归。
>
> **保留的历史设计（仅供追溯，不得作为实现依据）**：原设计包含计划对象（`plan_id` / `name` / `billing_cycle` / `price` / `features` / `region` / `status`）、多通道支付路由（国内微信/支付宝/银联；海外 Stripe/PayPal；App 数字商品走 Apple IAP / Google Play Billing）、持牌机构清算约束、订阅生命周期（`pending → paid → active`，续费失败进 `past_due` 宽限期后 `expired`）、退款审核（OQ-04）、对账与掉单补发。相关开放问题 OQ-02 / OQ-04 随之失效（见 §10）。

**当前获取功能使用权的唯一方式**：功能模块商城的一次性解锁（`one_time`，见 §5.1 / §11.11），服务端 `entitlements` 为唯一鉴权依据。

## 5. FR-03 核心 SaaS 工作区（2026-11-04 重定义：功能模块商城 + 漫剧 AI 剧）

> **现状：后端第 1/2 期已落地（2026-11-05），前端未开始**。原 FR-03（项目/任务/成员/邀请/仪表盘/增量同步/CSV 导出）已于 2026-11-04 整体删除（历史见 §5.3）；本节为**新范围的产品定义**。已落地：`catalog` 域 4 表 + `requireEntitlement` 门禁；`comic` 域 7 表 + `/api/v1/comic/*` 24 条路由；`media` 域 `storage.ts` + `/api/v1/media/*` 已装配上线；`ai` 域 `orchestrator.ts` + `/api/v1/ai/*` 已装配（`MIM_AI_WORKER` 默认消费队列）。未落地：前端 `ComicWorkbench.tsx` / `ComicFilms.tsx`、真实厂商模型调用、导出成片。

### 5.1 FR-03.1 功能模块商城

**目的**：把产品能力拆成可独立上架、独立定价、独立解锁的功能模块；**当前仅提供一次性购买解锁（`one_time`）**，原「订阅内含解锁」随 FR-02 于 2026-11-05 下线。

**Module（功能模块）字段**：

| 字段 | 说明 |
|---|---|
| `module_id` / `code` | 唯一标识；`code` 全局唯一、不可复用 |
| `name` / `summary` | 多语言名称与一句话简介（i18n 资源，不硬编码） |
| `unlock_mode` | `one_time`（一次性购买）— **当前唯一有效值**；`subscription`（订阅内含）随 FR-02 于 2026-11-05 下线，DB CHECK 约束已收敛为仅 `one_time` |
| `price` | **按 region + 币种独立定价**，不换算汇率；`bigint` 最小货币单位 |
| `entitlements_required` | 前置依赖模块（未解锁则不可购买/不可用） |
| `status` | `draft` / `active` / `archived` |
| `region` | `cn` / `global`（定价与可见性均分库） |

**定价与解锁规则**：
- 模块定价独立，改价不改历史解锁记录；上市时间用 `effective_from` / `effective_to` 控制
- 一次下单解锁 1 个模块（原「一单挂 1 个计划 + N 个模块」的 `order_items` 设计已随订单域下线，当前无订单载体，解锁记录直接落 `entitlements`）
- 解锁判定只看服务端 `Entitlement`（`active` 且未过期且 region 匹配）；端上缓存仅供展示
- 风控封禁可触发解锁回收（`revoked`）；退款触发的回收路径已随 FR-02 下线

**主流程**：

```text
进入商城 → 模块列表（按 region/status 过滤，仅 active 可售）
  → 模块详情（能力说明、解锁方式、价格、前置依赖）
  → 解锁（校验前置依赖已解锁）→ 落 Entitlement(active) → 站内通知「解锁已发放」
  → 进入对应模块工作台
风控回收：Entitlement(revoked) → 通知「解锁已回收」
```

> 原流程中的 `Order(pending) → 支付(FR-02) → Order(paid) → 同事务发放` 与 `Refund(executed) → Order(refunded) → Entitlement(revoked)` 两段已随支付/退款域于 2026-11-05 删除；`entitlements` 的发放写路径已由管理面补齐——`POST /entitlements/grant` 发放、`POST /entitlements/:id/revoke` 回收、`GET /modules` / `GET /modules/:code` 提供目录只读（见 §11.11）。

**异常与边界**：
- 前置依赖未满足：拒绝解锁并返回 `403` + 需先解锁的模块清单（通用错误语义，**不使用已不存在的 `MODULE_DEPENDENCY_UNMET` 错误码**）
- 模块下架（`archived`）：不可新购，已解锁用户仍可用至到期
- 重复解锁：已 `active` 的模块再次解锁返回 `409`（通用冲突语义，**不使用已不存在的 `MODULE_ALREADY_OWNED` 错误码**）
- region 不匹配：模块在另一 region 上架时，本区不可见、不可购
- 一次性解锁的有效期与回收窗口见 OQ-09（OQ-04 退款窗口已失效）

### 5.2 FR-03.2 漫剧 AI 剧（四种交付形态）

**目的**：以「漫剧」为载体，提供从 AI 辅助创作到全自动成片的能力，并把成片纳入作品管理与分发。

| 形态 | 交付物 | 关键能力 | 落地顺序 |
|---|---|---|---|
| ① AI 全自动生成成片 | 漫剧短视频（成片） | 输入题材/剧本大纲 → AI 分镜与角色设定 → 静帧/关键帧 → 图生视频 → 合成；需文生图/图生视频模型 + 任务队列 | 3 |
| ② AI 辅助创作工作台 | **创作工程**（非成片） | 剧本、分镜、角色一致性、对白、配音均由 AI 建议，人工确认后保存工程 | 1 |
| ③ 漫剧作品管理与分发 | 成片的管理与浏览 | 只做成片管理、版本、发布与浏览，不含 AI 生成 | 4 |
| ④ 创作工作台 + 导出成片 | 创作工程 + 由其生成的成片 | ②的工程 → AI 生成分镜图与短片 → 导出 | 2 |

> 形态 ①②④ 共用同一套对象模型（`ComicProject` / `Storyboard` / `ComicFilm` / `GenerationJob`），差异仅在「人工确认点」与「是否走全自动流水线」。

**创作流水线（②④① 共用主干）**：

```text
题材/剧本大纲
  → 结构化剧本（AI 起草，人工确认）
  → 角色设定（外观/性格/声线，写入 character bible）
  → 分镜表（镜头序列：景别、台词、时长、画面描述）
  → 关键帧（文生图，按角色 bible 约束一致性）
  → 图生视频（分镜片段，可配 TTS 配音）
  → 合成 ComicFilm → 审核 → published → 浏览/导出/发布
```

**角色一致性规则**：
- 角色外观以 `character bible`（参考图 + 固定 prompt 片段 + seed）为唯一来源，跨镜头复用
- 同一工程内同一角色的风格参数锁定；改设定需升版本，旧分镜不自动重生成
- 生成失败或画风偏离时，允许单镜头重生成，不影响其他已确认镜头

**生成任务与队列**：
- 每个生成动作落 `GenerationJob`（`queued` → `running` → `succeeded` / `failed` / `canceled`），带 `job_type`（`text` / `image` / `video` / `tts` / `compose`）
- 队列按 region 与优先级调度；同工程内任务串行化，跨工程并行
- 失败可重试但生成新 job，历史 job 与产物保留可追溯；产物写入对象存储 `generation_assets`
- 任务执行前**预检成本与配额**，超限直接拒绝下单/拒绝入队（不做事后追扣）

**成本与配额**：
- 按 region 设定生成额度上限（图/秒/视频条数）；额度消耗在 job `succeeded` 时结算。当前实现以**成本上限**而非订阅额度落地：单任务 `MIM_AI_JOB_COST_LIMIT_MINOR`（默认 100000）+ 当日累计 `MIM_AI_DAILY_COST_LIMIT_MINOR`（默认 500000），超限返回 `402 COST_LIMIT_EXCEEDED`（原「按订阅计划给定月度额度」随 FR-02 下线）
- 实际成本与预估偏差超阈值写成本告警，供运营调整模型路由（供应商见 OQ-08）
- 额度不足时提示购买生成包（生成包属于模块商城的 `one_time` 模块；原「升级计划」入口已随订阅下线）

**成片版本与发布**：
- `ComicFilm` 只追加版本（`film_versions`），已发布版本不可覆盖，只能发新版
- 发布前必须过审核（机审 + 人工抽检，口径见 OQ-07）；驳回需给出原因并回到 `draft`
- 导出提供分辨率/格式选项；导出产物写入对象存储并给出**预签名 URL**
- 版权与合规：输入素材与生成产物留存来源记录，侵权投诉可定位到工程与任务（OQ-07）

**异常与边界**：
- 模型超时/供应商 5xx：job 标 `failed`，保留已产出片段，可单步重试
- 生成内容触发审核拦截：job `failed` + 原因码，额度不返还（除非判定为供应商故障）
- 工程删除：软删除工程，但已发布成片按版权与审计要求保留（不可物理删除）
- 收藏/浏览计数等 P1 分发能力不在 P0；P0 只做到「成片管理 + 版本 + 发布 + 浏览」

### 5.3 历史记录（原 FR-03，仅供追溯）

> 以下内容为 2026-11-04 前的旧范围，代码与生产库均已删除，仅保留用于追溯；**不得**作为当前实现依据。

**原订阅计划 features 映射（已随 `plans.features` 列删除）**：

| 能力 | 免费版 | 基础版 ¥29/月 | 专业版 ¥99/月 |
|---|---|---|---|
| 项目数 | 3 个 | 无限 | 无限 |
| 视图 | 列表 / 今日 | 列表 / 今日 / 日历 | 列表 / 今日 / 日历 / 看板 |
| 提醒推送 | — | ✓ | ✓ |
| 协作（单项目协作者数） | —（单人） | ≤ 3 | 无限 |
| 高级筛选 / 自定义主题 | — | — | ✓ |
| 导出 CSV | — | ✓ | ✓ |

**现工作区框架（2026-11-05 实况）**：登录后工作区**仅展示 设置（Settings）** 一个入口（原「套餐（Plans）」入口已随 FR-02 删除）；数据按 `user_id` + `region` 隔离。`features` 鉴权已移除。新范围落地后需新增 **商场（Store）** 与 **漫剧（Comic）** 两个入口（见 §12）。

## 6. FR-04 多端体验一致性

**一致性契约**：

| 维度 | 统一规则 |
|---|---|
| 账号 | 同一市场内跨端实时同步（账号资料/地区/登录方式绑定；订阅维度已于 2026-11-05 下线） |
| 业务数据 | 所有端可见可编辑 |
| 文案与术语 | 同一概念同一文案（来自 i18n 资源） |
| 错误提示 | 同一错误码映射同一用户可读提示 |
| 设计系统 | Design Token 统一颜色/间距/字号，各端组件库基于 Token 实现 |
| 平台兼容下限 | iOS 15.0+ / Android 9.0+ / 微信、支付宝、抖音、百度、QQ 小程序 / Windows 10–11 / macOS 12+ / Ubuntu 20.04+（P0/P1 分列见 PRD §3） |

**平台适配层职责**：登录（微信/支付宝/Google/Apple SDK）、推送（APNs/FCM/厂商通道）、存储（localStorage/AsyncStorage/SQLite）、分享（各端原生分享）。~~支付（微信支付/支付宝/Stripe/IAP）~~ 已随 FR-02 于 2026-11-05 下线，`IPlatformAdapter` 的 `pay` 子接口在实现时不再需要。各端 UI 差异仅由适配层处理，业务逻辑统一。

## 7. FR-05 国际化与本地化

- **多语言**：默认中文简体 + 英文（首批清单 TBD = OQ-03）；检测优先级 = 用户设置 → 浏览器/系统语言 → 默认；所有用户可见文案从 i18n 资源加载，禁止硬编码；RTL 布局（阿拉伯语等）为 P1
- **多币种**：模块定价按 region + 币种独立定价，不用实时汇率；币种由 region 决定（国内 CNY、海外 USD）；价格展示含货币符号 + 两位小数（日元等零小数币种除外）。原「每计划按币种独立定价」中的计划维度已随 FR-02 下线
- **多时区**：服务端统一 UTC 存储；展示按用户时区转换（默认系统时区，可在设置中修改）

## 8. FR-06 合规与隐私

- **隐私政策与用户协议**：首次注册强制展示并勾选；政策必含数据收集清单、使用目的、存储期限、第三方 SDK 清单、用户权利（访问、更正、删除、注销）；政策更新后下次登录需重新确认
- **数据最小化**：仅收集必要数据；敏感数据（手机号、邮箱）加密存储、展示脱敏；国内数据境内存储、海外存对应区域，数据不出境
- **账号注销**：注销前提示数据删除不可恢复（原「提示订阅失效」已随 FR-02 下线，不再存在订阅维度）；7 天冷静期可撤销；冷静期后删除个人数据，保留匿名化业务与合规记录（海外删除请求按 GDPR/CCPA 30 天内处理）

## 9. 横切支撑（PRD §6 共享规则）

| 规则 | 定义 | 引用模块 |
|---|---|---|
| Region 隔离 | 国内(cn)/海外(global) 数据物理隔离，账号/解锁记录按 region 分库（原「订单/订阅按 region 分库」已随 FR-02 下线） | FR-01 |
| 幂等性 | 写操作以 `Idempotency-Key` 幂等（同键同体重放首次结果，同键异体 409）；鉴权类接口豁免。原「支付、订阅状态变更接口以 `request_id` 幂等」已随 FR-02 下线 | FR-01 |
| ~~审计日志~~ | **已下线（2026-11-05）**：`routes/audit.ts` 与 `audit_logs` 表已删除，不再有 180 天留存要求 | — |

**通知规则**：解锁成功/回收（站内 + 邮件/短信）；账号异常登录邮件/短信通知。原「支付成功通知」「到期前 7/3/1 天提醒」「续费失败通知」已随 FR-02 下线。

## 10. 开放问题对模块的阻塞（PRD §7）

| 编号 | 问题 | 阻塞模块 | 状态 |
|---|---|---|---|
| OQ-01 | 旗舰 SaaS 核心功能是什么 | FR-03 功能模块商城 + 漫剧 AI 剧 | 已重定义（2026-11-04）：旗舰形态 = SaaS 工具型（订阅制）— 功能模块商城 + 漫剧 AI 剧工作室 |
| OQ-02 | 国内 Android 数字商品是否必须走商店 IAP | ~~FR-02 支付通道与分成~~ | **已失效（2026-11-05）**：FR-02 整域下线，无支付通道 |
| OQ-03 | 首批出海市场与语种 | FR-05 i18n/合规 | TBD |
| OQ-04 | 退款窗口与条件（直连通道） | ~~FR-02 / FR-03.1 退款与解锁回收~~ | **已失效（2026-11-05）**：退款域下线，解锁回收现仅由风控触发 |
| OQ-05 | 账号合并策略与数据归属 | FR-01 账号打通 | TBD |
| OQ-06 | 是否支持 IoT 硬件接入 | 范围定义与后端架构 | Assumption：P0 不支持 |
| OQ-07 | 漫剧生成产物的版权归属、可商用范围与内容审核口径 | FR-03.2 成片发布、导出授权与合规免责 | TBD |
| OQ-08 | 文生图 / 图生视频 / TTS 模型选型与单工程成本上限 | FR-03.2 生成队列容量、配额与定价成本模型 | TBD |
| OQ-09 | 功能模块采用「订阅内含」还是「独立一次性购买」 | FR-03.1 模块定价表结构与解锁回收规则 | **已定案（2026-11-05）**：仅 `one_time`；`subscription` 模式随 FR-02 下线，`modules.unlock_mode` 的 DB CHECK 约束已同步收敛 |

## 11. 功能模块落地对照表（P0，仓库实况）

> 本页从产品功能视角**逐模块**标注后端路由文件 + 路由数 + 前端页面 + 实现状态。技术资产视角见 [02-modules.md](./02-modules.md)，目标架构分层见 [01-architecture.md](./01-architecture.md) §2。

### 11.1 账号身份模块（FR-01）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 验证码发送 | `auth.ts` `POST /auth/code` + `notify.ts` 通道层 | `Login.tsx` | ✅（已接入真实通道：国内手机号 → 阿里云短信 `@alicloud/dysmsapi20170525`，海外邮箱 → AWS SES `@aws-sdk/client-ses`；凭证未配置时生产 503 `AUTH_CHANNEL_NOT_CONFIGURED`，供应商失败 502 `AUTH_CODE_DELIVERY_FAILED`） |
| 验证码登录 / 注册 | `auth.ts` `POST /auth/login` | `Login.tsx` | ✅（开发/测试环境可用 `dev_code`） |
| 密码登录（生产入口） | `auth.ts` `POST /auth/password` | `Login.tsx`（默认模式） | ✅（口令取自 `MIM_AUTH_ADMIN_PASSWORD`，401 / 503 / 423 语义见 [05-runbook.md](./05-runbook.md) §6.3） |
| 令牌刷新轮换 | `auth.ts` `POST /auth/refresh` | `api.ts refreshSession()` | ✅ |
| 登出 | `auth.ts` `POST /auth/logout` | —（401 自动登出） | ✅ |
| 我的信息 | `me.ts` `GET /me` / `PATCH /me` | `Settings.tsx` | ✅ |
| 账号注销（冷静期） | `me.ts` `POST /me/deletion` + `POST /me/cancel-deletion` | `Settings.tsx` | ✅ |
| 第三方登录 / 账号合并 | — | — | ❌ TBD |

### 11.2 订阅支付模块（FR-02）— 已删除（2026-11-05）

原文件 `services/mim-api/src/routes/billing.ts`、`packages/core-domain/src/{plans,subscription,order}.ts`、`apps/web/src/views/Plans.tsx` 已删除；原 6 条路由（`GET /plans`、`POST /subscriptions/checkout`、`GET /subscriptions/current`、`POST /subscriptions/cancel`、`GET /orders`、`GET /invoices`）全部下线。生产库 9 张表（`plans`/`plan_prices`/`subscriptions`/`subscription_events`/`orders`/`payments`/`refunds`/`invoices`/`audit_logs`）DROP，迁移见 `deploy/migrations/2026-11-05-drop-billing-audit.cjs`。`.github/workflows/deploy.yml` 已断言 `GET /api/v1/plans` 为 404，防止回归。**当前购物/支付能力为 0。**

### 11.3 项目管理模块（FR-03-①）— 已删除

原文件 `services/mim-api/src/routes/projects.ts`、`apps/web/src/views/Projects.tsx`、`ProjectDetail.tsx` 已删除。原能力清单（列表/新建/详情/更新/归档/两级级联删除/成员/邀请/接受邀请/移除成员/撤销邀请）不再提供。

### 11.4 任务管理模块（FR-03-①）— 已删除

原文件 `services/mim-api/src/routes/tasks.ts` 已删除。原能力清单（任务列表含子任务、固定两级新建、详情、LWW 更新、状态切换、级联删除子任务）不再提供。

### 11.5 仪表盘模块（FR-03-④）— 已删除

原文件 `services/mim-api/src/routes/dashboard.ts`、`apps/web/src/views/Dashboard.tsx` 已删除。

### 11.6 协作模块（FR-03-③）— 已删除

原文件 `packages/core-domain/src/permissions.ts` 已删除；成员与邀请接口随 `projects.ts` 一并移除。

### 11.7 同步模块（FR-04 增量同步）— 已删除

原文件 `services/mim-api/src/routes/sync.ts` 已删除（`sync_cursors` 表同步清理）。FR-04 的「多端体验一致性」设计约束仍保留，但当前无增量同步实现。

### 11.8 导出模块 — 已删除

原文件 `services/mim-api/src/routes/exports.ts` 已删除（`content_exports` 表同步清理）。

### 11.9 审计与合规模块（FR-06）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| ~~审计日志查询~~ | ~~`audit.ts` `GET /audit`~~ | — | **已删除（2026-11-05）**：`routes/audit.ts` 与 `audit_logs` 表移除，CI 断言 `GET /api/v1/audit/logs` 为 404 |
| 手机号 / 邮箱规范化 | `core-domain` `normalizeIdentity` | `Login.tsx` | ✅ |
| 隐私政策页 | — | — | ❌ |
| 数据导出 / GDPR 请求 | — | — | ❌ |

### 11.10 模块间依赖

FR-02 已于 2026-11-05 整域下线，**当前不存在跨模块订单/支付依赖**。FR-05（i18n）为横切约束，由 `packages/*` 承载，`apps/web` 与 `services/mim-api` 同时引用；原 FR-06 审计查询已随 FR-02 一并删除（`audit_logs` 表移除）。**新 FR-03（商城 + 漫剧 AI 剧）仅依赖 FR-01 鉴权（已就绪）：`catalog` 域 4 表 + `requireEntitlement` 门禁已落地，`comic` 域 7 表 + 24 条路由已落地，`media` 域 `storage.ts` 已装配上线，`ai` 域 `orchestrator.ts` 已装配（`MIM_AI_WORKER` 默认消费）。** 原 FR-03（项目/任务/成员/邀请/仪表盘/同步/导出）已于 2026-11-04 删除，仅历史留痕（见 §11.3–§11.8）。

### 11.11 功能模块商城（FR-03.1）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 模块目录 / 详情 | **已实现（2026-11-07）**：`GET /modules`、`GET /modules/:code`（公开只读）；管理写路由 `PATCH /modules/:code/status`（`draft→active→archived` 单向状态机） | ✅ 契约测试 `test/catalog.test.ts`（18 例） | ✅ 已实现 |
| 模块定价（region / 币种 / 有效期） | —（`module_prices` 表已建，无定价接口） | — | 🟡 仅建表 |
| ~~下单挂载模块~~ | —（原 `order_items` 设计随订单域于 2026-11-05 下线，**不建表**；解锁直接落 `entitlements`） | — | **已取消** |
| 解锁发放 / 回收（Entitlement） | **已实现（2026-11-07）**：`POST /entitlements/grant`（发放，唯一索引兜底幂等）、`POST /entitlements/:id/revoke`（回收，写 `entitlement_events`）；到期由 `src/jobs.ts` 的 `runEntitlementExpiry` 定时扫描置 `expired` | ✅ 契约测试 `test/catalog.test.ts`（18 例）+ `test/jobs.test.ts`（9 例） | ✅ 已实现 |
| 解锁鉴权（服务端唯一依据） | `requireEntitlement(moduleCode)` 中间件（`src/middleware.ts`） | — | ✅ 已落地 |
| ~~退款触发解锁回收~~ | —（退款域已删除，**不再实现**；回收仅保留风控动作路径） | — | **已取消（2026-11-05）** |

### 11.12 漫剧 AI 剧（FR-03.2）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 漫剧工程（剧本 / 角色 / 分镜） | `comic.ts`：`GET/POST /comic/projects`、`GET/PATCH/DELETE /comic/projects/:id`、`POST /comic/projects/:id/storyboard` | `ComicWorkbench.tsx`（创作标签页：工程列表 / 角色 / AI 建议） | ✅ 前后端已落地 |
| 角色一致性（character bible） | `POST /comic/projects/:id/characters`（`comic_characters` 表，`(project_id, name)` 唯一 + prompt/seed） | `ComicWorkbench.tsx` 创作标签页 | ✅ 前后端已落地 |
| 生成任务队列（text / image / video / tts / compose） | `POST/GET /comic/projects/:id/jobs`、`GET /comic/jobs/:id`、`POST /comic/jobs/:id/{start,complete,fail,cancel,retry}`（`generation_jobs` 表） | `ComicWorkbench.tsx` 生成任务标签页（capabilities 横幅 / 不支持类型置灰 / 派发 / 手动运行 `POST /ai/jobs/:id/run` / 失败 error_code 透传 / 产物下载与图片缩略图 / 3s 轮询） | ✅ 前后端已落地（状态机 + 队列消费者 `src/orchestrator.ts`；真实厂商 openai 兼容协议已接入 text/image，video/tts/compose 诚实失败 `PROVIDER_NOT_CONFIGURED`） |
| 生成产物存储与分发 | `src/storage.ts`：`LocalDiskStorage`（HMAC 预签名 URL，落盘 `data/media`）+ `S3Storage`（AWS SDK）；`generation_assets` 表已建、`src/orchestrator.ts` 写入真实产物；`/media/presign/{upload,download}`、`/media/assets`、`/media/objects/*` 已挂载 | `ComicWorkbench.tsx` 成片标签页（工程产物面板 + 图片产物内联预览 + 预签名下载；成片版本面板 `FilmVersionsPanel` 下载/播放） | ✅ 前后端已落地（2026-11-05 后端装配上线；2026-11-06 前端接线） |
| 成片合成与版本 | `POST/GET /comic/projects/:id/films`、`GET /comic/films/:id`、`POST /comic/films/:id/versions`（`comic_films` / `film_versions` 表） | `ComicWorkbench.tsx` 成片标签页（创建时可选取 compose 产物 object_key） | ✅ 前后端已落地 |
| 审核与发布 | `POST /comic/films/:id/{submit-review,publish,reject,archive}`（状态机 + 驳回留原因） | `ComicWorkbench.tsx` 成片标签页（提交审核 / 发布 / 驳回 / 归档） | ✅ 前后端已落地（人工审核队列与内容机审未实现） |
| 成本 / 配额预检 | `src/orchestrator.ts`（已装配进 `app.ts`/`index.ts`，`MIM_AI_WORKER` 默认消费）：单任务上限 `MIM_AI_JOB_COST_LIMIT_MINOR`（默认 100000）+ 当日累计 `MIM_AI_DAILY_COST_LIMIT_MINOR`（默认 500000），超限返回 `COST_LIMIT_EXCEEDED(402)` | — | ✅ 后端已落地（2026-11-05） |
| 导出成片 | —（规划导出任务 + 对象存储预签名下载） | — | ❌ 0 代码 |

### 11.13 站点模块地图（DNSPod 备注结构化，2026-11-06）

> 数据源：仓库根 `dnspod_records_2026-11-05_21-42-26.xls`（DNSPod 导出，2026-11-05）的**「备注」列**。原始表 197 行，其中 180 行带备注，去重后为 **45 条主机记录 × 2 个 zone**（短主机与 FQDN 重复行已合并）。备注内容即各子站的产品定位，本模块将其落成结构化只读数据 + 公开 API + 前端可视化。

| 项 | 实况 |
|---|---|
| 数据文件 | `services/mim-api/src/site.ts`（`SITE_ZONES` / `SITE_CATEGORIES` / `SITE_MODULES`，纯静态常量，无数据库表） |
| zone | `laal.top`（A → `103.0.113.10`）、`mixm.top`（A → `103.0.113.20`）；唯一例外 `mixm.top` 的 `gy` 为 CNAME → `gale-engine-landing-6j02gsvv.edgeone.cool.` |
| 分类（8） | 门户与入口 6 / 身份与权限 2 / 运营后台 8 / 接口与开发 5 / 内容与媒体 7 / 电商与交易 7 / 数据与存储 4 / 工具与服务 6（合计 45） |
| 后端路由 | `routes/site.ts`：`GET /site/overview`、`GET /site/modules?zone=&category=&q=`、`GET /site/modules/:host`（3 条，**公开免鉴权**，zod `strictObject` 校验，非法 zone/category → 400 `VALIDATION_FAILED`，未知 host → 404 `NOT_FOUND`） |
| 前端页面 | `apps/web/src/views/SiteMap.tsx`，侧栏「站点地图 / Site Map」；一次拉全量后在客户端做 zone / 分类 / 关键词过滤，按分类分组渲染卡片，每条 record 展示 zone、记录类型、解析值与外链 |
| 搜索覆盖 | `q` 命中 host / label / description / FQDN / 解析值 / record 级备注（例如 `q=疾风引擎` 命中 `gy`） |
| 测试 | `test/site.test.ts` 7 例（overview 计数、列表 45×2、分类与 `q` 过滤、`gy` 的 CNAME 与 record 级覆盖、`@` 的 FQDN、非法参数 400 / 未知 host 404） |
| 状态 | ✅ 前后端已落地（不写入数据库，无迁移、无第三方依赖） |

## 12. 实现拆分清单（新 FR-03 落地路径）

> 分期口径由 PRD §3 / §5 FR-03.2 的四形态表确定：**②（AI 辅助创作工作台）→ ④（工作台 + 导出成片）→ ①（AI 全自动生成成片）→ ③（作品管理与分发）**。每期均须同时交付后端、前端、数据表与第三方 SDK 接入（铁律五），并按铁律七同步 PRD、本页、[08](./08-dev-implementation.md)、README。

### 12.0 共用基座（先于所有分期）

| 项 | 内容 |
|---|---|
| 后端域 | `catalog`（模块与解锁）、`comic`（工程/生成/成片）、`media`（对象存储与分发） |
| 数据表 | 见 [08](./08-dev-implementation.md) §3.2（`modules`、`module_prices`、`entitlements`、`entitlement_events`；`comic_projects`、`comic_characters`、`storyboards`、`comic_films`、`film_versions`、`generation_jobs`、`generation_assets`）。原 `order_items` 随订单域于 2026-11-05 取消，**不建表** |
| 第三方 SDK | 对象存储（S3 兼容 / 云厂商 OSS/COS）、文生图模型、图生视频模型、TTS、内容审核（OQ-07/OQ-08 定选型） |
| 前置依赖 | **仅 FR-01 鉴权（已就绪）**。FR-02 订单/支付/退款闭环已于 2026-11-05 整域下线，不再作为前置 |

### 12.1 第 1 期：② AI 辅助创作工作台（交付物 = 创作工程）

| 维度 | 交付内容 |
|---|---|
| 后端路由 | `comic.ts`：`POST/GET/PATCH/DELETE /comic/projects`、`POST /comic/projects/:id/storyboard`、`POST /comic/projects/:id/characters`；`POST /comic/projects/:id/suggest`（AI 建议：剧本/分镜/对白/配音） |
| 数据表 | `comic_projects`、`comic_characters`、`storyboards` |
| 前端视图 | `apps/web/src/views/ComicWorkbench.tsx`（工程列表、角色设定、AI 建议确认）— ✅ 已实现（创作标签页） |
| 鉴权 | 服务端 `requireEntitlement('comic.workbench')` — ✅ 已落地（`src/middleware.ts`） |
| 第三方 | 文本生成模型（剧本/分镜/对白建议）— **未接入**；`POST /comic/projects/:id/suggest` 当前返回本地 mock（`model: 'mock-text-suggest'`，`requires_confirmation: true`），TTS 未实现 |
| 验收 | 工程 CRUD + 分镜表落库 + AI 建议人工确认后可保存；工程状态机 `draft → storyboarded` 可闭环 — ✅ 后端已由 `test/comic.test.ts` 10 例覆盖 |

> **落地状态（2026-11-06）**：后端与数据表已交付（`schema.sql` comic 域 3 表、`routes/comic.ts`、`test/comic.test.ts` 全绿）；前端 `ComicWorkbench.tsx` 创作标签页已实现（工程 CRUD / 角色 / AI 建议，`kind` 对齐 `script|storyboard|dialogue|voice`）。真实文本模型已由第 2 期 orchestrator 承接（openai 兼容协议）。

### 12.2 第 2 期：④ 创作工作台 + 导出成片

| 维度 | 交付内容 |
|---|---|
| 后端路由 | **已落地（骨架，2026-11-05）**：`POST/GET /comic/projects/:id/jobs`（派发 / 列表）、`GET /comic/jobs/:id`、`POST /comic/jobs/:id/{start,complete,fail,cancel,retry}`（状态机控制面，失败重试新建 job）；`POST/GET /comic/projects/:id/films`、`GET /comic/films/:id`、`POST /comic/films/:id/versions`（版本只追加）、`POST /comic/films/:id/{submit-review,publish,reject,archive}`。规划增补：`POST /comic/projects/:id/generate`（按镜头生成关键帧 / 片段，真实模型驱动） |
| 数据表 | **七表已建齐**：第 1 期 `comic_projects`/`comic_characters`/`storyboards`；第 2 期 `generation_jobs`/`generation_assets`/`comic_films`/`film_versions` |
| 前端视图 | `ComicWorkbench.tsx` 生成任务标签页（派发 / 状态机操作 / 3s 轮询，轮询同时刷新工程详情）与成片标签页（创建 / 提交审核 / 发布 / 驳回 / 归档）— ✅ 已实现（2026-11-06） |
| 第三方 | 文本 / 文生图模型 — ✅ 已接入（`MIM_AI_PROVIDER=openai` 走 OpenAI 兼容协议，经 `MIM_AI_BASE_URL` 可切换火山方舟 / DeepSeek / 百炼，2026-11-06）；图生视频模型、TTS（配音）— 未接入（诚实失败 `PROVIDER_NOT_CONFIGURED`）；对象存储 + 预签名 URL — ✅ 已接入（`storage.ts` local/S3） |
| 依赖前置 | 第 1 期完成 ✅；`media` 域就绪；生成队列消费者（`jobs`） |
| 验收 | 分镜 → 关键帧 → 片段 → 合成可跑通；单镜头失败可重试且不影响其他镜头；导出给出预签名 URL |

> **落地状态（2026-11-05）**：任务编排与成片合成的路由骨架与状态机已交付（`schema.sql` comic 域新增 **4 表**：`generation_jobs`/`generation_assets`/`comic_films`/`film_versions`、`routes/comic.ts` 新增 16 条路由、`test/comic-phase2.test.ts` 10 例全绿）。骨架口径：首个任务派发驱动工程 `storyboarded → generating`，`compose` 任务成功驱动 `generating → rendered`，成片发布驱动 `rendered → published`；状态迁移当前由编排控制面端点驱动（`start/complete/fail`）。**已装配上线（2026-11-05）**：`src/orchestrator.ts`（mock 产物真实落盘 + 单任务/当日成本预检 + `generation_assets` 写入 + compose 成功联动工程 `rendered`）与 `src/storage.ts`（local/S3 预签名）均由 `app.ts`/`index.ts` import 并生效——对外暴露 `/api/v1/ai/*`（含 `GET /ai/capabilities`、`POST /ai/jobs/:id/run`）与 `/api/v1/media/*`（预签名上传/下载、资产列表、免鉴权对象收发），`MIM_AI_WORKER` 默认开启时 worker 轮询自动消费 `generation_jobs`；`generation_assets` 分镜全覆盖校验在接入真实厂商模型后收紧。**2026-11-06 增补**：① orchestrator 接入真实提供方 `MIM_AI_PROVIDER=openai`（OpenAI 兼容协议，支持 text `chat/completions` 与 image `images/generations`，b64_json 优先 / url 回源兜底；`video`/`tts`/`compose` 与未配置凭证保持诚实失败 `PROVIDER_NOT_CONFIGURED`；新增 env `MIM_AI_BASE_URL`/`MIM_AI_TEXT_MODEL`/`MIM_AI_IMAGE_MODEL`，登记见 wiki 09）；② 前端 `ComicWorkbench.tsx` 补「生成任务」「成片」标签页并修复 api.ts 信封契约（`{items}`/`{project, characters, latest_storyboard}` 等），任务列表有排队/运行中条目时 3s 轮询；`test/orchestrator.test.ts` 以 fetch 打桩覆盖真实调用路径。**2026-11-06 前端缺陷修复**：① 工程列表/详情 reload 期间不再卸载 `ProjectDetail`（仅首次无数据时占位），修复 Jobs/Films 任一操作后标签页被重置回「创作」；② 生成任务轮询同时刷新工程详情，compose 成功驱动 `generating → rendered` 后成片创建门槛即时解除，无需整页刷新。**2026-11-06 ai/media 前端接线**：① `apps/web/src/api.ts` media 命名空间契约对齐后端（`presignUpload`/`presignDownload`/`listAssets` 返回 `PresignedUrl`/`ListedAsset` 形状），新增 `api.ai` 命名空间（`capabilities`/`runJob`）；② 生成任务标签页接入 capabilities 横幅（provider / 支持类型 / 存储 / 未配置告警）、不支持类型下拉置灰、queued 任务「立即运行」、失败 `error_code — message` 透传、产物预签名下载与图片产物缩略图，骨架 `start/complete/fail` 按钮随 orchestrator 接管移除（后端路由保留）；③ 成片标签页新增工程产物面板（`GET /media/assets` 列表 + 图片内联预览 + 过期时间）与 `FilmVersionsPanel`（`GET /comic/films/:id` 版本列表，预签名下载/播放）；④ 新增 `test/ai-routes.test.ts` 5 例（capabilities 401/200、run 404 / 409 canceled / 200 succeeded + 产物落库），契约测试 52 → 57 例。

### 12.3 第 3 期：① AI 全自动生成成片

| 维度 | 交付内容 |
|---|---|
| 后端路由 | `POST /comic/auto`（输入题材/大纲 → 一次性串起剧本→角色→分镜→关键帧→片段→合成）；`GET /comic/auto/:jobId` 查询进度 |
| 数据表 | 复用第 2 期全部表；新增自动流水线的编排 job 记录 |
| 前端视图 | `ComicAuto.tsx`（题材输入、进度、成片结果） |
| 第三方 | 同第 2 期 + 编排层（串行链路、失败重试、成本预检） |
| 依赖前置 | 第 2 期完成；生成额度与配额预检 |
| 验收 | 单次输入可产出成片；全程无人工确认点；失败可单步重试；成本不超配额 |

### 12.4 第 4 期：③ 漫剧作品管理与分发

| 维度 | 交付内容 |
|---|---|
| 后端路由 | `GET /comic/films`（列表/筛选/分页）、`POST /comic/films/:id/publish`、`POST /comic/films/:id/archive`、`GET /comic/films/:id/versions` |
| 数据表 | 复用 `comic_films` / `film_versions`（只追加版本，已发布不可覆盖） |
| 前端视图 | `ComicFilms.tsx`（作品库、版本、发布/归档、浏览） |
| 第三方 | 内容审核（发布前机审 + 人工抽检，OQ-07） |
| 依赖前置 | 第 2/3 期完成 |
| 验收 | 成片状态机 `draft → reviewing → published → archived` 可闭环；版本只追加 |

> **P0 边界**：③ 在本 P0 内只做「成片管理 + 版本 + 发布 + 浏览」，不含全站推荐、分发渠道扩展（属 PRD §3 P1 内容管理）。

**开发实现口径**：数据库表结构、后端服务模块、存储分级见 [08-dev-implementation.md](./08-dev-implementation.md) §1.1；各功能所需第三方 SDK 与密钥命名见 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)。

---

_本页为产品功能视角文档，随 PRD 草案（V0.0.0-preview）同步演进；所有 TBD/Assumption 项待 PRD 确认后更新。_
