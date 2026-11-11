# 08 · 开发实现全景（数据库 / 前端 / 后端 / 存储 / 后台管理平台）

> **状态声明（证据）**：截至 V0.0.0-preview（2026-11-05），仓库内已落地 `apps/web`（React 18 + Vite 6）、`packages/core-domain`、`packages/i18n`、`services/mim-api`（Express 5 + SQLite/better-sqlite3），包管理器 pnpm workspace；`pnpm -r typecheck` / `pnpm --filter @mim/api test`（5 文件 40 例全通过）/ `pnpm -w build` / `node scripts/version-check.mjs` / `node scripts/env-check.mjs`（138 = 138）均已通过并有命令输出留档。
> **2026-11-04 变更（两次）**：① FR-03 旧范围（项目/任务/成员/邀请/仪表盘/增量同步/CSV 导出）已按用户指令整体移除，§3.2「content 域（已移除）」与同步/导出规则仅作历史参考，不再对应仓库实况；② FR-03 已**重定义为「功能模块商城 + 漫剧 AI 剧」**，新增 `catalog` / `comic` / `media` 三域与配套表；实现拆分清单见 [07-functional-modules.md](./07-functional-modules.md) §12。
> **2026-11-05 变更**：② 漫剧第 1/2 期后端已落地——`comic` 域 7 表 + 24 条路由 + `src/orchestrator.ts` + `src/storage.ts` 均已装配进 `app.ts`/`index.ts`；③ 受保护 router 的 `requireAuth` / `requireEntitlement` 改为按命名空间生效（`/me`、`/comic`、`/media`、`/ai`），未匹配路径落到统一 404，不再被鉴权误拦成 401（契约测试「已移除旧接口与未知路径返回 404」锁定）；④ 错误信封归一——`errorHandler` 识别 body-parser 的 `entity.parse.failed`（非法 JSON 请求体），返回 400 `VALIDATION_FAILED` 而非 500 `INTERNAL_ERROR`（契约测试新增 1 例，测试总数 39 → 40）。本页 §2 / §3 / §4 / §5 / §6 / §8 / §9 / §10 已按此同步。
> **2026-11-07 变更**：① `catalog` 补三条管理写路由（`PATCH /modules/:code/status`、`POST /entitlements/grant`、`POST /entitlements/:id/revoke`），鉴权由 `middleware.ts` 的 `requirePermission` 承担（Bearer JWT + RBAC 权限点，逐请求实时查库；`x-admin-token` 保留为超管引导通道，覆盖全部权限；无任何凭证返回 401 `AUTH_UNAUTHORIZED`，凭证无效返回 401 `invalid admin token`，权限不足返回 403 `FORBIDDEN` + `details.permission`）；② 新增 `services/mim-api/src/jobs.ts`——成本告警 / 成片审核超时 / 权益到期扫描三定时任务 + `start`/`stop` 生命周期，复用 `idempotency_keys`（`user_id='system'`、`method='JOB'`），`index.ts` 按 `MIM_JOBS_ENABLED` 装配与优雅退出；③ 契约测试新增 `test/catalog.test.ts`（18 例）与 `test/jobs.test.ts`（9 例），全仓测试 64 → **91 例**；④ `apps/web` 整站强制登录改为两级门禁——`store` / `sitemap` 匿名可访问，`comic` / `settings` 未登录时内嵌 `<Login embedded />`；⑤ **完整 RBAC 与独立后台落地**：`schema.sql` 新增 `permissions` / `roles` / `role_permissions` / `user_roles` 四表，`db.ts` 新增 `RBAC_PERMISSIONS`（8 权限点）/ `RBAC_ROLES`（`superadmin` / `operator` / `viewer` 三内置角色）/ `seedRbac` 幂等播种，`middleware.ts` 新增 `loadPermissions` + `requirePermission`，新增 `routes/admin.ts`（11 个 RBAC 管理端点）并挂载 `/api/v1/admin/*`，新增 `apps/admin` 独立管理后台（React 18 + Vite 6，开发端口 5174，生产入口 `/admin/`，nginx 独立静态根 `/opt/mim/admin`），新增 `test/rbac.test.ts`（28 例），全仓测试 91 → **120 例**（10 文件）。本页 §1.1 / §2 / §3 / §4 / §5 / §8 / §10 已按此同步。
> **2026-11-08 变更（前端路由与门禁）**：① `apps/web/src/router.ts` 由 hash 路由重写为零依赖 history 路径路由——路径即视图（`/store` / `/comic` / `/chat` / `/settings` / `/login`，单段路径兼容 `vite base './'`），旧 `#/xxx` 链接启动时 `replaceState` 改写；③ 整站强制登录改为**按需登录**终态——`/store` 匿名可浏览，`/comic` / `/chat` / `/settings` 匿名访问时内容区内嵌 `<Login embedded />`；④ 地址归一化（`?tads` / 裸问号清理）外置为 `apps/web/public/spa.js`（规避生产 CSP `script-src 'self'` 对内联脚本的拦截）；⑤ SPA 回退三件套——`scripts/spa-404.mjs`（GitHub Pages `404.html`）、`apps/web/public/_redirects`（Cloudflare Pages）、生产 nginx `try_files`；⑥ 新增 `scripts/verify-auth-gate.mjs` 按需登录静态断言门禁。本页相关小节已按此同步。
> **2026-11-08 变更（成片导出补齐）**：① 后端 `POST /comic/films/:id/export` 与 `transcodeVideo()` 早在第 2 期已存在，但前端 0 代码、契约测试 0 覆盖、本页与 07 仍标「规划 / 0 代码」——本轮把「半成品」补完：`apps/web/src/api.ts` 新增 `FilmExportFormat` / `FilmExportResolution` / `FilmExportResult` 与 `api.comic.exportFilm()`，`ComicWorkbench.tsx` 新增 `FilmExportPanel`（导出按钮 / 格式与分辨率选择 / 预签名下载链接 / 转码不可用本地化降级 / 降级后表单回写）；② 顺手修复跨源托管构建下预签名相对地址会打到静态站自身的隐患——新增 `resolvePublicUrl()` 并统一覆盖工程产物下载、图片缩略图、任务产物与成片版本下载共 6 处；③ 新增 `test/film-export.test.ts` 9 例（含预签名地址真实下载字节闭环），全仓契约测试 10 文件 145 例 → **11 文件 154 例**；④ Edge CDP 真实渲染 E2E 14/14 通过（登录 → 造真实成片 → 成片页 → MOV/720p 转码降级 → 一键原片直下 → 下载链接可见、零控制台错误、零横向溢出）。本页 §1.1 / §1.2 / §4.3 与 README、07、PRD 已按此同步。
> **2026-11-11 变更（对外路径段统一为模块功能名称）**：把内部视图标识与对外地址解耦——`router.ts` 新增 `VIEW_SEGMENTS`（`store→marketplace`、`sites→entry-catalog`、`comic→comic-studio`、`login→signin`，`deployments` / `chat` / `settings` 原名即功能名不变），`hrefOf()` 与 `parseLocation()` 全部改为经映射表寻址；新增 `LEGACY_SEGMENTS` 承担旧段兼容（命中旧段时 `replaceState` 改写为新路径并保留查询串 / hash，等价 301）。同轮联动四处：`scripts/build.mjs` 改为解析 `VIEW_SEGMENTS` 生成 `dist/<模块功能名>/index.html`；`apps/web/index.html` 内联脚本的视图段清单同步并重算 CSP 哈希（`sha256-Q4BFbQUCW5bmauOy9Zn8D1km5RItTJrk6r3tkodIR0M=`，nginx 6 处同轮替换）；`deploy/nginx-mim.conf` 增四条旧段 `location =` 301；`scripts/verify-auth-gate.mjs` / `verify-film-export.mjs` 的深链接断言改新段。后端 `/api/v1/*` 与管理端 `/admin/` 不在改名范围。
> **2026-11-11 变更（商城能力扩至 27 条 + IM 聊天完整化）**：① 商城每条导航条目落成真实能力的第一批 6 条扩到 **27 条**（`packages/core-domain/src/moduleCapabilities.ts`），执行层 `services/mim-api/src/capabilities.ts` 27 个 handler，新增 `mustache` / `yaml` / `expr-eval` / `diff` / `sql-formatter` / `csv-parse` 六个运行时依赖；`POST /modules/:code/invoke` 契约不变（登录 + 模块 active + 已登记能力 + 有效权益）。② IM 由「会话 + 文本」补齐为完整 IM：`src/im/db.ts` 新增会话详情 / 成员角色 / 成员列表 / 群改名 / 加人 / 踢人 / 退群与解散 / 置顶免打扰 / 消息搜索 / 2 分钟撤回（软删并清空 content 与对象键）共 10 个导出；`src/routes/im.ts` 新增 9 个端点；`im/protocol.ts` 与前端 `im/socket.ts` 同步新增 `message.recall` 服务端帧，`index.ts` 以 `deps.imHub = attachImWebSocket(...)` 回填 hub 供撤回广播；③ 前端 `Chat.tsx` 全量重写（建群、图片/文件预签名直传、撤回、会话内搜索、输入中提示、加载更早、发送状态、群信息面板、置顶免打扰），并修复 WS `ack` 后乐观消息未回填服务端 ID 导致重复显示的旧缺陷；④ 契约测试新增 `im-extended.test.ts`（9 例）与 `module-capability-coverage.test.ts`（30 例），全仓 **19 文件 / 283 例**；⑤ 线上取证：`/api/v1/modules/cat.dev-31` 返回 `capability="captcha.svg"`，主机内 `.tmp/im-e2e.mjs` 21 项断言全 PASS（建群 201 / 改名 200 与成员 403 / 置顶免打扰生效 / 搜索命中 1 / 撤回 200 且历史清空 / 踢人 200 / 解散 `dissolved`）。
> **2026-11-11 变更（程序开发组 37 条做满 + 聊天图片预览）**：① `MODULE_CAPABILITIES` 由 27 条扩到 46 条，新增 19 条全部绑定「程序开发」组（`cat.dev-08/10/12/13/15/16/18/19/20/22/24/25/27/30/33/34/35/36/37`），该组 37 条导航条目 100% 具备真实能力；执行层新增 `ui.theme`、`speech.ssml`、`http.status`、`data.profile`、`code.detect`、`cache.key`、`search.rank`、`service.topology`、`workflow.check`、`rbac.check`、`code.gen`、`ioc.graph`、`rule.eval`、`spring.config`、`node.pkg`、`bpmn.check`、`anim.keyframes`、`phone.format`、`tauri.perm` 共 19 个 handler，其中 `node.pkg` 引入 `semver` 做版本与范围校验；② 聊天 `Chat.tsx` 新增 `ChatImageBubble`，图片消息按 `object_key` 申请媒体下载签名后内联预览（点击开原图，失败回退文字），`styles.css` 增对应样式；③ 新增契约测试 `test/capabilities-extra.test.ts` 23 例，全仓 21 文件 / 315 例。
> **2026-11-11 变更（购物车 + 商品列表 + 个人中心）**：① 新增 `cart_items` 表（`user_id + module_id` 唯一，虚拟商品不设数量列）与 `src/routes/cart.ts` 五端点（`GET /cart`、`POST /cart/items`、`DELETE /cart/items/:moduleCode`、`DELETE /cart`、`POST /cart/checkout`）；② 结算语义复用商城主路径——免费模块同事务发 `entitlements` + `entitlement_events`（`reason=cart_checkout`），付费模块生成 `pending` 订单（已有待结算单回放），依赖缺失 / 已下架 / 已拥有按条 `skipped` 并保留在车；为此 `routes/catalog.ts` 的 `currentPrice` / `assertDependenciesMet` / `OrderRow` / `orderView` 改为导出共用；③ 前端新增 `views/Products.tsx`（独立 `/products` 密集列表：搜索 / 一级分类 / 可购买性 / 排序 + 分页 + 行内加购）、`views/Cart.tsx`（清单 / 合计 / 结算 / 逐条结果）、`views/Profile.tsx`（`/account` 四分区：资料编辑、我的权益、我的订单、账号安全）；④ 路由 `AppView` 增 `products` / `cart` / `account` 与对应 `VIEW_SEGMENTS`，`LEGACY_SEGMENTS` 兼容 `profile → account`，`App.tsx` 导航与 `GATED_VIEWS` 同步；`Store.tsx` 页头加「商品列表 / 购物车（角标）」入口、卡片加「加入购物车」；⑤ `index.html` 内联视图段清单扩充后重算 CSP 哈希为 `sha256-dx7A4PPWeWC48rajsnmlSYohErc75pUzV9+8bdWoB0k=` 并同步 `deploy/nginx-mim.conf` 4 处；⑥ 契约测试新增 `test/cart.test.ts` 9 例，全仓 **20 文件 / 292 例**。
> **2026-11-11 变更（商城 205 条全覆盖 + 聊天七项增强）**：① 商城侧为其余 143 条「软件方向」模块补「模块起盘蓝图」能力——`packages/core-domain/src/blueprints/` 新增 `types.ts` + 七份分组数据（openharmony 37 / ai 11 / industry 15 / enterprise-store 18 / platform 19 / infra 17 / extensions 26，共 143 条），`moduleCapabilities.ts` 由 62 条扩到 **79 条**（62 工具型 + 17 条 `catalog.<groupSlug>`），实现 205 条导航条目 100% 有真实能力；执行层 `services/mim-api/src/capabilities.ts` 新增 `createBlueprintHandler()` 与 17 个能力键注册，`routes/catalog.ts` 的 invoke 下发 `module_code` 供 handler 取条目专属数据（交付目标 / 技术栈 / 起步代码 + 分组目录树 / 交付物 / 验收清单）。编码规则踩坑记录：分类树真实编码为 `cat.<groupSlug>-<NN>`（OpenHarmony 组是 `cat.openharmony-01…37`，不是 `cat.open-01…`），本轮用脚本比对 7 个蓝图文件、能力清单与 205 条期望编码，批量修正 37 处 × 2 文件。② 聊天后端：`im_messages` 增 `reply_to_id` / `reply_excerpt`（`db.ts` 的 `ADDITIVE_COLUMNS` 让存量库自动补列）、`im/db.ts` 增 `getQuotedMessage` / `listMessagesAround` / `setMemberRole` / `transferOwnership`，`routes/im.ts` 增 `?around=` 查询、`PATCH …/members/:userId`、`POST …/transfer`，并新增 `conversation.members` 广播帧；前端 `Chat.tsx` 增引用 UI、文件气泡下载、群管理面板（设/撤管理员、转让群主、邀请入群、移除）、搜索结果定位高亮、未读分割线、表情选择器（`styles.css` 约 20 条配套规则）。③ 验证：`pnpm -r typecheck` 0（5/6 项目）、`pnpm --filter @mim/api test` **22 文件 / 347 例**、`comment-check --strict` 通过、`verify-deployments` 52/52、聊天点击级 E2E `verify:chat-flow` **15/15** 与新增 `verify:chat-plus` **23/23** 全 PASS。
> **2026-11-12 变更（登录入口补齐：自助注册 / 账号口令 / 通道自检 / 聊天匿名只读）**：生产此前只有「验证码登录（短信/邮件通道未配凭证 → 503）」与「管理员口令」两条路，普通访客点开 `/chat` 只能看到「此功能需登录后使用」，聊天实际不可用。本轮补齐四条：① `POST /auth/register`（`region + identifier + password + 可选 display_name`）——口令 bcrypt(10) 入 `credentials` 表（`kind='password'`，复用既有表结构、零迁移），注册成功直接下发双令牌；强度要求至少 8 位且含字母与数字；重复身份返回 409 新错误码 `AUTH_IDENTITY_EXISTS`（`packages/core-domain/src/errors.ts` 与 `packages/i18n` 中英词条同步登记）。② `POST /auth/password` 改为「先比管理员口令、再比账号自身口令」：`identities` 命中且 `credentials.kind='password'` 存在时走 bcrypt 校验，管理员口令入口保留；两者都未配置才回 503 `AUTH_PASSWORD_NOT_CONFIGURED`。③ 新增 `GET /auth/channels` —— 只回 `{sms,email,password,register}` 布尔值，不泄露凭证；`Login.tsx` 挂载时查询，验证码模式在通道未配置时直接提示「请改用密码登录或注册」，并把登录页从两段式扩为「密码 / 验证码 / 注册」三段。④ 前端新增 `views/ChatPreview.tsx`，`/chat` 匿名态由「整块登录卡片」改为**只读演示页**：同一套 `chat-layout` 布局 + 3 条示例会话 + 5 条示例消息（含引用块）+ 禁用输入区 + 顶部「去登录 / 注册」引导，`App.tsx` 的 `GATED_VIEWS` 相应移除 `chat`。⑤ 验证：新增 `test/auth-account.test.ts` 8 例（通道清单、注册 201 / 重复 409 / 弱口令 400、账号口令 200 / 错误 401 / 全未配置 503、管理员口令兼容），全仓 **23 文件 / 355 例**；`pnpm -r typecheck` 0、`comment-check --strict` 通过、web / api 构建 0。短信与邮件通道代码（`notify.ts` 的阿里云 SMS 与 AWS SES）早已就绪，缺的只是私有凭证，因此第 3 条需求在代码侧无新增、只需注入 `MIM_SMS_ALIYUN_*` / `MIM_EMAIL_SES_*` 环境变量即自动启用。
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
│    gateway · identity · content
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
| 部署形态 | 12 个独立服务 + gateway | 单服务 `services/mim-api`（模块化单体，路由按域分文件） | P0 先单体；路由边界已按域切分（`routes/auth|catalog|site|me|comic|media|ai|admin.ts` 八个），每个文件即一个域，未切分的域不预留空路由 |
| 数据库 | PostgreSQL 按 region 物理分库 + Redis + OpenSearch + MQ | SQLite 单库（`better-sqlite3`，WAL），进程内无外部依赖 | 降低本地/CI 启动成本；表结构（UUIDv7、`bigint` 金额、`deleted_at`、`version` 乐观锁、`idempotency_keys`）已按 PostgreSQL 可迁移口径设计 |
| 实时同步 | WebSocket + MQ 推送，5 秒内到达 | 当前无实时同步需求，同步层未实现 | 端侧数据按需拉取，无跨端一致性场景 |
| 客户端 | web / mini / mobile / desktop / admin 五端 | `apps/web`（用户端，React 18 + Vite 6，`/api` 与 `/health` 由 Vite 代理到 8787）+ `apps/admin`（独立管理后台，React 18 + Vite 6，开发端口 5174，生产入口 `/admin/`，同样经 Vite 代理 `/api`） | 先打通契约与核心流程；mini / mobile / desktop 三端复用同一 `/api/v1` 契约与 `packages/core-domain` |
| 共享包 | core-sdk / ui-kit / platform-adapter / observability / testing-utils | 仅 `packages/core-domain`（错误码/金额/UUIDv7）与 `packages/i18n`（zh-CN/en-US + 货币格式化） | 按需引入，未使用的能力不提前抽象；共享包只保留现行能力，未使用的旧域文件均已不在工作树 |
| 存储 | 对象存储 + CDN（附件/媒体/导出） | `src/storage.ts` 已实现 `LocalDiskStorage`（HMAC-SHA256 预签名，落盘 `data/media`）与 `S3Storage`（AWS SDK 预签名），`/api/v1/media/*` 已装配（2026-11-05） | 生产可选 S3 桶；漫剧关键帧/分镜片段/成片经预签名 URL 分发（见 §6） |
| 后台管理 | `admin-api` + RBAC 后台 | **完整 RBAC + `apps/admin` 独立后台已落地（2026-11-07）**：`schema.sql` 新增 `permissions` / `roles` / `role_permissions` / `user_roles` 四表，`db.ts` 定义 `RBAC_PERMISSIONS` 8 权限点（`module:read` / `module:write` / `entitlement:read` / `entitlement:grant` / `entitlement:revoke` / `user:read` / `rbac:read` / `rbac:write`）与 `RBAC_ROLES` 3 内置角色（`superadmin` 8 项 / `operator` 7 项不含 `rbac:write` / `viewer` 4 项）并由 `seedRbac` 幂等播种；`middleware.ts` 的 `loadPermissions` + `requirePermission` **逐请求实时查库**鉴权；`routes/admin.ts` 11 个 RBAC 端点挂载 `/api/v1/admin/*`；`apps/admin` 独立管理后台生产入口 `/admin/`（nginx 独立静态根 `/opt/mim/admin`）；`x-admin-token` 保留为**超管引导通道**（`timingSafeEqual` + sha256）；**操作审计留痕未实现** | 已达成原 P1 目标；后续待补：`apps/admin` 操作审计留痕（需重开审计域）、细粒度数据域权限、多组织隔离 |
| 鉴权 | gateway 验签 + Redis 会话 | 进程内 JWT（`jsonwebtoken`）+ refresh 轮换；Bearer 中间件在 `middleware.ts` | 单实例即可；横向扩展时 refresh 存储换 Redis |
| 契约先行 | OpenAPI/proto 生成 `core-sdk` | 手写 `apps/web/src/api.ts` + zod 校验（`validate.ts`）+ snake_case 响应 + 错误信封 | P0 以契约测试保障字段一致性：`test/*.test.ts` 共 **11 文件 154 例**（`api` 19 / `comic` 10 / `comic-phase2` 10 / `orchestrator` 10 / `catalog` 41 / `jobs` 9 / `ai-routes` 5 / `media` 3 / `rbac` 28 / `im` 10 / `film-export` 9）；`apps/admin/src/api.ts` 复用同一契约（`snake_case` + 错误信封），后续补 OpenAPI 导出 |
| 仪表盘切日 | 展示端负责时区转换 | **已移除（2026-11-04）**：`routes/dashboard.ts` 随 FR-03 删除，服务端不再按用户时区切日；用户 `timezone` 字段与设置入口保留 | 恢复仪表盘能力时按原口径（`Intl.DateTimeFormat('sv-SE')` + 时区过滤）重新实现 |

