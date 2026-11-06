/**
 * ai-orchestrator 域（08 §2 / §8）：生成任务编排控制面
 *
 * - 后台 worker 自动消费 queued 任务（进程内，见 orchestrator.ts）；
 * - 本路由提供手动触发（便于测试与运维补偿）与能力自检；
 * - 任务归属经工程 owner 校验，跨用户一律 404。
 */

import { Router } from 'express'; // 仅用 Router 工厂建子路由，本文件不直接使用 express 本体
import { AppError } from '@mim/core-domain'; // 抛出领域错误，由全局 errorHandler 统一转成错误信封

import { idempotency, requireAuth, requireEntitlement } from '../middleware.js'; // 幂等键、鉴权、权益三道拦截，缺一都会放开越权面
import { jsonParse, pathParam } from '../utils.js'; // jsonParse 安全解析 JSON 列；pathParam 取并校验路径参数
import type { Orchestrator } from '../orchestrator.js'; // 编排器类型，仅用于 requireOrchestrator 的返回标注
import type { ApiDeps } from '../types.js'; // 依赖容器类型
import { ownedJobProjectId } from './media.js'; // 复用 media 域的归属查询，避免两处各写一份 JOIN

const MODULE_CODE = 'comic.workbench'; // 与 comic / media 域同一模块码，保证解锁口径一致

interface JobRow { // generation_jobs 表行结构，用于把 SQL 结果强类型化
  id: string; // 任务主键（uuidv7）
  project_id: string; // 所属创作工程
  storyboard_id: string | null; // 关联分镜；非分镜类任务为 null
  job_type: string; // 任务类型（如生图 / 配音），决定 worker 走哪条产线
  status: string; // 任务状态：queued / running / succeeded / failed 等
  retry_of: string | null; // 重试来源任务 ID；首次执行时为 null，便于追踪重试链
  cost_estimate_minor: number | null; // 预估成本（最小货币单位），用于额度预占与展示
  error_code: string | null; // 失败错误码；成功时为 null
  payload: string; // 请求参数 JSON 文本，读库后需解析
  result: string | null; // 执行结果 JSON 文本；未完成时为 null
  created_by: string; // 创建者 user_id，审计与归属追溯用
  created_at: string; // 创建时间（ISO 字符串）
  started_at: string | null; // 开始执行时间；未开始为 null
  finished_at: string | null; // 结束时间；未结束为 null
} // JobRow 结束：字段与 generation_jobs 表列一一对应

function jobPayload(row: JobRow) { // 把 DB 行转成对外 JSON，顺带把两列 JSON 文本解析成对象
  return { // 显式列举字段，避免把内部列直接透出
    id: row.id, // 任务 ID
    project_id: row.project_id, // 所属工程
    storyboard_id: row.storyboard_id, // 关联分镜
    job_type: row.job_type, // 任务类型
    status: row.status, // 当前状态
    retry_of: row.retry_of, // 重试来源
    cost_estimate_minor: row.cost_estimate_minor, // 预估成本
    error_code: row.error_code, // 失败码
    payload: jsonParse<Record<string, unknown>>(row.payload) ?? {}, // 解析失败时给空对象，保证响应结构稳定不抛错
    result: row.result ? jsonParse<Record<string, unknown>>(row.result) : null, // 结果为空才返回 null，避免解析空串
    created_by: row.created_by, // 创建者
    created_at: row.created_at, // 创建时间
    started_at: row.started_at, // 开始时间
    finished_at: row.finished_at, // 结束时间
  }; // 返回对象字面量结束
} // jobPayload 结束

function requireOrchestrator(deps: ApiDeps): Orchestrator { // 取编排器；未装配时统一报配置缺失
  if (!deps.orchestrator) { // 测试或私有化部署可能未启用 AI 能力
    throw new AppError('PROVIDER_NOT_CONFIGURED', 'ai orchestrator is not available'); // 503 语义：能力未开而非路由不存在
  } // if 结束：未装配时已抛错，下面可安全断言非空
  return deps.orchestrator; // 收窄为必存在后返回，供调用方直接使用
} // requireOrchestrator 结束

export function createAiRouter(deps: ApiDeps): Router { // 路由工厂：由 app 在受保护段挂载
  const router = Router(); // 独立 router，避免影响其它域的中间件
  // 鉴权按命名空间生效：未匹配到 /ai* 的请求直接放行到后续 router，避免未知路径被误拦成 401
  router.use('/ai', requireAuth); // 只拦 /ai 前缀，后续 router 的请求原样穿透
  router.use('/ai', requireEntitlement(MODULE_CODE)); // 再校验模块权益，未解锁用户即使登录也拿不到 AI 能力

  /** 能力自检：provider / 成本上限 / 保留期 / 存储驱动 */
  router.get('/ai/capabilities', (_req, res) => { // 只读探测，供前端决定展示哪些入口
    const orchestrator = requireOrchestrator(deps); // 未装配编排器时此处直接抛配置错误
    res.json({ // 返回能力与存储状态两块，前端据此做降级
      ai: orchestrator.capabilities(), // 由编排器自述 provider、成本上限、保留期
      storage: deps.storage // 存储可能未配置，故先判空
        ? { driver: deps.storage.driver, configured: deps.storage.configured } // 只暴露驱动名与是否就绪，不泄漏凭证
        : null, // 未装配则返回 null，前端按「无存储」处理
    }); // json 调用结束，响应已发出
  }); // 能力自检路由处理函数结束

  /** 手动触发单个 queued 任务（正常由后台 worker 自动消费） */
  router.post('/ai/jobs/:id/run', idempotency, async (req, res) => { // 写操作，前置幂等键校验避免重复触发
    const user = req.user!; // 已过 requireAuth，user 必定存在
    const jobId = pathParam(req, 'id'); // 取路径参数并做基础校验

    const projectId = ownedJobProjectId(deps.db, user.id, jobId); // 经工程属主间接校验任务归属
    if (!projectId) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId }); // 无权限与不存在同样 404，不泄漏任务存在性

    const job = deps.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as JobRow | undefined; // 取整行用于状态判断与响应
    if (!job) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId }); // 归属已通过但行被并发删除时兜底
    if (job.status !== 'queued') { // 只有排队中的任务允许手动触发，避免重复执行
      throw new AppError('CONFLICT', `generation job is ${job.status}`, { job_id: jobId, status: job.status }); // 409 并把当前状态回给前端
    } // if 结束：确认是 queued 才允许继续

    const orchestrator = requireOrchestrator(deps); // 取编排器执行
    const run = await orchestrator.runOne(jobId); // 尝试认领并执行一个任务（内部先抢占状态）
    if (!run || run.status === 'skipped') { // 被其它 worker 抢先认领时会返回 skipped
      throw new AppError('CONFLICT', run?.message ?? 'generation job was claimed by another worker', { // 认领失败即 409，避免重复执行
        job_id: jobId, // 回传任务 ID 便于前端定位
      }); // AppError 构造结束，错误交由全局 errorHandler 转信封
    } // if 结束：成功认领则继续返回执行结果

    const updated = deps.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as JobRow; // 重查一次拿到执行后的最新状态

    res.json({ run, job: jobPayload(updated) }); // 同时返回本次执行详情与最新任务快照
  }); // 手动触发路由处理函数结束

  return router; // 交由 app 挂载到 /api/v1
} // 路由工厂结束，返回已注册好端点的 router
