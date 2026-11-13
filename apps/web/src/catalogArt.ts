/**
 * 商城商品视觉资源：逐商品矢量封面、详情说明面板与「商品参数详情图」生成器。
 *
 * 现行封面：`moduleCoverUrl()` 按模块编码实时生成 1200×675 SVG data URL（配色 / 字标 / 纹理
 * 稳定哈希），不依赖后端图片字段；详情画廊另由 `moduleStoryUrl()` 生成能力亮点 / 交付依赖两张
 * 说明面板，`specPosterUrl()` 生成 900×1180 参数长图。
 *
 * 遗留资源：早期 19 张分类 JPG（`apps/web/public/catalog/<slug>.jpg`）与 `categoryCoverUrl()`
 * 已不再被商城视图调用，仅保留以兼容历史产物；`categoryGroupSlug()` 仍被新矢量封面复用于分组色相。
 */

/** 分类封面映射：一级分类 slug → 静态图路径；缺图时回落到 misc 封面 */
const CATEGORY_COVER_SLUGS = new Set([
  'frontier', 'openharmony', 'dev', 'ai', 'industry', 'blockchain', 'wechat', 'enterprise', // 执行当前业务步骤
  'store', 'tools', 'web', 'devops', 'mobile', 'devtools', 'server', 'database', 'game', 'plugin', 'misc', // 执行当前业务步骤
]); // 执行当前业务步骤

/**
 * 由二级分类 slug（如 `ai-01` / `store-02`）取一级分类 slug。
 * 分类树规则固定为「一级 slug + '-' + 两位序号」，所以取最后一个横线前的部分即可；
 * 历史模块（ai-01 等）同样适用。
 */
export function categoryGroupSlug(categorySlug: string | null | undefined): string {
  // 未归类统一落到 misc，保证始终有图
  if (!categorySlug) return 'misc';
  // 取最后一个横线前的前缀
  const group = categorySlug.replace(/-\d{2}$/, '');
  // 不在已知 19 组内则回落 misc
  return CATEGORY_COVER_SLUGS.has(group) ? group : 'misc';
} // 代码块结束

/** 遗留：分类封面 URL（早期 19 张分类 JPG），商城视图已改用 moduleCoverUrl，保留以兼容历史产物 */
export function categoryCoverUrl(categorySlug: string | null | undefined): string {
  // 基础路径可能以 / 结尾，也可能为空，统一补齐
  const base = import.meta.env.BASE_URL || './';
  const normalized = base.endsWith('/') ? base : `${base}/`; // 常量 normalized：保存固定配置或一次性派生值
  // 以 BASE_URL 为基准拼静态图路径
  return `${normalized}catalog/${categoryGroupSlug(categorySlug)}.jpg`;
} // 代码块结束

/** 一级分类色相：让不同分类的商品封面有稳定但可区分的品牌色，避免整站一个蓝 */
const GROUP_HUE: Record<string, number> = {
  frontier: 218, openharmony: 190, dev: 202, ai: 226, industry: 208, // 技术类偏冷蓝
  blockchain: 268, wechat: 152, enterprise: 198, store: 24, tools: 282, // 商业与工具类拉开色相
  web: 205, devops: 182, mobile: 212, devtools: 262, server: 194, // 开发运维类保持冷静
  database: 220, game: 306, plugin: 176, misc: 210, // 娱乐与插件类补足差异
}; // 分类色相表结束

/** 字符串稳定哈希：同一商品每次渲染得到同一套配色与纹理，不因刷新跳色 */
function hashString(value: string): number {
  let hash = 2166136261; // FNV-1a 初始值
  for (let index = 0; index < value.length; index += 1) { // 逐字符混合
    hash ^= value.charCodeAt(index); // 异或当前字符
    hash = Math.imul(hash, 16777619); // FNV 质数乘法
  } // 遍历结束
  return hash >>> 0; // 转无符号 32 位
} // 哈希函数结束

