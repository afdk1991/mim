/**
 * 外观前台消费：把后台下发的主题配置清洗为安全的设计令牌，注入 CSS 变量。
 *
 * 降级口径：配置为空、字段类型非法或接口不可达时，一律回落 DEFAULT_THEME，
 * 不抛错、不白屏；颜色只接受合法 HEX，圆角限制在 0–32px，列表样式只认 card/list/compact。
 */

import type { ThemeSettings } from './api'; // 后台主题设置原始结构

/** 明暗主题：站点默认值与访客本地偏好共用同一口径。 */
export type ThemeMode = 'light' | 'dark';

/** 访客明暗偏好的本地存储键：只存 light / dark，不跟账号绑定。 */
const MODE_KEY = 'mim.theme.mode';

/** 清洗后的主题视图：全部字段都有安全兜底值。 */
export interface ResolvedTheme {
  accent: string; // 主色（合法 HEX）
  background: string; // 页面底色（合法 HEX）
  navLayout: string; // 导航布局口径（透传，供 CSS 与后续布局消费）
  listStyle: 'card' | 'list' | 'compact'; // 列表样式：卡片 / 单行列表 / 紧凑密度
  radius: number; // 圆角（px，0–32）
  font: string; // 字体族（空串表示沿用系统字体栈）
  mode: ThemeMode; // 站点默认明暗：访客未手动切换时生效
  navItems: Array<{ view: string; label: string; icon?: string; visible: boolean }>; // 后台配置导航项
} // 代码块结束

/** 读取访客手动选择的明暗；无记录或存储不可用返回 null。 */
export function readStoredMode(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(MODE_KEY); // 仅认 light / dark 两个字面量
    return raw === 'dark' || raw === 'light' ? raw : null; // 脏值当作未选择
  } catch {
    return null; // 隐私模式下读取失败不阻断
  }
} // readStoredMode 结束

/** 把明暗写到 <html data-theme>：tokens.css 的暗色分支只认 dark。 */
export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return; // 非浏览器环境跳过
  document.documentElement.dataset.theme = mode; // light 时选择器不命中，回落浅色
} // applyThemeMode 结束

/** 当前生效明暗：以已写入的 data-theme 为准，供切换按钮显示对向文案。 */
export function currentThemeMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light'; // 非浏览器环境按浅色
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; // 只有 dark 视为暗色
} // currentThemeMode 结束

/** 访客手动切换明暗：立即生效并写入本地，刷新后保持。 */
export function setThemeMode(mode: ThemeMode): void {
  applyThemeMode(mode); // 先切页面，避免存储异常时无反馈
  try {
    localStorage.setItem(MODE_KEY, mode); // 持久化偏好
  } catch {
    /* 存储不可用时仅本次生效，不阻断切换 */
  }
} // setThemeMode 结束

/** 内置默认外观：与后端 20-appearance.sql 兜底种子同口径。 */
export const DEFAULT_THEME: ResolvedTheme = {
  accent: '#3b6ef5', // 主色：与 tokens.css 浅色主色一致
  background: '#f5f6f7', // 页面底色：与 tokens.css 浅色底一致
  navLayout: 'top', // 导航布局口径
  listStyle: 'card', // 列表样式：卡片
  radius: 12, // 主圆角：与 tokens.css 一致
  font: '', // 字体族：空串沿用系统字体栈
  mode: 'light', // 站点默认浅色
  navItems: [], // 后台未配置导航项
}; // 代码块结束

const HEX_COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/; // 3 / 6 / 8 位 HEX
const LIST_STYLES = ['card', 'list', 'compact'] as const; // 合法列表样式枚举

/** 解析 3 / 6 位 HEX 为 RGB 分量；带透明度的 8 位与非法值返回 null。 */
function hexToRgb(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, ''); // 去掉井号，统一按无前缀处理
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex; // 3 位补成 6 位
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null; // 仅接受纯 6 位
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]; // 拆出 R/G/B
} // 代码块结束

/** RGB 分量拼回 6 位 HEX。 */
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); // 取整并夹在 0–255
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`; // 拼成 #rrggbb
} // 代码块结束

/** 暗色主色：向白色混合约 35%，保证深底上的对比度。 */
function liftForDark(accent: string): string {
  const rgb = hexToRgb(accent); // 解析主色
  if (!rgb) return accent; // 解析失败原样返回，交给 CSS 兜底
  const ratio = 0.35; // 提亮比例：足够可见又不至于发白
  return rgbToHex(rgb[0] + (255 - rgb[0]) * ratio, rgb[1] + (255 - rgb[1]) * ratio, rgb[2] + (255 - rgb[2]) * ratio); // 向白混合
} // 代码块结束

/** 把主色转成指定透明度的 rgba 字符串；解析失败返回空串由调用方跳过。 */
function withAlpha(accent: string, alpha: number): string {
  const rgb = hexToRgb(accent); // 解析主色
  if (!rgb) return ''; // 无法解析时不写变量
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`; // 组合成 rgba
} // 代码块结束

