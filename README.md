# Mim · 内容聚合社区

Mim 是一个「动态 / 文章 / 商城 / 工具台」四合一的内容聚合社区 Web 应用：前端是零第三方状态库与路由库的 React + Vite 单页应用，后端是仓库内自托管的 `server/`（Node 20 + `node:http` + PostgreSQL），**不配置后端时前端依然完全可用**（数据落 localStorage，云端写回自动跳过）。

---

## 一、技术栈

| 层面 | 选型 | 版本 | 版本来源（唯一真源） |
| --- | --- | --- | --- |
| 运行时 | Node.js | `>=20` | 根 `package.json` 的 `engines.node`；`server/package.json` 同约束 |
| 语言 | TypeScript | `~5.9.3` | 根 `package.json` 的 `devDependencies.typescript` |
| 框架 | React / React DOM | `^18.3.1` | 根 `package.json` 的 `dependencies` |
| 构建 | Vite（`@vitejs/plugin-react` 6.1.2） | `^8.3.4` | 根 `package.json` 的 `devDependencies` |
| 状态管理 | React 内置 `Context` + `useState` | 随 React 18.3.1 | `src/app/state/*`；**不引入 Redux / Zustand 等第三方库** |
| 路由 | 自研 hash 路由 | — | `src/app/router.tsx` + `src/app/routes.tsx` |
| 后端 | 自托管 `server/`（Node 20 + `node:http`） | Node `>=20` | `server/package.json` |
| 后端唯一外部依赖 | `pg`（PostgreSQL 驱动） | `^8.23.1` | `server/package.json` 的 `dependencies` |
| 数据库 | PostgreSQL | `14+`（建议 16） | `deploy/README.md` 的「前置条件」表（宿主机系统包） |
| 原生壳 | Capacitor（Android / iOS）、Tauri、Harmony | `^8.5.3`（Capacitor） | 根 `package.json` 的 `dependencies` |

> 前端零第三方 UI 库、零 CSS 框架：样式是手写 CSS + 主题变量（`src/ui/styles/*.css`）。

---

## 二、目录结构

