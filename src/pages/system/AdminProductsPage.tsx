/* ==========================================================================
 * 商品管理 —— #/admin/products
 *
 * 数据：直接复用 /api/rest/products。服务端对该表配置了 adminOverride，
 *      管理员可读写任意商品；普通用户只能维护自己创建的行。
 * 坑：
 *  1. 表列名是 price_cents（分），与前端 Fen 口径同名不同字，落库前必须换算，
 *     绝不手写 /100 或 *100 之外的转换。
 *  2. 后端未就绪时降级为空态 + 原因，绝不预置演示商品。
 *  3. 上下架只是 status 的合法取值（draft / active / archived），不是删除。
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { db } from '../../data/client'
import { getSession } from '../../data/session'
import { errText } from '../../core/result'
import { formatDate, yuanText, yuanToFen } from '../../core/utils'
import { MALL_CHANNEL_META } from '../../domain/commerce/model'
import type { MallChannel } from '../../domain/commerce/model'
import { Empty, Skeleton, Tag, useToast } from '../../ui'

const PAGE_SIZE = 200
const CHANNELS = Object.keys(MALL_CHANNEL_META) as MallChannel[]

interface ProductRow {
  id: string
  title?: string
  price_cents?: number
  original_price_cents?: number | null
  currency?: string
  channel?: string
  emoji?: string
  description?: string | null
  status?: string
  stock?: number
  sales?: number
  sort?: number
  created_at?: string
}

interface Draft {
  title: string
  channel: MallChannel
  priceYuan: string
  origYuan: string
  stock: string
  sort: string
  emoji: string
  desc: string
  status: string
}

const EMPTY_DRAFT: Draft = {
  title: '',
  channel: 'youxuan',
  priceYuan: '',
  origYuan: '',
  stock: '0',
  sort: '0',
  emoji: '📦',
  desc: '',
  status: 'draft',
}

const STATUS_TEXT: Record<string, string> = { draft: '草稿', active: '在售', archived: '已归档' }

function channelLabel(v: unknown): string {
  const meta = MALL_CHANNEL_META[v as MallChannel]
  return meta ? `${meta.emoji} ${meta.label}` : String(v ?? '—')
}

/** 行 → 表单草稿（分 → 元） */
function toDraft(p: ProductRow): Draft {
  return {
    title: p.title ?? '',
    channel: (CHANNELS.includes(p.channel as MallChannel) ? p.channel : 'youxuan') as MallChannel,
    priceYuan: yuanText(Number(p.price_cents) || 0),
    origYuan: p.original_price_cents === null || p.original_price_cents === undefined ? '' : yuanText(Number(p.original_price_cents)),
    stock: String(p.stock ?? 0),
    sort: String(p.sort ?? 0),
    emoji: p.emoji ?? '📦',
    desc: p.description ?? '',
    status: p.status ?? 'draft',
  }
}

export function AdminProductsPage() {
  return (
    <AdminGate>
      <ProductsInner />
    </AdminGate>
  )
}

