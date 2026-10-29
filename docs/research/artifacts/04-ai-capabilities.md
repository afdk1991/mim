# Mim 项目可免费/低成本接入的 AI 能力调研清单

- 调研基准日期：**2026-10-29（UTC+8）**
- 调研对象：Mim（React 18 + TS / node:http 零框架后端 / PostgreSQL / 自托管，已有 .edgeone、worker/ Cloudflare Workers、Coze 面板、AiRes 页面雏形）
- 业务语境：UGC 内容社区（动态/文章/代码片段/话题/视频/直播）+ 社交私信 + 商城 + 9 个工具台 + 管理后台；在中国运营，**有内容审核合规刚需**。
- 标注规则：✅ 已核实官方页；⚠️ 仅第三方/社区口径，未在官方定价页直接核到精确数字；🌐 国外服务（自托管服务器在中国大陆时需评估网络可达性）；🇨🇳 国内服务（合规、备案、实名认证友好）。

---

## 一、AI 网关 / 边缘模型（与 Mim 已有的 EdgeOne / Cloudflare 基础设施天然对齐）

| 资源 | 官网/定价页 | 现行免费额度（2026-10-29 核实） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| 🇨🇳 腾讯 EdgeOne Makers Models（内置模型网关） | https://cloud.tencent.com/document/product/1552/132789 | **免费版 50 万 token/月**（所有内置模型共享）；欠费即停；额度在控制台 Models 页查看。✅已核实官方（2026-09-22 更新版） | **极高**：Mim 已有 `.edgeone/` 目录，天然同账号同边缘网络；国内直连、合规 | 0 元起步；超量需联系商务开通企业版 | **立即用** |
| 🌐 Cloudflare Workers AI | https://developers.cloudflare.com/workers-ai/platform/pricing | **Free 计划每天 10,000 Neurons**；超量按 $0.011 / 1000 Neurons；自 2026-07-28 起部分模型（如高端模型）在 Free 计划返回 403，需 Workers Paid（$5/月起），但仍保留 10,000 Neurons/天免费额度。✅已核实官方 | **高**：Mim 已有 `worker/wrangler.jsonc`；适合把"标题生成/标签抽取"等轻量推理放在边缘；国内访问 Cloudflare 不稳 | 0 元起步；要全模型需 $5/月 | **立即用**（免费模型子集） |
| 🌐 OpenRouter（聚合网关） | https://openrouter.ai/pricing | **25+ 个免费模型**（Free Router 路由），prompt/completion token 单价 $0；免费端点有速率限制；充值收 5.5% 手续费（最低 $0.80）。✅已核实官方 | 中：作为**多模型兜底/比价层**有价值；国内服务器直连 openrouter.ai 通常不稳定，需经代理或走 EdgeOne 回源 | 0 元起步 | **值得评估** |
| LiteLLM（自托管网关，MIT） | https://www.litellm.ai/pricing | **开源自托管永久免费**（MIT）；Enterprise 版按治理需求收费。✅已核实官方 | 中低：Mim 后端是 node:http 零框架，自托管一个 Python LiteLLM 进程会**新增运维面**（进程、配置、密钥、日志）；建议**仅在同时接 ≥3 个模型时**再上 | 0 元软件成本；运维成本中等 | **仅参考**（暂不引入） |

---

## 二、模型 API 免费/低成本层

### 2.1 国内模型（合规、国内网络直连，推荐主力）

