/**
 * 外观前台消费：把后台下发的主题配置清洗为安全的设计令牌，注入 CSS 变量。
 *
 * 降级口径：配置为空、字段类型非法或接口不可达时，一律回落 DEFAULT_THEME，
 * 不抛错、不白屏；颜色只接受合法 HEX，圆角限制在 0–32px，列表样式只认 card/list/compact。
 */

import type { ThemeSettings } from './api'; // 后台主题设置原始结构

/** 清洗后的主题视图：全部字段都有安全兜底值。 */
export interface ResolvedTheme {
  accent: string; // 主色（合法 HEX）
  background: string; // 页面底色（合法 HEX）
  navLayout: string; // 导航布局口径（透传，供 CSS 与后续布局消费）
  listStyle: 'card' | 'list' | 'compact'; // 列表样式：卡片 / 单行列表 / 紧凑密度
  radius: number; // 圆角（px，0–32）
  font: string; // 字体族（空串表示沿用系统字体栈）
  navItems: Array<{ view: string; label: string; icon?: string; visible: boolean }>; // 后台配置导航项
}

/** 内置默认外观：与后端 20-appearance.sql 兜底种子同口径。 */
export const DEFAULT_THEME: ResolvedTheme = {
  accent: '#0f766e',
  background: '#f8fafc',
  navLayout: 'top',
  listStyle: 'card',
  radius: 14,
  font: '',
  navItems: [],
};

const HEX_COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/; // 3 / 6 / 8 位 HEX
const LIST_STYLES = ['card', 'list', 'compact'] as const; // 合法列表样式枚举

/** 清洗单个颜色：非法值回落默认主色 / 底色。 */
function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

/** 清洗后台主题原始配置：脏数据逐项回落，不整体丢弃。 */
export function resolveTheme(raw: ThemeSettings | null | undefined): ResolvedTheme {
  const t = raw && typeof raw === 'object' ? raw : {}; // 非对象按空配置处理
  const listStyle = LIST_STYLES.includes(t.list_style as (typeof LIST_STYLES)[number])
    ? (t.list_style as ResolvedTheme['listStyle'])
    : DEFAULT_THEME.listStyle;
  const radius = typeof t.radius === 'number' && Number.isFinite(t.radius)
    ? Math.min(32, Math.max(0, Math.round(t.radius)))
    : DEFAULT_THEME.radius;
  const navItems = Array.isArray(t.nav_items)
    ? t.nav_items
        .map((item) => ({
          view: typeof item.view === 'string' ? item.view : '',
          label: typeof item.label === 'string' ? item.label : '',
          icon: typeof item.icon === 'string' ? item.icon : undefined,
          visible: item.visible !== false, // 缺省可见
        }))
        .filter((item) => item.view && item.label)
    : [];
  return {
    accent: safeColor(t.accent, DEFAULT_THEME.accent),
    background: safeColor(t.background, DEFAULT_THEME.background),
    navLayout: typeof t.nav_layout === 'string' && t.nav_layout ? t.nav_layout : DEFAULT_THEME.navLayout,
    listStyle,
    radius,
    font: typeof t.font === 'string' ? t.font.trim() : '',
    navItems,
  };
}

/** 把清洗后的主题写入文档根 CSS 变量与数据集，供全站样式消费。 */
export function applyThemeVars(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return; // 非浏览器环境（测试 / SSR）跳过
  const root = document.documentElement; // 变量挂在 :root 上，全站继承
  root.style.setProperty('--primary', theme.accent); // 主色：按钮 / 选中态 / 链接
  root.style.setProperty('--primary-dark', theme.accent); // 主色加深版：悬停态沿用主色，避免脏配置产生低对比
  root.style.setProperty('--bg', theme.background); // 页面底色
  root.style.setProperty('--radius', `${theme.radius}px`); // 卡片圆角
  if (theme.font) root.style.setProperty('--font-family', theme.font); // 自定义字体族
  else root.style.removeProperty('--font-family'); // 未配置则回落系统字体栈
  root.dataset.listStyle = theme.listStyle; // 列表样式口径，供布局与列表容器变体选择器消费
  root.dataset.navLayout = theme.navLayout; // 导航布局口径透传
}

/** 内置导航项类型（与 router.ts AppView 对齐，这里用字符串解耦避免循环依赖）。 */
export interface NavDefault {
  view: string;
  label: string;
}

/**
 * 合并后台配置导航项与内置导航：
 * 按 view 匹配覆盖文案 / 显隐；配置里出现的未知视图忽略；未被配置覆盖的内置项原样保留。
 */
export function mergeNavItems(
  defaults: NavDefault[],
  configured: ResolvedTheme['navItems'],
): Array<NavDefault & { icon?: string; visible: boolean }> {
  const byView = new Map(configured.map((item) => [item.view, item])); // 配置索引
  return defaults.map((item) => {
    const override = byView.get(item.view); // 同视图配置
    return {
      ...item,
      icon: override?.icon,
      label: override?.label || item.label, // 配置空文案回落内置文案
      visible: override ? override.visible : true, // 未配置即可见
    };
  });
}
