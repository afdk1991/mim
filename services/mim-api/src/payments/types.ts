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
  id: string;
  user_id: string;
  purpose: PayPurpose;
  ref_id: string;
  provider: ExtChannelId;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  pay_url: string | null;
  qr_text: string | null;
  provider_txn_id: string | null;
  client_secret: string | null;
  expires_at: string | null;
  created_at: string;
  paid_at: string | null;
  refund_status: string | null;
  refunded_at: string | null;
}

/** 下单结果：跳转串 / 二维码内容 / 渠道订单号 / Stripe 客户端密钥 */
export interface OrderResult {
  next: 'qrcode' | 'redirect';
  qrText?: string;
  payUrl?: string;
  providerOrderId?: string;
  clientSecret?: string;
}

/** 标准化回调载荷：适配器把各家报文归一后交给路由统一校验履约 */
export interface NotifyPayload {
  intentId: string;
  amountCents: number;
  currency?: string;
  status: 'paid' | 'pending' | 'failed';
  providerTxnId: string;
  raw: unknown;
}

/** 退款上游请求描述（纯构造，便于单测签名而不打网络） */
export interface RefundRequest {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  body: string;
  contentType: 'application/json' | 'application/x-www-form-urlencoded';
}

/** 退款上游执行结果 */
export interface RefundOutcome {
  ok: boolean;
  providerRefundId?: string;
  raw: unknown;
}

/** 适配器统一能力契约：每个渠道都必须实现同一组能力 */
export interface ChannelAdapter {
  id: ExtChannelId;
  label: string;
  /** 回调成功后应答形态：聚合支付回纯文本 success，国际渠道回 JSON */
  ack: 'text-success' | 'json';
  /** 判断凭证是否齐全（configured）；不齐全时下单一律 503，不伪造成功 */
  configured(env: Record<string, string | undefined>): boolean;
  /** 是否运行在沙箱 / 测试环境 */
  sandbox(env: Record<string, string | undefined>): boolean;
  /** 下单签名 + 调用上游，返回跳转串 / 二维码；未配置抛 PROVIDER_NOT_CONFIGURED */
  createOrder(
    env: Record<string, string | undefined>,
    intent: ExtIntentRow,
    opts: { channel?: 'qr' | 'wap' | 'page' | 'app' },
  ): Promise<OrderResult>;
  /** 回调验签 + 报文归一；验签失败抛 FORBIDDEN，报文缺字段抛 VALIDATION_FAILED */
  parseNotify(
    env: Record<string, string | undefined>,
    headers: Record<string, string | undefined>,
    rawBody: string,
    body: unknown,
  ): Promise<NotifyPayload>;
  /** 构造退款上游请求（签名在此完成） */
  buildRefundRequest(
    env: Record<string, string | undefined>,
    intent: ExtIntentRow,
    amountCents: number,
    reason: string,
  ): RefundRequest;
  /** 执行退款调用 */
  executeRefund(env: Record<string, string | undefined>, request: RefundRequest): Promise<RefundOutcome>;
}
