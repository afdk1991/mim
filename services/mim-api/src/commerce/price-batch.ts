/**
 * 批量改价（商业化三期）
 *
 * 覆盖两类可售目标：
 *   - module：模块当前生效价格行（module_prices 中时间窗口覆盖当前时刻的行）；
 *   - shop_product：独立商城商品（shop_products.price_cents）。
 *
 * 三种调价模式：
 *   - fixed   固定价：direction 固定 set，value 为新价（分）；
 *   - percent 百分比增减：value 为百分点（1–100），按原价上下浮动；
 *   - amount  固定金额增减：value 为分，在原价上加减。
 *
 * 安全与可追溯：
 *   - 事务化：整批命中 / 跳过 / 写入同一事务，任一失败整体回滚；
 *   - 幂等键：(actor_id, idempotency_key) 唯一，重复提交回放同一批；
 *   - 改前快照：逐条记录 before/after，可回滚到上一批；
 *   - 审计留痕：批次头表 + 明细表全量留存操作人、模式、参数与筛选条件；
 *   - 0 价免费商品不参与调价（模块无价格行 / 价格为 0、商品价格为 0 一律跳过）。
 */

import { AppError, uuidv7 } from '@mim/core-domain'; // 业务异常 + 主键
import type { Db } from '../types.js'; // 数据库连接类型

/** 调价模式：固定价 / 百分比 / 固定金额 */
export type BatchMode = 'fixed' | 'percent' | 'amount';
/** 调价方向：固定 / 上调 / 下调 */
export type BatchDirection = 'set' | 'increase' | 'decrease';
/** 目标类型：模块 / 独立商城商品 */
export type BatchTargetType = 'module' | 'shop_product';

/** 筛选条件：全部可选，缺省按目标类型取在售集合 */
export interface BatchFilter {
  region?: string; // 仅模块：区域 cn / global
  category_slug?: string; // 仅模块：一级 slug（前缀覆盖二级）或二级 slug（精确）
  codes?: string[]; // 显式编码清单（模块 code / 商品 code），与其它条件取交集
  include_inactive?: boolean; // 是否纳入下架 / 归档目标；缺省 false 只改在售
}

/** 批量改价请求（路由层校验后透传） */
export interface BatchRequest {
  targetType: BatchTargetType; // 目标类型
  mode: BatchMode; // 调价模式
  direction: BatchDirection; // 调价方向
  value: number; // 模式参数：新价 / 百分点 / 金额（分）
  filter: BatchFilter; // 筛选条件快照
  idempotencyKey: string; // 幂等键（操作人作用域内唯一）
  actorId: string; // 操作人用户 ID 或 bootstrap 标记
}

/** 批次明细视图 */
export interface BatchItemView {
  target_type: BatchTargetType; // 目标类型
  target_id: string; // 目标主键
  target_code: string | null; // 对外编码
  currency: string | null; // 币种（模块价格行）
  before_amount_minor: number | null; // 改前价格（分）
  after_amount_minor: number | null; // 改后价格（分）
  skipped: boolean; // 是否按安全规则跳过
  reason: string | null; // 跳过原因
}

/** 批次对外视图 */
export interface BatchView {
  id: string; // 批次主键
  idempotency_key: string; // 幂等键
  target_type: BatchTargetType; // 目标类型
  mode: BatchMode; // 调价模式
  direction: BatchDirection; // 调价方向
  value: number; // 模式参数
  filter: BatchFilter; // 筛选条件快照
  total: number; // 命中目标数
  changed: number; // 实际改动数
  skipped: number; // 跳过数
  created_at: string; // 创建时间
  rolled_back_at: string | null; // 回滚时间；null 表示未回滚
  items: BatchItemView[]; // 明细快照
}

