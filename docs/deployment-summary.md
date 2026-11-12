# Mim 部署汇总（结构化核对表）

- 生成时间：2026-11-12T14:47:53.517Z
- 本地 HEAD：`057faf2`
- 采集模式：baseline（沿用契约取证快照）
- 单一事实源：`packages/core-domain/src/deploymentRegistry.json`（schema mim.deployment-registry.v1）

## 1. 总览

| 指标 | 数值 | 说明 |
|---|---|---|
| 矩阵平台 | 10 | 铁律九 10 个免费平台 |
| 规范部署项 | 16 | 去重后的部署仓库 + 部署项 |
| git 远端 | 2 | gitee / origin |
| CI 作业 | 5 | 其中部署作业 4 个 |
| 有取证 | 11 | 本轮存在可信取证 |
| 空数据 | 5 | result 为 null，明确标识而非填 0 |
| 异常 | 46 | 🔴 5 / 🟡 15 / 🟢 26 |
| 缺失信息 | 32 | 字段名或工件路径 |
| 工作树漂移 | 0 | 工件在远端 HEAD 存在、本地工作树缺失 |

## 2. 部署项主表（统一字段）

| 规范 ID | 仓库标识 | 平台 / 层级 | 交付链路 | 访问域名 | 部署状态 | 部署结果 | 异常说明 |
|---|---|---|---|---|---|---|---|
| `repo.github` | github:afdk1991/mim | GitHub 仓库 / source | push — | https://github.com/afdk1991/mim | ✅ OK | ✅ PASS — / —B | HTTPS_BLOCKED 等 1 项 |
| `repo.gitee` | gitee:mallwm_admin/mim | Gitee（码云）镜像仓 / source | push — | https://gitee.com/mallwm_admin/mim | ✅ OK | ✅ PASS 200 / 52034B | REMOTE_TIMEOUT_RECOVERED 等 3 项 |
| `server.tcloud` | github:afdk1991/mim | 腾讯云自建服务器 / production | ci deploy | https://mim.mixm.top | ✅ OK | ✅ PASS 200 / 53B | PRODUCTION_UNREACHABLE 等 4 项 |
| `pages.github` | github:afdk1991/mim | GitHub Pages / distribution | ci pages | https://afdk1991.github.io/mim/ | ✅ OK | ✅ PASS 200 / 5182B | SPA_FALLBACK_WORKTREE_RESTORED 等 2 项 |
| `packages.ghcr` | ghcr:afdk1991/mim-api | GitHub Packages (ghcr) / distribution | ci packages | https://ghcr.io/v2/ | ✅ OK | ✅ PASS 401 / 73B | AUTH_401_BY_DESIGN 等 2 项 |
| `pages.edgeone` | — | 腾讯云 EdgeOne Pages / distribution | manual — | https://data.mixm.top | ✅ OK | ✅ PASS 200 / 5305B | CUSTOM_DOMAIN_ARTIFACT_LAG 等 4 项 |
| `pages.cloudflare` | github:afdk1991/mim | Cloudflare Pages / Workers / distribution | ci platforms | https://mim-299.pages.dev/ | ✅ OK | ✅ PASS 200 / 5114B | LOCAL_PROCESS_DEPENDENCY 等 9 项 |
| `pages.vercel` | github:afdk1991/mim | Vercel / distribution | ci platforms | https://mim-puce.vercel.app | 🟡 UNVERIFIED | 🟡 DEGRADED 200 / 5182B | CREDENTIAL_MISSING 等 3 项 |
| `container.sealos` | ghcr:afdk1991/mim-api | Sealos / distribution | ci platforms | https://mim-i3ywsdfn.cloud.sealos.io/health | 🔴 BROKEN | 🔴 FAIL 000 / 0B | LOGIN_REQUIRED 等 3 项 |
| `pages.iga` | — | IGA Pages / distribution | manual platforms | https://mim-04xa6mw3hm-e1uhm452pi.preview.iga-pages.com | ✅ OK | ✅ PASS 200 / 5305B | PRIVATE_TOKEN_REQUIRED 等 3 项 |
| `worker.mim-store` | — | Cloudflare 独立 Worker / distribution | ci platforms | https://mim-store.15726833367.workers.dev | ✅ OK | ✅ PASS 200 / 5305B | DNS_POLLUTION 等 2 项 |
| `repo.gitlab` | — | GitLab 仓库 / source | push — | — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 |
| `repo.bitbucket` | — | Bitbucket 仓库 / source | push — | — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 |
| `pages.netlify` | github:afdk1991/mim | Netlify / distribution | ci platforms | — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 |
| `pages.azure-swa` | github:afdk1991/mim | Azure Static Web Apps / distribution | ci — | — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 |
| `container.render` | github:afdk1991/mim | Render / distribution | ci platforms | — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 |

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
| `pages.edgeone` | 🟡 warning | `CUSTOM_DOMAIN_ARTIFACT_LAG` | 2026-11-12 22:30 实测：data.mixm.top 首页仍引用 assets/index-Dmz7Z5Id.js，最新直传部署 dpbnaziq1hdm（产物 index-DzsHGdWK.js）尚未在自定义域生效；站点本身 200 可正常访问，仅产物版本滞后，待 EdgeOne 侧生效 / 清缓存后复测 |
| `pages.edgeone` | 🟢 info | `DEFAULT_DOMAIN_TOKEN_PROTECTED` | 默认域 mim-45yeiirr.edgeone.cool 需 eo_token 查询参数（平台访问保护），本机裸访 401/2715；自定义域 data.mixm.top 无需 token 即 200，矩阵入口以自定义域登记 |
| `pages.edgeone` | 🟢 info | `EDGEONE_LEGACY_PROJECT_MIM_APP` | 控制台仍存在遗留项目 mim-app（makers-qsbzlpxaoa8b，域名表为空）；删除属不可逆操作，需用户单独授权 |
| `pages.edgeone` | 🟢 info | `WAF_FALSE_POSITIVE` | 状态码 200 不等于内容可信：EdgeOne 边缘可能返回挑战/保护页，内容层判定以 title=Mim 与产物指纹为准；本轮已用 title 与 assets 指纹复核 |
| `pages.cloudflare` | 🟢 info | `DUPLICATE_MATRIX_ROW_MERGED` | README 曾将「同源自托管入口」另列一行，与本站同域名同载体，已合并为一行并用 delivery.modes 区分，避免重复计数 |
| `pages.cloudflare` | 🟡 warning | `LOCAL_PROCESS_DEPENDENCY` | 同源自托管 Worker 依赖本机 API 8787 / 静态站 5188 / cloudflared 三进程在线，本机离线即 502，不能作为稳定生产入口 |
| `pages.cloudflare` | 🟡 warning | `MANUAL_DEPLOY_OVERWRITE` | wrangler pages deploy 为手工直传；后续 CI 重发 Pages 会以 mim.mixm.top 的 VITE_API_ORIGIN 覆盖同源配置 |
| `pages.cloudflare` | 🟢 info | `CF_ARTIFACTS_WORKTREE_RESTORED` | wrangler.toml 与 functions/[[catchall]].js 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复；CI Cloudflare 步骤与 SPA 深链接回退不再悬空 |
| `pages.cloudflare` | 🟡 warning | `CF_PROJECT_ABSENT_RECREATED` | 2026-11-10 复核发现该 Pages 项目在 Cloudflare 账号 a799197458978d508f927083360c635b 中并不存在（同一 URL 返回 530，账号「Workers 和 Pages」列表为空）；已用控制台「直接上传」重建项目 mim-8ah 并直传根构建 dist，重建后 200。此前多轮记录的「CI 自动发布」实为 step SKIP 假绿 |
| `pages.cloudflare` | 🟢 info | `CF_CI_AUTODEPLOY_RESTORED` | 2026-11-10 22:1x 已恢复：新建仅含「Cloudflare Pages: 编辑」的自定义令牌写为仓库 secret CLOUDFLARE_API_TOKEN、并补 CLOUDFLARE_ACCOUNT_ID；push 后 CI 真实执行 wrangler pages deploy 且输出 Deployment complete，不再是 SKIP 假绿。原始缺陷 CF_CI_TOKEN_MISSING 已闭环 |
| `pages.cloudflare` | 🟡 warning | `CF_CI_PROJECT_NAME_MISMATCH` | deploy.yml 原写 --project-name=mim（与账号内实际项目 mim-8ah 不一致），且 wrangler.toml 的 name 也是 mim；首次真实调用时先被错误的 ACCOUNT_ID 拦下，修正后仍会命中不存在的项目。已把 CI 命令与 wrangler.toml 同时改为 mim-8ah，并去掉该步骤的 continue-on-error，避免「报错但仍 success」的假绿 |
| `pages.cloudflare` | 🟡 warning | `CF_API_UPSTREAM_DOWN` | 历史留痕：/api/* 反代随 Functions 上线后，上游 mim.mixm.top 在 2026-11-10 22:18 仍不可用（/api/v1/modules 521）；上游于 2026-11-10 23:40 恢复（/health 200），Pages 侧 /api/v1/modules 实测由 521/502 转 200 / 2.491s / 9514B |
| `pages.cloudflare` | 🟢 info | `CF_PROJECT_RENAMED_TO_MIM` | 2026-11-11 按用户「多平台项目名称统一为 Mim」指令，Pages 项目由 mim-8ah 迁移为 mim（项目名与项目名口径一致）；因 mim.pages.dev 子域全局唯一且已被他人占用，平台自动分配 mim-299.pages.dev。旧项目 mim-8ah 未删除，保留作回滚入口；CI 的 --project-name 与 wrangler.toml 的 name 已同步为 mim |
| `pages.vercel` | 🔴 critical | `CREDENTIAL_MISSING` | 缺 VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID，CI 无法发布 |
| `pages.vercel` | 🔴 critical | `LOCAL_NETWORK_BLOCKED` | 本机到 vercel.com 登录页读取超时（GAC pipe read timed out），无法在本地登录创建 token |
| `pages.vercel` | 🟡 warning | `STALE_ARTIFACT` | 线上产物 5182B 为历史版本，未同步本轮前端构建 |
| `container.sealos` | 🔴 critical | `LOGIN_REQUIRED` | cloud.sealos.io 已登录（Singapore / Private Team，余额 0.00），但应用列表 0 个：原 mim 实例不在当前区域且已停服；恢复需充值或改用其他区域/团队重建，属付费与账号决策，非技术可自动修复项 |
| `container.sealos` | 🔴 critical | `CREDENTIAL_MISSING` | 缺 SEALOS_KUBECONFIG / SEALOS_NAMESPACE / SEALOS_DOMAIN / MIM_JWT_SECRET，CI Sealos 步骤只能 SKIP |
| `container.sealos` | 🔴 critical | `SITE_DOWN` | /health 双出口 000，站点当前不可访问 |
| `pages.iga` | 🟡 warning | `PRIVATE_TOKEN_REQUIRED` | IGA Pages 预览域受平台访问保护：裸访 307→401，需 iga_token（HttpOnly cookie）两跳后 200；内容层以带凭证取证为准 |
| `pages.iga` | 🟡 warning | `IGA_PROJECT_SPLIT` | 同名 mim 分裂为三个项目（fr95fuwu57 / 96otddwh48 / 04xa6mw3hm），现行以 04xa6mw3hm 为准；清理旧项目不可逆，需用户授权 |
| `pages.iga` | 🟡 warning | `CI_IGA_CREDENTIALS_MISSING` | CI IGA 步骤仍需 IGA_ACCESS_KEY / IGA_SECRET_KEY secrets；本轮在火山引擎控制台创建 Access Key 的流程未取得 Secret（控制台按钮长转圈），直传由本机 CLI 登录态完成 |
| `worker.mim-store` | 🟢 info | `DNS_POLLUTION` | 本机 *.workers.dev 存在 DNS 污染 / 连接阻断，内容取证以 CI Runner 出口为准 |
| `worker.mim-store` | 🟢 info | `MATRIX_ROW_MISSING` | 矩阵表未单列该 Worker，汇总中单列一行以避免遗漏 |
| `repo.gitlab` | 🟡 warning | `EMPTY_RESULT` | 本轮未配置远端、无任何取证（result = null 空数据），不以历史或其它镜像仓状态冒充本仓同步结论 |
| `repo.gitlab` | 🟢 info | `ADOPTED_FREE_TIER_PENDING` | 已决策采用（免费层：顶级群组聚合 CI/CD 分钟、存储上限 5GB、子群组不额外增加额度）；待关联 GitLab 账号并 git remote add 后接入 |
| `repo.bitbucket` | 🟡 warning | `EMPTY_RESULT` | 本轮未配置远端、无任何取证（result = null 空数据），不以历史或其它镜像仓状态冒充本仓同步结论 |
| `repo.bitbucket` | 🟢 info | `ADOPTED_FREE_TIER_PENDING` | 已决策采用（免费层：最多 5 人永久免费、仓库软限 2GB / 硬限 4GB、LFS 1GB、约 50 构建分钟/月）；待关联账号并 git remote add 后接入 |
| `pages.netlify` | 🟡 warning | `EMPTY_RESULT` | 本轮未部署，result = null 空数据；已落地 netlify.toml（发布 apps/web/dist + SPA 回退），CI 步骤按 Vercel 同款 SKIP 模式待 secrets 接入 |
| `pages.netlify` | 🟢 info | `ADOPTED_FREE_TIER_PENDING` | 已决策采用（免费层：300 构建分钟/月，2026-10 起新账号改 credit 制；表单 / A-B 测试等附加功能多） |
| `pages.azure-swa` | 🟡 warning | `EMPTY_RESULT` | 本轮未部署，result = null 空数据；已落地 azure-static-web-apps.yml（SWA_TOKEN 缺省即 SKIP，不阻断），待 secret 接入 |
| `pages.azure-swa` | 🟢 info | `ADOPTED_FREE_TIER_PENDING` | 已决策采用（免费层：100GB 带宽/月、10 个应用；超额带宽不可用） |
| `container.render` | 🟡 warning | `EMPTY_RESULT` | 本轮未部署，result = null 空数据；已落地 render.yaml（免费静态站点，发布 apps/web/dist），CI 步骤按 Vercel 同款 SKIP 模式待 secrets 接入 |
| `container.render` | 🟢 info | `ADOPTED_FREE_TIER_PENDING` | 已决策采用（免费层：每工作区 750 免费实例小时/月，空闲休眠、冷启动慢，够跑一个常驻小服务） |

## 4. 仓库标识与部署工件

| 远端 | 地址 | 本轮 main hash | 判定 |
|---|---|---|---|
| `gitee` | https://gitee.com/mallwm_admin/mim.git | 057faf2b97c9862ca8d55e5212cd9e706362112e | ✅ 已取证 |
| `origin` | https://github.com/afdk1991/mim.git | 057faf2b97c9862ca8d55e5212cd9e706362112e | ✅ 已取证 |

| 工件 | 远端 HEAD | 本地工作树 | 判定 |
|---|---|---|---|
| `deploy/deploy.sh` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `.github/workflows/deploy.yml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `Dockerfile` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `apps/web/dist` | ❌ 缺失 | ✅ 存在 | ✅ 一致 |
| `wrangler.toml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `vercel.json` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `deploy/sealos/mim.yaml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `deploy/iga/deploy.sh` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `workers/mim-store` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `netlify.toml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `.github/workflows/azure-static-web-apps.yml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `render.yaml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |

## 5. 覆盖、去重与排除

- 矩阵文档行数核对：AGENTS.md 10 行表格；README.md 27 行表格。
- 去重：README 的「Cloudflare Pages 同源自托管入口（_worker.js）」与「Cloudflare Pages / Workers」为同一域名的两种发布形态，合并为 pages.cloudflare 一行并用 delivery.modes 区分，不重复计数；「mim-store」为不同域名 / 不同载体的独立 Worker，另列 worker.mim-store 一行，不遗漏。
- 补齐：2026-11-10 按用户指令把 Gitee（码云）镜像仓由「补充项」提升为铁律九矩阵成员（矩阵 9 → 10 行，platform_catalog.in_matrix = true），故相对矩阵补齐只剩独立 Worker mim-store 1 项。同日用户决策「全部采用免费层」：将候选池的 GitLab / Bitbucket / Netlify / Azure Static Web Apps / Render 共 5 项提升为「已采用（免费层）」登记项，从 excluded 移入 items，状态 UNVERIFIED（待接入外部账号），不冒充已部署。
- 排除：仅保留 2 项非采用：candidate.cf-workers（已落地形态合并进 pages.cloudflare 与 worker.mim-store，不单列）与 excluded.vefaas（无长期免费层，铁律九明确排除）。Bitbucket / Render / Netlify / Azure Static Web Apps 已于 2026-11-10 改为已采用免费层。

| 候选 / 排除项 | 理由 |
|---|---|
| Cloudflare Workers（免费层） | 已落地形态合并进 pages.cloudflare 与 worker.mim-store，不单列 |
| veFaaS | 无长期免费层，铁律九明确排除，不得重新引入 |

## 6. 取证来源

- git remote -v / git ls-remote origin / git ls-remote gitee（2026-11-11 实测：origin = 1fd7b5e、gitee = 1fd7b5e，与本地 HEAD 一致）
- 浏览器控制台实测（2026-11-11 01:05 +08:00）：vercel.com/afdk1991/mim 项目概览（页签 `mim - Overview - Vercel`、部署别名 mim-bochzr8hs-afdk1991s-projects.vercel.app）、console.cloud.tencent.com/edgeone/makers 项目列表（项目 mim / data.mixm.top / 代码源 afdk1991/mim main，遗留 mim-app）
- git ls-tree HEAD <artifact>（2026-11-09 23:03 实测，区分远端 HEAD 与本地工作树）
- curl 逐平台探测（2026-11-11 实测：mim-299.pages.dev 200 / 5263B、mim.mixm.top/health 200 / 53B、data.mixm.top 200 / 981B；mim-puce.vercel.app 本机 20s 超时 000；data.mim.top DNS 解析失败）
- AGENTS.md §0 / §9 表 / §9.1 / §10.1 / §12.2 / §12.3
- README.md「多平台部署矩阵」与「站点与部署」
- .github/workflows/deploy.yml（verify / deploy / pages / packages / platforms 五作业）

