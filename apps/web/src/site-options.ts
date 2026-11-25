// 站点选项消费层：把后台「站点选项」公开字段落到真实渲染。
// 分工：本文件只做三件事 —— ① 拉取并规范化公开取值；② 把与文档头 / CSS 变量相关的项即时应用；
// ③ 通过监听器把需要进 React 的项（悬浮按钮、移动 Tab、页脚开关）推给外壳，避免各视图各拉一次接口。

import { request } from './api/request'; // 统一请求层（含跨源与错误信封）

/** 规范化后的站点选项：只保留外壳会读的字段，其余公开字段由需要的视图按需读取 */
export interface SiteOptions {
  layoutWidth: number; // 内容区宽度（px）
  showRightSidebar: boolean; // 桌面端是否渲染右栏
  showFooter: boolean; // 是否渲染页脚
  stickyHeader: boolean; // 顶部导航是否吸顶
  cardRadius: 'sm' | 'md' | 'lg'; // 卡片圆角档位
  mobileTabEnabled: boolean; // 移动底部 Tab 总开关
  mobileTabItemsMax: number; // 移动 Tab 最多项数
  floatingEnabled: boolean; // 悬浮按钮总开关
  floatingPosition: 'right' | 'left'; // 悬浮按钮位置
  floatingBackToTop: boolean; // 是否显示回到顶部
  floatingContact: boolean; // 是否显示联系入口
  floatingContactUrl: string; // 联系入口链接（空串回落社区）
  shareEnabled: boolean; // 分享总开关
  sharePlatforms: Array<'wechat' | 'weibo' | 'qq' | 'x' | 'copy'>; // 已启用的分享渠道
  searchPlaceholder: string; // 搜索框占位文案
  searchHotWords: string[]; // 热门搜索词
  searchDefaultSort: 'relevance' | 'latest'; // 默认排序
  searchDiversifyDefault: boolean; // 默认去同质
  siteIconUrl: string; // 站点图标
  desktopIconUrl: string; // 桌面图标
  logoLightUrl: string; // 浅色 Logo
  logoDarkUrl: string; // 深色 Logo
  seoTitle: string; // 站点标题
  seoDescription: string; // 站点描述
  seoOgImage: string; // 分享大图
  customCss: string; // 自定义 CSS
  defaultLocale: 'zh' | 'en'; // 默认语言（登录用户仍以账号偏好优先）
  beianIcp: string; // 页脚 ICP 备案号文本，留空不渲染对应链接
  beianPolice: string; // 页脚公安备案号文本，留空不渲染对应链接
} // SiteOptions 结束

/** 默认取值：与后端注册表 defaultValue 保持同口径，接口不可达时行为等同「未配置」 */
export const DEFAULT_SITE_OPTIONS: SiteOptions = {
  layoutWidth: 1200,
  showRightSidebar: true,
  showFooter: true,
  stickyHeader: true,
  cardRadius: 'md',
  mobileTabEnabled: true,
  mobileTabItemsMax: 4,
  floatingEnabled: true,
  floatingPosition: 'right',
  floatingBackToTop: true,
  floatingContact: false,
  floatingContactUrl: '',
  shareEnabled: true,
  sharePlatforms: ['copy'],
  searchPlaceholder: '搜索帖子、版块、标签',
  searchHotWords: ['漫剧', 'AI 绘画', '前端'],
  searchDefaultSort: 'relevance',
  searchDiversifyDefault: true,
  siteIconUrl: '',
  desktopIconUrl: '',
  logoLightUrl: '',
  logoDarkUrl: '',
  seoTitle: 'Mim',
  seoDescription: 'Mim —— 社区、内容与交易一体的站点',
  seoOgImage: '',
  customCss: '',
  defaultLocale: 'zh',
  beianIcp: '苏ICP备2025161175号-1',
  beianPolice: '苏公网安备32072202010512号',
}; // 默认结束

/** 取字符串：类型不符一律回落默认，防止脏配置把渲染打崩 */
function str(raw: Record<string, unknown>, key: string, fallback: string): string {
  const value = raw[key]; // 取原始值
  return typeof value === 'string' ? value : fallback; // 非字符串回落默认
} // str 结束

/** 取布尔 */
function bool(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key]; // 取原始值
  return typeof value === 'boolean' ? value : fallback; // 非布尔回落默认
} // bool 结束

/** 取数值并夹到区间 */
function num(raw: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = raw[key]; // 取原始值
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback; // 非有限数回落默认
  return Math.min(Math.max(value, min), max); // 夹到区间
} // num 结束

