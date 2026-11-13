/** IM WebSocket 客户端：连接 /im/ws?token=…，自动重连与心跳，按帧 type 分发回调。
 *
 * 设计要点：
 *   - 连接地址由 VITE_API_ORIGIN 或同源 location 派生（http→ws / https→wss）；
 *   - 断线后指数退避重连，最大间隔 10s，避免无限占 CPU；
 *   - 每 25s 发送 ping，服务端 10s 内未回 pong 视为死连接，主动关闭触发重连；
 *   - 帧统一为 { type, id?, payload }，与后端 protocol.ts 对齐；
 *   - 多媒体消息只传 object_key 引用，二进制走 media 预签名上传通道。
 */

// 与后端 protocol.ts 对齐的客户端帧类型
export type ClientFrameType =
  | 'ping' // 心跳
  | 'message.send' // 发消息
  | 'message.read' // 标记已读
  | 'typing' // 输入中
  | 'call.invite' // 发起通话
  | 'call.offer' // WebRTC offer 信令
  | 'call.answer' // WebRTC answer 应答
  | 'call.ice' // WebRTC ICE 候选
  | 'call.hangup'; // 挂断

// 服务端帧类型
export type ServerFrameType =
  | 'pong' // 执行当前业务步骤
  | 'ack' // 执行当前业务步骤
  | 'message.new' // 执行当前业务步骤
  | 'message.delivered' // 执行当前业务步骤
  | 'message.read' // 执行当前业务步骤
  | 'message.recall' // 某条消息被撤回（发送者 2 分钟内撤回）
  | 'conversation.members' // 群成员或角色变化（加人/踢人/设管理员/转让群主），用于刷新群面板
  | 'typing' // 执行当前业务步骤
  | 'presence' // 执行当前业务步骤
  | 'call.invite' // 执行当前业务步骤
  | 'call.offer' // 执行当前业务步骤
  | 'call.answer' // 执行当前业务步骤
  | 'call.ice' // 执行当前业务步骤
  | 'call.hangup' // 执行当前业务步骤
  | 'error'; // 执行当前业务步骤

// 统一帧结构
export interface ImFrame {
  type: ClientFrameType | ServerFrameType; // 帧类型
  id?: string; // 客户端请求序号（ack 回传）
  payload?: unknown; // 载荷
  error?: { code: string; message: string }; // error 帧错误信息
} // 代码块结束

// 连接状态枚举
export type ConnectionState = 'connecting' | 'open' | 'closed';

// 客户端回调集合
export interface ImSocketHandlers {
  onState?: (state: ConnectionState) => void; // 连接状态变化
  onFrame?: (frame: ImFrame) => void; // 收到任意服务端帧
  onAck?: (id: string | undefined, ok: boolean, error?: string) => void; // 请求应答
  onMessage?: (message: unknown) => void; // 新消息到达
  onCall?: (frame: ImFrame) => void; // 通话信令帧
  onError?: (err: Event) => void; // 底层错误
} // 代码块结束

// 心跳与重连常量
const HEARTBEAT_INTERVAL = 25000; // 每 25s 发一次 ping
const HEARTBEAT_TIMEOUT = 10000; // 10s 内未收到 pong 视为死连接
const RECONNECT_BASE = 500; // 重连初始退避 0.5s
const RECONNECT_MAX = 10000; // 重连最大间隔 10s

// API 源：与 api.ts 一致，用于派生 WS 地址
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');

/** 由 API_ORIGIN 或同源 location 派生 WebSocket 地址。
 *
 * 关键：Cloudflare Pages / GitHub Pages 等静态托管的 /api 反代只支持 HTTP，
 * 无法转发 WebSocket Upgrade。因此当页面运行在非生产域、非本地时，WS 必须
 * 直连生产 API（mim.mixm.top），而不是走同源 /api 反代。
 */
function deriveWsUrl(token: string): string {
  // 生产 API 域名：静态托管平台的 WS 必须直连此源
  const PROD_ORIGIN = 'https://mim.mixm.top';
  // 优先用构建期指定的 API 源
  let origin = API_ORIGIN;
  if (!origin && typeof window !== 'undefined') { // 条件分支：按判断结果选择后续处理路径
    const host = window.location.hostname; // 常量 host：保存固定配置或一次性派生值
    // 在生产域或本地：WS 走同源（与 HTTP API 同域）
    if (host === 'mim.mixm.top' || host === 'localhost' || host === '127.0.0.1') {
      origin = window.location.origin; // 赋值：更新变量 origin 的取值
    } else { // 代码块结束
      // 静态托管平台（CF Pages / GitHub Pages 等）：WS 直连生产 API
      origin = PROD_ORIGIN;
    } // 代码块结束
  } // 代码块结束
  // 把 http(s):// 替换成 ws(s)://
  const wsOrigin = origin.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  // 拼接路径与令牌（token 走 query，避免在 WS 握手头里跨域限制）；与后端 /api/v1 前缀对齐
  return `${wsOrigin}/api/v1/im/ws?token=${encodeURIComponent(token)}`;
} // 代码块结束

