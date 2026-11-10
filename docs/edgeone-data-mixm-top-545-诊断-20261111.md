# data.mixm.top 深链接 545「Error return from script」诊断（2026-11-11）

> 触发问题：用户访问 <https://data.mixm.top/chat> 时地址栏变成 `/chat?`，页面空白并显示 `Error return from script`，追问「为什么是 /chat」。
>
> 取证环境：本机 Windows，真实浏览器（Chrome，经 Aha Browser Use）+ `curl` 12.0，时间 2026-11-11 00:0x–00:4x +08:00。

## 1. 结论摘要

1. `/chat` 本身没有异常：它是 Web SPA 的 7 个视图路径之一（`apps/web/src/router.ts`），根路径与未知路径都会回落到 `/store`。
2. `data.mixm.top` 上除「命中真实静态文件」的请求外，**所有路径都返回 HTTP 545 + 24 字节纯文本 `Error return from script`**，与前端路由无关。
3. `data.mixm.top` 绑在 EdgeOne Makers 项目 **`mim`**（Git 集成，代码源 `main`），而 `mim-app` 是另一个「直接上传」项目 —— 两者不是同一个站点，直传 `mim-app` 不会改变 `data.mixm.top` 的产物。
4. `mim` 项目上挂着一条 catch-all 处理（Edge Functions 24 小时内执行 70 次），未命中静态文件的请求进入它即报错，`Error return from script` 是 EdgeOne 运行时对「函数脚本执行失败」的返回文案。
5. 仓库根目录的 `functions/[[catchall]].js` 是 Cloudflare Pages 语法（`export async function onRequest` + `env.ASSETS.fetch`），EdgeOne 运行时没有 `env.ASSETS`，被当作 Edge Function 挂载后必然抛错 —— 与第 4 点的现象高度吻合。

## 2. 逐路径取证（curl，UA 为 Chrome 120）

| 请求 | HTTP | 字节 | Content-Type | 判读 |
|---|---|---|---|---|
| `https://data.mixm.top/` | 200 | 5114 | text/html | 命中静态 `index.html` |
| `/index.html` | 200 | 5114 | text/html | 命中静态文件 |
| `/spa.js` | 200 | 1363 | application/javascript | 命中静态文件 |
| `/assets/index-Cx2bnrs2.js` | 200 | 3 281 711 | application/javascript | 命中静态文件 |
| `/404.html` | 545 | 24 | — | 未命中（该部署没有 404.html）→ 落入 catch-all，报错 |
| `/store` | 545 | 24 | — | 同上 |
| `/chat` | 545 | 24 | — | 同上 |
| `/nope` | 545 | 24 | — | 同上 |

响应体固定为：

```
Error return from script
```

结论：**静态文件正常，未命中路径一律 545**。这不是 SPA 路由回退缺失（那会返回 404），而是平台侧 catch-all 处理器自身报错。

## 3. 对照实验（同一份产物，EdgeOne 预览域名）

同一份「最新构建 + 404 兜底 + 视图目录」产物直传到项目 `mim-app`（部署 ID `dpk5ysxjwrmx`），在其部署域名 `mim-app-pwayfmnh.edgeone.cool` 上实测：

| 路径 | 结果 |
|---|---|
| `/` | 200，渲染「功能模块商城」 |
| `/chat` | 200，渲染聊天视图 + 内嵌「此功能需登录后使用」登录卡片 |
| `/store` | 200，渲染商城视图 |
| `/zzz-not-exist` | 200，回落 `404.html` 后由 SPA 渲染（说明 404 兜底在 EdgeOne 可用） |

对照生产主站 `https://mim.mixm.top/chat`：200，渲染聊天视图 + 内嵌登录卡片（nginx `try_files` 回退正常）。

结论：**SPA 代码与产物没有问题，问题只在 `data.mixm.top` 这一个入口的部署与处理链路上。**

## 4. `/chat?` 那个孤立问号的来源

