/** 安全加固包测试：cache.ts 适配层（Redis 协议解析 / 内存降级 / 共享单例） */

import { describe, expect, it } from 'vitest';
import { createCache, getSharedCache } from '../src/cache.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('cache 内存降级后端', () => {
  it('未配置 MIM_REDIS_URL 时自动降级为 memory，并支持 get/set/del', async () => {
    const cache = createCache({});
    expect(cache.backend).toBe('memory');
    await cache.set('k1', 'v1');
    expect(await cache.get('k1')).toBe('v1');
    await cache.del('k1');
    expect(await cache.get('k1')).toBeNull();
    await cache.close();
  });

  it('incr 从 0 自增，并发语义为顺序计数', async () => {
    const cache = createCache({});
    expect(await cache.incr('counter')).toBe(1);
    expect(await cache.incr('counter')).toBe(2);
    expect(await cache.get('counter')).toBe('2');
    await cache.close();
  });

  it('TTL 过期后 get 返回 null；expire 可续期', async () => {
    const cache = createCache({});
    await cache.set('ttl', 'x', 1); // 1 秒
    await cache.expire('ttl', 1);
    expect(await cache.get('ttl')).toBe('x');
    await sleep(1_100);
    expect(await cache.get('ttl')).toBeNull();
    await cache.close();
  });

  it('ping 在内存后端恒为 true', async () => {
    const cache = createCache({});
    expect(await cache.ping()).toBe(true);
    await cache.close();
  });
});

describe('cache 工厂与共享单例', () => {
  it('配置 MIM_REDIS_URL 时选择 redis 后端（不在构造期建连）', () => {
    const cache = createCache({ MIM_REDIS_URL: 'redis://127.0.0.1:6379/3' });
    expect(cache.backend).toBe('redis');
    void cache.close();
  });

  it('同一 env 容器复用同一共享实例，不同 env 互不影响', () => {
    const envA = {};
    const envB = {};
    const a1 = getSharedCache(envA);
    const a2 = getSharedCache(envA);
    const b1 = getSharedCache(envB);
    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);
    void a1.close();
    void b1.close();
  });
});
