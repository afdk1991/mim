# Mim 自托管配套：监控 / 日志 / 备份 / 对象存储 / CI / 数据库托管免费层调研

- 检索日期基准：**2026-10-29（UTC+8，中国宁波）**
- 项目画像：React 18 + TS 前端 / node:http 零框架后端（端口 8787）/ PostgreSQL / GitHub Actions + 自有宿主机（systemd + nginx + PG）部署，**无 Docker**；已有 `/api/storage/*` 自研上传、`.edgeone` 部署目录、`worker/`（Cloudflare Workers 边缘层）
- 口径：所有免费额度均以 **2026-10-29 当天官方定价页/官方文档** 为准；标注「已核实官方」= 直接来自官网定价页/官方文档；标注「第三方称」= 仅见第三方文章，未在官方页直接核到。
- 优先级定义：**立即用** = 零成本、接入半天内、解决真实缺口；**值得评估** = 有价值但需先做小范围 POC；**仅参考** = 对 Mim 主路线不直接适用。

---

## 1. 健康检查 / 可用性监控

| 资源 | 官网/定价页 URL | 现行免费额度（2026-10-29） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| UptimeRobot | https://uptimerobot.com/pricing/ | Free 档：**50 个监控器、5 分钟间隔**、基础状态页（已核实官方） | 高：外部探活 `https://你的域名` + `/api/health`，国内可访问性一般但免费额度大 | 注册即用，5 分钟配完 | **立即用** |
| Better Stack（Uptime+日志+错误追踪一体） | https://betterstack.com/pricing/ | Free 档：**10 个监控器+10 个心跳（Cron）+1 个状态页**；另含 10 万异常/月、5000 session replay、3GB 日志（保留 3 天）、30GB 指标（已核实官方） | 高：可同时覆盖 Mim 的「外部可用性 + 备份任务心跳告警」，一套 SDK 前端 SPA 与后端 node 都能接 | 注册即用；日志/错误接 SDK 约半天 | **立即用**（备份心跳尤其推荐） |
| healthchecks.io（开源可自托管，BSD 类） | https://healthchecks.io/ | 官方托管免费：**20 个 checks**（邮箱/webhook 告警）；非盈利/开源项目 Business 档可免费申请（已核实官方） | 高：专为「cron 备份任务没跑」设计，与 Mim 的 pg_dump timer 场景完全对口；可自托管（Python/Django，非 Docker 亦可跑） | 托管版注册即用；自托管需 Python 环境 | **立即用** |
| Uptime Kuma（MIT，自托管） | https://github.com/louislam/uptime-kuma | 自托管完全免费；无 Docker 安装：`git clone` + Node.js ≥20.4 + `npm run setup` + pm2/systemd 托管（官方文档与 pkg.go.dev 环境说明均列 Node 直装路径，已核实官方） | 高：与 Mim「无 Docker、宿主机 systemd」路线一致；数据不出本机，国内访问无墙问题 | 需要在宿主机多跑一个 Node 服务（占 ~100-200MB 内存），约 1 小时 | **值得评估**（若不想把可用性数据交给海外 SaaS） |

## 2. 错误追踪

| 资源 | 官网/定价页 URL | 现行免费额度（2026-10-29） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Sentry（Developer Free） | https://sentry.io/pricing/ | Free 档：**1 个用户、5k errors/月、5GB 日志、5GB 应用指标、5M spans、50 session replay、1 个 uptime 监控、1 个 cron 监控、1GB 附件、30 天回看**（已核实官方，2026-10-29 直接抓取定价页） | 高：前端 SPA 用 `@sentry/browser`、后端 node:http 用 `@sentry/node`，均为官方 SDK | 接入约 1-2 小时；数据出境注意隐私最小化 | **立即用** |
| Sentry 自托管 | https://github.com/getsentry/self-hosted | 软件本身免费 | **不匹配**：官方自托管发行方式为 Docker Compose 全家桶（十几个容器），Mim 无 Docker 宿主机硬上代价过大 | 高（需 Docker 或手工拼装 10+ 服务） | 不建议（见文末清单） |
| GlitchTip（BSD，Sentry SDK 兼容） | https://glitchtip.com/pricing/ | 官方托管 Free：**1,000 events/月**；自托管完全免费（已核实官方） | 中：错误模型与 Sentry SDK 兼容，Mim 前端可复用同一类上报；但官方安装文档主推 Docker Compose，手工 Python+Postgres 直装可行但无官方支持路径 | 托管版 1k events/月偏小；自托管需手工排依赖 | **值得评估**（仅当 Sentry 免费额度 5k errors 不够或想完全自托管时） |

