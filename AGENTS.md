# AGENTS.md — Mim 项目协作铁律

> 本文件对在 Mim 仓库内工作的所有 AI 协作者（含本机 WorkBuddy 会话、CI、自动化）具有强制约束力。

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

- 部署链路必须**全自动化、可重放**：CI（GitHub Actions）在 `main` 上触发 → 安装依赖 → 类型检查 → 测试 → 构建 → 远程发布 → 重启服务 → 健康检查；服务器侧以幂等脚本（`deploy/*.sh`）实现，禁止依赖手工敲命令。

- **禁止只交付静态站点的本地预览**：静态产物（`apps/web` 构建产物）必须与后端 API、数据库一起上线到生产域名；生产部署配置（nginx / systemd / CI）必须入库（`deploy/`、`.github/workflows/`），不得散落在个人机器。

- 交付报告必须附**线上取证**：生产域名健康检查（如 `curl https://<域名>/health` 返回 200）、关键接口返回（如 `/api/v1/plans`）、以及一次真实端到端操作（登录 / 建项目 / 建任务 / 仪表盘）的浏览器验证结果。**无线上取证不得宣称「已上线」。**

- 数据库必须是**持久化生产库**（非内存库、非临时目录），备份与迁移脚本随部署工件入库。

- 若生产环境客观不可达（无主机、无凭证、无网络），按铁律一处置：先穷尽可执行动作并附取证，再明确报告缺口，不得以「本地预览」替代上线。

## 铁律九：多平台部署矩阵——只走免费方案，且必须逐平台取证

**本项目部署矩阵为 9 个免费平台，任何一轮部署都不得脱离该矩阵、不得引入付费方案。**

| 平台 | 免费 | 状态 | 域名 | 访问速度（HTTP / 耗时 / 连接） |
|---|---|---|---|---|
| 腾讯云自建服务器 | ✅ 是（自有服务器） | ✅ 已上线（前后端 + SQLite） | `https://mim.mixm.top` | 200 / 0.065s / 0.025s ⚡最快（`/health` 200 / 0.071s / 0.036s；`/admin/` 200 / 0.065s / 0.029s（`LEN=1430`，与上轮 admin 产物指纹一致）；`/api/v1/modules` 200 / 0.066s / 0.027s（商城接口已上线）；首页 `LEN=2896` 含归一化脚本，产物 `assets/index-s6n-xZuf.js` + `assets/index-DFqN9O7h.css`） |
| 腾讯云 EdgeOne Pages | ✅ 是 | ✅ 已同步（**direct upload 直传型，非仓库连接**；最近一次 Deployment `dpu0n61jlos8`，2026-11-08（`git worktree` 干净树 HEAD `42b98bc` 构建产物，经 `edgeone makers deploy apps/web/dist -n mim-app --env production` 直传）；**curl 命中 WAF 挑战页，须有头浏览器取证**） | `https://data.mixm.top` | curl 200 / 0.103s / 0.030s 但仅 985B 为 EdgeOne WAF 机器校验页（`EO_Bot_Ssid` / `_0x649a`）；最近一次有头取证（2026-11-06）：`title=Mim — 跨端任务与轻协作`、`assets/index-cpYhbG3w.js` + `assets/index-LqZ4J1V-.css`、`isWafChallenge=false` → 属实弹前端；**2026-11-07 01:48 起复用 profile 的 WAF 放行凭证已过期（约 17h），回落层 2 验证码页，CDP 合成点击 ×15 未通过；2026-11-08 04:01 本轮复测 curl 仍 985B 挑战页，真实内容连续多轮未复验（铁律三如实记录），替代取证为干净树直传 Deployment `dpu0n61jlos8`（exit 0，产物指纹 `index-s6n-xZuf.js` 与生产服务器一致）** |
| GitHub Pages | ✅ 是 | ✅ CI 自动发布（**含 `?tads` / 裸问号归一化脚本，已实测**） | `https://afdk1991.github.io/mim/` | 200 / 0.216s / 0.079s（`LEN=2896` 含归一化脚本，产物 `assets/index-CDuo76_9.js`） |
| Sealos | ✅ 是 | ✅ CI 自动发布（容器 + PVC；**纯 API 容器，根路径 `/` 404 无路由，`/health` 200**） | `https://mim-i3ywsdfn.cloud.sealos.io` | `/` **404** / 0.264s / 0.093s（`{"code":"NOT_FOUND","message":"route GET / not found"}`，`LEN=106`，属正常非故障）；`/health` 200 / 0.272s / 0.101s（`LEN=53`，`{"status":"ok"}`） |
| Cloudflare Pages | ✅ 是 | ✅ CI 自动发布（含 `/api` 反代与 `?tads` / 裸问号归一化脚本，已实测） | `https://mim-8ah.pages.dev` | 200 / 0.534s / 0.169s（`LEN=2896` 含归一化脚本，产物 `assets/index-s6n-xZuf.js` 与生产服务器同指纹） |
| GitHub Packages (ghcr) | ✅ 是 | ✅ CI 自动推送镜像 | `ghcr.io/afdk1991/mim-api` | 401 / 0.544s / 0.111s（未鉴权 401 `UNAUTHORIZED` 属正常） |
| IGA Pages | ✅ 是 | ✅ 已部署（Project `fr95fuwu57` / Deploy `p4f5a4svqm`） | `preview.iga-pages.com`（带 `iga_token` 访问 200） | 200（需 token）/ 未纳入本机 curl 批次 |
| Vercel | ✅ 是 | ✅ CI 取证通过（2026-11-06T13:15:10Z） | `https://mim-puce.vercel.app` | CI 记录 200；本机 000 / 21.271s（`--max-time 25` 截断，curl exit 28）/ 0.000s（`nslookup` 解析至 162.125.32.9（Dropbox 段）与 2a03:2880:f126:83:face:b00c:0:25de（Facebook 段），典型 DNS 污染特征，TCP 连接建立即失败） |
| GitHub 仓库 | ✅ 是 | ✅ 已同步（远端 main HEAD `d4c4620`，2026-11-08 `git ls-remote` 取证） | `https://github.com/afdk1991/mim` | 本机 000（curl exit 35：TLS 握手被阻断，TCP 0.020s 可建立；替代取证 `git ls-remote` 成功返回 `refs/heads/main` = `d4c4620` ✅） |