```
mim/
├─ index.html                      构建入口（挂载 #root，矢量 favicon）
├─ package.json                    前端依赖与脚本（含 server:* 后端命令转发）
├─ vite.config.ts                  base './'、别名 @→src、/api /auth /storage 开发代理
├─ tsconfig.json                   严格开关（strict / noUnusedLocals / verbatimModuleSyntax …）
├─ capacitor.config.ts             Capacitor 壳配置（webDir: dist）
├─ .env.example                    前端构建期环境变量模板（唯一入库的 env 文件）
│
├─ src/                            前端源码（五层单向依赖）
│  ├─ main.tsx                     入口：主题先行 → 挂载 React（允许 default export）
│  ├─ App.tsx                      根组件：Provider 栈 + Shell + 路由分发（允许 default export）
│  ├─ vite-env.d.ts                Vite 环境变量类型声明
│  │
│  ├─ core/                        ① 基础设施层：无业务、无 React
│  │  ├─ result.ts                   Result<T> / ErrCode / ERR_CN / errText / WriteBack 三态
│  │  ├─ utils.ts                    纯函数：uid / cx / timeAgo / yuanText / yuanToFen …
│  │  ├─ storage.ts                  localStorage 键名规范 + 带校验的 readJson/writeJson
│  │  ├─ events.ts                   跨模块事件广播（EVT 事件名表 + subscribe/emit）
│  │  ├─ http.ts                     全工程唯一 fetch 出口（Result 化、鉴权、超时、重试）
│  │  ├─ config.ts                   站点配置、API_BASE、LIMITS 等业务常量
│  │  ├─ version.ts                  版本唯一源（四段式 APP_VERSION + 派生规则）
│  │  └─ theme.ts                    浅色 / 深色切换，写入 <html data-theme>
│  │
│  ├─ data/                        ② 数据访问层：后端客户端与本地优先同步
│  │  ├─ client.ts                   db(list/one/insert/update/remove/rpc) + auth + storage
│  │  ├─ session.ts                  会话单例（uid / token / roles / permissions）
│  │  └─ sync.ts                     loadLocal / saveLocal / pushCloud / 缺列降级写入
│  │
│  ├─ domain/                      ③ 领域层：模型 + 纯规则，**不得引入 React**
│  │  ├─ content/                    model.ts（动态/文章/片段/资源）+ rules.ts（过滤/排序/可见性）
│  │  ├─ identity/                   model.ts（认证模式、资料、权限判定）
│  │  ├─ social/                     model.ts（群聊、话题签到、连击、漫游）
│  │  ├─ commerce/                   model.ts / order.ts / payment.ts + biz/ 四业务
│  │  │  └─ biz/                     registry.ts（唯一真源）+ seckill / local / live / travel
│  │  ├─ growth/                     growth.ts（行为记分、等级、签到、徽章）
│  │  └─ tools/                      model.ts（工具台共享类型与规则）
│  │
│  ├─ app/                         ④ 应用层：路由、导航、布局、跨页面状态
│  │  ├─ router.tsx                  hash 路由内核（parseHash / useRouter / navigate）
│  │  ├─ routes.tsx                  路由表唯一真源：resolveRoute(path, query)
│  │  ├─ nav.ts                      侧栏导航数据（NAV / ADMIN_NAV）
│  │  ├─ providers.tsx               Provider 栈组装（Router → Toast → App → Mall）
│  │  ├─ shell.tsx                   布局骨架：hero / 侧栏 / 主内容 / 页脚
│  │  ├─ admin-gate.tsx              管理后台守卫 + 「成为首个管理员」引导
│  │  └─ state/                      content.tsx / mall.tsx / wallet.tsx / identity.ts
│  │
│  ├─ pages/                       ⑤ 页面层：薄层，只做组装与渲染
│  │  ├─ content/                    Feed / 文章 / 视频 / 榜单 / 搜索 / 标签 / 资源 …
│  │  ├─ social/                     收藏 / 足迹 / 关注 / 私信 / 通知 / 主页
│  │  ├─ commerce/                   商城中心 / 商品 / 购物车 / 订单 / 钱包 / 四业务会场
│  │  ├─ tools/                      配送台 / 价格监控 / 路线导航 / 邮箱 / BOM / 智能体 …
│  │  └─ system/                     登录 / 设置 / 钱包 / VIP / 成长 / 信息页 / 管理后台
│  │
│  └─ ui/                          ⑤ 组件库（与 pages 同层）：basic / post-card / rich-text / toast
│     └─ styles/                     theme.css（主题变量）/ base.css / layout.css / components.css
│
├─ server/                         自托管后端（Node 20 + node:http + pg）
│  ├─ package.json                  依赖只有 pg；scripts: dev / start / migrate / seed:admin / check
│  ├─ .env.example                  后端环境变量模板
│  ├─ db/migrations/                0001_iam / 0002_content / 0003_commerce / 0004_business / 0005_growth
│  ├─ scripts/migrate.js            迁移执行器（记录于 schema_migrations，幂等）
│  ├─ scripts/promote-admin.js      命令行授予首个管理员
│  └─ src/                          main.js / db.js / auth.js / rest.js / rpc.js / storage.js / errors.js
│
├─ deploy/                         宿主机部署资产（不使用容器，详见 deploy/README.md）
│  ├─ README.md                     部署与运维主手册（唯一权威口径）
│  ├─ install.sh                    一键部署脚本（幂等）
│  ├─ init-db.sh                    建 PostgreSQL 库与账号（幂等）
│  ├─ mim-server.service            systemd 单元（开机自启 + 崩溃重启）
│  ├─ nginx-mim.conf                静态资源直出 + /api 反代
│  └─ logrotate-mim.conf            nginx 日志轮转（每天，保留 14 天）
│
├─ scripts/                        Node 工具脚本
│  ├─ server-health.mjs             后端健康探测（对应 npm run server:health）
│  ├─ verify-routes.mjs             全站路由遍历实测（对应 npm run verify:routes）
│  └─ version-check.mjs             版本号一致性校验（对应 npm run version:check）
│
├─ docs/                           文档
│  ├─ rebuild/                      重建文档：启动说明 / 页面实现规范 / 迁移说明 / 路由清单
│  └─ selfhosted-baas-blueprint.md  自托管后端设计蓝图
│
├─ android/ ios/ harmony/ src-tauri/  原生壳工程（Capacitor / Harmony / Tauri）
├─ public/                         favicon.svg / 404.html / privacy.html
└─ .github/workflows/build.yml     CI：verify（typecheck + build）→ deploy-pages
```

