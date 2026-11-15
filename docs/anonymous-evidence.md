# 前端匿名取证：可重复执行步骤

对应脚本：[verify-anonymous-evidence.mjs](../scripts/verify-anonymous-evidence.mjs)。

脚本用无头 Chromium（Chrome / Edge）+ 直接 HTTP 探测，验证 Mim 在**完全未登录**时：

- 该放行的读接口与页面正常放行；
- 该拦截的写动作、私密读、管理接口被稳定拦截（401 + `AUTH_UNAUTHORIZED`）；
- 已认证响应不会被公共缓存；
- 整轮匿名浏览不会往库里写入用户或浏览去重记录。

脚本零第三方依赖、只读探测、不创建业务数据，也不修改任何业务代码。

---

## 1. 前置条件

| 项 | 要求 | 自查方式 |
| --- | --- | --- |
| Node.js | 22 及以上（需要全局 `fetch`、全局 `WebSocket`、`node:sqlite`） | `node --version` |
| 浏览器 | 本机安装 Chrome 或 Edge；也可用 `MIM_EVIDENCE_BROWSER` 指定可执行文件 | 直接运行脚本，报"未找到 Chrome/Edge"即为缺失 |
| 目标版本 | 目标环境已部署**包含社区路由**的版本 | `curl -sk -o NUL -w "%{http_code}" "https://laal.top/api/v1/community/threads?limit=1"` 应为 `200` |
| 同源托管 | `/admin/` 必须由同一反向代理指向 admin 静态站点（nginx 常见做法） | 浏览器打开 `https://<站点>/admin/` 应看到「Mim 管理后台」登录卡片 |
| 网络 | 能访问目标站点的 HTML、`/api/v1/*`、以及媒体域名（不影响判定，只影响页面渲染速度） | — |

> 若 `/api/v1/community/threads` 返回 `404` 且信封是 `{"error":{"code":"NOT_FOUND",...}}`，说明目标环境跑的是**早于社区路由的旧版本**。这是真实的部署缺口，不是脚本缺陷；先部署再取证。

数据库与令牌都是**可选增强项**，不提供时对应检查项会明确 `SKIP`，不会被伪造成 `PASS`。

---

## 2. 环境变量

脚本不接收命令行参数，全部通过环境变量配置；**凭据只从环境变量读取**，不写入任何文件，输出里也只打印"已提供 / 未提供"。

| 变量 | 必需 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `MIM_EVIDENCE_WEB_BASE` | 否 | `https://laal.top` | 前端站点根地址，用于页面层验收 |
| `MIM_EVIDENCE_API_BASE` | 否 | `${WEB_BASE}/api/v1` | API 根地址；跨域部署（如 `https://api.example.com/api/v1`）时单独指定 |
| `MIM_EVIDENCE_BROWSER` | 否 | 自动探测 | Chrome / Edge 可执行文件绝对路径 |
| `MIM_EVIDENCE_CDP` | 否 | 空 | 复用已存在的 CDP 端点（如 `http://127.0.0.1:9222`），此时不自动启动浏览器 |
| `MIM_EVIDENCE_AUTH_TOKEN` | 否 | 空 | 普通用户 Bearer 令牌，用于 L2-9 / L2-10 |
| `MIM_EVIDENCE_ADMIN_TOKEN` | 否 | 空（回退 `MIM_ADMIN_TOKEN`） | 超管引导令牌，用于没有库文件时读取 `users` 总数 |
| `MIM_EVIDENCE_DB_PATH` | 否 | 空 | SQLite 库文件路径，只读打开，用于精确污染检查 |
| `MIM_EVIDENCE_TIMEOUT_MS` | 否 | `20000` | 单个等待步骤的超时（下限 3000） |
| `MIM_EVIDENCE_KEEP_BROWSER` | 否 | 空 | 设为 `1` 时保留浏览器进程与临时 profile，便于排查 |

注意：`MIM_EVIDENCE_API_BASE` 已经包含 `/api/v1`，不要再拼一次。

---

## 3. 执行命令

最小取证（匿名接口 + 页面 + 清洁上下文）：

```powershell
node scripts/verify-anonymous-evidence.mjs
```

指定环境（预发 / 自建域名 / 本地）：

```powershell
$env:MIM_EVIDENCE_WEB_BASE = "https://laal.top"
node scripts/verify-anonymous-evidence.mjs
```

完整取证（认证缓存头 + 精确污染检查）：