### 1.2 成片导出实现（2026-11-08 补齐）

| 层 | 位置 | 实现要点 |
|---|---|---|
| 后端路由 | `services/mim-api/src/routes/comic.ts` `POST /comic/films/:id/export` | 归属校验 → 取最新版本 `object_key` → MP4/1080p 直接复用原片；其它组合读 `MIM_FFMPEG_PATH` 调 `transcodeVideo()`（ffmpeg 缩放补边 + H.264/AAC，产物写 `exports/`）→ `storage.presignDownload()` 签发 1 小时 GET 地址。无产物 / 跨用户 404，转码不可用 403 且带 `details.requested`，写操作强制 `Idempotency-Key` |
| 前端契约 | `apps/web/src/api.ts` | 新增导出类型与 `api.comic.exportFilm()`；新增 `resolvePublicUrl()` 把服务端下发的相对预签名地址在 `VITE_API_ORIGIN` 跨源构建下补成可达地址 |
| 前端视图 | `apps/web/src/views/ComicWorkbench.tsx` `FilmExportPanel` | 成片行「导出」按钮惰性挂载面板；格式/分辨率下拉 + 生成下载链接；成功展示版本 / 格式 / 是否转码 / 有效期 / 下载入口；403 转码不可用时显示中文降级说明与「直接下载原片（MP4 / 1080p）」一键入口，成功后表单回写实际参数避免重复失败 |
| 验证 | `test/film-export.test.ts` + `scripts/verify-film-export.mjs`（`npm run verify:film-export`） | 9 例契约测试（门禁 / 无产物 / 原片直下 / 预签名地址真实下载字节 / 转码降级 / 入参校验 / 幂等重放 / 最新版本 / 归属隔离）+ Edge CDP E2E 14/14（真实登录造数、深链接、UI 渲染、降级交互、CSS 无溢出、控制台零错误） |