## 3. 指标与日志

| 资源 | 官网/定价页 URL | 现行免费额度（2026-10-29） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Grafana Cloud Free | https://grafana.com/pricing/ | **10k Prometheus 活跃指标序列、50GB 日志/月、50GB traces/月、50GB profiles、100k 次 Synthetic 检查、500 VUh k6、50k 前端 session、保留 14 天、3 个活跃用户**（已核实官方） | 高：宿主机 node_exporter 指标 + Mim 后端 metrics 直接 Remote Write 上去，不用自建 Grafana 服务器 | 注册账号 + 装 agent，约 1 小时 | **立即用**（替代自建全套监控的最快路径） |
| Prometheus + node_exporter + Alertmanager（Apache-2.0，自托管） | https://prometheus.io/download/ | 自托管完全免费；均为**单静态二进制**，无 Docker，配 systemd unit 即可 | 高：与 Mim 宿主机路线 100% 匹配；数据本地留存，适合国内网络 | 二进制下载+unit 文件，约 1-2 小时；长期需关注内存占用 | **值得评估**（与 Grafana Cloud 二选一：想数据不出本机就自建） |
| Loki + Promtail（Apache-2.0，自托管） | https://github.com/grafana/loki/releases | 自托管完全免费；官方 releases 提供 Linux 二进制压缩包（含 loki/promtail），非 Docker 可运行 | 中高：配合上面自建 Prometheus 时一起上，统一在本地 Grafana 看日志 | 约 1-2 小时；单二进制但配置项多 | **值得评估**（仅当选了自建 Prometheus 路线时配套使用） |

## 4. 备份

| 资源 | 官网/定价页 URL | 现行免费额度（2026-10-29） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| pg_dump + systemd timer（PostgreSQL 自带） | https://www.postgresql.org/docs/current/app-pgdump.html | 免费（随 PG 发行） | 高：Mim 已有 systemd 宿主机，`pg_dump -Fc` + timer + 保留策略，10 行脚本 | 几乎为零 | **立即用** |
| restic（BSD-2-Clause） | https://github.com/restic/restic | 自托管/任意后端免费；客户端单二进制 | 高：AES-CTR 加密后再传远端，支持 B2/R2/S3/WebDAV 等任意后端，去重压缩 | 约 1 小时（含首次全量备份基线） | **立即用** |
| rclone（MIT） | https://rclone.org/ | 免费开源，单二进制；支持 70+ 存储后端（B2、R2、COS、OSS、SFTP……） | 高：作为「备份到远端」的传输层；Mim 的 `/api/storage/*` 本地目录也可用它镜像到对象存储 | 约半小时（配一次 remote） | **立即用** |
| BorgBackup（BSD-3-Clause） | https://borgbackup.readthedocs.io/ | 免费开源 | 中：与 restic 功能高度重叠，二选一即可；restic 后端兼容性更好 | 同 restic | 仅参考（与 restic 重复） |
| Backblaze B2 免费层 | https://www.backblaze.com/cloud-storage（计费说明 https://help.backblaze.com/hc/en-us/articles/217667478 ） | **前 10GB 存储永久免费**；超出约 $6/TB·月；每日前 1GB 下载免费、出口流量有免费额度（2026 年官方帮助页与第三方核价均确认 10GB 免费仍在，已核实官方） | 高：作为 restic/rclone 的异地备份落点；国内访问速度一般但胜在便宜、S3 兼容 | 注册账号+建 bucket，约半小时 | **立即用**（异地备份首选之一） |

## 5. 对象存储（对照 Mim `/api/storage/*`）