- **权威明细位置**：逐平台发布作业见 [README.md](./README.md)「多平台部署矩阵」；实测汇总与 DNSPod 记录对应见 [05-runbook.md §7.1.3 / §7.6](./docs/wiki/05-runbook.md)；CI 实现见 [.github/workflows/deploy.yml](./.github/workflows/deploy.yml)（`deploy` / `pages` / `packages` / `platforms` 四个作业）。
- **免费是硬约束**：新增平台前必须确认无付费门槛；`veFaaS` 等**无长期免费层**的方案已移出交付范围，不得重新引入。`Render` 因存在长期免费层（750 实例小时/月），已于 2026-11-06 按铁律十改为「免费候选平台」，不再属于排除项。
- **每次部署必须更新取证**：表中「HTTP / 耗时 / 连接」须以当轮真实 `curl`（或 CI 出口）结果刷新，并注明测试日期与本机网络位置；不得沿用旧数据冒充本轮结果。
- **本机不可达 ≠ 部署失败**：`000` 类结果必须给出网络侧证据（DNS 污染地址、TCP 超时、HTTPS 阻断），并以 CI 日志、`git push` / `gh` CLI、平台控制台作为替代取证；无替代取证不得声明「已上线」。
- **变更须全量同步**（铁律七）：平台增删、域名变更、凭证变更时，同轮更新本表、README、`docs/wiki/05-runbook.md`（含 DNSPod 对应表）与 CI 工作流，缺一视为交付未完成。
- **最近一次复测（2026-11-08 04:01:51 +08:00，本机中国网络 curl，HEAD `d4c4620`「docs: 刷新铁律九平台矩阵取证」，性质为可访问性复测轮——无新部署、未重复浏览器 E2E 与 CI 重跑，商城接口逐项与 E2E 结论沿用 2026-11-08 03:31 轮次）**：`mim.mixm.top/health` 200 / 0.071s / 0.036s、`mim.mixm.top/` 200 / 0.065s / 0.025s / LEN=2896 且首页产物 `assets/index-s6n-xZuf.js` + `assets/index-DFqN9O7h.css` 含 `?tads` / 裸问号归一化脚本（`history.replaceState`）、`mim.mixm.top/admin/` 200 / 0.065s / 0.029s / LEN=1430、`mim.mixm.top/api/v1/modules` 200 / 0.066s / 0.027s、**`data.mixm.top` 200 / 0.103s / 0.030s / LEN=985 为 WAF 挑战页（放行凭证自 2026-11-07 01:48 起已过期，真实内容连续多轮未复验；替代取证为 `git worktree` 干净树（HEAD `42b98bc`）构建产物直传 Deployment `dpu0n61jlos8`（exit 0，产物指纹 `index-s6n-xZuf.js` 与生产服务器一致））**、GitHub Pages 200 / 0.216s / 0.079s / LEN=2896（含归一化脚本，产物 `assets/index-CDuo76_9.js`）、Sealos `/health` 200 / 0.272s / 0.101s / LEN=53（`{"status":"ok"}`；根路径 `/` 404 / 0.264s / 0.093s / LEN=106 属正常，纯 API 容器未注册根路由）、Cloudflare Pages 200 / 0.534s / 0.169s / LEN=2896（含归一化脚本，产物 `assets/index-s6n-xZuf.js` 与生产服务器同指纹）、ghcr tags 未鉴权 401 / 0.544s / 0.111s（`UNAUTHORIZED` 属正常）、Vercel 本机 000 / 21.271s（`--max-time 25` 截断，curl exit 28；`nslookup` 解析至 162.125.32.9（Dropbox 段）与 2a03:2880:f126:83:face:b00c:0:25de（Facebook 段 IPv6），典型 DNS 污染特征；CI「托管平台同步」作业含 Vercel 部署成功作替代取证）、github.com 本机 000 / 0.020s（curl exit 35：TLS 握手被阻断，TCP 可连；仓库操作经 `git ls-remote` 取证 ✅，远端 main HEAD = `d4c4620`）。速度排序（本机总耗时升序）：自建 0.065s < EdgeOne 0.103s（WAF 挑战页）< GitHub Pages 0.216s < Sealos 0.272s < Cloudflare Pages 0.534s < ghcr 0.544s。状态码与基线一致，无渠道新增或失效。
- **CI 重跑运维提示（2026-11-07 取证）**：`gh run rerun <run-id> --failed` 会在**同一 workflow run 内二次上传** `github-pages` artifact，导致 `actions/deploy-pages@v4` 报 `Multiple artifacts named "github-pages" were unexpectedly found for this workflow run. Artifact count is 2.` —— 重跑无效。正确做法是 `gh workflow run deploy.yml --ref main` 触发**全新 run**，再 `gh run watch <new-run-id> --exit-status` 监控。
- **WAF 假阳性判别规则**：EdgeOne 等带机器人校验的托管平台，`curl` / 无头 UA 可能拿到 200 但响应体为数百字节混淆 JS（含 `EO_Bot_Ssid` / `_0x649a`）。此类 200 **不得**作为「内容正确」的取证；须以有头真实浏览器（本机 Edge + CDP）读取 `document.title` / `script[src]` / `body.innerText` 并确认 `isWafChallenge=false`。
  - **拦截面实测（2026-11-07）**：`curl` / 无头 UA → 层 1 混淆 JS（约 986B）；**无头浏览器（`--headless=new`）与全新 user-data-dir 的有头 Edge → 层 2 验证码页**（`title=Security Verification`、`https://captcha.eo.gtimg.com/TEOCaptchaWidgetV1.js`、`htmlLen≈16419`、文案「正在验证连接安全性」）。判定正则须同时覆盖 `EO_Bot_Ssid|_0x649a|TEOCaptchaWidgetV1|正在验证连接安全性`。
  - **可通过方式与其失效边界**：复用**已通过过校验的** user-data-dir（本机 `$env:TEMP\edge-cdp-profile`）+ 有头模式 + CDP（`--remote-debugging-port=9333`）。新建 profile 一律落入验证码页，不可作为取证手段。**放行凭证会过期（实测约 17h 后失效：2026-11-07 01:48 复用该 profile 仍回落层 2）；层 2 的 TEOCaptcha 对 CDP 合成鼠标事件（`Input.dispatchMouseEvent`，×15 次点击）不放行；凭证过期后唯一出路是人工在有头浏览器勾选一次复选框，放行会回写 profile，后续 CDP 即可复用。**
