# Mim 部署指南（GitHub Pages / GitHub Packages / EdgeOne Pages / Supabase）

本项目已配置一条完整的 CI/CD 流水线：[.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)。

## 全栈分层：谁负责哪一层

| 能力层 | Mim 的选型 | 落地位置 | 免费额度 / 说明 |
| --- | --- | --- | --- |
| 代码仓库 + CI | GitHub | 仓库 `afdk1991/mim` + Actions | 私有库免费，Actions 每月 2000 分钟 |
| 制品仓库 | GitHub Packages | 打 tag `v*` 自动发布 `@afdk1991/mim` | 免费套餐仅 public，故 `npm publish --access public` |
| 纯静态前端 | GitHub Pages | `#/feed` hash 路由，`dist/` 直发 | 免费，无需 404 兜底 |
| 动态前端（国内边缘） | EdgeOne Makers | 同一份 `dist/`，CLI 自动部署 | 免费档，自动给预览域名 |
| 后端 API（主） | **Supabase** | 浏览器直连：PostgREST + GoTrue + Storage + Realtime | 免费档：500MB 数据库 / 1GB 存储 / 5 万 MAU |
| 数据库（主） | Supabase PostgreSQL | 直连（RLS 行级安全） | 权限由数据库策略承担 |
| 对象存储（主） | Supabase Storage 私有桶 `mim-media` | 直连（RLS 限定 `<uid>/` 前缀） | 见「Supabase」一节 |
| Auth（主） | Supabase GoTrue | 用户名注册/登录 + GitHub OAuth | 用户名映射合成邮箱 `<username>@mim.app` |
| 后端 API（备） | CloudBase 云函数 `mim-api` | `cloudfunctions/mim-api/index.js` | 自建账号 + 数据库代理 + 存储代理 |
| 数据库 / 存储（备） | CloudBase PostgreSQL + PG 存储桶 | 经 `mim-api` 代理 | RLS 由云函数强制注入 |
| 同契约后端 API（Supabase 版） | Supabase Edge Function `mim-api` | `supabase/functions/mim-api/` | 与 CloudBase 版同路由契约，可选 |

一句话：**GitHub 管代码与制品，Pages + EdgeOne 管前端，Supabase 直连管 API / 数据库 / 存储 / Auth（CloudBase 为备）。**
三者通过一次 `git push` 串起来。

后端优先级（`src/lib/supabase.ts` 自动选择，可用 `VITE_MIM_BACKEND` 强制指定）：

```
Supabase（配了 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY）
  → CloudBase（仅配 VITE_MIM_API_BASE）
    → 本地演示模式（两者皆无）
```

## 〇、云端后端（先读这段）

Mim 有**两套云端后端**，前端按优先级自动选择，页面无需任何改动：

### 1. Supabase（主后端，2026-10-24 接入）

前端经 `@supabase/supabase-js` **直连** Supabase，消费平台原生能力：

| 能力 | 端点 / 机制 | 安全模型 |
| --- | --- | --- |
| 注册 / 登录 | GoTrue `/auth/v1/signup`、`/token?grant_type=password` | 用户名映射合成邮箱 `<username>@mim.app`（`mailer_autoconfirm` 已开启，不发邮件）；含 `@` 的输入按邮箱直通 |
| 第三方登录 | GoTrue `/auth/v1/authorize` | GitHub 已启用；回跳白名单已含 Pages / EdgeOne / 本地 dev 三个入口 |
| 数据读写 | PostgREST `/rest/v1/<table>` | **RLS 行级安全**：公开表全员读、私有表仅本人、世界观点数据只读 |
| 对象存储 | Storage `/storage/v1/object/mim-media/<uid>/…` | RLS 限定首段目录 = 本人 uid；私有桶，仅签名链接可访问 |
| 私信实时推送 | Realtime（`messages` 表已加入 publication） | RLS 过滤后的 INSERT 事件推送 |

**为什么浏览器可以直连**：Supabase 网关对任意域名开放 CORS，且 publishable key
按设计即可暴露于客户端——数据安全完全由 RLS 承担（全表已启用，见 `supabase/schema.sql`）。
这解决了 CloudBase 侧的两个平台限制（注册通道被禁、CORS 白名单不可配）。