/** 取商品主色相：分类色相 ± 12°，同一分类下不同商品也有细微差异 */
function hueOf(code: string, groupSlug: string): number {
  const base = GROUP_HUE[groupSlug] ?? 210; // 未知分类回落品牌蓝
  const drift = (hashString(code) % 25) - 12; // -12 ~ +12 的稳定漂移
  return (base + drift + 360) % 360; // 归一化到 0~359
} // 色相函数结束

/** 商品字标：中文取前两个字，英文取单词首字母；不足两位时回落模块编码 */
function monogramOf(name: string, code: string): string {
  const cjk = name.match(/[\u4e00-\u9fa5]/g) ?? []; // 提取中文
  if (cjk.length >= 2) return cjk.slice(0, 2).join(''); // 中文双字标
  if (cjk.length === 1) return cjk[0]; // 单字中文
  const latin = name.match(/[A-Za-z0-9]+/g) ?? []; // 提取英文单词
  const initials = latin.map((word) => word[0]).join('').slice(0, 2).toUpperCase(); // 取首字母
  if (initials.length >= 2) return initials; // 两字母标
  return code.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'MI'; // 编码兜底
} // 字标函数结束

/** 标题裁切：中文按 11 字、英文按 26 字符，避免压到右侧图形 */
function clipTitle(value: string): string {
  const cjk = /[\u4e00-\u9fa5]/.test(value); // 是否中文标题
  return clip(value, cjk ? 11 : 26); // 复用统一省略号逻辑
} // 标题裁切结束

/** 按固定字数把说明切成多行，供 SVG 文本逐行输出 */
function wrapText(value: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = []; // 行缓冲
  let rest = value.trim(); // 剩余文本
  while (rest.length > 0 && lines.length < maxLines) { // 逐行截取
    lines.push(rest.slice(0, perLine)); // 当前行
    rest = rest.slice(perLine); // 剩余部分
  } // 循环结束
  if (rest.length > 0 && lines.length > 0) lines[lines.length - 1] = clip(`${lines[lines.length - 1]}…`, perLine + 1); // 末行省略
  return lines; // 返回行数组
} // 换行函数结束

/** 商品封面输入：只依赖列表接口已有字段，不额外请求后端图片 */
export interface ModuleArtInput {
  code: string; // 模块编码
  name: string; // 商品名
  categorySlug: string | null; // 二级分类 slug
  groupName: string; // 一级分类展示名
  summary: string; // 商品简介
  priceText: string; // 价格文案
  locale: 'zh-CN' | 'en-US'; // 语言
} // 封面输入结束

/** 商品独立的矢量封面：1200×675，配色 / 字标 / 纹理均由模块编码稳定生成 */
export function moduleCoverUrl(input: ModuleArtInput): string {
  const zh = input.locale !== 'en-US'; // 是否中文
  const group = categoryGroupSlug(input.categorySlug); // 一级分类 slug
  const hue = hueOf(input.code, group); // 商品主色相
  const hue2 = (hue + 38) % 360; // 辅助色相
  const mark = escapeXml(monogramOf(input.name, input.code)); // 商品字标
  const title = escapeXml(clipTitle(input.name)); // 商品标题
  const summary = wrapText(input.summary, zh ? 22 : 42, 2).map((line, index) => (
    `<text x="84" y="${452 + index * 40}" fill="rgba(235,243,255,0.66)" font-size="26">${escapeXml(line)}</text>`
  )).join(''); // 简介两行
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 58% 12%)"/>
      <stop offset="0.52" stop-color="hsl(${hue2} 62% 18%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 18) % 360} 70% 9%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.78" cy="0.24" r="0.62">
      <stop offset="0" stop-color="hsl(${hue2} 92% 62%)" stop-opacity="0.42"/>
      <stop offset="1" stop-color="hsl(${hue2} 92% 62%)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="hsl(${hue2} 92% 66%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 70) % 360} 88% 60%)"/>
    </linearGradient>
    <pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse">
      <path d="M54 0H0V54" fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect width="1200" height="675" fill="url(#grid)"/>
  <rect width="1200" height="675" fill="url(#glow)"/>
  <circle cx="985" cy="220" r="238" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>
  <circle cx="985" cy="220" r="178" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>
  <path d="M80 540 C 300 470, 520 650, 760 560 S 1060 500, 1180 590" fill="none" stroke="url(#line)" stroke-width="3" opacity="0.34"/>
  <rect x="84" y="70" width="188" height="42" rx="21" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.18)"/>
  <text x="178" y="99" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="700" letter-spacing="1">MIM STORE</text>
  <text x="84" y="185" fill="rgba(255,255,255,0.62)" font-size="24" letter-spacing="2">${escapeXml(input.groupName)}</text>
  <text x="84" y="292" fill="#ffffff" font-size="62" font-weight="800">${title}</text>
  <text x="84" y="348" fill="rgba(235,243,255,0.56)" font-size="24" font-family="ui-monospace, Menlo, Consolas, monospace">${escapeXml(input.code)}</text>
  ${summary}
  <rect x="84" y="572" width="132" height="6" rx="3" fill="url(#line)"/>
  <text x="84" y="616" fill="rgba(255,255,255,0.52)" font-size="22">${escapeXml(input.priceText)}</text>
  <g>
    <rect x="808" y="152" width="354" height="354" rx="58" fill="rgba(6,10,18,0.34)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
    <rect x="846" y="190" width="278" height="278" rx="42" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)"/>
    <circle cx="985" cy="329" r="92" fill="url(#line)" opacity="0.18"/>
    <text x="985" y="356" text-anchor="middle" fill="#ffffff" font-size="88" font-weight="800" letter-spacing="4">${mark}</text>
    <path d="M808 248h-26v-40M808 410h-26v40M1162 248h26v-40M1162 410h26v40" fill="none" stroke="hsl(${hue2} 92% 70%)" stroke-width="3" opacity="0.7"/>
  </g>
  <text x="1120" y="640" text-anchor="end" fill="rgba(255,255,255,0.30)" font-size="18" font-family="ui-monospace, Menlo, Consolas, monospace">#${(hashString(input.code) % 0xffffff).toString(16).toUpperCase().padStart(6, '0')}</text>
