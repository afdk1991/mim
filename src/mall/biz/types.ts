/* ============================================================================
 * 商城四大业务（秒杀 / 本地生活 / 直播尖货 / 出行服务）领域类型
 *
 * 设计原则（与商城中台 store.tsx 的收敛思路一致）：
 *   ① 统一基座：商品、购物车、订单、支付、钱包链路只有一套，
 *      四大业务不是「第二套电商」，而是同一条链路上的**业务扩展**。
 *   ② 差异化外挂：业务独有字段一律收进 OrderExt（可辨识联合），
 *      挂在主订单 MallOrder.ext 上；主订单表结构不变，
 *      未接入业务的订单 ext 为 undefined，行为与今天完全一致（不破坏既有功能）。
 *   ③ 双状态机：主状态（unpaid/awaiting_confirm/paid/done）继续承担资金语义，
 *      业务子状态 bizStatus 承担履约语义（到店核销 / 出票 / 退改 …），
 *      两者正交，避免把四种履约流程硬塞进同一个 status 枚举。
 *
 * 金额单位沿用既有约定：云端列 price_cents（分），前端模型统一用「元」。
 * ========================================================================== */

import type { MallChannel } from '../store'

/** 业务类型标识（与 MallChannel 一一对应：gexm/mix/live/laal） */
export type BizKind = 'seckill' | 'local' | 'live' | 'travel'

/** 业务 → 商城频道映射（唯一真源，避免各处硬编码字符串） */
export const BIZ_CHANNEL: Record<BizKind, MallChannel> = {
  seckill: 'gexm',
  local: 'mix',
  live: 'live',
  travel: 'laal',
}

/** 频道 → 业务（youxuan 为通用实物电商，无对应业务扩展） */
export const CHANNEL_BIZ: Partial<Record<MallChannel, BizKind>> = {
  gexm: 'seckill',
  mix: 'local',
  live: 'live',
  laal: 'travel',
}

/* -------------------------------------------------------------------------- */
/* 一、秒杀特惠（gexm）：限时场次 + 库存扣减 + 防超卖                          */
/* -------------------------------------------------------------------------- */

/** 秒杀场次。库存以「剩余/总量」双字段呈现，前端不做写入，只做展示与倒计时 */
export interface SeckillSession {
  id: string
  /** 关联商品（products.id） */
  goodsId: string
  title: string
  emoji: string
  /** 秒杀价（元） */
  price: number
  /** 划线原价（元）；不高于秒杀价时不展示 */
  origPrice?: number
  /** 场次开始 / 结束时间（毫秒时间戳） */
  startAt: number
  endAt: number
  /** 剩余库存 */
  remaining: number
  /** 场次总量（用于展示进度条） */
  total: number
  /** 每人限购件数 */
  limitPerUser: number
}

/** 场次阶段：未开始 / 抢购中 / 已售罄 / 已结束 */
export type SeckillPhase = 'upcoming' | 'ongoing' | 'sold_out' | 'ended'

/** 订单业务子状态（秒杀）：锁库存待支付 → 已锁 → 超时释放 */
export type SeckillBizStatus = 'locked' | 'released'

/* -------------------------------------------------------------------------- */
/* 二、本地生活（mix）：商户门店 + 套餐券 + 到店核销                           */
/* -------------------------------------------------------------------------- */

/** 商户门店 */
export interface LocalMerchant {
  id: string
  name: string
  /** 门店地址 */
  address: string
  /** 类目（美食 / 丽人 / 休闲 …） */
  category: string
  emoji: string
  /** 经度 / 纬度（可选，缺失时页面不做地图定位） */
  lng?: number
  lat?: number
  /** 营业时间文案 */
  hours?: string
  phone?: string
}

/** 套餐券（挂在门店下） */
export interface LocalVoucher {
  id: string
  merchantId: string
  /** 关联商品（products.id，走统一商品与结算链路） */
  goodsId: string
  title: string
  emoji: string
  /** 售价（元） */
  price: number
  /** 面值（元），用于展示「¥79 抢 ¥128 套餐」 */
  value: number
  /** 有效期截止（毫秒时间戳） */
  validUntil: number
  /** 使用规则（每人限购 / 是否可叠加 / 节假日是否可用 …） */
  rules: string[]
  /** 剩余库存 */
  remaining: number
}

/** 券码状态：未使用 → 已核销 / 已过期 / 退款中 / 已退 */
export type VoucherStatus = 'unused' | 'used' | 'expired' | 'refunding' | 'refunded'

