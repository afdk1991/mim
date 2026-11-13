/** 付费资产路由：付费阅读 / 下载 / 图库 / 视频的浏览、解锁与分成 */

import { Router } from 'express'; // 路由容器
import { randomUUID } from 'node:crypto'; // 购买记录主键
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { idempotency, requireAuth } from '../middleware.js'; // 会话与写幂等
import { parse } from '../validate.js'; // 校验错误翻译
import { recordEarning } from '../payments.js'; // 作者分成记账
import { assertSafeOutboundUrl, auditText, auditImage } from '../security.js'; // 出站 SSRF 校验 + 内容审核钩子
import type { ApiDeps } from '../types.js'; // 依赖容器

const now = () => new Date().toISOString(); // UTC 时间

/** 解析资产媒体数组；历史行没有 media_json 或脏 JSON 时返回空数组，避免详情 500。 */
function parseMedia(raw: unknown): Array<{ kind: 'image' | 'video'; url: string; poster_url: string | null }> {
  if (typeof raw !== 'string' || !raw.trim()) return []; // 条件分支：按判断结果选择后续处理路径
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const parsed: unknown = JSON.parse(raw); // 资产路由：解析与鉴权
    if (!Array.isArray(parsed)) return []; // 条件分支：按判断结果选择后续处理路径
    return parsed // 返回当前函数的处理结果
      .filter((item): item is { kind: 'image' | 'video'; url: string; poster_url?: string | null } => { // 执行当前业务步骤
        if (!item || typeof item !== 'object') return false; // 条件分支：按判断结果选择后续处理路径
        const row = item as Record<string, unknown>; // 资产路由：解析与鉴权
        return (row.kind === 'image' || row.kind === 'video') && typeof row.url === 'string' && row.url.length > 0; // 返回当前函数的处理结果
      }) // 代码块结束
      .map((item) => ({ kind: item.kind, url: item.url, poster_url: typeof item.poster_url === 'string' ? item.poster_url : null })); // 执行当前业务步骤
  } catch { // 代码块结束
    return []; // 返回当前函数的处理结果
  } // 代码块结束
} // 代码块结束

