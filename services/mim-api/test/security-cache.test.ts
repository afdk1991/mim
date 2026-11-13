/** 安全加固包测试：cache.ts 适配层（Redis 协议解析 / 内存降级 / 共享单例） */

import { describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import { createServer, type AddressInfo } from 'node:net'; // 引入依赖、类型或本地模块绑定
import { createCache, getSharedCache } from '../src/cache.js'; // 引入依赖、类型或本地模块绑定

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)); // 构造：准备本用例需要的输入、句柄或期望值

describe('cache 内存降级后端', () => { // 调用 describe 并处理其返回结果
  it('未配置 MIM_REDIS_URL 时自动降级为 memory，并支持 get/set/del', async () => { // 调用 it 并处理其返回结果
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(cache.backend).toBe('memory'); // 断言：校验响应字段与冻结契约一致
    await cache.set('k1', 'v1'); // 执行：等待接口或数据库操作返回
    expect(await cache.get('k1')).toBe('v1'); // 断言：校验响应字段与冻结契约一致
    await cache.del('k1'); // 执行：等待接口或数据库操作返回
    expect(await cache.get('k1')).toBeNull(); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  }); // 代码块结束

  it('incr 从 0 自增，并发语义为顺序计数', async () => { // 调用 it 并处理其返回结果
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(await cache.incr('counter')).toBe(1); // 断言：校验响应字段与冻结契约一致
    expect(await cache.incr('counter')).toBe(2); // 断言：校验响应字段与冻结契约一致
    expect(await cache.get('counter')).toBe('2'); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  }); // 代码块结束

  it('TTL 过期后 get 返回 null；expire 可续期', async () => { // 调用 it 并处理其返回结果
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    await cache.set('ttl', 'x', 1); // 1 秒
    await cache.expire('ttl', 1); // 执行：等待接口或数据库操作返回
    expect(await cache.get('ttl')).toBe('x'); // 断言：校验响应字段与冻结契约一致
    await sleep(1_100); // 执行：等待接口或数据库操作返回
    expect(await cache.get('ttl')).toBeNull(); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  }); // 代码块结束

  it('ping 在内存后端恒为 true', async () => { // 调用 it 并处理其返回结果
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(await cache.ping()).toBe(true); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  }); // 代码块结束
}); // 代码块结束

describe('cache 工厂与共享单例', () => { // 调用 describe 并处理其返回结果
  it('配置 MIM_REDIS_URL 时选择 redis 后端（不在构造期建连）', () => { // 调用 it 并处理其返回结果
    const cache = createCache({ MIM_REDIS_URL: 'redis://127.0.0.1:6379/3' }); // 常量 cache：保存固定配置或一次性派生值
    expect(cache.backend).toBe('redis'); // 断言：校验响应字段与冻结契约一致
    void cache.close(); // 执行当前业务步骤
  }); // 代码块结束

  it('同一 env 容器复用同一共享实例，不同 env 互不影响', () => { // 调用 it 并处理其返回结果
    const envA = {}; // 构造：准备本用例需要的输入、句柄或期望值
    const envB = {}; // 构造：准备本用例需要的输入、句柄或期望值
    const a1 = getSharedCache(envA); // 构造：准备本用例需要的输入、句柄或期望值
    const a2 = getSharedCache(envA); // 构造：准备本用例需要的输入、句柄或期望值
    const b1 = getSharedCache(envB); // 构造：准备本用例需要的输入、句柄或期望值
    expect(a1).toBe(a2); // 断言：校验响应字段与冻结契约一致
    expect(b1).not.toBe(a1); // 断言：校验响应字段与冻结契约一致
    void a1.close(); // 执行当前业务步骤
    void b1.close(); // 执行当前业务步骤
  }); // 代码块结束
}); // 代码块结束

