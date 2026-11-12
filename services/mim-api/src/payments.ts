/** 支付适配层：渠道注册、下单、回调验签与履约分账 */

import { createDecipheriv, createHmac, randomBytes, randomUUID, sign, verify } from 'node:crypto'; // 沙箱 HMAC、支付宝/微信 RSA 签名与微信回调解密
import { AppError } from '@mim/core-domain'; // 统一业务异常
import type { ApiDeps } from './types.js'; // 依赖容器

export type PayProvider = 'alipay' | 'wechat' | 'manual' | 'sandbox'; // 四类渠道
export type PayPurpose = 'shop_order' | 'vip' | 'asset' | 'recharge'; // 四类支付目的

export interface PayIntentRow {
  id: string;
  user_id: string;
  purpose: PayPurpose;
  ref_id: string;
  provider: PayProvider;
  amount_cents: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  pay_url: string | null;
  qr_text: string | null;
  provider_txn_id: string | null;
  expires_at: string | null;
  created_at: string;
  paid_at: string | null;
}

const now = (deps: ApiDeps) => deps.now?.() ?? new Date().toISOString(); // 可注入时钟

/** 渠道元数据：前端据此置灰与展示说明，不暴露任何密钥。 */
export function paymentChannels(env: Record<string, string | undefined>) {
  const hasAlipay = !!(env.MIM_ALIPAY_APP_ID && env.MIM_ALIPAY_PRIVATE_KEY); // 应用 ID + 应用私钥
  const hasWechat = !!(
    env.MIM_WECHAT_APP_ID &&
    env.MIM_WECHAT_MCH_ID &&
    env.MIM_WECHAT_API_V3_KEY &&
    env.MIM_WECHAT_SERIAL_NO &&
    env.MIM_WECHAT_PRIVATE_KEY &&
    env.MIM_WECHAT_NOTIFY_URL &&
    env.MIM_WECHAT_PLATFORM_PUBLIC_KEY
  ); // AppID + 商户号 + APIv3 + 证书序列号 + 私钥 + 回调 + 平台公钥
  return [
    { id: 'manual', label: '人工转账 / 线下收款', configured: true, note: '展示收款说明，运营确认后到账' },
    { id: 'alipay', label: '支付宝当面付', configured: hasAlipay, note: hasAlipay ? '已配置，可生成扫码订单' : '缺 MIM_ALIPAY_APP_ID / MIM_ALIPAY_PRIVATE_KEY' },
    { id: 'wechat', label: '微信企业支付（Native）', configured: hasWechat, note: hasWechat ? '已配置，可生成扫码订单并接收回调' : '缺 AppID / 商户号 / APIv3 密钥 / 证书私钥 / 回调地址 / 平台公钥' },
    { id: 'sandbox', label: '沙箱支付（仅测试）', configured: env.MIM_PAYMENT_SANDBOX === '1', note: '仅当 MIM_PAYMENT_SANDBOX=1 时可用' },
  ];
}

/** 支付宝 RSA2 签名：把参数按字典序拼接后签名，返回完整表单参数。 */
function alipaySignedParams(env: Record<string, string | undefined>, method: string, bizContent: string): Record<string, string> {
  const params: Record<string, string> = {
    app_id: env.MIM_ALIPAY_APP_ID ?? '',
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    version: '1.0',
    notify_url: env.MIM_ALIPAY_NOTIFY_URL ?? '',
    biz_content: bizContent,
  };
  const unsigned = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const privateKey = (env.MIM_ALIPAY_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  params.sign = sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64');
  return params;
}

/** 支付宝当面付预下单：返回二维码内容；网络失败按上游错误透出。 */
async function createAlipay(env: Record<string, string | undefined>, intent: PayIntentRow): Promise<{ qrText: string }> {
  if (!env.MIM_ALIPAY_APP_ID || !env.MIM_ALIPAY_PRIVATE_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', '支付宝渠道未配置');
  const biz = JSON.stringify({ out_trade_no: intent.id, total_amount: (intent.amount_cents / 100).toFixed(2), subject: `Mim 订单 ${intent.id}` });
  const params = alipaySignedParams(env, 'alipay.trade.precreate', biz);
  const res = await fetch('https://openapi.alipay.com/gateway.do', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params),
  });
  const json = (await res.json()) as { alipay_trade_precreate_response?: { code?: string; msg?: string; qr_code?: string } };
  const body = json.alipay_trade_precreate_response;
  if (!res.ok || !body || body.code !== '10000' || !body.qr_code) throw new AppError('INTERNAL_ERROR', body?.msg ?? '支付宝下单失败');
  return { qrText: body.qr_code };
}