```powershell
$env:MIM_EVIDENCE_WEB_BASE  = "https://laal.top"
$env:MIM_EVIDENCE_DB_PATH   = "services/mim-api/data/mim.db"   # 目标环境真实库文件
$env:MIM_EVIDENCE_AUTH_TOKEN = "<普通用户 Bearer，勿写入仓库>"
node scripts/verify-anonymous-evidence.mjs
```

跨域 API：

```powershell
$env:MIM_EVIDENCE_WEB_BASE = "https://laal.top"
$env:MIM_EVIDENCE_API_BASE = "https://api.laal.top/api/v1"
node scripts/verify-anonymous-evidence.mjs
```

Linux / macOS 把 `$env:X = "..."` 换成 `X=... node ...` 即可。

---

## 4. 逐项判据

脚本会自己创建一个**全新临时 profile** 的无头浏览器（不复用本机登录态），先取列表数据，再按下列顺序输出 `PASS / FAIL / SKIP`。

### L1 清洁上下文（在点击任何元素之前）

| 编号 | 判据 | 通过条件 |
| --- | --- | --- |
| L1-1 | 无 Cookie | CDP `Network.getAllCookies` 返回空，且 `document.cookie` 为空串 |
| L1-2 | 无 localStorage | `Object.keys(localStorage).length === 0` |
| L1-3 | 无 sessionStorage | `Object.keys(sessionStorage).length === 0` |

### L2 接口层

| 编号 | 请求 | 通过条件 |
| --- | --- | --- |
| L2-1 | `GET /community/threads?limit=12` | `200` |
| L2-2 | `GET /community/threads/:id` | 前 8 条中至少一条 `200` |
| L2-3 | 对照组：`GET /community/threads` | `200`（与 L2-4 同路径对照） |
| L2-4 | 对照组：`POST /community/threads` | `401` 且响应体顶层 `code === "AUTH_UNAUTHORIZED"` |
| L2-5 | `POST /community/threads/:id/like` | 同上 |
| L2-6 | `GET /me` | 同上 |
| L2-7 | `GET /community/favorites` | 同上 |
| L2-8 | `GET /admin/users?limit=1&offset=0` | `401` + `code=AUTH_UNAUTHORIZED` + `Content-Type: application/json` + 响应体不是 HTML |
| L2-9 | `GET /me`（带 Bearer） | `200`，证明令牌真实有效 |
| L2-10 | `GET /community/threads?limit=1`（带 Bearer） | `200`，且 `Cache-Control` 同时含 `private` 与 `no-store`，且**不得**含 `public` + `max-age` |

L2-3 / L2-4 是必须保留的对照组：同一个路径，GET 放行、POST 拦截，才能证明拦截发生在写入门禁而不是整条路由被禁。

L2-8 特别要求 JSON：若返回 `404`，说明管理路由没注册或反向代理没转发；若返回登录页 HTML，说明前端兜底把接口 404 吞掉了——两者都判 `FAIL`。

L2-10 只针对**已认证**响应。匿名响应的 `Cache-Control: public, max-age=60` 是当前设计，不属于缺陷。

### L3 页面层

脚本把列表里第一条 `unlocked === true` 且正文非空的帖子作为深链目标。

| 编号 | 场景 | 通过条件 |
| --- | --- | --- |
| L3-1 | 匿名打开 `/community` | 最终 `location.pathname` 仍是 `/community`（尾部斜杠已归一化），不被改写到 `/signin` |
| L3-2 | 列表渲染 | `.community-card` 数量 > 0，且页面正文 > 50 字符 |
| L3-3 | 深链 `/community/post/:id` | 最终路径与期望路径一致，不被改写 |
| L3-4 | 深链正文 | `.community-detail-body` 去空白后非空 |
| L3-5 | 匿名点赞 | 点击含「点赞 / 已赞」的按钮后跳转 `/signin`，或页面出现 `.auth-wrap` 登录卡片 |
| L3-6 | 匿名打开 `/admin/` | 路径以 `/admin` 开头，且出现 `.login-card` 与文案「Mim 管理后台」 |

### L4 污染检查

基线在 L2 完成后读取，终值在浏览器动作全部完成后读取。

