/* 商城购物车：全局通用购物车——数量调整、删除、结算。
   结算落 unpaid 订单（不扣钱，支付在订单中心完成），成功后回商城首页。 */

import { Empty, useToast } from '../components'
import { useRouter } from '../router'
import { useMall, useMallGoods } from './store'

export function MallCartPage() {
  const toast = useToast()
  const { navigate } = useRouter()
  const { state, setCartQty, removeFromCart, checkout } = useMall()
  /* 商品目录与商城中心同源：云端优先 + 演示兜底，
     否则云端模式下购物车条目会因取不到商品而被当成孤儿条目丢弃 */
  const { goods } = useMallGoods()

  const rows = state.cart
    .map((c) => {
      const g = goods.find((x) => x.id === c.goodsId)
      return g ? { c, g } : null
    })
    .filter((r) => r !== null)
  const total = rows.reduce((sum, r) => sum + r.g.price * r.c.qty, 0)
  const count = rows.reduce((n, r) => n + r.c.qty, 0)

  // 以可解析到商品库的条目为准（云端模式演示商品下架后，孤儿条目不阻塞空态判断）
  if (rows.length === 0) {
    return (
      <div className="page-grid single">
        <div>
          <h1 className="page-title">🧺 购物车</h1>
          <Empty text="购物车空空如也" />
          <div className="mall-cart-empty-go">
            <a className="btn btn-primary" href="#/mall">
              去逛逛
            </a>
          </div>
        </div>
      </div>
    )
  }

  const onCheckout = () => {
    const order = checkout()
    if (!order) return
    toast(`订单已提交 · ${order.id}`)
    navigate('/mall')
  }

  return (
    <div className="page-grid single">
      <div>
        <h1 className="page-title">🧺 购物车</h1>
        <div className="card">
          {rows.map(({ c, g }) => (
            <div key={`${c.goodsId}-${c.spec ?? ''}`} className="mall-cart-row">
              <a className="mall-cart-emoji" href={`#/mall/goods/${g.id}`}>
                {g.emoji}
              </a>
              <div className="mall-cart-info">
                <a href={`#/mall/goods/${g.id}`}>
                  <b>{g.title}</b>
                </a>
                {c.spec && <small>规格：{c.spec}</small>}
                <small>
                  ¥{g.price} × {c.qty} = <b className="mall-cart-sub">¥{g.price * c.qty}</b>
                </small>
              </div>
              <div className="mall-cart-ops">
                <button className="btn btn-ghost btn-sm" onClick={() => setCartQty(c.goodsId, c.spec, c.qty - 1)}>
                  -
                </button>
                <b>{c.qty}</b>
                <button className="btn btn-ghost btn-sm" onClick={() => setCartQty(c.goodsId, c.spec, c.qty + 1)}>
                  +
                </button>
                <button className="icon-btn" title="删除" onClick={() => removeFromCart(c.goodsId, c.spec)}>
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="card mall-cart-bar">
          <span className="muted">
            共 {count} 件 · 钱包余额 ¥{state.wallet}
          </span>
          <b className="mall-cart-total">合计：¥{total}</b>
          <button className="btn btn-primary" onClick={onCheckout}>
            结算
          </button>
          {state.wallet < total && <small className="mall-cart-warn">余额不足，可先提交订单，稍后在订单中心充值支付</small>}
        </div>
      </div>
    </div>
  )
}
