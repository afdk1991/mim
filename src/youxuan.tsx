import { useMemo, useState } from 'react'
import { Empty, useToast } from './components'
import { cx, uid } from './utils'

/* 优选商城：重实现自母本 youxuan-app（uni-app 综合电商）的商城交易闭环核心链路——
   分类金刚区 + 双列商品瀑布流 → 商品详情规格选择 → 加入购物车 / 立即购买 →
   购物车（增减/单选全选/删除/合计）→ 确认订单（优惠券满减抵扣）→ 模拟支付 →
   订单列表（待付款/待收货/已完成 状态流转：去支付/确认收货/删除）。
   社区发现、登录、地址簿与工具箱不在本轮范围。emoji 占位图零图片依赖。 */

interface Product { id: string; name: string; emoji: string; price: number; sales: number; cat: string; specs: string[] }
interface CartItem { pid: string; spec: string; qty: number }
interface Coupon { id: string; name: string; off: number; min: number; used: boolean }
interface OrderItem { pid: string; name: string; emoji: string; spec: string; qty: number; price: number }
interface Order { id: string; items: OrderItem[]; subtotal: number; off: number; total: number; status: 'unpaid' | 'shipped' | 'done'; at: number }
interface YXState { cart: CartItem[]; orders: Order[]; coupons: Coupon[] }

const STORAGE_KEY = 'mim-youxuan-v1'

type View = 'mall' | 'detail' | 'cart' | 'confirm' | 'orders'

const CATS = ['全部', '数码', '服饰', '美妆', '家居', '食品']

const PRODUCTS: Product[] = [
  { id: 'p1', name: '无线降噪耳机 Pro', emoji: '🎧', price: 399, sales: 12043, cat: '数码', specs: ['曜石黑', '珍珠白'] },
  { id: 'p2', name: '智能手表 S7 运动版', emoji: '⌚', price: 899, sales: 8211, cat: '数码', specs: ['42mm', '46mm'] },
  { id: 'p3', name: '蓝牙音箱迷你款', emoji: '🔊', price: 129, sales: 23190, cat: '数码', specs: ['经典灰', '活力橙'] },
  { id: 'p4', name: '纯棉宽松卫衣', emoji: '👕', price: 159, sales: 9877, cat: '服饰', specs: ['M', 'L', 'XL'] },
  { id: 'p5', name: '轻便防晒夹克', emoji: '🧥', price: 249, sales: 4520, cat: '服饰', specs: ['卡其', '雾蓝'] },
  { id: 'p6', name: '水润修护面霜', emoji: '🧴', price: 219, sales: 15602, cat: '美妆', specs: ['50g 正装', '15g 旅行装'] },
  { id: 'p7', name: '丝绒哑光口红', emoji: '💄', price: 139, sales: 18744, cat: '美妆', specs: ['枫叶红', '豆沙粉'] },
  { id: 'p8', name: '陶瓷马克杯套装', emoji: '🍵', price: 89, sales: 6301, cat: '家居', specs: ['单只', '四只装'] },
  { id: 'p9', name: '记忆棉枕芯', emoji: '🛏', price: 199, sales: 7488, cat: '家居', specs: ['标准款', '加高款'] },
  { id: 'p10', name: '每日坚果 30 包', emoji: '🥜', price: 99, sales: 32058, cat: '食品', specs: ['经典混合', '益生菌款'] },
  { id: 'p11', name: '冷萃咖啡液 12 条', emoji: '☕', price: 79, sales: 11209, cat: '食品', specs: ['无糖', '微糖'] },
  { id: 'p12', name: '即食鸡胸肉礼包', emoji: '🍗', price: 69, sales: 14933, cat: '食品', specs: ['原味', '黑胡椒'] },
]

function product(id: string): Product { return PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0] }

const seedCoupons = (): Coupon[] => [
  { id: 'c1', name: '新人券', off: 10, min: 100, used: false },
  { id: 'c2', name: '大额券', off: 30, min: 300, used: false },
]