> 设计取舍：**不新增数据库表**（导出是一次性凭证签发，不落任务表），也不引入新第三方依赖（转码沿用既有的 `node:child_process` + ffmpeg，媒体分发沿用 `storage.ts` 预签名）。后续若需要「导出历史 / 大文件异步打包」，再按 FR-03.2 规划引入导出任务表。

## 2. 后端服务模块清单

| 服务 | 职责 | 对外接口（前缀 `/api/v1`） | 关键依赖 | region |
|---|---|---|---|---|
| `gateway` | 统一入口：鉴权、限流、灰度、region 路由、错误码归一、多语言注入 | 全部流量入口 | Redis（限流）、identity（验签） | cn / global |
| `identity` | 注册登录、第三方登录绑定、会话与设备、账号合并、注销 | `/auth/*`、`/accounts/*`、`/devices/*` | 短信/邮件通道、Redis | 分库 |
| `catalog` | **（已落地，2026-11-07 补管理写面）** 功能模块目录、模块定价、解锁发放与回收、解锁鉴权；`modules`/`module_prices`/`entitlements`/`entitlement_events` 四表已建，`requireEntitlement` 门禁 + 公开只读 `GET /modules`、`GET /modules/:code` + 三条管理写路由（状态迁移 / 发放 / 回收）均已实现；`order_items` 随订单域于 2026-11-05 取消，**不建表** | `GET /modules`、`GET /modules/{code}`、`GET /entitlements`、`POST /entitlements`（普通用户自领）、`GET /entitlements/{code}/check`、`PATCH /modules/{code}/status`、`POST /entitlements/grant`、`POST /entitlements/{id}/revoke`（后三条需 `module:write` / `entitlement:grant` / `entitlement:revoke` 权限，Bearer + RBAC 逐请求实时查库；`x-admin-token` 为超管引导通道，覆盖全部权限） | admin-api | 分库 |
| `comic` | **（第 1 期已落地 2026-11-04；第 2 期路由骨架已落地 2026-11-05）** 工程/角色/分镜（`/comic/projects/*` 8 条）与生成任务编排、成片合成与版本、审核发布（`/comic/jobs/*`、`/comic/films/*` 16 条）均已实现（共 24 条路由）；任务编排与队列消费（`src/orchestrator.ts` → `/api/v1/ai/*`）、对象存储（`src/storage.ts` → `/api/v1/media/*`）**已于 2026-11-05 装配进 `app.ts`/`index.ts`，`MIM_AI_WORKER` 默认随进程自动消费；openai 兼容提供方已接入 text/image（2026-11-06，video/tts/compose 诚实失败 `PROVIDER_NOT_CONFIGURED`），更多真实厂商模型调用待 OQ-08 凭证** | `/comic/projects/*`、`/comic/jobs/*`、`/comic/films/*`（24 条已实现，骨架） | ai-orchestrator、media、对象存储、审核服务、MQ | 分库 |
| `media` | **（已落地并装配上线，2026-11-05）** `src/storage.ts` 实现 `LocalDiskStorage`（HMAC-SHA256 预签名 URL，落盘 `data/media`）与 `S3Storage`（AWS SDK 预签名）；`/media/presign/*`、`/media/assets`、免鉴权对象收发端点均已挂载；`generation_assets` 表已建 | `/media/presign/upload`、`/media/presign/download`、`/media/assets`、`/media/objects/*`（已上线） | 对象存储、CDN | 按 region 桶 |
| `content` | **P0 任务与协作域已整体移除（2026-11-04，本页保留为历史设计）**：原含项目/任务/子任务、列表/今日/日历/看板视图、个人仪表盘、成员邀请与两档权限、增量同步、CSV 导出；**P1 通用内容管理域**：内容/资源元数据、审核流、检索索引、推荐候选 | P1：`/contents/*`、`/search`（原 P0 的 `/projects/*`、`/tasks/*`、`/dashboard`、`/sync/*`、`/exports/*` 已删除） | P1：对象存储、OpenSearch、审核服务 | 分库 |
| `im` | 会话、消息可靠性、已读回执、在线状态、离线推送、审核 | `/im/*`（HTTP + WebSocket） | MQ、推送通道、审核服务 | 分库 |
| `rtc` | 信令、房间编排、录制、转码、质量监测 | `/rtc/*` | RTC 第三方、对象存储 | 分集群 |
| `ai-orchestrator` | 模型路由、Prompt 版本、输出审核、配额与成本核算；**漫剧生成**（文生图 / 图生视频 / TTS / 合成）的模型路由、成本预检与配额扣减在此编排 | `/ai/*`、内部消费 `generation_jobs` 队列 | 大模型供应商、审核服务、MQ | 按合规域 |
| `notification` | 站内信、邮件、短信、推送编排与模板 | `/notifications/*` | 邮件/短信/推送通道 | 分库 |
| `openapi` | 开放平台：OAuth2、API Key、Webhook 投递、限流 | `/open/*` | gateway | 分库 |
| `admin-api` | **（已落地，2026-11-07）** 运营后台 BFF：RBAC 角色/权限/用户角色管理与 `GET /admin/me` 权限自省，实现在 `services/mim-api/src/routes/admin.ts`（**同进程路由，非独立服务**），共 11 个端点；独立前端 `apps/admin` 生产入口 `/admin/`；操作审计埋点未实现 | `/admin/*` | catalog 库（当前 SQLite 单库） | 单库 |
| `jobs` | **（已落地，2026-11-07）** `src/jobs.ts` 提供三个定时任务（成本告警 / 成片审核超时 / 权益到期扫描）+ `start`/`stop` 生命周期，复用 `idempotency_keys`（`user_id='system'`、`method='JOB'`）做抢占与结算；`index.ts` 按 `MIM_JOBS_ENABLED`（默认开）装配并在优雅退出时 `stop()`（见 §8） | 无 HTTP | 全部域库（当前仅 SQLite 单库） | 双区各一套 |