/** 支付宝手机网站支付：返回可直接跳转的网关地址，供移动端唤起支付宝。 */
function createAlipayWap(env: Record<string, string | undefined>, intent: PayIntentRow): { payUrl: string } {
  if (!env.MIM_ALIPAY_APP_ID || !env.MIM_ALIPAY_PRIVATE_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', '支付宝渠道未配置');
  const biz = JSON.stringify({
    out_trade_no: intent.id,
    total_amount: (intent.amount_cents / 100).toFixed(2),
    subject: `Mim 订单 ${intent.id}`,
    product_code: 'QUICK_WAP_WAY',
  });
  const params = alipaySignedParams(env, 'alipay.trade.wap.pay', biz);
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return { payUrl: `https://openapi.alipay.com/gateway.do?${query}` };
}

/** 微信支付 v3 请求签名：METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n。 */
function wechatAuthorization(env: Record<string, string | undefined>, method: string, path: string, body: string): string {
  const mchid = env.MIM_WECHAT_MCH_ID ?? '';
  const serialNo = env.MIM_WECHAT_SERIAL_NO ?? '';
  const privateKey = (env.MIM_WECHAT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
}

/** 微信 Native 下单：返回 code_url，前端渲染二维码。 */
async function createWechatNative(env: Record<string, string | undefined>, intent: PayIntentRow): Promise<{ qrText: string }> {
  const appid = env.MIM_WECHAT_APP_ID;
  const mchid = env.MIM_WECHAT_MCH_ID;
  const serialNo = env.MIM_WECHAT_SERIAL_NO;
  const privateKey = env.MIM_WECHAT_PRIVATE_KEY;
  const notifyUrl = env.MIM_WECHAT_NOTIFY_URL;
  if (!appid || !mchid || !serialNo || !privateKey || !notifyUrl) throw new AppError('PROVIDER_NOT_CONFIGURED', '微信支付未配置 AppID / 商户号 / 证书 / 回调地址');
  const path = '/v3/pay/transactions/native';
  const body = JSON.stringify({
    appid,
    mchid,
    description: `Mim 订单 ${intent.id}`,
    out_trade_no: intent.id,
    notify_url: notifyUrl,
    amount: { total: intent.amount_cents, currency: 'CNY' },
  });
  const res = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method: 'POST',
    headers: {
      authorization: wechatAuthorization(env, 'POST', path, body),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body,
  });
  const json = (await res.json()) as { code_url?: string; message?: string; code?: string };
  if (!res.ok || !json.code_url) throw new AppError('INTERNAL_ERROR', json.message ?? json.code ?? '微信下单失败');
  return { qrText: json.code_url };
}

/** 微信回调验签：用平台公钥验证原始报文签名。 */
export function verifyWechatSignature(
  env: Record<string, string | undefined>,
  headers: { timestamp?: string; nonce?: string; signature?: string; serial?: string },
  rawBody: string,
): boolean {
  if (env.MIM_WECHAT_PLATFORM_SERIAL && headers.serial && env.MIM_WECHAT_PLATFORM_SERIAL !== headers.serial) return false;
  const publicKey = (env.MIM_WECHAT_PLATFORM_PUBLIC_KEY ?? '').replace(/\\n/g, '\n');
  if (!publicKey || !headers.timestamp || !headers.nonce || !headers.signature) return false;
  const message = `${headers.timestamp}\n${headers.nonce}\n${rawBody}\n`;
  return verify('RSA-SHA256', Buffer.from(message), publicKey, Buffer.from(headers.signature, 'base64'));
}

/** 微信回调资源解密：AES-256-GCM，key 为 APIv3 密钥。 */
export function decryptWechatResource(
  apiV3Key: string,
  resource: { ciphertext: string; nonce: string; associated_data?: string },
): Record<string, unknown> {
  const key = Buffer.from(apiV3Key);
  if (key.length !== 32) throw new AppError('PROVIDER_NOT_CONFIGURED', '微信 APIv3 密钥必须是 32 字节');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce));
  decipher.setAuthTag(Buffer.from((resource as { ciphertext: string; nonce: string; associated_data?: string; tag?: string }).tag ?? '', 'base64'));
  if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data));
  const plain = Buffer.concat([decipher.update(Buffer.from(resource.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as Record<string, unknown>;
}
export async function createIntent(
  deps: ApiDeps,
  input: { userId: string; purpose: PayPurpose; refId: string; provider: PayProvider; amountCents: number; channel?: 'qr' | 'wap' | 'app' },
) {
  if (input.amountCents <= 0) throw new AppError('VALIDATION_FAILED', '支付金额必须大于 0');
  const id = `pay-${randomUUID()}`;
  const ts = now(deps);
  const expires = new Date(Date.now() + 30 * 60000).toISOString(); // 30 分钟未支付自动失效
  deps.db
    .prepare(
      `INSERT INTO payment_intents (id, user_id, purpose, ref_id, provider, amount_cents, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(id, input.userId, input.purpose, input.refId, input.provider, input.amountCents, expires, ts);
  const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id) as PayIntentRow;
  if (input.provider === 'manual') {
    const account = deps.env.MIM_MANUAL_PAY_ACCOUNT ?? '请联系客服获取收款账户';
    const qr = `人工转账：${account}；金额 ${(input.amountCents / 100).toFixed(2)} 元；备注 ${id}`;
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(qr, id);
    return { intent: { ...intent, qr_text: qr }, next: 'manual_confirm' as const };
  }
  if (input.provider === 'sandbox') {
    if (deps.env.MIM_PAYMENT_SANDBOX !== '1') throw new AppError('PROVIDER_NOT_CONFIGURED', '沙箱支付未启用');
    const qr = `sandbox:${id}`;
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(qr, id);
    return { intent: { ...intent, qr_text: qr }, next: 'sandbox_confirm' as const };
  }
  if (input.provider === 'alipay') {
    if (input.channel === 'wap' || input.channel === 'app') {
      const result = createAlipayWap(deps.env, intent);
      deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(result.payUrl, id);
      return { intent: { ...intent, qr_text: result.payUrl }, next: 'redirect' as const, pay_url: result.payUrl };
    }
    const result = await createAlipay(deps.env, intent);
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(result.qrText, id);
    return { intent: { ...intent, qr_text: result.qrText }, next: 'qrcode' as const };
  }
  if (input.provider === 'wechat') {
    const result = await createWechatNative(deps.env, intent);
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(result.qrText, id);
    return { intent: { ...intent, qr_text: result.qrText }, next: 'qrcode' as const };
  }
  throw new AppError('PROVIDER_NOT_CONFIGURED', '不支持的支付渠道');
}

/** 校验沙箱回调签名：HMAC-SHA256(`${intent}.${amount}.${status}`)。 */
export function verifySandboxSignature(intentId: string, amount: number, status: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(`${intentId}.${amount}.${status}`).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

/** 恒定时间比较十六进制签名，避免逐字节提前返回。 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 确保钱包行存在，支付履约时余额入账不会静默落空。 */
function ensureWallet(deps: ApiDeps, userId: string): { balance_cents: number; points: number } {
  const existing = deps.db.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as
    | { balance_cents: number; points: number }
    | undefined;
  if (existing) return existing;
  deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now(deps));
  return { balance_cents: 0, points: 100 };
}

/** 记一条创作者收益：平台抽 30%，作者得 70%，先记 pending。 */
export function recordEarning(deps: ApiDeps, userId: string | null, sourceType: string, sourceId: string, gross: number): void {
  if (!userId || gross <= 0) return; // 平台自营资产不分账
  const net = Math.round(gross * 0.7);
  const fee = gross - net;
  deps.db
    .prepare(
      `INSERT OR IGNORE INTO creator_earnings (id, user_id, source_type, source_id, gross_cents, platform_fee_cents, net_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(`ce-${randomUUID()}`, userId, sourceType, sourceId, gross, fee, net, now(deps));
}

/** 履约：把已支付意图落到对应业务，幂等（已 paid 直接返回）。 */
export function fulfillIntent(deps: ApiDeps, intent: PayIntentRow, providerTxnId: string | null): void {
  if (intent.status === 'paid') return; // 重复回调不重复发货
  const ts = now(deps);
  const tx = deps.db.transaction(() => {
    deps.db.prepare("UPDATE payment_intents SET status = 'paid', provider_txn_id = ?, paid_at = ? WHERE id = ?").run(providerTxnId, ts, intent.id);
    if (intent.purpose === 'recharge') {
      ensureWallet(deps, intent.user_id);
      deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(intent.amount_cents, ts, intent.user_id);
      deps.db
        .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'recharge', ?, 'payment', ?, '在线充值', ?)")
        .run(`wt-${randomUUID()}`, intent.user_id, intent.amount_cents, intent.id, ts);
    } else if (intent.purpose === 'asset') {
      const asset = deps.db.prepare("SELECT id, author_id, price_cents FROM paid_assets WHERE code = ? AND status = 'published'").get(intent.ref_id) as
        | { id: string; author_id: string | null; price_cents: number }
        | undefined;
      if (!asset) throw new AppError('NOT_FOUND', '资产不存在');
      deps.db
        .prepare('INSERT OR IGNORE INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`ap-${randomUUID()}`, intent.user_id, asset.id, intent.amount_cents, ts);
      deps.db.prepare('UPDATE paid_assets SET sales = sales + 1 WHERE id = ?').run(asset.id);
      recordEarning(deps, asset.author_id, 'asset', asset.id, intent.amount_cents);
    } else if (intent.purpose === 'vip') {
      const plan = deps.db.prepare('SELECT id, level, duration_days FROM vip_plans WHERE code = ? AND active = 1').get(intent.ref_id) as
        | { id: string; level: number; duration_days: number }
        | undefined;
      if (!plan) throw new AppError('NOT_FOUND', 'VIP 套餐不存在');
      const current = deps.db
        .prepare("SELECT expires_at FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1")
        .get(intent.user_id, ts) as { expires_at: string } | undefined;
      const start = current ? new Date(current.expires_at) : new Date();
      const expires = new Date(start.getTime() + plan.duration_days * 86400000).toISOString();
      deps.db
        .prepare("INSERT INTO vip_memberships (id, user_id, plan_id, level, starts_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)")
        .run(`vip-${randomUUID()}`, intent.user_id, plan.id, plan.level, ts, expires, ts);
    } else if (intent.purpose === 'shop_order') {
      const order = deps.db.prepare('SELECT status, payable_cents FROM shop_orders WHERE id = ?').get(intent.ref_id) as
        | { status: string; payable_cents: number }
        | undefined;
      if (!order) throw new AppError('NOT_FOUND', '订单不存在');
      if (order.payable_cents !== intent.amount_cents) throw new AppError('CONFLICT', '支付金额与订单不一致');
      deps.db.prepare("UPDATE shop_orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'").run(ts, intent.ref_id);
    }
    deps.db
      .prepare('INSERT INTO payment_events (id, intent_id, provider, event, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`pe-${randomUUID()}`, intent.id, intent.provider, 'paid', providerTxnId ?? '', ts);
  });
  tx();
}
