/* ==========================================================================
 * 商城域模型 —— 商品 / 购物车 / 订单 / 四大业务扩展
 *
 * 金额单位（重建统一，消除历史 100 倍错位 bug）：
 *   全模型层一律用「分」整数，字段名带 Fen 后缀（priceFen / amountFen / valueFen）。
 *   展示层用 core/utils 的 yuanText() 转换，禁止在模型层做浮点运算。
 *
 * 统一基座 + 差异化外挂：
 *   商品/购物车/订单/支付/钱包只有一套；业务独有字段收进 OrderExt 判别联合，
 *   挂在 MallOrder.ext 上。ext 为 undefined 的普通订单行为与普通电商完全一致。
 * ======================================================================== */

export type MallChannel = 'youxuan' | 'gexm' | 'mix' | 'live' | 'laal'

export const MALL_CHANNEL_META: Record<MallChannel, { emoji: string; label: string }> = {
  youxuan: { emoji: '🛍️', label: '优选商城' },
  gexm: { emoji: '⚡', label: '秒杀特惠' },
  mix: { emoji: '🍜', label: '本地生活' },
  live: { emoji: '📺', label: '直播带货' },
  laal: { emoji: '🚗', label: '出行服务' },
}

export interface MallGoods {
  id: string
  channel: MallChannel
  title: string
  emoji: string
  /** 售价（分） */
  priceFen: number
  /** 划线原价（分）；仅当原价 > 售价时才有意义 */
  origPriceFen?: number
  desc: string
}

export interface MallCartItem {
  goodsId: string
  qty: number
  spec?: string
  /** 业务成交单价覆盖（秒杀价 / 直播价）；缺省取目录价 */
  priceFen?: number
  /** 带业务扩展的行永不与普通行合并，避免秒杀价与目录价混算 */
  ext?: OrderExt
}

/* ---------- 四大业务 ---------- */

export type BizKind = 'seckill' | 'local' | 'live' | 'travel'

export type SeckillPhase = 'upcoming' | 'ongoing' | 'sold_out' | 'ended'

export interface SeckillSession {
  id: string
  goodsId: string
  title: string
  emoji: string
  priceFen: number
  origPriceFen?: number
  startAt: number
  endAt: number
  remaining: number
  total: number
  limitPerUser: number
}

export interface LocalMerchant {
  id: string
  name: string
  address: string
  category: string
  emoji: string
  lng?: number
  lat?: number
  hours?: string
  phone?: string
}

export interface LocalVoucher {
  id: string
  merchantId: string
  goodsId: string
  title: string
  emoji: string
  priceFen: number
  /** 面值（分） */
  valueFen: number
  validUntil: number
  rules: string[]
  remaining: number
}

export type VoucherStatus = 'unused' | 'used' | 'expired' | 'refunding' | 'refunded'

export interface VoucherCode {
  code: string
  orderId: string
  voucherId: string
  merchantId: string
  status: VoucherStatus
  expireAt: number
  usedAt?: number
}

export type LiveRoomStatus = 'preview' | 'live' | 'ended'

export interface LiveRoom {
  id: string
  title: string
  anchorId: string
  anchorName: string
  anchorEmoji: string
  status: LiveRoomStatus
  startedAt: number
  viewers: number
  cover?: string
}

export interface LiveShelfItem {
  roomId: string
  goodsId: string
  title: string
  emoji: string
  livePriceFen: number
  origPriceFen?: number
  seq: number
  /** 讲解中：客户端置顶高亮 */
  explaining: boolean
}

export type TravelKind = 'flight' | 'train' | 'bus' | 'hotel' | 'scenic'

export interface TravelTicket {
  id: string
  kind: TravelKind
  title: string
  emoji: string
  fromCity: string
  toCity: string
  priceFen: number
  seatClasses: string[]
}

export interface TravelDateStock {
  ticketId: string
  /** YYYY-MM-DD */
  date: string
  remaining: number
  priceFen: number
}

export interface TravelRule {
  ticketId: string
  refundable: boolean
  changeable: boolean
  /** 手续费率 0~1 */
  feeRate: number
  /** 出发前 N 小时内不可退改；0 表示不限制 */
  cutoffHours: number
  note: string
}

export const TRAVEL_KIND_META: Record<TravelKind, { emoji: string; label: string }> = {
  flight: { emoji: '✈️', label: '机票' },
  train: { emoji: '🚄', label: '火车票' },
  bus: { emoji: '🚌', label: '汽车票' },
  hotel: { emoji: '🏨', label: '酒店' },
  scenic: { emoji: '🎫', label: '景区票' },
}

