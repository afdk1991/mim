# Mim Design Token 规范

| 项 | 值 |
| --- | --- |
| 版本 | v0.1 |
| 状态 | 草案（已逐行核对 `src/ui/styles/*.css` 与 `src/core/theme.ts`，未发明任何 token） |
| 负责人 | UI/UX（设计）主责 / PM（评审） / QA（一致性复核） |
| 日期 | 2026-10-30 |
| 事实来源 | `src/ui/styles/theme.css`、`src/ui/styles/base.css`、`src/ui/styles/components.css`、`src/ui/styles/layout.css`、`src/core/theme.ts`、`src/platform/types.ts:17` |

---

## 0. 现状一句话结论

当前**只有一套 CSS 变量体系，且只覆盖颜色、圆角、阴影、最大宽度四类**（全部定义在 `src/ui/styles/theme.css:8-36` 的 `:root` 与 `theme.css:38-62` 的 `html[data-theme='dark']`）。
**字号、行高、间距、层级（z-index）、动效时长与缓动目前全部硬编码在组件样式里**，没有变量化。
主题模式**只有 `light` 与 `dark` 两种**（`src/platform/types.ts:17`），**没有 `auto`（跟随系统）模式**——系统偏好仅在「用户从未手动选择过」时被 `getTheme()` 读取一次（`src/core/theme.ts:19-23`）。

---

## 1. 颜色（Color）

### 1.1 已实现

| 现状变量名 | 取值（light） | 取值（dark） | 语义化建议名 | 状态 |
| --- | --- | --- | --- | --- |
| `--primary` | `#ff8200` | `#ff9a33` | `color.brand.default` | 已实现 |
| `--primary-deep` | `#e06400` | `#ffb066` | `color.brand.deep`（hover/按下） | 已实现 |
| `--primary-weak` | `rgba(255, 130, 0, 0.12)` | `rgba(255, 154, 51, 0.16)` | `color.brand.subtle`（选中底色） | 已实现 |
| `--text` | `#1f2328` | `#e6edf3` | `color.text.primary` | 已实现 |
| `--text-2` | `#4a5158` | `#b9c2cc` | `color.text.secondary` | 已实现 |
| `--text-3` | `#8b949e` | `#8b949e`（两模式同值） | `color.text.tertiary` | 已实现 |
| `--bg` | `#ffffff` | `#0d1117` | `color.bg.canvas` | 已实现 |
| `--bg-soft` | `#f6f8fa` | `#161b22` | `color.bg.subtle` | 已实现 |
| `--card` | `#ffffff` | `#161b22` | `color.bg.card` | 已实现 |
| `--card-2` | `#f6f8fa` | `#1c2129` | `color.bg.card-nested` | 已实现 |
| `--line` | `rgba(128, 128, 128, 0.2)` | `rgba(255, 255, 255, 0.12)` | `color.border.subtle`（分隔线） | 已实现 |
| `--border` | `rgba(128, 128, 128, 0.28)` | `rgba(255, 255, 255, 0.16)` | `color.border.default`（控件描边） | 已实现 |
| `--danger` | `#e64340` | `#ff7b72` | `color.status.danger` | 已实现 |
| `--danger-weak` | `rgba(230, 67, 64, 0.12)` | `rgba(255, 123, 114, 0.16)` | `color.status.danger-subtle` | 已实现 |
| `--success` | `#2da44e` | `#3fb950` | `color.status.success` | 已实现 |
| `--warn` | `#d29922` | `#e3b341` | `color.status.warning` | 已实现 |

来源：`theme.css:9-35`（light）、`theme.css:39-61`（dark）。

### 1.2 建议新增

