# Mim 线上域名访问地址与路由模式诊断报告

> 再后续变更（2026-11-08）：本文「hash 路由」与「全站会话门禁」两类结论已被同日两次改造取代——① 前端路由由 hash 重写为 history 路径路由（`/store` 等单段路径，旧 `#/xxx` 链接启动时 `replaceState` 改写，见 `apps/web/src/router.ts`）；② 门禁模型由整站强制登录改为按需登录（`/store` 匿名可浏览，`/comic` `/chat` `/settings` 匿名访问时内容区内嵌登录卡片），`scripts/verify-auth-gate.mjs` 已同步重写为按需登录静态断言 + 可选 `--live` 浏览器实测。

> 生成时间：2026-11-08 02:56 +08:00 ｜ 范围：`F:\合并项目\Mim` 全仓 + 部署矩阵内自有线上域名
> 本轮为**只读诊断**：不改代码、不改配置、不部署、不写凭据；线上仅对 README/AGENTS.md 已登记的自有域名发起 GET 首页与深链接探测，未扫描端口、未枚举路径、未探测未授权资产。

---

## 0. 结论先行

**根因不在 nginx / 平台回退配置，而在前端路由层：本项目从设计上就采用「零依赖 hash 路由」。**

`apps/web/src/router.ts` 用 `window.location.hash` + `hashchange` 事件驱动视图切换，`hrefOf()` 生成的地址一律是 `#/<view>` 或 `#/site/<key>`。浏览器**不会把 `#` 及其后内容发送给服务端**，所以服务端永远只收到 `GET /`（或 `/mim/`），所有功能模块共享同一个物理入口 `index.html`，路径部分恒定不变。

因此线上看到的是：

```
https://mim.mixm.top/#/store          ← 功能模块
https://mim.mixm.top/#/comic          ← 漫剧工作台
https://mim.mixm.top/#/site/www       ← 45 个站点节点之一
```

而不是：

```
https://mim.mixm.top/store
https://mim.mixm.top/comic
https://mim.mixm.top/site/www
```

这不是遗漏，是**为「一份产物挂 9 个免费静态平台」做的有意取舍**（`vite base: './'` 可挂任意子路径；hash 路由不需要任何服务端回退，天然适配 GitHub Pages / EdgeOne / IGA 等纯静态托管）。代价就是模块名进不了 URL 路径。

**两个最容易误判的点，先说清：**

1. **服务端回退配置其实大多已经有了**（nginx `try_files`、Vercel `rewrites`、Render `routes`、Cloudflare 内置回退），实测自建域名直接访问 `/site/www` 返回 **200 且与首页字节级一致**。但这些回退从未被 hash 路由触发 —— 配置不是根因。
2. **改 history 路由有两个硬阻塞**（本轮实测取证）：`vite base: './'` 相对资源路径在深链接下失效；GitHub Pages 无 `404.html` 回退，深链接直接 404。详见 §4、§7。

---

## 1. 线上域名资产台账（全部访问地址）

来源：`README.md` §多平台部署矩阵（150–164 行）、`AGENTS.md` 铁律九表格、`deploy/nginx-mim.conf` 注释。

