/**
 * 部署汇总路由（2026-11-09）：把散落在 AGENTS.md / README / CI / git 远端的部署项收口为一份可核对清单。
 *
 * 设计边界：
 *   - 部署项为静态契约（packages/core-domain/src/deploymentRegistry.json），不在库里复制一份；
 *   - 三个端点全部公开只读，与站点模块 / 商城目录同一「浏览公开」访问模型；
 *   - 统一字段一律 snake_case；result 为 null 表示空数据，缺失信息由 missing_fields 显式给出；
 *   - 只读汇总不引入写操作、不查业务表，避免把运维视图变成新的数据写入面。
 *
 * 路由一览（/api/v1 前缀由 app.ts 统一挂载）：
 *   GET /deployments/overview   公开 — 全量汇总（状态 / 结果 / 层级 / 平台 / 严重度分布 + 覆盖口径）
 *   GET /deployments            公开 — 部署项清单，支持 q / layer / status / verdict / platform_id 过滤
 *   GET /deployments/:id        公开 — 单项详情（仓库标识、交付链路、结果、异常、缺失信息、取证来源）
 *
 * 注意：/deployments/overview 必须注册在 /deployments/:id 之前，否则会被详情路由当作 id 吞掉。
 */

import { Router } from 'express'; // Express 路由容器，按 /api/v1 前缀挂载
import { AppError } from '@mim/core-domain'; // 统一业务异常，未登记 id 回 404 信封
import {
  DEPLOYMENT_CI_JOBS, // CI 作业清单（5 个，含 1 个门禁作业）
  DEPLOYMENT_EXCLUDED, // 候选池 / 已排除项，明确不计入部署项
  DEPLOYMENT_ITEMS, // 16 个规范部署项（单一事实源，运行时实计数）
  DEPLOYMENT_LAYER_CODES, // 层级字典
  DEPLOYMENT_PLATFORMS, // 平台目录（9 个矩阵平台 + 7 个补充平台，共 16）
  DEPLOYMENT_SEVERITY_CODES, // 严重度字典
  DEPLOYMENT_STATUS_CODES, // 部署状态字典
  DEPLOYMENT_VERDICT_CODES, // 部署结果字典
  deploymentRegistry, // 注册表元信息（schema / 取证时间 / 覆盖口径）
  deploymentSummary, // 与前端共用的汇总统计函数
  findDeploymentItem, // 按规范 id 查询部署项
  listDeploymentItems, // 按条件过滤部署项
} from '@mim/core-domain'; // 共享包单一数据源，前后端共用同一份部署口径
import { pathParam } from '../utils.js'; // 严格路径参数提取
import type { ApiDeps } from '../types.js'; // 依赖容器类型，保持与其它路由工厂签名一致

// 从查询串取字符串参数：非字符串一律回落空串，避免数组型参数污染过滤条件。
function queryString(req: { query: Record<string, unknown> }, key: string): string {
  // 只接受 string，其余（数组 / 对象 / undefined）按未提供处理。
  const value = req.query[key];
  // 去首尾空白后返回。
  return typeof value === 'string' ? value.trim() : '';
} // queryString 结束