/** HSL 转 RGB；h 为角度，s / l 用 0–1 小数。 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s; // 色度
  const hp = (((h % 360) + 360) % 360) / 60; // 色相落到 0–6 扇区
  const x = c * (1 - Math.abs((hp % 2) - 1)); // 扇区次高分量
  const m = l - c / 2; // 亮度偏移
  let r = 0; // 红分量
  let g = 0; // 绿分量
  let b = 0; // 蓝分量
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; // 补偏移并放大到 0–255
} // 代码块结束

/** WCAG 相对亮度。 */
function relativeLuminance(rgb: [number, number, number]): number {
  const channel = (value: number): number => {
    const n = value / 255; // 归一化
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); // 分段线性化
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]); // 加权求和
} // 代码块结束

/** 两色对比度，返回 1–21。 */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a); // 色 A 亮度
  const lb = relativeLuminance(b); // 色 B 亮度
  const hi = Math.max(la, lb); // 较亮者
  const lo = Math.min(la, lb); // 较暗者
  return (hi + 0.05) / (lo + 0.05); // WCAG 比值
} // 代码块结束

/**
 * 主按钮对比度兜底：浅色 --primary-fill 是按主色 88% + 深蓝 12% 压暗后的实际底色，
 * 若其上的 --on-primary 文字不足 4.5:1，就把主色逐步压暗到刚好达标。
 * 默认品牌蓝约 4.97:1，不会触发；只有运营配到过亮的主色（如粉 #f53dbb ≈3.8:1）时才生效。
 */
function ensureButtonContrast(accent: string): string {
  const rgb = hexToRgb(accent); // 解析主色
  if (!rgb) return accent; // 解析失败交回原值
  const fillBase = hslToRgb(222, 0.45, 0.08); // 与 tokens.css 的 12% 深色混合项同口径
  const onPrimary = hslToRgb(222, 1, 0.97); // 与浅色 --on-primary 同口径
  let current: [number, number, number] = [rgb[0], rgb[1], rgb[2]]; // 从原主色开始
  for (let step = 0; step < 40; step += 1) { // 最多压暗 40 档，足够覆盖极亮色
    const fill: [number, number, number] = [
      current[0] * 0.88 + fillBase[0] * 0.12, // 填充红
      current[1] * 0.88 + fillBase[1] * 0.12, // 填充绿
      current[2] * 0.88 + fillBase[2] * 0.12, // 填充蓝
    ];
    if (contrastRatio(fill, onPrimary) >= 4.6) break; // 留 0.1 安全余量，避免十六进制取整后掉到 4.5 以下
    current = [current[0] * 0.9, current[1] * 0.9, current[2] * 0.9]; // 未达标继续压暗
  }
  return rgbToHex(current[0], current[1], current[2]); // 返回可安全承载白字的主色
} // 代码块结束

/** 清洗单个颜色：非法值回落默认主色 / 底色。 */
function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback; // 返回当前函数的处理结果
} // 代码块结束

/** 清洗后台主题原始配置：脏数据逐项回落，不整体丢弃。 */
export function resolveTheme(raw: ThemeSettings | null | undefined): ResolvedTheme {
  const t = raw && typeof raw === 'object' ? raw : {}; // 非对象按空配置处理
  const listStyle = LIST_STYLES.includes(t.list_style as (typeof LIST_STYLES)[number]) // 常量 listStyle：保存固定配置或一次性派生值
    ? (t.list_style as ResolvedTheme['listStyle']) // 执行当前业务步骤
    : DEFAULT_THEME.listStyle; // 执行当前业务步骤
  const radius = typeof t.radius === 'number' && Number.isFinite(t.radius) // 常量 radius：保存固定配置或一次性派生值
    ? Math.min(32, Math.max(0, Math.round(t.radius))) // 执行当前业务步骤
    : DEFAULT_THEME.radius; // 执行当前业务步骤
  const navItems = Array.isArray(t.nav_items) // 常量 navItems：保存固定配置或一次性派生值
    ? t.nav_items // 执行当前业务步骤
        .map((item) => ({ // 执行当前业务步骤
          view: typeof item.view === 'string' ? item.view : '', // 对象字段 view：记录一项配置或数据
          label: typeof item.label === 'string' ? item.label : '', // 对象字段 label：记录一项配置或数据
          icon: typeof item.icon === 'string' ? item.icon : undefined, // 对象字段 icon：记录一项配置或数据
          visible: item.visible !== false, // 缺省可见
        })) // 代码块结束
        .filter((item) => item.view && item.label) // 执行当前业务步骤
    : []; // 执行当前业务步骤
  return { // 返回当前函数的处理结果
    accent: safeColor(t.accent, DEFAULT_THEME.accent), // 对象字段 accent：记录一项配置或数据
    background: safeColor(t.background, DEFAULT_THEME.background), // 对象字段 background：记录一项配置或数据
    navLayout: typeof t.nav_layout === 'string' && t.nav_layout ? t.nav_layout : DEFAULT_THEME.navLayout, // 对象字段 navLayout：记录一项配置或数据
    listStyle, // 执行当前业务步骤
    radius, // 执行当前业务步骤
    font: typeof t.font === 'string' ? t.font.trim() : '', // 对象字段 font：记录一项配置或数据
    mode: t.mode === 'dark' ? 'dark' : 'light', // 站点默认明暗：只认 dark，其余回落浅色
    navItems, // 执行当前业务步骤
  }; // 代码块结束
} // 代码块结束

