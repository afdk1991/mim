/* 商城中台：统一钱包 / 积分 / 购物车 / 订单状态。
   全局通用电商流程——五个旧商城（优选/秒杀/本地生活/直播/代驾）
   在这里收敛为「频道」分类标签，不保留各自独特交互。
   数据归属：积分/购物车/订单按真实登录身份隔离（mim-mall-v1:<userId>），
   切换演示身份不清数据；老共享 key（mim-mall-v1）一次性幂等迁移。
   轮 15 打通：余额不再独立存储，统一镜像 mim-wallet-v1（getWalletState），
   支付走 walletConsume 真实扣费，充值走 walletRecharge 进统一钱包流水。
   轮 17：支付通道适配（src/mall/payment.ts）——钱包余额 + 收款码扫码人工确认
   （付款凭证 → awaiting_confirm → 管理员口令核销），为后续聚合支付预留通道位。 */

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth'
import { supabase, cloudEnabled, cloudBackend } from '../lib/supabase'
import { pullToolState, pushToolState } from '../lib/tool-cloud'
import { WALLET_UPDATE_EVT, getWalletState, walletConsume, walletRecharge } from '../wallet'
import { checkOperatorKey } from './payment'
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

export type MallCartItem = { goodsId: string; qty: number; spec?: string }

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

/* 统一商品库：五个频道各取代表商品，emoji 占位（项目零图片依赖）。
   云端真实模式不内置任何演示商品（与 data/seed.ts 的双模式一致），
   商品列表走空态 + 「发布自己的商品」引导；纯本地模式保留演示商品作离线回退。 */
const DEMO_GOODS: MallGoods[] = [
  { id: 'y1', channel: 'youxuan', title: '无线蓝牙耳机', emoji: '🎧', price: 129, desc: '半入耳式 长续航' },
  { id: 'y2', channel: 'youxuan', title: '电动牙刷', emoji: '🪥', price: 89, desc: '声波震动 三档模式' },
  { id: 'y3', channel: 'youxuan', title: '保温杯', emoji: '🥤', price: 49, desc: '316不锈钢 24h保温' },
  { id: 'y4', channel: 'youxuan', title: '桌面加湿器', emoji: '💧', price: 69, desc: '静音大雾量 定时断电' },
  { id: 'g1', channel: 'gexm', title: '智能手环', emoji: '⌚', price: 99, origPrice: 199, desc: '心率血氧 运动记录' },
  { id: 'g2', channel: 'gexm', title: '便携榨汁杯', emoji: '🥝', price: 59, origPrice: 129, desc: 'USB充电 六叶刀头' },
  { id: 'g3', channel: 'gexm', title: '电竞鼠标', emoji: '🖱️', price: 79, origPrice: 159, desc: '16000DPI RGB灯效' },
  { id: 'm1', channel: 'mix', title: '双人火锅套餐', emoji: '🍲', price: 168, desc: '招牌锅底 三荤三素' },
  { id: 'm2', channel: 'mix', title: '精品洗车券', emoji: '🚿', price: 39, desc: '内外清洗 免费吸尘' },
  { id: 'm3', channel: 'mix', title: '影院通票', emoji: '🎬', price: 45, desc: '全国通用 有效期90天' },
  { id: 'l1', channel: 'live', title: '唇釉礼盒', emoji: '💄', price: 99, desc: '直播间专供 五色装' },
  { id: 'l2', channel: 'live', title: '零食大礼包', emoji: '🍫', price: 68, desc: '30包混装 追剧必备' },
  { id: 'l3', channel: 'live', title: '露营折叠椅', emoji: '🏕️', price: 118, desc: '铝合金骨架 承重120kg' },
  { id: 'a1', channel: 'laal', title: '机场接送券', emoji: '🛫', price: 128, desc: '24h预约 全城可达' },
  { id: 'a2', channel: 'laal', title: '代驾畅行卡', emoji: '🚗', price: 98, desc: '10次抵扣 全国可用' },
]
/* 纯本地/离线模式（cloudBackend==='local'，即未配置任一云端后端或被显式指定 local）
   保留演示商品作离线回退；云端模式（supabase/cloudbase）不预置演示商品，
   商品列表走空态 + 发布引导（与 data/seed.ts 的双模式一致）。
   注：此前误用恒真的 cloudEnabled 作判据，导致本地演示商品永远不可达，此处修正。 */
export const MALL_GOODS: MallGoods[] = cloudBackend === 'local' ? DEMO_GOODS : []

/* ------------------------------------------------------------------ */
/* 商品目录：云端优先 + 本地演示兜底                                    */
/* ------------------------------------------------------------------ */

