/* ==========================================================================
 * 商城状态 —— 购物车 / 订单 / 结算链路
 *
 * 铁律（重建加固的两点）：
 *  1. 业务下单必须先「占库存」再建单：hold 抛错即放弃，
 *     绝不允许产生「下单成功但没库存」的订单。
 *  2. 取消订单必须释放已占资源（秒杀锁、出行日期库存），
 *     原实现只释放了秒杀，出行库存会被取消单永久占用。
 * ========================================================================== */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  MallCartItem,
  MallGoods,
  MallOrder,
  OrderBizStatus,
  OrderExt,
  OrderStatus,
} from '../../domain/commerce/model'
import { MALL_CHANNEL_META } from '../../domain/commerce/model'
import { buildOrder, isValidOrder, rewardPoints, unitPriceFen } from '../../domain/commerce/order'
import { BIZ_HOLD_RPC, BIZ_RELEASE_RPC } from '../../domain/commerce/biz/registry'
import { errText } from '../../core/result'
import { emit, EVT } from '../../core/events'
import { loadSnapshot, saveSnapshot } from '../../data/sync'
import { db } from '../../data/client'
import { emitToast } from '../../ui'
import { walletConsume } from './wallet'

const SCOPE = 'mall'

export interface MallState {
  cart: MallCartItem[]
  orders: MallOrder[]
  points: number
}

const EMPTY: MallState = { cart: [], orders: [], points: 0 }

function parseMall(raw: unknown): MallState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const cart = Array.isArray(r.cart)
    ? (r.cart as MallCartItem[]).filter((c) => c && typeof c.goodsId === 'string' && typeof c.qty === 'number')
    : []
  const orders = Array.isArray(r.orders)
    ? (r.orders as MallOrder[]).filter((o) => o && typeof o.id === 'string' && isValidOrder(o))
    : []
  return { cart, orders, points: typeof r.points === 'number' ? r.points : 0 }
}

export interface PlaceBizInput {
  goodsId: string
  title: string
  emoji: string
  priceFen: number
  qty: number
  ext?: OrderExt
  /** 服务端占库存回调；抛错即放弃建单 */
  hold?: (orderId: string) => Promise<void>
}

export interface MallApi {
  state: MallState
  goods: MallGoods[]
  goodsLoading: boolean
  goodsFromCloud: boolean
  addToCart: (goodsId: string, qty?: number, spec?: string, biz?: { priceFen?: number; ext?: OrderExt }) => void
  setCartQty: (goodsId: string, spec: string | undefined, qty: number) => void
  removeFromCart: (goodsId: string, spec?: string) => void
  clearCart: () => void
  checkout: () => MallOrder | null
  placeBizOrder: (input: PlaceBizInput) => Promise<MallOrder | null>
  payOrder: (id: string) => boolean
  submitPayProof: (id: string, method: string, ref: string) => void
  cancelOrder: (id: string) => void
  confirmOrder: (id: string) => void
  setBizStatus: (id: string, s: OrderBizStatus) => void
  setBizExt: (id: string, ext: OrderExt) => void
  cartTotalFen: (goods: MallGoods[]) => number
}

const MallCtx = createContext<MallApi | null>(null)

/* ---------- 商品目录：云端唯一来源，空即空态 ---------- */

interface ProductRow {
  id?: unknown
  title?: unknown
  price_cents?: unknown
  original_price_cents?: unknown
  channel?: unknown
  emoji?: unknown
  description?: unknown
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)

function mapProduct(r: ProductRow): MallGoods | null {
  if (typeof r.id !== 'string' || !r.id) return null
  const ch = str(r.channel)
  const channel = ch in MALL_CHANNEL_META ? (ch as MallGoods['channel']) : 'youxuan'
  const price = num(r.price_cents, 0)
  const orig = num(r.original_price_cents, 0)
  return {
    id: r.id,
    channel,
    title: str(r.title, '未命名商品'),
    emoji: str(r.emoji, '📦'),
    priceFen: Math.max(0, Math.round(price)),
    // 脏数据防护：原价不高于售价时不展示划线价
    ...(orig > price ? { origPriceFen: Math.round(orig) } : {}),
    desc: str(r.description),
  }
}