/** 最小 RESP 假服务器：在测试内自建，记录收到的命令报文并按标准协议回复 */
function startFakeRedis(): Promise<{ server: ReturnType<typeof createServer>; commands: string[][]; port: number }> {
  const commands: string[][] = []; // 收到的命令（参数数组），供报文断言
  const store = new Map<string, string>(); // 假键值库

  function respond(args: string[]): string { // 函数 respond：封装一段可复用的处理逻辑
    const cmd = (args[0] ?? '').toUpperCase(); // 常量 cmd：保存固定配置或一次性派生值
    switch (cmd) { // 执行当前业务步骤
      case 'AUTH': // switch 分支取值：命中后执行对应处理
      case 'SELECT': // switch 分支取值：命中后执行对应处理
        return '+OK\r\n'; // 返回当前函数的处理结果
      case 'PING': // switch 分支取值：命中后执行对应处理
        return '+PONG\r\n'; // 返回当前函数的处理结果
      case 'SET': // switch 分支取值：命中后执行对应处理
        store.set(args[1]!, args[2]!); // 执行当前业务步骤
        return '+OK\r\n'; // 返回当前函数的处理结果
      case 'GET': { // switch 分支取值：命中后执行对应处理
        const v = store.get(args[1]!); // 常量 v：保存固定配置或一次性派生值
        return v === undefined ? '$-1\r\n' : `$${Buffer.byteLength(v)}\r\n${v}\r\n`; // 返回当前函数的处理结果
      } // 代码块结束
      case 'INCR': { // switch 分支取值：命中后执行对应处理
        const n = (Number(store.get(args[1]!) ?? '0') || 0) + 1; // 常量 n：保存固定配置或一次性派生值
        store.set(args[1]!, String(n)); // 执行当前业务步骤
        return `:${n}\r\n`; // 返回当前函数的处理结果
      } // 代码块结束
      case 'EXPIRE': // switch 分支取值：命中后执行对应处理
      case 'DEL': // switch 分支取值：命中后执行对应处理
        return ':1\r\n'; // 返回当前函数的处理结果
      default: // 对象字段 default：记录一项配置或数据
        return '+OK\r\n'; // 返回当前函数的处理结果
    } // 代码块结束
  } // 代码块结束

  const server = createServer((socket) => { // 常量 server：保存固定配置或一次性派生值
    let buf = Buffer.alloc(0); // 可变变量 buf：运行过程中会被重新赋值
    socket.on('data', (chunk) => { // 执行当前业务步骤
      buf = Buffer.concat([buf, chunk]); // 赋值：更新变量 buf 的取值
      for (;;) { // 循环：逐项遍历集合并执行相同处理
        const lineEnd = buf.indexOf('\r\n'); // 常量 lineEnd：保存固定配置或一次性派生值
        if (lineEnd === -1) break; // 条件分支：按判断结果选择后续处理路径
        const header = buf.slice(0, lineEnd).toString('utf8'); // 常量 header：保存固定配置或一次性派生值
        if (!header.startsWith('*')) break; // 条件分支：按判断结果选择后续处理路径
        const count = Number(header.slice(1)); // 常量 count：保存固定配置或一次性派生值
        let cursor = lineEnd + 2; // 可变变量 cursor：运行过程中会被重新赋值
        const args: string[] = []; // 常量 args：保存固定配置或一次性派生值
        let complete = true; // 可变变量 complete：运行过程中会被重新赋值
        for (let i = 0; i < count; i += 1) { // 循环：逐项遍历集合并执行相同处理
          const lenEnd = buf.indexOf('\r\n', cursor); // 常量 lenEnd：保存固定配置或一次性派生值
          if (lenEnd === -1) { complete = false; break; } // 条件分支：按判断结果选择后续处理路径
          const len = Number(buf.slice(cursor + 1, lenEnd).toString('utf8')); // 常量 len：保存固定配置或一次性派生值
          const bodyStart = lenEnd + 2; // 常量 bodyStart：保存固定配置或一次性派生值
          if (buf.length < bodyStart + len + 2) { complete = false; break; } // 条件分支：按判断结果选择后续处理路径
          args.push(buf.slice(bodyStart, bodyStart + len).toString('utf8')); // 执行当前业务步骤
          cursor = bodyStart + len + 2; // 赋值：更新变量 cursor 的取值
        } // 代码块结束
        if (!complete) break; // 条件分支：按判断结果选择后续处理路径
        buf = buf.slice(cursor); // 赋值：更新变量 buf 的取值
        commands.push(args); // 执行当前业务步骤
        socket.write(respond(args)); // 执行当前业务步骤
      } // 代码块结束
    }); // 代码块结束
  }); // 代码块结束

  return new Promise((resolve) => { // 返回当前函数的处理结果
    server.listen(0, '127.0.0.1', () => { // 执行当前业务步骤
      resolve({ server, commands, port: (server.address() as AddressInfo).port }); // 调用 resolve 并处理其返回结果
    }); // 代码块结束
  }); // 代码块结束
} // 代码块结束

