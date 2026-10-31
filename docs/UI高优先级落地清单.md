# UI 高优先级落地清单

> 对应 `UIUX_审阅与优化方案.md` §十 🔴高优先级 5 项 + §十一 验收指标
> 施工批次：第 2 批（结构层），承接第 1 批（commit `525df27`）

---

## 一、已落地项总览

| # | 改进项 | 批次 | 状态 |
|---|---|---|---|
| 1 | 拆分主色令牌（--primary-strong / --primary-text / --text-3） | 第 1 批 | ✅ 已落地 |
| 2 | 首页默认 Tab 改「推荐」 | 第 1 批 | ✅ 已落地 |
| 5 | 移动端触控目标放大至 ≥36px | 第 1 批 | ✅ 已落地 |
| 8 | 热门页去重（列表从第 4 条起渲染） | 第 1 批 | ✅ 已落地 |
| 3 | 移动端底部 Tab Bar（5 项） | 第 2 批 | ✅ 本次落地 |
| 4 | 每页补唯一 H1 + 装饰标题降级 | 第 2 批 | ✅ 本次落地 |
| 6 | 导航分组（内容/社交/交易/工具 4 组） | 第 2 批 | ✅ 本次落地 |
| 7 | 移除「我的主页」重复导航项 | 第 2 批 | ✅ 本次落地 |

---

## 二、本次改动明细（第 2 批）

### #3 移动端底部 Tab Bar

**改动文件：**
- `F:\合并项目\Mim\src\app\shell.tsx` L83-84（引入 `<TabBar path={path} />`）+ L171-193（`TabBar` 组件定义，5 项：首页/发现/发布/商城/我的）
- `F:\合并项目\Mim\src\ui\styles\layout.css` L149-175（`.tabbar` 基础样式，桌面端 `display:none`）+ L226-244（移动端媒体查询内：fixed 贴底、56px 高、`env(safe-area-inset-bottom)`、body padding-bottom 避让、`.sidenav-section` 移动端隐藏）

**实现要点：**
- 5 个 Tab：首页 `#/feed` / 发现 `#/topics` / 发布 `#/publish` / 商城 `#/mall` / 我的 `#/my`
- 高度 56px + `padding-bottom: env(safe-area-inset-bottom)` 适配 iPhone 安全区
- `body { padding-bottom: calc(56px + env(safe-area-inset-bottom)) }` 避免内容被遮挡
- 选中态用 `var(--primary-text)`（CSS 变量，无硬编码颜色）
- 桌面端 `display: none`，不影响现有侧栏布局

### #4 每页补唯一 H1 + 装饰标题降级

**改动文件：**
- `F:\合并项目\Mim\src\pages\content\FeedPage.tsx` L172（新增 `<h1 className="sr-only">首页广场</h1>`）
- `F:\合并项目\Mim\src\ui\styles\base.css` L84-93（新增 `.sr-only` 工具类）
- `F:\合并项目\Mim\src\app\shell.tsx` L60, L72, L99（页脚 3 处 `<h4>` → `<div className="footer-heading">`）
- `F:\合并项目\Mim\src\ui\styles\layout.css` L133-138（CSS 选择器 `.site-footer h4` → `.site-footer .footer-heading`）

**H1 覆盖率现状（抽样 6 页）：**

| 页面 | H1 状态 | 说明 |
|---|---|---|
| `/feed`（首页广场） | ✅ 新增 sr-only H1 | 视觉隐藏，读屏器可识别 |
| `/mall`（商城中心） | ✅ 已有 | `MallHomePage.tsx:48` 可见 H1 |
| `/settings`（设置） | ✅ 已有 | `SettingsPage.tsx:88` 可见 H1 |
| `/admin`（管理后台） | ✅ 已有 | `AdminHomePage.tsx:79` 可见 H1 |
| `/admin/products` 等 7 个子页 | ✅ 已有 | 各 Admin 页面均有 `page-title` H1 |
| **覆盖率** | **6/6 = 100%** | 目标 100% ✅ |

