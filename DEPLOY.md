# Mim 部署指南（GitHub Pages / GitHub Packages / EdgeOne Makers / Supabase）

本项目已配置一条完整的 CI/CD 流水线：[.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)。

> 本文是**作者自己维护线上站**的操作手册（以 `afdk1991/mim` 与作者 Supabase 项目为前提）。
> 若你是拿到源码的部署方 / 买家，请改看 [INSTALL.md](INSTALL.md)：从零建库、配环境变量、
> 以及必须改掉的 8 处作者绑定点。

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

后端优先级（`src/lib/supabase.ts` 自动选择，可用 `VITE_MIM_BACKEND=supabase|cloudbase` 强制指定）：

```
Supabase（配了 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY）
  → CloudBase（仅配 VITE_MIM_API_BASE）
    → 两者皆无：启动即渲染配置错误页（无本地兜底模式）
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

#### 迁移状态（2026-10-28 实测 · 以 `npm run db:probe` 为准）

> 此前本节写的是「2026-10-25 已全部应用」，与实测不符 —— 原因是 CI 的 `migrate-db` job
> 在未配 `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` 时**整段跳过且不报错**，
> job 仍显示 success。因此**任何时候都应以 `npm run db:probe` 的只读探测结果为准**，
> 不要以 CI 绿灯判断迁移已落地。

| 迁移 | 内容 | 线上状态 |
| --- | --- | --- |
| `0000_schema.sql` | 20 张业务表基线 + RLS + `send_message` / `bump_*` | ✅ 已应用 |
| `0001_iam_phase1.sql` | IAM 四表 + 审计日志 + RBAC 种子（4 角色 / 6 权限） | ✅ 已应用 |
| `0002_storage_media.sql` | 私有桶 `mim-media` + 存储 RLS（3MB + MIME 白名单） | ✅ 已应用 |
| `0003_account_bridge.sql` | 账号桥表 + `username_taken` / `claim_username` RPC | ✅ 已应用 |
| `0004_post_rich_fields.sql` | posts 富媒体字段（media/vote/lottery/visibility/pinned 等） | ✅ 已应用 |
| `0005_mall_catalog.sql` | products 商城字段扩展（不含任何商品数据） | ✅ 已应用 |
| `0006_wallet.sql` | 钱包表 + `wallet_state` / `wallet_debit` / `wallet_credit` | ✅ 已应用 |
| `0007_growth.sql` | 成长体系 + `growth_state` / `growth_record` / `growth_checkin` | ✅ 已应用 |
| `0008_mall.sql` | `mall_orders` + `confirm_order` | ❌ **未应用**（线上缺表与函数） |
| `0009_price_rec.sql` | `price_quotes` / `rec_feedback` + `price_latest` / `rec_feedback_*` | ❌ **未应用** |
| `0010_admin_bootstrap.sql` | `has_any_admin` / `bootstrap_admin` / `grant_admin_by_name` | ❌ **未应用** |
| `0011_mall_ops_key.sql` | `mall_ops_config` + `verify_ops_key` / `set_mall_ops_key` + `ops_key_ready` | ❌ **未应用** |

补齐（零凭证，SQL Editor）：

```bash
npm run db:gen-pending -- 0008     # 生成 supabase/apply-pending-manual.sql
# 全文粘贴到 Dashboard → SQL Editor → Run（幂等，可重复执行，不触碰既有数据）
```

影响面：上述四个迁移未落地时，**商城云端订单、价格行情快照、推荐负反馈同城、
`/#/admin` 首个管理员引导**均处于失效状态（前端会静默降级或报错）。

执行方式（后续新增迁移同样适用）：

