/** IM WebSocket 连接管理：维护用户到其在线连接的映射，提供定向与广播能力。
 *
 * 设计：
 *   - 一个用户可同时持有多个连接（多端登录），用 Set<WebSocket> 保存。
 *   - 所有广播均遍历会话成员的在线连接，保证消息只投递给相关用户。
 *   - 单实例内存状态，符合当前「自建服务器单实例」部署形态；
 *     若未来多副本，需引入 Redis Pub/Sub 做跨实例广播（不在本期范围）。
 */

import type { WebSocket } from 'ws'; // 引入 ws 库的 WebSocket 类型，仅作类型标注
import type { ServerFrame } from './protocol.js'; // 服务端帧类型，广播时统一信封

/** 单个连接的上下文：绑定用户 ID，便于连接关闭时反查清理 */
interface ConnectionCtx {
  userId: string; // 该连接归属的用户 ID
  joinedAt: number; // 连接建立的时间戳（毫秒），用于连接时长统计与调试
} // ConnectionCtx 结束

export class ImHub {
  /** user_id → 该用户的全部在线连接集合 */
  private readonly connections = new Map<string, Set<WebSocket>>();
  /** WebSocket → 上下文 的反向映射，连接关闭时用它反查 userId */
  private readonly ctxBySocket = new WeakMap<WebSocket, ConnectionCtx>();

  /** 注册一个新连接：把 socket 挂到对应 userId 的集合下 */
  register(userId: string, socket: WebSocket): void {
    // 取该用户已有连接集合，不存在则新建
    const set = this.connections.get(userId) ?? new Set<WebSocket>();
    // 把当前连接加入集合
    set.add(socket);
    // 写回 map（首次新建时必须写回，否则 map 里还是 undefined）
    this.connections.set(userId, set);
    // 建立反向映射，供 disconnect 使用
    this.ctxBySocket.set(socket, { userId, joinedAt: Date.now() });
  } // register 结束

  /** 注销一个连接：从用户集合中移除；若该用户已无连接则清理键 */
  unregister(socket: WebSocket): string | null {
    // 从反向映射取出上下文，拿不到说明未注册过，直接返回 null
    const ctx = this.ctxBySocket.get(socket);
    if (!ctx) return null;
    // 取该用户的连接集合
    const set = this.connections.get(ctx.userId);
    if (set) {
      // 从集合中移除当前连接
      set.delete(socket);
      // 集合为空时整体删除，避免 map 残留空集合造成「看似在线」的误判
      if (set.size === 0) this.connections.delete(ctx.userId);
    }
    // 返回用户 ID，供调用方广播 presence.offline 事件
    return ctx.userId;
  } // unregister 结束

  /** 判断某用户是否在线（至少有一个连接） */
  isOnline(userId: string): boolean {
    // 集合存在且非空即为在线
    const set = this.connections.get(userId);
    return !!set && set.size > 0;
  } // isOnline 结束

  /** 给单个用户的所有在线连接发送一帧 */
  sendToUser(userId: string, frame: ServerFrame): void {
    // 取该用户连接集合
    const set = this.connections.get(userId);
    if (!set) return; // 不在线直接返回，不抛错
    // 序列化帧为 JSON 字符串
    const text = JSON.stringify(frame);
    // 遍历该用户全部连接（多端登录）逐个发送
    for (const socket of set) {
      // 仅向 OPEN 状态的连接发送，避免向已关闭的 socket 写导致抛错
      if (socket.readyState === socket.OPEN) socket.send(text);
    }
  } // sendToUser 结束

  /** 给一组用户（通常是同一会话的成员）广播同一帧，跳过发送者本人 */
  broadcastToUsers(userIds: Iterable<string>, frame: ServerFrame, excludeUserId?: string): void {
    // 用 Set 去重，避免同一用户在成员列表里出现多次导致重复推送
    const targets = new Set(userIds);
    // 若指定了排除用户（通常是消息发送者），从目标集合中移除
    if (excludeUserId) targets.delete(excludeUserId);
    // 逐个用户投递
    for (const uid of targets) {
      this.sendToUser(uid, frame);
    }
  } // broadcastToUsers 结束

  /** 当前在线用户总数（用于监控与 presence 聚合） */
  get onlineUserCount(): number {
    // map 的 size 即在线用户数（已剔空集合）
    return this.connections.size;
  } // onlineUserCount getter 结束
} // ImHub 类结束
