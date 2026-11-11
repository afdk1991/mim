# 05 · 项目运行方式

> 仓库已是可运行的 pnpm Monorepo：`services/mim-api`（后端，8787）与 `apps/web`（Web 端，5173）构成 P0 功能产品；另有 `scripts/` 下仓库级脚本（版本校验、密钥模板校验、注释覆盖率校验、站点构建、统一入口配置清单校验、站点入口契约校验）。本页覆盖启动、测试、构建与校验的完整命令。
>
> **2026-11-09 统一入口配置清单轮**：按 45 类 DNSPod 备注去重整理为 45 个去重入口 + 19 业务域，统一可配置占位标识（不补写具体主机值）；`/sites` 视图升级为统一入口配置清单（消费 `/api/v1/entries*` 6 只读端点 + `/api/v1/sites*` 运行时端点）。启动 API 后 `npm run verify:site-modules` 离线校验 79 项、 `npm run verify:entry-manifest` 校验 19 业务用途覆盖与去重整理；`npm run verify:site-directory` 校验上一轮站点入口契约。交付说明见 [../统一入口配置清单与模块化实现说明-20261109.md](../统一入口配置清单与模块化实现说明-20261109.md)，可读清单见 [../统一入口配置清单-20261109.md](../统一入口配置清单-20261109.md)。
>
> **2026-11-12 落地状态对齐（现行口径）**：序号 02 条目移除后清单为 **44 入口 / 19 业务域 / 132 功能点 / 88 演示条目 / 116 关联 / 46 占位标识**；新增落地状态层 `packages/core-domain/src/entryImplementation.ts`，四态分布 **已落地 4 / 部分相邻 19 / 规划中 19 / 语义冲突 2**，概览与列表逐条透出。`npm run verify:site-modules` 现 **83 项**（含落地链路断言），`verify:entry-manifest` **23 项**。规划中入口不提供直达、不展示演示条目冒充真实业务。

## 1. 前置条件

| 依赖 | 必要性 | 检查命令 |
|---|---|---|
| Node.js（≥ 20，实测 v22.23.3） | **必需** | `node --version` |
| pnpm 9.12.0（`packageManager` 已锁定） | **必需**（`corepack enable` 或 `npm i -g pnpm@9.12.0`） | `pnpm --version` |
| git CLI | 可选（仅 tag 校验段需要） | `git --version` |

> **生产服务器 Node 口径（2026-11-10 实测补充）**：腾讯云 CVM 上 `services/mim-api` 的 esbuild 单文件产物（`dist/index.js` 约 6.5MB）在 **Node 22.11.0** 上启动即 `SEGV`（`status=11 / core-dump`，无任何输出），同一份产物在 Node 22.23 / 主机升级后的 **v22.20.0** 上正常。故生产机 Node 必须 ≥ 22.12，本轮实际部署在 `/opt/node22`（nodejs.org 官方 tarball 解包，软链到 `/usr/local/bin/node|npm|npx`）。另：生产主机必须先行 `systemctl restart mim-api` 前确认 `node -v`；`sharp` 已改为缩略图路由 `await import` 按需加载，不再阻塞启动。

首次使用须 `pnpm install`（安装 workspace 全部依赖；锁文件 `pnpm-lock.yaml` 已入库）。

## 2. 运行版本校验

### 基本用法（README.md §校验命令）

```bash
node scripts/version-check.mjs
RELEASE_CHANNEL=preview node scripts/version-check.mjs
```

Windows PowerShell 5.1 环境变量写法：

```powershell
$env:RELEASE_CHANNEL = 'preview'; node scripts/version-check.mjs
# 用毕清除，避免污染后续命令
Remove-Item Env:RELEASE_CHANNEL
```

### 退出码契约

| 退出码 | 含义 | CI 语义 |
|---|---|---|
| `0` | 校验通过（含「全跳过」情形） | 门禁绿 |
| `1` | 存在违规（版本格式错 / 通道非法 / 预览通道有正式 tag） | 门禁红 |

### 三种典型场景

| 场景 | 预期输出要点 | 退出码 |
|---|---|---|
| 当前仓库现状（`package.json` 版本 `0.0.0`、无正式 tag） | `✅ 版本号 0.0.0 合法（V0.0.0）` + tag 段通过 | 0 |
| `package.json` 写 `"version": "0.0.0-preview"` | ❌ 版本号不符合 semver（预发行后缀只允许走 RELEASE_CHANNEL，不进版本数字） | 1 |
| `RELEASE_CHANNEL=preview` 且仓库已有 `V0.0.0` tag | ❌ 预览通道下已存在正式 tag | 1 |

完整判定逻辑与输出样例见 [03-code-reference.md](./03-code-reference.md)。

### 运行密钥模板校验（09 清单 §0）

把 `.env.example` 与 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) §0 的密钥治理硬约束做自动比对：

```bash
node scripts/env-check.mjs
```

| 检查项 | 判定 |
|---|---|
| 模板 ↔ 清单双向对齐 | 清单登记的变量未落位到模板 → ❌；模板出现清单外变量 → ❌；由清单通配符覆盖的项 → ⚠️ |
| 空值占位 | 任一变量存在非空值 → ❌（只打印变量名，不回显值） |
| `MIM_` 前缀 | 变量名不符合 `MIM_<领域>_<提供方>_<密钥类型>` → ❌ |
| 变量重复 | 同名变量出现多次 → ❌ |
| `.gitignore` 覆盖 | `.env` 未被忽略 → ❌；缺少 `!.env.example` 反向豁免 → ⚠️ |
| 本地 `.env` | 存在则提示（仅探测存在性，绝不读取内容） |

退出码契约与版本校验一致：`0` = 通过；`1` = 存在违规。检查清单与实现细节见 [03-code-reference.md](./03-code-reference.md) §7。

## 3. 版本号操作规约（铁律四）

| 动作 | 规则 |
|---|---|
| 对外正式发布 | 首版 `V0.0.0`，此后 `V0.0.1`… 递增；发布前不得占用 |
| 内部/预览/草稿构建 | 设 `RELEASE_CHANNEL=preview/draft/test`，展示为 `V0.0.0-preview`，**不改 semver 数字** |
| 内部 git tag | 仅允许 `draft-*` / `pre-*` 前缀；`V<semver>`（大写 V）保留给正式发布 |
| 版本号落盘位置 | `package.json` 的 `version` 字段（优先）或根目录 `VERSION` 文件 |

## 4. 环境变量与密钥模板

| 项 | 说明 |
|---|---|
| 占位模板 | 根目录 `.env.example`（138 个 `MIM_*` 空值变量，按领域分组，含北斗专项） |
| 本地使用 | 复制为 `.env` 后按需填写；根目录 `.gitignore` 已忽略 `.env`，禁止提交 |
| 生产使用 | CI Secret / 云 KMS / Secret Manager，不落盘、不入库 |
| 清单来源 | [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)（变量名与提供方一一对应） |
| 核对方式 | `node scripts/env-check.mjs` 自动校验（见 §2「运行密钥模板校验」），失败即退出码 1 |
| 成片导出转码（可选，2026-11-08） | `MIM_FFMPEG_PATH` 已在 `.env.example` / 09 清单登记，留空为**默认安全态**：`POST /api/v1/comic/films/:id/export` 对 MP4 / 1080p 直接签发原片预签名下载地址（1 小时有效，无需 ffmpeg）；请求 MOV 或 720p 时返回 403 `FEATURE_NOT_AVAILABLE` 并回显 `details.requested`，前端展示本地化提示与「直接下载原片」一键降级。需启用转码时在生产 `mim-api.env` 写入 ffmpeg 可执行文件绝对路径（服务器须已安装 ffmpeg + libx264），无需重启前端 |
| 第三方登录（2026-11-12） | 每家 provider 两个必填变量（`MIM_AUTH_<ID>_CLIENT_ID` / `_CLIENT_SECRET`，Apple 为 `SERVICE_ID` + `TEAM_ID` + `KEY_ID` + `PRIVATE_KEY`，微信 `WECHAT_APP_ID` / `_APP_SECRET`，QQ `QQ_APP_ID` / `_APP_KEY`，抖音 `DOUYIN_CLIENT_KEY` / `_CLIENT_SECRET`）；公共变量 `MIM_OAUTH_CALLBACK_BASE`（后端对外基址，默认取请求的 `x-forwarded-proto` + `host`）与 `MIM_WEB_BASE_URL`（回调 302 的前端基址）；每家可选覆盖 `MIM_AUTH_<ID>_REDIRECT_URI` / `_AUTHORIZE_URL` / `_TOKEN_URL` / `_PROFILE_URL` / `_JWKS_URL`。**缺任一家凭证时该家 `configured=false`：前端按钮置灰并标注「未配置」，`POST /auth/oauth/:provider/authorize` 返回 503 `AUTH_OAUTH_NOT_CONFIGURED`，不会静默降级**。`GET /auth/oauth/providers` 可随时查看 9 家的配置状态 |

### 4.1 第三方登录回调登记（平台侧，2026-11-12）

部署到生产（或本地联调）后，需在各开放平台控制台登记下列回调 URL，形如 `${MIM_OAUTH_CALLBACK_BASE}/api/v1/auth/oauth/<provider>/callback`。默认生产基址为 `https://mim.mixm.top`：

