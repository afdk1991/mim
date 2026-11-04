# 07 · 功能模块

> 本页从 [Mim-PRD.html](file:///f:/合并项目/Mim/Mim-PRD.html)（V0.0.0-preview 草案）§3–§7 提取产品功能模块全景。所有条目均锚定 PRD 原文，`TBD` / `Assumption` 标注与 PRD 保持一致。技术/架构视角的模块清单见 [02-modules.md](./02-modules.md)，本页为产品功能视角。

## 1. 模块全景

| 模块 | PRD 锚点 | 优先级 | 状态（证据见 [08](./08-dev-implementation.md) §1.1） |
|---|---|---|---|
| FR-01 账号与身份 | §5 FR-01 | P0 | **已实现（P0 最小集）**：cn 手机号验证码、global 邮箱密码/验证码；JWT access + refresh 轮换；region 强隔离。未实现：微信/支付宝/Google/Apple 第三方登录、账号合并（OQ-05）、新设备登录保护 |
| FR-02 订阅与支付 | §5 FR-02 | P0 | **已实现（P0，mock 支付驱动）**：计划/价格/订阅状态机/checkout/取消/发票。未实现：真实通道（微信/支付宝/Stripe/IAP）、退款（OQ-04）、对账、掉单补发 |
| FR-03 核心 SaaS 工作区 | §5 FR-03 | P0 | **已实现（P0）**：项目→任务→子任务两级、协作者邀请（editor/viewer）、个人仪表盘、4s 轮询增量同步、CSV 导出（按套餐）。见 §5.2 features 映射 |
| FR-04 多端体验一致性 | §5 FR-04 | P0 | **部分实现**：`packages/core-domain`（领域/权限/错误码）+ `packages/i18n`（双语文案/货币格式化）+ 统一 HTTP 契约已落地；仅 Web 一端，`IPlatformAdapter` 未落地 |
| FR-05 国际化与本地化 | §5 FR-05 | P0 | **部分实现**：zh-CN / en-US 文案包、未命中回退链、`formatCurrency`、UTC 存储；未实现：语言切换 UI 持久化、RTL、时区设置 UI |
| FR-06 合规与隐私 | §5 FR-06 | P0 | **部分实现**：审计日志（登录/支付/关键写操作）、手机号/邮箱规范化与脱敏。未实现：隐私政策强制勾选、账号注销 + 7 天冷静期、数据导出/删除请求 |
| IM / 音视频 / AI 编排 / 内容管理 / 开放平台 / 管理后台 | §3 P1 清单 | P1 | 后续迭代，仅列名 |
| 平台兼容性要求（三端最低版本矩阵） | §3 平台兼容性要求 | P0/P1 分列 | 规格已定义，未实现（当前仅 Web，浏览器环境下运行） |
| IoT 硬件接入 | §3 排除项 / OQ-06 | 排除 | Assumption：P0 不支持 |

旗舰产品形态已定案 **SaaS 工具型（订阅制）— 跨端任务与轻协作工具**（OQ-01，2026-11-03），首端为 Web + 微信小程序（国内），出海以 App + Web 切入（PRD 文首 callout）。

## 2. 角色与对象模型（PRD §4）

### 2.1 角色

| 角色 | 定义 | 核心权限 |
|---|---|---|
| 访客 | 未登录用户 | 浏览公开内容、注册/登录 |
| 免费用户 | 已注册未订阅 | 使用免费功能、查看计划、发起订阅 |
| 订阅用户 | 有有效订阅 | 使用付费功能、管理订阅、跨端登录 |
| 运营管理员 | 内部运营人员 | 管理计划、查看订单、处理退款工单（TBD） |

### 2.2 核心对象状态机

**Subscription（订阅）**：

| 状态 | 进入条件 | 可执行操作 |
|---|---|---|
| `active` | 支付成功且在有效期内 | 使用付费功能、取消续费、申请退款 |
| `past_due` | 续费失败，宽限期内 | 更新支付方式、查看欠费 |
| `canceled` | 用户取消或退款完成 | 不可用付费功能（至当期结束） |
| `expired` | 订阅到期未续费 | 重新订阅 |

**Order（订单）**：`pending`（已创建待支付）→ `paid`（支付成功）/ `failed`（支付失败）/ `closed`（超时未支付关闭）；`refunded`（已退款，全额或部分）。

## 3. FR-01 账号与身份

**目的**：用户在任意端完成注册/登录后，账号与订阅状态在所有端实时同步；国内与海外登录方式不同，底层账号体系统一。

**注册与登录方式**：

| 市场 | 方式 | 说明 |
|---|---|---|
| 国内 | 手机号 + 验证码、微信登录、支付宝登录 | 手机号为主，第三方为辅 |
| 海外 | 邮箱 + 密码/验证码、Google Sign-In、Apple Sign-In | App 端提供第三方登录时必须同时提供 Apple Sign-In（App Store 要求） |

**跨端打通规则**：
- 同一手机号/邮箱在国内与海外视为**不同账号**（region 物理隔离）
- 同一市场内多种登录方式可绑定至同一账号；绑定需二次验证（已登录方式确认 + 新方式验证码）
- 账号可申请合并，合并后订阅与订单归并至保留账号（策略 TBD = OQ-05）

**异常与边界**：
- 验证码频控：同一标识 60 秒内 1 次，1 小时内 ≤ 5 次；验证码 5 分钟有效，错 5 次失效
- 登录失败 5 次锁定 15 分钟（仅该端，不影响其他端在线会话）
- 新设备登录保护：已登录用户在新设备登录需邮件/短信确认

PRD 内含交互演示（登录流程）：`showLogin(type)` 切换手机号/邮箱/微信（微信禁用输入框），`submitLogin()` 空值报错、非空显示演示成功文案。

## 4. FR-02 订阅与支付

**目的**：用户选计划并完成支付后获得功能使用权；支付通道按市场与平台路由，业务方只感知统一订阅状态。

**订阅计划（Plan）字段**：`plan_id`（唯一标识）、`name`（多语言）、`billing_cycle`（月/季/年）、`price`（分币种 CNY/USD 等）、`features`（功能权限列表）、`region`（国内/海外/全球）、`status`（active/archived）。

**支付通道路由**：

| 场景 | 可用通道 | 规则 |
|---|---|---|
| 国内 Web/小程序 | 微信支付、支付宝、银联 | 按用户选择 |
| 国内 App 数字商品 | — | iOS 必须 Apple IAP；Android 国内商店规则视渠道（Assumption = OQ-02） |
| 海外 Web | Stripe、PayPal | 按用户选择 |
| 海外 App 数字商品 | Apple IAP、Google Play Billing | 商店强制，否则拒审 |

**资金合规硬约束**：清算必须由持牌机构完成；自研层 = 支付编排、账务、订阅计费、对账、风控。iOS/Android 数字商品走商店 IAP，抽成 15%~30%。

**订阅生命周期**：

```text
选择计划 → Order(pending) → 拉起支付 →
  ├─ 成功 → Order(paid) → Subscription(active) → 发放权限
  ├─ 失败 → Order(failed) → 提示重试
  └─ 超时 → Order(closed)
续费：到期前 N 天自动扣款 → 成功续期 / 失败 → past_due 宽限期重试 → 仍失败 → expired
```

**退款规则**：IAP 走商店流程 + 回调更新订阅；直连通道用户申请 + 运营审核（窗口与条件 TBD = OQ-04）；退款后订阅立即失效或按比例折算至当期结束，不可恢复。

**异常与边界**：
- 支付回调幂等：`order_id` + 通道流水号
- 掉单补发：对账任务每日扫描 `paid` 但无 `active` 订阅的订单，自动补发
- 跨端同步：订阅状态变更 5 秒内同步所有在线端，离线端下次拉取时更新

PRD 内含交互演示（计划与支付）：基础版 ¥29/月（年付 ¥290 省 ¥58）、专业版 ¥99/月（年付 ¥990 省 ¥198），`selectPlan()` → `doPay()` 显示支付成功。

## 5. FR-03 核心 SaaS 工作区

> **OQ-01 已定案**（2026-11-03）：旗舰产品形态为 **SaaS 工具型（订阅制）— 跨端任务与轻协作工具**。

### 5.1 P0 核心模块（订阅用户可用）

| 模块 | 定义 |
|---|---|
| ① 任务管理 | 项目 → 任务 → 子任务（固定两级）；属性：标题、描述、标签（多选）、截止日期、完成状态；截止日提醒推送（复用 FR-04 平台适配层推送能力） |
| ② 多端实时同步 | 依托 FR-04 一致性契约：变更 5 秒内同步在线端，离线端下次拉取更新；冲突策略 = 服务端 last-write-wins + 客户端乐观更新 |
| ③ 基础协作 | 项目所有者经手机号/邮箱邀请成员；权限两档（可编辑/只读）；协作项目数据按创建者 `user_id` + `region` 归属 |
| ④ 个人仪表盘 | 今日任务（截止日为今天）+ 即将到期（未来 7 天）+ 逾期 + 未排期 + 今日已完成；**切日口径按用户时区**（`Intl.DateTimeFormat` 解析 IANA 时区），今日已完成取 `updated_at` 按用户时区落在今日的记录 |

### 5.2 订阅计划 features 映射

| 能力 | 免费版 | 基础版 ¥29/月 | 专业版 ¥99/月 |
|---|---|---|---|
| 项目数 | 3 个 | 无限 | 无限 |
| 视图 | 列表 / 今日 | 列表 / 今日 / 日历 | 列表 / 今日 / 日历 / 看板 |
| 提醒推送 | — | ✓ | ✓ |
| 协作（单项目协作者数） | —（单人） | ≤ 3 | 无限 |
| 高级筛选 / 自定义主题 | — | — | ✓ |
| 导出 CSV | — | ✓ | ✓ |

### 5.3 P1 增量（挂接既有 P1 能力模块）

- AI 摘要与智能安排（← AI 编排模块，模型路由/配额复用）
- 任务评论与即时讨论（← IM 模块，会话能力复用）
- 模板市场（任务/项目模板分享）

### 5.4 P0 明确不做

- 甘特图、资源排期（复杂项目管理能力，另行评估）
- 音视频会议入口（P1 音视频模块上线后再评估）

### 5.5 工作区框架与权限校验（通用规则保留）

**工作区框架**：登录后进入工作区，左侧导航展示功能模块；模块按订阅计划 `features` 列表显隐；免费用户见付费模块显示升级引导；数据按 `user_id` + `region` 隔离。

**权限校验**：服务端每次访问付费功能时校验订阅状态与 features；客户端缓存订阅状态 5 分钟，超时重拉；订阅失效后已打开的付费页面提示并引导重新订阅。

## 6. FR-04 多端体验一致性

**一致性契约**：

| 维度 | 统一规则 |
|---|---|
| 账号与订阅 | 同一市场内跨端实时同步 |
| 业务数据 | 所有端可见可编辑 |
| 文案与术语 | 同一概念同一文案（来自 i18n 资源） |
| 错误提示 | 同一错误码映射同一用户可读提示 |
| 设计系统 | Design Token 统一颜色/间距/字号，各端组件库基于 Token 实现 |
| 平台兼容下限 | iOS 15.0+ / Android 9.0+ / 微信、支付宝、抖音、百度、QQ 小程序 / Windows 10–11 / macOS 12+ / Ubuntu 20.04+（P0/P1 分列见 PRD §3） |

**平台适配层职责**：登录（微信/支付宝/Google/Apple SDK）、支付（微信支付/支付宝/Stripe/IAP）、推送（APNs/FCM/厂商通道）、存储（localStorage/AsyncStorage/SQLite）、分享（各端原生分享）。各端 UI 差异仅由适配层处理，业务逻辑统一。

## 7. FR-05 国际化与本地化

- **多语言**：默认中文简体 + 英文（首批清单 TBD = OQ-03）；检测优先级 = 用户设置 → 浏览器/系统语言 → 默认；所有用户可见文案从 i18n 资源加载，禁止硬编码；RTL 布局（阿拉伯语等）为 P1
- **多币种**：每计划按币种独立定价，不用实时汇率；币种由 region 决定（国内 CNY、海外 USD）；价格展示含货币符号 + 两位小数（日元等零小数币种除外）
- **多时区**：服务端统一 UTC 存储；展示按用户时区转换（默认系统时区，可在设置中修改）

## 8. FR-06 合规与隐私

- **隐私政策与用户协议**：首次注册强制展示并勾选；政策必含数据收集清单、使用目的、存储期限、第三方 SDK 清单、用户权利（访问、更正、删除、注销）；政策更新后下次登录需重新确认
- **数据最小化**：仅收集必要数据；敏感数据（手机号、邮箱）加密存储、展示脱敏；国内数据境内存储、海外存对应区域，数据不出境
- **账号注销**：注销前提示订阅失效、数据删除不可恢复；7 天冷静期可撤销；冷静期后删除个人数据，保留匿名化订单与财务记录（合规要求）；海外删除请求按 GDPR/CCPA 30 天内处理

## 9. 横切支撑（PRD §6 共享规则）

| 规则 | 定义 | 引用模块 |
|---|---|---|
| Region 隔离 | 国内(cn)/海外(global) 数据物理隔离，账号/订单/订阅按 region 分库 | FR-01, FR-02, FR-03 |
| 幂等性 | 支付、订阅状态变更接口以 `request_id` 幂等，重复请求返回首次结果 | FR-02 |
| 审计日志 | 登录、支付、退款、注销等关键操作留痕，保留 180 天 | FR-01, FR-02, FR-06 |

**通知规则**：支付成功（站内 + 邮件/短信）；到期前 7/3/1 天各提醒一次；续费失败立即通知更新支付方式；账号异常登录邮件/短信通知。

## 10. 开放问题对模块的阻塞（PRD §7）

| 编号 | 问题 | 阻塞模块 | 状态 |
|---|---|---|---|
| OQ-01 | 旗舰 SaaS 核心功能是什么 | FR-03 工作区内容与订阅 features | 已定案（2026-11-03）：跨端任务与轻协作工具 |
| OQ-02 | 国内 Android 数字商品是否必须走商店 IAP | FR-02 支付通道与分成 | Assumption, TBD |
| OQ-03 | 首批出海市场与语种 | FR-05 i18n/支付/合规 | TBD |
| OQ-04 | 退款窗口与条件（直连通道） | FR-02 退款规则 | TBD |
| OQ-05 | 账号合并策略与数据归属 | FR-01 账号打通 | TBD |
| OQ-06 | 是否支持 IoT 硬件接入 | 范围定义与后端架构 | Assumption：P0 不支持 |

## 11. 功能模块落地对照表（P0，仓库实况）

> 本页从产品功能视角**逐模块**标注后端路由文件 + 路由数 + 前端页面 + 实现状态。技术资产视角见 [02-modules.md](./02-modules.md)，目标架构分层见 [01-architecture.md](./01-architecture.md) §2。

### 11.1 账号身份模块（FR-01）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 验证码发送 | `auth.ts` `POST /auth/code` | `Login.tsx` | ✅ |
| 登录 / 注册 | `auth.ts` `POST /auth/login` | `Login.tsx` | ✅ |
| 令牌刷新轮换 | `auth.ts` `POST /auth/refresh` | `api.ts refreshSession()` | ✅ |
| 登出 | `auth.ts` `POST /auth/logout` | —（401 自动登出） | ✅ |
| 我的信息 | `me.ts` `GET /me` / `PATCH /me` | `Settings.tsx` | ✅ |
| 账号注销（冷静期） | `me.ts` `POST /me/deletion` + `POST /me/cancel-deletion` | `Settings.tsx` | ✅ |
| 第三方登录 / 账号合并 | — | — | ❌ TBD |

### 11.2 订阅支付模块（FR-02）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 套餐目录 | `billing.ts` `GET /plans` | `Plans.tsx` | ✅ |
| 订阅创建（checkout） | `billing.ts` `POST /subscriptions/checkout` | `Plans.tsx` | ✅（仅 mock driver） |
| 当前订阅 | `billing.ts` `GET /subscriptions/current` | `Settings.tsx` + `me.ts` | ✅ |
| 取消订阅 | `billing.ts` `POST /subscriptions/cancel` | `Settings.tsx` | ✅ |
| 订单列表 | `billing.ts` `GET /orders` | `Settings.tsx` | ✅ |
| 发票列表 | `billing.ts` `GET /invoices` | `Settings.tsx` | ✅ |
| 真实支付驱动 / 退款 / 对账 | — | — | ❌ TBD |

### 11.3 项目管理模块（FR-03-①）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 项目列表 | `projects.ts` `GET /projects` | `Projects.tsx` | ✅ |
| 新建项目 | `projects.ts` `POST /projects` | `Projects.tsx` | ✅ |
| 项目详情 | `projects.ts` `GET /projects/:projectId` | `ProjectDetail.tsx` | ✅ |
| 项目更新 | `projects.ts` `PATCH /projects/:projectId` | `ProjectDetail.tsx` | ✅ |
| 归档项目 | `projects.ts` `POST /projects/:projectId/archive` | — | ✅（路由就绪，UI 未渲染） |
| **删除项目** | `projects.ts` `DELETE /projects/:projectId` | — | ✅（路由就绪，UI 未渲染） |
| 项目成员列表 | `projects.ts` `GET /projects/:projectId/members` | — | ✅（路由就绪） |
| 邀请成员 | `projects.ts` `POST /projects/:projectId/invitations` | — | ✅（路由就绪） |
| 接受邀请 | `projects.ts` `POST /invitations/:token/accept` | — | ✅（路由就绪） |
| 移除成员 | `projects.ts` `DELETE /projects/:projectId/members/:userId` | — | ✅（路由就绪） |

### 11.4 任务管理模块（FR-03-①）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 任务列表（含子任务） | `tasks.ts` `GET /projects/:projectId/tasks` | `ProjectDetail.tsx` | ✅ |
| 新建任务 / 子任务 | `tasks.ts` `POST /projects/:projectId/tasks` | `ProjectDetail.tsx` | ✅（固定两级，三级返回 400） |
| 任务详情 | `tasks.ts` `GET /tasks/:taskId` | — | ✅ |
| 任务更新（LWW） | `tasks.ts` `PATCH /tasks/:taskId` | `ProjectDetail.tsx` | ✅（含 `client_updated_at` 冲突裁决） |
| 状态切换 | `tasks.ts` `POST /tasks/:taskId/status` | `ProjectDetail.tsx` | ✅ |
| **删除任务 / 级联子任务** | `tasks.ts` `DELETE /tasks/:taskId` | — | ✅（路由就绪，UI 未渲染） |

### 11.5 仪表盘模块（FR-03-④）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 今日 / 未来 7 天 / 逾期 / 未排期 / **今日已完成** | `dashboard.ts` `GET /dashboard` | `Dashboard.tsx` | ✅（今日已完成按用户时区切日，见 §5.1） |

### 11.6 协作模块（FR-03-③）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 协作者邀请（editor / viewer） | 见「项目管理模块」 invitations | — | ✅ |
| 只读权限拦截 | `core-domain/src/permissions.ts` `assertCan` | 前端按 `features` 隐藏 UI | ✅ |
| 协作者列表 / 移除 | 见「项目管理模块」 members | — | ✅ |
| 实时评论 / 讨论 | — | — | ❌ P1 |

### 11.7 同步模块（FR-04）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 增量变更拉取 | `sync.ts` `GET /sync/changes`（`since_seq` + `project_id`） | `api.ts` 4s 轮询 | ✅ |
| 游标上报 | `sync.ts` `POST /sync/cursors` | `api.ts` 写入 `sync_cursors` | ✅ |
| WebSocket 推送 | — | — | ❌（用 4s 轮询替代，满足 5 秒约束） |

### 11.8 导出模块

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 创建导出任务 | `exports.ts` `POST /projects/:projectId/exports` | `Projects.tsx`（导出按钮） | ✅（仅 basic 及以上） |
| 导出列表 | `exports.ts` `GET /exports` | — | ✅ |
| 下载导出文件 | `exports.ts` `GET /exports/:exportId/download` | — | ✅ |

### 11.9 审计与合规模块（FR-06）

| 子模块 | 后端路由 | 前端页面 | 状态 |
|---|---|---|---|
| 审计日志查询 | `audit.ts` `GET /audit` | — | ✅（后端就绪） |
| 手机号 / 邮箱规范化 | `core-domain` `normalizeIdentity` | `Login.tsx` | ✅ |
| 隐私政策页 | — | — | ❌ |
| 数据导出 / GDPR 请求 | — | — | ❌ |

### 11.10 模块间依赖（代码已体现）

FR-02 依赖 FR-01（`auth.ts` 的 `requireAuth` 前置）；FR-03 全部子模块依赖 FR-01 登录态 + FR-02 `features` 鉴权；FR-04（同步）、FR-05（i18n）、FR-06（审计）为横切约束，由 `packages/*` 承载，`apps/web` 与 `services/mim-api` 同时引用。

**开发实现口径**：数据库表结构、后端服务模块、存储分级见 [08-dev-implementation.md](./08-dev-implementation.md) §1.1；各功能所需第三方 SDK 与密钥命名见 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)。

---

_本页为产品功能视角文档，随 PRD 草案（V0.0.0-preview）同步演进；所有 TBD/Assumption 项待 PRD 确认后更新。_
