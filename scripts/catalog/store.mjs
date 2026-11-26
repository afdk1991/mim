/**
 * 落库：按 source_key 幂等 upsert、字段级流水、源站消失只标下架（2026-11-26，SQLite 版）。
 *
 * 只在这里碰数据库；采集与字段规则分别在 collect.mjs / mapping.mjs。
 * 表结构见 services/mim-api/src/schema.d/58-catalog-mall.sql，旧 products / shop_products 完全不动。
 */
import path from 'node:path'; // 拼接模块解析路径
import { readFileSync } from 'node:fs'; // 读取建表脚本
import { createRequire } from 'node:module'; // 复用 API 包内的 better-sqlite3

import { buildDetail, deriveStock } from './mapping.mjs'; // 字段口径
import { REPO_ROOT } from './config.mjs'; // 仓库根

const SCHEMA_FILE = path.join(REPO_ROOT, 'services', 'mim-api', 'src', 'schema.d', '58-catalog-mall.sql'); // 建表脚本

/** 从 API 包解析 better-sqlite3，避免在根目录再装一份原生模块。 */
function loadSqlite() {
  const req = createRequire(path.join(REPO_ROOT, 'services', 'mim-api', 'package.json')); // 以 API 包为解析基准
  return req('better-sqlite3'); // 返回构造函数
}

/** 打开数据库并确保目录表已建好。 */
export function openDb(dbPath) {
  const Database = loadSqlite(); // 驱动
  const db = new Database(dbPath); // 打开库
  db.pragma('journal_mode = WAL'); // WAL：采集与 API 读可并行
  db.pragma('busy_timeout = 10000'); // 锁等待 10s，避免瞬时冲突
  db.exec(readFileSync(SCHEMA_FILE, 'utf8')); // 幂等建表
  return db; // 返回连接
}

/** 批次开始。 */
export function markRunStarted(db, runId, startedAt) {
  db.prepare(
    `INSERT INTO catalog_sync_runs (run_id, source, started_at, status, phase)
     VALUES (?, 'egluosi', ?, 'running', 'catalog')
     ON CONFLICT(run_id) DO UPDATE SET status='running', error=NULL, started_at=excluded.started_at`
  ).run(runId, startedAt);
}

/** 批次结束：stats 存 JSON，error 压成单行截断。 */
export function markRunFinished(db, runId, status, stats, reportPath, error) {
  const summary = error ? String(error).replace(/\s+/g, ' ').trim().slice(0, 500) : null; // 单行摘要
  db.prepare(
    `UPDATE catalog_sync_runs
        SET finished_at = ?, status = ?, phase = 'done', stats = ?, report_path = ?, error = ?
      WHERE run_id = ?`
  ).run(new Date().toISOString(), status, JSON.stringify(stats || {}), reportPath || null, summary, runId);
}

/** 批次阶段推进，供长时间运行的详情阶段可见。 */
export function markRunPhase(db, runId, phase) {
  db.prepare('UPDATE catalog_sync_runs SET phase = ? WHERE run_id = ?').run(phase, runId); // 仅更新阶段
}

/** 类目主键：源站 + 层级 + 编码，跨库稳定。 */
function categoryId(level, code) {
  return `egluosi-L${level}-${code}`; // 例：egluosi-L3-110001
}

/** 递归 upsert 三级类目树。 */
export function upsertCategories(db, tree, now) {
  const stmt = db.prepare(
    `INSERT INTO catalog_categories (id, source, level, code, name, parent_id, path_names, sort_no, product_count, is_active, first_seen_at, synced_at)
     VALUES (?, 'egluosi', ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       parent_id = excluded.parent_id,
       path_names = excluded.path_names,
       sort_no = excluded.sort_no,
       is_active = 1,
       synced_at = excluded.synced_at`
  );
  let count = 0; // 类目数
  const walk = (nodes, level, parentId, trail, sortBase) => {
    let sort = sortBase; // 同级顺序
    for (const node of nodes || []) {
      const ctg = node.ctg || {}; // 类目元信息
      const code = String(ctg.code || ctg.value || ''); // 编码
      if (!code || !ctg.name) continue; // 缺编码/名称跳过
      const id = categoryId(level, code); // 主键
      const pathNames = [...trail, ctg.name]; // 名称路径
      stmt.run(id, level, code, ctg.name, parentId, JSON.stringify(pathNames), sort, now, now); // 写入
      count += 1; // 计数
      sort += 1; // 递进顺序
      if (Array.isArray(node.subs) && node.subs.length > 0) walk(node.subs, level + 1, id, pathNames, 0); // 下钻
    }
  };
  const tx = db.transaction(() => walk(tree, 1, null, [], 0)); // 单事务写入
  tx(); // 执行
  return count; // 返回类目数
}

