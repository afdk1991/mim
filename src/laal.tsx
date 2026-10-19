import './laal.css'
import { useEffect, useState } from 'react'
import { useToast } from './components'
import { cx, uid, timeAgo } from './utils'

/* 代驾出行台：重实现自母本 laal-platform「安行代驾（daijia）」出行平台的主链路——
   叫车下单（起终点选点 + 里程预估价 + 优惠券自动抵扣）→ 模拟派单/司机接单/接驾 →
   行程进度模拟推进（emoji 网格地图轨迹）→ 到达余额支付 → 星级评价 →
   订单历史（全部/待完成/已完成）+ 优惠券中心 + 余额充值。
   真定位/真支付/司机端/管理后台不在本轮范围。零图片依赖，数据存 localStorage。 */

interface LaalPlace { name: string; emoji: string; x: number; y: number }
interface LaalDriver { name: string; emoji: string; plate: string; rating: number; trips: number; color: string }
interface LaalCouponTpl { title: string; amount: number; minSpend: number }
interface LaalCoupon extends LaalCouponTpl { uid: string; used: boolean }
type LaalStatus = 'matching' | 'waiting' | 'driving' | 'arrived' | 'done' | 'canceled'
interface LaalOrder {
  id: string
  from: string
  to: string
  km: number
  price: number
  cut: number
  couponUid: string | null
  status: LaalStatus
  driver: LaalDriver | null
  rating: number
  createdAt: number
}
interface LaalState { balance: number; coupons: LaalCoupon[]; orders: LaalOrder[] }

const STORAGE_KEY = 'mim-laal-v1'
const MATCH_SEC = 3      // 派单等待秒数
const PICKUP_SEC = 6     // 司机接驾秒数
const DRIVE_SEC = 12     // 行程模拟秒数
const ACTIVE: ReadonlySet<LaalStatus> = new Set(['matching', 'waiting', 'driving', 'arrived'])

const PLACES: LaalPlace[] = [
  { name: '幸福小区 3 号门', emoji: '🏠', x: 18, y: 76 },
  { name: '环球金融中心', emoji: '🏢', x: 52, y: 30 },
  { name: '老城美食街', emoji: '🍜', x: 34, y: 52 },
  { name: '市第一医院', emoji: '🏥', x: 70, y: 62 },
  { name: '高铁南站', emoji: '🚄', x: 84, y: 84 },
  { name: '城东大学城', emoji: '🏫', x: 12, y: 22 },
  { name: '万象汇购物中心', emoji: '🛍', x: 62, y: 12 },
  { name: '奥体中心', emoji: '⚽', x: 88, y: 38 },
]

const DRIVERS: LaalDriver[] = [
  { name: '王师傅', emoji: '👨‍✈️', plate: '京A·8D521', rating: 4.9, trips: 3210, color: '#ffe3c2' },
  { name: '李师傅', emoji: '🧑‍🔧', plate: '京B·3F870', rating: 4.8, trips: 2568, color: '#d9ecff' },
  { name: '赵师傅', emoji: '🧔', plate: '京C·6Q239', rating: 5.0, trips: 1875, color: '#e2f7e5' },
  { name: '陈师傅', emoji: '👨‍🦱', plate: '京D·9K412', rating: 4.7, trips: 4102, color: '#fde3ec' },
]

const COUPON_POOL: LaalCouponTpl[] = [
  { title: '新客立减券', amount: 10, minSpend: 15 },
  { title: '满 40 减 8', amount: 8, minSpend: 40 },
  { title: '深夜安返券', amount: 15, minSpend: 50 },
]

const STATUS_TEXT: Record<LaalStatus, string> = {
  matching: '派单中',
  waiting: '司机接驾中',
  driving: '行程中',
  arrived: '待支付',
  done: '已完成',
  canceled: '已取消',
}

const round1 = (n: number) => Math.round(n * 10) / 10
const calcKm = (a: LaalPlace, b: LaalPlace) => round1(Math.max(1.5, Math.hypot(a.x - b.x, a.y - b.y) * 0.28))
const calcPrice = (km: number) => round1(12 + Math.max(0, km - 3) * 2.8)
const paidOf = (o: LaalOrder) => Math.max(0, round1(o.price - o.cut))

