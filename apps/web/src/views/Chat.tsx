/** Chat：IM 聊天视图，左侧会话列表 + 用户搜索，右侧消息区 + 输入框 + 视频通话。
 *
 * 数据流：
 *   - 会话列表 / 历史消息 / 用户搜索走 HTTP（api.im.*）；
 *   - 实时消息与已读 / 输入中 / 通话信令走 WebSocket（useImSocket）；
 *   - 发送消息优先走 WS，WS 未连接时回退 HTTP（api.im.sendMessage）。
 */

// React 钩子
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 类型导入：Locale
import type { Locale } from '@mim/i18n';
// API 客户端与类型
import { api, getSession } from '../api';
import type { ImConversation, ImMessage, ImUser } from '../api';
// IM socket hook
import { useImSocket } from '../im/useImSocket';
import type { ImFrame } from '../im/socket';
// 视频通话组件与会话类型
import { VideoCall, type CallSession } from '../components/VideoCall';

/** 组件入参 */
interface ChatProps {
  locale: Locale; // 当前界面语言
}

/** 格式化时间戳为 HH:mm */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso); // 解析 ISO 时间
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // 取时分
  } catch {
    return ''; // 解析失败返回空
  }
} // formatTime 结束

/** 把消息内容渲染为文本（图片/文件消息显示文件名） */
function messagePreview(msg: ImMessage): string {
  if (msg.content_type === 'text') return msg.content; // 文本直接显示
  if (msg.content_type === 'image') return '[图片]'; // 图片消息预览
  if (msg.content_type === 'file') return `[文件] ${msg.object_name ?? ''}`; // 文件消息预览
  return msg.content; // system 等其它类型兜底
} // messagePreview 结束

