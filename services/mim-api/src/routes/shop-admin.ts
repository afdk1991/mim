/**
 * 独立商城后台写入面（RBAC 控制面）：商品 / 优惠码 / 充值卡密 / VIP 套餐四类数据的 CRUD。
 *
 * 鉴权口径：全部端点挂 `requirePermission('commerce:write')`；
 *   - 未带凭证 / 令牌无效 → 401 AUTH_UNAUTHORIZED（由中间件抛出）；
 *   - 已登录但缺权限点 → 403 FORBIDDEN；
 *   - 入参非法 → 400 VALIDATION_FAILED；
 *   - 唯一键冲突 / 仍被订单引用 → 409 CONFLICT；
 *   - 目标不存在 → 404 NOT_FOUND。
 *
 * 表结构口径：仅读写既有表（shop_products / coupons / wallet_cards / vip_plans /
 * shop_card_keys）；卡密作废留痕列 voided_at 走 schema.d 的 ALTER_ADD 补齐，不改既有建表语句。
 */

import { Router } from 'express'; // 路由工厂：产出可挂到 /api/v1 的 Router 实例
import { randomInt } from 'node:crypto'; // 卡密码段随机字符选取，避免可猜测
import { z } from 'zod'; // 声明式请求体校验，统一经 parse 转译为 VALIDATION_FAILED
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 主键生成
import { clockOf } from '../domain.js'; // 统一时钟：测试可注入固定时间
import { requirePermission } from '../middleware.js'; // 细粒度权限门禁
import { parse } from '../validate.js'; // zod 校验包装：失败抛 VALIDATION_FAILED 并透出 issues
import { jsonParse, pathParam } from '../utils.js'; // JSON 文本容错解析 + 路径参数类型收敛
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与数据库连接类型，仅编译期引用

// ── 行结构与视图映射 ────────────────────────────────────────────────────────

/** 商品表行结构：列名与 schema.sql 严格一一对应 */
interface ProductRow {
  id: string; // 商品主键
  code: string; // 商品编码，唯一，下单按 code 定位
  name: string; // 商品名
  summary: string; // 简介
  kind: 'physical' | 'virtual_auto' | 'virtual_manual'; // 发货方式
  price_cents: number; // 售价（分）
  cover_url: string | null; // 封面图地址，可空
  stock: number; // 实物 / 人工发货库存；自动发卡密商品以卡密可用数为准
  delivery_note: string; // 发货说明
  status: 'active' | 'off'; // 上架位：active 在售，off 下架
  sort_order: number; // 展示排序权重
  created_at: string; // 创建时间
  available: number; // 可售数量（视图计算列：自动发货取未用卡密数）
  key_count: number; // 卡密库存总数（含已用），后台核对用
} // ProductRow 结束

/** 优惠码表行结构 */
interface CouponRow {
  id: string; // 优惠码主键
  code: string; // 优惠码，唯一，入库统一大写
  kind: 'fixed' | 'percent'; // fixed 固定立减 / percent 百分比折扣
  value: number; // fixed 为立减金额（分）；percent 为 1-100
  min_amount_cents: number; // 最低可用订单金额（分）
  max_uses: number; // 最大核销次数，0 表示不限
  used_count: number; // 已核销次数
  active: number; // 1 启用 / 0 停用
  starts_at: string | null; // 生效起始时间，null 表示立即生效
  expires_at: string | null; // 过期时间，null 表示长期有效
} // CouponRow 结束

/** 充值卡密表行结构 */
interface CardRow {
  id: string; // 卡密主键
  code: string; // 卡密码，唯一
  amount_cents: number; // 面额（分）
  status: 'unused' | 'used'; // 兑换状态
  used_by: string | null; // 兑换用户 ID
  used_at: string | null; // 兑换时间
  voided_at: string | null; // 作废时间，null 表示未作废
  created_at: string; // 生成时间
} // CardRow 结束

/** VIP 套餐表行结构 */
interface PlanRow {
  id: string; // 套餐主键
  code: string; // 套餐编码，唯一
  name: string; // 套餐名
  level: number; // 会员等级
  price_cents: number; // 售价（分）
  duration_days: number; // 有效期天数
  perks: string; // 权益清单 JSON 文本
  sort_order: number; // 展示排序权重
  active: number; // 1 启用 / 0 停用
} // PlanRow 结束

