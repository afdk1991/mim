/* 商城中心：统一商品流 + 频道分类 chip + 资产条。
   全局通用电商入口——频道仅作分类标签（不保留旧模块独特交互）。 */

import { useState } from 'react'
import { Empty } from '../components'
import { cx } from '../utils'
import { MALL_CHANNEL_META, MALL_GOODS, useMall } from './store'
import type { MallChannel } from './store'

type Cat = MallChannel | 'all'

export function MallHomePage() {
  const { state } = useMall()
  const [cat, setCat] = useState<Cat>('all')
  const goods = cat === 'all' ? MALL_GOODS : MALL_GOODS.filter((g) => g.channel === cat)
  const cartCount = state.cart.reduce((n, c) => n + c.qty, 0)

  return (
    <div className="page-grid single">
      <div>
        <h1 className="page-title">🛒 商城中心</h1>

        <div className="card myhub-card">
          <div className="myhub-assets">
            <a className="myhub-asset" href="#/mall">
              <span className="myhub-asset-emoji">💰</span>
              <b className="myhub-asset-value">¥{state.wallet}</b>
              <small>钱包余额</small>
            </a>
            <a className="myhub-asset" href="#/mall">
              <span className="myhub-asset-emoji">🪙</span>
              <b className="myhub-asset-value">{state.points}</b>
              <small>积分</small>
            </a>
            <a className="myhub-asset" href="#/mall">
              <span className="myhub-asset-emoji">🧺</span>
              <b className="myhub-asset-value">{cartCount}</b>
              <small>购物车</small>
            </a>
          </div>
        </div>

        <div className="mall-chips">
          <button className={cx('chip', cat === 'all' && 'active')} onClick={() => setCat('all')}>
            全部
          </button>
          {(Object.keys(MALL_CHANNEL_META) as MallChannel[]).map((ch) => (
            <button key={ch} className={cx('chip', cat === ch && 'active')} onClick={() => setCat(ch)}>
              {MALL_CHANNEL_META[ch].emoji} {MALL_CHANNEL_META[ch].label}
            </button>
          ))}
        </div>

        {goods.length === 0 ? (
          <Empty text="该频道暂无商品" />
        ) : (
          <div className="mall-grid">
            {goods.map((g) => (
              <div key={g.id} className="card mall-goods">
                <div className="mall-goods-emoji">{g.emoji}</div>
                <b className="mall-goods-title">{g.title}</b>
                <div className="mall-goods-desc">{g.desc}</div>
                <div className="mall-goods-price">
                  <b>¥{g.price}</b>
                  {g.origPrice !== undefined && <s>¥{g.origPrice}</s>}
                </div>
                <span className="tag mall-goods-cat">
                  {MALL_CHANNEL_META[g.channel].emoji} {MALL_CHANNEL_META[g.channel].label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
