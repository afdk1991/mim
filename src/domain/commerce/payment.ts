/* ==========================================================================
 * 支付通道 —— 钱包余额 / 扫码人工确认
 *
 * 资金安全红线（重建时特意保留并加固）：
 *   1. 人工核销口令的比对必须在服务端，前端只透传用户输入。
 *      原实现曾把口令写进前端常量，属可被直接绕过的资金欺诈漏洞。
 *   2. 扫码通道不预置收款码：未配置 payQrCodeUrl 时通道整体关闭，
 *      页面明示「暂不提供自助充值」，而不是显示一个假二维码。
 * ======================================================================== */

import { FEATURES, SITE_CONFIG, isSet } from '../../core/config'

export type PayChannelId = 'wallet' | 'qrcode-manual'

export interface PaymentChannel {
  id: PayChannelId
  label: string
  desc: string
  available: () => boolean
}

export const PAY_CHANNELS: PaymentChannel[] = [
  {
    id: 'wallet',
    label: '钱包余额',
    desc: '从统一钱包即时扣款',
    available: () => true,
  },
  {
    id: 'qrcode-manual',
    label: '扫码支付',
    desc: '扫码付款后提交凭证，等待管理员核销',
    available: () => FEATURES.qrcodePay,
  },
]

export function availableChannels(): PaymentChannel[] {
  return PAY_CHANNELS.filter((c) => c.available())
}

export function qrcodePayInfo(): { qrcodeUrl: string; note: string } {
  return { qrcodeUrl: SITE_CONFIG.payQrCodeUrl, note: SITE_CONFIG.payQrNote }
}

/** 人工核销入口是否开放（依赖服务端口令配置，前端不持有口令） */
export function manualConfirmEnabled(): boolean {
  return isSet(SITE_CONFIG.payQrCodeUrl)
}
