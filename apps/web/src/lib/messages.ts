/**
 * 前端新增界面文案本地字典（zh-CN / en-US 一一对应）。
 *
 * 范围说明：packages/i18n 既有字典未覆盖收银台 / 支付结果等新页面，
 * 在「只改 apps/web」的约束下先在本地维护；键名以 web. 前缀分组，后续可平移进共享字典。
 */

import type { Locale } from '@mim/i18n';

type Dict = Record<string, string>;

const zh: Dict = {
  'web.checkout.title': '收银台', // 键 web.checkout.title 的文案：收银台
  'web.checkout.amount': '应付金额', // 键 web.checkout.amount 的文案：应付金额
  'web.checkout.provider': '支付渠道', // 键 web.checkout.provider 的文案：支付渠道
  'web.checkout.qrHint': '扫码支付，或点击下方按钮唤起支付 App', // 键 web.checkout.qrHint 的文案：扫码支付，或点击下方按钮唤起支付 App
  'web.checkout.openAlipay': '打开支付宝', // 键 web.checkout.openAlipay 的文案：打开支付宝
  'web.checkout.openWechat': '打开微信', // 键 web.checkout.openWechat 的文案：打开微信
  'web.checkout.refresh': '我已完成支付，刷新状态', // 键 web.checkout.refresh 的文案：我已完成支付，刷新状态
  'web.checkout.pending': '等待支付完成…', // 键 web.checkout.pending 的文案：等待支付完成…
  'web.checkout.success': '支付成功', // 键 web.checkout.success 的文案：支付成功
  'web.checkout.failed': '支付未完成', // 键 web.checkout.failed 的文案：支付未完成
  'web.checkout.cancelled': '支付已取消', // 键 web.checkout.cancelled 的文案：支付已取消
  'web.checkout.back': '返回上一页', // 键 web.checkout.back 的文案：返回上一页
  'web.checkout.manualNote': '线下转账请按页面指引完成付款，运营核对到账后自动履约。', // 键 web.checkout.manualNote 的文案：线下转账请按页面指引完成付款，运营核对到账后自动履约。
  'web.checkout.sandboxNote': '沙箱渠道：在测试环境模拟支付回调后即视为完成。', // 键 web.checkout.sandboxNote 的文案：沙箱渠道：在测试环境模拟支付回调后即视为完成。
  'web.checkout.wechatHint': '请在微信中打开本页面完成微信支付；外部浏览器可扫码支付。', // 键 web.checkout.wechatHint 的文案：请在微信中打开本页面完成微信支付；外部浏览器可扫码支付。
  'web.return.title': '支付结果', // 键 web.return.title 的文案：支付结果
  'web.return.processing': '支付处理中，请稍候…', // 键 web.return.processing 的文案：支付处理中，请稍候…
  'web.return.success': '支付成功，权益已到账', // 键 web.return.success 的文案：支付成功，权益已到账
  'web.return.failed': '支付未完成，可返回重新发起支付', // 键 web.return.failed 的文案：支付未完成，可返回重新发起支付
  'web.player.loading': '加载中…', // 键 web.player.loading 的文案：加载中…
  'web.common.retry': '重试', // 键 web.common.retry 的文案：重试
  'web.common.payNow': '去支付', // 键 web.common.payNow 的文案：去支付
};

const en: Dict = {
  'web.checkout.title': 'Checkout', // 键 web.checkout.title 的文案：Checkout
  'web.checkout.amount': 'Amount due', // 键 web.checkout.amount 的文案：Amount due
  'web.checkout.provider': 'Payment channel', // 键 web.checkout.provider 的文案：Payment channel
  'web.checkout.qrHint': 'Scan to pay, or tap the button below to open the payment app', // 键 web.checkout.qrHint 的文案：Scan to pay, or tap the button below to …
  'web.checkout.openAlipay': 'Open Alipay', // 键 web.checkout.openAlipay 的文案：Open Alipay
  'web.checkout.openWechat': 'Open WeChat', // 键 web.checkout.openWechat 的文案：Open WeChat
  'web.checkout.refresh': 'I have paid — refresh status', // 键 web.checkout.refresh 的文案：I have paid — refresh status
  'web.checkout.pending': 'Waiting for payment…', // 键 web.checkout.pending 的文案：Waiting for payment…
  'web.checkout.success': 'Payment successful', // 键 web.checkout.success 的文案：Payment successful
  'web.checkout.failed': 'Payment not completed', // 键 web.checkout.failed 的文案：Payment not completed
  'web.checkout.cancelled': 'Payment cancelled', // 键 web.checkout.cancelled 的文案：Payment cancelled
  'web.checkout.back': 'Go back', // 键 web.checkout.back 的文案：Go back
  'web.checkout.manualNote': 'For manual transfer, follow the payment instructions; fulfillment is confirmed after the operator verifies the transfer.', // 键 web.checkout.manualNote 的文案：For manual transfer, follow the payment …
  'web.checkout.sandboxNote': 'Sandbox channel: fulfillment is marked complete after the test callback.', // 键 web.checkout.sandboxNote 的文案：Sandbox channel: fulfillment is marked c…
  'web.checkout.wechatHint': 'Open this page inside WeChat to pay with WeChat Pay; otherwise scan the QR code.', // 键 web.checkout.wechatHint 的文案：Open this page inside WeChat to pay with…
  'web.return.title': 'Payment result', // 键 web.return.title 的文案：Payment result
  'web.return.processing': 'Processing your payment…', // 键 web.return.processing 的文案：Processing your payment…
  'web.return.success': 'Payment successful, benefits granted', // 键 web.return.success 的文案：Payment successful, benefits granted
  'web.return.failed': 'Payment not completed; you can go back and retry', // 键 web.return.failed 的文案：Payment not completed; you can go back a…
  'web.player.loading': 'Loading…', // 键 web.player.loading 的文案：Loading…
  'web.common.retry': 'Retry', // 键 web.common.retry 的文案：Retry
  'web.common.payNow': 'Pay now', // 键 web.common.payNow 的文案：Pay now
};

const DICTS: Record<Locale, Dict> = { 'zh-CN': zh, 'en-US': en };

/** 取本地字典文案；缺失时回落中文，再回落键名本身 */
export function tr(locale: Locale, key: string): string {
  return DICTS[locale][key] ?? zh[key] ?? key;
}