| 建议名 | 建议取值 | 理由 | 状态 |
| --- | --- | --- | --- |
| `--on-primary` | `#ffffff` | 主色按钮上的文字色当前在 `base.css:130`、`:145` 硬编码 `#fff` | 建议新增 |
| `--success-weak` | `rgba(45, 164, 78, 0.12)` | 成功态底色缺失，`--danger-weak` 有对应但 success 没有 | 建议新增 |
| `--warn-weak` | `rgba(210, 153, 34, 0.12)` | 同上，警告态底色缺失 | 建议新增 |
| `--disabled` | `rgba(128, 128, 128, 0.5)` | 禁用态目前用 `opacity: 0.5` 表达（`base.css:122-125`），跨端渲染不一致 | 建议新增 |
| `--overlay` | `rgba(0, 0, 0, 0.45)` | 遮罩色硬编码于 `base.css:310`；Toast 底色另硬编码 `rgba(0,0,0,0.82)`（`base.css:367`） | 建议新增 |
| `--focus-ring` | 取 `--primary` | 当前仅 `.input:focus` 改边框色（`base.css:258-260`），无统一焦点环 | 建议新增 |

### 1.3 使用铁律（沿用 `theme.css:1-6` 的既有约定）

> 组件样式里禁止出现硬编码颜色值，一律引用变量，否则深色模式下必然出现「深色背景上的深色文字」。

当前已确认的硬编码例外（**待改造**，见第 8 节缺口表）：`base.css:130`、`base.css:145`、`base.css:310`、`base.css:367`。

---

## 2. 字号与行高（Typography）

### 2.1 已实现

**无。** 当前没有任何字号/行高的 CSS 变量，全部为字面量。

### 2.2 现状字面量盘点（改造依据）

| 场景 | 字号 | 行高 | 字重 | 出处 |
| --- | --- | --- | --- | --- |
| body 基准 | 14px | 1.6 | 400 | `base.css:20-21` |
| 按钮默认 | 13px | 继承 | 继承 | `base.css:114` |
| 按钮小号 `.btn-sm` | 12px | 继承 | 继承 | `base.css:150` |
| 图标按钮 `.icon-btn` | 16px | — | — | `base.css:166` |
| 页标题 `.page-title` | 18px | — | 600 | `base.css:190-191` |
| 区块标题 `.section-title` | 14px | — | 600 | `base.css:196-197` |
| 标签 `.tag` | 12px | — | — | `base.css:219` |
| chip | 13px | — | — | `base.css:236` |
| 输入 `.input` | 14px | — | — | `base.css:254` |
| Tab `.tab-btn` | 14px | — | — | `base.css:283` |
| 空态 emoji | 34px | — | — | `base.css:302` |
| 弹窗头 `.modal-head` | 15px | — | 600 | `base.css:334-335` |
| Toast | 13px | — | — | `base.css:369` |
| 侧栏品牌 | 16px | — | 700 | `layout.css:34-35` |
| 侧栏链接 | 13px | — | 400 | `layout.css:47` |
| 侧栏徽标 | 11px | 18px | — | `layout.css:85-86` |
| 页脚 | 12px | — | — | `layout.css:123` |

### 2.3 建议新增

| 建议名 | 建议取值 | 对应现状 | 状态 |
| --- | --- | --- | --- |
| `--fs-xs` | `11px` | 侧栏徽标 | 建议新增 |
| `--fs-sm` | `12px` | `.btn-sm` / `.tag` / 页脚 | 建议新增 |
| `--fs-md` | `13px` | 按钮 / chip / Toast / 侧栏链接 | 建议新增 |
| `--fs-base` | `14px` | body / `.input` / `.tab-btn` / `.section-title` | 建议新增 |
| `--fs-lg` | `15px` | `.modal-head` | 建议新增 |
| `--fs-xl` | `18px` | `.page-title` | 建议新增 |
| `--lh-base` | `1.6` | body | 建议新增 |
| `--font-sans` | 现有字体栈 | `base.css:18-19` 的 `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif` | 建议新增 |

---

## 3. 间距（Spacing）

### 3.1 已实现

**无。** 无间距变量。

### 3.2 现状字面量盘点

