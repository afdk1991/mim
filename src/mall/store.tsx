/* 商城中台：统一钱包 / 积分 / 购物车 / 订单状态。
   全局通用电商流程——五个旧商城（优选/秒杀/本地生活/直播/代驾）
   在这里收敛为「频道」分类标签，不保留各自独特交互。
   数据归属：积分/购物车/订单按真实登录身份隔离（mim-mall-v2:<userId>）。
   商品唯一来源为云端 products 表；不含任何演示商品/演示订单/演示积分。
   轮 15 打通：余额不再独立存储，统一镜像 mim-wallet-v1（getWalletState），
   支付走 walletConsume 真实扣费；充值不再由本模块直接加钱，
   改由 MallWallet 走「扫码付款 + 凭证 + 管理员核销」后调用 walletRecharge 入账。
   轮 17：支付通道适配（src/mall/payment.ts）——钱包余额 + 收款码扫码人工确认
   （付款凭证 → awaiting_confirm → 管理员口令核销），为后续聚合支付预留通道位。
   轮 26 扩展：四大业务（秒杀/本地生活/直播尖货/出行服务）接入同一条链路——
   商品、购物车、订单、支付仍是唯一一套，业务独有字段挂在 MallOrder.ext（OrderExt），
   履约语义走 bizStatus，与主状态正交。ext 为 undefined 的普通订单行为完全不变。 */

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { emitToast } from '../components'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { pullToolState, pushToolState } from '../lib/tool-cloud'
import { WALLET_UPDATE_EVT, getWalletState, walletConsume, hydrateWallet } from '../wallet'
import { mallConfirm, mallUpsertOrder } from '../lib/bizApi'
import { initialBizStatus, channelOfBiz } from './biz/types'
import type { BizKind, OrderBizStatus, OrderExt } from './biz/types'
import type { PayChannelId, PayProof } from './payment'

export type MallChannel = 'youxuan' | 'gexm' | 'mix' | 'live' | 'laal'

export type MallGoods = {
  id: string
  channel: MallChannel
  title: string
  emoji: string
  price: number
  origPrice?: number
  desc: string
}

/** 购物车行：price 为业务成交单价覆盖（秒杀价/直播价），缺省取商品目录价 */
export type MallCartItem = { goodsId: string; qty: number; spec?: string; price?: number; ext?: OrderExt }

export type MallOrder = {
  id: string
  goodsId: string
  title: string
  emoji: string
  amount: number
  qty: number
  channel: MallChannel
  /* awaiting_confirm：扫码人工确认通道已提交付款凭证，等待管理员核销（必有 proof） */
  status: 'unpaid' | 'awaiting_confirm' | 'paid' | 'done'
  at: number
  payChannel?: PayChannelId
  proof?: PayProof
  /* ---- 业务扩展（四大业务；普通实物订单三项均为 undefined，行为不变） ---- */
  bizKind?: BizKind
  ext?: OrderExt
  /** 履约状态（到店核销 / 出票 / 退改…），与 status 正交 */
  bizStatus?: OrderBizStatus
}

export type MallState = {
  wallet: number
  points: number
  cart: MallCartItem[]
  orders: MallOrder[]
}

export const MALL_CHANNEL_META: Record<MallChannel, { emoji: string; label: string }> = {
  youxuan: { emoji: '🎁', label: '优选好物' },
  gexm: { emoji: '⚡', label: '秒杀特惠' },
  mix: { emoji: '🍜', label: '本地生活' },
  live: { emoji: '📺', label: '直播尖货' },
  laal: { emoji: '🚗', label: '出行服务' },
}

/* ------------------------------------------------------------------ */
/* 商品目录：云端 products 表为唯一来源（无任何内置演示商品）            */
/* ------------------------------------------------------------------ */

/**
 * 商品目录唯一来源为云端 products 表（迁移 0005_mall_catalog.sql 补齐
 * channel/emoji/description/original_price_cents 字段）。
 * 云端不可用或无在售商品时，商城显示空态 + 发布引导，不兜底任何演示商品。
 */

/** 云端商品行形态（products 表；channel/emoji/description/original_price_cents 由迁移 0005 补齐） */
export type ProductRow = {
  id: string
  title: string
  price_cents: number
  original_price_cents?: number | null
  channel?: string | null
  emoji?: string | null
  description?: string | null
}

const MALL_CHANNEL_IDS: MallChannel[] = ['youxuan', 'gexm', 'mix', 'live', 'laal']

function asChannel(v: unknown): MallChannel {
  return typeof v === 'string' && (MALL_CHANNEL_IDS as string[]).includes(v) ? (v as MallChannel) : 'youxuan'
}