```powershell
# A. 云端通道（推荐，无需数据库密码）
$env:SUPABASE_ACCESS_TOKEN="sbp_..."      # Dashboard → Account → Access Tokens
$env:SUPABASE_PROJECT_REF="sepfobukokrrivwyvhnd"
npm run db:apply:remote                    # 按序应用全部迁移（已应用的自动跳过）

# B. 本地通道（需要数据库连接串）
$env:SUPABASE_DB_URL="postgresql://postgres.<ref>:<密码>@aws-0-<区域>.pooler.supabase.com:5432/postgres"
$env:ADMIN_EMAIL="you@example.com"        # 可选：给该注册邮箱授予 admin 角色
npm run db:apply
```

> 两个通道共用 `scripts/lib/migration-plan.mjs` 统一计划；SQL 均为幂等写法
> （`add column if not exists` / DO 块约束 / `on conflict`），重复执行安全。
> 注意：PostgreSQL 的 `ADD CONSTRAINT` **不支持** `IF NOT EXISTS`，
> 0004/0005 已改用 DO 块 + `duplicate_object` 异常处理实现幂等。

#### 本地开发

`.env`（模板见 `.env.example`，仓库已内置同值兜底常量）：

```ini
VITE_SUPABASE_URL=https://sepfobukokrrivwyvhnd.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg
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

`.env` 中写入（模板见 `.env.example`；**必须至少配置一组云端**，两者皆无时应用启动即渲染
配置错误页，不再回退本地模式。CI 已内联注入两组公开配置，无需再配 GitHub Secrets）：

```ini
# 主后端（Supabase 直连）
VITE_SUPABASE_URL=https://sepfobukokrrivwyvhnd.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg
# 备后端（仅在不配 Supabase 时生效）
# VITE_MIM_API_BASE=https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mim-api
# 强制指定后端（可选）：supabase / cloudbase（缺省按上表优先级自动选择）
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

`supabase/functions/` 有变更时 CI 自动部署并同步运行密钥；手动部署（三选一）：

```powershell
# A. 远程脚本（推荐，无需安装 CLI / Docker）
node scripts/deploy-supabase-function.mjs
#   Access Token 来源：环境变量 SUPABASE_ACCESS_TOKEN
#   （原 browser-shots/supabase-access-token.txt 明文令牌文件已在测试产物清理中移除，
#     不再落盘明文凭据；需要时以 node scripts/supabase-grab-keys.mjs 重新抓取到该 gitignore 目录，
#     用后即删）

# B. Supabase CLI
npm install -g supabase
supabase functions deploy mim-api --project-ref <ref>

# C. Supabase Dashboard → Edge Functions → 新建 mim-api，粘贴源码
```

> **function secrets 注意事项**：平台**禁止** secret 名以 `SUPABASE_` 开头
> （`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 由
> Edge Runtime 自动注入，手动设置会报 400）。故只需设置自定义的 `MIM_TOKEN_SECRET`：
> `scripts/deploy-supabase-function.mjs` 已按此规则处理（随机生成并写入）。

部署后把前端指向它即可走备路径：`VITE_MIM_API_BASE=https://<ref>.supabase.co/functions/v1/mim-api`。

### CloudBase ↔ Supabase 账号体系同步（账号桥）

两套后端各有独立账号体系（CloudBase：`app_users`，`uid=u_xxx`，PBKDF2-SHA512 密码哈希；
Supabase：GoTrue `auth.users`，uuid，bcrypt）。**账号桥**把两者在用户名维度合并为同一空间：

| 场景 | 机制 |
| --- | --- |
| Supabase 侧注册 | 先调 RPC `username_taken` 全局查重（覆盖 CloudBase 桥接账号）→ 成功后 fire-and-forget 双写 CloudBase `/auth/register`（切回备后端时账号仍在） |
| CloudBase 侧注册 | 先问 Supabase `username_taken`（占用则 409；**查询失败放行**，不因主后端不可用拒绝注册）→ 成功后 `claim_username` 把 用户名/哈希/salt/uid 登记进 `account_bridge` |
| CloudBase 老账号在 Supabase 登录 | 原生登录失败 → Edge Function `/auth/bridge-login` 验 PBKDF2 旧哈希（与 CloudBase 版同参）→ 通过则 Admin API **自动落户** → 前端用原密码重试即成功，此后完全原生 |
| 存量账号搬迁 | `npm run sync:accounts`（dry-run 默认，`--apply` 执行）把 CloudBase `app_users` 全量灌入 `account_bridge`，幂等 |

