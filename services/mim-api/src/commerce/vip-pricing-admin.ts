/**
 * VIP 定价规则写入路径（管理端专用）。
 *
 * 读取侧见 vip-pricing.ts：公开 GET /vip/prices 只回 enabled=1 的规则。
 * 本文件负责新增 / 修改 / 删除，并保证「同一 (dimension, dimension_value) 只能有一条生效」：
 * 新增启用行或把某行改为启用时，同一事务内把同键其它 enabled=1 行置为 0。
 *
 * 不加唯一索引：生产表可能存在历史重复行，直接加唯一约束会让迁移失败；
 * 约束改由写入路径保证，读路径仍按 enabled=1 过滤。
 * 审计：统一 audit.ts 目前尚未入库，路由层留了明确的接入调用点，本文件不 import 审计。
 */

import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 主键生成
import type { Db } from '../types.js'; // 数据库连接类型，仅编译期引用
import type { VipPriceDimension, VipPriceRuleRow } from './vip-pricing.js'; // 复用读取侧的维度与行类型

/** 库内一行的完整视图：比定价计算用的 VipPriceRuleRow 多出两个时间戳 */
export interface VipPriceRuleRecord extends VipPriceRuleRow {
  created_at: string; // 创建时间（UTC ISO-8601）
  updated_at: string; // 最近修改时间（UTC ISO-8601）
}

/** 定价模式：固定价 / 百分比折扣 */
export type VipPriceRuleMode = 'fixed' | 'discount';

/** 写入入参：一份完整规则（新增用全量，修改用其子集） */
export interface VipPriceRuleInput {
  dimension: VipPriceDimension; // 命中维度
  dimension_value: string; // 维度取值（模块码 / 分类 slug / 资产类型）
  level_min: number; // 可享受该规则的最低 VIP 等级
  mode: VipPriceRuleMode; // 固定价 / 折扣
  price_cents: number | null; // fixed 模式固定价（分）
  discount_percent: number | null; // discount 模式折扣百分比（1–100）
  currency: string; // 币种标记
  enabled: boolean; // 是否生效
}

/** 修改入参：只带需要改的字段 */
export type VipPriceRulePatch = Partial<VipPriceRuleInput>;

/** 对外返回视图：enabled 统一收敛为布尔，避免前端再判断 0/1 */
export interface VipPriceRuleView extends Omit<VipPriceRuleRecord, 'enabled'> {
  enabled: boolean; // 是否生效
}

/** 显式列清单：避免 SELECT * 在后续加列时把内部字段泄露给接口 */
const RULE_COLUMNS = 'id, dimension, dimension_value, level_min, mode, price_cents, discount_percent, currency, enabled, created_at, updated_at';

/** 合法维度集合，用于运行时兜底校验（路由层已有 zod，这里防直接调用绕过） */
const DIMENSIONS: readonly VipPriceDimension[] = ['module', 'category', 'asset_kind'];

/** 合法模式集合 */
const MODES: readonly VipPriceRuleMode[] = ['fixed', 'discount'];

/** 维度取值最大长度：与路由层 zod 保持一致 */
const MAX_DIMENSION_VALUE = 120;

/** 固定价上限（分）：与路由层 zod 保持一致，防止误填超大金额 */
const MAX_PRICE_CENTS = 100_000_000;

/** 内部：把库行转成对外视图 */
export function vipPriceRuleView(record: VipPriceRuleRecord): VipPriceRuleView { // 视图映射出口
  return { ...record, enabled: record.enabled === 1 }; // 0/1 收敛成布尔，其余字段原样
}

/** 内部：读取单行，不存在返回 undefined */
function readRule(db: Db, id: string): VipPriceRuleRecord | undefined { // 单行读取
  return db.prepare(`SELECT ${RULE_COLUMNS} FROM vip_price_rules WHERE id = ?`).get(id) as VipPriceRuleRecord | undefined; // 主键精确查询
}