线上项目：`https://sepfobukokrrivwyvhnd.supabase.co`（schema 已应用，含既有数据）。

#### 待执行迁移（需人工凭证，AI 无法代执行）

两个迁移文件已就绪但**尚未应用到线上库**（本环境只有 anon key，无数据库密码 / access token）：

| 迁移 | 内容 | 缺失后果 |
| --- | --- | --- |
| `supabase/migrations/0001_iam_phase1.sql` | IAM 四表 + 审计日志 + RBAC 种子 | `user_roles` 等查询 404（PGRST205）⇒ 无 RBAC，管理后台入口不显示 |
| `supabase/migrations/0002_storage_media.sql` | 私有桶 `mim-media` + 存储 RLS | 上传走本地预览降级（云端上传不可用） |

执行方式（二选一）：

```powershell
# A. 数据库连接串（Dashboard → Project Settings → Database → Session pooler）
$env:SUPABASE_DB_URL="postgresql://postgres.<ref>:<密码>@aws-0-<区域>.pooler.supabase.com:5432/postgres"
$env:ADMIN_EMAIL="you@example.com"        # 可选：给该注册邮箱授予 admin 角色
npm run db:apply                          # 按序应用全部迁移（已应用的自动跳过）

# B. Supabase Dashboard → SQL Editor → 依次粘贴两个 .sql 文件全量执行（幂等）
```

> `npm run db:apply` 会自动发现 `supabase/migrations/*.sql` 并按文件名顺序执行，
> 已记录于 `public.schema_migrations` 的版本跳过；两个迁移均为幂等 SQL，重复执行安全。

#### 本地开发

`.env`（模板见 `.env.example`，仓库已内置同值兜底常量）：

```ini
VITE_SUPABASE_URL=https://sepfobukokrrivwyvhnd.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg
```

#### 回归验证（真实 HTTP 调用）

```powershell
npm run smoke:supabase                  # 只读：settings/公开表读/RLS 隔离/RPC/OAuth URL/桶状态
npm run smoke:supabase -- --with-auth   # 追加：注册→登录→会话→建档→JWT 读私有表（留冒烟账号）

# 浏览器级端到端（真实 Edge 渲染 + 真实注册登录）：
npm run build
npx vite preview --port 5199 --host 127.0.0.1   # 另开终端
node scripts/verify-supabase-e2e.mjs
```

### 2. CloudBase（备后端）

仅当未配置 Supabase（或 `VITE_MIM_BACKEND=cloudbase`）时生效。存在的理由（平台硬限制）：

| 限制 | 表现 | 结果 |
| --- | --- | --- |
| 注册通道被禁 | `POST /auth/v1/signup` 恒返回 `501 you can not signup just by username and password`，即便用 service_role Key 也一样 | 自助注册只能自建 |
| CORS 白名单 | 网关只放行安全域名，体验版套餐不允许添加域名（`CreateAuthDomain` 被拒） | GitHub Pages / EdgeOne 等线上域名一律 **403** |

`mim-api` 同时解决两者：自建账号体系（PBKDF2 密码哈希 + HMAC 签名令牌），
并自行回写 `Access-Control-Allow-Origin: *`，因此**任意部署域名都能直接调用**。

### 安全模型（务必了解）

云函数用 `service_role` Key 访问数据库，而 **service_role 会绕过 RLS**，
所以权限全部由云函数强制注入，不依赖浏览器传参：

- 读：公开表放行；私有表自动追加 `owner 列 = 当前 uid`
- 写：自动把 owner 列改写为当前 uid（伪造他人 id 无效）
- 改/删：自动按 `owner 列 = 当前 uid` 过滤（改他人数据返回空）
- `app_users` / `audit_logs` 永不代理；`topics` / `hot_searches` / `resources` 等只读

### 本地开发

