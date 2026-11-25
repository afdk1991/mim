/**
 * VIP 定价规则查询与后台写入端点。
 *
 *   GET    /api/v1/vip/prices                 — 公开只读，返回启用中的定价规则（enabled=1）
 *   GET    /api/v1/admin/vip/price-rules      — 管理端全量列表（含停用），commerce:write
 *   POST   /api/v1/admin/vip/price-rules      — 新增规则，commerce:write
 *   PUT    /api/v1/admin/vip/price-rules/:id  — 修改规则，commerce:write
 *   DELETE /api/v1/admin/vip/price-rules/:id  — 删除规则，commerce:write
 *
 * 同一 (dimension, dimension_value) 只允许一条生效：新增 / 启用时由 commerce/vip-pricing-admin.ts
 * 在同一事务内停用同键其它启用行；不加唯一索引，避免存量重复行让迁移失败。
 * 审计：三条管理写接口（新增 / 改价 / 删除）统一走 audit.ts 的 audited() 包装，动作码
 * vip_price_rule.create / update / delete；公开读与管理端列表只读不审计。
 */

import { Router } from 'express'; // 路由容器
import { z } from 'zod'; // 声明式请求体校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { clockOf } from '../domain.js'; // 统一时钟：测试可注入固定时间
import { requirePermission } from '../middleware.js'; // 细粒度权限门禁
import { audited, auditActor } from '../audit.js'; // 统一审计留痕：操作人 / 动作 / 对象 / 结果
import { parse } from '../validate.js'; // zod 校验包装：失败抛 VALIDATION_FAILED
import { pathParam } from '../utils.js'; // 路径参数类型收敛
import { loadVipPriceRules, type VipPriceRuleRow } from '../commerce/vip-pricing.js'; // 规则加载（公开读）
import { REFUND_POLICY } from '../commerce/policy.js'; // 退款 / 服务费策略常量：公开定价页脚注同源复用
import {
  createVipPriceRule, // 新增规则
  deleteVipPriceRule, // 删除规则
  listVipPriceRulesAdmin, // 管理端全量列表
  updateVipPriceRule, // 修改规则
  vipPriceRuleView, // 库行 → 对外视图
  type VipPriceRuleInput, // 写入入参类型
  type VipPriceRulePatch, // 修改入参类型
} from '../commerce/vip-pricing-admin.js'; // 管理端写入模块
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 过滤参数到规则维度的映射 */
const FILTER_DIMENSION = { module: 'module', category: 'category', kind: 'asset_kind' } as const;

/** 维度枚举：与表 CHECK 约束保持一致 */
const dimensionSchema = z.enum(['module', 'category', 'asset_kind']); // 命中维度

/** 模式枚举：固定价 / 百分比折扣 */
const modeSchema = z.enum(['fixed', 'discount']); // 定价模式

/** 新增入参：必填维度 + 取值 + 模式，其余给默认值 */
const ruleCreateSchema = z.object({
  dimension: dimensionSchema, // 命中维度
  dimension_value: z.string().trim().min(1).max(120), // 维度取值（模块码 / 分类 slug / 资产类型）
  level_min: z.number().int().min(0).max(99).optional().default(1), // 最低 VIP 等级，默认 1
  mode: modeSchema, // 固定价 / 折扣
  price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(), // fixed 模式固定价（分）
  discount_percent: z.number().int().min(1).max(100).nullable().optional(), // discount 模式折扣百分比
  currency: z.string().trim().min(3).max(8).optional().default('CNY'), // 币种，默认 CNY
  enabled: z.boolean().optional().default(true), // 是否生效，默认启用
}); // ruleCreateSchema 结束

