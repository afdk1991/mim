# Mim 开源同类项目参考 与 部署/网络免费资源调研清单

- 调研基准日期：**2026-10-29（UTC+8）**
- 调研对象：Mim（React 18 + TS / node:http 零框架后端 / PostgreSQL / 无 Docker 自托管 / GitHub Actions + systemd + nginx；业务：内容社区 + 社交 + 商城 + VIP + 9 工具台 + 管理后台）
- 运行环境前提：用户在中国宁波，自托管服务器大概率位于**中国大陆境内**（备案、IPv6、CDN 国内可用性是现实约束）。
- 标注规则：✅ 已核实官方文档/官网/官方仓库；⚠️ 仅第三方/社区口径，未在官方页直接核到；🌐 国外服务（境内服务器需评估网络可达性与合规）；🇨🇳 国内服务。
- 合规边界总原则：**Mim 只"参考"同类开源项目的功能结构与 UI 模式，不复制其源码**——下表每条均按"仅参考 / 可有限借鉴代码"分级。

---

## 一、开源同类项目参考

### 1.1 内容社区类

| 资源 | 官网/仓库 URL | 许可证 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| NodeBB | https://nodebb.org/pricing ；仓库 https://github.com/NodeBB/NodeBB | **GPL-3.0** ✅（官方定价页明示 GPLv3 自托管免费） | **高**：同为 Node.js 生态、社区论坛功能模型（板块/话题/用户层级）与 Mim 动态/话题/榜单最接近 | 仅参考功能结构与信息架构，**不引入代码**（GPL 传染） | **值得评估**（功能参考） |
| Discourse | https://www.discourse.org/open-source | **GPL v2** ✅（官方 Open Source 页："The GNU General Public License, version 2"） | 中：功能成熟度标杆（长文/评论/通知体系），但技术栈 Ruby on Rails 且官方强制 Docker 部署，与 Mim「node:http 零框架、无 Docker」路线完全不同 | 仅参考**社区运营机制与产品形态**，不碰代码 | **仅参考** |
| Flarum | https://docs.flarum.org/ （官方文档 About 页："released under the MIT license"） | **MIT** ✅ | 中高：轻量论坛 UI（讨论流、标签）与 Mim 动态流形态相似；PHP 栈不通用，但 MIT 下**设计甚至局部代码可借鉴（需保留版权声明）** | 参考 UI/交互，成本极低 | **立即用**（仅 UI/交互参考） |
| Lemmy | https://github.com/LemmyNet/lemmy （README："Open source, AGPL License"） | **AGPL-3.0** ✅ | 低：联邦化（ActivityPub）方向与 Mim 业务无关；Rust 栈 | **禁止引入任何代码**（AGPL 对网络服务同样传染）；仅可看其"订阅/社区"信息架构 | **仅参考** |

### 1.2 商城类

| 资源 | 官网/仓库 URL | 许可证 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| litemall | https://gitee.com/linlinjava/litemall | **代码 MIT**（文档 CC BY-ND 4.0）✅（Gitee 仓库 README 明示） | **高**：商品/购物车/订单/优惠券/秒杀等模块划分清晰，与 Mim「金额用分」的小额商城（秒杀/本地生活/直播尖货/钱包）结构可直接对照 | MIT 下可参考甚至局部借鉴代码（保留版权声明）；Spring Boot 栈不移植 | **立即用**（功能结构参考首选） |
| lilishop（开源版） | https://pickmall.cn/quote.html | **开源版 MIT** ✅（官方报价页明示 MIT 协议开源版、完整源码 Gitee/GitHub；高级版付费） | 高：Java 商城中模块划分最贴近"多端（PC/H5/小程序/App）"，与 Mim 多端（web/android/ios/tauri）思路一致 | 仅参考功能模块（结算/分销/营销），不引入代码 | **值得评估** |
| mall4j | https://www.mall4j.com/price/ ；README https://gitee.com/gz-yami/mall4j/blob/master/README.md | **开源版 AGPLv3** ✅（官方价格页与 Gitee README 双核实；⚠️ 注意：不是 Apache，闭源商用须购商业授权） | 中：营销玩法（拼团/秒杀/积分）设计可看 | **仅看产品功能截图与文档**，不克隆代码（AGPL 传染 + 商业授权陷阱） | **仅参考**（功能清单） |
| macrozheng/mall | https://github.com/macrozheng/mall （仓库 LICENSE：Apache License 2.0, Copyright (c) 2018-2026 macrozheng） | **Apache-2.0** ✅（核实修正：任务背景写"MIT"，实际官方仓库为 Apache-2.0） | 高：前台商城 + 后台管理模块划分的经典教材级结构，文档极全 | Apache-2.0 允许借鉴设计/代码（需保留版权与 NOTICE），Spring Boot 栈不移植 | **立即用**（后台结构参考首选） |

