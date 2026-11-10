# Mim 部署汇总（结构化核对表）

- 生成时间：2026-11-10T10:59:36.219Z
- 本地 HEAD：`5372205`
- 采集模式：baseline（沿用契约取证快照）
- 单一事实源：`packages/core-domain/src/deploymentRegistry.json`（schema mim.deployment-registry.v1）

## 1. 总览

| 指标 | 数值 | 说明 |
|---|---|---|
| 矩阵平台 | 9 | 铁律九 9 个免费平台 |
| 规范部署项 | 16 | 去重后的部署仓库 + 部署项 |
| git 远端 | 2 | gitee / origin |
| CI 作业 | 5 | 其中部署作业 4 个 |
| 有取证 | 9 | 本轮存在可信取证 |
| 空数据 | 7 | result 为 null，明确标识而非填 0 |
| 异常 | 36 | 🔴 2 / 🟡 15 / 🟢 19 |
| 缺失信息 | 48 | 字段名或工件路径 |
| 工作树漂移 | 0 | 工件在远端 HEAD 存在、本地工作树缺失 |

## 2. 部署项主表（统一字段）

| 规范 ID | 仓库标识 | 平台 / 层级 | 交付链路 | 部署状态 | 部署结果 | 异常说明 | 缺失信息 |
|---|---|---|---|---|---|---|---|
| `repo.github` | github:afdk1991/mim | GitHub 仓库 / source | push — | ✅ OK | ✅ PASS — / —B | HTTPS_BLOCKED 等 1 项 | — |
| `repo.gitee` | gitee:mallwm_admin/mim | Gitee 镜像仓 / source | push — | 🟡 UNVERIFIED | 🟡 未测 — / —B | REMOTE_TIMEOUT 等 2 项 | ⚠ 2 项 |
| `server.tcloud` | github:afdk1991/mim | 腾讯云自建服务器 / production | ci deploy | 🔴 BROKEN | 🔴 FAIL 000 / 0B | PRODUCTION_UNREACHABLE 等 3 项 | ⚠ 6 项 |
| `pages.github` | github:afdk1991/mim | GitHub Pages / distribution | ci pages | ✅ OK | ✅ PASS 200 / 5182B | SPA_FALLBACK_WORKTREE_RESTORED 等 2 项 | — |
| `packages.ghcr` | ghcr:afdk1991/mim-api | GitHub Packages (ghcr) / distribution | ci packages | ✅ OK | ✅ PASS 401 / 73B | AUTH_401_BY_DESIGN 等 2 项 | ⚠ 1 项 |
| `pages.edgeone` | — | 腾讯云 EdgeOne Pages / distribution | manual — | 🟡 MANUAL | 🟡 DEGRADED 200 / 984B | WAF_FALSE_POSITIVE 等 2 项 | ⚠ 2 项 |
| `pages.cloudflare` | github:afdk1991/mim | Cloudflare Pages / Workers / distribution | ci platforms | ✅ OK | ✅ PASS 200 / 5182B | LOCAL_PROCESS_DEPENDENCY 等 4 项 | — |
| `pages.vercel` | github:afdk1991/mim | Vercel / distribution | ci platforms | 🟡 UNVERIFIED | 🔴 FAIL 000 / 0B | CI_SKIP_FALSE_GREEN 等 2 项 | ⚠ 2 项 |
| `container.sealos` | ghcr:afdk1991/mim-api | Sealos / distribution | ci platforms | ✅ OK | ✅ PASS 200 / 53B | ROOT_404_BY_DESIGN 等 2 项 | — |
| `pages.iga` | — | IGA Pages / distribution | manual platforms | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 3 项 | ⚠ 5 项 |
| `worker.mim-store` | — | Cloudflare 独立 Worker / distribution | manual — | 🟡 MANUAL | ⚪ 空数据 | EMPTY_RESULT 等 3 项 | ⚠ 5 项 |
| `repo.gitlab` | — | GitLab 仓库 / source | push — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 | ⚠ 4 项 |
| `repo.bitbucket` | — | Bitbucket 仓库 / source | push — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 | ⚠ 4 项 |
| `pages.netlify` | github:afdk1991/mim | Netlify / distribution | ci platforms | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 | ⚠ 6 项 |
| `pages.azure-swa` | github:afdk1991/mim | Azure Static Web Apps / distribution | ci — | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 | ⚠ 5 项 |
| `container.render` | github:afdk1991/mim | Render / distribution | ci platforms | 🟡 UNVERIFIED | ⚪ 空数据 | EMPTY_RESULT 等 2 项 | ⚠ 6 项 |