/* ---------- 订单扩展（判别联合） ---------- */

export interface SeckillExt {
  kind: 'seckill'
  sessionId: string
  seckillPriceFen: number
  /** 锁库存到期时间（毫秒，展示用；真正裁定在服务端） */
  lockExpireAt: number
}

export interface LocalExt {
  kind: 'local'
  merchantId: string
  merchantName: string
  voucherId: string
  /** 支付后由服务端回填；待支付时为空串 */
  voucherCode: string
  expireAt: number
}

export interface LiveExt {
  kind: 'live'
  roomId: string
  roomTitle: string
  anchorId: string
  anchorName: string
  livePriceFen: number
}

export interface TravelExt {
  kind: 'travel'
  ticketId: string
  kindLabel: string
  /** 出行日期 YYYY-MM-DD */
  date: string
  passengers: string[]
  seatClass: string
  /** 下单即快照：运营事后改规则不影响已成交订单 */
  rule: TravelRule
}

export type OrderExt = SeckillExt | LocalExt | LiveExt | TravelExt

/* ---------- 履约状态（与主状态正交） ---------- */

export type SeckillBizStatus = 'locked' | 'released'
export type LocalBizStatus = 'pending_verify' | 'verified' | 'expired' | 'refunding' | 'refunded'
export type LiveBizStatus = 'pending_ship' | 'shipped'
export type TravelBizStatus = 'pending_ticket' | 'ticketed' | 'traveled' | 'refunding' | 'refunded' | 'changing'

export type OrderBizStatus = SeckillBizStatus | LocalBizStatus | LiveBizStatus | TravelBizStatus

/** 下单初始履约状态 */
export function initialBizStatus(ext: OrderExt): OrderBizStatus {
  switch (ext.kind) {
    case 'seckill':
      return 'locked'
    case 'local':
      return 'pending_verify'
    case 'live':
      return 'pending_ship'
    case 'travel':
      return 'pending_ticket'
  }
}

export function channelOfBiz(ext: OrderExt): MallChannel {
  switch (ext.kind) {
    case 'seckill':
      return 'gexm'
    case 'local':
      return 'mix'
    case 'live':
      return 'live'
    case 'travel':
      return 'laal'
  }
}

/* ---------- 主订单 ---------- */

export type OrderStatus = 'unpaid' | 'awaiting_confirm' | 'paid' | 'done'

export interface PayProof {
  method: string
  ref: string
  at: number
}

export interface MallOrder {
  id: string
  goodsId: string
  title: string
  emoji: string
  /** 订单总额（分） */
  amountFen: number
  qty: number
  channel: MallChannel
  status: OrderStatus
  at: number
  payChannel?: string
  proof?: PayProof
  bizKind?: BizKind
  ext?: OrderExt
  bizStatus?: OrderBizStatus
}

/* ---------- 钱包 ---------- */

export type PlanCode = 'BASIC' | 'SUPER' | 'DOWNLOAD_PACK' | 'ENTERPRISE'

export type TxKind = 'recharge' | 'consume' | 'income'

export interface WalletTx {
  id: number
  kind: TxKind
  /** 一律正数，方向由 kind 决定 */
  fen: number
  note: string
  at: number
}

export interface WalletState {
  balanceFen: number
  plan: PlanCode
  txs: WalletTx[]
}

/* ---------- 业务规则纯函数 ---------- */

export function seckillPhase(s: SeckillSession, now = Date.now()): SeckillPhase {
  if (s.remaining <= 0) return 'sold_out'
  if (now < s.startAt) return 'upcoming'
  if (now >= s.endAt) return 'ended'
  return 'ongoing'
}

export function seckillBuyable(s: SeckillSession, now = Date.now()): boolean {
  return seckillPhase(s, now) === 'ongoing'
}

/** 退票手续费：不可退时全额手续费（实退 0） */
export function travelRefundFee(amountFen: number, rule: TravelRule): number {
  if (!rule.refundable) return amountFen
  return Math.ceil(amountFen * rule.feeRate)
}

export function travelRefundAmount(amountFen: number, rule: TravelRule): number {
  return Math.max(0, amountFen - travelRefundFee(amountFen, rule))
}

/** 是否在退改截止窗口内 */
export function travelWithinCutoff(departAt: number, rule: TravelRule, now = Date.now()): boolean {
  return rule.cutoffHours > 0 && departAt - now <= rule.cutoffHours * 3_600_000
}

export function voucherUsable(c: VoucherCode, now = Date.now()): boolean {
  return c.status === 'unused' && c.expireAt > now
}
