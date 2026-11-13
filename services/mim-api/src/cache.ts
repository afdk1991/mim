/**
 * 最小缓存适配层（安全加固与性能包，2026-11-13）。
 *
 * 职责：
 *   - 频控滑动窗口、验证码状态、会话/幂等辅助计数统一走本层；
 *   - 配置 MIM_REDIS_URL 时走真实 Redis（本文件用 node:net 手写最小 RESP 客户端，不新增第三方依赖）；
 *   - 未配置时自动降级为进程内 Map + 定时清理，单副本本地开发 / 测试可用；
 *   - 后端身份可观测：`backend` 字段与启动日志明确打印当前走的是 redis 还是 memory。
 *
 * 接口刻意压到最小：get / set / incr / expire / del / ping / close，
 * 不暴露 Redis 专有数据结构，便于后续替换后端而不动调用方。
 */

import { createConnection, type Socket } from 'node:net'; // 手写 RESP 只用 TCP 直连，不引 redis 客户端
import { URL } from 'node:url'; // 解析 redis:// 连接串

/** 缓存后端类型：redis 为真实实例，memory 为进程内降级实现 */
export type CacheBackendKind = 'redis' | 'memory'; // 声明类型 CacheBackendKind：约束跨模块数据结构

/** 统一缓存接口：值一律按字符串存取，调用方自行序列化 */
export interface CacheBackend { // 声明类型 CacheBackend：约束跨模块数据结构
  /** 当前后端标识，日志与 /ready 探测据此判断 */
  readonly backend: CacheBackendKind; // 业务步骤：推进当前流程的下一项处理
  /** 读键；不存在或已过期返回 null */
  get(key: string): Promise<string | null>; // 业务步骤：推进当前流程的下一项处理
  /** 写键；ttlSeconds 省略时不过期（仅进程内降级实现，Redis 侧仍建议传 TTL） */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>; // 业务步骤：推进当前流程的下一项处理
  /** 计数自增，键不存在时从 0 开始；返回自增后的值 */
  incr(key: string): Promise<number>; // 业务步骤：推进当前流程的下一项处理
  /** 给已有键续期；键不存在时不报错（与 Redis EXPIRE 语义一致） */
  expire(key: string, ttlSeconds: number): Promise<void>; // 业务步骤：推进当前流程的下一项处理
  /** 删键 */
  del(key: string): Promise<void>; // 业务步骤：推进当前流程的下一项处理
  /** 探活：Redis 走 PING，内存后端恒 true */
  ping(): Promise<boolean>; // 业务步骤：推进当前流程的下一项处理
  /** 释放连接；内存后端清理定时任务 */
  close(): Promise<void>; // 业务步骤：推进当前流程的下一项处理
} // 结束代码块：本层作用域收尾

// ---------------------------------------------------------------------------
// 进程内降级实现（Map + 惰性过期 + 定时清扫）
// ---------------------------------------------------------------------------

interface MemoryEntry { // 声明类型 MemoryEntry：约束跨模块数据结构
  value: string; // 对象字段：声明结构中的一项数据
  expiresAt: number | null; // null 表示永不过期
} // 结束代码块：本层作用域收尾

class MemoryCache implements CacheBackend { // 业务步骤：推进当前流程的下一项处理
  readonly backend: CacheBackendKind = 'memory'; // 业务步骤：推进当前流程的下一项处理
  private store = new Map<string, MemoryEntry>(); // 业务步骤：推进当前流程的下一项处理
  private sweepTimer: NodeJS.Timeout | null = null; // 业务步骤：推进当前流程的下一项处理

  constructor() { // 业务步骤：推进当前流程的下一项处理
    // 定时清扫已过期条目；unref 保证不阻止进程退出
    this.sweepTimer = setInterval(() => this.sweep(), 60_000); // 业务步骤：推进当前流程的下一项处理
    this.sweepTimer.unref(); // 业务步骤：推进当前流程的下一项处理
  } // 结束代码块：本层作用域收尾

  private isExpired(entry: MemoryEntry): boolean { // 业务步骤：推进当前流程的下一项处理
    return entry.expiresAt !== null && entry.expiresAt <= Date.now(); // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  private sweep(): void { // 业务步骤：推进当前流程的下一项处理
    const now = Date.now(); // 保存 now：承载本步骤的计算结果供后续使用
    for (const [key, entry] of this.store) { // 循环处理：逐项完成批量数据操作
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.store.delete(key); // 条件分支：仅在满足业务前置条件时继续
    } // 结束循环体：本层作用域收尾
  } // 结束代码块：本层作用域收尾