/** 修改入参：全部可选，但至少给一项 */
const ruleUpdateSchema = z.object({
  dimension: dimensionSchema.optional(), // 命中维度
  dimension_value: z.string().trim().min(1).max(120).optional(), // 维度取值
  level_min: z.number().int().min(0).max(99).optional(), // 最低 VIP 等级
  mode: modeSchema.optional(), // 定价模式
  price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(), // 固定价（分）
  discount_percent: z.number().int().min(1).max(100).nullable().optional(), // 折扣百分比
  currency: z.string().trim().min(3).max(8).optional(), // 币种
  enabled: z.boolean().optional(), // 是否生效
}).refine((value) => Object.keys(value).length > 0, { message: '至少填写一个字段' }); // 空 body 判 400

export function createVipPricingRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例
  const db = deps.db; // 同步 SQLite 连接
  const perm = requirePermission('commerce:write'); // 后台定价读写统一交易权限点（与 shop-admin 的 VIP 套餐一致）

  router.get('/vip/prices', (req, res) => { // 公开只读
    const rules = loadVipPriceRules(db); // 加载启用规则（enabled=1）
    const moduleValue = typeof req.query.module === 'string' ? req.query.module.trim() : ''; // 模块过滤
    const categoryValue = typeof req.query.category === 'string' ? req.query.category.trim() : ''; // 分类过滤
    const kindValue = typeof req.query.kind === 'string' ? req.query.kind.trim() : ''; // 资产类型过滤

    let filtered = rules; // 缺省全量
    const pairs: Array<[keyof typeof FILTER_DIMENSION, string]> = [
      ['module', moduleValue],
      ['category', categoryValue],
      ['kind', kindValue],
    ];
    for (const [param, value] of pairs) { // 每个非空过滤条件精确匹配维度取值
      if (!value) continue;
      filtered = filtered.filter((r: VipPriceRuleRow) => r.dimension === FILTER_DIMENSION[param] && r.dimension_value === value);
    }
    res.json({ rules: filtered }); // 回显规则列表（空数组即无命中规则，前端按原价展示）
  });

  router.get('/vip/pricing/public', (_req, res) => { // 公开只读：定价与权益页档位，匿名可达
    const rows = db // 保存 rows：承载本步骤的计算结果供后续使用
      .prepare('SELECT code, name, level, price_cents, duration_days, perks FROM vip_plans WHERE active = 1 ORDER BY sort_order, level, code') // 预编译 SQL：只取公开列，不取 id / sort_order / active 等内部字段
      .all() as Array<{ code: string; name: string; level: number; price_cents: number; duration_days: number; perks: string }>; // 查询多行：读取启用档位供批量整形
    const plans = rows.map((row) => { // 库行 → 公开视图：perks JSON 安全解析，脏数据回落空数组
      let perks: string[] = []; // 权益清单缺省为空
      try { // perks 列为 JSON 字符串，解析失败不阻断公开页
        const parsed: unknown = JSON.parse(row.perks); // 解析 JSON
        if (Array.isArray(parsed)) { // 仅数组形态采纳
          perks = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0); // 逐项过滤非字符串与空串
        } // 数组判断结束
      } catch { // JSON 损坏时回落空权益清单
        perks = []; // 兜底空数组
      } // 解析兜底结束
      return { // 公开视图只暴露定价页所需字段
        code: row.code, // 套餐编码
        name: row.name, // 档位名称
        level: row.level, // 等级
        price_cents: row.price_cents, // 价格（分）
        duration_days: row.duration_days, // 有效天数
        perks, // 权益清单
      }; // 公开视图组装结束
    }); // 档位整形结束
    res.json({ // 公开定价响应：档位 + 策略脚注 + 合规入口
      plans, // 启用档位列表（空数组即未配置，前端渲染空态）
      policy: { // 脚注口径与退款政策常量同源，避免两处各写一套
        platform_service_fee_cents: REFUND_POLICY.platform_service_fee_cents, // 平台服务费（分），固定 0
        effective_date: REFUND_POLICY.effective_date, // 政策生效日期
      }, // 策略脚注结束
      legal: { // 合规静态页站内路径，前端经路由前缀拼装
        refund_path: '/legal/refund', // 退款与售后说明
        help_path: '/legal/help', // 帮助中心
      }, // 合规入口结束
    }); // 响应组装结束
  }); // 公开定价路由结束

  router.get('/admin/vip/price-rules', perm, (_req, res) => { // 管理端全量列表
    const rules = listVipPriceRulesAdmin(db).map(vipPriceRuleView); // 库行统一转视图（enabled 转布尔）
    res.json({ rules }); // 含停用行，供后台看到同键历史
  });

  router.post('/admin/vip/price-rules', perm, (req, res) => { // 新增规则
    const body = parse(ruleCreateSchema, req.body); // 校验入参
    const input: VipPriceRuleInput = {
      dimension: body.dimension, // 命中维度
      dimension_value: body.dimension_value, // 维度取值
      level_min: body.level_min, // 最低等级
      mode: body.mode, // 定价模式
      price_cents: body.price_cents ?? null, // 固定价归 null
      discount_percent: body.discount_percent ?? null, // 折扣归 null
      currency: body.currency, // 币种
      enabled: body.enabled, // 是否生效
    }; // 组装写入入参
    const record = audited(db, auditActor(req), { // 新增规则与审计同属一次敏感操作
      action: 'vip_price_rule.create', // 动作码：新增定价规则
      targetType: 'vip_price_rule', // 对象类型
      targetId: `${input.dimension}:${input.dimension_value}`, // 对象主键：维度 + 取值
      detail: { ...input }, // 明细：写入入参（敏感键由 audit.ts 统一脱敏）
    }, () => createVipPriceRule(db, input, clockOf(deps))); // 写入并自动停用同键旧启用行
    res.status(201).json({ rule: vipPriceRuleView(record) }); // 回传创建视图
  });

  router.put('/admin/vip/price-rules/:id', perm, (req, res) => { // 修改规则
    const id = pathParam(req, 'id'); // 取路径参数
    const body = parse(ruleUpdateSchema, req.body); // 校验入参
    const patch: VipPriceRulePatch = {}; // 只收集显式传入的字段
    if (body.dimension !== undefined) patch.dimension = body.dimension; // 维度
    if (body.dimension_value !== undefined) patch.dimension_value = body.dimension_value; // 取值
    if (body.level_min !== undefined) patch.level_min = body.level_min; // 最低等级
    if (body.mode !== undefined) patch.mode = body.mode; // 模式
    if (body.price_cents !== undefined) patch.price_cents = body.price_cents; // 固定价（允许显式 null）
    if (body.discount_percent !== undefined) patch.discount_percent = body.discount_percent; // 折扣（允许显式 null）
    if (body.currency !== undefined) patch.currency = body.currency; // 币种
    if (body.enabled !== undefined) patch.enabled = body.enabled; // 启停
    const record = audited(db, auditActor(req), { // 改价规则与审计同属一次敏感操作
      action: 'vip_price_rule.update', // 动作码：修改定价规则
      targetType: 'vip_price_rule', // 对象类型
      targetId: id, // 对象主键：规则 ID
      detail: { ...patch }, // 明细：本次补丁字段
    }, () => updateVipPriceRule(db, id, patch, clockOf(deps))); // 合并成目标态校验后写库
    res.json({ rule: vipPriceRuleView(record) }); // 回传更新视图
  });

  router.delete('/admin/vip/price-rules/:id', perm, (req, res) => { // 删除规则
    const id = pathParam(req, 'id'); // 取路径参数
    const deleted = audited(db, auditActor(req), { // 删除规则与审计同属一次敏感操作
      action: 'vip_price_rule.delete', // 动作码：删除定价规则
      targetType: 'vip_price_rule', // 对象类型
      targetId: id, // 对象主键：规则 ID
    }, () => deleteVipPriceRule(db, id)); // 物理删除
    if (!deleted) throw new AppError('NOT_FOUND', '未找到 VIP 价格规则', { rule_id: id }); // 未命中判 404
    res.json({ id, deleted: true }); // 明确告知删除成功
  });

  return router; // 交出可挂载路由
}