| Provider | 登记的回调 URL | 备注 |
|---|---|---|
| GitHub | `https://mim.mixm.top/api/v1/auth/oauth/github/callback` | OAuth App 的 Authorization callback URL，一个 App 只允许一个 |
| Gitee | `https://mim.mixm.top/api/v1/auth/oauth/gitee/callback` | 第三方应用「回调地址」 |
| GitLab | `https://mim.mixm.top/api/v1/auth/oauth/gitlab/callback` | 自建实例用 `MIM_AUTH_GITLAB_AUTHORIZE_URL` / `_TOKEN_URL` / `_PROFILE_URL` 覆盖域 |
| Google | `https://mim.mixm.top/api/v1/auth/oauth/google/callback` | Authorized redirect URI，需与 `MIM_AUTH_GOOGLE_REDIRECT_URI` 完全一致 |
| Microsoft | `https://mim.mixm.top/api/v1/auth/oauth/microsoft/callback` | Web 平台 Redirect URI（单页应用类型不适用于本流程） |
| Apple | `https://mim.mixm.top/api/v1/auth/oauth/apple/callback` | Service ID 的 Return URL 必须为 HTTPS 且不含端口；域名需先在 Apple 侧验证 |
| 微信 | `https://mim.mixm.top/api/v1/auth/oauth/wechat/callback` | 网站应用「授权回调域」只填域名，不带协议与路径 |
| QQ | `https://mim.mixm.top/api/v1/auth/oauth/qq/callback` | 需与 `MIM_AUTH_QQ_REDIRECT_URI` 完全一致 |
| 抖音 | `https://mim.mixm.top/api/v1/auth/oauth/douyin/callback` | 网站应用「授权回调地址」需精确匹配，含协议 |

- 本地联调把 `MIM_OAUTH_CALLBACK_BASE` 设为 `http://127.0.0.1:8787`（契约测试即用此口径 + 端点覆盖启动假提供方，不外连）；`MIM_WEB_BASE_URL` 设为 `http://127.0.0.1:5173`，回调后 302 回前端 `/signin?oauth_ticket=...`。
- 生产必须 HTTPS：`oauth4webapi` 对非 HTTPS 令牌端点默认拒绝，代码仅在 `NODE_ENV !== 'production'` 且令牌地址为 `http://` 时放开 `allowInsecureRequests`，生产不存在该旁路。
- 排障顺序：`GET /auth/oauth/providers` 看 `configured` → 平台侧回调 URL 是否与上表逐字一致 → 服务端日志中 `AUTH_OAUTH_STATE_INVALID`（state 过期/被重放）或 `AUTH_OAUTH_EXCHANGE_FAILED`（令牌交换失败）。

## 5. 查看产品规划文档

| 文档 | 打开方式 |
|---|---|
| `Mim-PRD.html` | 浏览器直接打开（自包含、零依赖，仅含 FR-01 登录交互演示） |
| `team-hiring-plan.md`、两份调研 txt | 任意 Markdown/文本编辑器 |

## 6. 启动功能应用（P0）

### 6.1 一键命令

```bash
pnpm install                       # 首次
pnpm --filter @mim/api dev         # 后端（tsx watch），http://127.0.0.1:8787
pnpm --filter @mim/web dev         # 用户端（Vite），http://127.0.0.1:5173
pnpm --filter @mim/admin dev       # 管理后台（Vite），http://127.0.0.1:5174/admin/
```

用户端与后台的 Vite 均把 `/api` 与 `/health` 代理到 `http://127.0.0.1:8787`，因此浏览器只需访问 5173 / 5174，无需配置跨域。后台独立应用以 `base: './'` 构建，生产由 nginx 的 `/admin/` location 指向 `/opt/mim/admin`。

### 6.2 质量门禁命令

```bash
pnpm -r typecheck                       # 5 of 6 workspace 项目类型检查（@mim/admin 已纳入）
pnpm --filter @mim/api test             # vitest + supertest，25 个测试文件 372 例全通过（2026-11-12 复核）
pnpm --filter @mim/web build            # 用户端 tsc --noEmit + vite build
pnpm --filter @mim/admin build          # 管理后台 tsc --noEmit + vite build（产物 dist/ 发布到 /opt/mim/admin）
npm run check                           # 版本规约 + 密钥模板校验 + 注释覆盖率门禁（CI 以 --strict 执行）
```

**聊天点击级 E2E（Edge CDP，两个脚本可重放）**：先起三件套 —— `MIM_JOBS=0 MIM_AI_WORKER=0 node services/mim-api/dist/index.js`（API :8787）、`node scripts/serve-local.mjs`（静态站 :5188，同源反代 `/api`）、`msedge --headless=new --remote-debugging-port=9222 --user-data-dir=<绝对路径>/.tmp/edge-profile-chat about:blank`；再跑 `npm run verify:chat-flow`（15 项）与 `npm run verify:chat-plus`（23 项，引用回复 / 文件下载直链 / 设管理员 / 邀请入群 / 搜索定位高亮），取证落 `.tmp/chat-flow-e2e.json`、`.tmp/chat-plus-e2e.json` 与同名 `.png`。
> **踩坑**：本地 E2E 前必须确认 `apps/web/dist` 是**同源构建**（`$env:VITE_API_ORIGIN=''; pnpm --filter @mim/web build`）。若产物带 `VITE_API_ORIGIN=https://mim.mixm.top`，页面会把请求打到生产 API，本地 token 不被识别 → 会话列表空、用户搜索空，`verify-chat-flow` 会连锁 FAIL 6 项。

### 6.3 数据结构与运行形态

