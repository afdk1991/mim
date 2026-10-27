/* ==========================================================================
 * ResourcesPage 资源下载 —— 分类筛选 + 下载量排序
 *
 * 数据源：云端 resources 表（POST/REST 由 data/client 统一承载）。
 *   这是内容域里唯一走后端读取的页面：重建时确认 resources 尚无写入通道，
 *   所以「一张资源都没有」是当前的真实状态，页面如实显示空态而不预铺示例附件。
 *   后端未配置 / 表不存在时降级为空态并给出原因（errText），绝不用演示数据兜底。
 * 下载：走状态层 downloadResource —— 它只向后端递增一次下载计数（无收益流水），
 *       资源行本身没有附件地址字段，所以这里如实「记一次下载」，不伪造文件流或下载动画。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import { Empty, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount } from '@/core/utils'
import type { Resource } from '@/domain/content/model'
import { useCloudRows } from './content-data'
import { AsyncState } from './content-parts'
import { reportGrowth } from './growth-report'

const RES_ICONS: Record<string, string> = { pdf: '📕', video: '🎬', code: '💾', doc: '📘' }

function mapResource(row: Record<string, unknown>): Resource | null {
  const id = row.id
  const title = row.title
  if (typeof id !== 'string' || typeof title !== 'string') return null
  return {
    id,
    title,
    description: typeof row.description === 'string' ? row.description : '',
    category: typeof row.category === 'string' ? row.category : '未分类',
    uploader: typeof row.uploader === 'string' ? row.uploader : '未知上传者',
    size: typeof row.size === 'string' ? row.size : '—',
    downloads: typeof row.downloads === 'number' ? row.downloads : 0,
    type: typeof row.type === 'string' ? row.type : 'file',
    ...(typeof row.url === 'string' && row.url ? { url: row.url } : {}),
  }
}

export function ResourcesPage() {
  const app = useApp()
  const toast = useToast()
  const { rows, loading, error, reload } = useCloudRows<Resource>('resources', mapResource)
  const [cat, setCat] = useState<string | null>(null)
  const [sort, setSort] = useState<'default' | 'downloads' | 'name'>('default')

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category))), [rows])
  const list = useMemo(() => {
    const base = rows.filter((r) => !cat || r.category === cat)
    if (sort === 'downloads') return [...base].sort((a, b) => b.downloads - a.downloads)
    if (sort === 'name') return [...base].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    return base
  }, [rows, cat, sort])

  return (
    <div className="page-grid single">
      <div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2 className="page-title">📦 资源下载</h2>
          <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>
            {loading ? '加载中…' : '⟳ 重新加载'}
          </button>
        </div>

        {categories.length > 0 ? (
          <div className="card chip-row">
            <button className={cx('chip', cat === null && 'active')} onClick={() => setCat(null)}>
              全部
            </button>
            {categories.map((c) => (
              <button key={c} className={cx('chip', cat === c && 'active')} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        ) : null}

        <div className="tabs">
          <button className={cx('tab-btn', sort === 'default' && 'active')} onClick={() => setSort('default')}>
            📦 默认
          </button>
          <button className={cx('tab-btn', sort === 'downloads' && 'active')} onClick={() => setSort('downloads')}>
            🔥 下载最多
          </button>
          <button className={cx('tab-btn', sort === 'name' && 'active')} onClick={() => setSort('name')}>
            🔤 名称
          </button>
        </div>

        <AsyncState
          loading={loading}
          error={error || undefined}
          empty={
            list.length === 0 && (
              <Empty
                emoji="📦"
                text={
                  rows.length === 0
                    ? '暂无资源：资源通道尚未接入真实数据源，接入后这里会自动出现可下载附件'
                    : '该分类下暂无资源'
                }
              />
            )
          }
          skeletonRows={3}
        >
          {list.map((r) => (
            <div key={r.id} className="card res-row">
              <span className={cx('res-icon', `t-${r.type}`)}>{RES_ICONS[r.type] ?? '📦'}</span>
              <div className="res-main">
                <b>{r.title}</b>
                <p className="muted">{r.description}</p>
                <small className="muted">上传者：{r.uploader}</small>
              </div>
              <div className="res-meta">
                <div>{r.size}</div>
                <div className="muted">{formatCount(r.downloads)} 次下载</div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                title={r.url ? '打开附件' : '该资源未登记附件地址，仅记录一次下载'}
                onClick={() => {
                  app.downloadResource(r.id)
                  // 计数由后端 rpc 落库；本机成长分同样在真实点击后走 evaluate() 判定
                  const outcome = reportGrowth('resource_downloaded')
                  toast(outcome.ok ? '已记录一次下载 ⬇️' : '已记录下载（今日成长分已达上限）')
                  if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer')
                }}
              >
                下载
              </button>
            </div>
          ))}
        </AsyncState>
      </div>
    </div>
  )
}