### 1.3 后台模板与 UI 参考

| 资源 | 官网/仓库 URL | 许可证 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| shadcn/ui | https://www.npmjs.com/package/shadcn （CLI：MIT）；Pro 授权 https://www.shadcn.io/license | **核心组件 MIT** ✅；**Pro Blocks/付费组件需订阅授权**（Individual/Team/Organization 三档）✅ | **极高**：React 18 + Tailwind 技术栈与 Mim 自研轻量 UI 一致，后台管理面板可直接借鉴其组件模式 | MIT 组件可直接复制进项目（保留声明）；Pro 组件不买不抄 | **立即用** |
| Ant Design | https://github.com/ant-design/ant-design （仓库 LICENSE 为 MIT；本轮核到 ant-design-cli LICENSE 同为 MIT 文本 ✅） | **MIT** ✅ | 高：中后台表单/表格/布局模式的事实标准，与 Mim 管理后台场景匹配 | 直接 npm 引入或仅参考交互，均可 | **立即用** |
| Arco Design（字节跳动） | https://arco.design | ⚠️ 本轮未在官方页直接核到 LICENSE 文本（社区通常口径为 MIT/Apache-2.0），**引入前须先读仓库 LICENSE** | 中高：React 组件库，中文文档友好 | 未核实前**仅作视觉参考** | **仅参考**（先核 LICENSE） |
| vue-pure-admin | https://gitee.com/yiming_chang/vue-pure-admin | **MIT** ✅（Gitee 仓库明示 MIT © 2020-present） | 中：Vue3+Element-Plus 栈与 Mim React 不通用，但其**后台页面布局/菜单体系/权限路由设计**是国产中后台模板里最完整的 | 纯视觉/结构参考，不引入代码（技术栈不同） | **值得评估**（仅 UI 结构） |
| AdminLTE | https://adminlte.io/ | ⚠️ 本轮未核到官方 LICENSE（社区通常口径为 MIT），引入前须读 LICENSE 文件 | 中：经典 Bootstrap 后台模板，信息密度高 | 未核实前仅参考 | **仅参考** |

### 1.4 开源协议合规边界（Mim 行动准则）

- **GPL 族（GPL-2.0 / GPL-3.0 / AGPL-3.0）= 只看不用**：NodeBB(GPL-3.0)、Discourse(GPL-2.0)、Lemmy(AGPL-3.0)、mall4j(AGPLv3)。"参考其功能/UI 截图/交互描述"不构成衍生作品；但**任何复制其代码、改其代码、将其代码与 Mim 代码链接进同一进程/同一部署单元，都会触发 Copyleft 传染，要求 Mim 整体开源**。AGPL 更严：即使只做网络服务不分发，也要求公开服务端源码。→ Mim 对这四个项目只做"产品调研笔记"，不建源码 fork。
- **MIT = 最宽松，可放心借鉴**：Flarum、litemall 代码、shadcn/ui 核心、Ant Design、vue-pure-admin。允许复制/修改/商用，**唯一义务是保留版权声明与许可证文本**（建议在 Mim 仓库 NOTICE/CREDITS 文件里登记）。
- **Apache-2.0 = 宽松但多两个动作**：macrozheng/mall。除保留版权外，若对方有 NOTICE 文件须一并保留；修改其文件时建议标注修改处。无 Copyleft，Mim 闭源商用无忧。
- **商业双轨项目警惕"开源版 ≠ 自由商用"**：mall4j、lilishop 均为"开源版 + 商业版"双轨——mall4j 开源版 AGPLv3 本身就限制闭源商用；lilishop 开源版 MIT 但高级功能在商业版。Mim 若商用化，**不要把这些项目的源码合进 Mim**，只参考功能清单。

---

## 二、部署与网络免费资源（无 Docker 自托管 + 国内现实）