| 项 | 实况 |
|---|---|
| 数据库 | SQLite（`better-sqlite3`，WAL），首次启动自动建表；测试使用内存库 |
| 端口 | API `8787`（读标准环境变量 `PORT`，默认 8787）；Web `5173` |
| 环境变量 | `.env.example` 登记第三方密钥占位（P0 无真实密钥需求）；应用自有 `MIM_JWT_SECRET`（生产必配）、`MIM_AUTH_ADMIN_PASSWORD`（生产密码登录口令）与 `MIM_ADMIN_TOKEN`（RBAC 超管引导令牌），三者均由 `deploy/deploy.sh` §5 幂等写入 `/opt/mim/mim-api.env`。`MIM_ADMIN_TOKEN` 缺失时 `/api/v1/admin/*` 与 catalog 管理写路由返回 403 `FEATURE_NOT_AVAILABLE 'admin API is not enabled'`，独立后台 `/admin/` 只能打开静态页无法写操作；配置后 `x-admin-token` 通道视同拥有全量权限（bootstrap），用于「第一个超管从哪来」的冷启动 |
| 验证码 | 开发/测试环境未配置通道时在响应中回传 `dev_code`；**生产环境（`NODE_ENV=production`）强制走第三方通道，不回传 `dev_code`**。通道已支持：国内手机号 → 阿里云短信（`@alicloud/dysmsapi20170525`，需 `MIM_SMS_ALIYUN_ACCESS_KEY_ID` / `MIM_SMS_ALIYUN_ACCESS_KEY_SECRET` / `MIM_SMS_ALIYUN_SIGN_NAME` / `MIM_SMS_ALIYUN_TEMPLATE_CODE` 四项齐备），海外邮箱 → AWS SES（`@aws-sdk/client-ses`，需 `MIM_EMAIL_SES_ACCESS_KEY_ID` / `MIM_EMAIL_SES_SECRET_ACCESS_KEY` / `MIM_EMAIL_SES_FROM_ADDRESS`，`MIM_EMAIL_SES_REGION` 缺省回退 us-east-1）。通道未配置时合法请求返回 503 `AUTH_CHANNEL_NOT_CONFIGURED`；供应商发送失败返回 502 `AUTH_CODE_DELIVERY_FAILED` |
| 生产登录入口 | 三条入口并存，前端登录页按 `GET /api/v1/auth/channels` 自动选择可用项：① **自助注册 + 账号口令**——`POST /api/v1/auth/register`（`{region,identifier,password,display_name?}`，口令 ≥8 位且含字母与数字，bcrypt 存 `credentials(kind='password')`）创建账号并直接登录，重复注册 409 `AUTH_IDENTITY_EXISTS`；② **管理员口令**——`POST /api/v1/auth/password`（`{region,identifier,password}`，口令取自 `MIM_AUTH_ADMIN_PASSWORD`）；③ **验证码**——需先注入短信/邮件通道凭证。`/auth/password` 先比管理员口令、再比账号自身口令，两者都未配置返回 503 `AUTH_PASSWORD_NOT_CONFIGURED`，口令错误 401 `AUTH_PASSWORD_INVALID`，连续失败 5 次锁定 15 分钟（423 `AUTH_ACCOUNT_LOCKED`）。前端默认「密码登录」，注册为登录页第三个分段。 |
| 前端视图 | 仅「设置」一页。重定义后：`catalog` 域 4 表 + `comic` 域 **7 表**（第 1 期 3 表 + 第 2 期 `generation_jobs`/`generation_assets`/`comic_films`/`film_versions` 4 表）已建、`/api/v1/comic/*` 24 条路由已上线（第 1 期 8 条 + 第 2 期任务编排与成片 16 条，拆分见 `docs/wiki/07-functional-modules.md` §12）；第 2 期**已装配上线（2026-11-05）**：`app.ts` 已 import 并挂载 `/api/v1/media/*`（`createMediaRouter` + 免鉴权对象收发 `createMediaObjectRouter`，后者先于全局 `express.json`）与 `/api/v1/ai/*`（`createAiRouter`），`index.ts` 构造 `storage` + `orchestrator` 并在 `MIM_AI_WORKER` 默认开启时 `orchestrator.start()` 自动消费 `generation_jobs`；商城与漫剧前端视图已上线。**免登录体验（2026-11-08 起按需登录，2026-11-12 演进为访客会话模型；「设置」并入个人中心、漫剧放映厅匿名可看）**：前端启动时本地无会话即自动领取匿名访客会话（`POST /api/v1/auth/guest`，`is_guest=1`、自动分配 Mim ID、签发 access/refresh 双令牌），此后全站按可用路径渲染；商城目录 `/marketplace`、入口配置清单、部署汇总匿名可浏览；`/comic-studio` 默认进「放映厅」分段，匿名可直接播放内置演示片库（`GET /api/v1/comic/showcase`），创作工作台分段在模块内引导登录；`/products`、`/cart`、`/account` 由访客会话直接驱动，离线或建号失败时才显示重试免登录会话的降级入口；`/chat` 匿名态为只读演示页；`/account` 导航入口对访客同样可见。原独立 `/settings` 视图已删除，账号资料 / 语言时区 / 区域信息 / 注销操作全部并入 `/account` 的「账号与设置」分区，旧 `/settings` 链接由 `LEGACY_SEGMENTS` 落到 `/account`。`/signin` 仅用于把访客升级为正式账号；退出、`/me` 启动校验发现令牌失效（refresh 续期失败）或跨标签页退出时回落访客态。前端路由为 history 路径路由（`/store` 等单段路径，`vite base './'` 兼容），旧 `#/xxx` 链接启动时自动改写。`apps/web/src/api.ts` 提供会话结构校验、`SESSION_CHANGED_EVENT` 广播与 `/me` 静默校验；`site/*.html` 与 `Mim-PRD.html` 为公开产品文档页，不含门禁；独立管理后台 `apps/admin` 原本即为「无凭证只渲染登录页」的全站门禁，无需改动。后端业务接口（`/me`、`/comic/*`、`/ai/*`、`/media/*`、`/im/*`、`/entitlements`、`/admin/*`）原本即 requireAuth；仅 `GET /modules` 系列为不含用户数据的公开只读静态元数据，保持原契约不变 |
| 模块解锁 | **商城模块目录（2026-11-10 两级分类改造后）**：`module_categories` 表存 19 个一级分类 + 205 个二级条目；二级条目一律生成一个功能模块（编码 `cat.<一级slug>-<两位序号>`，`sort_order = 一级序×100 + 二级序`，`license` / `language` / `stars` 随组默认值落库，定价全免费、无前置依赖），与 8 个存量模块（`comic.workbench`、`comic.genpack.basic/pro/team`、`ai.dubbing`、`ai.script`、`media.storage`、`template.pack`，由 `LEGACY_META` 归入 `ai-01` / `ai-06` / `ai-07` / `server-12` / `tools-03` 并保持原付费价与依赖链）共同随 `createDatabase()` 幂等 upsert 写入 cn/global 两区；`requireEntitlement('comic.workbench')` 无权益返回 **403 `FEATURE_NOT_AVAILABLE`**，`details` 含 `module_code`、`region` |
| **现行覆盖：免登录体验（2026-11-12 起取代按需登录）** | 全站不再有「此功能需登录后使用」。前端启动时若本地无会话，自动调用 `POST /api/v1/auth/guest` 领取匿名访客会话（`users.is_guest=1`，同样自动分配 Mim ID、同样签发 access/refresh 双令牌）；此后 `/marketplace`、`/products`、`/cart`、`/account`、`/entry-catalog`、`/deployments`、`/comic-studio`（放映厅 + 创作工作台）、`/chat` 全部直接可用，加购 / 下单 / 解锁 / 订单 / 聊天收发 / 漫剧创作均按已登录路径工作，数据归属该访客账号。`/signin` 只用于把访客升级为正式账号（密码 / 验证码 / 自助注册 / 9 家第三方），退出登录后重新加载页面又会自动回到免登录可用态；`/account` 导航常驻。访客建号按 IP 限流（30 次/小时，超限 429 `AUTH_GUEST_RATE_LIMITED`）。上表第 157 行的「按需登录 / 内嵌登录卡片 / 只读演示」口径为历史留痕，按铁律三保留，不再作为现状引用。独立管理后台 `/admin/` 仍保持「无凭证只渲染登录页」的门禁 |
| 授权命令 | **首选管理后台（2026-11-08 起）**：`/admin/` →「权益管理」页按用户 ID + 模块 code 发放 / 回收，回收与事件审计（`GET /entitlements/:id/events`）同页可查；模块上架 / 调价走「功能模块」页（`POST /modules`、`PATCH /modules/:code/status`、`POST /modules/:code/prices` 等，需 `module:write`）。应急手工 SQL（不推荐，绕过事件审计）：`sqlite3 /opt/mim/app/services/mim-api/data/mim.db "INSERT INTO entitlements (id,user_id,module_id,source,source_id,status,version,created_at,updated_at) VALUES ('ent:<uid>:comic','<uid>',(SELECT id FROM modules WHERE code='comic.workbench' AND region='cn'),'admin',NULL,'active',1,datetime('now'),datetime('now'));"` |

### 6.4 冒烟顺序（HTTP 全链路）

生产冒烟顺序：`auth/password → me → comic/projects`（验证码 `auth/code` 在生产必回 503，仅开发/测试环境用 `auth/code → auth/login`）。

漫剧工作台（第 1 期）：

`GET /api/v1/comic/projects`（无权益 → 403 `FEATURE_NOT_AVAILABLE`）→ 授予 `comic.workbench` 权益 →
`POST /api/v1/comic/projects`（带 `Idempotency-Key`）→ `POST /api/v1/comic/projects/:id/characters` →
`POST /api/v1/comic/projects/:id/storyboard`（`confirm:true`，工程转 `storyboarded`）→ `GET /api/v1/comic/projects/:id` → `POST /api/v1/comic/projects/:id/suggest`

漫剧工作台（第 2 期骨架：任务编排 + 成片合成）：

`POST /api/v1/comic/projects/:id/jobs`（`job_type:"compose"`，工程转 `generating`）→ `POST /api/v1/comic/jobs/:id/start` →
`POST /api/v1/comic/jobs/:id/complete`（compose 成功，工程转 `rendered`）→ `POST /api/v1/comic/projects/:id/films`（建 `draft` 成片 + v1）→
`POST /api/v1/comic/films/:id/submit-review`（最新版本须带 `object_key`）→ `POST /api/v1/comic/films/:id/publish`（工程转 `published`）；
失败链路：`POST /api/v1/comic/jobs/:id/fail` → `POST /api/v1/comic/jobs/:id/retry`（新建 job，`retry_of` 指向原 job）

商城模块目录（公开只读，**免鉴权**）：

`GET /api/v1/taxonomy`（200，`groups` 19 个一级分类、`total_items` 205、`total_modules` 为 active 模块总数）→
`GET /api/v1/modules`（200，默认 `sort=recommended`、`pageSize=20`，返回 `total / page / page_size / total_pages`）→
`GET /api/v1/modules?category=store`（200，一级前缀命中 9 条）→ `GET /api/v1/modules?category=store-03`（200，二级精确命中 1 条）→
`GET /api/v1/modules?sort=stars&licenses=MIT,Apache-2.0&languages=PHP`（200）→ `GET /api/v1/modules?sort=hot`（必须 400 `VALIDATION_FAILED`）→
`GET /api/v1/modules?q=comic`（200，搜索生效）→
`GET /api/v1/modules/hot`（200，默认 `range=today`、`window_hours=24`、`items` ≤5 且 `hotness` 降序）、`GET /api/v1/modules/hot?range=week`（200，`window_hours=168`）、`GET /api/v1/modules/hot?category=store&limit=20`（200，`total` 9 且全部归属 `store-` 前缀）、`GET /api/v1/modules/hot?range=month`（必须 400 `VALIDATION_FAILED`）→
`GET /api/v1/modules/comic.workbench`（200，含 `price_history` / `requires` / `current_price` / `category_slug` / `license` / `language` / `stars`）→
`GET /api/v1/modules/unknown-code`（必须 404）

## 7. 生产部署（铁律八）

> **生产环境已上线**：`https://mim.mixm.top`（前端 `apps/web` + 后端 `services/mim-api` + SQLite 持久化数据库）。本地预览不是交付终点。

### 7.1 自动部署（默认路径）

push 到 `main` 即触发 `.github/workflows/deploy.yml`：

```
verify:  pnpm install --frozen-lockfile → pnpm -r typecheck → @mim/api test
         → @mim/web build → @mim/admin build → comment-check --strict
deploy:  scp deploy/deploy.sh → ssh ubuntu@<host> "sudo -n bash /opt/mim/app/deploy/deploy.sh $GITHUB_SHA"
         → 脚本 reset --hard 到该 SHA（而非 origin/main，避免连续 push 时先跑的 Run 部署到后推的提交）
         → 安装 deploy/nginx-mim.conf 到 /etc/nginx/sites-available/mim.conf
           → nginx -t → certbot 重注 TLS（--keep-until-expiring）→ reload
           → 断言本机 curl -k --resolve <域名>:443:127.0.0.1 https://<域名>/admin/ 含 noindex
             （不用 http://127.0.0.1/admin 的 301 判定：certbot --redirect 的 80 端口跳转块恒 301，属假阳性）
         → 校验服务器 HEAD == 本次提交 SHA（不一致即失败）
         → curl https://mim.mixm.top/health（必须 200，最多重试 10 次）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/admin（必须 301）
         → curl https://mim.mixm.top/admin/（必须含 noindex 与 assets/index-*，否则落回用户端页面）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/api/v1/plans（必须 404）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/api/v1/audit/logs（必须 404）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/api/v1/modules（必须 200）
         → curl -o /dev/null -w '%{http_code}' https://mim.mixm.top/health（必须 200）
         → curl -X POST -H 'Content-Type: application/json' -d '{}'
           https://mim.mixm.top/api/v1/auth/code（空体必须 400）
         → curl -X POST -H 'Content-Type: application/json' --data-binary '{"region":'
           https://mim.mixm.top/api/v1/auth/code（非法 JSON 必须 400，不得回 500）
```