export function MallProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MallState>(() => loadSnapshot(SCOPE, parseMall, EMPTY))
  const [goods, setGoods] = useState<MallGoods[]>([])
  const [goodsLoading, setGoodsLoading] = useState(true)
  const [goodsFromCloud, setGoodsFromCloud] = useState(false)
  const ref = useRef(state)
  ref.current = state

  useEffect(() => {
    saveSnapshot(SCOPE, state)
    emit(EVT.mall)
  }, [state])

  /* 商品目录：失败也缓存结果，避免表未就绪时每次进页面都打一次请求 */
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await db.list<ProductRow>('products', {
        eq: [['status', 'active']],
        order: { col: 'sort', asc: true },
        limit: 200,
      })
      if (!alive) return
      setGoodsLoading(false)
      if (!r.ok) {
        setGoods([])
        setGoodsFromCloud(false)
        return
      }
      setGoods(r.data.map(mapProduct).filter((g): g is MallGoods => g !== null))
      setGoodsFromCloud(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  const upsertOrder = useCallback((o: MallOrder) => {
    void db.rpc('mall_upsert_order', { p_order: toCloud(o) }, { write: true })
  }, [])

  const api = useMemo<MallApi>(() => {
    const patch = (fn: (s: MallState) => MallState): void => setState((s) => fn(s))

    return {
      state,
      goods,
      goodsLoading,
      goodsFromCloud,

      addToCart(goodsId, qty = 1, spec, biz) {
        patch((s) => {
          const i = s.cart.findIndex(
            (c) => c.goodsId === goodsId && c.spec === spec && !!c.ext === !!biz?.ext,
          )
          if (i < 0) {
            return {
              ...s,
              cart: [
                ...s.cart,
                {
                  goodsId,
                  qty,
                  ...(spec ? { spec } : {}),
                  ...(biz?.priceFen !== undefined ? { priceFen: biz.priceFen } : {}),
                  ...(biz?.ext ? { ext: biz.ext } : {}),
                },
              ],
            }
          }
          const cart = s.cart.slice()
          cart[i] = { ...cart[i]!, qty: cart[i]!.qty + qty }
          return { ...s, cart }
        })
      },

      setCartQty(goodsId, spec, qty) {
        patch((s) => ({
          ...s,
          cart:
            qty <= 0
              ? s.cart.filter((c) => !(c.goodsId === goodsId && c.spec === spec))
              : s.cart.map((c) => (c.goodsId === goodsId && c.spec === spec ? { ...c, qty } : c)),
        }))
      },

      removeFromCart(goodsId, spec) {
        patch((s) => ({
          ...s,
          cart: s.cart.filter((c) => !(c.goodsId === goodsId && (spec === undefined || c.spec === spec))),
        }))
      },

      clearCart() {
        patch((s) => ({ ...s, cart: [] }))
      },

      checkout() {
        const head = ref.current.cart[0]
        if (!head) return null
        const g = goods.find((x) => x.id === head.goodsId)
        if (!g) return null
        const order = buildOrder({
          goodsId: g.id,
          title: ref.current.cart.length === 1 ? g.title : `${g.title} 等${ref.current.cart.length}种`,
          emoji: g.emoji,
          priceFen: unitPriceFen(head, g),
          qty: ref.current.cart.reduce((n, c) => n + c.qty, 0),
          ...(head.ext ? { ext: head.ext } : {}),
        })
        patch((s) => ({ ...s, orders: [order, ...s.orders], cart: [] }))
        upsertOrder(order)
        return order
      },

      async placeBizOrder(input) {
        const id = `MO-${Date.now()}`
        // 先占库存：失败即不建单
        if (input.hold) {
          try {
            await input.hold(id)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            emitToast(`下单失败：${msg}`)
            return null
          }
        }
        const order = buildOrder({
          goodsId: input.goodsId,
          title: input.title,
          emoji: input.emoji,
          priceFen: input.priceFen,
          qty: input.qty,
          ...(input.ext ? { ext: input.ext } : {}),
        })
        const final: MallOrder = { ...order, id }
        patch((s) => ({ ...s, orders: [final, ...s.orders] }))
        upsertOrder(final)
        return final
      },

      payOrder(id) {
        const o = ref.current.orders.find((x) => x.id === id)
        if (!o || o.status !== 'unpaid') return false
        if (!walletConsume(o.amountFen, `订单 ${o.title}`)) return false
        const points = rewardPoints(o.amountFen)
        patch((s) => ({
          ...s,
          points: s.points + points,
          orders: s.orders.map((x) => (x.id === id ? { ...x, status: 'paid' as OrderStatus, payChannel: 'wallet' } : x)),
        }))
        const next = ref.current.orders.find((x) => x.id === id)
        if (next) upsertOrder(next)
        return true
      },

      submitPayProof(id, method, ref2) {
        patch((s) => ({
          ...s,
          orders: s.orders.map((o) =>
            o.id === id
              ? {
                  ...o,
                  status: 'awaiting_confirm' as OrderStatus,
                  payChannel: 'qrcode-manual',
                  proof: { method, ref: ref2, at: Date.now() },
                }
              : o,
          ),
        }))
        const next = ref.current.orders.find((x) => x.id === id)
        if (next) upsertOrder(next)
      },

      async cancelOrder(id) {
        const o = ref.current.orders.find((x) => x.id === id)
        if (!o || o.status !== 'unpaid') return
        // 取消必须释放已占资源，否则库存被取消单永久占用
        const rpc = o.ext ? BIZ_RELEASE_RPC[o.ext.kind] : null
        if (rpc && o.ext) {
          const ext = o.ext
          const params =
            ext.kind === 'seckill'
              ? { p_session_id: ext.sessionId, p_order_id: id }
              : ext.kind === 'travel'
                ? { p_ticket_id: ext.ticketId, p_date: ext.date, p_qty: o.qty, p_order_id: id }
                : {}
          try {
            const r = await db.rpc(rpc, params, { write: true })
            if (!r.ok) emitToast(`释放库存失败：${errText(r.error)}`)
          } catch {
            /* 释放失败不阻断取消：服务端有过期兜底 */
          }
        }
        patch((s) => ({ ...s, orders: s.orders.filter((x) => x.id !== id) }))
      },

      confirmOrder(id) {
        patch((s) => ({
          ...s,
          orders: s.orders.map((o) => (o.id === id && o.status === 'paid' ? { ...o, status: 'done' as OrderStatus } : o)),
        }))
        const next = ref.current.orders.find((x) => x.id === id)
        if (next) upsertOrder(next)
      },

      setBizStatus(id, s2) {
        patch((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, bizStatus: s2 } : o)) }))
        const next = ref.current.orders.find((x) => x.id === id)
        if (next) upsertOrder(next)
      },

      setBizExt(id, ext) {
        patch((s) => ({
          ...s,
          orders: s.orders.map((o) => (o.id === id ? { ...o, ext, bizKind: ext.kind } : o)),
        }))
        const next = ref.current.orders.find((x) => x.id === id)
        if (next) upsertOrder(next)
      },

      cartTotalFen(list) {
        const byId = new Map(list.map((g) => [g.id, g]))
        return ref.current.cart.reduce((sum, c) => sum + unitPriceFen(c, byId.get(c.goodsId)) * c.qty, 0)
      },
    }
  }, [state, goods, goodsLoading, goodsFromCloud, upsertOrder])

  return <MallCtx.Provider value={api}>{children}</MallCtx.Provider>
}

function toCloud(o: MallOrder): Record<string, unknown> {
  return {
    id: o.id,
    goods_id: o.goodsId,
    title: o.title,
    emoji: o.emoji,
    amount_fen: o.amountFen,
    qty: o.qty,
    channel: o.channel,
    status: o.status,
    pay_channel: o.payChannel ?? null,
    proof: o.proof ?? null,
    biz_kind: o.bizKind ?? null,
    ext: o.ext ?? null,
    biz_status: o.bizStatus ?? null,
  }
}

export function useMall(): MallApi {
  const v = useContext(MallCtx)
  if (!v) throw new Error('useMall 必须在 MallProvider 内使用')
  return v
}

/** 业务占库存：由页面在 placeBizOrder 的 hold 回调里调用 */
export async function holdBizStock(
  kind: OrderExt['kind'],
  params: Record<string, unknown>,
): Promise<void> {
  const rpc = BIZ_HOLD_RPC[kind]
  if (!rpc) return
  const r = await db.rpc(rpc, params, { write: true })
  if (!r.ok) throw new Error(errText(r.error))
}