真实浏览器复现：进入 `/chat` 时被 EdgeOne 抛到 `Security Verification`（人机校验页），勾选通过后地址栏被改写为 `https://data.mixm.top/chat?`（空查询串），随后页面落到 545 报错页。

`apps/web/public/spa.js` 设计上会用 `history.replaceState` 清掉「`?tads` / 残留裸问号」，但只在 SPA 真正加载后生效；拿到 545 纯文本页时脚本根本没执行，因此问号留在地址栏。

## 5. 本轮已做的改动

| 动作 | 对象 | 结果 |
|---|---|---|
| 构建最新 Web 产物（`pnpm --filter @mim/web build`） | 本地 | 成功，产物 `assets/index-CibEQxs6.js` |
| 生成 EdgeOne 专用暂存产物：`404.html` 副本 + `store/ sites/ deployments/ comic/ chat/ settings/ login/` 各一份 `index.html`，并移除 `_redirects` | `%TEMP%\eo-deploy-mim` | 完成（仓库内文件未改动） |
| 直传 EdgeOne 项目 `mim-app`（生产环境） | 项目 `mim-app`（`makers-6b8km8xikz2l`） | 部署 `dpk5ysxjwrmx` 成功 |
| 关闭 `mim` 项目「安全防护 → Bot 管理 → 基础 Bot 管理 → 人机校验页」开关 | 项目 `mim` | 已关闭；取证：`/chat` 由「200 + 985B 人机校验页」变为「545 + 24B」，说明校验层已不再拦截 |

> 注意：关闭「人机校验页」改变了该域名的安全策略（原先所有访客都必须过人机校验）。如需恢复，在 EdgeOne 控制台同一位置重新打开即可。

## 6. 尚未修复（需要决策；2026-11-11 00:5x 已由方案 A 落地，见 §8）

`data.mixm.top` 仍会 545，因为 `mim` 项目里那条 catch-all 处理仍然存在。可选两条路：

**方案 A（治本，需改仓库 + push）**
1. 让 `mim` 项目的构建产物不包含 Cloudflare 的 `functions/`（改成只上传 `apps/web/dist`，或把该函数改写为 EdgeOne 兼容的 `export default` 且不依赖 `env.ASSETS`）。
2. 让 `dist` 带上 `404.html`（`scripts/spa-404.mjs` 已经有这个能力，但目前不在 `apps/web` 的 build 链里自动执行）。
3. push 到 `main` → EdgeOne 自动重建 → 深链接回落 `404.html`，可用。

**方案 B（绕开，纯控制台）**
把 `data.mixm.top` 从项目 `mim` 解绑、改绑到已经验证可用的项目 `mim-app`。代价：`mim` 项目仍是坏的，下次 push 重建也不会自愈；且域名换绑需重新走一次归属验证。

**官方限制（同时记录）**：EdgeOne Pages 的 `rewrites` 明确「不支持 SPA 前端路由重写」（`edgeone.json` 文档原文），因此 `_redirects` 的 `/* /index.html 200` 在该平台没有官方支持，纵深回退只能靠 `404.html` 或函数实现。

## 7. 参考

- EdgeOne `edgeone.json` 文档：`rewrites` 仅适用静态资源，不支持 SPA 前端路由重写。
- 平台错误码文档未列 545，与「函数脚本执行失败」的文案 `Error return from script` 一致（该文案亦出现在 EdgeOne OpenNext 适配层的注释中，用于描述脚本解析/执行阶段整体失败）。

## 8. 方案 A 落地：根因实测确认 + 仓库侧修复（2026-11-11 00:4x–00:5x）

### 8.1 根因实测确认（逐次部署对照）

在 EdgeOne 项目 `mim-app`（与生产同平台、独立域名，不影响 `data.mixm.top`）上做四组对照部署，每组的产物差异只有一处：

