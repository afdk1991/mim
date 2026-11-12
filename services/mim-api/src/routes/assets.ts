/** 付费资产路由：付费阅读 / 下载 / 图库 / 视频的浏览、解锁与分成 */

import { Router } from 'express'; // 路由容器
import { randomUUID } from 'node:crypto'; // 购买记录主键
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { idempotency, requireAuth } from '../middleware.js'; // 会话与写幂等
import { parse } from '../validate.js'; // 校验错误翻译
import { recordEarning } from '../payments.js'; // 作者分成记账
import { assertPublicHttpUrl } from '../security.js'; // 媒体地址 SSRF 校验
import type { ApiDeps } from '../types.js'; // 依赖容器

const now = () => new Date().toISOString(); // UTC 时间

/** 解析资产媒体数组；历史行没有 media_json 或脏 JSON 时返回空数组，避免详情 500。 */
function parseMedia(raw: unknown): Array<{ kind: 'image' | 'video'; url: string; poster_url: string | null }> {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw); // 资产路由：解析与鉴权
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { kind: 'image' | 'video'; url: string; poster_url?: string | null } => {
        if (!item || typeof item !== 'object') return false;
        const row = item as Record<string, unknown>; // 资产路由：解析与鉴权
        return (row.kind === 'image' || row.kind === 'video') && typeof row.url === 'string' && row.url.length > 0;
      })
      .map((item) => ({ kind: item.kind, url: item.url, poster_url: typeof item.poster_url === 'string' ? item.poster_url : null }));
  } catch {
    return [];
  }
}

/** 媒体地址校验：站内相对路径直接放行，http(s) 必须通过 SSRF 私网检查。 */
async function assertMediaUrl(url: string): Promise<void> {
  if (/^\/(?!\/)/.test(url)) return;
  if (!/^https?:\/\//i.test(url)) throw new AppError('VALIDATION_FAILED', '媒体地址必须是站内路径或 http(s) 地址');
  try {
    await assertPublicHttpUrl(url);
  } catch {
    throw new AppError('VALIDATION_FAILED', '媒体地址不允许指向内网或非法协议');
  }
}

/** 当前 VIP 等级：0 表示非会员。 */
function vipLevel(deps: ApiDeps, userId: string): number {
  const row = deps.db // 资产路由：解析与鉴权
    .prepare("SELECT level FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY level DESC LIMIT 1")
    .get(userId, now()) as { level: number } | undefined;
  return row?.level ?? 0;
}

/** 是否已购买某资产。 */
function purchased(deps: ApiDeps, userId: string, assetId: string): boolean {
  return !!deps.db.prepare('SELECT 1 AS ok FROM asset_purchases WHERE user_id = ? AND asset_id = ?').get(userId, assetId);
}

/** 资产是否可读：免费 / 已购 / VIP 免费资产 / 作者本人。 */
function hasAccess(deps: ApiDeps, userId: string, asset: { id: string; price_cents: number; vip_free: number; author_id: string | null }): boolean {
  if (asset.price_cents <= 0) return true; // 免费资产
  if (asset.author_id === userId) return true; // 作者可看自己的作品
  if (asset.vip_free === 1 && vipLevel(deps, userId) > 0) return true; // VIP 免费
  return purchased(deps, userId, asset.id); // 已购
}

/** 钱包余额校验，不足时给出可识别原因。 */
function requireBalance(deps: ApiDeps, userId: string, amount: number): void {
  const wallet = deps.db.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as // 资产路由：解析与鉴权
    | { balance_cents: number; points: number }
    | undefined;
  const row = wallet ?? { balance_cents: 0, points: 100 }; // 资产路由：解析与鉴权
  if (!wallet) deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?)').run(userId, 0, 100, now());
  if (row.balance_cents < amount) throw new AppError('VALIDATION_FAILED', '余额不足，请先充值或用卡密兑换', { reason: 'INSUFFICIENT_BALANCE', required_cents: amount, balance_cents: row.balance_cents });
}

/** 资产列表项：公开字段 + 当前用户是否已解锁。 */
function listItem(deps: ApiDeps, userId: string, row: Record<string, unknown> & { id: string; price_cents: number; vip_free: number; author_id: string | null }) {
  const access = hasAccess(deps, userId, row); // 资产路由：解析与鉴权
  return {
    code: row.code,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    cover_url: row.cover_url,
    price_cents: row.price_cents,
    vip_free: row.vip_free === 1,
    views: row.views,
    sales: row.sales,
    updated_at: row.updated_at,
    unlocked: access,
  };
}

