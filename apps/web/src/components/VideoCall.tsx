/** VideoCall：WebRTC 视频通话浮窗，通过 IM WebSocket 交换信令（invite/offer/answer/ice/hangup）。
 *
 * 受控接口：
 *   - session：null 表示无通话；{ mode:'outgoing'|'incoming', peerUserId, peerDisplayName } 表示通话会话。
 *   - signal：最新到达的通话信令帧（由父组件从 socket 转发），变化时触发协商处理。
 *
 * 信令流程：
 *   1. 主叫 session.mode='outgoing' → 自动 getUserMedia + createOffer → 发 call.offer；
 *   2. 被叫收到 call.invite → session.mode='incoming' → 显示接听按钮；
 *   3. 被叫点接听 → getUserMedia + setRemoteDescription(offer) → createAnswer → 发 call.answer；
 *   4. 双方 ICE candidate 通过 call.ice 互发；
 *   5. 任一方 call.hangup → 双方关闭 PC，父组件清理 session。
 */

// React 钩子：状态、副作用、引用与回调
import { useCallback, useEffect, useRef, useState } from 'react';
// IM 帧类型与 socket 引用
import type { ImSocket, ImFrame } from '../im/socket';
// 类型导入：Locale
import type { Locale } from '@mim/i18n';

/** 通话会话信息 */
export interface CallSession {
  mode: 'outgoing' | 'incoming'; // 主叫 / 被叫
  peerUserId: string; // 对方用户 ID
  peerDisplayName: string; // 对方显示名
} // 代码块结束

/** 组件入参 */
interface VideoCallProps {
  socket: ImSocket | null; // IM socket 实例，用于发信令
  session: CallSession | null; // 当前通话会话，null 表示无通话
  signal: ImFrame | null; // 最新到达的通话信令帧，由父组件转发
  locale: Locale; // 当前界面语言
  onEnded: () => void; // 通话结束回调：父组件把 session 置空
} // 代码块结束

/** 通话状态机 */
type CallState =
  | 'idle' // 空闲
  | 'ringing-out' // 拨出等待接听
  | 'ringing-in' // 来电等待本机接听
  | 'connecting' // 协商 SDP/ICE
  | 'connected' // 已接通
  | 'ended'; // 已结束

// 媒体约束：720p 理想值，浏览器自适应
const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: true, // 必开音频
  video: { width: { ideal: 1280 }, height: { ideal: 720 } }, // 视频理想 720p
}; // 代码块结束