| 资源 | 官网/定价页 URL | 现行免费额度（2026-10-29） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Cloudflare R2 | https://developers.cloudflare.com/r2/pricing/ | **免费层：10GB 存储·月、Class A 操作 100 万次/月、Class B 操作 1000 万次/月，且出口流量永久免费**（已核实官方；Mim 已有 worker/ Cloudflare 生态，同一账号开通即可） | 高：无出口费 + 已有 CF 生态 + Workers 可直接读写；国内访问 CF 节点速度尚可 | 约 1 小时（建 bucket、改 `/api/storage/*` 落盘为 S3 SDK） | **立即用**（若 `/api/storage/*` 文件量增长快，R2 免费层是性价比最高的落点） |
| MinIO（AGPL-3.0，自托管 S3） | https://min.io/docs/minio/linux/index.html | 软件免费；**官方提供 Linux 单二进制直装（`wget dl.min.io/.../minio`），无 Docker 亦可跑 + systemd**（已核实官方） | 中：可替代本地磁盘做 S3 接口存储，但 AGPL-3.0 对对外提供网络服务的 Mim 有传染性要求（需开源修改），且与宿主机磁盘方案相比无增量价值 | 约 1 小时部署；许可证需法务自查 | **仅参考**（除非 Mim 未来要对外卖存储服务） |
| 腾讯云 COS（新客免费包） | https://www.tencentcloud.com/document/product/436/6240 | 新用户：**50GB 标准存储 × 6 个月**（到期后按量付费，非永久免费；请求费与外网下行流量不在包内）（已核实官方） | 中高：国内访问最快、备案域名直挂 CDN 友好；但 6 个月后收费 | 约 1 小时 | **值得评估**（文件主要给国内用户下载时优于 R2） |
| 阿里云 OSS（新客免费试用） | https://help.aliyun.com/zh/oss/free-quota-for-new-users | 新用户：**标准存储 20GB × 3 个月 + 外网下行 2GB + 请求 20 万次**（已核实官方；同为到期后按量付费） | 中：额度比 COS 小且短，国内网络体验与 COS 相当 | 约 1 小时 | **仅参考**（不如 COS 新客包） |
| 保留本地磁盘（现状 `/api/storage/*`） | — | 免费 | 高：零迁移成本；缺点是无异地冗余、磁盘坏即丢 | 零 | **维持现状，同时开启第 4 节备份兜底** |

## 6. CI 免费额度（GitHub/Gitee/GitLab）

| 资源 | 官网/定价页 URL | 现行免费额度（2026-10-29） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| GitHub Actions（云 runner，私有仓库） | https://docs.github.com/en/billing/concepts/product-billing/github-actions | **GitHub Free 个人账户：私有仓库 2,000 分钟/月**；公开仓库不限分钟（已核实官方，GitHub Plans 文档确认） | 高：Mim 已有 `.github/` 在用；前端 `npm ci && vite build && vitest` 一次约 3-6 分钟，2,000 分钟/月足够日提交 | 零 | **立即用** |
| GitHub Actions 自托管 runner（Mim 自有宿主机） | https://docs.github.com/en/actions/hosting-your-own-runners | 自托管 runner **不消耗分钟额度、不限次数**，免费 | 高：Mim 部署本来就在自有宿主机上，装一个 runner agent 后 CI 直接在本机跑（可顺带做部署）；缺点是要自己维护 agent 安全与版本 | 约 1 小时安装；需管控本机权限 | **值得评估**（用量超 2,000 分钟后再上不迟） |
| Gitee Go | https://help.gitee.com/gitee-go/price/ | **单个仓库 200 分钟免费构建时长（永久）+ 个人/组织每月 500 分钟免费额度自动到账**（已核实官方帮助中心） | 高：Mim 已有 `.gitee/`；国内构建速度远快于 GitHub 云 runner，适合做国内镜像仓的流水线兜底 | 约半小时 | **值得评估**（作为国内构建通道） |
| GitLab.com CI（含极狐 JihuLab.com） | https://docs.gitlab.com/ci/pipelines/compute_minutes/ | Free 档：**400 compute 分钟/月（按顶级命名空间）**；自托管 runner 不限量免费（已核实官方；极狐中文站同口径 400 分钟） | 中：额度只有 GitHub 的 1/5；Mim 现有生态在 GitHub/Gitee，迁移收益低 | — | 仅参考 |
| 腾讯云 Codeup / AtomGit / CNB | — | 本轮检索被平台限制，未拿到官方定价页现行数字 | 低：均面向企业/团队售卖，个人免费额度长期不稳定 | — | 不建议（见文末清单） |