服务拆分原则：**先单体后拆分**。P0 实际为单个部署单元 `services/mim-api`（模块化单体，按域分路由文件：`auth` / `catalog` / `me` / `comic` / `media` / `ai` / `im` / `admin`），但代码边界仍按上表分目录，避免后期拆分时重构业务逻辑。

各服务所需的第三方提供方、SDK/API 形态与密钥命名见 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)；密钥按 region 独立、不入库，仅存环境变量或 KMS。

## 3. 数据库设计

### 3.1 全局约束

| 约束 | 规则 |
|---|---|
| 分库 | `cn` 与 `global` **物理独立集群**，不共用实例；跨区只同步匿名聚合指标，不同步个人数据 |
| 分 schema | 按域：`identity` / `catalog` / `comic` / `media` / `content` / `im` / `ai` / `admin` / `ops` |
| 主键 | `id` 使用 UUIDv7（时间有序，便于索引与分片） |
| 金额 | 一律 `bigint` 整数**最小货币单位**（人民币=分，美元=分），配 `currency char(3)` |
| 时间 | `timestamptz`，统一 UTC 存储，展示端负责时区转换 |
| 软删除 | 业务表带 `deleted_at timestamptz NULL`；已发布成片与事件/版本表**禁止软删除或覆盖**，只能追加新版本或记录 |
| 并发 | 带 `version int` 乐观锁；一切状态变更必须走对应状态机校验（漫剧三套状态机见 [07](./07-functional-modules.md) §2.2） |
| 幂等 | 独立表 `ops.idempotency_keys(idempotency_key, scope, request_hash, response_json, created_at)`，唯一索引 `(scope, idempotency_key)` |
| 分区 | `im.messages` 按会话哈希分片；业务表不设分区 |
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
| `account_merges` | `id`、`source_user_id`、`target_user_id`、`status`、`approved_by`、`executed_at` | OQ-05 落地；执行前校验登录方式绑定与风控状态 |

**catalog 域（5 表已建 + `requireEntitlement` 已落地，2026-11-08 增补 `module_orders`）**

> 功能模块商城（FR-03.1）。模块目录与定价、解锁发放与回收；解锁鉴权只认服务端 `entitlements`。2026-11-08 付费模块门禁落地后新增**模块级订单表 `module_orders`**（不含任何订阅/计划字段），付费模块须「下单 → 结算 → 发权益」，免费模块仍直接解锁。

