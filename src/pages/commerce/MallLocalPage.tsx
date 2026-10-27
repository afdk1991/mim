/* ==========================================================================
 * 本地生活会会场 —— 门店 / 套餐券 / 我的券码
 *
 * 数据：local_merchants + local_vouchers（status='active'）+ local_vouchers_codes
 *      （RLS 保证只能看到自己的码），行 → 模型走 domain 层 mapXxx。
 *
 * 防伪造 / 防重复核销的落地方式：
 *   券码**只能由服务端生成**（issue_voucher_code，且订单未支付不发码），
 *   前端不构造、不猜测任何码；核销在服务端用 where status='unused' 的
 *   条件更新做一次性状态转移，同一码不可能被销两次。
 *   页面只负责展示码与状态。
 * ======================================================================== */

import { useState } from 'react'
import { useMall } from '@/app/state/mall'
import { useRouter } from '@/app/router'
import type { LocalMerchant, LocalVoucher, VoucherCode } from '@/domain/commerce/model'
import {
  VOUCHER_STATUS_TEXT,
  mapMerchant,
  mapVoucher,
  mapVoucherCode,
  voucherExpireAt,
  vouchersByMerchant,
} from '@/domain/commerce/biz/local'
import type { MerchantRow, VoucherCodeRow, VoucherRow } from '@/domain/commerce/biz/local'
import { Empty, Skeleton, useToast } from '@/ui'
import { cx, formatDate, yuanText } from '@/core/utils'
import { useCloudList } from './use-commerce-data'

export function MallLocalPage() {
  const merchants = useCloudList<MerchantRow, LocalMerchant>('local_merchants', mapMerchant, {
    order: { col: 'name', asc: true },
    limit: 200,
  })
  const vouchers = useCloudList<VoucherRow, LocalVoucher>('local_vouchers', mapVoucher, {
    eq: [['status', 'active']],
    order: { col: 'price_cents', asc: true },
    limit: 200,
  })
  const codes = useCloudList<VoucherCodeRow, VoucherCode>('local_voucher_codes', mapVoucherCode, {
    order: { col: 'expire_at', asc: false },
    limit: 50,
  })

  const { placeBizOrder } = useMall()
  const { navigate } = useRouter()
  const toast = useToast()
  const [busyId, setBusyId] = useState('')

  const groups = vouchersByMerchant(vouchers.items)
  const byId = new Map(merchants.items.map((m) => [m.id, m]))

  const buy = async (v: LocalVoucher): Promise<void> => {
    if (v.remaining <= 0) {
      toast('该套餐券已售完')
      return
    }
    setBusyId(v.id)
    const order = await placeBizOrder({
      goodsId: v.goodsId || v.id,
      title: v.title,
      emoji: v.emoji,
      priceFen: v.priceFen,
      qty: 1,
      ext: {
        kind: 'local',
        merchantId: v.merchantId,
        merchantName: byId.get(v.merchantId)?.name ?? '',
        voucherId: v.id,
        // 空串占位：支付后由服务端 issue_voucher_code 回填，前端不得自行构造
        voucherCode: '',
        expireAt: voucherExpireAt(v.validUntil),
      },
      // 到店券无需占库存，取消订单也不释放任何资源
    })
    setBusyId('')
    if (order) {
      toast('订单已创建，支付后可在订单中心取券码')
      navigate('/mall/orders')
    }
  }

  const loading = merchants.loading || vouchers.loading || codes.loading
  const failed = merchants.error ?? vouchers.error ?? null
  const empty = !loading && groups.length === 0 && codes.items.length === 0

  return (
    <div className="page">
      <h1 className="page-title">🍜 本地生活</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        门店套餐 · 券码核销 · 到店可用（券码由服务端生成与核销）
      </p>

      {loading ? <Skeleton rows={3} height={110} /> : null}

      {!loading && failed ? <Empty emoji="📭" text={`门店数据暂不可读：${failed}`} /> : null}

      {!loading && !failed && empty ? <Empty emoji="📭" text="暂无可购套餐券，稍后再来看看" /> : null}

      {!loading &&
        groups.map((g) => (
          <MerchantBlock
            key={g.merchantId}
            merchant={byId.get(g.merchantId)}
            vouchers={g.vouchers}
            busyId={busyId}
            onBuy={buy}
          />
        ))}

      {!loading && codes.items.length > 0 ? (
        <>
          <div className="section-title">🎟️ 我的券码</div>
          {codes.items.map((c) => (
            <div className="card notif-row" key={c.code}>
              <span className="notif-icon">🎟️</span>
              <div className="notif-body">
                <div className="row-between">
                  <b className="mall-code">{c.code}</b>
                  <span className="tag">{VOUCHER_STATUS_TEXT[c.status]}</span>
                </div>
                <small className="muted">
                  订单 {c.orderId} · 有效期至 {formatDate(c.expireAt)}
                  {c.usedAt ? ` · 核销于 ${formatDate(c.usedAt)}` : ''}
                </small>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

function MerchantBlock({
  merchant,
  vouchers,
  busyId,
  onBuy,
}: {
  merchant: LocalMerchant | undefined
  vouchers: LocalVoucher[]
  busyId: string
  onBuy: (v: LocalVoucher) => Promise<void>
}) {
  return (
    <div className="card mall-biz-card">
      <div className="mall-biz-head">
        <span className="mall-biz-emoji">{merchant?.emoji ?? '🏪'}</span>
        <div className="mall-biz-title">
          <b>{merchant?.name ?? '未命名门店'}</b>
          <small>
            {merchant?.category ?? '其他'}
            {merchant?.address ? ` · ${merchant.address}` : ''}
            {merchant?.hours ? ` · ${merchant.hours}` : ''}
            {merchant?.phone ? ` · ${merchant.phone}` : ''}
          </small>
        </div>
      </div>

      {vouchers.map((v) => (
        <div className="mall-biz-line" key={v.id}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>
            {v.emoji} {v.title}
          </span>
          <span>售 ¥{yuanText(v.priceFen)} · 值 ¥{yuanText(v.valueFen)}</span>
          <span>有效期至 {formatDate(v.validUntil)} · 剩 {v.remaining}</span>
          <button
            className={cx('btn', 'btn-primary', 'btn-sm')}
            disabled={busyId === v.id || v.remaining <= 0}
            onClick={() => void onBuy(v)}
          >
            {busyId === v.id ? '下单中…' : '购买'}
          </button>
        </div>
      ))}

      {vouchers[0]?.rules.length ? (
        <div className="mall-biz-rules">
          {vouchers[0].rules.map((r) => (
            <span className="tag" key={r}>
              {r}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