`.env` 中写入（模板见 `.env.example`；未配置任何后端时应用自动回退「本地演示模式」，
数据仅存 localStorage，因此任何环境下都能安全构建上线。CI 已内联注入两组公开配置，
无需再配 GitHub Secrets）：

```ini
# 主后端（Supabase 直连）
VITE_SUPABASE_URL=https://sepfobukokrrivwyvhnd.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg
# 备后端（仅在不配 Supabase 时生效）
# VITE_MIM_API_BASE=https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mim-api
# 强制指定后端（可选）：supabase / cloudbase / local / auto（默认 auto）
# VITE_MIM_BACKEND=cloudbase
```

### Supabase Edge Function mim-api（可选，同契约后端 API）

`supabase/functions/mim-api/` 是与 CloudBase 云函数**完全同路由契约**的 Deno 函数
（`/auth/*`、`/db/rest/*`、`/db/rpc/*`、`/storage/*`），供需要「自建令牌 + 服务端
权限注入」形态的场景使用；前端主路径是浏览器直连，**不依赖本函数**。

部署需在仓库 **Settings → Secrets and variables → Actions** 配四项
（未配则 `deploy-supabase-function` job 整段跳过，不影响其他部署）：

| Secret | 说明 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase 账号 Access Token（Dashboard → Account → Access Tokens） |
| `SUPABASE_PROJECT_REF` | 项目 ref（Dashboard → Project Settings → General，形如 `sepfobukokrrivwyvhnd`） |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role Key（Dashboard → Project Settings → API） |
| `MIM_TOKEN_SECRET` | 自建 HMAC 令牌密钥（任意长随机串；**轮换会使全部已签发令牌失效**） |

`supabase/functions/` 有变更时 CI 自动部署并同步运行密钥；手动部署：

```powershell
npm install -g supabase
supabase functions deploy mim-api --project-ref <ref>
supabase secrets set SUPABASE_URL=https://sepfobukokrrivwyvhnd.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> MIM_TOKEN_SECRET=<secret> --project-ref <ref>
```

部署后把前端指向它即可走备路径：`VITE_MIM_API_BASE=https://<ref>.supabase.co/functions/v1/mim-api`。

## 部署矩阵

| 事件 | 动作 |
| --- | --- |
| Push 到 `main` | 类型检查 → 构建 → 自动部署 **GitHub Pages** + **EdgeOne Pages** |
| Push 到 `main` 且 `cloudfunctions/` 有变更 | 额外部署云函数 **mim-api**（需先配 CloudBase 密钥，未配则跳过） |
| Push 到 `main` 且 `supabase/functions/` 有变更 | 额外部署 **Supabase Edge Function mim-api**（需先配 Supabase 密钥，未配则跳过） |
| Push tag `v*`（如 `v1.0.0`） | 类型检查 → 构建 → 发布 npm 包到 **GitHub Packages**（站点与 main 同提交，无需重复部署） |
| Pull Request | 只跑质量门禁（typecheck + build），不部署 |
| 手动触发 | 在仓库 Actions 页点 `Run workflow` 随时部署 |

## 一、首次上线（仅需做一次）

### 1. 把代码推上 GitHub

> 本机当前未安装 `git` 命令行，可任选其一：
> - 安装 Git：`winget install --id Git.Git -e`，然后执行下方命令；
> - 或在 GitHub 仓库网页端拖拽上传（Upload files），后续改动再装 Git。

```powershell
# 安装 Git 后执行
cd f:\合并项目\Mim
git init
git add .
git commit -m "feat: 项目初始化并接入 CI/CD 部署"
# 在 github.com 新建空仓库 mim（不要勾选自动生成 README）
git remote add origin https://github.com/<你的用户名>/mim.git
git branch -M main
git push -u origin main
```

推送后流水线会自动开始构建。在仓库 **Actions** 标签页可查看进度。

### 2. 开启 GitHub Pages（免费静态托管）

进入仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
之后每次 push main，流水线会自动发布到：

```
https://<你的用户名>.github.io/mim/
```

项目使用 hash 路由（`#/feed` 等），无需任何 404 兜底配置，子路径直接可用。

### 3. 配置 EdgeOne Pages（腾讯云免费托管）

