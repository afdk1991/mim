/** 扩展支付渠道：统一适配器契约与共享类型 */

import type { PayPurpose } from '../payments.js'; // 复用既有四类支付目的

/** 既有四渠道（主库 payment_intents） */
export type LegacyChannelId = 'alipay' | 'wechat' | 'manual' | 'sandbox';

/** 本包新增的五渠道（落 payment_ext_intents） */
export type ExtChannelId = 'hupijiao' | 'xunhu' | 'paypal' | 'stripe' | 'alipay_ent';

/** 九渠道矩阵全集 */
export type AnyChannelId = LegacyChannelId | ExtChannelId;

/** 扩展渠道意图行（对应 payment_ext_intents 表） */
export interface ExtIntentRow {
  id: string; // 对象字段 id：记录一项配置或数据
  user_id: string; // 对象字段 user_id：记录一项配置或数据
  purpose: PayPurpose; // 对象字段 purpose：记录一项配置或数据
  ref_id: string; // 对象字段 ref_id：记录一项配置或数据
  provider: ExtChannelId; // 对象字段 provider：记录一项配置或数据
  amount_cents: number; // 对象字段 amount_cents：记录一项配置或数据
  currency: string; // 对象字段 currency：记录一项配置或数据
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'; // 对象字段 status：记录一项配置或数据
  pay_url: string | null; // 对象字段 pay_url：记录一项配置或数据
  qr_text: string | null; // 对象字段 qr_text：记录一项配置或数据
  provider_txn_id: string | null; // 对象字段 provider_txn_id：记录一项配置或数据
  client_secret: string | null; // 对象字段 client_secret：记录一项配置或数据
  expires_at: string | null; // 对象字段 expires_at：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  paid_at: string | null; // 对象字段 paid_at：记录一项配置或数据
  refund_status: string | null; // 对象字段 refund_status：记录一项配置或数据
  refunded_at: string | null; // 对象字段 refunded_at：记录一项配置或数据
} // 代码块结束

/** 下单结果：跳转串 / 二维码内容 / 渠道订单号 / Stripe 客户端密钥 */
export interface OrderResult {
  next: 'qrcode' | 'redirect'; // 对象字段 next：记录一项配置或数据
  qrText?: string; // 执行当前业务步骤
  payUrl?: string; // 执行当前业务步骤
  providerOrderId?: string; // 执行当前业务步骤
  clientSecret?: string; // 执行当前业务步骤
} // 代码块结束

/** 标准化回调载荷：适配器把各家报文归一后交给路由统一校验履约 */
export interface NotifyPayload {
  intentId: string; // 对象字段 intentId：记录一项配置或数据
  amountCents: number; // 对象字段 amountCents：记录一项配置或数据
  currency?: string; // 执行当前业务步骤
  status: 'paid' | 'pending' | 'failed'; // 对象字段 status：记录一项配置或数据
  providerTxnId: string; // 对象字段 providerTxnId：记录一项配置或数据
  raw: unknown; // 对象字段 raw：记录一项配置或数据
} // 代码块结束

/** 退款上游请求描述（纯构造，便于单测签名而不打网络） */
export interface RefundRequest {
  method: 'POST'; // 对象字段 method：记录一项配置或数据
  url: string; // 对象字段 url：记录一项配置或数据
  headers: Record<string, string>; // 对象字段 headers：记录一项配置或数据
  body: string; // 对象字段 body：记录一项配置或数据
  contentType: 'application/json' | 'application/x-www-form-urlencoded'; // 对象字段 contentType：记录一项配置或数据
} // 代码块结束

/** 退款上游执行结果 */
export interface RefundOutcome {
  ok: boolean; // 对象字段 ok：记录一项配置或数据
  providerRefundId?: string; // 执行当前业务步骤
  raw: unknown; // 对象字段 raw：记录一项配置或数据
} // 代码块结束

/** 适配器统一能力契约：每个渠道都必须实现同一组能力 */
export interface ChannelAdapter {
  id: ExtChannelId; // 对象字段 id：记录一项配置或数据
  label: string; // 对象字段 label：记录一项配置或数据
  /** 回调成功后应答形态：聚合支付回纯文本 success，国际渠道回 JSON */
  ack: 'text-success' | 'json';
  /** 判断凭证是否齐全（configured）；不齐全时下单一律 503，不伪造成功 */
  configured(env: Record<string, string | undefined>): boolean;
  /** 是否运行在沙箱 / 测试环境 */
  sandbox(env: Record<string, string | undefined>): boolean;
  /** 下单签名 + 调用上游，返回跳转串 / 二维码；未配置抛 PROVIDER_NOT_CONFIGURED */
  createOrder(
    env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
    intent: ExtIntentRow, // 对象字段 intent：记录一项配置或数据
    opts: { channel?: 'qr' | 'wap' | 'page' | 'app' }, // 对象字段 opts：记录一项配置或数据
  ): Promise<OrderResult>; // 执行当前业务步骤
  /** 回调验签 + 报文归一；验签失败抛 FORBIDDEN，报文缺字段抛 VALIDATION_FAILED */
  parseNotify(
    env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
    headers: Record<string, string | undefined>, // 对象字段 headers：记录一项配置或数据
    rawBody: string, // 对象字段 rawBody：记录一项配置或数据
    body: unknown, // 对象字段 body：记录一项配置或数据
  ): Promise<NotifyPayload>; // 执行当前业务步骤
  /** 构造退款上游请求（签名在此完成） */
  buildRefundRequest(
    env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
    intent: ExtIntentRow, // 对象字段 intent：记录一项配置或数据
    amountCents: number, // 对象字段 amountCents：记录一项配置或数据
    reason: string, // 对象字段 reason：记录一项配置或数据
  ): RefundRequest; // 执行当前业务步骤
  /** 执行退款调用 */
  executeRefund(env: Record<string, string | undefined>, request: RefundRequest): Promise<RefundOutcome>;
} // 代码块结束
