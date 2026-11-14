/**
 * VIP 定价规则查询端点。
 *
 *   GET /api/v1/vip/prices?module=&category=&kind=  — 公开只读，返回启用中的定价规则；
 *   不传过滤参数时列出全部规则（运营后台展示用）。
 *
 * 规则写入走管理端既有 RBAC 流程（admin.ts 由并行 agent 占用，本文件不承担写接口）。
 */

import { Router } from 'express'; // 路由容器
import { loadVipPriceRules, type VipPriceRuleRow } from '../commerce/vip-pricing.js'; // 规则加载
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 过滤参数到规则维度的映射 */
const FILTER_DIMENSION = { module: 'module', category: 'category', kind: 'asset_kind' } as const;

export function createVipPricingRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  router.get('/vip/prices', (req, res) => { // 公开只读
    const rules = loadVipPriceRules(deps.db); // 加载启用规则
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

  return router; // 交出可挂载路由
}
