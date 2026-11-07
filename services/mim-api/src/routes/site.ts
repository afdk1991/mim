/**
 * 站点模块地图（site 域）公开路由
 *
 *   GET /site/overview                 全站概览：zone / 分类 / 模块数
 *   GET /site/modules?zone=&category=&q=  模块列表（可组合过滤，未知参数 400）
 *   GET /site/modules/:host            单模块详情（未知主机 404）
 *
 * 数据为静态常量（src/site.ts），不读写数据库、不要求鉴权。
 */

// Express 路由器：用于挂载 site 域的三条公开只读接口
import { Router } from 'express';
// zod：用于对 query 参数做严格校验（未知参数直接拒绝）
import { z } from 'zod';
// 统一错误类型：VALIDATION_FAILED / NOT_FOUND 由全局错误中间件转成 JSON
import { AppError } from '@mim/core-domain';
// 校验小工具：把 zod 解析失败统一包装为 AppError
import { parse } from '../validate.js';
// 路径参数读取小工具：兼容 Express 5 的 params 类型
import { pathParam } from '../utils.js';
// 站点静态数据：分类、模块、zone 以及两个类型守卫
import {
  SITE_CATEGORIES,
  SITE_MODULES,
  SITE_ZONES,
  isSiteCategory,
  isSiteZone,
} from '../site.js';
// 仅类型导入：编译后会被擦除，不产生运行时代码
import type { SiteCategoryId, SiteModule, SiteZoneId } from '../site.js';

// query 参数 schema：strictObject 表示出现未声明的参数（如 foo=bar）会直接校验失败
const querySchema = z.strictObject({
  // zone：最多 32 字符，可选；合法值在下方用 isSiteZone 二次校验
  zone: z.string().max(32).optional(),
  // category：最多 32 字符，可选；合法值在下方用 isSiteCategory 二次校验
  category: z.string().max(32).optional(),
  // q：关键词搜索，最多 64 字符，可选
  q: z.string().max(64).optional(),
});

// 按分类 id 取双语名称；分类由 SiteCategoryId 联合类型约束，必能命中
const categoryName = (id: SiteCategoryId) => SITE_CATEGORIES.find((c) => c.id === id)!.name;

// 把内部 SiteModule 转成接口响应体；zone 传入时只保留该 zone 的记录
function present(module: SiteModule, zone?: SiteZoneId) {
  // 有 zone 过滤则筛记录，否则保留全部记录
  const records = zone ? module.records.filter((r) => r.zone === zone) : module.records;
  // 返回对外字段：urls 由过滤后的记录重新推导，避免暴露多余 zone 的入口
  return {
    // 主机名（不含 zone），根域名为 '@'
    host: module.host,
    // 分类 id，供前端做分组与筛选
    category: module.category,
    // 分类双语名称，前端按 locale 取值展示
    category_name: categoryName(module.category),
    // 备注第一段：模块定位
    label: module.label,
    // 备注第二段：站点说明
    description: module.description,
    // https 入口地址，与 records 一一对应
    urls: records.map((r) => `https://${r.fqdn}`),
    // 该模块在当前 zone 下的解析记录明细
    records,
  };
}

// 关键词匹配：host / 备注 / 入口地址 / record 级备注全部纳入检索范围
function matches(module: SiteModule, q: string): boolean {
  // 统一小写并去空格，实现大小写不敏感的关键词匹配
  const needle = q.trim().toLowerCase();
  // 空关键词视为不过滤，直接返回 true
  if (!needle) return true;
  // 把模块所有可检索字段拼成一个字符串（空格分隔）做 includes 匹配
  const haystack = [
    // 主机名，例如 gy / api / @
    module.host,
    // 模块级备注第一段
    module.label,
    // 模块级备注第二段
    module.description,
    // 模块的 https 入口地址
    ...module.urls,
    // 每条记录的 fqdn、record 级备注（覆盖项）也参与检索
    ...module.records.flatMap((r) => [r.fqdn, r.label ?? '', r.description ?? '']),
  ]
    // 用空格拼接，避免跨字段误匹配
    .join(' ')
    // 转小写，保证大小写不敏感
    .toLowerCase();
  // 包含关键词即命中
  return haystack.includes(needle);
}