| 表 | 关键字段 | 说明 / 索引 |
|---|---|---|
| `modules` | `id`、`code`、`name_i18n`、`summary_i18n`、`unlock_mode(one_time)`、`entitlements_required`、`region`、`status(draft/active/archived)`、`sort_order` | 模块目录；**唯一索引 `(region, code)`**（支持 cn/global 双区同 code 各一行），`code` 在区内不复用；索引 `(region, status, sort_order)`。JSON 字段在 SQLite 以 TEXT 存。`unlock_mode` 当前唯一有效值 `one_time`（DB CHECK 约束仅允许该值） |
| `module_prices` | `id`、`module_id`、`currency`、`amount_minor`、`effective_from`、`effective_to` | 定价与模块解耦，改价不改历史解锁记录；`amount_minor` 有 `CHECK (> 0)` |
| `module_orders` | `id`、`user_id`、`module_id`、`region`、`currency`、`amount_minor`、`status(pending/paid/cancelled)`、`channel(manual/alipay/wechat/stripe)`、`channel_txn_id`、`entitlement_id`、`created_at`、`updated_at`、`paid_at`、`cancelled_at` | 付费模块订单；金额在**下单时刻由服务端快照**，不随改价变化。部分唯一索引 `uq_module_orders_pending (user_id, module_id) WHERE status='pending'` 防重复待付单（取消后可重新下单）；索引 `idx_module_orders_user`、`idx_module_orders_status`；**`uq_module_orders_txn`**（`channel_txn_id` 部分唯一，NULL 不参与）保证同一笔渠道交易只结算一张单。人工结算走 `POST /orders/:id/settle`（`channel_txn_id` 为 NULL）；在线渠道走 `POST /orders/:id/payment-notify`（HMAC 签名 + 交易号幂等），两条入口共用同一结算事务 |
| `entitlements` | `id`、`user_id`、`module_id`、`source(admin)`、`source_id`、`status(active/expired/revoked)`、`expires_at`、`version` | **服务端解锁鉴权唯一依据**；唯一索引 `(user_id, module_id)`（一次性解锁）。`source` 当前唯一有效值 `admin`（DB CHECK 仅允许该值）；订单结算发放时 `source_id` 写订单主键（一单一权益，可反查来源订单） |
| `entitlement_events` | `id`、`entitlement_id`、`from_status`、`to_status`、`reason`、`actor(job/admin/system)`、`created_at` | 只追加，禁止 UPDATE |

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
| `admin` | **已落地四表（2026-11-07）**：`permissions`、`roles`、`role_permissions`、`user_roles` | RBAC 主体（8 权限点 / 3 内置角色 / 用户角色绑定）；**审计相关表**规划中的 `admin_users` / `role_bindings` / `operation_logs` / `tickets` / `feature_flags` / `announcements` **均未建表**，当前员工身份复用 `users` 表 |
| `ops` | `idempotency_keys`、`outbox_events`、`dead_letters`、`job_runs` | 幂等、事务性发件箱、失败队列、任务记录 |

### 3.3 状态机落库规则

- 所有状态写入必须携带 `idempotency_key`，重复请求返回首次结果（PRD §6 幂等规则）；同键同体重放首次响应，同键异体返回 `409`。
- `contents.status`（P1）：`draft → published ⇄ blocked`、`published → deleted`；任何机审/人审结论只能经 `audit_records` 追加，不允许直接改 `contents.status` 跳过审核。
- `modules.status`（**写路径已实现，2026-11-07**：`PATCH /modules/:code/status` + 状态机校验 + 契约测试 7 例）：只能 `draft → active → archived` 单向；`archived` 后不可新购，已购 `entitlements` 不受影响；`code` 一旦分配在区内永不复用（唯一约束为 `(region, code)`）。
- `entitlements.status`（**发放/回收写路径已实现，2026-11-07**：`POST /entitlements/grant` / `POST /entitlements/:id/revoke` 与 `entitlement_events` 同事务写入；到期由 `src/jobs.ts` 的 `entitlement-expiry` 任务扫描迁移）：只能经 `entitlement_events` 追加推进；`revoked`（风控回收）与 `expired`（时效到期）必须与触发动作**同事务**写入，不允许事后异步补写。当前只读门禁 `requireEntitlement` 已按 `status='active' AND (expires_at IS NULL OR expires_at > now)` 判定。
- `comic_projects.status`（**第 1 期已实现 `draft ⇄ storyboarded`；第 2 期骨架已实现 `storyboarded → generating → rendered → published`**，`archived` 保留给归档流）：进入 `storyboarded` 必须有对应 `storyboards` 已确认版本（`confirmed_at` 非空），且仅 `draft`/`storyboarded` 两种状态允许编辑与写分镜；首个 `generation_jobs` 派发驱动 `storyboarded → generating`，`compose` 任务成功驱动 `generating → rendered`（骨架口径；`orchestrator.ts` 已于 2026-11-05 装配进 `app.ts`/`index.ts`，接入真实厂商模型后收紧为「产物覆盖全部分镜」）；成片 `publish` 驱动 `rendered → published`，不得跳级。
- `comic_films.status`（**第 2 期骨架已实现**）：`draft → reviewing → published → archived`；提交审核要求最新版本已登记 `object_key`；驳回回到 `draft` 并留原因（`review_note`）；`published` 只能由 `current_version_id` 指向的 `film_versions` 支撑，版本只追加不覆盖，发新版回到 `draft` 待重审。
- `generation_jobs.status`（**第 2 期骨架已实现**）：`queued → running → succeeded | failed | canceled` 单向；失败重试**新建** job（`retry_of` 指向原 job），历史 job 与产物永不覆盖；额度在 `succeeded` 时结算（`src/orchestrator.ts` 已内置单任务/当日成本预检，并已于 2026-11-05 装配进 `app.ts`/`index.ts`）。状态迁移既可由编排控制面端点驱动，也可由 worker 轮询队列自动消费（`MIM_AI_WORKER` 默认 `1`，置 `0` 关闭）。

## 4. 前端（多端）模块清单

### 4.1 端划分与职责

| 端 | 技术栈（规划） | 入口/路由 | P0 页面 |
|---|---|---|---|
| `apps/web` | Next.js（SSR + PWA） | `/`（营销）、`/app/*`（工作区）、`/[locale]/*` | **当前实况**：登录、账号设置（含地区信息）、协议页。规划新增：商城、漫剧工作台、成片管理 |
| `apps/mini` | uni-app 或 Taro（多编译目标、分包） | 首页、我的、设置 | 微信授权登录、设置 |
| `apps/mobile` | Flutter（iOS/Android/鸿蒙 ArkTS 适配层） | 同上 | 登录、工作区、推送设置 |
| `apps/desktop` | Tauri（Win/macOS/Linux） | 同上 | 登录（浏览器回调）、工作区、更新提示 |
| `apps/admin` | **React 18 + Vite 6（自写 CSS 令牌，未引入 Ant Design Pro）** | `/admin/`（生产 nginx 独立静态根 `/opt/mim/admin`；开发端口 5174，`/api` 经 Vite 代理到 8787） | 见 §5 后台管理平台（**已上线，2026-11-07**） |

### 4.2 共享包职责

| 包 | 职责 | 禁止事项 |
|---|---|---|
| `core-domain` | 类型、状态机、校验规则（纯函数，可单测）；当前仅含错误码/金额/UUIDv7 | 禁止 import 任何端 SDK；当前域模型覆盖身份、模块目录、解锁、漫剧工程与成片 |
| `core-sdk` | 由 OpenAPI 生成的请求客户端 + 类型 + 错误码 | 禁止手写接口与字段 |
| `ui-kit` | Design Token（颜色/间距/字号/圆角）+ 基础组件 | 禁止写业务逻辑 |
| `i18n` | 文案资源、复数规则、货币/时区格式化、RTL 预留 | 禁止硬编码文案 |
| `platform-adapter` | `IPlatformAdapter` 及子接口（auth/push/storage/share） | 业务层禁止 `if (platform)` 判断 |
| `capability-client` | 能力网关客户端（im/rtc/ai/push/storage 的统一调用与降级） | 禁止直连第三方 SDK |
| `observability` | 埋点、日志、错误上报、性能指标 | 禁止输出 PII 明文 |
| `testing-utils` | 契约测试夹具、e2e helper | 禁止依赖生产数据 |

