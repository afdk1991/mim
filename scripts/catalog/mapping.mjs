/**
 * 源站字段 ↔ 库字段 的唯一映射表。
 *
 * 口径变更只改这里：采集（collect）、构造（build*）、入库比对（diffProduct）都读本文件，
 * 不允许各自维护一份字段名。
 */

/** 一级分类稳定短码（与站点 ctg.value 对应） */
export const C1_CODE = {
  '001': 'egm-screw',
  '002': 'eg-screw',
  '003': 'auto-screw',
  '004': 'hand-tool',
  '005': 'expansion',
  '006': 'cutting-tool',
};

export const MAX_ORDER_QTY = 1000000;
export const IMPORT_BATCH = 'egluosi-sync';
/** 假设库存口径：箱规（CA，缺失退 BX）× 10；仅在源站未标缺货时作为可售上限。 */
export const STOCK_BOX_MULTIPLIER = 10;

/**
 * 映射表：一行 = 一个源站字段（或组合）到库字段的落地规则。
 * kind: int / percent / calc / number / text / bool / json
 * 注意：`number` 只做原值透传，不进 PRICE_FIELDS，不参与价格派生。
 */
export const FIELD_MAP = [
  { source: 'basePrcD3N2', column: 'price_li', kind: 'int', note: '面价，厘/支（千支价 × 10）' },
  { source: 'basePrcD3N2', column: 'price_fen', kind: 'int', note: '面价，分/支 = 厘/10 四舍五入' },
  {
    source: 'disD2N2',
    column: 'discount_pct',
    kind: 'percent',
    note: '源站折扣百分比。100 是合法值（无折扣），只有字段缺失才为 null',
  },
  {
    source: 'disD2N2 × basePrcD3N2',
    column: 'sale_price_li',
    kind: 'calc',
    note: '折后价，厘/支；discount_pct=100 时等于 price_li',
  },
  {
    source: 'invStatusDesc',
    column: 'source_inv_status',
    kind: 'text',
    note: '源站库存状态原文。缺货优先于假设库存：缺货即不可下单',
  },
  {
    source: 'tejiaD2N2',
    column: 'tejia_discount_pct',
    kind: 'number',
    note: '特价折扣百分比；0/缺失落 null。只采集透传，不参与价格派生（不进 PRICE_FIELDS）',
  },
  { source: 'onSale', column: 'source_on_sale', kind: 'bool', note: 'false = 源站下架（只标不可售，不删）' },
  { source: 'code', column: 'source_key', kind: 'text', note: 'sku:<code>；无 code 退 url:<详情URL>' },
  { source: 'code', column: 'source_id', kind: 'text', note: '源站货号原文' },
  { source: 'name', column: 'title', kind: 'text', note: '站点原始标题' },
  { source: 'convsDesc', column: 'packaging_desc', kind: 'text', note: '包装描述原文' },
  { source: 'convs', column: 'unit_conversions', kind: 'json', note: '单位换算表（CA=箱/BX=盒 等）' },
  { source: 'units', column: 'unit_options', kind: 'json', note: '可选单位（code/name）' },
  { source: 'basePrcD3N2/units/convsDesc', column: 'pack_qty', kind: 'int', note: '无价时回退列表包装量' },
  { source: 'activitys/manjianTipTexts/tipText', column: 'promotions', kind: 'json', note: '活动与满减提示' },
  { source: 'brand/grade/code/spec/name/material/std/teeth/treat/convsDesc', column: 'attributes', kind: 'json' },
  {
    source: '规格/标准/等级/材质/牙别/表面处理/包装',
    column: 'specs',
    kind: 'json',
    note: '只保留这 7 个键，与前端规格 tab 对齐',
  },
];

/** 详情页属性标题 ← 源站字段（顺序即展示顺序） */
export const ATTRIBUTE_MAP = [
  ['品牌', 'brand'],
  ['等级', 'grade'],
  ['包装', 'convsDesc'],
  ['项目号', 'code'],
  ['规格', 'spec'],
  ['品名', 'name'],
  ['材质', 'material'],
  ['标准', 'std'],
  ['牙别', 'teeth'],
  ['表面处理', 'treat'],
];

/** 列表页规格键 ← 源站字段 */
export const LIST_SPEC_MAP = [
  ['规格', 'spec'],
  ['标准', 'std'],
  ['等级', 'grade'],
  ['材质', 'material'],
  ['牙别', 'teeth'],
  ['表面处理', 'treat'],
  ['包装', 'convsDesc'],
];

/** 落库 specs 保留的键（与前端规格 tab 一致） */
export const SPEC_KEYS = ['规格', '标准', '等级', '材质', '牙别', '表面处理', '包装'];

