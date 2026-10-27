/* ==========================================================================
 * Toast —— 全站轻提示
 *
 * emitToast 是模块级出口（React 树外也能调用），未挂载 Provider 时静默丢弃，
 * 这样领域层与数据层可以直接提示，不必层层透传回调。
 * ======================================================================== */

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ToastFn = (text: string) => void

const ToastCtx = createContext<ToastFn>(() => {})

const TOAST_MS = 1800

let sink: ToastFn | null = null

export function emitToast(text: string): void {
  sink?.(text)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Array<{ id: number; text: string }>>([])
  const seq = useRef(0)

  const push = useCallback<ToastFn>((text) => {
    // 与末条文案相同则刷新计时，不叠加重复气泡
    setItems((prev) => {
      if (prev.length > 0 && prev[prev.length - 1]?.text === text) return prev
      seq.current += 1
      const id = seq.current
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), TOAST_MS)
      return [...prev, { id, text }]
    })
  }, [])

  sink = push

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastFn {
  return useContext(ToastCtx)
}
