/* ============================================================================
 * 四大业务共用基建：金额/时间归一化、云端列表 hook、倒计时时钟
 *
 * 只放「无业务语义」的通用件 —— 各业务的模型映射与操作分别落在
 * seckill.ts / local.ts / live.ts / travel.ts，避免本文件变成第二个业务真源。
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'
import { mallBizRows } from '../../lib/bizApi'
import type { BizQuery, MallBizTable } from '../../lib/bizApi'

/* -------------------------------------------------------------------------- */
/* 归一化：云端列 → 前端模型                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 分 → 元（云端价格列统一为分，前端统一为元）。
 * 非法值归 0 —— 宁可显示 ¥0 也不能让 NaN 透到 UI 上。
 */
export function yuan(cents: unknown): number {
  const n = Number(cents)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n / 100)
}

/**
 * 任意时间输入 → 毫秒时间戳。
 * 云端混用 bigint（毫秒 epoch）与 timestamptz 字符串，这里统一收敛：
 * 数值小于 1e12 视为「秒」，字符串走 Date.parse，解析失败返回 0（调用方按空处理）。
 */
export function ms(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? Math.round(v * 1000) : Math.round(v)
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n) && n !== 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : 0
  }
  return 0
}

/** jsonb 字符串数组 → string[]（脏数据一律退化为空数组） */
export function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string') {
    try {
      const p: unknown = JSON.parse(v)
      if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string')
    } catch {
      /* 脏数据：退回空数组 */
    }
  }
  return []
}

/* -------------------------------------------------------------------------- */
/* 云端列表读取 hook                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 业务表 → 领域模型列表（云端优先）。
 *
 * 与 store.tsx 的 useMallGoods 同构：表不存在（迁移未应用）/ 查询失败 / 无数据
 * 一律走空态，绝不兜底演示数据。
 *
 * @param mapRow 行 → 模型；返回 null 表示该行是脏数据，直接丢弃
 */
export function useBizRows<T>(
  table: MallBizTable,
  mapRow: (r: Record<string, unknown>) => T | null,
  q?: BizQuery,
): { rows: T[]; loading: boolean; fromCloud: boolean } {
  const [rows, setRows] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(true)
  /* mapRow 每次渲染都是新函数：放进依赖数组会导致 effect 无限重跑，故用 ref 稳定化 */
  const mapRef = useRef(mapRow)
  mapRef.current = mapRow
  const key = q ? JSON.stringify(q) : ''

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      const raw = await mallBizRows<Record<string, unknown>>(table, q)
      if (!alive) return
      if (!raw) {
        setRows(null) // 云端不可用：空态
        setLoading(false)
        return
      }
      const list: T[] = []
      for (const r of raw) {
        const m = mapRef.current(r)
        if (m !== null) list.push(m)
      }
      setRows(list)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- q 以序列化 key 参与比较
  }, [table, key])

  if (rows === null) return { rows: [], loading, fromCloud: false }
  return { rows, loading, fromCloud: true }
}

/* -------------------------------------------------------------------------- */
/* 倒计时时钟                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 每秒推进的时钟（供秒杀倒计时 / 场次阶段判定）。
 * 只驱动展示，不参与任何库存或状态判断 —— 真正的开抢/售罄由服务端 RPC 裁定。
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}