function defaultLaal(): LaalState {
  const km = calcKm(PLACES[0], PLACES[2])
  return {
    balance: 88,
    coupons: [{ ...COUPON_POOL[0], uid: uid('cp'), used: false }],
    orders: [
      {
        id: 'DJ10086', from: PLACES[0].name, to: PLACES[2].name, km,
        price: calcPrice(km), cut: 0, couponUid: null,
        status: 'done', driver: DRIVERS[0], rating: 5, createdAt: Date.now() - 86_400_000 * 2,
      },
    ],
  }
}

function loadLaal(): LaalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LaalState
      if (parsed && typeof parsed.balance === 'number' && Array.isArray(parsed.coupons) && Array.isArray(parsed.orders)) {
        return parsed
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return defaultLaal()
}

type TabKey = 'all' | 'open' | 'done'

export function LaalPage() {
  const toast = useToast()
  const [laal, setLaal] = useState<LaalState>(loadLaal)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [phaseSec, setPhaseSec] = useState(0)
  const [fromName, setFromName] = useState(PLACES[0].name)
  const [toName, setToName] = useState(PLACES[1].name)
  const [tab, setTab] = useState<TabKey>('all')

  const save = (next: LaalState) => {
    setLaal(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const active = laal.orders.find((o) => o.id === activeId && ACTIVE.has(o.status)) ?? null

  /* 行程状态机：派单 → 接驾 → 行程 → 待支付（会话内每秒推进） */
  useEffect(() => { setPhaseSec(0) }, [active?.id, active?.status])

  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setPhaseSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [active?.id, active?.status])

  useEffect(() => {
    if (!active) return
    if (active.status === 'matching' && phaseSec >= MATCH_SEC) {
      const d = DRIVERS[Math.floor(Math.random() * DRIVERS.length)]
      patchActive({ status: 'waiting', driver: d })
      toast(`🚗 ${d.name}已接单，正赶来`)
    } else if (active.status === 'waiting' && phaseSec >= PICKUP_SEC) {
      patchActive({ status: 'driving' })
      toast('司机已到达上车点，行程开始')
    } else if (active.status === 'driving' && phaseSec >= DRIVE_SEC) {
      patchActive({ status: 'arrived' })
      toast('已到达目的地，请支付车费')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseSec, active?.id, active?.status])

  const patchActive = (patch: Partial<LaalOrder>) => {
    if (!activeId) return
    save({ ...laal, orders: laal.orders.map((o) => (o.id === activeId ? { ...o, ...patch } : o)) })
  }

  /* ---------- 下单 ---------- */
  const fromP = PLACES.find((p) => p.name === fromName)
  const toP = PLACES.find((p) => p.name === toName)
  const sameSpot = !fromP || !toP || fromP.name === toP.name
  const estKm = !sameSpot && fromP && toP ? calcKm(fromP, toP) : 0
  const estPrice = estKm ? calcPrice(estKm) : 0
  const estEta = estKm ? Math.max(5, Math.round(estKm * 2 + 4)) : 0
  const pickCoupon = (price: number) =>
    laal.coupons.filter((c) => !c.used && price >= c.minSpend).sort((a, b) => b.amount - a.amount)[0] ?? null
  const estCoupon = estKm ? pickCoupon(estPrice) : null

  const createOrder = () => {
    if (!fromP || !toP || sameSpot) return
    const km = calcKm(fromP, toP)
    const price = calcPrice(km)
    const best = pickCoupon(price)
    const order: LaalOrder = {
      id: uid('DJ'), from: fromP.name, to: toP.name, km, price,
      cut: best?.amount ?? 0, couponUid: best?.uid ?? null,
      status: 'matching', driver: null, rating: 0, createdAt: Date.now(),
    }
    setActiveId(order.id)
    setPhaseSec(0)
    save({ ...laal, orders: [order, ...laal.orders] })
    toast(`已呼叫代驾，预计 ${Math.max(5, Math.round(km * 2 + 4))} 分钟接驾`)
  }

  const swapSpot = () => { setFromName(toName); setToName(fromName) }

  /* ---------- 行程操作 ---------- */
  const cancelOrder = () => {
    if (!window.confirm('确认取消本次代驾吗？')) return
    patchActive({ status: 'canceled' })
    toast('订单已取消，未产生费用')
  }

  const pay = (o: LaalOrder) => {
    const paid = paidOf(o)
    if (laal.balance < paid) {
      toast(`余额不足，还差 ¥${(paid - laal.balance).toFixed(1)}，请先充值`)
      return
    }
    save({
      ...laal,
      balance: round1(laal.balance - paid),
      coupons: laal.coupons.map((c) => (c.uid === o.couponUid ? { ...c, used: true } : c)),
      orders: laal.orders.map((x) => (x.id === o.id ? { ...x, status: 'done' } : x)),
    })
    toast(`支付成功 ¥${paid.toFixed(1)}，别忘了评价本次服务`)
  }

  const rate = (orderId: string, stars: number) => {
    save({ ...laal, orders: laal.orders.map((x) => (x.id === orderId ? { ...x, rating: stars } : x)) })
    toast(`已评价 ${stars} 星，感谢反馈`)
  }

  /* ---------- 账户 / 券 ---------- */
  const recharge = (n: number) => {
    save({ ...laal, balance: round1(laal.balance + n) })
    toast(`充值成功 +¥${n}`)
  }

  const claim = (tpl: LaalCouponTpl) => {
    save({ ...laal, coupons: [...laal.coupons, { ...tpl, uid: uid('cp'), used: false }] })
    toast(`已领取「${tpl.title}」`)
  }

  const reset = () => {
    if (window.confirm('确定重置代驾出行演示数据吗？')) {
      setActiveId(null)
      setPhaseSec(0)
      save(defaultLaal())
    }
  }

  /* ---------- 派生数据 ---------- */
  const doneOrders = laal.orders.filter((o) => o.status === 'done')
  const totalSpent = round1(doneOrders.reduce((s, o) => s + paidOf(o), 0))
  const unusedCoupons = laal.coupons.filter((c) => !c.used)
  const ownedTitles = new Set(unusedCoupons.map((c) => c.title))
  const listOrders = laal.orders.filter((o) =>
    tab === 'all' ? true : tab === 'done' ? o.status === 'done' : ACTIVE.has(o.status),
  )
  const activeFrom = active ? PLACES.find((p) => p.name === active.from) ?? PLACES[0] : null
  const activeTo = active ? PLACES.find((p) => p.name === active.to) ?? PLACES[1] : null
  const drivePct = Math.min(96, phaseSec * 9)

  /* ---------- 行程地图标记 ---------- */
  const driverPos = () => {
    if (!active || !activeFrom || !activeTo) return null
    if (active.status === 'driving') {
      const t = drivePct / 100
      return { x: activeFrom.x + (activeTo.x - activeFrom.x) * t, y: activeFrom.y + (activeTo.y - activeFrom.y) * t }
    }
    return { x: activeFrom.x, y: activeFrom.y }
  }
  const dPos = driverPos()

  const stClass = (s: LaalStatus) =>
    s === 'done' ? 'ok' : s === 'canceled' ? '' : s === 'arrived' ? 'warn' : 'run'

  return (
    <div className="page-grid">
      <div>
        <h2 className="page-title">🚗 代驾出行</h2>

        {/* 叫车面板 */}
        <div className="card laal-form">
          <div className="laal-place-row">
            <span className="laal-place-emoji">{fromP?.emoji ?? '📍'}</span>
            <select className="laal-select" value={fromName} onChange={(e) => setFromName(e.target.value)} aria-label="选择上车点">
              {PLACES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <button className="laal-swap" title="交换起终点" onClick={swapSpot}>⇅</button>
          </div>
          <div className="laal-place-row">
            <span className="laal-place-emoji dest">{toP?.emoji ?? '🏁'}</span>
            <select className="laal-select" value={toName} onChange={(e) => setToName(e.target.value)} aria-label="选择目的地">
              {PLACES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="laal-est">
            {estKm ? (
              <>
                <span>里程 <b>{estKm.toFixed(1)} km</b></span>
                <span>预计 <b>{estEta} 分钟</b></span>
                <span>预估 <b>¥{estPrice.toFixed(1)}</b></span>
                {estCoupon
                  ? <span className="laal-cut-tag">券已选「{estCoupon.title}」抵 ¥{estCoupon.amount}</span>
                  : <span className="muted">无可用优惠券</span>}
              </>
            ) : (
              <span className="muted">请选择不同的上车点与目的地</span>
            )}
          </div>
          <button
            className="btn btn-primary laal-call"
            disabled={sameSpot || !!active}
            onClick={createOrder}
          >
            {active
              ? '行程进行中，暂不能叫车'
              : estKm
                ? `呼叫代驾 · 券后 ¥${Math.max(0, round1(estPrice - (estCoupon?.amount ?? 0))).toFixed(1)}`
                : '呼叫代驾'}
          </button>
          <p className="laal-hint">起步价 ¥12（含 3 km），超出部分 ¥2.8/km · 下单自动选用最优优惠券</p>
        </div>

        {/* 当前行程 */}
        {active && activeFrom && activeTo && (
          <div className="card laal-trip">
            <div className="laal-trip-head">
              <b>{active.from} → {active.to}</b>
              <span className={cx('laal-st', stClass(active.status))}>{STATUS_TEXT[active.status]}</span>
              <span className="muted">{active.id} · {active.km.toFixed(1)} km</span>
            </div>
            <div className="laal-map">
              <svg className="laal-map-route" viewBox="0 0 100 100" preserveAspectRatio="none">
                <line
                  x1={activeFrom.x} y1={activeFrom.y} x2={activeTo.x} y2={activeTo.y}
                  stroke="var(--primary)" strokeWidth="0.7" strokeDasharray="2 1.6" opacity="0.7"
                />
              </svg>
              <span className="laal-pin" style={{ left: `${activeFrom.x}%`, top: `${activeFrom.y}%` }}>
                <i>{activeFrom.emoji}</i><em>上车点</em>
              </span>
              <span className="laal-pin dest" style={{ left: `${activeTo.x}%`, top: `${activeTo.y}%` }}>
                <i>{activeTo.emoji}</i><em>目的地</em>
              </span>
              {dPos && active.driver && (
                <span className="laal-pin driver" style={{ left: `${dPos.x}%`, top: `${dPos.y}%` }}>
                  <i>🚗</i>
                </span>
              )}
            </div>
            {active.status === 'matching' && (
              <p className="laal-radar">正在为你派单，请稍候…（{Math.min(phaseSec, MATCH_SEC)}/{MATCH_SEC}s）</p>
            )}
            {active.driver && (
              <div className="laal-driver">
                <span className="laal-driver-avatar" style={{ background: active.driver.color }}>{active.driver.emoji}</span>
                <span className="laal-driver-info">
                  <b>{active.driver.name} · {active.driver.plate}</b>
                  <small>代驾龄 5 年 · 累计 {active.driver.trips.toLocaleString()} 单</small>
                </span>
                <span className="laal-driver-rate"><b>{active.driver.rating.toFixed(1)}</b><br /><small>评分</small></span>
              </div>
            )}
            {active.status === 'waiting' && (
              <p className="laal-hint">司机距您约 {Math.max(1, PICKUP_SEC - phaseSec)} 分钟，请在上车点等候</p>
            )}
            {active.status === 'driving' && (
              <>
                <div className="laal-progress"><i style={{ width: `${drivePct}%` }} /></div>
                <p className="laal-hint">行程中 · 预计 {Math.max(1, Math.ceil((100 - drivePct) / 9))} 分钟到达目的地</p>
              </>
            )}
            {active.status === 'arrived' && (
              <div className="laal-est">
                <span>车费 <b>¥{active.price.toFixed(1)}</b></span>
                {active.cut > 0 && <span className="laal-cut-tag">已优惠 ¥{active.cut}</span>}
                <span>实付 <b>¥{paidOf(active).toFixed(1)}</b></span>
              </div>
            )}
            <div className="laal-trip-actions">
              {active.status === 'arrived' ? (
                <button className="btn btn-primary" onClick={() => pay(active)}>
                  确认支付 ¥{paidOf(active).toFixed(1)}（余额支付）
                </button>
              ) : (
                <button className="btn btn-danger btn-sm" onClick={cancelOrder}>取消订单</button>
              )}
            </div>
          </div>
        )}

        {/* 历史订单 */}
        <div className="card">
          <div className="laal-tabs">
            {([['all', `全部 ${laal.orders.length}`], ['open', '待完成'], ['done', `已完成 ${doneOrders.length}`]] as const).map(
              ([k, label]) => (
                <button key={k} className={cx('chip', tab === k && 'active')} onClick={() => setTab(k)}>{label}</button>
              ),
            )}
          </div>
          {listOrders.length === 0 && (
            <div className="empty"><div className="empty-emoji">🛣️</div>暂无相关行程，先叫一次代驾吧</div>
          )}
          {listOrders.map((o) => (
            <div key={o.id} className="laal-order">
              <div className="laal-order-top">
                <span className={cx('laal-st', stClass(o.status))}>{STATUS_TEXT[o.status]}</span>
                <span className="muted">{timeAgo(o.createdAt)}</span>
                <span className="laal-order-price">
                  {o.status === 'done' || o.status === 'arrived' ? <b>¥{paidOf(o).toFixed(1)}</b> : <span className="muted">预估 ¥{o.price.toFixed(1)}</span>}
                </span>
              </div>
              <p className="laal-order-route">{o.from} → {o.to}</p>
              <div className="laal-order-meta">
                <span>{o.km.toFixed(1)} km</span>
                {o.driver && <span>司机 {o.driver.name} · {o.driver.plate}</span>}
                {o.cut > 0 && <span className="laal-cut-tag">券抵 ¥{o.cut}</span>}
              </div>
              {o.status === 'done' && (
                o.rating === 0 ? (
                  <div className="laal-stars" title="点击星星评价本次服务">
                    {[1, 2, 3, 4, 5].map((k) => (
                      <button key={k} className="laal-star" onClick={() => rate(o.id, k)}>★</button>
                    ))}
                    <span className="muted" style={{ fontSize: 12, alignSelf: 'center', marginLeft: 6 }}>点击星星评价</span>
                  </div>
                ) : (
                  <div className="laal-stars">
                    {[1, 2, 3, 4, 5].map((k) => (
                      <span key={k} className={cx('laal-star', k <= o.rating && 'on')}>★</span>
                    ))}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 右栏 */}
      <div>
        <div className="side-card">
          <h3>👛 余额</h3>
          <p className="laal-balance">¥{laal.balance.toFixed(1)}</p>
          <p className="muted">完成 {doneOrders.length} 单 · 累计消费 ¥{totalSpent.toFixed(1)}</p>
          <div className="laal-recharge">
            {[20, 50, 100].map((n) => (
              <button key={n} className="btn btn-ghost btn-sm" onClick={() => recharge(n)}>+¥{n}</button>
            ))}
          </div>
        </div>
        <div className="side-card">
          <h3>🎟️ 我的优惠券（{unusedCoupons.length}）</h3>
          {laal.coupons.length === 0 && <p className="muted">还没有优惠券，去下方领券吧</p>}
          {laal.coupons.slice(-4).reverse().map((c) => (
            <div key={c.uid} className={cx('laal-coupon', c.used && 'used')}>
              <span className="laal-coupon-amt"><b>¥{c.amount}</b><small>满 {c.minSpend} 可用</small></span>
              <span className="laal-coupon-body">
                <b>{c.title}</b>
                <small>{c.used ? '已使用' : '下单自动抵扣'}</small>
              </span>
            </div>
          ))}
        </div>
        <div className="side-card">
          <h3>🎁 领券中心</h3>
          {COUPON_POOL.map((p) => (
            <div key={p.title} className="laal-coupon">
              <span className="laal-coupon-amt"><b>¥{p.amount}</b><small>满 {p.minSpend} 可用</small></span>
              <span className="laal-coupon-body">
                <b>{p.title}</b>
                <small>每个账号限领 1 张</small>
              </span>
              <button
                className="btn btn-ghost btn-sm laal-claim"
                disabled={ownedTitles.has(p.title)}
                onClick={() => claim(p)}
              >
                {ownedTitles.has(p.title) ? '已领' : '领取'}
              </button>
            </div>
          ))}
        </div>
        <div className="side-card">
          <p className="muted">演示说明：派单 / 接驾 / 行程均为本地模拟推进，余额与订单保存在浏览器本地。</p>
          <button className="btn btn-ghost btn-sm" onClick={reset}>重置演示数据</button>
        </div>
      </div>
    </div>
  )
}
