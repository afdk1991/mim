/* ============================================================================
 * 四大业务注册表：统一入口导航 + 履约状态机元数据
 *
 * 为什么要有注册表：四个业务的入口、状态枚举、状态文案各不相同，
 * 若分散在各页面里硬编码，「统一入口导航」与「订单差异化渲染」就会各写一份、
 * 必然漂移。这里作为唯一真源，页面只消费不定义。
 *
 * 与主状态机的关系：主状态（unpaid/awaiting_confirm/paid/done）管资金，
 * 履约状态（bizStatus）管交付，两者正交并行展示。
 * ========================================================================== */

import type { MallChannel } from '../store'
import { BIZ_CHANNEL, type BizKind, type OrderBizStatus, type OrderExt } from './types'

/* -------------------------------------------------------------------------- */
/* 统一入口导航                                                                */
/* -------------------------------------------------------------------------- */

export interface BizEntryMeta {
  kind: BizKind
  /** 商城频道（商品归类的落点） */
  channel: MallChannel
  emoji: string
  label: string
  /** 业务会场路由（统一前缀 #/mall/biz/<kind>，避免与频道路由 #/mall/live 等冲突） */
  route: string
  desc: string
  /** 会场核心能力（入口卡片的三个卖点） */
  highlights: string[]
}

export const BIZ_META: Record<BizKind, BizEntryMeta> = {
  seckill: {
    kind: 'seckill',
    channel: BIZ_CHANNEL.seckill,
    emoji: '⚡',
    label: '秒杀特惠',
    route: '#/mall/biz/seckill',
    desc: '限时场次抢购，库存服务端原子扣减，绝不超卖',
    highlights: ['限时场次', '服务端防超卖', '每人限购'],
  },
  local: {
    kind: 'local',
    channel: BIZ_CHANNEL.local,
    emoji: '🍜',
    label: '本地生活',
    route: '#/mall/biz/local',
    desc: '门店套餐券，到店出示券码核销，一码一次',
    highlights: ['商户门店', '套餐券', '到店核销'],
  },
  live: {
    kind: 'live',
    channel: BIZ_CHANNEL.live,
    emoji: '📺',
    label: '直播尖货',
    route: '#/mall/biz/live',
    desc: '直播间货架与讲解位，点商品跳统一详情下单',
    highlights: ['直播间货架', '专享价', '跳转下单'],
  },
  travel: {
    kind: 'travel',
    channel: BIZ_CHANNEL.travel,
    emoji: '🚗',
    label: '出行服务',
    route: '#/mall/biz/travel',
    desc: '机票/火车/酒店按日期选库存，退改规则下单即快照',
    highlights: ['日期库存', '退改规则', '在线退票'],
  },
}

/** 入口顺序（与底部导航 / 商城中心展示顺序一致） */
export const BIZ_ENTRIES: BizEntryMeta[] = [BIZ_META.seckill, BIZ_META.local, BIZ_META.live, BIZ_META.travel]

/** 路由段 → 业务（App.tsx 路由分发用） */
export const BIZ_BY_ROUTE: Record<string, BizKind> = {
  seckill: 'seckill',
  local: 'local',
  live: 'live',
  travel: 'travel',
}

/* -------------------------------------------------------------------------- */
/* 履约状态机元数据                                                            */
/* -------------------------------------------------------------------------- */

export interface BizStatusMeta {
  label: string
  /** 样式修饰类（与主状态的 mall-order-unpaid 等并列，不复用避免语义混淆） */
  cls: string
  /** 终态（已核销 / 已退票 …）不再展示操作按钮 */
  terminal: boolean
}

export const BIZ_STATUS_META: Record<OrderBizStatus, BizStatusMeta> = {
  /* 秒杀 */
  locked: { label: '已锁库存', cls: 'mall-biz-locked', terminal: false },
  released: { label: '库存已释放', cls: 'mall-biz-closed', terminal: true },
  /* 本地生活 */
  pending_verify: { label: '待核销', cls: 'mall-biz-pending', terminal: false },
  verified: { label: '已核销', cls: 'mall-biz-done', terminal: true },
  expired: { label: '已过期', cls: 'mall-biz-closed', terminal: true },
  refunding: { label: '退款中', cls: 'mall-biz-pending', terminal: false },
  refunded: { label: '已退款', cls: 'mall-biz-closed', terminal: true },
  /* 直播 */
  pending_ship: { label: '待发货', cls: 'mall-biz-pending', terminal: false },
  shipped: { label: '已发货', cls: 'mall-biz-done', terminal: true },
  /* 出行 */
  pending_ticket: { label: '待出票', cls: 'mall-biz-pending', terminal: false },
  ticketed: { label: '已出票', cls: 'mall-biz-locked', terminal: false },
  traveled: { label: '已出行', cls: 'mall-biz-done', terminal: true },
  changing: { label: '改签中', cls: 'mall-biz-pending', terminal: false },
}

/** 履约状态文案（未知状态原样返回，便于排查脏数据） */
export function bizStatusLabel(s: string | undefined | null): string {
  if (!s) return ''
  return BIZ_STATUS_META[s as OrderBizStatus]?.label ?? s
}

/** 该履约状态是否还有可执行动作 */
export function bizStatusTerminal(s: string | undefined | null): boolean {
  if (!s) return false
  return BIZ_STATUS_META[s as OrderBizStatus]?.terminal === true
}

/* -------------------------------------------------------------------------- */
/* 订单扩展读取                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 订单业务扩展的安全读取：ext 为 undefined（普通实物订单）或结构非法时返回 null。
 * 老订单与未接入业务的订单一律走 null 分支 —— 渲染与今天完全一致，不破坏既有功能。
 */
export function readOrderExt(ext: unknown): OrderExt | null {
  if (!ext || typeof ext !== 'object') return null
  const o = ext as Partial<OrderExt> & { kind?: unknown }
  switch (o.kind) {
    case 'seckill':
    case 'local':
    case 'live':
    case 'travel':
      return ext as OrderExt
    default:
      return null
  }
}

/** 订单是否属于某业务（供订单中心差异化渲染与筛选） */
export function isBizOrder(ext: unknown, kind: BizKind): boolean {
  const e = readOrderExt(ext)
  return e !== null && e.kind === kind
}

/** 业务 → 频道（订单落库时的 channel 取值唯一真源） */
export function channelOfBiz(kind: BizKind): MallChannel {
  return BIZ_CHANNEL[kind]
}