/** 把接口返回的扁平取值规范化成外壳需要的结构 */
export function normalizeSiteOptions(raw: Record<string, unknown> | null | undefined): SiteOptions {
  const source = raw ?? {}; // 空值兜底
  const radius = str(source, 'card_radius', DEFAULT_SITE_OPTIONS.cardRadius); // 圆角档位
  const position = str(source, 'floating_position', DEFAULT_SITE_OPTIONS.floatingPosition); // 悬浮位置
  const sort = str(source, 'search_default_sort', DEFAULT_SITE_OPTIONS.searchDefaultSort); // 默认排序
  const hotRaw = str(source, 'search_hot_words', DEFAULT_SITE_OPTIONS.searchHotWords.join('\n')); // 热词原文（每行一个）
  const hotWords = hotRaw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).slice(0, 12); // 清洗为最多 12 个
  const platforms: SiteOptions['sharePlatforms'] = []; // 渠道累计
  if (bool(source, 'share_wechat', false)) platforms.push('wechat'); // 微信
  if (bool(source, 'share_weibo', false)) platforms.push('weibo'); // 微博
  if (bool(source, 'share_qq', false)) platforms.push('qq'); // QQ
  if (bool(source, 'share_x', false)) platforms.push('x'); // X
  if (bool(source, 'share_copy', true)) platforms.push('copy'); // 复制链接
  return {
    layoutWidth: num(source, 'layout_width', DEFAULT_SITE_OPTIONS.layoutWidth, 960, 1600),
    showRightSidebar: bool(source, 'show_right_sidebar', DEFAULT_SITE_OPTIONS.showRightSidebar),
    showFooter: bool(source, 'show_footer', DEFAULT_SITE_OPTIONS.showFooter),
    stickyHeader: bool(source, 'sticky_header', DEFAULT_SITE_OPTIONS.stickyHeader),
    cardRadius: radius === 'sm' || radius === 'lg' ? radius : 'md',
    mobileTabEnabled: bool(source, 'mobile_tab_enabled', DEFAULT_SITE_OPTIONS.mobileTabEnabled),
    mobileTabItemsMax: num(source, 'mobile_tab_items_max', DEFAULT_SITE_OPTIONS.mobileTabItemsMax, 1, 6),
    floatingEnabled: bool(source, 'floating_enabled', DEFAULT_SITE_OPTIONS.floatingEnabled),
    floatingPosition: position === 'left' ? 'left' : 'right',
    floatingBackToTop: bool(source, 'floating_back_to_top', DEFAULT_SITE_OPTIONS.floatingBackToTop),
    floatingContact: bool(source, 'floating_contact', DEFAULT_SITE_OPTIONS.floatingContact),
    floatingContactUrl: str(source, 'floating_contact_url', ''),
    shareEnabled: bool(source, 'share_enabled', DEFAULT_SITE_OPTIONS.shareEnabled),
    sharePlatforms: platforms,
    searchPlaceholder: str(source, 'search_placeholder', DEFAULT_SITE_OPTIONS.searchPlaceholder),
    searchHotWords: hotWords.length > 0 ? hotWords : DEFAULT_SITE_OPTIONS.searchHotWords,
    searchDefaultSort: sort === 'latest' ? 'latest' : 'relevance',
    searchDiversifyDefault: bool(source, 'search_diversify_default', DEFAULT_SITE_OPTIONS.searchDiversifyDefault),
    siteIconUrl: str(source, 'site_icon_url', ''),
    desktopIconUrl: str(source, 'desktop_icon_url', ''),
    logoLightUrl: str(source, 'logo_light_url', ''),
    logoDarkUrl: str(source, 'logo_dark_url', ''),
    seoTitle: str(source, 'seo_title', DEFAULT_SITE_OPTIONS.seoTitle),
    seoDescription: str(source, 'seo_description', DEFAULT_SITE_OPTIONS.seoDescription),
    seoOgImage: str(source, 'seo_og_image', ''),
    customCss: str(source, 'custom_css', ''),
    defaultLocale: str(source, 'default_locale', DEFAULT_SITE_OPTIONS.defaultLocale) === 'en' ? 'en' : 'zh',
    beianIcp: str(source, 'beian_icp', DEFAULT_SITE_OPTIONS.beianIcp),
    beianPolice: str(source, 'beian_police', DEFAULT_SITE_OPTIONS.beianPolice),
  }; // 返回规范化结果
} // normalizeSiteOptions 结束