export function createAssetsRouter(deps: ApiDeps): Router {
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
    if (kind) {
      where.push('kind = ?');
      args.push(kind);
    }
    if (q) {
      where.push('(title LIKE ? OR summary LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const rows = deps.db // 资产路由：解析与鉴权
      .prepare(`SELECT id, code, kind, title, summary, cover_url, price_cents, vip_free, author_id, views, sales, updated_at FROM paid_assets WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 60`)
      .all(...args) as Array<Record<string, unknown> & { id: string; price_cents: number; vip_free: number; author_id: string | null }>;
    res.json({ items: rows.map((row) => listItem(deps, userId, row)), vip_level: vipLevel(deps, userId) });
  });

  /** 我的资产：已购买的资产清单。 */
  router.get('/assets/mine/list', (req, res) => { // 资产路由：解析与鉴权
    const userId = req.user!.id; // 资产路由：解析与鉴权
    const rows = deps.db // 资产路由：解析与鉴权
      .prepare(
        `SELECT a.code, a.kind, a.title, a.summary, a.cover_url, a.file_url, p.amount_cents, p.created_at
         FROM asset_purchases p JOIN paid_assets a ON a.id = p.asset_id
         WHERE p.user_id = ? ORDER BY p.created_at DESC`,
      )
      .all(userId);
    res.json({ items: rows });
  });

  /** 资产详情：未解锁时只给摘要，正文与文件地址隐藏。 */
  router.get('/assets/:code', (req, res) => { // 资产路由：解析与鉴权
    const userId = req.user!.id;
    const asset = deps.db.prepare("SELECT * FROM paid_assets WHERE code = ? AND status = 'published'").get(req.params.code) as
      | (Record<string, unknown> & { id: string; body: string; file_url: string | null; price_cents: number; vip_free: number; author_id: string | null })
      | undefined;
    if (!asset) throw new AppError('NOT_FOUND', '资产不存在或已下架');
    deps.db.prepare('UPDATE paid_assets SET views = views + 1 WHERE id = ?').run(asset.id);
    const access = hasAccess(deps, userId, asset);
    const preview = asset.kind === 'article' ? asset.body.slice(0, 220) : ''; // 阅读类给一段试读
    res.json({
      asset: {
        code: asset.code,
        kind: asset.kind,
        title: asset.title,
        summary: asset.summary,
        cover_url: asset.cover_url,
        price_cents: asset.price_cents,
        vip_free: asset.vip_free === 1,
        views: Number(asset.views) + 1,
        sales: asset.sales,
        updated_at: asset.updated_at,
        unlocked: access,
        body: access ? asset.body : preview,
        file_url: access ? asset.file_url : null,
        media: access ? parseMedia(asset.media_json) : [],
      },
    });
  });

  /** 购买资产：余额支付；免费 / VIP 免费 / 已购直接成功。 */
  router.post('/assets/:code/purchase', (req, res) => {
    const userId = req.user!.id;
    const asset = deps.db.prepare("SELECT * FROM paid_assets WHERE code = ? AND status = 'published'").get(req.params.code) as
      | { id: string; code: string; price_cents: number; vip_free: number; author_id: string | null }
      | undefined;
    if (!asset) throw new AppError('NOT_FOUND', '资产不存在或已下架');
    if (purchased(deps, userId, asset.id)) return res.json({ ok: true, charged_cents: 0, via: 'owned' });
    let charge = asset.price_cents;
    let via: 'free' | 'vip' | 'balance' = 'balance';
    if (charge <= 0) {
      charge = 0;
      via = 'free';
    } else if (asset.vip_free === 1 && vipLevel(deps, userId) > 0) {
      charge = 0;
      via = 'vip';
    } else {
      requireBalance(deps, userId, charge);
    }
    const ts = now();
    const tx = deps.db.transaction(() => {
      if (charge > 0) {
        deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = ? WHERE user_id = ?').run(charge, ts, userId);
        deps.db
          .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'consume', ?, 'asset', ?, ?, ?)")
          .run(`wt-${randomUUID()}`, userId, -charge, asset.id, `购买资产 ${asset.code}`, ts);
      }
      deps.db
        .prepare('INSERT INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`ap-${randomUUID()}`, userId, asset.id, charge, ts);
      deps.db.prepare('UPDATE paid_assets SET sales = sales + 1 WHERE id = ?').run(asset.id);
      recordEarning(deps, asset.author_id, 'asset', asset.id, charge);
    });
    tx();
    res.status(201).json({ ok: true, charged_cents: charge, via });
  });

  /** 作者发布资产：登录即可发布免费资源；付费资产需作者已开通（暂以登录代替）。 */
  router.post('/assets', async (req, res) => {
    const userId = req.user!.id;
    const body = parse(
      z.object({
        code: z.string().min(3).max(60),
        kind: z.enum(['article', 'download', 'gallery', 'video']),
        title: z.string().min(1).max(120),
        summary: z.string().max(300).default(''),
        body: z.string().max(20000).default(''),
        cover_url: z.string().max(300).optional(),
        file_url: z.string().max(300).optional(),
        price_cents: z.number().int().min(0).max(1000000).default(0),
        vip_free: z.boolean().default(false),
        media: z.array(z.object({ kind: z.enum(['image', 'video']), url: z.string().min(1).max(500), poster_url: z.string().max(500).optional() })).max(30).default([]),
      }),
      req.body,
    );
    if (deps.db.prepare('SELECT 1 AS ok FROM paid_assets WHERE code = ?').get(body.code)) throw new AppError('CONFLICT', '资产编码已存在');
    if (body.kind === 'gallery' && body.media.length === 0) throw new AppError('VALIDATION_FAILED', '图库至少需要一张图片');
    if (body.kind === 'video' && body.media.length === 0 && !body.file_url) throw new AppError('VALIDATION_FAILED', '付费视频需要视频地址');
    if (body.cover_url) await assertMediaUrl(body.cover_url);
    if (body.file_url && !/^\/(?!\/)/.test(body.file_url)) await assertMediaUrl(body.file_url);
    for (const item of body.media) {
      await assertMediaUrl(item.url);
      if (item.poster_url) await assertMediaUrl(item.poster_url);
    }
    const mediaJson = JSON.stringify(body.media);
    const ts = now();
    deps.db
      .prepare(
        `INSERT INTO paid_assets (id, code, kind, title, summary, body, cover_url, file_url, media_json, price_cents, vip_free, author_id, status, views, sales, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 0, 0, ?, ?)`,
      )
      .run(`asset-${randomUUID()}`, body.code, body.kind, body.title, body.summary, body.body, body.cover_url ?? null, body.file_url ?? null, mediaJson, body.price_cents, body.vip_free ? 1 : 0, userId, ts, ts);
    res.status(201).json({ ok: true, code: body.code });
  });

  return router;
}