### 2.1 CDN / WAF / 边缘加速

| 资源 | 官网/文档 URL | 现行免费额度（2026-10-29 核实） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| 🇨🇳 腾讯 EdgeOne 免费套餐 | 免费套餐指南 https://www.tencentcloud.com/document/product/1145/70405 ；产品页 https://cloud.tencent.com/product/teo ；配额 https://cloud.tencent.com/document/product/1552/132789 | **免费套餐 0 元领取、长期有效**（限量内测中）：安全加速流量与请求数官方文档标"unmetered/不限量" ✅；另有时限**试用版套餐：10GB 安全加速流量 + 10 万请求 + 10 增值用量**（含 OWASP Top10 托管规则集、精准 CC 防护）✅ https://cloud.tencent.com/act/pro/eo-trial ；Edge Functions 免费版执行 300 万次/月 ✅ | **极高**：Mim 仓库已有 `.edgeone/` 目录，同账号同边缘网络；国内节点直连、合规；自带免费 HTTPS 证书、规则引擎、DDoS/CC/Web 防护 | 0 元起步；流量超免费档后个人版 9.9 元/月（50GB/300 万请求/1 站点） | **立即用**（首选边缘层） |
| 🌐 Cloudflare 免费版（CDN/WAF/DNS/Universal SSL/Tunnel） | https://www.cloudflare.com/plans/ ；中国网络说明 https://developers.cloudflare.com/china-network | **Free $0/月**：CDN/WAF/DDoS/DNS/Universal SSL 全免费 ✅；Tunnel 内网穿透同属免费能力 ⚠️（官方文档列于各计划，未在定价页单列数字） | **中**：Mim 已有 `worker/wrangler.jsonc`；但**免费版不含中国大陆节点**——CF 中国网络由京东云运营、必须持有 ICP 备案号并走商务开通 PoC（✅ 官方 china-network 文档）；境内用户访问 CF 境外节点速度不稳 | 0 元；国内加速不可用，仅作境外用户/Worker 边缘函数 | **立即用**（Worker 已有部分）；**国内主链路不依赖** |
| 🇨🇳 七牛云 CDN | 免费额度须知 https://developer.qiniu.com/af/12968/freequota | 实名认证后：**国内 HTTP 下载 10GB/月 + 海外 10GB/月**，另**动态加速 5 万次请求/月** ✅；kodo 对象存储 10GB/月免费 | 中：适合把 Mim 静态资源（视频封面/图片/附件）切走，回源压力下降；国内 CDN 需域名已备案 | 0 元起步，超量按量（约 0.2-0.3 元/GB） | **值得评估**（静态资源卸载） |
| 🇨🇳 又拍云 CDN | https://www.upyun.com/ | ⚠️ 本轮未核到现行公开免费额度（历史上有新用户流量包，现行政策未在官方页核实） | 低-中 | 未核实 | **仅参考** |

### 2.2 免费 SSL 证书

| 资源 | 官网/文档 URL | 现行条款（2026-10-29 核实） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Let's Encrypt | https://letsencrypt.com/zh-cn/ ；certbot 文档 https://eff-certbot.readthedocs.io/ | 免费 DV 证书，**90 天有效**；certbot 装 systemd timer 自动续期（剩余 <30 天触发续签）✅ | **极高**：Mim nginx 反代标准动作，acme.sh/certbot 一键 | 0 元 | **立即用**（推荐主力） |
| ZeroSSL | https://zerossl.com/about/ ；ACME 自动化 https://zerossl.com/features/acme | 免费计划手工签发 **5 张 90 天证书**；**经 ACME 客户端（acme.sh/Caddy/win-acme）签发则 90 天证书无限量且免费自动续期** ✅；acme.sh 默认 CA 现为 ZeroSSL | 高：与 Let's Encrypt 互为备份 CA | 0 元 | **立即用**（备用 CA） |
| 🇨🇳 腾讯云免费 SSL 证书 | https://cloud.tencent.com.cn/document/product/400/89868 （2026-01-23 更新版） | **有效期 90 天**（非早年的 1 年），单账号最多 50 张 ✅ | 高：与 EdgeOne 同账号，可一键部署到 EdgeOne/CDN | 0 元 | **立即用**（边缘侧证书） |
| 🇨🇳 阿里云个人测试证书（免费版） | https://help.aliyun.com/zh/ssl-certificate/purchase-an-individual-test-certificate | 免费版 **90 天 DV**；Pro 版 34 元/张/6 个月 ✅ | 中高：若回源站用阿里云轻量服务器则顺手 | 0 元 | **值得评估** |
| 🌐 Cloudflare Universal SSL | https://www.cloudflare-cn.com/application-services/products/ssl/ ；说明 PDF https://cf-assets.www.cloudflare.com/ （Universal SSL 白皮书） | 代理接入 CF 的域名**自动免费签发+续期** Universal SSL ✅ | 中：仅当流量走 CF 代理时有意义；源站证书仍需自备 | 0 元 | **跟随 CF 策略** |

