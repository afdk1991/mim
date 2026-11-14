/**
 * 支付唤起与意图状态判定纯函数（无 React / 无网络依赖，可独立单测）。
 *
 * 契约：
 * - 移动端按 UA 判断，scheme 一律真实拼接，不写注释占位；
 * - 桌面端不尝试唤起 App，只展示二维码 / 支付链接；
 * - 状态归类只做前端展示分组，最终以服务端回调履约为准。
 */

import type { PaymentProvider } from '../api';

/** 唤起结果：scheme 为 null 表示当前环境无可唤起的原生 App */
export interface PaymentLaunch {
  /** 可跳转的原生 scheme；null 时走二维码 / 链接兜底 */
  scheme: string | null;
  /** 按钮文案（未走 i18n，由调用方结合语言渲染） */
  provider: string;
  /** 场景提示：移动端直起 / 扫码兜底 / 桌面扫码 */
  note: 'app-wap' | 'app-scan' | 'desktop-qr' | 'wechat-hint';
}

/** 移动端 UA 判定：覆盖主流手机 / 平板与移动端浏览器标识 */
export function isMobileUserAgent(ua: string): boolean {
  if (!ua) return false;
  return /Android|iPhone|iPad|iPod|HarmonyOS|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

/**
 * 支付宝 WAP 直起 scheme：把支付链接包进支付宝小程序容器打开。
 * appId 20000067 为支付宝「网页跳转」标准容器；url 必须编码后拼接。
 */
export function buildAlipayWapScheme(targetUrl: string): string {
  return `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(targetUrl)}`;
}

/** 支付宝扫码兜底 scheme：无 H5 链接时唤起支付宝扫一扫，由用户扫收款码 */
export function buildAlipayScanScheme(): string {
  return 'alipays://platformapi/startapp?appId=20000123&actionType=scan';
}

/**
 * 按渠道与支付链接生成唤起方案。
 * @param provider 渠道（alipay / wechat / manual / sandbox）
 * @param payUrl   后端 next.pay_url，可能为 null
 * @param qrText   后端 next.qr_text（二维码内容），可能为 null
 * @param ua       浏览器 UA，服务端不可用时传 ''
 */
export function resolvePaymentLaunch(
  provider: PaymentProvider | string,
  payUrl: string | null,
  qrText: string | null,
  ua: string,
): PaymentLaunch {
  const mobile = isMobileUserAgent(ua);
  if (provider === 'alipay') {
    if (mobile && payUrl) {
      return { scheme: buildAlipayWapScheme(payUrl), provider: 'alipay', note: 'app-wap' };
    }
    if (mobile) {
      return { scheme: buildAlipayScanScheme(), provider: 'alipay', note: 'app-scan' };
    }
    return { scheme: null, provider: 'alipay', note: 'desktop-qr' };
  }
  if (provider === 'wechat') {
    // 微信内 H5 支付需 JS-SDK 签名，外部浏览器无法直起；
    // 外部环境给出 weixin:// 兜底提示，微信内由后端 H5 链路处理。
    if (mobile) return { scheme: 'weixin://', provider: 'wechat', note: 'wechat-hint' };
    return { scheme: null, provider: 'wechat', note: 'desktop-qr' };
  }
  // manual / sandbox 及未知渠道：不直起原生 App，统一走二维码 / 链接展示
  return { scheme: null, provider, note: 'desktop-qr' };
}

/** 支付意图前端三态归类：成功 / 处理中 / 失败（含取消） */
export type IntentUiStatus = 'paid' | 'pending' | 'failed';

export function classifyIntentStatus(status: string | null | undefined): IntentUiStatus {
  const s = (status ?? '').toLowerCase();
  if (s === 'paid' || s === 'success' || s === 'completed') return 'paid';
  if (s === 'pending' || s === 'created' || s === 'processing' || s === 'waiting' || s === '') return 'pending';
  // failed / cancelled / refunded / expired / rejected 都归入失败展示
  return 'failed';
}

/** 收银台 / 回跳页 query 参数解析：intent 为主键，provider/purpose/ref_id 为展示与回跳辅助信息 */
export interface IntentQuery {
  intentId: string;
  provider?: string;
  purpose?: string;
  refId?: string;
}

export function parseIntentQuery(search: string): IntentQuery {
  const params = new URLSearchParams(search);
  return {
    intentId: (params.get('intent') ?? params.get('intent_id') ?? '').trim(),
    provider: params.get('provider') ?? undefined,
    purpose: params.get('purpose') ?? undefined,
    refId: params.get('ref') ?? params.get('ref_id') ?? undefined,
  };
}
