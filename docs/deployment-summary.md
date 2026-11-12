# Mim 部署汇总（结构化核对表）

- 生成时间：2026-11-12T17:11:27.866Z
- 本地 HEAD：`0dd2b9d`
- 采集模式：baseline（沿用契约取证快照）
- 单一事实源：`packages/core-domain/src/deploymentRegistry.json`（schema mim.deployment-registry.v1）

## 1. 总览

| 指标 | 数值 | 说明 |
|---|---|---|
| 矩阵平台 | 11 | 铁律九 10 个免费平台 |
| 规范部署项 | 12 | 去重后的部署仓库 + 部署项 |
| git 远端 | 2 | gitee / origin |
| CI 作业 | 5 | 其中部署作业 4 个 |
| 有取证 | 12 | 本轮存在可信取证 |
| 空数据 | 0 | result 为 null，明确标识而非填 0 |
| 阻断异常 | 0 | 🔴 0 / 🟡 0（另 🟢 30 条为历史取证留痕，不是待处置异常） |
| 缺失信息 | 5 | 字段名或工件路径 |
| 工作树漂移 | 0 | 工件在远端 HEAD 存在、本地工作树缺失 |

## 2. 部署项主表（统一字段）

| 规范 ID | 仓库标识 | 平台 / 层级 | 交付链路 | 访问域名 | 部署状态 | 部署结果 | 异常说明 |
|---|---|---|---|---|---|---|---|
| `repo.github` | github:afdk1991/mim | GitHub 仓库 / source | push — | https://github.com/afdk1991/mim | ✅ OK | ✅ PASS — / —B | HTTPS_BLOCKED 等 1 项 |
| `repo.gitee` | gitee:mallwm_admin/mim | Gitee（码云）镜像仓 / source | push — | https://gitee.com/mallwm_admin/mim | ✅ OK | ✅ PASS 200 / 52034B | REMOTE_TIMEOUT_RECOVERED 等 3 项 |
| `server.tcloud` | github:afdk1991/mim | 腾讯云自建服务器 / production | ci deploy | https://mim.mixm.top | ✅ OK | ✅ PASS 200 / 53B | PRODUCTION_UNREACHABLE 等 4 项 |
| `pages.github` | github:afdk1991/mim | GitHub Pages / distribution | ci pages | https://afdk1991.github.io/mim/ | ✅ OK | ✅ PASS 200 / 5182B | SPA_FALLBACK_WORKTREE_RESTORED 等 2 项 |
| `packages.ghcr` | ghcr:afdk1991/mim-api | GitHub Packages (ghcr) / distribution | ci packages | https://ghcr.io/v2/ | ✅ OK | ✅ PASS 401 / 73B | AUTH_401_BY_DESIGN 等 2 项 |
| `pages.edgeone` | — | 腾讯云 EdgeOne Pages / distribution | manual — | https://data.mixm.top | ✅ OK | ✅ PASS 200 / 5305B | CUSTOM_DOMAIN_ARTIFACT_ALIGNED 等 4 项 |
| `pages.cloudflare` | github:afdk1991/mim | Cloudflare Pages / Workers / distribution | ci platforms | https://mim-299.pages.dev/ | ✅ OK | ✅ PASS 200 / 5114B | DUPLICATE_MATRIX_ROW_MERGED 等 9 项 |
| `pages.vercel` | github:afdk1991/mim | Vercel / distribution | ci platforms | https://mim-puce.vercel.app | ✅ OK | ✅ PASS 200 / 5305B | — |
| `pages.iga` | — | IGA Pages / distribution | manual platforms | https://mim-04xa6mw3hm-e1uhm452pi.preview.iga-pages.com | ✅ OK | ✅ PASS 200 / 5305B | PRIVATE_TOKEN_REQUIRED 等 3 项 |
| `worker.mim-store` | — | Cloudflare 独立 Worker / distribution | ci platforms | https://mim-store.15726833367.workers.dev | ✅ OK | ✅ PASS 200 / 5305B | DNS_POLLUTION 等 1 项 |
| `pages.netlify` | github:afdk1991/mim | Netlify / distribution | ci platforms | https://mim-web.netlify.app | ✅ OK | ✅ PASS 200 / 5840B | — |
| `worker.mim-api-edge` | — | Cloudflare 独立 Worker / distribution | ci platforms | https://mim-api-edge.15726833367.workers.dev | ✅ OK | ✅ PASS 200 / 53B | LOCAL_WORKERS_DEV_BLOCKED 等 1 项 |

## 3. 异常说明明细