/** 媒体地址校验：站内相对路径直接放行，http(s) 必须通过 SSRF 私网检查（协议白名单 + DNS 二次校验）。 */
async function assertMediaUrl(url: string): Promise<void> {
  if (/^\/(?!\/)/.test(url)) return; // 条件分支：按判断结果选择后续处理路径
  if (!/^https?:\/\//i.test(url)) throw new AppError('VALIDATION_FAILED', '媒体地址必须是站内路径或 http(s) 地址');
  try { // 异常捕获起点：包裹可能抛出错误的操作
    await assertSafeOutboundUrl(url); // 异步等待：挂起至 Promise 落定后再继续
  } catch { // 代码块结束
    throw new AppError('VALIDATION_FAILED', '媒体地址不允许指向内网或非法协议'); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
} // 代码块结束

/** 当前 VIP 等级：0 表示非会员。 */
function vipLevel(deps: ApiDeps, userId: string): number {
  const row = deps.db // 资产路由：解析与鉴权
    .prepare("SELECT level FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY level DESC LIMIT 1") // 执行当前业务步骤
    .get(userId, now()) as { level: number } | undefined; // 注册 GET 路由 / 中间件处理器
  return row?.level ?? 0; // 返回当前函数的处理结果
} // 代码块结束

/** 是否已购买某资产。 */
function purchased(deps: ApiDeps, userId: string, assetId: string): boolean {
  return !!deps.db.prepare('SELECT 1 AS ok FROM asset_purchases WHERE user_id = ? AND asset_id = ?').get(userId, assetId); // 返回当前函数的处理结果
} // 代码块结束

/** 资产是否可读：免费 / 已购 / VIP 免费资产 / 作者本人。 */
function hasAccess(deps: ApiDeps, userId: string, asset: { id: string; price_cents: number; vip_free: number; author_id: string | null }): boolean {
  if (asset.price_cents <= 0) return true; // 免费资产
  if (asset.author_id === userId) return true; // 作者可看自己的作品
  if (asset.vip_free === 1 && vipLevel(deps, userId) > 0) return true; // VIP 免费
  return purchased(deps, userId, asset.id); // 已购
} // 代码块结束

/** 钱包余额校验，不足时给出可识别原因。 */
function requireBalance(deps: ApiDeps, userId: string, amount: number): void {
  const wallet = deps.db.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as // 资产路由：解析与鉴权
    | { balance_cents: number; points: number } // 执行当前业务步骤
    | undefined; // 执行当前业务步骤
  const row = wallet ?? { balance_cents: 0, points: 100 }; // 资产路由：解析与鉴权
  if (!wallet) deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?)').run(userId, 0, 100, now()); // 条件分支：按判断结果选择后续处理路径
  if (row.balance_cents < amount) throw new AppError('VALIDATION_FAILED', '余额不足，请先充值或用卡密兑换', { reason: 'INSUFFICIENT_BALANCE', required_cents: amount, balance_cents: row.balance_cents }); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

/** 资产列表项：公开字段 + 当前用户是否已解锁。 */
function listItem(deps: ApiDeps, userId: string, row: Record<string, unknown> & { id: string; price_cents: number; vip_free: number; author_id: string | null }) {
  const access = hasAccess(deps, userId, row); // 资产路由：解析与鉴权
  return { // 返回当前函数的处理结果
    code: row.code, // 对象字段 code：记录一项配置或数据
    kind: row.kind, // 对象字段 kind：记录一项配置或数据
    title: row.title, // 对象字段 title：记录一项配置或数据
    summary: row.summary, // 对象字段 summary：记录一项配置或数据
    cover_url: row.cover_url, // 对象字段 cover_url：记录一项配置或数据
    price_cents: row.price_cents, // 对象字段 price_cents：记录一项配置或数据
    vip_free: row.vip_free === 1, // 对象字段 vip_free：记录一项配置或数据
    views: row.views, // 对象字段 views：记录一项配置或数据
    sales: row.sales, // 对象字段 sales：记录一项配置或数据
    updated_at: row.updated_at, // 对象字段 updated_at：记录一项配置或数据
    unlocked: access, // 对象字段 unlocked：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

export function createAssetsRouter(deps: ApiDeps): Router { // 导出函数 createAssetsRouter：对外暴露的调用入口
  const router = Router(); // 资产路由：解析与鉴权
  router.use('/assets', requireAuth); // 与社区一致：访客会话同样可用
  router.use('/assets', idempotency); // 购买写操作防重复扣款

  /** 资产列表：按类型 / 关键词过滤。 */
  router.get('/assets', (req, res) => { // 资产路由：解析与鉴权
    const userId = req.user!.id; // 资产路由：解析与鉴权
    const kind = typeof req.query.kind === 'string' && req.query.kind !== 'all' ? req.query.kind : ''; // 资产路由：解析与鉴权
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; // 资产路由：解析与鉴权
    const where = ["status = 'published'"]; // 资产路由：解析与鉴权
    const args: unknown[] = []; // 资产路由：解析与鉴权
    if (kind) { // 条件分支：按判断结果选择后续处理路径
      where.push('kind = ?'); // 执行当前业务步骤
      args.push(kind); // 执行当前业务步骤
    } // 代码块结束
    if (q) { // 条件分支：按判断结果选择后续处理路径
      where.push('(title LIKE ? OR summary LIKE ?)'); // 执行当前业务步骤
      args.push(`%${q}%`, `%${q}%`); // 执行当前业务步骤
    } // 代码块结束
    const rows = deps.db // 资产路由：解析与鉴权
      .prepare(`SELECT id, code, kind, title, summary, cover_url, price_cents, vip_free, author_id, views, sales, updated_at FROM paid_assets WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 60`) // 执行当前业务步骤
      .all(...args) as Array<Record<string, unknown> & { id: string; price_cents: number; vip_free: number; author_id: string | null }>; // 注册 ALL 路由 / 中间件处理器
    res.json({ items: rows.map((row) => listItem(deps, userId, row)), vip_level: vipLevel(deps, userId) }); // 执行当前业务步骤
  }); // 代码块结束

  /** 我的资产：已购买的资产清单。 */
  router.get('/assets/mine/list', (req, res) => { // 资产路由：解析与鉴权
    const userId = req.user!.id; // 资产路由：解析与鉴权
    const rows = deps.db // 资产路由：解析与鉴权
      .prepare( // 执行当前业务步骤
        `SELECT a.code, a.kind, a.title, a.summary, a.cover_url, a.file_url, p.amount_cents, p.created_at
         FROM asset_purchases p JOIN paid_assets a ON a.id = p.asset_id
         WHERE p.user_id = ? ORDER BY p.created_at DESC`,
      ) // 执行当前业务步骤
      .all(userId); // 注册 ALL 路由 / 中间件处理器
    res.json({ items: rows }); // 执行当前业务步骤
  }); // 代码块结束

  /** 资产详情：未解锁时只给摘要，正文与文件地址隐藏。 */
  router.get('/assets/:code', (req, res) => { // 资产路由：解析与鉴权
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const asset = deps.db.prepare("SELECT * FROM paid_assets WHERE code = ? AND status = 'published'").get(req.params.code) as // 常量 asset：保存固定配置或一次性派生值
      | (Record<string, unknown> & { id: string; body: string; file_url: string | null; price_cents: number; vip_free: number; author_id: string | null }) // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (!asset) throw new AppError('NOT_FOUND', '资产不存在或已下架'); // 条件分支：按判断结果选择后续处理路径
    deps.db.prepare('UPDATE paid_assets SET views = views + 1 WHERE id = ?').run(asset.id); // 执行当前业务步骤
    const access = hasAccess(deps, userId, asset); // 常量 access：保存固定配置或一次性派生值
    const preview = asset.kind === 'article' ? asset.body.slice(0, 220) : ''; // 阅读类给一段试读
    res.json({ // 执行当前业务步骤
      asset: { // 对象字段 asset：记录一项配置或数据
        code: asset.code, // 对象字段 code：记录一项配置或数据
        kind: asset.kind, // 对象字段 kind：记录一项配置或数据
        title: asset.title, // 对象字段 title：记录一项配置或数据
        summary: asset.summary, // 对象字段 summary：记录一项配置或数据
        cover_url: asset.cover_url, // 对象字段 cover_url：记录一项配置或数据
        price_cents: asset.price_cents, // 对象字段 price_cents：记录一项配置或数据
        vip_free: asset.vip_free === 1, // 对象字段 vip_free：记录一项配置或数据
        views: Number(asset.views) + 1, // 对象字段 views：记录一项配置或数据
        sales: asset.sales, // 对象字段 sales：记录一项配置或数据
        updated_at: asset.updated_at, // 对象字段 updated_at：记录一项配置或数据
        unlocked: access, // 对象字段 unlocked：记录一项配置或数据
        body: access ? asset.body : preview, // 对象字段 body：记录一项配置或数据
        file_url: access ? asset.file_url : null, // 对象字段 file_url：记录一项配置或数据
        media: access ? parseMedia(asset.media_json) : [], // 对象字段 media：记录一项配置或数据
      }, // 代码块结束
    }); // 代码块结束
  }); // 代码块结束

  /** 购买资产：余额支付；免费 / VIP 免费 / 已购直接成功。 */
  router.post('/assets/:code/purchase', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const asset = deps.db.prepare("SELECT * FROM paid_assets WHERE code = ? AND status = 'published'").get(req.params.code) as // 常量 asset：保存固定配置或一次性派生值
      | { id: string; code: string; price_cents: number; vip_free: number; author_id: string | null } // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (!asset) throw new AppError('NOT_FOUND', '资产不存在或已下架'); // 条件分支：按判断结果选择后续处理路径
    if (purchased(deps, userId, asset.id)) return res.json({ ok: true, charged_cents: 0, via: 'owned' }); // 条件分支：按判断结果选择后续处理路径
    let charge = asset.price_cents; // 可变变量 charge：运行过程中会被重新赋值
    let via: 'free' | 'vip' | 'balance' = 'balance'; // 可变变量 via：运行过程中会被重新赋值
    if (charge <= 0) { // 条件分支：按判断结果选择后续处理路径
      charge = 0; // 赋值：更新变量 charge 的取值
      via = 'free'; // 赋值：更新变量 via 的取值
    } else if (asset.vip_free === 1 && vipLevel(deps, userId) > 0) { // 代码块结束
      charge = 0; // 赋值：更新变量 charge 的取值
      via = 'vip'; // 赋值：更新变量 via 的取值
    } else { // 代码块结束
      requireBalance(deps, userId, charge); // 调用 requireBalance 并处理其返回结果
    } // 代码块结束
    const ts = now(); // 常量 ts：保存固定配置或一次性派生值
    const tx = deps.db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
      if (charge > 0) { // 条件分支：按判断结果选择后续处理路径
        deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = ? WHERE user_id = ?').run(charge, ts, userId); // 执行当前业务步骤
        deps.db // 执行当前业务步骤
          .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'consume', ?, 'asset', ?, ?, ?)") // 执行当前业务步骤
          .run(`wt-${randomUUID()}`, userId, -charge, asset.id, `购买资产 ${asset.code}`, ts); // 执行当前业务步骤
      } // 代码块结束
      deps.db // 执行当前业务步骤
        .prepare('INSERT INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)') // 执行当前业务步骤
        .run(`ap-${randomUUID()}`, userId, asset.id, charge, ts); // 执行当前业务步骤
      deps.db.prepare('UPDATE paid_assets SET sales = sales + 1 WHERE id = ?').run(asset.id); // 执行当前业务步骤
      recordEarning(deps, asset.author_id, 'asset', asset.id, charge); // 调用 recordEarning 并处理其返回结果
    }); // 代码块结束
    tx(); // 调用 tx 并处理其返回结果
    res.status(201).json({ ok: true, charged_cents: charge, via }); // 执行当前业务步骤
  }); // 代码块结束

  /** 作者发布资产：登录即可发布免费资源；付费资产需作者已开通（暂以登录代替）。 */
  router.post('/assets', async (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const body = parse( // 常量 body：保存固定配置或一次性派生值
      z.object({ // 执行当前业务步骤
        code: z.string().min(3).max(60), // 对象字段 code：记录一项配置或数据
        kind: z.enum(['article', 'download', 'gallery', 'video']), // 对象字段 kind：记录一项配置或数据
        title: z.string().min(1).max(120), // 对象字段 title：记录一项配置或数据
        summary: z.string().max(300).default(''), // 对象字段 summary：记录一项配置或数据
        body: z.string().max(20000).default(''), // 对象字段 body：记录一项配置或数据
        cover_url: z.string().max(300).optional(), // 对象字段 cover_url：记录一项配置或数据
        file_url: z.string().max(300).optional(), // 对象字段 file_url：记录一项配置或数据
        price_cents: z.number().int().min(0).max(1000000).default(0), // 对象字段 price_cents：记录一项配置或数据
        vip_free: z.boolean().default(false), // 对象字段 vip_free：记录一项配置或数据
        media: z.array(z.object({ kind: z.enum(['image', 'video']), url: z.string().min(1).max(500), poster_url: z.string().max(500).optional() })).max(30).default([]), // 对象字段 media：记录一项配置或数据
      }), // 代码块结束
      req.body, // 执行当前业务步骤
    ); // 执行当前业务步骤
    if (deps.db.prepare('SELECT 1 AS ok FROM paid_assets WHERE code = ?').get(body.code)) throw new AppError('CONFLICT', '资产编码已存在'); // 条件分支：按判断结果选择后续处理路径
    if (body.kind === 'gallery' && body.media.length === 0) throw new AppError('VALIDATION_FAILED', '图库至少需要一张图片'); // 条件分支：按判断结果选择后续处理路径
    if (body.kind === 'video' && body.media.length === 0 && !body.file_url) throw new AppError('VALIDATION_FAILED', '付费视频需要视频地址'); // 条件分支：按判断结果选择后续处理路径
    if (body.cover_url) await assertMediaUrl(body.cover_url); // 条件分支：按判断结果选择后续处理路径
    if (body.file_url && !/^\/(?!\/)/.test(body.file_url)) await assertMediaUrl(body.file_url); // 条件分支：按判断结果选择后续处理路径
    for (const item of body.media) { // 循环：逐项遍历集合并执行相同处理
      await assertMediaUrl(item.url); // 异步等待：挂起至 Promise 落定后再继续
      if (item.poster_url) await assertMediaUrl(item.poster_url); // 条件分支：按判断结果选择后续处理路径
    } // 代码块结束
    // 内容审核钩子：文本先过审；远程图片/封面再逐张过审。未配置密钥时 provider=none 放行，
    // 上游故障按 MIM_AUDIT_FALLBACK 决定 open 放行 / closed 拒绝。
    const textAudit = await auditText(deps.env, `${body.title}\n${body.summary}\n${body.body}`);
    if (!textAudit.ok) throw new AppError('VALIDATION_FAILED', textAudit.reason ?? '内容未通过审核'); // 条件分支：按判断结果选择后续处理路径
    const remoteImages = [ // 常量 remoteImages：保存固定配置或一次性派生值
      body.cover_url, // 执行当前业务步骤
      ...body.media.map((item) => item.url), // 执行当前业务步骤
      ...body.media.map((item) => item.poster_url), // 执行当前业务步骤
    ].filter((u): u is string => typeof u === 'string' && Boolean(u) && /^https?:/i.test(u)); // 执行当前业务步骤
    for (const imageUrl of remoteImages) { // 循环：逐项遍历集合并执行相同处理
      const imageAudit = await auditImage(deps.env, imageUrl); // 常量 imageAudit：保存固定配置或一次性派生值
      if (!imageAudit.ok) throw new AppError('VALIDATION_FAILED', imageAudit.reason ?? '图片未通过审核'); // 条件分支：按判断结果选择后续处理路径
    } // 代码块结束
    const mediaJson = JSON.stringify(body.media); // 常量 mediaJson：保存固定配置或一次性派生值
    const ts = now(); // 常量 ts：保存固定配置或一次性派生值
    deps.db // 执行当前业务步骤
      .prepare( // 执行当前业务步骤
        `INSERT INTO paid_assets (id, code, kind, title, summary, body, cover_url, file_url, media_json, price_cents, vip_free, author_id, status, views, sales, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 0, 0, ?, ?)`,
      ) // 执行当前业务步骤
      .run(`asset-${randomUUID()}`, body.code, body.kind, body.title, body.summary, body.body, body.cover_url ?? null, body.file_url ?? null, mediaJson, body.price_cents, body.vip_free ? 1 : 0, userId, ts, ts); // 执行当前业务步骤
    res.status(201).json({ ok: true, code: body.code }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