</svg>`; // 封面 SVG
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; // 返回可直接渲染的图片地址
} // 封面函数结束

/** 详情画廊的说明面板类型：能力亮点 / 交付与依赖 */
export type StoryPanelKind = 'feature' | 'delivery';

/** 详情画廊说明图：同一套商品配色，输出能力亮点或交付信息，保证每件商品详情不是单图 */
export function moduleStoryUrl(input: ModuleArtInput & { capabilityText: string; requiresText: string; statusText: string; region: string }, kind: StoryPanelKind): string {
  const zh = input.locale !== 'en-US'; // 是否中文
  const group = categoryGroupSlug(input.categorySlug); // 一级分类
  const hue = hueOf(input.code, group); // 商品主色相
  const title = escapeXml(clipTitle(input.name)); // 标题
  const heading = kind === 'feature' ? (zh ? '能力亮点' : 'Capabilities') : (zh ? '交付与依赖' : 'Delivery & requirements'); // 面板标题
  const summaryLines = wrapText(input.summary, zh ? 27 : 52, 3).map((line, index) => (
    `<text x="84" y="${318 + index * 42}" fill="rgba(235,243,255,0.62)" font-size="27">${escapeXml(line)}</text>`
  )).join(''); // 简介三行
  const featureRows = [
    [zh ? '能力绑定' : 'Capability', input.capabilityText],
    [zh ? '价格' : 'Price', input.priceText],
    [zh ? '上架状态' : 'Status', input.statusText],
  ]; // 能力亮点行
  const deliveryRows = [
    [zh ? '解锁方式' : 'Unlock', zh ? '一次性买断' : 'One-time purchase'],
    [zh ? '前置依赖' : 'Requires', input.requiresText],
    [zh ? '区域' : 'Region', input.region],
  ]; // 交付行
  const rows = kind === 'feature' ? featureRows : deliveryRows; // 当前面板行
  const rowSvg = rows.map(([label, value], index) => `
    <g>
      <rect x="${680 + index * 168}" y="500" width="152" height="112" rx="20" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.10)"/>
      <text x="${756 + index * 168}" y="536" text-anchor="middle" fill="rgba(235,243,255,0.48)" font-size="18">${escapeXml(label)}</text>
      <text x="${756 + index * 168}" y="578" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="600">${escapeXml(clip(value, 12))}</text>
    </g>`).join(''); // 三张信息卡
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 52% 11%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 44) % 360} 66% 20%)"/>
    </linearGradient>
    <pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse">
      <path d="M54 0H0V54" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
    </pattern>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="hsl(${hue} 92% 68%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 70) % 360} 88% 62%)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect width="1200" height="675" fill="url(#grid)"/>
  <circle cx="1040" cy="120" r="210" fill="hsl(${hue} 90% 62%)" opacity="0.16"/>
  <text x="84" y="118" fill="rgba(255,255,255,0.50)" font-size="20" font-family="ui-monospace, Menlo, Consolas, monospace">${escapeXml(input.code)}</text>
  <text x="84" y="212" fill="#ffffff" font-size="54" font-weight="800">${heading}</text>
  <text x="84" y="266" fill="rgba(255,255,255,0.82)" font-size="30" font-weight="600">${title}</text>
  <rect x="84" y="286" width="96" height="4" rx="2" fill="url(#line)"/>
  ${summaryLines}
  ${rowSvg}
  <text x="1116" y="640" text-anchor="end" fill="rgba(255,255,255,0.32)" font-size="18">Mim Store · ${zh ? '商品详情' : 'Product detail'}</text>
</svg>`; // 说明面板 SVG
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; // 返回图片地址
} // 说明图结束

/** 参数图所需字段：与 Store 详情接口字段同名，便于直接传值 */
export interface SpecPosterInput {
  name: string; // 商品名
  code: string; // 模块编码
  groupName: string; // 一级分类名
  categoryName: string; // 一级 / 二级分类展示名
  license: string | null; // 开源许可
  language: string | null; // 编程语言
  stars: number; // Star 数
  priceText: string; // 价格文案（免费 / 金额）
  region: string; // 区域
  statusText: string; // 状态文案
  requiresText: string; // 依赖文案
  capabilityText: string; // 能力说明
  locale: 'zh-CN' | 'en-US'; // 语言
} // 代码块结束