| 资源 | 定价页 | 现行免费额度 | 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| 🇨🇳 火山方舟 / 豆包大模型 | https://www.volcengine.com/product/ark ；安心体验模式 https://ark.volcengine.com/region:cn-beijing/docs/free-tokens-only-mode | **每个模型首次开通送 50 万 tokens**；"安心体验模式"仅消耗赠送额度、用满自动暂停不产生费用；另有"协作奖励计划"每日按授权模型送最多 500 万 tokens/模型（30 天有效）。✅已核实官方 | **极高**：国内直连、中文场景强、与 EdgeOne 同属腾讯/火山生态；适合文章摘要、标题、话题标签 | 0 元起步；超量按 token 计费（豆包 Seed 系列百万 tokens 量级，单模型月成本通常 < 几十元即可覆盖社区早期流量） | **立即用** |
| 🇨🇳 智谱 GLM 开放平台（BigModel） | https://bigmodel.cn/pricing | **GLM-4.7-Flash（200K 上下文）输入/输出/缓存全免费**；**GLM-4.6V-Flash 视觉模型全免费**；付费模型缓存存储限时免费。✅已核实官方 | **极高**：Flash 系列长期免费是 Mim 最划算的选项；200K 上下文适合长文章摘要/代码片段解释 | 0 元 | **立即用**（首选免费层） |
| 🇨🇳 阿里云百炼（通义千问 Qwen） | https://help.aliyun.com/zh/model-studio/new-free-quota | **新人每个模型独立约 100 万 tokens 免费**，仅华北2（北京）地域生效，有效期开通后 90/180 天（视开通时间）；全平台 70+ 模型合计超 7000 万 tokens。✅已核实官方（2026-10-20 更新） | 高：中文能力稳定；适合作为豆包/智谱之外的**第二供应商**做容灾 | 0 元起步 | **立即用**（作为兜底） |
| 🇨🇳 DeepSeek API | https://api-docs.deepseek.com/zh-cn/quick_start/pricing | **无长期免费层**；按峰谷计费（闲时半价），deepseek-flash 闲时输入缓存命中 $0.003/百万 tokens、deepseek-v4-pro 闲时 $0.022/百万 tokens；新账号历史上赠送少量体验金（⚠️ 第三方口径，未在官方页核到当前送额）。✅官方价格已核实 | 高：中文/代码能力强、单价极低；适合**代码片段解释、长文章生成**等重任务 | 极低（月几元~几十元量级即可起步） | **值得评估**（按量付费，不白嫖） |
| 🇨🇳 Kimi / 月之暗面开放平台 | https://platform.kimi.com/docs/pricing/chat | **无免费层**；kimi-k2.6 输入 ¥6.50/MTok、输出 ¥27.00/MTok；kimi-k3 为 1M 上下文按量付费。✅官方价格已核实 | 中：长上下文优势，但价格高于豆包/智谱 Flash；社区场景非必需 | 按 token 计费 | **仅参考** |

### 2.2 国外模型（自托管服务器在中国大陆时，网络可达性是第一约束）

| 资源 | 定价页 | 现行免费额度 | 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| 🌐 Google Gemini API 免费层 | https://ai.google.dev/gemini-api/docs/rate-limits | **Free 层存在**，按模型分 RPM/TPM/RPD 三围限制，具体数字需在 AI Studio 查看；社区反馈 2026 年新免费 key 实测低至 ~20 RPD（⚠️ 论坛口径，非官方统一数字）；Free 层无支出上限。✅官方限速页已核实（2026-10-26 更新） | 低：①中国大陆服务器直连 `generativelanguage.googleapis.com` 通常不通；②免费层 RPD 小、不适合生产 | 0 元起步但网络是硬伤 | **仅参考** |
| 🌐 Groq Cloud 免费层 | https://groq.com/groqcloud | **Free 计划 $0、无需信用卡**；第三方实测入口级文本模型 ~30 RPM、~1000 RPD、~100k tokens/天（⚠️ 2026-08 第三方核实，官方页未列精确数字）；速度快但模型以 Llama/GPT-OSS 等开源为主 | 低：国内服务器直连 groq.com 不稳定；中文能力弱于国产模型 | 0 元起步 | **仅参考** |
| 🌐 Mistral La Plateforme Experiment | https://mistral.ai/ （定价页） | **Experiment 计划免费**，需手机号验证、默认同意数据用于训练；第三方称每月约 $10 等值额度（⚠️ 第三方口径） | 低：法文为主、中文弱；国内网络同 Gemini | 0 元起步 | **不建议引入** |

---

## 三、UGC 内容审核合规方案（Mim 在华运营的刚需）

> 合规必要性：依据《网络安全法》《互联网信息服务管理办法》《网络信息内容生态治理规定》，UGC 平台（含动态、评论、私信、直播弹幕）必须先审后发或实时审核，个人/小规模社区也不能裸奔。**AI 辅助生成 ≠ 内容审核合规**，必须接入专业审核 API。

