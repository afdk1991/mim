/* ==========================================================================
 * 浏览足迹 —— 最近看过的动态 / 文章（上限 LIMITS.historyMax = 50）
 *
 * 存储：localStorage 键 `mim.history`，元素级校验后读入（脏数据整批剔除，
 *      否则一条坏记录会让整页白屏 —— 原实现踩过）。
 *
 * 约定（跨页面共用）：任何页面打开动态/文章时调用 recordView(kind, id)，
 *      本页负责读取、重排、单条删除与清空。足迹不是账号资产，删除不溯及内容本身。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import type { HistoryEntry, ViewKind } from '@/domain/content/model'
import { LIMITS } from '@/core/config'
import { asRecord, arrayOf, asNumber, asString, readJson, writeJson } from '@/core/storage'
import { emit, EVT, subscribe } from '@/core/events'
import { ellipsis, timeAgo } from '@/core/utils'
import { Empty, useToast } from '@/ui'

const HISTORY_KEY = 'mim.history'

function parseEntry(v: unknown): HistoryEntry | null {
  const r = asRecord(v)
  if (!r) return null
  const kind: ViewKind | null = r.kind === 'post' || r.kind === 'article' ? r.kind : null
  const id = asString(r.id)
  const at = asNumber(r.at)
  if (!kind || !id || at === null) return null
  return { kind, id, at }
}

const parseHistory = arrayOf<HistoryEntry>(parseEntry)

export function loadHistory(): HistoryEntry[] {
  return readJson(HISTORY_KEY, parseHistory, [] as HistoryEntry[])
}

/** 记录一次浏览：去重后置顶，超出上限自动裁剪最旧的一条 */
export function recordView(kind: ViewKind, id: string): void {
  const rest = loadHistory().filter((e) => !(e.kind === kind && e.id === id))
  writeJson(HISTORY_KEY, [{ kind, id, at: Date.now() }, ...rest].slice(0, LIMITS.historyMax))
  emit(EVT.social)
}

export function HistoryPage() {
  const toast = useToast()
  const [list, setList] = useState<HistoryEntry[]>(loadHistory)

  // 其他页面写入足迹后本页要跟着变（切路由回来不该看到旧快照）
  useEffect(() => subscribe(EVT.social, () => setList(loadHistory())), [])

  const clear = (): void => {
    writeJson(HISTORY_KEY, [])
    setList([])
    emit(EVT.social)
    toast('浏览足迹已清空')
  }

  const remove = (e: HistoryEntry): void => {
    writeJson(HISTORY_KEY, list.filter((x) => !(x.kind === e.kind && x.id === e.id)))
    setList((prev) => prev.filter((x) => !(x.kind === e.kind && x.id === e.id)))
    emit(EVT.social)
  }

  return (
    <div className="page">
      <div className="row-between">
        <h1 className="page-title" style={{ margin: 0 }}>
          🕘 浏览足迹 <span className="tag">{list.length}/{LIMITS.historyMax}</span>
        </h1>
        <button className="btn btn-ghost btn-sm" disabled={list.length === 0} onClick={clear}>
          清空足迹
        </button>
      </div>

      {list.length === 0 ? (
        <Empty emoji="🕘" text="还没有浏览记录：去广场逛逛，看过的动态与文章会出现在这里" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {list.map((e) => (
            <div key={`${e.kind}-${e.id}`} className="notif-row">
              <span className="notif-icon">{e.kind === 'post' ? '📝' : '📄'}</span>
              <div className="notif-body">
                <p style={{ margin: 0 }}>
                  <a href={e.kind === 'post' ? `#/post/${e.id}` : `#/article/${e.id}`}>
                    {e.kind === 'post' ? '动态' : '文章'} · {ellipsis(e.id, 10)}
                  </a>
                </p>
                <small className="muted">{timeAgo(e.at)}看过</small>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(e)} title="删除这条足迹">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        足迹保存在本机 localStorage（键 {HISTORY_KEY}），超出 {LIMITS.historyMax} 条自动裁剪最早的记录。
      </p>
    </div>
  )
}
