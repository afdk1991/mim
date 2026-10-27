/* ==========================================================================
 * 商城中心 —— 四业务统一入口 + 五频道商品流
 *
 * 数据：商品只来自 useMall().goods（云端 products 表唯一来源），空即空态，
 *      绝不预铺演示商品；频道只是商品的一个归类标签。
 *
 * 坑（原实现真实踩过）：hash 从 #/mall/gexm 切到 #/mall/mix 时 React 复用同一
 *      组件实例，useState(initial) 的初值只在挂载时生效一次 ——
 *      结果「点了频道但商品列表不动」。必须用 useEffect 跟随 initial 覆盖手动选择。
 * ========================================================================== */

import { useEffect, useState } from 'react'
import { useMall } from '@/app/state/mall'
import { useRouter } from '@/app/router'
import { MALL_CHANNEL_META } from '@/domain/commerce/model'
import type { MallChannel } from '@/domain/commerce/model'
import { BIZ_ENTRIES } from '@/domain/commerce/biz/registry'
import { Empty, Skeleton } from '@/ui'
import { cx, yuanText } from '@/core/utils'

const CHANNELS = Object.keys(MALL_CHANNEL_META) as MallChannel[]

export interface MallHomePageProps {
  initial?: MallChannel
}

export function MallHomePage({ initial }: MallHomePageProps) {
  const { goods, goodsLoading, goodsFromCloud } = useMall()
  const { navigate } = useRouter()
  const [channel, setChannel] = useState<MallChannel>(initial ?? 'youxuan')

  // 组件实例被路由复用时，useState 初值不会重算，只能靠 effect 同步
  useEffect(() => {
    if (initial) setChannel(initial)
  }, [initial])

  // 切频道同时改 hash，保证地址可分享、刷新后仍在原频道
  const pick = (c: MallChannel): void => {
    setChannel(c)
    navigate(`/mall/${c}`)
  }

  const list = goods.filter((g) => g.channel === channel)
  const meta = MALL_CHANNEL_META[channel]

  return (
    <div className="page">
      <h1 className="page-title">🛍️ 商城中心</h1>

      <div className="section-title">业务会场</div>
      <div className="mall-biz-entries">
        {BIZ_ENTRIES.map((b) => (
          <a key={b.kind} className="card mall-biz-entry" href={`#/mall/biz/${b.route}`}>
            <span className="mall-biz-entry-emoji">{b.emoji}</span>
            <b>{b.label}</b>
            <small>{b.tagline}</small>
          </a>
        ))}
      </div>

      <div className="section-title">
        {meta.emoji} {meta.label}
      </div>
      <div className="chip-row">
        {CHANNELS.map((c) => (
          <button key={c} className={cx('chip', c === channel && 'active')} onClick={() => pick(c)}>
            {MALL_CHANNEL_META[c].emoji} {MALL_CHANNEL_META[c].label}
          </button>
        ))}
      </div>

      {goodsLoading ? <Skeleton rows={3} height={110} /> : null}

      {!goodsLoading && !goodsFromCloud ? (
        <Empty emoji="📭" text="商品数据尚未就绪：云端 products 表暂不可读，请稍后再来" />
      ) : null}

      {!goodsLoading && goodsFromCloud && list.length === 0 ? <Empty emoji="📭" text={`${meta.label} 暂无在售商品`} /> : null}

      {!goodsLoading && list.length > 0 ? (
        <div className="mall-goods-grid">
          {list.map((g) => (
            <a key={g.id} className="card mall-goods-card" href={`#/mall/goods/${g.id}`}>
              <span className="mall-goods-emoji">{g.emoji}</span>
              <span className="mall-goods-card-title">{g.title}</span>
              <span className="mall-goods-price">¥{yuanText(g.priceFen)}</span>
              {g.origPriceFen !== undefined ? <span className="mall-goods-orig">¥{yuanText(g.origPriceFen)}</span> : null}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}
