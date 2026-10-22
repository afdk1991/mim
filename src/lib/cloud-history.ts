/* 搜索/浏览历史云端同步层。
   走 documents 表通用键值层（key='history'），整存整取。
   本地立即写 localStorage 保证 UI 响应，云端异步同步不阻塞。 */
import { cloudDocGet, cloudDocSet } from './cloud-doc'
import type { HistoryEntry } from '../utils'

const HISTORY_DOC_KEY = 'history'

/** 从云端加载历史记录；未登录/未配置/失败返回 null，调用方回落本地 */
export async function cloudLoadHistory(): Promise<HistoryEntry[] | null> {
  try {
    const doc = await cloudDocGet<HistoryEntry[]>(HISTORY_DOC_KEY)
    if (doc === null) return null
    if (!Array.isArray(doc)) return []
    return doc.filter(
      (e) => e && (e.kind === 'post' || e.kind === 'article') && typeof e.id === 'string',
    )
  } catch {
    return null
  }
}

/** 云端保存历史记录（全量覆盖），成功或跳过返回 true，失败返回 false */
export async function cloudSaveHistory(history: HistoryEntry[]): Promise<boolean> {
  try {
    return await cloudDocSet(HISTORY_DOC_KEY, history)
  } catch {
    return false
  }
}

/** 云端清空历史记录 */
export async function cloudClearHistory(): Promise<boolean> {
  try {
    return await cloudDocSet(HISTORY_DOC_KEY, [])
  } catch {
    return false
  }
}

/** 登录后把云端历史同步到本地 localStorage（loadHistory 同步读本地） */
export async function cloudSyncHistoryToLocal(): Promise<void> {
  try {
    const hist = await cloudLoadHistory()
    if (hist !== null) {
      localStorage.setItem('mim-history', JSON.stringify(hist))
    }
  } catch {
    /* 同步失败不影响本地 */
  }
}
