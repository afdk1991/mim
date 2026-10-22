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
import { cloudEnabled } from '../lib/supabase'
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
export const MALL_GOODS: MallGoods[] = cloudEnabled ? [] : DEMO_GOODS

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
      base.cart = base.cart.filter((c) => MALL_GOODS.some((g) => g.id === c.goodsId))
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
      const first = MALL_GOODS.find((g) => g.id === head.goodsId)
      if (!first) return null
      const amount = state.cart.reduce(
        (sum, c) => sum + (MALL_GOODS.find((g) => g.id === c.goodsId)?.price ?? 0) * c.qty,
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
