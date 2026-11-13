/** 安全路由：验证码适配层签发、内容举报（滑动窗口限频）、运营处置与索引巡检 */

import { Router } from 'express'; // 引入依赖、类型或本地模块绑定
import { randomUUID } from 'node:crypto'; // 引入依赖、类型或本地模块绑定
import { z } from 'zod'; // 引入依赖、类型或本地模块绑定
import { AppError } from '@mim/core-domain'; // 引入依赖、类型或本地模块绑定
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 引入依赖、类型或本地模块绑定
import { parse } from '../validate.js'; // 引入依赖、类型或本地模块绑定
import { // 引入依赖、类型或本地模块绑定
  issueCaptcha, // 执行当前业务步骤
  verifyCaptcha, // 执行当前业务步骤
  captchaMode, // 执行当前业务步骤
  sceneCaptchaRequired, // 执行当前业务步骤
  captchaProvidersConfigured, // 执行当前业务步骤
  auditConfigured, // 执行当前业务步骤
  auditFallback, // 执行当前业务步骤
  inspectIndexes, // 执行当前业务步骤
  slidingWindow, // 执行当前业务步骤
  cacheOf, // 执行当前业务步骤
  type CaptchaScene, // 类型别名 CaptchaScene：复用一份复合类型定义
} from '../security.js'; // 代码块结束
import type { ApiDeps } from '../types.js'; // 引入依赖、类型或本地模块绑定
import { describeCdn, purgeCdn, type PurgeResult } from '../cdn.js'; // 引入依赖、类型或本地模块绑定

const now = () => new Date().toISOString(); // 统一 UTC 时间
const REPORT_SCENES: CaptchaScene[] = ['register', 'login', 'report', 'post']; // 状态披露用全场景清单

/** 举报限频：窗口（分钟）与上限均可由环境变量覆盖，缺省 24h / 5 条，按 用户+目标 滑动窗口 */
function reportLimit(env: Record<string, string | undefined>): { limit: number; windowSeconds: number } {
  const limit = Number(env.MIM_REPORT_LIMIT?.trim() || 5); // 常量 limit：保存固定配置或一次性派生值
  const windowMinutes = Number(env.MIM_REPORT_WINDOW_MINUTES?.trim() || 1440); // 常量 windowMinutes：保存固定配置或一次性派生值
  return { limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5, windowSeconds: Number.isFinite(windowMinutes) && windowMinutes > 0 ? Math.floor(windowMinutes * 60) : 86_400 }; // 返回当前函数的处理结果
} // 代码块结束