// STUN 服务器：公共 STUN 用于 NAT 穿透；生产环境可加自建 TURN
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** 视频通话浮窗组件 */
export function VideoCall({ socket, session, signal, locale, onEnded }: VideoCallProps) {
  // 通话状态
  const [state, setState] = useState<CallState>('idle');
  // 本地媒体流
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // 远端媒体流
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  // 错误提示
  const [error, setError] = useState<string | null>(null);

  // RTCPeerConnection 引用
  const pcRef = useRef<RTCPeerConnection | null>(null);
  // 本地流引用：关闭时停止轨道
  const localStreamRef = useRef<MediaStream | null>(null);

  // 会话引用：供异步回调取最新值
  const sessionRef = useRef<CallSession | null>(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // 清理所有媒体与连接资源
  const cleanup = useCallback(() => {
    if (pcRef.current) { // 条件分支：按判断结果选择后续处理路径
      pcRef.current.onicecandidate = null; // 解绑事件
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close(); // 关闭连接
      pcRef.current = null;
    } // 代码块结束
    if (localStreamRef.current) { // 条件分支：按判断结果选择后续处理路径
      localStreamRef.current.getTracks().forEach((t) => t.stop()); // 停止摄像头/麦克风
      localStreamRef.current = null;
      setLocalStream(null);
    } // 代码块结束
    setRemoteStream(null); // 清远端画面
  }, []);

  // 创建 PeerConnection 并绑定 ontrack / onicecandidate / onconnectionstatechange
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }); // 常量 pc：保存固定配置或一次性派生值
    pcRef.current = pc;
    // 收到对端媒体流
    pc.ontrack = (ev) => {
      if (ev.streams[0]) setRemoteStream(ev.streams[0]); // 设置远端画面
    }; // 代码块结束
    // 收集到 ICE candidate 时发给对方
    pc.onicecandidate = (ev) => {
      const peer = sessionRef.current?.peerUserId; // 常量 peer：保存固定配置或一次性派生值
      if (ev.candidate && socket && peer) { // 条件分支：按判断结果选择后续处理路径
        socket.send({
          type: 'call.ice', // 对象字段 type：记录一项配置或数据
          payload: { to_user_id: peer, candidate: JSON.stringify(ev.candidate) },
        });
      } // 代码块结束
    }; // 代码块结束
    // 连接状态变化：connected → 已接通；failed/disconnected → 结束
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setState('connected'); // 条件分支：按判断结果选择后续处理路径
      else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') { // 备选条件分支：上一条件不满足时再做判断
        setState('ended');
        cleanup();
        window.setTimeout(onEnded, 800); // 延迟通知父组件清理
      } // 代码块结束
    }; // 代码块结束
    return pc; // 返回当前函数的处理结果
  }, [socket, cleanup, onEnded]);

  // 挂断：通知对方并清理
  const hangup = useCallback(() => {
    const peer = sessionRef.current?.peerUserId; // 常量 peer：保存固定配置或一次性派生值
    if (socket && peer) { // 条件分支：按判断结果选择后续处理路径
      socket.send({ type: 'call.hangup', payload: { to_user_id: peer } }); // 通知对方
    } // 代码块结束
    setState('ended');
    cleanup();
    window.setTimeout(onEnded, 800);
  }, [socket, cleanup, onEnded]);

  // 被叫接听：申请媒体 → 创建 PC → 等 offer 到来再创建 answer
  const accept = useCallback(async () => {
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS); // 申请摄像头麦克风
      localStreamRef.current = stream;
      setLocalStream(stream);
      const pc = createPeerConnection(); // 创建 PC
      stream.getTracks().forEach((t) => pc.addTrack(t, stream)); // 把本地轨道加入 PC
      setState('connecting'); // 进入协商态，等待 call.offer
    } catch {
      setError(locale === 'en-US' ? 'Camera/mic permission denied' : '无法访问摄像头或麦克风');
      setState('ended');
      window.setTimeout(onEnded, 1500);
    } // 代码块结束
  }, [createPeerConnection, locale, onEnded]);

  // 主叫发起通话：申请媒体 → 创建 PC → 创建 offer → 发送
  const startOutgoing = useCallback(async () => {
    const peer = sessionRef.current?.peerUserId; // 常量 peer：保存固定配置或一次性派生值
    if (!peer || !socket) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS); // 申请本地媒体
      localStreamRef.current = stream;
      setLocalStream(stream);
      const pc = createPeerConnection(); // 创建 PC
      stream.getTracks().forEach((t) => pc.addTrack(t, stream)); // 加入本地轨道
      const offer = await pc.createOffer(); // 创建 SDP offer
      await pc.setLocalDescription(offer); // 设置本地描述
      socket.send({ type: 'call.offer', payload: { to_user_id: peer, sdp: offer.sdp } }); // 发送 offer
      setState('connecting'); // 进入协商态
    } catch {
      setError(locale === 'en-US' ? 'Camera/mic permission denied' : '无法访问摄像头或麦克风');
      setState('ended');
      window.setTimeout(onEnded, 1500);
    } // 代码块结束
  }, [socket, createPeerConnection, locale, onEnded]);

  // 会话变化：主叫自动拨出，被叫显示振铃
  useEffect(() => {
    if (!session) { // 条件分支：按判断结果选择后续处理路径
      // 会话被清空：重置状态
      setState('idle');
      cleanup();
      return; // 返回当前函数的处理结果
    } // 代码块结束
    setError(null); // 进入新会话前清错误
    if (session.mode === 'outgoing') { // 条件分支：按判断结果选择后续处理路径
      setState('ringing-out'); // 拨出态
      startOutgoing(); // 自动发起
    } else { // 代码块结束
      setState('ringing-in'); // 来电态：等待用户接听
    } // 代码块结束
    // 卸载或会话结束时清理
    return cleanup;
  }, [session, startOutgoing, cleanup]);

  // 处理到达的信令帧
  useEffect(() => {
    if (!signal) return; // 条件分支：按判断结果选择后续处理路径
    const pc = pcRef.current; // 常量 pc：保存固定配置或一次性派生值
    const payload = signal.payload as { sdp?: string; candidate?: string; from_user_id?: string } | undefined; // 常量 payload：保存固定配置或一次性派生值
    // 只处理来自当前通话对方的信令
    if (payload?.from_user_id && sessionRef.current && payload.from_user_id !== sessionRef.current.peerUserId) return;

    switch (signal.type) { // 执行当前业务步骤
      case 'call.offer': { // switch 分支取值：命中后执行对应处理
        // 收到 offer：设置远端描述 → 创建 answer
        if (!pc || !payload?.sdp) return;
        (async () => {
          await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp! }); // 异步等待：挂起至 Promise 落定后再继续
          const answer = await pc.createAnswer(); // 常量 answer：保存固定配置或一次性派生值
          await pc.setLocalDescription(answer); // 异步等待：挂起至 Promise 落定后再继续
          const peer = sessionRef.current?.peerUserId; // 常量 peer：保存固定配置或一次性派生值
          if (peer && socket) { // 条件分支：按判断结果选择后续处理路径
            socket.send({ type: 'call.answer', payload: { to_user_id: peer, sdp: answer.sdp } });
          } // 代码块结束
        })().catch(() => setError(locale === 'en-US' ? 'Negotiation failed' : '协商失败'));
        break; // 跳出当前循环或 switch 分支
      } // 代码块结束
      case 'call.answer': { // switch 分支取值：命中后执行对应处理
        // 收到 answer：设置远端描述
        if (!pc || !payload?.sdp) return;
        pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp }).catch(() =>
          setError(locale === 'en-US' ? 'Negotiation failed' : '协商失败'),
        ); // 执行当前业务步骤
        break; // 跳出当前循环或 switch 分支
      } // 代码块结束
      case 'call.ice': { // switch 分支取值：命中后执行对应处理
        // 收到 ICE candidate：添加到 PC
        if (!pc || !payload?.candidate) return;
        try { // 异常捕获起点：包裹可能抛出错误的操作
          const ice = JSON.parse(payload.candidate) as RTCIceCandidateInit; // 常量 ice：保存固定配置或一次性派生值
          pc.addIceCandidate(new RTCIceCandidate(ice)).catch(() => undefined); // 忽略过期 candidate
        } catch {
          // candidate JSON 解析失败静默忽略
        }
        break; // 跳出当前循环或 switch 分支
      } // 代码块结束
      case 'call.hangup': // switch 分支取值：命中后执行对应处理
        // 对方挂断
        setState('ended');
        cleanup();
        window.setTimeout(onEnded, 800);
        break; // 跳出当前循环或 switch 分支
      default:
        break; // 跳出当前循环或 switch 分支
    } // 代码块结束
  }, [signal, socket, cleanup, onEnded, locale]);

  // 无会话或空闲态不渲染
  if (!session || state === 'idle') return null;

  const isZh = locale !== 'en-US'; // 常量 isZh：保存固定配置或一次性派生值
  // 状态文案
  const stateText =
    state === 'ringing-out'
      ? isZh ? '正在呼叫…' : 'Calling…'
      : state === 'ringing-in'
        ? isZh ? '来电' : 'Incoming call'
        : state === 'connecting'
          ? isZh ? '连接中…' : 'Connecting…'
          : state === 'connected'
            ? isZh ? '通话中' : 'In call'
            : isZh ? '通话已结束' : 'Call ended';

  return ( // 返回当前函数的处理结果
    // 浮窗：固定右下角，带阴影圆角
    <div className="video-call-float" role="dialog" aria-label={stateText}>
      {/* 标题栏：对方名 + 状态 */}
      <div className="video-call-title">{/* 执行当前业务步骤 */}
        <span className="video-call-name">{session.peerDisplayName || session.peerUserId}</span>
        <span className="video-call-state">{stateText}</span>
      </div>
      {/* 远端视频（大画面），未接通时为黑屏 */}
      <video
        className="video-remote"
        autoPlay
        playsInline
        ref={(el) => { if (el) el.srcObject = remoteStream; }}
      />
      {/* 本地视频画中画 */}
      {localStream && (
        <video
          className="video-local"
          autoPlay
          playsInline
          muted
          ref={(el) => { if (el) el.srcObject = localStream; }}
        />
      )}
      {/* 错误提示条 */}
      {error && <div className="video-call-error">{error}</div>}
      {/* 操作按钮 */}
      <div className="video-call-actions">{/* 执行当前业务步骤 */}
        {state === 'ringing-in' && (
          <button type="button" className="btn primary" onClick={accept}>{/* 执行当前业务步骤 */}
            {isZh ? '接听' : 'Accept'}
          </button>
        )}
        {state !== 'ended' && ( /* idle 已在渲染前提前 return，控制流收窄后原比较恒真，故只需排除 ended */
          <button type="button" className="btn danger" onClick={hangup}>{/* 执行当前业务步骤 */}
            {isZh ? '挂断' : 'Hang up'}
          </button>
        )}
      </div>
    </div>
  ); // 执行当前业务步骤
} // VideoCall 结束
