/**
 * 前端新增界面文案本地字典（zh-CN / en-US 一一对应）。
 *
 * 范围说明：packages/i18n 既有字典未覆盖收银台 / 播放器 / 分享 / 语言切换等新页面，
 * 在「只改 apps/web」的约束下先在本地维护；键名以 web. 前缀分组，后续可平移进共享字典。
 */

import type { Locale } from '@mim/i18n';

type Dict = Record<string, string>;

const zh: Dict = {
  'web.checkout.title': '收银台',
  'web.checkout.amount': '应付金额',
  'web.checkout.provider': '支付渠道',
  'web.checkout.qrHint': '扫码支付，或点击下方按钮唤起支付 App',
  'web.checkout.openAlipay': '打开支付宝',
  'web.checkout.openWechat': '打开微信',
  'web.checkout.refresh': '我已完成支付，刷新状态',
  'web.checkout.pending': '等待支付完成…',
  'web.checkout.success': '支付成功',
  'web.checkout.failed': '支付未完成',
  'web.checkout.cancelled': '支付已取消',
  'web.checkout.back': '返回上一页',
  'web.checkout.manualNote': '线下转账请按页面指引完成付款，运营核对到账后自动履约。',
  'web.checkout.sandboxNote': '沙箱渠道：在测试环境模拟支付回调后即视为完成。',
  'web.checkout.wechatHint': '请在微信中打开本页面完成微信支付；外部浏览器可扫码支付。',
  'web.return.title': '支付结果',
  'web.return.processing': '支付处理中，请稍候…',
  'web.return.success': '支付成功，权益已到账',
  'web.return.failed': '支付未完成，可返回重新发起支付',
  'web.share.title': '分享',
  'web.share.copy': '复制链接',
  'web.share.copied': '链接已复制',
  'web.share.text': '分享文案',
  'web.share.qr': '扫码打开',
  'web.player.episode': '剧集',
  'web.player.prev': '上一集',
  'web.player.next': '下一集',
  'web.player.lockedTitle': '内容未解锁',
  'web.player.lockedDesc': '解锁后即可观看全部剧集与正文；VIP 会员可按权益直接查看。',
  'web.player.unlock': '立即解锁',
  'web.player.loading': '加载中…',
  'web.player.empty': '暂无可播放的内容',
  'web.player.openInPlayer': '独立播放',
  'web.language.label': '语言',
  'web.language.zh': '简体中文',
  'web.language.en': 'English',
  'web.common.retry': '重试',
  'web.common.onlinePay': '在线支付',
  'web.common.payNow': '去支付',
  'web.common.recharge': '余额充值',
  'web.common.amountYuan': '金额（元）',
};

const en: Dict = {
  'web.checkout.title': 'Checkout',
  'web.checkout.amount': 'Amount due',
  'web.checkout.provider': 'Payment channel',
  'web.checkout.qrHint': 'Scan to pay, or tap the button below to open the payment app',
  'web.checkout.openAlipay': 'Open Alipay',
  'web.checkout.openWechat': 'Open WeChat',
  'web.checkout.refresh': 'I have paid — refresh status',
  'web.checkout.pending': 'Waiting for payment…',
  'web.checkout.success': 'Payment successful',
  'web.checkout.failed': 'Payment not completed',
  'web.checkout.cancelled': 'Payment cancelled',
  'web.checkout.back': 'Go back',
  'web.checkout.manualNote': 'For manual transfer, follow the payment instructions; fulfillment is confirmed after the operator verifies the transfer.',
  'web.checkout.sandboxNote': 'Sandbox channel: fulfillment is marked complete after the test callback.',
  'web.checkout.wechatHint': 'Open this page inside WeChat to pay with WeChat Pay; otherwise scan the QR code.',
  'web.return.title': 'Payment result',
  'web.return.processing': 'Processing your payment…',
  'web.return.success': 'Payment successful, benefits granted',
  'web.return.failed': 'Payment not completed; you can go back and retry',
  'web.share.title': 'Share',
  'web.share.copy': 'Copy link',
  'web.share.copied': 'Link copied',
  'web.share.text': 'Share text',
  'web.share.qr': 'Scan to open',
  'web.player.episode': 'Episodes',
  'web.player.prev': 'Previous',
  'web.player.next': 'Next',
  'web.player.lockedTitle': 'Locked content',
  'web.player.lockedDesc': 'Unlock to watch all episodes and read the full body; VIP members can view under their benefits.',
  'web.player.unlock': 'Unlock now',
  'web.player.loading': 'Loading…',
  'web.player.empty': 'No playable content yet',
  'web.player.openInPlayer': 'Open in player',
  'web.language.label': 'Language',
  'web.language.zh': '简体中文',
  'web.language.en': 'English',
  'web.common.retry': 'Retry',
  'web.common.onlinePay': 'Online payment',
  'web.common.payNow': 'Pay now',
  'web.common.recharge': 'Top up balance',
  'web.common.amountYuan': 'Amount (CNY)',
};

const DICTS: Record<Locale, Dict> = { 'zh-CN': zh, 'en-US': en };

/** 取本地字典文案；缺失时回落中文，再回落键名本身 */
export function tr(locale: Locale, key: string): string {
  return DICTS[locale][key] ?? zh[key] ?? key;
}
