/* 云端通用文档同步层（轮 6）：工具台等本地状态迁移云端的通用键值层。
   documents 表每用户每 key 一行（主键 user_id+key，data jsonb 整存整取），
   后续各工具台接入只需 cloudDocGet/cloudDocSet，无需按模块建表。
   语义对齐 cloud-write：未登录/未配置云端时静默跳过（get 返回 null / set 返回 true），
   失败弹极简 DOM toast 并返回失败态。
   toast 为独立副本（不 import cloud-write，与 cloud-msg.ts 同理由：保持零耦合）。 */
import { supabase } from './supabase'

/** 极简 DOM toast（独立副本）：云端文档保存失败时提示用户 */
function docToast(msg: string): void {
  try {
    const el = document.createElement('div')
    el.textContent = msg
    el.style.cssText =
      'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:9999;' +
      'padding:10px 18px;border-radius:999px;font-size:14px;color:#fff;' +
      'background:rgba(220,38,38,.92);box-shadow:0 4px 16px rgba(0,0,0,.2);'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2200)
  } catch {
    /* 非 DOM 环境静默 */
  }
}

async function docUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

/** 读一份云端文档快照：未登录/未配置返回 null（调用方回落本地状态） */
export async function cloudDocGet<T>(key: string): Promise<T | null> {
  const userId = await docUserId()
  if (!userId) return null
  const { data, error } = await supabase!
    .from('documents')
    .select('data')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle()
  if (error) {
    console.warn('[cloud-doc] 读取失败：', error.message)
    return null
  }
  return (data?.data as T | undefined) ?? null
}

/** 写一份云端文档快照（upsert 新建/更新二合一）：成功或跳过返回 true，失败返回 false（已 toast） */
export async function cloudDocSet<T>(key: string, data: T): Promise<boolean> {
  const userId = await docUserId()
  if (!userId) return true
  const { error } = await supabase!.from('documents').upsert(
    {
      user_id: userId,
      key,
      data: data as unknown,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,key' },
  )
  if (error) {
    console.warn('[cloud-doc] 保存失败：', error.message)
    docToast('云端文档同步失败，仅保存在本机')
    return false
  }
  return true
}