## 3. 异常说明明细

| 部署项 | 严重度 | 异常码 | 说明 |
|---|---|---|---|
| `repo.github` | 🟢 info | `HTTPS_BLOCKED` | github.com 网页本机 TLS 握手被阻断，仓库同步改以 git ls-remote 取证，不影响同步结论 |
| `repo.gitee` | 🔴 critical | `REMOTE_TIMEOUT` | 镜像仓本轮未取证，铁律十二 §12.2「双远端同轮全推」无法判定达成 |
| `repo.gitee` | 🟡 warning | `MATRIX_ROW_MISSING` | README「多平台部署矩阵」未列 Gitee 镜像仓行，本汇总按 §12.2 补齐 |
| `server.tcloud` | 🔴 critical | `PRODUCTION_UNREACHABLE` | 生产 /health 本轮 000，无 V2/V3/V4 线上取证，不得宣称「已上线」；本机不可达 ≠ 部署失败，但主机侧亦不可验证 |
| `server.tcloud` | 🟢 info | `WORKTREE_ARTIFACT_MISSING` | deploy/ 全目录曾于 2026-11-08 从工作树移除（未提交，远端正品无损），2026-11-10 已由 git 恢复至 HEAD 状态；历史风险留痕，当前无悬空 |
| `server.tcloud` | 🟡 warning | `MISSING_HOST_CREDENTIALS` | 无 SSH 私钥 / tccli / 管理员口令，主机侧状态（systemd / nginx / SQLite）本轮无法验证 |
| `pages.github` | 🟢 info | `SPA_FALLBACK_WORKTREE_RESTORED` | scripts/spa-404.mjs 与 apps/web/public/_redirects 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复，本地可复现深链接 404.html 链路 |
| `pages.github` | 🟢 info | `DEEP_LINK_404_BY_DESIGN` | /mim/store 返回 404 + 5182B 为 dist/404.html 逐字节副本的平台能力上限，浏览器加载后 SPA 正常启动 |
| `packages.ghcr` | 🟢 info | `AUTH_401_BY_DESIGN` | 未鉴权 401 为 ghcr 预期响应，不判定为部署失败 |
| `packages.ghcr` | 🟢 info | `DOCKERFILE_WORKTREE_RESTORED` | Dockerfile 与 .dockerignore 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复，本地可复现镜像构建；CI job packages 不再悬空 |
| `pages.edgeone` | 🟡 warning | `WAF_FALSE_POSITIVE` | 200 + 984B 为 WAF 挑战页，不等于内容正确；须复用已放行 Edge profile + 有头 CDP 复验，放行凭证会过期 |
| `pages.edgeone` | 🟢 info | `NO_CI_LINK` | 最近一次直传 Deployment dpu0n61jlos8（2026-11-08），非仓库连接，push main 不会自动刷新该站 |
| `pages.cloudflare` | 🟢 info | `DUPLICATE_MATRIX_ROW_MERGED` | README 曾将「同源自托管入口」另列一行，与本站同域名同载体，已合并为一行并用 delivery.modes 区分，避免重复计数 |
| `pages.cloudflare` | 🟡 warning | `LOCAL_PROCESS_DEPENDENCY` | 同源自托管 Worker 依赖本机 API 8787 / 静态站 5188 / cloudflared 三进程在线，本机离线即 502，不能作为稳定生产入口 |
| `pages.cloudflare` | 🟡 warning | `MANUAL_DEPLOY_OVERWRITE` | wrangler pages deploy 为手工直传；后续 CI 重发 Pages 会以 mim.mixm.top 的 VITE_API_ORIGIN 覆盖同源配置 |
| `pages.cloudflare` | 🟢 info | `CF_ARTIFACTS_WORKTREE_RESTORED` | wrangler.toml 与 functions/[[catchall]].js 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复；CI Cloudflare 步骤与 SPA 深链接回退不再悬空 |
| `pages.vercel` | 🟡 warning | `CI_SKIP_FALSE_GREEN` | README 2026-11-09 取证段载明 CI secrets 为空时该步骤 SKIP（continue-on-error: true），历史「作业 success」不等于本轮已部署 |
| `pages.vercel` | 🟢 info | `VERCEL_CONFIG_WORKTREE_RESTORED` | vercel.json 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复，本地可复现 rewrite 反代配置 |
| `container.sealos` | 🟢 info | `ROOT_404_BY_DESIGN` | 纯 API 容器未注册根路由，/ 返回 404 与 /store 返回 route GET / not found 均属设计内，不托管商城 SPA |
| `container.sealos` | 🟢 info | `SEALOS_MANIFEST_WORKTREE_RESTORED` | deploy/sealos/mim.yaml 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复；CI Sealos 步骤不再悬空 |
| `pages.iga` | 🟡 warning | `EMPTY_RESULT` | 本轮无任何探测取证（result = null 空数据），不以历史 200 冒充现状 |
| `pages.iga` | 🟡 warning | `PRIVATE_TOKEN_REQUIRED` | 入口需 iga_token 私有凭证，沙箱缺失；按铁律一如实标注未测 |
| `pages.iga` | 🟢 info | `IGA_SCRIPT_WORKTREE_RESTORED` | deploy/iga/deploy.sh 曾于 2026-11-08 从工作树移除，2026-11-10 已恢复；CI IGA 步骤不再悬空 |
| `worker.mim-store` | 🟡 warning | `EMPTY_RESULT` | 本轮未对该 Worker 单独探测（result = null 空数据），不以同源 Pages 的 200 冒充 |
| `worker.mim-store` | 🟡 warning | `DNS_POLLUTION` | README 2026-11-09 取证载明本机 *.workers.dev 被 DNS 污染（156.233.67.243、443 不通），不作国内入口 |
| `worker.mim-store` | 🟢 info | `MATRIX_ROW_MISSING` | 仅出现在 README 取证段落、矩阵表未列；因其域名与载体均不同于 pages.cloudflare，本汇总另列一行避免遗漏 |
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
| `gitee` | https://gitee.com/mallwm_admin/mim.git | — | ⚪ 未取证（spawnSync git ETIMEDOUT） |
| `origin` | https://github.com/afdk1991/mim.git | 53722055110011c440f5263b326d503f3773760f | ✅ 已取证 |

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
| `netlify.toml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `.github/workflows/azure-static-web-apps.yml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |
| `render.yaml` | ✅ 存在 | ✅ 存在 | ✅ 一致 |

