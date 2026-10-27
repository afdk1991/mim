/* ==========================================================================
 * 购物车 —— 数量增减 / 删除 / 结算
 *
 * 金额口径铁律：总价必须走 mall 的 cartTotalFen(goods)，
 *      与 checkout() 用同一个 unitPriceFen —— 业务行（秒杀价/直播价）有
 *      priceFen 覆盖，页面自己按目录价累加会与结算金额对不上。
 * ======================================================================== */

import { useMall } from '@/app/state/mall'
import { useRouter } from '@/app/router'
import { unitPriceFen } from '@/domain/commerce/order'
import type { MallCartItem, MallGoods } from '@/domain/commerce/model'
import { Empty, Skeleton, useToast } from '@/ui'
import { clamp, yuanText } from '@/core/utils'

const MAX_QTY = 99

export function MallCartPage() {
  const { state, goods, goodsLoading, setCartQty, removeFromCart, clearCart, checkout, cartTotalFen } = useMall()
  const { navigate } = useRouter()
  const toast = useToast()

  const rows = state.cart.map((item) => ({
    item,
    goods: goods.find((g) => g.id === item.goodsId),
  }))

  if (goodsLoading) {
    return (
      <div className="page">
        <Skeleton rows={3} height={72} />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="page">
        <Empty emoji="🛒" text="购物车还是空的，去商城挑几件吧" />
        <a className="btn btn-primary btn-block" href="#/mall">
          去逛逛
        </a>
      </div>
    )
  }

  const totalFen = cartTotalFen(goods)

  return (
    <div className="page">
      <h1 className="page-title">🛒 购物车</h1>

      {rows.map(({ item, goods: g }) => (
        <CartRow
          key={`${item.goodsId}|${item.spec ?? ''}|${item.ext ? 'biz' : 'std'}`}
          item={item}
          goods={g}
          onQty={(q) => setCartQty(item.goodsId, item.spec, q)}
          onRemove={() => removeFromCart(item.goodsId, item.spec)}
        />
      ))}

      <div className="card row-between">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>
            合计（{rows.reduce((n, r) => n + r.item.qty, 0)} 件）
          </div>
          <div className="mall-goods-price" style={{ fontSize: 20 }}>
            ¥{yuanText(totalFen)}
          </div>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={clearCart}>
            清空
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              const o = checkout()
              if (!o) {
                toast('结算失败：购物车为空或商品已下架')
                return
              }
              toast('订单已创建，请完成支付')
              navigate('/mall/orders')
            }}
          >
            去结算
          </button>
        </div>
      </div>
    </div>
  )
}

function CartRow({
  item,
  goods,
  onQty,
  onRemove,
}: {
  item: MallCartItem
  goods: MallGoods | undefined
  onQty: (q: number) => void
  onRemove: () => void
}) {
  // 商品已下架时不再假装能买：保留行让用户自己删，避免结算时静默丢失
  if (!goods) {
    return (
      <div className="card mall-cart-row">
        <div className="grow">
          <b>商品已下架</b>
          <div className="muted" style={{ fontSize: 12 }}>
            id：{item.goodsId}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onRemove}>
          删除
        </button>
      </div>
    )
  }

  const unit = unitPriceFen(item, goods)

  return (
    <div className="card mall-cart-row">
      <span className="mall-biz-emoji">{goods.emoji}</span>
      <div className="grow">
        <b>{goods.title}</b>
        <div className="muted" style={{ fontSize: 12 }}>
          ¥{yuanText(unit)}
          {item.spec ? ` · ${item.spec}` : ''}
          {item.ext ? ' · 业务专享价' : ''}
        </div>
      </div>
      <div className="row">
        <button className="btn btn-sm" disabled={item.qty <= 1} onClick={() => onQty(clamp(item.qty - 1, 1, MAX_QTY))}>
          －
        </button>
        <b style={{ minWidth: 24, textAlign: 'center' }}>{item.qty}</b>
        <button
          className="btn btn-sm"
          disabled={item.qty >= MAX_QTY}
          onClick={() => onQty(clamp(item.qty + 1, 1, MAX_QTY))}
        >
          ＋
        </button>
      </div>
      <div className="mall-goods-price right" style={{ minWidth: 72 }}>
        ¥{yuanText(unit * item.qty)}
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onRemove}>
        删除
      </button>
    </div>
  )
}