| 场景 | 取值 | 出处 |
| --- | --- | --- |
| 通用 flex gap | 8px | `base.css:77`、`base.css:91` |
| 按钮 padding | `7px 14px` | `base.css:109` |
| 按钮 gap | 6px | `base.css:108` |
| 小按钮 padding | `4px 10px` | `base.css:149` |
| 卡片 padding | 14px | `base.css:179` |
| 页面 padding | 14px | `base.css:186` |
| 网格 gap | 14px | `base.css:206` |
| chip padding / gap | `4px 12px` / 6px | `base.css:232`、`base.css:228` |
| 输入 padding | `8px 12px` | `base.css:250` |
| 弹窗头/体/操作区 padding | `14px 16px` / `16px` / `12px 16px` | `base.css:332`、`base.css:339`、`base.css:346` |
| 空态 padding | `40px 16px` | `base.css:297` |
| 骨架 gap | 8px | `base.css:359` |
| shell gap / padding | 14px / `0 14px 24px` | `layout.css:8`、`layout.css:12` |
| 侧栏 padding | `12px 10px` | `layout.css:24` |
| 页脚 col gap | 10px | `layout.css:130` |

### 3.3 建议新增（4px 基准刻度）

| 建议名 | 建议取值 | 状态 |
| --- | --- | --- |
| `--sp-1` | `4px` | 建议新增 |
| `--sp-2` | `6px` | 建议新增 |
| `--sp-3` | `8px` | 建议新增 |
| `--sp-4` | `10px` | 建议新增 |
| `--sp-5` | `12px` | 建议新增 |
| `--sp-6` | `14px` | 建议新增 |
| `--sp-7` | `16px` | 建议新增 |
| `--sp-9` | `24px` | 建议新增 |
| `--sp-12` | `40px` | 建议新增 |

---

## 4. 圆角（Radius）

| 现状变量名 | 取值 | 语义化建议名 | 状态 |
| --- | --- | --- | --- |
| `--radius` | `12px` | `radius.md`（卡片/弹窗/侧栏） | 已实现 |
| `--radius-sm` | `8px` | `radius.sm`（按钮/输入/骨架） | 已实现 |
| — | 现状硬编码 `4px`（`.tag`，`base.css:219`） | `radius.xs` | 建议新增 |
| — | 现状硬编码 `999px`（chip `.chip:236`、Toast `.toast:366`、侧栏徽标 `layout.css:84`） | `radius.pill` | 建议新增 |
| — | 现状硬编码 `50%`（`.icon-btn:163`、`.to-top:157`） | `radius.full` | 建议新增 |
| — | 现状硬编码 `14px`（`public/privacy.html` 内 logo，非组件体系） | 不纳入 | 不在范围 |

---

## 5. 阴影（Shadow/Elevation）

| 现状变量名 | 取值（light） | 取值（dark） | 语义化建议名 | 状态 |
| --- | --- | --- | --- | --- |
| `--shadow` | `0 1px 3px rgba(0, 0, 0, 0.06)` | `0 1px 3px rgba(0, 0, 0, 0.4)` | `elevation.1`（卡片/悬浮按钮） | 已实现 |
| `--shadow-pop` | `0 8px 28px rgba(0, 0, 0, 0.14)` | `0 8px 28px rgba(0, 0, 0, 0.5)` | `elevation.3`（弹层/模态） | 已实现 |
| — | 无 | 无 | `elevation.2`（下拉/浮层，介于两者之间） | 建议新增 |
| — | 无 | 无 | `elevation.0`（无阴影，列表内嵌卡片） | 建议新增 |

---

## 6. 层级（Z-index）