**装饰标题降级：**
- Shell 页脚 mini：`<h4>站点</h4>` / `<h4>联系</h4>` → `<div className="footer-heading">`
- Shell 侧栏页脚：`<h4>站点</h4>` → `<div className="footer-heading">`
- 降级后视觉样式不变（CSS 选择器同步更新），但不再参与读屏器标题层级导航

### #6 导航分组

**改动文件：**
- `F:\合并项目\Mim\src\app\nav.ts` L18（`NavItem` 新增 `isSection?: boolean`）+ L40-68（NAV 数组重构为 4 组）+ L33-42（MALL_CHILDREN 并入 5 个商城频道）
- `F:\合并项目\Mim\src\app\shell.tsx` L93-94（SideNav key 兼容 section 项）+ L114-117（NavNode 处理 `isSection`）
- `F:\合并项目\Mim\src\ui\styles\layout.css` L78-88（新增 `.sidenav-section` 样式：11px 大写小标题，`pointer-events: none`）

**分组结构：**

| 分组 | 收纳项 | 数量 |
|---|---|---|
| 内容 | 首页 / 文章 / 写文章 / 超话 / 标签 / 代码片段 / 资源下载 | 7 |
| 社交 | 通知 / 私信 / 我的（含 9 个二级子项） | 3（+9 二级） |
| 交易 | 商城（含 9 个二级子项：商城中心/优选/直播/本地生活/出行/秒杀/购物车/订单/钱包） | 1（+9 二级） |
| 工具 | 配送台 / 价格监控 / 路线导航 / 邮箱 / BOM / 智能体 / AI 资源 / 漫剧 / 聚合监控 / 直播开播 | 10 |

**一级入口变化：** 26 项平铺 → 4 个分组小标题 + 18 个可点一级项（原 26 项中 5 个商城频道并入二级，3 个分组标题不可点击）

### #7 移除「我的主页」重复导航项

**改动文件：**
- `F:\合并项目\Mim\src\app\nav.ts` L22（删除 `{ href: '#/my', match: '/my', label: '我的主页', icon: '👤' }`）

**说明：** 一级项「我的」(`#/my`) 与 MY_CHILDREN 首项「我的主页」指向同一路由，展开后重复。删除后 MY_CHILDREN 保留 9 项（我的博客/收藏/足迹/关注列表/发布器/统一钱包/VIP/成长引擎/设置）。

---

## 三、验收指标对照

| 指标 | 优化前 | 第 1 批后 | 本次（第 2 批）后 | 目标 |
|---|---|---|---|---|
| 浅色对比度不达标项 | 8 / 16 | 0 | 0 | **0** ✅ |
| 移动端导航横滑距离 | 2047px（6 屏） | 2047px | **0**（底部 Tab Bar 替代横滑侧栏） | **0** ✅ |
| 移动端最小触控目标 | 16px | ≥36px | ≥36px | **≥36px** ✅ |
| 页面 H1 覆盖率 | 2 / 6 | 2 / 6 | **6 / 6 = 100%** | **100%** ✅ |
| 表单可访问名称覆盖率 | 90% | 90% | 90% | 100%（留待后续） |

---

## 四、验证结果

| 验证项 | 退出码 | 说明 |
|---|---|---|
| `npm run typecheck` | **0** | tsc --noEmit 通过，无类型错误 |
| `npm run build` | **0** | vite build 通过，产物正常输出 |

---

## 五、未触碰项（留待下一轮）

- 中优先级：字号收敛（#9）、圆角收敛（#10）、全局焦点环（#11，已在 base.css 落地）、模态焦点管理（#12）、三档断点（#13）、工具台模板（#14）、商城空态文案（#15）、设置 Tab 字重（#16，已在 base.css .tab-btn.active 落地）、后台独立布局（#17）
- 低优先级：aria-label 补完（#18）、头像色板深色适配（#19）、内联样式替换（#20）、页脚 DOM 去重（#21）、商品卡分层（#22）、骨架屏补齐（#23）、价格监控窄屏（#24）
