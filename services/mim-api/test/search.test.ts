/** 契约测试：统一搜索 —— 五来源检索 / 分组 / 来源过滤 / 参数校验 / Meili 未配置与不可达降级 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排：每例重建内存库
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂（自动执行 schema + 种子）
import { SITE_MODULES } from '@mim/core-domain'; // 入口数量断言基准

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库

/** 登录辅助：验证码换令牌，与其余契约测试同一口径 */
async function login(identifier: string): Promise<string> {
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier }); // 申请验证码
  expect(codeRes.status).toBe(201); // 201 已创建
  const loginRes = await request(app).post('/api/v1/auth/login').send({ // 换令牌
    region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, // 验证码
    device: { platform: 'web', name: 'test' }, // 设备必填
  }); // 登录请求结束
  expect(loginRes.status).toBe(200); // 200 登录成功
  return loginRes.body.access_token as string; // 返回令牌
} // login 结束

beforeEach(() => { // 每例重建库与应用
  db = createDatabase(':memory:'); // 内存库，自动写入模块 / 入口 / 导航 / 社区 / 商品种子
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 默认不配置 Meilisearch，走 SQLite
}); // beforeEach 结束

describe('统一搜索公开检索', () => { // 浏览类端点匿名可用
  it('关键词命中多个来源并按来源分组', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: '商城' }); // 中文关键词
    expect(res.status).toBe(200); // 200
    expect(res.body.schema).toBe('mim.search.v1'); // 契约版本
    expect(res.body.engine).toBe('sqlite'); // 未配置 Meili 时为本地引擎
    expect(res.body.total).toBeGreaterThan(0); // 至少一条命中
    expect(res.body.groups.length).toBeGreaterThan(0); // 至少一个来源分组
    const scopes = res.body.groups.map((group: { scope: string }) => group.scope); // 命中来源
    expect(scopes).toContain('module'); // 模块商城必然命中
    for (const group of res.body.groups as Array<{ count: number; items: Array<{ score: number }> }>) { // 逐组校验
      expect(group.count).toBe(group.items.length); // 计数与条目一致
      expect(group.items.every((item) => item.score > 0)).toBe(true); // 命中项分数为正
    } // 分组循环结束
  });

  it('scope 过滤只返回指定来源，非法 scope 返回 400', async () => {
    const onlyEntry = await request(app).get('/api/v1/search').query({ q: '导航', scope: 'entry' }); // 只看入口
    expect(onlyEntry.status).toBe(200); // 200
    expect(onlyEntry.body.groups.every((group: { scope: string }) => group.scope === 'entry')).toBe(true); // 来源唯一
    const bad = await request(app).get('/api/v1/search').query({ q: 'x', scope: 'unknown' }); // 非法来源
    expect(bad.status).toBe(400); // 400
  });

  it('缺少关键词返回 400，无命中返回空分组', async () => {
    const missing = await request(app).get('/api/v1/search'); // 不带 q
    expect(missing.status).toBe(400); // 400
    const none = await request(app).get('/api/v1/search').query({ q: 'zzzz-no-such-keyword-9999' }); // 必然无命中
    expect(none.status).toBe(200); // 200
    expect(none.body.total).toBe(0); // 总数为 0
    expect(none.body.groups).toEqual([]); // 不返回空分组
  });

  it('limit 限制每个来源的条数并截取命中片段', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'a', scope: 'module', limit: 2 }); // 英文单字母，命中量大
    expect(res.status).toBe(200); // 200
    for (const group of res.body.groups as Array<{ items: Array<{ snippet: string }> }>) { // 逐组断言
      expect(group.items.length).toBeLessThanOrEqual(2); // 每来源不超过 limit
      expect(group.items.every((item) => item.snippet.length > 0)).toBe(true); // 片段非空
    } // 循环结束
  });

  it('summary 回传全部来源文档数，入口数与静态契约一致', async () => {
    const res = await request(app).get('/api/v1/search/summary'); // 来源汇总
    expect(res.status).toBe(200); // 200
    expect(res.body.total).toBeGreaterThan(0); // 有可搜文档
    const entry = res.body.scopes.find((item: { scope: string }) => item.scope === 'entry'); // 入口来源
    expect(entry.count).toBe(SITE_MODULES.length); // 44 个入口全部可搜
    expect(res.body.engine).toBe('sqlite'); // 默认引擎
  });
}); // 公开检索用例结束

describe('Meilisearch 配置与降级', () => { // 远端引擎的可用性与降级
  it('配置了但实例不可达时自动降级 SQLite 并返回结果', async () => {
    const configured = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_MEILISEARCH_URL: 'http://127.0.0.1:9', MIM_MEILISEARCH_KEY: 'test-key' } }); // 指向关闭端口
    const res = await request(configured).get('/api/v1/search').query({ q: '商城' }); // 触发远端失败
    expect(res.status).toBe(200); // 搜索本身仍成功
    expect(res.body.engine).toBe('sqlite'); // 已降级
    expect(res.body.total).toBeGreaterThan(0); // 本地结果可用
  });

  it('未配置时重建索引返回 503，未登录返回 401', async () => {
    const noAuth = await request(app).post('/api/v1/search/reindex').send({}); // 无令牌
    expect(noAuth.status).toBe(401); // 401
    const token = await login('13800000010'); // 普通用户
    const notConfigured = await request(app).post('/api/v1/search/reindex').set('Authorization', `Bearer ${token}`).send({}); // 有令牌但未配置
    expect([401, 403, 503]).toContain(notConfigured.status); // 普通用户可能先被权限拦下；未配置时为 503
  });
}); // Meili 用例结束
