/**
 * 统一入口配置清单路由（2026-11-09）：把「主机记录 + 备注」去重整理后的 45 个入口
 * 与 19 个业务域对外暴露，并给出每个入口的核心功能、职责边界、后台/接口职责、
 * 相似模块关联与区分、以及可配置占位标识的配置状态。
 *
 * 设计边界：
 *   - 清单本体是静态契约（packages/core-domain/src/siteModules.json），不在库里复制；
 *   - 用户未提供任何具体主机记录值，故入口只用可配置占位标识，代码不推导、不补写真实域名；
 *   - 运行期实际主机值由外部配置注入，本路由只回显「是否已配置」，不回传具体值；
 *   - 全部端点只读公开，与商城 / 站点矩阵一致，写操作由 sites 路由按登录 + 幂等处理。
 *
 * 路由一览（/api/v1 前缀由 app.ts 统一挂载）：
 *   GET /entries/overview        公开 — 清单规模、去重整理、占位配置统计
 *   GET /entries                 公开 — 44 入口清单，支持 q / domain 过滤
 *   GET /entries/domains         公开 — 19 个业务域
 *   GET /entries/placeholders    公开 — 46 个占位标识（44 入口 + @ 根域名 + 空白占位）
 *   GET /entries/config          公开 — 可配置占位标识模板与注入说明（值恒为空）
 *   GET /entries/:entryKey       公开 — 单入口详情，含关联入口的解析结果
 *
 * 注意：静态路径（overview / domains / placeholders / config）必须先于 /:entryKey 注册。
 */

import { Router } from 'express'; // Express 路由容器，按 /api/v1 前缀挂载
import { AppError } from '@mim/core-domain'; // 统一业务异常，未登记入口回 404
import { // 引入依赖、类型或本地模块绑定
  SITE_DOMAINS, // 19 个业务域，供筛选与汇总
  SITE_MODULES, // 44 个去重入口静态契约
  entryHostTemplate, // 配置模板：44 个环境变量键，值全为空
  findSiteModule, // 按占位键定位入口
  implementationSummary, // 落地状态四态计数
  resolveEntryHost, // 解析占位标识的配置状态（不回显具体值）
  siteModulesRegistry, // 顶层元信息：去重口径 / @ 记录 / 空白字段 / 主机配置策略
  siteModulesSummary, // 规模汇总
} from '@mim/core-domain'; // 共享包单一数据源，前后端共用同一份清单
import { pathParam } from '../utils.js'; // 严格路径参数提取，非字符串一律 400
import type { ApiDeps } from '../types.js'; // 依赖容器类型，保持与其它路由工厂签名一致

// 入口清单视图：只输出模块划分与职责相关字段，不携带运行时演示数据。
function entryView(m: (typeof SITE_MODULES)[number]) {
  // 逐字段显式列出，避免把 capabilities / seed 等运行时数据混进清单。
  return {
    // 两位序号。
    id: m.id,
    // 稳定入口标识（占位键），不是具体主机值。
    entryKey: m.entryKey,
    // 可配置占位标识，形如 {{HOST:PORTAL_ROOT}}。
    placeholder: m.placeholder,
    // 运行期配置注入键。
    envKey: m.envKey,
    // 是否已由外部配置注入实际主机值。
    configured: resolveEntryHost(m.entryKey).configured,
    // 备注原文，作为唯一比对基准。
    note: m.note,
    // 备注前半段：入口描述。
    entry: m.entry,
    // 备注后半段：业务系统/模块说明，模块划分依据。
    system: m.system,
    // 业务域编码。
    domain: m.domain,
    // 业务域中文名。
    domainName: m.domainName,
    // 核心功能清单。
    coreFunctions: m.coreFunctions,
    // 职责边界：负责 / 不负责。
    responsibility: m.responsibility,
    // 后台管理职责。
    adminRole: m.adminRole,
    // 接口职责。
    apiRole: m.apiRole,
    // 相似模块关联与区分。
    related: m.related,
    // 落地状态映射：现有真实模块、可直达视图 / 外链与边界说明。
    implementation: m.implementation,
    // 台账溯源行号（两行重复备注合并为一项后的位置）。
    rows: m.rows,
    // 来源工作表，仅作溯源。
    sheet: m.sheet,
  }; // 代码块结束
} // entryView 结束