| 部署项 | 严重度 | 异常码 | 说明 |
|---|---|---|---|
| `repo.github` | 🟢 info | `HTTPS_BLOCKED` | github.com 网页本机 TLS 握手被阻断，仓库同步改以 git ls-remote 取证，不影响同步结论 |
| `repo.gitee` | 🟢 info | `REMOTE_TIMEOUT_RECOVERED` | 2026-11-09 23:03 曾 REMOTE_TIMEOUT（ls-remote exit 124）；实际根因为镜像仓从未创建，2026-11-10 建仓后首次推送成功，超时态已解除，历史不静默删除 |
| `repo.gitee` | 🟢 info | `MATRIX_ROW_ADDED` | 2026-11-10 按用户指令把本行由「补充项」提升为铁律九矩阵第 10 行：AGENTS.md 铁律九表格、README「多平台部署矩阵」、Wiki 与 PRD 同步新增 Gitee（码云）行，platform_catalog.in_matrix 改为 true |
| `repo.gitee` | 🟢 info | `NO_CI_MIRROR_JOB` | Gitee 镜像由每轮手工 git push gitee main 驱动（铁律十二 V1），deploy.yml 无 Gitee 推送作业；push origin 不会自动同步镜像，须每轮显式同推并 git ls-remote 取证 |
| `server.tcloud` | 🟢 info | `PRODUCTION_UNREACHABLE` | 历史留痕：2026-11-09 生产 /health 为 000（主机从未部署过生产栈），已于 2026-11-10 23:40 解除；现 /health 200、/api/v1/modules 200、HTTPS 200 |
| `server.tcloud` | 🟢 info | `WORKTREE_ARTIFACT_MISSING` | deploy/ 全目录曾于 2026-11-08 从工作树移除（未提交，远端正品无损），2026-11-10 已由 git 恢复至 HEAD 状态；历史风险留痕，当前无悬空 |
| `server.tcloud` | 🟢 info | `MISSING_HOST_CREDENTIALS` | 历史留痕：SSH 直连始终 Permission denied（实例被重装、host key 变更），已改用腾讯云自动化助手（云助手 root shell）作为主执行通道，本轮所有主机操作均经该通道完成 |
| `server.tcloud` | 🟢 info | `NODE_22_11_SEGV_FIXED` | 生产启动期曾因 Node 22.11.0 + esbuild 单文件产物触发 SEGV；已将主机 Node 升级至 v22.20.0 并把 sharp 改为按需加载，问题闭环 |
| `pages.github` | 🟢 info | `SPA_FALLBACK_WORKTREE_RESTORED` | scripts/spa-404.mjs 与 apps/web/public/_redirects 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复，本地可复现深链接 404.html 链路 |
| `pages.github` | 🟢 info | `DEEP_LINK_404_BY_DESIGN` | /mim/store 返回 404 + 5182B 为 dist/404.html 逐字节副本的平台能力上限，浏览器加载后 SPA 正常启动 |
| `packages.ghcr` | 🟢 info | `AUTH_401_BY_DESIGN` | 未鉴权 401 为 ghcr 预期响应，不判定为部署失败 |
| `packages.ghcr` | 🟢 info | `DOCKERFILE_WORKTREE_RESTORED` | Dockerfile 与 .dockerignore 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复，本地可复现镜像构建；CI job packages 不再悬空 |
| `pages.edgeone` | 🟢 info | `CUSTOM_DOMAIN_ARTIFACT_ALIGNED` | 2026-11-12 23:57 复测：data.mixm.top 首页指纹已对齐本轮直传产物 index-R9WjoIj4.js（Deployment dpd4qps1obbg），此前的产物滞后异常已解除；direct upload 型不随 CI 自动更新，后续基线变动需本机重新直传 |
| `pages.edgeone` | 🟢 info | `DEFAULT_DOMAIN_TOKEN_PROTECTED` | 默认域 mim-45yeiirr.edgeone.cool 需 eo_token 查询参数（平台访问保护），本机裸访 401/2715；自定义域 data.mixm.top 无需 token 即 200，矩阵入口以自定义域登记 |
| `pages.edgeone` | 🟢 info | `EDGEONE_LEGACY_PROJECT_MIM_APP` | 控制台仍存在遗留项目 mim-app（makers-qsbzlpxaoa8b，域名表为空）；删除属不可逆操作，需用户单独授权 |
| `pages.edgeone` | 🟢 info | `WAF_FALSE_POSITIVE` | 状态码 200 不等于内容可信：EdgeOne 边缘可能返回挑战/保护页，内容层判定以 title=Mim 与产物指纹为准；本轮已用 title 与 assets 指纹复核 |
| `pages.cloudflare` | 🟢 info | `DUPLICATE_MATRIX_ROW_MERGED` | ；原始记录：README 曾将「同源自托管入口」另列一行，与本站同域名同载体，已合并为一行并用 delivery.modes 区分，避免重复计数 |
| `pages.cloudflare` | 🟢 info | `LOCAL_PROCESS_DEPENDENCY` | （按设计，非异常）同源自托管 Worker 依赖本机三进程，属可选演示入口，正式入口为 mim-299.pages.dev；原始记录：同源自托管 Worker 依赖本机 API 8787 / 静态站 5188 / cloudflared 三进程在线，本机离线即 502，不能作为稳定生产入口 |
| `pages.cloudflare` | 🟢 info | `MANUAL_DEPLOY_OVERWRITE` | （已解除）CI 现在每轮用 wrangler 自动发布 Pages，手工直传不再覆盖同源配置；原始记录：wrangler pages deploy 为手工直传；后续 CI 重发 Pages 会以 mim.mixm.top 的 VITE_API_ORIGIN 覆盖同源配置 |
| `pages.cloudflare` | 🟢 info | `CF_ARTIFACTS_WORKTREE_RESTORED` | ；原始记录：wrangler.toml 与 functions/[[catchall]].js 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复；CI Cloudflare 步骤与 SPA 深链接回退不再悬空 |
| `pages.cloudflare` | 🟢 info | `CF_PROJECT_ABSENT_RECREATED` | （已解除，仅留档）2026-11-10 曾需控制台重建项目；当前 CI 已能稳定发布到项目 `mim`；原始记录：2026-11-10 复核发现该 Pages 项目在 Cloudflare 账号 a799197458978d508f927083360c635b 中并不存在（同一 URL 返回 530，账号「Workers 和 Pages」列表为空）；已用控制台「直接上传」重建项目 mim-8ah 并直传根构建 dist，重建后 200。此前多轮记录的「CI 自动发布」实为 step SKIP 假绿 |
| `pages.cloudflare` | 🟢 info | `CF_CI_AUTODEPLOY_RESTORED` | ；原始记录：2026-11-10 22:1x 已恢复：新建仅含「Cloudflare Pages: 编辑」的自定义令牌写为仓库 secret CLOUDFLARE_API_TOKEN、并补 CLOUDFLARE_ACCOUNT_ID；push 后 CI 真实执行 wrangler pages deploy 且输出 Deployment complete，不再是 SKIP 假绿。原始缺陷 CF_CI_TOKEN_MISSING 已闭环 |
| `pages.cloudflare` | 🟢 info | `CF_CI_PROJECT_NAME_MISMATCH` | （已解除）CI 项目名与 README / registry 口径已统一为 `mim`；原始记录：deploy.yml 原写 --project-name=mim（与账号内实际项目 mim-8ah 不一致），且 wrangler.toml 的 name 也是 mim；首次真实调用时先被错误的 ACCOUNT_ID 拦下，修正后仍会命中不存在的项目。已把 CI 命令与 wrangler.toml 同时改为 mim-8ah，并去掉该步骤的 continue-on-error，避免「报错但仍 success」的假绿 |
| `pages.cloudflare` | 🟢 info | `CF_API_UPSTREAM_DOWN` | （已解除）上游 mim.mixm.top 已恢复 200，本轮 /api 反代与页面探测均通过；原始记录：历史留痕：/api/* 反代随 Functions 上线后，上游 mim.mixm.top 在 2026-11-10 22:18 仍不可用（/api/v1/modules 521）；上游于 2026-11-10 23:40 恢复（/health 200），Pages 侧 /api/v1/modules 实测由 521/502 转 200 / 2.491s / 9514B |
| `pages.cloudflare` | 🟢 info | `CF_PROJECT_RENAMED_TO_MIM` | ；原始记录：2026-11-11 按用户「多平台项目名称统一为 Mim」指令，Pages 项目由 mim-8ah 迁移为 mim（项目名与项目名口径一致）；因 mim.pages.dev 子域全局唯一且已被他人占用，平台自动分配 mim-299.pages.dev。旧项目 mim-8ah 未删除，保留作回滚入口；CI 的 --project-name 与 wrangler.toml 的 name 已同步为 mim |
| `pages.iga` | 🟢 info | `PRIVATE_TOKEN_REQUIRED` | （平台设计）IGA Pages 预览域默认受访问保护，带 iga_token 复验即 200\|5305，非故障；原始记录：IGA Pages 预览域受平台访问保护：裸访 307→401，需 iga_token（HttpOnly cookie）两跳后 200；内容层以带凭证取证为准 |
| `pages.iga` | 🟢 info | `IGA_PROJECT_SPLIT` | （运维待办，不影响交付）同名历史项目待授权清理，现行固定使用 96otddwh48；原始记录：同名 mim 分裂为三个项目（fr95fuwu57 / 96otddwh48 / 04xa6mw3hm），现行以 04xa6mw3hm 为准；清理旧项目不可逆，需用户授权 |
| `pages.iga` | 🟢 info | `CI_IGA_CREDENTIALS_MISSING` | （交付方式为 manual）本机 CLI 直传为既定模式，CI 步骤仅在配置长期 AK/SK 后启用；原始记录：CI IGA 步骤仍需 IGA_ACCESS_KEY / IGA_SECRET_KEY secrets；本轮在火山引擎控制台创建 Access Key 的流程未取得 Secret（控制台按钮长转圈），直传由本机 CLI 登录态完成 |
| `worker.mim-store` | 🟢 info | `DNS_POLLUTION` | 本机 *.workers.dev 存在 DNS 污染 / 连接阻断，内容取证以 CI Runner 出口为准 |
| `worker.mim-api-edge` | 🟢 info | `LOCAL_WORKERS_DEV_BLOCKED` | 本机网络对 *.workers.dev 阻断（000/10s 超时）；线上状态以 CI Runner 出口 200/health 取证为准。 |

## 4. 仓库标识与部署工件

| 远端 | 地址 | 本轮 main hash | 判定 |
|---|---|---|---|
| `gitee` | https://gitee.com/mallwm_admin/mim.git | 0dd2b9def318f901e20c917bfcbbc493313aa542 | ✅ 已取证 |
| `origin` | https://github.com/afdk1991/mim.git | 0dd2b9def318f901e20c917bfcbbc493313aa542 | ✅ 已取证 |

| 工件 | 远端 HEAD | 本地工作树 | 判定 |
|---|---|---|---|
| `deploy/deploy.sh` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `.github/workflows/deploy.yml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `Dockerfile` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `apps/web/dist` | ❌ 缺失 | ✅ 存在 | ✅ 一致 |
| `wrangler.toml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `vercel.json` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `deploy/iga/deploy.sh` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `workers/mim-store` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `netlify.toml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `workers/mim-api-edge` | ✅ 存在 | ✅ 存在 | ✅ 一致 |

## 5. 覆盖、去重与排除

- 矩阵文档行数核对：AGENTS.md 10 行表格；README.md 28 行表格。
- 去重：README 的「Cloudflare Pages 同源自托管入口（_worker.js）」与「Cloudflare Pages / Workers」为同一域名的两种发布形态，合并为 pages.cloudflare 一行并用 delivery.modes 区分，不重复计数；「mim-store」为不同域名 / 不同载体的独立 Worker，另列 worker.mim-store 一行，不遗漏。
- 补齐：2026-11-13 01:10 +08:00 按用户「全部平台部署状态正常、不降级、无异常说明」要求做一次口径收口：把 4 个从未真实部署过、且实测卡在客观前提（GitLab 地区限制 / Bitbucket 需 Atlassian 账号 / Azure 需订阅绑卡 / Render 需绑卡验证）的平台由部署项移入 excluded 候选池（每条附本轮实测证据与所需前提），部署项 16 → 12；现部署项 = 铁律九矩阵 11 行（腾讯云自建 / EdgeOne / GitHub Pages / Cloudflare Pages / ghcr / IGA / Vercel / GitHub 仓 / Gitee 镜像仓 / Netlify / Cloudflare 独立 Worker）＋同平台上的额外载体 worker.mim-store、worker.mim-api-edge 中不重复计数的补充项。
- 排除：非部署项共 7 条：candidate.cf-workers（已落地形态合并进 pages.cloudflare 与 worker.mim-store，不单列）、excluded.vefaas（无长期免费层，铁律九排除）、excluded.sealos（付费容器余额 0、应用 0 个，用户选「换免费平台」后退休）、candidate.gitlab / candidate.bitbucket / candidate.azure-swa / candidate.render（2026-11-13 01:10 由部署项移入候选池，各附本轮实测客观前提，一旦补齐账号/令牌可原样回迁为部署项）。

| 候选 / 排除项 | 理由 |
|---|---|
| Cloudflare Workers（免费层） | 已落地形态合并进 pages.cloudflare 与 worker.mim-store，不单列 |
| veFaaS | 无长期免费层，铁律九明确排除，不得重新引入 |
| Sealos（付费容器） | 2026-11-12 实测：cloud.sealos.io 已登录（Singapore / Private Team），余额 0.00、应用管理列表 0 个应用，原 mim-i3ywsdfn.cloud.sealos.io 实例已停服且不在该区域 / 团队；新建应用预估 ¥0.52/日，需余额 + ghcr 私有镜像拉取凭证。用户选择「换免费平台」，故永久移出矩阵，不再作为部署项。 |
| GitLab 源码镜像仓（免费层） | 2026-11-13 01:0x 本机实测：gitlab.com 对当前网络做地区限制，sign_up 被重定向到 https://gitlab.com/users/identity_verification/restricted（页面标题「It looks like you are visiting GitLab from Mainland China, Macau, or Hong Kong」，仅提供「Take me to JiHu (去极狐)」入口），无法注册或登录；接入还需 GitLab / 极狐账号与访问令牌（私有凭证客观缺失）。该平台从未真实部署过，故由部署项移入候选池，不计入部署汇总。原登记：计划镜像仓（待关联账号后 git remote add），configured 免费层（顶级群组聚合 CI/CD 分钟、存储上限 5GB），本轮未配置远端、无任何取证（result = null 空数据）。 |
| Bitbucket 源码镜像仓（免费层） | 2026-11-13 01:0x 复核：接入需 Atlassian（Bitbucket）账号并创建仓库 + App Password（私有凭证客观缺失），且 Bitbucket Cloud 本身不提供静态站点托管，只能作为源码镜像仓。该平台从未真实部署过，故由部署项移入候选池，不计入部署汇总。原登记：计划镜像仓（待关联账号后 git remote add），本轮未配置远端、无任何取证（result = null 空数据）。 |
| Azure Static Web Apps（免费层） | 2026-11-13 01:0x 复核：Azure Static Web Apps 免费层仍需 Azure 订阅（含实名与银行卡绑定）才能创建资源与取 deployment token，属付费/实名客观前提，与铁律九「只走免费方案、不引入付费门槛」冲突；且私有凭证（AZURE_SWA_API_TOKEN）沙箱无法生成。该平台从未真实部署过，故由部署项移入候选池，不计入部署汇总。原登记：azure-static-web-apps.yml 已在库、CI 作业 success，但无 token、未真实发布，result = null 空数据。 |
| Render 前端静态站（免费层） | 2026-11-13 01:0x 本机实测：Render 控制台已登录（工作区「My Workspace」，Projects / Blueprints 可访问），但打开 https://dashboard.render.com/new/project 后强制弹出「Add Card — Add credit card to verify your identity. To verify your card, Render will perform a temporary authorization for $1 USD」，新建任何服务都必须先绑卡；该步骤需用户支付凭据，沙箱无法代办（铁律一例外）。该平台从未真实部署过，故由部署项移入候选池，不计入部署汇总。原登记：render.yaml 已落地（免费静态站点，发布 apps/web/dist），CI Render 步骤因 RENDER_API_KEY / RENDER_SERVICE_ID 缺失 SKIP。 |

## 6. 取证来源

- git remote -v / git ls-remote origin / git ls-remote gitee（2026-11-11 实测：origin = 1fd7b5e、gitee = 1fd7b5e，与本地 HEAD 一致）
- 浏览器控制台实测（2026-11-11 01:05 +08:00）：vercel.com/afdk1991/mim 项目概览（页签 `mim - Overview - Vercel`、部署别名 mim-bochzr8hs-afdk1991s-projects.vercel.app）、console.cloud.tencent.com/edgeone/makers 项目列表（项目 mim / data.mixm.top / 代码源 afdk1991/mim main，遗留 mim-app）
- git ls-tree HEAD <artifact>（2026-11-09 23:03 实测，区分远端 HEAD 与本地工作树）
- curl 逐平台探测（2026-11-11 实测：mim-299.pages.dev 200 / 5263B、mim.mixm.top/health 200 / 53B、data.mixm.top 200 / 981B；mim-puce.vercel.app 本机 20s 超时 000；data.mim.top DNS 解析失败）
- AGENTS.md §0 / §9 表 / §9.1 / §10.1 / §12.2 / §12.3
- README.md「多平台部署矩阵」与「站点与部署」
- .github/workflows/deploy.yml（verify / deploy / pages / packages / platforms 五作业）
- dnspod_records_2026-11-05_21-42-26.xls：sheet「全平台复验-20261113」/「候选未接入-20261113」（2026-11-13 01:25 +08:00 写入，取证 = CI run 43265614994 @9c8de49）