生产安全开关与登录入口（CI 不跑，需合法请求体）：

- `POST /api/v1/auth/code` 传 `{"region":"cn","provider":"phone","identifier":"13800000000"}`：通道未配置应返回 503 `AUTH_CHANNEL_NOT_CONFIGURED`；已配置阿里云短信后返回 201 `delivery:"phone"` 且响应无 `dev_code`（真实短信下发，供应商失败返回 502 `AUTH_CODE_DELIVERY_FAILED`）。任何情况下不得回 200 带 `dev_code` 或 500。
- `POST /api/v1/auth/password` 传 `{"region":"cn","identifier":"13800000000","password":"<MIM_AUTH_ADMIN_PASSWORD>"}` 应返回 200 并带 `access_token` / `refresh_token` / `user`；口令错误应 401 `AUTH_PASSWORD_INVALID`。生产口令由 `deploy/deploy.sh` §5 幂等写入 `/opt/mim/mim-api.env`（chmod 600）：优先保留已有值，其次采用 CI Secret 同名变量，两者皆无则现场 `openssl rand` 生成随机值且不回显日志；**不再存在公开默认口令**，运维须从服务器 env 文件读取。
- `GET /api/v1/auth/channels` 应返回 200 且仅含 `{"sms":...,"email":...,"password":...,"register":true}` 四个布尔值；不得回 404（旧构建的特征）或泄露凭证内容。
- `POST /api/v1/auth/register` 传 `{"region":"cn","identifier":"<未注册手机号>","password":"<≥8 位字母+数字>"}` 应返回 201 且带 `access_token` / `refresh_token` / `user`；同标识再次提交应 409 `AUTH_IDENTITY_EXISTS`；纯字母口令应 400 `VALIDATION_FAILED` 且 `details.field='password'`。注册后用同一账号口令走 `POST /api/v1/auth/password` 应 200（证明注册与登录口令闭环）。
- `/chat` 匿名访问应直接渲染可收发消息的真实聊天（启动时已自动领取访客会话，`localStorage` 的 `mim.session.v1` 中 `user.is_guest=true`），不再出现「只读演示」或「此功能需登录后使用」；`/products`、`/cart`、`/account`、`/comic-studio` 工作台同理免登录可用，侧栏显示「访客 · 免登录」与「登录 / 注册正式账号」。

所需 GitHub Actions secrets：`DEPLOY_SSH_KEY`（部署私钥）、`DEPLOY_HOST`、`DEPLOY_USER`；可选通道 secrets（配置后由 `deploy.yml` 经 `sudo env` 透传写入 `mim-api.env`，即配即生效）：`MIM_SMS_ALIYUN_ACCESS_KEY_ID` / `MIM_SMS_ALIYUN_ACCESS_KEY_SECRET` / `MIM_SMS_ALIYUN_SIGN_NAME` / `MIM_SMS_ALIYUN_TEMPLATE_CODE`（阿里云短信）、`MIM_EMAIL_SES_ACCESS_KEY_ID` / `MIM_EMAIL_SES_SECRET_ACCESS_KEY` / `MIM_EMAIL_SES_REGION` / `MIM_EMAIL_SES_FROM_ADDRESS`（AWS SES）。

```bash
gh secret set DEPLOY_SSH_KEY --body "$(cat ~/.ssh/mim_deploy)"
gh secret set DEPLOY_HOST --body "115.159.159.11"
gh secret set DEPLOY_USER --body "ubuntu"
gh run watch          # 观察最近一次运行
```

### 7.1.2 多平台同步（GitHub Pages / Packages / 托管平台）

同一次 push 还会并行触发 3 个 job（均 `needs: verify`，失败不影响自建服务器发布）：

| job | 做什么 | 需要的 secret | 缺失时行为 |
|---|---|---|---|
| `pages` | `pnpm --filter @mim/web build`（注入 `VITE_API_ORIGIN=https://mim.mixm.top`）→ `upload-pages-artifact` → `deploy-pages` | 无（用 `GITHUB_TOKEN` + `pages: write` / `id-token: write`） | 直接发布 `https://afdk1991.github.io/mim/` |
| `packages` | `docker/build-push-action` 推 `ghcr.io/afdk1991/mim-api:latest` 与 `:${GITHUB_SHA}` | 无（`GITHUB_TOKEN` + `packages: write`） | 直接推送；镜像供 Sealos 等容器平台复用 |
| `platforms` | Cloudflare / Vercel / Sealos / IGA 依次同步 | 见下表 | 每个 step `[ -z "$TOKEN" ] && exit 0`，打印 SKIP |

| 平台 | 配置文件 | secret |
|---|---|---|
| Cloudflare Pages | `wrangler.toml` + `functions/api/[[path]].js`（/api 反代）+ `functions/[[catchall]].js`（SPA 深链接回退） | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |
| Vercel | `vercel.json` | `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` |
| Sealos | `deploy/sealos/mim.yaml` | `SEALOS_KUBECONFIG`、`SEALOS_DOMAIN`、`SEALOS_NAMESPACE`、`MIM_JWT_SECRET` |
| IGA Pages | `deploy/iga/deploy.sh`（`iga login` + `iga pages deploy --name`） | `IGA_ACCESS_KEY`、`IGA_SECRET_KEY`、`IGA_PROJECT_NAME`（可选 `IGA_SCOPE`，默认 `domestic`） |

**SPA 深链接回退四件套（2026-11-08 定性；2026-11-11 路径段改为模块功能名称后回退载体不变）**：前端 history 路径路由的对外路径段为 `/marketplace` `/products` `/cart` `/account` `/entry-catalog` `/deployments` `/comic-studio` `/chat` `/signin`（旧段 `/store` `/sites` `/comic` `/login` `/settings` `/profile` 由前端 `LEGACY_SEGMENTS` 与生产 nginx 301 改写，其中 `/settings` 落到 `/account`），各平台回退载体分工如下——

| 平台 | 回退载体 | 行为 |
|---|---|---|
| 腾讯云自建服务器 | nginx `try_files $uri $uri/ /index.html` + 四条旧段 `location = … { return 301 …; }` | 深链接 200 重写 index.html（2026-11-08 五条深链接实测全 200 / LEN=5182；2026-11-11 起旧段先 301 到新段） |
| Cloudflare Pages | `functions/[[catchall]].js` catch-all | **Pages 挂载 Functions 后 `_redirects` 被整体旁路**；函数只对「GET + 静态资源未命中返回 404 + 非 `/api/` 前缀 + `Accept` 含 `text/html`」的请求 200 重写 index.html |
| GitHub Pages | `dist/404.html`（`index.html` 逐字节副本，`scripts/spa-404.mjs` 生成） | 深链接返回 **404 状态 + SPA 全文**，浏览器加载后 router 读 `location.pathname` 渲染，404 状态码属平台能力上限的预期设计；响应体长度与首页相同，不能以长度区分命中，只能看状态码 |
| EdgeOne Pages | 构建期生成的 `dist/404.html` + `dist/<模块功能名>/index.html`（路径段清单从 `router.ts` 的 `VIEW_SEGMENTS` 解析，`scripts/build.mjs` 的 `emitSpaFallback()` 产出） | **`_redirects` 在该平台不可靠且可能触发平台层报错**（2026-11-11 实测：深链接返回 HTTP 545 + 24 字节 `Error return from script`）；改为让每个路径段命中真实静态目录，2026-11-11 前实测 `/store` `/chat` `/comic` `/settings` `/login` 全部正常渲染，改名后由同名目录 `marketplace/` `comic-studio/` 等承接。`functions/[[catchall]].js` 已加运行时能力守卫，被该平台挂载时返回 404 而不再抛错 |

> **CF 深链接 curl 取证口径**：裸 curl 默认发 `Accept: */*`（不含 `text/html`），catch-all Function 按设计跳过回退、返回 404——**这不代表回归**。测 CF 深链接必须带浏览器式 Accept 头：`curl -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"`，预期 200 / LEN=5182（CI run 42412711936 部署后五条深链接实测全部 200）。

**当前实况（2026-11-06）**：

| 平台 | 状态 | 取证 / 阻塞原因 |
|---|---|---|
| IGA Pages | ✅ 已部署 | `iga login`（本机 SSO）→ `iga pages deploy --name mim --scope domestic` → Project ID `fr95fuwu57`、Deploy `p4f5a4svqm`；preview 域名为 token 门禁（307 下发 `iga_token` Cookie 后可达），`curl -c/-b` 带 Cookie 实测 200 / 476 字节；自有域名需控制台绑定（domestic scope 需 ICP 备案） |

> IGA 脚本支持「本机 SSO 登录态复用」：CI 用 AK/SK，本机执行前只需 `iga login`，脚本内以 `whoami` 探测登录态；CLI 由脚本在缺省时自装（`@iga-pages/cli`），首建应用后把项目名写入 secret 即可自动发布。

