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
  if (purpose === 'recharge') { // 条件分支：按判断结果选择后续处理路径
    if (!bodyAmount || bodyAmount < 100 || bodyAmount > 200000) throw new AppError('VALIDATION_FAILED', '充值金额需在 1–2000 元之间'); // 条件分支：按判断结果选择后续处理路径
    return bodyAmount; // 返回当前函数的处理结果
  } // 代码块结束
  if (purpose === 'asset') { // 条件分支：按判断结果选择后续处理路径
    const asset = deps.db.prepare("SELECT id, price_cents, vip_free FROM paid_assets WHERE code = ? AND status = 'published'").get(refId) as // 常量 asset：保存固定配置或一次性派生值
      | { id: string; price_cents: number; vip_free: number } // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (!asset) throw new AppError('NOT_FOUND', '资产不存在'); // 条件分支：按判断结果选择后续处理路径
    if (deps.db.prepare('SELECT 1 AS ok FROM asset_purchases WHERE user_id = ? AND asset_id = ?').get(userId, asset.id)) throw new AppError('CONFLICT', '已购买该资产'); // 条件分支：按判断结果选择后续处理路径
    return asset.price_cents; // 返回当前函数的处理结果
  } // 代码块结束
  if (purpose === 'vip') { // 条件分支：按判断结果选择后续处理路径
    const plan = deps.db.prepare('SELECT price_cents FROM vip_plans WHERE code = ? AND active = 1').get(refId) as { price_cents: number } | undefined; // 常量 plan：保存固定配置或一次性派生值
    if (!plan) throw new AppError('NOT_FOUND', 'VIP 套餐不存在'); // 条件分支：按判断结果选择后续处理路径
    return plan.price_cents; // 返回当前函数的处理结果
  } // 代码块结束
  const order = deps.db.prepare('SELECT user_id, status, payable_cents FROM shop_orders WHERE id = ?').get(refId) as // 常量 order：保存固定配置或一次性派生值
    | { user_id: string; status: string; payable_cents: number } // 执行当前业务步骤
    | undefined; // 执行当前业务步骤
  if (!order || order.user_id !== userId) throw new AppError('NOT_FOUND', '订单不存在'); // 条件分支：按判断结果选择后续处理路径
  if (order.status !== 'pending') throw new AppError('CONFLICT', '当前订单无需在线支付'); // 条件分支：按判断结果选择后续处理路径
  return order.payable_cents; // 返回当前函数的处理结果
} // 代码块结束

