/* ==========================================================================
 * 漫剧片单 —— 收藏 / 看过 / 播放进度 / 自定义片源
 *
 * 合规变更（重建重点）：原片單依赖 openverse 在线检索（该依赖已从工程删除），
 *      因此改为「片源完全由用户自己添加」：填写标题、分类、封面 emoji、来源与
 *      可选的媒体直链。不再联网检索任何外部片源，也不预置演示内容。
 *
 * 安全：媒体直链只接受 http(s)，避免 javascript: / data: 之类的伪协议进播放器。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import type { MjCat, MjItem, MjState } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { cx, uid } from '@/core/utils'
import { Empty, Modal, Tag, useToast } from '@/ui'

const SCOPE = 'tools.manju'

type TabKey = MjCat | 'all'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'comic', label: '漫画改编' },
  { key: 'ai', label: 'AI 漫剧' },
]

const CAT_TEXT: Record<MjCat, string> = { comic: '漫画改编', ai: 'AI 漫剧' }

const EMPTY_STATE: MjState = { favorites: [], seen: [], progress: {}, customExt: [] }

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v.trim())

function parseItem(v: unknown): MjItem | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null
  const cat: MjCat = r.cat === 'comic' || r.cat === 'ai' ? r.cat : 'ai'
  const str = (x: unknown): string => (typeof x === 'string' ? x : '')
  return {
    id: r.id,
    title: r.title,
    cat,
    cover: str(r.cover) || '🎬',
    source: str(r.source) || '用户添加',
    episodesText: str(r.episodesText),
    custom: true,
    ...(str(r.license) ? { license: str(r.license) } : {}),
    ...(isUrl(r.videoUrl) ? { videoUrl: r.videoUrl.trim() } : {}),
    ...(isUrl(r.audioUrl) ? { audioUrl: r.audioUrl.trim() } : {}),
    ...(isUrl(r.thumb) ? { thumb: r.thumb.trim() } : {}),
    ...(isUrl(r.homeUrl) ? { homeUrl: r.homeUrl.trim() } : {}),
  }
}

function parseState(raw: unknown): MjState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const items = Array.isArray(r.customExt) ? r.customExt : []
  const customExt: MjItem[] = []
  for (const v of items) {
    const it = parseItem(v)
    if (it) customExt.push(it)
  }
  const progress: Record<string, number> = {}
  if (r.progress && typeof r.progress === 'object') {
    for (const [k, v] of Object.entries(r.progress as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) progress[k] = Math.max(0, Math.min(100, Math.round(v)))
    }
  }
  return { favorites: strList(r.favorites), seen: strList(r.seen), progress, customExt }
}

interface Draft {
  title: string
  cat: MjCat
  cover: string
  source: string
  episodesText: string
  videoUrl: string
  homeUrl: string
  license: string
}

const emptyDraft = (): Draft => ({
  title: '',
  cat: 'comic',
  cover: '🎬',
  source: '',
  episodesText: '',
  videoUrl: '',
  homeUrl: '',
  license: '',
})

export function ManjuPage() {
  const toast = useToast()
  const [state, setState] = useState<MjState>(() => loadSnapshot(SCOPE, parseState, EMPTY_STATE))
  const [tab, setTab] = useState<TabKey>('all')
  const [adding, setAdding] = useState<Draft | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    saveSnapshot(SCOPE, state)
  }, [state])

  const list = state.customExt.filter((it) => tab === 'all' || it.cat === tab)
  const playingItem = playing ? (state.customExt.find((i) => i.id === playing) ?? null) : null

  const add = (): void => {
    if (!adding) return
    const title = adding.title.trim()
    if (!title) {
      toast('请填写片名')
      return
    }
    // FE-008：协议白名单显式提示。原实现是静默丢弃非 http(s) 地址，
    // 用户填了 javascript:/data: 之类的伪协议却看不到任何反馈，等于无声放行。
    const bad: string[] = []
    if (adding.videoUrl.trim() && !isUrl(adding.videoUrl)) bad.push('媒体直链')
    if (adding.homeUrl.trim() && !isUrl(adding.homeUrl)) bad.push('来源页')
    if (bad.length) {
      toast(`${bad.join('、')} 仅支持 http(s):// 开头，已忽略非法地址`)
    }
    const item: MjItem = {
      id: uid('mj'),
      title,
      cat: adding.cat,
      cover: adding.cover.trim() || '🎬',
      source: adding.source.trim() || '用户添加',
      episodesText: adding.episodesText.trim() || '自定义片源',
      custom: true,
      ...(adding.license.trim() ? { license: adding.license.trim() } : {}),
      ...(isUrl(adding.videoUrl) ? { videoUrl: adding.videoUrl.trim() } : {}),
      ...(isUrl(adding.homeUrl) ? { homeUrl: adding.homeUrl.trim() } : {}),
    }
    setState((prev) => ({ ...prev, customExt: [item, ...prev.customExt] }))
    setAdding(null)
    toast(`已加入片单：${title}`)
  }

  const toggle = (field: 'favorites' | 'seen', id: string): void => {
    setState((prev) => {
      const on = prev[field].includes(id)
      return { ...prev, [field]: on ? prev[field].filter((x) => x !== id) : [...prev[field], id] }
    })
  }

  const setProgress = (id: string, value: number): void => {
    setState((prev) => ({ ...prev, progress: { ...prev.progress, [id]: Math.round(value) } }))
  }

  const remove = (item: MjItem): void => {
    if (!window.confirm(`确定从片单移除「${item.title}」吗？`)) return
    setState((prev) => ({
      favorites: prev.favorites.filter((x) => x !== item.id),
      seen: prev.seen.filter((x) => x !== item.id),
      progress: Object.fromEntries(Object.entries(prev.progress).filter(([k]) => k !== item.id)),
      customExt: prev.customExt.filter((x) => x.id !== item.id),
    }))
    if (playing === item.id) setPlaying(null)
    toast('已从片单移除')
  }

  return (
    <div className="page">
      <div className="row-between">
        <h1 className="page-title" style={{ margin: 0 }}>🎬 漫剧片单</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(emptyDraft())}>+ 添加片源</button>
      </div>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        片源完全由你自己添加（标题 / 分类 / 封面 / 来源 / 可选媒体直链），本页不联网检索、不预置演示内容。
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {state.customExt.length === 0 ? (
        <Empty emoji="📭" text="暂未配置片源：点击右上角「+ 添加片源」登记你要看的漫剧" />
      ) : list.length === 0 ? (
        <Empty emoji="📭" text="该分类下还没有片源，换一个分类或添加一条" />
      ) : (
        list.map((item) => {
          const pct = state.progress[item.id] ?? 0
          const faved = state.favorites.includes(item.id)
          const seen = state.seen.includes(item.id)
          return (
            <div key={item.id} className="card">
              <div className="row">
                <span style={{ fontSize: 30 }}>{item.cover}</span>
                <div className="grow">
                  <b>{item.title}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {CAT_TEXT[item.cat]} · {item.source} · {item.episodesText}
                  </div>
                </div>
                {seen ? <Tag>已看过</Tag> : null}
                {item.license ? <Tag>{item.license}</Tag> : null}
              </div>

              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 12, width: 42 }}>进度</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={pct}
                  style={{ flex: 1 }}
                  onChange={(e) => setProgress(item.id, Number(e.target.value))}
                  aria-label={`${item.title} 播放进度`}
                />
                <b style={{ width: 42, textAlign: 'right' }}>{pct}%</b>
              </div>

              <div className="row wrap" style={{ marginTop: 8 }}>
                <button className={cx('btn btn-sm', faved ? 'btn-primary' : 'btn-ghost')} onClick={() => toggle('favorites', item.id)}>
                  {faved ? '💔 取消收藏' : '⭐ 收藏'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle('seen', item.id)}>
                  {seen ? '↩️ 标记未看' : '✅ 标记看过'}
                </button>
                {item.videoUrl || item.audioUrl ? (
                  <button className="btn btn-primary btn-sm" onClick={() => setPlaying(item.id)}>
                    ▶️ 播放
                  </button>
                ) : null}
                {item.homeUrl && /^https?:\/\//i.test(item.homeUrl) ? (
                  <a className="btn btn-ghost btn-sm" href={item.homeUrl} target="_blank" rel="noreferrer">
                    来源页 ↗
                  </a>
                ) : null}
                <span className="grow" />
                <button className="btn btn-ghost btn-sm" onClick={() => remove(item)}>移除</button>
              </div>
            </div>
          )
        })
      )}

      {state.customExt.length > 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>
          共 {state.customExt.length} 条片源 · 收藏 {state.favorites.length} · 看过 {state.seen.length}
        </p>
      ) : null}

      {adding ? (
        <Modal title="添加片源" onClose={() => setAdding(null)}>
          <div className="col">
            <input className="input" placeholder="片名（必填）" value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
            <div className="chip-row">
              {(['comic', 'ai'] as MjCat[]).map((c) => (
                <button key={c} className={cx('chip', adding.cat === c && 'active')} onClick={() => setAdding({ ...adding, cat: c })}>
                  {CAT_TEXT[c]}
                </button>
              ))}
            </div>
            <input className="input" placeholder="封面 emoji（如 🎬）" value={adding.cover} onChange={(e) => setAdding({ ...adding, cover: e.target.value })} />
            <input className="input" placeholder="来源（如 B站 / 自建 NAS）" value={adding.source} onChange={(e) => setAdding({ ...adding, source: e.target.value })} />
            <input className="input" placeholder="集数说明（如 全12集）" value={adding.episodesText} onChange={(e) => setAdding({ ...adding, episodesText: e.target.value })} />
            <input className="input" placeholder="媒体直链 https://…（可选，需允许跨域播放）" value={adding.videoUrl} onChange={(e) => setAdding({ ...adding, videoUrl: e.target.value })} />
            <input className="input" placeholder="来源页 https://…（可选）" value={adding.homeUrl} onChange={(e) => setAdding({ ...adding, homeUrl: e.target.value })} />
            <input className="input" placeholder="授权说明（可选，如 CC BY / 公版）" value={adding.license} onChange={(e) => setAdding({ ...adding, license: e.target.value })} />
            <button className="btn btn-primary" onClick={add}>加入片单</button>
          </div>
        </Modal>
      ) : null}

      {playingItem ? (
        <Modal title={playingItem.title} onClose={() => setPlaying(null)}>
          {playingItem.videoUrl ? (
            <video src={playingItem.videoUrl} controls style={{ width: '100%' }} />
          ) : playingItem.audioUrl ? (
            <audio src={playingItem.audioUrl} controls style={{ width: '100%' }} />
          ) : (
            <Empty emoji="🔗" text="该片源没有可用的媒体直链" />
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            媒体直链由你填写，播放能否成功取决于该地址是否允许跨域与直链访问。
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