/** 写 / 更新一个 <meta>（按 name 或 property 匹配），缺失则创建 */
function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  if (!content) return; // 空值不写入，避免覆盖默认文案
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`); // 查找既有标签
  if (!tag) {
    tag = document.createElement('meta'); // 缺失则新建
    tag.setAttribute(attr, key); // 设置识别属性
    document.head.appendChild(tag); // 挂到 head
  }
  tag.setAttribute('content', content); // 写入内容
} // upsertMeta 结束

/** 写 / 更新一个 <link>（按 rel 匹配） */
function upsertLink(rel: string, href: string, extra?: Record<string, string>): void {
  if (!href) return; // 空值不写入
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`); // 查找既有标签
  if (!tag) {
    tag = document.createElement('link'); // 缺失则新建
    tag.setAttribute('rel', rel); // 设置关系
    document.head.appendChild(tag); // 挂到 head
  }
  tag.setAttribute('href', href); // 写入地址
  for (const [name, value] of Object.entries(extra ?? {})) tag.setAttribute(name, value); // 附加属性（如 sizes）
} // upsertLink 结束

/** 应用与文档头 / 样式相关的选项：标题、描述、图标、布局变量与自定义 CSS。
 *  只改 DOM，不改 React 状态，因此可在首帧之外安全重复调用。 */
export function applySiteChrome(options: SiteOptions): void {
  document.title = options.seoTitle || DEFAULT_SITE_OPTIONS.seoTitle; // 标题
  upsertMeta('name', 'description', options.seoDescription); // 描述
  upsertMeta('property', 'og:title', options.seoTitle); // 分享标题
  upsertMeta('property', 'og:description', options.seoDescription); // 分享描述
  upsertMeta('property', 'og:image', options.seoOgImage); // 分享大图
  upsertLink('icon', options.siteIconUrl); // favicon
  upsertLink('apple-touch-icon', options.desktopIconUrl, { sizes: '148x148' }); // 主屏图标
  const root = document.documentElement; // 根元素
  root.style.setProperty('--page-max', `${options.layoutWidth}px`); // 内容区宽度令牌：外壳与顶栏共用同一变量
  root.dataset.siteRadius = options.cardRadius; // 卡片圆角档位（样式表按 data 属性切换）
  let style = document.getElementById('mim-site-custom-css') as HTMLStyleElement | null; // 自定义样式容器
  if (!style) {
    style = document.createElement('style'); // 缺失则新建
    style.id = 'mim-site-custom-css'; // 固定 id，重复加载只替换内容
    document.head.appendChild(style); // 挂到 head
  }
  style.textContent = options.customCss; // 写入运营配置的 CSS
} // applySiteChrome 结束

/** 缓存：接口只拉一次，视图通过 currentSiteOptions() 同步读取 */
let cached: SiteOptions | null = null; // 当前生效取值
const listeners = new Set<(options: SiteOptions) => void>(); // 订阅者（外壳与悬浮层）

/** 同步读取当前生效取值：未加载完成时返回默认值，保证首帧不崩 */
export function currentSiteOptions(): SiteOptions {
  return cached ?? DEFAULT_SITE_OPTIONS; // 有缓存用缓存，否则默认
} // currentSiteOptions 结束

/** 订阅取值变化：返回取消订阅函数，供 React effect 清理 */
export function subscribeSiteOptions(listener: (options: SiteOptions) => void): () => void {
  listeners.add(listener); // 登记
  if (cached) listener(cached); // 已有缓存立即回调，避免订阅者错过首轮
  return () => {
    listeners.delete(listener); // 取消登记
  }; // 返回清理函数
} // subscribeSiteOptions 结束

/** 拉取公开选项并应用：失败时保持默认值，不阻断前台启动 */
export async function loadSiteOptions(): Promise<SiteOptions> {
  try {
    const payload = await request<{ values: Record<string, unknown> }>('/site/options', { idempotency: false }); // 公开只读
    cached = normalizeSiteOptions(payload.values); // 规范化
  } catch {
    cached = cached ?? DEFAULT_SITE_OPTIONS; // 接口失败保留上一次或默认
  }
  applySiteChrome(cached); // 应用到文档头与样式
  for (const listener of listeners) listener(cached); // 通知订阅者
  return cached; // 返回最终取值
} // loadSiteOptions 结束

/** 图库 / 卡片圆角档位 → CSS 变量值：与前端外观令牌同族 */
export const RADIUS_TOKEN: Record<SiteOptions['cardRadius'], string> = { sm: '8px', md: '12px', lg: '18px' }; // 档位映射
