/* 云端私信（轮 5）：send_message RPC 写入 + Realtime 订阅接收。
   双行模型：RPC 一次插两行（发送者 owner 侧 from_me=true / 接收者 owner 侧
   from_me=false），RLS 仅放行 owner_id=me 的行，因此：
   - 「我的全部私信」拉取 = owner_id=me 的行集合（见 cloud-read.ts）
   - 实时订阅按 owner_id=me 过滤 INSERT，回调内再放行 from_me=false（对方来信）；
     我自己发的行1（owner=me, from_me=true）也会触发，但本地已有乐观行，忽略。
   本文件自带极简 toast（与 cloud-write.cloudToast 同源实现的独立副本——
   cloud-write.ts 正被并行会话修改中，禁止 import 以规避冲突）。 */
import { supabase } from './supabase'

export type CloudMsgResult = 'ok' | 'skip' | 'fail'

/** 极简 toast：与 cloud-write.cloudToast 同源（独立副本） */
function msgToast(text: string, ok: boolean): void {
  try {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText =
      'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:9999;' +
      'padding:10px 18px;border-radius:999px;font-size:14px;color:#fff;' +
      `background:${ok ? 'rgba(24,144,255,.92)' : 'rgba(220,38,38,.92)'};` +
      'box-shadow:0 4px 16px rgba(0,0,0,.2);'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2200)
  } catch {
    /* 非 DOM 环境静默 */
  }
}

/** 云端发送私信：走 send_message RPC（security definer 一次写双方两行） */
export async function cloudSendMessage(peerId: string, content: string): Promise<CloudMsgResult> {
  if (!supabase) return 'skip'
  const { error } = await supabase.rpc('send_message', { p_peer: peerId, p_content: content })
  if (error) {
    console.warn('[cloud-msg] 发送失败：', error.message)
    msgToast('私信云端同步失败，仅保存在本机', false)
    return 'fail'
  }
  return 'ok'
}

/** 实时订阅对方来信：channel 过滤 owner_id=me 的 INSERT，回调只放行 from_me=false */
export function subscribeMessages(
  meId: string,
  onIncoming: (m: { id: string; userId: string; content: string; createdAt: number }) => void,
): () => void {
  if (!supabase) return () => {}
  const sb = supabase // 闭包内不可依赖模块导入的窄化，捕获局部引用
  const channel = sb
    .channel(`mim-msg-${meId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `owner_id=eq.${meId}` },
      (payload: any) => {
        const row = payload.new as { id: string; peer_id: string; from_me: boolean; content: string; created_at: string }
        if (row.from_me) return // 我方乐观行已在本地，忽略
        onIncoming({
          id: row.id,
          userId: row.peer_id,
          content: row.content,
          createdAt: Date.parse(row.created_at),
        })
      },
    )
    .subscribe()
  return () => {
    void sb.removeChannel(channel)
  }
}