/** 入参形态校验：模式与方向必须匹配，参数落在合法区间 */
function validateRequest(req: BatchRequest): void {
  if (!Number.isInteger(req.value) || req.value < 0) {
    throw new AppError('VALIDATION_FAILED', 'value must be a non-negative integer', { field: 'value' }); // 金额 / 比例均为非负整数
  }
  if (req.mode === 'fixed') {
    if (req.direction !== 'set') throw new AppError('VALIDATION_FAILED', 'fixed price mode requires direction=set'); // 固定价无增减方向
  } else {
    if (req.direction !== 'increase' && req.direction !== 'decrease') {
      throw new AppError('VALIDATION_FAILED', `${req.mode} mode requires direction=increase|decrease`); // 增减模式必须带方向
    }
    if (req.mode === 'percent' && (req.value < 1 || req.value > 100)) {
      throw new AppError('VALIDATION_FAILED', 'percent value must be between 1 and 100'); // 百分比区间
    }
  }
}

/** 按模式计算新价；结果夹到非负整数（分） */
function applyMode(mode: BatchMode, direction: BatchDirection, value: number, oldPrice: number): number {
  if (mode === 'fixed') return value; // 固定价直接覆盖
  if (mode === 'percent') {
    const factor = direction === 'increase' ? (100 + value) / 100 : (100 - value) / 100; // 上浮 / 下浮系数
    return Math.max(0, Math.round(oldPrice * factor)); // 四舍五入到分，不为负
  }
  // amount：固定金额加减
  return Math.max(0, direction === 'increase' ? oldPrice + value : oldPrice - value);
}

/** 目标候选行：统一成内部结构，模块与商品两条查询各自填充 */
interface Candidate {
  targetId: string; // 目标主键
  targetCode: string; // 对外编码
  currency: string | null; // 币种（商品无币种，落 null）
  priceRowId: string | null; // 模块价格行主键（回滚定位用）
  current: number; // 当前价格（分）
  status: string; // 在售状态
  categorySlug: string | null; // 归属二级分类标识（商品为空）
}