/** 聊天视图 */
export function Chat({ locale }: ChatProps) {
  const isZh = locale !== 'en-US'; // 中文判断
  const session = getSession(); // 取当前会话，拿 user.id
  const currentUserId = session?.user.id ?? ''; // 当前用户 ID

  // IM socket
  const im = useImSocket();
  const { connected, send, onMessage, onCall, onFrame } = im;

  // 会话列表
  const [conversations, setConversations] = useState<ImConversation[]>([]);
  // 当前选中的会话 ID
  const [activeId, setActiveId] = useState<string | null>(null);
  // 当前会话的消息列表
  const [messages, setMessages] = useState<ImMessage[]>([]);
  // 输入框文本
  const [draft, setDraft] = useState('');
  // 用户搜索关键词
  const [searchQ, setSearchQ] = useState('');
  // 搜索结果
  const [searchResults, setSearchResults] = useState<ImUser[]>([]);
  // 是否正在搜索（防抖用）
  const searchingRef = useRef(false);
  // 发送中状态
  const [sending, setSending] = useState(false);
  // 错误提示
  const [error, setError] = useState<string | null>(null);
  // 消息列表滚动容器 ref
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 视频通话状态
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  // 最新通话信令帧
  const [callSignal, setCallSignal] = useState<ImFrame | null>(null);

  // 加载会话列表
  const loadConversations = useCallback(async () => {
    try {
      const res = await api.im.listConversations(); // 拉取会话列表
      setConversations(res.items); // 更新列表
    } catch (e) {
      setError(isZh ? '加载会话失败' : 'Failed to load conversations'); // 错误提示
    }
  }, [isZh]);

  // 挂载时加载会话列表
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // 选中会话变化时加载消息
  useEffect(() => {
    if (!activeId) {
      setMessages([]); // 无选中时清空消息
      return;
    }
    let cancelled = false; // 竞态取消标志
    (async () => {
      try {
        const res = await api.im.listMessages(activeId, { limit: 50 }); // 拉最近 50 条
        if (!cancelled) {
          setMessages(res.items); // 更新消息
          // 标记已读到最新消息（若有）
          if (res.items.length > 0) {
            api.im.markRead(activeId, res.items[res.items.length - 1].id).catch(() => undefined);
          }
        }
      } catch {
        if (!cancelled) setError(isZh ? '加载消息失败' : 'Failed to load messages');
      }
    })();
    return () => { cancelled = true; }; // 卸载或切换时取消
  }, [activeId, isZh]);

  // 新消息到达：加入对应会话并刷新列表
  useEffect(() => {
    return onMessage((raw) => {
      const msg = raw as ImMessage; // 断言为消息结构
      // 若属于当前会话，追加到消息列表
      if (msg.conversation_id === activeId) {
        setMessages((prev) => [...prev, msg]);
        // 标记已读
        api.im.markRead(msg.conversation_id, msg.id).catch(() => undefined);
      }
      // 刷新会话列表（更新最后消息与未读数）
      loadConversations();
    });
  }, [onMessage, activeId, loadConversations]);

  // 通话信令到达：转发给 VideoCall
  useEffect(() => {
    return onCall((frame) => {
      // 如果是来电邀请且当前无通话，创建 incoming 会话
      if (frame.type === 'call.invite' && !callSession) {
        const p = frame.payload as { from_user_id?: string; from_display_name?: string } | undefined;
        if (p?.from_user_id) {
          setCallSession({ mode: 'incoming', peerUserId: p.from_user_id, peerDisplayName: p.from_display_name ?? p.from_user_id });
        }
      }
      // 把信令帧传给 VideoCall 处理
      setCallSignal(frame);
    });
  }, [onCall, callSession]);

  // ack 帧处理：消息发送成功后更新本地状态
  useEffect(() => {
    return onFrame((frame) => {
      if (frame.type === 'ack' && frame.id) {
        const p = frame.payload as { ok: boolean; message_id?: string; error?: string } | undefined;
        if (p?.ok && p.message_id) {
          // 发送成功：把本地 pending 消息的 id 更新为服务端 id（简化处理：直接刷新列表）
          loadConversations();
        }
      }
    });
  }, [onFrame, loadConversations]);

  // 新消息到达时自动滚动到底
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 防抖搜索用户
  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults([]); // 空关键词清空结果
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.im.searchUsers(searchQ.trim()); // 搜索用户
        setSearchResults(res.items); // 更新结果
      } catch {
        setSearchResults([]);
      }
    }, 300); // 300ms 防抖
    return () => window.clearTimeout(timer);
  }, [searchQ]);

  // 发送文本消息
  const sendText = useCallback(async () => {
    const text = draft.trim(); // 去除首尾空白
    if (!text || !activeId) return; // 空内容或无会话不发
    setSending(true); // 标记发送中
    setError(null); // 清旧错误
    // 构造本地乐观消息
    const optimistic: ImMessage = {
      id: `pending-${Date.now()}`, // 临时 id，等 ack 替换
      conversation_id: activeId,
      sender_user_id: currentUserId,
      sender_display_name: session?.user.display_name ?? currentUserId,
      content_type: 'text',
      content: text,
      status: 'sent',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]); // 乐观追加
    setDraft(''); // 清空输入框

    if (connected) {
      // WS 通道发送
      send({ type: 'message.send', payload: { conversation_id: activeId, content_type: 'text', content: text } });
      setSending(false);
    } else {
      // HTTP 兜底发送
      try {
        const res = await api.im.sendMessage(activeId, { content_type: 'text', content: text });
        setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? res.message : m))); // 替换临时消息
      } catch {
        setError(isZh ? '发送失败' : 'Send failed'); // 失败提示
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id)); // 移除乐观消息
      }
      setSending(false);
    }
  }, [draft, activeId, currentUserId, session, connected, send, isZh]);

  // 回车发送
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // 阻止换行
      sendText(); // 发送
    }
  }; // handleKeyDown 结束

  // 点击搜索结果 → 创建/打开私聊
  const handlePickUser = useCallback(async (user: ImUser) => {
    try {
      const res = await api.im.createConversation({ type: 'direct', target_user_id: user.id }); // 创建私聊
      setActiveId(res.conversation_id); // 选中新会话
      setSearchQ(''); // 清空搜索
      setSearchResults([]); // 清空结果
      loadConversations(); // 刷新列表
    } catch {
      setError(isZh ? '创建会话失败' : 'Failed to start chat');
    }
  }, [isZh, loadConversations]);

  // 发起视频通话
  const handleVideoCall = useCallback(() => {
    const conv = conversations.find((c) => c.id === activeId); // 取当前会话
    if (!conv || conv.type !== 'direct' || !conv.other_user_id) return; // 仅私聊可视频
    setCallSignal(null); // 清旧信令
    setCallSession({ mode: 'outgoing', peerUserId: conv.other_user_id, peerDisplayName: conv.title });
  }, [conversations, activeId]);

  // 通话结束回调
  const handleCallEnded = useCallback(() => {
    setCallSession(null); // 清空会话
    setCallSignal(null); // 清信令
  }, []);

  // 当前选中的会话对象
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  return (
    <div className="chat-layout">
      {/* 左侧：会话列表 + 搜索 */}
      <aside className="chat-sidebar">
        {/* 搜索框 */}
        <div className="chat-search">
          <input
            type="text"
            placeholder={isZh ? '搜索用户开始聊天…' : 'Search users to chat…'}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
        {/* 搜索结果（有搜索词时显示） */}
        {searchQ.trim() && (
          <div className="chat-search-results">
            {searchResults.length === 0 ? (
              <p className="chat-empty">{isZh ? '未找到用户' : 'No users found'}</p>
            ) : (
              searchResults.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="chat-user-item"
                  onClick={() => handlePickUser(u)}
                >
                  <span className="chat-avatar">{(u.display_name || u.id).slice(0, 1)}</span>
                  <span className="chat-user-name">{u.display_name || u.id}</span>
                </button>
              ))
            )}
          </div>
        )}
        {/* 会话列表 */}
        <div className="chat-conversations">
          {conversations.length === 0 ? (
            <p className="chat-empty">{isZh ? '还没有会话，搜索用户开始聊天' : 'No conversations yet'}</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chat-conv-item${c.id === activeId ? ' active' : ''}`}
                onClick={() => setActiveId(c.id)}
              >
                <span className="chat-avatar">{(c.title || '?').slice(0, 1)}</span>
                <span className="chat-conv-body">
                  <span className="chat-conv-title">{c.title}</span>
                  <span className="chat-conv-preview">
                    {c.last_message ? messagePreview(c.last_message) : (isZh ? '暂无消息' : 'No messages')}
                  </span>
                </span>
                {c.unread_count > 0 && <span className="chat-badge">{c.unread_count}</span>}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* 右侧：消息区 + 输入 */}
      <section className="chat-main">
        {activeConversation ? (
          <>
            {/* 会话头部：标题 + 视频通话按钮 */}
            <header className="chat-header">
              <span className="chat-header-title">{activeConversation.title}</span>
              <span className="chat-header-status">{connected ? (isZh ? '已连接' : 'Connected') : (isZh ? '未连接' : 'Offline')}</span>
              {activeConversation.type === 'direct' && (
                <button type="button" className="btn ghost" onClick={handleVideoCall} disabled={!connected}>
                  {isZh ? '视频通话' : 'Video call'}
                </button>
              )}
            </header>
            {/* 消息列表 */}
            <div className="chat-messages">
              {messages.map((m) => {
                const mine = m.sender_user_id === currentUserId; // 是否自己发的
                return (
                  <div key={m.id} className={`chat-msg ${mine ? 'mine' : 'theirs'}`}>
                    <span className="chat-msg-sender">{mine ? (isZh ? '我' : 'Me') : m.sender_display_name}</span>
                    <div className="chat-msg-bubble">
                      {m.content_type === 'text' ? (
                        <span>{m.content}</span>
                      ) : m.content_type === 'image' ? (
                        <span>[图片]</span>
                      ) : (
                        <span>{`[文件] ${m.object_name ?? ''}`}</span>
                      )}
                    </div>
                    <span className="chat-msg-time">{formatTime(m.created_at)}</span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            {/* 输入区 */}
            <div className="chat-input">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isZh ? '输入消息，回车发送（Shift+Enter 换行）' : 'Type a message, Enter to send'}
                rows={2}
              />
              <button type="button" className="btn primary" onClick={sendText} disabled={sending || !draft.trim()}>
                {isZh ? '发送' : 'Send'}
              </button>
            </div>
          </>
        ) : (
          <div className="chat-placeholder">{isZh ? '选择一个会话或搜索用户开始聊天' : 'Select a conversation or search users'}</div>
        )}
        {/* 错误提示条 */}
        {error && <div className="chat-error">{error}</div>}
      </section>

      {/* 视频通话浮窗 */}
      {callSession && (
        <VideoCall
          socket={im.socket}
          session={callSession}
          signal={callSignal}
          locale={locale}
          onEnded={handleCallEnded}
        />
      )}
    </div>
  );
} // Chat 结束