/** 内部：校验一份完整规则自洽，不合法抛 VALIDATION_FAILED */
function assertRuleConsistent(rule: VipPriceRuleInput): void { // 业务层兜底校验
  if (!DIMENSIONS.includes(rule.dimension)) throw new AppError('VALIDATION_FAILED', 'dimension must be module, category or asset_kind', { field: 'dimension' }); // 维度白名单
  const value = typeof rule.dimension_value === 'string' ? rule.dimension_value.trim() : ''; // 取值去空白
  if (!value) throw new AppError('VALIDATION_FAILED', 'dimension_value must not be empty', { field: 'dimension_value' }); // 取值非空
  if (value.length > MAX_DIMENSION_VALUE) throw new AppError('VALIDATION_FAILED', `dimension_value must be at most ${MAX_DIMENSION_VALUE} characters`, { field: 'dimension_value' }); // 取值限长
  if (!Number.isInteger(rule.level_min) || rule.level_min < 0 || rule.level_min > 99) throw new AppError('VALIDATION_FAILED', 'level_min must be an integer between 0 and 99', { field: 'level_min' }); // 等级门槛
  if (!MODES.includes(rule.mode)) throw new AppError('VALIDATION_FAILED', 'mode must be fixed or discount', { field: 'mode' }); // 模式白名单
  if (rule.mode === 'fixed') { // 固定价：必须有价格，且不能同时带折扣
    const price = rule.price_cents; // 固定价
    if (price === null || price === undefined || !Number.isInteger(price) || price < 0 || price > MAX_PRICE_CENTS) throw new AppError('VALIDATION_FAILED', 'fixed mode requires price_cents between 0 and 100000000', { field: 'price_cents' }); // 价格区间
    if (rule.discount_percent !== null && rule.discount_percent !== undefined) throw new AppError('VALIDATION_FAILED', 'fixed mode must not set discount_percent', { field: 'discount_percent' }); // 互斥字段
  } else { // 折扣：必须有百分比，且不能同时带固定价
    const percent = rule.discount_percent; // 折扣百分比
    if (percent === null || percent === undefined || !Number.isInteger(percent) || percent < 1 || percent > 100) throw new AppError('VALIDATION_FAILED', 'discount mode requires discount_percent between 1 and 100', { field: 'discount_percent' }); // 百分比区间
    if (rule.price_cents !== null && rule.price_cents !== undefined) throw new AppError('VALIDATION_FAILED', 'discount mode must not set price_cents', { field: 'price_cents' }); // 互斥字段
  } // 模式分支结束
  if (typeof rule.currency !== 'string' || rule.currency.trim().length === 0) throw new AppError('VALIDATION_FAILED', 'currency must not be empty', { field: 'currency' }); // 币种非空
} // assertRuleConsistent 结束

/** 内部：把入参归一为可落库形态（去空白、金额空值归一） */
function normalizeRule(rule: VipPriceRuleInput): VipPriceRuleInput { // 归一口径统一
  return {
    ...rule, // 其余字段原样
    dimension_value: rule.dimension_value.trim(), // 取值去空白
    price_cents: rule.price_cents ?? null, // 空值统一为 null，便于互斥判断
    discount_percent: rule.discount_percent ?? null, // 空值统一为 null
    currency: rule.currency.trim().toUpperCase(), // 币种统一大写
  }; // 归一结果
} // normalizeRule 结束

/**
 * 管理端全量列表：含停用行，按维度 + 取值 + 更新时间倒序，便于后台一眼看到同键历史。
 */
export function listVipPriceRulesAdmin(db: Db): VipPriceRuleRecord[] { // 列表入口
  return db
    .prepare(
      `SELECT ${RULE_COLUMNS} FROM vip_price_rules
       ORDER BY dimension, dimension_value, enabled DESC, updated_at DESC`,
    )
    .all() as VipPriceRuleRecord[]; // 同键内启用的排前面，再按最近修改
} // listVipPriceRulesAdmin 结束

/**
 * 新增规则：enabled=true 时自动停用同 (dimension, dimension_value) 的其它启用行。
 * 插入与停用放在同一事务，避免出现两条同时生效的中间态。
 */