// 路由工厂：与其余域一致，由 createApp 注入 deps 后统一挂载。
export function createEntriesRouter(_deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例
  const reg = siteModulesRegistry; // 缓存顶层元信息，避免每次请求重复解构

  // ---------- 公开：清单总览 ----------

  /** GET /entries/overview — 规模、去重整理口径与占位配置统计 */
  router.get('/entries/overview', (_req, res) => { // 公开只读
    const summary = siteModulesSummary(); // 模块 / 能力 / 业务域 / 空备注行统计
    const entries = SITE_MODULES.map((m) => resolveEntryHost(m.entryKey)); // 逐入口判定配置状态
    const configured = entries.filter((e) => e.configured).length; // 已注入实际值的入口数
    res.json({ // 统一响应体
      schema: reg.schema, // 契约版本 v2
      title: reg.title, // 清单标题
      source: reg.source, // 依据说明
      scope: reg.scope, // 取证范围
      moduleBasis: reg.moduleBasis, // 模块划分依据
      noteFormat: reg.noteFormat, // 备注格式说明
      derivation: reg.derivation, // 实现推导声明
      entries: summary.modules, // 去重后业务入口数（44）
      domains: summary.domains, // 业务域数（19）
      capabilities: summary.capabilities, // 运行时功能点数（132）
      relations: SITE_MODULES.reduce((n, m) => n + m.related.length, 0), // 相似模块关联条数
      placeholders: entries.length + 2, // 44 入口 + @ 根域名占位 + 空白占位
      configured, // 已配置入口数，默认 0
      unconfigured: entries.length - configured, // 未配置入口数
      implementation: implementationSummary(SITE_MODULES), // 落地状态四态计数
      dedupe: reg.dedupe, // @ / 空白 / 重复备注的整理结果
      atRecord: reg.atRecord, // @ 合并后的占位项
      blankRecord: reg.blankRecord, // 空白字段合并后的占位项
      hostConfig: reg.hostConfig, // 不补写具体主机值的策略
      blankRows: reg.blankRows.length, // 台账空备注原始行数（13）
    }); // 响应结束
  }); // GET /entries/overview 结束

  // ---------- 公开：业务域清单 ----------

  /** GET /entries/domains — 19 个业务域及其入口数 */
  router.get('/entries/domains', (_req, res) => { // 公开只读
    res.json({ // 统一响应体
      total: SITE_DOMAINS.length, // 业务域总数
      domains: SITE_DOMAINS, // 业务域数组，每项含 code / name / description / count / entryKeys
    }); // 响应结束
  }); // GET /entries/domains 结束

  // ---------- 公开：占位标识清单 ----------

  /** GET /entries/placeholders — 全部可配置占位标识及配置状态 */
  router.get('/entries/placeholders', (_req, res) => { // 公开只读
    const items = SITE_MODULES.map((m) => ({ // 45 个业务入口占位
      entryKey: m.entryKey, // 占位键
      placeholder: m.placeholder, // 占位标识
      envKey: m.envKey, // 注入键
      configured: resolveEntryHost(m.entryKey).configured, // 是否已配置
      kind: 'entry', // 类型：业务入口
      system: m.system, // 业务系统说明
    })); // 业务入口映射结束
    for (const extra of [reg.atRecord, reg.blankRecord]) { // @ 根域名与空白字段两个非模块占位
      const resolution = resolveEntryHost(extra.entryKey); // 复用同一解析规则
      items.push({ // 追加非模块占位
        entryKey: extra.entryKey, // 占位键
        placeholder: extra.placeholder, // 占位标识
        envKey: `MIM_HOST_${extra.entryKey}`, // 注入键，与业务入口同规则
        configured: resolution.configured, // 是否已配置
        kind: 'placeholder', // 类型：未建模块的占位记录
        system: extra.resolution, // 整理结论作为说明
      }); // 追加结束
    } // 非模块占位循环结束
    res.json({ // 统一响应体
      total: items.length, // 占位标识总数（47）
      configured: items.filter((i) => i.configured).length, // 已配置数
      items, // 占位标识数组
    }); // 响应结束
  }); // GET /entries/placeholders 结束

  // ---------- 公开：配置模板 ----------

  /** GET /entries/config — 可配置占位标识模板，值恒为空，不回传具体主机值 */
  router.get('/entries/config', (_req, res) => { // 公开只读
    res.json({ // 统一响应体
      schema: 'mim.entry-hosts.v1', // 配置模板版本
      template: reg.hostConfig.template, // 模板文件路径
      format: reg.hostConfig.format, // 占位标识格式
      envPrefix: reg.hostConfig.envPrefix, // 环境变量前缀
      rule: reg.hostConfig.rule, // 不补写规则
      resolutionOfMissing: reg.hostConfig.resolutionOfMissing, // 未配置时的降级口径
      hosts: entryHostTemplate(), // 45 个键，值全部为空串
    }); // 响应结束
  }); // GET /entries/config 结束

  // ---------- 公开：入口清单与检索 ----------

  /** GET /entries — 44 入口清单，支持 q（备注/系统名/占位键/业务域）与 domain 过滤 */
  router.get('/entries', (req, res) => { // 公开只读，与商城目录同一访问模型
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''; // 搜索词小写化
    const domain = typeof req.query.domain === 'string' ? req.query.domain.trim() : ''; // 业务域编码
    const entries = SITE_MODULES // 从静态契约出发，不查库
      .filter((m) => !domain || m.domain === domain) // 业务域过滤，空串表示不过滤
      .filter((m) => !q || [ // 多字段包含匹配，覆盖清单所有可读字段
        m.entryKey, m.placeholder, m.system, m.entry, m.note, m.domain, m.domainName, // 执行当前业务步骤
        ...m.coreFunctions, ...m.responsibility.inScope, ...m.responsibility.outOfScope, // 执行当前业务步骤
      ].some((v) => String(v).toLowerCase().includes(q))) // 任一字段命中即保留
      .map(entryView); // 转为清单视图
    res.json({ // 统一响应体
      schema: reg.schema, // 契约版本
      domains: SITE_DOMAINS, // 业务域清单，供前端渲染筛选控件
      total: entries.length, // 过滤后命中数
      entries, // 入口数组
    }); // 响应结束
  }); // GET /entries 结束

  // ---------- 公开：单入口详情 ----------

  /** GET /entries/:entryKey — 单入口详情，含关联入口解析结果与运行时能力点 */
  router.get('/entries/:entryKey', (req, res) => { // 公开只读
    const key = pathParam(req, 'entryKey'); // 严格取路径参数
    const module = findSiteModule(key); // 按占位键定位
    if (!module) { // 未登记入口统一 404，不猜测具体主机值
      throw new AppError('NOT_FOUND', `entry not found: ${key}`, { entryKey: key }); // 404 并回显占位键
    } // 未登记分支结束
    const related = module.related.map((r) => { // 把关联占位键解析成可读摘要
      const target = findSiteModule(r.entryKey); // 定位关联入口
      return { // 返回关联详情
        ...r, // 原有 relation / distinction
        system: target?.system ?? null, // 关联入口的业务系统说明
        domainName: target?.domainName ?? null, // 关联入口的业务域
      }; // 关联详情结束
    }); // 关联映射结束
    res.json({ // 统一响应体
      entry: { ...entryView(module), related }, // 清单视图 + 关联解析
      hostConfig: reg.hostConfig, // 占位配置策略
      capabilities: module.capabilities, // 运行时能力点（供 sites 视图跳转使用）
    }); // 响应结束
  }); // GET /entries/:entryKey 结束

  return router; // 返回装配完成的路由
} // createEntriesRouter 结束
