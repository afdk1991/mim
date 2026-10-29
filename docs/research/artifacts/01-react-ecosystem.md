# Mim 前端生态可复用开源库调研报告

> **项目**：Mim（自托管全栈，React 18.3 + Vite 8.3 + TS 5.9 纯 SPA，自研 hash 路由 + 自研轻量 UI + 自研 data 层，运行时依赖仅 react / react-dom / @capacitor）
> **检索日期基准**：2026-10-29
> **调研方式**：只读互联网调研，关键事实（许可证 / 维护状态 / 包体积量级 / TS 支持）以 npm 官方页、GitHub 仓库与各库官网为准；包体积凡标注「官方」者出自库官方文档/博客，标注「第三方称」者来自独立站点，仅供量级参考。
> **评分口径**：优先级分三档——**立即用**（高收益、低风险、与自研件不冲突）/ **值得评估**（收益明确但需对照自研实现做接入试验）/ **仅参考**（与自研路线冲突或已不建议新项目采用）。

---

## 〇、维度结论速览（3-5 条）

1. **真正「立即用」的只有轻量工具层**：clsx（<1KB）、TanStack Virtual（~6KB headless）、react-markdown（安全渲染 Markdown）、Embla Carousel（~3-5KB headless）——它们与 Mim 自研 UI/路由/data 层零冲突，纯增量能力。
2. **服务端状态是最大取舍点**：Mim 通用 `REST /api/rest/:table` 模式 + 自研 data 层已覆盖基本读写；TanStack Query（MIT，周下载 ~5860 万）的缓存/去重/失效能力值得做一次接入试验，但属「值得评估」而非立即替换——它会重写 data 层约定。
3. **编辑器选 TipTap（headless）不选 Quill**：TipTap 无头设计与 Mim 自研 UI 哲学完全契合；Lexical 作为 Meta 背书的备选；Quill 官方版近 2 年未发新版，维护停滞，不建议新项目采用。
4. **图表按管理后台规模选**：简单柱状/折线用 Recharts（官方示例 tree-shaken 单图 ~9.5KB/3KB gzip）；需要地图/仪表盘再上 ECharts（Apache-2.0，必须按需引入）；AntV G2 对后台场景过重。
5. **组件库全部「仅参考」**：antd v6 / Arco 与 Mim 已成型的自研 UI 直接冲突（带全局样式覆盖、CSS-in-JS 体系）；shadcn/ui 依赖 Tailwind + Radix，Mim 无 Tailwind。保持自研轻量 UI 路线。

---

## 一、列表虚拟化（动态流 / 评论 / 私信 / 通知长列表）

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| TanStack Virtual（@tanstack/react-virtual） | https://tanstack.com/virtual/latest ；https://github.com/TanStack/virtual | MIT（npm 已核实，v3.14.6，数日前仍在发布） | **高**。Headless 内核只管「视口内该渲染谁」，不输出任何 DOM/样式，与 Mim 自研列表 UI 完全兼容；横向/纵向/网格皆可驱动动态流、评论楼、私信会话列表 | 接入工作量小：在现有列表组件外裹一层 `useVirtualizer`，约半天到一天；维护面仅 1 个包（核心约 6KB minified，官方 2026-05 博客数据，已核实官方） | **立即用** |
| react-window | https://www.npmjs.com/package/react-window ；https://github.com/bvaughn/react-window | MIT（npm 已核实）。**维护状态更正**：非「已弃用」——npm 搜索页显示 brianvaughn 本人 v2.3.3 约 10 天前仍在发布，peer 支持 react ^18 \|\| ^19 | 中。API 更古老（FixedSizeList/VariableSizeList），只做「定高/预估高」窗口化，对 Mim 动态流这种卡片高度参差、含图片懒加载的场景需要自己再包一层测量逻辑 | 包体积最小，但业务侧要补自适应高度测量，自研量反而比 TanStack Virtual 大 | 仅参考（被 TanStack Virtual 覆盖） |
| react-virtuoso | https://virtuoso.dev/ ；https://github.com/petyosi/react-virtuoso | MIT（npm 已核实，v4.18.19，2 天前发布，维护极活跃） | 中高。开箱即带无限滚动、分组粘性头部、起始锚点，省自研；但它是**带 DOM 结构的组件级库**，样式定制自由度低于 headless 方案，与自研 UI 的视觉统一需额外调样式。注意：官网明示其 Message List 组件为**商业许可**，core/list/grid/table 才是 MIT | 接入最快（一天内出效果），但样式覆盖成本隐藏在后期 | **值得评估**（私信会话列表这种强粘性头部场景可试） |