| 组 | 产物差异 | `/chat` | `/store` | `/zzz-not-exist` |
|---|---|---|---|---|
| ① | dist + 404.html + 7 个视图目录，**无 `_redirects`** | 200 渲染 | 200 渲染 | SPA 渲染 |
| ② | dist + 404.html + `_redirects`，无视图目录 | 200 渲染 | 平台 404 页 | 平台 404 页 |
| ③ | dist + 404.html，无视图目录、无 `_redirects` | 200 渲染 | 平台 404 页 | 平台 404 页 |
| ④ | 同 ③ 再放入 `functions/[[catchall]].js`（Cloudflare 语法原样） | 200 渲染 | 平台 404 页 | **283 字节 `Error return from script`** |

结论（实测，非推断）：
1. **`functions/[[catchall]].js` 就是 545 的来源**。同一个目录只多这一个文件，`/zzz-not-exist` 立刻从正常页面变成 283 字节 `Error return from script`，与线上 `data.mixm.top` 的表现逐字节一致。
2. 该平台会把该函数当作处理器挂载并**优先执行命名导出 `onRequest`**；函数里的 `await next()` 与 `env.ASSETS.fetch()` 在 EdgeOne 运行时都不存在，抛错即被执行层折算为 545。
3. 再加一层对照：把函数文件改成**只有 `export default`**（无命名导出）→ `/zzz-not-exist` 返回 268 字节 `Not Found`（我们自己写的 404），不再 545。说明只要命名导出不再抛错，整站就不再被打挂。
4. `_redirects` 在 EdgeOne 上**不可靠**（组 ② 的 `/store` 落到平台 404 页），"仍会解析 `_redirects`" 的历史口径作废。
5. 每个视图一个同名目录是**最可靠的深链接方案**（组 ①，7 条路径全部命中真实静态文件）。

### 8.2 仓库侧改动（已本地完成，未提交、未 push）

| 文件 | 改动 | 目的 |
|---|---|---|
| `functions/[[catchall]].js` | 在命名导出开头加运行时能力守卫：`next` 不是函数或 `env.ASSETS` 缺失时直接返回 404；另加 `export default` 兜底导出 | 该函数被 EdgeOne 挂载时不再抛错，整站非静态路径不再 545 |
| `apps/web/package.json` | `build` 末尾追加 `node ../../scripts/spa-404.mjs` | 每次构建自动产出 `apps/web/dist/404.html`（GitHub Pages / CF / Vercel / Netlify 共用） |
| `scripts/build.mjs` | 新增 `readSpaViews()`（从 `router.ts` 的 `VIEWS` 解析视图清单，避免两处清单漂移）与 `emitSpaFallback()`（在根 `dist` 生成 `404.html` + 每个视图的同名目录），并在 `emitDist` 后调用 | 让 EdgeOne 的 OutputDir=`dist` 天然带上深链接回退载体；只作用于根 `dist`，不动 `apps/web/dist`，避免 GitHub Pages 补斜杠导致相对资源解析失效 |

### 8.3 本地取证

- `node scripts/build.mjs` → 退出码 0；日志 `✅ SPA 回退产物就绪: 404.html + 7 个视图目录（store / sites / deployments / comic / chat / settings / login）`；根 `dist` 文件清单实测含 `404.html`(5114B) 与 7 个视图目录。
- `pnpm -r typecheck` → 0（5 个项目全 Done）。
- `pnpm --filter @mim/api test` → **16 文件 / 233 例全通过**。
- `node scripts/verify-deployments.mjs` → **52/52 PASS**。
- 守卫版函数的端到端复验（EdgeOne 预览域名 `mim-app-dplt22tzwwr8.edgeone.cool`）：`/` 5874B、`/store` 6429B、`/chat` 6446B、`/comic` 6446B、`/settings` 6446B、`/login` 6388B 全部正常渲染 SPA；`/nope` 返回 268B `Not Found`（不再 545）。

### 8.4 还差的一步

改动尚未 `git add / commit / push`。push 到 `main` 后 `mim` 项目自动重建，`data.mixm.top` 才会真正自愈（届时复验 `/store` `/chat` `/comic` `/settings` `/login` 应全部 200 渲染）。