```bash
# 一次性注入（有凭证时）
gh secret set CLOUDFLARE_API_TOKEN --body "<token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account id>"
gh secret set VERCEL_TOKEN --body "<token>"
gh secret set SEALOS_KUBECONFIG --body "$(cat ~/.kube/config)"
gh secret set SEALOS_DOMAIN --body "mim-<ns>.cloud.sealos.io"
gh secret set SEALOS_NAMESPACE --body "ns-<xxxx>"
gh secret set MIM_JWT_SECRET --body "<64 位 hex>"
gh secret set IGA_ACCESS_KEY --body "<volcengine ak>"
gh secret set IGA_SECRET_KEY --body "<volcengine sk>"
gh secret set IGA_PROJECT_NAME --body "mim"
```

托管平台以独立域名访问时，**商城是否可见取决于前端如何请求 `/api/v1/modules`**，需按平台区分配置：

| 平台 | 前端 API 源 | 是否需要 `MIM_CORS_ORIGINS` | 说明 |
|---|---|---|---|
| 自建 `mim.mixm.top` | 同源（nginx 反代 `/api/`） | 否 | 不挂 CORS 中间件 |
| GitHub Pages `afdk1991.github.io` | 构建期注入 `VITE_API_ORIGIN=https://mim.mixm.top`（跨域直连） | **是** | 必须含 `https://afdk1991.github.io`（含 `/mim` 子路径同源） |
| Cloudflare Pages `mim-299.pages.dev`（项目名 `mim`；旧 `mim-8ah` 保留回滚） | 相对 `/api`（同源） | 否 | `functions/api/[[path]].js` 已同源反代到 `mixm.top` |
| Vercel（项目名 `mim`，域名 `mim-puce.vercel.app`） | 相对 `/api`（同源） | 否 | `vercel.json` `rewrites` 已同源反代 |
| IGA Pages | 取决于其部署脚本 | 若直连则**是** | 见 `deploy/iga/deploy.sh`；若反代同源则无需 |
| Sealos `mim-i3ywsdfn.cloud.sealos.io` | — | — | **纯 API 容器，不托管 Web SPA**，`/store` 返回 JSON 404 属预期，非缺陷 |

> 配置要点：`MIM_CORS_ORIGINS` 缺配时后端**完全不挂 CORS 中间件**，跨域直连的镜像站（如 GitHub Pages）浏览器会拦截 `/api/v1/modules` → 商城整页报错/空白。
> `deploy/deploy.sh` 已幂等补齐 `https://afdk1991.github.io,https://mim.mixm.top,https://data.mixm.top`；其余镜像源（IGA 等）须按需追加。

容器镜像说明：本机与 CI 均不使用 `pnpm deploy`（pnpm 9.12 实测报 `Unknown option: 'legacy'` 且目标路径拼接异常），
`Dockerfile` 运行阶段直接搬运 pnpm 相对符号链接依赖树（builder 与 runtime 的 `WORKDIR` 同为 `/app`）。

### 7.1.3 多平台实测汇总（2026-11-07 01:48:24 +08:00，本机中国网络，commit `7e4e3e9`，历史快照）

> **最新取证（2026-11-08 18:14:17 +08:00，本机中国网络 curl，HEAD `3271204`，成片导出交付轮、CI run 42470091995 五作业全绿）**：自建 `/health` 200 / 0.061s / LEN=53、首页 200 / 0.064s / LEN=5182（新产物 `index-D2UkZqM1.js`，与本地同源构建一致，证明本轮前端已上线）、五条深链接 `/store` `/comic` `/chat` `/settings` `/login` 全 200 / LEN=5182（0.066–0.079s，nginx `try_files` 生效）、`/admin/` 200 / 0.069s / LEN=1430、`/api/v1/modules` 200 / 0.076s / LEN=438、`/api/v1/site/overview` 404 / LEN=126（`NOT_FOUND`）、导出路由匿名探测 401 `AUTH_UNAUTHORIZED`（非 404，路由在线）；GitHub Pages `/mim/` 200 / 0.867s / LEN=5182（`index-COy8rstl.js`，根构建注入 API 源），深链接 `/mim/store` 404 / 0.370s / LEN=5182（`404.html` 副本预期设计）；Cloudflare Pages 首页 200 / 1.384s / LEN=5182（与自建同指纹），带 `Accept: text/html` 头 `/store` 200 / 0.931s、`/comic` 200 / 0.842s、`/login` 200 / 1.526s 全 LEN=5182，裸 curl `/store` 404 / 0.791s 属 catch-all Function 按设计只重写 html 导航；Sealos `/health` 200 / 0.718s / LEN=53；EdgeOne 200 / 0.075s / LEN=985 仍为 WAF 挑战页（`EO_Bot_Ssid` / `_0x649a`）；ghcr 401 / 1.087s / LEN=73 正常；Vercel 本机 000 / 0.183s（exit 35，schannel TLS 握手失败，CI 平台同步作业 success 替代取证）、github.com 本机 HTTPS 阻断（`git ls-remote` 替代取证远端 main = `3271204`）。**生产 Edge CDP E2E 8/8**（商城匿名搜索 comic → 1 个结果 → 详情面板、新 bundle、`/comic` 匿名内嵌登录卡片、console 零错误）与**本地成片导出 E2E 14/14**（登录→造真实成片→导出面板→转码降级→原片直下→下载链接）见 [AGENTS.md 铁律九表格](../../AGENTS.md) 与 [08 §1.2](./08-dev-implementation.md)。**本节 01:48 表格、05:05 与 17:42 段落为历史留痕，不代表当前运行状态。**

> **历史留痕：最新取证（2026-11-08 17:42:36 +08:00，本机中国网络 curl，HEAD `1b3072e`，可访问性复测轮、无新功能部署）**：自建 `/health` 200 / 0.074s / 0.035s / LEN=53、首页 200 / 0.075s / LEN=5182（`index-ChbzA5PZ.js`）、五条深链接 `/store` `/comic` `/chat` `/settings` `/login` 全 200 / LEN=5182（0.053–0.064s，nginx `try_files` 生效）、`/admin/` 200 / 0.093s / LEN=1430、`/api/v1/modules` 200 / 0.066s / LEN=438、`/api/v1/site/overview` 404 / LEN=126（`NOT_FOUND`）；GitHub Pages `/mim/` 200 / 0.402s / LEN=5182（`index-Mq2I8smM.js`），深链接 `/mim/store` 404 / 1.008s / LEN=5182（`404.html` 副本预期设计）；Cloudflare Pages 首页 200 / 2.401s / LEN=5182（与自建同指纹），带 `Accept: text/html` 头深链接 `/store` 200 / 0.982s、`/comic` 200 / 0.749s、`/login` 200 / 0.948s 全 LEN=5182，裸 curl `/store` 404 / 0.562s 属 catch-all Function 按设计只重写 html 导航；Sealos `/health` 200 / 0.366s / 0.196s / LEN=53；EdgeOne 200 / 0.090s / LEN=985 仍为 WAF 挑战页（`EO_Bot_Ssid` / `_0x649a`）；ghcr 401 / 0.537s / LEN=73 正常；Vercel 本机 000 / 21.276s（exit 28，DNS 污染）、github.com 本机 000 / 0.015s（exit 35，TLS 阻断，TCP 0.007s 可连），`git ls-remote` 替代取证远端 main = `1b3072e`，与本地 0 ahead / 0 behind。**本节 01:48 表格及下方 05:05 段落为历史留痕，不代表当前运行状态；最新逐平台明细见 [AGENTS.md 铁律九表格](../../AGENTS.md)。**

> **历史留痕：取证口径说明（2026-11-08 05:05:32 核对）**：本节标题、结论与下方表格为 **2026-11-07 01:48 的历史实测快照**（commit `7e4e3e9`），按铁律三保留原始数值留痕，**不代表当前运行状态**。仓库当前 HEAD 为 `83f454c`（CI run 42413909910 五作业全绿）；**最新一轮逐平台取证见 [AGENTS.md 铁律九表格](../../AGENTS.md)（2026-11-08 05:05:32 按需登录交付轮，本机中国网络 curl）**，该轮要点：按需登录模型已上线（商城 `/store` 匿名可浏览，`/comic` `/chat` `/settings` 收费/私密视图匿名访问时于内容区内嵌登录卡片）；自建主站 `/health` 200/0.087s、首页 200/0.066s（LEN=5182，产物 `assets/index-ChbzA5PZ.js`）、五条深链接（`/store` `/comic` `/chat` `/settings` `/login`）全 200/LEN=5182、`/admin/` 200/0.062s/LEN=1430、`/api/v1/modules` 200/0.062s/LEN=438；Cloudflare Pages 首页 200/0.678s（LEN=5182 与自建同指纹），带 `Accept: text/html` 头深链接 `/store` 200/0.570s、`/comic` 200/0.579s、`/login` 200/0.494s；GitHub Pages `/mim/` 200/0.535s（深链接 404+LEN=5182 属 `404.html` 预期设计）；Sealos `/health` 200/0.269s；ghcr 未鉴权 401 正常；**EdgeOne `data.mixm.top` curl 200/0.116s 仍为 985B WAF 挑战页**（真实内容最近一次复验为 2026-11-08 04:33 有头放行后商城全链路通过：`title=Mim（旧定位副标题已于 2026-11-10 删除）`、`isWafChallenge=false`、`#/store` 渲染、搜索/详情/`/api/v1/modules` 200、console 零报错、无 `?tads` 残留）；Vercel 与 github.com 本机不可达属网络侧限制（DNS 污染 / TLS 阻断），CI 与 `git ls-remote` 取证正常。**按需登录 E2E**：本地 `scripts/verify-auth-gate.mjs --live` 52/52、生产匿名态 6/6 全 PASS；生产登录因 SMS 通道未配置（`auth/code` 503 `AUTH_CHANNEL_NOT_CONFIGURED`）以本地替代取证。本节数值待下一轮独立 curl 后整体同步，勿直接引用为现状。