---

## 二、富文本编辑器（文章 / 代码片段发布场景）

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| TipTap（@tiptap/react） | https://tiptap.dev/ ；https://github.com/ueberdosis/tiptap | MIT（npm 已核实，v3.32.0，约 10 天前发布） | **高（首选）**。Headless 框架——自带零 UI，工具栏/气泡菜单全部自己画，正好落在 Mim 自研 UI 体系内；基于 ProseMirror，数据模型稳定，扩展生态（代码块、表格、链接、图片）齐全；注意评论/AI 命令等高级扩展是付费 Pro 扩展，日常文章够用 | 接入量中等：核心 + 常用扩展约 8-12 个包，首版 2-3 天；ProseMirror 概念曲线是主要学习成本；包体积为编辑器三家中最大量级（ProseMirror 内核决定，官方未公布单一定数，第三方称整体 ~30-60KB gzip，仅供参考） | **值得评估→倾向采用**（文章发布模块） |
| Lexical | https://lexical.dev/ ；https://github.com/facebook/lexical | MIT © Meta Platforms（官网 API 页已核实），v0.52.0，3 天前发布 | 高。Meta 出品，可靠性/无障碍/性能是其卖点，同样提供 `@lexical/react` 官方绑定；版本号仍 pre-1.0 但生产验证充分（第三方资料称 API 实践中已稳定，仅版本号保守） | 与 TipTap 并列评估：扩展体系比 TipTap 分散（每个能力一个 `@lexical/*` 包），文档与中文社区资源略少 | **值得评估**（TipTap 的平行备选） |
| Quill | https://quilljs.com/ ；https://github.com/slab/quill | **BSD-3-Clause**（npm 已核实，quill@2.0.3，约 2 年前发布） | 低。官方 2.0.3 后近 2 年无新版本，维护明显放缓；自带主题样式（snow/bubble）与 Mim 自研 UI 视觉统一成本高。⚠️ 注意：网络上存在声称「MIT、~43KB gzip」的第三方 Quill 站点（quilleditor.org），**并非官方 slab/quill**，许可证结论以 npm 官方包（BSD-3）为准 | —— | **不建议引入**（见结尾清单） |

---

## 三、拖拽（工具台排序 / 榜单排序）

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| dnd-kit | https://dndkit.com/ ；https://github.com/clauderic/dnd-kit | MIT（npm 已核实）。维护活跃：新一代 `@dnd-kit/react`（建于 `@dnd-kit/dom` 之上）5 天前刚发布 | **高**。Sensor 抽象（Pointer/Mouse/Touch/Keyboard）原生支持触屏，适配 Mim Capacitor/小程序 webview 场景；无障碍内置；与自研 UI 不绑定 | 接入中等：`DndContext + useSortable` 模式，一个排序列表约半天；新旧两套包（旧 `@dnd-kit/core` 系 / 新 `@dnd-kit/react` 系）选型需先定 | **值得评估**（工具台/榜单排序首选） |
| SortableJS | https://www.npmjs.com/package/sortablejs ；https://github.com/SortableJS/Sortable | MIT（npm 页内 LICENSE 原文已核实） | 中。零依赖、框架无关的纯 JS 库，四端（web/capacitor/miniprogram/mock）一套代码最省心；核心仓库更新慢（约 2024-08 后活跃度低），但 API 稳定、生态极成熟 | 接入极轻：一个 `new Sortable(el, options)` 即完成排序，1-2 小时；缺点是直接操作 DOM，需自行同步回 React state | **值得评估**（若只做纯列表排序、不要花哨拖拽动效，比 dnd-kit 更省） |
| react-beautiful-dnd | https://github.com/atlassian/react-beautiful-dnd | Apache-2.0 | **不建议新项目采用**。Atlassian 官方维护声明（npm 镜像 README 转载原文已核实）：「继续被 Atlassian 产品重度依赖，但我们聚焦其他优先级，**无进一步特性开发计划**；仅做关键（安全）更新，不积极监控 issue/PR」——事实性维护冻结，且其 API 与新版 React 并发特性存在历史兼容问题 | —— | **不建议引入**（见结尾清单） |

---

## 四、日期时间（对照自研实现）

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| dayjs | https://day.js.org/ ；https://github.com/iamkun/dayjs | MIT（npm 已核实，v1.11.23） | **高**。官方标称 2KB（已核实官方），与 Moment 同 API，链式调用心智成本低；locale 按需引入（不用不进包），满足 Mim 时间戳友好显示（「3 分钟前」）、日期格式化、相对时间三类需求 | 接入极轻：替换自研 `formatTime` 类函数约 1 天；UTC/时区/relativeTime 插件按用取 | **值得评估→倾向采用**（自研日期函数若已超 ~300 行即值得换） |
| date-fns | https://date-fns.org/ ；https://github.com/date-fns/date-fns | MIT（npm 已核实） | 中高。函数式（`formatDistance(subDays(...))`），tree-shaking、100% TS 类型；tree-shaken 后量级第三方称约 10KB、完整 gzip 约 13.4KB（来自 eslint-plugin-you-dont-need-momentjs 对照表，**第三方称**，仅供量级参考）；locale 64 种 | 与 dayjs 二选一：函数式风格与 Mim `core/` 层纯函数取向更搭，但 API 记忆负担高于 dayjs | **仅参考/备选**（若团队偏好函数式则替 dayjs） |

---

## 五、图表（管理后台统计图表）

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Recharts | https://recharts.org/ （recharts.github.io）；https://github.com/recharts/recharts | MIT（npm 已核实，Copyright Recharts Group） | **高（后台首选）**。React 声明式 SVG 组件（`<LineChart><Line/></LineChart>`），与 Mim 自研 UI 的组件化写法一致；官方文档示例给出单个图表 entry tree-shaken ~9.5KB、min+gzip ~3KB（已核实官方） | 接入极轻：1 天内出柱状/折线/饼图；自定义 tooltip/配色以匹配自研主题即可 | **值得评估→倾向采用**（后台统计模块） |
| Apache ECharts | https://echarts.apache.org/ ；https://github.com/apache/echarts | Apache-2.0（npm 已核实，v6.1.0，2026-05-19 发布） | 中。能力最全（地图/关系图/大数据量渲染），但 npm 包 dist 达 53.1MB（未压缩，已核实官方），**必须走 `echarts/core` + 按需 register 模块**，否则包体积灾难；对 Mim 后台若只需常规统计图表则能力过剩 | 接入中等：按需引入封装一个 `<EChart>` 壳约 1-2 天；配 TS 类型与主题对齐自研色板 | **值得评估**（仅当需要地图/仪表盘级复杂图时） |
| AntV G2 | https://github.com/antvis/G2 | MIT（bestofjs 记录 antvis/G2 近 2 天仍有提交，已核实官方仓库活跃） | 中低。「图形语法」抽象学习曲线陡，其 React 绑定 `g2-react` 为薄壳；Mim 后台统计属常规图表，用不上 Grammer of Graphics 的表达力 | 学习成本高 | **仅参考** |

---

## 六、状态管理 / 数据获取（对照自研 data 层）

> **背景对照**：Mim 自研 data 层跑在通用 `REST /api/rest/:table` 接口上，即按表名 + 查询参数读写。通用接口意味着天然存在「同表多视图缓存一致性」「重复请求去重」「列表失效刷新」三类问题——这正是数据获取库解决的核心问题。

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| TanStack Query（@tanstack/react-query） | https://tanstack.com/query ；https://github.com/TanStack/query | MIT（npm 已核实，v5.101.2，周下载 ~5866 万） | **高价值但需试验**。官方明示 transport 无关（REST/GraphQL/promise 皆可），与 Mim 通用表接口天然契合：以 `['table', params]` 为 queryKey 即获得缓存、 stale-while-revalidate、窗口聚焦自动刷新、invalidate 联动；与自研 data 层不冲突——它管「缓存/调度」，Mim 保留自己的 fetch 封装（在 `queryFn` 里调用） | 接入中等偏大：需要在 `data/` 层加一层 QueryClient 封装、统一 queryKey 约定、处理 Capacitor/小程序端的网络差异；预估 3-5 天跑通一个模块再推广。**关键决策点**：通用表接口下写操作（POST/PUT/DELETE）的失效策略需要自己设计 | **值得评估**（本期最该做的一个技术验证） |
| zustand | https://github.com/pmndrs/zustand | MIT（npm 已核实，v5.0.15） | 中。极简 store，解决「跨组件共享 UI 状态」（如私信未读、VIP 面板状态）；但 Mim 已有七层分层与自研状态流，若现有 useReducer/context 未遇瓶颈，引入收益边际 | 接入轻（半天），但与自研状态范式并存会产生两套心智 | **仅参考**（除非自研 store 出现实际痛点） |
| jotai | https://www.npmjs.com/package/jotai | MIT（npm 已核实，v3.0.1，10 天前发布） | 中低。原子化状态粒度更细，但对中大型 SPA 的调试/序列化不如 zustand 直观；与 zustand 二选一，不同时引入 | —— | **仅参考** |

---

## 七、表单与校验（对照自研表单，尤其管理后台）

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| react-hook-form | https://react-hook-form.com/ ；https://github.com/react-hook-form/react-hook-form | MIT（npm 已核实，v7.91.0，15 小时前仍在发布，零运行时依赖） | **高**。Proxy 订阅模型，重渲染最少，性能取向与 Mim 自研轻量路线一致；与自研 UI 不冲突（它不管渲染，只管值/校验/错误） | 接入轻：包裹现有输入组件 1 天；与 zod 联用通过 `@hookform/resolvers` | **值得评估**（后台复杂表单（商品/VIP/工具台配置）收益明显；C 端简单表单可继续自研） |
| zod | https://zod.dev/ ；https://github.com/colinhacks/zod | MIT（npm 已核实） | **高**。TS-first 校验，v4 官方 benchmarks：整体 bundle 5.36KB gzip（v3 为 12.47KB），zod-mini 仅 2.12KB（已核实官方）；同时覆盖「前端表单校验」+「后端通用表接口返回数据的运行时类型收窄」两个场景，与 Mim REST 通用接口配套价值高 | 接入轻（1 天）；可先在 data 层对关键接口响应用，再推广到表单 | **值得评估→倾向采用** |
| valibot | https://valibot.dev/ ；https://github.com/fabian-hiller/valibot | MIT（官网 FAQ 已核实） | 中高。模块化/tree-shakable，官方卖点是「比 zod 更小」；API 与 zod 高度相似可互换 | 与 zod 二选一；生态/社区资源少于 zod | **仅参考**（zod 的轻量替代备选） |

---

## 八、其他高价值工具

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| clsx | https://www.npmjs.com/package/clsx | MIT © Luke Edwards（npm 已核实） | **极高**。条件 className 拼接，<1KB、零依赖，自研 UI 的 className 工具几乎必然重复造这个轮子 | 接入成本为零（一行 import） | **立即用** |
| es-toolkit | https://es-toolkit.dev/ ；https://github.com/toss/es-toolkit | MIT © Viva Republica（Toss，npm 已核实，v1.53.0，2 天前发布） | 高。官方称 tree-shaking 下代码量比 lodash 最多少 97%、运行快 2-3 倍，自带 `es-toolkit/compat` 兼容层可无痛替换 lodash（已核实官方）；TS 类型内置 | 轻；若 Mim `core/` 已有自研 utils 则按需补缺口函数即可，不必整体替换 | **值得评估**（自研 utils 出现重复轮子时） |
| lodash-es | https://www.npmjs.com/package/lodash-es | MIT（lodash 项目统一许可证） | 中。功能全但包体积远大于 es-toolkit，现代项目首选 es-toolkit | —— | **不建议引入**（被 es-toolkit 覆盖） |
| immer | https://www.npmjs.com/package/immer | MIT © Michel Weststrate（第三方 NOTICE 转载 LICENSE 已核实，v10.2/11.1） | 中。不可变更新的草稿语法，对嵌套 state 更新友好；但与 zustand 组合才最顺，单独在 React 中收益一般 | 轻 | **仅参考** |
| Embla Carousel（embla-carousel-react） | https://www.embla-carousel.com/ ；npm `embla-carousel-react` | MIT（npm 已核实） | **高**。Headless 轮播——只提供滚动/吸附逻辑，UI 全自研，与 Mim 首页横幅/直播位/资源卡片流视觉统一最契合；Swier 官方对比页称其核心 gzip ~3-5KB（来自 Swiper 官网对比页，**官方但为竞对口径**，仅供量级参考） | 接入轻（半天） | **立即用**（替代自研轮播；比 Swiper 更贴合自研 UI） |
| Swiper | https://swiperjs.com/ ；npm `swiper` | MIT（Swiper 中文官网已核实） | 中。功能最全（分页/导航/自动播放/懒加载内置），但自带完整 DOM 与样式体系，与自研 UI 定制自由度冲突；对比页称 modular gzip ~25-45KB（同上，竞对口径） | 接入快但样式二次定制成本在后头 | **仅参考**（Embla 被选中时不引入） |
| react-markdown | https://remark.js.org/ （remarkjs）；npm `react-markdown` | MIT © Espen Hovlandsdal（npm/GitHub LICENSE 已核实） | **高**。组件式渲染 Markdown，**默认不渲染 raw HTML（安全）**，对 UGC（动态/文章/代码片段预览）的 XSS 安全恰好对症；与自研 UI 通过 `components` 映射把 `<pre><code>` 接到自研代码块组件 | 接入轻（1 天）；GFM 表格/删除线加 remark-gfm 扩展 | **立即用**（UGC 渲染首选） |
| shiki | https://shiki.style/ ；npm `shiki` | MIT（GitHub LICENSE 已核实，v4.5.0，22 天前发布） | 高（代码片段模块高亮首选）。基于 TextMate 语法，着色准确度业界最佳；⚠️ 官方文档明示：full bundle 6.9MB min / 1.3MB gzip（异步分块按需加载，已核实官方）——**必须用 fine-grained 按需引入目标语言**（官方称合计传输约 200KB），否则包体积爆炸 | 接入中等：选语言子集 + 主题映射，约 1-2 天 | **值得评估→倾向采用**（按语言子集引入） |
| highlight.js | https://highlightjs.org/ ；npm `highlight.js` | **BSD-3-Clause**（npm 已核实，v11.12.0） | 高。更老牌更轻（common bundle ~10KB gzip 量级，官方 CDN 口径），许可证 BSD-3 与 MIT 同为宽松许可，商用无虞；着色准确度略逊 shiki 但对社区代码片段足够 | 接入轻（半天），可 CDN 也可 npm | **值得评估**（shiki 的轻量平替；两者择一） |