**证书方案推荐**：Mim 源站 nginx 用 **acme.sh（默认 ZeroSSL）或 certbot（Let's Encrypt）+ systemd/cron 自动续期**，90 天全自动化，0 成本；边缘侧用 EdgeOne 免费证书托管，不操心。**不再推荐购买付费证书**（DV 免费层已够用）。

### 2.3 免费域名现状（2026-10-29 核实）

| 资源 | 官网/状态 URL | 现状 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Freenom（.tk/.ml/.ga/.cf/.gq） | https://www.freenom.com/ （官网公告："new registrations is temporarily out-of-order"） | **新注册实质停止**：2024 年起暂停，2026 年社区口径"基本不可用"，存量域名续费亦被搁置 ✅官网公告 + ⚠️第三方指南 https://www.keydal.net/blog/free-domain-guide-2026 | 无：且此类免费域名**无法用于国内 ICP 备案**，对 Mim 无意义 | — | **不建议引入** |
| eu.org（免费二级域名） | https://eu.org/ | 仍在运营，免费、志愿编辑人工审核，⚠️第三方 2026 指南称审核 1-3 周、内容政策严格（未核官方流程页）https://www.keydal.tr/blog/bedava-domain-rehberi-2026 | 低：二级免费域名**基本无法通过国内 ICP 备案**（备案要求可核验的顶级域名），仅适合境外/个人玩具站 | 0 元 | **仅参考**（备案不了，别用作正式域名） |
| 注册商低价顶级域（建议） | — | .com 约 ¥60-80/年、.cn 首年常有 ¥9-29 活动（⚠️ 本轮未核具体价格页） | **Mim 正式域名必须买可备案的顶级域**，这是合规前提 | 每年几十元 | **立即用**（小额必花） |

### 2.4 IPv6 自托管（结合宁波家用/机房宽带现实）

| 事项 | 依据 URL | 现状结论 | 与 Mim 匹配度 | 优先级 |
|---|---|---|---|---|
| 国内家庭宽带公网 IPv6 | 工信部《"网络去NAT"专项工作通知》 https://www.miit.gov.cn/jgsj/txs/wjfb/art/2024/art_141a01e110104032bf8e773bd42979ed.html | **到 2024 年底基础电信企业固定宽带 IPv6 连通率不低于 80%** ✅官方；三大运营商家宽普遍已下发公网 IPv6 /64 前缀 | 高：宁波电信/联通/移动家宽大概率**直接有公网 IPv6** | **立即用** |
| nginx 双栈配置 | 双栈教程 https://www.hncloud.com/news/11442.html ；IPv6 DDNS 实例 https://www.zouht.com/3096.html | nginx 同时 `listen 80;` + `listen [::]:80;`；DNS 加 AAAA 记录与 A 记录共存，客户端优先 IPv6 ⚠️社区教程口径（操作标准动作） | 高：Mim nginx 加一行即可 | **立即用** |
| 注意事项 | — | ① 家用宽带动态前缀会变，需 **IPv6 DDNS**（路由器固件或 acme/ddns-go）；② **有公网 IPv6 ≠ 可绕过备案**——内容监管按"网站"而非地址族，境内服务器对外提供 Web 服务仍须 ICP 备案；③ IPv4 侧家宽一般仍是 CGNAT，IPv4 入站需靠 Tunnel/内网穿透 | — | 执行前必读 |

### 2.5 备案合规（国内运营 Mim 的硬约束）

