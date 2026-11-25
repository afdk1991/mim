/**
 * 13 业务领域平台路由（2026-11-25）：把静态领域目录以公开只读的方式提供给前端渲染。
 *
 * 设计边界：
 *   - 领域清单为静态契约（src/domains/catalog.ts），本路由只读取，不查业务表、不提供写操作；
 *   - 四个端点全部公开只读，与站点选项 / VIP 定价同一「浏览公开」访问模型，匿名即可访问；
 *   - 统一字段一律 snake_case；未知 slug 用 AppError 回统一 404 错误信封；
 *   - /domains/overview 必须注册在 /domains/:slug 之前，否则会被详情路由当作 slug 吞掉。
 *
 * 路由一览（/api/v1 前缀由 app.ts 统一挂载）：
 *   GET /domains/overview      公开 — 汇总 + 字典 + 13 领域精简信息
 *   GET /domains               公开 — 领域清单，支持 q / category / status 过滤
 *   GET /domains/:slug/features 公开 — 单个领域的功能点清单
 *   GET /domains/:slug         公开 — 单个领域完整详情
 */

import { Router } from 'express'; // Express 路由容器，按 /api/v1 前缀挂载
import { AppError } from '@mim/core-domain'; // 统一业务异常，未知 slug 回 404 信封
import { // 引入静态领域目录的常量与查询函数
  DOMAIN_CATEGORIES, // 分组字典，供前端生成筛选器与徽标文案
  DOMAIN_SCHEMA, // 契约版本，供清单 / 详情 / 功能点响应统一回显
  DOMAIN_STATUSES, // 状态字典，供前端区分已上线与规划中
  DOMAINS, // 13 个领域单一事实源，仅用于 overview 精简信息
  domainSummary, // 汇总函数，数字由静态数据推导而非硬编码
  findDomain, // 按 slug 查询单个领域，未命中返回 null
  listDomains, // 按 q / category / status 过滤领域清单
} from '../domains/catalog.js'; // 静态目录模块，NodeNext 下 ESM import 必须带 .js 后缀
import { pathParam } from '../utils.js'; // 严格路径参数提取，非字符串一律 400
import type { ApiDeps } from '../types.js'; // 依赖容器类型，与其它路由工厂签名保持一致

// 从查询串取字符串参数：非字符串一律回落空串，避免数组型参数污染过滤条件。
function queryString(req: { query: Record<string, unknown> }, key: string): string {
  const value = req.query[key]; // 直接从 Express 查询对象取值
  return typeof value === 'string' ? value.trim() : ''; // 只接受 string，去空白后返回
} // queryString 结束