/** 源站下架标记：仅在全量、列表阶段无失败时执行，避免把「没抓到」误判为下架。 */
export function delistMissing(db, seenKeys, now) {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _seen_keys (k TEXT PRIMARY KEY)'); // 临时表
  db.exec('DELETE FROM _seen_keys'); // 清空
  const ins = db.prepare('INSERT OR IGNORE INTO _seen_keys (k) VALUES (?)'); // 插入语句
  const tx = db.transaction(() => {
    for (const key of seenKeys) ins.run(key); // 批量写入
    db.prepare(
      `UPDATE catalog_products
          SET listed = 0, source_status = 'delisted', synced_at = ?, updated_at = ?
        WHERE source = 'egluosi' AND listed = 1
          AND NOT EXISTS (SELECT 1 FROM _seen_keys s WHERE s.k = catalog_products.source_key)`
    ).run(now, now); // 未出现的商品标下架
  });
  tx(); // 执行
}

/** 回填类目商品数（含下级），供类目页与一级覆盖核对。 */
export function refreshCategoryCounts(db) {
  db.exec(
    `UPDATE catalog_categories
        SET product_count = (
          SELECT COUNT(*) FROM catalog_products p
           WHERE p.listed = 1 AND p.source = 'egluosi'
             AND (p.c1_id = catalog_categories.id OR p.c2_id = catalog_categories.id OR p.c3_id = catalog_categories.id)
        )`
  );
}

/** JSON 规范化比较：SQLite 里 JSON 以文本保存，键顺序固定由我们控制。 */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon); // 数组递归
  if (value && typeof value === 'object') {
    const out = {}; // 新对象
    for (const k of Object.keys(value).sort()) out[k] = canon(value[k]); // 键排序
    return out; // 返回
  }
  return value; // 基本类型原样
}

/** 判断两个值是否等价。 */
function sameValue(a, b, isJson) {
  if (isJson) return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null)); // JSON 比规范化
  return String(a ?? '') === String(b ?? ''); // 标量比字符串
}

/** 图片 URL → 元数据（宽高/字节），由采集阶段画廊快照提供。 */
function buildImageMeta(gallery) {
  const map = new Map(); // url → meta
  for (const entries of Object.values(gallery || {})) {
    for (const e of entries || []) if (e?.url) map.set(e.url, e); // 记录
  }
  return map; // 返回
}

/** 规格图映射：c3 → URL。 */
function specImageMap(gallery) {
  const out = {}; // c3 → url
  for (const [c3, entries] of Object.entries(gallery || {})) {
    const spec = entries.find((e) => e.role === 'spec' && e.url); // 规格图
    if (spec) out[c3] = spec.url; // 记录
  }
  return out; // 返回
}

