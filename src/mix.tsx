import './mix.css'
import { useEffect, useRef, useState } from 'react'
import { useToast } from './components'
import { cx, uid } from './utils'

/* ============================================================
 * 本地生活服务台 —— 重新开发自合并源码 mixmlaal-fullstack
 * （生活服务聚合平台：外卖 / 跑腿 / 网约车 / 订单 / 模拟支付）
 * 纯前端 mock：估价、下单、钱包扣款，localStorage 持久化
 * ============================================================ */

type OrderKind = 'food' | 'errand' | 'ride'
type OrderStatus = 'unpaid' | 'paid'
type ErrandSize = 'small' | 'medium' | 'large'

interface MixOrder {
  id: string
  kind: OrderKind
  title: string
  detail: string
  amount: number
  status: OrderStatus
  createdAt: number
}

interface MixData {
  wallet: number
  orders: MixOrder[]
}

interface Quote {
  distance: number
  duration: number
  min: number
  max: number
}

const STORAGE_KEY = 'mim-mix-v1'

/* ---------- 种子数据 / 本地存储 ---------- */

function seedData(): MixData {
  const min = (n: number) => Date.now() - n * 60_000
  return {
    wallet: 88,
    orders: [
      {
        id: 'o-seed-1',
        kind: 'food',
        title: '金拱门汉堡',
        detail: '芝士汉堡套餐 ×1 · 800m',
        amount: 37.5,
        status: 'paid',
        createdAt: min(45),
      },
      {
        id: 'o-seed-2',
        kind: 'ride',
        title: '快车出行',
        detail: '科技园 → 中央公园 · 6.2km',
        amount: 27.5,
        status: 'unpaid',
        createdAt: min(12),
      },
    ],
  }
}

function loadMix(): MixData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedData()
    const d = JSON.parse(raw) as Partial<MixData>
    const ok =
      typeof d.wallet === 'number' &&
      Array.isArray(d.orders) &&
      d.orders.every(
        (o) =>
          o != null &&
          typeof o.id === 'string' &&
          (o.kind === 'food' || o.kind === 'errand' || o.kind === 'ride') &&
          typeof o.title === 'string' &&
          typeof o.detail === 'string' &&
          typeof o.amount === 'number' &&
          (o.status === 'unpaid' || o.status === 'paid') &&
          typeof o.createdAt === 'number',
      )
    if (ok) return d as MixData
  } catch {
    /* 忽略损坏的本地数据，重新播种 */
  }
  return seedData()
}

/* ---------- 静态模拟数据（源自母本外卖 / 跑腿 / 网约车定价逻辑） ---------- */

interface Merchant {
  id: string
  name: string
  emoji: string
  category: string
  rating: number
  sales: number
  minOrder: number
  deliveryFee: number
  deliveryTime: string
  distance: number
}

interface FoodItem {
  id: string
  name: string
  emoji: string
  price: number
}

const CATEGORIES = ['全部', '快餐', '披萨', '家常菜'] as const

const MERCHANTS: Merchant[] = [
  { id: 'm1', name: '金拱门汉堡', emoji: '🍔', category: '快餐', rating: 4.5, sales: 1234, minOrder: 20, deliveryFee: 5, deliveryTime: '30-40分钟', distance: 800 },
  { id: 'm2', name: '炸鸡小站', emoji: '🍗', category: '快餐', rating: 4.3, sales: 987, minOrder: 25, deliveryFee: 6, deliveryTime: '25-35分钟', distance: 1200 },
  { id: 'm3', name: '披萨工坊', emoji: '🍕', category: '披萨', rating: 4.6, sales: 765, minOrder: 30, deliveryFee: 7, deliveryTime: '35-45分钟', distance: 1500 },
  { id: 'm4', name: '粥粉面家', emoji: '🍜', category: '家常菜', rating: 4.7, sales: 2100, minOrder: 15, deliveryFee: 4, deliveryTime: '20-30分钟', distance: 600 },
]