// 路由工厂：与其余域一致，由 createApp 注入 deps 后统一挂载。
export function createDomainsRouter(_deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例，不共享其它域的中间件

  // ---------- 公开：全量汇总（匿名可读） ----------

  /** GET /domains/overview — 汇总 + 字典 + 13 领域精简信息（须先于 /domains/:slug 注册） */
  router.get('/domains/overview', (_req, res) => { // 匿名可读，无权限门禁
    const summary = domainSummary(); // 先取汇总，供顶层字段与前端计数别名共用
    res.json({ // 统一响应体：汇总 + 前端计数别名 + 两组字典 + 精简清单
      ...summary, // schema / total / by_category / by_status / active_count / planned_count
      active: summary.active_count, // 前端计数别名：已上线数量，避免前端重复计算
      categories: Object.keys(DOMAIN_CATEGORIES).length, // 前端计数别名：分组数量（5），与前端总览口径一致
      category_codes: DOMAIN_CATEGORIES, // 分组字典：production / business / knowledge / lifestyle / support
      statuses: DOMAIN_STATUSES, // 状态字典：active / planned
      items: DOMAINS.map((domain) => ({ // 精简信息：卡片渲染只需这几个字段
        slug: domain.slug, // 领域唯一标识，用于跳转详情
        name_zh: domain.name_zh, // 中文名，卡片主标题
        name_en: domain.name_en, // 英文名，双语标题
        icon: domain.icon, // emoji 图标，卡片视觉标识
        category: domain.category, // 分组编码，用于卡片分组
        status: domain.status, // 上线状态，用于可用/敬请期待徽标
      })), // 精简清单结束，避免 overview 响应体携带长文本
    }); // 响应结束
  }); // GET /domains/overview 结束

  // ---------- 公开：领域清单（匿名可读） ----------

  /** GET /domains — 全量领域清单，支持 q / category / status 过滤 */
  router.get('/domains', (req, res) => { // 匿名可读，无权限门禁
    const filter = { // 逐项读取查询参数，空串等价于不过滤
      q: queryString(req, 'q'), // 关键词：匹配 slug / 中英文名 / 简述 / 复用说明 / 功能点
      category: queryString(req, 'category'), // 分组编码，例如 production
      status: queryString(req, 'status'), // 状态编码，例如 active
    }; // 过滤条件结束
    const rows = listDomains(filter); // 复用静态目录过滤函数，保证前后端口径一致
    res.json({ // 统一响应体：契约版本 + 过滤条件回显 + 总数 + 清单 + 字典
      schema: DOMAIN_SCHEMA, // 契约版本
      filters: filter, // 回显本次生效的过滤条件，便于核对
      total: rows.length, // 过滤后条数，无命中为 0
      items: rows, // 领域数组，字段完整（含 reuse 与 features）
      categories: DOMAIN_CATEGORIES, // 分组字典，供筛选器渲染
      statuses: DOMAIN_STATUSES, // 状态字典，供筛选器渲染
    }); // 响应结束
  }); // GET /domains 结束

  // ---------- 公开：功能点清单（匿名可读） ----------

  /** GET /domains/:slug/features — 单个领域的功能点清单（先于详情注册，语义更具体） */
  router.get('/domains/:slug/features', (req, res) => { // 匿名可读，无权限门禁
    const slug = pathParam(req, 'slug'); // 严格取路径参数，非字符串一律 400
    const domain = findDomain(slug); // 按 slug 查询静态目录
    if (!domain) throw new AppError('NOT_FOUND', `未找到业务领域：${slug}`, { slug }); // 未登记 slug 回 404 并回显
    res.json({ // 统一响应体：契约版本 + 领域标识 + 功能点数组 + 前端对象化清单
      schema: DOMAIN_SCHEMA, // 契约版本
      slug: domain.slug, // 领域唯一标识
      name_zh: domain.name_zh, // 中文名，供页面标题展示
      total: domain.features.length, // 功能点数量，由数组长度推导
      features: domain.features, // 功能点字符串数组（静态契约原样）
      // 对象化清单的 slug / name_zh / name_en 均为「所属领域」标识，功能点文本只在 description；展示功能点请读上面的 features 字符串数组。
      items: domain.features.map((feature) => ({ // 前端对象化清单：与前端 DomainFeature 形状一致
        slug: domain.slug, // 对象所属领域标识（非功能点标识）
        name_zh: domain.name_zh, // 对象所属领域中文名（非功能点名）
        name_en: domain.name_en, // 对象所属领域英文名（非功能点名）
        description: feature, // 单个功能点文本作为描述
      })), // 对象化清单结束
    }); // 响应结束
  }); // GET /domains/:slug/features 结束

  // ---------- 公开：单项详情（匿名可读） ----------

  /** GET /domains/:slug — 单个领域完整详情（9 个 snake_case 字段） */
  router.get('/domains/:slug', (req, res) => { // 匿名可读，无权限门禁
    const slug = pathParam(req, 'slug'); // 严格取路径参数，非字符串一律 400
    const domain = findDomain(slug); // 按 slug 查询静态目录
    if (!domain) throw new AppError('NOT_FOUND', `未找到业务领域：${slug}`, { slug }); // 未登记 slug 回 404 并回显
    res.json({ // 统一响应体：契约版本 + 完整领域对象（双键兼容）+ 所属分组/状态文案
      schema: DOMAIN_SCHEMA, // 契约版本
      item: domain, // 完整领域对象，字段全部 snake_case
      domain, // 前端期望的别名键，与 item 指向同一对象，避免前端再做归一化
      category_label: DOMAIN_CATEGORIES[domain.category], // 分组中文名，避免前端重复维护字典
      status_label: DOMAIN_STATUSES[domain.status], // 状态中文名，避免前端重复维护字典
    }); // 响应结束
  }); // GET /domains/:slug 结束

  return router; // 返回装配完成的路由
} // createDomainsRouter 结束