### 4.3 页面级模块（P0 可交付集合）

| 模块 | 关键交互 | 涉及 FR |
|---|---|---|
| 登录/注册 | 手机号验证码、邮箱密码/验证码、微信/支付宝/Google/Apple 登录；频控与错误提示 | FR-01 |
| 账号设置 | 资料、绑定管理、设备列表、注销（7 天冷静期可撤销） | FR-01 / FR-06 |
| 协议与隐私 | 首次强制勾选、政策更新后重新确认、SDK 清单展示 | FR-06 |
| 语言与地区 | 语言切换、币种展示、时区设置 | FR-05 |
| 功能模块商城（**🟢 全链路已落地（2026-11-08）：目录/详情/付费门禁/订单/人工结算/渠道回调 + Web 商城页 + Admin 订单页**） | 模块列表（按 region/status 过滤 + `?q=` 搜索）、模块详情（价格历史/前置依赖）、**免费模块直接解锁、付费模块一律 402 `PAYMENT_REQUIRED` 引导下单**、下单（金额服务端快照 + 渠道可选 + 待付唯一约束 + 业务回放）、取消订单、管理端跨用户订单列表（`GET /orders/manage`）、人工结算（订单置 paid + 发放订单来源权益 + 写 `entitlement_events` 同事务）、**渠道支付回调（`POST /orders/:id/payment-notify`：HMAC-SHA256 签名 + ±300s 时间窗 + 交易号幂等 + 金额/渠道一致性校验，与人工结算共用同一事务）**；依赖链写入时做**成环检测**（A→B→A 与自指均 400） | FR-03.1 |
| 漫剧 AI 剧工作台（**🟢 后端第 1/2 期已落地（`comic` 域 7 表 + 24 条路由 + `orchestrator.ts`/`storage.ts` 已装配）；前端三标签页已落地**——创作（工程/角色/AI 建议）、生成任务（capabilities 横幅 / 派发 / 手动运行 / 失败透传 / 产物下载 / 3s 轮询）、成片（工程产物面板 / 版本面板下载播放 / 审核发布），2026-11-06） | 工程列表/详情、剧本与角色设定（character bible）、分镜表（镜头序列/台词/时长）、单镜头重生成、生成任务进度与失败重试 | FR-03.2（形态②④①） |
| 成片管理（**🟢 后端已落地（第 2 期 `comic_films`/`film_versions` + `/comic/films/*`）；前端已落地**——工作台成片标签页：列表/版本面板（预签名下载/播放）/提交审核/发布/驳回/归档，2026-11-06） | 成片列表、版本列表、审核状态、发布/归档、导出（分辨率/格式，预签名 URL 下载） | FR-03.2（形态③） |


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

**当前实现（2026-11-07，完整 RBAC 已落地）**：角色与权限为**数据库驱动的动态模型**，定义在 `services/mim-api/src/db.ts` 的 `RBAC_PERMISSIONS` / `RBAC_ROLES`，由 `seedRbac(db)` 幂等播种（已存在则跳过，不覆盖人工改动），用户与角色经 `user_roles` 表绑定。权限点共 8 个，内置角色共 3 个：

| 内置角色 | 权限点 | 说明 |
|---|---|---|
| `superadmin` | 全部 8 项 | `module:read` / `module:write` / `entitlement:read` / `entitlement:grant` / `entitlement:revoke` / `user:read` / `rbac:read` / `rbac:write` |
| `operator` | 7 项（**不含 `rbac:write`**） | 可读角色定义、可做模块与权益写操作，但不能创建/修改角色、不能改角色权限集合 |
| `viewer` | 4 项 | `module:read` / `entitlement:read` / `user:read` / `rbac:read`（纯只读） |

鉴权链路（`middleware.ts`）：`requirePermission(permission)` 逐请求实时查库（`loadPermissions` 由 `user_roles → role_permissions → permissions` 关联取并集），不做进程内缓存，改权限立即生效。两条通道并存：① Bearer JWT + RBAC 权限点（常规后台用户）；② `x-admin-token`（sha256 + `timingSafeEqual` 常量时间比对，命中后 `req.adminBootstrap = true` 覆盖全部权限）作为**超管引导通道**，用于首次开通与紧急兜底；未配置 `MIM_ADMIN_TOKEN` 时该通道返回 403 `FEATURE_NOT_AVAILABLE`。错误语义：无任何凭证 → 401 `AUTH_UNAUTHORIZED`；token 错误 → 401 `invalid admin token`；Bearer 权限不足 → 403 `FORBIDDEN` + `details.permission`。

管理端点由 `services/mim-api/src/routes/admin.ts` 提供（挂载 `/api/v1/admin/*`，共 11 条）：`GET /admin/me`（权限自省）、`GET /admin/permissions`、`GET|POST /admin/roles`、`PATCH|DELETE /admin/roles/:code`、`GET|PUT /admin/roles/:code/permissions`、`GET /admin/users`、`GET|POST /admin/users/:userId/roles`、`DELETE /admin/users/:userId/roles/:roleCode`。

**历史设计留痕（已被上述实现取代）**：

|---|---|---|

硬规则（历史条文）：~~任何写操作必须写 `admin.operation_logs`~~ —— **该表不存在**，`admin.operation_logs` 从未建表。当前写路由的实际留痕手段为：`requirePermission` 逐请求实时查库鉴权 + `entitlement_events` 记录权益发放/回收事件（`POST /entitlements/grant`、`POST /entitlements/:id/revoke` 均写入事件行）。当前无金额写操作，未来若重开计费能力须同步恢复操作审计与四眼原则。

原「P0 任务与协作数据后台默认只读」规则已失效（2026-11-04，FR-03 项目/任务数据整体移除；审核队列仅服务 P1 `contents`）。

### 5.2 功能模块

| 模块 | 功能点 | 关联后端 |
|---|---|---|
| 用户管理 | 检索、详情（账号/设备/解锁时间线）、封禁/解封、注销协助、账号合并审批 | identity |
| 模块与解锁（`catalog`） | 模块检索/上下架（`draft`/`active`/`archived`）、定价与生效期配置、解锁记录查询、手工发放/回收（经 `entitlement_events` 留痕） | catalog |
| 内容审核（P1） | 机审结果、人审队列、处置动作、申诉（仅 P1 `contents`） | content |
| 工单系统 | 客服工单、SLA、内部备注、用户可见回复 | admin / notification |
| 经营看板 | **待重新定义**：当前可观测口径为解锁数、生成任务量与成本、region 拆分 | 数仓/只读副本 |
| 配置中心 | Feature Flag、灰度比例、公告、通知模板 | admin / notification |

### 5.3 后台不得做的事

- 不得直接改账：金额调整只能通过「冲正/退款/补偿」三类受控动作（**当前无计费写操作**）；
- 不得绕过状态机改解锁状态（`entitlements` 的状态变更须经 `entitlement_events` 追加）；
- 不得导出含 PII 的明文报表（导出需脱敏 + 审批 + 水印）；
- 不得跨 region 合并数据。

## 6. 存储设计

| 存储 | 用途 | 关键配置 |
|---|---|---|
| PostgreSQL | 主业务库（按 region 分集群、按域分 schema） | 主从 + 只读副本（供 admin 看板）；PITR 备份；连接池上限按服务配额 |
| Redis | 会话/刷新令牌黑名单、验证码、频控计数、解锁状态缓存（TTL 5 分钟）、分布式锁、轻量队列 | 开启持久化用于锁场景；key 前缀按域隔离 |
| OpenSearch | P1 内容与后台检索、日志检索；**P1 漫剧工程/成片与生成产物的元数据检索**（P0 无检索需求，原项目/任务检索随 FR-03 移除） | 按 region 独立索引；索引按天滚动 |
| 对象存储 | 头像、音视频录制；**漫剧关键帧、分镜片段、TTS 音频、成片**（`generation_assets` / `film_versions` 仅存 `object_key`） | 私有桶 + 预签名 URL；录制保留期按业务配置；漫剧原始产物保留 90 天、已发布成片按版权要求长期保留。原「发票 PDF」保留要求与 CSV 导出产物均不在现行范围 |
| CDN | 静态资源、媒体分发（含漫剧成片播放） | 国内/海外分开加速域；回源鉴权 |
| MQ（Kafka/RabbitMQ） | 领域事件、异步任务、事务性发件箱（原 P0 `task.changed` 事件随 FR-03 移除）；**`generation.job.*`（入队/状态变更/完成/失败）与 `entitlement.*`（发放/回收）事件** | `outbox_events → MQ`，消费失败进 `dead_letters` 并可重放；生成任务队列与业务事件队列分 topic |