const MENUS: Record<string, FoodItem[]> = {
  m1: [
    { id: 'm1-1', name: '芝士汉堡套餐', emoji: '🍔', price: 32.5 },
    { id: 'm1-2', name: '麦乐鸡 5 块', emoji: '🍗', price: 12 },
    { id: 'm1-3', name: '冰爽可乐', emoji: '🥤', price: 6.5 },
  ],
  m2: [
    { id: 'm2-1', name: '香辣炸鸡桶', emoji: '🍗', price: 39.9 },
    { id: 'm2-2', name: '薯条大份', emoji: '🍟', price: 13 },
    { id: 'm2-3', name: '蛋挞 ×2', emoji: '🥧', price: 10 },
  ],
  m3: [
    { id: 'm3-1', name: '超级至尊披萨 9 寸', emoji: '🍕', price: 58 },
    { id: 'm3-2', name: '芝士条 ×4', emoji: '🧆', price: 18 },
    { id: 'm3-3', name: '凯撒沙拉', emoji: '🥗', price: 22 },
  ],
  m4: [
    { id: 'm4-1', name: '招牌皮蛋瘦肉粥', emoji: '🥣', price: 14 },
    { id: 'm4-2', name: '牛肉汤粉', emoji: '🍜', price: 21 },
    { id: 'm4-3', name: '虾饺 ×4', emoji: '🥟', price: 16 },
  ],
}

const ERRAND_TYPES = [
  { id: 'express', label: '帮我送', emoji: '📦' },
  { id: 'buy', label: '帮我买', emoji: '🛍️' },
  { id: 'queue', label: '代排队', emoji: '⏳' },
] as const

const ERRAND_SIZES: Array<{ id: ErrandSize; label: string; fee: number }> = [
  { id: 'small', label: '小件', fee: 0 },
  { id: 'medium', label: '中件 +¥5', fee: 5 },
  { id: 'large', label: '大件 +¥10', fee: 10 },
]

const CAR_TYPES = [
  { id: 'express', label: '快车', emoji: '🚗', base: 12, perKm: 2.5, min: 25, desc: '经济实惠' },
  { id: 'taxi', label: '出租车', emoji: '🚕', base: 14, perKm: 2.8, min: 30, desc: '路边即停' },
  { id: 'premium', label: '优享', emoji: '🚙', base: 20, perKm: 4, min: 45, desc: '舒适型车' },
  { id: 'luxury', label: '豪华', emoji: '🚓', base: 35, perKm: 6.5, min: 80, desc: '高端商务' },
] as const
type CarTypeId = (typeof CAR_TYPES)[number]['id']

const TABS = [
  { id: 'food', label: '外卖', emoji: '🍔' },
  { id: 'errand', label: '跑腿', emoji: '🏃' },
  { id: 'ride', label: '打车', emoji: '🚗' },
  { id: 'orders', label: '订单', emoji: '🧾' },
] as const
type TabId = (typeof TABS)[number]['id']

const KIND_META: Record<OrderKind, { label: string; emoji: string }> = {
  food: { label: '外卖', emoji: '🍔' },
  errand: { label: '跑腿', emoji: '🏃' },
  ride: { label: '打车', emoji: '🚗' },
}

const r1 = (n: number): number => Math.round(n * 10) / 10

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------- 页面组件 ---------- */