### 分层依赖规则（**强制**）

```
pages / ui  →  app  →  domain  →  data  →  core
```

| 层 | 允许依赖 | **禁止** |
| --- | --- | --- |
| `core/` | 同层（`utils` 可依赖 `storage`） | 依赖 `data` / `domain` / `app` / `pages`；引入 React |
| `data/` | `core` | 依赖 `domain` / `app` / `pages`；直接 `fetch`（必须走 `core/http`） |
| `domain/` | `core`、同层其他域模型 | 引入 React；做 IO（读写必须在 `data` / `app/state`） |
| `app/` | `domain` / `data` / `core` / `ui` | 被 `domain` / `data` 反向依赖 |
| `pages/` | `app` / `domain` / `core` / `ui` | 直接 `fetch`；直接读写 `localStorage`；被其他层依赖 |
| `ui/` | `core`（`utils` / `theme`）、`domain` 的纯类型 | 依赖 `data` / `app` / `pages`；含业务逻辑 |

---

## 三、代码风格与命名规范

以下每一条都是**可执行规则**，不是建议。改动代码前先对照自查。

### 3.1 命名

| 对象 | 规范 | 示例 |
| --- | --- | --- |
| 类型 / 接口 | `PascalCase` | `MallGoods`、`ErrCode`、`RouterValue` |
| 函数 / 变量 / 参数 | `camelCase` | `currentUid()`、`resolveRoute()`、`feedPageSize` |
| 常量 | `UPPER_SNAKE` | `LOCAL_UID`、`MAX_DROP_ROUNDS`、`BREAKPOINT_MOBILE` |
| 组件文件 | `PascalCase.tsx` | `FeedPage.tsx`、`PostCard.tsx` |
| 非组件文件 | `kebab-case.ts` | `content-data.ts`、`admin-gate.tsx`、`settings-panels.tsx` |
| CSS 类名 | `kebab-case` + 语义前缀 | `sidenav-link`、`wb-hero`、`site-footer-mini` |
| 事件名 | `EVT.<名>` 集中声明 | 见 `src/core/events.ts` 的 `EVT` 表 |

### 3.2 金额：一律整数「分」

- 所有金额变量 / 字段以 `Fen` 结尾：`amountFen` / `priceFen` / `unitPriceFen` / `balanceFen` / `thresholdFen`。
- **禁止**浮点金额，禁止出现「元」单位的金额列或字段。
- 展示一律走 `yuanText(fen)`；需要换算时用 `yuanToFen()` / `fenToYuan()`（`src/core/utils.ts`）。
- 禁止 `fen / 100` 的手写拼装（历史上由此产生过 100 倍错位 bug）。

### 3.3 本地存储

- 键名统一点分结构：
  - 全局（不随身份变化）`mim.<scope>.<field>`
  - 按身份隔离 `mim.<scope>.<uid>.<field>`
- 读写**必须**走 `src/core/storage.ts` 的 `readJson` / `writeJson`（或 `src/data/sync.ts` 的 `loadLocal` / `saveLocal` / `loadSnapshot` / `saveSnapshot`）。
- **禁止**裸 `localStorage.getItem` / `setItem`。
- 读取必须传 `parse` 校验器（元素级校验，脏数据整批剔除而非强转）。
- 未登录时 `uid` 恒为 `'local'`（`LOCAL_UID`），它是本机存储锚点，**不是**「演示模式」标记。