| 场景 | 现状取值 | 出处 | 建议名 | 状态 |
| --- | --- | --- | --- | --- |
| 移动端 sticky 侧栏 | 400 | `layout.css:184` | `--z-sticky` | 建议新增 |
| 回到顶部按钮 | 500 | `layout.css:159` | `--z-float` | 建议新增 |
| 模态遮罩 | 900 | `base.css:314` | `--z-modal` | 建议新增 |
| Toast | 1000 | `base.css:360` | `--z-toast` | 建议新增 |
| OTA 横幅 | 未检索到显式 z-index（`src/ota.ts:162` 的 `.ota-banner`） | `components.css`（待核实） | `--z-banner` | 建议新增（取值待核实） |

---

## 7. 动效（Motion）

| 场景 | 现状取值 | 出处 | 建议名 | 状态 |
| --- | --- | --- | --- | --- |
| 按钮 hover 过渡 | `background 0.15s, border-color 0.15s`（缓动默认 ease） | `base.css:115` | `--dur-fast` = `150ms` | 建议新增 |
| 骨架屏微光 | `skeleton-shine 1.4s ease infinite` | `base.css:378`、`base.css:382-389` | `--dur-skeleton` = `1400ms` | 建议新增 |
| Toast 停留时长 | `1800ms`（JS 常量 `TOAST_MS`） | `src/ui/toast.tsx:15` | `--dur-toast`（需与 JS 常量同步） | 建议新增 |
| 通用缓动 | 未定义（浏览器默认 `ease`） | — | `--ease-standard` = `cubic-bezier(0.2, 0, 0, 1)` | 建议新增 |

---

## 8. 其他尺度

| 现状变量名 | 取值 | 用途 | 状态 |
| --- | --- | --- | --- |
| `--max-w` | `1180px` | 页面/shell/hero 最大宽度（`base.css:184`、`layout.css:10`、`layout.css:98`） | 已实现 |
| — | 断点 `860px` | 侧栏由左固定栏切换为顶部横向 sticky（`layout.css:165`） | 建议新增为文档常量 `breakpoint.md`（CSS 媒体查询无法用变量，约定即可） |
| — | 侧栏宽 `200px`（实测含边框 196px，`scripts/verify-desktop-regress.mjs:16` 断言 196） | 桌面布局 | 建议新增 `--sidenav-w` |
| — | 移动端断点内 shell padding `0 10px 20px`（`layout.css:168`） | 移动端留白 | 建议纳入 spacing |

---

## 9. 主题模式与切换机制

```ts
// src/core/theme.ts:19-32（原文摘录）
export function getTheme(): ThemeMode {
  const saved = readRaw(THEME_KEY)          // mim.theme
  if (saved === 'light' || saved === 'dark') return saved
  return getPlatform().env.prefersDark() ? 'dark' : 'light'
}

export function setTheme(mode: ThemeMode): void {
  writeRaw(THEME_KEY, mode)                 // 落库（平台 KV）
  applyTheme(mode)                          // getPlatform().ui.applyTheme(mode)
}
```

| 能力 | 现状 | 说明 |
| --- | --- | --- |
| 模式取值 | `light \| dark`（`src/platform/types.ts:17`） | **无 `auto`** |
| 落地方式 | Web/Capacitor 写 `<html data-theme>`（`src/platform/web.ts:137-141`） | 选择器 `html[data-theme='dark']` 在 `theme.css:38` |
| 小程序 | `applyTheme` 为空实现（`src/platform/miniprogram.ts:105-107`） | 主题由小程序全局配置决定，页面内只能靠 CSS 变量切换 |
| 系统偏好 | 仅「未手动选择过」时读取一次 | 运行中切换系统主题**不会**自动跟随 |
| 首屏闪白 | `initTheme()` 在启动时套用（`src/core/theme.ts:41-43`） | 已实现 |

---

## 10. 版本机制

### 10.1 版本号约定

- Token 体系整体采用 **语义化版本**：`MAJOR.MINOR.PATCH`，与本文档「版本」字段一致（当前 `v0.1`）。
- 判定规则：
  - **MAJOR**：删除变量、改变既有变量的语义（如 `--primary` 改作别的用途）、改变取值导致对比度不达标。
  - **MINOR**：新增变量（第 1-8 节中所有「建议新增」项走此类）。
  - **PATCH**：仅调整文档描述、修正拼写、补充示例，不动取值。

