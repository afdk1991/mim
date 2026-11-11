/** IM 消息协议：客户端与服务端 WebSocket 帧的统一类型定义。
 *
 * 设计原则：
 *   - 帧统一为 { type, id?, payload }，id 为客户端生成的请求序号，
 *     服务端在 ack 帧中回传，便于前端把响应与请求关联。
 *   - 多媒体消息（image/file）只在 payload 里携带 object_key，
 *     实际二进制走 media 预签名上传通道，避免大 payload 阻塞 WebSocket。
 *   - 视频通话信令（offer/answer/ice）复用同一连接，服务端仅做透传转发，
 *     不解析 SDP 内容，保证端到端隐私且降低服务端负担。
 */

/** 客户端 → 服务端的请求类型枚举 */
export type ClientFrameType =
  | 'ping' // 心跳：服务端回 pong
  | 'message.send' // 发送消息：落库后广播给同会话其它在线成员
  | 'message.read' // 标记会话已读：更新 last_read_message_id 并广播 read 事件
  | 'typing' // 输入中提示：广播给同会话其它在线成员（不落库）
  | 'call.invite' // 发起视频通话邀请
  | 'call.offer' // WebRTC SDP offer
  | 'call.answer' // WebRTC SDP answer
  | 'call.ice' // WebRTC ICE candidate
  | 'call.hangup'; // 挂断通话

/** 服务端 → 客户端的事件类型枚举 */
export type ServerFrameType =
  | 'pong' // 心跳响应
  | 'ack' // 请求处理结果（成功或错误，携带对应 id）
  | 'message.new' // 新消息到达
  | 'message.delivered' // 消息已投递到对方在线设备
  | 'message.read' // 对方已读某条消息
  | 'message.recall' // 某条消息被撤回（发送者 2 分钟内撤回，或管理员操作）
  | 'typing' // 对方正在输入
  | 'presence' // 用户在线/离线状态变更
  | 'call.invite' // 收到视频通话邀请
  | 'call.offer' // 收到对端 SDP offer
  | 'call.answer' // 收到对端 SDP answer
  | 'call.ice' // 收到对端 ICE candidate
  | 'call.hangup' // 对端挂断
  | 'error'; // 协议级错误（未登录、未知 type 等）

/** 消息内容类型：文本 / 图片 / 文件 / 系统提示 */
export type MessageContentType = 'text' | 'image' | 'file' | 'system';

/** 消息投递状态：sent（已落库）→ delivered（已投递给在线接收方）→ read（对方已读） */
export type MessageStatus = 'sent' | 'delivered' | 'read';

/** message.send 的请求体 */
export interface MessageSendPayload {
  conversation_id: string; // 目标会话 ID
  content_type: MessageContentType; // 内容类型
  content?: string; // 文本内容（text 必填；image/file 可为空）
  object_key?: string; // 媒体对象键（image/file 必填，由 media 预签名上传获得）
  object_mime?: string; // 媒体 MIME 类型
  object_name?: string; // 原始文件名
  object_size?: number; // 文件字节数
} // MessageSendPayload 结束

/** message.read 的请求体 */
export interface MessageReadPayload {
  conversation_id: string; // 已读的会话
  message_id: string; // 已读到的最新消息 ID
} // MessageReadPayload 结束

/** typing 的请求体 */
export interface TypingPayload {
  conversation_id: string; // 正在输入的会话
} // TypingPayload 结束

/** 视频通话信令的统一请求体：to_user_id 指定接收方 */
export interface CallSignalPayload {
  conversation_id?: string; // 关联会话（direct 会话可推导，群通话必填）
  to_user_id: string; // 信令接收方用户 ID
  sdp?: string; // offer/answer 的 SDP 文本
  candidate?: string; // ICE candidate 的 JSON 文本
} // CallSignalPayload 结束

/** 客户端帧的统一结构 */
export interface ClientFrame {
  type: ClientFrameType; // 帧类型
  id?: string; // 客户端请求序号，服务端在 ack 中回传
  payload?: unknown; // 帧载荷，按 type 解析
} // ClientFrame 结束

/** 服务端帧的统一结构 */
export interface ServerFrame {
  type: ServerFrameType; // 帧类型
  id?: string; // 对应客户端请求的 id（ack 帧必有）
  payload?: unknown; // 帧载荷
  error?: { code: string; message: string }; // error 帧的错误信息
} // ServerFrame 结束

/** ack 帧的载荷：请求处理结果 */
export interface AckPayload {
  ok: boolean; // true 表示成功，false 表示失败
  message_id?: string; // message.send 成功时返回落库后的消息 ID
  error?: string; // 失败原因（人类可读）
} // AckPayload 结束

/** 对外暴露的消息对象（落库后广播与 HTTP 返回共用） */
export interface MessageView {
  id: string; // 消息 ID
  conversation_id: string; // 所属会话
  sender_user_id: string; // 发送者 ID
  sender_display_name: string; // 发送者显示名（冗余，避免前端二次查用户）
  content_type: MessageContentType; // 内容类型
  content: string; // 文本内容或空串
  object_key?: string | null; // 媒体对象键
  object_mime?: string | null; // 媒体 MIME
  object_name?: string | null; // 原始文件名
  object_size?: number | null; // 文件大小
  status: MessageStatus; // 投递状态
  created_at: string; // 创建时间（UTC ISO-8601）
} // MessageView 结束