## 7. 数据库托管免费层（仅评估，Mim 已自托管 PG）

| 资源 | 官网/定价页 URL | 现行免费额度（2026-10-29） | 对 Mim 是否值得 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Neon（Serverless Postgres） | https://neon.tech/pricing | Free：**最多 100 个项目、每项目 100 CU-小时/月、每项目 0.5GB 存储、空闲 5 分钟缩容到零**（已核实官方） | 值得：可作为**开发环境副本 / CI 集成测试库 / 异地只读备份目标**（从自托管 pg_dump 定期灌一份）；不能当生产 | 约半小时 | **值得评估** |
| Supabase（Postgres 托管） | https://supabase.com/pricing | Free：**每活跃项目 500MB 数据库、Nano 共享计算免费、7 天无活动自动暂停、5GB 出口**（已核实官方） | 仅参考：500MB 比 Neon 还小且会暂停；Mim 已有 selfhosted-baas-blueprint 设计，未来真要用 BaaS 再回来开 | 约半小时 | 仅参考 |
| TiDB Cloud Starter（MySQL 兼容） | https://www.pingcap.com/pricing/ | 每组织（最多 5 实例）：**25GiB 行存 + 25GiB 列存 + 2.5 亿 RU/月**（已核实官方） | 不匹配：MySQL 协议，与 Mim 的 PG 体系不通；除非未来拆 TiDB 子项目 | — | 不建议（见文末清单） |
| PlanetScale（MySQL） | https://planetscale.com/docs/plans/hobby-plan-deprecation-faq | **Hobby 免费档已于 2024 年下线，新库无法创建，现存库过期自动休眠**（已核实官方 deprecation FAQ） | 不适用：无免费层，且 MySQL 与 Mim 的 PG 体系不通 | — | 不建议（见文末清单） |

---

## 8. 不建议引入清单（含原因）

| 项目 | 原因 |
|---|---|
| Sentry 自托管（Docker Compose 版） | 官方发行方式是 10+ 容器的 Docker Compose 全家桶，Mim 宿主机无 Docker，强行手搓等于自建一套监控平台，维护成本远超 Sentry Developer Free（5k errors/月） |
| GlitchTip 自托管（除非走托管 Free） | 官方安装文档主推 Docker Compose；手工 Python+Postgres 直装无官方支持，与 Mim 无 Docker 路线不匹配；托管 Free 仅 1,000 events/月，对生产偏小 |
| PlanetScale | 官方 Hobby 免费档已下线（2024 年起），且 MySQL 与 Mim 的 PostgreSQL 体系不兼容 |
| TiDB Cloud Starter | 免费额度虽大（25GiB+250M RU），但 MySQL 兼容、与 Mim 的 PG 技术栈不通，对 Mim 是负资产 |
| 腾讯云 Codeup / AtomGit / CNB 免费 CI | 官方定价页本轮未能核实到稳定数字，且这三家免费额度历史上频繁调整、面向企业售卖；Mim 已有 GitHub Actions（2,000 分钟）+ Gitee Go（500+200 分钟），边际收益低 |
| BorgBackup | 与 restic 功能重叠，restic 后端兼容性（B2/R2/S3）更好，二选一即可，无需同时引入 |
| 阿里云 OSS 新客包 | 与腾讯云 COS 新客包（50GB×6 个月）相比额度更小（20GB×3 个月），国内场景选 COS 即可 |
| GitLab.com CI | 免费 400 分钟/月仅为 GitHub Actions 的 1/5，Mim 代码与流水线已在 GitHub/Gitee，迁移无收益 |

---

## 9. 本轮来源清单（去重后，全部 2026-10-29 当天检索）