export function MixPage() {
  const toast = useToast()
  const [mix, setMix] = useState<MixData>(loadMix)
  const [tab, setTab] = useState<TabId>('food')
  const [busy, setBusy] = useState<string | null>(null)

  /* 外卖 */
  const [cat, setCat] = useState<string>('全部')
  const [foodId, setFoodId] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})

  /* 跑腿 */
  const [errandType, setErrandType] = useState<(typeof ERRAND_TYPES)[number]['id']>('express')
  const [errandFrom, setErrandFrom] = useState('')
  const [errandTo, setErrandTo] = useState('')
  const [errandWeight, setErrandWeight] = useState('1')
  const [errandSize, setErrandSize] = useState<ErrandSize>('small')
  const [errandQuote, setErrandQuote] = useState<Quote | null>(null)

  /* 打车 */
  const [carId, setCarId] = useState<CarTypeId>('express')
  const [rideFrom, setRideFrom] = useState('')
  const [rideTo, setRideTo] = useState('')
  const [rideQuote, setRideQuote] = useState<Quote | null>(null)

  /* 持久化 */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mix))
    } catch {
      /* ignore */
    }
  }, [mix])

  /* setTimeout 模拟加载，卸载时清理 */
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (fn: () => void, ms = 700) => {
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t)
      fn()
    }, ms)
    timers.current.push(t)
  }

  const addOrder = (kind: OrderKind, title: string, detail: string, amount: number) => {
    setMix((m) => ({
      ...m,
      orders: [{ id: uid('o'), kind, title, detail, amount, status: 'unpaid', createdAt: Date.now() }, ...m.orders],
    }))
  }

  /* ---------- 外卖链路 ---------- */

  const filteredMerchants = MERCHANTS.filter((m) => cat === '全部' || m.category === cat)
  const selectedMerchant = foodId ? MERCHANTS.find((m) => m.id === foodId) : undefined
  const menu = foodId ? (MENUS[foodId] ?? []) : []
  const cartItems = menu
    .map((it) => ({ ...it, qty: cart[it.id] ?? 0 }))
    .filter((it) => it.qty > 0)
  const foodTotal = r1(cartItems.reduce((s, it) => s + it.price * it.qty, 0))

  const addToCart = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const decFromCart = (id: string) =>
    setCart((c) => {
      const next = { ...c }
      const q = (next[id] ?? 0) - 1
      if (q <= 0) delete next[id]
      else next[id] = q
      return next
    })

  const submitFood = () => {
    if (!selectedMerchant) return
    if (cartItems.length === 0) {
      toast('先挑点什么吧，购物车还是空的')
      return
    }
    if (foodTotal < selectedMerchant.minOrder) {
      toast(`未达起送价 ¥${selectedMerchant.minOrder}，还差 ¥${r1(selectedMerchant.minOrder - foodTotal)}`)
      return
    }
    setBusy('food')
    later(() => {
      const detail =
        cartItems.map((it) => `${it.name} ×${it.qty}`).join('、') + ` · ${selectedMerchant.distance}m`
      addOrder('food', selectedMerchant.name, detail, r1(foodTotal + selectedMerchant.deliveryFee))
      setCart({})
      setFoodId(null)
      setBusy(null)
      toast('外卖订单已提交，请前往订单页支付')
    })
  }

  /* ---------- 跑腿链路（母本定价：基础10 + 2/km + 超重2/kg + 尺寸加价） ---------- */

  const errandSizeFee = ERRAND_SIZES.find((s) => s.id === errandSize)?.fee ?? 0

  const doErrandQuote = () => {
    if (!errandFrom.trim() || !errandTo.trim()) {
      toast('请填写取件地址和收件地址')
      return
    }
    const weight = Number(errandWeight) || 0
    if (weight <= 0 || weight > 50) {
      toast('请填写有效重量（0-50kg）')
      return
    }
    setBusy('errand')
    later(() => {
      const distance = r1(2 + Math.random() * 8)
      const weightFee = weight > 5 ? r1((weight - 5) * 2) : 0
      const total = 10 + distance * 2 + weightFee + errandSizeFee
      setErrandQuote({
        distance,
        duration: Math.ceil(distance * 10),
        min: Math.floor(total * 0.9),
        max: Math.ceil(total * 1.1),
      })
      setBusy(null)
    })
  }

  const submitErrand = () => {
    if (!errandQuote) return
    setBusy('errand-order')
    later(() => {
      const label = ERRAND_TYPES.find((t) => t.id === errandType)?.label ?? '帮我送'
      addOrder(
        'errand',
        `${label}·跑腿`,
        `${errandFrom} → ${errandTo} · ${errandQuote.distance}km`,
        r1((errandQuote.min + errandQuote.max) / 2),
      )
      setErrandQuote(null)
      setBusy(null)
      toast('跑腿订单已创建，请前往订单页支付')
    }, 500)
  }

  /* ---------- 打车链路（母本定价：起步价 + 每公里 × 路线距离） ---------- */

  const selectedCar = CAR_TYPES.find((c) => c.id === carId) ?? CAR_TYPES[0]

  const doRideQuote = () => {
    if (!rideFrom.trim() || !rideTo.trim()) {
      toast('请填写出发地和目的地')
      return
    }
    setBusy('ride')
    later(() => {
      const distance = r1(3 + Math.random() * 12)
      const est = selectedCar.base + distance * selectedCar.perKm
      setRideQuote({
        distance,
        duration: Math.ceil(distance * 2.2) + 4,
        min: Math.max(selectedCar.min, Math.floor(est * 0.9)),
        max: Math.max(selectedCar.min + 10, Math.ceil(est * 1.1)),
      })
      setBusy(null)
    })
  }

  const submitRide = () => {
    if (!rideQuote) return
    setBusy('ride-order')
    later(() => {
      addOrder(
        'ride',
        `${selectedCar.label}出行`,
        `${rideFrom} → ${rideTo} · ${rideQuote.distance}km`,
        r1((rideQuote.min + rideQuote.max) / 2),
      )
      setRideQuote(null)
      setBusy(null)
      toast('叫车成功，行程结束后请支付')
    }, 500)
  }

  /* ---------- 订单 / 钱包 ---------- */

  const pay = (id: string) => {
    const o = mix.orders.find((x) => x.id === id)
    if (!o || o.status === 'paid') return
    if (mix.wallet < o.amount) {
      toast(`余额不足，还差 ¥${r1(o.amount - mix.wallet)}，可先充值`)
      return
    }
    setMix((m) => ({
      wallet: r1(m.wallet - o.amount),
      orders: m.orders.map((x) => (x.id === id ? { ...x, status: 'paid' as const } : x)),
    }))
    toast(`支付成功 ¥${o.amount.toFixed(1)} ✅`)
  }

  const recharge = () => {
    setMix((m) => ({ ...m, wallet: r1(m.wallet + 50) }))
    toast('充值成功 +50 元（演示）')
  }

  const resetDemo = () => {
    if (!window.confirm('重置演示数据？将清空本地记录并恢复初始状态')) return
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setMix(seedData())
    setFoodId(null)
    setCart({})
    setErrandQuote(null)
    setRideQuote(null)
    toast('已重置为演示初始数据')
  }

  const unpaidCount = mix.orders.filter((o) => o.status === 'unpaid').length
  const paidSum = r1(mix.orders.filter((o) => o.status === 'paid').reduce((s, o) => s + o.amount, 0))

  /* ---------- 渲染片段 ---------- */

  const renderFood = () =>
    selectedMerchant ? (
      <div className="card">
        <div className="mix-back">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setFoodId(null)
              setCart({})
            }}
          >
            ← 返回商家列表
          </button>
        </div>
        <div className="mix-merchant" style={{ cursor: 'default' }}>
          <span className="mix-m-emoji">{selectedMerchant.emoji}</span>
          <span className="mix-m-body">
            <span className="mix-m-name">{selectedMerchant.name}</span>
            <span className="mix-m-meta">
              <span className="mix-m-rate">⭐ {selectedMerchant.rating}</span> · 月售 {selectedMerchant.sales} ·{' '}
              {selectedMerchant.deliveryTime}
            </span>
          </span>
        </div>
        {menu.map((it) => {
          const qty = cart[it.id] ?? 0
          return (
            <div className="mix-item" key={it.id}>
              <span className="mix-item-emoji">{it.emoji}</span>
              <span className="mix-item-name">{it.name}</span>
              <span className="mix-item-price">¥{it.price}</span>
              {qty === 0 ? (
                <button className="btn btn-primary mix-add" disabled={busy !== null} onClick={() => addToCart(it.id)}>
                  ＋
                </button>
              ) : (
                <span className="mix-stepper">
                  <button className="mix-qty" onClick={() => decFromCart(it.id)}>
                    −
                  </button>
                  <b>{qty}</b>
                  <button className="mix-qty" onClick={() => addToCart(it.id)}>
                    ＋
                  </button>
                </span>
              )}
            </div>
          )
        })}
        <div className="mix-cartbar">
          {cartItems.length === 0 ? (
            <span className="muted">🛒 购物车是空的 · 起送 ¥{selectedMerchant.minOrder}</span>
          ) : foodTotal < selectedMerchant.minOrder ? (
            <span className="muted">
              还差 ¥{r1(selectedMerchant.minOrder - foodTotal)} 起送 · 合计 ¥{r1(foodTotal + selectedMerchant.deliveryFee)}
            </span>
          ) : (
            <span>
              <b>¥{r1(foodTotal + selectedMerchant.deliveryFee)}</b>{' '}
              <small className="muted">含配送费 ¥{selectedMerchant.deliveryFee}</small>
            </span>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={busy !== null || foodTotal < selectedMerchant.minOrder}
            onClick={submitFood}
          >
            {busy === 'food' ? <span className="mix-busy">提交中…</span> : '提交订单'}
          </button>
        </div>
      </div>
    ) : (
      <div className="card">
        <div className="mix-chips">
          {CATEGORIES.map((c) => (
            <button key={c} className={cx('mix-chip', cat === c && 'active')} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        {filteredMerchants.length === 0 ? (
          <div className="mix-empty">
            <div className="mix-empty-emoji">🏪</div>
            <p>该分类下暂无商家</p>
          </div>
        ) : (
          filteredMerchants.map((m) => (
            <button
              key={m.id}
              className="mix-merchant"
              onClick={() => {
                setFoodId(m.id)
                setCart({})
              }}
            >
              <span className="mix-m-emoji">{m.emoji}</span>
              <span className="mix-m-body">
                <span className="mix-m-name">{m.name}</span>
                <span className="mix-m-meta">
                  <span className="mix-m-rate">⭐ {m.rating}</span> · 月售 {m.sales} · 🚴 ¥{m.deliveryFee} · {m.deliveryTime}
                </span>
                <span className="mix-m-min">
                  起送 ¥{m.minOrder} · 距离 {m.distance}m
                </span>
              </span>
              <span className="mix-m-arrow">›</span>
            </button>
          ))
        )}
      </div>
    )

  const renderErrand = () => (
    <div className="card">
      <div className="mix-form">
        <div className="mix-field wide">
          <label>服务类型</label>
          <div className="mix-radio-row">
            {ERRAND_TYPES.map((t) => (
              <button
                key={t.id}
                className={cx('mix-chip', errandType === t.id && 'active')}
                onClick={() => setErrandType(t.id)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mix-field">
          <label>取件 / 采买地址</label>
          <input
            className="input"
            value={errandFrom}
            onChange={(e) => setErrandFrom(e.target.value)}
            placeholder="如：中心广场药店"
          />
        </div>
        <div className="mix-field">
          <label>送达地址</label>
          <input
            className="input"
            value={errandTo}
            onChange={(e) => setErrandTo(e.target.value)}
            placeholder="如：翡翠湾 5-301"
          />
        </div>
        <div className="mix-field">
          <label>物品重量（kg）</label>
          <input
            className="input"
            type="number"
            min={0.1}
            step={0.1}
            value={errandWeight}
            onChange={(e) => setErrandWeight(e.target.value)}
          />
        </div>
        <div className="mix-field">
          <label>物品尺寸</label>
          <div className="mix-radio-row">
            {ERRAND_SIZES.map((s) => (
              <button
                key={s.id}
                className={cx('mix-chip', errandSize === s.id && 'active')}
                onClick={() => setErrandSize(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mix-price-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <button className="btn btn-ghost" disabled={busy !== null} onClick={doErrandQuote}>
          {busy === 'errand' ? <span className="mix-busy">估价中…</span> : '💰 价格预估'}
        </button>
      </div>
      {errandQuote && (
        <div className="mix-pricebox">
          预估 <b>¥{errandQuote.min}-{errandQuote.max}</b> · 距离 {errandQuote.distance}km · 约 {errandQuote.duration}{' '}
          分钟送达
          <div className="mix-price-actions">
            <button className="btn btn-primary" disabled={busy !== null} onClick={submitErrand}>
              {busy === 'errand-order' ? <span className="mix-busy">下单中…</span> : '🛵 发布跑腿单'}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const renderRide = () => (
    <div className="card">
      <div className="mix-form">
        <div className="mix-field">
          <label>出发地</label>
          <input
            className="input"
            value={rideFrom}
            onChange={(e) => setRideFrom(e.target.value)}
            placeholder="如：科技园 B 座"
          />
        </div>
        <div className="mix-field">
          <label>目的地</label>
          <input
            className="input"
            value={rideTo}
            onChange={(e) => setRideTo(e.target.value)}
            placeholder="如：中央公园南门"
          />
        </div>
      </div>
      <div className="mix-cars">
        {CAR_TYPES.map((c) => (
          <button key={c.id} className={cx('mix-car', carId === c.id && 'active')} onClick={() => setCarId(c.id)}>
            <div className="mix-car-name">
              {c.emoji} {c.label}
            </div>
            <div className="mix-car-desc">
              {c.desc} · 起步 ¥{c.min}
            </div>
          </button>
        ))}
      </div>
      <div className="mix-price-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <button className="btn btn-ghost" disabled={busy !== null} onClick={doRideQuote}>
          {busy === 'ride' ? <span className="mix-busy">估价中…</span> : '💰 价格预估'}
        </button>
      </div>
      {rideQuote && (
        <div className="mix-pricebox">
          {selectedCar.emoji} {selectedCar.label} 预估 <b>¥{rideQuote.min}-{rideQuote.max}</b> · {rideQuote.distance}km ·
          约 {rideQuote.duration} 分钟
          <div className="mix-price-actions">
            <button className="btn btn-primary" disabled={busy !== null} onClick={submitRide}>
              {busy === 'ride-order' ? <span className="mix-busy">呼叫中…</span> : '🚗 立即叫车'}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const renderOrders = () => (
    <div>
      {mix.orders.length === 0 ? (
        <div className="card">
          <div className="mix-empty">
            <div className="mix-empty-emoji">🧾</div>
            <p>还没有订单，先去外卖 / 跑腿 / 打车逛逛吧</p>
          </div>
        </div>
      ) : (
        mix.orders.map((o) => (
          <div className="card" key={o.id}>
            <div className="mix-order-top">
              <span className="mix-kind-tag">
                {KIND_META[o.kind].emoji} {KIND_META[o.kind].label}
              </span>
              <span className={cx('mix-badge', o.status)}>{o.status === 'paid' ? '已支付' : '待支付'}</span>
            </div>
            <b>{o.title}</b>
            <p className="muted mix-tip">
              {o.detail} · {fmtTime(o.createdAt)}
            </p>
            <div className="mix-order-foot">
              <span className="mix-amount">¥{o.amount.toFixed(1)}</span>
              {o.status === 'unpaid' && (
                <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => pay(o.id)}>
                  立即支付
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )

  return (
    <div>
      <h2 className="page-title">🧭 本地生活服务台</h2>
      <div className="mix-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={cx('mix-tab', tab === t.id && 'active')} onClick={() => setTab(t.id)}>
            {t.emoji} {t.label}
          </button>
        ))}
      </div>
      <div className="page-grid">
        <div>
          {tab === 'food' && renderFood()}
          {tab === 'errand' && renderErrand()}
          {tab === 'ride' && renderRide()}
          {tab === 'orders' && renderOrders()}
        </div>
        <div>
          <div className="side-card">
            <h3>💰 平台钱包</h3>
            <div className="mix-balance">¥{mix.wallet.toFixed(1)}</div>
            <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={recharge}>
              充值 +50（演示）
            </button>
            <p className="mix-tip muted">订单支付将从钱包余额中直接扣除</p>
          </div>
          <div className="side-card">
            <h3>📊 消费统计</h3>
            <div className="mix-stat-row">
              <span className="muted">累计订单</span>
              <b>{mix.orders.length} 单</b>
            </div>
            <div className="mix-stat-row">
              <span className="muted">待支付</span>
              <b>{unpaidCount} 单</b>
            </div>
            <div className="mix-stat-row">
              <span className="muted">累计消费</span>
              <b>¥{paidSum.toFixed(1)}</b>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={resetDemo}>
              ♻️ 重置演示数据
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