| 编号 | 数据源 | 通过条件 |
| --- | --- | --- |
| L4-1 | `MIM_EVIDENCE_DB_PATH` 的 `users` 计数；无库时回退超管接口 `total` | 终值 == 基线 |
| L4-2 | 库内 `community_thread_views WHERE user_id = ''`；无库时对比帖子 `views` | 库模式：终值 == 基线；无库模式：`views` 不增只能 `SKIP`（弱证据） |

L4-2 无库时的 `SKIP` 是刻意的：`views` 不增长也可能是因为历史上已经存在匿名去重行，不能据此证明"这次没有写账本"。

---

## 5. 输出与退出码

- 每项实时打印一行：`[PASS|FAIL|SKIP] 编号 名称 — 证据`；
- 证据串固定包含 `方法 URL -> 实际状态码`，并按可用性追加 `content-type=`、`code=`、`cache-control=`；
- 末尾打印 `汇总：PASS n / FAIL n / SKIP n`、失败明细、跳过明细。

| 退出码 | 含义 |
| --- | --- |
| `0` | 没有 FAIL（允许 SKIP） |
| `1` | 至少一项 FAIL |
| `2` | 前置条件 / 配置错误（Node 版本、浏览器缺失、库文件不存在、地址非法等） |

CI 里可直接用退出码判定，`SKIP` 不会让流水线变红，但会在日志里列出缺少哪些环境变量。

---

## 6. 常见误判

1. **深链正文为空就判页面坏了**：脚本会自动挑 `unlocked === true` 的免费帖；如果前 8 条全是付费锁帖，L3-3/3-4/3-5 会 `SKIP` 而不是 `FAIL`。若出现 `FAIL` 且正文为 0，先确认该帖是否在服务端被锁定。
2. **L4-1 计数漂移**：取证窗口内有真人注册、后台建号或另一个部署在写同一个库，`users` 会变。请选低峰窗口，或用只读库 + 快照，不要一边做注册压测一边取证。
3. **令牌过期**：`MIM_EVIDENCE_AUTH_TOKEN` 无效时 L2-9 直接 `FAIL`，L2-10 转为 `SKIP`，不会被误报成缓存配置问题。重新取一个新令牌即可。
4. **`Cache-Control` 显示"（缺失）"**：常见于脚本和 API 之间还有一层本地代理 / CDN，只回传了部分响应头。用直连 API 的地址（`MIM_EVIDENCE_API_BASE`）复核，不要急着改服务端。
5. **把匿名响应的 `public, max-age=60` 当成缺陷**：只有带 `Authorization` 的响应必须 `private, no-store`。L2-1 的 `public` 是预期行为。
6. **`/admin/` 打不开或返回社区前端**：反代没有把 `/admin` 指到 admin 静态目录。注意仓库自带的 `scripts/serve-local.mjs` 只托管 `apps/web/dist`，**不含** admin，所以本地用它跑必然 L3-6 失败，这是本地环境的限制。
7. **L2-8 返回 404**：管理路由未注册，或反向代理只转发了 `/api/` 没有覆盖 `/api/v1/admin`；也可能命中了 SPA 兜底。看证据串里的 `content-type` 即可区分。
8. **401 与 403 混用**：本项目契约是匿名访问返回 `401 + AUTH_UNAUTHORIZED`；`403` 表示"已认证但无权限"，出现在匿名场景同样判 `FAIL`。
9. **复用了不干净的浏览器**：指定 `MIM_EVIDENCE_CDP` 时，浏览器会继承已有 Cookie / Storage，L1 必然失败。常规取证不要用这个变量，让脚本自己起临时 profile。
10. **WAF / 人机校验**：网关返回 `403`、`503` 或 HTML 挑战页时，L2、L3 会成片失败。先 `curl` 看是不是被拦截，再重跑。
11. **地址拼错**：`MIM_EVIDENCE_API_BASE` 应填到 `/api/v1` 为止；带尾斜杠会被脚本归一化，但重复拼 `/api/v1/api/v1` 不会。
12. **目标环境版本偏旧**：`/api/v1/community/*` 返回 `404 NOT_FOUND` 是真实的部署缺口。先确认线上版本，再决定是部署还是取证。

---

## 7. 取证留档

建议把以下内容一起贴到工单 / 发布记录：

1. 完整标准输出（含每项证据串）；
2. `退出码`；
3. 本次使用的 `WEB_BASE` / `API_BASE` 与是否提供 DB、令牌（**不要贴令牌值**）；
4. 若存在 `SKIP`，写明补齐计划（补库路径 / 补令牌 / 换低峰窗口）。