| # | 平台 / 系统 | 访问地址 | 载体 | 当前实际 URL 形态 | 深链接回退实测（2026-11-08） |
|---|---|---|---|---|---|
| 1 | 腾讯云自建（生产主站） | `https://mim.mixm.top/` | 前后端 + SQLite + nginx | `https://mim.mixm.top/#/<view>`、`/#/site/<key>` | ✅ `/directory`、`/site/www` 均 200 且字节级等同首页 |
| 2 | 同上·管理后台 | `https://mim.mixm.top/admin/` | `apps/admin` 静态产物 | **恒定 `/admin/`**（连 hash 都没有） | ✅ `/admin/` 200（LEN=1430） |
| 3 | 腾讯云 EdgeOne Pages | `https://data.mixm.top/` | 直传 `apps/web/dist` | `https://data.mixm.top/#/<view>` | ⚪ 首页 200 但 LEN=985 为 WAF 挑战页，真实内容需有头浏览器；回退能力无法判定 |
| 4 | GitHub Pages | `https://afdk1991.github.io/mim/` | 纯静态 | `.../mim/#/<view>`（子路径 `/mim/` + hash） | 🔴 `/mim/directory` → **404**（GitHub Pages 标准 404 页，无 `404.html`） |
| 5 | Cloudflare Pages | `https://mim-8ah.pages.dev/` | 静态 + `functions/api/[[path]].js` 反代 | `https://mim-8ah.pages.dev/#/<view>` | ✅ `/directory` → 200 且返回 `index.html`（平台内置 SPA 回退，仓库无 `_redirects`） |
| 6 | Vercel | `https://mim-puce.vercel.app/` | 静态 + `vercel.json` rewrites | `...vercel.app/#/<view>` | ⚪ 本机 `000`（DNS 污染，历史一致）；配置层已有全量回退，CI 有部署取证 |
| 7 | Sealos | `https://mim-i3ywsdfn.cloud.sealos.io/` | 纯 API 容器 | 无前端页面 | 不适用（`/` 404 `route GET / not found`，`/health` 200） |
| 8 | IGA Pages | `https://preview.iga-pages.com/`（带 `iga_token`） | 纯静态 | `#/<view>` | ⚪ 带 token 200；回退能力未实测 |
| 9 | GitHub 仓库 | `https://github.com/afdk1991/mim` | 源码 | 非 Web 应用入口 | 不适用 |
| 10 | GitHub Packages | `ghcr.io/afdk1991/mim-api` | 容器镜像 | 非 HTTP 站点 | 不适用 |
| 11 | Render（候选，未启用） | `https://mim-web.onrender.com` | Blueprint | — | 未启用；`render.yaml` 已配 `/* → /index.html` |
| 12 | 历史预览（已不在矩阵） | `https://mim-web-hcrop0f4.edgeone.cool` | 早期静态预览 | `#/<view>` | 带 `eo_token` 访问；本轮未探测 |
| 13 | 站点地图 45 个子域 | `https://<host>.mixm.top`（如 `www` / `gy` / `mall`） | **DNS 元数据展示** | ⚪ **不是本项目前端入口** | 不探测：`nginx-mim.conf:9-12` 明确「45 子域由各自服务承载，不要加通配 server_name 吸收其流量」 |

> **第 13 项是最常见的误解来源**：站点目录里每个模块卡片都显示一个 FQDN（如 `www.mixm.top`），但点击「进入模块」跳的是**站内 `#/site/www`**，不是那个域名。`SiteMap.tsx:170` 的 `https://${r.fqdn}` 只是逐条展示用的新标签外链。

---

## 2. 根因分析：四层链路逐层取证

### 2.1 路由模式层（根因本体）

| 配置位置 | 代码 / 证据 | 判定 |
|---|---|---|
| `apps/web/src/router.ts:25-33` | `parseHash(hash)` 把 `location.hash` 去掉 `#` 与前导 `/` 后按 `/` 拆段；`parts[0]==='site'` → 节点页，其余匹配 `VIEWS`；**未知/空一律回落 `store`** | 🔴 只认 hash，**完全不读 `location.pathname`** |
| `apps/web/src/router.ts:36-39` | `hrefOf()` 返回 `` `#/site/${key}` `` 或 `` `#/${view}` `` | 🔴 地址生成源头即 hash |
| `apps/web/src/router.ts:42-47` | `navigate()` 写 `window.location.hash = next` | 🔴 无 `pushState` |
| `apps/web/src/router.ts:50-67` | `useHashRoute()` 用 `useState` + `hashchange` 监听驱动视图 | 🔴 无 History API |
| `apps/web/src/main.tsx` | `createRoot(...).render(<StrictMode><App /></StrictMode>)` | 无 `BrowserRouter` / 无 Router 包裹 |
| `apps/web/src/App.tsx:43-44, 131-146, 173` | `const [route, go] = useHashRoute()`；6 个侧栏按钮 `onClick={() => go({view})}` | 🔴 侧栏是 `<button>` 而非 `<a href>`，地址只能由 `go()` 写 hash 产生 |

**线上 bundle 反证（最硬证据）**：拉取生产 `https://mim.mixm.top/assets/index-BYc40BEt.js`（217,698 B）统计：

| 标记 | 命中 |
|---|---|
| `hashchange` | 2 |
| `location.hash` | 1 |
| `#/site/`、`#/directory`、`#/sitemap` | 各 1 |
| `pushState` / `history.` | **0** |

→ 线上运行的代码确实是纯 hash 路由，零 History API。

### 2.2 入口页面层

