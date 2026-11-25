/**
 * 社区申诉与关注板块路由（2026-11-25 申诉与成长公开批次）。
 *
 * 端点一览（统一挂在 /api/v1 下）：
 *   POST   /community/appeals            本人对被处置内容提交申诉（需登录，7 天窗口，同一目标一次）
 *   GET    /community/appeals/mine       本人申诉列表（私密读，匿名 401）
 *   GET    /admin/appeals                待处理申诉队列（RBAC content:write，按提交时间正序）
 *   PUT    /admin/appeals/:id            受理 / 驳回 + 处理说明（RBAC content:write，写审计 + 站内回执）
 *   GET    /community/follows/boards     本人关注的板块清单（私密读，匿名 401；关注关系不公开）
 *
 * 处置事实口径：
 *   · 帖子被处置 = community_threads.status='hidden'，处置时间取 updated_at；
 *   · 回复被处置 = community_posts.deleted_at 非空（软删 / 隐藏），处置时间取 deleted_at；
 *   · 申诉期间不恢复内容（保守口径），受理 / 驳回都只回执，不自动改动目标内容状态。
 */

import { Router } from 'express'; // Express 路由容器
import { randomUUID } from 'node:crypto'; // 申诉单 / 通知主键
import { z } from 'zod'; // 入参声明式校验
import { AppError } from '@mim/core-domain'; // 统一业务异常与错误码
import { parse } from '../validate.js'; // zod 校验失败统一翻译为 VALIDATION_FAILED
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 登录态 / RBAC 门禁 / 写操作幂等
import { auditActor, audited } from '../audit.js'; // 后台处理动作统一审计留痕
import { clockOf } from '../domain.js'; // 可注入时钟：窗口判断在测试里可复现
import type { ApiDeps } from '../types.js'; // 依赖容器类型

/** 申诉受理窗口：被处置后 7 天内可申诉，超期不再受理（毫秒） */
const APPEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 个自然日

/** 提交申诉请求体：对象类型 + 对象主键 + 申诉理由，理由由作者自述、路由层限长 */
const appealBodySchema = z.object({ // 字段白名单：只接纳这三项，多余键丢弃
  target_type: z.enum(['thread', 'reply']), // 对象类型：帖子 / 回复（与前端文案口径一致）
  target_id: z.string().trim().min(1).max(64), // 对象主键：社区帖子或回复 ID
  reason: z.string().trim().min(2, '请填写申诉理由').max(500, '申诉理由不超过 500 字'), // 理由：供版主 / 超管复核
}); // appealBodySchema 结束

/** 处理申诉请求体：受理 / 驳回二选一，处理说明可选但建议填写 */
const reviewBodySchema = z.object({ // 字段白名单
  decision: z.enum(['accept', 'reject']), // 受理成立 / 驳回
  note: z.string().trim().max(500).default(''), // 处理说明：随站内通知回执申诉人
}); // reviewBodySchema 结束

/** 被处置目标行：路由判定窗口与归属时共用的最小字段集 */
interface DisposedTarget { // 接口声明：约束读取结果结构
  authorId: string | null; // 内容作者；作者为空（官方帖）不接受申诉
  disposedAt: string; // 处置时间：帖子取 updated_at，回复取 deleted_at
  threadId: string | null; // 归属帖子：回复申诉时便于通知与定位
  title: string | null; // 归属帖子标题：队列与回执展示用
} // DisposedTarget 结束

/**
 * 读取并校验申诉目标：存在、归属本人、确有被处置记录。
 * 任一前置不满足都抛对应业务错误码，不在调用处重复拼分支。
 */