/** 组装一行商品数据（同时用于 INSERT 与 diff）。 */
function buildRow(item, detail, specImageUrl, imageMeta, now) {
  // 列表阶段还没抓到详情时，用列表价与库存状态兜底，保证新增商品立刻可展示
  const safeDetail = detail || {
    basePrcD3N2: item.priceFen != null ? item.priceFen * 10 : null,
    invStatusDesc: item.sourceInvStatus,
    onSale: true,
  };
  const next = buildDetail(safeDetail, specImageUrl); // 详情派生
  const priced = next.priceLi != null; // 是否有公开价
  const stockPlan = deriveStock(next.unitConversions, priced); // 估算库存
  const images = (item.images || []).map((url) => {
    const meta = imageMeta.get(url) || {}; // 查元数据
    return { url, file: url.split('/').pop(), role: meta.role || null, width: meta.width || 0, height: meta.height || 0, bytes: meta.bytes || 0 }; // 完整图片对象
  });
  const cover = images[0]?.url || null; // 封面
  return {
    id: `eg-${item.sourceId || item.itemNo}`, // 稳定主键
    source: 'egluosi',
    source_key: item.sourceKey,
    source_id: item.sourceId || null,
    source_url: item.sourceUrl,
    item_no: item.itemNo,
    title: item.name,
    subtitle: item.subtitle || '',
    brand: item.brand || null,
    c1_id: item.chain?.[0]?.code ? `egluosi-L1-${item.chain[0].code}` : null,
    c2_id: item.chain?.[1]?.code ? `egluosi-L2-${item.chain[1].code}` : null,
    c3_id: item.chain?.[2]?.code ? `egluosi-L3-${item.chain[2].code}` : null,
    category_path: JSON.stringify(item.categoryPath || []),
    specs: JSON.stringify(next.specs || {}),
    attributes: JSON.stringify(next.attributes || {}),
    promotions: JSON.stringify(next.promotions || []),
    price_li: next.priceLi,
    price_fen: priced ? next.priceFen : 0,
    discount_pct: next.discountPct,
    sale_price_li: next.salePriceLi,
    tejia_discount_pct: next.tejiaDiscountPct,
    price_source: next.priceSource,
    price_captured_at: item.priceCapturedAt,
    stock: stockPlan.stock,
    stock_source: stockPlan.stockSource,
    source_inv_status: next.sourceInvStatus,
    source_on_sale: next.sourceOnSale ? 1 : 0,
    listed: next.sourceOnSale && (item.sourceInvStatus || '') !== '下架' ? 1 : 0, // 下架明确不可售
    source_status: next.sourceOnSale ? 'active' : 'off-sale',
    status: 'active',
    unit: next.unit,
    pack_qty: priced ? null : item.packQty,
    description: item.description || '',
    images: JSON.stringify(images),
    cover_url: cover,
    spec_image_url: next.specImage || null,
    synced_at: now,
    updated_at: now,
  };
}

/** 字段级比对；返回需要更新的列与变更清单。 */
function diffRow(oldRow, next) {
  const fields = [
    ['title', false], ['subtitle', false], ['brand', false],
    ['price_li', false], ['price_fen', false], ['discount_pct', false], ['sale_price_li', false], ['tejia_discount_pct', false],
    ['price_source', false], ['specs', true], ['attributes', true], ['promotions', true],
    ['pack_qty', false], ['unit', false], ['description', false],
    ['images', true], ['cover_url', false], ['spec_image_url', false],
    ['source_inv_status', false], ['source_on_sale', false], ['listed', false], ['source_status', false],
    ['stock', false], ['stock_source', false],
  ];
  const changes = []; // 变更
  const patch = {}; // 待更新列
  for (const [field, isJson] of fields) {
    let oldV = oldRow[field]; // 旧值
    let newV = next[field]; // 新值
    if (isJson) {
      try { oldV = JSON.parse(oldV || 'null'); } catch { oldV = null; } // 旧 JSON 文本
      try { newV = JSON.parse(newV || 'null'); } catch { newV = null; } // 新 JSON 文本
    }
    if (!sameValue(oldV, newV, isJson)) {
      changes.push({ field, old: oldV, new: newV }); // 记录变更
      patch[field] = next[field]; // 记录更新
    }
  }
  // 图片为空时不清空已有图片（--no-images 或缺缓存）
  const newImages = JSON.parse(next.images || '[]'); // 新图片数组
  if (!Array.isArray(newImages) || newImages.length === 0) {
    delete patch.images; // 保留旧图
    delete patch.cover_url; // 保留旧封面
    delete patch.spec_image_url; // 保留旧规格图
    for (let i = changes.length - 1; i >= 0; i -= 1) {
      if (['images', 'cover_url', 'spec_image_url'].includes(changes[i].field)) changes.splice(i, 1); // 同步移除变更记录
    }
  }
  return { changes, patch }; // 返回
}