| 配置位置 | 内容 | 判定 |
|---|---|---|
| `apps/web/index.html:89-90` | 全站唯一挂载点 `<div id="root">` + `/src/main.tsx` | 所有视图共用同一份 HTML |
| `apps/web/index.html:47` | 未登录门禁卡片 `link.href = '/#/login'` | 🔴 登录入口也是 hash |
| `apps/web/index.html:80` | 归一化脚本注释：「本站使用 `#/<view>` 与 `#/site/<key>` 节点路由，**非空时一律不动地址**」 | 🔴 设计契约白纸黑字 |
| `apps/web/index.html:82-83` | `if (hash === '' && ...)` 才用 `replaceState` 修正 `?tads` / 裸问号 | 该脚本只清查询串，**不参与路由** |
| `apps/admin/index.html` | 同样只有 `<div id="root">`，无路由脚本 | 后台独立入口 |
| `Mim-PRD.html:51`、`site/index.html:50`、`site/prd.html:51`、`dist/index.html:47`、`apps/web/dist/index.html:47` | 均含 `/#/login` | 🔴 hash 已扩散到 PRD / 离线站点 / 构建产物 |

> 静态文档页 `site/index.html` 另有 `href="#arch"` / `#p0` / `#roadmap` 锚点 —— 与 SPA hash 路由共用 `#` 符号，但不是路由，属易混淆项。

### 2.3 访问地址生成规则层（hash 被固化成 API 契约）

这是最容易被忽略、却决定改造工作量的一层：**hash 字符串不是前端临时拼的，是后端 API 下发的字段值**。

| 配置位置 | 内容 | 判定 |
|---|---|---|
| `services/mim-api/src/site-nodes.ts:155-158` | `routeKeyOf()`：`'@'` 在 URL hash 中是保留字符，映射为 `'root'` | 🔴 别名规则专为 hash 设计 |
| `services/mim-api/src/site-nodes.ts:168` | `route: \`#/site/${key}\`` —— **45 个节点的 `route` 字段直接写入 hash 字符串** | 🔴 服务端数据契约 |
| `services/mim-api/src/site.ts:229-230, 258` | `fqdnOf()` 生成 `https://<host>.mixm.top`，`urls` 给出 HTTPS 入口 | 这是展示用域名，不是前端路由 |
| `apps/web/src/api.ts:483-492` | `SiteNodeSpec.route: string; // 站内 hash 路由，如 #/site/www` | 🔴 契约类型注释固化 |
| `apps/web/src/views/SiteDirectory.tsx:119-123` | `<a href={item.node.route}>` —— 原样把 API 的 hash 值塞进 `href` | 🔴 未做路径转换 |
| `apps/web/src/views/SiteMap.tsx:184` | `<a href={item.node.route}>`「进入模块」 | 🔴 同上 |
| `services/mim-api/test/site-nodes.test.ts:48, 70, 143` | 断言 `route === '#/site/<key>'`、`'#/site/root'` | 🔴 契约测试锁死格式 |
| `scripts/verify-auth-gate.mjs:220, 247, 285, 305, 327` | 8 类视图 + 45 节点全量 hash 清单，浏览器直达 `BASE + '#/site/gy'` | 🔴 门禁验收脚本锁死格式 |
| `docs/wiki/07-functional-modules.md:346, 361` | 「零依赖 hash 路由」「`@ → root`，站内路由 `#/site/root`」 | 🔴 文档固化 |

**结论**：改路径不是改一个 `router.ts` 就完事，要连后端数据契约、前端两处 `href`、3 处契约测试、门禁验收脚本、Wiki 一起改（铁律七）。

### 2.4 服务端转发 / 回退配置层（非根因，但决定改造可行性）