/** IM WebSocket 客户端类：单连接，自动重连，心跳保活 */
export class ImSocket {
  private ws: WebSocket | null = null; // 底层 WebSocket 实例
  private token: string; // access_token，重连时复用
  private handlers: ImSocketHandlers; // 回调集合
  private state: ConnectionState = 'closed'; // 当前连接状态
  private reconnectAttempts = 0; // 重连次数，用于指数退避
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null; // 重连定时器
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null; // 心跳定时器
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null; // 心跳超时定时器
  private frameId = 0; // 自增帧序号，服务端 ack 回传用于关联
  private closedByUser = false; // 用户主动关闭则不再重连

  constructor(token: string, handlers: ImSocketHandlers = {}) { // 调用 constructor 并处理其返回结果
    this.token = token; // 保存令牌供重连使用
    this.handlers = handlers; // 保存回调集合
  } // 构造函数结束

  /** 建立连接；已连接时直接返回 */
  connect(): void {
    // 主动关闭标志复位，允许 connect 重新开启自动重连
    this.closedByUser = false;
    // 已在连接中或已打开，不重复创建
    if (this.state === 'connecting' || this.state === 'open') return;
    this.setState('connecting'); // 通知外部进入连接中
    try { // 异常捕获起点：包裹可能抛出错误的操作
      // 新建 WebSocket，地址含 token
      this.ws = new WebSocket(deriveWsUrl(this.token));
    } catch (err) { // 代码块结束
      // 地址非法等同步异常：通知错误并调度重连
      this.handlers.onError?.(err as Event);
      this.scheduleReconnect(); // 执行当前业务步骤
      return; // 返回当前函数的处理结果
    } // 代码块结束
    // 连接成功
    this.ws.onopen = () => {
      this.setState('open'); // 通知外部已打开
      this.reconnectAttempts = 0; // 成功后重置退避计数
      this.startHeartbeat(); // 启动心跳
    }; // 代码块结束
    // 收到消息
    this.ws.onmessage = (ev) => {
      this.handleRawMessage(ev.data); // 统一解析与分发
    }; // 代码块结束
    // 连接关闭
    this.ws.onclose = () => {
      this.stopHeartbeat(); // 停止心跳
      this.setState('closed'); // 通知外部已关闭
      // 非用户主动关闭则调度重连
      if (!this.closedByUser) this.scheduleReconnect();
    }; // 代码块结束
    // 连接错误
    this.ws.onerror = (ev) => {
      this.handlers.onError?.(ev); // 通知外部错误
    }; // 代码块结束
  } // connect 结束

  /** 主动关闭：不再重连 */
  close(): void {
    this.closedByUser = true; // 标记为用户关闭，阻止 onclose 触发重连
    this.clearReconnect(); // 清掉待执行的重连定时器
    this.stopHeartbeat(); // 停止心跳
    if (this.ws) { // 条件分支：按判断结果选择后续处理路径
      // 清空回调，避免 close 事件触发重连逻辑
      this.ws.onclose = null;
      this.ws.onerror = null; // 执行当前业务步骤
      this.ws.close(); // 关闭底层连接
      this.ws = null; // 执行当前业务步骤
    } // 代码块结束
    this.setState('closed'); // 通知外部已关闭
  } // close 结束

  /** 发送一帧；连接未打开时静默丢弃（调用方应自行判断 state） */
  send(frame: Omit<ImFrame, 'id'> & { id?: string }): string | undefined {
    // 未打开无法发送
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return undefined;
    // 若调用方未指定 id，自动分配一个自增序号
    const id = frame.id ?? String(++this.frameId);
    const full: ImFrame = { ...frame, id }; // 组装完整帧
    this.ws.send(JSON.stringify(full)); // 序列化为 JSON 发送
    return id; // 返回帧 id 供调用方匹配 ack
  } // send 结束