function loadYX(): YXState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as YXState
      if (parsed && Array.isArray(parsed.cart) && Array.isArray(parsed.orders)) {
        return { ...parsed, coupons: Array.isArray(parsed.coupons) ? parsed.coupons : seedCoupons() }
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return { cart: [], orders: [], coupons: seedCoupons() }
}

const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function YouXuanPage() {
  const toast = useToast()
  const [state, setState] = useState<YXState>(loadYX)
  const [view, setView] = useState<View>('mall')
  const [kw, setKw] = useState('')
  const [cat, setCat] = useState('全部')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [spec, setSpec] = useState('')
  const [buyQty, setBuyQty] = useState(1)
  const [pick, setPick] = useState<string[]>([])          // 购物车勾选 pid|spec
  const [couponId, setCouponId] = useState<string | null>(null)
  const [pendingBuy, setPendingBuy] = useState<{ pid: string; spec: string; qty: number } | null>(null)
  const [orderFilter, setOrderFilter] = useState<'all' | 'unpaid' | 'shipped' | 'done'>('all')

  const save = (next: YXState) => {
    setState(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const list = useMemo(
    () => PRODUCTS.filter((p) => (cat === '全部' || p.cat === cat) && (!kw.trim() || p.name.toLowerCase().includes(kw.trim().toLowerCase()))),
    [cat, kw],
  )

  const detail = detailId ? product(detailId) : null
  const cartCount = state.cart.reduce((s, c) => s + c.qty, 0)
  const cartDetail = state.cart.map((c) => ({ ...c, p: product(c.pid) }))
  const picked = cartDetail.filter((c) => pick.includes(c.pid + '|' + c.spec))
  const cartSubtotal = picked.reduce((s, c) => s + c.p.price * c.qty, 0)
  const allPicked = cartDetail.length > 0 && pick.length === cartDetail.length

  // 确认订单的条目来源：立即购买直达 或 购物车勾选
  const confirmItems: OrderItem[] = pendingBuy
    ? [{ pid: pendingBuy.pid, name: product(pendingBuy.pid).name, emoji: product(pendingBuy.pid).emoji, spec: pendingBuy.spec, qty: pendingBuy.qty, price: product(pendingBuy.pid).price }]
    : picked.map((c) => ({ pid: c.pid, name: c.p.name, emoji: c.p.emoji, spec: c.spec, qty: c.qty, price: c.p.price }))
  const confirmSubtotal = confirmItems.reduce((s, i) => s + i.price * i.qty, 0)
  const usableCoupons = state.coupons.filter((c) => !c.used && confirmSubtotal >= c.min)
  const curCoupon = state.coupons.find((c) => c.id === couponId && !c.used && confirmSubtotal >= c.min) ?? null
  const confirmTotal = Math.max(0, confirmSubtotal - (curCoupon?.off ?? 0))

  const openDetail = (id: string) => {
    setDetailId(id)
    setSpec(product(id).specs[0])
    setBuyQty(1)
    setView('detail')
  }

  const addToCart = () => {
    if (!detail) return
    const key = detail.id + '|' + spec
    const existed = state.cart.find((c) => c.pid + '|' + c.spec === key)
    const cart = existed
      ? state.cart.map((c) => (c.pid + '|' + c.spec === key ? { ...c, qty: c.qty + buyQty } : c))
      : [...state.cart, { pid: detail.id, spec, qty: buyQty }]
    save({ ...state, cart })
    toast(`已加入购物车：${detail.name} · ${spec} × ${buyQty}`)
  }

  const buyNow = () => {
    if (!detail) return
    setPendingBuy({ pid: detail.id, spec, qty: buyQty })
    setCouponId(null)
    setView('confirm')
  }

  const changeQty = (key: string, d: number) => {
    const cart = state.cart
      .map((c) => (c.pid + '|' + c.spec === key ? { ...c, qty: c.qty + d } : c))
      .filter((c) => c.qty > 0)
    save({ ...state, cart })
    if (d < 0 && !state.cart.find((c) => c.pid + '|' + c.spec === key && c.qty + d > 0)) {
      setPick((prev) => prev.filter((k) => k !== key))
    }
  }

  const removePicked = () => {
    if (pick.length === 0) { toast('请先勾选要删除的商品'); return }
    save({ ...state, cart: state.cart.filter((c) => !pick.includes(c.pid + '|' + c.spec)) })
    setPick([])
    toast('已删除勾选商品 🗑')
  }

  const placeOrder = () => {
    if (confirmItems.length === 0) { toast('没有待结算的商品'); return }
    const order: Order = {
      id: uid('yx'), items: confirmItems, subtotal: confirmSubtotal,
      off: curCoupon?.off ?? 0, total: confirmTotal, status: 'unpaid', at: Date.now(),
    }
    const coupons = curCoupon ? state.coupons.map((c) => (c.id === curCoupon.id ? { ...c, used: true } : c)) : state.coupons
    const cart = pendingBuy ? state.cart : state.cart.filter((c) => pick.includes(c.pid + '|' + c.spec))
    save({ cart, orders: [order, ...state.orders], coupons })
    setPendingBuy(null)
    setPick([])
    setCouponId(null)
    setOrderFilter('all')
    setView('orders')
    toast(`订单已提交（待付款）：合计 ¥${money(order.total)}`)
  }

  const payOrder = (id: string) => {
    save({ ...state, orders: state.orders.map((o) => (o.id === id ? { ...o, status: 'shipped' } : o)) })
    toast('模拟支付成功，商家已发货 🚚')
  }

  const receiveOrder = (id: string) => {
    save({ ...state, orders: state.orders.map((o) => (o.id === id ? { ...o, status: 'done' } : o)) })
    toast('确认收货，订单完成 ✅')
  }

  const removeOrder = (id: string) => {
    save({ ...state, orders: state.orders.filter((o) => o.id !== id) })
    toast('订单已删除 🗑')
  }

  const orders = state.orders.filter((o) => orderFilter === 'all' || o.status === orderFilter)
  const statusMeta = { unpaid: ['待付款', '🟠'], shipped: ['待收货', '🚚'], done: ['已完成', '✅'] } as const

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🛍 优选商城</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          商城交易闭环演示 · 瀑布流 → 详情规格 → 购物车 → 优惠券下单 → 模拟支付与订单流转
        </p>

        {/* 顶部 Tab（含购物车角标） */}
        <div className="yx-tabs">
          {([['mall', '商城'], ['cart', '购物车'], ['orders', '订单']] as const).map(([k, label]) => (
            <button
              key={k}
              className={cx('yx-tab', view === k && 'active')}
              onClick={() => { if (k === 'cart') { setPendingBuy(null); setPick(state.cart.map((c) => c.pid + '|' + c.spec)) } setView(k) }}
            >
              {label}
              {k === 'cart' && cartCount > 0 && <span className="yx-badge">{cartCount > 99 ? '99+' : cartCount}</span>}
            </button>
          ))}
        </div>

        {/* 商城：搜索 + 金刚区 + 瀑布流 */}
        {view === 'mall' && (
          <>
            <input
              className="input yx-search"
              placeholder="搜索商品…"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <div className="rider-strip" style={{ margin: '10px 0 12px' }}>
              {CATS.map((c) => (
                <button key={c} className={cx('btn btn-sm', cat === c ? '' : 'btn-ghost')} onClick={() => setCat(c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className="card" style={{ padding: 12 }}>
              {list.length === 0 && <Empty emoji="🔍" text="没有找到相关商品" />}
              <div className="yx-grid">
                {list.map((p) => (
                  <button key={p.id} className="yx-card" onClick={() => openDetail(p.id)}>
                    <span className="yx-img">{p.emoji}</span>
                    <b className="yx-name">{p.name}</b>
                    <span className="yx-price">¥{money(p.price)}</span>
                    <span className="muted">已售 {p.sales.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 商品详情：规格 + 数量 + 加购 / 立即购买 */}
        {view === 'detail' && detail && (
          <div className="card">
            <div className="yx-detail-head">
              <span className="yx-img lg">{detail.emoji}</span>
              <div>
                <b style={{ fontSize: 16 }}>{detail.name}</b>
                <p className="yx-price" style={{ margin: '6px 0 0' }}>¥{money(detail.price)}</p>
                <span className="muted">已售 {detail.sales.toLocaleString()} · {detail.cat}</span>
              </div>
            </div>
            <div className="task-row">
              <span className="tag">规格</span>
              <div className="toolbar-actions">
                {detail.specs.map((s) => (
                  <button key={s} className={cx('btn btn-sm', spec === s ? '' : 'btn-ghost')} onClick={() => setSpec(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="task-row">
              <span className="tag">数量</span>
              <span className="qty-ctl">
                <button className="qty-btn" onClick={() => setBuyQty(Math.max(1, buyQty - 1))}>−</button>
                <b style={{ minWidth: 28, textAlign: 'center' }}>{buyQty}</b>
                <button className="qty-btn" onClick={() => setBuyQty(buyQty + 1)}>＋</button>
              </span>
            </div>
            <div className="board-toolbar">
              <button className="btn btn-ghost" onClick={() => setView('mall')}>← 返回</button>
              <div className="toolbar-actions">
                <button className="btn btn-ghost" onClick={addToCart}>加入购物车</button>
                <button className="btn" onClick={buyNow}>立即购买</button>
              </div>
            </div>
          </div>
        )}

        {/* 购物车 */}
        {view === 'cart' && (
          <div className="card">
            {cartDetail.length === 0 && <Empty emoji="🛒" text="购物车空空如也，去商城逛逛吧" />}
            {cartDetail.map((c) => {
              const key = c.pid + '|' + c.spec
              const checked = pick.includes(key)
              return (
                <div key={key} className="task-row">
                  <input type="checkbox" checked={checked} onChange={() => {
                    setPick(checked ? pick.filter((k) => k !== key) : [...pick, key])
                  }} />
                  <span className="notif-icon">{c.p.emoji}</span>
                  <div className="notif-body">
                    <p>{c.p.name} <span className="muted">· {c.spec}</span></p>
                    <small className="yx-price">¥{money(c.p.price)} × {c.qty}</small>
                  </div>
                  <span className="qty-ctl">
                    <button className="qty-btn" onClick={() => changeQty(key, -1)}>−</button>
                    <b style={{ minWidth: 24, textAlign: 'center' }}>{c.qty}</b>
                    <button className="qty-btn" onClick={() => changeQty(key, 1)}>＋</button>
                  </span>
                </div>
              )
            })}
            {cartDetail.length > 0 && (
              <>
                <div className="task-row">
                  <input type="checkbox" checked={allPicked} onChange={() => {
                    setPick(allPicked ? [] : cartDetail.map((c) => c.pid + '|' + c.spec))
                  }} />
                  <span>全选（已选 {picked.length} 件）</span>
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={removePicked}>删除勾选</button>
                </div>
                <div className="board-toolbar">
                  <b>合计 <span className="yx-price">¥{money(cartSubtotal)}</span></b>
                  <button className="btn" disabled={picked.length === 0} onClick={() => { setCouponId(null); setPendingBuy(null); setView('confirm') }}>
                    去结算（{picked.reduce((s, c) => s + c.qty, 0)} 件）
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 确认订单：地址 + 优惠券 + 实付款 */}
        {view === 'confirm' && (
          <div className="card">
            <div className="task-row">
              <span className="notif-icon">📍</span>
              <div className="notif-body">
                <p>收货地址：<b>王小明 138****6666</b></p>
                <small className="muted">示例市高新区优选路 88 号 3 栋 502（演示地址）</small>
              </div>
            </div>
            <div className="task-row">
              <span className="notif-icon">🎁</span>
              <div className="notif-body">
                <p>优惠券抵扣</p>
                <div className="toolbar-actions" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  <button className={cx('btn btn-sm', !couponId ? '' : 'btn-ghost')} onClick={() => setCouponId(null)}>不使用</button>
                  {usableCoupons.map((c) => (
                    <button key={c.id} className={cx('btn btn-sm', couponId === c.id ? '' : 'btn-ghost')} onClick={() => setCouponId(c.id)}>
                      {c.name} 满{c.min}减{c.off}
                    </button>
                  ))}
                  {state.coupons.filter((c) => !usableCoupons.includes(c)).map((c) => (
                    <button key={c.id} className="btn btn-sm btn-ghost" disabled title={c.used ? '已使用' : `需满 ${c.min} 元可用`}>
                      {c.name} 满{c.min}减{c.off}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="task-row">
              <span className="notif-icon">🧾</span>
              <div className="notif-body">
                {confirmItems.map((i) => (
                  <p key={i.pid + i.spec} style={{ margin: '2px 0' }}>
                    {i.emoji} {i.name} <span className="muted">· {i.spec} × {i.qty}</span>
                  </p>
                ))}
                {confirmItems.length === 0 && <p className="muted">没有待结算的商品，请先去购物车勾选</p>}
              </div>
            </div>
            <div className="task-row">
              <span className="tag">小计</span><b>¥{money(confirmSubtotal)}</b>
            </div>
            <div className="task-row">
              <span className="tag">券抵扣</span><b className={curCoupon ? 'coze-ok' : 'muted'}>− ¥{money(curCoupon?.off ?? 0)}</b>
            </div>
            <div className="board-toolbar">
              <b>实付款 <span className="yx-price" style={{ fontSize: 20 }}>¥{money(confirmTotal)}</span></b>
              <div className="toolbar-actions">
                <button className="btn btn-ghost" onClick={() => { setPendingBuy(null); setView(pick.length > 0 ? 'cart' : 'mall') }}>返回</button>
                <button className="btn" disabled={confirmItems.length === 0} onClick={placeOrder}>提交订单</button>
              </div>
            </div>
          </div>
        )}

        {/* 订单列表：状态筛选 + 流转 */}
        {view === 'orders' && (
          <div className="card">
            <div className="rider-strip" style={{ margin: '0 0 8px' }}>
              {([['all', '全部'], ['unpaid', '待付款'], ['shipped', '待收货'], ['done', '已完成']] as const).map(([k, label]) => (
                <button key={k} className={cx('btn btn-sm', orderFilter === k ? '' : 'btn-ghost')} onClick={() => setOrderFilter(k)}>
                  {label}{k !== 'all' && `（${state.orders.filter((o) => o.status === k).length}）`}
                </button>
              ))}
            </div>
            {orders.length === 0 && <Empty emoji="📦" text="暂无对应状态的订单" />}
            {orders.map((o) => {
              const [label, icon] = statusMeta[o.status]
              const summary = o.items.map((i) => `${i.emoji}${i.name}×${i.qty}`).join('、')
              return (
                <div key={o.id} className="task-row">
                  <span className="notif-icon">{icon}</span>
                  <div className="notif-body">
                    <p>
                      <span className="tag">{label}</span>
                      {summary.slice(0, 40)}
                      {summary.length > 40 ? '…' : ''}
                    </p>
                    <small className="muted">
                      {o.id} · 小计 ¥{money(o.subtotal)}{o.off > 0 ? ` - 券¥${money(o.off)}` : ''} · 实付 <b className="yx-price">¥{money(o.total)}</b>
                    </small>
                  </div>
                  <div className="toolbar-actions" style={{ flexShrink: 0 }}>
                    {o.status === 'unpaid' && <button className="btn btn-sm" onClick={() => payOrder(o.id)}>去支付</button>}
                    {o.status === 'shipped' && <button className="btn btn-sm" onClick={() => receiveOrder(o.id)}>确认收货</button>}
                    {o.status === 'done' && <button className="btn btn-ghost btn-sm" onClick={() => removeOrder(o.id)}>删除</button>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