export function createVipPriceRule(db: Db, input: VipPriceRuleInput, now: string): VipPriceRuleRecord { // 新增入口
  const next = normalizeRule(input); // 入参归一
  assertRuleConsistent(next); // 写库前兜底校验
  const id = uuidv7(); // 新规则主键
  const tx = db.transaction(() => { // 插入 + 停用同键旧行必须原子
    db.prepare(
      `INSERT INTO vip_price_rules
         (id, dimension, dimension_value, level_min, mode, price_cents, discount_percent, currency, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      next.dimension,
      next.dimension_value,
      next.level_min,
      next.mode,
      next.price_cents,
      next.discount_percent,
      next.currency,
      next.enabled ? 1 : 0,
      now,
      now,
    ); // 写入主体
    if (next.enabled) disableOtherEnabled(db, next.dimension, next.dimension_value, id, now); // 同键只留当前这条生效
  }); // 事务结束
  tx(); // 执行事务
  const created = readRule(db, id); // 回读落库结果
  if (!created) throw new AppError('INTERNAL_ERROR', 'vip price rule write failed', { rule_id: id }); // 理论上不会发生，兜底
  return created; // 返回完整行
} // createVipPriceRule 结束

/**
 * 修改规则：先按现有行 + patch 合成目标态再校验，避免局部更新拼出非法组合。
 * 目标态为启用时（包括从停用改为启用、或改了维度/取值），停用新键下的其它启用行。
 */
export function updateVipPriceRule(db: Db, id: string, patch: VipPriceRulePatch, now: string): VipPriceRuleRecord { // 修改入口
  const existing = readRule(db, id); // 取现有行
  if (!existing) throw new AppError('NOT_FOUND', 'vip price rule not found', { rule_id: id }); // 不存在直接 404
  const merged = normalizeRule({
    dimension: patch.dimension ?? existing.dimension,
    dimension_value: patch.dimension_value ?? existing.dimension_value,
    level_min: patch.level_min ?? existing.level_min,
    mode: patch.mode ?? existing.mode,
    price_cents: patch.price_cents !== undefined ? patch.price_cents : existing.price_cents,
    discount_percent: patch.discount_percent !== undefined ? patch.discount_percent : existing.discount_percent,
    currency: patch.currency ?? existing.currency,
    enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled === 1,
  }); // 合并成目标态
  assertRuleConsistent(merged); // 目标态校验
  const tx = db.transaction(() => { // 更新 + 停用同键旧行必须原子
    db.prepare(
      `UPDATE vip_price_rules
          SET dimension = ?, dimension_value = ?, level_min = ?, mode = ?,
              price_cents = ?, discount_percent = ?, currency = ?, enabled = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      merged.dimension,
      merged.dimension_value,
      merged.level_min,
      merged.mode,
      merged.price_cents,
      merged.discount_percent,
      merged.currency,
      merged.enabled ? 1 : 0,
      now,
      id,
    ); // 全量覆盖可改字段
    if (merged.enabled) disableOtherEnabled(db, merged.dimension, merged.dimension_value, id, now); // 同键只留当前这条生效
  }); // 事务结束
  tx(); // 执行事务
  const updated = readRule(db, id); // 回读落库结果
  if (!updated) throw new AppError('INTERNAL_ERROR', 'vip price rule write failed', { rule_id: id }); // 理论上不会发生，兜底
  return updated; // 返回完整行
} // updateVipPriceRule 结束

/** 删除规则：物理删除，返回是否命中，路由据此区分 200 / 404 */
export function deleteVipPriceRule(db: Db, id: string): boolean { // 删除入口
  const result = db.prepare('DELETE FROM vip_price_rules WHERE id = ?').run(id); // 主键删除
  return result.changes > 0; // 有变更即删除成功
} // deleteVipPriceRule 结束

/** 内部：停用同 (dimension, dimension_value) 下除当前行以外的启用行 */
function disableOtherEnabled(db: Db, dimension: VipPriceDimension, dimensionValue: string, keepId: string, now: string): void { // 同键收敛
  db.prepare(
    `UPDATE vip_price_rules SET enabled = 0, updated_at = ?
      WHERE dimension = ? AND dimension_value = ? AND enabled = 1 AND id <> ?`,
  ).run(now, dimension, dimensionValue, keepId); // 排除当前行，避免把刚写入的规则也停掉
} // disableOtherEnabled 结束