结论：**9 个免费平台全部接入或已取证上线；`data.mixm.top` 的 curl 200 已按 EdgeOne WAF 挑战页修正为假阳性（真实内容须有头浏览器取证）——本轮复用 profile 的 WAF 放行凭证已过期（约 17h），层 2 验证码页 CDP 合成点击 ×15 未通过，真实内容本轮未复验（最近一次有头取证 2026-11-06）。自建主站首页已引用本轮新产物 `assets/index-B15IIvsS.js`（证明 commit `7e4e3e9`「整站强制登录改为公开视图免登录」已上线），其余状态码与 2026-11-06 基线一致，无渠道新增或失效。**

| 平台 | 免费 | 状态 | 域名 | HTTP / 总耗时 / 连接 |
|---|---|---|---|---|
| 腾讯云自建服务器 | ✅（自有服务器） | ✅ 已上线（前后端 + SQLite） | `https://mim.mixm.top` | 200 / **0.065s** / 0.027s ⚡最快（`/health` 200 / 0.070s） |
| 腾讯云 EdgeOne Pages | ✅ | ✅ 已同步（项目名 **`mim`**，2026-11-11 01:05 控制台复核；遗留项目 `mim-app` 无流量保留回滚；真实前端 `apps/web/dist`；curl 命中 WAF 挑战页，须有头浏览器取证） | `https://data.mixm.top` | curl 200 / 0.062s / 0.025s 但仅 **986B** 为 WAF 机器校验页（`EO_Bot_Ssid` / `_0x649a`）；2026-11-11 01:05 实测 200 / **981B** / `server: edgeone makers`；最近一次有头取证（2026-11-06）：`title=Mim`、`assets/index-cpYhbG3w.js` + `assets/index-LqZ4J1V-.css`、`isWafChallenge=false` → 属实弹前端；**2026-11-07 01:48 复测：复用 profile 的 WAF 放行凭证已过期（约 17h），回落层 2 验证码页，CDP 合成点击 ×15 未通过，本轮真实内容未复验（铁律三如实记录）** |
| GitHub Pages | ✅ | ✅ CI 自动发布 | `https://afdk1991.github.io/mim/` | 200 / 0.225s / 0.095s |
| Sealos | ✅ | ✅ CI 自动发布（容器 + PVC；纯 API 容器，根路径 `/` 404 无路由，`/health` 200） | `https://mim-i3ywsdfn.cloud.sealos.io` | `/` **404**（`route GET / not found`，属正常非故障）/ 0.281s / 0.101s；`/health` 200 / 0.283s / 0.096s |
| Cloudflare Pages | ✅ | ✅ CI 自动发布（项目名 `mim`，含 /api 反代） | `https://mim-299.pages.dev` | 2026-11-11 实测 `/` 200 / 1.840s / 5114B、`/api/v1/modules` 200 / 3.200s / 9514B（历史 2026-11-07 快照为 200 / 1.172s / 0.166s，域名当时为 `mim-8ah.pages.dev`） |
| GitHub Packages (ghcr) | ✅ | ✅ CI 自动推送镜像 | `ghcr.io/afdk1991/mim-api` | 401 / 0.745s / 0.140s（未鉴权 401 属正常） |
| IGA Pages | ✅ | ✅ 已部署（Project `fr95fuwu57` / Deploy `p4f5a4svqm`） | `preview.iga-pages.com`（带 `iga_token` 访问 200） | 200（需 token）/ 未纳入本机 curl 批次 |
| Vercel | ✅ | ✅ CI 取证通过（2026-11-06T13:15:10Z）；项目名 **`mim`**（2026-11-11 01:05 控制台复核，`mim-puce` 为 `mim.vercel.app` 被占后平台自动追加的后缀域名） | `https://mim-puce.vercel.app` | CI 记录 200；本机 000 / 20.006s（`--max-time 20` 截断）/ 0.000s（2026-11-07 01:48 实测 DNS 污染到 162.125.2.5（Dropbox 段地址，典型污染特征），TCP 连接即失败；2026-11-11 01:05 复测仍 20s 超时） |
| GitHub 仓库 | ✅ | ✅ 已同步（HEAD `41a871d`，2026-11-07 提交） | `https://github.com/afdk1991/mim` | 本机 000 / 0.029s / 0.011s（curl exit 35：TLS 握手阻断，TCP 可连；仓库操作经 git push / gh CLI 取证 ✅） |
| **Gitee（码云）镜像仓**（2026-11-10 入矩阵，第 10 行） | ✅ | ✅ 已同步（源码国内镜像仓，无 CI 推送作业，每轮手工 `git push gitee main`） | `https://gitee.com/mallwm_admin/mim` | **200 / 0.469s / 52034B（2026-11-10 22:20 实测）**：页面标题「mim: Mim - 跨平台商业级项目(GitHub 镜像)」、默认分支 `main`、129 次提交；`git ls-remote gitee refs/heads/main` = `4398cf0`（exit 0 / 0.27s）与本地 HEAD 一致 |

> **表格口径说明（2026-11-10）**：本表除「Gitee（码云）镜像仓」一行（2026-11-10 22:20 本轮新增实测）外，其余各行的 HTTP / 耗时仍为 2026-11-07 01:48 的历史数值，按铁律三留痕、不作现状引用；最新逐平台结论见 [AGENTS.md 铁律九表格](../../AGENTS.md) 与 §9.12。

> **2026-11-10 22:18 三项落地（本轮真实结果，覆盖上一条 21:47 快照）**：① **`/api` 反代已上线** —— 用新建令牌 `mim-ci-gh-actions`（权限仅「Cloudflare Pages: 编辑」）执行 `npx wrangler@3 pages deploy apps/web/dist --project-name mim-8ah --branch main --commit-dirty=true`，日志「Uploaded 4 files」「Uploading _redirects」「**Uploading Functions bundle**」「Deployment complete!」，`functions/api/[[path]].js` 与 `functions/[[catchall]].js` 已随站点生效；② **CI 自动发布已恢复** —— 仓库 secrets 补 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（原为 `total_count: 0`），并把 `deploy.yml` 的 `--project-name=mim` 改为 `mim-8ah`、去掉该步骤 `continue-on-error`、同步 `wrangler.toml` 的 `name`；push 后 run **42831492102** 五作业全绿，Cloudflare 步骤真实执行 `wrangler 4.160.0` → 「Success! Uploaded 3 files (2 already uploaded)」「Uploading Functions bundle」「**Deployment complete!** … https://1c93fea4.mim-8ah.pages.dev」，随后自检 `https://mim-8ah.pages.dev/ => 200`。生产域复测：`/` **200 / 1.585s / 5114B**、`/store` **200 / 1.150s / 5114B**、预览域 200 / 1.541s / 5114B；③ **`/api` 仍不可用（521）** —— `https://mim-8ah.pages.dev/api/v1/modules` **521 / 1.183s / 7005B**，因上游 `https://mim.mixm.top` 的 80/443 端口拒连（`Test-NetConnection 115.159.159.11` → 80 False / 443 False / 22 True，`curl --noproxy …/health` → 000）；云主机侧无 SSH 私钥、腾讯云控制台无登录态，主机侧无法修复，**不得宣称生产已上线**。

> **2026-11-10 21:47 复核与重建（本轮真实结果）**：上表 Cloudflare Pages 行所记「CI 自动发布（含 /api 反代）」已不成立——复核时 `https://mim-8ah.pages.dev` 返回 **530（项目不存在）**，Cloudflare 账号 `15726833367@139.com`（Account ID `a799197458978d508f927083360c635b`）的「Workers 和 Pages」项目列表为**空**，`mixm.top` zone 内 **0 条 DNS 记录**（域名权威解析不在该账号）；`deploy.yml` 的 Cloudflare 步骤因仓库无 `CLOUDFLARE_API_TOKEN` 每轮 `SKIP` 后 `exit 0`，属假绿。本轮用控制台「直接上传」重建 Pages 项目 `mim-8ah` 并直传根构建 `dist`（6 文件），取证：`/` **200 / 1.455s / 5114B**（`title=Mim`、产物 `assets/index-DkyuUDY7.js` + `index-DY6XAYXj.css`）、`/store` **200 / 1.040s / 5114B**、`assets/index-DkyuUDY7.js` **200**。**限制**：该入口为纯静态直传，**不含 `/api` 反代**（`functions/api/[[path]].js` 未随本次上传，故接口调用仍无同源后端）；且 push 后 CI 不会自动重发，须补 `CLOUDFLARE_API_TOKEN` 才恢复自动发布。

