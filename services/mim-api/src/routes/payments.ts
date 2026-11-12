/** 支付路由：渠道状态、支付意图、回调验签与线下确认 */

import { Router } from 'express'; // 路由容器
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 会话、幂等与运营权限
import { parse } from '../validate.js'; // 校验错误翻译
import { createIntent, decryptWechatResource, fulfillIntent, paymentChannels, verifySandboxSignature, verifyWechatSignature, type PayIntentRow, type PayProvider } from '../payments.js'; // 支付内核
import type { ApiDeps } from '../types.js'; // 依赖容器

const PROVIDERS: PayProvider[] = ['alipay', 'wechat', 'manual', 'sandbox']; // 可用渠道白名单

/** 计算支付金额：一律以服务端商品 / 订单价格为准，不接受前端传金额。 */
function resolveAmount(deps: ApiDeps, userId: string, purpose: string, refId: string, bodyAmount?: number): number {
  if (purpose === 'recharge') {
    if (!bodyAmount || bodyAmount < 100 || bodyAmount > 200000) throw new AppError('VALIDATION_FAILED', '充值金额需在 1–2000 元之间');
    return bodyAmount;
  }
  if (purpose === 'asset') {
    const asset = deps.db.prepare("SELECT id, price_cents, vip_free FROM paid_assets WHERE code = ? AND status = 'published'").get(refId) as
      | { id: string; price_cents: number; vip_free: number }
      | undefined;
    if (!asset) throw new AppError('NOT_FOUND', '资产不存在');
    if (deps.db.prepare('SELECT 1 AS ok FROM asset_purchases WHERE user_id = ? AND asset_id = ?').get(userId, asset.id)) throw new AppError('CONFLICT', '已购买该资产');
    return asset.price_cents;
  }
  if (purpose === 'vip') {
    const plan = deps.db.prepare('SELECT price_cents FROM vip_plans WHERE code = ? AND active = 1').get(refId) as { price_cents: number } | undefined;
    if (!plan) throw new AppError('NOT_FOUND', 'VIP 套餐不存在');
    return plan.price_cents;
  }
  const order = deps.db.prepare('SELECT user_id, status, payable_cents FROM shop_orders WHERE id = ?').get(refId) as
    | { user_id: string; status: string; payable_cents: number }
    | undefined;
  if (!order || order.user_id !== userId) throw new AppError('NOT_FOUND', '订单不存在');
  if (order.status !== 'pending') throw new AppError('CONFLICT', '当前订单无需在线支付');
  return order.payable_cents;
}

