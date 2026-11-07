/** IM WebSocket 接入层：把 HTTP server 升级为 WebSocket，鉴权后路由消息帧。
 *
 * 职责：
 *   1. 监听 upgrade 事件，校验 query.token 中的 JWT，拿 user_id；
 *   2. 注册到 ImHub，连接关闭时反注册并广播 presence.offline；
 *   3. 解析客户端 JSON 帧，按 type 分发到 message/read/typing/call 处理器；
 *   4. 多媒体消息只在 WS 中传 object_key 引用，二进制走 media 预签名通道。
 */

import { type Server as HttpServer } from 'node:http'; // 仅用于类型，实际 server 由外部传入
import type { IncomingMessage } from 'node:http'; // 升级请求类型
import { parse as parseUrl } from 'node:url'; // 解析升级请求 URL，提取 query.token
import { WebSocketServer, type WebSocket } from 'ws'; // ws 库的服务端与连接类型
import { verifyAccessToken } from '../auth.js'; // JWT 校验，拿 user_id
import { ImHub } from './hub.js'; // 连接管理
import { createMessage, getMemberUserIds, isMember, markConversationRead } from './db.js'; // 数据访问
import type { ApiDeps } from '../types.js'; // 依赖注入
import type {
  AckPayload,
  CallSignalPayload,
  ClientFrame,
  MessageReadPayload,
  MessageSendPayload,
  ServerFrame,
  TypingPayload,
} from './protocol.js'; // 协议类型

/** 把 IM WebSocket 挂到一个 HTTP server 上；返回 ImHub 供 HTTP 路由推送事件用 */
export function attachImWebSocket(server: HttpServer, deps: ApiDeps): ImHub {
  const hub = new ImHub(); // 新建连接管理中心
  const wss = new WebSocketServer({ noServer: true }); // 不自动监听端口，由外部 server 的 upgrade 事件驱动

  // 处理升级请求：校验 token → 建立 WS 连接
  server.on('upgrade', (req, socket, head) => {
    // 只处理 /api/v1/im/ws 路径的升级请求，其它路径交给其它处理
    if (!req.url || !req.url.startsWith('/api/v1/im/ws')) return;
    // 从 URL query 中取 token
    const parsed = parseUrl(req.url, true);
    const token = (parsed.query.token as string) || '';
    // 无 token 或 token 非法：返回 HTTP 401 后优雅关闭 socket
    // 注意：不能直接 destroy()，否则 401 响应体来不及刷出，nginx 会回 502
    const payload = token ? verifyAccessToken(token, deps.jwtSecret) : null;
    if (!payload) {
      // 写 HTTP 401 响应头，end() 会确保数据刷出后再关闭连接
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    // 通过鉴权，升级为 WebSocket 连接
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, payload.sub); // payload.sub 即 user_id
    });
  });

  // 连接建立后注册到 hub 并绑定消息处理
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, userId: unknown) => {
    const uid = String(userId); // 转为字符串，确保类型一致
    hub.register(uid, ws); // 注册连接

    // 给当前用户推送 presence.online（仅自己可见，可扩展为好友列表广播）
    sendFrame(ws, { type: 'presence', payload: { user_id: uid, online: true } });

    // 收到消息帧
    ws.on('message', (raw: Buffer) => {
      // 解析 JSON 帧；解析失败回 error 帧
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString()) as ClientFrame;
      } catch {
        sendFrame(ws, { type: 'error', error: { code: 'BAD_JSON', message: '帧不是合法 JSON' } });
        return;
      }
      // 分发到各处理器
      handleFrame(ws, uid, frame, deps, hub).catch((err) => {
        // 处理器内部异常：回 error 帧并打日志
        console.warn('[im] frame handler error', { type: frame.type, error: String(err) });
        sendFrame(ws, { type: 'error', id: frame.id, error: { code: 'INTERNAL', message: '处理失败' } });
      });
    });

    // 连接关闭：反注册并广播离线
    ws.on('close', () => {
      const removed = hub.unregister(ws); // 从 hub 移除
      if (removed && !hub.isOnline(removed)) {
        // 该用户已无其它连接，向其会话成员广播离线（此处简化：仅日志，避免广播风暴）
        console.info('[im] user offline', { user_id: removed });
      }
    });
  });

  return hub; // 暴露 hub 给 HTTP 路由，便于跨通道推送
} // attachImWebSocket 结束

/** 单帧处理入口：按 type 分发，全部异步以便落库 */
async function handleFrame(
  ws: WebSocket,
  userId: string,
  frame: ClientFrame,
  deps: ApiDeps,
  hub: ImHub,
): Promise<void> {
  switch (frame.type) {
    case 'ping': {
      // 心跳：直接回 pong
      sendFrame(ws, { type: 'pong', id: frame.id });
      return;
    }
    case 'message.send': {
      await handleMessageSend(ws, userId, frame, deps, hub);
      return;
    }
    case 'message.read': {
      handleMessageRead(userId, frame, deps, hub);
      return;
    }
    case 'typing': {
      handleTyping(userId, frame, deps, hub);
      return;
    }
    case 'call.invite':
    case 'call.offer':
    case 'call.answer':
    case 'call.ice':
    case 'call.hangup': {
      handleCallSignal(userId, frame, deps, hub);
      return;
    }
    default: {
      // 未知帧类型：回 error
      sendFrame(ws, { type: 'error', id: frame.id, error: { code: 'UNKNOWN_TYPE', message: '未知帧类型' } });
    }
  }
} // handleFrame 结束