/** 券码（一单一码，核销即销码） */
export interface VoucherCode {
  code: string
  orderId: string
  voucherId: string
  merchantId: string
  status: VoucherStatus
  /** 有效期截止（毫秒时间戳） */
  expireAt: number
  usedAt?: number
}

/** 订单业务子状态（本地生活）：待核销 / 已核销 / 已过期 / 退款中 / 已退款 */
export type LocalBizStatus = 'pending_verify' | 'verified' | 'expired' | 'refunding' | 'refunded'

/* -------------------------------------------------------------------------- */
/* 三、直播尖货（live）：直播间货架 + 跳转下单                                 */
/* -------------------------------------------------------------------------- */

/** 直播间状态：预告 / 直播中 / 已结束 */
export type LiveRoomStatus = 'preview' | 'live' | 'ended'

export interface LiveRoom {
  id: string
  title: string
  /** 主播（profiles.id） */
  anchorId: string
  anchorName: string
  anchorEmoji: string
  status: LiveRoomStatus
  /** 开播时间（毫秒时间戳） */
  startedAt: number
  /** 在线人数（展示用，可为 0） */
  viewers: number
  cover?: string
}

/** 直播间货架条目：讲解中的商品 + 直播专享价 + 讲解序号 */
export interface LiveShelfItem {
  roomId: string
  goodsId: string
  title: string
  emoji: string
  /** 直播专享价（元） */
  livePrice: number
  /** 原价（元） */
  origPrice?: number
  /** 讲解排序（越小越靠前） */
  seq: number
  /** 是否正在讲解（置顶高亮） */
  explaining: boolean
}

/** 订单业务子状态（直播）：直播专享待发货 / 已发货 */
export type LiveBizStatus = 'pending_ship' | 'shipped'

/* -------------------------------------------------------------------------- */
/* 四、出行服务（laal）：票务预订 + 日期库存 + 退改规则                        */
/* -------------------------------------------------------------------------- */

/** 出行票种大类 */
export type TravelKind = 'flight' | 'train' | 'bus' | 'hotel' | 'scenic'

export interface TravelTicket {
  id: string
  kind: TravelKind
  title: string
  emoji: string
  /** 出发地 / 目的地（酒店 / 景区为城市名） */
  fromCity: string
  toCity: string
  /** 基础票价（元，单张） */
  price: number
  /** 舱位 / 席别 / 房型（经济舱 / 二等座 / 大床房 …） */
  seatClasses: string[]
}

/** 某票种某日期的库存（出行按「日期」而非「件数」售卖） */
export interface TravelDateStock {
  ticketId: string
  /** 日期（YYYY-MM-DD，本地日期，不带时区） */
  date: string
  /** 该日剩余库存 */
  remaining: number
  /** 该日总价（元，含日期浮动价；等于票价 ± 日历差价） */
  price: number
}

/** 退改规则（按票种配置） */
export interface TravelRule {
  ticketId: string
  /** 是否可退 */
  refundable: boolean
  /** 是否可改签 */
  changeable: boolean
  /** 退票手续费率（0~1），0 表示免费退 */
  feeRate: number
  /** 距出发多少小时内不可退改（0 表示不限制） */
  cutoffHours: number
  /** 规则说明（展示给用户） */
  note: string
}

/** 订单业务子状态（出行）：待出票 / 已出票 / 已出行 / 退票中 / 已退票 / 改签中 */
export type TravelBizStatus =
  | 'pending_ticket'
  | 'ticketed'
  | 'traveled'
  | 'refunding'
  | 'refunded'
  | 'changing'

/* -------------------------------------------------------------------------- */
/* 五、订单扩展（四大业务共用挂载点）                                          */
/* -------------------------------------------------------------------------- */

/**
 * 订单业务扩展：可辨识联合，按 kind 收窄。
 * 挂在 MallOrder.ext 上；undefined 表示普通实物订单（行为完全不变）。
 */