- **`?tads` 注入机制（2026-11-07 定性）**：EdgeOne Bot 挑战脚本给地址栏附加 `?tads`，其字符串表内的清理逻辑为 `location.href=location.href.replace(/[?|&]tads/, '')`，只匹配 `?tads` 本体、不匹配清理后残留的裸问号，故留下 `https://data.mixm.top/?`。修复落在 `apps/web/index.html` `<head>`（`history.replaceState` 原地清空查询串/裸问号，不新增历史、不跳转）。`edgeone makers --help` 仅 8 个子命令，**无 WAF / Bot 管理子命令**，关闭 WAF 只能走腾讯云 Web 控制台（需用户私有登录态，沙箱无凭证）。
- **与「不使用容器」既有约定的说明**：Sealos（容器 + PVC）、ghcr 镜像与 `deploy/sealos/mim.yaml` 属分发型平台的必要载体，仅限「托管平台同步」链路；生产主链路（`mim.mixm.top`）仍为宿主机直部署（nginx + systemd + SQLite），不得改为容器运行。

## 铁律十：免费平台额度矩阵与选型路由

**免费是唯一准入标准，不看品牌标签。** 本铁律收录远程仓库与部署平台的免费额度，作为「候选池 + 选型依据」；铁律九的 9 平台表是「已落地矩阵」，二者关系为：铁律九 = 当前实际部署，铁律十 = 可纳入候选与选型依据。任一层级都不得引入付费方案。