| 资源 | 定价页 | 现行免费/试用额度 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| 🇨🇳 腾讯云内容安全（文本） | https://cloud.tencent.com/document/product/1124/37119 | **新用户 3000 条文本免费试用包，15 天有效**（不含"AI 生成识别"）；超出 25 元/万条。✅已核实官方（2026-10-19 更新） | **极高**：与 EdgeOne 同账号、同地域、调用链路最短；覆盖涉黄/涉政/谩骂/广告 | 试用 0 元；正式约 ¥0.0025/条 | **立即用**（先开试用包跑通） |
| 🇨🇳 阿里云内容安全 / AI 安全护栏 | https://help.aliyun.com/zh/document_detail/69806.html | **首次调用起 31 天内，每日 3000 条文本免费**；第 32 天起按量计费，文本增强版约 7.5 元/万次起。✅已核实官方 | 高：可与百炼同账号，便于模型+审核一体 | 试用期 0 元；正式约 ¥0.00075/条（比腾讯便宜） | **立即用**（备选/比价） |
| 🇨🇳 网易易盾 | https://dun.163.com/ | **官方称"高额免费试用量及试用期"**，但未在公开页给精确条数；高级版约 450 元/人/年（⚠️ 第三方定价页口径）。✅免费试用存在已核实，精确数字未核到 | 中：能力强但商务流程较重，适合中后期 | 试用期 0 元 | **值得评估**（规模化后再切） |

**取舍建议**：Mim 早期（日均 UGC < 几千条）直接用 **阿里云内容安全 31 天每日 3000 条免费额度** 或 **腾讯云 3000 条 15 天试用** 跑通审核链路；上线生产后选一家按量付费（文本 ¥0.00075~0.0025/条，月成本通常 < 100 元）。**不要用通用大模型（豆包/Gemini）自己写审核 prompt 替代专业审核服务**——准确率、召回率、合规背书都不够。

---

## 四、AI 功能落地建议（结合 Mim 业务）

| 功能 | 推荐接入 | 成本量级 | 说明 |
|---|---|---|---|
| 1. 文章/动态的**标题生成 + 摘要 + 话题标签** | 智谱 GLM-4.7-Flash（免费）兜底，火山方舟豆包 50 万 tokens 试用 | **0 元**（免费层足够早期） | 写文章时一键生成 3 个候选标题、100 字摘要、3 个话题标签；GLM-4.7-Flash 200K 上下文直接吞长文 |
| 2. **智能回复辅助**（私信/评论框下方"帮我润色/续写"） | 同上，前端调 AiRes 页面已有的接口 | 0 元 | 用户触发才调用，成本天然可控 |
| 3. **UGC 发布前审核**（动态/评论/昵称/私信文本） | 阿里云内容安全（31 天每日 3000 条免费）→ 转正后按量 | 试用期 0；正式月 ~¥50-100 | **合规刚需，优先级最高**；不要用大模型 prompt 替代 |
| 4. **工具台 AI 化**——建议优先改造"代码片段工具" | DeepSeek API（按量，代码能力强、单价极低）或 Cloudflare Workers AI 上的 `@cf/zai-org/glm-4.7-flash` | 月几元~几十元 | 代码片段解释、注释生成、语言识别；其余 8 个工具台按需再扩 |
| 5. **搜索/推荐增强**（内容自动打标签 → PG 全文检索/标签页） | 火山方舟豆包 Embedding 或智谱 Embedding-2（¥0.5/百万 tokens） | 极低 | 对存量 UGC 离线批量打标签，写入 PostgreSQL 标签字段；在线时零成本 |

---

## 五、自托管 LLM 是否值得（Ollama / vLLM）

| 资源 | 许可证 | 硬件门槛 | 结论 |
|---|---|---|---|
| Ollama | MIT ✅ | 7B 模型 ≥8GB RAM；13B ≥16GB；70B ≥32GB + NVIDIA GPU 加速才可用 | **不建议在 Mim 自托管宿主机上跑**：个人服务器一般无 GPU、内存 ≤16GB，跑 7B 量化模型 CPU 推理延迟数百 ms~秒级，无法满足社区实时交互。仅在你有闲置带显卡的机器时**仅作本地开发/脱敏测试用**。 |
| vLLM | Apache-2.0 | 生产级推理需多张 NVIDIA GPU（单卡 24GB 起） | **完全不适用**于个人自托管 Mim。 |