/** 云端商品行 → MallGoods。金额单位为「分」，前端统一用「元」。 */
export function mapProduct(row: ProductRow): MallGoods {
  const price = Math.max(0, Math.round((Number(row.price_cents) || 0) / 100))
  const goods: MallGoods = {
    id: String(row.id ?? ''),
    channel: asChannel(row.channel),
    title: String(row.title ?? '未命名商品'),
    emoji: String(row.emoji ?? '📦'),
    price,
    desc: String(row.description ?? ''),
  }
  const orig = Number(row.original_price_cents)
  // 原价必须高于现价才有展示意义，避免脏数据显示「划线价比现价还低」
  if (Number.isFinite(orig) && orig > 0) {
    const origYuan = Math.round(orig / 100)
    if (origYuan > price) goods.origPrice = origYuan
  }
  return goods
}

/** 模块级缓存：路由来回切换不重复打云端（商品目录变更频率低） */
let cloudGoodsCache: MallGoods[] | null = null
/** 是否已尝试过拉取（失败也算）：迁移未应用时 products 表不存在，
 *  不缓存失败会让用户每进一次商城就多打一次 404 */
let cloudGoodsChecked = false
/** 并发去重：多个组件同时挂载时共用同一个请求 */
let cloudGoodsPromise: Promise<MallGoods[] | null> | null = null

/** 取云端商品（带并发去重 + 结果/失败双重缓存） */
function loadCloudGoods(): Promise<MallGoods[] | null> {
  if (cloudGoodsChecked) return Promise.resolve(cloudGoodsCache)
  if (!cloudGoodsPromise) {
    cloudGoodsPromise = fetchCloudGoods().then((goods) => {
      cloudGoodsChecked = true
      cloudGoodsCache = goods
      cloudGoodsPromise = null
      return goods
    })
  }
  return cloudGoodsPromise
}

/**
 * 拉取云端在售商品。
 * @returns 商品数组；表/列缺失、查询失败或无在售商品时返回 null（交由调用方兜底）
 */
export async function fetchCloudGoods(): Promise<MallGoods[] | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, title, price_cents, original_price_cents, channel, emoji, description, sort')
      .eq('status', 'active')
      .order('sort', { ascending: true })
      .limit(200)
    if (error || !Array.isArray(data)) return null
    const goods = (data as ProductRow[]).filter((r) => r && r.id).map(mapProduct)
    return goods.length > 0 ? goods : null
  } catch {
    return null
  }
}

/**
 * 商品目录：云端有数据时用云端，否则为空（空态 + 发布引导）。
 * 无云端商品缓存时发起一次拉取，拉取失败即为空态。
 */