  async get(key: string): Promise<string | null> { // 业务步骤：推进当前流程的下一项处理
    const entry = this.store.get(key); // 保存 entry：承载本步骤的计算结果供后续使用
    if (!entry) return null; // 条件分支：仅在满足业务前置条件时继续
    if (this.isExpired(entry)) { // 条件分支：仅在满足业务前置条件时继续
      this.store.delete(key); // 业务步骤：推进当前流程的下一项处理
      return null; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    return entry.value; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    this.store.set(key, { // 业务步骤：推进当前流程的下一项处理
      value, // 业务步骤：推进当前流程的下一项处理
      expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
  } // 结束代码块：本层作用域收尾

  async incr(key: string): Promise<number> { // 业务步骤：推进当前流程的下一项处理
    const current = await this.get(key); // 保存 current：承载本步骤的计算结果供后续使用
    const next = (current === null ? 0 : Number.parseInt(current, 10) || 0) + 1; // 保存 next：承载本步骤的计算结果供后续使用
    await this.set(key, String(next)); // 等待异步结果：串行完成依赖操作
    return next; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  async expire(key: string, ttlSeconds: number): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    const entry = this.store.get(key); // 保存 entry：承载本步骤的计算结果供后续使用
    if (!entry) return; // 条件分支：仅在满足业务前置条件时继续
    entry.expiresAt = Date.now() + ttlSeconds * 1000; // 业务步骤：推进当前流程的下一项处理
  } // 结束代码块：本层作用域收尾

  async del(key: string): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    this.store.delete(key); // 业务步骤：推进当前流程的下一项处理
  } // 结束代码块：本层作用域收尾

  async ping(): Promise<boolean> { // 业务步骤：推进当前流程的下一项处理
    return true; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  async close(): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    this.store.clear(); // 业务步骤：推进当前流程的下一项处理
    if (this.sweepTimer) clearInterval(this.sweepTimer); // 条件分支：仅在满足业务前置条件时继续
    this.sweepTimer = null; // 业务步骤：推进当前流程的下一项处理
  } // 结束代码块：本层作用域收尾
} // 结束代码块：本层作用域收尾

// ---------------------------------------------------------------------------
// 最小 RESP 客户端（node:net 直连，不新增依赖）
// ---------------------------------------------------------------------------

type RedisReply = string | number | null | RedisReply[]; // 声明类型 RedisReply：约束跨模块数据结构

interface PendingRequest { // 声明类型 PendingRequest：约束跨模块数据结构
  resolve: (reply: RedisReply) => void; // 对象字段：声明结构中的一项数据
  reject: (err: Error) => void; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

/** 解析 MIM_REDIS_URL：支持 redis://[user:pass@]host:port[/db]，缺省 localhost:6379/0 */
function parseRedisUrl(raw: string): { host: string; port: number; password: string | null; db: number } { // 定义函数 parseRedisUrl：封装可复用业务步骤
  const trimmed = raw.trim(); // 保存 trimmed：承载本步骤的计算结果供后续使用
  if (!trimmed) throw new Error('MIM_REDIS_URL is empty'); // 条件分支：仅在满足业务前置条件时继续
  let url: URL; // 保存 url：承载本步骤的计算结果供后续使用
  try { // 异常保护：确保失败路径可回收资源
    url = trimmed.includes('://') ? new URL(trimmed) : new URL(`redis://${trimmed}`);
  } catch { // 结束代码块：本层作用域收尾
    throw new Error(`invalid MIM_REDIS_URL: ${trimmed}`); // 抛出异常：中止非法路径并交给统一错误处理
  } // 结束代码块：本层作用域收尾
  const host = url.hostname || '127.0.0.1'; // 保存 host：承载本步骤的计算结果供后续使用
  const port = Number(url.port || 6379); // 保存 port：承载本步骤的计算结果供后续使用
  const password = url.password ? decodeURIComponent(url.password) : null; // 保存 password：承载本步骤的计算结果供后续使用
  const dbMatch = url.pathname.replace(/^\//, '').match(/^\d+$/);
  const db = dbMatch ? Number(dbMatch[0]) : 0; // 保存 db：承载本步骤的计算结果供后续使用
  return { host, port, password, db }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

function encodeCommand(args: string[]): Buffer { // 定义函数 encodeCommand：封装可复用业务步骤
  const parts: string[] = [`*${args.length}`]; // 保存 parts：承载本步骤的计算结果供后续使用
  for (const arg of args) { // 循环处理：逐项完成批量数据操作
    const body = Buffer.from(String(arg), 'utf8'); // 保存 body：承载本步骤的计算结果供后续使用
    parts.push(`$${body.length}`, body.toString('binary')); // 业务步骤：推进当前流程的下一项处理
  } // 结束循环体：本层作用域收尾
  return Buffer.from(parts.join('\r\n') + '\r\n', 'binary'); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

class RedisCache implements CacheBackend { // 业务步骤：推进当前流程的下一项处理
  readonly backend: CacheBackendKind = 'redis'; // 业务步骤：推进当前流程的下一项处理
  private socket: Socket | null = null; // 业务步骤：推进当前流程的下一项处理
  private buffer: Buffer = Buffer.alloc(0); // 业务步骤：推进当前流程的下一项处理
  private pending: PendingRequest[] = []; // 业务步骤：推进当前流程的下一项处理
  private connecting: Promise<void> | null = null; // 业务步骤：推进当前流程的下一项处理
  private closed = false; // 业务步骤：推进当前流程的下一项处理
  private readonly options: { host: string; port: number; password: string | null; db: number }; // 业务步骤：推进当前流程的下一项处理

  constructor(rawUrl: string) { // 业务步骤：推进当前流程的下一项处理
    this.options = parseRedisUrl(rawUrl); // 业务步骤：推进当前流程的下一项处理
  } // 结束代码块：本层作用域收尾

  private connect(): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    if (this.socket && !this.socket.destroyed) return Promise.resolve(); // 条件分支：仅在满足业务前置条件时继续
    if (this.connecting) return this.connecting; // 条件分支：仅在满足业务前置条件时继续
    this.connecting = new Promise<void>((resolve, reject) => { // 业务步骤：推进当前流程的下一项处理
      const { host, port, password, db } = this.options; // 解构依赖：从模块或上下文取出所需成员
      let settled = false; // 连接承诺只收敛一次，避免 close 与 error 重复 reject
      const failConnect = (err: Error): void => { // 连接期失败：排空 pending 并收敛连接承诺，避免后续重连永久挂起
        this.failPending(err); // 业务步骤：推进当前流程的下一项处理
        if (!settled) { settled = true; reject(err); } // 条件分支：仅在满足业务前置条件时继续
      };
      const socket = createConnection({ host, port }, () => { // 保存 socket：承载本步骤的计算结果供后续使用
        // 握手阶段直接走低层写命令，避免 rawCommand 再次进入 connect() 形成自等待
        const authStep = password ? this.writeCommand(['AUTH', password]).then(() => undefined) : Promise.resolve(); // 保存 authStep：承载本步骤的计算结果供后续使用
        authStep // 业务步骤：推进当前流程的下一项处理
          .then(() => (db > 0 ? this.writeCommand(['SELECT', String(db)]).then(() => undefined) : undefined)) // 链式调用：在上一步结果上继续处理
          .then(() => { if (!settled) { settled = true; resolve(); } }) // 链式调用：先判收敛标记再 resolve
          .catch(failConnect); // 链式调用：在上一步结果上继续处理
      }); // 结束函数体：本层作用域收尾
      socket.setNoDelay(true); // 业务步骤：推进当前流程的下一项处理
      socket.setTimeout(10_000); // 业务步骤：推进当前流程的下一项处理
      socket.on('data', (chunk) => this.onData(chunk)); // 业务步骤：推进当前流程的下一项处理
      socket.on('error', (err) => failConnect(err)); // 连接期错误：排空 pending + 收敛连接承诺
      socket.on('close', () => { // 业务步骤：推进当前流程的下一项处理
        this.socket = null; // 业务步骤：推进当前流程的下一项处理
        failConnect(new Error('redis connection closed')); // 业务步骤：推进当前流程的下一项处理
      }); // 结束函数体：本层作用域收尾
      socket.on('timeout', () => { // 业务步骤：推进当前流程的下一项处理
        socket.destroy(new Error('redis connection timed out')); // 业务步骤：推进当前流程的下一项处理
      }); // 结束函数体：本层作用域收尾
      this.socket = socket; // 业务步骤：推进当前流程的下一项处理
    }); // 结束代码块：本层作用域收尾
    this.connecting.finally(() => { // 业务步骤：推进当前流程的下一项处理
      this.connecting = null; // 业务步骤：推进当前流程的下一项处理
    }).catch(() => { /* 派生承诺的拒绝已由 rawCommand 的 await 收口，此处避免未处理拒绝告警 */ });
    return this.connecting; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  /** 低层写命令：假定 socket 已就绪，不再触发连接流程 */
  private writeCommand(args: string[]): Promise<RedisReply> { // 业务步骤：推进当前流程的下一项处理
    const socket = this.socket; // 保存 socket：承载本步骤的计算结果供后续使用
    if (!socket) return Promise.reject(new Error('redis connection unavailable')); // 条件分支：仅在满足业务前置条件时继续
    return new Promise<RedisReply>((resolve, reject) => { // 返回结果：把本步骤产物交给调用方
      this.pending.push({ resolve, reject }); // 业务步骤：推进当前流程的下一项处理
      socket.write(encodeCommand(args)); // 业务步骤：推进当前流程的下一项处理
    }); // 结束函数体：本层作用域收尾
  } // 结束代码块：本层作用域收尾

  private failPending(err: Error): void { // 业务步骤：推进当前流程的下一项处理
    for (const req of this.pending.splice(0)) req.reject(err); // 循环处理：逐项完成批量数据操作
  } // 结束代码块：本层作用域收尾

  private onData(chunk: Buffer): void { // 业务步骤：推进当前流程的下一项处理
    const merged = Buffer.alloc(this.buffer.length + chunk.length); // 保存 merged：承载本步骤的计算结果供后续使用
    this.buffer.copy(merged, 0); // 业务步骤：推进当前流程的下一项处理
    chunk.copy(merged, this.buffer.length); // 业务步骤：推进当前流程的下一项处理
    this.buffer = merged; // 业务步骤：推进当前流程的下一项处理
    // 循环解析直到缓冲区不足一条完整回复
    for (;;) { // 循环处理：逐项完成批量数据操作
      const parsed = this.parseReply(); // 保存 parsed：承载本步骤的计算结果供后续使用
      if (!parsed) break; // 条件分支：仅在满足业务前置条件时继续
      const { reply, consumed } = parsed; // 解构依赖：从模块或上下文取出所需成员
      this.buffer = this.buffer.slice(consumed); // 业务步骤：推进当前流程的下一项处理
      const req = this.pending.shift(); // 保存 req：承载本步骤的计算结果供后续使用
      if (req) req.resolve(reply); // 条件分支：仅在满足业务前置条件时继续
    } // 结束循环体：本层作用域收尾
  } // 结束代码块：本层作用域收尾

  /** 极简 RESP 解析：支持 + / - / : / $ / *，足够覆盖本层用到的命令 */
  private parseReply(): { reply: RedisReply; consumed: number } | null { // 业务步骤：推进当前流程的下一项处理
    const buf = this.buffer; // 保存 buf：承载本步骤的计算结果供后续使用
    const lineEnd = buf.indexOf('\r\n'); // 保存 lineEnd：承载本步骤的计算结果供后续使用
    if (lineEnd === -1) return null; // 条件分支：仅在满足业务前置条件时继续
    const type = String.fromCharCode(buf[0]!); // 保存 type：承载本步骤的计算结果供后续使用
    const line = buf.slice(1, lineEnd).toString('utf8'); // 保存 line：承载本步骤的计算结果供后续使用
    const headerLen = lineEnd + 2; // 保存 headerLen：承载本步骤的计算结果供后续使用

    if (type === '+' || type === ':') { // 条件分支：仅在满足业务前置条件时继续
      return { reply: type === ':' ? Number(line) : line, consumed: headerLen }; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    if (type === '-') { // 条件分支：仅在满足业务前置条件时继续
      const err = new Error(line); // 保存 err：承载本步骤的计算结果供后续使用
      return { reply: err as unknown as RedisReply, consumed: headerLen }; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    if (type === '$') { // 条件分支：仅在满足业务前置条件时继续
      const len = Number(line); // 保存 len：承载本步骤的计算结果供后续使用
      if (len === -1) return { reply: null, consumed: headerLen }; // 条件分支：仅在满足业务前置条件时继续
      const bodyEnd = headerLen + len + 2; // 保存 bodyEnd：承载本步骤的计算结果供后续使用
      if (buf.length < bodyEnd) return null; // 条件分支：仅在满足业务前置条件时继续
      return { reply: buf.slice(headerLen, headerLen + len).toString('utf8'), consumed: bodyEnd }; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    if (type === '*') { // 条件分支：仅在满足业务前置条件时继续
      const count = Number(line); // 保存 count：承载本步骤的计算结果供后续使用
      if (count === -1) return { reply: null, consumed: headerLen }; // 条件分支：仅在满足业务前置条件时继续
      const items: RedisReply[] = []; // 保存 items：承载本步骤的计算结果供后续使用
      let cursor = headerLen; // 保存 cursor：承载本步骤的计算结果供后续使用
      for (let i = 0; i < count; i += 1) { // 循环处理：逐项完成批量数据操作
        const slice = this.buffer.slice(cursor); // 保存 slice：承载本步骤的计算结果供后续使用
        const sub = this.parseReplyBuffer(slice); // 保存 sub：承载本步骤的计算结果供后续使用
        if (!sub) return null; // 条件分支：仅在满足业务前置条件时继续
        items.push(sub.reply); // 业务步骤：推进当前流程的下一项处理
        cursor += sub.consumed; // 业务步骤：推进当前流程的下一项处理
      } // 结束循环体：本层作用域收尾
      return { reply: items, consumed: cursor }; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    return null; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  /** 对指定切片解析一条回复（供数组元素递归使用） */
  private parseReplyBuffer(buf: Buffer): { reply: RedisReply; consumed: number } | null { // 业务步骤：推进当前流程的下一项处理
    const prev = this.buffer; // 保存 prev：承载本步骤的计算结果供后续使用
    this.buffer = buf; // 业务步骤：推进当前流程的下一项处理
    try { // 异常保护：确保失败路径可回收资源
      return this.parseReply(); // 返回结果：把本步骤产物交给调用方
    } finally { // 结束代码块：本层作用域收尾
      this.buffer = prev; // 业务步骤：推进当前流程的下一项处理
    } // 结束代码块：本层作用域收尾
  } // 结束代码块：本层作用域收尾

  private async rawCommand(args: string[]): Promise<RedisReply> { // 业务步骤：推进当前流程的下一项处理
    if (this.closed) throw new Error('redis client closed'); // 条件分支：仅在满足业务前置条件时继续
    await this.connect(); // 等待异步结果：串行完成依赖操作
    return this.writeCommand(args); // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  private unwrap(reply: RedisReply): string | null { // 业务步骤：推进当前流程的下一项处理
    if (reply instanceof Error) throw reply; // 条件分支：仅在满足业务前置条件时继续
    if (reply === null) return null; // 条件分支：仅在满足业务前置条件时继续
    return String(reply); // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  async get(key: string): Promise<string | null> { // 业务步骤：推进当前流程的下一项处理
    return this.unwrap(await this.rawCommand(['GET', key])); // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    const args = ttlSeconds === undefined ? ['SET', key, value] : ['SET', key, value, 'EX', String(ttlSeconds)]; // 保存 args：承载本步骤的计算结果供后续使用
    await this.rawCommand(args); // 等待异步结果：串行完成依赖操作
  } // 结束代码块：本层作用域收尾

  async incr(key: string): Promise<number> { // 业务步骤：推进当前流程的下一项处理
    const reply = await this.rawCommand(['INCR', key]); // 保存 reply：承载本步骤的计算结果供后续使用
    if (reply instanceof Error) throw reply; // 条件分支：仅在满足业务前置条件时继续
    return Number(reply); // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  async expire(key: string, ttlSeconds: number): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    await this.rawCommand(['EXPIRE', key, String(ttlSeconds)]); // 等待异步结果：串行完成依赖操作
  } // 结束代码块：本层作用域收尾

  async del(key: string): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    await this.rawCommand(['DEL', key]); // 等待异步结果：串行完成依赖操作
  } // 结束代码块：本层作用域收尾

  async ping(): Promise<boolean> { // 业务步骤：推进当前流程的下一项处理
    const reply = await this.rawCommand(['PING']); // 保存 reply：承载本步骤的计算结果供后续使用
    return !(reply instanceof Error) && String(reply) === 'PONG'; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  async close(): Promise<void> { // 业务步骤：推进当前流程的下一项处理
    this.closed = true; // 业务步骤：推进当前流程的下一项处理
    try { // 异常保护：确保失败路径可回收资源
      await this.rawCommand(['QUIT']); // 等待异步结果：串行完成依赖操作
    } catch { // 结束代码块：本层作用域收尾
      // 关闭阶段忽略协议层错误，直接断连
    } // 结束代码块：本层作用域收尾
    this.socket?.destroy(); // 业务步骤：推进当前流程的下一项处理
    this.socket = null; // 业务步骤：推进当前流程的下一项处理
  } // 结束代码块：本层作用域收尾
} // 结束代码块：本层作用域收尾

// ---------------------------------------------------------------------------
// Redis 断连自动降级内存：连接类失败后本进程内回落到 MemoryCache，不抛断连给业务
// ---------------------------------------------------------------------------

/** 判断是否为连接类错误（断连 / 不可达 / 超时）；协议层错误（错误回复）不在此列，不应触发降级 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes('closed') ||
    message.includes('unavailable') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('eai_again') ||
    message.includes('enotfound') ||
    message.includes('etimedout') ||
    message.includes('socket hang up')
  );
}

/** Redis + 内存回退包装：首次连接类失败后全程走内存后端，保证业务在 Redis 抖动时不中断 */
class RedisFallbackCache implements CacheBackend {
  private primary: RedisCache;
  private fallback: MemoryCache;
  private degraded = false;

  constructor(rawUrl: string) {
    this.primary = new RedisCache(rawUrl);
    this.fallback = new MemoryCache();
  }

  get backend(): CacheBackendKind {
    return this.degraded ? 'memory' : 'redis';
  }

  private async withFallback<T>(op: (backend: CacheBackend) => Promise<T>): Promise<T> {
    if (this.degraded) return op(this.fallback);
    try {
      return await op(this.primary);
    } catch (err) {
      if (!isConnectionError(err)) throw err; // 协议层错误原样上抛，不误降级
      this.degraded = true;
      console.error(`[cache] redis unavailable, degrading to in-memory backend: ${err instanceof Error ? err.message : String(err)}`);
      return op(this.fallback);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.withFallback((c) => c.get(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    return this.withFallback((c) => c.set(key, value, ttlSeconds));
  }

  async incr(key: string): Promise<number> {
    return this.withFallback((c) => c.incr(key));
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    return this.withFallback((c) => c.expire(key, ttlSeconds));
  }

  async del(key: string): Promise<void> {
    return this.withFallback((c) => c.del(key));
  }

  async ping(): Promise<boolean> {
    return this.withFallback((c) => c.ping());
  }

  async close(): Promise<void> {
    try {
      await this.primary.close();
    } catch {
      // 关闭阶段忽略连接层错误
    }
    await this.fallback.close();
  }
}

// ---------------------------------------------------------------------------
// 工厂与进程级单例
// ---------------------------------------------------------------------------

/** 按环境变量构造缓存后端；未配置 MIM_REDIS_URL 时降级为内存实现 */
export function createCache(env: Record<string, string | undefined>): CacheBackend { // 定义函数 createCache：封装可复用业务步骤
  const redisUrl = env.MIM_REDIS_URL?.trim(); // 保存 redisUrl：承载本步骤的计算结果供后续使用
  if (redisUrl) return new RedisFallbackCache(redisUrl); // 条件分支：仅在满足业务前置条件时继续
  return new MemoryCache(); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

const sharedByEnv = new WeakMap<object, CacheBackend>(); // 保存 sharedByEnv：承载本步骤的计算结果供后续使用

/**
 * 取进程内共享缓存：同一 env 容器复用同一实例（Redis 单连接 / 内存单 Map）。
 * 测试可直接传替身 env 对象拿到隔离实例；生产由 app 装配时首次访问触发。
 */
export function getSharedCache(env: Record<string, string | undefined>): CacheBackend { // 定义函数 getSharedCache：封装可复用业务步骤
  let cache = sharedByEnv.get(env); // 保存 cache：承载本步骤的计算结果供后续使用
  if (!cache) { // 条件分支：仅在满足业务前置条件时继续
    cache = createCache(env); // 赋值：更新当前作用域中的状态
    console.log(`[cache] backend=${cache.backend}${cache.backend === 'redis' ? ` url=${env.MIM_REDIS_URL!.replace(/\/\/[^@]*@/, '//***@')}` : ' (in-memory, single replica only)'}`);
    sharedByEnv.set(env, cache); // 业务步骤：推进当前流程的下一项处理
  } // 结束条件分支：本层作用域收尾
  return cache; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾
