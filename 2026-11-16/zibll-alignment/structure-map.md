# zibll V9.2 → apps/web 结构映射与差异表

> 素材：`E:\迅雷下载\zibll-V9.2(1651)\zibll`（WordPress 主题包，不做运行时移植）
> 目标：`apps/web`（React + 纯 CSS，零第三方 UI 库）
> 原则：只学结构、样式与交互；不引入 PHP / jQuery / 授权校验；品牌蓝 `#3b6ef5` 与全彩体系保留。

---

## 一、素材盘点

| 路径 | 职责 | 本项目的用法 |
| --- | --- | --- |
| `header.php` / `footer.php` / `sidebar.php` | 三段式外壳 | 复刻为顶栏 + 内容两栏 + 多列页脚 |
| `index.php` / `category.php` / `archive.php` / `search.php` / `tag.php` / `author.php` | 列表页族 | 对应社区列表、图库/视频、作者聚合 |
| `single.php` / `template/single-*.php` | 内容详情 | 对应帖子详情、付费资产详情 |
| `page.php` | 静态页 | 对应后台装修的 PageBlocks 区块页 |
| `404.php` | 空态 | 对应统一空态插图与回退出口 |
| `template/excerpt.php` + `inc/functions/zib-posts-list.php` | 列表项 / 卡片生成器 | 卡片与列表项形态的唯一真源 |
| `pages/user-sign.php`、`pages/user-auth.php` | 登录注册 | 对应 `/signin` |
| `zibpay/` | 付费面板与解锁流程 | 对应收银台、付费墙 |
| `oauth/` | 第三方登录按钮 | 对应登录页社交登录条 |
| `css/main.css` | 设计令牌 + 组件样式 | 令牌与形态取值来源 |
| `fonts/`、`img/` | 字体与静态素材 | 直接复用（见第五节） |

---

## 二、结构映射与差异

| # | zibll 模板 | apps/web 对应 | 现状 | 形态差异（要改的点） |
| --- | --- | --- | --- | --- |
| 1 | `header.php` | `App.tsx` 的 `.sidebar`（232px 深色左栏） | 导航竖排在左栏，品牌在顶，用户区在底 | zibll 是**顶部横导航**：`padding 8px 20px`、吸顶、滚动后 `0 4px 10px` 阴影、`backdrop-filter` 毛玻璃（`--blur-bg: rgba(255,255,255,.8)`）；导航项 `padding 10px`、`radius 4px`、二级下拉、右侧用户区 + 登录按钮 + 搜索框；logo 高 36px。Mim 缺：横向一级/二级层级、搜索入口、吸顶反馈 |
| 2 | `sidebar.php` + `inc/widgets/*` | 无（全部内容堆在单列） | 无右栏 | zibll 内容区是 `main 1200px` 两栏：正文列 + 右栏 widget 卡片（标题带 4px 主色左条 + 微光 `.title-theme:before`，卡内 `padding 15px`）。Mim 需补右栏承载「热门帖 / 板块导航 / 作者榜 / 站点统计」 |
| 3 | `index.php` + `template/excerpt.php` | 社区「论坛」页签列表 | 单列纵向卡片，封面比例 10:7，整卡点击 | zibll 列表项是**横向结构**：`.posts-item.list` `padding 20px`、`margin 15px 0`、`radius 8px`、`shadow 0 0 10px`、`transition .2s`；左缩略图 `width 190px`、`padding-bottom 70%`（≈10:7）、`margin-right 20px`；右侧垂直分布：标题 `18px/1.4` 两行截断 → 摘要两行 → 底部 meta 行（左：`avatar-mini` + 作者 + 时间；右：付费徽章 + 阅读数）→ 标签行 `11px / padding 2px 5px` |
| 4 | `.posts-item.card` | 图库 / 视频网格、精选卡片 | 网格存在但内部结构偏「信息框」 | zibll 卡片：`width calc(33.333% - 16px)`、`margin 8px`、`padding 10px`；封面 100% 宽 + 70% 高；正文 `margin-top 10px`；标题 `14px` 且 `min-height 2.8em`（**等高对齐**）；meta `12px`；`style2` 变体默认透明、hover 才浮出背景与阴影 |
| 5 | `category.php` / `archive.php` / `search.php` | 社区筛选栏 + 页签 + 排序条 | chips 行 + 页签 | zibll 页面头部是「大标题 + 描述 + 统计 + 面包屑」整体块，再是排序条；筛选与排序是**两级**：分类条在上、排序/视图切换在下。Mim 目前压成一行，层级不足 |
| 6 | `single.php` | 帖子详情 / 付费资产详情 | 标题 + 正文 + 操作 | zibll 详情：`content-wrap` + `content-layout` + 右栏；顶部封面 `--single-cover-scale: 35%`；标题区含分类 chip、标题、meta 行（头像 + 作者 + 时间 + 阅读）；正文 `wp-posts-content` 有独立 h2/h3 排版；末尾标签行 + 作者卡 + 相关推荐 + 评论模块 |
| 7 | `page.php` | `PageBlocks` 装修区块页 | 区块堆叠 | zibll 页面是「宽内容 + 评论」，区块之间用 `box-body padding 15px` 分隔；Mim 的区块间距偏大且缺统一表面层 |
| 8 | `footer.php` | `.app-footer` 单行 | 一行版权 | zibll 页脚 `padding 30px`、`font-size 13px`、`color --muted-2`、背景同主表面；内部 `list-inline` 三列（品牌/描述 · 链接列 · 联系方式与二维码右对齐），列内 `margin 5px 15px`，链接 hover 走主色 |
| 9 | `pages/user-sign.php` | `/signin` 登录页 | 居中卡片 + 分段表单 | zibll 登录是**左右分栏**：左侧插画/logo（占 45%），右侧表单 `max-width 330px`；输入是**下划线式**（`padding 0 2em .3em .3em`、`margin-top 1.7em`，只留底边）；社交登录是一排 `32px` 圆形图标按钮；验证码按钮内嵌在输入行右侧 |
| 10 | `author.php` | 账号页 / 图库作者聚合 | 资料表单 | zibll 作者页有头图 + 头像 + 昵称 + 等级徽章 + 三列统计 + 内容列表，Mim 缺这套「人物卡」 |
| 11 | `zibpay/` | 收银台 / 付费墙 | 价格 + 解锁按钮 | zibll 付费面板有价格阶梯（VIP 价 / 原价划线）、权益列表、主次按钮层级（实心主按钮 + 幽灵次按钮） |
| 12 | `404.php` + `img/null-*.svg` | 各页空态/错误态 | 文本空态 | zibll 用 `null.svg`/`null-search.svg`/`null-post.svg` 等插图 + 标题 + 说明 + 回退按钮 |
| 13 | `oauth/` | 登录页第三方登录 | 无或文本按钮 | zibll 为圆形品牌图标条 `32px`，hover 抬升 |

---

## 三、设计令牌对照

### 3.1 颜色

| 语义 | zibll 实际值 | Mim 现值 | 动作 |
| --- | --- | --- | --- |
| 主题色 | `#f04494`（可后台改） | `#3b6ef5`（后台可改） | **保持 Mim 品牌蓝** |
| 焦点/链接 | `--focus-color` = 主题色 | `--link: hsl(222 74% 36%)` | 保留 Mim（对比度更好） |
| 主文字 | `#333` | `--text` | 保留 |
| 正文文字 | `#4e5358` | `--text-secondary` | 保留 |
| 次级/弱文字 | `#777` / `#999` / `#b1b1b1` | `--text-muted` 等 | 保留，补一档 `#b1b1b1` 级 |
| 页面底色 | `#f5f6f7` | `#f1f2f4`（带色相混合） | 建议对齐 `#f5f6f7` 基调但**保留色相偏移**（全彩要求） |
| 一级表面 | `#fff` | `color-mix(#fff 97%, 主色)` | 保留 Mim 的微色相表面 |
| 次级表面 | `#eee` / `#f6f7f8` | `--surface-2/3` | 保留 |
| 描边 | `rgba(50,50,50,.06)` | 边框令牌 | 对齐为更浅的 hairline |
| 阴影色 | `rgba(116,116,116,.08)` | `rgba(17,24,39,.05~.11)` | 阴影值改为 zibll 的**低对比大范围** `0 0 10px` |
| 功能色板 | red `#ff5473` / orange `#ff6f06` / blue `#2997f7` / indigo `#5c7cff` / cyan `#08c4c1` / green `#12b928` / purple `#d448f5` / gray `#818b95` | Mim 已有 danger/success/warning/info/violet/premium | 保留 Mim 语义色，**新增一组「板块色相」**用于徽章与标签，保证全彩 |

### 3.2 形状 / 排版 / 节奏

| 令牌 | zibll | Mim | 差异 |
| --- | --- | --- | --- |
| 内容宽度 | `--mian-max-width: 1200px` | `--page-max: 1200px` | 一致 |
| 主圆角 | `--main-radius: 8px`，`--mini-radius: 5.7px` | `--radius: 8px`（默认，后台可调），`--radius-lg: 12px`（主推 / 详情卡） | 默认已对齐 8px，见「七、收口结论」 |
| 卡片内边距 | `20px`（列表）/ `10px`（卡片）/ `15px`（widget） | `--card-pad: 16px` | 需区分三档，不再统一 16 |
| 封面比例 | 列表 190×70%、卡片 100%×70%、详情 35% | `--card-cover: 10/7` | 比例一致，**尺寸与出现位置**不同 |
| 正文字号 | 15px 级 | `--fs-base: 14px` | Mim 偏小一档，正文可提至 15 |
| 标题阶梯 | 列表标题 18 / 卡片标题 14 / 区块标题 15~20 | 22 / 18 / 16 | 需补「列表标题 18」与「卡片标题 14」两档 |
| 行高 | 标题 1.4em，正文 1.7~1.8 | `1.35 / 1.45 / 1.75` | 正文行高需放宽 |
| 间距节奏 | 15 / 20 / 30 为主 | 4/8/12/16/20/24/32 | 保留 Mim 阶梯，但卡片间距改用 `15px` 节奏 |
| 过渡 | 卡片 `.2s`、hover `.3s`、头部 `.15s` | `--dur 200ms` + 统一 transition | 补「卡片 hover 0.3s / 头部 0.15s」两档 |
| 缓动 | 以 ease 为主 | `cubic-bezier(.28,.9,.34,.99)` | 保留 Mim 曲线 |
| 暗色底 | `#292a2d` / 表面 `#323335` / 次级 `#2d2e31` | `--theme-bg-dark: #292a2d` | 底色已对齐，补表面层级与描边 `rgba(114,114,114,.1)` |

---

## 四、组件形态差异（按可复用件）

| 组件 | zibll 形态 | Mim 现状 | 改造要点 |
| --- | --- | --- | --- |
| 列表项 | 左图右文，图 190px、文三行（标题/摘要/meta） | 上图下文 | 新增 `thread-item--row` 形态，缩略图 190px + 20px 间距 |
| 卡片 | 3 列，`calc(33.333% - 16px)`，标题等高 2.8em | 网格 300px 起 | 网格列宽改按三分栏，标题占位锁定 |
| 按钮 | `.but`：`padding .3em .6em`、`radius 4px`、半透明底 `rgba(136,136,136,.1)`、hover 仅降透明度、active 内阴影；`.radius` 为 50px 药丸 | `.btn` 34px 高、实心为主 | 拆出「实心主 / 描边 / 幽灵 / 药丸」四档层级，hover 不做位移动画 |
| 徽章 | 封面左上角叠加，`scale(.85)` 微调，功能色成组 | 有 badge 但混用 | 统一封面角标 + 语义色映射 |
| 头像 | 多尺寸 + 角标叠加（VIP/等级） | 单尺寸圆形 | 补 18/24/32/40 四档 + 角标槽位 |
| 标签 | `11px`、`padding 2px 5px`、圆角小、色淡 | 12px 胶囊 | 标签改小号方标签，胶囊只留给筛选项 |
| 分页 | 数字分页 + 「加载更多」 | 加载更多 | 列表底部补页码分页（保留加载更多） |
| 导航 | 顶部一级 + hover 二级下拉 | 左侧单层 | 改顶栏，二级下拉用 `--surface` + `--shadow-lg` |
| 页脚 | 三列 widget + 版权行 | 单行 | 拆「品牌 / 导航列 / 联系方式」三区 |
| 空态 | SVG 插图 + 标题 + 说明 + 按钮 | 文本 | 复用 `null-*.svg` |
| 悬浮反馈 | 卡片 `translateY(-2px)` + 阴影加深、封面 `scale(1.05)` | 仅阴影 | 补位移与封面缩放 |

---

## 五、可直接复用的静态素材

| 类别 | 文件 | 用途 |
| --- | --- | --- |
| 字体 | `fonts/fontawesome-webfont.{woff,ttf,svg,eot}` | 图标字体（自托管，无需外链） |
| 字体 | `fonts/img-code.ttf`、`fonts/lg.svg` | 符号图标 |
| 空态 | `img/null.svg`、`null-search.svg`、`null-post.svg`、`null-love.svg`、`null-order.svg`、`null-money.svg`、`null-user.svg`、`null-set.svg`、`null-cap.svg`、`null-2.svg` | 各视图空态 |
| 占位 | `img/thumbnail.svg`、`thumbnail-sm.svg`、`thumbnail-lg.svg`、`spare-pic.svg`、`404.svg` | 封面缺图占位、404 |
| 身份 | `img/avatar-default.png`、`vip-1.svg`、`vip-2.svg`、`user-level-1..10.png`、`medal/*.svg` | 默认头像、VIP 与等级角标 |
| 消息 | `img/msg-*.svg` | 通知分类图标 |
| 装饰 | `img/slide.jpg`、`slider-bg.jpg`、`slider-layer-1/2.png`、`topic.jpg` | 首屏氛围层 |

> 授权：用户持有正版授权（域名 `laal.top`，至 2026-12-16），素材与结构可合法复用；**授权码不写入仓库**，不移植授权校验代码。

---

## 六、实施顺序（每页做完即上线取证）

1. **外壳**：顶栏（横导航 + 二级 + 用户区）+ 内容两栏 + 多列页脚 —— 三个核心页共用，先落地。
2. **首页**：hero 区 → 板块色相入口卡 → 精选卡片（`.posts-item.card` 形态）→ 右栏 widget。
3. **社区**：页头（标题/统计/排序两级）→ 列表项横排形态 → 分页 → 空态插图。
4. **登录**：左插画右表单分栏 + 下划线输入 + 圆形社交按钮。

## 七、收口结论（2026-11-19 代码现状）

1. **卡片圆角（已收口）**：默认 `--theme-radius: 8px`（zibll 口径），后台 `--theme-*` / `--radius` 覆盖通道保留；主推卡 / 详情卡 / 弹窗走 `--radius-lg: 12px` 大一档。令牌见 `apps/web/src/tokens.css`。
2. **移动端底 Tab（已收口）**：`Shell.tsx` 的 `.mobile-tabs` 在 ≤760px 显示，图标 + 短文案，选中态跟随当前视图；顶部横导航外壳已替换原左侧深色栏。