### 10.1 远程仓库平台

| 平台 | 免费版核心额度 | 特点 |
|---|---|---|
| GitHub | 无限公开/私有仓库、无限协作者；2,000 CI/CD 分钟/月；500MB Packages 存储 | 生态最大，Actions + Pages 一条龙 |
| GitLab | 免费层存储上限 5GB（超限项目转只读）；CI/CD 分钟按顶级群组计，子群组不额外增加 | 内置 DevOps 全流程，CI/CD 能力强 |
| Bitbucket | 最多 5 人永久免费；仓库软限 2GB / 硬限 4GB；LFS 1GB；约 50 构建分钟/月 | 与 Jira 深度集成，小团队够用 |
| Gitee（码云） | 1000 个仓库、5GB 总容量，含 Gitee Pages 静态托管 ⚠️单源待校验 | 国内访问快，需实名 |

**选型建议**：个人/开源默认 GitHub；重 CI/CD 或私有化诉求看 GitLab；5 人内小团队且用 Jira 选 Bitbucket；主要面向国内访问选 Gitee。

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

- **适用范围**：仓库内所有自有源码与脚本 —— `apps/web/src/**`、`apps/admin/src/**`、`services/mim-api/src/**` 与 `services/mim-api/test/**`、`packages/*/src/**`、`scripts/**`、`*.css`、`*.html`（含 `site/*.html`、`Mim-PRD.html`）；新增与修改的每一行同样适用。校验实现 `scripts/comment-check.mjs` 的 `TARGET_DIRS` 覆盖 `apps`（含两个前端）、`services`、`packages`、`scripts`、`site`，与此处文本一致。
- **注释粒度**：每行代码必须有对应解释（行内尾注或紧邻上一行）；注释用**中文**，说明「做什么 + 为什么」，禁止无信息量复述（如 `i++ // i 加一`）。
- **豁免项**（不要求逐行注释）：锁文件（`pnpm-lock.yaml` 等）、`node_modules`、自动生成产物（`dist/`、`*.min.*`）、二进制与数据文件、纯文档 `*.md`、`.env.example`。
- **校验工具**：`scripts/comment-check.mjs` 输出逐文件覆盖率与缺口清单；`pnpm check:comments` 为基线报告（`--strict` 为 CI 门禁模式）。
- **诚实报告**：未达标文件列入缺口清单并分批补齐；**不得**在未全量达标时声称「已全量注释完成」（铁律三）。
- **交付报告必附**：本轮覆盖文件数 / 总文件数、未达标清单、`comment-check` 退出码取证。

## 与铁律一冲突时的优先级

若「必须引入第三方依赖」（铁律五）或「禁止只做本地预览、必须生产部署」（铁律八）与「AI 负责执行」（铁律一）在特定环境下冲突（如沙箱无网络、包管理器不可达、目标环境限制依赖数量、生产主机不可达），以铁律一（执行优先）为最高位：AI 可改用本地实现、精简功能或寻找替代方案，但执行时必须在报告中显式标注「已偏离铁律五 / 铁律八」并说明理由，便于用户回溯。

***

_本文件由用户于 2026-11-01 立规，2026-11-03 增补铁律六、七，2026-11-04 增补铁律八（全自动化生产部署，禁止仅本地预览），2026-11-06 增补铁律九（9 平台免费部署矩阵与逐平台取证），2026-11-06 增补铁律十（免费平台额度矩阵与选型路由，含 Render 免费层定性修正）、铁律十一（全仓库逐行注释与解释）。AI 协作者在每轮交付前须自检是否违反铁律一、铁律八、铁律九、铁律十与铁律十一。_