export function createPaymentsRouter(deps: ApiDeps): Router { // 导出函数 createPaymentsRouter：对外暴露的调用入口
  const router = Router(); // 常量 router：保存固定配置或一次性派生值

  /** 渠道状态：只回配置与否，不回密钥。 */
  router.get('/payments/channels', requireAuth, (_req, res) => {
    res.json({ channels: paymentChannels(deps.env) }); // 执行当前业务步骤
  }); // 代码块结束

  /** 创建支付意图。 */
  router.post('/payments/intents', requireAuth, idempotency, async (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const body = parse( // 常量 body：保存固定配置或一次性派生值
      z.object({ // 执行当前业务步骤
        purpose: z.enum(['shop_order', 'vip', 'asset', 'recharge']), // 对象字段 purpose：记录一项配置或数据
        ref_id: z.string().min(1).max(80), // 对象字段 ref_id：记录一项配置或数据
        provider: z.enum(['alipay', 'wechat', 'manual', 'sandbox']), // 对象字段 provider：记录一项配置或数据
        channel: z.enum(['qr', 'wap', 'app']).optional(), // 对象字段 channel：记录一项配置或数据
        amount_cents: z.number().int().min(0).max(200000).optional(), // 对象字段 amount_cents：记录一项配置或数据
      }), // 代码块结束
      req.body, // 执行当前业务步骤
    ); // 执行当前业务步骤
    if (!PROVIDERS.includes(body.provider)) throw new AppError('VALIDATION_FAILED', '不支持的支付渠道'); // 条件分支：按判断结果选择后续处理路径
    const amount = resolveAmount(deps, userId, body.purpose, body.ref_id, body.amount_cents); // 常量 amount：保存固定配置或一次性派生值
    if (amount <= 0) throw new AppError('VALIDATION_FAILED', '该对象无需支付'); // 条件分支：按判断结果选择后续处理路径
    const result = await createIntent(deps, { // 常量 result：保存固定配置或一次性派生值
      userId, // 执行当前业务步骤
      purpose: body.purpose, // 对象字段 purpose：记录一项配置或数据
      refId: body.ref_id, // 对象字段 refId：记录一项配置或数据
      provider: body.provider, // 对象字段 provider：记录一项配置或数据
      amountCents: amount, // 对象字段 amountCents：记录一项配置或数据
      channel: body.channel, // 对象字段 channel：记录一项配置或数据
    }); // 代码块结束
    res.status(201).json({ intent: result.intent, next: result.next, pay_url: 'pay_url' in result ? result.pay_url : undefined }); // 执行当前业务步骤
  }); // 代码块结束

  /** 查询支付意图：仅本人可见。 */
  router.get('/payments/intents/:id', requireAuth, (req, res) => {
    const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as PayIntentRow | undefined; // 常量 intent：保存固定配置或一次性派生值
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 条件分支：按判断结果选择后续处理路径
    res.json({ intent }); // 执行当前业务步骤
  }); // 代码块结束

  /** 取消未支付意图。 */
  router.post('/payments/intents/:id/cancel', requireAuth, idempotency, (req, res) => {
    const intent = deps.db.prepare('SELECT status FROM payment_intents WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as { status: string } | undefined; // 常量 intent：保存固定配置或一次性派生值
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 条件分支：按判断结果选择后续处理路径
    if (intent.status === 'paid') throw new AppError('CONFLICT', '已支付不可取消'); // 条件分支：按判断结果选择后续处理路径
    deps.db.prepare("UPDATE payment_intents SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(req.params.id); // 执行当前业务步骤
    res.json({ ok: true }); // 执行当前业务步骤
  }); // 代码块结束

  /** 线下转账确认：运营核对到账后手动履约。 */
  router.post('/payments/intents/:id/offline-confirm', requireAuth, requirePermission('commerce:write'), idempotency, (req, res) => {
    const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(req.params.id) as PayIntentRow | undefined; // 常量 intent：保存固定配置或一次性派生值
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 条件分支：按判断结果选择后续处理路径
    if (intent.provider !== 'manual') throw new AppError('VALIDATION_FAILED', '仅人工转账支付单可线下确认'); // 条件分支：按判断结果选择后续处理路径
    fulfillIntent(deps, intent, req.adminBootstrap ? 'admin-bootstrap' : req.user!.id); // 调用 fulfillIntent 并处理其返回结果
    res.json({ ok: true, status: 'paid' }); // 执行当前业务步骤
  }); // 代码块结束

  /** 微信支付回调：验签 + AES-GCM 解密 + 金额核对后履约；失败返回 FAIL 让微信重试。 */
  router.post('/payments/wechat/notify', (req, res) => {
    const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}); // 常量 rawBody：保存固定配置或一次性派生值
    const signatureOk = verifyWechatSignature( // 常量 signatureOk：保存固定配置或一次性派生值
      deps.env, // 执行当前业务步骤
      { // 执行当前业务步骤
        timestamp: req.header('wechatpay-timestamp') ?? undefined, // 对象字段 timestamp：记录一项配置或数据
        nonce: req.header('wechatpay-nonce') ?? undefined, // 对象字段 nonce：记录一项配置或数据
        signature: req.header('wechatpay-signature') ?? undefined, // 对象字段 signature：记录一项配置或数据
        serial: req.header('wechatpay-serial') ?? undefined, // 对象字段 serial：记录一项配置或数据
      }, // 代码块结束
      rawBody, // 执行当前业务步骤
    ); // 执行当前业务步骤
    if (!signatureOk) { // 条件分支：按判断结果选择后续处理路径
      res.status(401).json({ code: 'FAIL', message: '签名验证失败' }); // 执行当前业务步骤
      return; // 返回当前函数的处理结果
    } // 代码块结束
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const body = req.body as { // 常量 body：保存固定配置或一次性派生值
        resource?: { ciphertext: string; nonce: string; associated_data?: string; tag?: string }; // 执行当前业务步骤
      }; // 代码块结束
      if (!body.resource) throw new AppError('VALIDATION_FAILED', '回调缺少 resource'); // 条件分支：按判断结果选择后续处理路径
      const apiV3Key = deps.env.MIM_WECHAT_API_V3_KEY ?? ''; // 常量 apiV3Key：保存固定配置或一次性派生值
      const payload = decryptWechatResource(apiV3Key, body.resource) as { // 常量 payload：保存固定配置或一次性派生值
        out_trade_no?: string; // 执行当前业务步骤
        trade_state?: string; // 执行当前业务步骤
        transaction_id?: string; // 执行当前业务步骤
        amount?: { total?: number }; // 执行当前业务步骤
      }; // 代码块结束
      if (payload.trade_state !== 'SUCCESS' || !payload.out_trade_no) { // 条件分支：按判断结果选择后续处理路径
        res.json({ code: 'SUCCESS', message: '非成功状态已忽略' }); // 执行当前业务步骤
        return; // 返回当前函数的处理结果
      } // 代码块结束
      const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(payload.out_trade_no) as PayIntentRow | undefined; // 常量 intent：保存固定配置或一次性派生值
      if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 条件分支：按判断结果选择后续处理路径
      if (intent.provider !== 'wechat') throw new AppError('CONFLICT', '支付单渠道不匹配'); // 条件分支：按判断结果选择后续处理路径
      if (intent.amount_cents !== payload.amount?.total) throw new AppError('CONFLICT', '回调金额与支付单不一致'); // 条件分支：按判断结果选择后续处理路径
      fulfillIntent(deps, intent, `wechat-${payload.transaction_id ?? payload.out_trade_no}`); // 调用 fulfillIntent 并处理其返回结果
      res.json({ code: 'SUCCESS', message: '成功' }); // 执行当前业务步骤
    } catch (error) { // 代码块结束
      const message = error instanceof Error ? error.message : '回调处理失败'; // 常量 message：保存固定配置或一次性派生值
      res.status(400).json({ code: 'FAIL', message }); // 执行当前业务步骤
    } // 代码块结束
  }); // 代码块结束

  /** 沙箱回调：HMAC 验签通过才履约，未启用时 404。 */
  router.post('/payments/sandbox/notify', (req, res) => {
    if (deps.env.MIM_PAYMENT_SANDBOX !== '1') throw new AppError('NOT_FOUND', '沙箱支付未启用'); // 条件分支：按判断结果选择后续处理路径
    const body = parse(z.object({ intent_id: z.string().min(1), amount_cents: z.number().int().positive(), status: z.literal('paid') }), req.body); // 常量 body：保存固定配置或一次性派生值
    const signature = req.header('x-mim-signature') ?? ''; // 常量 signature：保存固定配置或一次性派生值
    const secret = deps.env.MIM_PAYMENT_SANDBOX_SECRET ?? ''; // 常量 secret：保存固定配置或一次性派生值
    if (!secret || !verifySandboxSignature(body.intent_id, body.amount_cents, body.status, signature, secret)) throw new AppError('FORBIDDEN', '沙箱回调验签失败'); // 条件分支：按判断结果选择后续处理路径
    const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(body.intent_id) as PayIntentRow | undefined; // 常量 intent：保存固定配置或一次性派生值
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 条件分支：按判断结果选择后续处理路径
    if (intent.amount_cents !== body.amount_cents) throw new AppError('CONFLICT', '回调金额与支付单不一致'); // 条件分支：按判断结果选择后续处理路径
    fulfillIntent(deps, intent, `sandbox-${body.intent_id}`); // 调用 fulfillIntent 并处理其返回结果
    res.json({ ok: true }); // 执行当前业务步骤
  }); // 代码块结束

  /** 运营视角：待处理支付单与汇总。 */
  router.get('/payments/admin/summary', requirePermission('commerce:write'), (_req, res) => {
    const pending = deps.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount FROM payment_intents WHERE status = 'pending'").get(); // 常量 pending：保存固定配置或一次性派生值
    const paid = deps.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount FROM payment_intents WHERE status = 'paid'").get(); // 常量 paid：保存固定配置或一次性派生值
    const recent = deps.db.prepare('SELECT id, user_id, purpose, ref_id, provider, amount_cents, status, created_at FROM payment_intents ORDER BY created_at DESC LIMIT 20').all(); // 常量 recent：保存固定配置或一次性派生值
    res.json({ pending, paid, recent }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
