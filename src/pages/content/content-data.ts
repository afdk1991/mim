/* ==========================================================================
 * 内容域页面共用 hook —— 首屏骨架 / 云端读取
 *
 * 两个约定：
 *  1. 首屏骨架只用于「本机数据立刻可用」的列表页，目的是避免布局跳动，
 *     不代表在等数据（真在等数据的页面用下面的 useCloudRows）。
 *  2. 云端读取一律返回 Result 语义：loading / error / rows，
 *     失败只降级为空态并说明原因，绝不兜底演示数据。
 * ======================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '@/data/client'
import { errText } from '@/core/result'

/** 首屏短骨架：mount 后 delay 毫秒置为已就绪 */
export function useFirstPaint(delay = 260): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), delay)
    return () => window.clearTimeout(t)
  }, [delay])
  return ready
}

export interface CloudRows<T> {
  rows: T[]
  loading: boolean
  /** 空字符串表示无错误；有值时页面降级为空态并展示该说明 */
  error: string
  reload: () => void
}

/**
 * 读取云端表。map 逐行校验，脏行丢弃（与原史料 mixes 会因一行脏数据整页白屏的坑对齐治理）。
 * map 放在 ref 里更新，避免调用方传内联函数导致 effect 死循环。
 */
export function useCloudRows<T>(table: string, map: (row: Record<string, unknown>) => T | null): CloudRows<T> {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [token, setToken] = useState(0)
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void (async () => {
      const r = await db.list<Record<string, unknown>>(table, { order: { col: 'created_at', asc: false }, limit: 200 })
      if (!alive) return
      if (!r.ok) {
        setRows([])
        setError(`加载失败：${errText(r.error)}`)
      } else {
        const out: T[] = []
        for (const row of r.data) {
          const one = mapRef.current(row)
          if (one !== null) out.push(one)
        }
        setRows(out)
      }
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [table, token])

  const reload = useCallback(() => setToken((n) => n + 1), [])
  return { rows, loading, error, reload }
}
