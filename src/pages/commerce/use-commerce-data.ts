/* ==========================================================================
 * 商城页面共用的读取钩子
 *
 * 为什么抽出来：四个业务会场都要「拉云端表 → 用 domain 层 mapXxx 归一化 →
 * 失败降级空态」，各写一遍会出现四种不同的错误处理口径（有人 toast、有人白屏）。
 *
 * 关键设计：
 *  1. query / mapRow 用 ref 持有 —— 页面里直接写对象字面量也不会因引用变化
 *     触发重复请求，只有 table 变化或手动 reload 才重新拉取。
 *  2. 失败一律「空数组 + error 文案」，页面据此渲染空态，绝不兜底演示数据。
 * ======================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ListQuery } from '../../data/client'
import { db } from '../../data/client'
import { errText } from '../../core/result'

export interface CloudList<T> {
  items: T[]
  loading: boolean
  /** 后端未就绪 / 读取失败的原因；空态要展示给用户 */
  error: string | null
  reload: () => void
}

/** 列表读取：db.list + 行映射，失败降级为空态 */
export function useCloudList<Row, Model>(
  table: string,
  mapRow: (r: Row) => Model | null,
  query: ListQuery = {},
): CloudList<Model> {
  const [items, setItems] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const qRef = useRef(query)
  qRef.current = query
  const mapRef = useRef(mapRow)
  mapRef.current = mapRow

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      const r = await db.list<Row>(table, qRef.current)
      if (!alive) return
      setLoading(false)
      if (!r.ok) {
        setItems([])
        setError(errText(r.error))
        return
      }
      setError(null)
      setItems(r.data.map(mapRef.current).filter((m): m is Model => m !== null))
    })()
    return () => {
      alive = false
    }
  }, [table, nonce])

  const reload = useCallback((): void => setNonce((n) => n + 1), [])
  return { items, loading, error, reload }
}

/** 云端 rpc 直接返回裸 jsonb，行形状不可信，统一按 unknown 读 */
export function asRecord(v: unknown): Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** 从 rpc 结果里取数字；脏数据回退 0，绝不产生 NaN 金额 */
export function numOf(r: Record<string, unknown>, key: string): number {
  const v = r[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0
}

export function strOf(r: Record<string, unknown>, key: string): string {
  const v = r[key]
  return typeof v === 'string' ? v : ''
}

/** 秒级时钟：秒杀倒计时用。intervalMs<=0 停表（无进行中/即将开始的场次时省掉定时器） */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs <= 0) return
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}
