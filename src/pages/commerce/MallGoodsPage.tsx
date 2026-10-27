/* ==========================================================================
 * 商品详情 —— 统一商品页（秒杀 / 直播 / 本地券点进来都落在这里）
 *
 * 数据：从 useMall().goods 里按 id 取，云端 products 表唯一来源。
 *      取不到就是商品下架或链接失效，给空态而不是猜一个商品出来。
 * 金额：priceFen / origPriceFen 一律「分」，展示用 yuanText()，不做二次换算。
 *
 * 注意：业务成交价（秒杀价 / 直播专享价）不在详情页加购生效 ——
 *      那些会场走 placeBizOrder 直接建单；详情页只按目录价加购。
 * ======================================================================== */

import { useState } from 'react'
import { useMall } from '@/app/state/mall'
import { MALL_CHANNEL_META } from '@/domain/commerce/model'
import { Empty, Skeleton, useToast } from '@/ui'
import { clamp, yuanText } from '@/core/utils'

const MAX_QTY = 99

export interface MallGoodsPageProps {
  id: string
}

export function MallGoodsPage({ id }: MallGoodsPageProps) {
  const { goods, goodsLoading, addToCart } = useMall()
  const toast = useToast()
  const [qty, setQty] = useState(1)

  if (goodsLoading) {
    return (
      <div className="page">
        <Skeleton rows={3} height={120} />
      </div>
    )
  }

  const g = goods.find((x) => x.id === id) ?? null
  const channel = g ? MALL_CHANNEL_META[g.channel] : null

  if (!g || !channel) {
    return (
      <div className="page">
        <Empty emoji="🔍" text="商品不存在或已下架，回商城看看其他好物吧" />
        <a className="btn btn-primary btn-block" href="#/mall">
          回到商城中心
        </a>
      </div>
    )
  }

  const totalFen = g.priceFen * qty

  return (
    <div className="page">
      <div className="card mall-goods-detail">
        <div className="mall-goods-detail-emoji">{g.emoji}</div>
        <div className="col" style={{ gap: 6 }}>
          <h1 className="page-title" style={{ margin: 0 }}>
            {g.title}
          </h1>
          <div className="row wrap">
            <span className="tag">
              {channel.emoji} {channel.label}
            </span>
            {g.origPriceFen !== undefined ? <span className="tag">省 ¥{yuanText(g.origPriceFen - g.priceFen)}</span> : null}
          </div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <span className="mall-goods-price" style={{ fontSize: 22 }}>
              ¥{yuanText(g.priceFen)}
            </span>
            {g.origPriceFen !== undefined ? <span className="mall-goods-orig">¥{yuanText(g.origPriceFen)}</span> : null}
          </div>
        </div>
      </div>

      <div className="section-title">商品介绍</div>
      <div className="card">
        {g.desc ? <div className="post-body">{g.desc}</div> : <Empty emoji="📝" text="该商品暂无详细介绍" />}
      </div>

      <div className="section-title">购买数量</div>
      <div className="card row-between">
        <div className="row">
          <button
            className="btn btn-sm"
            disabled={qty <= 1}
            onClick={() => setQty((n) => clamp(n - 1, 1, MAX_QTY))}
            aria-label="减少数量"
          >
            －
          </button>
          <b style={{ minWidth: 28, textAlign: 'center' }}>{qty}</b>
          <button
            className="btn btn-sm"
            disabled={qty >= MAX_QTY}
            onClick={() => setQty((n) => clamp(n + 1, 1, MAX_QTY))}
            aria-label="增加数量"
          >
            ＋
          </button>
        </div>
        <div className="right">
          <div className="muted" style={{ fontSize: 12 }}>
            小计
          </div>
          <div className="mall-goods-price">¥{yuanText(totalFen)}</div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary grow"
          onClick={() => {
            addToCart(g.id, qty)
            toast(`已加入购物车 ×${qty}`)
          }}
        >
          加入购物车
        </button>
        <a className="btn" href="#/mall/cart">
          去购物车
        </a>
      </div>
    </div>
  )
}
