/**
 * 商城商品视觉资源：分类封面图与「商品参数详情图」生成器。
 *
 * 封面图：19 个一级分类各一张，构建期放在 `apps/web/public/catalog/<slug>.jpg`，
 * 用 `import.meta.env.BASE_URL` 拼路径，保证 GitHub Pages 的 `/mim/` 子路径与
 * 生产根路径都能正确命中（不要写死 `/catalog/...`）。
 *
 * 参数图：不依赖后端图片字段，按模块详情实时生成 SVG（浏览器按 `<img>` 渲染），
 * 因此 205 条模块每条都有自己的一张「商品参数图」，且永远与接口数据一致。
 */

/** 分类封面映射：一级分类 slug → 静态图路径；缺图时回落到 misc 封面 */
const CATEGORY_COVER_SLUGS = new Set([
  'frontier', 'openharmony', 'dev', 'ai', 'industry', 'blockchain', 'wechat', 'enterprise',
  'store', 'tools', 'web', 'devops', 'mobile', 'devtools', 'server', 'database', 'game', 'plugin', 'misc',
]);

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
}

/** 分类封面 URL：相对 BASE_URL，兼容站点子路径部署 */
export function categoryCoverUrl(categorySlug: string | null | undefined): string {
  // 基础路径可能以 / 结尾，也可能为空，统一补齐
  const base = import.meta.env.BASE_URL || './';
  const normalized = base.endsWith('/') ? base : `${base}/`;
  // 以 BASE_URL 为基准拼静态图路径
  return `${normalized}catalog/${categoryGroupSlug(categorySlug)}.jpg`;
}

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
}

/** XML 转义：商品名等用户可见文本可能含 & < >，直接插入 SVG 会破坏文档 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 按字符宽度粗略截断，避免长文案溢出参数图右边界 */
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * 生成「商品参数详情图」的 data URL（SVG）。
 * 900×1180，深色卡片风格，含标题、编码、参数键值表、价格、依赖与能力说明。
 */
export function specPosterUrl(input: SpecPosterInput): string {
  const zh = input.locale !== 'en-US';
  const rows: Array<[string, string]> = [
    [zh ? '模块编码' : 'Module code', input.code],
    [zh ? '所属分类' : 'Category', input.categoryName],
    [zh ? '一级分类' : 'Group', input.groupName],
    [zh ? '开源许可' : 'License', input.license ?? '—'],
    [zh ? '编程语言' : 'Language', input.language ?? '—'],
    [zh ? 'Star 数' : 'Stars', `★ ${input.stars}`],
    [zh ? '区域' : 'Region', input.region],
    [zh ? '上架状态' : 'Status', input.statusText],
    [zh ? '解锁方式' : 'Unlock mode', zh ? '一次性买断' : 'One-time purchase'],
    [zh ? '价格' : 'Price', input.priceText],
    [zh ? '前置依赖' : 'Requires', input.requiresText],
    [zh ? '能力绑定' : 'Capability', input.capabilityText],
  ];

  const title = clip(input.name, 22);
  const subtitle = clip(input.code, 34);
  const rowHeight = 68;
  const tableTop = 268;
  const width = 900;
  const height = tableTop + rows.length * rowHeight + 96;

  const rowSvg = rows
    .map(([label, value], index) => {
      const y = tableTop + index * rowHeight;
      const fill = index % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)';
      return `
    <g>
      <rect x="56" y="${y}" width="${width - 112}" height="${rowHeight - 8}" rx="14" fill="${fill}"/>
      <text x="82" y="${y + 40}" fill="#8ea3c8" font-size="22">${escapeXml(label)}</text>
      <text x="${width - 82}" y="${y + 40}" text-anchor="end" fill="#f2f6ff" font-size="24" font-weight="600">${escapeXml(clip(value, 30))}</text>
    </g>`;
    })
    .join('');

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
}
