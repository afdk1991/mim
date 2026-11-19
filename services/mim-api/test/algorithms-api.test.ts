/** 自研算法接口契约测试：/community/search 相关性排序 与 /community/trending 热度榜 */

import { describe, expect, it, beforeEach } from 'vitest'; // 测试框架：断言与用例组织
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库（自带社区种子）
import type { Db } from '../src/types.js'; // 连接类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试用 JWT 密钥
let app: Express; // 被测应用
let db: Db; // 内存库句柄，供用例插入受控帖子

beforeEach(() => { // 每个用例独立建库，互不污染
  db = createDatabase(':memory:'); // 新建内存库并写入种子
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 组装应用
}); // 用例前置结束

/** 插入一条受控帖子：标题 / 正文 / 互动量可指定，便于断言排序。 */
function insertThread(id: string, title: string, body: string, metrics: { likes?: number; replies?: number; views?: number; createdAt?: string }): void {
  const board = db.prepare('SELECT id FROM community_boards LIMIT 1').get() as { id: string }; // 取任意种子板块
  const createdAt = metrics.createdAt ?? new Date().toISOString(); // 默认刚发布
  db.prepare( // 写入最小可用帖子行
    `INSERT INTO community_threads
       (id, board_id, author_id, title, summary, body, kind, cover_url, price_cents, status, views, likes, reply_count, recommend_score, created_at, updated_at, last_activity_at)
     VALUES (?, ?, NULL, ?, '', ?, 'text', NULL, 0, 'published', ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, board.id, title, body, metrics.views ?? 0, metrics.likes ?? 0, metrics.replies ?? 0, createdAt, createdAt, createdAt); // 绑定参数
} // insertThread 结束

describe('社区搜索相关性排序', () => { // 用例组：搜索
  it('标题强命中排在正文弱命中之前，并回显 relevance', async () => { // 相关性排序
    insertThread('t-title', '漫剧工作台上线公告', '这是一段与关键词无关的正文', { createdAt: '2026-11-18T00:00:00.000Z' }); // 标题命中
    insertThread('t-body', '随手记录', '正文里只提到一次漫剧工作台', { createdAt: '2026-11-18T00:00:00.000Z' }); // 正文命中，同龄对照
    const res = await request(app).get('/api/v1/community/search').query({ q: '漫剧工作台', limit: 5 }); // 默认走相关性排序
    expect(res.status).toBe(200); // 只读端点匿名可读
    const ids = (res.body.items as Array<{ id: string }>).map((item) => item.id); // 结果主键序列
    expect(ids).toContain('t-title'); // 标题命中必须出现
    expect(ids.findIndex((id) => id === 't-title')).toBeLessThan(ids.findIndex((id) => id === 't-body')); // 同龄下标题权重更高，排在正文命中前
    const titleItem = (res.body.items as Array<{ id: string; relevance: number }>).find((item) => item.id === 't-title'); // 取标题命中项
    expect(titleItem?.relevance).toBeGreaterThan(0); // 相关性分应大于 0
    expect(res.body.sort).toBe('relevance'); // 默认排序口径
  }); // 用例结束

  it('sort=latest 回到时间口径且 relevance 为 0', async () => { // 旧口径逃生口
    insertThread('t-old', '漫剧旧帖', '正文', { createdAt: '2026-11-01T00:00:00.000Z' }); // 较旧
    insertThread('t-new', '漫剧新帖', '正文', { createdAt: '2026-11-18T00:00:00.000Z' }); // 较新
    const res = await request(app).get('/api/v1/community/search').query({ q: '漫剧', sort: 'latest' }); // 显式时间排序
    expect(res.status).toBe(200); // 请求成功
    const items = res.body.items as Array<{ id: string; relevance: number }>; // 结果集
    expect(items.findIndex((item) => item.id === 't-new')).toBeLessThan(items.findIndex((item) => item.id === 't-old')); // 新帖相对旧帖在前（种子帖可能更靠前）
    expect(items.every((item) => item.relevance === 0)).toBe(true); // 时间口径不算相关性
  }); // 用例结束

  it('diversify=1 时仍可返回且不报错', async () => { // 多样性开关
    insertThread('d-1', '漫剧合集一', '正文', { createdAt: '2026-11-18T00:00:00.000Z' }); // 同话题
    insertThread('d-2', '漫剧合集二', '正文', { createdAt: '2026-11-17T00:00:00.000Z' }); // 同话题
    const res = await request(app).get('/api/v1/community/search').query({ q: '漫剧', diversify: 1 }); // 开启去同质
    expect(res.status).toBe(200); // 请求成功
    expect(res.body.diversify).toBe(true); // 响应回显开关
    expect(res.body.items.length).toBeGreaterThan(0); // 仍有结果
  }); // 用例结束
}); // 用例组结束

describe('社区热榜', () => { // 用例组：热度
  it('高互动更新帖排在前面，heat 回显可对账', async () => { // 热度排序
    insertThread('h-hot', '热帖', '正文', { likes: 30, replies: 10, views: 1000 }); // 刚发布且互动高
    insertThread('h-cold', '冷帖', '正文', { likes: 1, replies: 0, views: 10, createdAt: '2026-10-01T00:00:00.000Z' }); // 旧且互动低
    const res = await request(app).get('/api/v1/community/trending').query({ limit: 5 }); // 取前 5
    expect(res.status).toBe(200); // 只读端点匿名可读
    expect(res.body.algorithm).toBe('heat-v1'); // 算法版本可追溯
    const items = res.body.items as Array<{ id: string; heat: number }>; // 结果集
    expect(items.length).toBeLessThanOrEqual(5); // 遵守 limit
    expect(items.some((item) => item.id === 'h-hot')).toBe(true); // 热帖必在榜内
    for (let i = 1; i < items.length; i += 1) expect(items[i - 1].heat).toBeGreaterThanOrEqual(items[i].heat); // 热度单调不增
  }); // 用例结束

  it('limit 越界被夹到 1～50', async () => { // 参数边界
    const res = await request(app).get('/api/v1/community/trending').query({ limit: 999 }); // 超大 limit
    expect(res.status).toBe(200); // 请求成功
    expect(res.body.limit).toBe(50); // 上限夹取
  }); // 用例结束
}); // 用例组结束