/**
 * 阶段三：写入商品（先列表项保底，再用详情覆盖）。
 * @returns {{inserted:number, updated:number, unchanged:number, images:number}}
 */
export function applyProducts({ db, runId, items, details, gallery, now }) {
  const meta = buildImageMeta(gallery); // 图片元数据
  const specByC3 = specImageMap(gallery); // 规格图
  const getExisting = db.prepare('SELECT * FROM catalog_products WHERE source_key = ?'); // 查旧行
  const insertSql = `INSERT INTO catalog_products (
      id, source, source_key, source_id, source_url, item_no, title, subtitle, brand,
      c1_id, c2_id, c3_id, category_path, specs, attributes, promotions,
      price_li, price_fen, discount_pct, sale_price_li, tejia_discount_pct, price_source, price_captured_at,
      stock, stock_source, source_inv_status, source_on_sale, listed, source_status, status,
      unit, pack_qty, description, images, cover_url, spec_image_url,
      synced_at, created_at, updated_at
    ) VALUES (
      @id, @source, @source_key, @source_id, @source_url, @item_no, @title, @subtitle, @brand,
      @c1_id, @c2_id, @c3_id, @category_path, @specs, @attributes, @promotions,
      @price_li, @price_fen, @discount_pct, @sale_price_li, @tejia_discount_pct, @price_source, @price_captured_at,
      @stock, @stock_source, @source_inv_status, @source_on_sale, @listed, @source_status, @status,
      @unit, @pack_qty, @description, @images, @cover_url, @spec_image_url,
      @synced_at, @created_at, @updated_at
    )`; // 插入语句
  const insert = db.prepare(insertSql); // 预编译
  const updateBase = `UPDATE catalog_products SET synced_at = @synced_at, updated_at = @updated_at`; // 更新前缀
  const logChange = db.prepare(
    'INSERT INTO catalog_change_log (run_id, product_id, source_key, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ); // 变更流水

  const stats = { inserted: 0, updated: 0, unchanged: 0, images: 0 }; // 统计
  const tx = db.transaction(() => {
    for (const item of items) {
      const detail = details?.items?.[item.itemNo] || null; // 详情（可为空）
      const spec = specByC3[item.c3] || null; // 规格图
      const row = buildRow(item, detail, spec, meta, now); // 组装
      const old = getExisting.get(row.source_key); // 查旧行
      if (!old) {
        insert.run({ ...row, created_at: now }); // 新插入
        stats.inserted += 1; // 计数
      } else {
        const { changes, patch } = diffRow(old, row); // 比对
        if (changes.length > 0) {
          const sets = Object.keys(patch).map((k) => `${k} = @${k}`); // SET 片段
          db.prepare(`${updateBase}${sets.length ? ', ' + sets.join(', ') : ''} WHERE source_key = @source_key`).run({
            ...patch,
            synced_at: now,
            updated_at: now,
            source_key: row.source_key,
          }); // 更新
          for (const c of changes) {
            logChange.run(runId, row.id, row.source_key, c.field, JSON.stringify(c.old ?? null), JSON.stringify(c.new ?? null), now); // 写流水
          }
          stats.updated += 1; // 计数
        } else {
          db.prepare('UPDATE catalog_products SET synced_at = ?, updated_at = ? WHERE source_key = ?').run(now, now, row.source_key); // 仅刷新时间
          stats.unchanged += 1; // 计数
        }
      }
      const imgs = JSON.parse(row.images || '[]'); // 图片数组
      stats.images += Array.isArray(imgs) ? imgs.length : 0; // 累计
    }
  });
  tx(); // 执行
  return stats; // 返回
}

/** 只读：按 source_key 取一件，供 inspect 使用。 */
export function readProduct(db, sourceKey) {
  return db.prepare('SELECT * FROM catalog_products WHERE source_key = ?').get(sourceKey) || null; // 单行
}

/** 读取最近一次同步批次。 */
export function latestRun(db) {
  return db.prepare('SELECT * FROM catalog_sync_runs ORDER BY started_at DESC LIMIT 1').get() || null; // 最近批次
}
