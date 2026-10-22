/* 支付通道适配层：
 *  - wallet：统一钱包余额支付（真实扣费 mim-wallet-v1，余额不足返回 false）
 *  - qrcode-manual：收款码扫码 + 付款凭证人工确认
 *    （用户提交凭证 → 订单 awaiting_confirm → 管理员凭 payConfirmKey 口令核销 → paid）
 *  PaymentChannel 接口为后续接入聚合支付（微信/支付宝官方或第三方）预留通道位：
 *  新通道只需在此追加 PaymentChannel 并在订单中心补充对应交互，不改订单状态机。 */

import { SITE_CONFIG } from '../site-config'

export type PayChannelId = 'wallet' | 'qrcode-manual'

/** 付款凭证：扫码人工确认通道必带 */
export type PayProof = { method: string; ref: string; at: number }

export interface PaymentChannel {
  id: PayChannelId
  label: string
  desc: string
  available: () => boolean
}

export const PAY_CHANNELS: PaymentChannel[] = [
  { id: 'wallet', label: '钱包余额', desc: '统一钱包扣款，即时到账', available: () => true },
  {
    id: 'qrcode-manual',
    label: '扫码支付',
    desc: '扫码付款后提交凭证，管理员确认',
    available: () => SITE_CONFIG.payQrCodeUrl.trim() !== '',
  },
]

/** 收款码信息（未配置时 qrcodeUrl 为空串） */
export function qrcodePayInfo(): { qrcodeUrl: string; note: string } {
  return { qrcodeUrl: SITE_CONFIG.payQrCodeUrl.trim(), note: SITE_CONFIG.payQrNote.trim() }
}

/** 管理员核销口令校验（未配置口令则核销入口关闭） */
export function checkOperatorKey(key: string): boolean {
  const expect = SITE_CONFIG.payConfirmKey.trim()
  return expect !== '' && key.trim() === expect
}