### 3.4 错误处理：不抛异常

- 统一返回 `Result<T>`（`src/core/result.ts` 的 `ok()` / `fail()`），异常只保留给真正的程序错误。
- 错误码 `ErrCode` → 中文文案走 `errText(error)` 或 `ERR_CN[code]`，**页面不得各自翻译**。
- 后端调用只走 `src/core/http.ts`（`request` / `get` / `post` / `patch` / `del`）与 `src/data/client.ts`（`db` / `auth` / `storage`）。

### 3.5 云端写回三态协议

`WriteBack = 'ok' | 'skip' | 'fail'`（`src/core/result.ts`）：

- `ok`：云端已确认；
- `skip`：**未配置后端或未登录**，本地态即最终态，**不算错误、不提示失败**；
- `fail`：云端拒绝，调用方**必须**回滚本地乐观更新并提示。

### 3.6 订单双状态机（正交，禁止混用）

- `status` 管**资金**：`unpaid → awaiting_confirm → paid → done`
- `bizStatus` 管**履约**：`locked` / `pending_verify` / `pending_ticket` / `ticketed` …
- 订单中心必须并列展示两个状态徽标，不能用其中一个替代另一个。
- 业务下单必须先「服务端占库存」再建单（`src/app/state/mall.tsx` 的 `holdBizStock`），占库存失败即放弃建单。

### 3.7 CSS：只用主题变量

- 颜色一律引用 `src/ui/styles/theme.css` 的变量：`--primary` / `--primary-deep` / `--primary-weak` / `--text` / `--text-2` / `--text-3` / `--bg` / `--bg-soft` / `--card` / `--card-2` / `--line` / `--border` / `--danger` / `--success` / `--warn` / `--radius` / `--shadow`。
- **禁止**在组件样式里硬编码颜色值（深色模式下必然出现不可读文本）。
- 深浅色由 `<html data-theme="light|dark">` 切换，不要在组件里另写 `prefers-color-scheme` 分支。

### 3.8 导出约定

- 组件一律**具名导出**，不写 `export default`。
- 例外：仅入口文件允许 default export —— `src/main.tsx`、`src/App.tsx`。
- 页面按域从桶文件导入（`src/pages/<域>/index.ts`）；新增页面必须同时改桶文件与 `src/app/routes.tsx`，否则会拿到 `undefined` 组件。

### 3.9 数据真实性红线

- 无真实来源时显示**空态**，禁止预置演示商品、示例文章、随机点赞、假已读回执、伪造收款码。
- 券码只能由服务端生成（`issue_voucher_code`），前端不构造、不猜测。
- 法定登记信息（备案号 / 许可证）留空时显示「本项内容由站点运营方配置后展示。」，禁止虚构。

### 3.10 已知安全边界（FE-009）

- **会话令牌以明文存在 localStorage**（键 `mim.session`）：同源 XSS 或本机恶意软件可直接读取。
  这是单防线，不是加密存储。当前**未引入 base64 / 异或等「二级混淆」**——前端 bundle 内任何
  可逆变换都不是安全边界，只会误导审计；真正的收敛路径是把会话换成服务端下发的
  `HttpOnly + Secure + SameSite=Lax` Cookie，需要后端配合。
- 在上述收敛落地前，本站已采取的缓解措施：用户上传的 HTML 不内联渲染（`ui/rich-text.tsx`
  走白名单）、所有外链 `rel="noreferrer"`、`ManjuPage` 等用户自填 URL 仅放行 `http(s)://`
  协议（`javascript:` / `data:` 伪协议在解析与渲染两端都被拦截）。
- 演示期已知：`wallet_credit`（前端自助加余额）未加 admin 校验，仅供本地调试；接入真实
  支付回调后必须收口（见 `docs/gaps.md` BE-006）。

---

## 四、快速开始

### 1) 安装依赖

```bash
git clone <你的仓库地址>
cd mim
npm install
```

预期输出：结尾出现 `added N packages in Xs`，无 `npm error`。

### 2) 启动前端

```bash
npm run dev
```

预期输出：

```
  VITE v8.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

打开 <http://localhost:5173/> ，默认落到 `#/feed`。**此时不启动后端也能完整使用**（数据存本机）。

### 3) 启动后端（可选，但多端同步 / 商城 / 后台需要）

后端是宿主机上的普通 Node 进程，数据库是宿主机安装的 PostgreSQL —— 不需要任何虚拟化环境。

```bash
# ① 装 PostgreSQL（Debian 系；其它发行版见 INSTALL.md）
sudo apt-get update && sudo apt-get install -y postgresql
sudo systemctl enable --now postgresql

# ② 建库建账号（幂等，可重复执行；口令换成你自己的）
PGUSER=mim PGPASSWORD='换成你的密码' PGDATABASE=mim ./deploy/init-db.sh

# ③ 安装后端依赖（只有 pg）+ 写配置
npm run server:install
cp server/.env.example server/.env
vi server/.env                 # DATABASE_URL=postgres://mim:换成你的密码@127.0.0.1:5432/mim

# ④ 应用迁移并启动
npm run server:migrate         # 应用 server/db/migrations/*.sql（幂等，可重复执行）
npm run server:dev             # node src/main.js，默认 http://127.0.0.1:8787
npm run server:health          # 健康探测
```

macOS 用 `brew install postgresql@16 && brew services start postgresql@16`，
Windows 用 `winget install PostgreSQL.PostgreSQL.16`，逐平台步骤见 [`INSTALL.md`](INSTALL.md)。

`npm run server:health` 预期输出：

```
Mim 后端健康探测 → http://127.0.0.1:8787
  ✓ 健康检查：200 {"ok":true,"db":true,"service":"mim-server",...}
  ✓ REST 商品列表：200 []

全部通过：后端可用
```

`npm run server:dev` 就是直接跑进程（`node src/main.js`），日志打在当前终端，便于断点调试；
生产则交给 systemd 守护，见 [`deploy/README.md`](deploy/README.md)。

后端起来后，前端 dev 无需任何跨域配置：`vite.config.ts` 已把 `/api`、`/auth`、`/storage` 代理到 `http://127.0.0.1:8787`。

---

## 五、环境变量

### 前端：`VITE_MIM_API_BASE`

复制模板后按需修改：

```bash
cp .env.example .env.local
```

| 场景 | 取值 | 行为 |
| --- | --- | --- |
| 留空（默认） | `VITE_MIM_API_BASE=` | `API_BASE` 回退同源 `/api`，适配「静态站点 + 网关反代」部署；开发期由 vite 代理到 `127.0.0.1:8787` |
| 本地后端 | `VITE_MIM_API_BASE=http://127.0.0.1:8787` | 前端直连本机 `server/` |
| 生产后端 | `VITE_MIM_API_BASE=https://api.example.com` | 前端直连公网后端 |

说明：

- 该变量是**构建期**注入（Vite 会内联进产物），改地址必须重新 `npm run build`。
- 变量值末尾的 `/` 会被自动去除（见 `src/core/config.ts`）。
- **未配置后端时前端仍然完全可用**：数据落 localStorage，云端写回自动跳过（三态协议里的 `skip`，不算错误）。
- `.env` / `.env.local` 已在 `.gitignore` 中排除，只有 `.env.example` 入库；真实密钥不得进版本库。

### 后端：`server/.env`