1. 打开 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages) 并开通服务；
2. 在控制台生成 **API Token**（参考官方文档 [API Token](https://edgeone.cloud.tencent.com/pages/document/176921267881082880)）；
3. 回到 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**：
   - Name：`EDGEONE_API_TOKEN`
   - Secret：粘贴刚才的 Token；
4. 项目名默认为 `mim`（项目不存在会自动创建）。如需改名，编辑
   [.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml) 中 `deploy-edgeone` 的 `EDGEONE_PROJECT_NAME`。

配置完成后，push main 即自动把 `dist/` 通过官方 CLI `edgeone pages deploy` 发布上线。

### 4. GitHub Packages（npm 包托管，需配一个 PAT Secret）

> ⚠️ **PAT 是硬要求，不是可选回退。** 实测：即使包已关联到仓库，
> `GITHUB_TOKEN` 发布仍报 `403 permission_denied: write_package`（v0.0.4 复现过两次）。
> 用户级公开 npm 包必须用带 `write:packages` + `read:packages` 的 PAT。

先在仓库 **Settings → Secrets and variables → Actions** 新增：

| Secret 名 | 值 | 说明 |
|---|---|---|
| `NPM_TOKEN` | GitHub PAT | 需勾选 `write:packages` + `read:packages`（Settings → Developer settings → Personal access tokens） |

配好后打 tag 发版即自动发布：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

发布出的包名为 `@<你的用户名>/mim`，地址在仓库 Packages 标签页。
拉取时在本机项目根目录建 `.npmrc`：

```ini
@<你的用户名>:registry=https://npm.pkg.github.com/
```

安装：`npm install @<你的用户名>/mim`（首次会要求用 GitHub PAT 登录）。

## 二、日常开发节奏（边开发边上线）

```powershell
git add .
git commit -m "..."
git push          # 自动构建并同步上线 GitHub Pages + EdgeOne Pages
```

安全网：

- PR 会先跑质量门禁，通过后再合并，避免坏版本上线；
- 同一分支的并发部署会自动取消旧的，只保留最新一次；
- 每次构建产物都会在 Actions 运行详情里保留 7 天，可手动下载排查。

## 三、本地手动部署（可选）

不经过 GitHub，直接用官方 CLI 发布到 EdgeOne：

```powershell
npm install -g edgeone
edgeone login
npm run build
edgeone pages deploy ./dist -n mim -e production
```

## 四、云函数开发与排障

### 部署方式：CI 自动（推荐）+ 手动兜底

CI 的 `deploy-function` job 会在 `cloudfunctions/` 有变更时自动部署，
但需要仓库先配好三个 Secrets（**Settings → Secrets and variables → Actions**）：

| Secret | 说明 |
| --- | --- |
| `CLOUDBASE_SECRET_ID` | 腾讯云 API 密钥 SecretId（CAM 子账号，授予 CloudBase 相关权限） |
| `CLOUDBASE_SECRET_KEY` | 对应 SecretKey |
| `CLOUDBASE_ENV_ID` | CloudBase 环境 ID，形如 `xxx-1a2b3c4d` |

**未配置时该 job 整段跳过**，不影响 Pages / EdgeOne 部署。此时改完云函数仍需手动部署：

```powershell
# 用 CloudBase CLI
tcb fn deploy mim-api --dir ./cloudfunctions -e <环境ID>
```

或通过 CloudBase MCP：`manageFunctions(action="updateFunctionCode", functionName="mim-api",
functionRootPath="<项目根>/cloudfunctions", handler="index.main")`。

> 注意 `functionRootPath` 指向**包含函数目录的父目录**（`cloudfunctions`），
> 不是项目根目录，也不是 `cloudfunctions/mim-api` 本身。
>
> 另：函数开启了 `InstallDependency`，上传带 `package.json` 的代码后云端会装依赖，
> 刚部署完的 1～2 分钟内 `require` 可能仍报 MODULE_NOT_FOUND，稍等再验。

### 云存储（对象存储层）

桶 `mim-media` 为**私有桶**，文件只能凭签名链接访问。因为是 CloudBase **PostgreSQL 模式**，
旧 COS 接口（`app.uploadFile` / `getTempFileURL`）会直接报 `STORAGE_NOT_SUPPORTED`，
必须走 PG 存储 HTTP API（云函数内已封装）：

| 动作 | 端点 |
| --- | --- |
| 上传 | `POST /v1/storages/object/<bucket>/<key>`（请求体即文件字节） |
| 取签名链接 | `POST /v1/storages/object/sign/<bucket>/<key>` `{expiresIn}` |
| 列目录 | `POST /v1/storages/object/list/<bucket>` `{prefix,limit}` |
| 删除 | `DELETE /v1/storages/object/<bucket>/<key>` |

前端可用路由（均需登录，返回 CORS `*`）：

| 路由 | 说明 |
| --- | --- |
| `POST /storage/upload` | `{name, mime, data(base64)}` → `{key, bucket, size}` |
| `GET /storage/url?key=…&expiresIn=…` | 取临时可访问链接 |
| `GET /storage/list` | 列出自己目录下的文件 |
| `POST /storage/delete` | `{keys:[…]}` 删除自己的文件 |

约束与隔离：

- 单文件上限 **3MB**（HTTP 请求体 ~6MB，base64 膨胀 33% 后留余量）；
- 仅放行 `image/*`、`video/*`、`audio/*`（`image/svg+xml` 因可内嵌脚本被排除）；
- 对象 key 固定为 `<uid>/<yyyy-mm>/<uuid>.<ext>`，取链与删除前校验首段 uid ⇒ **无法读写他人文件**。

建桶 SQL（已执行，重建时再用）：

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('mim-media', 'mim-media', false);
```

前端入口见 `src/lib/cloud-storage.ts`，UI 见「发布页 → 媒体 → 上传/转码工作台」：
已登录即真上传并显示 `☁️ 已上传云端`，未登录/超限时自动退回本地预览，不静默失败。

### 上线前回归清单（真实 curl 验证，别靠静态推断）

```powershell
$API = "https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mim-api"

# 1. 注册拿 token
$r = Invoke-RestMethod "$API/auth/register" -Method POST -ContentType "application/json" `
      -Body '{"username":"smoke_test","password":"SmokeTest@2026"}'
$t = $r.token

# 2. 鉴权 / 权限 / 越权 逐项核对（期望值见下表）
Invoke-RestMethod "$API/auth/me" -Headers @{ Authorization = "Bearer $t" }   # 200
Invoke-RestMethod "$API/db/rest/posts"                                       # 200 匿名可读
Invoke-RestMethod "$API/db/rest/favorites"                                   # 401 匿名不可读私有表
Invoke-RestMethod "$API/db/rest/app_users" -Headers @{ Authorization="Bearer $t" }  # 403
Invoke-RestMethod "$API/db/rest/topics" -Method POST -Headers @{ Authorization="Bearer $t" } `
      -ContentType "application/json" -Body '{"name":"x"}'                   # 403 只读表
```

| 用例 | 期望 |
| --- | --- |
| `POST /auth/register`、`POST /auth/login` | 200 |
| `GET /auth/me`（带 Bearer） | 200 |
| 匿名读 `posts` / `topics` 等公开表 | 200 |
| 匿名读 `favorites` 等私有表、匿名写任意表 | 401 |
| 写只读表（`topics` / `hot_searches` / `resources`） | 403 |
| 访问 `app_users` / `audit_logs` | 403 |
| 非法表名（如 `posts;drop`） | 400 |
| 改他人数据 | 返回空（强制追加 owner 过滤，改 0 行） |
| 任意域名携带 Origin | 响应 `Access-Control-Allow-Origin: *` |

### 存储链路回归（一键跑真实调用）

```powershell
node scripts/smoke-storage.mjs     # 默认打线上 mim-api
MIM_API=https://xxx/mim-api node scripts/smoke-storage.mjs
```

覆盖 14 项：注册 → 上传 → 匿名拦截(401) → 类型拦截(415) → 超限拦截(413) →
取签名链接 → 链接匿名可下载 → 越权取链(403) → 列目录 → 删除 → 越权删除(403) →
删除后取链(404)。全通过退出码 0，有失败为 1。

### 「注册/登录成功，但 /auth/me 返回 401」

**先别改鉴权代码**，按此顺序排查：

1. **重新登录取一个新 token 再试。** 最常见原因是 `MIM_TOKEN_SECRET` 被轮换过，
   旧 token 的 HMAC 签名校验自然失败。换发新 token 后通常立即恢复 200。
2. 确认请求头名是 `Authorization: Bearer <token>`（也接受 `x-mim-token: <token>`）。
3. 仍失败再查云函数日志：`queryFunctions(action="listFunctionLogs", functionName="mim-api")`。

> 副作用：轮换 `MIM_TOKEN_SECRET` 会让**全部已登录用户的令牌失效**（需重新登录）。
> 这是设计使然，但生产环境不要频繁轮换。

## 常见问题

- **Pages 部署按钮置灰**：未把 Settings → Pages 的 Source 切成 GitHub Actions。
- **EdgeOne 部署报 token 无效**：确认 Secret 名是 `EDGEONE_API_TOKEN`，且 Token 是在 Pages 控制台（非腾讯云主账号密钥）生成。
- **改了部署项目名后出现两个项目**：旧项目需在 EdgeOne 控制台手动删除。

## 附：仓库重建后必做清单（2026-10-23 实测）

远端仓库若被删除/转移，本地历史仍在，重建后一次 push 即全量恢复。但**新仓库是空壳**，
以下三项必须补，否则部署链路会假失败或根本跑不起来：

| # | 事项 | 命令 / 位置 | 漏做的后果 |
|---|---|---|---|
| 1 | 启用 GitHub Pages | `gh api --method POST repos/<owner>/<repo>/pages -f build_type=workflow` | `deploy-pages` 报 Pages 未启用 |
| 2 | 配 `EDGEONE_API_TOKEN` | `gh secret set EDGEONE_API_TOKEN --repo <owner>/<repo> --body "$(从 ~/.edgeone/<hash> 取 .value.Token)"` | EdgeOne 部署鉴权失败 |
| 3 | 确认 workflow 可解析 | 手动 `gh workflow run <file>.yml --ref main` | 见下方坑 ① |

### 坑 ①：`secrets` 上下文不能用于 job 级 `if`（会静默掐掉全部部署）

```yaml
# ❌ 错误：GitHub 拒绝解析整个 workflow，run 启动 0 个 job
if: github.ref == 'refs/heads/main' && secrets.CLOUDBASE_SECRET_ID != ''
```

表现极具误导性：**Pages / EdgeOne 两个部署 job 都不跑，run 状态 failure 但无任何日志**。
只有手动 dispatch 才能拿到真实报错（HTTP 422 `Unrecognized named-value: 'secrets'`）。
正确写法是 job 级 `env` 承接、step 级 `if` 判断：

```yaml
if: github.ref == 'refs/heads/main'
env:
  HAS_CLOUDBASE: ${{ secrets.CLOUDBASE_SECRET_ID != '' && secrets.CLOUDBASE_ENV_ID != '' }}
steps:
  - run: echo "跳过"
    if: env.HAS_CLOUDBASE != 'true'
```

### 坑 ②：EdgeOne 默认域名裸访问返回 401 ≠ 部署失败

`curl https://<project>.edgeone.cool/` 直接 401，页面文字为
`Access Restricted or Authentication Expired`。这是 EdgeOne 对默认子域开启的访问保护，
**部署本身是成功的**。判断真伪看 CI 日志里的 `Deploy Success` + `Deploy URL`。
要裸域名可访问，需在 EdgeOne 控制台关闭该项目的访问限制，或绑定自有域名。

### 坑 ③：仓库删除会让 npm 包变成孤儿包

`gh api user/packages/npm/mim` 的 `repository` 字段会变成 `null`，但包本身仍在。
用同名仓库重新发布即可重新关联，包版本不受影响。
