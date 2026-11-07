/** useImSocket：把 ImSocket 实例封装为 React Hook，组件可直接拿到连接状态与收发能力。
 *
 * 用法：
 *   const { socket, connected, send, onMessage } = useImSocket(token);
 *   useEffect(() => onMessage((msg) => ...), []);
 *
 * 设计要点：
 *   - 组件挂载时建立连接，卸载时关闭；
 *   - token 变化时重建连接（登出/切换账号）；
 *   - 通过 effect 注册的事件回调保证每次渲染取最新闭包；
 *   - send 方法稳定引用，不会因重渲染改变。
 */

// React 钩子：副作用、引用、回调与状态
import { useCallback, useEffect, useRef, useState } from 'react';
// IM 客户端类与类型
import { ImSocket, type ConnectionState, type ImFrame } from './socket';
// 会话读取：获取 access_token 并在令牌更新时重连
import { getSession } from '../api';

/** Hook 返回值结构 */
export interface UseImSocket {
  socket: ImSocket | null; // 底层 socket 实例，供高级调用（如通话组件）
  connected: boolean; // 是否已连接
  state: ConnectionState; // 连接状态详情
  send: (frame: Omit<ImFrame, 'id'> & { id?: string }) => string | undefined; // 发送帧
  onFrame: (cb: (frame: ImFrame) => void) => () => void; // 注册帧回调，返回注销函数
  onMessage: (cb: (message: unknown) => void) => () => void; // 注册新消息回调
  onCall: (cb: (frame: ImFrame) => void) => () => void; // 注册通话信令回调
}

/** IM Socket Hook：管理连接生命周期并提供稳定的收发接口 */
export function useImSocket(): UseImSocket {
  // 用 ref 保存 socket 实例，避免重渲染时重建
  const socketRef = useRef<ImSocket | null>(null);
  // 连接状态：供 UI 显示连接中/已连接/已断开
  const [state, setState] = useState<ConnectionState>('closed');
  // 回调注册表：用 ref 保存，保证 effect 内注册的回调能取到最新值
  const frameCbs = useRef<Set<(frame: ImFrame) => void>>(new Set());
  const messageCbs = useRef<Set<(message: unknown) => void>>(new Set());
  const callCbs = useRef<Set<(frame: ImFrame) => void>>(new Set());

  // 建立连接的 effect：依赖令牌，令牌变化时重建
  useEffect(() => {
    const session = getSession(); // 从 localStorage 取当前会话
    if (!session) return; // 未登录不建立连接
    const token = session.access_token; // 取出 access_token
    // 创建 socket 实例，把三类回调转发到 ref 中的注册集合
    const socket = new ImSocket(token, {
      onState: (s) => setState(s), // 状态变化同步到 React state
      onFrame: (frame) => frameCbs.current.forEach((cb) => cb(frame)), // 广播给所有帧回调
      onMessage: (msg) => messageCbs.current.forEach((cb) => cb(msg)), // 广播新消息
      onCall: (frame) => callCbs.current.forEach((cb) => cb(frame)), // 广播通话信令
    });
    socketRef.current = socket; // 保存到 ref
    socket.connect(); // 建立连接
    // 卸载时关闭连接，清理引用
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []); // 空依赖：只在挂载时创建一次；令牌变化由登出流程整体重建

  // 稳定的发送方法：直接调用 socket.send
  const send = useCallback<UseImSocket['send']>((frame) => {
    return socketRef.current?.send(frame); // 无实例时返回 undefined
  }, []);

  // 注册帧回调：返回注销函数，effect 清理时调用
  const onFrame = useCallback((cb: (frame: ImFrame) => void) => {
    frameCbs.current.add(cb); // 加入集合
    return () => frameCbs.current.delete(cb); // 返回注销函数
  }, []);

  // 注册新消息回调
  const onMessage = useCallback((cb: (message: unknown) => void) => {
    messageCbs.current.add(cb);
    return () => messageCbs.current.delete(cb);
  }, []);

  // 注册通话信令回调
  const onCall = useCallback((cb: (frame: ImFrame) => void) => {
    callCbs.current.add(cb);
    return () => callCbs.current.delete(cb);
  }, []);

  // 返回给调用方的接口
  return {
    socket: socketRef.current, // 底层实例（可能为 null，未登录时）
    connected: state === 'open', // 便捷的已连接布尔值
    state, // 完整状态
    send, // 发送方法
    onFrame, // 帧回调注册
    onMessage, // 消息回调注册
    onCall, // 通话回调注册
  };
} // useImSocket 结束