/** 详情接口需要保留的原始字段 */
export const DETAIL_KEYS = [
  'no', 'code', 'name', 'brand', 'grade', 'material', 'std', 'teeth', 'treat', 'spec',
  'convsDesc', 'c3', 'basePrcD3N2', 'disD2N2', 'tejiaD2N2', 'units', 'convs', 'activitys',
  'tipText', 'manjianTipTexts', 'desc', 'invQtys', 'invStatusDesc', 'onSale', 'manuDay',
  'deliDay', 'erpDisD4', 'priceFlag', 'lowDqDisc', 'retail',
];

/** 价格类字段（变更时打 price_changed_at） */
export const PRICE_FIELDS = new Set(FIELD_MAP.filter((m) => m.kind === 'int' || m.kind === 'percent' || m.kind === 'calc').map((m) => m.column));

const nonEmpty = (...values) =>
  values.map((v) => (v === null || v === undefined ? '' : String(v).trim())).filter(Boolean);

export function nowIso() {
  return new Date().toISOString();
}

/** 品牌归一化：源站 brand 常填标准号/等级，需要回退到货名前缀。 */
export function normalizeBrand(rawBrand, name) {
  const cleaned = (rawBrand || '').replace(/牌\s*$/, '').trim();
  const gradeLike = /^(DIN|GB|ANSI|ISO|JIS|BS|AS|UN|UNF|UNC|S2|CR-V|ASP|ML|SCM|40Cr|35#|45#)/i;
  if (cleaned && !gradeLike.test(cleaned)) {
    const upper = cleaned.toUpperCase();
    if (upper === 'EGM') return 'EGM';
    if (upper === 'EG') return 'EG';
    return cleaned;
  }
  const prefixes = ['OSG', 'UTOOL', 'U-POWER', 'ET', 'MH', 'SKC', 'PCC', 'EGM', 'EG'];
  for (const p of prefixes) {
    if (name && name.toUpperCase().startsWith(p)) return p;
  }
  return '其他';
}

/**
 * 价格与折扣口径（修正版）。
 *
 * - price_li：源站 basePrcD3N2（厘/支），>0 才落，否则 null（无公开价）
 * - discount_pct：源站 disD2N2 有值就落，**包含 100**；100 表示「源站明确给出无折扣」
 * - sale_price_li：有折扣字段就按折扣算，100 → 等于面价；折扣字段缺失才留空
 * - tejiaDiscountPct：源站 tejiaD2N2 特价折扣，>0 才落。仅透传展示，
 *   不参与 price_li / sale_price_li 的任何计算（价格派生口径保持不变）
 */
export function normalizePrice(detail) {
  const rawPrice = Number(detail.basePrcD3N2);
  const priceLi = Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round(rawPrice) : null;

  const hasDisc = detail.disD2N2 !== null && detail.disD2N2 !== undefined && detail.disD2N2 !== '';
  const discNum = hasDisc ? Number(detail.disD2N2) : NaN;
  const discountPct = Number.isFinite(discNum) && discNum > 0 ? Math.round(discNum * 100) / 100 : null;

  const salePriceLi = priceLi != null && discountPct != null ? Math.round((priceLi * discountPct) / 100) : null;

  const tejiaNum = Number(detail.tejiaD2N2);
  const tejiaDiscountPct =
    Number.isFinite(tejiaNum) && tejiaNum > 0 ? Math.round(tejiaNum * 100) / 100 : null;

  return {
    priceLi,
    priceFen: priceLi != null ? Math.round(priceLi / 10) : 0,
    discountPct,
    salePriceLi,
    tejiaDiscountPct,
    priceSource: priceLi != null ? 'anonymous' : 'inquiry',
  };
}

/**
 * 假设库存：箱规 × 10。
 * 注意：这只是「有货时的可售上限」，源站 invStatusDesc 标缺货时前端与下单以源站为准。
 */
export function deriveStock(unitConversions, priced) {
  if (!priced) return { stock: 0, stockSource: 'unknown' };
  const conv = unitConversions || {};
  const perUnit = Number(conv.CA) > 0 ? Number(conv.CA) : Number(conv.BX) > 0 ? Number(conv.BX) : 0;
  if (!Number.isFinite(perUnit) || perUnit <= 0) return { stock: 0, stockSource: 'unknown' };
  return { stock: perUnit * STOCK_BOX_MULTIPLIER, stockSource: 'assumed-box10' };
}

export function buildAttributes(detail) {
  const attrs = {};
  for (const [label, key] of ATTRIBUTE_MAP) {
    const value = detail[key];
    if (typeof value === 'string' && value.trim()) attrs[label] = value.trim();
  }
  return attrs;
}

export function buildPromotions(detail) {
  const out = [];
  for (const a of Array.isArray(detail.activitys) ? detail.activitys : []) {
    if (typeof a === 'string') {
      if (a.trim()) out.push({ text: a.trim(), kind: 'activity' });
      continue;
    }
    if (!a || typeof a !== 'object') continue;
    const text = a.name || a.title || a.desc || a.content || a.activityName || '';
    if (!text) continue;
    const item = { text: String(text), kind: 'activity' };
    const from = a.startTime || a.beginTime || a.beginDate || a.validFrom;
    const to = a.endTime || a.endDate || a.validTo;
    if (from) item.validFrom = String(from);
    if (to) item.validTo = String(to);
    out.push(item);
  }
  for (const t of Array.isArray(detail.manjianTipTexts) ? detail.manjianTipTexts : []) {
    if (typeof t === 'string' && t.trim()) out.push({ text: t.trim(), kind: 'manjian' });
  }
  if (typeof detail.tipText === 'string' && detail.tipText.trim()) {
    out.push({ text: detail.tipText.trim(), kind: 'tip' });
  }
  return out;
}

/** 列表行 → 目录项（商品主档）。origin 由调用方传入，避免模块内写死站点。 */
export function buildCatalogItem(row, category, gallery, origin) {
  const no = row.no;
  const code = row.code ? String(row.code) : null;
  if (!no || !row.name) return null;

  const detailUrl = `${origin}/b2b/mall/item?itemNo=${encodeURIComponent(no)}`;
  const rawName = String(row.name || '');
  const spec = row.spec ? String(row.spec) : '';
  const brand = normalizeBrand(row.brand, rawName);

  const skipBrandPrefix = brand === '其他' || rawName.toUpperCase().startsWith(brand.toUpperCase());
  const name = (skipBrandPrefix ? nonEmpty(rawName, spec) : nonEmpty(brand, rawName, spec)).join(' ');
  const subtitle = nonEmpty(spec, row.grade, row.material, row.treat, row.teeth, row.std).join(' · ');

  const specs = {};
  for (const [label, key] of LIST_SPEC_MAP) {
    const raw = key === 'std' && row.std === '无' ? '' : row[key];
    if (raw !== null && raw !== undefined && String(raw).trim()) specs[label] = String(raw).trim();
  }
  if (row.invStatusDesc) specs['库存状态'] = String(row.invStatusDesc).trim();

  const listPrice = Number(row.basePrcD3N2);
  if (Number.isFinite(listPrice) && listPrice > 0) specs['千支面价(元/千支)'] = String(listPrice);
  if (Number.isFinite(Number(row.disD2N2)) && Number(row.disD2N2) > 0) {
    specs['折扣(%)'] = String(row.disD2N2);
  }

  const units = Array.isArray(row.units) ? row.units : [];
  const primaryUnit = units.find((u) => u.code === 'EA') || units[0];
  const unit = primaryUnit ? primaryUnit.name : '';
  let packQty = null;
  if (primaryUnit && primaryUnit.code !== 'EA') {
    const conv = Number(row.convs?.[primaryUnit.code]);
    if (Number.isFinite(conv)) packQty = conv;
  }

  const priced = Number.isFinite(listPrice) && listPrice > 0;
  const priceFen = priced ? Math.round(listPrice / 10) : null;
  const priceSource = priced ? 'anonymous' : 'inquiry';

  const description = nonEmpty(
    `品名：${rawName}`,
    row.std ? `标准：${row.std}` : '',
    row.material ? `材质：${row.material}` : '',
    row.grade ? `等级：${row.grade}` : '',
    row.teeth ? `牙别：${row.teeth}` : '',
    row.treat ? `表面处理：${row.treat}` : '',
    row.convsDesc ? `包装：${row.convsDesc}` : '',
    code ? `项目号：${code}` : '',
    row.invStatusDesc ? `库存状态：${row.invStatusDesc}` : ''
  ).join('\n');

  const images = [];
  for (const g of gallery) {
    if (g.url && !images.includes(g.url)) images.push(g.url);
  }

  return {
    sourceKey: code ? `sku:${code}` : `url:${detailUrl}`,
    sourceId: code,
    sourceUrl: detailUrl,
    itemNo: String(no),
    name,
    subtitle: subtitle || `${brand} ${category.path[category.path.length - 1]}`.trim(),
    brand,
    categoryCode: category.code,
    categoryPath: category.path,
    chain: category.chain, // 完整 c1/c2/c3 链路（Mim 版新增，用于类目外键）
    specs,
    unit,
    packQty,
    priceFen,
    priceSource,
    priceCapturedAt: nowIso(),
    images,
    cover: images[0] || '#0f9d8f',
    description,
    c3: String(category.leafValue),
    // 列表行就带库存状态，目录源据此提前判缺货（详情阶段会覆盖）
    sourceInvStatus: row.invStatusDesc ? String(row.invStatusDesc).trim() : null,
  };
}

/** 详情 → 可落库字段（价格/折扣口径见 normalizePrice）。 */
export function buildDetail(detail, specImage) {
  const price = normalizePrice(detail);
  const attrs = buildAttributes(detail);
  const units = (Array.isArray(detail.units) ? detail.units : []).filter(
    (u) => u && u.code && u.name && detail.convs && Number.isFinite(detail.convs[u.code]) && detail.convs[u.code] > 0
  );
  const convs = {};
  for (const [k, v] of Object.entries(detail.convs || {})) {
    if (Number.isFinite(v) && v > 0) convs[k] = v;
  }
  const specs = {};
  for (const key of SPEC_KEYS) {
    if (attrs[key]) specs[key] = attrs[key];
  }
  return {
    ...price,
    attributes: attrs,
    promotions: buildPromotions(detail),
    packagingDesc: detail.convsDesc || null,
    unitOptions: units.map((u) => ({ code: u.code, name: u.name })),
    unitConversions: convs,
    specImage,
    specs,
    unit: '支',
    sourceOnSale: detail.onSale !== false,
    sourceInvStatus: detail.invStatusDesc || null,
    maxOrderQty: MAX_ORDER_QTY,
  };
}

// jsonb 在 Postgres 内会重排对象键，比较前必须做键排序归一，否则会误报全量变更。
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

export function sameJson(a, b) {
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
}

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 逐字段比对；silent = 仅补首次登记值，不计变更。 */
export function diffProduct(db, next) {
  const changes = [];
  const put = (field, oldV, newV, isJson = false, silentIfNull = false) => {
    const a = isJson ? oldV ?? null : oldV;
    const b = isJson ? newV ?? null : newV;
    const same = isJson ? sameJson(a, b) : String(a ?? '') === String(b ?? '');
    if (!same) changes.push({ field, old: a, new: b, silent: silentIfNull && (a === null || a === undefined) });
  };
  put('title', db.title, next.title);
  put('subtitle', db.subtitle, next.subtitle);
  put('brand', db.brand, next.brand);
  // 分类层级由「三级分类重建」任务统一维护，这里不改写，避免把扁平一级名覆盖成叶子名
  put('price_li', num(db.price_li), next.priceLi);
  put('price_fen', num(db.price_fen), next.priceFen);
  put('discount_pct', num(db.discount_pct), next.discountPct);
  put('sale_price_li', num(db.sale_price_li), next.salePriceLi);
  // 特价折扣只透传，变更不计入价格变更（PRICE_FIELDS 不含该列）
  put('tejia_discount_pct', num(db.tejia_discount_pct), next.tejiaDiscountPct);
  put('price_source', db.price_source, next.priceLi != null ? 'anonymous' : 'inquiry');
  put('attributes', db.attributes, next.attributes, true);
  put('promotions', db.promotions, next.promotions, true);
  put('packaging_desc', db.packaging_desc, next.packagingDesc);
  put('unit_options', db.unit_options, next.unitOptions, true);
  put('unit_conversions', db.unit_conversions, next.unitConversions, true);
  // spec 图缺失（--no-images / 画廊缓存没命中）时保留库内原值，不把已有规格图清空
  if (next.specImage) put('spec_image', db.spec_image, next.specImage);
  put('specs', db.specs, next.specs, true);
  put('unit', db.unit, next.unit);
  // 画廊没取到（--no-images 或缓存缺失）时不动图片，避免把库内已有图片改写为空
  if (Array.isArray(next.images) && next.images.length > 0) {
    put('images', db.images, next.images, true);
    put('cover', db.cover, next.cover);
  }
  put('source_inv_status', db.source_inv_status, next.sourceInvStatus, false, true);
  put('source_on_sale', db.source_on_sale, next.sourceOnSale, false, true);
  put('max_order_qty', num(db.max_order_qty), next.maxOrderQty);
  return changes;
}

/** 供 inspect 打印「映射表」用 */
export function mappingTable() {
  return FIELD_MAP.map((m) => ({ 源站字段: m.source, 库字段: m.column, 类型: m.kind, 口径: m.note || '' }));
}