数据分级：

| 级别 | 数据 | 处理 |
|---|---|---|
| L1 敏感 | 手机号、邮箱、密码哈希、支付凭证（**当前无支付能力**） | 加密存储、展示脱敏、禁止进日志与埋点 |
| L2 业务 | 内容正文（P1）、**漫剧工程与成片、解锁与回收记录** | 按 region 隔离、按角色授权、审计访问 |
| L3 公开 | 模块价格、公开内容 | 可缓存、可 CDN |

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
| 注销冷静期到期清理 | 每日 | 只处理到期且未撤销 |
| 搜索索引投递（P1） | 持续消费 | 仅 P1 `contents`；失败进死信，可重放 |
| 配额重置（AI/存储） | 每月 1 日 | 按 `quota_id + period` 幂等（以 `MIM_AI_JOB_COST_LIMIT_MINOR` / `MIM_AI_DAILY_COST_LIMIT_MINOR` 成本上限落地） |
| **AI 生成任务队列消费**（**已落地，2026-11-05**） | 持续消费 | `src/orchestrator.ts` 消费 `generation_jobs`（`text`/`image`/`video`/`tts`/`compose`）；`MIM_AI_WORKER` 默认 `1` 随进程启动；同工程串行、跨工程并行；失败进死信可重放；重试新建 job（`retry_of`）不覆盖历史 |
| **生成成本告警**（**已落地，2026-11-07**：`src/jobs.ts` `runCostAlert`） | 每小时（`DEFAULT_INTERVALS['cost-alert'] = 3600_000`） | 近一小时 `generation_jobs.cost_estimate_minor` 之和对比小时上限（`MIM_AI_HOURLY_COST_LIMIT_MINOR`，缺省按 `MIM_AI_DAILY_COST_LIMIT_MINOR / 24` 向上取整，日上限缺省 500000），越线即告警；幂等键 `job:cost-alert:<YYYY-MM-DDTHH>`（`idempotency_keys` 中 `user_id='system'`、`method='JOB'`） |
| **成片审核超时提醒**（**已落地，2026-11-07**：`src/jobs.ts` `runFilmReviewSla`） | 每 6 小时（`DEFAULT_INTERVALS['film-review-sla'] = 21600_000`） | `comic_films.status = 'reviewing'` 且 `updated_at` 早于 `now - SLA` 的条目计数告警；SLA 由 `MIM_FILM_REVIEW_SLA_HOURS` 配置（缺省 48）；幂等键 `job:film-review-sla:<YYYY-MM-DDTHH>` |
| **解锁到期扫描**（**已落地，2026-11-07**：`src/jobs.ts` `runEntitlementExpiry`） | 每日（`DEFAULT_INTERVALS['entitlement-expiry'] = 86400_000`） | 时效型 `entitlements`（`status='active' AND expires_at <= now`）转 `expired`，UPDATE 与 `entitlement_events` 追加（`actor='job'`、`reason='expires_at reached'`）**同事务**；逐条幂等键 `job:entitlement-expiry:<entitlement_id>:<expires_at>` |
| **过期产物清理 + 失联任务回收**（**已落地，2026-11-08**：`src/jobs.ts` `runAssetGc` / `src/orchestrator.ts` `reclaimStale`） | 产物清理每日（`DEFAULT_INTERVALS['asset-gc'] = 86400_000`）；失联回收随 worker 每轮 `tick()` 及启动瞬间执行 | `asset-gc`：`generation_assets.expires_at <= now AND purged_at IS NULL` 逐条真删对象字节并回写 `purged_at`（**行保留作审计**，成片 `expires_at` 为空天然豁免），逐条幂等键 `job:asset-gc:<asset_id>:<expires_at>`，单轮上限 `MIM_ASSET_GC_BATCH`（缺省 200），删除失败回滚幂等键待下轮重试；`reclaimStale`：`status='running'` 且 `started_at` 早于 `now - MIM_AI_JOB_STALE_MS`（缺省 900000）时放回 `queued` 并 `attempts+1`，达到 `MIM_AI_JOB_MAX_RECLAIM`（缺省 2）判 `failed / JOB_STALE_TIMEOUT`，避免崩溃后任务永久卡死 |
| 截止日提醒推送 | — | 已移除（FR-03 删除；`features` 套餐能力校验与 `task_events` 提醒源同步取消） |
| 项目邀请过期 | — | 已移除（FR-03 删除，随 `project_invitations` 表清理） |
| CSV 导出生成 | — | 已移除（FR-03 删除，随 `content_exports` 表清理） |
| 同步事件与游标清理 | — | 已移除（FR-03 删除，随 `task_events` / `sync_cursors` 表清理） |

## 9. 可观测性与安全

- **链路**：`request_id` 贯穿 gateway → 服务 → MQ → jobs；结构化日志（JSON），禁止打印 PII；
- **指标**：**当前口径为生成任务成功率/失败原因分布、单任务与当日 AI 成本、解锁发放/回收数、接口 P95、错误码 TopN**；
- **告警**：死信堆积、生成任务失败率异常、AI 单日成本逼近上限（`MIM_AI_DAILY_COST_LIMIT_MINOR`）、登录失败率异常；
- **安全**：全链路 TLS；密钥托管（KMS/Vault），禁止硬编码；WAF + 限流；后台管理端独立域名与二次认证；依赖漏洞扫描进 CI。

## 10. 落地顺序（与 PRD 优先级对齐）

| 阶段 | 交付物 | 对应 |
|---|---|---|
| 第 1 步 | monorepo 骨架、`identity`、`apps/web` | P0 |
| 第 2 步 | `admin-api` 完整管理面（**已落地，2026-11-07**：完整 RBAC —— `schema.sql` 四表 `permissions` / `roles` / `role_permissions` / `user_roles`，`db.ts` 8 权限点 + 3 内置角色 + `seedRbac` 幂等播种，`requirePermission` 逐请求实时查库，`routes/admin.ts` 11 条 RBAC 管理端点，`x-admin-token` 保留为超管引导通道；三条 catalog 管理写路由按权限点鉴权；`apps/admin` 独立端**已建并上线（2026-11-07）**：React 18 + Vite 6，开发端口 5174，生产入口 `/admin/`（nginx 独立静态根 `/opt/mim/admin`），覆盖概览 / 模块状态流转 / 权益发放回收 / 角色权限 / 用户角色五视图）、`jobs`（~~续费/对账/掉单~~ 已删除；注销冷静期清理、AI 队列消费；**三定时任务已落地，2026-11-07**：成本告警 / 成片审核超时 / 权益到期扫描）（~~协作邀请与两档权限~~、~~同步通道~~、~~截止日提醒~~ 已随 FR-03 移除） | P0 运营闭环 |
| 第 3 步 | `apps/mobile``notification`、i18n 首批语种 | P0 完成 |
| 第 4 步 | `content`（P1 通用内容管理：内容/审核/检索）、`im`、`rtc`、`ai-orchestrator`、`openapi`、`apps/desktop` | P1 |

**FR-03 新范围（功能模块商城 + 漫剧 AI 剧）落地顺序**（与 [07-functional-modules.md](./07-functional-modules.md) §12 一致，四期串行）：