## 5. 覆盖、去重与排除

- 矩阵文档行数核对：AGENTS.md 9 行表格；README.md 15 行表格。
- 去重：README 的「Cloudflare Pages 同源自托管入口（_worker.js）」与「Cloudflare Pages / Workers」为同一域名的两种发布形态，合并为 pages.cloudflare 一行并用 delivery.modes 区分，不重复计数；「mim-store」为不同域名 / 不同载体的独立 Worker，另列 worker.mim-store 一行，不遗漏。
- 补齐：相对铁律九 9 行矩阵补齐 2 项：Gitee 镜像仓（§12.2 有、README 矩阵缺）与独立 Worker mim-store（README 取证段有、矩阵表缺）。2026-11-10 用户决策「全部采用免费层」：将候选池的 GitLab / Bitbucket / Netlify / Azure Static Web Apps / Render 共 5 项提升为「已采用（免费层）」登记项，从 excluded 移入 items，状态 UNVERIFIED（待接入外部账号），不冒充已部署。
- 排除：仅保留 2 项非采用：candidate.cf-workers（已落地形态合并进 pages.cloudflare 与 worker.mim-store，不单列）与 excluded.vefaas（无长期免费层，铁律九明确排除）。Bitbucket / Render / Netlify / Azure Static Web Apps 已于 2026-11-10 改为已采用免费层。

| 候选 / 排除项 | 理由 |
|---|---|
| Cloudflare Workers（免费层） | 已落地形态合并进 pages.cloudflare 与 worker.mim-store，不单列 |
| veFaaS | 无长期免费层，铁律九明确排除，不得重新引入 |

## 6. 取证来源

- git remote -v / git ls-remote origin / git ls-remote gitee（2026-11-09 23:03 实测）
- git ls-tree HEAD <artifact>（2026-11-09 23:03 实测，区分远端 HEAD 与本地工作树）
- curl 逐平台探测（2026-11-09 23:03 实测）
- AGENTS.md §0 / §9 表 / §9.1 / §10.1 / §12.2 / §12.3
- README.md「多平台部署矩阵」与「站点与部署」
- .github/workflows/deploy.yml（verify / deploy / pages / packages / platforms 五作业）