| 事项 | 依据 URL | 现行规则（2026-10-29 核实） |
|---|---|---|
| ICP 备案义务 | 工信部《非经营性互联网信息服务备案管理办法》PDF https://www.miit.gov.cn/ （办法原文）✅；阿里云官方 FAQ https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/faq-about-icp-filing-applications-in-different-scenarios | **域名解析指向中国内地服务器并开通 Web 服务 → 必须 ICP 备案**；经云厂商（阿里云/腾讯云等接入商）在线提交 + 工信部短信核验，个人备案免费、约 2-3 周；首页底部须悬挂备案号并链接至工信部 |
| 境外服务器替代 | 同上阿里云 FAQ ✅；CERNET 备案指南 https://icp.nic.edu.cn/ICP%E5%A4%87%E6%A1%88%E6%8C%87%E5%8D%97.html | 解析指向**境外/香港服务器可免 ICP 备案**，但**仍需公安联网备案**（全国互联网安全管理服务平台）；代价：大陆用户访问延迟高、**国内 CDN（七牛/EdgeOne 国内节点）不可用或体验差** |
| "用 Cloudflare 代理规避备案"是否可行 | CF 中国网络官方文档 https://developers.cloudflare.com/china-network/get-started/ | **不成立**：① CF 免费版不提供大陆节点，代理只套境外 IP，等于"境外服务器"方案；② CF 中国网络（京东云运营）**明确要求域名持有有效 ICP 备案号**才能接入。合规做法只有两条路：**办 ICP 备案用境内服务**，或**承认走境外节点、接受速度与合规降级**，不要钻代理空子 |

### 2.6 自托管加固（免费开源工具清单）

| 工具 | 官网 URL | 用途 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| fail2ban | https://www.fail2ban.org/ （⚠️ 本轮未核版本细节，常用开源入侵防御，GPL） | 自动封禁 SSH/nginx 暴力破解 IP | **极高**：systemd 服务器标准动作 | 0 元 | **立即用** |
| UFW（Uncomplicated Firewall） | https://launchpad.net/ufw （Ubuntu 自带 ⚠️ 未本轮细核） | 主机防火墙，仅放行 22/80/443 | **极高** | 0 元 | **立即用** |
| acme.sh / certbot | https://github.com/acmesh-official/acme.sh ；https://eff-certbot.readthedocs.io/ | 证书申请+自动续期（见 2.2） | 极高 | 0 元 | **立即用** |
| nginx 反代 + 安全头配置 | — | TLS1.2+、HSTS、隐藏版本号、限流 limit_req | 极高（Mim 已用 nginx） | 0 元 | **立即用** |
| sshd 加固（禁密码登录、改端口） | — | systemd 前置必做 | 高 | 0 元 | **立即用** |

---

## 三、不建议引入清单

| 项目 | 原因 |
|---|---|
| NodeBB / Discourse 源码（哪怕 fork 后改） | GPL-3.0 / GPL-2.0，与 Mim 自有闭源/私有代码链接即整体 Copyleft 传染；且栈不匹配（NodeBB 自带整套论坛后端，Discourse 强制 Docker） |
| Lemmy 任何代码 | AGPL-3.0：网络服务形态也传染；ActivityPub 联邦化方向与 Mim 业务无关 |
| mall4j 开源版源码 | AGPLv3 + 商业双轨陷阱：闭源商用须另购商业授权，直接引入等于给未来埋雷 |
| Freenom 免费域名 | 官方已停新注册、存量续费失控；且**国内无法 ICP 备案**，与 Mim 在华运营直接冲突 |
| eu.org 作 Mim 正式域名 | 免费二级域名过不了国内备案；人工审核 1-3 周且政策不可控，不适合生产 |
| Cloudflare 免费版当国内主 CDN | 免费版无大陆节点；CF 中国网络必须 ICP + 商务开通，免费层用户用不上 |
| Arco Design / AdminLTE 直接抄代码 | 本轮未核实 LICENSE 文本，核实前只看不用 |
| 付费 SSL 证书（OV/EV/多年期） | DV 免费层（Let's Encrypt/ZeroSSL/腾讯云）已覆盖 Mim 全部场景，无必要花钱 |
| 又拍云/其他厂商"免费 CDN"作为主力 | 未核到现行免费额度；早期静态资源用七牛 10GB/月 + EdgeOne 免费档已够，不增加厂商数量 |

---

## 四、来源 URL 汇总（去重，检索日期均为 2026-10-29）

