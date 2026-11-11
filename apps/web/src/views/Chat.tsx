/** Chat：IM 聊天视图（会话列表 + 会话内搜索 + 消息区 + 图片/文件 + 群管理 + 视频通话）。
 *
 * 数据流：
 *   - 会话列表 / 历史消息 / 会话内搜索 / 群成员 / 用户搜索走 HTTP（api.im.*）；
 *   - 实时消息、已读、输入中、撤回、通话信令走 WebSocket（useImSocket）；
 *   - 发送消息优先走 WS（拿到 requestId → ack 回填消息 ID），WS 未连接时回退 HTTP（api.im.sendMessage）；
 *   - 图片/文件先走 media 预签名直传拿到 object_key，再发一条 image/file 消息（大文件不过 WebSocket）。
 */

// React 钩子：状态、副作用、引用与回调
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 语言类型
import type { Locale } from '@mim/i18n';
// API 客户端与会话读取
import { api, getSession } from '../api';
// IM 相关类型：会话 / 消息 / 用户 / 成员
import type { ImConversation, ImMember, ImMessage, ImUser } from '../api';
// IM socket hook：连接、发送、帧订阅
import { useImSocket } from '../im/useImSocket';
// 帧类型
import type { ImFrame } from '../im/socket';
// 视频通话组件与会话类型
import { VideoCall, type CallSession } from '../components/VideoCall';

/** 组件入参 */
interface ChatProps {
  locale: Locale; // 当前界面语言
} // ChatProps 结束

/** 撤回窗口：2 分钟，与后端保持一致（仅用于前端是否显示「撤回」按钮） */
const RECALL_WINDOW_MS = 120000; // 毫秒

/** 格式化时间戳为 HH:mm */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso); // 解析 ISO 时间
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // 取时分
  } catch {
    return ''; // 解析失败返回空
  }
} // formatTime 结束

/** 图片气泡：按 object_key 向服务端申请下载签名，取到后内联渲染缩略图，点击可看原图
 *  - 签名地址有时效，故按 object_key 缓存一次结果，消息列表重渲染不重复申请
 *  - 申请失败时回退为文字占位，不阻塞消息展示
 * 入口：消息 content_type === 'image' 且带 object_key
 * 出口：<img> 或占位文本
 */
function ChatImageBubble({ objectKey, name, isZh }: { objectKey: string; name?: string; isZh: boolean }) {
  const [url, setUrl] = useState<string | null>(null); // 签名后的可访问地址
  const [failed, setFailed] = useState(false); // 申请失败标记
  useEffect(() => {
    let alive = true; // 组件卸载后丢弃回调，避免卸载后 setState
    setFailed(false); // 每次换 key 重置失败态
    api.media
      .presignDownload(objectKey, 3600) // 申请 1 小时有效的下载签名
      .then((res) => {
        if (alive) setUrl(res.download.url); // 拿到直链
      })
      .catch(() => {
        if (alive) setFailed(true); // 失败回退占位
      });
    return () => {
      alive = false; // 清理标记
    };
  }, [objectKey]); // 仅 object_key 变化时重新申请
  if (failed) return <span className="chat-image-fallback">{`[图片] ${name ?? ''}`}</span>; // 失败占位
  if (!url) return <span className="chat-image-loading">{isZh ? '图片加载中…' : 'Loading…'}</span>; // 加载中占位
  return (
    <a className="chat-image" href={url} target="_blank" rel="noreferrer" title={name ?? ''}>
      <img src={url} alt={name ?? (isZh ? '图片' : 'image')} loading="lazy" />{/* 缩略展示，点击开原图 */}
    </a>
  );
} // ChatImageBubble 结束

/** 消息预览文本：列表里显示的摘要 */
function messagePreview(msg: ImMessage): string {
  if (msg.content_type === 'text') return msg.content; // 文本直接显示
  if (msg.content_type === 'image') return '[图片]'; // 图片消息预览
  if (msg.content_type === 'file') return `[文件] ${msg.object_name ?? ''}`; // 文件消息预览
  return msg.content; // system 等其它类型兜底
} // messagePreview 结束

/** 发送状态图标：sent 单勾、delivered 双勾、read 双勾加粗由 CSS 区分 */
function statusMark(status: ImMessage['status'], isZh: boolean): string {
  if (status === 'read') return isZh ? '已读' : 'Read'; // 对方已读
  if (status === 'delivered') return isZh ? '已送达' : 'Delivered'; // 已投递
  return isZh ? '已发送' : 'Sent'; // 仅落库
} // statusMark 结束

