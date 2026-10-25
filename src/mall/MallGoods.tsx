/* 商城商品详情页：全局通用详情——emoji 展示、价格、数量选择、加入购物车/立即购买。 */

import { useState } from 'react'
import { Empty, useToast } from '../components'
import { useRouter } from '../router'
import { MALL_CHANNEL_META, useMall, useMallGoods } from './store'

export function MallGoodsPage({ id }: { id: string }) {
  const toast = useToast()
  const { navigate } = useRouter()
  const { addToCart } = useMall()
  const [qty, setQty] = useState(1)
  /* 商品目录与商城中心同源：云端优先 + 演示兜底，保证详情页可直接打开 */
  const { goods, loading } = useMallGoods()
  const g = goods.find((x) => x.id === id)
  if (loading) return <Empty text="正在加载商品…" />
  if (!g) return <Empty text="商品不存在" />
  const meta = MALL_CHANNEL_META[g.channel]

  const add = (goCart: boolean) => {
    addToCart(g.id, qty)
    if (goCart) navigate('/mall/cart')
    else toast(`已加入购物车 · ${g.title} x${qty}`)
  }

  return (
    <div className="page-grid single">
      <div>
        <a className="mall-back" href="#/mall">
          ← 返回商城
        </a>
        <div className="card mall-detail">
          <div className="mall-detail-emoji">{g.emoji}</div>
          <div className="mall-detail-info">
            <span className="tag">
              {meta.emoji} {meta.label}
            </span>
            <h2>{g.title}</h2>
            <div className="mall-goods-desc">{g.desc}</div>
            <div className="mall-goods-price">
              <b>¥{g.price}</b>
              {g.origPrice !== undefined && <s>¥{g.origPrice}</s>}
            </div>
            <div className="mall-qty">
              <span>数量</span>
              <button className="btn btn-ghost btn-sm" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>
                -
              </button>
              <b>{qty}</b>
              <button className="btn btn-ghost btn-sm" disabled={qty >= 99} onClick={() => setQty(qty + 1)}>
                +
              </button>
            </div>
            <div className="mall-detail-actions">
              <button className="btn btn-ghost" onClick={() => add(false)}>
                加入购物车
              </button>
              <button className="btn btn-primary" onClick={() => add(true)}>
                立即购买
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
