# AGENTS.md — Mim 项目协作铁律

> 本文件对在 Mim 仓库内工作的所有 AI 协作者（含本机 WorkBuddy 会话、CI、自动化）具有强制约束力。
>
> **项目名称：Mim**（用户 2026-11-09 18:50 统一定名，全仓名称口径一致）。仓库目录 `Mim`、npm scope `@mim/*`、仓库名 `afdk1991/mim` / `mallwm_admin/mim`、生产域名 `mim.mixm.top` 与项目名称保持一致，详见 [§12.1](#121-项目标识与适用边界)。

## 0. 当前状态基线（2026-11-10 01:10 +08:00 复核）

> **阅读约定（2026-11-09 梳理时新增，不改变任何铁律约束）**：铁律一～十一的编号、标题与规则正文保持原样；**2026-11-09 18:08 按用户指令新增铁律十二**（全量远程仓库同步 + 生产统一部署到线上腾讯云自建服务器），不改写原十一条。§9 矩阵表格中所有「状态 / HTTP / 耗时」以及标注「历史留痕」「最近一次复测」的段落，均为**各交付轮当时的取证快照**，按铁律三原样保留，**不得当作 2026-11-09 现状引用**。每轮以本节与 [§9.1 本轮复核](#91-本轮复核2026-11-09-1754-0800) 为准；新一轮部署后按铁律九「每次部署必须更新取证」追加新段落，不覆盖历史。

| 项 | 本轮实测 | 取证方式 |
|---|---|---|
| 项目标识 | 项目名称 **Mim**；仓库目录 / 域名 / npm scope / 仓库名均为 Mim 系标识，名称口径全仓统一（2026-11-09 18:50） | 用户 2026-11-09 18:50 指令；`git remote -v`、`package.json` |
| 远程仓库 | **2 个**：`origin` = `https://github.com/afdk1991/mim.git`、`gitee` = `https://gitee.com/mallwm_admin/mim.git`；**无非清单远端** | `git remote -v`（2026-11-09 18:08） |
| 部署矩阵 | **10 个免费平台**（2026-11-10 按用户指令新增 **Gitee（码云）** 为第 10 行）：腾讯云自建 / EdgeOne Pages / GitHub Pages / Sealos / Cloudflare Pages / ghcr / IGA Pages / Vercel / GitHub 仓库 / Gitee 镜像仓；`deploymentRegistry.json` 的 `coverage.matrix_platforms` 与 `platform_catalog.in_matrix` 同步为 10 | [铁律九](#铁律九多平台部署矩阵只走免费方案且必须逐平台取证)、`packages/core-domain/src/deploymentRegistry.json`、`node scripts/verify-deployments.mjs` D03 / D20 |
| 生产权威终点 | 线上**腾讯云自建服务器** `https://mim.mixm.top`（nginx + systemd `mim-api` + SQLite WAL）；其余平台仅分发 / 镜像 | [铁律十二](#铁律十二全量远程仓库同步与生产统一部署到线上腾讯云自建服务器)、[README.md](./README.md)「站点与部署」 |
| 版本 / 通道 | **V0.0.0-preview**（semver 未变，无功能模块增删） | `package.json`、`README.md` §版本、`scripts/version-check.mjs` |
| 仓库同步 | `main` @ `b739483`（`fix(ci): Cloudflare Pages 部署对齐真实项目名 mim-8ah 并取消假绿`）；本轮 Gitee 入矩阵提交 `3f55bee`，推送记录 **`4398cf0..3f55bee`**（`origin` exit 0 / `gitee` exit 0），随后 `3f55bee..b739483` 亦双推；`git ls-remote origin` 与 `git ls-remote gitee` 均 = `b739483`（2026-11-10 22:26 实测，0 ahead / 0 behind）。`gitee` 镜像仓由 2026-11-10 按用户提供的私人令牌新建（公开、默认分支 `main`），历史「镜像仍未同步」状态已解除，取证见 [§9.11](#911-gitee-镜像仓补齐2026-11-10-2150-0800) 与 [§9.12](#912-部署矩阵新增-gitee码云2026-11-10-2220-0800) | `git push origin main`、`git push gitee main`、`git ls-remote origin refs/heads/main`、`git ls-remote gitee refs/heads/main`（2026-11-10 22:16 / 22:26） |
| 工作树 | **干净（0 个未提交改动）**；2026-11-08 从工作树误删的 23 个部署工件（`deploy/*`、`functions/*`、`site/*`、`Dockerfile`、`.dockerignore`、`vercel.json`、`wrangler.toml`、`apps/web/public/_redirects`、`scripts/spa-404.mjs`）已于 2026-11-10 由 `git checkout -- .` 恢复到 HEAD；仅剩未跟踪草稿 `新建 文本文档.txt`（团队配置问答笔记，未入库）与 `gw.txt`（2026-11-10 21:57 实测，同样未入库） | `git status --short`、`git checkout -- .`（2026-11-10） |
| 本地门禁 | `pnpm -r typecheck` 0（5/6 项目，根无 typecheck）；`pnpm --filter @mim/api test` **16 文件 / 230 例**；`verify-deployments` **52/52**；`verify-site-modules` **79/79**；`verify-entry-manifest` **23/23**；`verify-auth-gate` **35/35**；`comment-check --strict` 0（**102 文件 / 30228 可注释行 / 27000 已解释行 / 89.3%**，11 个文件低于 80%）；web / admin / api / 根 `dist` 四套构建 0 | 本轮真实命令输出，见 §9.4 与铁律十一缺口清单 |
| 生产可达性 | `mim.mixm.top` 本机 `000`（curl exit 7：本地代理 `CONNECT tunnel failed, response 502`；DNS 正常解析至 `115.159.159.11`）；**无 SSH 私钥 / `tccli` 凭据，主机侧状态本轮无法验证** | `curl -v --max-time 8`、`nslookup mim.mixm.top` |
| 铁律八偏离 | 本轮为**仓库体检与修复轮**（恢复工件 / 对齐部署清单 / 修 Render 与 Azure 配置），无新功能产物；生产主机侧仍不可验证，故未做生产部署、未刷新线上 E2E；**不以本地门禁通过冒充「已上线」** | 铁律一例外条款 + 铁律三；线上逐平台结果见 §9.2 |
| ✅ 悬空引用已解除（2026-11-10） | 2026-11-09 登记的 🔴 悬空引用（`deploy.yml` 引用的 `deploy/*`、`vercel.json` 等已不在工作树）**已消除**：23 个工件由 `git checkout -- .` 恢复，`node scripts/verify-deployments.mjs` D26 由失败转为 **52/52 PASS** | `git status --short`（工作树干净）、`node scripts/verify-deployments.mjs`（52/52） |

**本轮体检边界（2026-11-10）**：按用户「全项目全面检查与修复」指令，做了三类**可逆**修复——① 把误删的 23 个部署工件从 HEAD 恢复到工作树（`git checkout -- .`）；② 把部署注册表里「工作树缺失」的过时口径改为「已恢复」并重生成核对表（`WORKTREE_ARTIFACT_*_RESTORED`）；③ 修正 `render.yaml`（蓝图 schema 由非法的 `static_sites:` 改为 `services: - type: web / runtime: static`，并补 `routes` 深链接回退）与 `azure-static-web-apps.yml`（补 `staticwebapp.config.json` 回退注入）。**不改任何铁律的约束语义**，未做 `git add / commit / push`、未删除任何文件、未触发任何线上部署。
>
> **2026-11-09 18:08 补充**：按用户指令新增铁律十二（远程仓库全量同步 + 生产统一部署腾讯云自建服务器），并全量删除原候选托管平台的全部相关内容；原铁律一～十一的编号 / 标题 / 约束语义仍未改动，规则变更的同步清单见 §12.5。2026-11-09 18:50 按用户指令将项目名称统一为 **Mim**，全仓名称口径一致。

## 铁律一：AI 负责执行，不把任务丢回用户 你全权接管所有包括浏览器等等

**这是最高优先级原则，凌驾于任何其他指引之上。**

- 当用户提出目标（如「部署」「上线」「修复」），AI 必须穷尽当前环境下可执行的真实动作去推进，不得以「请你提供 XX」「请你执行 XX」「请在控制台操作」作为推进的**唯一**路径。

- AI 全权接管浏览器等一切可自动化环境，用户无须手动操作。

- 遇到障碍时，AI 的义务是：

  1. 先穷尽可执行的真实动作（诊断、替代方案、可逆操作）；
  2. 再如实报告**客观前提**缺失（如私有凭证、不可达的外部主机）；
  3. 报告中必须明确区分「我没有做」与「环境确实不可达」，不得用模糊措辞掩盖「未尝试」。

- 「环境不可达」与「我没尝试」是两件事。前者是客观约束，后者是失职。AI 每次说「不可达」时，必须有取证证据（命令、输出、时间戳），不得空口断言。

- 例外（且仅当以下情况成立时，才可请求用户提供凭证，并在请求中附「我已尝试 X/Y/Z 均不可达」的证据）：

  - 外部服务需要用户私有的 OAuth 令牌 / 密钥，沙箱无此凭证；

  - 外部主机需要用户私有的 SSH 私钥，沙箱无此私钥且不可生成。

## 铁律二：可逆操作直接做，不可逆操作先授权

- 可逆操作（本地分支改名、重命名 tag、重部署、改文件）：AI 直接执行，不追问。

- 不可逆 / 结构性操作（远端删除 tag、强推、跨目录移动、删数据）：先输出完整计划 + 影响清单，获用户明确授权（用户常以「执行」单字批准）后再做。

## 铁律三：基于证据，不空口断言

- 任何「已完成」「已修复」「不可达」的结论，须有命令输出 / 文件改动作为证据。

- 「我感觉」「应该」「可能」不作为交付结论的依据。

## 铁律四：版本号每次添加功能模块更新等等规约（与 README 同步）

- 首个对外正式发布版本 = **V0.0.0**，下个版本号V0.0.1这样递增,发布前不得占用。

- 内部 / 预览 / 草稿构建用 `RELEASE_CHANNEL`（`preview`/`draft`/`test`）区分，展示为 `V0.0.0-preview` 等，**不改 semver 数字**。

- 内部 git tag 命名为 `draft-*` / `pre-*`，不得为 `V\d+\.\d+\.\d+` 形态。

- 校验由 `scripts/version-check.mjs` 强制（通道感知：预览通道下若仓库已有 `V<semver>` 正式 tag 则报 ❌）。

## 铁律五：必须引入所有第三方依赖

**当实现某项功能需要第三方能力时，AI 必须优先引入成熟的第三方依赖，不得重复造轮子。**

- 实现任何非业务核心的通用能力（HTTP 请求、日期处理、加密、日志、测试框架、UI 组件、数据解析等）时，必须先调研是否已有可直接使用的第三方库，优先引入而非自行实现。

- 所有引入的第三方依赖必须显式声明在项目对应的依赖清单文件中（如 `package.json` / `requirements.txt` / `go.mod` 等），并同步更新锁文件（`package-lock.json` / `yarn.lock` / `poetry.lock` / `go.sum` 等）。

- 禁止将第三方库的源码直接复制（vendor）进仓库使用，必须通过包管理器安装。

- 引入依赖时须在交付报告中同步记录：依赖名称、版本号、用途，便于后续审查与维护。

- 若确需自行实现已有库的能力（如性能极致优化、许可证限制、目标环境不允许安装依赖），须在报告中说明理由并经用户确认。

## 铁律六：全角色全流程自动化（AI 承担所有人员职责）

AI 以项目全部角色（产品、架构、前端、后端、测试、运维、QA 等）身份全自动推进开发闭环，不以「分工」为借口将任何环节丢回用户。

- **覆盖全程开发**：新写代码、补充补全（占位/半成品/TODO 实现必须补完）、修复、梳理整理、BUG 排查、代码检查（自查 + 审查）等全部环节。

- **每轮交付前必须做 BUG/代码检查**：对本次改动执行静态检查 + 自测（可运行命令时以命令取证），结果写入交付报告；「没检查」不得作为交付结论。

- **自动化优先**：能写脚本/命令自动完成的验证不手工描述；发现可固化的检查项应沉淀为脚本或文档规则。

- 接管浏览器等一切可自动化环境（与铁律一「全权接管所有包括浏览器等等」一致），不把操作步骤丢回用户。

## 铁律七：功能模块增删必须全量同步

每次**添加、修改或删除**任何功能模块（含规则、文档、依赖、配置），AI 必须同步更新项目内所有受影响工件，不允许「只改代码不改文档」。

- 同步范围（按实际涉及项）：源代码与补全、依赖清单 + 锁文件（铁律五）、版本号与 RELEASE_CHANNEL（铁律四）、PRD（Mim-PRD.html）、Wiki（docs/wiki/*）、README。

- 交付报告必须附**同步清单**：列出本次随模块变动更新的工件，以及明确不涉及的工件（标注「不涉及」）；漏更新视为交付未完成。

- 删除模块时同样适用：需同步清理文档、依赖、索引与版本记录，不得留下悬空引用。

## 铁律八：任务完成后必须全自动化部署到远程生产环境（禁止只做本地预览）

**本地运行 / 本地预览不是交付终点，只是过程验证手段。**

- 每轮任务（新增功能、修复、改造、文档/静态站点变更）完成后，AI 必须把整个项目 **前后端 + 数据库** 自动部署到远程生产环境并上线可访问，不得以「本地跑通了」「本地预览正常」「你自己部署一下」作为交付结论。

- 部署链路必须**全自动化、可重放**：CI（GitHub Actions）在 `main` 上触发 → 安装依赖 → 类型检查 → 测试 → 构建 → 远程发布 → 重启服务 → 健康检查；服务器侧以幂等脚本（`deploy/*.sh`）实现，禁止依赖手工敲命令。（**现状标注 2026-11-09**：`deploy/` 已于 2026-11-08 从工作树移除且未提交，见 §0；规则语义不变，恢复或收敛须按铁律二授权。）

- **禁止只交付静态站点的本地预览**：静态产物（`apps/web` 构建产物）必须与后端 API、数据库一起上线到生产域名；生产部署配置（nginx / systemd / CI）必须入库（`deploy/`、`.github/workflows/`），不得散落在个人机器。（**现状标注 2026-11-09**：`.github/workflows/deploy.yml` 仍在库，`deploy/` 已不在工作树，CI 存在悬空引用，见 §0。）

- 交付报告必须附**线上取证**：生产域名健康检查（如 `curl https://<域名>/health` 返回 200）、关键接口返回（如 `/api/v1/plans`）、以及一次真实端到端操作（登录 / 建项目 / 建任务 / 仪表盘）的浏览器验证结果。**无线上取证不得宣称「已上线」。**

- 数据库必须是**持久化生产库**（非内存库、非临时目录），备份与迁移脚本随部署工件入库。

- 若生产环境客观不可达（无主机、无凭证、无网络），按铁律一处置：先穷尽可执行动作并附取证，再明确报告缺口，不得以「本地预览」替代上线。

## 铁律九：多平台部署矩阵——只走免费方案，且必须逐平台取证

**本项目部署矩阵为 10 个免费平台（2026-11-10 按用户指令新增 Gitee（码云）镜像仓为第 10 行），任何一轮部署都不得脱离该矩阵、不得引入付费方案。**

> ⚠️ **表格口径（2026-11-09 梳理标注）**：下表「状态 / 访问速度」为 **2026-11-08 18:14 成片导出交付轮**的历史快照，按铁律三原样保留，**不得作为本轮现状引用**；本轮真实 `curl` 复核见 [§9.1](#91-本轮复核2026-11-09-1754-0800)。表内 `✅ 已上线` 亦不表示 2026-11-09 生产可达，生产可达性以 §0 与 §9.1 为准。

| 平台 | 免费 | 状态 | 域名 | 访问速度（HTTP / 耗时 / 连接） |
|---|---|---|---|---|
| 腾讯云自建服务器 | ✅ 是（自有服务器） | ✅ 已上线（前后端 + SQLite） | `https://mim.mixm.top` | 200 / 0.061s ⚡最快（2026-11-08 18:14 本轮实测：`/health` 200 / 0.061s / 0.001s / LEN=53；首页 200 / 0.064s / 0.001s / LEN=5182，产物 `assets/index-D2UkZqM1.js` + `assets/index-CeRvh2Rf.css`；五条深链接 `/comic` 0.073s / `/store` 0.079s / `/chat` 0.071s / `/settings` 0.066s / `/login` 0.068s 全 200 / LEN=5182，nginx `try_files` 生效；`/admin/` 200 / 0.069s / LEN=1430；`/api/v1/modules` 200 / 0.076s / LEN=438；`/api/v1/site/overview` 404 / LEN=126；**导出路由匿名探测 `POST /api/v1/comic/films/does-not-exist/export` 返回 401 `AUTH_UNAUTHORIZED` 而非 404，证明路由在线**；生产 Edge CDP E2E 8/8——新 bundle 加载、`/store` 匿名渲染 8 个模块卡片、搜索 comic 命中漫剧工作台 → 详情面板「状态: 已上架 / 依赖链 / 价格历史」、`/comic` 匿名内嵌登录卡片、console 零报错；**本轮（2026-11-08 18:3x）商城种子由 1 个模块扩充为 8 个（含付费生成包与依赖链），`/api/v1/modules` 现返回 8 条、`/store` 不再显空**） |
| 腾讯云 EdgeOne Pages | ✅ 是 | ✅ 已同步（**direct upload 直传型，非仓库连接**；最近一次 Deployment `dpu0n61jlos8`，2026-11-08，`git worktree` 干净树 HEAD `42b98bc` 构建产物，经 `edgeone makers deploy apps/web/dist -n mim-app --env production` 直传；**curl 命中 WAF 挑战页，须有头浏览器取证**） | `https://data.mixm.top` | 200 / 0.075s / 0.001s 但仅 985B 为 EdgeOne WAF 机器校验页（`EO_Bot_Ssid` / `_0x649a` 命中，本轮未做内容层复验；CI「托管平台同步」作业 success 作替代取证）；**2026-11-08 04:33 有头 Edge + CDP 人工放行后商城全链路通过**（历史留痕，放行凭证会过期）：`title=Mim`、`isWafChallenge=false`、搜索/详情/`/api/v1/modules` 200、console 零报错 |
| GitHub Pages | ✅ 是 | ✅ CI 自动发布（**含 `?tads` / 裸问号归一化脚本，已实测**） | `https://afdk1991.github.io/mim/` | `/mim/` 200 / 0.867s / 0.001s / LEN=5182（产物 `assets/index-COy8rstl.js`，根构建注入 `VITE_API_ORIGIN` 与自建同源指纹不同属预期）；深链接 `/mim/store` 404 / 0.370s / LEN=5182 属 `404.html` 逐字节副本的预期设计，浏览器加载后 SPA 直接启动 |
| Sealos | ✅ 是 | ✅ CI 自动发布（容器 + PVC；**纯 API 容器，根路径 `/` 404 无路由，`/health` 200**） | `https://mim-i3ywsdfn.cloud.sealos.io` | `/health` 200 / 0.718s / 0.001s / LEN=53（`{"status":"ok"}`；根路径 `/` 404 属纯 API 容器未注册根路由，本轮未重测；`/store` 等 Web 路由命中 API 返回 `route GET /store not found` 404 JSON 属预期——Sealos 为纯 API 容器，不托管商城 SPA；商城 SPA 仅在 `mim.mixm.top` / GitHub Pages / Cloudflare Pages 提供） |
| Cloudflare Pages | ✅ 是 | ✅ CI 自动发布（含 `/api` 反代与 `?tads` / 裸问号归一化脚本；**`functions/[[catchall]].js` catch-all 修复深链接 404 已上线**） | `https://mim-8ah.pages.dev` | 首页 200 / 1.384s / 0.001s / LEN=5182（产物 `index-D2UkZqM1.js` 与自建同指纹）；带 `Accept: text/html` 头深链接 `/store` 200 / 0.931s、`/comic` 200 / 0.842s、`/login` 200 / 1.526s 全 LEN=5182（catch-all Function 生效）；裸 curl `/store` 404 / 0.791s / LEN=5182 属预期——函数只对 html 导航重写 |
| GitHub Packages (ghcr) | ✅ 是 | ✅ CI 自动推送镜像 | `ghcr.io/afdk1991/mim-api` | 401 / 1.087s / 0.001s / LEN=73（未鉴权 401 `UNAUTHORIZED` 属正常；CI `packages` 作业 success 推送 `ghcr.io/afdk1991/mim-api:{latest,sha}`） |
| IGA Pages | ✅ 是 | ✅ 已部署（Project `fr95fuwu57` / Deploy `p4f5a4svqm`） | `preview.iga-pages.com`（带 `iga_token` 访问 200） | 200（需 token）/ 未纳入本轮本机 curl 批次；CI「托管平台同步」作业 success |
| Vercel | ✅ 是 | ✅ CI 取证通过（2026-11-06T13:15:10Z） | `https://mim-puce.vercel.app` | CI「托管平台同步」作业 success（本轮 run 42470091995）；本机 000 / 0.183s（curl exit 35：schannel `failed to receive handshake, SSL/TLS connection failed`），`nslookup` 解析至 2001::c73b:94ca / 216.198.79.3 / 64.29.17.3，属本机网络侧 TLS 阻断 |
| GitHub 仓库 | ✅ 是 | ✅ 已同步（远端 main HEAD `3271204`，2026-11-08 18:14 `git ls-remote` 取证，本地 0 ahead / 0 behind） | `https://github.com/afdk1991/mim` | 本机 HTTPS 000（TLS 阻断，历史取证）；替代取证 `git ls-remote origin refs/heads/main` = `3271204` ✅，CI run 42470091995 五作业全绿（2026-11-08T10:07:48Z → 10:09:54Z） |
| **Gitee（码云）**（2026-11-10 新增为第 10 行） | ✅ 是 | ✅ 已同步（源码国内镜像仓，远端 `gitee`；**无 CI 推送作业，按铁律十二每轮手工同推**） | `https://gitee.com/mallwm_admin/mim` | **200 / 0.469s / LEN=52034（2026-11-10 22:20 本轮实测）**：`curl https://gitee.com/mallwm_admin/mim` → 200 / 0.469s / 52034B，页面标题「mim: Mim - 跨平台商业级项目(GitHub 镜像)」、默认分支 `main`、129 次提交；git 通道 `git ls-remote gitee refs/heads/main` = `4398cf0`（exit 0 / 0.27s），与本地 HEAD 一致（0 ahead / 0 behind）。矩阵成员身份与 `in_matrix` 标记见 `packages/core-domain/src/deploymentRegistry.json` |

### 9.1 本轮复核（2026-11-09 17:54 +08:00）

**性质**：文档梳理轮的可访问性复核，无新部署、未重跑 CI、未做浏览器 E2E；本机中国网络经本地代理出网，HEAD `3b9b251`。

| 平台 / 入口 | 探测 URL | HTTP | 总耗时 | LEN | 判读 |
|---|---|---|---|---|---|
| 腾讯云自建 | `/health` | 000 | 2.149s | 0 | curl exit 7：本地代理 `CONNECT tunnel failed, response 502`；DNS 正常解析 `115.159.159.11`；主机侧状态本轮不可验证 |
| 腾讯云自建 | `/` | 000 | 2.072s | 0 | 同上 |
| EdgeOne Pages | `/` | 200 | 0.697s | 985 | **WAF 挑战页**（`EO_Bot_Ssid` / `_0x649a`），按下方「WAF 假阳性判别规则」不作内容取证 |
| GitHub Pages | `/mim/` | 200 | 0.764s | 5182 | 产物 `assets/index-CcCuY8hw.js` |
| Sealos | `/health` | 200 | 0.882s | 53 | `{"status":"ok"}`（纯 API 容器，根路径无路由属预期） |
| Cloudflare Pages | `/` | 200 | 0.892s | 5182 | 产物 `assets/index-BoTlMYaC.js` |
| ghcr | `/v2/` | 401 | 0.671s | 73 | 未鉴权 `UNAUTHORIZED`，属正常 |
| Vercel | `/` | 000 | 10.005s | 0 | `--max-time 10` 截断；`nslookup` 见 `2a03:2880:f11c:8083:face:b00c:0:25de` / `159.106.121.75`，DNS 污染特征 |
| IGA Pages | — | 未测 | — | — | 需 `iga_token` 私有凭证，本轮未纳入 curl 批次，按铁律一如实标注「未测」，不以历史 200 冒充 |
| GitHub 仓库 | — | — | — | — | 本机 HTTPS 阻断；替代取证 `git ls-remote origin refs/heads/main` = `3b9b251` ✅ |

- **产物指纹变化**：GitHub Pages `index-CcCuY8hw.js`、Cloudflare Pages `index-BoTlMYaC.js`，与历史快照的 `index-D2UkZqM1.js` / `index-COy8rstl.js` 均不同，证明线上产物已更新；两站因根构建注入 `VITE_API_ORIGIN` 而指纹不同，属既有设计。
- **本机不可达 ≠ 部署失败**（铁律九）：自建域名 `000` 已附代理 502 与 DNS 证据；但本轮**未取得**新 CI run、平台控制台或服务端日志作为替代取证，故**不声明生产「已上线」**，仅声明 4 个静态 / API 入口 200 可访问。
- **本轮未做**（不以历史结果冒充）：线上 `/api/v1/modules` 内容层、深链接带 `Accept: text/html` 复核、EdgeOne 有头浏览器放行后的内容层、生产浏览器 E2E。

**规则补充轮复核（2026-11-09 18:30 +08:00，铁律十二立规轮；无新部署、未重跑 CI、未做浏览器 E2E）**：本机中国网络经本地代理出网，HEAD `3b9b251`，以下为铁律十二 §12.4 的 V1–V6 本轮实测，按铁律九追加、不覆盖上方 17:54 快照。

- **V1 双远端**：`git ls-remote origin refs/heads/main` = `3b9b251`（0 ahead / 0 behind ✅）；`git ls-remote gitee refs/heads/main` **exit 124（25s 超时，仅返回 TLS 证书校验禁用告警）**，按 §12.2 如实标注「`gitee` 本轮未取证」，**不冒充全量同步**；本轮无 commit，未 push 任何远端。
- **V2 / V3 生产**：`mim.mixm.top` 的 `/health`、`/`、`/api/v1/modules` 均 `000` / 约 2.14s / LEN=0（curl exit 7，本地代理 `CONNECT tunnel failed, response 502`），主机侧无 SSH / `tccli` 凭证可验证 → **未通过，不宣称已上线**。
- **V5 逐平台**：`data.mixm.top` 200 / 0.087s / 985B（WAF 挑战页，不作内容取证）；GitHub Pages `/mim/` 200 / 1.332s / 5182B；Sealos `/health` 200 / 0.713s / 53B；Cloudflare Pages 200 / 0.677s / 5182B；ghcr `/v2/` 401 / 0.736s / 73B（未鉴权属正常）；Vercel 000 / 0.270s；IGA Pages 需 `iga_token` 私有凭证，本轮未测。
- **V4**：未做（生产主机不可达，无真实渲染对象）。**V6 本地门禁**：`pnpm -r typecheck` 0、`pnpm --filter @mim/api test` **12 文件 174/174**、`verify-auth-gate` **35/35**、`comment-check --strict` 0、`npm run check` 0，全绿。
- **结论**：本轮为规则补充与文档清理，无新代码产物；按铁律八 / 十二如实标注**未做生产部署**，不以本地门禁通过或分发平台 200 冒充「已上线」。

### 9.2 本轮复核（2026-11-10 01:10 +08:00，全项目体检与修复轮）

**性质**：仓库全面体检 + 可逆修复，无新功能产物、未触发任何线上部署、未 push。本机中国网络直连，HEAD `e7e364d`。

| 项 | 本轮实测 | 判读 |
|---|---|---|
| 工作树恢复 | `git checkout -- .` 恢复 23 个 `D` 工件；随后 `git status --short` 仅剩 1 个未跟踪草稿 | ✅ 工件恢复 |
| 远端同步 | `git ls-remote origin refs/heads/main` = `e7e364d`，与本地 HEAD 一致（0 ahead / 0 behind） | ✅ |
| 部署清单一致性 | `node scripts/verify-deployments.mjs` 由 **51/52**（D26 失败）转为 **52/52 PASS** | ✅ |
| 生产可达性 | `curl https://mim.mixm.top/health` → **exit 7**（本地代理 `CONNECT tunnel failed`），无 SSH / `tccli` 凭证 | 未通过，不宣称已上线 |
| 本地门禁 | typecheck 0；api test **15 文件 211/211**；comment-check `--strict` 0（102 文件 / 89.3%）；`npm run check` 0 | ✅ 全绿 |
| 构建 | `@mim/web`、`@mim/admin`、`@mim/api`、根 `dist` 四套构建均 0 | ✅ |

- **未做**：CI run 取证（本机无法访问 GitHub Actions 页面）、生产浏览器 E2E、IGA Pages 探测（缺 `iga_token`）、Render / Azure / Netlify 真实发布（缺平台账号与 secret）。
- **结论**：本轮修复的是「工作树与 HEAD 不一致导致 CI 依赖悬空」这一确凿缺陷，以及由此派生的清单口径漂移；生产侧结论不变——**未取得线上取证，不声明已上线**。

### 9.3 提交、双推与真实 CI 取证（2026-11-10 01:2x–01:5x +08:00）

**性质**：把 §9.2 的修复真正推上去并取一次真实 CI 结果；本轮只改 `.github/workflows/deploy.yml` 的凭据守卫与本节，不改任何业务代码。

| 项 | 本轮实测 | 判读 |
|---|---|---|
| 提交 | `f15b8c5`（12 files changed, 301 insertions, 152 deletions） | ✅ |
| `origin/main` | `e7e364d..f15b8c5  main -> main` | ✅ |
| `gitee` 镜像 | `git push gitee main` 与 `git ls-remote gitee` 两次均挂起（>10 分钟无输出后终止） | ❌ 本机到 gitee 不可达，**镜像未同步** |
| CI（`gh` 取证） | run **42664471175**（Deploy @ `f15b8c5`）failure；42664471471（Azure SWA）success；上游 42657119711（Deploy @ `e7e364d`）已 failure、42655995208（Deploy @ `c1f8416`）已 failure | 见下 |
| Deploy 作业逐项 | 质量门禁 ✅ / 托管平台同步 ✅ / GitHub Pages ✅ / **发布到生产服务器 ❌** / GitHub Packages ✅ | 唯一失败点 |
| 失败根因 | 失败 step「上传本次提交的部署脚本」日志：`ssh: Could not resolve hostname : Name or service not known` → `@` 前主机名为空 | 凭据缺失 |
| 凭据取证 | `gh api repos/afdk1991/mim/actions/secrets` → `{"total_count":0,"secrets":[]}` | 仓库**零 secret** |

- **假绿说明**：「托管平台同步（Cloudflare / Vercel / Sealos / IGA / Netlify / Render）success」= 六个平台 step 全部命中 `SKIP: 缺少 XXX; exit 0`，不代表任何平台真的发过；Azure / Pages / Packages 三个作业不依赖私有凭据，属真绿。
- **修复后复验**：run **42666493322**（Deploy @ `49bbd46`）**completed success**，五作业全绿；「发布到生产服务器」内 `检查生产主机凭据` 执行、7 个远程步骤 `skipped`、`未配置凭据 SKIP 提示` 成功并输出 `::warning::`。绿≠已上线：生产仍未部署。
- **本轮修复（`.github/workflows/deploy.yml`）**：新增 `检查生产主机凭据`（id `creds`，输出 `has_creds`），7 个远程步骤加 `if: steps.creds.outputs.has_creds == '1'`，并新增 `未配置凭据 SKIP 提示`（`has_creds == '0'` 时 `::warning::` 明示「不等于已上线」）。凭据齐备时行为与原流程完全一致，失败依旧红；凭据缺失时不再用空主机名硬失败，红信号恢复可判别性。
- **仍未满足的铁律八**：`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` 属私有凭据（铁律一例外），沙箱无法生成；在补齐前生产部署恒为 SKIP，**不得宣称已上线**。其余平台 token 清单见 `docs/仓库体检报告-2026-11-10.md` §6.4。
- **本轮本地门禁**（提交前）：`typecheck` 0；api test **15 文件 211/211**；`verify-deployments` **52/52**；`comment-check --strict` 0；`env-check` 0；`deploy.yml` 经 `yaml.safe_load` 解析通过（11 个 step、7 个远程 step 均带 `has_creds == '1'` 守卫）。


- **免费是硬约束**：新增平台前必须确认无付费门槛；`veFaaS` 等**无长期免费层**的方案已移出交付范围，不得重新引入。`Render` 因存在长期免费层（750 实例小时/月），已于 2026-11-06 按铁律十改为「免费候选平台」，不再属于排除项。
- **每次部署必须更新取证**：表中「HTTP / 耗时 / 连接」须以当轮真实 `curl`（或 CI 出口）结果刷新，并注明测试日期与本机网络位置；不得沿用旧数据冒充本轮结果。
- **本机不可达 ≠ 部署失败**：`000` 类结果必须给出网络侧证据（DNS 污染地址、TCP 超时、HTTPS 阻断），并以 CI 日志、`git push` / `gh` CLI、平台控制台作为替代取证；无替代取证不得声明「已上线」。
- **变更须全量同步**（铁律七）：平台增删、域名变更、凭证变更时，同轮更新本表、README、`docs/wiki/05-runbook.md`（含 DNSPod 对应表）与 CI 工作流，缺一视为交付未完成。
> **历史留痕导航（2026-11-09 梳理新增）**：紧随其后的 5 个长段落是各交付轮当时的取证快照，按铁律三保留原数值与口径，**均不冒充本轮结果**；本轮现状以 §0 与 §9.1 为准。按起始短语定位：

| 序号 | 时间 / HEAD | 轮次性质 | 该轮关键结论（仅历史） |
|---|---|---|---|
| H1 | 2026-11-08 04:01 / `d4c4620` | 可访问性复测 | 九平台状态码与基线一致，无新部署 |
| H2 | 2026-11-08 05:05 / `83f454c` | 按需登录交付 | `verify-auth-gate --live` 52/52、生产匿名态 6/6 |
| H3 | 2026-11-08 17:42 / `1b3072e` | 仓库 / 文档一致性加固 | 契约测试 10 文件 145/145、注释 90.5%（当时口径） |
| H4 | 2026-11-08 18:14 / `3271204` | 成片导出交付 | 契约测试 11 文件 154/154、成片导出 E2E 14/14、生产 E2E 8/8 |
| H5 | 2026-11-08 18:3x / HEAD 待定 | 商城充实 | `seedModules` 由 1 扩为 8 个模块，本地 `/store` 8 张卡片 |

> 各轮测试规模差异（145 → 154 → 174 → 211）来自后续新增契约用例；**本轮为 15 文件 211 例**，见 §0 / §9.2，历史数字不改写、不作现状引用。

- **上一次复测（历史留痕，2026-11-08 04:01:51 +08:00，本机中国网络 curl，HEAD `d4c4620`「docs: 刷新铁律九平台矩阵取证」，性质为可访问性复测轮——无新部署、未重复浏览器 E2E 与 CI 重跑，商城接口逐项与 E2E 结论沿用 2026-11-08 03:31 轮次）**：`mim.mixm.top/health` 200 / 0.071s / 0.036s、`mim.mixm.top/` 200 / 0.065s / 0.025s / LEN=2896 且首页产物 `assets/index-s6n-xZuf.js` + `assets/index-DFqN9O7h.css` 含 `?tads` / 裸问号归一化脚本（`history.replaceState`）、`mim.mixm.top/admin/` 200 / 0.065s / 0.029s / LEN=1430、`mim.mixm.top/api/v1/modules` 200 / 0.066s / 0.027s、**`data.mixm.top` 200 / 0.103s / 0.030s / LEN=985 为 WAF 挑战页（放行凭证自 2026-11-07 01:48 起已过期，真实内容连续多轮未复验；替代取证为 `git worktree` 干净树（HEAD `42b98bc`）构建产物直传 Deployment `dpu0n61jlos8`（exit 0，产物指纹 `index-s6n-xZuf.js` 与生产服务器一致））**、GitHub Pages 200 / 0.216s / 0.079s / LEN=2896（含归一化脚本，产物 `assets/index-CDuo76_9.js`）、Sealos `/health` 200 / 0.272s / 0.101s / LEN=53（`{"status":"ok"}`；根路径 `/` 404 / 0.264s / 0.093s / LEN=106 属正常，纯 API 容器未注册根路由）、Cloudflare Pages 200 / 0.534s / 0.169s / LEN=2896（含归一化脚本，产物 `assets/index-s6n-xZuf.js` 与生产服务器同指纹）、ghcr tags 未鉴权 401 / 0.544s / 0.111s（`UNAUTHORIZED` 属正常）、Vercel 本机 000 / 21.271s（`--max-time 25` 截断，curl exit 28；`nslookup` 解析至 162.125.32.9（Dropbox 段）与 2a03:2880:f126:83:face:b00c:0:25de（Facebook 段 IPv6），典型 DNS 污染特征；CI「托管平台同步」作业含 Vercel 部署成功作替代取证）、github.com 本机 000 / 0.020s（curl exit 35：TLS 握手被阻断，TCP 可连；仓库操作经 `git ls-remote` 取证 ✅，远端 main HEAD = `d4c4620`）。速度排序（本机总耗时升序）：自建 0.065s < EdgeOne 0.103s（WAF 挑战页）< GitHub Pages 0.216s < Sealos 0.272s < Cloudflare Pages 0.534s < ghcr 0.544s。状态码与基线一致，无渠道新增或失效。
- **历史留痕：最近一次复测（2026-11-08 05:05:32 +08:00，按需登录交付轮——商城 `/store` 匿名可浏览、`/comic` `/chat` `/settings` 收费/私密视图匿名访问时于内容区内嵌登录卡片，本机中国网络 curl，HEAD `83f454c`，CI run 42413909910 五作业全绿）**：自建全链路实测——`/health` 200 / 0.087s / 0.045s / LEN=53、首页 200 / 0.066s / 0.024s / LEN=5182（含归一化脚本与 `history.replaceState`，产物 `assets/index-ChbzA5PZ.js` + `assets/index-CeRvh2Rf.css`）、**五条深链接 `/store` 200/0.089s、`/comic` 200/0.062s、`/chat` 200/0.068s、`/settings` 200/0.059s、`/login` 200/0.066s 全部 LEN=5182（nginx `try_files` SPA 回落实测生效）**、`/admin/` 200 / 0.062s / 0.027s / LEN=1430、`/api/v1/modules` 200 / 0.062s / 0.023s / LEN=438；**Cloudflare Pages 带 `Accept: text/html` 头深链接实测——`/store` 200/0.570s、`/comic` 200/0.579s、`/login` 200/0.494s 全部 LEN=5182（catch-all Function 生效；裸 curl 默认 `Accept: */*` 得 404 属预期，函数只对 html 导航重写）**，首页 200 / 0.678s / 0.179s / LEN=5182（产物与自建同指纹 `assets/index-ChbzA5PZ.js`）；GitHub Pages `/mim/` 200 / 0.535s / 0.259s / LEN=5182（产物 `assets/index-Mq2I8smM.js` + `assets/index-CeRvh2Rf.css`），深链接 `/mim/store` 404 / 0.328s / LEN=5182（`dist/404.html` 逐字节副本，404 状态码属平台能力上限的预期设计，浏览器加载后 SPA 直接启动渲染）；Sealos `/health` 200 / 0.269s / 0.103s / LEN=53（根路径 `/` 404 属正常，纯 API 容器未注册根路由）；ghcr 未鉴权 401 / 0.552s / 0.115s / LEN=73（`UNAUTHORIZED` 属正常）；EdgeOne `data.mixm.top` curl 200 / 0.116s / 0.040s 但仅 985B 为 WAF 挑战页（`EO_Bot_Ssid` / `_0x649a`；真实内容最近一次复验为 2026-11-08 04:33 有头 Edge + CDP 人工放行后商城全链路通过，放行凭证仍会过期）；Vercel 本机 000 / 21.286s（`--max-time 25` 截断，curl exit 28，DNS 污染，CI「托管平台同步」作业替代取证）；github.com 本机 000 / 0.018s（curl exit 35：schannel `CRYPT_E_NO_REVOCATION_CHECK`，TLS 握手被阻断，TCP 可连），`git ls-remote` 取证远端 main HEAD = `83f454c` ✅。**SPA 回退四件套终态分工沿用**：生产 nginx `try_files`（200 重写）、CF Pages `functions/[[catchall]].js`（200 重写）、GitHub Pages `dist/404.html`（404 状态 + SPA 全文）、`apps/web/public/_redirects`（EdgeOne Pages 等仍解析它的平台）。**按需登录 E2E 取证**：本地 `scripts/verify-auth-gate.mjs --live` 52/52 全 PASS（35 条静态断言 + 17 场景 Edge CDP）；生产匿名态 live 6/6 核心场景全 PASS（商城 `/store` 匿名可浏览、`/comic` `/chat` `/settings` 匿名访问内嵌登录卡片、登录页直达、`/admin/` 登录页正常）；生产登录链路因 `POST /api/v1/auth/code` 返回 503 `AUTH_CHANNEL_NOT_CONFIGURED`（SMS 通道未配置）以本地替代取证。状态码与基线一致，无渠道新增或失效。
- **历史留痕：最近一次复测（2026-11-08 17:42:36 +08:00，仓库 / 文档一致性加固轮——无新功能部署、未重跑 CI 与浏览器 E2E，本机中国网络 curl，HEAD `1b3072e`）**：自建全链路——`/health` 200 / 0.074s / 0.035s / LEN=53（`{"status":"ok","service":"mim-api","version":"0.0.0"}`）、首页 200 / 0.075s / 0.034s / LEN=5182（产物 `index-ChbzA5PZ.js` + `index-CeRvh2Rf.css`）、五条深链接 `/store` 0.060s / `/comic` 0.063s / `/chat` 0.064s / `/settings` 0.053s / `/login` 0.061s 全部 200 / LEN=5182、`/admin/` 200 / 0.093s / LEN=1430、`/api/v1/modules` 200 / 0.066s / LEN=438（返回 1 条 `comic.workbench` 上架模块）、`/api/v1/site/overview` 404 / LEN=126（`NOT_FOUND` 信封）；GitHub Pages `/mim/` 200 / 0.402s / 0.073s / LEN=5182（产物 `index-Mq2I8smM.js`）、深链接 `/mim/store` 404 / 1.008s / 0.119s / LEN=5182（`404.html` 逐字节副本，属平台能力上限预期设计）；Cloudflare Pages 首页 200 / 2.401s / 0.160s / LEN=5182（与自建同指纹），带 `Accept: text/html` 头 `/store` 200 / 0.982s、`/comic` 200 / 0.749s、`/login` 200 / 0.948s 全部 LEN=5182，裸 curl `/store` 404 / 0.562s 属 catch-all Function 按设计只重写 html 导航；Sealos `/health` 200 / 0.366s / 0.196s / LEN=53；EdgeOne `data.mixm.top` 200 / 0.090s / 0.034s 但仅 985B 为 WAF 挑战页（`EO_Bot_Ssid` / `_0x649a`，真实内容本轮未以有头浏览器复验）；ghcr 401 / 0.537s / 0.107s / LEN=73（正常）；Vercel 本机 000 / 21.276s（curl exit 28，DNS 污染，CI「托管平台同步」作业替代取证）；github.com 本机 000 / 0.015s（curl exit 35：schannel 吊销检查阻断 TLS，TCP 0.007s 可连），`git ls-remote` 取证远端 main HEAD = `1b3072e`、本地 0 ahead / 0 behind ✅。**本轮本地门禁**：`pnpm -r typecheck` 0、`pnpm --filter @mim/api test` 10 文件 **145/145**、`npm run check` 0、`comment-check --strict` 0（总体 90.5%）、web/admin/root 三套构建 0（根构建需清空 `NODE_OPTIONS` 规避本机 safe-delete 批量删除保护）。**产物指纹**：生产自建与 CF Pages 同为 `index-ChbzA5PZ.js`，GitHub Pages 为 `index-Mq2I8smM.js`（根构建注入 `VITE_API_ORIGIN` 所致，符合既有设计），与仓库 HEAD 一致、无未部署的前端改动。状态码与基线一致，无渠道新增或失效。
- **[H4 历史留痕] 复测（2026-11-08 18:14:17 +08:00，成片导出交付轮——HEAD `3271204`，CI run 42470091995 五作业全绿，本机中国网络 curl + 生产 Edge CDP）**：自建 `/health` 200 / 0.061s / 0.001s / LEN=53、首页 200 / 0.064s / LEN=5182（**本轮新产物 `index-D2UkZqM1.js` + `index-CeRvh2Rf.css`**，与本地同源构建逐字一致，证明本轮前端改动已上线）、五条深链接 `/store` `/comic` `/chat` `/settings` `/login` 全 200 / LEN=5182（0.066–0.079s）、`/admin/` 200 / 0.069s / LEN=1430、`/api/v1/modules` 200 / 0.076s / LEN=438、`/api/v1/site/overview` 404 / LEN=126、`POST /api/v1/comic/films/does-not-exist/export` 匿名 401 `AUTH_UNAUTHORIZED`（导出路由在线）；GitHub Pages `/mim/` 200 / 0.867s / LEN=5182（`index-COy8rstl.js`，根构建注入 API 源）、深链接 `/mim/store` 404 / 0.370s / LEN=5182 属 `404.html` 预期设计；Cloudflare Pages 首页 200 / 1.384s / LEN=5182（与自建同指纹），带 `Accept: text/html` 头 `/store` 200 / 0.931s、`/comic` 200 / 0.842s、`/login` 200 / 1.526s 全 LEN=5182，裸 curl `/store` 404 / 0.791s 属 catch-all 按设计只重写 html 导航；Sealos `/health` 200 / 0.718s / LEN=53；EdgeOne 200 / 0.075s / LEN=985 仍为 WAF 挑战页（`EO_Bot_Ssid` / `_0x649a`，真实内容本轮未复验）；ghcr 401 / 1.087s / LEN=73 正常；Vercel 本机 000 / 0.183s（curl exit 35，schannel TLS 握手失败，`nslookup` 见 2001::c73b:94ca 等），CI「托管平台同步」success 替代取证；github.com 本机 HTTPS 阻断，`git ls-remote` 取证远端 main = `3271204` ✅。**本轮门禁**：`pnpm -r typecheck` 0、`pnpm --filter @mim/api test` 11 文件 **154/154**、`npm run check` 0、`comment-check --strict` 0（90.1%）、`verify-auth-gate` 35/35、web/admin/api/root 四套构建 0、`npm run verify:film-export` Edge CDP **14/14**（真实登录→造工程→成片→MOV/720p 转码降级→一键原片直下→下载链接可见→零控制台错误→零横向溢出）。**生产浏览器 E2E 8/8**：`/store` 匿名渲染商城、加载新 bundle、地址栏无 `?tads`、模块卡片来自真实 `/api/v1/modules`、输入 comic 提交搜索得 1 个结果、点「详情」展开「状态: 已上架 / 依赖链 无前置依赖 / 价格历史 暂无定价记录」、`/comic` 匿名内嵌「此功能需登录后使用」、console 零报错。**生产登录链路**：密码登录需服务器 `/opt/mim/mim-api.env` 中的 `MIM_AUTH_ADMIN_PASSWORD`（私有凭证、沙盒不可读），验证码通道生产返回 503 `AUTH_CHANNEL_NOT_CONFIGURED`；故登录后的成片导出全链路以本地 14/14 E2E 作为替代取证，不冒充生产登录态。状态码与基线一致，无渠道新增或失效。
- **[H5 历史留痕] 复测（2026-11-08 18:3x +08:00，商城充实轮——HEAD 待定，本地 Edge CDP 验证，本机中国网络 curl）**：**根因修复**：此前用户反馈「商城看不到」，定位为 `services/mim-api/src/db.ts` 的 `seedModules` 仅种入 1 个模块（`comic.workbench`），`/store` 虽正常渲染但页面显空（仅 1 张卡片 + 大块留白）。本轮将种子扩充为 **8 个模块**（cn/global 双区各一套）：`comic.workbench`（免费）、`comic.genpack.basic` ¥99/`$14.99`、`comic.genpack.pro` ¥299/`$42.99`（前置 basic）、`comic.genpack.team` ¥999/`$139.99`（前置 pro）、`ai.dubbing` ¥199/`$28.99`、`ai.script`（免费）、`media.storage` ¥49/`$6.99`、`template.pack`（免费），含付费价格与依赖链。**本地验证**：`pnpm --filter @mim/api build` 0、`api` 契约测试 11 文件 **154/154**、`pnpm -r typecheck` 0、`comment-check --strict` 0（90.1%）、`npm run check` 0、web 构建 0；本地 `GET /api/v1/modules` 返回 **8 条**、`Edge CDP` 渲染 `/store` 确认 8 张模块卡片（3 列网格）标题/价格/前置依赖/详情按钮全部可见、零控制台错误；生产 Edge CDP E2E 与九平台取证将在 push + CI 后刷新。**说明**：`/store` 为 Web SPA 路由，仅 `mim.mixm.top` / GitHub Pages / Cloudflare Pages 托管前端；`data.mixm.top`（EdgeOne）为 WAF 验证页、`mim-i3ywsdfn.cloud.sealos.io`（Sealos）为纯 API 容器（`/store` 命中 API 返回 404 JSON 属预期），此二者本就不提供商城 SPA，非缺陷。
- **CI 重跑运维提示（2026-11-07 取证）**：`gh run rerun <run-id> --failed` 会在**同一 workflow run 内二次上传** `github-pages` artifact，导致 `actions/deploy-pages@v4` 报 `Multiple artifacts named "github-pages" were unexpectedly found for this workflow run. Artifact count is 2.` —— 重跑无效。正确做法是 `gh workflow run deploy.yml --ref main` 触发**全新 run**，再 `gh run watch <new-run-id> --exit-status` 监控。
- **WAF 假阳性判别规则**：EdgeOne 等带机器人校验的托管平台，`curl` / 无头 UA 可能拿到 200 但响应体为数百字节混淆 JS（含 `EO_Bot_Ssid` / `_0x649a`）。此类 200 **不得**作为「内容正确」的取证；须以有头真实浏览器（本机 Edge + CDP）读取 `document.title` / `script[src]` / `body.innerText` 并确认 `isWafChallenge=false`。
  - **拦截面实测（2026-11-07）**：`curl` / 无头 UA → 层 1 混淆 JS（约 986B）；**无头浏览器（`--headless=new`）与全新 user-data-dir 的有头 Edge → 层 2 验证码页**（`title=Security Verification`、`https://captcha.eo.gtimg.com/TEOCaptchaWidgetV1.js`、`htmlLen≈16419`、文案「正在验证连接安全性」）。判定正则须同时覆盖 `EO_Bot_Ssid|_0x649a|TEOCaptchaWidgetV1|正在验证连接安全性`。
  - **可通过方式与其失效边界**：复用**已通过过校验的** user-data-dir（本机 `$env:TEMP\edge-cdp-profile`）+ 有头模式 + CDP（`--remote-debugging-port=9333`）。新建 profile 一律落入验证码页，不可作为取证手段。**放行凭证会过期（实测约 17h 后失效：2026-11-07 01:48 复用该 profile 仍回落层 2）；层 2 的 TEOCaptcha 对 CDP 合成鼠标事件（`Input.dispatchMouseEvent`，×15 次点击）不放行；凭证过期后唯一出路是人工在有头浏览器勾选一次复选框，放行会回写 profile，后续 CDP 即可复用。**
- **`?tads` 注入机制（2026-11-07 定性）**：EdgeOne Bot 挑战脚本给地址栏附加 `?tads`，其字符串表内的清理逻辑为 `location.href=location.href.replace(/[?|&]tads/, '')`，只匹配 `?tads` 本体、不匹配清理后残留的裸问号，故留下 `https://data.mixm.top/?`。修复落在 `apps/web/index.html` `<head>`（`history.replaceState` 原地清空查询串/裸问号，不新增历史、不跳转）。`edgeone makers --help` 仅 8 个子命令，**无 WAF / Bot 管理子命令**，关闭 WAF 只能走腾讯云 Web 控制台（需用户私有登录态，沙箱无凭证）。
- **与「不使用容器」既有约定的说明**：Sealos（容器 + PVC）、ghcr 镜像与 `deploy/sealos/mim.yaml` 属分发型平台的必要载体，仅限「托管平台同步」链路；生产主链路（`mim.mixm.top`）仍为宿主机直部署（nginx + systemd + SQLite），不得改为容器运行。

### 9.4 商城两级分类改造（2026-11-10，本地门禁全绿 / 该轮未提交，已随 §9.5 一并提交为 `d65615e`）

**性质**：按用户指令把商城从「平铺模块卡片」改为**两级分类结构**（19 个一级分类 + 205 个二级条目，二级条目一律作为功能模块入库），并补齐页面筛选（排序 3 档 / 开源许可 48 项 / 编程语言 87 项）。存量 8 个模块保留并归类，付费价与依赖链未改。

| 项 | 本轮实测 | 取证方式 |
|---|---|---|
| 数据源 | `packages/core-domain/src/catalogTaxonomy.ts`（新建，唯一权威副本）：19 组 / 205 条 / 48 许可 / 87 语言 / `CATALOG_SORT_MODES` | 文件内容 + 契约测试断言与常量对齐 |
| 库结构 | `modules` 增 `category_slug` / `license` / `language` / `stars`；新建 `module_categories`（`level` 1\|2、`parent_id` 自引用、`slug` 唯一）；`ADDITIVE_COLUMNS` 与 `schema.sql` 双路径同改 | `schema.sql`、`db.ts` 迁移段 |
| 种子 | 二级条目 → 205 个模块 × cn/global = 410 行（编码 `cat.<一级slug>-<两位序号>`）；存量 8 模块经 `LEGACY_META` 归入 `ai-01` / `ai-06` / `ai-07` / `server-12` / `tools-03` | 存量开发库实测：`/taxonomy` → `groups=19 items=205 modules=213` |
| 接口 | 新增 `GET /taxonomy`；`GET /modules` 支持 `q/category/sort/licenses/languages/page/pageSize` 并返回 `total/page/page_size/total_pages`；`GET /modules/:code` 与 `/modules/manage` 补 4 字段 | 契约测试 `test/catalog-taxonomy.test.ts`（10 例） |
| 前端 | `Store.tsx` 整文件重写为两栏分类树 + 筛选面板 + 分页 + 卡片徽标 + 详情元信息行；`styles.css` 追加分类树样式段（含 960px 单列降级） | `pnpm --filter @mim/web build` 0 |
| 本地门禁 | `pnpm -r typecheck` 0（5/5）；`pnpm --filter @mim/api test` **16 文件 221 例**；`@mim/web` 构建 0（51 modules，`index-CtMbsEKS.js` 403.97 kB）；`env-check` / `version-check` / `comment-check --strict` / `verify-deployments` **52/52** / `verify-entry-manifest` / `verify-site-modules` 全 0 | 本轮真实命令输出 |
| 生产 | **未部署**：本轮未 commit / 未 push；生产主机仍不可达且仓库零 secret，按铁律八如实标注缺口 | `git status`（未提交）、§9.3 凭据取证 |

- **排障留痕（避免重复试错）**：`Store.tsx` 曾出现 `TS2322: Type 'unknown' is not assignable to type 'ReactNode'`，报错位置在「最后添加的 JSX 元素」上漂移（`<form>`、`<span>` 均被误指）。真因是 `useAsync` 的 `error` 字段类型为 `unknown`，写成 `{taxonomyState.error && <p>…</p>}` 时 `unknown` 被当作子节点渲染。**规则**：`AsyncState.error` 一律用 `!== null` 布尔判断后再渲染，禁止直接 `&&` 短路渲染。修好后报错一次性消失，探针实验全部撤销。
- **本轮未做**：`en-US` 二级条目名暂沿用中文（`seedCategoryModules` 注释已标注为占位口径，已于 §9.6 补齐）；205 个二级模块统一「免费 + 无前置」属当前假设，用户未给价格语义；「热门项目（今日/本周）」「搜索帮助浮窗」两区块未实现（用户答复口径为 "1-2"，已于 §9.5 补齐）；一级分类的管理端 CRUD 未暴露。

### 9.5 商城非分类区块补齐（2026-11-10，第二轮；本地门禁全绿 + CI 五作业全绿，生产仍 SKIP）

**性质**：用户「整个项目所有」指令后，把 §9.4 未纳入的两个非分类区块补上——右侧「热门项目（今日 / 本周）」与右下「搜索帮助」浮窗（12 条）；列表分页在 §9.4 已实现。分类树、205 个二级模块、存量 8 模块归类与付费依赖链**未改动**。

| 项 | 本轮实测 | 取证方式 |
|---|---|---|
| 热门项目接口 | 新增 `GET /modules/hot`：`range=today\|week`（24h / 168h，非法值 400 `VALIDATION_FAILED`）、`category`（一级前缀 / 二级精确 / `all`）、`limit`（1–20，默认 5）；**热度 = `stars` + 窗口内新建加权 1000**，全部由库内字段计算，不插入虚构热度 | 契约测试 3 例（`test/catalog-taxonomy.test.ts`）+ 存量开发库实测 |
| 热门项目前端 | `Store.tsx` 新增 `.store-hot` 卡片：今日 / 本周按钮组切换、榜单显示名次 + 名称 + `★ stars`、点击条目直达其所属二级分类；`styles.css` 追加 `.store-hot` / `.hot-list` / `.hot-item` / `.hot-rank` | `pnpm --filter @mim/web build` 0 |
| 搜索帮助浮窗 | `Store.tsx` 新增 `SEARCH_HELP` 固定 12 条（Git 命令在线学习 / Gitee 导入 GitHub / 仓库基础操作 / 企业版对比 / SSH 公钥 / 代码冲突 / 仓库体积 / 找回删除数据 / 配额说明 / GitHub 快速导入同步 / Release 是什么 / PHP 发布 packagist），右下方 `position: fixed` 面板 + 悬浮按钮可展开收起，条目为外链 | 同上 |
| 接口层 | `apps/web/src/api.ts` 新增 `catalog.getHotModules()` | typecheck 0 |
| 存量库实测 | `GET /modules/hot` → `range=today window=24 total=213 items=5 top1=cat.dev-26 hotness=10900`（= stars 9900 + 窗口内加权 1000）；`?range=week&category=store&limit=20` → `window=168 total=9 items=9`，slug 全部 `store-*` | 本地 8788 实例 + `services/mim-api/data/mim.db` |
| 本地门禁 | `pnpm -r typecheck` 0（5/5）；`pnpm --filter @mim/api test` **16 文件 224 例**（221 + 3）；`@mim/web` 构建 0（51 modules，`index-DQ1X-P9I.js` 407.50 kB / `index-CW0Cu4wp.css` 19.74 kB）；`verify-deployments` **52/52**；`verify-entry-manifest` / `verify-site-modules` / `env-check` / `version-check` / `comment-check --strict` 全 0 | 本轮真实命令输出 |
| 生产 | `mim.mixm.top` 仍 **未部署**（主机不可达 + 仓库零 secret 未变，远程步骤 skipped）；但本轮已 commit + push 并取得真实 CI：提交 `d65615e`（12 files / +1680 / −326），`origin/main` `f5468e8..d65615e` | `git push`、`gh run view` |

- **提交与 CI（本轮真实取证）**：`git push origin main` → `f5468e8..d65615e main -> main`；CI run **42791339647**（Deploy @ `d65615e`）**completed success**，五作业全绿（质量门禁 / 发布到生产服务器 / GitHub Pages / GitHub Packages / 托管平台同步）；`42791339560`（Azure SWA @ `d65615e`）同样 success。「发布到生产服务器」内 7 个远程步骤 skipped、`未配置凭据 SKIP 提示` 成功——**绿 ≠ 已上线**。文档补充提交 `0755818` 后的 run **42792142242**（Deploy）/ **42792142334**（Azure SWA）亦全绿。
- **页面 E2E（本地 5173 + 8787，真实浏览器）**：`/store` 渲染出「分类导航 19 / 全部推荐项目 213」与 19 个一级分类（计数 5/37/37/17/15/2/4/5/9/7/17/3/10/8/13/3/3/8/10）；点击「建站系统」展开 9 个二级条目且各自计数 1，右侧收敛为 9 张卡片（`cat.store-01..09` 均为 PHP / GPL-3.0 / ★ + 免费 + 「登录后解锁」），分页条为「第 1 / 1 页 · 共 9 个模块」；「热门项目」卡片今日/本周可切换并列出 5 条；排序切 `Stars` 后 card 序列 9900 → 8700 → 8600 → 7400 降序；`details.filter-pop` 内实测 **开源许可 48 个复选框 / 编程语言 87 个复选框**；「搜索帮助」浮窗展开后 12 条外链全部可见。截图：`.screenshots/store-taxonomy-help.png`、`.screenshots/store-filters-stars.png`。唯一控制台 error 为 `/favicon.ico` 404（`apps/web/public` 无 favicon，属既有观感项，非本轮引入）。
- **托管站点取证**：`https://afdk1991.github.io/mim/` 200 / 4.73s / 5182B，产物 `assets/index-YtVSj9dJ.js` + `assets/index-CW0Cu4wp.css`（CSS 指纹与本机构建逐字一致）；下载该 CSS 后 `grep store-hot|store-help|hot-item` 命中共 1 次 → 证明含「热门项目 / 搜索帮助」样式的本轮构建**真实上线到 GitHub Pages**。`mim.mixm.top/health` → `000` / 2.11s / LEN=0（本地代理 `CONNECT tunnel failed`），`mim-8ah.pages.dev` → `530`，均未取得内容层取证，**不宣称生产已上线**。

- **排障留痕**：`clockOf(deps)` 返回 **ISO 字符串**而非 `Date`，`now.getTime()` 会报 `TS2339`；窗口回溯须写 `new Date(new Date(now).getTime() - hours*3600*1000).toISOString()`。
- **仍未做**：一级分类管理端 CRUD；`en-US` 二级条目名翻译；205 个二级模块的差异化定价语义（当前全部免费、无前置）。（注：其中 `en-US` 翻译已在 §9.6 完成，此行保留为 §9.5 当时口径。）

### 9.6 分类与模块的英文名落地（2026-11-10，第三轮）

**性质**：清掉 §9.4 / §9.5 反复标注的「`en-US` 名称沿用中文」占位口径——把 19 个一级分类名 + 205 个二级条目名全部译成英文，并让英文站点真正用上。

| 项 | 本轮实测 | 取证方式 |
|---|---|---|
| 英文数据源 | `packages/core-domain/src/catalogTaxonomy.ts` 新增 `CATALOG_GROUP_EN`（19 组、205 条，与中文清单**逐项同序**）+ `catalogGroupNameEn()` / `catalogItemNameEn()` 两个取数函数（缺失回落中文，不产生空名） | 文件内容 |
| 模块名 | `buildCatalogModuleSeeds()` 产出 `name_en`；`seedCategoryModules` 的 `name_i18n` 由 `{zh-CN: 中文, en-US: 中文}` 改为 `{zh-CN: 中文, en-US: 英文}`，英文简介同步改用英文条目名 | `grep` 种子段 + 契约测试 |
| 分类表 | `module_categories` 新增 `name_en TEXT`（`schema.sql` 与 `ADDITIVE_COLUMNS` 双路径同改，老库启动即补列），`seedCatalogCategories` 写入英文名 | `db.ts` 迁移清单 + 启动日志 `additive column created` |
| 接口 | `GET /taxonomy` 的分组与条目各带 `name_en`（未登记时为 `null`，不伪造空串） | 契约测试新增 2 例 |
| 前端 | `Store.tsx` 新增 `categoryName(locale, name, name_en)`：`en-US` 优先 `name_en`，缺失回落中文；一级导航、二级条目、「一级 / 二级」面包屑、详情归属行四处统一走该函数 | `pnpm --filter @mim/web build` 0 |
| 本地门禁 | `pnpm -r typecheck` 0（5/5）；`pnpm --filter @mim/api test` **16 文件 226 例**（224 + 英文名 2 例全绿）；`@mim/web` 构建 0；`comment-check --strict` 0 | 本轮真实命令输出 |

- **翻译口径（供后续核对）**：一级分类 `Site builders` / `Software development` / `Games & entertainment` / `Plugins & extensions` / `Other open source` 等；OpenHarmony 组中文括号里的英文直接提为英文名（`按钮(Button)` → `Button`、`手势控制(Gesture)` → `Gesture control`），避免 `Button(Button)` 这类重复；分隔符统一用 `·` / `/`，不用中文顿号。
- **顺序守卫**：英文清单靠**组内下标**与中文对齐，测试同时断言首条与末条（`Button` / `Gesture control`），任一侧插条导致错位会立刻红。
- **仍未做**：205 个二级模块的差异化定价语义（用户未给价格口径）；一级分类管理端 CRUD（已于 §9.7 补齐）。

### 9.7 分类导航管理端 CRUD（2026-11-10，本地门禁与浏览器 E2E 双绿）

**性质**：把 §9.6 末尾标记「仍未做」的一级分类管理端 CRUD 补上——两级分类树（19 一级 + 205 二级）在 `apps/admin` 里可读、可增、可改、可删，写操作全部走 RBAC，不引入新表。

| 项 | 本轮实测 | 取证方式 |
|---|---|---|
| 读树接口 | `GET /categories/manage`（`module:read`，区域走 `x-region`）：返回 `groups[].items[]` 两级结构，一级 `module_count` 为组内二级计数之和，计数口径与公开 `/taxonomy` 一致（只算 `status='active'` 且未软删），另回 `total_groups` / `total_items` | 契约测试 + 本地 curl 200 |
| 新建接口 | `POST /categories`（`module:write`）：zod 校验 slug `^[a-z][a-z0-9-]{0,40}$`；slug 重复 → 409 `CONFLICT`；`parent_slug` 不存在或非一级 → 404；二级 slug 必须以「父 slug-」开头否则 400（公开树与前缀过滤都依赖这条约定）；一级 slug 含连字符 → 400；`sort_order` 缺省取同级 `MAX+1` | 契约测试 |
| 编辑接口 | `PATCH /categories/:slug`：仅 `name` / `name_en`（可传 `null` 清空）/ `sort_order`，三者全缺 → 400；不存在 → 404；改的是同一张表，公开 `/taxonomy` 立即读到新名（测试用「改名后回读公开树」守这条） | 契约测试 |
| 删除接口 | `DELETE /categories/:slug`：不存在 404；一级仍有子级 409；仍有模块引用 409（二级按 `category_slug` 精确、一级按 `LIKE '<slug>-%'` 前缀，`escapeLike` 防通配注入）；成功为**物理删除**并回执 `{slug, level, deleted}` | 契约测试 |
| 管理端页面 | `apps/admin/src/views/Categories.tsx`：19 组 + 205 条参数化渲染（`renderRow(row, level)`），行内可改中文名 / 英文名 / 排序，**只下发真正变化的字段**（`save()` 做差异比对），新建面板带父分类下拉，删除时把后端 409 文案直接透出；无 `module:write` 时全部写按钮禁用 | `pnpm -r typecheck` 0、`@mim/admin build` 0 |
| 前端入口 | `App.tsx` 的 `ViewKey` 加 `'categories'`、侧栏 `NAV` 加「分类导航」（`module:read`）、`renderView` 加分支；`api.ts` 追加 9 个分类 CRUD 导出；`styles.css` 追加 `.cat-group` / `.cat-row-g1` / `.cat-row-g2` / `.cat-slug`（二级缩进 24px 形成树形观感） | 文件内容 |
| 本地门禁 | `pnpm -r typecheck` 0（5/5）；`pnpm --filter @mim/api test` **16 文件 230 例**（226 + 分类 CRUD 4 例）；`@mim/admin` 构建 0；`comment-check --strict` 0；`verify-deployments` 52/52；`verify-entry-manifest` 23/23；`verify-site-modules` 79/79 | 本轮真实命令输出 |
| 浏览器 E2E | 本地 API 8787（`MIM_ADMIN_TOKEN` 已设）+ admin dev 5174：令牌登录成功（`/admin/me` 200，权限含 `module:write`）→ 点「分类导航」→ **一级 19 / 二级 205** 渲染，英文名列回显 `Frontier technology` / `Low-code` / `Research papers` / `Quantum computing` / `Button` 等真实译名 → 新建 `e2echeck` 后变 **20 组**并提示「已创建」→ 行内改名保存提示「已保存」→ 删 `frontier` 被拒并显示 `CONFLICT: category still has child items`（409 保护在 UI 可见）→ 删 `e2echeck` 成功回到 **19 / 205** | 浏览器 `bu` 会话 + 截图 `.screenshots/admin-categories.png`（1280×960） |

- **排障留痕（本地 E2E 首次失败的真因）**：首次令牌登录报 `AUTH_UNAUTHORIZED: missing bearer token`，且 `GET /categories/manage` 返回 404。**真因不是权限也不是新路由**——8787 端口上跑着上一轮遗留的旧 API 进程，新进程 `EADDRINUSE` 起不来（`.tmp/api-admin.err.log` 有 `EADDRINUSE ... port 8787`），浏览器打到的是旧代码。处置：按端口取 `OwningProcess` 杀掉旧进程后重启，`/health` 200、`/admin/me` 200、`/categories/manage` 200 立刻全绿。**规则**：本地起 API 前先查端口占用，看到 `EADDRINUSE` 必须杀旧进程重起，不得当成「路由没注册」去改代码。
- **控制台噪声说明**：E2E 页面 console 里有 `ws://localhost:5173` 连接失败，是上一轮商城 dev server 已停导致的遗留 vite 客户端重连，与本轮管理端无关，零功能报错。
- **仍未做**：分类树在管理端**没有做拖拽排序**（排序靠改 `sort_order` 数字）；205 个二级模块差异化定价语义、排序三档独立时间列仍为开放项。

### 9.8 删除产品里的旧定位副标题与旧 FR-03 旗舰形态残留（2026-11-10）

**性质**：按用户指令删除产品里残留的旧定位文案与旧 FR-03 旗舰形态的功能条目。该定位文案属于 2026-11-04 前旗舰形态的遗留表述，PRD 与 Wiki 早已登记为历史范围，但前端仍在侧栏品牌区、登录卡片与标签页标题继续展示、文档中仍按旧口径列功能条目，与当前定位（功能模块商城 + 漫剧 AI 剧）不符。

| 项 | 本轮改动 | 取证方式 |
|---|---|---|
| 词条 | `packages/i18n/src/index.ts` 删除 `app.tagline`（中英各一条，连带注释），字典键集合仍中英对齐 | 文件内容 + `pnpm -r typecheck` 0 |
| 侧栏 | `apps/web/src/App.tsx` 品牌区只留 `app.name`，移除 `brand-tagline` 一行 | `apps/web` 构建 0 |
| 登录页 | `apps/web/src/views/Login.tsx` 登录卡片只留 `<h1>` 应用名，移除副标题段 | 同上 |
| 标签页 | `apps/web/index.html` `<title>` 由「`Mim` + 旧副标题」改为 `Mim` | `apps/web/dist/index.html` 实测 `<title>Mim</title>` |
| 样式 | `apps/web/src/styles.css` 删除已无引用的 `.brand-tagline` 规则，并把 `.brand` / `--sidebar-muted` / `.user-region` 处仍提旧文案的注释改写为现状描述（铁律十一要求注释与实际一致） | 产物 `assets/*.js`、`assets/*.css` grep 旧文案与 `brand-tagline` **均 0 命中** |
| 文档功能条目（§9.9） | `Mim-PRD.html` / `site/index.html` / `site/prd.html` / `docs/wiki/01-architecture.md` 里的旧 FR-03 功能规格与旧定位表述全部删除或改写成现行范围 | 见 §9.9 的 grep 复核（tracked 文件 0 命中） |

- **证据口径调整**：`README.md` / `docs/wiki/05-runbook.md` / 本文件铁律九表格里的 EdgeOne 有头取证原文是「`title=Mim` + 旧副标题」，按用户「整个项目删除」的指令，副标题原句已不再保留，改为「`title=Mim`（旧定位副标题已于 2026-11-10 删除）」——保留取证的可核对性（标题主体、`isWafChallenge=false`、产物指纹、时间戳均未动），只剥离已删除的文案。

### 9.9 全项目清除旧 FR-03 旗舰形态与旧定位文案的残留（2026-11-10）

**性质**：用户把范围从「删掉那句标语」升级为「删除整个项目里关于它的模块和功能」。本轮把仓库内**所有仍以现行口径描述该旧旗舰形态的位置**（PRD 两份、PRD 阅读页两份、Wiki 架构页、README/AGENTS 的取证串）一并清理，避免「代码已删、文档仍在教旧功能」的错位。**不删除**与它无关的通用技术词「跨端」（多端账号打通、跨端前端、跨端适配层等仍是现行需求），也**不动**用户自己的两个未跟踪文件。

| 文件 | 处理 | 复核 |
|---|---|---|
| `Mim-PRD.html` | ①文档定位段删掉「替代原…方案」的旧形态指代；②§5 FR-03 历史记录里的四条旧功能规格（任务管理 / 多端同步 / 基础协作 / 个人仪表盘）改写为「已删除、不再保留实现口径」 | `grep 旧形态关键词` 0 命中 |
| `site/prd.html` | ①文档定位段同步；②§FR-03 整节由「旧四条功能 + 订阅 features 映射表 + 旧工作区框架 + 旧权限校验」替换为**现行范围**（商城 + 漫剧），表与旧清单全部移除 | 同上 |
| `site/index.html` | FR-03 卡片正文由旧形态描述改为现行两域范围 | 同上 |
| `docs/wiki/01-architecture.md` | 旗舰形态行与 P0 必交付段的旧形态指代改为「早期旗舰形态（已随 FR-03 重写并于 2026-11-10 删除功能条目）」 | 同上 |
| `README.md`（3 处）、`docs/wiki/05-runbook.md`（2 处）、`AGENTS.md`（1 处） | EdgeOne 有头取证里的线上标题串剥离旧副标题原句，改记为 `title=Mim`，其余取证要素一字未动 | 同上 |
| `apps/web/src/styles.css` | 基准字号注释里的「任务管理场景」改为「模块列表与工作台场景」（铁律十一：注释须与现状一致） | `@mim/web` 构建 0 |

- **复核方式**：`git grep -I` 对旧定位文案与旧旗舰形态名（脚本里以关键词常量给出，避免本文件再复述原句）在 **tracked 文件**上 0 命中；`apps/web/dist` 全目录 grep 同组关键词 0 命中。
- **明确不动的部分**：①通用技术词「跨端」（`docs/四份技术资料完整内容整理-20261109.md` 的跨端策略 / 跨端前端人力、PRD 里的跨端账号打通、跨端继续使用等）——这是多端技术表述，不是该旧模块；②用户未跟踪文件 `新建 文本文档.txt` 与 `docs/gitee-开源项目适配清单-2026-11-10.md`（后者是外部抓取资料，含与旧形态同名的对标小节，但属用户材料，未获指令不动）。
- **未做**：旧功能的代码与库表已不在工作树中，本轮无代码可删；`site/` 只有静态页，构建脚本 `scripts/build-site.mjs` 未改动。

### 9.10 Cloudflare Pages 复核与重建（2026-11-10 21:47 +08:00）

**性质**：按用户给出的 Cloudflare 控制台地址做真实核查，发现此前矩阵里「Cloudflare Pages ✅ CI 自动发布」已不成立；本轮把项目重建并把取证写回注册表与文档。

| 项 | 本轮实测 | 判读 |
|---|---|---|
| 账号 | `15726833367@139.com`，Account ID `a799197458978d508f927083360c635b` | 登录态有效 |
| Workers / Pages 项目 | 「Workers 和 Pages」列表 **No projects found** | 项目不存在 |
| 站点可达性 | `curl https://mim-8ah.pages.dev/` → **530**，`curl` 报 DNS 不可解析 | 入口已失效 |
| `mixm.top` zone | 该账号内 zone 存在但 **DNS 记录数 0**（「没有 DNS 记录」）；`mim.mixm.top` 由外部解析至 `115.159.159.11` | Cloudflare 侧不承载该域解析 |
| CI 真实行为 | `deploy.yml` Cloudflare 步骤因无 `CLOUDFLARE_API_TOKEN` 输出 `SKIP: 缺少 …; exit 0` | 历史「自动发布」为假绿 |
| 重建动作 | 控制台「直接上传」新建 Pages 项目 `mim-8ah`，直传根构建 `dist` 6 个文件后「部署站点」，控制台提示「成功！您的项目已部署到以下区域：全球」 | ✅ 项目已重建 |
| 重建后取证 | `/` **200 / 1.455s / 5114B**（`title=Mim`、`assets/index-DkyuUDY7.js` + `index-DY6XAYXj.css`）；`/store` **200 / 1.040s / 5114B**；`assets/index-DkyuUDY7.js` **200** | ✅ 静态站可用 |
| 未覆盖项 | 本次为纯静态直传，未上传 `functions/api/[[path]].js`，故**无 `/api` 反代**；仓库 secrets 仍缺 `CLOUDFLARE_API_TOKEN`，push 后不会自动重发 | 如实记录，不宣称「CI 自动发布已恢复」 |

- **同步工件**：`packages/core-domain/src/deploymentRegistry.json`（`pages.cloudflare` 的 `result` 证据与 `captured_at` 刷新，新增 `CF_PROJECT_ABSENT_RECREATED` / `CF_CI_TOKEN_MISSING` 两条异常）、`docs/deployment-summary.json` 与 `.md`（由 `node scripts/deployment-summary.mjs` 重生成）、`README.md` 与 `docs/wiki/05-runbook.md` 的取证段。
- **门禁**：`node scripts/verify-deployments.mjs` **52/52 PASS**。
- **后续待办**：补 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` 两个 secret 后 CI 才能真发；若需同源 `/api`，须把 `functions/` 一并上传或在 Pages 项目里启用 Git 集成。



### 9.11 Gitee 镜像仓补齐（2026-11-10 21:50 +08:00）

**性质**：按用户提供的 Gitee 私人令牌补齐国内镜像仓，首次实现铁律十二 §12.2「双远端同轮全推」。本轮只动**远程托管与文档取证**，不改业务代码、不触发任何平台部署。

| 项 | 本轮实测 | 取证方式 |
|---|---|---|
| 令牌有效性 | `GET /api/v5/user` → `login=mallwm_admin`、`name=mallwm`；`/api/v5/user/namespaces` → `mallwm_admin` | Gitee API v5 |
| 建仓前状态 | `git ls-remote`（带 token）→ `remote: 404 not found!` / `fatal: repository 'https://gitee.com/mallwm_admin/mim.git/' not found`；`GET /api/v5/repos/mallwm_admin/mim` → 404；账号仓库列表返回 **0 个** | 建仓前确证「仓库不存在」，非权限不足 |
| 建仓 | `POST /api/v5/user/repos`（`name=mim`、`path=mim`、`auto_init=false`）→ 创建 `mallwm_admin/mim`；再 `PATCH`（`private=false`）→ 公开、默认分支 `main`，与 GitHub 主仓（`private=False`）可见性口径一致 | API 返回 `private=False`、`default_branch=main`、`html_url=https://gitee.com/mallwm_admin/mim` |
| 首次推送 | `git push <token-url> main` → `* [new branch] main -> main`（exit 0）；随后 `git push --all` / `git push --tags` 均 `Everything up-to-date`（本地仅 `main` 分支、0 个 tag） | git 真实输出 |
| 同步验收 | `gitee` / `origin` 的 `refs/heads/main` 均 = 本地 HEAD = `44b2fee`（三端一致，0 ahead / 0 behind） | `git ls-remote origin`、`git ls-remote gitee`、`git rev-parse HEAD` |
| 凭证落点 | 令牌写入 **Windows 凭据管理器**（`git-credential-manager`），**未**写入 `.git/config` 明文；实测 `git push gitee main`（不带 token）→ `Everything up-to-date`、exit 0 | `git credential approve`、`git push gitee main` |
| 未覆盖项 | ① 工作树存在未跟踪草稿（`gw.txt`、`新建 文本文档.txt`），未提交故未进入任何远端；② `packages/core-domain/src/deploymentRegistry.json` 的 `repo.gitee` 仍是 **2026-11-09 23:03 采集快照**（`UNVERIFIED` / `NOT_TESTED` / `REMOTE_TIMEOUT`），本轮**未重跑采集器**；刷新须同步改 `services/mim-api/test/deployments.test.ts` 的 `repo.gitee` 断言与 `scripts/verify-deployments.mjs` D23 的关键异常码白名单，否则门禁必红 | 如实标注，**不冒充注册表已刷新** |
| 铁律八边界 | 本轮为**仓库同步轮**，无功能产物、无部署，故不涉 V2–V4 线上取证；V1（双远端同步）本轮**首次通过** | 铁律八豁免场景：无产物可部署 |

- **后续待办**：① 若要让 `/deployments` 仪表盘反映真实状态，需重跑 `node scripts/deployment-summary.mjs` 并同轮修正 `repo.gitee` 的契约断言与 D23 异常码白名单；② Gitee 侧如需 CI 镜像（Gitee Go / Webhook），须另配账号，本轮未做；③ 令牌若需轮换，重置后重新 `git credential approve` 即可，无需改仓库配置。

### 9.12 部署矩阵新增 Gitee（码云）（2026-11-10 22:20 +08:00）

**性质**：按用户指令「多平台部署矩阵添加 Gitee（码云）(gitee.com) 平台」，把已在铁律十二 §12.2 登记、但长期作为「矩阵外补充项」的 Gitee 镜像仓**提升为铁律九矩阵第 10 行**；同步刷新注册表、生成器、校验器、契约测试与全部文档口径。本轮不改业务代码、不触发任何平台部署。

| 项 | 本轮实测 | 取证方式 |
|---|---|---|
| Gitee 网页可达 | `https://gitee.com/mallwm_admin/mim` → **200 / 0.469s / 52034B**，标题「mim: Mim - 跨平台商业级项目(GitHub 镜像)」、默认分支 `main`、129 次提交、最新提交与本地 HEAD 同一条 | `curl -w '%{http_code}|%{time_total}|%{size_download}'`、`web.fetch` 页面标题与分支 |
| Gitee git 通道 | `git ls-remote gitee refs/heads/main` = `4398cf032e65bd7c17437fe79c2a5524d722798e`（**exit 0 / 0.27s**），与本地 HEAD `4398cf0` 一致（0 ahead / 0 behind） | `git ls-remote gitee` |
| 矩阵口径 | 铁律九 9 → **10 个免费平台**；`deploymentRegistry.json` 的 `platform_catalog.gitee.in_matrix` 由 `false` 改为 `true`、`coverage.matrix_platforms` 9 → 10 | `packages/core-domain/src/deploymentRegistry.json` |
| 注册表取证 | `repo.gitee` 由 `UNVERIFIED / NOT_TESTED` 改为 **`OK / PASS`**（`http_code=200`、`latency_ms=469`、`bytes=52034`），保留 `REMOTE_TIMEOUT_RECOVERED` 历史留痕，新增 `MATRIX_ROW_ADDED` / `NO_CI_MIRROR_JOB` 两条 info 异常 | 同上，`captured_at = 2026-11-10 22:20 +08:00` |
| 门禁同步 | `scripts/verify-deployments.mjs` D03 / D20 断言由 9 改为 **10**；`services/mim-api/test/deployments.test.ts` 两处 `9` 改为 **10**；`scripts/deployment-summary.mjs` 说明文案同步 | 本轮命令输出，见交付报告 |
| 文档同步（铁律七） | `AGENTS.md`（§0 / 铁律九表格 / §9.12 / §13.4）、`README.md`（铁律清单 / 多平台部署矩阵 / 覆盖口径）、`docs/wiki/05-runbook.md`（§7.1.3 平台数与 DNSPod 表）、`06-governance.md`、`02-modules.md`、`Mim-PRD.html` | 逐文件改动 |
| 交付链路 | Gitee 为**源码镜像仓**（layer `source`），交付方式 `push`：每轮手工 `git push gitee main` + `git ls-remote` 取证；**`deploy.yml` 无 Gitee 推送作业**，`push origin` 不会自动同步镜像 | `.github/workflows/deploy.yml` 全文 0 命中 `gitee` |
| 铁律八边界 | 本轮为**平台登记与文档同步轮**，无功能产物、无部署，故不涉 V2–V4 线上取证；V1 双远端同步本轮实测通过 | 铁律八豁免场景：无产物可部署 |
| 提交与双推 | 提交 `3f55bee`（`docs(deploy): 铁律九部署矩阵新增 Gitee(码云) 为第 10 平台并同步注册表与门禁`，15 files / +166 / −132）；`git push origin main` → `4398cf0..3f55bee` exit 0；`git push gitee main` → `4398cf0..3f55bee` exit 0；两端 `git ls-remote` 均 = `3f55bee` | `git push` 输出、`git ls-remote origin|gitee` |
| CI 取证 | run **42831377382**（Deploy @ `3f55bee`）**五作业全绿**：质量门禁 / 发布到生产服务器 / GitHub Pages / 托管平台同步 / GitHub Packages；run 42831377456（Azure SWA）success。生产作业 5s 且带 `::warning::`「未配置 DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY，生产发布已 SKIP；这不等于『已上线』」 | `gh run view 42831377382` |
| 并行改动同步 | 推送后发现工作树出现本次任务之外的 Cloudflare CI 修复（项目名 `mim-8ah`、去 `continue-on-error`），已由并行侧提交为 `b739483` 并推 `origin`；本会话按铁律十二把 `gitee` 同步至 `b739483`（`3f55bee..b739483` exit 0），两端一致 | `git log`、`git push gitee main`、`git ls-remote` |

- **如实记录的限制**：① Gitee 的 200 仅为**仓库页可达性**取证，不代表任何生产服务可用，也不得替代 `mim.mixm.top`（铁律十二 §12.3）；② 未配置 Gitee Go / Webhook 自动镜像，镜像同步仍依赖每轮手工推送；③ 本轮未做生产部署与线上 E2E（CI 生产作业如实 SKIP）。

### 9.13 Cloudflare 三项落地：/api 反代、CI 自动发布、生产核查（2026-11-10 22:18 +08:00）

**性质**：按用户在交互确认里的「三项全做」推进 —— ① Pages 补回 `/api` 反代、② 恢复 push 后 CI 自动发 Pages、③ 生产 `mim.mixm.top` 上线核查。① 与 ② 本轮闭环并取得线上取证；③ 取得**主机侧不可达的完整证据链**后如实停下，不冒充上线。

| 项 | 本轮实测 | 判读 |
|---|---|---|
| ① 令牌 | 新建用户 API 令牌 `mim-ci-gh-actions`，权限「所有帐户 · Cloudflare Pages: 编辑」、无过期；`GET /client/v4/user/tokens/verify` → `{"status":"active","success":true}`，token id `2ddbedd09fc31376000a981237b0265d`；账号内原有一个同名体系旧令牌 `mim-ci`（`cfut…f84b`，含 Workers 脚本权限，创建 4 天前）无法取回明文 | ✅ 新令牌 active |
| ① 带 Functions 部署 | `npx --yes wrangler@3 pages deploy apps/web/dist --project-name mim-8ah --branch main --commit-dirty=true` → 「Compiled Worker successfully」「Success! Uploaded 4 files (1 already uploaded) (8.27 sec)」「Uploading _redirects」「**Uploading Functions bundle**」「Deployment complete!」→ 预览域 `https://1f236943.mim-8ah.pages.dev` | ✅ `functions/api/[[path]].js` + `functions/[[catchall]].js` 已随站点上线 |
| ① 反代实测 | `https://mim-8ah.pages.dev/api/v1/modules` → **521 / 1.183s / 7005B**（`/api/health` 同为 521） | Functions 在跑、上游不可达（见 ③） |
| ② secret 补齐 | `gh secret set CLOUDFLARE_API_TOKEN`（新令牌）+ `gh secret set CLOUDFLARE_ACCOUNT_ID` → `repos/…/actions/secrets` 由 `total_count: 0` 变 **2** | ✅ 凭据就位 |
| ② 首次真实调用暴露两处缺陷 | run **42830819050**（`workflow_dispatch`）结论 success，但日志里 Cloudflare 步骤实际报 `[ERROR] Invalid account ID "***" set in the CLOUDFLARE_ACCOUNT_ID environment variable`、`Process completed with exit code 1` —— `gh secret set` 从管道读入时把 `acct=` 前缀一并写入；同一行命令仍是 `--project-name=mim`（账号内实际项目名 `mim-8ah`），且步骤带 `continue-on-error: true` | ⚠️ 修 secret 前仍是**假绿**（作业 success ≠ 部署成功） |
| ② 修复 | ① `gh secret set CLOUDFLARE_ACCOUNT_ID --body …`（裸值）；② `deploy.yml` 的 `--project-name` 改 `mim-8ah`、去掉 `continue-on-error`；③ `wrangler.toml` 的 `name` 改 `mim-8ah`。提交 `b739483`（2 files / +8 / −3）并 `git push origin main` | ✅ |
| ② 修复后真发 | run **42831492102**（Deploy @ `b739483`）五作业：质量门禁 ✓ 57s / GitHub Packages ✓ 49s / 发布到生产服务器 ✓ 5s / GitHub Pages ✓ / 托管平台同步 ✓ 47s；Cloudflare 步骤日志：`⛅️ wrangler 4.160.0`、`Success! Uploaded 3 files (2 already uploaded) (4.57 sec)`、`Uploading _redirects`、`Uploading Functions bundle`、`**Deployment complete!** … https://1c93fea4.mim-8ah.pages.dev`，随后平台自检 `https://mim-8ah.pages.dev/ => 200` | ✅ **push 后 CI 真的发 Pages**（不再是 SKIP） |
| ② 生产域复测 | `https://mim-8ah.pages.dev/` **200 / 1.585s / 5114B**；`/store` **200 / 1.150s / 5114B**；预览域 `https://1c93fea4.mim-8ah.pages.dev/` 200 / 1.541s / 5114B | ✅ 静态站可用 |
| ③ 主机端口（Windows 侧 `--noproxy`） | `Test-NetConnection 115.159.159.11` → 80 **False** / 443 **False** / 22 **True**；`curl http(s)://mim.mixm.top/health` → **000 / 2.10s / 2.13s** | 主机在线但 Web 服务未运行 |
| ③ SSH 凭据 | 云主机侧（`vm`，`hostname=vefaas-…` 沙箱，非生产机）无 `~/.ssh`；`ssh -o BatchMode=yes root@115.159.159.11` → `Permission denied (publickey,password)` | 无可用私钥，进不去主机 |
| ③ 控制台 | `https://console.cloud.tencent.com/cvm/index` 跳转 `cloud.tencent.com/login`（无登录态），无法查实例状态 / 安全组 | 需用户登录才能从云侧定位 |
| ③ 结论 | 生产站**未上线**：`/health` 000、80/443 拒连；`/api` 反代因此无后端可打（521） | **不宣称上线**（铁律八） |

- **同步工件**：`packages/core-domain/src/deploymentRegistry.json`（`pages.cloudflare` 的 `result` 刷新为 22:18 取证、`latency_ms` 1455 → **1585**、异常新增 `CF_CI_AUTODEPLOY_RESTORED`（info，闭环原 `CF_CI_TOKEN_MISSING`）/ `CF_CI_PROJECT_NAME_MISMATCH`（warning）/ `CF_API_UPSTREAM_DOWN`（warning））、`docs/deployment-summary.json` 与 `.md`（重生成）、`README.md` 与 `docs/wiki/05-runbook.md` 取证段、本段。
- **门禁**：`node scripts/verify-deployments.mjs` **52/52 PASS**、`verify-entry-manifest` PASS、`deploy.yml` 经 `yaml.safe_load` 解析通过。
- **未覆盖项**：① Pages 侧未绑自定义域（`mixm.top` zone 内 0 条 DNS）；② 旧令牌 `mim-ci` 未吊销；③ 生产主机 Web 服务未起（nginx / systemd `mim-api`）的根因需服务器权限或腾讯云控制台登录后定位；④ 未做生产登录态 E2E（后端不可达）。

## 铁律十：免费平台额度矩阵与选型路由

**免费是唯一准入标准，不看品牌标签。** 本铁律收录远程仓库与部署平台的免费额度，作为「候选池 + 选型依据」；铁律九的 10 平台表是「已落地矩阵」，二者关系为：铁律九 = 当前实际部署，铁律十 = 可纳入候选与选型依据。任一层级都不得引入付费方案。

### 10.1 远程仓库平台（2026-11-09 清理后为 3 个）

| 平台 | 免费版核心额度 | 特点 |
|---|---|---|
| GitHub | 无限公开/私有仓库、无限协作者；2,000 CI/CD 分钟/月；500MB Packages 存储 | 生态最大，Actions + Pages 一条龙；本项目 `origin` 主仓 |
| Bitbucket | 最多 5 人永久免费；仓库软限 2GB / 硬限 4GB；LFS 1GB；约 50 构建分钟/月 | 与 Jira 深度集成，小团队够用 |
| Gitee（码云） | 1000 个仓库、5GB 总容量，含 Gitee Pages 静态托管 ⚠️单源待校验 | 国内访问快，需实名；本项目 `gitee` 镜像仓 |

> **删除留痕（2026-11-09 18:08，用户指令）**：原表第 2 行与选型建议中的原候选托管平台条目已**全量删除**；清理前该平台关键词全仓文本命中 5 处（本文件 2 处、README 1 处、Wiki 2 处），清理后命中 0；无对应 CI 配置文件、CI 变量、镜像仓库或 git 远端。按用户指令，**被移除的候选平台不得重新进入候选池**，新增远程仓库一律走铁律十二 §12.2 的授权流程；被删条目原文可从 git 历史追溯。

**选型建议**：个人/开源默认 GitHub（本项目主仓）；5 人内小团队且用 Jira 选 Bitbucket；主要面向国内访问选 Gitee（本项目镜像仓）。实际启用的两个远端与同步要求见 [铁律十二 §12.2](#122-远程仓库清单与全量同步)。

### 10.2 免费网站部署 — 纯静态站（博客 / 文档 / 落地页 / 作品集）

| 平台 | 免费额度 | 备注 |
|---|---|---|
| GitHub Pages | 100GB/月带宽（软限）、每小时 10 次构建 | 与仓库直连，push 即部署，最省事 |
| Cloudflare Pages | 免费版单站最多 20,000 个文件 | 全球 CDN，边缘性能最好 |
| Vercel | 100GB 流量/月、100 万次函数调用/月、4 小时 Active CPU/月、100 次部署/天 | 仅限非商业用途，Next.js 首选 |
| Netlify | 300 构建分钟/月（2026-10 起新账号改为 credit 制）⚠️额度口径变动中 | 表单 / A-B 测试等附加功能多 |
| Azure Static Web Apps | 100GB 带宽/月、10 个应用；超额带宽不可用（免费层） | 微软生态 |

### 10.3 需要后端 / 动态服务（API、数据库、Node/Python 服务）

| 平台 | 免费额度 | 备注 |
|---|---|---|
| Render | 每工作区 750 免费实例小时/月 | 空闲会休眠，冷启动慢；够跑一个常驻小服务 |
| Cloudflare Workers | 10 万请求/天、单请求约 10ms CPU | 边缘函数，适合轻量 API / 代理 / 重定向 |

**组合推荐**：GitHub（仓库）+ Cloudflare Pages 或 GitHub Pages（静态）→ 零成本；需要接口再加 Cloudflare Workers 或 Render。

### 10.4 裁决与复核

- **Render 定性修正（2026-11-06）**：Render 存在长期免费层（750 实例小时/月），即日起从铁律九「付费方案排除」改为**免费候选平台**；仅在免费额度内的休眠型实例算合规，超出免费额度即违规。`veFaaS` 无长期免费层，继续排除。
- **新平台准入四要件**（缺一不得纳入）：① 存在长期（非限时试用）免费层；② 额度足以承载本项目当前形态；③ 明确是否需实名 / 绑卡；④ 记录额度复核日期与来源。
- **额度复核**：本表额度随平台政策变动（如 Netlify 2026-10 credit 制、Gitee 单源待校验），每季度至少复核一次并注明日期；任何降额须在当轮交付报告标注影响面。
- **取证与同步**：新平台上线后按铁律九执行逐平台 `curl` 取证，并同步 README「多平台部署矩阵」、`docs/wiki/05-runbook.md` 与 CI 工作流（铁律七）。

## 铁律十一：全仓库逐行注释与解释

**每一行自有代码都必须有可读的解释，注释是交付物的一部分，不是可选项。**

- **适用范围**：仓库内所有自有源码与脚本 —— `apps/web/src/**`、`apps/admin/src/**`、`services/mim-api/src/**` 与 `services/mim-api/test/**`、`packages/*/src/**`、`scripts/**`、`*.css`、`*.html`（含 `Mim-PRD.html` 与 `site/*.html`）。校验实现 `scripts/comment-check.mjs` 的 `TARGET_DIRS` 覆盖 `apps`（含两个前端）、`services`、`packages`、`scripts`、`site` 五项，与 2026-11-10 恢复后的真实目录一致（`site/` 已重新存在，含 `index.html` 与 `prd.html`，仅离线阅读、不参与生产）；现状见 §0。
- **注释粒度**：每行代码必须有对应解释（行内尾注或紧邻上一行）；注释用**中文**，说明「做什么 + 为什么」，禁止无信息量复述（如 `i++ // i 加一`）。
- **豁免项**（不要求逐行注释）：锁文件（`pnpm-lock.yaml` 等）、`node_modules`、自动生成产物（`dist/`、`*.min.*`）、二进制与数据文件、纯文档 `*.md`、`.env.example`。
- **校验工具**：`scripts/comment-check.mjs` 输出逐文件覆盖率与缺口清单；`pnpm check:comments` 为基线报告（`--strict` 为 CI 门禁模式）。
- **诚实报告**：未达标文件列入缺口清单并分批补齐；**不得**在未全量达标时声称「已全量注释完成」（铁律三）。
- **交付报告必附**：本轮覆盖文件数 / 总文件数、未达标清单、`comment-check` 退出码取证。

### 当前缺口清单（2026-11-10 01:10 基线实测，102 文件 / 30228 可注释行 / 27000 已解释行 / 总体 89.3%）

以下 **11 个文件**低于 80% 阈值，`--strict` 目前只按**总体覆盖率**判定故仍通过（不阻断 CI），但按本铁律仍属未完成项，须分批补齐；**不得**以「strict 通过」等同于「逐行注释已完成」。本清单于 2026-11-10 复核：较 2026-11-09 基线的 8 个文件新增 3 项（`Deployments.tsx` 与 `deployment-summary.mjs` 为部署汇总模块新增源码，`verify-site-modules.mjs` 为统一入口清单校验脚本），原有 8 个文件的覆盖率**逐项未变**；总体口径由 83 文件 / 23882 行变为 102 文件 / 30228 行，源于 `site/` 恢复（2 个 HTML）与 2026-11-09～10 新增源码文件，非注释回退。

| 批次 | 文件 | 覆盖率 | 已解释 / 可注释 | 缺口行 | 归属模块 |
|---|---|---|---|---|---|
| 1 | `apps/web/src/views/Deployments.tsx` | 40.9% | 161 / 394 | 233 | 部署汇总视图 |
| 1 | `apps/web/src/views/Chat.tsx` | 43.8% | 160 / 365 | 205 | IM 前端视图 |
| 1 | `apps/web/src/components/VideoCall.tsx` | 47.0% | 133 / 283 | 150 | WebRTC 通话组件 |
| 2 | `services/mim-api/src/im/db.ts` | 48.7% | 145 / 298 | 153 | IM 数据层 |
| 2 | `services/mim-api/test/im.test.ts` | 49.0% | 71 / 145 | 74 | IM 契约测试 |
| 2 | `services/mim-api/src/im/ws.ts` | 50.4% | 115 / 228 | 113 | IM WebSocket 服务 |
| 3 | `services/mim-api/src/routes/im.ts` | 55.1% | 81 / 147 | 66 | IM 路由 |
| 3 | `scripts/verify-film-export.mjs` | 55.5% | 117 / 211 | 94 | 成片导出 E2E 校验脚本 |
| 4 | `scripts/deployment-summary.mjs` | 64.0% | 285 / 445 | 160 | 部署汇总生成器 |
| 4 | `apps/web/src/im/socket.ts` | 69.9% | 179 / 256 | 77 | IM 前端 socket |
| 4 | `scripts/verify-site-modules.mjs` | 77.5% | 324 / 418 | 94 | 统一入口清单校验脚本 |

- **补齐口径**：逐行中文注释须说明「做什么 + 为什么」，禁止无信息量复述；`.tsx` 的 JSX 属性区域可用 `/* … */` 前导 / 尾注（TS 语法实测合法），JSX children 区域用 `{/* … */}`，普通 TS 行用 `// …`；每批完成后须重跑 `node scripts/comment-check.mjs --strict` + `pnpm -r typecheck` + `npm test` 取证。
- **本轮状态**：清单已按 2026-11-10 01:10 实测刷新为 11 个文件，**未补齐任何一行注释**（本轮目标为仓库体检与工件恢复，不扩张到数百行低信息量注释改动）；后续按批次 1 → 2 → 3 → 4 推进，补齐后同步删除本表对应行。
- **本轮交付取证（2026-11-10 01:10）**：`node scripts/comment-check.mjs --strict` 退出码 0（102 文件、总体 89.3% ≥ 80%、11 个文件低于 80%）、`pnpm -r typecheck` 0、`pnpm --filter @mim/api test` **15 文件 211/211**、`node scripts/verify-deployments.mjs` **52/52**、`node scripts/env-check.mjs` / `version-check.mjs` / `npm run check` 0、web / admin / api / 根 `dist` 构建 0；线上取证见 §9.2（生产主机侧仍不可验证，按铁律八如实标注偏离）。
- **交付取证（2026-11-08 18:24）**：`node scripts/comment-check.mjs --strict --top=999` 退出码 0（总体 90.1% ≥ 80%），`pnpm -r typecheck` 0、`pnpm --filter @mim/api test` 11 文件 154/154、CI run `42470711736`（HEAD `b455d9c`）success；生产 `https://mim.mixm.top/health` 200 / 0.092s、首页 200 / 0.069s / LEN=5182（新产物 `index-D2UkZqM1.js`）、`/api/v1/modules` 200 / 0.078s / LEN=438，GitHub Pages 200 / 0.653s、Cloudflare Pages 200 / 1.526s。

## 铁律十二：全量远程仓库同步与生产统一部署到线上腾讯云自建服务器

**本铁律由用户于 2026-11-09 18:08 指令补充，收口「所有远程仓库 + 部署 + 线上腾讯云自建服务器」三类事项；不推翻铁律八 / 九 / 十，只在其之上明确「代码托管清单」与「唯一生产终点」。原铁律一～十一的编号、标题与约束语义保持不变。**

### 12.1 项目标识与适用边界

| 项 | 口径 |
|---|---|
| 项目名称 | **Mim**（用户 2026-11-09 18:50 统一定名；全仓名称口径一致） |
| 技术标识 | 仓库目录 `Mim`、npm scope `@mim/*`、仓库名 `afdk1991/mim` 与 `mallwm_admin/mim`、生产域名 `mim.mixm.top`，与项目名称一致，无需改名 |
| 适用 | 本仓库所有 AI 协作者、CI、自动化；涉及代码托管、push、部署、上线、域名 / DNS、生产取证的**每一轮交付** |
| 不适用 | 本地开发预览、单元测试、离线文档阅读（但仍不得作为交付终点，铁律八） |
| 排除 | **已移除的候选托管平台及任何非清单代码托管 / CI 平台**，按用户 2026-11-09 指令全量删除（见 §10.1 删除留痕），不得重新进入候选池 |

### 12.2 远程仓库清单与全量同步

| 远端名 | 地址 | 角色 | 每轮同步要求 |
|---|---|---|---|
| `origin` | `https://github.com/afdk1991/mim.git` | 源码主仓 + CI 触发源 | `git push origin main` 后 `git ls-remote origin refs/heads/main` 取证 |
| `gitee` | `https://gitee.com/mallwm_admin/mim.git` | 国内镜像仓（2026-11-10 起同时为铁律九矩阵第 10 行） | `git push gitee main` 后 `git ls-remote gitee refs/heads/main` 取证（2026-11-10 已按用户提供的私人令牌建仓并完成首次同步，见 [§9.11](#911-gitee-镜像仓补齐2026-11-10-2150-0800)；入矩阵取证见 [§9.12](#912-部署矩阵新增-gitee码云2026-11-10-2220-0800)） |

- **全量**：两个远端必须**同轮全部推送**，禁止只推 `origin`；逐个比对 hash 与本地 HEAD 一致（0 ahead / 0 behind）才算同步完成。
- **不可达处理**：某远端本轮网络 / 凭证不可达时，按铁律一如实报告「该远端未同步」并附命令输出与时间戳，**不得**以另一远端成功冒充全量同步，不得声明「已同步全部远程仓库」。
- **变更管控**：新增 / 删除 / 改名 remote 属结构性变更（铁律二），须先列影响清单并获授权；禁止重新引入已移除平台的远端、其 CI 配置文件 / CI 变量 / 镜像仓库。
- **托管 ≠ 生产**：远程仓库只承担源码托管与镜像，**不承担生产运行**；生产运行唯一落点为 §12.3。

### 12.3 生产唯一权威终点：线上腾讯云自建服务器

| 项 | 口径 |
|---|---|
| 主机 / 域名 | 腾讯云自建服务器（自有），`https://mim.mixm.top`；DNS A 记录 `115.159.159.11`（§9.1 取证），DNSPod 台账见 `dnspod_records_2026-11-05_21-42-26.xls` 与 [05-runbook.md §7.1.3 / §7.6](./docs/wiki/05-runbook.md) |
| 运行形态 | 宿主机直部署：nginx（静态根 + `/api/v1` 反代 + SPA `try_files`）+ systemd `mim-api`（8787）+ SQLite WAL 持久化库 `/opt/mim/app/services/mim-api/data/mim.db`；**前后端 + 数据库一体上线** |
| 服务器布局 | `/opt/mim/app`（git 仓库）/ `/opt/mim/web`（用户端静态根）/ `/opt/mim/admin`（管理后台静态根）/ `/opt/mim/mim-api.env`（运行期凭证） |
| 代码同步通道 | 服务器 `https://github.com` 出网被阻断，改走 `git@github.com:22` + `/opt/mim/.ssh/deploy_key` 只读 Deploy Key |
| 部署链路 | push `main`（双远端）→ GitHub Actions `.github/workflows/deploy.yml` → 类型检查 / 测试 / 构建 → SSH 幂等脚本发布 → systemd 重启 → `/health` 取证 |

- **唯一性**：铁律九的 10 平台及其 200 响应**仅作分发 / 镜像 / 可用性取证**；静态站直传（EdgeOne / GitHub Pages / Cloudflare Pages）、同源反代 Worker、容器镜像（Sealos / ghcr）均属分发层，**任何一个都不得替代 `mim.mixm.top` 成为「已上线」依据**。
- **冲突裁决**：铁律八 / 九的「多平台发布」与本节「唯一生产终点」并列时，本节定义**交付终点**；铁律九仍完整约束「只走免费方案 + 逐平台取证」，两者并行不悖、不构成豁免。
- **禁止**：禁止把本地预览、`npm run dev`、任一托管平台 200、CI job success 单独当作「已上线」；禁止引入付费方案（铁律九 / 十）。
- **凭证边界**：生产 SSH 私钥、`MIM_AUTH_ADMIN_PASSWORD`、`tccli` 等属用户私有凭证；沙箱缺失时按铁律一「唯一例外」处置，附已尝试取证后如实标注偏离，**不得伪造健康检查或线上截图**。
- **现状如实标注（2026-11-09）**：`deploy/` 与 `deploy.sh` 已从工作树移除（未提交），`.github/workflows/deploy.yml` 仍在库且存在悬空引用（§0）；`mim.mixm.top` 本机 `000` 属本地代理 `CONNECT tunnel failed, response 502`，主机侧状态无 SSH / `tccli` 凭证可验证。恢复部署链路或收敛 CI 属结构性变更，须按铁律二授权后执行，本轮不擅自改动。

### 12.4 每轮交付必须附的取证（缺一不得宣称完成）

| # | 取证项 | 命令 / 方式 | 通过标准 |
|---|---|---|---|
| V1 | 双远端同步 | `git ls-remote origin refs/heads/main`、`git ls-remote gitee refs/heads/main` | 两端 hash 均 == 本地 HEAD |
| V2 | 生产健康 | `curl -sS -o /dev/null -w "%{http_code}" https://mim.mixm.top/health` | HTTP 200 且响应 `{"status":"ok"}` |
| V3 | 关键接口 | `curl https://mim.mixm.top/api/v1/modules` | HTTP 200 且返回有效模块列表 |
| V4 | 真实渲染 | 有头 Edge + CDP 打开 `https://mim.mixm.top/store` | 模块卡片可见、console 零报错 |
| V5 | 逐平台 | 铁律九 / §9.1 各入口 `curl` | 按轮刷新；本机 `000` 须附网络侧证据与替代取证 |
| V6 | 本地门禁 | `pnpm -r typecheck`、`pnpm --filter @mim/api test`、`verify-auth-gate`、`comment-check --strict`、`npm run check` | 全 0 / 全 PASS |

> V2–V4 受制于生产主机可达性与私有凭证时，按铁律八「若生产环境客观不可达」条款如实标注偏离，**不得以 V5 / V6 通过冒充已上线**。

### 12.5 变更同步清单（铁律七）

规则、远端或平台发生变更时，同轮更新：`AGENTS.md` 本节与 §0 / §9.1 / §10.1、`README.md`（铁律清单 + 站点与部署 + 多平台部署矩阵）、`docs/wiki/01-architecture.md`、`02-modules.md`、`05-runbook.md`、`06-governance.md`、`docs/wiki/README.md`、`docs/rewrite-vs-refactor-decision.md`、`.github/workflows/deploy.yml`（若涉及 CI）、工作日志。不涉及源代码 / 依赖清单 / 锁文件 / 版本号时，须在交付报告明确标注「不涉及」。

---

## 13. 部署汇总：单一事实源与核对口径（2026-11-09 新增，非铁律）

> 本章为**功能模块说明**，不新增铁律、不改写铁律一～十二的编号 / 标题 / 约束语义；§0 与 §9.1 的历史快照按铁律三原样保留，本章仅追加本轮取证与统一口径。

**13.1 单一事实源**：部署仓库与部署项统一由 `packages/core-domain/src/deploymentRegistry.json`（schema `mim.deployment-registry.v1`）定义，共享包 `deploymentRegistry.ts` 提供类型 / 索引 / 过滤 / 汇总；后端 `services/mim-api/src/routes/deployments.ts`、前端 `apps/web/src/views/Deployments.tsx`、生成器 `scripts/deployment-summary.mjs` 一律消费该数据源，**不得各自维护第二份清单**。

**13.2 统一字段**（`snake_case`，与 API 响应一致）：`id` / `name` / `aliases` / `platform_id` / `layer` / `kind` / `repository{id,url,role}`（仓库标识）/ `entry_url` / `delivery{mode,ci_job,ci_step,artifact,artifact_in_head,artifact_in_worktree,credential,modes}` / `status`（部署状态）/ `result`（部署结果）/ `anomalies`（异常说明）/ `missing_fields`（缺失信息）/ `sources`。

**13.3 三类特殊态必须显式标识**（不得用 0 / 空串 / 绿色徽标掩盖）：
- **空数据**：`result = null`，须带 `EMPTY_RESULT` 异常与 `http_code` 缺失项；本轮为 `pages.iga`、`worker.mim-store`，外加 2026-11-10 新增的 `repo.gitlab`、`repo.bitbucket`、`pages.netlify`、`pages.azure-swa`、`container.render` 共 7 项（均待接入外部账号，未达线上可达）。
- **失败状态**：`status = BROKEN` 或 `result.verdict = FAIL`，须有异常说明；本轮为 `server.tcloud`（生产 `000`）、`pages.vercel`（TLS 阻断）。`repo.gitee` 的 2026-11-09 `ls-remote` exit 124 已于 2026-11-10 解除（建仓 + 同推成功后状态 `OK / PASS`），历史留痕以 `REMOTE_TIMEOUT_RECOVERED` 保留，**不静默删除**。
- **缺失信息**：逐项列 `missing_fields`（私有凭证、工件路径、未取得的 V2/V3/V4 取证等）；2026-11-10 22:20 重生成后为 46 项（含 5 个新增免费层平台的凭据与入口缺失）。

**13.4 覆盖、去重与排除**：铁律九 **10 个矩阵平台**（2026-11-10 起含 Gitee 镜像仓）+ 6 个补充平台 = 16 个平台目录 → 16 个规范部署项（`repo.gitee` 已于 2026-11-10 由补充项提升为矩阵成员，仍为同一规范部署项；`worker.mim-store` 为矩阵外补充项，并于 2026-11-10 按用户决策「全部采用免费层」将 GitLab / Bitbucket / Netlify / Azure SWA / Render 共 5 项从铁律十候选池提升为「已采用（免费层）」登记项）；5 个 CI 作业中 4 个为部署作业，2 个真实 git 远端 + 2 个计划远端（GitLab / Bitbucket，待关联账号后接入）；README 曾将 Cloudflare 同源自托管入口另列一行，与 `pages.cloudflare` 同域名同载体，合并后用 `delivery.modes` 区分，避免重复计数。`candidate.cf-workers`（已合并进 `pages.cloudflare` + `worker.mim-store`）与 `excluded.vefaas`（无长期免费层）仍列 `excluded` 且**不计入部署项**。

**13.5 工件双口径（本轮纠正）**：`deploy/*`、`Dockerfile`、`vercel.json`、`wrangler.toml`、`functions/*` 等 21 个路径为 **staged `D` 未提交**，`git ls-tree HEAD` 实测**仍在远端 HEAD `3b9b251`**，故 CI 当前**不会**因缺件失败；风险在「一旦提交删除即悬空」。汇总以 `artifact_in_head` / `artifact_in_worktree` 两个字段分别记录，不得混为一谈。

**13.6 汇总不是部署取证**：`docs/deployment-summary.{json,md}` 与 `/deployments` 视图是**核对工具**，其 `PASS` 只证明采集与字段自洽，**不得**替代铁律八 / 十二的 V2–V4 线上取证，也不得据以宣称「已上线」；生产唯一权威终点仍为 §12.3 的 `https://mim.mixm.top`。

**13.7 每轮同步清单（铁律七）**：部署项 / 平台 / 远端 / CI 作业发生变化时，同轮更新 `deploymentRegistry.json`、本文件 §13、`README.md`（版本 / 校验命令 / 仓库结构 / 前端视图 / 后端接口 / 站点与部署 / 文档索引）、`docs/wiki/{01-architecture,02-modules,05-runbook,README}.md`、`Mim-PRD.html`、`package.json` 脚本、生成器与校验器断言，并重新生成两份结构化产物。**不涉及**：依赖清单 / 锁文件（零第三方依赖）、semver 数字（`preview` 通道）、CI 部署语义。

**13.8 历史取证快照（2026-11-09 23:03 +08:00，HEAD `3b9b251`；按铁律三留痕，不作现状引用）**：`origin` `ls-remote` = `3b9b251` ✅；`gitee` exit 124 未取证；生产 `/health` `000` / 2.123s / curl exit 7（代理 502）；GitHub Pages 200/5182B、Cloudflare Pages 200/5182B、Sealos `/health` 200/53B、EdgeOne 200/984B（WAF 挑战页，判 `DEGRADED`）、ghcr 401/73B（未鉴权属正常）、Vercel `000` / exit 35 TLS 阻断；6 项工件工作树漂移；异常 26 项（🔴2 / 🟡17 / 🟢7）、缺失信息 34 项。按铁律八 / 十二如实标注**未做生产部署**。

**13.9 2026-11-10 决策：全部采用免费层**：用户明确「把你表里列的全部平台都纳入采用范围，且只用免费额度」。据此将铁律十候选池中的 GitLab / Bitbucket（远程仓库）、Netlify / Azure SWA / Render（部署平台）共 5 项从 `excluded` 提升为 `items` 中的「已采用（免费层）」登记项（`status = UNVERIFIED`、`result = null` 标 `EMPTY_RESULT`、各带免费额度 note 与缺失凭据清单），不冒充已部署。已配套新增免费层配置脚手架并接入受保护 CI：
- `netlify.toml`：发布 `apps/web/dist` + SPA 回退；deploy.yml 的 `Netlify` 步骤按 Vercel 同款「缺 `NETLIFY_AUTH_TOKEN` 即 SKIP」模式运行。
- `render.yaml`：Render 免费静态站点（750 实例小时/月）；deploy.yml 的 `Render` 步骤按同款 SKIP 模式触发已存在服务部署。
- `.github/workflows/azure-static-web-apps.yml`：Azure SWA 独立工作流，`AZURE_SWA_TOKEN` 缺省即 SKIP，不阻断。
- GitLab / Bitbucket 计划作为镜像仓，待用户关联账号并 `git remote add` 后接入（`coverage.planned_git_remotes = 2`）。
**诚实边界**：本轮仅完成「决策登记 + 配置脚手架 + 受保护 CI」，5 项均未达到线上可达；真实部署需在对应平台控制台创建项目并填入 secret（`NETLIFY_AUTH_TOKEN` / `NETLIFY_SITE_ID` / `RENDER_API_KEY` / `RENDER_SERVICE_ID` / `AZURE_SWA_TOKEN` 及两镜像仓凭证）后由 CI 自动发布。

**13.10 本轮取证：Gitee 入矩阵（2026-11-10 22:20 +08:00，HEAD `4398cf0`）**：`git ls-remote gitee refs/heads/main` = `4398cf0`（exit 0 / 0.27s，与本地 HEAD 一致，0 ahead / 0 behind）；`curl https://gitee.com/mallwm_admin/mim` = **200 / 0.469s / 52034B**（标题「mim: Mim - 跨平台商业级项目(GitHub 镜像)」、默认分支 `main`、129 次提交）；`platform_catalog.in_matrix = true`、`coverage.matrix_platforms = 10`；重新生成 `docs/deployment-summary.{json,md}`（部署项 16 / 有取证 9 / 空数据 7 / 异常 39（🔴1 / 🟡16 / 🟢22）/ 缺失信息 46）；本地门禁 `verify-deployments` **52/52**、api 契约测试 **16 文件 233/233**、`pnpm -r typecheck` 0、`comment-check --strict` 0。生产 `mim.mixm.top` 沿用 2026-11-09 快照（`000`），**本轮未做生产部署、未宣称已上线**。

---

## 与铁律一冲突时的优先级

若「必须引入第三方依赖」（铁律五）或「禁止只做本地预览、必须生产部署」（铁律八）与「AI 负责执行」（铁律一）在特定环境下冲突（如沙箱无网络、包管理器不可达、目标环境限制依赖数量、生产主机不可达），以铁律一（执行优先）为最高位：AI 可改用本地实现、精简功能或寻找替代方案，但执行时必须在报告中显式标注「已偏离铁律五 / 铁律八」并说明理由，便于用户回溯。

***

_本文件由用户于 2026-11-01 立规，2026-11-03 增补铁律六、七，2026-11-04 增补铁律八（全自动化生产部署，禁止仅本地预览），2026-11-06 增补铁律九（9 平台免费部署矩阵与逐平台取证）与铁律十（免费平台额度矩阵与选型路由，含 Render 免费层定性修正）、铁律十一（全仓库逐行注释与解释）。AI 协作者在每轮交付前须自检是否违反铁律一、铁律八、铁律九、铁律十、铁律十一与铁律十二。2026-11-09 按「保留现有结构梳理」新增 §0 当前状态基线、§9.1 本轮复核、历史留痕导航与缺口口径刷新，铁律一～十一的编号 / 标题 / 约束语义均未改动。2026-11-09 18:08 按用户指令补充**铁律十二**（全量远程仓库同步 + 生产统一部署到线上腾讯云自建服务器 + 项目名称统一为 Mim），全量删除原候选托管平台的全部相关内容（§10.1 留痕），并按铁律七同步 README 与 Wiki 全部铁律条数口径。2026-11-09 18:50 按用户指令把全仓作为项目名称的旧称统一更正为 **Mim**，AGENTS / README / Wiki / 决策文档同步完成，原十一条铁律与铁律十二的约束语义未变。**2026-11-10 按用户指令把 Gitee（码云）镜像仓纳入铁律九部署矩阵第 10 行（矩阵由 9 平台扩为 10 平台），仅扩充矩阵成员与取证口径，铁律一～十二的编号 / 标题 / 约束语义未改动。**_