1. UptimeRobot Pricing — https://uptimerobot.com/pricing/
2. UptimeRobot Knowledge Hub（Free 档 50 monitors/5 min）— https://uptimerobot.com/knowledge-hub/monitoring/what-is-uptimerobot/
3. Better Stack Pricing（Free 档全量额度）— https://betterstack.com/pricing/
4. healthchecks.io 首页（20 checks free）— https://healthchecks.io/
5. healthchecks.io Sentry 对比文档（开源可自托管说明）— https://healthchecks.io/docs/healthchecks_sentry_comparison/
6. Uptime Kuma GitHub（Node.js ≥20.4 / pm2 直装）— https://github.com/louislam/uptime-kuma
7. Sentry Pricing 官方页（Developer Free：5k errors、5GB logs、1 user 等）— https://sentry.io/pricing/
8. GlitchTip Pricing（托管 Free 1,000 events/月）— https://glitchtip.com/pricing/
9. GlitchTip Install 文档（官方主推 Docker Compose）— https://glitchtip.com/documentation/install/
10. Grafana Pricing（Free：10k metrics、50GB logs/traces/profiles、14 天保留、3 用户）— https://grafana.com/pricing/
11. Grafana Cloud Sign-up 页（Free 档全量数字）— https://grafana.com/auth/
12. Prometheus Downloads（静态二进制）— https://prometheus.io/download/
13. Grafana Loki Releases（Linux 二进制）— https://github.com/grafana/loki/releases
14. PostgreSQL pg_dump 文档 — https://www.postgresql.org/docs/current/app-pgdump.html
15. restic GitHub（BSD-2）— https://github.com/restic/restic
16. rclone 官网（MIT、70+ 后端）— https://rclone.org/
17. BorgBackup 文档（BSD-3）— https://borgbackup.readthedocs.io/
18. Backblaze B2 Pricing 帮助（前 10GB 永久免费）— https://help.backblaze.com/hc/en-us/articles/217667478-Understanding-B2-Pricing-Structure
19. Cloudflare R2 Pricing 文档（10GB + 100 万 Class A + 1000 万 Class B）— https://developers.cloudflare.com/r2/pricing/
20. Cloudflare R2 产品页（无出口费）— https://www.cloudflare.com/developer-platform/products/r2/
21. MinIO Linux 安装文档（单二进制直装、AGPLv3）— https://min.io/docs/minio/linux/index.html
22. 腾讯云 COS 免费额度文档（新用户 50GB×6 个月）— https://www.tencentcloud.com/document/product/436/6240
23. 阿里云 OSS 新用户免费试用额度（20GB×3 个月+2GB 下行+20 万请求）— https://help.aliyun.com/zh/oss/free-quota-for-new-users
24. GitHub Actions Billing 文档 — https://docs.github.com/en/billing/concepts/product-billing/github-actions
25. GitHub Plans 文档（Free：2,000 Actions 分钟/月）— https://docs.github.com/en/get-started/learning-about-github/githubs-plans
26. Gitee Go 产品定价帮助（200 分钟/仓库永久 + 500 分钟/月）— https://help.gitee.com/gitee-go/price/
27. GitLab Compute Minutes 文档（Free 400 分钟/月）— https://docs.gitlab.com/ci/pipelines/compute_minutes/
28. 极狐 GitLab 计算分钟文档（同 400 分钟口径）— https://gitlab.cn/docs/jh/ci/pipelines/compute_minutes/
29. Neon Pricing 官方页（Free：100 projects、100 CU-hr/项目、0.5GB/项目）— https://neon.tech/pricing
30. Supabase Pricing — https://supabase.com/pricing
31. Supabase Billing 文档（Free 500MB/活跃项目、Nano $0）— https://supabase.com/docs/guides/platform/org-based-billing
32. PlanetScale Hobby 档下线 FAQ — https://planetscale.com/docs/plans/hobby-plan-deprecation-faq
33. TiDB Cloud Pricing（Starter 免费 25GiB+25GiB+250M RU/组织）— https://www.pingcap.com/pricing/

> 备注：腾讯云 Codeup / AtomGit / CNB 的官方定价页本轮受搜索限制未取得数字，已在「不建议引入清单」标注，建议落地前人工复核一次。