/** 处理发送消息：校验成员身份 → 落库 → 广播给同会话其它在线成员 → 回 ack */
async function handleMessageSend(
  ws: WebSocket,
  userId: string,
  frame: ClientFrame,
  deps: ApiDeps,
  hub: ImHub,
): Promise<void> {
  const p = frame.payload as Partial<MessageSendPayload> | undefined; // 载荷
  // 基础字段校验
  if (!p?.conversation_id || !p.content_type) {
    sendAck(ws, frame.id, false, '缺少 conversation_id 或 content_type');
    return;
  }
  // 文本消息必须有内容；图片/文件必须有 object_key
  if (p.content_type === 'text' && !p.content?.trim()) {
    sendAck(ws, frame.id, false, '文本消息不能为空');
    return;
  }
  if ((p.content_type === 'image' || p.content_type === 'file') && !p.object_key) {
    sendAck(ws, frame.id, false, '图片/文件消息必须携带 object_key');
    return;
  }
  // 校验发送者是该会话成员
  if (!isMember(deps.db, p.conversation_id, userId)) {
    sendAck(ws, frame.id, false, '非会话成员');
    return;
  }
  // 落库
  const message = createMessage(deps.db, {
    conversationId: p.conversation_id,
    senderUserId: userId,
    contentType: p.content_type,
    content: p.content,
    objectKey: p.object_key,
    objectMime: p.object_mime,
    objectName: p.object_name,
    objectSize: p.object_size,
  });
  // 回 ack（携带消息 ID，前端用于更新本地状态）
  sendAck(ws, frame.id, true, undefined, message.id);
  // 广播给同会话其它在线成员
  const members = getMemberUserIds(deps.db, p.conversation_id);
  hub.broadcastToUsers(members, { type: 'message.new', payload: { message } }, userId);
  // 对在线接收方标记 delivered（简化：只要对方在线即视为已投递）
  for (const m of members) {
    if (m !== userId && hub.isOnline(m)) {
      hub.sendToUser(m, { type: 'message.delivered', payload: { message_id: message.id } });
    }
  }
} // handleMessageSend 结束

/** 处理标记已读：更新游标 → 广播 read 事件给同会话成员 */
function handleMessageRead(userId: string, frame: ClientFrame, deps: ApiDeps, hub: ImHub): void {
  const p = frame.payload as Partial<MessageReadPayload> | undefined;
  if (!p?.conversation_id || !p.message_id) return; // 缺字段静默忽略
  if (!isMember(deps.db, p.conversation_id, userId)) return; // 非成员忽略
  // 更新已读游标并把消息状态置为 read
  markConversationRead(deps.db, p.conversation_id, userId, p.message_id);
  // 广播已读事件，让发送方更新消息状态
  const members = getMemberUserIds(deps.db, p.conversation_id);
  hub.broadcastToUsers(members, {
    type: 'message.read',
    payload: { conversation_id: p.conversation_id, reader_id: userId, message_id: p.message_id },
  });
} // handleMessageRead 结束

/** 处理输入中：广播给同会话其它在线成员（不落库） */
function handleTyping(userId: string, frame: ClientFrame, deps: ApiDeps, hub: ImHub): void {
  const p = frame.payload as Partial<TypingPayload> | undefined;
  if (!p?.conversation_id) return;
  if (!isMember(deps.db, p.conversation_id, userId)) return;
  const members = getMemberUserIds(deps.db, p.conversation_id);
  hub.broadcastToUsers(members, { type: 'typing', payload: { conversation_id: p.conversation_id, user_id: userId } }, userId);
} // handleTyping 结束

/** 处理视频通话信令：透传到指定接收方（服务端不解析 SDP） */
function handleCallSignal(userId: string, frame: ClientFrame, _deps: ApiDeps, hub: ImHub): void {
  const p = frame.payload as Partial<CallSignalPayload> | undefined;
  if (!p?.to_user_id) return; // 缺接收方忽略
  // 直接把原帧转发给目标用户（保留 type 与 payload）
  hub.sendToUser(p.to_user_id, {
    type: frame.type as ServerFrame['type'],
    payload: { ...p, from_user_id: userId }, // 附上发送者 ID，方便前端过滤
  });
} // handleCallSignal 结束

/** 给单个连接发一帧（统一 JSON 序列化） */
function sendFrame(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame)); // 仅向已打开连接发送
} // sendFrame 结束

/** 发送 ack 帧：封装成功/失败与可选消息 ID */
function sendAck(ws: WebSocket, id: string | undefined, ok: boolean, error?: string, messageId?: string): void {
  const payload: AckPayload = { ok }; // 基础 ack
  if (!ok && error) payload.error = error; // 失败时带错误信息
  if (ok && messageId) payload.message_id = messageId; // 成功且有消息 ID 时带回
  sendFrame(ws, { type: 'ack', id, payload });
} // sendAck 结束