复制 `server/.env.example` 为 `server/.env` 后修改。完整变量表见 `server/README.md`，常用项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/mim` | 宿主机 PostgreSQL 连接串（本机就是 `127.0.0.1`） |
| `JWT_SECRET` | `change-me-in-production` | **生产必须替换**：`openssl rand -hex 32` |
| `BOOTSTRAP_ADMIN_USERNAME` | 空 | 全新库首个管理员账号名 |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` | `./data/uploads` / `3145728` | 对象存储落盘目录与单文件上限（与前端 `LIMITS.uploadMaxBytes` 对齐） |
| `PUBLIC_API_BASE` | 空 | 有网关 / CDN 时填公网地址，决定 `/api/storage/<key>` 返回的 `url` 是否绝对 |

---

## 六、后端命令

全部在**仓库根目录**执行（内部用 `npm --prefix server` 转发）：

| 命令 | 作用 |
| --- | --- |
| `npm run server:install` | 安装 `server/` 依赖（只有 `pg`） |
| `npm run server:migrate` | 应用 `server/db/migrations/*.sql`（幂等，可重复执行） |
| `npm run server:dev` | 前台直接启动 API（`node src/main.js`），日志打在终端，Ctrl+C 停止 |
| `npm run server:start` | 以 `npm start` 方式启动（`node src/main.js`，适合挂后台脚本） |
| `npm run server:check` | 对所有 `src/*.js` 与 `scripts/*.js` 做 `node --check` 语法检查 |
| `npm run server:health` | 探测 `/api/health` 与 `/api/rest/products?limit=1` |

生产环境不用这些命令守护进程，交给 systemd：

```bash
sudo systemctl enable --now mim-server     # enable = 开机自启，--now = 立即启动
sudo systemctl restart mim-server          # 改了 .env 或拉了新代码之后
sudo journalctl -u mim-server -f           # 看日志
```

注意 **`start` 不等于 `enable`**：只 `start` 的服务重启机器后不会自己起来。

---

## 七、常用命令速查表

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装前端依赖 |
| `npm run dev` | 前端开发服务器（<http://localhost:5173/>） |
| `npm run typecheck` | TS 严格检查（`tsc --noEmit`），**提交前必须 0 错误** |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run server:install` | 安装后端依赖 |
| `npm run server:migrate` | 执行数据库迁移 |
| `npm run server:dev` | 本机启动后端（8787，前台） |
| `npm run server:start` | 本机启动后端（8787） |
| `npm run server:check` | 后端语法自检 |
| `npm run server:health` | 后端健康探测 |
| `npm run verify:routes` | 全站路由遍历实测（需先起 dev server，需本机浏览器） |
| `npm run version:check` | 版本号一致性校验（`src/core/version.ts` 为唯一源） |

后端目录内另有（`cd server` 后执行）：

| 命令 | 作用 |
| --- | --- |
| `npm run migrate` | 同 `npm run server:migrate` |
| `npm run seed:admin` | `node scripts/promote-admin.js <username\|userId>` 授予首个管理员 |
| `npm run check` | 对所有 `src/*.js` 与 `scripts/*.js` 做 `node --check` 语法检查 |

---

## 八、更多文档

| 文档 | 内容 |
| --- | --- |
| `docs/rebuild/启动说明.md` | 第一次拿到仓库的 step by step（环境 → 前端 → 后端 → 首个管理员 → 常见问题） |
| `docs/rebuild/页面实现规范.md` | 页面开发契约基线（分层、别名、可直接使用的 API、红线） |
| `docs/rebuild/路由清单.md` | 全站路由表（hash / 组件 / 所属域 / 是否需要登录 / 功能说明） |
| `docs/rebuild/迁移说明.md` | 从旧双后端架构迁移到自托管 `server/` 的变化与回滚方式 |
| `DEPLOY.md` | 部署形态、端口表、三个部署入口、nginx 反代要点、日志 |
| `deploy/README.md` | 部署与运维手册（systemd / nginx / 备份 / 排错，权威口径） |
| `INSTALL.md` | 环境依赖清单与逐平台安装步骤 |
| `server/README.md` | 后端路由契约、RPC 清单、环境变量全表、常见问题 |