---

## 九、组件库对照（保持自研 UI vs 引入组件库）

| 资源名 | 官网/仓库 | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| Ant Design（antd） | https://ant.design/ ；npm `antd` | MIT（npm 已核实，v6.6.7，6 天前发布） | **低**。企业级后台组件最全，但其 FAQ 官方明示为样式便利**会注入不可移除的全局样式**——与 Mim 已成型的自研轻量 UI 直接体系冲突；迁移等于推翻 `ui/` 层 | 极高（全量重写） | **仅参考**（后台复杂组件的交互模式可借鉴设计） |
| Arco Design（@arco-design/web-react） | https://arco.design/ ；npm `@arco-design/web-react` | MIT（npm README 已核实，ByteDance 出品） | 低。同为企业级组件体系，与 antd 同类冲突；中文文档友好是唯一相对优势 | 极高 | **仅参考** |
| shadcn/ui | https://ui.shadcn.com/ ；https://github.com/shadcn-ui/ui | MIT（Vercel 官方说明 + GitHub LICENSE 已核实） | 低。「源码拷贝进项目」模式本最贴合 Mim 自研哲学，但其组件全部构建在 **Tailwind CSS + Radix UI** 之上——Mim 无 Tailwind，引入等于同时引入整套原子 CSS 范式，得不偿失 | 高（需先引入 Tailwind） | **仅参考**（其无障碍 Radix 底层组件的设计思路可借鉴；若未来引入 Tailwind 再重评） |

**组件库维度明确结论**：Mim 已自研 UI 且运行时依赖刻意保持极简（仅 react/react-dom/@capacitor），此时引入任何大组件库都是「体系冲突 > 组件红利」。维持自研轻量 UI 路线，需要复杂组件（如树选择、虚拟表格）时按「组件级单点引入」处理（参考 TanStack Virtual 的 headless 模式），而非引入整套设计系统。

---

## 十、不建议引入清单（含原因）

