/* 工具台云端存档适配层（轮 6）
   底层为 documents 通用键值文档表：每用户每 key 一行，data 为整包 jsonb 快照。
   key 取各模块本地 localStorage key（如 mim-ai-v1），云端天然按 user_id 隔离。
   未配置云端 / 未登录时静默跳过；fire-and-forget 不弹 toast，不阻塞 UI。 */
import { supabase } from './supabase'

/* 当前登录用户 id；未登录或云端未配置返回 null */
async function toolUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

/* 拉取某 key 的云端快照；无云端/未登录/无记录/格式异常一律返回 null（调用方保持本地状态） */
export async function pullToolState(key: string): Promise<unknown | null> {
  const userId = await toolUserId()
  if (!userId) return null
  const { data, error } = await supabase!
    .from('documents')
    .select('data')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle()
  if (error || !data || typeof data.data !== 'object' || data.data === null) return null
  return data.data
}

/* 推送整包快照（异步后台执行，失败静默——下次变更会再次覆盖推送） */
export function pushToolState(key: string, state: unknown): void {
  void (async () => {
    const userId = await toolUserId()
    if (!userId) return
    await supabase!
      .from('documents')
      .upsert(
        { user_id: userId, key, data: state, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' },
      )
  })()
}

/* 节流推送：同一 key 在 minMs 窗口内多次调用只发一次（尾调用保证最终状态不丢）。
   适用高频变更场景（如播放进度每 ~5s 一次），避免把云端 upsert 打爆。 */
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pushLastAt = new Map<string, number>()

export function pushToolStateThrottled(key: string, state: unknown, minMs = 10_000): void {
  const now = Date.now()
  const last = pushLastAt.get(key) ?? 0
  if (now - last >= minMs) {
    pushLastAt.set(key, now)
    pushToolState(key, state)
    return
  }
  const pending = pushTimers.get(key)
  if (pending) clearTimeout(pending)
  pushTimers.set(
    key,
    setTimeout(() => {
      pushTimers.delete(key)
      pushLastAt.set(key, Date.now())
      pushToolState(key, state)
    }, Math.max(minMs - (now - last), 0)),
  )
}

/* 拉取快照 + updated_at（供调用方做「新者优先」合并；比本地 savedAt 旧则丢弃） */
export async function pullToolStateMeta(
  key: string,
): Promise<{ data: unknown; updatedAt: string } | null> {
  const userId = await toolUserId()
  if (!userId) return null
  const { data, error } = await supabase!
    .from('documents')
    .select('data,updated_at')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle()
  if (error || !data || typeof data.data !== 'object' || data.data === null) return null
  return {
    data: data.data,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : '',
  }
}