**开源许可证类**
1. NodeBB 官方定价页（GPLv3 自托管）：https://nodebb.org/pricing
2. Discourse 官方 Open Source 页（GPL v2）：https://www.discourse.org/open-source
3. Flarum 官方文档 About（MIT）：https://docs.flarum.org/
4. Lemmy GitHub 仓库（AGPL）：https://github.com/LemmyNet/lemmy
5. litemall Gitee 仓库（代码 MIT）：https://gitee.com/linlinjava/litemall
6. lilishop 官方报价页（开源版 MIT）：https://pickmall.cn/quote.html
7. mall4j 官方价格页（开源版 AGPL3.0）：https://www.mall4j.com/price/
8. mall4j Gitee README（AGPLv3 授权说明）：https://gitee.com/gz-yami/mall4j/blob/master/README.md
9. macrozheng/mall GitHub 仓库（Apache-2.0）：https://github.com/macrozheng/mall
10. shadcn npm（MIT）：https://www.npmjs.com/package/shadcn
11. shadcn.io Pro 授权页：https://www.shadcn.io/license
12. ant-design LICENSE（MIT 文本）：https://github.com/ant-design/ant-design
13. vue-pure-admin Gitee（MIT）：https://gitee.com/yiming_chang/vue-pure-admin

**CDN/WAF/边缘类**
14. Cloudflare 定价页（Free $0/月）：https://www.cloudflare.com/plans/
15. Cloudflare 中国网络总览（京东云运营、需 ICP）：https://developers.cloudflare.com/china-network
16. Cloudflare 中国网络入门（ICP 备案号要求）：https://developers.cloudflare.com/china-network/get-started/
17. Cloudflare Universal SSL 说明：https://www.cloudflare.com/application-services/products/ssl/
18. EdgeOne 免费套餐官方指南：https://www.tencentcloud.com/document/product/1145/70405
19. EdgeOne 产品页（个人版 9.9 元/月 50GB）：https://cloud.tencent.com/product/teo
20. EdgeOne 试用套餐活动页（10GB+10 万请求）：https://cloud.tencent.com/act/pro/eo-trial
21. EdgeOne 限制与配额（Edge Functions 300 万次/月）：https://cloud.tencent.com/document/product/1552/132789
22. 七牛云免费额度须知（CDN 10GB/区域/月）：https://developer.qiniu.com/af/12968/freequota

**证书类**
23. Let's Encrypt 官网（免费 90 天 DV）：https://letsencrypt.com/zh-cn/
24. certbot 官方文档（自动续期）：https://eff-certbot.readthedocs.io/
25. ZeroSSL 官方 About（免费计划 5 张/ACME 无限量）：https://zerossl.com/about/
26. ZeroSSL ACME 自动化页：https://zerossl.com/features/acme
27. 腾讯云免费 SSL 证书概述（90 天、50 张上限）：https://cloud.tencent.com.cn/document/product/400/89868
28. 阿里云个人测试证书对比（免费版 90 天）：https://help.aliyun.com/zh/ssl-certificate/purchase-an-individual-test-certificate

**域名 / 备案 / IPv6 类**
29. Freenom 官网（新注册暂停公告）：https://www.freenom.com/
30. 免费域名 2026 指南（第三方，eu.org/ Freenom 现状）：https://www.keydal.net/blog/free-domain-guide-2026 ；https://www.keydal.tr/blog/bedava-domain-rehberi-2026
31. 工信部《非经营性互联网信息服务备案管理办法》：https://www.miit.gov.cn/
32. 阿里云 ICP 备案 FAQ（境内备案/境外免 ICP 但需公安备案）：https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/faq-about-icp-filing-applications-in-different-scenarios
33. CERNET ICP 备案指南（解析境内才需备案）：https://icp.nic.edu.cn/ICP%E5%A4%87%E6%A1%88%E6%8C%87%E5%8D%97.html
34. 工信部"网络去NAT"IPv6 通知（家宽 IPv6 连通率 ≥80%）：https://www.miit.gov.cn/jgsj/txs/wjfb/art/2024/art_141a01e110104032bf8e773bd42979ed.html
35. nginx 双栈配置教程（社区口径）：https://www.hncloud.com/news/11442.html
36. IPv6 DDNS 实操案例（社区口径）：https://www.zouht.com/3096.html