/** XML 转义：商品名等用户可见文本可能含 & < >，直接插入 SVG 会破坏文档 */
function escapeXml(value: string): string {
  return value // 返回当前函数的处理结果
    .replace(/&/g, '&amp;') // 执行当前业务步骤
    .replace(/</g, '&lt;') // 执行当前业务步骤
    .replace(/>/g, '&gt;') // 执行当前业务步骤
    .replace(/"/g, '&quot;') // 执行当前业务步骤
    .replace(/'/g, '&apos;'); // 执行当前业务步骤
} // 代码块结束

/** 按字符宽度粗略截断，避免长文案溢出参数图右边界 */
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 生成「商品参数详情图」的 data URL（SVG）。
 * 900×1180，深色卡片风格，含标题、编码、参数键值表、价格、依赖与能力说明。
 */
export function specPosterUrl(input: SpecPosterInput): string {
  const zh = input.locale !== 'en-US'; // 常量 zh：保存固定配置或一次性派生值
  const rows: Array<[string, string]> = [ // 常量 rows：保存固定配置或一次性派生值
    [zh ? '模块编码' : 'Module code', input.code], // 执行当前业务步骤
    [zh ? '所属分类' : 'Category', input.categoryName], // 执行当前业务步骤
    [zh ? '一级分类' : 'Group', input.groupName], // 执行当前业务步骤
    [zh ? '开源许可' : 'License', input.license ?? '—'], // 执行当前业务步骤
    [zh ? '编程语言' : 'Language', input.language ?? '—'], // 执行当前业务步骤
    [zh ? 'Star 数' : 'Stars', `★ ${input.stars}`], // 执行当前业务步骤
    [zh ? '区域' : 'Region', input.region], // 执行当前业务步骤
    [zh ? '上架状态' : 'Status', input.statusText], // 执行当前业务步骤
    [zh ? '解锁方式' : 'Unlock mode', zh ? '一次性买断' : 'One-time purchase'], // 执行当前业务步骤
    [zh ? '价格' : 'Price', input.priceText], // 执行当前业务步骤
    [zh ? '前置依赖' : 'Requires', input.requiresText], // 执行当前业务步骤
    [zh ? '能力绑定' : 'Capability', input.capabilityText], // 执行当前业务步骤
  ]; // 执行当前业务步骤

  const title = clip(input.name, 22); // 常量 title：保存固定配置或一次性派生值
  const subtitle = clip(input.code, 34); // 常量 subtitle：保存固定配置或一次性派生值
  const rowHeight = 68; // 常量 rowHeight：保存固定配置或一次性派生值
  const tableTop = 268; // 常量 tableTop：保存固定配置或一次性派生值
  const width = 900; // 常量 width：保存固定配置或一次性派生值
  const height = tableTop + rows.length * rowHeight + 96; // 常量 height：保存固定配置或一次性派生值

  const rowSvg = rows // 常量 rowSvg：保存固定配置或一次性派生值
    .map(([label, value], index) => { // 执行当前业务步骤
      const y = tableTop + index * rowHeight; // 常量 y：保存固定配置或一次性派生值
      const fill = index % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)'; // 常量 fill：保存固定配置或一次性派生值
      return `
    <g>
      <rect x="56" y="${y}" width="${width - 112}" height="${rowHeight - 8}" rx="14" fill="${fill}"/>
      <text x="82" y="${y + 40}" fill="#8ea3c8" font-size="22">${escapeXml(label)}</text>
      <text x="${width - 82}" y="${y + 40}" text-anchor="end" fill="#f2f6ff" font-size="24" font-weight="600">${escapeXml(clip(value, 30))}</text>
    </g>`;
    }) // 代码块结束
    .join(''); // 执行当前业务步骤

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="0.55" stop-color="#101b33"/>
      <stop offset="1" stop-color="#1b1430"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5b8cff"/>
      <stop offset="1" stop-color="#9a6bff"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="760" cy="118" r="150" fill="#5b8cff" opacity="0.16"/>
  <circle cx="120" cy="${height - 90}" r="180" fill="#9a6bff" opacity="0.12"/>
  <rect x="56" y="64" width="132" height="34" rx="17" fill="url(#accent)"/>
  <text x="122" y="87" text-anchor="middle" fill="#ffffff" font-size="18" font-weight="700">Mim Store</text>
  <text x="56" y="164" fill="#ffffff" font-size="44" font-weight="700">${escapeXml(title)}</text>
  <text x="56" y="206" fill="#9db0d4" font-size="22" font-family="ui-monospace, Menlo, Consolas, monospace">${escapeXml(subtitle)}</text>
  <rect x="56" y="232" width="96" height="4" rx="2" fill="url(#accent)"/>
  ${rowSvg}
  <text x="56" y="${height - 44}" fill="#6f84aa" font-size="18">${zh ? '商品参数由 Mim 商城接口实时生成 · 解锁后在对应功能中生效' : 'Specs generated live from the Mim catalog API · effective after unlock'}</text>
</svg>`;

  // encodeURIComponent 避免 # 等字符截断 data URL
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
} // 代码块结束