/** 解析模块候选：当前生效价格行 + 模块状态 / 分类 / 区域 */
function resolveModuleCandidates(db: Db, filter: BatchFilter, now: string): Candidate[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.code, m.status, m.category_slug,
              p.id AS price_row_id, p.currency, p.amount_minor
         FROM modules m
         LEFT JOIN module_prices p ON p.module_id = m.id
           AND p.effective_from <= ? AND (p.effective_to IS NULL OR p.effective_to >= ?)
        WHERE m.deleted_at IS NULL
          AND (? = '' OR m.region = ?)`,
    )
    .all(now, now, filter.region ?? '', filter.region ?? '') as Array<{
      id: string; code: string; status: string; category_slug: string | null;
      price_row_id: string | null; currency: string | null; amount_minor: number | null;
    }>;
  return rows.map((row) => ({
    targetId: row.id, targetCode: row.code, currency: row.currency, priceRowId: row.price_row_id,
    current: row.amount_minor ?? 0, status: row.status, categorySlug: row.category_slug,
  }));
}

/** 解析独立商城商品候选 */
function resolveShopCandidates(db: Db): Candidate[] {
  const rows = db
    .prepare('SELECT id, code, price_cents, status FROM shop_products')
    .all() as Array<{ id: string; code: string; price_cents: number; status: string }>;
  return rows.map((row) => ({ targetId: row.id, targetCode: row.code, currency: null, priceRowId: null, current: row.price_cents, status: row.status, categorySlug: null }));
}

/** 按筛选条件收敛候选集；分类前缀 / 编码清单 / 在售状态三类过滤取交集 */
function filterCandidates(candidates: Candidate[], filter: BatchFilter): Candidate[] {
  const codeSet = filter.codes && filter.codes.length > 0 ? new Set(filter.codes) : null; // 显式编码清单
  const category = filter.category_slug?.trim() ?? ''; // 分类过滤条件
  return candidates.filter((item) => {
    if (codeSet && !codeSet.has(item.targetCode)) return false; // 编码不在清单内剔除
    if (!filter.include_inactive && item.status !== 'active') return false; // 缺省只改在售
    if (category) {
      const slug = item.categorySlug ?? ''; // 商品无分类标识
      if (!slug || (slug !== category && !slug.startsWith(`${category}-`))) return false; // 二级精确 / 一级前缀
    }
    return true;
  });
}

interface BatchHeaderRow { // 批次头表行结构
  id: string; idempotency_key: string; actor_id: string; target_type: BatchTargetType;
  mode: BatchMode; direction: BatchDirection; value: number; filter_json: string;
  total: number; changed: number; skipped: number; created_at: string; rolled_back_at: string | null;
}

interface BatchItemRow { // 批次明细表行结构
  target_type: BatchTargetType; target_id: string; price_row_id: string | null; target_code: string | null;
  currency: string | null; before_amount_minor: number | null; after_amount_minor: number | null;
  skipped: number; reason: string | null;
}

/** 把库内批次行组装成对外视图（明细一并带出） */
function toBatchView(db: Db, header: BatchHeaderRow): BatchView {
  const items = db.prepare('SELECT * FROM price_batch_items WHERE batch_id = ? ORDER BY rowid ASC').all(header.id) as BatchItemRow[];
  return {
    id: header.id, idempotency_key: header.idempotency_key, target_type: header.target_type,
    mode: header.mode, direction: header.direction, value: header.value,
    filter: JSON.parse(header.filter_json) as BatchFilter,
    total: header.total, changed: header.changed, skipped: header.skipped,
    created_at: header.created_at, rolled_back_at: header.rolled_back_at,
    items: items.map((item) => ({
      target_type: item.target_type, target_id: item.target_id, target_code: item.target_code,
      currency: item.currency, before_amount_minor: item.before_amount_minor, after_amount_minor: item.after_amount_minor,
      skipped: item.skipped === 1, reason: item.reason,
    })),
  };
}

/** 按主键取批次；不存在返回 null */
export function getBatch(db: Db, batchId: string): BatchView | null {
  const header = db.prepare('SELECT * FROM price_batches WHERE id = ?').get(batchId) as BatchHeaderRow | undefined;
  return header ? toBatchView(db, header) : null;
}

/** 批次列表（倒序，便于后台最近操作优先查看） */
export function listBatches(db: Db, limit = 50): BatchView[] {
  const headers = db.prepare('SELECT * FROM price_batches ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as BatchHeaderRow[];
  return headers.map((header) => toBatchView(db, header));
}

/**
 * 执行一批调价：校验 → 解析候选 → 事务内快照 / 计算 / 写入 / 留痕。
 * 同幂等键重复提交直接回放既有批次，不二次改价。
 */
export function runPriceBatch(db: Db, req: BatchRequest, now: string): BatchView {
  validateRequest(req); // 模式 / 方向 / 参数区间校验

  const replay = db // 幂等回放：同操作人同键已有批次
    .prepare('SELECT * FROM price_batches WHERE actor_id = ? AND idempotency_key = ?')
    .get(req.actorId, req.idempotencyKey) as BatchHeaderRow | undefined;
  if (replay) return toBatchView(db, replay); // 回放既有结果，不重复改价

  const candidates = filterCandidates( // 解析并收敛候选集
    req.targetType === 'module' ? resolveModuleCandidates(db, req.filter, now) : resolveShopCandidates(db),
    req.filter,
  );

  const batchId = uuidv7(); // 批次主键
  const items: Array<{ row: BatchItemRow; after: number | null; priceRowId: string | null }> = []; // 待写明细 + 改动定位
  let changed = 0; // 实际改动计数
  let skipped = 0; // 跳过计数

  for (const candidate of candidates) { // 逐条计算新价与跳过原因
    if (candidate.current <= 0) { // 0 价免费商品不参与调价，避免把免费品误改成付费
      skipped += 1;
      items.push({ row: { target_type: req.targetType, target_id: candidate.targetId, price_row_id: candidate.priceRowId, target_code: candidate.targetCode, currency: candidate.currency, before_amount_minor: 0, after_amount_minor: 0, skipped: 1, reason: 'free_zero_price' }, after: null, priceRowId: candidate.priceRowId });
      continue;
    }
    const after = applyMode(req.mode, req.direction, req.value, candidate.current); // 计算新价
    if (after === candidate.current) { // 计算结果与原价一致：记跳过，不产生无意义写入
      skipped += 1;
      items.push({ row: { target_type: req.targetType, target_id: candidate.targetId, price_row_id: candidate.priceRowId, target_code: candidate.targetCode, currency: candidate.currency, before_amount_minor: candidate.current, after_amount_minor: candidate.current, skipped: 1, reason: 'unchanged' }, after: null, priceRowId: candidate.priceRowId });
      continue;
    }
    changed += 1;
    items.push({ row: { target_type: req.targetType, target_id: candidate.targetId, price_row_id: candidate.priceRowId, target_code: candidate.targetCode, currency: candidate.currency, before_amount_minor: candidate.current, after_amount_minor: after, skipped: 0, reason: null }, after, priceRowId: candidate.priceRowId });
  }

  const tx = db.transaction(() => { // 整批同一事务：快照、改价、留痕要么全成要么全回滚
    db.prepare( // 批次头表：模式 / 参数 / 筛选条件全量快照留痕
      `INSERT INTO price_batches (id, idempotency_key, actor_id, target_type, mode, direction, value, filter_json, total, changed, skipped, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(batchId, req.idempotencyKey, req.actorId, req.targetType, req.mode, req.direction, req.value, JSON.stringify(req.filter), candidates.length, changed, skipped, now);

    const insertItem = db.prepare( // 明细行：改前 / 改后快照
      `INSERT INTO price_batch_items (id, batch_id, target_type, target_id, price_row_id, target_code, currency, before_amount_minor, after_amount_minor, skipped, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateModulePrice = db.prepare('UPDATE module_prices SET amount_minor = ? WHERE id = ?'); // 模块：改当前生效价格行
    const updateShopPrice = db.prepare('UPDATE shop_products SET price_cents = ? WHERE id = ?'); // 商品：直接改列

    for (const item of items) { // 逐条写明细并落新价
      insertItem.run(`pbi-${uuidv7()}`, batchId, item.row.target_type, item.row.target_id, item.row.price_row_id, item.row.target_code, item.row.currency, item.row.before_amount_minor, item.row.after_amount_minor, item.row.skipped, item.row.reason, now);
      if (item.after === null) continue; // 跳过项不改价
      if (req.targetType === 'module') {
        if (!item.priceRowId) continue; // 无生效价格行（免费模块）已在上面跳过，兜底防呆
        updateModulePrice.run(item.after, item.priceRowId); // 改模块价格行
      } else {
        updateShopPrice.run(item.after, item.row.target_id); // 改商品价格
      }
    }
  });
  tx(); // 执行事务
  return getBatch(db, batchId)!; // 回读组装视图
}

/**
 * 回滚一批调价：按明细快照把非跳过项恢复到改前价格，整批同一事务。
 * 已回滚的批次重复回滚返回 409，避免二次恢复覆盖后续人工调价。
 */
export function rollbackBatch(db: Db, batchId: string, now: string): BatchView {
  const header = db.prepare('SELECT * FROM price_batches WHERE id = ?').get(batchId) as BatchHeaderRow | undefined;
  if (!header) throw new AppError('NOT_FOUND', 'price batch not found', { batch_id: batchId }); // 批次不存在
  if (header.rolled_back_at) throw new AppError('CONFLICT', 'price batch already rolled back', { batch_id: batchId, rolled_back_at: header.rolled_back_at }); // 重复回滚冲突

  const items = db.prepare('SELECT * FROM price_batch_items WHERE batch_id = ? AND skipped = 0').all(batchId) as BatchItemRow[]; // 只恢复实际改动项
  const tx = db.transaction(() => {
    const restoreModule = db.prepare('UPDATE module_prices SET amount_minor = ? WHERE id = ?'); // 恢复模块价格行
    const restoreShop = db.prepare('UPDATE shop_products SET price_cents = ? WHERE id = ?'); // 恢复商品价格
    for (const item of items) { // 逐条按快照恢复
      if (item.before_amount_minor === null) continue; // 无快照不恢复
      if (item.target_type === 'module') {
        if (item.price_row_id) restoreModule.run(item.before_amount_minor, item.price_row_id); // 按价格行定位恢复
      } else {
        restoreShop.run(item.before_amount_minor, item.target_id); // 按商品主键恢复
      }
    }
    db.prepare('UPDATE price_batches SET rolled_back_at = ? WHERE id = ?').run(now, batchId); // 标记已回滚
  });
  tx();
  return getBatch(db, batchId)!; // 回读最新视图
}