**结论**：自托管 LLM 对 Mim 当前硬件现实**仅参考、不引入**。把"模型"留在云端 API，把"网关/缓存/密钥管理"留在自己后端即可。

---

## 六、不建议引入清单

1. **自托管 Ollama / vLLM 跑生产模型**——无 GPU 宿主机跑不动，延迟与并发都不达标。
2. **用通用大模型 prompt 替代专业内容审核服务**——准确率、合规背书都不够，违规风险自担。
3. **Google Gemini / Groq / Mistral 免费层作为生产主力**——国内服务器网络不可达，且免费层 RPD 小。
4. **Kimi 开放平台**——无免费层、单价高于豆包/智谱，社区场景非必需。
5. **LiteLLM 自托管网关**——Mim 早期模型数量 ≤3 时，自托管 Python 进程是纯运维负担；等接 ≥4 个模型再评估。
6. **OpenRouter 作为国内直连主通道**——网络不稳，仅作多模型比价/兜底。

---

## 七、来源 URL 与检索日期（去重后）

> 检索日期均为 **2026-10-29**。

1. EdgeOne Makers 限制与配额（50 万 token/月）：https://cloud.tencent.com/document/product/1552/132789
2. EdgeOne Makers 概览：https://cloud.tencent.com/document/product/1552/132760
3. EdgeOne 朱雀模型说明：https://cloud.tencent.com/document/product/1552/137539
4. Cloudflare Workers AI Pricing：https://developers.cloudflare.com/workers-ai/platform/pricing
5. Cloudflare Workers AI 2026-07-28 模型需 Paid 计划公告：https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/
6. OpenRouter Pricing：https://openrouter.ai/pricing
7. OpenRouter Free Models Router：https://openrouter.ai/docs/guides/routing/routers/free-router
8. LiteLLM Pricing（MIT 自托管免费）：https://www.litellm.ai/pricing
9. 火山方舟产品页（每模型 50 万 tokens）：https://www.volcengine.com/product/ark
10. 火山方舟安心体验模式：https://ark.volcengine.com/region:cn-beijing/docs/free-tokens-only-mode
11. 火山方舟协作奖励计划：https://www.volcengine.com/docs/82379/1391869
12. 智谱 BigModel 定价（GLM-4.7-Flash 免费）：https://bigmodel.cn/pricing
13. 智谱 API 定价文档：https://docs.bigmodel.cn/cn/guide/start/pricing
14. 阿里云百炼新人免费额度：https://help.aliyun.com/zh/model-studio/new-free-quota
15. DeepSeek API 定价：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
16. DeepSeek V4-Pro 上线峰谷定价公告：https://api-docs.deepseek.com/zh-cn/news/news260813/
17. Kimi API 定价：https://platform.kimi.com/docs/pricing/chat
18. Gemini API 速率限制：https://ai.google.dev/gemini-api/docs/rate-limits
19. Groq Cloud 计划页：https://groq.com/groqcloud
20. 腾讯云内容安全标准服务计费（3000 条 15 天试用）：https://cloud.tencent.com/document/product/1124/37119
21. 腾讯云文本内容安全计费（25 元/万条）：https://cloud.tencent.cn/document/product/1124/37118
22. 阿里云内容安全开通（31 天每日 3000 条免费）：https://help.aliyun.com/zh/document_detail/69806.html
23. 阿里云内容安全增强版计费（7.5 元/万次起）：https://help.aliyun.com/zh/document_detail/2539430.html
24. 网易易盾官网（免费试用入口）：https://dun.163.com/
25. Ollama 中文文档（硬件门槛）：https://ollama.readthedocs.io/quickstart/

---

*本清单所有免费额度数字均于 2026-10-29 当日检索官方页核实；标注 ⚠️ 的为第三方口径，接入前请以官方控制台实时展示为准。*