/** 商品对外视图：直接透传既有字段，available / key_count 供后台库存核对 */
function productView(row: ProductRow) {
  return { // 返回前端可直接渲染的对象
    id: row.id, // 商品主键
    code: row.code, // 编码
    name: row.name, // 名称
    summary: row.summary, // 简介
    kind: row.kind, // 发货方式
    price_cents: row.price_cents, // 售价（分）
    cover_url: row.cover_url, // 封面
    stock: row.stock, // 登记库存
    available: row.available, // 可售数量
    key_count: row.key_count, // 卡密总数
    delivery_note: row.delivery_note, // 发货说明
    status: row.status, // 上架位
    sort_order: row.sort_order, // 排序
    created_at: row.created_at, // 创建时间
  }; // 视图对象结束
} // productView 结束

/** 优惠码对外视图 */
function couponView(row: CouponRow) {
  return { // 返回前端可直接渲染的对象
    id: row.id, // 主键
    code: row.code, // 优惠码
    kind: row.kind, // 类型
    value: row.value, // 面值 / 折扣比例
    min_amount_cents: row.min_amount_cents, // 最低金额
    max_uses: row.max_uses, // 最大次数
    used_count: row.used_count, // 已用次数
    active: row.active === 1, // 启停布尔化
    starts_at: row.starts_at, // 生效起
    expires_at: row.expires_at, // 过期止
  }; // 视图对象结束
} // couponView 结束

/** 充值卡密对外视图 */
function cardView(row: CardRow) {
  return { // 返回前端可直接渲染的对象
    id: row.id, // 主键
    code: row.code, // 卡密码
    amount_cents: row.amount_cents, // 面额（分）
    status: row.status, // 兑换状态
    used_by: row.used_by, // 兑换人
    used_at: row.used_at, // 兑换时间
    voided: row.voided_at !== null, // 是否已作废
    voided_at: row.voided_at, // 作废时间
    created_at: row.created_at, // 生成时间
  }; // 视图对象结束
} // cardView 结束

/** VIP 套餐对外视图：perks JSON 容错解析为字符串数组 */
function planView(row: PlanRow) {
  return { // 返回前端可直接渲染的对象
    id: row.id, // 主键
    code: row.code, // 编码
    name: row.name, // 名称
    level: row.level, // 等级
    price_cents: row.price_cents, // 售价（分）
    duration_days: row.duration_days, // 有效期天数
    perks: jsonParse<string[]>(row.perks) ?? [], // 权益清单
    sort_order: row.sort_order, // 排序
    active: row.active === 1, // 启停布尔化
  }; // 视图对象结束
} // planView 结束

// ── 入参 schema ──────────────────────────────────────────────────────────────

/** 商品编码：小写字母 / 数字开头，可含连字符与下划线，3-60 位 */
const PRODUCT_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,59}$/; // 编码正则常量

/** 商品创建入参 */
const productCreateSchema = z.object({
  code: z.string().regex(PRODUCT_CODE_RE, 'code must match ^[a-z0-9][a-z0-9_-]{1,59}$'), // 商品编码
  name: z.string().min(1).max(80), // 商品名
  summary: z.string().max(500).optional().default(''), // 简介
  kind: z.enum(['physical', 'virtual_auto', 'virtual_manual']), // 发货方式
  price_cents: z.number().int().min(0).max(100_000_000), // 售价（分），上限 100 万元兜底
  cover_url: z.string().max(500).nullable().optional(), // 封面，可空
  stock: z.number().int().min(0).max(1_000_000).optional().default(0), // 实物 / 人工库存
  delivery_note: z.string().max(500).optional().default(''), // 发货说明
  status: z.enum(['active', 'off']).optional().default('active'), // 上架位，默认在售
  sort_order: z.number().int().min(0).max(1000).optional().default(0), // 排序权重
  card_keys: z.array(z.string().trim().min(1).max(64)).max(500).optional().default([]), // 自动发货卡密批次
}); // productCreateSchema 结束

/** 商品修改入参：除 code 外业务字段均可局部更新，至少提供一项 */
const productUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(), // 名称
  summary: z.string().max(500).optional(), // 简介
  price_cents: z.number().int().min(0).max(100_000_000).optional(), // 售价
  cover_url: z.string().max(500).nullable().optional(), // 封面
  stock: z.number().int().min(0).max(1_000_000).optional(), // 库存
  delivery_note: z.string().max(500).optional(), // 发货说明
  status: z.enum(['active', 'off']).optional(), // 上架位
  sort_order: z.number().int().min(0).max(1000).optional(), // 排序
  card_keys: z.array(z.string().trim().min(1).max(64)).max(500).optional(), // 追加卡密批次
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' }); // 空 PATCH 判 400