| 配置位置 | 配置内容 | 实测 | 判定 |
|---|---|---|---|
| `deploy/nginx-mim.conf:128-130` | `location / { try_files $uri $uri/ /index.html; }` | `/directory`、`/site/www` → 200，LEN=2896，与首页 `diff -q` 一致 | ✅ **已具备 SPA 回退**，但从未被触发 |
| `deploy/nginx-mim.conf:117-125` | `location /admin/ { root /opt/mim; try_files $uri $uri/ /admin/index.html; }` | `/admin/` → 200 | ✅ 后台深链接回退已就绪 |
| `deploy/nginx-mim.conf:17` | `server_name mim.mixm.top;`（单域，注释禁止通配） | — | 45 子域流量不被吸收 |
| `vercel.json:12-15` | `/(.*) → /index.html`（`api/`、`/health` 规则在前） | 本机 000，CI 有部署取证 | ✅ 配置已有，未实测 |
| `render.yaml:41-50` | `/* → /index.html` | 未启用（候选 Blueprint） | ✅ 配置已有 |
| `functions/api/[[path]].js` | 仅 `/api/*` 同源反代到 `https://mim.mixm.top` | — | ⚪ 与页面路由无关 |
| Cloudflare Pages | 仓库**无** `_redirects`，靠平台内置 SPA 回退 | `/directory` → 200 且返回 `index.html` | 🟡 隐式能力，建议显式化 |
| GitHub Pages（`.github/workflows/deploy.yml` pages job） | `upload-pages-artifact` 直接上传 `apps/web/dist`；**无 `404.html`、无 `_redirects`** | `/mim/directory` → **404**「Page not found · GitHub Pages」 | 🔴 **改路径的硬阻塞** |
| EdgeOne / IGA | 直传 `dist`，仓库无 rewrites 配置 | WAF / token 遮挡 | ⚪ 无法判定 |
| Sealos | 纯 API 容器 | `/` 404 | 不适用 |

**关键推论**：服务端回退「有」不等于「路径可用」。当前即使深链接返回 200，前端 `parseHash('')` 仍回落到默认 `store` 视图 —— 因为前端根本不看 `pathname`。

---

## 3. 影响范围

| 范围 | 模块数 | 当前地址 | 具体影响 |
|---|---|---|---|
| 主站侧栏视图 | 6 + 登录伪视图 | `#/store` `#/comic` `#/chat` `#/sitemap` `#/directory` `#/settings` `#/login` | 路径恒为 `/`；`#` 后片段不参与 HTTP 请求 |
| 站点节点模块页 | **45** | `#/site/<key>`（`www` / `root` / `gy` / `mall` …） | 45 个「不同模块」在服务器日志里是同一个 `GET /`；无法按 URL 做灰度、缓存、鉴权、统计 |
| **管理后台** | **5** | **恒定 `/admin/`** | 更极端：`App.tsx:93` 用 `useState<ViewKey>('overview')` 切视图，**连 hash 都不写**。刷新回概览、无法收藏/分享具体页、前进后退失效、权限回收回落逻辑只存在于内存 |
| 站点目录 / 站点地图 | 2 个入口页 | `href={item.node.route}` | 45 张卡片全部指向同一路径下的不同 hash，不是独立 URL |
| 全站会话门禁 | 覆盖所有 hash | `apps/web/index.html:6-68` | 门禁脚本按 hash 直达内页设计（`verify-auth-gate.mjs` 全量覆盖 53 个入口） |
| 静态文档 / PRD | 4 份 HTML | `/#/login` + `#arch` 等锚点 | 同源符号混用；改路由需同步 |
| 测试 / 契约 / 文档 | 3 + 1 + 3 处 | hash 断言与描述 | 改造必须全量同步（铁律七） |

**用户体验层面的具体后果**：
- 🔴 复制地址栏分享「站点目录」给同事，对方拿到的是 `/#/directory`（能打开，但看起来不像一个模块地址）；
- 🔴 服务端无法按路径做访问控制 / CDN 缓存粒度 / 日志区分（安全自查报告 G4/G10 的 `/admin/` 前置控制也受影响）；
- 🔴 搜索引擎对 `#` 后内容不索引（后台已主动 `noindex`，主站则属隐性损失）；
- 🔴 后台刷新必定丢失当前视图，5 个管理页无法深链接；
- 🟡 站内栏目锚点被迫放弃：`SiteNodePage.tsx:47` 注释「不使用 hash 片段，避免污染 `#/site/<key>` 路由」，`jumpTo()` 改用 `scrollIntoView` —— `#` 被路由占用后，原生锚点能力被牺牲。

---

## 4. 线上表现 vs 预期路径（差异对照）

