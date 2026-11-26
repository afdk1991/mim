/**
 * 全量商城目录只读接口（2026-11-26）。
 *
 * 只读 catalog_* 表，不碰既有 shop_products / 订单链路：
 *   GET /mall/overview          商品总数、一级类目覆盖、图片清晰度、最近同步批次
 *   GET /mall/categories        三级类目树（默认全部，可用 level=1|2|3 过滤）
 *   GET /mall/products          商品分页（关键词 / 类目 / 品牌 / 排序）
 *   GET /mall/products/:id      商品详情 + 同三级类目推荐
 *   GET /mall/img/:file         高清商品图（内容寻址文件名，强缓存）
 *   GET /mall/sync/status       最近一次同步批次
 * 全部为公开只读，匿名可访问；不提供任何写入口。
 */
import { Router } from 'express'; // 路由工厂
import { existsSync } from 'node:fs'; // 判断图片文件是否存在
import path from 'node:path'; // 绝对路径拼接

import { AppError } from '@mim/core-domain'; // 统一错误码
import { REPO_ROOT } from '../config.js'; // 仓库根目录
import type { ApiDeps } from '../types.js'; // 依赖容器类型

/** 图片目录：与采集器默认值一致，可用环境变量覆盖（生产指向持久化目录）。 */
const DEFAULT_IMAGE_DIR = path.join(REPO_ROOT, 'storage', 'catalog-images'); // 默认落盘目录
const IMAGE_FILE_RE = /^[a-f0-9]{40}\.(jpg|png|gif|webp)$/; // 只放行 SHA1 + 图片扩展名，杜绝路径穿越

/** 把 SQLite 里的 JSON 文本安全转成对象。 */
function parseJson(text: unknown, fallback: unknown) {
  try {
    return typeof text === 'string' && text ? JSON.parse(text) : fallback; // 正常解析
  } catch {
    return fallback; // 脏数据回落
  }
}

/** 商品行 → 对外结构（snake_case，前端零转换）。 */
function mapProduct(row: Record<string, unknown>) {
  return {
    id: row.id,
    source: row.source,
    source_key: row.source_key,
    source_id: row.source_id,
    source_url: row.source_url,
    item_no: row.item_no,
    title: row.title,
    subtitle: row.subtitle,
    brand: row.brand,
    c1_id: row.c1_id,
    c2_id: row.c2_id,
    c3_id: row.c3_id,
    category_path: parseJson(row.category_path, []),
    specs: parseJson(row.specs, {}),
    attributes: parseJson(row.attributes, {}),
    promotions: parseJson(row.promotions, []),
    price_li: row.price_li,
    price_cents: row.price_fen,
    discount_pct: row.discount_pct,
    sale_price_li: row.sale_price_li,
    tejia_discount_pct: row.tejia_discount_pct,
    price_source: row.price_source,
    price_captured_at: row.price_captured_at,
    stock: row.stock,
    stock_source: row.stock_source,
    source_inv_status: row.source_inv_status,
    source_on_sale: row.source_on_sale,
    listed: row.listed,
    source_status: row.source_status,
    unit: row.unit,
    pack_qty: row.pack_qty,
    description: row.description,
    images: parseJson(row.images, []),
    cover_url: row.cover_url,
    spec_image_url: row.spec_image_url,
    synced_at: row.synced_at,
    updated_at: row.updated_at,
  };
}

/** 读取图片目录。 */
function imageDirOf(env: Record<string, string | undefined>): string {
  return env.MIM_CATALOG_IMAGE_DIR ? path.resolve(env.MIM_CATALOG_IMAGE_DIR) : DEFAULT_IMAGE_DIR; // 环境变量优先
}