function resolveDisposedTarget( // 函数 resolveDisposedTarget：封装目标校验流程
  db: ApiDeps['db'], // 数据库句柄
  targetType: 'thread' | 'reply', // 对象类型
  targetId: string, // 对象主键
  userId: string, // 当前申诉人
): DisposedTarget { // 返回归属与处置时间快照
  if (targetType === 'thread') { // 帖子分支：按隐藏状态判定处置事实
    const row = db.prepare( // 预编译查询：取作者 / 状态 / 处置时间 / 标题
      `SELECT id, author_id, status, title, updated_at
         FROM community_threads WHERE id = ?`,
    ).get(targetId) as { id: string; author_id: string | null; status: string; title: string; updated_at: string } | undefined; // 查询单行
    if (!row) throw new AppError('NOT_FOUND', '申诉对象不存在或已被删除'); // 404：对象不存在
    if (row.author_id !== userId) throw new AppError('FORBIDDEN', '只能对自己发布的内容申诉'); // 403：非本人目标
    if (row.status !== 'hidden') throw new AppError('VALIDATION_FAILED', '该内容当前未被处置，无需申诉'); // 400：未被隐藏
    return { authorId: row.author_id, disposedAt: row.updated_at, threadId: row.id, title: row.title }; // 处置快照交回
  } // 帖子分支结束
  // 回复分支：按软删时间判定处置事实（deleted_at 非空即被删除 / 隐藏）
  const row = db.prepare( // 预编译查询：回复作者 / 软删时间 / 归属帖子
    `SELECT p.id, p.author_id, p.deleted_at, p.thread_id, t.title
       FROM community_posts p
       LEFT JOIN community_threads t ON t.id = p.thread_id
      WHERE p.id = ?`,
  ).get(targetId) as { id: string; author_id: string | null; deleted_at: string | null; thread_id: string; title: string | null } | undefined; // 查询单行
  if (!row) throw new AppError('NOT_FOUND', '申诉对象不存在或已被删除'); // 404：对象不存在
  if (row.author_id !== userId) throw new AppError('FORBIDDEN', '只能对自己发布的内容申诉'); // 403：非本人目标
  if (!row.deleted_at) throw new AppError('VALIDATION_FAILED', '该回复当前未被处置，无需申诉'); // 400：未被软删
  return { authorId: row.author_id, disposedAt: row.deleted_at, threadId: row.thread_id, title: row.title }; // 处置快照交回
} // resolveDisposedTarget 结束