> **WAF 假阳性判别规则**：EdgeOne 等带机器人校验的托管平台，`curl` / 无头 UA 可能拿到 200 但响应体为数百字节混淆 JS（含 `EO_Bot_Ssid` / `_0x649a`）。此类 200 不得作为「内容正确」的取证；须以有头真实浏览器读取 `document.title` / `script[src]` / `body.innerText` 并确认 `isWafChallenge=false`。
>
> **拦截面实测（2026-11-07）**：`curl` / 无头 UA → 层 1 混淆 JS（约 986B）；**无头浏览器（`--headless=new`）与全新 `user-data-dir` 的有头 Edge → 层 2 验证码页**（`title=Security Verification`、`https://captcha.eo.gtimg.com/TEOCaptchaWidgetV1.js`、`htmlLen≈16419`、文案「正在验证连接安全性」）。判定正则须覆盖 `EO_Bot_Ssid|_0x649a|TEOCaptchaWidgetV1|正在验证连接安全性`。**可通过方式与其失效边界**：复用**已通过过校验的** `user-data-dir`（本机 `$env:TEMP\edge-cdp-profile`）+ 有头模式 + CDP（`--remote-debugging-port=9333`）；新建 profile 一律落入验证码页，不可作为取证手段。**且放行凭证会过期（实测约 17h 后失效：2026-11-07 01:48 复用该 profile 仍回落层 2）；层 2 的 TEOCaptcha 对 CDP 合成鼠标事件（`Input.dispatchMouseEvent`，×15 次点击）不放行；凭证过期后唯一出路是人工在有头浏览器勾选一次复选框，放行会回写 profile，后续 CDP 即可复用**。
>
> **`?tads` 注入机制与本轮修复（2026-11-07 定性）**：EdgeOne Bot 挑战脚本会给地址栏附加 `?tads` 参数，其字符串表内的清理逻辑为 `location.href=location.href.replace(/[?|&]tads/, '')`——该正则只匹配 `?tads` 本体、**不匹配**清理后残留的裸问号，因此地址栏最终留下 `https://data.mixm.top/?`。修复落在 [apps/web/index.html](../../apps/web/index.html) 的 `<head>` 内联脚本：在 React 挂载前用 `history.replaceState(null, '', location.pathname)` 原地清空查询串/裸问号，**不新增历史记录、不跳转**；仅命中「空查询串且地址以问号结尾」与「查询串恰为 `?tads`」两种形态，其余地址一律不动。该修复已随 CI 上线并实测：`mim.mixm.top/` → `tads=YES replaceState=YES`、`mim-8ah.pages.dev/` → `tads=YES replaceState=YES`、`afdk1991.github.io/mim/` → `LEN=1745 tads=True rs=True`。**EdgeOne 侧断根受限**：`edgeone makers --help` 仅 `init`/`dev`/`generate-routes`/`env`/`link`/`deploy`/`claim`/`create` 共 8 个子命令，**无任何 WAF / Bot 管理子命令**，关闭 WAF 只能走腾讯云 Web 控制台（需用户私有登录态，沙箱无凭证）；本轮已用 `edgeone makers deploy apps/web/dist -n mim-app --env production` 直传成功（Project ID `makers-qn9l8zxypkwd`、Deployment ID `dpbspulwd0nd`、exit 0 / `Deploy Success`），证明 `mim-app` 为 **direct upload 直传型**而非控制台「连接仓库」型。

> 以上矩阵已升格为项目规则：[AGENTS.md 铁律九](../../AGENTS.md)——免费是硬约束，每轮部署须刷新本表取证。

> 候选平台的免费额度与选型路由见 [AGENTS.md 铁律十](../../AGENTS.md)：远程仓库 3 个（GitHub / Bitbucket / Gitee）、纯静态 5 个（GitHub Pages / Cloudflare Pages / Vercel / Netlify / Azure Static Web Apps）、后端动态 2 个（Render 750 实例小时/月、Cloudflare Workers 10 万请求/天）。**原候选托管平台相关内容已于 2026-11-09 全量删除，不得重新引入候选池**。**本表为已落地的 9 平台矩阵，铁律十为候选池与选型依据**；新增平台须先过「长期免费层 / 额度可承载 / 是否实名绑卡 / 复核日期与来源」四要件。
>
> **生产权威终点（铁律十二，2026-11-09 补充）**：上述 9 平台仅为分发 / 镜像 / 可用性取证，**唯一生产上线终点为线上腾讯云自建服务器 `https://mim.mixm.top`**（nginx + systemd `mim-api` + SQLite WAL，前后端 + 数据库一体）；两个代码远端 `origin`（GitHub）与 `gitee`（Gitee）每轮须同轮全推并逐个 `git ls-remote` 取证。详见 [AGENTS.md §12](../../AGENTS.md)。

> **本机不可达两项属网络侧限制，不代表部署失败**：Vercel 存在 DNS 污染、github.com 存在 HTTPS 阻断；两者均有 CI 日志与 git/gh 侧取证。

### 7.1.4 已采用免费层平台（2026-11-10 扩展，待接入外部账号）

用户 2026-11-10 决策「全部采用免费层」后，GitLab / Bitbucket / Netlify / Azure Static Web Apps / Render 五项从铁律十候选池升为**已采用登记项**，状态 `UNVERIFIED`（脚手架已就绪，真实发布需平台建项 + 填 secret，不冒充已部署）。本节只记录三条**已落地 CI 链路**的运维要点：

| 平台 | 配置文件 | CI 行为 | 深链接回退 |
|---|---|---|---|
| Netlify | `netlify.toml` | `deploy.yml` 的 `Netlify` 步骤，缺 `NETLIFY_AUTH_TOKEN` 即 SKIP | `[[redirects]] /* → /index.html 200`（Netlify 原生规则） |
| Azure Static Web Apps | `.github/workflows/azure-static-web-apps.yml`（独立 workflow） | 缺 `AZURE_SWA_TOKEN` 即 SKIP；已构建产物 `apps/web/dist` + `skip_app_build: true` | 部署前由 workflow 向产物注入 `staticwebapp.config.json`（`navigationFallback.rewrite=/index.html`，排除 `/assets/*` 与常见静态后缀） |
| Render | `render.yaml` | `deploy.yml` 的 `Render` 步骤，缺 `RENDER_API_KEY` 即 SKIP | 蓝图 `routes: - type: rewrite / source: /* / destination: /index.html` |

- **`render.yaml` schema 修正（2026-11-10）**：原文件用 `static_sites:` 顶层键，非 Render 官方蓝图 schema（官方为 `services:` 下 `type: web` + `runtime: static`），已按官方字段重写，避免平台建项时解析失败。
- **接入步骤（需用户账号）**：平台控制台创建项目 → 拿到 site id / token 写入仓库 secrets（`NETLIFY_AUTH_TOKEN` / `NETLIFY_SITE_ID`、`AZURE_SWA_TOKEN`、`RENDER_API_KEY` / `RENDER_SERVICE_ID`）→ 下一次 push `main` 由 CI 自动发布 → 按铁律九补 `curl` 取证后再改状态。
- **未接入期间的判定**：这些步骤 `continue-on-error: true`（Azure 为 `if: env.SWA_TOKEN != ''`），**作业变绿不等于已部署**，不得据此宣称上线（铁律三 / 铁律九）。

### 7.1.1 服务器出网限制（重要）

生产服务器 **访问 `https://github.com` 超时**（`curl: (28) SSL timeout`），但 `github.com:22` 可达，
因此代码同步走 **SSH + 只读 deploy key**，不走 HTTPS：

| 项 | 值 |
|---|---|
| 仓库地址 | `git@github.com:afdk1991/mim.git`（`deploy.sh` 内 `REPO_URL` 默认值） |
| 私钥（服务器） | `/opt/mim/.ssh/deploy_key`（root 600，仅服务器持有） |
| 公钥（GitHub） | 仓库 Settings → Deploy keys，标题 `mim-prod-deploy (115.159.159.11)`，**read-only** |
| 连通性取证 | `sudo env GIT_SSH_COMMAND='ssh -i /opt/mim/.ssh/deploy_key -o BatchMode=yes -o StrictHostKeyChecking=accept-new' git ls-remote git@github.com:afdk1991/mim.git HEAD` |

`deploy.sh` 会用该私钥设置 `GIT_SSH_COMMAND`，并对 `git fetch` 做 3 次重试；私钥缺失时直接报错退出。

### 7.2 服务器一次性引导（仅首次 / 重建机器）

```bash
ssh ubuntu@115.159.159.11
sudo -n bash /opt/mim/app/deploy/bootstrap.sh   # 需仓库已在 /opt/mim/app
```

`bootstrap.sh` 幂等完成：apt 依赖（git/nginx/rsync/curl/certbot）→ corepack + pnpm 9.12.0 → 系统用户 `mim` → `/opt/mim/{app,web}` → **生成/复用 SSH deploy key 并验证可读仓库** → nginx 站点 → systemd `mim-api` → Let's Encrypt 证书（仅对已解析域名申请）→ 首发布。首次执行若提示 `deploy key 未授权`，把打印出的公钥加为仓库 Deploy Key（只读）后重跑即可。

### 7.3 幂等重放与运维

```bash
sudo -n bash /opt/mim/app/deploy/deploy.sh              # 手动重放发布（origin/main → install → build → 发布 → 健康轮询）
sudo -n bash /opt/mim/app/deploy/deploy.sh <commit-sha>  # 精确重放到指定提交（CI 同款行为）
bash /opt/mim/app/deploy/backup-db.sh          # SQLite 在线热备份（默认 /var/backups/mim，保留 14 份）
systemctl status mim-api; journalctl -u mim-api -n 50    # 服务状态与日志
```

### 7.4 生产布局

| 项 | 路径 |
|---|---|
| 仓库 | `/opt/mim/app`（git，`mim` 用户所有） |
| 静态根 | `/opt/mim/web`（`apps/web/dist` 同步而来，nginx `root`） |
| 数据库 | `/opt/mim/app/services/mim-api/data/mim.db`（WAL，持久化） |
| JWT 密钥 | `/opt/mim/app/.mim-dev-secret/jwt.key`（首次启动自动生成，不入库） |
| 站点配置 | `/etc/nginx/sites-available/mim.conf`（源模板 `deploy/nginx-mim.conf`） |

