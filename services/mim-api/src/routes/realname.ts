/**
 * 实名审核路由：本人提交 / 状态查询 + 管理端待审队列与审核流转。
 *
 * 端点一览（统一挂在 /api/v1 下）：
 *   POST   /auth/realname/submit    本人提交实名（需登录；明文不入库）
 *   GET    /auth/realname/status    本人查询审核状态（需登录）
 *   GET    /admin/realname/queue     管理端待审队列（权限：user:read）
 *   POST   /admin/realname/:id/review 管理端通过 / 驳回（权限：rbac:write）
 *
 * 未接入第三方核验服务时记录 provider='manual'，全部进入人工队列。
 */

import { Router } from 'express'; // 独立路由实例
import { z } from 'zod'; // 请求体校验
import { parse } from '../validate.js'; // zod 校验包装
import { requireAuth } from '../middleware.js'; // 本人端点登录态
import { requirePermission } from '../middleware.js'; // 管理端点 RBAC 门禁
import { clockOf } from '../domain.js'; // 可注入时钟
import {
  getMyRealname, // 本人状态查询
  listPendingRealnames, // 待审队列
  reviewRealname, // 审核流转
  submitRealname, // 提交实名
  type RealnameIdType, // 证件类型
} from '../realname.js'; // 实名数据层
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 提交请求体：证件号明文只在本次请求内存存在，落库仅留摘要与后四位 */
const submitBody = z.object({ // 字段白名单
  id_type: z.enum(['id_card', 'passport', 'other']), // 证件类型
  name: z.string().min(2).max(30), // 真实姓名
  id_number: z.string().min(1).max(32), // 仅限长度，格式由数据层统一判 REALNAME_INVALID
}); // submitBody 结束

/** 审核请求体：decision 二选一，驳回原因按数据层规则校验必填 */
const reviewBody = z.object({ // 字段白名单
  decision: z.enum(['approve', 'reject']), // 通过 / 驳回
  reason: z.string().max(200).optional(), // 驳回原因
}); // reviewBody 结束

/** 取实名摘要密钥：可选独立机密，缺省回退 JWT 密钥 */
function digestSecret(deps: ApiDeps): string { // 与数据层 HMAC 口径一致
  return (deps.env.MIM_REALNAME_SECRET ?? '').trim() || deps.jwtSecret; // 优先独立机密
} // digestSecret 结束

/** 组装实名路由工厂：测试自建 mini app 时直接挂载本路由 */
export function createRealnameRouter(deps: ApiDeps): Router { // 依赖显式注入
  const router = Router(); // 独立路由实例

  router.post('/auth/realname/submit', requireAuth, (req, res) => { // 本人提交
    const body = parse(submitBody, req.body ?? {}); // 校验请求体
    const now = clockOf(deps); // 统一取时
    const view = submitRealname( // 写入摘要与脱敏片段
      deps.db, // 数据库句柄
      digestSecret(deps), // HMAC 密钥
      deps.env, // 读审核通道配置
      req.user!.id, // 归属用户
      { idType: body.id_type as RealnameIdType, name: body.name, idNumber: body.id_number }, // 入参
      now, // 提交时间
    ); // submitRealname 结束
    res.status(201).json(view); // 回显脱敏视图
  }); // 结束 POST /auth/realname/submit

  router.get('/auth/realname/status', requireAuth, (req, res) => { // 本人状态
    const view = getMyRealname(deps.db, req.user!.id); // 查本人记录
    res.json({ record: view }); // 未提交为 null，前端据此展示表单
  }); // 结束 GET /auth/realname/status

  router.get('/admin/realname/queue', requirePermission('user:read'), (_req, res) => { // 待审队列
    const queue = listPendingRealnames(deps.db, 50); // 取前 50 条待审
    res.json({ queue }); // 回显队列条目（脱敏字段）
  }); // 结束 GET /admin/realname/queue

  router.post('/admin/realname/:id/review', requirePermission('rbac:write'), (req, res) => { // 审核流转
    const body = parse(reviewBody, req.body ?? {}); // 校验请求体
    const recordId = String(req.params.id ?? ''); // 路径参数收敛为字符串
    const now = clockOf(deps); // 统一取时
    const reviewerId = req.adminBootstrap === true ? 'admin-bootstrap' : req.user!.id; // 引导通道标记操作人
    const view = reviewRealname(deps.db, recordId, body.decision, body.reason ?? null, reviewerId, now); // 执行流转
    res.json(view); // 回读最新视图
  }); // 结束 POST /admin/realname/:id/review

  return router; // 交出可挂载路由
} // createRealnameRouter 结束
