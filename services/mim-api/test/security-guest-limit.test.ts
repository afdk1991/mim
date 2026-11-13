/** 安全加固包测试：访客频控迁出进程内 Map，走共享缓存后端（多实例计数一致） */

import { beforeEach, describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // 引入依赖、类型或本地模块绑定
import type { Express } from 'express'; // 引入依赖、类型或本地模块绑定
import { createApp } from '../src/app.js'; // 引入依赖、类型或本地模块绑定
import { createDatabase } from '../src/db.js'; // 引入依赖、类型或本地模块绑定
import { cacheOf } from '../src/security.js'; // 引入依赖、类型或本地模块绑定
import type { Db } from '../src/types.js'; // 引入依赖、类型或本地模块绑定

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥

let db: Db; // 可变变量 db：运行过程中会被重新赋值
let env: Record<string, string | undefined>; // 可变变量 env：运行过程中会被重新赋值

beforeEach(() => { // 调用 beforeEach 并处理其返回结果
  db = createDatabase(':memory:'); // 赋值：更新变量 db 的取值
  env = {}; // 同一 env 容器 → getSharedCache 复用同一后端实例（模拟多实例共享同一 Redis/内存后端）
}); // 代码块结束

describe('访客频控共享后端', () => { // 调用 describe 并处理其返回结果
  it('同一 env 取到的缓存实例为单例，计数跨实例一致', async () => { // 调用 it 并处理其返回结果
    const first = cacheOf(env); // 常量 first：保存固定配置或一次性派生值
    const second = cacheOf(env); // 常量 second：保存固定配置或一次性派生值
    expect(first).toBe(second); // 单例：同一后端
    await first.incr('guest:127.0.0.1'); // 异步等待：挂起至 Promise 落定后再继续
    await first.incr('guest:127.0.0.1'); // 异步等待：挂起至 Promise 落定后再继续
    expect(await second.get('guest:127.0.0.1')).toBe('2'); // 第二个实例读到同一计数
    await first.close(); // 异步等待：挂起至 Promise 落定后再继续
  }); // 代码块结束

  it('两个应用实例共享同一后端：第二个实例不会按本地内存重置计数', async () => { // 调用 it 并处理其返回结果
    const app1: Express = createApp({ db, jwtSecret: JWT_SECRET, env }); // 常量 app1：保存固定配置或一次性派生值
    const app2: Express = createApp({ db, jwtSecret: JWT_SECRET, env }); // 同 env：与 app1 共享缓存后端

    const first = await request(app1).post('/api/v1/auth/guest').send({ region: 'cn' }); // 常量 first：保存固定配置或一次性派生值
    expect(first.status).toBe(200); // 调用 expect 并处理其返回结果
    const second = await request(app2).post('/api/v1/auth/guest').send({ region: 'cn' }); // 常量 second：保存固定配置或一次性派生值
    expect(second.status).toBe(200); // 共享后端下计数累加，未触发本地窗口重置
    expect(cacheOf(env)).toBe(cacheOf(env)); // 两实例取到同一后端单例
  }); // 代码块结束
}); // 代码块结束