// 路由工厂：与其余域一致，由 createApp 注入 deps 后统一挂载。
export function createDeploymentsRouter(_deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  // ---------- 公开：全量汇总 ----------

  /** GET /deployments/overview — 统一字段的分布统计 + 覆盖口径 + 字典（须先于 /deployments/:id 注册） */
  router.get('/deployments/overview', (_req, res) => { // 公开只读，匿名可访问
    res.json({ // 统一响应体：汇总（含 schema / captured_at / head）+ 口径 + 字典 + 作业 / 排除清单
      ...deploymentSummary(), // schema / captured_at / head / total / by_status / by_verdict / by_layer / by_platform / by_severity 等
      scope: deploymentRegistry.scope, // 覆盖范围说明
      sources: deploymentRegistry.sources, // 取证来源清单
      status_codes: DEPLOYMENT_STATUS_CODES, // 状态字典，供前端渲染徽标文案
      verdict_codes: DEPLOYMENT_VERDICT_CODES, // 结果字典，区分 PASS / DEGRADED / FAIL / NOT_TESTED / EMPTY
      severity_codes: DEPLOYMENT_SEVERITY_CODES, // 严重度字典，对应 🔴 / 🟡 / 🟢
      layer_codes: DEPLOYMENT_LAYER_CODES, // 层级字典，production 为唯一权威终点
      platforms: DEPLOYMENT_PLATFORMS, // 平台目录，含 in_matrix 标记
      ci_job_list: DEPLOYMENT_CI_JOBS, // CI 作业明细（数字 ci_jobs 由汇总函数给出，避免同名字段覆盖）
      excluded_items: DEPLOYMENT_EXCLUDED, // 候选池 / 排除项明细（数字 excluded 由汇总函数给出）
      field_spec: deploymentRegistry.field_spec, // 统一字段说明，便于核对命名口径
    }); // 响应结束
  }); // GET /deployments/overview 结束

  // ---------- 公开：部署项清单 ----------

  /** GET /deployments — 全量规范部署项（16），支持 q / layer / status / verdict / platform_id 过滤 */
  router.get('/deployments', (req, res) => { // 公开只读
    const filter = { // 逐项读取查询参数，空串等价于不过滤
      q: queryString(req, 'q'), // 关键词：id / 名称 / 别名 / 仓库标识 / 入口
      layer: queryString(req, 'layer'), // 层级：production / distribution / source
      status: queryString(req, 'status'), // 部署状态：OK / BROKEN / UNVERIFIED / MANUAL
      verdict: queryString(req, 'verdict'), // 结果：PASS / DEGRADED / FAIL / NOT_TESTED / EMPTY
      platform_id: queryString(req, 'platform_id'), // 平台编码，例如 github-pages
    }; // 过滤条件结束
    const rows = listDeploymentItems(filter); // 复用共享包过滤，保证前后端口径完全一致
    res.json({ // 统一响应体：过滤条件回显 + 总数 + 清单 + 字典
      schema: deploymentRegistry.schema, // 契约版本
      captured_at: deploymentRegistry.capturedAt, // 取证时间
      filters: filter, // 回显本次生效的过滤条件，便于核对
      total: rows.length, // 过滤后条数
      registry_total: DEPLOYMENT_ITEMS.length, // 注册表总条数，便于区分「过滤结果」与「空数据」
      items: rows, // 部署项数组（含 result 为 null 的空数据项）
      status_codes: DEPLOYMENT_STATUS_CODES, // 状态字典
      verdict_codes: DEPLOYMENT_VERDICT_CODES, // 结果字典
      severity_codes: DEPLOYMENT_SEVERITY_CODES, // 严重度字典，供异常说明分级展示
    }); // 响应结束
  }); // GET /deployments 结束

  // ---------- 公开：单项详情 ----------

  /** GET /deployments/:id — 单项完整视图（含异常说明与缺失信息清单） */
  router.get('/deployments/:id', (req, res) => { // 公开只读
    const id = pathParam(req, 'id'); // 严格取路径参数，非字符串一律 400
    const item = findDeploymentItem(id); // 按规范 id 查询
    if (!item) throw new AppError('NOT_FOUND', `deployment item not found: ${id}`, { id }); // 未登记 id 回 404 并回显
    res.json({ // 统一响应体：单项 + 相关字典 + 同类项
      schema: deploymentRegistry.schema, // 契约版本
      item, // 完整部署项（统一字段，result 可能为 null）
      related: DEPLOYMENT_ITEMS // 同平台的其它部署项，便于核对「同类项不遗漏 / 不重复」
        .filter((other) => other.platform_id === item.platform_id && other.id !== item.id)
        .map((other) => ({ id: other.id, name: other.name, layer: other.layer })), // 只回显三项，避免响应体过大
      status_codes: DEPLOYMENT_STATUS_CODES, // 状态字典
      verdict_codes: DEPLOYMENT_VERDICT_CODES, // 结果字典
      severity_codes: DEPLOYMENT_SEVERITY_CODES, // 严重度字典
    }); // 响应结束
  }); // GET /deployments/:id 结束

  return router; // 返回装配完成的路由
} // createDeploymentsRouter 结束