  /** 解析并分发收到的原始消息 */
  private handleRawMessage(raw: unknown): void {
    let frame: ImFrame; // 可变变量 frame：运行过程中会被重新赋值
    try { // 异常捕获起点：包裹可能抛出错误的操作
      frame = JSON.parse(String(raw)) as ImFrame; // 尝试解析 JSON
    } catch { // 代码块结束
      return; // 非 JSON 帧静默忽略
    } // 代码块结束
    this.handlers.onFrame?.(frame); // 先通知原始帧回调
    // 按类型分发到专用回调
    switch (frame.type) {
      case 'pong': // switch 分支取值：命中后执行对应处理
        this.onPong(); // 心跳响应：清掉超时定时器
        break; // 跳出当前循环或 switch 分支
      case 'ack': { // switch 分支取值：命中后执行对应处理
        // ack 载荷形状：{ ok, message_id?, error? }
        const p = frame.payload as { ok: boolean; error?: string } | undefined;
        this.handlers.onAck?.(frame.id, p?.ok ?? false, p?.error); // 执行当前业务步骤
        break; // 跳出当前循环或 switch 分支
      } // 代码块结束
      case 'message.new': { // switch 分支取值：命中后执行对应处理
        // 新消息载荷：{ message }
        const p = frame.payload as { message: unknown } | undefined;
        if (p?.message) this.handlers.onMessage?.(p.message); // 条件分支：按判断结果选择后续处理路径
        break; // 跳出当前循环或 switch 分支
      } // 代码块结束
      case 'call.invite': // switch 分支取值：命中后执行对应处理
      case 'call.offer': // switch 分支取值：命中后执行对应处理
      case 'call.answer': // switch 分支取值：命中后执行对应处理
      case 'call.ice': // switch 分支取值：命中后执行对应处理
      case 'call.hangup': // switch 分支取值：命中后执行对应处理
        this.handlers.onCall?.(frame); // 通话信令交给通话组件处理
        break; // 跳出当前循环或 switch 分支
      default: // 对象字段 default：记录一项配置或数据
        break; // 其它帧（message.delivered/read/typing/presence/error）由 onFrame 自行处理
    } // 代码块结束
  } // handleRawMessage 结束

  /** 启动心跳：定时发 ping，超时未回 pong 则主动断开触发重连 */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // 先清理旧定时器
    this.heartbeatTimer = setInterval(() => { // 执行当前业务步骤
      this.send({ type: 'ping' }); // 发送心跳帧
      // 超时未收到 pong，主动关闭连接让重连逻辑接管
      this.heartbeatTimeout = setTimeout(() => {
        if (this.ws) this.ws.close(); // 关闭触发 onclose → 重连
      }, HEARTBEAT_TIMEOUT); // 代码块结束
    }, HEARTBEAT_INTERVAL); // 代码块结束
  } // startHeartbeat 结束

  /** 收到 pong 时清除超时定时器 */
  private onPong(): void {
    if (this.heartbeatTimeout) { // 条件分支：按判断结果选择后续处理路径
      clearTimeout(this.heartbeatTimeout); // 调用 clearTimeout 并处理其返回结果
      this.heartbeatTimeout = null; // 执行当前业务步骤
    } // 代码块结束
  } // onPong 结束

  /** 停止心跳相关定时器 */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { // 条件分支：按判断结果选择后续处理路径
      clearInterval(this.heartbeatTimer); // 调用 clearInterval 并处理其返回结果
      this.heartbeatTimer = null; // 执行当前业务步骤
    } // 代码块结束
    if (this.heartbeatTimeout) { // 条件分支：按判断结果选择后续处理路径
      clearTimeout(this.heartbeatTimeout); // 调用 clearTimeout 并处理其返回结果
      this.heartbeatTimeout = null; // 执行当前业务步骤
    } // 代码块结束
  } // stopHeartbeat 结束

  /** 指数退避调度重连 */
  private scheduleReconnect(): void {
    this.clearReconnect(); // 清掉旧定时器避免重复
    // 计算退避时长：base * 2^attempts，封顶 max
    const delay = Math.min(RECONNECT_BASE * 2 ** this.reconnectAttempts, RECONNECT_MAX);
    this.reconnectAttempts += 1; // 递增重连次数
    this.reconnectTimer = setTimeout(() => this.connect(), delay); // 延迟后重连
  } // scheduleReconnect 结束

  /** 清除待执行的重连定时器 */
  private clearReconnect(): void {
    if (this.reconnectTimer) { // 条件分支：按判断结果选择后续处理路径
      clearTimeout(this.reconnectTimer); // 调用 clearTimeout 并处理其返回结果
      this.reconnectTimer = null; // 执行当前业务步骤
    } // 代码块结束
  } // clearReconnect 结束

  /** 更新状态并通知外部 */
  private setState(next: ConnectionState): void {
    if (this.state === next) return; // 状态未变不重复通知
    this.state = next; // 更新内部状态
    this.handlers.onState?.(next); // 通知外部回调
  } // setState 结束

  /** 只读暴露当前连接状态 */
  get connected(): boolean {
    return this.state === 'open'; // 仅 open 视为已连接
  } // connected getter 结束
} // ImSocket 类结束