// 工厂函数：创建 site 域路由，供 app.ts 以 app.use('/api/v1', createSiteRouter()) 挂载
export function createSiteRouter(): Router {
  // 新建路由器实例
  const router = Router();

  /** GET /site/overview — 分类与 zone 维度计数 */
  router.get('/site/overview', (_req, res) => {
    // 直接返回静态聚合结果：总数 + 每 zone 计数 + 每分类计数
    res.json({
      // 模块总数（45 条主机记录）
      total: SITE_MODULES.length,
      // zone 概览：id / apex / 覆盖模块数（不暴露解析目标）
      zones: SITE_ZONES.map((zone) => ({
        // zone 标识（当前仅 mixm.top）
        id: zone.id,
        // zone 的根域名（与 id 同值）
        apex: zone.apex,
        // 该 zone 下存在解析记录的模块数量（本数据集为 45）
        count: SITE_MODULES.filter((m) => m.records.some((r) => r.zone === zone.id)).length,
      })),
      // 8 个分类的概览：id / 双语名 / 该分类模块数（合计 45）
      categories: SITE_CATEGORIES.map((category) => ({
        // 分类标识
        id: category.id,
        // 分类双语名称
        name: category.name,
        // 该分类下的模块数量
        count: SITE_MODULES.filter((m) => m.category === category.id).length,
      })),
    });
  });

  /** GET /site/modules — 组合过滤：zone / category / q */
  router.get('/site/modules', (req, res) => {
    // 用 zod 严格校验 query：未知参数会抛 VALIDATION_FAILED（400）
    const query = parse(querySchema, req.query);

    // zone 存在但不是合法 zone 时，返回 400 并附允许值清单
    if (query.zone !== undefined && !isSiteZone(query.zone)) {
      throw new AppError('VALIDATION_FAILED', 'unknown zone', {
        // 回显非法入参，便于前端提示
        zone: query.zone,
        // 回显允许的 zone 列表
        allowed: SITE_ZONES.map((z) => z.id),
      });
    }
    // category 存在但不是合法分类时，返回 400 并附允许值清单
    if (query.category !== undefined && !isSiteCategory(query.category)) {
      throw new AppError('VALIDATION_FAILED', 'unknown category', {
        // 回显非法入参
        category: query.category,
        // 回显允许的分类列表
        allowed: SITE_CATEGORIES.map((c) => c.id),
      });
    }

    // 校验通过后收窄类型，后续过滤逻辑可安全使用字面量联合类型
    const zone = query.zone as SiteZoneId | undefined;
    // 依次执行 zone 过滤 → category 过滤 → 关键词过滤，最后映射成响应结构
    const items = SITE_MODULES.filter((m) => !zone || m.records.some((r) => r.zone === zone))
      // category 过滤：未指定则全部保留
      .filter((m) => !query.category || m.category === query.category)
      // 关键词过滤：q 缺省时 matches 恒为 true
      .filter((m) => matches(m, query.q ?? ''))
      // 映射为对外响应体；传入 zone 时只会保留该 zone 的记录
      .map((m) => present(m, zone));

    // 返回过滤结果：total 为命中数，module_total 为全量数，filters 回显实际生效条件
    res.json({
      // 当前过滤条件下的命中数量
      total: items.length,
      // 全量模块数量（45），便于前端展示「命中 / 总数」
      module_total: SITE_MODULES.length,
      // 回显生效的过滤条件，未指定时为 null
      filters: {
        // 生效的 zone，未指定为 null
        zone: zone ?? null,
        // 生效的分类，未指定为 null
        category: query.category ?? null,
        // 生效的关键词（trim 后），空串视为 null
        q: query.q?.trim() || null,
      },
      // 模块列表本体
      items,
    });
  });

  /** GET /site/modules/:host — 单模块（host 为主机记录，如 gy / api / @） */
  router.get('/site/modules/:host', (req, res) => {
    // 读取路径参数并统一转小写，保证大小写不敏感
    const host = pathParam(req, 'host').toLowerCase();
    // 在静态模块表中查找同名 host
    const module = SITE_MODULES.find((m) => m.host.toLowerCase() === host);
    // 未找到则返回 404，并回显查询的 host
    if (!module) {
      throw new AppError('NOT_FOUND', 'site module not found', { host });
    }
    // 命中则返回单模块完整详情
    res.json({ module: present(module) });
  });

  // 返回路由器，由 app.ts 统一挂载到 /api/v1
  return router;
}
