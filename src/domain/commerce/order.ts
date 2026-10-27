/* ==========================================================================
 * 订单状态机与金额计算 —— 商城结算链路的唯一裁决者
 *
 * 双状态机正交：
 *   status    管资金：unpaid → awaiting_confirm → paid → done
 *   bizStatus 管履约：locked / pending_verify / pending_ticket …
 * 两者并行展示，互不替代；任一方转移都不得隐式改动另一方。
 * ======================================================================== */

import type { MallCartItem, MallGoods, MallOrder, OrderBizStatus, OrderExt, OrderStatus } from './model'
import { initialBizStatus } from './model'

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; cls: string }> = {
  unpaid: { label: '待支付', cls: 'unpaid' },
  awaiting_confirm: { label: '待确认', cls: 'unpaid' },
  paid: { label: '已支付', cls: 'paid' },
  done: { label: '已完成', cls: 'done' },
}

/* ---------- 转移守卫 ---------- */

export function canPay(o: MallOrder): boolean {
  return o.status === 'unpaid'
}

export function canSubmitProof(o: MallOrder): boolean {
  return o.status === 'unpaid'
}

export function canConfirmManual(o: MallOrder): boolean {
  return o.status === 'awaiting_confirm'
}

/** 仅 unpaid 可取消；已支付订单必须走退票/退款流程 */
export function canCancel(o: MallOrder): boolean {
  return o.status === 'unpaid'
}

export function canFinish(o: MallOrder): boolean {
  return o.status === 'paid'
}

/* ---------- 履约状态元数据 ---------- */

interface BizStatusMeta {
  label: string
  cls: string
  /** 终态：订单卡不再展示业务操作按钮 */
  terminal: boolean
}

const COMMON_REFUND: BizStatusMeta = { label: '退款中', cls: 'pending', terminal: false }

export const BIZ_STATUS_META: Record<OrderBizStatus, BizStatusMeta> = {
  locked: { label: '已锁库存', cls: 'pending', terminal: false },
  released: { label: '库存已释放', cls: 'closed', terminal: true },
  pending_verify: { label: '待核销', cls: 'pending', terminal: false },
  verified: { label: '已核销', cls: 'done', terminal: true },
  expired: { label: '已过期', cls: 'closed', terminal: true },
  refunding: COMMON_REFUND,
  refunded: { label: '已退款', cls: 'closed', terminal: true },
  pending_ship: { label: '待发货', cls: 'pending', terminal: false },
  shipped: { label: '已发货', cls: 'done', terminal: true },
  pending_ticket: { label: '待出票', cls: 'pending', terminal: false },
  ticketed: { label: '已出票', cls: 'done', terminal: false },
  traveled: { label: '已完成出行', cls: 'done', terminal: true },
  changing: { label: '改签中', cls: 'pending', terminal: false },
}

export function bizStatusLabel(s: OrderBizStatus | undefined): string {
  return s ? BIZ_STATUS_META[s].label : ''
}

export function bizStatusTerminal(s: OrderBizStatus | undefined): boolean {
  return s ? BIZ_STATUS_META[s].terminal : false
}

/** 安全读取业务扩展：类型不匹配返回 null（防止半残数据进入业务分支） */
export function readOrderExt(ext: OrderExt | undefined, kind: OrderExt['kind']): OrderExt | null {
  if (!ext || ext.kind !== kind) return null
  return ext
}

export function isBizOrder(o: MallOrder): boolean {
  return !!o.bizKind && !!o.ext
}

/* ---------- 金额计算 ---------- */

/** 购物车行单价：业务成交价优先，其次目录价 */
export function unitPriceFen(item: MallCartItem, goods: MallGoods | undefined): number {
  return item.priceFen ?? goods?.priceFen ?? 0
}

/** 结算总额（分）：Σ 行单价 × 数量 */
export function cartTotalFen(items: MallCartItem[], goods: MallGoods[]): number {
  const byId = new Map(goods.map((g) => [g.id, g]))
  return items.reduce((sum, c) => sum + unitPriceFen(c, byId.get(c.goodsId)) * c.qty, 0)
}

export function cartQty(items: MallCartItem[]): number {
  return items.reduce((sum, c) => sum + c.qty, 0)
}

/** 购物车合并键：业务行永不与普通行合并 */
export function cartKey(item: MallCartItem): string {
  return `${item.goodsId}|${item.spec ?? ''}|${item.ext ? 'biz' : 'std'}`
}

/** 支付返积分：订单金额的 5%（向下取整，单位与积分体系一致为「分」） */
export function rewardPoints(amountFen: number): number {
  return Math.floor((amountFen / 100) * 0.05)
}

/* ---------- 建单 ---------- */

export interface PlaceOrderInput {
  goodsId: string
  title: string
  emoji: string
  priceFen: number
  qty: number
  ext?: OrderExt
}

export function buildOrder(input: PlaceOrderInput, now = Date.now()): MallOrder {
  const ext = input.ext
  return {
    id: `MO-${now}`,
    goodsId: input.goodsId,
    title: input.title,
    emoji: input.emoji,
    amountFen: Math.round(input.priceFen * input.qty),
    qty: input.qty,
    channel: ext ? channelOf(ext) : 'youxuan',
    status: 'unpaid',
    at: now,
    ...(ext ? { bizKind: ext.kind, ext, bizStatus: initialBizStatus(ext) } : {}),
  }
}

function channelOf(ext: OrderExt): MallOrder['channel'] {
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

/* ---------- 订单列表筛选 ---------- */

export function filterOrders(orders: MallOrder[], status: OrderStatus | 'all'): MallOrder[] {
  return status === 'all' ? orders : orders.filter((o) => o.status === status)
}

/** 反序列化校验：有 bizKind 但 ext 不合法的「半残数据」整条丢弃 */
export function isValidOrder(o: MallOrder): boolean {
  if (!o.bizKind) return true
  return !!o.ext && o.ext.kind === o.bizKind
}