### 10.2 变更通知

| 环节 | 责任人 | 动作 |
| --- | --- | --- |
| 提出 | 任何人 | 在 PR 描述中写明「Token 变更」+ 影响面（涉及哪些组件类名） |
| 评审 | UI/UX | 确认命名符合第 1-8 节语义层级，确认 light/dark 两侧**成对**提供 |
| 实现 | 前端 | 改 `src/ui/styles/theme.css` 的 `:root` 与 `html[data-theme='dark']` **两处**，缺一则深色模式破功 |
| 验证 | QA | 执行 `npm run verify:routes`（59 路由 0 白屏）+ 深浅两模式截图对比 |
| 通知 | UI/UX | 更新本文档版本与变更表，并同步 `docs/design/组件规范.md` |

### 10.3 兼容策略

1. **新增优先**：只增不改。新增 token 默认不改变任何现有渲染结果。
2. **旧值不动**：已实现 token（第 1.1/4/5/8 节）的取值如需调整，必须先新增 `--xxx-2` 并在组件中切换，确认无回归后再改原值。
3. **硬编码改造分批进行**：第 1.3、2.3、3.3、4、6、7 节的建议项按「组件 → token」顺序推进，每批只改一类，避免一次性替换导致对比度与布局同时回归。
4. **回退兜底**：所有 `var(--x)` 引用必须提供回退值写法 `var(--x, <fallback>)`，防止旧壳（Capacitor 已 sync 的 WebView 缓存）缺失变量时样式塌陷。

### 10.4 废弃标记

- 废弃的 token 在 `theme.css` 中保留**至少一个 MINOR 版本**，并在注释中写明：

```css
/* @deprecated 自 v0.2 起废弃，请改用 --radius-pill；v0.4 移除 */
--radius-pill-old: 999px;
```

- 同时在本文档对应行的「状态」列标注「已废弃（计划 v0._ 移除）」。
- 移除前须由 QA 全量检索 `var(--<name>)` 命中数为 0。

---

## 11. 缺口清单（不改代码，仅登记）

| 编号 | 缺口 | 出处 | 影响 |
| --- | --- | --- | --- |
| T-01 | 主题无 `auto` 模式，运行中切换系统主题不跟随 | `src/platform/types.ts:17`、`src/core/theme.ts:19` | 深色偏好的跨端一致性 |
| T-02 | 主色按钮文字色硬编码 `#fff` | `src/ui/styles/base.css:130`、`base.css:145` | 品牌色调整时对比度无保障 |
| T-03 | 遮罩与 Toast 底色硬编码 | `base.css:310`、`base.css:367` | 深色模式遮罩层次不可调 |
| T-04 | 字号/行高/间距/层级/动效 全部无变量 | `base.css`、`layout.css` 全文 | 跨端与改版成本高 |
| T-05 | 断点 `860px` 未文档化为约定常量 | `layout.css:165` | 新增响应式组件易各写各的 |
| T-06 | Toast 时长为 JS 常量 `1800ms`，与样式无统一出处 | `src/ui/toast.tsx:15` | 动效 token 化时被遗漏 |
| T-07 | `--card` 与 `--bg` 在 light 下同为 `#ffffff`，卡片靠 `--line` 描边区分 | `theme.css:17`、`theme.css:19` | 无阴影场景层级弱（设计决策，非缺陷） |
| T-08 | 小程序端 `applyTheme` 为空实现，深色模式实际不可用 | `src/platform/miniprogram.ts:105-107` | 小程序与 Web 视觉不一致 |
| T-09 | OTA 横幅 `.ota-banner` 的 z-index 未在样式文件中核实 | `src/ota.ts:162` | 可能与 Toast（1000）重叠，待核实 |