| 不建议引入 | 原因 |
|---|---|
| react-beautiful-dnd | Atlassian 官方声明无特性开发计划、仅做关键安全更新（事实性维护冻结），且与新版 React 并发模型存在历史兼容问题；新项目应选 dnd-kit |
| Quill 官方版（slab/quill） | 最新 2.0.3 约 2 年前发布后停滞；自带主题与自研 UI 冲突；许可证为 BSD-3（非网络上某些第三方站点声称的 MIT，注意甄别） |
| Moment.js（及任何 moment 衍生） | 官方自身已停止新特性开发（legacy 状态），被 dayjs/date-fns 取代；Mim 若自研日期实现，替换方向是 dayjs 而非 moment |
| lodash / lodash-es 整体引入 | 现代 bundle 下体积远大于 es-toolkit；需要工具函数时按需从 es-toolkit 取 |
| Ant Design / Arco Design 全量引入 | 注入全局样式、与自研 UI 体系冲突；迁移成本等于重写 `ui/` 层 |
| shadcn/ui 直接引入 | 强依赖 Tailwind + Radix，Mim 无 Tailwind 技术栈；仅作设计参考 |
| TanStack Query 全量替换自研 data 层（一刀切） | 应先在 1 个模块做接入试验，验证通用 `:table` 接口下 queryKey 约定与失效策略可行后再推广；直接替换风险高 |
| ECharts 全量包（不经按需引入） | dist 未压缩 53MB，必须 `echarts/core` 按需 register；否则与 Mim 极简依赖哲学冲突 |
| shiki full bundle | 6.9MB min / 1.3MB gzip，必须 fine-grained 只引用到语言；后台/社区代码片段模块若量小，直接 highlight.js 即可 |
| zustand + jotai 同时引入 | 同一类需求的两套范式，二选一即可；且 Mim 现有状态流未报告痛点，优先级最低 |

---

## 十一、来源 URL（去重后汇总，检索日期 2026-10-29）

**虚拟化**
1. https://tanstack.com/virtual/latest
2. https://www.npmjs.com/package/@tanstack/react-virtual
3. https://tanstack.com/blog/tanstack-virtual-perf-and-ios
4. https://www.npmjs.com/search?q=react-window
5. https://npmmirror.com/package/react-window/deps
6. https://virtuoso.dev/
7. https://www.npmjs.com/package/react-virtuoso

**编辑器**
8. https://tiptap.dev/
9. https://www.npmjs.com/package/@tiptap/react
10. https://lexical.dev/
11. https://www.npmjs.com/package/lexical
12. https://www.npmjs.com/package/quill
13. https://quilljs.com/

**拖拽**
14. https://dndkit.com/
15. https://www.npmjs.com/package/@dnd-kit/react
16. https://www.npmjs.com/package/sortablejs
17. https://github.com/SortableJS/Sortable
18. https://github.com/atlassian/react-beautiful-dnd

**日期**
19. https://day.js.org/
20. https://www.npmjs.com/package/dayjs
21. https://date-fns.org/
22. https://www.npmjs.com/package/date-fns

**图表**
23. https://echarts.apache.org/
24. https://www.npmjs.com/package/echarts
25. https://recharts.org/
26. https://www.npmjs.com/package/recharts
27. https://github.com/antvis/G2

**状态/数据获取**
28. https://tanstack.com/query
29. https://www.npmjs.com/package/@tanstack/react-query
30. https://www.npmjs.com/package/zustand
31. https://www.npmjs.com/package/jotai

**表单/校验**
32. https://react-hook-form.com/
33. https://www.npmjs.com/package/react-hook-form
34. https://zod.dev/
35. https://www.npmjs.com/package/zod
36. https://valibot.dev/

**工具/轮播/Markdown/高亮**
37. https://es-toolkit.dev/
38. https://www.npmjs.com/package/es-toolkit
39. https://www.npmjs.com/package/lodash-es
40. https://www.npmjs.com/package/clsx
41. https://www.npmjs.com/package/immer
42. https://swiperjs.com/
43. https://www.npmjs.com/package/embla-carousel-react
44. https://www.npmjs.com/package/react-markdown
45. https://shiki.style/
46. https://www.npmjs.com/package/shiki
47. https://highlightjs.org/
48. https://www.npmjs.com/package/highlight.js

**组件库**
49. https://ant.design/
50. https://www.npmjs.com/package/antd
51. https://arco.design/
52. https://www.npmjs.com/package/@arco-design/web-react
53. https://ui.shadcn.com/
54. https://vercel.com/i/what-is-shadcn

---

*报告完。所有许可证与维护状态以 2026-10-29 检索到的 npm 官方页 / GitHub 仓库 / 官方文档为准；包体积数字凡标注「官方」者出自库官方文档或博客，标注「第三方称/竞对口径」者仅供量级参考。*