describe('cache Redis 协议与断连降级（假服务器）', () => { // 调用 describe 并处理其返回结果
  it('AUTH/SELECT/SET/GET/INCR/EXPIRE/DEL/PING 报文符合 RESP 协议', async () => { // 调用 it 并处理其返回结果
    const fake = await startFakeRedis(); // 常量 fake：保存固定配置或一次性派生值
    const cache = createCache({ MIM_REDIS_URL: 'redis://:s3cret@127.0.0.1:%d/3'.replace('%d', String(fake.port)) }); // 常量 cache：保存固定配置或一次性派生值

    await cache.set('k1', 'v1', 60); // 异步等待：挂起至 Promise 落定后再继续
    expect(await cache.get('k1')).toBe('v1'); // 调用 expect 并处理其返回结果
    expect(await cache.incr('counter')).toBe(1); // 调用 expect 并处理其返回结果
    await cache.expire('counter', 60); // 异步等待：挂起至 Promise 落定后再继续
    await cache.del('k1'); // 异步等待：挂起至 Promise 落定后再继续
    expect(await cache.ping()).toBe(true); // 调用 expect 并处理其返回结果
    await cache.close(); // 异步等待：挂起至 Promise 落定后再继续

    const flat = fake.commands.map((c) => c.join(' ')); // 常量 flat：保存固定配置或一次性派生值
    expect(flat).toContain('AUTH s3cret'); // 调用 expect 并处理其返回结果
    expect(flat).toContain('SELECT 3'); // 调用 expect 并处理其返回结果
    expect(flat).toContain('SET k1 v1 EX 60'); // 调用 expect 并处理其返回结果
    expect(flat).toContain('GET k1'); // 调用 expect 并处理其返回结果
    expect(flat).toContain('INCR counter'); // 调用 expect 并处理其返回结果
    expect(flat).toContain('EXPIRE counter 60'); // 调用 expect 并处理其返回结果
    expect(flat).toContain('DEL k1'); // 调用 expect 并处理其返回结果
    expect(flat).toContain('PING'); // 调用 expect 并处理其返回结果
    await new Promise((r) => fake.server.close(r)); // 异步等待：挂起至 Promise 落定后再继续
  }); // 代码块结束

  it('Redis 中途断连后自动降级内存后端，业务读写不中断', async () => { // 调用 it 并处理其返回结果
    const fake = await startFakeRedis(); // 常量 fake：保存固定配置或一次性派生值
    const cache = createCache({ MIM_REDIS_URL: `redis://127.0.0.1:${fake.port}/0` }); // 常量 cache：保存固定配置或一次性派生值

    await cache.set('a', '1'); // 异步等待：挂起至 Promise 落定后再继续
    expect(await cache.get('a')).toBe('1'); // 调用 expect 并处理其返回结果

    await new Promise((r) => fake.server.close(r)); // 中途断连
    await new Promise((r) => setTimeout(r, 50)); // 等待 close 事件排空

    await cache.set('b', '2'); // 不应抛错：回落内存后端
    expect(await cache.get('b')).toBe('2'); // 调用 expect 并处理其返回结果
    expect(cache.backend).toBe('memory'); // 后端身份翻转为内存
    await cache.close(); // 异步等待：挂起至 Promise 落定后再继续
  }); // 代码块结束
}); // 代码块结束