export type OrderExt =
  | {
      kind: 'seckill'
      sessionId: string
      /** 成交秒杀价（元，锁价：下单时的场次价） */
      seckillPrice: number
      /** 库存锁过期时间（毫秒；超时未支付由服务端释放） */
      lockExpireAt: number
    }
  | {
      kind: 'local'
      merchantId: string
      merchantName: string
      voucherId: string
      /** 券码（支付后由服务端生成，待支付时为空串） */
      voucherCode: string
      /** 有效期截止（毫秒时间戳） */
      expireAt: number
    }
  | {
      kind: 'live'
      roomId: string
      roomTitle: string
      anchorId: string
      anchorName: string
      /** 成交直播专享价（元） */
      livePrice: number
    }
  | {
      kind: 'travel'
      ticketId: string
      kindLabel: string
      /** 出行日期（YYYY-MM-DD） */
      date: string
      /** 乘客 / 入住人姓名 */
      passengers: string[]
      /** 舱位 / 席别 / 房型 */
      seatClass: string
      /** 下单时快照的退改规则 */
      rule: TravelRule
    }

/** 各业务的订单子状态（履约状态机，与主状态正交） */
export type OrderBizStatus =
  | SeckillBizStatus
  | LocalBizStatus
  | LiveBizStatus
  | TravelBizStatus

/**
 * 下单时的初始履约状态（按业务分流）。
 * 资金状态由主状态机管，这里是「货/券/票」的交付起点。
 */
export function initialBizStatus(ext: OrderExt): OrderBizStatus {
  switch (ext.kind) {
    case 'seckill':
      return 'locked' // 库存已锁，待支付
    case 'local':
      return 'pending_verify' // 待到店核销
    case 'live':
      return 'pending_ship' // 直播专享待发货
    case 'travel':
      return 'pending_ticket' // 已占座，待出票
  }
}

/** 业务 → 订单应落的商城频道（结算链路唯一真源） */
export function channelOfBiz(ext: OrderExt): MallChannel {
  return BIZ_CHANNEL[ext.kind]
}

/* -------------------------------------------------------------------------- */
/* 六、纯函数工具（不依赖云端，便于单测）                                      */
/* -------------------------------------------------------------------------- */

/** 秒杀场次阶段判定：售罄优先于结束（售罄是终态，结束也是终态，但展示语义不同） */
export function seckillPhase(s: SeckillSession, now: number = Date.now()): SeckillPhase {
  if (s.remaining <= 0) return 'sold_out'
  if (now < s.startAt) return 'upcoming'
  if (now >= s.endAt) return 'ended'
  return 'ongoing'
}

/** 场次是否可抢（仅「抢购中」可下单，从根上避免未开抢/已结束下单） */
export function seckillBuyable(s: SeckillSession, now: number = Date.now()): boolean {
  return seckillPhase(s, now) === 'ongoing'
}

/** 券码是否已失效（已核销 / 已过期 / 已退） */
export function voucherUsable(c: VoucherCode, now: number = Date.now()): boolean {
  return c.status === 'unused' && c.expireAt > now
}

/** 本地生活券是否过期（按有效期截止判定，未核销且未过期即有效） */
export function localVoucherUsable(expireAt: number, now: number = Date.now()): boolean {
  return expireAt > now
}

/** 出行退票手续费（元，向上取整到元，避免分币歧义） */
export function travelRefundFee(amountYuan: number, rule: TravelRule): number {
  if (!rule.refundable) return amountYuan // 不可退：手续费等于全额（实退 0）
  return Math.ceil(amountYuan * rule.feeRate)
}

/** 出行实退金额（元） */
export function travelRefundAmount(amountYuan: number, rule: TravelRule): number {
  return Math.max(0, amountYuan - travelRefundFee(amountYuan, rule))
}

/**
 * 是否在退改截止窗口内。
 * @param departAt 出发时间（毫秒）；酒店 / 景区传入住日或游玩日 0 点
 */
export function travelWithinCutoff(departAt: number, rule: TravelRule, now: number = Date.now()): boolean {
  if (rule.cutoffHours <= 0) return false
  return departAt - now <= rule.cutoffHours * 3600_000
}

/** 日期格式化为 YYYY-MM-DD（本地时区，避免 toISOString 的 UTC 偏移错日） */
export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 今天起算的第 n 天（n=0 即今天） */
export function dayOffset(n: number, from: Date = new Date()): string {
  const d = new Date(from.getTime())
  d.setDate(d.getDate() + n)
  return fmtDate(d)
}

/** 倒计时文案：>1 天显示「剩 x 天」，否则显示 hh:mm:ss，已开始/已结束返回空串 */
export function countdownText(targetAt: number, now: number = Date.now()): string {
  const ms = targetAt - now
  if (ms <= 0) return ''
  const day = Math.floor(ms / 86_400_000)
  if (day >= 1) return `剩 ${day} 天`
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}`
}