/** 组装申诉路由工厂：测试自建 mini app 时直接挂载本路由 */
export function createAppealsRouter(deps: ApiDeps): Router { // 依赖显式注入
  const router = Router(); // 独立路由实例

  /** 提交申诉：登录用户对自己被处置的帖子 / 回复发起一次申诉 */
  // 幂等由社区路由全局中间件覆盖 /community 前缀，本路由不再重复挂载，避免同请求被两层幂等各占一次键
  router.post('/community/appeals', requireAuth, (req, res) => { // 写操作：登录态校验后进入业务流程
    const body = parse(appealBodySchema, req.body ?? {}); // 校验请求体并剥离多余字段
    const userId = req.user!.id; // 申诉人主键：登录态由 requireAuth 保证
    const now = clockOf(deps); // 统一取时：窗口判断与落库时间同源

    // 同一目标只能申诉一次：已有待处理或已结案的申诉都不允许重复提交
    const duplicated = deps.db // 预编译查询：本人 + 同一对象是否已有申诉单
      .prepare('SELECT id FROM community_appeals WHERE user_id = ? AND target_type = ? AND target_id = ?')
      .get(userId, body.target_type, body.target_id); // 查询单行
    if (duplicated) throw new AppError('CONFLICT', '该目标已提交过申诉，请勿重复提交'); // 409：重复申诉拦截

    const target = resolveDisposedTarget(deps.db, body.target_type, body.target_id, userId); // 归属 + 处置事实校验
    const disposedAtMs = Date.parse(target.disposedAt); // 处置时间转毫秒时间戳
    if (!Number.isFinite(disposedAtMs)) throw new AppError('VALIDATION_FAILED', '处置时间无效，请稍后重试'); // 时间解析失败兜底
    if (Date.parse(now) - disposedAtMs > APPEAL_WINDOW_MS) { // 超 7 天受理窗口
      throw new AppError('VALIDATION_FAILED', '已超过 7 天申诉受理期限', { reason: 'APPEAL_WINDOW_EXPIRED' }); // 400：窗口过期
    } // 窗口判定结束

    const appealId = `appeal-${randomUUID()}`; // 申诉主键前缀与举报 / 通知同风格
    deps.db.prepare( // 预编译写入：申诉单落库，状态默认 pending
      `INSERT INTO community_appeals (id, user_id, target_type, target_id, reason, status, handled_by, handled_note, created_at, handled_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, '', ?, NULL)`,
    ).run(appealId, userId, body.target_type, body.target_id, body.reason, now); // 绑定参数并执行写入

    res.status(201).json({ id: appealId, status: 'pending' }); // 回申诉 id 与初始状态
  }); // 结束 POST /community/appeals

  /** 本人申诉列表：只按申诉人过滤，匿名 401；含归属帖子标题便于定位 */
  router.get('/community/appeals/mine', requireAuth, (req, res) => { // 私密读：requireAuth 兜底，门禁清单同步登记
    const userId = req.user!.id; // 只读取本人单据，绝不按他人申诉人过滤
    const rows = deps.db // 预编译查询：申诉单左联归属帖子标题
      .prepare(
        `SELECT a.id, a.target_type, a.target_id, a.reason, a.status, a.handled_note,
                a.created_at, a.handled_at, t.title AS thread_title, p.thread_id AS post_thread_id
           FROM community_appeals a
           LEFT JOIN community_threads t ON a.target_type = 'thread' AND t.id = a.target_id
           LEFT JOIN community_posts p ON a.target_type = 'reply' AND p.id = a.target_id
          WHERE a.user_id = ?
          ORDER BY a.created_at DESC`,
      )
      .all(userId) as Array<{ // 查询多行：列表字段结构
      id: string; target_type: 'thread' | 'reply'; target_id: string; reason: string; // 对象定位与理由
      status: 'pending' | 'accepted' | 'rejected'; handled_note: string; // 状态与处理说明
      created_at: string; handled_at: string | null; thread_title: string | null; post_thread_id: string | null; // 时间与归属
    }>;
    const items = rows.map((row) => ({ // 逐行归一对外视图：回复目标的帖子标题回落关联帖
      id: row.id, // 申诉主键
      target_type: row.target_type, // 帖子 / 回复
      target_id: row.target_id, // 对象主键
      thread_id: row.target_type === 'reply' ? row.post_thread_id : row.target_id, // 归属帖子：通知 / 跳转定位用
      thread_title: row.thread_title, // 归属帖子标题
      reason: row.reason, // 申诉理由
      status: row.status, // 受理状态
      handled_note: row.handled_note, // 处理说明
      created_at: row.created_at, // 提交时间
      handled_at: row.handled_at, // 处理时间
    })); // 视图映射结束
    res.json({ items, total: items.length }); // 列表 + 总数，与收藏 / 举报我的列表同形态
  }); // 结束 GET /community/appeals/mine

  /** 管理端申诉队列：content:write 权限，待处理优先、先申诉先受理；已结案单附在后面便于复核 */
  router.get('/admin/appeals', requirePermission('content:write'), (_req, res) => { // 后台读：RBAC 门禁先于业务查询
    const rows = deps.db // 预编译查询：申诉人昵称 + 归属帖子标题 + 回复摘要
      .prepare(
        `SELECT a.id, a.user_id, u.display_name AS user_name,
                a.target_type, a.target_id, a.reason, a.status, a.handled_by, a.handled_note,
                a.created_at, a.handled_at, t.title AS thread_title, p.content AS post_excerpt
           FROM community_appeals a
           LEFT JOIN users u ON u.id = a.user_id
           LEFT JOIN community_threads t ON a.target_type = 'thread' AND t.id = a.target_id
           LEFT JOIN community_posts p ON a.target_type = 'reply' AND p.id = a.target_id
          ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at ASC
          LIMIT 100`,
      )
      .all() as Array<{ // 查询多行：队列条目结构
      id: string; user_id: string; user_name: string | null; // 申诉人
      target_type: 'thread' | 'reply'; target_id: string; reason: string; // 对象与理由
      status: 'pending' | 'accepted' | 'rejected'; handled_by: string | null; handled_note: string; // 处理状态
      created_at: string; handled_at: string | null; thread_title: string | null; post_excerpt: string | null; // 时间与定位
    }>;
    res.json({ items: rows, total: rows.length }); // 队列条目 + 总数
  }); // 结束 GET /admin/appeals

  /** 受理 / 驳回申诉：写审计留痕，并向申诉人发站内通知回执；不自动恢复被处置内容 */
  router.put('/admin/appeals/:id', requirePermission('content:write'), idempotency, (req, res) => { // 后台写：RBAC content:write + 幂等防重复流转
    const body = parse(reviewBodySchema, req.body ?? {}); // 校验决策与处理说明
    const appealId = String(req.params.id ?? ''); // 申诉主键路径参数
    const now = clockOf(deps); // 统一取时：处理时间与审计时间同源

    const appeal = deps.db // 预编译查询：待处理申诉单
      .prepare(
        `SELECT a.id, a.user_id, a.target_type, a.target_id, a.status,
                t.title AS thread_title, p.thread_id AS post_thread_id
           FROM community_appeals a
           LEFT JOIN community_threads t ON a.target_type = 'thread' AND t.id = a.target_id
           LEFT JOIN community_posts p ON a.target_type = 'reply' AND p.id = a.target_id
          WHERE a.id = ?`,
      )
      .get(appealId) as { // 查询单行
      id: string; user_id: string; target_type: 'thread' | 'reply'; target_id: string; status: string; // 申诉定位字段
      thread_title: string | null; post_thread_id: string | null; // 归属帖子：通知关联用
    } | undefined;
    if (!appeal) throw new AppError('NOT_FOUND', '申诉单不存在'); // 404：单据不存在
    if (appeal.status !== 'pending') throw new AppError('CONFLICT', '该申诉已处理，不能重复流转'); // 409：已结案

    const handlerId = req.adminBootstrap === true ? 'admin-bootstrap' : req.user!.id; // 处理人：引导通道单独标记
    const decisionStatus = body.decision === 'accept' ? 'accepted' : 'rejected'; // 受理成立 / 驳回 归一为库内状态
    const noticeContent = body.decision === 'accept' // 回执文案：受理与驳回分两版，说明随附处理说明
      ? `你的申诉已受理：${body.note || '被处置内容经复核成立，将按规则恢复展示。'}`
      : `你的申诉已驳回：${body.note || '经复核，原处置维持不变。'}`; // 驳回回执

    audited(deps.db, auditActor(req), { // 处理动作与审计同属一次敏感操作，失败也留 failure 痕
      action: 'community.appeal.review', // 动作码：与举报处理审计同域分段
      targetType: 'appeal', // 对象类型
      targetId: appeal.id, // 对象主键
      detail: { decision: body.decision, target_type: appeal.target_type, target_id: appeal.target_id }, // 明细：决策与对象（不含敏感明文）
    }, () => { // 业务动作闭包：更新申诉单 + 写站内回执
      deps.db.prepare( // 预编译写入：流转状态、处理人、说明与处理时间
        `UPDATE community_appeals
           SET status = ?, handled_by = ?, handled_note = ?, handled_at = ?
         WHERE id = ? AND status = 'pending'`, // 条件更新兜底并发重复处理
      ).run(decisionStatus, handlerId, body.note, now, appeal.id); // 绑定参数并执行写入
      const threadId = appeal.target_type === 'reply' ? appeal.post_thread_id : appeal.target_id; // 通知关联帖子
      deps.db.prepare( // 预编译写入：站内通知回执申诉人，申诉期间不改动目标内容状态
        `INSERT INTO community_notifications (id, user_id, kind, thread_id, post_id, actor_id, content, created_at)
         VALUES (?, ?, 'appeal', ?, ?, ?, ?, ?)`,
      ).run(`notif-${randomUUID()}`, appeal.user_id, threadId, appeal.target_type === 'reply' ? appeal.target_id : null, handlerId, noticeContent.slice(0, 120), now); // 通知摘要截断 120 字，与既有通知口径一致
    }); // audited 结束

    res.json({ ok: true, id: appeal.id, status: decisionStatus }); // 回处理结果状态
  }); // 结束 PUT /admin/appeals/:id

  /** 本人关注的板块清单：关注关系不公开，只有本人能看到；匿名 401 */
  router.get('/community/follows/boards', requireAuth, (req, res) => { // 私密读：门禁清单同步登记
    const userId = req.user!.id; // 只读取本人关注记录
    const boards = deps.db // 预编译查询：关注记录联板块元信息 + 成员数 / 帖数
      .prepare(
        `SELECT b.slug, b.name, b.icon, b.visibility,
                (SELECT COUNT(*) FROM community_board_memberships m WHERE m.board_id = b.id) AS member_count,
                (SELECT COUNT(*) FROM community_threads t WHERE t.board_id = b.id AND t.status = 'published') AS thread_count
           FROM community_board_follows f
           JOIN community_boards b ON b.id = f.board_id
          WHERE f.user_id = ? AND b.status = 'active'
          ORDER BY f.created_at ASC`,
      )
      .all(userId) as Array<{ // 查询多行：关注板块一行
      slug: string; name: string; icon: string; visibility: string; // 板块元信息
      member_count: number; thread_count: number; // 成员数与帖数
    }>;
    res.json({ boards, total: boards.length }); // 清单 + 总数
  }); // 结束 GET /community/follows/boards

  return router; // 交回装配完成的路由
} // createAppealsRouter 结束