export function createSecurityRouter(deps: ApiDeps): Router { // 导出函数 createSecurityRouter：对外暴露的调用入口
  const router = Router(); // 常量 router：保存固定配置或一次性派生值
  let lastPurge: PurgeResult | null = null; // 最近一次 CDN 刷新结果（进程内留存，持久审计见 cdn_purge_audit 表）

  /** 公开能力状态：前端据此决定是否展示验证码与审核提示；如实回显当前模式 / 凭证齐备度 / 审核降级策略。 */
  router.get('/security/status', (_req, res) => {
    const env = deps.env; // 常量 env：保存固定配置或一次性派生值
    const mode = captchaMode(env); // 常量 mode：保存固定配置或一次性派生值
    const requiredScenes = REPORT_SCENES.filter((scene) => sceneCaptchaRequired(env, scene)); // 常量 requiredScenes：保存固定配置或一次性派生值
    const providers = captchaProvidersConfigured(env); // 常量 providers：保存固定配置或一次性派生值
    const auditEnabled = auditConfigured(env); // 常量 auditEnabled：保存固定配置或一次性派生值
    res.json({ // 执行当前业务步骤
      // 兼容旧字段：任一强制场景即视为需要验证码；审核是否接入
      captcha_required: requiredScenes.length > 0,
      content_audit: auditEnabled, // 对象字段 content_audit：记录一项配置或数据
      captcha: { // 对象字段 captcha：记录一项配置或数据
        mode, // 执行当前业务步骤
        required_scenes: requiredScenes, // 对象字段 required_scenes：记录一项配置或数据
        providers: { image: true, slider: true, tencent: providers.tencent, geetest4: providers.geetest4 }, // 对象字段 providers：记录一项配置或数据
      }, // 代码块结束
      audit: { enabled: auditEnabled, provider: auditEnabled ? 'baidu' : 'none', fallback: auditFallback(env) }, // 对象字段 audit：记录一项配置或数据
    }); // 代码块结束
  }); // 代码块结束

  /** 验证码签发：按场景（register/login/report/post）走当前模式适配器；第三方缺凭证抛 503。 */
  router.get('/auth/captcha', (req, res) => {
    const sceneRaw = typeof req.query.scene === 'string' ? req.query.scene : 'login'; // 常量 sceneRaw：保存固定配置或一次性派生值
    const scene: CaptchaScene = (REPORT_SCENES as string[]).includes(sceneRaw) ? (sceneRaw as CaptchaScene) : 'login'; // 常量 scene：保存固定配置或一次性派生值
    const issue = issueCaptcha(deps.db, deps.env, scene); // 常量 issue：保存固定配置或一次性派生值
    res.json({ scene, ...issue }); // 执行当前业务步骤
  }); // 代码块结束

  /** 提交举报：report 场景验证码（若强制）→ 用户+目标滑动窗口限频 → 目标存在性与自举报校验。 */
  router.post('/reports', requireAuth, idempotency, async (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    // 先于 zod 剥离读取验证码字段；off / 场景未强制时 verifyCaptcha 直接放行
    await verifyCaptcha(deps.db, deps.env, 'report', (req.body ?? {}) as Record<string, unknown>);
    const body = parse( // 常量 body：保存固定配置或一次性派生值
      z.object({ // 执行当前业务步骤
        target_type: z.enum(['thread', 'post', 'asset', 'product', 'user']), // 对象字段 target_type：记录一项配置或数据
        target_id: z.string().min(1).max(80), // 对象字段 target_id：记录一项配置或数据
        reason: z.string().min(2).max(80), // 对象字段 reason：记录一项配置或数据
        detail: z.string().max(500).optional(), // 对象字段 detail：记录一项配置或数据
      }), // 代码块结束
      req.body, // 执行当前业务步骤
    ); // 执行当前业务步骤
    // 滑动窗口：维度 = 用户 + 目标类型 + 目标 ID；窗口与上限走环境变量，缺省 24h / 5 条
    const { limit, windowSeconds } = reportLimit(deps.env);
    const rate = await slidingWindow(cacheOf(deps.env), `report:${userId}:${body.target_type}:${body.target_id}`, limit, windowSeconds); // 常量 rate：保存固定配置或一次性派生值
    if (!rate.ok) throw new AppError('RATE_LIMITED', `窗口内最多提交 ${limit} 条举报`, { limit, reset_at: rate.resetAt }); // 条件分支：按判断结果选择后续处理路径
    if (body.target_type === 'user' && body.target_id === userId) throw new AppError('VALIDATION_FAILED', '不能举报自己'); // 条件分支：按判断结果选择后续处理路径
    const exists = (() => { // 常量 exists：保存固定配置或一次性派生值
      if (body.target_type === 'thread') return !!deps.db.prepare('SELECT 1 AS ok FROM community_threads WHERE id = ?').get(body.target_id); // 条件分支：按判断结果选择后续处理路径
      if (body.target_type === 'post') return !!deps.db.prepare('SELECT 1 AS ok FROM community_posts WHERE id = ?').get(body.target_id); // 条件分支：按判断结果选择后续处理路径
      if (body.target_type === 'asset') return !!deps.db.prepare('SELECT 1 AS ok FROM paid_assets WHERE code = ? OR id = ?').get(body.target_id, body.target_id); // 条件分支：按判断结果选择后续处理路径
      if (body.target_type === 'product') return !!deps.db.prepare('SELECT 1 AS ok FROM shop_products WHERE code = ? OR id = ?').get(body.target_id, body.target_id); // 条件分支：按判断结果选择后续处理路径
      return !!deps.db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').get(body.target_id); // 返回当前函数的处理结果
    })(); // 代码块结束
    if (!exists) throw new AppError('NOT_FOUND', '举报目标不存在'); // 条件分支：按判断结果选择后续处理路径
    const ts = now(); // 常量 ts：保存固定配置或一次性派生值
    const id = `report-${randomUUID()}`; // 常量 id：保存固定配置或一次性派生值
    deps.db // 执行当前业务步骤
      .prepare( // 执行当前业务步骤
        `INSERT INTO content_reports (id, reporter_id, target_type, target_id, reason, detail, status, admin_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)`,
      ) // 执行当前业务步骤
      .run(id, userId, body.target_type, body.target_id, body.reason, body.detail ?? '', ts, ts); // 执行当前业务步骤
    res.status(201).json({ ok: true, id }); // 执行当前业务步骤
  }); // 代码块结束

  /** 我的举报记录。 */
  router.get('/reports/mine', requireAuth, (req, res) => {
    const items = deps.db // 常量 items：保存固定配置或一次性派生值
      .prepare('SELECT id, target_type, target_id, reason, status, admin_note, created_at FROM content_reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 30') // 执行当前业务步骤
      .all(req.user!.id); // 注册 ALL 路由 / 中间件处理器
    res.json({ items }); // 执行当前业务步骤
  }); // 代码块结束

  /** 运营视角：按状态列出举报。 */
  router.get('/reports/admin', requirePermission('commerce:write'), (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending'; // 常量 status：保存固定配置或一次性派生值
    const items = deps.db // 常量 items：保存固定配置或一次性派生值
      .prepare('SELECT id, reporter_id, target_type, target_id, reason, detail, status, admin_note, created_at FROM content_reports WHERE status = ? ORDER BY created_at ASC LIMIT 100') // 执行当前业务步骤
      .all(status); // 注册 ALL 路由 / 中间件处理器
    res.json({ items }); // 执行当前业务步骤
  }); // 代码块结束

  /** 索引巡检：缺失索引建议与慢查询候选（只读，供 DBA / 运营复核执行计划）。 */
  router.get('/security/index-audit', requirePermission('commerce:write'), (_req, res) => {
    res.json(inspectIndexes(deps.db)); // 执行当前业务步骤
  }); // 代码块结束

  /** CDN 配置与回源缓存契约状态：如实回显厂商 / 齐备度 / 策略清单 / 最近刷新结果。 */
  router.get('/security/cdn', requirePermission('commerce:write'), (_req, res) => {
    res.json({ ...describeCdn(deps.env), purge_last_result: lastPurge }); // 执行当前业务步骤
  }); // 代码块结束

  /** 主动刷新 CDN 缓存：需管理权限（commerce:write 等价管理门禁），结果落 cdn_purge_audit 审计表。 */
  router.post('/security/cdn/purge', requireAuth, requirePermission('commerce:write'), idempotency, async (req, res) => {
    const body = parse(z.object({ urls: z.array(z.string().url()).min(1) }), req.body); // 常量 body：保存固定配置或一次性派生值
    const result = await purgeCdn(deps.env, body.urls); // 常量 result：保存固定配置或一次性派生值
    lastPurge = result; // 赋值：更新变量 lastPurge 的取值
    deps.db // 执行当前业务步骤
      .prepare( // 执行当前业务步骤
        `INSERT INTO cdn_purge_audit (id, actor_id, provider, ok, configured, purged_json, error, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ) // 执行当前业务步骤
      .run( // 执行当前业务步骤
        `cdn-purge-${randomUUID()}`, // 执行当前业务步骤
        req.user!.id, // 执行当前业务步骤
        result.provider, // 执行当前业务步骤
        result.ok ? 1 : 0, // 执行当前业务步骤
        result.configured ? 1 : 0, // 执行当前业务步骤
        JSON.stringify(result.purged), // 执行当前业务步骤
        result.error ?? null, // 执行当前业务步骤
        result.status ?? null, // 执行当前业务步骤
        now(), // 调用 now 并处理其返回结果
      ); // 执行当前业务步骤
    res.status(result.ok ? 200 : result.configured ? 502 : 503).json(result); // 执行当前业务步骤
  }); // 代码块结束

  /** 运营处置：通过则隐藏目标内容，驳回只记录结论。 */
  router.put('/reports/:id', requirePermission('commerce:write'), idempotency, (req, res) => {
    const body = parse(z.object({ status: z.enum(['resolved', 'rejected']), admin_note: z.string().max(200).optional() }), req.body); // 常量 body：保存固定配置或一次性派生值
    const row = deps.db.prepare('SELECT id, target_type, target_id, status FROM content_reports WHERE id = ?').get(req.params.id) as // 常量 row：保存固定配置或一次性派生值
      | { id: string; target_type: string; target_id: string; status: string } // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (!row) throw new AppError('NOT_FOUND', '举报记录不存在'); // 条件分支：按判断结果选择后续处理路径
    if (row.status !== 'pending') throw new AppError('CONFLICT', '举报已处理'); // 条件分支：按判断结果选择后续处理路径
    const ts = now(); // 常量 ts：保存固定配置或一次性派生值
    const tx = deps.db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
      deps.db.prepare('UPDATE content_reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?').run(body.status, body.admin_note ?? '', ts, row.id); // 执行当前业务步骤
      if (body.status === 'resolved') { // 条件分支：按判断结果选择后续处理路径
        if (row.target_type === 'thread') deps.db.prepare("UPDATE community_threads SET status = 'hidden' WHERE id = ?").run(row.target_id); // 条件分支：按判断结果选择后续处理路径
        if (row.target_type === 'post') deps.db.prepare('DELETE FROM community_posts WHERE id = ?').run(row.target_id); // 条件分支：按判断结果选择后续处理路径
        if (row.target_type === 'product') deps.db.prepare("UPDATE shop_products SET status = 'inactive' WHERE code = ? OR id = ?").run(row.target_id, row.target_id); // 条件分支：按判断结果选择后续处理路径
        if (row.target_type === 'asset') deps.db.prepare("UPDATE paid_assets SET status = 'hidden' WHERE code = ? OR id = ?").run(row.target_id, row.target_id); // 条件分支：按判断结果选择后续处理路径
      } // 代码块结束
    }); // 代码块结束
    tx(); // 调用 tx 并处理其返回结果
    res.json({ ok: true, status: body.status }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