### 7.5 根级构建（生产前端 / PRD 离线阅读）

```bash
npm run build        # scripts/build.mjs：构建真实前端 apps/web/dist → 根 dist/（EdgeOne Pages OutputDir=dist 同款链路）
npm run build:site   # scripts/build.mjs --site：仅把 site/ 复制到 根 dist/（PRD 阅读页离线预览）
npm run build:web    # 仅构建 apps/web → apps/web/dist
npm run check        # version-check + env-check + comment-check（退出码 0 = 通过）
```

`site/` **不参与任何生产托管**；生产前端与 EdgeOne Pages（`data.mixm.top`）前端**只来自 `apps/web` 构建产物**——根 `dist/` 由 `scripts/build.mjs` 从 `apps/web/dist` 复制而来。`.edgeone/` 配置已移除。

## 7.6 DNS 资产（DNSPod mixm.top）与功能模块对应

来源：`dnspod_records_2026-11-05_21-42-26.xls`（197 条，含 GBK 中文备注）。**口径更正（2026-11-11 实读）**：197 条 = 两个工作表原始行数之和（`laal.top` 93 + `mixm.top` 104，均含表头），逐行只有「主机记录 / 线路类型 / TTL 600 / 备注」有值，**记录类型与记录值两列全为空**，逐主机折叠后实为 46 条主机记录（44 类模块入口 + 根域 / 空白占位），即这是一份命名模板而非可直接导入的解析记录。结论（2026-11-06 全仓比对）：

- **项目实际使用 3 条**：`mim`（生产主域）、`data`（EdgeOne Pages 真实前端站）、`_dnsauth.mim`（证书签发校验）；`cloud.mixm.top` DNS 在线但项目零引用；其余 193 条未使用。
- **备注 ↔ 模块对应（40 种备注）**：仅 3 类直接命中——`auth` / `login` / `api` → FR-01 账号与身份 + `mim-api`；10 类部分沾边（`admin` / `center` / `user` / `dy` / `sp` / `video` / `yy` / `img` / `secure` / `portal`）；27 类无对应（`pay` 无对应域；电商 7 类、资讯 4 类、工具 4 类、移动端 3 类等与当前「功能模块商城 + 漫剧 AI 剧」范围无关）。

### 部署平台 ↔ DNSPod 记录对应（2026-11-06 实测）

§7.1.3 的 **10 个免费平台**（2026-11-10 起含 Gitee 镜像仓）中，仅 2 个平台经 DNSPod `mixm.top` 自有域解析，其余 8 个使用平台方域名、不经 DNSPod：

| 部署平台 | 域名 | DNSPod 记录（类型 \| 主机记录 \| 记录值） | 记录状态 |
|---|---|---|---|
| 腾讯云自建服务器（生产） | `mim.mixm.top` | `A \| mim \| 115.159.159.11`（TTL 600） | 正常（2026-11-01 16:44:49） |
| 生产证书签发校验（Let's Encrypt DNS-01） | —（校验用，不提供访问） | `TXT \| _dnsauth.mim \| 20261101085017crjbxlenk4ad73ctm41heelf10vswxc`（TTL 600） | 正常（2026-11-01 16:50:18） |
| 腾讯云 EdgeOne Pages | `data.mixm.top` | `CNAME \| data \| data.mixm.top.pages.dnsoe5.com.`（TTL 600） | 正常（2026-11-01 21:18:09） |
| Gitee（码云）镜像仓 | `gitee.com`（平台方域名） | 不经 DNSPod，`mixm.top` 下无对应记录；仓库路径 `mallwm_admin/mim` | 2026-11-10 22:20 实测 200 / 0.469s / 52034B |
| GitHub Pages / Sealos / Cloudflare Pages / ghcr / IGA Pages / Vercel / GitHub 仓库 | 平台方域名（`*.github.io` / `*.cloud.sealos.io` / `*.pages.dev` / `ghcr.io` / `*.iga-pages.com` / `*.vercel.app` / `github.com`） | 不经 DNSPod，`mixm.top` 下无对应记录 | — |

补充说明：

- `cloud`（`A \| cloud \| 115.159.159.11`，正常，2026-11-01 21:08:13）DNS 在线但项目零引用，未指向任何部署平台功能。
- `@` 根域及旧 `cloud` / `data` A 记录（103.0.113.20）状态为「暂停」，不参与服务。
- 另有 `_dnsauth.gy`（CNAME → `gy.mixm.top.eoacme0.com.`）属 EdgeOne 证书校验，与 `gy.mixm.top` 子站相关，当前项目未使用。

### 多平台自定义域名矩阵（2026-11-11 按用户指令统一到 DNSPod 导出命名）

用户要求「多平台部署矩阵所有自定义域名使用导出中对应的域名」，据此把 10 平台的**自定义域名**统一取 `mixm.top` 工作表的主机记录，单一事实源为 `packages/core-domain/src/customDomains.json`（含每条域名的 xls 行号、备注、状态与下一步），门禁脚本 `node scripts/verify-custom-domains.mjs`。

| 部署平台 | 自定义域名 | xls 主机 / 行号 | 状态 |
|---|---|---|---|
| 腾讯云自建服务器（生产权威终点） | `mim.mixm.top` | `mim` / 100 | live（`/health` 200 / 53B） |
| 腾讯云 EdgeOne Pages | `data.mixm.top` | `data` / 22–23、104 | live（`/` 200，校验通过后深链接正常） |
| GitHub Pages | `www.mixm.top` | `www` / 6–7 | pending_dns |
| Cloudflare Pages | `portal.mixm.top` | `portal` / 54–55 | pending_dns |
| Vercel | `m.mixm.top` | `m` / 46–47 | pending_dns |
| Sealos | `api.mixm.top` | `api` / 10–11 | pending_dns |
| IGA Pages | `test.mixm.top` | `test` / 72–73 | pending_dns |
| Gitee（码云）镜像仓 | `store.mixm.top` | `store` / 68–69 | pending_dns |
| GitHub 仓库 | `dev.mixm.top` | `dev` / 24–25 | pending_dns |
| Cloudflare 独立 Worker（`mim-store`） | `shop.mixm.top` | `shop` / 60–61 | pending_dns |

- **保留**：`cloud.mixm.top`（xls 20–21、102 行）已解析至生产 CVM 并被云服务模块占用（实测 200 / 5114B），不分配给任何平台。
- **不适用**：ghcr（域名固定 `ghcr.io`）。
- **待办**：DNSPod 添加 `www` / `portal` / `m` / `api` / `test` / `store` / `dev` / `shop` 解析 → 各平台控制台绑定自定义域名 → 指向 CVM 的新域名需单独签发证书（现有证书不覆盖任意子域，2026-11-11 严格 TLS 探测未配置主机名得 exit 000）。

## 8. 部署汇总核对（2026-11-09 新增）

**何时跑**：每轮涉及远端 / 平台 / CI / 部署工件变更后；以及需要一次性核对「所有部署仓库及相关部署项的效果与结果」时。

```bash
npm run summary:deployments                 # 基线：采集仓库与工件，沿用契约取证快照
node scripts/deployment-summary.mjs --live # 追加逐入口真实 curl 探测，刷新各部署项 result
npm run verify:deployments                  # 55 项零依赖断言（唯一性 / 覆盖 / 双口径 / 全链路 / 8 列规范）
```

产物：`docs/deployment-summary.json`（结构化，schema `mim.deployment-registry.v1`）、`docs/deployment-summary.md`（主表 + 异常明细 + 仓库工件 + 覆盖去重 + 取证来源）。Web 端 `/deployments` 与 `/api/v1/deployments*` 提供同一份数据的交互式核对。

**主表列规范（2026-11-12 起固定 8 列，前端与 Markdown 核对表同口径）**：`规范 ID / 名称`｜`仓库标识`｜`平台 / 层级`｜`交付链路`｜`访问域名`｜`部署状态`｜`部署结果`｜`异常说明`。访问域名为可点击入口（`entry_url` 为空显示 `—`）；缺失信息并入「异常说明」列以 `⚠ 缺失 n` 徽标呈现，展开详情内保留完整缺失清单。

**判读约定**：

| 标识 | 含义 | 处置 |
|---|---|---|
| `⚪ 空数据` | `result = null`，本轮无任何取证 | 补私有凭证或发起探测；不得以历史 200 冒充 |
| `🔴 FAIL / BROKEN` | 明确失败或不可达 | 附网络侧证据；生产项须回到铁律十二 V2–V4 取证 |
| `🟡 DEGRADED / UNVERIFIED` | 可达但内容不可核验（WAF）/ 未取证 | 有头浏览器复验或补 `ls-remote` |
| `⚠ 缺失 n 项` | `missing_fields` 非空 | 逐项补齐（凭证 / 工件 / 取证） |
| `工件漂移` | `in_head=true` 且 `in_worktree=false` | 未提交删除时 CI 仍可读；提交前须评估 CI 悬空风险 |

**本轮基线（2026-11-09 23:03，HEAD `3b9b251`）**：11 部署项 / 9 取证 + 2 空数据 / 异常 26（🔴2 🟡17 🟢7）/ 缺失 34 / 工件漂移 6；`origin` 同步 ✅、`gitee` exit 124 未取证；生产 `/health` `000`（代理 502），**未做生产部署、不宣称已上线**。逐平台实测见 [AGENTS.md §13.8](../../AGENTS.md)，结构化明细见 [deployment-summary.md](../deployment-summary.md)。
