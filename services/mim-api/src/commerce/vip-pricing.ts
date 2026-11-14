/**
 * VIP 按模块 / 分类 / 资产类型单独定价。
 *
 * 规则表 vip_price_rules 一行即一条可命中的定价策略：
 *   - dimension=module：按模块编码命中；category：按分类 slug；asset_kind：按资产类型；
 *   - level_min：可享受该规则的最低 VIP 等级，等级不足回落原价（reason=level_insufficient）；
 *   - mode=fixed：固定价（分）；mode=discount：按百分比折扣（1–100）。
 *
 * 优先级固定为：module > category > asset_kind > 原价；命中第一条可用规则即返回，
 * 不再向下回退。纯函数不碰数据库，便于单测穷举优先级与等级门槛；DB 加载见 loadVipPriceRules。
 */

import type { Db } from '../types.js'; // 数据库句柄类型，编译期擦除

/** 规则可命中的三个维度 */
export type VipPriceDimension = 'module' | 'category' | 'asset_kind';

/** vip_price_rules 行的最小视图（只取定价计算需要的列） */
export interface VipPriceRuleRow {
  id: string; // 规则主键，回传给调用方便于对账
  dimension: VipPriceDimension; // 命中维度
  dimension_value: string; // 维度取值（模块码 / 分类 slug / 资产类型）
  level_min: number; // 最低 VIP 等级
  mode: 'fixed' | 'discount'; // 固定价 / 百分比折扣
  price_cents: number | null; // fixed 模式固定价（分）
  discount_percent: number | null; // discount 模式折扣百分比（1–100）
  currency: string; // 币种标记，定价计算不换算，仅随结果回显
  enabled: number; // 启用位：0 视为不存在
}

/** resolveVipPrice 入参 */
export interface VipPriceInput {
  module?: string | null; // 模块编码（模块商品路径传入）
  category?: string | null; // 分类 slug（分类路径传入）
  kind?: string | null; // 资产类型：article / download / gallery / video
  userVipLevel: number; // 当前用户 VIP 等级；0 表示非会员
  basePriceCents: number; // 商品原价（分）
}

/** resolveVipPrice 出参 */
export interface ResolvedVipPrice {
  priceCents: number; // 最终应付（分），非负整数
  ruleId: string | null; // 命中的规则主键；原价回落时为 null
  reason: // 命中路径 / 回落原因，便于前端与日志区分
  | 'original' // 无规则命中或非 VIP，按原价
    | 'module' // 模块规则命中
    | 'category' // 分类规则命中
    | 'asset_kind' // 资产类型规则命中
    | 'level_insufficient'; // 命中规则但 VIP 等级不足，回落原价
  currency: string; // 命中规则的币种；原价回落沿用调用方原价币种约定（CNY）
}

/** 维度优先级：模块最具体，其次分类，再次资产类型 */
const PRIORITY: readonly VipPriceDimension[] = ['module', 'category', 'asset_kind'];

/** 维度取值映射：入参字段与规则维度一一对应 */
function dimensionValue(input: VipPriceInput, dim: VipPriceDimension): string | null {
  if (dim === 'module') return input.module ?? null; // 模块编码
  if (dim === 'category') return input.category ?? null; // 分类 slug
  return input.kind ?? null; // 资产类型
}

/**
 * 纯函数：按规则集解析最终 VIP 定价。
 *  - 非会员（level<=0）或原价为 0：直接回落原价，不查规则；
 *  - 规则等级门槛不足：返回原价并标注 level_insufficient；
 *  - fixed 价格为 null / discount 百分比越界：该规则不可用，继续向下一维度查找。
 */
export function resolveVipPrice(rules: VipPriceRuleRow[], input: VipPriceInput): ResolvedVipPrice {
  const base = Math.max(0, Math.round(input.basePriceCents)); // 原价归一为非负整数分
  const fallback: ResolvedVipPrice = { priceCents: base, ruleId: null, reason: 'original', currency: 'CNY' }; // 原价回落形状
  if (input.userVipLevel <= 0 || base <= 0) return fallback; // 非会员 / 免费商品不参与 VIP 定价

  for (const dim of PRIORITY) { // 按固定优先级逐维度查找
    const value = dimensionValue(input, dim); // 本维度取值
    if (!value) continue; // 入参未提供该维度则跳过
    const rule = rules.find( // 精确匹配维度 + 取值 + 启用位
      (r) => r.enabled === 1 && r.dimension === dim && r.dimension_value === value,
    );
    if (!rule) continue; // 该维度无规则，继续下一级
    if (input.userVipLevel < rule.level_min) { // 等级门槛不足：回落原价但留痕规则 ID
      return { priceCents: base, ruleId: rule.id, reason: 'level_insufficient', currency: rule.currency };
    }
    if (rule.mode === 'fixed') { // 固定价模式
      if (rule.price_cents == null) continue; // 脏规则：缺固定价，不命中
      const fixed = Math.max(0, Math.round(rule.price_cents)); // 归一非负
      return { priceCents: fixed, ruleId: rule.id, reason: dim, currency: rule.currency };
    }
    const percent = Number(rule.discount_percent); // 折扣百分比
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue; // 越界折扣不命中
    const discounted = Math.max(0, Math.round((base * (100 - percent)) / 100)); // 整数分四舍五入
    return { priceCents: discounted, ruleId: rule.id, reason: dim, currency: rule.currency };
  }
  return fallback; // 三个维度均未命中
}

/** 从库中加载全部启用中的定价规则；空库返回空数组，纯函数按原价处理 */
export function loadVipPriceRules(db: Db): VipPriceRuleRow[] {
  return db
    .prepare(
      `SELECT id, dimension, dimension_value, level_min, mode, price_cents, discount_percent, currency, enabled
       FROM vip_price_rules WHERE enabled = 1`,
    )
    .all() as VipPriceRuleRow[];
}