export function createPaymentsRouter(deps: ApiDeps): Router {
  const router = Router();

  /** 渠道状态：只回配置与否，不回密钥。 */
  router.get('/payments/channels', requireAuth, (_req, res) => {
    res.json({ channels: paymentChannels(deps.env) });
  });

  /** 创建支付意图。 */
  router.post('/payments/intents', requireAuth, idempotency, async (req, res) => {
    const userId = req.user!.id;
    const body = parse(
      z.object({
        purpose: z.enum(['shop_order', 'vip', 'asset', 'recharge']),
        ref_id: z.string().min(1).max(80),
        provider: z.enum(['alipay', 'wechat', 'manual', 'sandbox']),
        channel: z.enum(['qr', 'wap', 'app']).optional(),
        amount_cents: z.number().int().min(0).max(200000).optional(),
      }),
      req.body,
    );
    if (!PROVIDERS.includes(body.provider)) throw new AppError('VALIDATION_FAILED', '不支持的支付渠道');
    const amount = resolveAmount(deps, userId, body.purpose, body.ref_id, body.amount_cents);
    if (amount <= 0) throw new AppError('VALIDATION_FAILED', '该对象无需支付');
    const result = await createIntent(deps, {
      userId,
      purpose: body.purpose,
      refId: body.ref_id,
      provider: body.provider,
      amountCents: amount,
      channel: body.channel,
    });
    res.status(201).json({ intent: result.intent, next: result.next, pay_url: 'pay_url' in result ? result.pay_url : undefined });
  });

  /** 查询支付意图：仅本人可见。 */
  router.get('/payments/intents/:id', requireAuth, (req, res) => {
    const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as PayIntentRow | undefined;
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在');
    res.json({ intent });
  });

  /** 取消未支付意图。 */
  router.post('/payments/intents/:id/cancel', requireAuth, idempotency, (req, res) => {
    const intent = deps.db.prepare('SELECT status FROM payment_intents WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as { status: string } | undefined;
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在');
    if (intent.status === 'paid') throw new AppError('CONFLICT', '已支付不可取消');
    deps.db.prepare("UPDATE payment_intents SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(req.params.id);
    res.json({ ok: true });
  });

  /** 线下转账确认：运营核对到账后手动履约。 */
  router.post('/payments/intents/:id/offline-confirm', requireAuth, requirePermission('commerce:write'), idempotency, (req, res) => {
    const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(req.params.id) as PayIntentRow | undefined;
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在');
    if (intent.provider !== 'manual') throw new AppError('VALIDATION_FAILED', '仅人工转账支付单可线下确认');
    fulfillIntent(deps, intent, req.adminBootstrap ? 'admin-bootstrap' : req.user!.id);
    res.json({ ok: true, status: 'paid' });
  });

  /** 微信支付回调：验签 + AES-GCM 解密 + 金额核对后履约；失败返回 FAIL 让微信重试。 */
  router.post('/payments/wechat/notify', (req, res) => {
    const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const signatureOk = verifyWechatSignature(
      deps.env,
      {
        timestamp: req.header('wechatpay-timestamp') ?? undefined,
        nonce: req.header('wechatpay-nonce') ?? undefined,
        signature: req.header('wechatpay-signature') ?? undefined,
        serial: req.header('wechatpay-serial') ?? undefined,
      },
      rawBody,
    );
    if (!signatureOk) {
      res.status(401).json({ code: 'FAIL', message: '签名验证失败' });
      return;
    }
    try {
      const body = req.body as {
        resource?: { ciphertext: string; nonce: string; associated_data?: string; tag?: string };
      };
      if (!body.resource) throw new AppError('VALIDATION_FAILED', '回调缺少 resource');
      const apiV3Key = deps.env.MIM_WECHAT_API_V3_KEY ?? '';
      const payload = decryptWechatResource(apiV3Key, body.resource) as {
        out_trade_no?: string;
        trade_state?: string;
        transaction_id?: string;
        amount?: { total?: number };
      };
      if (payload.trade_state !== 'SUCCESS' || !payload.out_trade_no) {
        res.json({ code: 'SUCCESS', message: '非成功状态已忽略' });
        return;
      }
      const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(payload.out_trade_no) as PayIntentRow | undefined;
      if (!intent) throw new AppError('NOT_FOUND', '支付单不存在');
      if (intent.provider !== 'wechat') throw new AppError('CONFLICT', '支付单渠道不匹配');
      if (intent.amount_cents !== payload.amount?.total) throw new AppError('CONFLICT', '回调金额与支付单不一致');
      fulfillIntent(deps, intent, `wechat-${payload.transaction_id ?? payload.out_trade_no}`);
      res.json({ code: 'SUCCESS', message: '成功' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '回调处理失败';
      res.status(400).json({ code: 'FAIL', message });
    }
  });

  /** 沙箱回调：HMAC 验签通过才履约，未启用时 404。 */
  router.post('/payments/sandbox/notify', (req, res) => {
    if (deps.env.MIM_PAYMENT_SANDBOX !== '1') throw new AppError('NOT_FOUND', '沙箱支付未启用');
    const body = parse(z.object({ intent_id: z.string().min(1), amount_cents: z.number().int().positive(), status: z.literal('paid') }), req.body);
    const signature = req.header('x-mim-signature') ?? '';
    const secret = deps.env.MIM_PAYMENT_SANDBOX_SECRET ?? '';
    if (!secret || !verifySandboxSignature(body.intent_id, body.amount_cents, body.status, signature, secret)) throw new AppError('FORBIDDEN', '沙箱回调验签失败');
    const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(body.intent_id) as PayIntentRow | undefined;
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在');
    if (intent.amount_cents !== body.amount_cents) throw new AppError('CONFLICT', '回调金额与支付单不一致');
    fulfillIntent(deps, intent, `sandbox-${body.intent_id}`);
    res.json({ ok: true });
  });

  /** 运营视角：待处理支付单与汇总。 */
  router.get('/payments/admin/summary', requirePermission('commerce:write'), (_req, res) => {
    const pending = deps.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount FROM payment_intents WHERE status = 'pending'").get();
    const paid = deps.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount FROM payment_intents WHERE status = 'paid'").get();
    const recent = deps.db.prepare('SELECT id, user_id, purpose, ref_id, provider, amount_cents, status, created_at FROM payment_intents ORDER BY created_at DESC LIMIT 20').all();
    res.json({ pending, paid, recent });
  });

  return router;
}