/** 创建只读路由。 */
export function createMallRouter(deps: ApiDeps): Router {
  const router = Router(); // 路由实例

  /** 概览：总数 / 一级类目覆盖 / 图片清晰度 / 最近批次。 */
  router.get('/mall/overview', (_req, res) => {
    const total = (deps.db.prepare("SELECT COUNT(*) AS n FROM catalog_products WHERE source = 'egluosi'").get() as { n: number }).n; // 商品总数
    const listed = (deps.db.prepare("SELECT COUNT(*) AS n FROM catalog_products WHERE source = 'egluosi' AND listed = 1").get() as { n: number }).n; // 可售数
    const categories = deps.db
      .prepare(
        `SELECT c.id, c.code, c.name, c.level,
                (SELECT COUNT(*) FROM catalog_products p
                  WHERE p.source = 'egluosi' AND p.listed = 1 AND p.c1_id = c.id) AS product_count
           FROM catalog_categories c
          WHERE c.level = 1 AND c.is_active = 1
          ORDER BY c.sort_no`
      )
      .all() as Array<{ id: string; code: string; name: string; level: number; product_count: number }>; // 一级类目（商品数实时计算，不依赖缓存回填）
    const counts = deps.db
      .prepare('SELECT level, COUNT(*) AS n FROM catalog_categories WHERE is_active = 1 GROUP BY level')
      .all() as Array<{ level: number; n: number }>; // 层级计数
    const run = deps.db.prepare(
      `SELECT run_id, started_at, finished_at, status, phase, stats FROM catalog_sync_runs
        ORDER BY (stats LIKE '%"repair":true%') ASC, started_at DESC LIMIT 1`
    ).get() as
      | { run_id: string; started_at: string; finished_at: string | null; status: string; phase: string | null; stats: string }
      | undefined; // 最近批次
    const imgDir = imageDirOf(deps.env); // 图片目录
    res.json({
      products: { total, listed },
      categories: {
        l1: categories.map((c) => ({ id: c.id, code: c.code, name: c.name, products: c.product_count })),
        levels: Object.fromEntries(counts.map((c) => [c.level, c.n])),
      },
      images: { dir: imgDir, available: existsSync(imgDir) },
      sync: run ? { ...run, stats: parseJson(run.stats, {}) } : null,
    }); // 输出
  });

  /** 类目树：默认三级全量；level 可选 1/2/3。 */
  router.get('/mall/categories', (req, res) => {
    const level = Number(req.query.level) || 0; // 0 表示全量
    const rows = deps.db
      .prepare(
        `SELECT c.id, c.level, c.code, c.name, c.parent_id, c.path_names, c.sort_no,
                (SELECT COUNT(*) FROM catalog_products p
                  WHERE p.source = 'egluosi' AND p.listed = 1
                    AND (p.c1_id = c.id OR p.c2_id = c.id OR p.c3_id = c.id)) AS product_count
           FROM catalog_categories c
          WHERE c.is_active = 1 ${level ? 'AND c.level = ?' : ''}
          ORDER BY c.level, c.sort_no`
      )
      .all(...(level ? [level] : [])) as Array<Record<string, unknown>>; // 查询（商品数实时计算）
    res.json({
      categories: rows.map((r) => ({
        id: r.id,
        level: r.level,
        code: r.code,
        name: r.name,
        parent_id: r.parent_id,
        path_names: parseJson(r.path_names, []),
        sort_no: r.sort_no,
        product_count: r.product_count,
      })),
    }); // 输出
  });

  /** 商品分页：关键词 / 类目 / 品牌 / 排序，默认按更新时间倒序。 */
  router.get('/mall/products', (req, res) => {
    const q = String(req.query.q || '').trim(); // 关键词
    const c1 = String(req.query.c1 || '').trim(); // 一级 id 或 code
    const c2 = String(req.query.c2 || '').trim(); // 二级
    const c3 = String(req.query.c3 || '').trim(); // 三级
    const brand = String(req.query.brand || '').trim(); // 品牌
    const sort = String(req.query.sort || 'default'); // 排序
    const page = Math.max(1, Number(req.query.page) || 1); // 页码
    const pageSize = Math.min(60, Math.max(1, Number(req.query.page_size) || 20)); // 每页上限 60
    const where: string[] = ["source = 'egluosi'", 'listed = 1', "status = 'active'"]; // 固定条件
    const params: unknown[] = []; // 绑定参数
    const col = (value: string) => (value.startsWith('egluosi-L') ? 'id' : 'code'); // 兼容 id 与 code
    if (c1) { where.push(`c1_id IN (SELECT id FROM catalog_categories WHERE ${col(c1)} = ?)`); params.push(c1); } // 一级
    if (c2) { where.push(`c2_id IN (SELECT id FROM catalog_categories WHERE ${col(c2)} = ?)`); params.push(c2); } // 二级
    if (c3) { where.push(`c3_id IN (SELECT id FROM catalog_categories WHERE ${col(c3)} = ?)`); params.push(c3); } // 三级
    if (brand) { where.push('brand = ?'); params.push(brand); } // 品牌
    if (q) { where.push('(title LIKE ? OR source_id LIKE ? OR brand LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); } // 关键词
    const order =
      sort === 'price_asc' ? 'price_fen ASC, id ASC' :
      sort === 'price_desc' ? 'price_fen DESC, id ASC' :
      sort === 'newest' ? 'synced_at DESC, id ASC' :
      'listed DESC, price_fen DESC, id ASC'; // 排序白名单
    const whereSql = `WHERE ${where.join(' AND ')}`; // WHERE 片段
    const total = (deps.db.prepare(`SELECT COUNT(*) AS n FROM catalog_products ${whereSql}`).get(...params) as { n: number }).n; // 总数
    const rows = deps.db
      .prepare(`SELECT * FROM catalog_products ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>; // 当前页
    res.json({ total, page, page_size: pageSize, items: rows.map(mapProduct) }); // 输出
  });

  /** 商品详情：按本地 id 或源站编码查；附同三级类目推荐。 */
  router.get('/mall/products/:id', (req, res) => {
    const key = String(req.params.id || ''); // 路径参数
    const row = deps.db
      .prepare("SELECT * FROM catalog_products WHERE (id = ? OR source_id = ?) AND source = 'egluosi'")
      .get(key, key) as Record<string, unknown> | undefined; // 单件
    if (!row) throw new AppError('NOT_FOUND', '商品不存在'); // 未命中
    const related = deps.db
      .prepare(
        "SELECT id, title, price_fen, cover_url, brand, category_path FROM catalog_products WHERE c3_id = ? AND id <> ? AND listed = 1 AND status = 'active' ORDER BY price_fen ASC LIMIT 8"
      )
      .all(row.c3_id, row.id) as Array<Record<string, unknown>>; // 同类推荐
    res.json({
      product: mapProduct(row),
      related: related.map((r) => ({
        id: r.id,
        title: r.title,
        price_cents: r.price_fen,
        cover_url: r.cover_url,
        brand: r.brand,
        category_path: parseJson(r.category_path, []),
      })),
    }); // 输出
  });

  /** 图片：内容寻址文件名 + 强缓存；只允许 SHA1.扩展名。 */
  router.get('/mall/img/:file', (req, res) => {
    const file = String(req.params.file || ''); // 文件名
    if (!IMAGE_FILE_RE.test(file)) throw new AppError('NOT_FOUND', '图片不存在'); // 非法文件名直接 404
    const abs = path.join(imageDirOf(deps.env), file); // 绝对路径
    if (!existsSync(abs)) throw new AppError('NOT_FOUND', '图片不存在'); // 未落盘
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 内容寻址，永久缓存
    res.sendFile(abs); // 发送文件
  });

  /** 同步状态：最近批次 + 批次总数。 */
  router.get('/mall/sync/status', (_req, res) => {
    const run = deps.db.prepare(
      `SELECT run_id, started_at, finished_at, status, phase, stats, error FROM catalog_sync_runs
        ORDER BY (stats LIKE '%"repair":true%') ASC, started_at DESC LIMIT 1`
    ).get() as
      | Record<string, unknown>
      | undefined; // 最近批次
    const runs = (deps.db.prepare("SELECT COUNT(*) AS n FROM catalog_sync_runs WHERE source = 'egluosi'").get() as { n: number }).n; // 批次数
    res.json({ runs, latest: run ? { ...run, stats: parseJson(run.stats, {}) } : null }); // 输出
  });

  return router; // 返回
}