/**
 * 把清洗后的主题写入文档根的主题输入变量与数据集，供全站样式消费。
 *
 * 只写 --theme-* 输入变量：--primary / --bg / --radius 由 tokens.css 在
 * :root 与 :root[data-theme='dark'] 两个分支里分别取值，因此运行期配置
 * 不会再以浅色值把暗色下的底色与主色钉死。
 *
 * 明暗口径：访客手动选择（localStorage）优先，否则用后台下发的站点默认值；
 * 结果写 <html data-theme>，由 tokens.css 的暗色分支接管。
 */
export function applyThemeVars(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return; // 非浏览器环境（测试 / SSR）跳过
  const root = document.documentElement; // 变量挂在 :root 上，全站继承
  applyThemeMode(readStoredMode() ?? theme.mode); // 本地偏好优先，其次站点默认
  // 主按钮兜底：先确保浅色填充上的白字 ≥4.5:1，再写回主色输入
  const accent = ensureButtonContrast(theme.accent); // 合规主色（默认蓝色不变）
  root.style.setProperty('--theme-primary', accent); // 浅色主色输入
  root.style.setProperty('--theme-bg', theme.background); // 浅色底色输入（暗色另有 --theme-bg-dark 兜底）
  root.style.setProperty('--theme-radius', `${theme.radius}px`); // 圆角输入
  const isDefaultAccent = accent.toLowerCase() === DEFAULT_THEME.accent; // 主色未自定义时交回令牌默认值
  const darkAccent = isDefaultAccent ? '' : liftForDark(accent); // 自定义主色派生出暗色提亮值
  const darkSoft = isDefaultAccent ? '' : withAlpha(accent, 0.16); // 暗色淡底
  const darkRing = isDefaultAccent ? '' : withAlpha(accent, 0.36); // 暗色焦点环
  const lightSoft = isDefaultAccent ? '' : withAlpha(accent, 0.1); // 浅色淡底
  const lightRing = isDefaultAccent ? '' : withAlpha(accent, 0.28); // 浅色焦点环
  const derived: Array<[string, string]> = [
    ['--theme-primary-dark', darkAccent],
    ['--theme-primary-soft', lightSoft],
    ['--theme-primary-soft-dark', darkSoft],
    ['--theme-primary-ring', lightRing],
    ['--theme-primary-ring-dark', darkRing],
  ]; // 待写入的派生变量
  for (const [name, value] of derived) {
    if (value) root.style.setProperty(name, value); // 有派生值时写入
    else root.style.removeProperty(name); // 默认主色则移除，回落到 tokens.css
  }
  if (theme.font) root.style.setProperty('--font-family', theme.font); // 自定义字体族
  else root.style.removeProperty('--font-family'); // 未配置则回落系统字体栈
  root.dataset.listStyle = theme.listStyle; // 列表样式口径，供布局与列表容器变体选择器消费
  root.dataset.navLayout = theme.navLayout; // 导航布局口径透传
} // 代码块结束

/** 内置导航项类型（与 router.ts AppView 对齐，这里用字符串解耦避免循环依赖）。 */
export interface NavDefault {
  view: string; // 对象字段 view：记录一项配置或数据
  label: string; // 对象字段 label：记录一项配置或数据
  hidden?: boolean; // 合并进上级视图的一级入口：路由与页面保留，侧栏不再单独占一行（2026-11-13 导航收口）
} // 代码块结束

/**
 * 合并后台配置导航项与内置导航：
 * 按 view 匹配覆盖文案 / 显隐；配置里出现的未知视图忽略；未被配置覆盖的内置项原样保留。
 */
export function mergeNavItems(
  defaults: NavDefault[], // 对象字段 defaults：记录一项配置或数据
  configured: ResolvedTheme['navItems'], // 对象字段 configured：记录一项配置或数据
): Array<NavDefault & { icon?: string; visible: boolean }> { // 执行当前业务步骤
  const byView = new Map(configured.map((item) => [item.view, item])); // 配置索引
  return defaults.map((item) => { // 返回当前函数的处理结果
    const override = byView.get(item.view); // 同视图配置
    return { // 返回当前函数的处理结果
      ...item, // 执行当前业务步骤
      icon: override?.icon, // 对象字段 icon：记录一项配置或数据
      label: override?.label || item.label, // 配置空文案回落内置文案
      visible: override ? override.visible : true, // 未配置即可见
    }; // 代码块结束
  }); // 代码块结束
} // 代码块结束