| 期次 | 交付物 | 对应形态 | 依赖前置 |
|---|---|---|---|
| 基座 | `catalog` 域 4 表已建（`modules`/`module_prices`/`entitlements`/`entitlement_events`）+ `/modules` `/entitlements` 路由**已实现（2026-11-07 补三条管理写路由）**；`requireEntitlement` 门禁已落地。`entitlements` 现由后台/风控动作直接写入并追加 `entitlement_events` | 商城（FR-03.1） | 无（复用现有 identity） |
| 第 1 期 | `comic` 域工程/角色/分镜三表；工作台的工程 CRUD、character bible、分镜编辑与人工确认 | ② AI 辅助创作工作台 | 第 1 期仅工程，不产出成片 |
| 第 2 期 | `generation_jobs` / `generation_assets` + `ai-orchestrator` 生成编排；文生图/图生视频/TTS/合成队列；工作台内单镜头生成与导出成片。**代码状态（2026-11-05）**：路由骨架 16 条已上线；`src/orchestrator.ts`（mock 产物真实落盘 + 成本预检 + compose 联动工程 `rendered`）与 `src/storage.ts`（local/S3 预签名）**已于 2026-11-05 装配进 `app.ts`/`index.ts`（`/api/v1/ai/*`、`/api/v1/media/*`，`MIM_AI_WORKER` 默认自动消费）**；openai 兼容提供方已接入 text/image（2026-11-06），video/tts/compose 诚实失败，更多真实模型调用待 OQ-08 凭证 | ④ 创作工作台 + 导出成片 | 模型供应商凭证（OQ-08）、对象存储 |
| 第 3 期 | 全自动流水线：题材/大纲一次输入跑完整条链（无人工确认点） | ① AI 全自动生成成片 | 第 2 期全链路稳定 |
| 第 4 期 | `comic_films` / `film_versions` + 审核发布 + 导出；成片列表/版本/浏览 | ③ 漫剧作品管理与分发 | 审核口径（OQ-07） |

**未决阻塞**：原「工作区实体设计」相关阻塞已随 FR-03 于 2026-11-04 整体移除而**失效**（8 张 content 表、两层任务限制、同步事务与 LWW 裁决、同步游标保留期、软删物理清理保留期均不再适用）；仍需确认：OQ-03（首批语种）、OQ-05（账号合并）、**OQ-07（漫剧版权与审核口径）**、**OQ-08（生成模型供应商与成本上限）**、**OQ-09（模块定价与折扣）**，见 [07-functional-modules.md](./07-functional-modules.md) §10。P1 通用内容管理（`contents` / 审核 / 检索）不阻塞 P0；FR-03 新范围的商城基座不依赖 OQ-07/08/09，漫剧第 1 期（工作台）亦不依赖 OQ-08（无真实模型调用），第 2 期起被 OQ-07 / OQ-08 阻塞。

## 8. IM 即时通讯与视频通话（已落地，2026-11-08）

### 8.1 架构概览

IM 域复用现有 Express HTTP server 的 `upgrade` 事件挂载 WebSocket，无需独立端口。实时消息与视频通话信令共用同一条 WS 连接，多媒体二进制走 media 预签名通道（WS 只传 `object_key` 引用）。

| 层 | 文件 | 职责 |
|---|---|---|
| 协议 | `services/mim-api/src/im/protocol.ts` | ClientFrame/ServerFrame 类型定义、消息内容类型（text/image/file/system）、信令帧（call.invite/offer/answer/ice/hangup） |
| 连接管理 | `services/mim-api/src/im/hub.ts` | `ImHub`：user_id → Set\<WebSocket\>，`register`/`unregister`/`broadcastToUsers`/`sendToUser`/`isOnline` |
| 数据层 | `services/mim-api/src/im/db.ts` | 会话/成员/消息 CRUD，direct 会话去重（按 sorted user_id pair 查询），已读游标 |
| WS 接入 | `services/mim-api/src/im/ws.ts` | `attachImWebSocket(server, deps)`：upgrade 鉴权 → 帧路由（message/read/typing/call.*） |
| HTTP 路由 | `services/mim-api/src/routes/im.ts` | `/im/conversations`、`/im/conversations/:id/messages`、`/im/conversations/:id/read`、`/im/users` |

### 8.2 数据库表（schema.sql 追加）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `im_conversations` | id, type[direct\|group], title, owner_user_id, avatar_object_key | 会话主表，软删除 |
| `im_conversation_members` | conversation_id, user_id, role, last_read_message_id, muted, pinned | 成员表，PK(conversation_id, user_id) |
| `im_messages` | id, conversation_id, sender_user_id, content_type, content, object_key, status[sent\|delivered\|read] | 消息表，软删除 |

### 8.3 WebSocket 协议

- **端点**：`wss://mim.mixm.top/api/v1/im/ws?token=<access_token>`
- **鉴权**：query.token 经 `verifyAccessToken` 校验；失败时完成 101 握手后发 `error` 帧（code=UNAUTHORIZED）并以 close code 1008 关闭（nginx 要求 upgrade 请求返回 101，否则回 502）
- **心跳**：客户端 25s 发 `ping`，服务端回 `pong`；10s 超时断开
- **重连**：前端指数退避 0.5s→10s

**客户端帧**（ClientFrame）：
| type | payload | 说明 |
|---|---|---|
| `ping` | — | 心跳 |
| `message.send` | { conversation_id, content_type, content?, object_key? } | 发消息，回 `ack` |
| `message.read` | { conversation_id, message_id } | 标记已读 |
| `typing` | { conversation_id } | 输入中 |
| `call.invite` / `call.offer` / `call.answer` / `call.ice` / `call.hangup` | { to_user_id, ... } | 视频通话信令，服务端透传 |

**服务端帧**（ServerFrame）：`presence`、`message.new`、`message.delivered`、`message.read`、`typing`、`ack`、`error`、`pong`、透传的 `call.*`

### 8.4 视频通话（WebRTC）

- **信令通道**：复用 WS 连接，`call.invite`→`call.offer`→`call.answer`→`call.ice`→`call.hangup`
- **媒体通道**：浏览器原生 WebRTC（RTCPeerConnection），STUN 服务器 `stun:stun.l.google.com:19302`
- **前端组件**：`apps/web/src/components/VideoCall.tsx`，浮动窗口，支持主叫/被叫、本地/远端视频流、挂断
- **TURN**：当前未配置 TURN 服务器，对称 NAT 环境下可能无法直连（待后续按需引入免费 TURN 如 OpenRelay）

### 8.5 前端实现

| 文件 | 职责 |
|---|---|
| `apps/web/src/im/socket.ts` | `ImSocket` 类：连接、自动重连、心跳、帧分发 |
| `apps/web/src/im/useImSocket.ts` | React Hook：`socket`/`connected`/`send`/`onFrame`/`onMessage`/`onCall` |
| `apps/web/src/views/Chat.tsx` | 聊天页：左侧会话列表+用户搜索，右侧消息气泡+输入框 |
| `apps/web/src/components/VideoCall.tsx` | 视频通话浮动窗口 |

WS URL 推导：host 为 `mim.mixm.top` 或 `localhost` 时同源连接；否则直连 `wss://mim.mixm.top`（Cloudflare Pages 等静态托管无法反代 WS）。

### 8.6 部署配置

- nginx `location /api/v1/im/ws`：`proxy_http_version 1.1` + `Upgrade`/`Connection: upgrade` 头 + `proxy_read_timeout 3600s`
- 后端 `index.ts`：`createServer(app)` + `attachImWebSocket(server, deps)` 替代 `app.listen`
- 依赖：`ws` + `@types/ws`

### 8.7 验证证据（2026-11-08，生产 mim.mixm.top）

- WS 无 token：101 握手 + `error(UNAUTHORIZED)` + close 1008（无 502）
- WS 非法 token：同上
- WS 合法 token：101 + `presence` + `message.send` → `ack{ok:true,message_id}`
- HTTP：`POST /im/conversations` 建会话、`GET /im/conversations/:id/messages` 拉消息均正常
- 浏览器 E2E：登录 → 聊天 → 发消息 → 消息显示，7 步全 PASS
- 后端测试：10 个 IM 测试全过；全量 163 测试全过

---

_本页为开发实现规划草案，随代码落地逐节替换为「已实现」描述；修订时必须同步 [02-modules.md](./02-modules.md)、[04-dependencies.md](./04-dependencies.md)、[README.md](./README.md) 与根 README（铁律七）。_
