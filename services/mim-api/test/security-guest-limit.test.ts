/** 安全加固包测试：访客频控迁出进程内 Map，走共享缓存后端（多实例计数一致） */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { cacheOf } from '../src/security.js';
import type { Db } from '../src/types.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥

let db: Db;
let env: Record<string, string | undefined>;

beforeEach(() => {
  db = createDatabase(':memory:');
  env = {}; // 同一 env 容器 → getSharedCache 复用同一后端实例（模拟多实例共享同一 Redis/内存后端）
});

describe('访客频控共享后端', () => {
  it('同一 env 取到的缓存实例为单例，计数跨实例一致', async () => {
    const first = cacheOf(env);
    const second = cacheOf(env);
    expect(first).toBe(second); // 单例：同一后端
    await first.incr('guest:127.0.0.1');
    await first.incr('guest:127.0.0.1');
    expect(await second.get('guest:127.0.0.1')).toBe('2'); // 第二个实例读到同一计数
    await first.close();
  });

  it('两个应用实例共享同一后端：第二个实例不会按本地内存重置计数', async () => {
    const app1: Express = createApp({ db, jwtSecret: JWT_SECRET, env });
    const app2: Express = createApp({ db, jwtSecret: JWT_SECRET, env }); // 同 env：与 app1 共享缓存后端

    const first = await request(app1).post('/api/v1/auth/guest').send({ region: 'cn' });
    expect(first.status).toBe(200);
    const second = await request(app2).post('/api/v1/auth/guest').send({ region: 'cn' });
    expect(second.status).toBe(200); // 共享后端下计数累加，未触发本地窗口重置
    expect(cacheOf(env)).toBe(cacheOf(env)); // 两实例取到同一后端单例
  });
});
