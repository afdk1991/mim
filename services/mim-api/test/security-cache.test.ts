/** 安全加固包测试：cache.ts 适配层（Redis 协议解析 / 内存降级 / 共享单例） */

import { describe, expect, it } from 'vitest';
import { createServer, type AddressInfo } from 'node:net';
import { createCache, getSharedCache } from '../src/cache.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)); // 构造：准备本用例需要的输入、句柄或期望值

describe('cache 内存降级后端', () => {
  it('未配置 MIM_REDIS_URL 时自动降级为 memory，并支持 get/set/del', async () => {
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(cache.backend).toBe('memory'); // 断言：校验响应字段与冻结契约一致
    await cache.set('k1', 'v1'); // 执行：等待接口或数据库操作返回
    expect(await cache.get('k1')).toBe('v1'); // 断言：校验响应字段与冻结契约一致
    await cache.del('k1'); // 执行：等待接口或数据库操作返回
    expect(await cache.get('k1')).toBeNull(); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  });

  it('incr 从 0 自增，并发语义为顺序计数', async () => {
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(await cache.incr('counter')).toBe(1); // 断言：校验响应字段与冻结契约一致
    expect(await cache.incr('counter')).toBe(2); // 断言：校验响应字段与冻结契约一致
    expect(await cache.get('counter')).toBe('2'); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  });

  it('TTL 过期后 get 返回 null；expire 可续期', async () => {
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    await cache.set('ttl', 'x', 1); // 1 秒
    await cache.expire('ttl', 1); // 执行：等待接口或数据库操作返回
    expect(await cache.get('ttl')).toBe('x'); // 断言：校验响应字段与冻结契约一致
    await sleep(1_100); // 执行：等待接口或数据库操作返回
    expect(await cache.get('ttl')).toBeNull(); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  });

  it('ping 在内存后端恒为 true', async () => {
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(await cache.ping()).toBe(true); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  });
});

describe('cache 工厂与共享单例', () => {
  it('配置 MIM_REDIS_URL 时选择 redis 后端（不在构造期建连）', () => {
    const cache = createCache({ MIM_REDIS_URL: 'redis://127.0.0.1:6379/3' });
    expect(cache.backend).toBe('redis'); // 断言：校验响应字段与冻结契约一致
    void cache.close();
  });

  it('同一 env 容器复用同一共享实例，不同 env 互不影响', () => {
    const envA = {}; // 构造：准备本用例需要的输入、句柄或期望值
    const envB = {}; // 构造：准备本用例需要的输入、句柄或期望值
    const a1 = getSharedCache(envA); // 构造：准备本用例需要的输入、句柄或期望值
    const a2 = getSharedCache(envA); // 构造：准备本用例需要的输入、句柄或期望值
    const b1 = getSharedCache(envB); // 构造：准备本用例需要的输入、句柄或期望值
    expect(a1).toBe(a2); // 断言：校验响应字段与冻结契约一致
    expect(b1).not.toBe(a1); // 断言：校验响应字段与冻结契约一致
    void a1.close();
    void b1.close();
  });
});

/** 最小 RESP 假服务器：在测试内自建，记录收到的命令报文并按标准协议回复 */
function startFakeRedis(): Promise<{ server: ReturnType<typeof createServer>; commands: string[][]; port: number }> {
  const commands: string[][] = []; // 收到的命令（参数数组），供报文断言
  const store = new Map<string, string>(); // 假键值库

  function respond(args: string[]): string {
    const cmd = (args[0] ?? '').toUpperCase();
    switch (cmd) {
      case 'AUTH':
      case 'SELECT':
        return '+OK\r\n';
      case 'PING':
        return '+PONG\r\n';
      case 'SET':
        store.set(args[1]!, args[2]!);
        return '+OK\r\n';
      case 'GET': {
        const v = store.get(args[1]!);
        return v === undefined ? '$-1\r\n' : `$${Buffer.byteLength(v)}\r\n${v}\r\n`;
      }
      case 'INCR': {
        const n = (Number(store.get(args[1]!) ?? '0') || 0) + 1;
        store.set(args[1]!, String(n));
        return `:${n}\r\n`;
      }
      case 'EXPIRE':
      case 'DEL':
        return ':1\r\n';
      default:
        return '+OK\r\n';
    }
  }

  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const lineEnd = buf.indexOf('\r\n');
        if (lineEnd === -1) break;
        const header = buf.slice(0, lineEnd).toString('utf8');
        if (!header.startsWith('*')) break;
        const count = Number(header.slice(1));
        let cursor = lineEnd + 2;
        const args: string[] = [];
        let complete = true;
        for (let i = 0; i < count; i += 1) {
          const lenEnd = buf.indexOf('\r\n', cursor);
          if (lenEnd === -1) { complete = false; break; }
          const len = Number(buf.slice(cursor + 1, lenEnd).toString('utf8'));
          const bodyStart = lenEnd + 2;
          if (buf.length < bodyStart + len + 2) { complete = false; break; }
          args.push(buf.slice(bodyStart, bodyStart + len).toString('utf8'));
          cursor = bodyStart + len + 2;
        }
        if (!complete) break;
        buf = buf.slice(cursor);
        commands.push(args);
        socket.write(respond(args));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, commands, port: (server.address() as AddressInfo).port });
    });
  });
}

describe('cache Redis 协议与断连降级（假服务器）', () => {
  it('AUTH/SELECT/SET/GET/INCR/EXPIRE/DEL/PING 报文符合 RESP 协议', async () => {
    const fake = await startFakeRedis();
    const cache = createCache({ MIM_REDIS_URL: 'redis://:s3cret@127.0.0.1:%d/3'.replace('%d', String(fake.port)) });

    await cache.set('k1', 'v1', 60);
    expect(await cache.get('k1')).toBe('v1');
    expect(await cache.incr('counter')).toBe(1);
    await cache.expire('counter', 60);
    await cache.del('k1');
    expect(await cache.ping()).toBe(true);
    await cache.close();

    const flat = fake.commands.map((c) => c.join(' '));
    expect(flat).toContain('AUTH s3cret');
    expect(flat).toContain('SELECT 3');
    expect(flat).toContain('SET k1 v1 EX 60');
    expect(flat).toContain('GET k1');
    expect(flat).toContain('INCR counter');
    expect(flat).toContain('EXPIRE counter 60');
    expect(flat).toContain('DEL k1');
    expect(flat).toContain('PING');
    await new Promise((r) => fake.server.close(r));
  });

  it('Redis 中途断连后自动降级内存后端，业务读写不中断', async () => {
    const fake = await startFakeRedis();
    const cache = createCache({ MIM_REDIS_URL: `redis://127.0.0.1:${fake.port}/0` });

    await cache.set('a', '1');
    expect(await cache.get('a')).toBe('1');

    await new Promise((r) => fake.server.close(r)); // 中途断连
    await new Promise((r) => setTimeout(r, 50)); // 等待 close 事件排空

    await cache.set('b', '2'); // 不应抛错：回落内存后端
    expect(await cache.get('b')).toBe('2');
    expect(cache.backend).toBe('memory'); // 后端身份翻转为内存
    await cache.close();
  });
});
