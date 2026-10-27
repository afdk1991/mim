/* ==========================================================================
 * 四业务注册表 —— 统一入口导航与履约状态元数据的唯一真源
 *
 * 页面只消费这里的数据，不得自行定义业务文案或路由，
 * 否则「同一个状态在订单中心和会场显示两种说法」这类不一致必然复现。
 * ======================================================================== */

import type { BizKind } from '../model'

export interface BizMeta {
  kind: BizKind
  /** 会场路由（与商品频道前缀隔离，避免 #/mall/live 撞车） */
  route: string
  emoji: string
  label: string
  tagline: string
  /** 商品频道路由（同一业务在商品流里的入口） */
  channelRoute: string
}

export const BIZ_META: Record<BizKind, BizMeta> = {
  seckill: {
    kind: 'seckill',
    route: 'seckill',
    emoji: '⚡',
    label: '秒杀特惠',
    tagline: '限时场次 · 库存锁定 · 防超卖',
    channelRoute: 'gexm',
  },
  local: {
    kind: 'local',
    route: 'local',
    emoji: '🍜',
    label: '本地生活',
    tagline: '门店套餐 · 券码核销 · 到店可用',
    channelRoute: 'mix',
  },
  live: {
    kind: 'live',
    route: 'live',
    emoji: '📺',
    label: '直播尖货',
    tagline: '直播间货架 · 专享价直下',
    channelRoute: 'live',
  },
  travel: {
    kind: 'travel',
    route: 'travel',
    emoji: '🚗',
    label: '出行服务',
    tagline: '日期库存 · 在线选座 · 退改规则',
    channelRoute: 'laal',
  },
}

/** 商城中心的四业务统一入口（顺序即展示顺序） */
export const BIZ_ENTRIES: BizMeta[] = [BIZ_META.seckill, BIZ_META.local, BIZ_META.live, BIZ_META.travel]

/** 路由 → 业务，供 App 路由分发使用 */
export const BIZ_BY_ROUTE: Record<string, BizMeta> = Object.fromEntries(
  BIZ_ENTRIES.map((b) => [b.route, b]),
)

export function bizOfRoute(route: string | undefined): BizMeta | null {
  return route ? BIZ_BY_ROUTE[route] ?? null : null
}

/** 该业务在「下单时必须先在服务端占库存」的函数名；无则为 null（无需占库存） */
export const BIZ_HOLD_RPC: Record<BizKind, string | null> = {
  seckill: 'seckill_grab',
  local: null,
  live: null,
  travel: 'travel_book',
}

/** 取消订单时是否需要释放已占资源 */
export const BIZ_RELEASE_RPC: Record<BizKind, string | null> = {
  seckill: 'seckill_release',
  local: null,
  live: null,
  travel: 'travel_release',
}