/** 优惠码编码：大写字母 / 数字开头，可含连字符，2-40 位（入库统一大写） */
const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/; // 优惠码正则常量

/** 优惠码创建入参 */
const couponCreateSchema = z.object({
  code: z.string().regex(COUPON_CODE_RE, 'code must match ^[A-Z0-9][A-Z0-9_-]{1,39}$'), // 优惠码
  kind: z.enum(['fixed', 'percent']), // 类型
  value: z.number().int().min(1).max(100_000_000), // 面值 / 比例
  min_amount_cents: z.number().int().min(0).max(100_000_000).optional().default(0), // 最低可用金额
  max_uses: z.number().int().min(0).max(1_000_000).optional().default(0), // 最大核销次数
  active: z.boolean().optional().default(true), // 启停，默认启用
  starts_at: z.string().nullable().optional(), // 生效起始（ISO 或日期串）
  expires_at: z.string().nullable().optional(), // 过期时间
}).refine( // 按类型收敛取值区间
  (value) => value.kind === 'fixed' || (value.value >= 1 && value.value <= 100), // percent 必须落在 1-100
  { message: 'percent coupon value must be between 1 and 100' }, // 区间非法即 400
); // couponCreateSchema 结束

/** 优惠码修改入参：至少提供一项可改字段 */
const couponUpdateSchema = z.object({
  value: z.number().int().min(1).max(100_000_000).optional(), // 面值 / 比例
  min_amount_cents: z.number().int().min(0).max(100_000_000).optional(), // 最低金额
  max_uses: z.number().int().min(0).max(1_000_000).optional(), // 最大次数
  active: z.boolean().optional(), // 启停
  starts_at: z.string().nullable().optional(), // 生效起
  expires_at: z.string().nullable().optional(), // 过期止
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' }); // 空 PATCH 判 400

/** 卡密批次生成入参 */
const cardBatchSchema = z.object({
  amount_cents: z.number().int().min(1).max(100_000_000), // 面额（分）
  count: z.number().int().min(1).max(500), // 单次生成张数上限 500
}); // cardBatchSchema 结束

/** VIP 套餐编码：与商品编码同口径 */
const PLAN_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,59}$/; // 套餐编码正则常量

/** VIP 套餐创建入参 */
const planCreateSchema = z.object({
  code: z.string().regex(PLAN_CODE_RE, 'code must match ^[a-z0-9][a-z0-9_-]{1,59}$'), // 套餐编码
  name: z.string().min(1).max(80), // 套餐名
  level: z.number().int().min(1).max(10), // 会员等级 1-10
  price_cents: z.number().int().min(0).max(100_000_000), // 售价（分）
  duration_days: z.number().int().min(1).max(3650), // 有效期天数，上限 10 年
  perks: z.array(z.string().max(80)).max(20).optional().default([]), // 权益清单
  sort_order: z.number().int().min(0).max(1000).optional().default(0), // 排序
  active: z.boolean().optional().default(true), // 启停，默认启用
}); // planCreateSchema 结束

/** VIP 套餐修改入参：至少提供一项 */
const planUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(), // 名称
  level: z.number().int().min(1).max(10).optional(), // 等级
  price_cents: z.number().int().min(0).max(100_000_000).optional(), // 售价
  duration_days: z.number().int().min(1).max(3650).optional(), // 天数
  perks: z.array(z.string().max(80)).max(20).optional(), // 权益清单
  sort_order: z.number().int().min(0).max(1000).optional(), // 排序
  active: z.boolean().optional(), // 启停
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' }); // 空 PATCH 判 400

// ── 内部辅助 ────────────────────────────────────────────────────────────────

/** 卡密码段字符集：剔除易混淆字符（0/O、1/I/L），便于人工录入 */
const CARD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 字符集常量

/** 生成一张不与现有卡密冲突的码：MIM-XXXXXXXXXX；碰撞重试有限次 */
function generateCardCode(db: Db): string {
  for (let attempt = 0; attempt < 5; attempt += 1) { // 碰撞重试上限，避免极端情况下死循环
    const body = Array.from({ length: 10 }, () => CARD_ALPHABET[randomInt(CARD_ALPHABET.length)]).join(''); // 10 位随机码段
    const code = `MIM-${body}`; // 固定前缀 + 随机段
    const exists = db.prepare('SELECT id FROM wallet_cards WHERE code = ?').get(code) as { id: string } | undefined; // 唯一键预检
    if (!exists) return code; // 未占用即可用
  } // 重试循环结束
  throw new AppError('CONFLICT', 'card code collision, please retry', {}); // 极端碰撞兜底 409
} // generateCardCode 结束

/** 按商品编码加载行；不存在抛 404 */
function requireProduct(db: Db, code: string): ProductRow {
  const row = db.prepare('SELECT * FROM shop_products WHERE code = ?').get(code) as ProductRow | undefined; // 编码精确取行
  if (!row) throw new AppError('NOT_FOUND', 'product not found', { product_code: code }); // 404
  return row; // 命中返回行
} // requireProduct 结束

/** 按优惠码加载行；不存在抛 404 */
function requireCoupon(db: Db, code: string): CouponRow {
  const row = db.prepare('SELECT * FROM coupons WHERE code = ?').get(code) as CouponRow | undefined; // 编码精确取行
  if (!row) throw new AppError('NOT_FOUND', 'coupon not found', { coupon_code: code }); // 404
  return row; // 命中返回行
} // requireCoupon 结束

/** 按套餐编码加载行；不存在抛 404 */
function requirePlan(db: Db, code: string): PlanRow {
  const row = db.prepare('SELECT * FROM vip_plans WHERE code = ?').get(code) as PlanRow | undefined; // 编码精确取行
  if (!row) throw new AppError('NOT_FOUND', 'vip plan not found', { plan_code: code }); // 404
  return row; // 命中返回行
} // requirePlan 结束

/** 统计某商品是否已被订单引用（有引用禁止删除，保护成交历史） */
function productOrderCount(db: Db, productId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM shop_orders WHERE product_id = ?').get(productId) as { total: number }; // 计数一行
  return row.total; // 返回引用条数
} // productOrderCount 结束

/** 统计某优惠码是否已被核销引用（有引用禁止删除，保留对账记录） */
function couponRedemptionCount(db: Db, couponId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM coupon_redemptions WHERE coupon_id = ?').get(couponId) as { total: number }; // 计数一行
  return row.total; // 返回引用条数
} // couponRedemptionCount 结束

/** 统计某套餐是否仍有生效 / 历史会员归属（有引用禁止删除） */
function planMembershipCount(db: Db, planId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM vip_memberships WHERE plan_id = ?').get(planId) as { total: number }; // 计数一行
  return row.total; // 返回引用条数
} // planMembershipCount 结束

/** 把追加的卡密批次写入指定商品；空列表直接跳过 */
function insertCardKeyBatch(db: Db, productId: string, keys: string[], now: string): void {
  const uniqueKeys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))]; // 去重去空
  if (uniqueKeys.length === 0) return; // 无批次可写
  const insert = db.prepare('INSERT OR IGNORE INTO shop_card_keys (id, product_id, code, status, created_at) VALUES (?, ?, ?, \'unused\', ?)'); // 幂等插入
  for (const key of uniqueKeys) { // 逐条写入，重复码由 UNIQUE 约束忽略
    insert.run(uuidv7(), productId, key, now); // 绑定主键、商品、卡密与时间
  } // 批次循环结束
} // insertCardKeyBatch 结束

