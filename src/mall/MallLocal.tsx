/* 本地生活会场：商户门店 + 套餐券 + 我的券包（到店核销）。
   券码由服务端生成与核销（issue_voucher_code / verify_voucher），
   前端只展示，不构造码 —— 避免履约凭证可被客户端伪造。 */

import { useState } from 'react'
import { Empty, useToast } from '../components'
import { useRouter } from '../router'
import { useMall } from './store'
import { fmtDate, voucherUsable } from './biz/types'
import { useLocalMerchants, useLocalVouchers, useMyVoucherCodes, vouchersByMerchant } from './biz/local'
import type { LocalMerchant, LocalVoucher } from './biz/types'

const CODE_STATUS: Record<string, { label: string; cls: string }> = {
  unused: { label: '待核销', cls: 'mall-biz-pending' },
  used: { label: '已核销', cls: 'mall-biz-done' },
  expired: { label: '已过期', cls: 'mall-biz-closed' },
  refunding: { label: '退款中', cls: 'mall-biz-pending' },
  refunded: { label: '已退款', cls: 'mall-biz-closed' },
}

/** 套餐券卡片：购买即建单（支付后到「订单中心」取券码） */
function VoucherCard({ v, merchant }: { v: LocalVoucher; merchant: LocalMerchant | undefined }) {
  const toast = useToast()
  const { navigate } = useRouter()
  const { placeBizOrder } = useMall()
  const [busy, setBusy] = useState(false)

  const buy = async () => {
    if (busy) return
    setBusy(true)
    try {
      const order = await placeBizOrder({
        goodsId: v.goodsId || v.id,
        title: v.title,
        emoji: v.emoji,
        price: v.price,
        qty: 1,
        ext: {
          kind: 'local',
          merchantId: v.merchantId,
          merchantName: merchant?.name ?? '门店',
          voucherId: v.id,
          voucherCode: '', // 支付成功后由服务端发码，此处留空
          expireAt: v.validUntil,
        },
      })
      if (order) {
        toast(`已下单 · 支付后可在订单中心取券码`)
        navigate('/mall/orders')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mall-biz-card">
      <div className="mall-biz-head">
        <span className="mall-biz-emoji">{v.emoji}</span>
        <div className="mall-biz-title">
          <b>{v.title}</b>
          <small>
            ¥{v.price} 抢 ¥{v.value} · 有效期至 {fmtDate(new Date(v.validUntil))}
          </small>
        </div>
        <span className="mall-biz-status mall-biz-pending">剩 {v.remaining}</span>
      </div>
      {v.rules.length > 0 && (
        <div className="mall-biz-rules">
          {v.rules.map((r) => (
            <span key={r} className="tag">
              {r}
            </span>
          ))}
        </div>
      )}
      <div className="mall-biz-foot">
        <div className="mall-goods-price">
          <b>¥{v.price}</b>
          <s>¥{v.value}</s>
        </div>
        <div className="mall-biz-actions">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={buy}>
            {busy ? '下单中…' : '立即购买'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MallLocalPage() {
  const { merchants, loading: lm, fromCloud: fm } = useLocalMerchants()
  const { vouchers, loading: lv, fromCloud: fv } = useLocalVouchers()
  const { codes, loading: lc, fromCloud: fc } = useMyVoucherCodes()
  const now = Date.now()
  const byMerchant = vouchersByMerchant(vouchers)
  const loading = lm || lv || lc
  const ready = fm || fv

  return (
    <div className="page-grid single">
      <div>
        <a className="mall-back" href="#/mall">
          ← 返回商城
        </a>
        <h1 className="page-title">🍜 本地生活</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          门店套餐券在线购买，到店出示券码核销，一码一次、核销即销。
        </p>

        <h2 className="mall-biz-section">🎫 我的券包</h2>
        {lc ? (
          <Empty text="正在加载券包…" />
        ) : !fc ? (
          <Empty text="券码表未就绪（需应用迁移 0012）" />
        ) : codes.length === 0 ? (
          <Empty text="暂无券码，购买套餐后到订单中心取码" />
        ) : (
          codes.map((c) => {
            const m = CODE_STATUS[c.status] ?? CODE_STATUS.unused
            /* 已过有效期但未核销的码按过期展示：避免用户拿着过期码到店 */
            const expired = c.status === 'unused' && !voucherUsable(c, now)
            const meta = expired ? CODE_STATUS.expired : m
            return (
              <div key={c.code} className="card mall-biz-card">
                <div className="mall-biz-head">
                  <span className="mall-biz-emoji">🎟️</span>
                  <div className="mall-biz-title">
                    <b>{c.code}</b>
                    <small>有效期至 {fmtDate(new Date(c.expireAt))}</small>
                  </div>
                  <span className={`mall-biz-status ${meta.cls}`}>{meta.label}</span>
                </div>
              </div>
            )
          })
        )}

        <h2 className="mall-biz-section">🏪 门店与套餐</h2>
        {loading ? (
          <Empty text="正在加载门店…" />
        ) : !ready ? (
          <Empty text="本地生活业务表未就绪（需应用迁移 0012），暂不可用" />
        ) : merchants.length === 0 ? (
          <Empty text="暂无门店" />
        ) : (
          merchants.map((m) => {
            const list = byMerchant.get(m.id) ?? []
            if (list.length === 0) return null
            return (
              <div key={m.id} className="card mall-biz-merchant">
                <div className="mall-biz-head">
                  <span className="mall-biz-emoji">{m.emoji}</span>
                  <div className="mall-biz-title">
                    <b>{m.name}</b>
                    <small>
                      {m.category} · {m.address}
                      {m.hours ? ` · ${m.hours}` : ''}
                    </small>
                  </div>
                </div>
                {list.map((v) => (
                  <VoucherCard key={v.id} v={v} merchant={m} />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