/**
 * 云端商品目录（products 表）此前是死数据：
 *   · 0001 建的 products 只有 (id, title, price_cents, currency, status)，
 *     缺前端 MallGoods 必需的 channel / emoji / description / 原价；
 *   · 且从未灌过任何商品 → 云端模式下 MALL_GOODS 恒为 []，商城永远空态。
 * 迁移 0005_mall_catalog.sql 补齐了字段与五频道种子数据，
 * 本段负责把云端商品真正接进前端，并在云端不可用/为空时兜底演示商品，
 * 保证商城在任何后端状态下都可用（「前后端数据交互正常」的落点）。
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
 * 商品目录：云端有数据时用云端，否则回退本地演示商品。
 * 纯本地模式直接返回演示商品，不发起任何云端请求。
 */
export function useMallGoods(): { goods: MallGoods[]; fromCloud: boolean; loading: boolean } {
  const [cloudGoods, setCloudGoods] = useState<MallGoods[] | null>(cloudGoodsCache)
  const [loading, setLoading] = useState(cloudBackend !== 'local' && cloudGoodsCache === null)

  useEffect(() => {
    if (cloudBackend === 'local') {
      setLoading(false)
      return
    }
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

  // 云端拿到真实商品即用云端数据；否则兜底演示商品，保证商城永远可用
  if (cloudGoods && cloudGoods.length > 0) {
    return { goods: cloudGoods, fromCloud: true, loading }
  }
  return { goods: DEMO_GOODS, fromCloud: false, loading }
}

/**
 * 当前可用商品全集：云端缓存优先，否则演示商品。
 * 供购物车校验 / 结算等非 React 上下文使用（组件请用 useMallGoods）。
 *
 * 修复要点：此处若沿用 MALL_GOODS（云端模式下恒为 []），会导致
 *   ① 购物车条目被校验逻辑全量清空（用户加购后购物车秒空）
 *   ② checkout() 取不到首件商品直接返回 null → 结算完全不可用
 *   ③ 订单金额为 0
 */
function currentGoods(): MallGoods[] {
  return cloudGoodsCache && cloudGoodsCache.length > 0 ? cloudGoodsCache : DEMO_GOODS
}

/* 旧共享 key（迁移源）与按真实身份隔离的存储 key */
const LEGACY_KEY = 'mim-mall-v1'
const mallKeyFor = (userId: string) => `mim-mall-v1:${userId}`

function seedState(): MallState {
  // 云端真实模式：不预填假余额/演示订单（与 data/seed.ts 的云端空种子一致）
  if (cloudEnabled) return { wallet: 0, points: 0, cart: [], orders: [] }
  const now = Date.now()
  return {
    /* 轮 15 并轨：余额镜像统一钱包（分→元取整展示），不再本地独立记账 */
    wallet: Math.round(getWalletState().balanceFen / 100),
    points: 6666,
    cart: [],
    orders: [
      {
        id: 'MO-DEMO1',
        goodsId: 'y1',
        title: '无线蓝牙耳机',
        emoji: '🎧',
        amount: 129,
        qty: 1,
        channel: 'youxuan',
        status: 'done',
        at: now - 2 * 86400000,
      },
      {
        id: 'MO-DEMO2',
        goodsId: 'y2',
        title: '电动牙刷',
        emoji: '🪥',
        amount: 89,
        qty: 1,
        channel: 'youxuan',
        status: 'unpaid',
        at: now - 3600000,
      },
    ],
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
  return (
    typeof r.id === 'string' &&
    typeof r.goodsId === 'string' &&
    typeof r.title === 'string' &&
    typeof r.emoji === 'string' &&
    typeof r.amount === 'number' &&
    typeof r.qty === 'number' &&
    isChannel(r.channel) &&
    (r.status === 'unpaid' || r.status === 'awaiting_confirm' || r.status === 'paid' || r.status === 'done') &&
    typeof r.at === 'number'
  )
}

/* 逐字段校验：任一异常回退对应字段的 seed 值（参照 store.tsx loadState 先例） */
function loadMallFor(userId: string): MallState {
  const base = seedState()
  const key = mallKeyFor(userId)
  try {
    // 一次性迁移：老共享存档复制到当前用户专属 key（幂等；失败不阻塞，按 seed 兜底）
    // 云端真实模式跳过迁移：老共享 key 存的是演示期数据，不注入真实身份
    const legacy = cloudEnabled ? null : localStorage.getItem(LEGACY_KEY)
    if (legacy && !localStorage.getItem(key)) {
      try {
        localStorage.setItem(key, legacy)
      } catch {
        /* ignore */
      }
    }
    const raw = localStorage.getItem(key)
    if (!raw) return base
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return base
    const o = v as Record<string, unknown>
    if (typeof o.points === 'number' && Number.isFinite(o.points)) base.points = o.points
    /* 轮 15 并轨：余额以统一钱包为准，不再读取本地旧值（wallet 字段仅为展示镜像） */
    if (Array.isArray(o.cart)) base.cart = o.cart.filter(isCartItem)
    if (Array.isArray(o.orders)) base.orders = o.orders.filter(isOrder)
    // 云端真实模式清理演示期遗留：预置演示订单（MO-DEMO*）与引用已下架演示商品的购物车条目
    if (cloudEnabled) {
      base.orders = base.orders.filter((it) => !it.id.startsWith('MO-DEMO'))
      base.cart = base.cart.filter((c) => currentGoods().some((g) => g.id === c.goodsId))
    }
    return base
  } catch {
    return base
  }
}

type MallApi = {
  state: MallState
  addToCart: (goodsId: string, qty?: number, spec?: string) => void
  setCartQty: (goodsId: string, spec: string | undefined, qty: number) => void
  removeFromCart: (goodsId: string, spec?: string) => void
  clearCart: () => void
  /** 购物车合并为一笔 unpaid 订单（不扣钱，payOrder 时才扣） */
  checkout: () => MallOrder | null
  /** 校验 unpaid + 统一钱包扣费成功 → 返 5% 积分 → paid；失败返回 false */
  payOrder: (id: string) => boolean
  /** 扫码人工确认通道：提交付款凭证（unpaid → awaiting_confirm，等待管理员核销） */
  submitPayProof: (id: string, method: string, ref: string) => void
  /** 管理员凭口令确认收款（awaiting_confirm → paid，返 5% 积分）；口令错误返回 false */
  confirmManualPay: (id: string, key: string) => boolean
  /** 取消 unpaid 订单（演示简化：直接从订单列表移除） */
  cancelOrder: (id: string) => void
  confirmOrder: (id: string) => void
  recharge: (amount: number) => void
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
    // 云端恢复（轮 6）：拉取该身份快照 → 写回本地 → 重载（云 key 统一 mim-mall-v1，表按 user_id 隔离）
    void pullToolState('mim-mall-v1').then((d) => {
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
    pushToolState('mim-mall-v1', state) // 云端整包快照（未登录/未配置时静默跳过）
  }, [state, storageKey])

  const api: MallApi = {
    state,
    addToCart(goodsId, qty = 1, spec) {
      setState((s) => {
        const i = s.cart.findIndex((c) => c.goodsId === goodsId && c.spec === spec)
        if (i < 0) return { ...s, cart: [...s.cart, { goodsId, qty, spec }] }
        const cur = s.cart[i]
        if (!cur) return s
        const cart = s.cart.slice()
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
      const amount = state.cart.reduce(
        (sum, c) => sum + (goods.find((g) => g.id === c.goodsId)?.price ?? 0) * c.qty,
        0,
      )
      const qty = state.cart.reduce((sum, c) => sum + c.qty, 0)
      const order: MallOrder = {
        id: `MO-${Date.now()}`,
        goodsId: first.id,
        title: state.cart.length === 1 ? first.title : `${first.title} 等${state.cart.length}种`,
        emoji: first.emoji,
        amount,
        qty,
        channel: first.channel,
        status: 'unpaid',
        at: Date.now(),
      }
      setState((s) => ({ ...s, orders: [order, ...s.orders], cart: [] }))
      return order
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
      setState((s) => ({
        ...s,
        orders: s.orders.map((o) =>
          o.id === id && o.status === 'unpaid'
            ? {
                ...o,
                status: 'awaiting_confirm',
                payChannel: 'qrcode-manual' as PayChannelId,
                proof: { method, ref, at: Date.now() },
              }
            : o,
        ),
      }))
    },
    confirmManualPay(id, key) {
      if (!checkOperatorKey(key)) return false
      const order = state.orders.find((o) => o.id === id && o.status === 'awaiting_confirm')
      if (!order) return false
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
    recharge(amount) {
      /* 轮 15 并轨：充值进统一钱包（元→分），余额镜像由 WALLET_UPDATE_EVT 事件同步刷新 */
      walletRecharge(amount * 100, `商城充值 ¥${amount}（未接入真实支付）`)
    },
  }

  return <MallContext.Provider value={api}>{children}</MallContext.Provider>
}

export function useMall(): MallApi {
  const v = useContext(MallContext)
  if (!v) throw new Error('useMall must be used within MallProvider')
  return v
}