安全要点（`account_bridge` 对客户端**禁 select**，仅 Edge Function 以 service_role 读取）：

- 桥接登录**只可新建** GoTrue 账号；合成邮箱账号已存在时一律 409，**绝不修改对方密码**
  ——否则知道 CloudBase 旧密码的人可接管同名 Supabase 账号；
- 防爆破：同一用户名连续失败 5 次锁定 15 分钟（`failed_attempts` / `locked_until`）；
- `username_taken` / `claim_username` 为 `security definer` RPC，anon 可调——
  与开放注册同暴露面（抢注用户名本就是开放注册允许的行为）。

启用清单（2026-10-25 已全部落地）：

1. ✅ 迁移 `0003_account_bridge.sql` 已应用（`username_taken` RPC 实测可用）；
2. ✅ Edge Function mim-api 已通过 Management API 部署上线（`/auth/bridge-login`
   等全路由实测 200，`MIM_TOKEN_SECRET` 已写入 function secrets）；
3. ✅ CloudBase 侧 mim-api 已重新部署（注册链路接全局查重 + 桥接登记）；
4. （可选，搬迁存量账号）`CLOUDBASE_SERVICE_KEY` + `SUPABASE_SERVICE_ROLE_KEY`（或
   `SUPABASE_DB_URL`）后执行 `npm run sync:accounts`。

> 线上账号现状：CloudBase 与 Supabase 两边的测试号已全部清零（app_users / auth.users
> 均为 0），账号桥随新用户注册自动开始积累记录。

### 管理后台权限（`#/admin`）

注册只自动分配 `user` 角色，必须显式授权才能进后台（`user_roles` 写策略要求调用者已是 admin）。
迁移 `0010_admin_bootstrap.sql` 提供四条通道（详见 `INSTALL.md` §3）：

| 通道 | 命令 / 操作 |
|---|---|
| 前端自助 | 登录后开 `#/admin` → 系统无管理员时出现「👑 成为首个管理员」（RPC `bootstrap_admin()`，门自动关闭） |
| SQL Editor | 粘贴 `supabase/grant-admin.sql`，替换用户名执行（`grant_admin_by_name()`） |
| 脚本 | `npm run admin:grant -- <用户名>`（`--list` / `--who`；需 `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`） |
| CI | Secrets 设 `ADMIN_EMAIL=<注册邮箱>`，push main 随迁移自动授予 |

同时修正了 `0008_mall.sql` 中 `is_admin(uuid)` 误用 `user_roles.role` 列（实际为 `role_id`
外键）导致的运行时报错——该 bug 会让商城订单核销恒失败。

## 部署矩阵

| 事件 | 动作 |
| --- | --- |
| Push 到 `main` | 类型检查 → 构建 → 自动部署 **GitHub Pages** + **EdgeOne Makers** |
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

### 3. 配置 EdgeOne Makers（腾讯云免费托管）

1. 打开 [EdgeOne Makers 控制台](https://console.cloud.tencent.com/edgeone/pages) 并开通服务；
2. 在控制台生成 **API Token**（参考官方文档 [API Token](https://edgeone.cloud.tencent.com/pages/document/176921267881082880)）；
3. 回到 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**：
   - Name：`EDGEONE_API_TOKEN`
   - Secret：粘贴刚才的 Token；
4. 项目名默认为 `mim`（项目不存在会自动创建）。如需改名，编辑
   [.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml) 中 `deploy-edgeone` 的 `EDGEONE_PROJECT_NAME`。

配置完成后，push main 即自动把 `dist/` 通过官方 CLI `edgeone makers deploy` 发布上线。

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
git push          # 自动构建并同步上线 GitHub Pages + EdgeOne Makers
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
edgeone makers deploy -n mim -t "$EDGEONE_API_TOKEN"
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