| 功能模块 | 当前线上地址（生产主站） | 预期路径（History 模式） | GitHub Pages 前缀差异 |
|---|---|---|---|
| 功能模块（默认） | `https://mim.mixm.top/` 或 `/#/store` | `/store` | `/mim/` → `/mim/store` |
| 漫剧 AI 剧 | `/#/comic` | `/comic` | `/mim/comic` |
| IM 聊天 | `/#/chat` | `/chat` | `/mim/chat` |
| 站点地图 | `/#/sitemap` | `/sitemap` | `/mim/sitemap` |
| 站点目录 | `/#/directory` | `/directory` | `/mim/directory` |
| 设置 | `/#/settings` | `/settings` | `/mim/settings` |
| 登录 | `/#/login` | `/login` | `/mim/login` |
| 节点页（45） | `/#/site/www` | `/site/www` | `/mim/site/www` |
| 后台 5 视图 | `/admin/`（恒定） | `/admin/overview` `/admin/modules` `/admin/entitlements` `/admin/roles` `/admin/users` | 后台不部署到 Pages |

**实测差异证据**：

```
GET https://mim.mixm.top/directory            → 200, LEN=2896, 与首页字节级一致（回退生效，但前端不渲染 directory）
GET https://mim.mixm.top/site/www             → 200, LEN=2896, 与首页字节级一致
GET https://afdk1991.github.io/mim/directory → 404, 「Page not found · GitHub Pages」
GET https://mim-8ah.pages.dev/directory      → 200, 返回 index.html（内置回退）
GET https://data.mixm.top/                   → 200, LEN=985, WAF 挑战页（非真实内容）
GET https://mim-puce.vercel.app/             → 000（本机 DNS 污染，CI 侧有部署取证）
```

### 🔴 硬阻塞 A：`base: './'` 与深链接不兼容

`apps/web/vite.config.ts:26` 与 `apps/admin/vite.config.ts:26` 均为 `base: './'`，目的是「一份产物挂任意子路径」（`README.md:152`）。产物 HTML 引用为：

```html
<script type="module" crossorigin src="./assets/index-BYc40BEt.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-CHtOI4g2.css">
```

浏览器在 `/site/www` 下会把 `./assets/...` 解析成 `/site/assets/...`。实测：

```
GET /site/assets/index-BYc40BEt.js → HTTP 200 | content-type text/html | LEN=2896
GET /assets/index-BYc40BEt.js      → HTTP 200 | content-type application/javascript ✅
```

即深链接下**资源请求拿到的是 index.html 而非 JS**，浏览器按 JS 解析必然失败 → 白屏。这是改 history 路由的第一硬阻塞，必须先解决。

### 🔴 硬阻塞 B：GitHub Pages 无 SPA 回退

CI pages job 直接上传 `apps/web/dist`（仅有 `index.html` + `assets/`，全仓无 `404.html` / `_redirects`），`/mim/directory` 实测 404。GitHub Pages 不支持 `_redirects`，只能靠 `404.html` 兜底（或平台侧配置）。

---

## 5. 为什么当前会选 hash（设计取舍，不是 BUG）

| 约束 | 证据 | hash 路由如何满足 |
|---|---|---|
| 9 个免费平台形态不一 | `AGENTS.md` 铁律九矩阵 | 纯静态平台（GitHub Pages / EdgeOne / IGA）无服务端 rewrite 能力；hash 不需要任何服务端配置 |
| 一份产物挂任意子路径 | `vite.config.ts:26` `base:'./'`；`README.md:152` | hash 与挂载前缀无关，`/mim/#/x`、`/#/x` 都能工作 |
| 零第三方依赖 | `router.ts` 注释「无依赖 hash 路由」；`docs/wiki/07-functional-modules.md:346` | 手写 68 行即可覆盖 8 视图 + 45 节点 |
| 刷新 / 前进后退 / 外链直达要可用 | `router.ts:49-67`、`verify-auth-gate.mjs` | `hashchange` 天然支持，且刷新时服务端只收 `/` 不会 404 |

> 按现行 `AGENTS.md` **铁律五**（必须引入成熟第三方依赖、不得重复造轮子），若后续改造，应引入 `react-router-dom` 而非自研 history 实现；这一点与当年的「零依赖」取舍冲突，需在方案中显式决策。

---

## 6. 需要调整的内容（清单，未执行）

> 本节为**建议清单**。切换路由模式属结构性变更（`AGENTS.md` 铁律二），且需同步 9 平台部署与线上验证（铁律八），须经明确授权后再实施。

### P0 · 改造前必须先解决的两个硬阻塞