export function useMallGoods(): { goods: MallGoods[]; fromCloud: boolean; loading: boolean } {
  const [cloudGoods, setCloudGoods] = useState<MallGoods[] | null>(cloudGoodsCache)
  const [loading, setLoading] = useState(cloudGoodsCache === null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const goods = await loadCloudGoods()
      if (!alive) return
      setCloudGoods(goods)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  // 云端拿到真实商品即用云端数据；否则空态，不兜底演示商品
  if (cloudGoods && cloudGoods.length > 0) {
    return { goods: cloudGoods, fromCloud: true, loading }
  }
  return { goods: [], fromCloud: false, loading }
}

/**
 * 当前可用商品全集：云端缓存（无缓存即为空）。
 * 供购物车校验 / 结算等非 React 上下文使用（组件请用 useMallGoods）。
 */
function currentGoods(): MallGoods[] {
  return cloudGoodsCache ?? []
}

/* 按真实身份隔离的存储 key（v2：随演示数据清除换代，旧 v1 存档整体作废） */
const mallKeyFor = (userId: string) => `mim-mall-v2:${userId}`

/** 订单 → 云端 mall_orders 列（snake_case，兼容 postgREST / CloudBase PG） */
function toCloudOrder(o: MallOrder): Record<string, unknown> {
  return {
    id: o.id,
    goods_id: o.goodsId,
    title: o.title,
    emoji: o.emoji,
    amount: o.amount,
    qty: o.qty,
    channel: o.channel,
    status: o.status,
    pay_channel: o.payChannel ?? null,
    proof: o.proof ?? null,
    /* 迁移 0012 新增列；未应用时整行会被拒，由 cloud-write 的缺列降级自动裁剪 */
    biz_kind: o.bizKind ?? null,
    ext: o.ext ?? null,
    biz_status: o.bizStatus ?? null,
  }
}

function seedState(): MallState {
  return {
    /* 轮 15 并轨：余额镜像统一钱包（分→元取整展示），不再本地独立记账 */
    wallet: Math.round(getWalletState().balanceFen / 100),
    points: 0,
    cart: [],
    orders: [],
  }
}

const isChannel = (v: unknown): v is MallChannel =>
  v === 'youxuan' || v === 'gexm' || v === 'mix' || v === 'live' || v === 'laal'

const isCartItem = (c: unknown): c is MallCartItem =>
  !!c &&
  typeof c === 'object' &&
  typeof (c as MallCartItem).goodsId === 'string' &&
  typeof (c as MallCartItem).qty === 'number'

const isOrder = (it: unknown): it is MallOrder => {
  if (!it || typeof it !== 'object') return false
  const r = it as Partial<MallOrder>
  /* 业务扩展三件套：要么全无（普通订单），要么有 ext 且 kind 合法；
     半残数据（有 bizKind 无 ext）视为脏数据丢弃，避免订单页渲染出无源状态 */
  const ext = r.ext
  const extOk =
    ext === undefined ||
    (!!ext &&
      typeof ext === 'object' &&
      (ext.kind === 'seckill' || ext.kind === 'local' || ext.kind === 'live' || ext.kind === 'travel'))
  const bizOk = extOk && (r.bizStatus === undefined || typeof r.bizStatus === 'string')
  return (
    typeof r.id === 'string' &&
    typeof r.goodsId === 'string' &&
    typeof r.title === 'string' &&
    typeof r.emoji === 'string' &&
    typeof r.amount === 'number' &&
    typeof r.qty === 'number' &&
    isChannel(r.channel) &&
    (r.status === 'unpaid' || r.status === 'awaiting_confirm' || r.status === 'paid' || r.status === 'done') &&
    typeof r.at === 'number' &&
    bizOk
  )
}

/* 逐字段校验：任一异常回退对应字段的 seed 值（参照 store.tsx loadState 先例） */
function loadMallFor(userId: string): MallState {
  const base = seedState()
  const key = mallKeyFor(userId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return base
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return base
    const o = v as Record<string, unknown>
    if (typeof o.points === 'number' && Number.isFinite(o.points)) base.points = o.points
    /* 轮 15 并轨：余额以统一钱包为准，不再读取本地旧值（wallet 字段仅为展示镜像） */
    if (Array.isArray(o.cart)) base.cart = o.cart.filter(isCartItem)
    if (Array.isArray(o.orders)) base.orders = o.orders.filter(isOrder)
    return base
  } catch {
    return base
  }
}

/** 业务直接下单入参（秒杀抢购 / 券购买 / 直播下单 / 出行占座统一入口） */
export type PlaceBizInput = {
  goodsId: string
  title: string
  emoji: string
  /** 成交单价（元）：秒杀价 / 券价 / 直播专享价 / 日期票价 */
  price: number
  qty: number
  ext: OrderExt
  /**
   * 服务端占库存回调（拿到订单号后执行：seckill_grab / travel_book）。
   * 回调抛错即放弃建单 —— 库存没占到就不该产生订单，避免「下单成功但无库存」。
   */
  hold?: (orderId: string) => Promise<void>
}

type MallApi = {
  state: MallState
  /** @param biz 业务成交单价与扩展（省略即普通实物商品，走目录价） */
  addToCart: (goodsId: string, qty?: number, spec?: string, biz?: { price?: number; ext?: OrderExt }) => void
  setCartQty: (goodsId: string, spec: string | undefined, qty: number) => void
  removeFromCart: (goodsId: string, spec?: string) => void
  clearCart: () => void
  /** 购物车合并为一笔 unpaid 订单（不扣钱，payOrder 时才扣）；业务行按其 ext 归入对应频道 */
  checkout: () => MallOrder | null
  /**
   * 业务直接下单：先让服务端占住库存（hold），成功才建单。
   * 与普通 checkout 的区别：库存/场次资格由服务端裁定，失败即无订单。
   * @returns 订单；hold 失败返回 null（已 toast 服务端原因）
   */
  placeBizOrder: (input: PlaceBizInput) => Promise<MallOrder | null>
  /** 推进履约状态（核销 / 出票 / 退票…）；与资金状态互不干扰 */
  setBizStatus: (id: string, bizStatus: OrderBizStatus) => void
  /** 覆写业务扩展（如支付后回填服务端下发的券码）；整段替换便于联合类型收窄 */
  setBizExt: (id: string, ext: OrderExt) => void
  /** 校验 unpaid + 统一钱包扣费成功 → 返 5% 积分 → paid；失败返回 false */
  payOrder: (id: string) => boolean
  /** 扫码人工确认通道：提交付款凭证（unpaid → awaiting_confirm，等待管理员核销） */
  submitPayProof: (id: string, method: string, ref: string) => void
  /** 管理员凭口令确认收款（awaiting_confirm → paid，返 5% 积分）；
   *  口令校验改在服务端（mim-api /mall/confirm）进行，前端只透传用户输入，永不下发/比对口令。 */
  confirmManualPay: (id: string, key: string) => Promise<boolean>
  /** 取消 unpaid 订单（演示简化：直接从订单列表移除） */
  cancelOrder: (id: string) => void
  confirmOrder: (id: string) => void
}

const MallContext = createContext<MallApi | null>(null)

export function MallProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth()
  const userId = auth.userId
  const storageKey = mallKeyFor(userId)
  const [state, setState] = useState<MallState>(() => loadMallFor(userId))

  // 真实身份变化（登录/退出/云端会话切换）时重载该身份的钱包数据
  useEffect(() => {
    setState(loadMallFor(userId))
    // 钱包后端化：切号时从云端拉取权威余额（云端优先 + localStorage 降级）
    void hydrateWallet(userId)
    // 云端恢复（轮 6）：拉取该身份快照 → 写回本地 → 重载（云 key 统一 mim-mall-v2，表按 user_id 隔离）
    void pullToolState('mim-mall-v2').then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(mallKeyFor(userId), JSON.stringify(d)) } catch { /* ignore */ }
      setState(loadMallFor(userId))
    })
  }, [userId])

  /* 轮 15 并轨：统一钱包（mim-wallet-v1）变更时同步余额镜像（含本模块消费/充值触发的广播） */
  useEffect(() => {
    const sync = () => setState((s) => ({ ...s, wallet: Math.round(getWalletState().balanceFen / 100) }))
    window.addEventListener(WALLET_UPDATE_EVT, sync)
    sync() // 挂载即以统一钱包为准校准一次
    return () => window.removeEventListener(WALLET_UPDATE_EVT, sync)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      /* ignore */
    }
    pushToolState('mim-mall-v2', state) // 云端整包快照（未登录/未配置时静默跳过）
  }, [state, storageKey])

  const api: MallApi = {
    state,
    addToCart(goodsId, qty = 1, spec, biz) {
      setState((s) => {
        const i = s.cart.findIndex((c) => c.goodsId === goodsId && c.spec === spec)
        if (i < 0) return { ...s, cart: [...s.cart, { goodsId, qty, spec, ...biz }] }
        const cur = s.cart[i]
        if (!cur) return s
        const cart = s.cart.slice()
        // 业务行（有 ext）不与普通行合并：秒杀价与目录价混在一行会算错钱
        if (cur.ext || biz?.ext) {
          cart.push({ goodsId, qty, spec, ...biz })
          return { ...s, cart }
        }
        cart[i] = { ...cur, qty: cur.qty + qty }
        return { ...s, cart }
      })
    },
    setCartQty(goodsId, spec, qty) {
      setState((s) => ({
        ...s,
        cart:
          qty <= 0
            ? s.cart.filter((c) => !(c.goodsId === goodsId && c.spec === spec))
            : s.cart.map((c) => (c.goodsId === goodsId && c.spec === spec ? { ...c, qty } : c)),
      }))
    },
    removeFromCart(goodsId, spec) {
      setState((s) => ({ ...s, cart: s.cart.filter((c) => !(c.goodsId === goodsId && c.spec === spec)) }))
    },
    clearCart() {
      setState((s) => ({ ...s, cart: [] }))
    },
    checkout() {
      const head = state.cart[0]
      if (!head) return null
      const goods = currentGoods()
      const first = goods.find((g) => g.id === head.goodsId)
      if (!first) return null
      /* 业务行按成交单价（price）计价，普通行按目录价 */
      const unitPrice = (c: MallCartItem) => c.price ?? goods.find((g) => g.id === c.goodsId)?.price ?? 0
      const amount = state.cart.reduce((sum, c) => sum + unitPrice(c) * c.qty, 0)
      const qty = state.cart.reduce((sum, c) => sum + c.qty, 0)
      /* 业务归属：任一行带 ext 即以该业务的频道落单（业务单不跨业务混单） */
      const bizLine = state.cart.find((c) => c.ext)
      const ext = bizLine?.ext
      const order: MallOrder = {
        id: `MO-${Date.now()}`,
        goodsId: first.id,
        title: state.cart.length === 1 ? first.title : `${first.title} 等${state.cart.length}种`,
        emoji: first.emoji,
        amount,
        qty,
        channel: ext ? channelOfBiz(ext) : first.channel,
        status: 'unpaid',
        at: Date.now(),
      }
      if (ext) {
        order.bizKind = ext.kind
        order.ext = ext
        order.bizStatus = initialBizStatus(ext)
      }
      setState((s) => ({ ...s, orders: [order, ...s.orders], cart: [] }))
      // 云端持久化订单（真源从 localStorage 挪到数据库，按 user_id 隔离）
      void mallUpsertOrder(toCloudOrder(order)).catch(() => {})
      return order
    },
    async placeBizOrder(input) {
      const id = `MO-${Date.now()}`
      // 先占库存：服务端裁定失败（售罄/未开抢/超限/不可退…）即不建单
      if (input.hold) {
        try {
          await input.hold(id)
        } catch (e) {
          emitToast(`下单失败：${(e as Error).message}`)
          return null
        }
      }
      const ext = input.ext
      const order: MallOrder = {
        id,
        goodsId: input.goodsId,
        title: input.title,
        emoji: input.emoji,
        amount: Math.round(input.price * input.qty),
        qty: input.qty,
        channel: channelOfBiz(ext),
        status: 'unpaid',
        at: Date.now(),
        bizKind: ext.kind,
        ext,
        bizStatus: initialBizStatus(ext),
      }
      setState((s) => ({ ...s, orders: [order, ...s.orders] }))
      void mallUpsertOrder(toCloudOrder(order)).catch(() => {})
      return order
    },
    setBizStatus(id, bizStatus) {
      const cur = state.orders.find((o) => o.id === id)
      if (!cur) return
      const next: MallOrder = { ...cur, bizStatus }
      setState((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? next : o)) }))
      void mallUpsertOrder(toCloudOrder(next)).catch(() => {})
    },
    setBizExt(id, ext) {
      const cur = state.orders.find((o) => o.id === id)
      if (!cur) return
      const next: MallOrder = { ...cur, ext, bizKind: ext.kind }
      setState((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? next : o)) }))
      void mallUpsertOrder(toCloudOrder(next)).catch(() => {})
    },
    payOrder(id) {
      const order = state.orders.find((o) => o.id === id)
      /* 轮 15 并轨：真实扣统一钱包 mim-wallet-v1（余额不足内部已 toast，订单保持 unpaid 可充值后再付） */
      if (!order || order.status !== 'unpaid') return false
      if (!walletConsume(order.amount * 100, `商城订单 ${order.title}（${order.qty} 件）`)) return false
      setState((s) => ({
        ...s,
        points: s.points + Math.floor(order.amount * 0.05),
        orders: s.orders.map((o) => (o.id === id ? { ...o, status: 'paid' } : o)),
      }))
      return true
    },
    submitPayProof(id, method, ref) {
      const cur = state.orders.find((o) => o.id === id && o.status === 'unpaid')
      if (!cur) return
      const updated: MallOrder = {
        ...cur,
        status: 'awaiting_confirm',
        payChannel: 'qrcode-manual',
        proof: { method, ref, at: Date.now() },
      }
      setState((s) => ({
        ...s,
        orders: s.orders.map((o) => (o.id === id && o.status === 'unpaid' ? updated : o)),
      }))
      void mallUpsertOrder(toCloudOrder(updated)).catch(() => {})
    },
    async confirmManualPay(id, key) {
      const order = state.orders.find((o) => o.id === id && o.status === 'awaiting_confirm')
      if (!order) return false
      // P0-1 资金安全：口令校验改在服务端（mim-api /mall/confirm）进行，前端只透传。
      // 服务端完成 admin 鉴权 + 口令比对 + 状态机转移 awaiting_confirm → paid。
      try {
        await mallConfirm(order.id, key)
      } catch (e) {
        emitToast(`核销失败：${(e as Error).message}`)
        return false
      }
      setState((s) => ({
        ...s,
        points: s.points + Math.floor(order.amount * 0.05),
        orders: s.orders.map((o) =>
          o.id === id && o.status === 'awaiting_confirm' ? { ...o, status: 'paid' } : o,
        ),
      }))
      return true
    },
    cancelOrder(id) {
      setState((s) => ({ ...s, orders: s.orders.filter((o) => !(o.id === id && o.status === 'unpaid')) }))
    },
    confirmOrder(id) {
      setState((s) => ({
        ...s,
        orders: s.orders.map((o) => (o.id === id && o.status === 'paid' ? { ...o, status: 'done' } : o)),
      }))
    },
  }

  return <MallContext.Provider value={api}>{children}</MallContext.Provider>
}

export function useMall(): MallApi {
  const v = useContext(MallContext)
  if (!v) throw new Error('useMall must be used within MallProvider')
  return v
}