/** 聊天视图 */
export function Chat({ locale }: ChatProps) {
  const isZh = locale !== 'en-US'; // 中文判断
  const session = getSession(); // 取当前会话，拿 user.id
  const currentUserId = session?.user.id ?? ''; // 当前用户 ID

  // IM socket
  const im = useImSocket();
  const { connected, send, onMessage, onCall, onFrame } = im;

  // ---------- 会话与消息状态 ----------
  const [conversations, setConversations] = useState<ImConversation[]>([]); // 会话列表
  const [activeId, setActiveId] = useState<string | null>(null); // 当前会话 ID
  const [messages, setMessages] = useState<ImMessage[]>([]); // 当前会话消息
  const [hasMore, setHasMore] = useState(false); // 是否还有更早的消息
  const [loadingMore, setLoadingMore] = useState(false); // 加载更早消息中
  const [draft, setDraft] = useState(''); // 输入框文本
  const [sending, setSending] = useState(false); // 发送中
  const [error, setError] = useState<string | null>(null); // 错误提示
  const messagesEndRef = useRef<HTMLDivElement | null>(null); // 滚动锚点

  // 发送请求序号 → 本地乐观消息 ID，ack 回来后据此替换
  const pendingRef = useRef<Map<string, string>>(new Map());

  // ---------- 搜索与建群 ----------
  const [searchQ, setSearchQ] = useState(''); // 用户搜索关键词（建私聊 / 加群选人共用）
  const [searchResults, setSearchResults] = useState<ImUser[]>([]); // 用户搜索结果
  const [groupMode, setGroupMode] = useState(false); // 是否处于「新建群聊」模式
  const [groupName, setGroupName] = useState(''); // 新群名
  const [groupPick, setGroupPick] = useState<string[]>([]); // 已勾选的成员 ID

  // ---------- 会话内消息搜索 ----------
  const [msgQuery, setMsgQuery] = useState(''); // 会话内搜索词
  const [msgResults, setMsgResults] = useState<ImMessage[] | null>(null); // 搜索结果（null 表示未搜索）

  // ---------- 输入中 ----------
  const [typingLabel, setTypingLabel] = useState<string | null>(null); // 正在输入的人名
  const typingTimerRef = useRef<number | null>(null); // 清空「正在输入」的定时器
  const lastTypingSent = useRef(0); // 上次发送 typing 帧的时间戳，做节流

  // ---------- 群信息面板 ----------
  const [panelOpen, setPanelOpen] = useState(false); // 面板开关
  const [members, setMembers] = useState<ImMember[]>([]); // 成员列表
  const [ownerId, setOwnerId] = useState<string | null>(null); // 群主 ID
  const [renameDraft, setRenameDraft] = useState(''); // 群改名输入

  // ---------- 视频通话 ----------
  const [callSession, setCallSession] = useState<CallSession | null>(null); // 通话会话
  const [callSignal, setCallSignal] = useState<ImFrame | null>(null); // 最新信令帧

  // 文件选择框引用
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- 数据加载 ----------

  /** 拉取会话列表 */
  const loadConversations = useCallback(async () => {
    try {
      const res = await api.im.listConversations(); // 拉取列表
      setConversations(res.items); // 更新
    } catch {
      setError(isZh ? '加载会话失败' : 'Failed to load conversations'); // 失败提示
    }
  }, [isZh]); // loadConversations 结束

  // 挂载时加载一次
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  /** 打开某会话：拉消息、清搜索、标已读、载群成员 */
  const openConversation = useCallback(
    async (conversationId: string) => {
      setActiveId(conversationId); // 切换选中
      setMsgQuery(''); // 清会话内搜索
      setMsgResults(null); // 清搜索结果
      setPanelOpen(false); // 关群面板
      try {
        const res = await api.im.listMessages(conversationId, { limit: 50 }); // 最近 50 条
        setMessages(res.items); // 更新消息
        setHasMore(res.items.length >= 50); // 满 50 条才可能还有更早
        const last = res.items[res.items.length - 1]; // 最后一条
        if (last) {
          // 标记已读并刷新列表，让未读角标消失
          await api.im.markRead(conversationId, last.id).catch(() => undefined);
          loadConversations();
        } // 有消息才标记
      } catch {
        setError(isZh ? '加载消息失败' : 'Failed to load messages'); // 失败提示
      } // try 结束
    },
    [isZh, loadConversations],
  ); // openConversation 结束

  /** 加载更早消息：以当前第一条为游标向前翻页 */
  const loadMore = useCallback(async () => {
    if (!activeId || messages.length === 0 || loadingMore) return; // 无会话 / 无消息 / 正在加载时不重复请求
    setLoadingMore(true); // 置加载中
    try {
      const res = await api.im.listMessages(activeId, { before: messages[0].id, limit: 50 }); // 取更早 50 条
      setMessages((prev) => [...res.items, ...prev]); // 拼到列表头部
      setHasMore(res.items.length >= 50); // 满页才继续可翻
    } catch {
      setError(isZh ? '加载更多失败' : 'Failed to load more'); // 失败提示
    } finally {
      setLoadingMore(false); // 复位
    } // finally 结束
  }, [activeId, messages, loadingMore, isZh]); // loadMore 结束

  // ---------- 实时事件 ----------

  // 新消息：追加到当前会话、标记已读、刷新列表
  useEffect(() => {
    return onMessage((raw) => {
      const msg = raw as ImMessage; // 断言为消息结构
      if (msg.conversation_id === activeId) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])); // 去重追加
        api.im.markRead(msg.conversation_id, msg.id).catch(() => undefined); // 标已读
        setTypingLabel(null); // 对方发来消息即清掉「正在输入」
      } // 属于当前会话才追加
      loadConversations(); // 无论如何刷新列表摘要
    });
  }, [onMessage, activeId, loadConversations]);

  // 帧事件：ack 回填消息 ID、撤回移除消息、输入中提示、已读状态
  useEffect(() => {
    return onFrame((frame) => {
      const payload = frame.payload as Record<string, unknown> | undefined; // 帧载荷
      if (frame.type === 'ack' && frame.id) {
        const localId = pendingRef.current.get(frame.id); // 找到对应的乐观消息
        const serverId = typeof payload?.message_id === 'string' ? payload.message_id : undefined; // 服务端消息 ID
        if (localId && serverId && payload?.ok !== false) {
          pendingRef.current.delete(frame.id); // 用掉即删
          setMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, id: serverId, status: 'sent' } : m))); // 替换临时 ID
        } else if (localId) {
          pendingRef.current.delete(frame.id); // 发送失败：移除乐观消息并提示
          setMessages((prev) => prev.filter((m) => m.id !== localId));
          setError(isZh ? '发送失败，请重试' : 'Send failed, please retry');
        } // ack 分支结束
        loadConversations(); // 刷新摘要
        return; // ack 处理完
      } // ack 结束
      if (frame.type === 'message.recall') {
        const mid = typeof payload?.message_id === 'string' ? payload.message_id : ''; // 被撤回的消息 ID
        if (mid) setMessages((prev) => prev.filter((m) => m.id !== mid)); // 从界面移除
        loadConversations(); // 摘要同步
        return; // 撤回处理完
      } // recall 结束
      if (frame.type === 'typing') {
        const convId = typeof payload?.conversation_id === 'string' ? payload.conversation_id : ''; // 会话
        const uid = typeof payload?.user_id === 'string' ? payload.user_id : ''; // 输入者
        if (convId === activeId && uid && uid !== currentUserId) {
          const who = conversations.find((c) => c.id === convId)?.title; // 群聊里用标题占位
          setTypingLabel(who ? (isZh ? '对方正在输入…' : 'Typing…') : isZh ? '对方正在输入…' : 'Typing…'); // 显示提示
          if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current); // 重置定时器
          typingTimerRef.current = window.setTimeout(() => setTypingLabel(null), 3000); // 3 秒无新事件即清除
        } // 只处理当前会话
        return; // typing 处理完
      } // typing 结束
      if (frame.type === 'message.read') {
        const convId = typeof payload?.conversation_id === 'string' ? payload.conversation_id : ''; // 会话
        if (convId === activeId) {
          setMessages((prev) => prev.map((m) => (m.sender_user_id === currentUserId ? { ...m, status: 'read' } : m))); // 自己的消息统一标已读
        } // 只改当前会话
      } // read 结束
    });
  }, [onFrame, activeId, currentUserId, conversations, isZh, loadConversations]);

  // 通话信令：来电邀请建通话，其余转发给 VideoCall
  useEffect(() => {
    return onCall((frame) => {
      if (frame.type === 'call.invite' && !callSession) {
        const p = frame.payload as { from_user_id?: string; from_display_name?: string } | undefined;
        if (p?.from_user_id) {
          setCallSession({ mode: 'incoming', peerUserId: p.from_user_id, peerDisplayName: p.from_display_name ?? p.from_user_id });
        }
      } // 来电分支结束
      setCallSignal(frame); // 交给通话组件
    });
  }, [onCall, callSession]);

  // 消息变化后滚动到底（加载更早时不强制跳到底部会造成跳动，这里只在追加时滚）
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 用户搜索防抖（建私聊 / 建群选人共用）
  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults([]); // 空关键词清空
      return;
    } // 空词结束
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.im.searchUsers(searchQ.trim()); // 搜索
        setSearchResults(res.items); // 更新结果
      } catch {
        setSearchResults([]); // 失败清空
      } // try 结束
    }, 300); // 300ms 防抖
    return () => window.clearTimeout(timer); // 清理定时器
  }, [searchQ]);

  // ---------- 动作 ----------

  /** 通过 WS 或 HTTP 发一条消息：返回是否成功 */
  const deliver = useCallback(
    async (body: { content_type: 'text' | 'image' | 'file'; content?: string; object_key?: string; object_mime?: string; object_name?: string; object_size?: number }, optimistic: ImMessage) => {
      if (!activeId) return; // 无会话直接返回
      setMessages((prev) => [...prev, optimistic]); // 乐观追加
      if (connected) {
        const reqId = send({ type: 'message.send', payload: { conversation_id: activeId, ...body } }); // WS 发送
        if (reqId) pendingRef.current.set(reqId, optimistic.id); // 记录请求序号，等 ack 回填
        return; // WS 分支结束
      } // connected 分支结束
      try {
        const res = await api.im.sendMessage(activeId, body); // HTTP 兜底
        setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? res.message : m))); // 用服务端对象替换
        loadConversations(); // 刷新摘要
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id)); // 移除乐观消息
        setError(isZh ? '发送失败' : 'Send failed'); // 提示
      } // try 结束
    },
    [activeId, connected, send, isZh, loadConversations],
  ); // deliver 结束

  /** 发送文本：清空输入并投递 */
  const sendText = useCallback(async () => {
    const text = draft.trim(); // 去首尾空白
    if (!text || !activeId) return; // 空内容 / 无会话不发
    setSending(true); // 置发送中
    setError(null); // 清旧错误
    setDraft(''); // 清输入框
    const optimistic: ImMessage = {
      id: `pending-${Date.now()}`, // 临时 ID
      conversation_id: activeId, // 归属会话
      sender_user_id: currentUserId, // 发送者
      sender_display_name: session?.user.display_name ?? currentUserId, // 显示名
      content_type: 'text', // 文本
      content: text, // 正文
      status: 'sent', // 初始状态
      created_at: new Date().toISOString(), // 本地时间
    };
    await deliver({ content_type: 'text', content: text }, optimistic); // 统一投递
    setSending(false); // 复位
  }, [draft, activeId, currentUserId, session, deliver]);

  /** 发送图片或文件：先直传拿到 object_key，再发消息 */
  const sendFile = useCallback(
    async (file: File) => {
      if (!activeId) return; // 无会话不发
      const isImage = file.type.startsWith('image/'); // 是否图片
      const mime = file.type || 'application/octet-stream'; // MIME 兜底
      setSending(true); // 置发送中
      setError(null); // 清错误
      try {
        const presign = await api.media.presignUpload({
          asset_type: isImage ? 'image' : 'text', // 对象存储按 image / 通用文件归类
          mime, // 文件 MIME
          size_bytes: file.size, // 体积
        }); // 申请上传凭证
        const put = await fetch(presign.upload.url, { method: presign.upload.method, headers: presign.upload.headers, body: file }); // 直传字节
        if (!put.ok) throw new Error(`upload failed: ${put.status}`); // 直传失败即中止
        const optimistic: ImMessage = {
          id: `pending-${Date.now()}`, // 临时 ID
          conversation_id: activeId, // 会话
          sender_user_id: currentUserId, // 发送者
          sender_display_name: session?.user.display_name ?? currentUserId, // 显示名
          content_type: isImage ? 'image' : 'file', // 类型
          content: '', // 无正文
          object_key: presign.object_key, // 对象键
          object_mime: mime, // MIME
          object_name: file.name, // 文件名
          object_size: file.size, // 体积
          status: 'sent', // 初始状态
          created_at: new Date().toISOString(), // 时间
        };
        await deliver(
          {
            content_type: isImage ? 'image' : 'file', // 类型
            object_key: presign.object_key, // 对象键
            object_mime: mime, // MIME
            object_name: file.name, // 文件名
            object_size: file.size, // 体积
          },
          optimistic,
        ); // 投递消息
      } catch {
        setError(isZh ? '图片/文件发送失败' : 'Upload failed'); // 失败提示
      } finally {
        setSending(false); // 复位
      } // finally 结束
    },
    [activeId, currentUserId, session, isZh, deliver],
  ); // sendFile 结束

  /** 撤回消息：仅自己且 2 分钟内 */
  const recall = useCallback(
    async (msg: ImMessage) => {
      if (!activeId) return; // 无会话
      try {
        await api.im.recallMessage(activeId, msg.id); // 调后端
        setMessages((prev) => prev.filter((m) => m.id !== msg.id)); // 本地移除
        loadConversations(); // 刷新摘要
      } catch {
        setError(isZh ? '撤回失败（超过 2 分钟或不是本人消息）' : 'Recall failed'); // 失败提示
      } // try 结束
    },
    [activeId, isZh, loadConversations],
  ); // recall 结束

  /** 会话内消息搜索 */
  const runMessageSearch = useCallback(async () => {
    if (!activeId || !msgQuery.trim()) {
      setMsgResults(null); // 清空则退出搜索态
      return;
    } // 空词结束
    try {
      const res = await api.im.searchMessages(activeId, msgQuery.trim()); // 搜索
      setMsgResults(res.items); // 展示结果
    } catch {
      setError(isZh ? '搜索失败' : 'Search failed'); // 失败提示
    } // try 结束
  }, [activeId, msgQuery, isZh]);

  /** 新建私聊 */
  const pickUser = useCallback(
    async (user: ImUser) => {
      try {
        const res = await api.im.createConversation({ type: 'direct', target_user_id: user.id }); // 复用或新建
        setSearchQ(''); // 清搜索
        setSearchResults([]); // 清结果
        await openConversation(res.conversation_id); // 直接打开
      } catch {
        setError(isZh ? '创建会话失败' : 'Failed to start chat'); // 失败提示
      } // try 结束
    },
    [isZh, openConversation],
  ); // pickUser 结束

  /** 勾选/取消勾选建群成员 */
  const toggleGroupPick = useCallback((userId: string) => {
    setGroupPick((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId])); // 反选
  }, []); // toggleGroupPick 结束

  /** 创建群聊 */
  const createGroup = useCallback(async () => {
    if (groupPick.length === 0) {
      setError(isZh ? '至少选择一位成员' : 'Pick at least one member'); // 校验
      return;
    } // 校验结束
    try {
      const res = await api.im.createConversation({
        type: 'group', // 群聊
        name: groupName.trim() || (isZh ? '新群聊' : 'New group'), // 群名兜底
        member_user_ids: groupPick, // 成员
      }); // 创建
      setGroupMode(false); // 退出建群模式
      setGroupName(''); // 清群名
      setGroupPick([]); // 清勾选
      setSearchQ(''); // 清搜索
      setSearchResults([]); // 清结果
      await loadConversations(); // 先刷新会话列表，否则新群不在 conversations 里，activeConversation 为空、右侧不会渲染
      await openConversation(res.conversation_id); // 打开新群
    } catch {
      setError(isZh ? '创建群聊失败' : 'Failed to create group'); // 失败提示
    } // try 结束
  }, [groupPick, groupName, isZh, openConversation, loadConversations]); // 建群依赖：列表刷新函数也要进依赖，避免拿旧闭包

  /** 打开群信息面板：拉成员与群主 */
  const openPanel = useCallback(async () => {
    if (!activeId) return; // 无会话
    try {
      const res = await api.im.getConversation(activeId); // 会话 + 成员
      setMembers(res.members); // 成员列表
      setOwnerId(res.conversation.owner_user_id); // 群主
      setRenameDraft(res.conversation.title); // 预填群名
      setPanelOpen(true); // 打开面板
    } catch {
      setError(isZh ? '加载群信息失败' : 'Failed to load group info'); // 失败提示
    } // try 结束
  }, [activeId, isZh]); // openPanel 结束

  /** 改建群名 */
  const renameGroup = useCallback(async () => {
    if (!activeId || !renameDraft.trim()) return; // 空名不改
    try {
      await api.im.renameConversation(activeId, renameDraft.trim()); // 提交
      await loadConversations(); // 刷新列表标题
      setPanelOpen(false); // 关面板
    } catch {
      setError(isZh ? '改名失败（仅群主/管理员）' : 'Rename failed'); // 失败提示
    } // try 结束
  }, [activeId, renameDraft, isZh, loadConversations]);

  /** 退出群 / 解散群 / 删除私聊 */
  const leaveConversation = useCallback(async () => {
    if (!activeId) return; // 无会话
    try {
      await api.im.deleteConversation(activeId); // 后端按角色处理
      setActiveId(null); // 清选中
      setMessages([]); // 清消息
      setPanelOpen(false); // 关面板
      await loadConversations(); // 刷新列表
    } catch {
      setError(isZh ? '操作失败' : 'Failed'); // 失败提示
    } // try 结束
  }, [activeId, isZh, loadConversations]);

  /** 置顶 / 免打扰切换 */
  const togglePreference = useCallback(
    async (patch: { pinned?: boolean; muted?: boolean }) => {
      if (!activeId) return; // 无会话
      try {
        await api.im.setPreference(activeId, patch); // 写入
        await loadConversations(); // 刷新
      } catch {
        setError(isZh ? '设置失败' : 'Failed to update'); // 失败提示
      } // try 结束
    },
    [activeId, isZh, loadConversations],
  ); // togglePreference 结束

  // 回车发送；输入时按节流发 typing 帧
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // 阻止换行
      void sendText(); // 发送
    } // 回车分支
  }; // handleKeyDown 结束

  const handleDraftChange = (value: string) => {
    setDraft(value); // 更新输入
    if (!activeId || !connected) return; // 无会话 / 未连接不发 typing
    const nowMs = Date.now(); // 当前时间
    if (nowMs - lastTypingSent.current < 1500) return; // 1.5 秒节流，避免刷爆 WS
    lastTypingSent.current = nowMs; // 记录发送时间
    send({ type: 'typing', payload: { conversation_id: activeId } }); // 广播输入中
  }; // handleDraftChange 结束

  /** 发起视频通话（仅私聊） */
  const handleVideoCall = useCallback(() => {
    const conv = conversations.find((c) => c.id === activeId); // 当前会话
    if (!conv || conv.type !== 'direct' || !conv.other_user_id) return; // 仅私聊可视频
    setCallSignal(null); // 清旧信令
    setCallSession({ mode: 'outgoing', peerUserId: conv.other_user_id, peerDisplayName: conv.title }); // 发起
  }, [conversations, activeId]);

  /** 通话结束 */
  const handleCallEnded = useCallback(() => {
    setCallSession(null); // 清会话
    setCallSignal(null); // 清信令
  }, []);

  const activeConversation = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]); // 当前会话对象

  return (
    <div className="chat-layout">
      {/* 左侧：搜索 + 建群 + 会话列表 */}
      <aside className="chat-sidebar">
        <div className="chat-search">
          <input
            type="text"
            placeholder={isZh ? '搜索用户…' : 'Search users…'}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <button
            type="button"
            className="btn ghost chat-new-group"
            onClick={() => {
              setGroupMode((v) => !v); // 切换建群模式
              setSearchQ(''); // 清搜索
              setSearchResults([]); // 清结果
            }}
          >
            {isZh ? (groupMode ? '取消' : '+ 群聊') : groupMode ? 'Cancel' : '+ Group'}
          </button>
        </div>

        {/* 建群表单：群名 + 勾选成员 */}
        {groupMode && (
          <div className="chat-group-form">
            <input
              type="text"
              placeholder={isZh ? '群名称' : 'Group name'}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            {groupPick.length > 0 && <p className="chat-hint">{isZh ? `已选 ${groupPick.length} 人` : `${groupPick.length} selected`}</p>}
            {searchResults.length > 0 && (
              <div className="chat-search-results">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`chat-user-item${groupPick.includes(u.id) ? ' picked' : ''}`}
                    onClick={() => toggleGroupPick(u.id)}
                  >
                    <span className="chat-avatar">{(u.display_name || u.id).slice(0, 1)}</span>
                    <span className="chat-user-name">{u.display_name || u.id}</span>
                    <span className="chat-pick-mark">{groupPick.includes(u.id) ? '✓' : '+'}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn primary" onClick={createGroup} disabled={groupPick.length === 0}>
              {isZh ? '创建群聊' : 'Create group'}
            </button>
          </div>
        )}

        {/* 私聊搜索结果（非建群模式） */}
        {!groupMode && searchQ.trim() !== '' && (
          <div className="chat-search-results">
            {searchResults.length === 0 ? (
              <p className="chat-empty">{isZh ? '未找到用户' : 'No users found'}</p>
            ) : (
              searchResults.map((u) => (
                <button key={u.id} type="button" className="chat-user-item" onClick={() => pickUser(u)}>
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
                onClick={() => void openConversation(c.id)}
              >
                <span className="chat-avatar">{(c.title || '?').slice(0, 1)}</span>
                <span className="chat-conv-body">
                  <span className="chat-conv-title">
                    {c.title}
                    {c.type === 'group' && <span className="chat-conv-meta">({c.member_count})</span>}
                    {c.pinned && <span className="chat-conv-flag">{isZh ? '置顶' : 'Pinned'}</span>}
                    {c.muted && <span className="chat-conv-flag">{isZh ? '免打扰' : 'Muted'}</span>}
                  </span>
                  <span className="chat-conv-preview">
                    {c.last_message ? messagePreview(c.last_message) : isZh ? '暂无消息' : 'No messages'}
                  </span>
                </span>
                {c.unread_count > 0 && <span className={`chat-badge${c.muted ? ' muted' : ''}`}>{c.muted ? '·' : c.unread_count}</span>}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* 右侧：消息区 + 输入 */}
      <section className="chat-main">
        {activeConversation ? (
          <>
            <header className="chat-header">
              <span className="chat-header-title">{activeConversation.title}</span>
              <span className="chat-header-status">{connected ? (isZh ? '已连接' : 'Connected') : isZh ? '未连接' : 'Offline'}</span>
              {/* 会话内消息搜索 */}
              <input
                type="text"
                className="chat-msg-search"
                placeholder={isZh ? '搜索聊天记录' : 'Search messages'}
                value={msgQuery}
                onChange={(e) => setMsgQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runMessageSearch(); // 回车即搜
                  if (e.key === 'Escape') {
                    setMsgQuery(''); // Esc 清空
                    setMsgResults(null);
                  } // Esc 分支
                }}
              />
              <button type="button" className="btn ghost" onClick={() => void togglePreference({ pinned: !activeConversation.pinned })}>
                {activeConversation.pinned ? (isZh ? '取消置顶' : 'Unpin') : isZh ? '置顶' : 'Pin'}
              </button>
              <button type="button" className="btn ghost" onClick={() => void togglePreference({ muted: !activeConversation.muted })}>
                {activeConversation.muted ? (isZh ? '取消免打扰' : 'Unmute') : isZh ? '免打扰' : 'Mute'}
              </button>
              {/* 群信息（群聊） / 视频通话（私聊） */}
              {activeConversation.type === 'group' ? (
                <button type="button" className="btn ghost" onClick={() => void openPanel()}>
                  {isZh ? '群信息' : 'Group info'}
                </button>
              ) : (
                <button type="button" className="btn ghost" onClick={handleVideoCall} disabled={!connected}>
                  {isZh ? '视频通话' : 'Video call'}
                </button>
              )}
            </header>

            {/* 搜索结果条：点击某条跳回正文位置（简化：直接清空搜索并滚动到底） */}
            {msgResults && (
              <div className="chat-msg-result-bar">
                <span>{isZh ? `命中 ${msgResults.length} 条` : `${msgResults.length} matches`}</span>
                {msgResults.slice(0, 5).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="chat-msg-result-item"
                    onClick={() => {
                      setMsgQuery(''); // 退出搜索态
                      setMsgResults(null); // 清结果
                    }}
                  >
                    {formatTime(m.created_at)} · {messagePreview(m).slice(0, 20)}
                  </button>
                ))}
                <button type="button" className="btn ghost" onClick={() => setMsgResults(null)}>
                  {isZh ? '关闭' : 'Close'}
                </button>
              </div>
            )}

            <div className="chat-messages">
              {hasMore && (
                <button type="button" className="btn ghost chat-more" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? (isZh ? '加载中…' : 'Loading…') : isZh ? '加载更早消息' : 'Load earlier'}
                </button>
              )}
              {messages.map((m) => {
                const mine = m.sender_user_id === currentUserId; // 是否自己发的
                const canRecall = mine && Date.now() - Date.parse(m.created_at) < RECALL_WINDOW_MS && !m.id.startsWith('pending-'); // 2 分钟内且已落库
                return (
                  <div key={m.id} className={`chat-msg ${mine ? 'mine' : 'theirs'}`}>
                    <span className="chat-msg-sender">{mine ? (isZh ? '我' : 'Me') : m.sender_display_name}</span>
                    <div className="chat-msg-bubble">
                      {m.content_type === 'text' ? (
                        <span className="chat-msg-text">{m.content}</span>
                      ) : m.content_type === 'image' ? (
                        m.object_key ? (
                          <ChatImageBubble objectKey={m.object_key} name={m.object_name ?? undefined} isZh={isZh} /> // 有对象键就内联预览
                        ) : (
                          <span>{`[图片] ${m.object_name ?? ''}`}</span> // 无 object_key（历史消息）回退文字
                        )
                      ) : (
                        <span>{`[文件] ${m.object_name ?? ''}`}</span>
                      )}
                    </div>
                    <span className="chat-msg-time">
                      {formatTime(m.created_at)}
                      {mine && <span className={`chat-msg-status ${m.status}`}>{statusMark(m.status, isZh)}</span>}
                      {canRecall && (
                        <button type="button" className="chat-recall" onClick={() => void recall(m)}>
                          {isZh ? '撤回' : 'Recall'}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* 对方正在输入 */}
            {typingLabel && <div className="chat-typing">{typingLabel}</div>}

            <div className="chat-input">
              <textarea
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isZh ? '输入消息，回车发送（Shift+Enter 换行）' : 'Type a message, Enter to send'}
                rows={2}
              />
              {/* 图片/文件：走预签名直传 */}
              <button type="button" className="btn ghost chat-attach" onClick={() => fileInputRef.current?.click()} disabled={sending}>
                {isZh ? '图片/文件' : 'Attach'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]; // 取第一个文件
                  if (file) void sendFile(file); // 上传并发送
                  e.target.value = ''; // 允许重复选同一文件
                }}
              />
              <button type="button" className="btn primary" onClick={() => void sendText()} disabled={sending || !draft.trim()}>
                {isZh ? '发送' : 'Send'}
              </button>
            </div>
          </>
        ) : (
          <div className="chat-placeholder">{isZh ? '选择一个会话或搜索用户开始聊天' : 'Select a conversation or search users'}</div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </section>

      {/* 群信息面板 */}
      {panelOpen && activeConversation && (
        <aside className="chat-panel">
          <header>
            <span>{isZh ? '群信息' : 'Group info'}</span>
            <button type="button" className="btn ghost" onClick={() => setPanelOpen(false)}>
              {isZh ? '关闭' : 'Close'}
            </button>
          </header>
          <div className="chat-panel-row">
            <input type="text" value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} />
            <button type="button" className="btn" onClick={() => void renameGroup()}>
              {isZh ? '改名' : 'Rename'}
            </button>
          </div>
          <div className="chat-panel-row">
            <span>{isZh ? `成员 ${members.length} 人` : `${members.length} members`}</span>
          </div>
          <div className="chat-member-list">
            {members.map((m) => (
              <div key={m.user_id} className="chat-member-chip">
                <span className="chat-avatar">{(m.display_name || m.user_id).slice(0, 1)}</span>
                <span className="chat-user-name">{m.display_name}</span>
                <span className="chat-member-role">{m.role === 'owner' ? (isZh ? '群主' : 'Owner') : m.role === 'admin' ? (isZh ? '管理员' : 'Admin') : ''}</span>
                {/* 群主可移除普通成员；自己可退群 */}
                {m.user_id !== ownerId && m.user_id === currentUserId && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void api.im.removeMember(activeConversation.id, m.user_id).then(() => leaveConversation())}
                  >
                    {isZh ? '退群' : 'Leave'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="btn danger" onClick={() => void leaveConversation()}>
            {isZh ? '删除并退出' : 'Delete & leave'}
          </button>
        </aside>
      )}

      {/* 视频通话浮窗 */}
      {callSession && (
        <VideoCall socket={im.socket} session={callSession} signal={callSignal} locale={locale} onEnded={handleCallEnded} />
      )}
    </div>
  );
} // Chat 结束