| # | 文件 | 调整内容 | 验收 |
|---|---|---|---|
| 1 | `apps/web/vite.config.ts:26`、`apps/admin/vite.config.ts:26` | `base: './'` → 绝对路径方案。因 GitHub Pages 挂 `/mim/`、其余平台挂 `/`，**不能简单写死 `/`**：建议 CI 分平台注入 `VITE_BASE`（Pages 用 `/mim/`，其余 `/`），或产物改用运行时绝对资源路径 + `basename` 适配 | 深链接下 `assets/*.js` 返回 `application/javascript` |
| 2 | `.github/workflows/deploy.yml` pages job | 构建后追加 `cp apps/web/dist/index.html apps/web/dist/404.html`（或生成等价 404 兜底页），使 GitHub Pages 深链接回退到 SPA | `/mim/directory` 返回 200 + SPA HTML |

### P1 · 路由与地址生成（核心改造）

| # | 文件 | 调整内容 |
|---|---|---|
| 3 | `apps/web/src/router.ts` | 按铁律五引入 `react-router-dom`（版本与用途写入依赖清单 + `pnpm-lock.yaml`），改用 `BrowserRouter` / `useNavigate` / `useLocation`；`parseHash`→路径解析，`hrefOf`→`/<view>`、`/site/<key>`；保留未知路径回落 `store` 的安全语义 |
| 4 | `apps/web/src/main.tsx` | 用 Router 包裹 `<App />`；按平台前缀设置 `basename` |
| 5 | `apps/web/src/App.tsx:133-146, 164-177` | 6 个侧栏 `<button onClick={() => go(...)}>` → `<NavLink to="/...">`（同时修掉「按钮不是链接、无法新标签打开」） |
| 6 | `services/mim-api/src/site-nodes.ts:155-168` | `routeKeyOf` 可保留，但 `route` 字段改为 `/site/<key>`；`'@'→'root'` 映射仍需要（避免路径歧义） |
| 7 | `apps/web/src/api.ts:483-492` | `SiteNodeSpec.route` 注释与语义改为「站内路径路由」 |
| 8 | `apps/web/src/views/SiteDirectory.tsx:119-123`、`SiteMap.tsx:184` | `href={item.node.route}` → `<Link to={item.node.route}>` |
| 9 | `apps/web/index.html:47, 80` | `/#/login` → `/login`；归一化脚本注释与 `hash === ''` 判断按新路由语义重写（注意 `?tads` 清理仍要做） |
| 10 | `Mim-PRD.html:51`、`site/index.html:50`、`site/prd.html:51` | 同步 `/#/login` → `/login` |
| 11 | `apps/admin/src/App.tsx:23, 93, 137-139, 152-164, 183-196` | 引入路由：5 个 `ViewKey` 映射 `/admin/overview` `/modules` `/entitlements` `/roles` `/users`；刷新保持视图；权限回收回落 `overview` 逻辑保留 |
| 12 | `services/mim-api/test/site-nodes.test.ts:48, 70, 143` | 3 处 hash 断言改为路径断言 |
| 13 | `scripts/verify-auth-gate.mjs:220, 247, 285, 305, 327` | 53 个入口清单由 `#/...` 改为 `/...`，直达验证改为路径导航 |

### P2 · 服务端 / 平台回退与文档同步

| # | 文件 | 调整内容 |
|---|---|---|
| 14 | `deploy/nginx-mim.conf:128-130, 117-125` | 回退已就绪，复验即可；建议补 `location ~* \.(sql|bak|zip|env|db)$ { deny all; }`（沿用安全自查报告 P0 建议） |
| 15 | `vercel.json`、`render.yaml` | 全量 rewrite 已就绪，复验；确认 `/api/`、`/health` 规则优先级在前 |
| 16 | Cloudflare Pages | 新增 `apps/web/dist/_redirects`：`/* /index.html 200`，把隐式内置回退显式化 |
| 17 | EdgeOne / IGA | 确认平台是否支持 SPA 回退；若不支持，需平台侧配置或保留 hash 兜底 |
| 18 | `README.md:150-170`、`docs/wiki/07-functional-modules.md:346, 361`、`docs/wiki/05-runbook.md`、`AGENTS.md` 铁律九取证口径 | 全量同步 URL 形态与逐平台实测数值（铁律七、九） |
| 19 | `src/core/version.ts` / `RELEASE_CHANNEL` | 路由改造属功能模块修改，按铁律四核对版本递增与通道；**正式版号 `V0.0.0` 发布前不得占用** |