function ProductsInner() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ProductRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const r = await db.list<ProductRow>('products', { order: { col: 'sort', asc: true }, limit: PAGE_SIZE })
    setLoading(false)
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    setError(null)
    setRows(r.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const startCreate = () => {
    setEditing('new')
    setDraft(EMPTY_DRAFT)
  }

  const startEdit = (p: ProductRow) => {
    setEditing(p.id)
    setDraft(toDraft(p))
  }

  const cancel = () => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
  }

  const submit = async () => {
    const title = draft.title.trim()
    if (!title) {
      toast('请填写商品名称')
      return
    }
    const priceFen = yuanToFen(Number(draft.priceYuan) || 0)
    if (!Number.isFinite(priceFen) || priceFen < 0) {
      toast('售价需为不小于 0 的数字')
      return
    }

    const body: Record<string, unknown> = {
      title,
      channel: draft.channel,
      price_cents: priceFen,
      original_price_cents: draft.origYuan.trim() === '' ? null : yuanToFen(Number(draft.origYuan) || 0),
      currency: 'CNY',
      emoji: draft.emoji.trim() || '📦',
      description: draft.desc.trim() || null,
      status: draft.status,
      stock: Math.max(0, Math.round(Number(draft.stock) || 0)),
      sort: Math.round(Number(draft.sort) || 0),
    }

    setSaving(true)
    const r =
      editing === 'new'
        ? await db.insert<ProductRow>('products', { ...body, created_by: getSession().uid || null })
        : await db.update('products', String(editing), body)
    setSaving(false)

    if (!r.ok) {
      toast(errText(r.error))
      return
    }
    toast(editing === 'new' ? '商品已创建' : '商品已保存')
    cancel()
    setLoading(true)
    void load()
  }

  const toggleStatus = async (p: ProductRow) => {
    const next = p.status === 'active' ? 'draft' : 'active'
    const r = await db.update('products', p.id, { status: next })
    if (!r.ok) {
      toast(errText(r.error))
      return
    }
    toast(next === 'active' ? '已上架' : '已下架')
    setRows((list) => list.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
  }

  return (
    <div className="page page-grid single">
      <h1 className="page-title">📦 商品管理</h1>

      <div className="card col">
        <div className="row-between" style={{ alignItems: 'center' }}>
          <div className="section-title" style={{ margin: 0 }}>
            {editing === 'new' ? '新增商品' : editing ? '编辑商品' : '选择商品进行编辑'}
          </div>
          {editing ? (
            <button className="btn" onClick={cancel}>
              取消
            </button>
          ) : (
            <button className="btn btn-primary" onClick={startCreate}>
              ＋ 新增
            </button>
          )}
        </div>

        {editing ? (
          <div className="col" style={{ marginTop: 12, gap: 8 }}>
            <input className="mall-biz-input" placeholder="商品名称" value={draft.title} onChange={(e) => set('title', e.target.value)} />
            <div className="row wrap">
              <select
                className="mall-biz-input"
                value={draft.channel}
                onChange={(e) => set('channel', e.target.value as MallChannel)}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {MALL_CHANNEL_META[c].emoji} {MALL_CHANNEL_META[c].label}
                  </option>
                ))}
              </select>
              <select className="mall-biz-input" value={draft.status} onChange={(e) => set('status', e.target.value)}>
                <option value="draft">草稿</option>
                <option value="active">在售</option>
                <option value="archived">已归档</option>
              </select>
            </div>
            <div className="row wrap">
              <input
                className="mall-biz-input"
                inputMode="decimal"
                placeholder="售价（元）"
                value={draft.priceYuan}
                onChange={(e) => set('priceYuan', e.target.value)}
              />
              <input
                className="mall-biz-input"
                inputMode="decimal"
                placeholder="划线原价（元，可空）"
                value={draft.origYuan}
                onChange={(e) => set('origYuan', e.target.value)}
              />
            </div>
            <div className="row wrap">
              <input
                className="mall-biz-input"
                inputMode="numeric"
                placeholder="库存"
                value={draft.stock}
                onChange={(e) => set('stock', e.target.value)}
              />
              <input
                className="mall-biz-input"
                inputMode="numeric"
                placeholder="排序（越小越前）"
                value={draft.sort}
                onChange={(e) => set('sort', e.target.value)}
              />
              <input className="mall-biz-input" placeholder="图标 emoji" value={draft.emoji} onChange={(e) => set('emoji', e.target.value)} />
            </div>
            <textarea
              className="mall-biz-input"
              rows={3}
              placeholder="商品描述（可空）"
              value={draft.desc}
              onChange={(e) => set('desc', e.target.value)}
            />
            <button className="btn btn-primary btn-block" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </button>
            <small className="muted">金额以「分」落库（price_cents），本表单按「元」输入并自动换算。</small>
          </div>
        ) : null}
      </div>

      <div className="section-title">商品列表</div>
      {loading ? (
        <Skeleton rows={4} height={64} />
      ) : error ? (
        <div className="card">
          <Empty emoji="🗄️" text="无法读取商品数据" />
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            原因：{error}。请确认 server 已部署并完成数据库迁移（npm run server:migrate）。
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty emoji="📭" text="暂无商品：点击「新增」创建第一件商品" />
        </div>
      ) : (
        <div className="col">
          {rows.map((p) => (
            <div className="card" key={p.id}>
              <div className="row-between" style={{ alignItems: 'center', gap: 8 }}>
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{p.emoji || '📦'}</span>
                  <b>{p.title || '（未命名）'}</b>
                  <Tag>{channelLabel(p.channel)}</Tag>
                  <Tag>{STATUS_TEXT[p.status ?? ''] ?? p.status ?? '—'}</Tag>
                </div>
                <b style={{ color: 'var(--primary)' }}>¥{yuanText(Number(p.price_cents) || 0)}</b>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                库存 {p.stock ?? 0} · 已售 {p.sales ?? 0} · 排序 {p.sort ?? 0}
                {p.created_at ? ` · 创建于 ${formatDate(Date.parse(p.created_at))}` : ''}
              </div>
              {p.description ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {p.description}
                </div>
              ) : null}
              <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
                <button className="btn" onClick={() => startEdit(p)}>
                  编辑
                </button>
                <button className="btn" onClick={() => void toggleStatus(p)}>
                  {p.status === 'active' ? '下架' : '上架'}
                </button>
                <a className="btn" href={`#/mall/${p.channel ?? 'youxuan'}`} target="_blank" rel="noreferrer">
                  前台查看
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