// ── 路由装配 ─────────────────────────────────────────────────────────────────

export function createShopAdminRouter(deps: ApiDeps): Router { // 导出工厂：对外暴露装配入口
  const router = Router(); // 独立 Router，避免影响其它命名空间的注册顺序
  const db = deps.db; // 依赖提升为局部变量，处理器内少一次属性访问
  const perm = requirePermission('commerce:write'); // 本面全部写读操作共用交易权限点

  // ── 商品 ──────────────────────────────────────────────────────────────────

  /** GET /admin/shop/products — 商品全量列表（含下架），附可售数量与卡密总数 */
  router.get('/admin/shop/products', perm, (_req, res) => {
    const rows = db.prepare(
      `SELECT p.*,
              CASE WHEN p.kind = 'virtual_auto'
                THEN (SELECT COUNT(*) FROM shop_card_keys k WHERE k.product_id = p.id AND k.status = 'unused')
                ELSE p.stock END AS available,
              (SELECT COUNT(*) FROM shop_card_keys k WHERE k.product_id = p.id) AS key_count
         FROM shop_products p
        ORDER BY p.sort_order, p.code`, // 排序权重优先，其次编码保证输出稳定
    ).all() as ProductRow[]; // 商品总量有限，一次性全取
    res.json({ products: rows.map(productView) }); // 统一包一层 products 字段
  }); // GET 商品列表结束

  /** POST /admin/shop/products — 新建商品；自动发货商品可随单录入卡密批次 */
  router.post('/admin/shop/products', perm, (req, res) => {
    const body = parse(productCreateSchema, req.body); // 先校验入参形态，非法直接 400
    if (body.kind !== 'virtual_auto' && body.card_keys.length > 0) { // 非自动发货商品挂卡密无意义
      throw new AppError('VALIDATION_FAILED', 'card_keys only apply to virtual_auto products', { field: 'card_keys' }); // 400
    } // 卡密适用范围校验结束
    const dup = db.prepare('SELECT id FROM shop_products WHERE code = ?').get(body.code) as { id: string } | undefined; // 唯一键预检
    if (dup) throw new AppError('CONFLICT', 'product code already exists', { product_code: body.code }); // 409
    const now = clockOf(deps); // 统一时间源
    const productId = uuidv7(); // 新商品主键
    const createProduct = db.transaction(() => { // 商品主体与卡密批次同批生效
      db.prepare(
        `INSERT INTO shop_products (id, code, name, summary, kind, price_cents, cover_url, stock, delivery_note, status, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        productId, body.code, body.name, body.summary, body.kind, body.price_cents,
        body.cover_url ?? null, body.stock, body.delivery_note, body.status, body.sort_order, now,
      ); // 写入商品主体
      if (body.kind === 'virtual_auto') insertCardKeyBatch(db, productId, body.card_keys, now); // 自动发货：落卡密批次
    }); // 事务定义结束
    createProduct(); // 执行事务
    const created = db.prepare('SELECT * FROM shop_products WHERE id = ?').get(productId) as ProductRow; // 回读完整行
    res.status(201).json({ product: productView({ ...created, available: created.kind === 'virtual_auto' ? body.card_keys.length : created.stock, key_count: body.card_keys.length }) }); // 回传创建视图
  }); // POST 商品结束

  /** PUT /admin/shop/products/:code — 局部更新商品；编码不可改，可追加卡密批次 */
  router.put('/admin/shop/products/:code', perm, (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const existing = requireProduct(db, code); // 存在性 + 取行
    const body = parse(productUpdateSchema, req.body); // 校验可改字段
    if (body.card_keys !== undefined && existing.kind !== 'virtual_auto') { // 追加批次同样只对自动发货生效
      throw new AppError('VALIDATION_FAILED', 'card_keys only apply to virtual_auto products', { field: 'card_keys' }); // 400
    } // 批次适用范围校验结束
    const now = clockOf(deps); // 统一时间源
    const sets: string[] = []; // SET 子句列清单
    const values: unknown[] = []; // 与 SET 对齐的绑定值
    if (body.name !== undefined) { sets.push('name = ?'); values.push(body.name); } // 名称
    if (body.summary !== undefined) { sets.push('summary = ?'); values.push(body.summary); } // 简介
    if (body.price_cents !== undefined) { sets.push('price_cents = ?'); values.push(body.price_cents); } // 售价
    if (body.cover_url !== undefined) { sets.push('cover_url = ?'); values.push(body.cover_url ?? null); } // 封面
    if (body.stock !== undefined) { sets.push('stock = ?'); values.push(body.stock); } // 库存
    if (body.delivery_note !== undefined) { sets.push('delivery_note = ?'); values.push(body.delivery_note); } // 发货说明
    if (body.status !== undefined) { sets.push('status = ?'); values.push(body.status); } // 上架位
    if (body.sort_order !== undefined) { sets.push('sort_order = ?'); values.push(body.sort_order); } // 排序
    const updateProduct = db.transaction(() => { // 字段更新与卡密追加同事务
      if (sets.length > 0) { // 有字段变更才执行 UPDATE
        db.prepare(`UPDATE shop_products SET ${sets.join(', ')} WHERE id = ?`).run(...values, existing.id); // 列名全部来自代码常量，无注入风险
      } // 字段更新结束
      if (body.card_keys !== undefined) insertCardKeyBatch(db, existing.id, body.card_keys, now); // 追加卡密批次
    }); // 事务定义结束
    updateProduct(); // 执行事务
    const updated = db.prepare('SELECT * FROM shop_products WHERE id = ?').get(existing.id) as ProductRow; // 回读
    const available = updated.kind === 'virtual_auto'
      ? (db.prepare("SELECT COUNT(*) AS n FROM shop_card_keys WHERE product_id = ? AND status = 'unused'").get(updated.id) as { n: number }).n
      : updated.stock; // 可售数量按发货方式口径计算
    const keyCount = (db.prepare('SELECT COUNT(*) AS n FROM shop_card_keys WHERE product_id = ?').get(updated.id) as { n: number }).n; // 卡密总数
    res.json({ product: productView({ ...updated, available, key_count: keyCount }) }); // 回传更新视图
  }); // PUT 商品结束

  /** DELETE /admin/shop/products/:code — 删除商品；已有订单引用时 409 保护历史 */
  router.delete('/admin/shop/products/:code', perm, (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const existing = requireProduct(db, code); // 存在性 + 取行
    const orders = productOrderCount(db, existing.id); // 订单引用计数
    if (orders > 0) { // 仍被成交订单引用
      throw new AppError('CONFLICT', 'product is referenced by orders', { product_code: code, orders }); // 409
    } // 引用保护结束
    const removeProduct = db.transaction(() => { // 先清卡密库存，再删商品主体
      db.prepare('DELETE FROM shop_card_keys WHERE product_id = ?').run(existing.id); // 卡密随商品一并移除
      db.prepare('DELETE FROM shop_products WHERE id = ?').run(existing.id); // 删除商品行
    }); // 事务定义结束
    removeProduct(); // 执行事务
    res.json({ code, deleted: true }); // 明确告知删除成功
  }); // DELETE 商品结束

  // ── 优惠码 ────────────────────────────────────────────────────────────────

  /** GET /admin/coupons — 优惠码全量列表（含停用与已用完） */
  router.get('/admin/coupons', perm, (_req, res) => {
    const rows = db.prepare('SELECT * FROM coupons ORDER BY code').all() as CouponRow[]; // 编码排序保证输出稳定
    res.json({ coupons: rows.map(couponView) }); // 统一包一层 coupons 字段
  }); // GET 优惠码列表结束

  /** POST /admin/coupons — 新建优惠码；code 入库统一大写 */
  router.post('/admin/coupons', perm, (req, res) => {
    const body = parse(couponCreateSchema, req.body); // 校验入参
    const code = body.code.toUpperCase(); // 归一为大写，避免大小写双码
    const dup = db.prepare('SELECT id FROM coupons WHERE code = ?').get(code) as { id: string } | undefined; // 唯一键预检
    if (dup) throw new AppError('CONFLICT', 'coupon code already exists', { coupon_code: code }); // 409
    const now = clockOf(deps); // 统一时间源（表无 created_at 列，时间仅用于审计上下文）
    void now; // 优惠码表结构不含时间列，保留时钟入口便于后续扩展
    const couponId = uuidv7(); // 新优惠码主键
    db.prepare(
      `INSERT INTO coupons (id, code, kind, value, min_amount_cents, max_uses, used_count, active, starts_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(couponId, code, body.kind, body.value, body.min_amount_cents, body.max_uses, body.active ? 1 : 0, body.starts_at ?? null, body.expires_at ?? null); // 写入主体
    const created = db.prepare('SELECT * FROM coupons WHERE id = ?').get(couponId) as CouponRow; // 回读
    res.status(201).json({ coupon: couponView(created) }); // 回传创建视图
  }); // POST 优惠码结束

  /** PATCH /admin/coupons/:code — 局部更新优惠码（面值 / 门槛 / 次数 / 启停 / 有效期） */
  router.patch('/admin/coupons/:code', perm, (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const existing = requireCoupon(db, code); // 存在性 + 取行
    const body = parse(couponUpdateSchema, req.body); // 校验可改字段
    if (body.value !== undefined && existing.kind === 'percent' && (body.value < 1 || body.value > 100)) {
      throw new AppError('VALIDATION_FAILED', 'percent coupon value must be between 1 and 100', { field: 'value' }); // 比例类型区间守卫
    } // percent 区间校验结束
    const sets: string[] = []; // SET 列清单
    const values: unknown[] = []; // 绑定值
    if (body.value !== undefined) { sets.push('value = ?'); values.push(body.value); } // 面值 / 比例
    if (body.min_amount_cents !== undefined) { sets.push('min_amount_cents = ?'); values.push(body.min_amount_cents); } // 门槛
    if (body.max_uses !== undefined) { sets.push('max_uses = ?'); values.push(body.max_uses); } // 最大次数
    if (body.active !== undefined) { sets.push('active = ?'); values.push(body.active ? 1 : 0); } // 启停
    if (body.starts_at !== undefined) { sets.push('starts_at = ?'); values.push(body.starts_at ?? null); } // 生效起
    if (body.expires_at !== undefined) { sets.push('expires_at = ?'); values.push(body.expires_at ?? null); } // 过期止
    if (sets.length > 0) db.prepare(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`).run(...values, existing.id); // 动态拼 SET，列名来自常量
    const updated = db.prepare('SELECT * FROM coupons WHERE id = ?').get(existing.id) as CouponRow; // 回读
    res.json({ coupon: couponView(updated) }); // 回传更新视图
  }); // PATCH 优惠码结束

  /** DELETE /admin/coupons/:code — 删除优惠码；已被核销引用时 409 保留对账记录 */
  router.delete('/admin/coupons/:code', perm, (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const existing = requireCoupon(db, code); // 存在性 + 取行
    const redemptions = couponRedemptionCount(db, existing.id); // 核销引用计数
    if (redemptions > 0) { // 已有成交核销记录
      throw new AppError('CONFLICT', 'coupon is referenced by redemptions', { coupon_code: code, redemptions }); // 409
    } // 引用保护结束
    db.prepare('DELETE FROM coupons WHERE id = ?').run(existing.id); // 删除优惠码
    res.json({ code, deleted: true }); // 明确告知删除成功
  }); // DELETE 优惠码结束

  // ── 充值卡密 ──────────────────────────────────────────────────────────────

  /** POST /admin/cards/batch — 批量生成充值卡密，返回本批生成的全部码 */
  router.post('/admin/cards/batch', perm, (req, res) => {
    const body = parse(cardBatchSchema, req.body); // 校验面额与张数
    const now = clockOf(deps); // 统一时间源
    const created: CardRow[] = []; // 本批回读行集合
    const batch = db.transaction(() => { // 整批同事务：任一码碰撞 / 写入失败整体回滚
      for (let i = 0; i < body.count; i += 1) { // 逐张生成
        const code = generateCardCode(db); // 取不冲突的码
        const id = uuidv7(); // 主键
        db.prepare('INSERT INTO wallet_cards (id, code, amount_cents, status, used_by, used_at, voided_at, created_at) VALUES (?, ?, ?, \'unused\', NULL, NULL, NULL, ?)')
          .run(id, code, body.amount_cents, now); // 写入未使用卡密
        created.push({ id, code, amount_cents: body.amount_cents, status: 'unused', used_by: null, used_at: null, voided_at: null, created_at: now }); // 纳入回读集合
      } // 批次循环结束
    }); // 事务定义结束
    batch(); // 执行事务
    res.status(201).json({ cards: created.map(cardView), count: created.length }); // 回传本批卡密视图
  }); // POST 卡密批次结束

  /** GET /admin/cards — 卡密列表（最近 500 张）+ 用量统计 */
  router.get('/admin/cards', perm, (_req, res) => {
    const rows = db.prepare('SELECT * FROM wallet_cards ORDER BY created_at DESC, code LIMIT 500').all() as CardRow[]; // 倒序取最近批次
    const stats = db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'unused' AND voided_at IS NULL THEN 1 ELSE 0 END) AS unused,
         SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used,
         SUM(CASE WHEN voided_at IS NOT NULL THEN 1 ELSE 0 END) AS voided
       FROM wallet_cards`,
    ).get() as { total: number; unused: number; used: number; voided: number }; // 聚合统计一行
    res.json({ cards: rows.map(cardView), stats }); // 列表 + 统计一并下发
  }); // GET 卡密列表结束

  /** POST /admin/cards/:code/void — 作废未使用卡密；已兑换不可作废，重复作废幂等 200 */
  router.post('/admin/cards/:code/void', perm, (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const row = db.prepare('SELECT * FROM wallet_cards WHERE code = ?').get(code) as CardRow | undefined; // 按码精确取行
    if (!row) throw new AppError('NOT_FOUND', 'card not found', { card_code: code }); // 404
    if (row.status === 'used') { // 已兑换：金额已入钱包，不可回滚作废
      throw new AppError('CONFLICT', 'used card cannot be voided', { card_code: code }); // 409
    } // 已用保护结束
    if (row.voided_at === null) { // 尚未作废才写留痕，已作废直接回放当前状态
      db.prepare('UPDATE wallet_cards SET voided_at = ? WHERE id = ?').run(clockOf(deps), row.id); // 写作废时间
    } // 幂等分支结束
    const updated = db.prepare('SELECT * FROM wallet_cards WHERE id = ?').get(row.id) as CardRow; // 回读
    res.json({ card: cardView(updated) }); // 回传卡密视图
  }); // POST 卡密作废结束

  // ── VIP 套餐 ─────────────────────────────────────────────────────────────

  /** GET /admin/vip/plans — 套餐全量列表（含停用） */
  router.get('/admin/vip/plans', perm, (_req, res) => {
    const rows = db.prepare('SELECT * FROM vip_plans ORDER BY sort_order, level, code').all() as PlanRow[]; // 排序权重 + 等级稳定输出
    res.json({ plans: rows.map(planView) }); // 统一包一层 plans 字段
  }); // GET 套餐列表结束

  /** POST /admin/vip/plans — 新建 VIP 套餐 */
  router.post('/admin/vip/plans', perm, (req, res) => {
    const body = parse(planCreateSchema, req.body); // 校验入参
    const dup = db.prepare('SELECT id FROM vip_plans WHERE code = ?').get(body.code) as { id: string } | undefined; // 唯一键预检
    if (dup) throw new AppError('CONFLICT', 'vip plan code already exists', { plan_code: body.code }); // 409
    const planId = uuidv7(); // 新套餐主键
    db.prepare(
      `INSERT INTO vip_plans (id, code, name, level, price_cents, duration_days, perks, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(planId, body.code, body.name, body.level, body.price_cents, body.duration_days, JSON.stringify(body.perks), body.sort_order, body.active ? 1 : 0); // 写入主体
    const created = db.prepare('SELECT * FROM vip_plans WHERE id = ?').get(planId) as PlanRow; // 回读
    res.status(201).json({ plan: planView(created) }); // 回传创建视图
  }); // POST 套餐结束

  /** PUT /admin/vip/plans/:code — 局部更新套餐；编码不可改 */
  router.put('/admin/vip/plans/:code', perm, (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const existing = requirePlan(db, code); // 存在性 + 取行
    const body = parse(planUpdateSchema, req.body); // 校验可改字段
    const sets: string[] = []; // SET 列清单
    const values: unknown[] = []; // 绑定值
    if (body.name !== undefined) { sets.push('name = ?'); values.push(body.name); } // 名称
    if (body.level !== undefined) { sets.push('level = ?'); values.push(body.level); } // 等级
    if (body.price_cents !== undefined) { sets.push('price_cents = ?'); values.push(body.price_cents); } // 售价
    if (body.duration_days !== undefined) { sets.push('duration_days = ?'); values.push(body.duration_days); } // 天数
    if (body.perks !== undefined) { sets.push('perks = ?'); values.push(JSON.stringify(body.perks)); } // 权益清单序列化
    if (body.sort_order !== undefined) { sets.push('sort_order = ?'); values.push(body.sort_order); } // 排序
    if (body.active !== undefined) { sets.push('active = ?'); values.push(body.active ? 1 : 0); } // 启停
    if (sets.length > 0) db.prepare(`UPDATE vip_plans SET ${sets.join(', ')} WHERE id = ?`).run(...values, existing.id); // 动态拼 SET，列名来自常量
    const updated = db.prepare('SELECT * FROM vip_plans WHERE id = ?').get(existing.id) as PlanRow; // 回读
    res.json({ plan: planView(updated) }); // 回传更新视图
  }); // PUT 套餐结束

  /** DELETE /admin/vip/plans/:code — 删除套餐；仍有会员归属时 409 保护历史 */
  router.delete('/admin/vip/plans/:code', perm, (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const existing = requirePlan(db, code); // 存在性 + 取行
    const memberships = planMembershipCount(db, existing.id); // 会员引用计数
    if (memberships > 0) { // 仍有历史 / 生效会员
      throw new AppError('CONFLICT', 'vip plan is referenced by memberships', { plan_code: code, memberships }); // 409
    } // 引用保护结束
    db.prepare('DELETE FROM vip_plans WHERE id = ?').run(existing.id); // 删除套餐
    res.json({ code, deleted: true }); // 明确告知删除成功
  }); // DELETE 套餐结束

  return router; // 返回装配完成的管理面路由
} // createShopAdminRouter 结束