> **边界提醒**：45 个 `*.mixm.top` 子域是 DNS 元数据，各自由独立服务承载（`nginx-mim.conf:9-12` 明确禁止通配 `server_name`）。改前端路由**不会**把它们变成 `/site/xxx` 路径，也不会让它们自动指向本项目 SPA；若期望「每个模块一个独立域名」，那是 DNS + 服务路由的另一项工程，不在本清单内。

---

## 7. 验证标准（可执行、可判定）

| # | 验证项 | 命令 / 方法 | 通过标准 |
|---|---|---|---|
| V1 | 产物静态检查 | `grep -c 'pushState\|BrowserRouter' apps/web/dist/assets/*.js`；`grep -c '#/site/' ...` | 前者 ≥1，后者 =0 |
| V2 | 深链接 HTTP（每平台） | `curl -s -o /dev/null -w '%{http_code} %{content_type}' https://<host>/site/www` | 200 + `text/html`；GitHub Pages 需含 `/mim/` 前缀 |
| V3 | 深链接资源（硬阻塞 A） | `curl -sI https://mim.mixm.top/site/assets/index-*.js` | 200 + `application/javascript`，**不得**为 `text/html` |
| V4 | 浏览器真实渲染（铁律八） | 有头 Edge + CDP 打开 `https://mim.mixm.top/site/www` | `location.pathname==='/site/www'`、`location.hash===''`、节点页标题为 `www`、`document.title` 正确、无白屏 |
| V5 | 导航四态 | 站内点击 / 刷新 / 前进后退 / 新标签打开复制的地址 | 四态均停留同一模块，无回落 `store` |
| V6 | 后台 5 视图 | 逐个打开 + 刷新 + 权限回收 | 刷新保持当前视图；权限回收回落 `overview` |
| V7 | 45 节点契约 | `GET /api/v1/site/nodes` + `pnpm --filter @mim/api test` | `route` 全为 `/site/<key>`、唯一无冲突；契约测试全绿 |
| V8 | 门禁不回退 | `node scripts/verify-auth-gate.mjs`（路径版） | 未登录直达全部 53 个路径入口仍 `locked`；登录后原地解锁目标内页 |
| V9 | 9 平台逐平台取证 | 按 `AGENTS.md` 铁律九表格逐条 curl，EdgeOne 用有头浏览器判定 WAF（不得把 985B 挑战页当成功） | 每平台记录 HTTP / 耗时 / LEN / 真实内容判定；`000` 附 DNS 污染证据与 CI 替代取证 |
| V10 | 构建与类型 | `pnpm exec tsc --noEmit`、`pnpm --filter @mim/web build`、`pnpm --filter @mim/admin build`、全量 test | 0 错误、构建成功、测试全绿 |
| V11 | 全量同步（铁律七） | 交付报告附同步清单 | 代码 / 依赖 + 锁文件 / 版本号 / PRD / Wiki / README / AGENTS.md / CI / nginx 全部列出「已更新」或「不涉及」 |
| V12 | 线上端到端（铁律八） | CI push `main` → 五作业全绿 → 生产健康检查 + 关键接口 + 一次真实浏览器操作 | 附线上取证；无取证不得宣称「已上线」 |

---

## 8. 交付边界声明

- 本轮为**只读诊断**：未修改任何源代码、配置、依赖、文档索引以外的工件，未部署、未重启服务、未触碰本机/服务器网络配置，未输出任何凭据值。
- 线上探测仅限 `README.md`/`AGENTS.md` 已登记的自有域名，且只做首页与单个深链接的 GET；45 个 `*.mixm.top` 子域按 `nginx-mim.conf` 边界**未探测**。
- 线上首页产物为 `assets/index-BYc40BEt.js`（与 `AGENTS.md` 记录的 HEAD 一致）；本地 `apps/web/dist/index.html` 为 `index-CNvHGqHo.js` 且新增了会话门禁脚本 —— 说明**工作区存在未部署改动**。本报告的路由结论对两者均成立（线上 bundle 已单独取证），但后续改造须先同步工作区再构建发布。
- 本报告为基于仓库静态配置与自有域名只读响应的诊断，不构成对第三方托管平台内部行为的保证；标注「⚪ 无法判定」的项须在授权范围内由平台侧复核。
