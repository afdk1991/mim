/** 自研算法参数配置契约：默认值 / 优先级 / 夹取 / 后台读写端点 / 参数真实生效 */

import { describe, expect, it, beforeEach } from 'vitest'; // 测试框架
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库（自带社区种子）
import type { Db } from '../src/types.js'; // 连接类型
import { ALGORITHM_WEIGHTS_KEY, DEFAULT_ALGORITHM_WEIGHTS, loadAlgorithmWeights, mergeAlgorithmWeights, saveAlgorithmWeights } from '../src/algorithms/index.js'; // 被测配置层

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试用 JWT 密钥
const ADMIN_TOKEN = 'test-admin-token'; // 运营引导令牌，等同全权限
let app: Express; // 被测应用
let db: Db; // 内存库句柄
let env: Record<string, string>; // 环境变量：每个用例可注入权重覆盖

beforeEach(() => { // 每个用例独立建库
  db = createDatabase(':memory:'); // 新建内存库
  env = { MIM_ADMIN_TOKEN: ADMIN_TOKEN }; // 注入引导令牌
  app = createApp({ db, jwtSecret: JWT_SECRET, env }); // 组装应用
}); // 前置结束

/** 运营请求头：引导令牌 + JSON + 独立幂等键。 */
function adminHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json', 'idempotency-key': `algo-${Math.random().toString(36).slice(2)}` }; // 独立幂等键避免互相干扰
} // adminHeaders 结束

/** 插入受控帖子：标题 / 正文不同来源命中，便于验证字段权重。 */
function insertThread(id: string, title: string, body: string): void {
  const board = db.prepare('SELECT id FROM community_boards LIMIT 1').get() as { id: string }; // 任意种子板块
  const ts = '2026-11-18T00:00:00.000Z'; // 统一时间，排除时效干扰
  db.prepare( // 最小可用行
    `INSERT INTO community_threads
       (id, board_id, author_id, title, summary, body, kind, cover_url, price_cents, status, views, likes, reply_count, recommend_score, created_at, updated_at, last_activity_at)
     VALUES (?, ?, NULL, ?, '', ?, 'text', NULL, 0, 'published', 0, 0, 0, 0, ?, ?, ?)`,
  ).run(id, board.id, title, body, ts, ts, ts); // 绑定参数
} // insertThread 结束

describe('算法参数配置层', () => { // 用例组：纯函数
  it('默认值完整且与文档口径一致', () => { // 默认参数
    expect(DEFAULT_ALGORITHM_WEIGHTS.bm25).toEqual({ k1: 1.2, b: 0.75, title: 3, summary: 2, body: 1 }); // BM25 默认
    expect(DEFAULT_ALGORITHM_WEIGHTS.window.search).toBeGreaterThan(200); // 搜索窗口已突破原 200 条
    expect(loadAlgorithmWeights({}, db).source).toBe('default'); // 无配置时来源为 default
  }); // 用例结束

  it('site_settings 持久化优先于默认，环境变量又优先于持久化', () => { // 优先级
    saveAlgorithmWeights(db, { bm25: { title: 5 }, window: { search: 900 } }, '2026-11-19T00:00:00.000Z'); // 运营落库
    const fromSettings = loadAlgorithmWeights({}, db); // 只有持久化
    expect(fromSettings.source).toBe('settings'); // 来源 settings
    expect(fromSettings.weights.bm25.title).toBe(5); // 覆盖生效
    expect(fromSettings.weights.bm25.summary).toBe(2); // 未提交字段保持默认
    const fromEnv = loadAlgorithmWeights({ MIM_ALGORITHM_WEIGHTS: JSON.stringify({ window: { search: 300 } }) }, db); // 环境变量覆盖
    expect(fromEnv.source).toBe('env'); // 来源 env
    expect(fromEnv.weights.window.search).toBe(300); // 环境变量优先
    expect(fromEnv.weights.bm25.title).toBe(5); // 环境变量未提字段仍取持久化值
  }); // 用例结束

  it('非法值与越界值被夹取，脏 JSON 回落默认', () => { // 健壮性
    const merged = mergeAlgorithmWeights(DEFAULT_ALGORITHM_WEIGHTS, { bm25: { k1: 99, b: -1, body: 'x' }, window: { search: 1, trending: 99999 }, heat: { gravity: 0 } }); // 极端输入
    expect(merged.bm25.k1).toBe(3); // k1 上界
    expect(merged.bm25.b).toBe(0); // b 下界
    expect(merged.bm25.body).toBe(DEFAULT_ALGORITHM_WEIGHTS.bm25.body); // 非数字回落
    expect(merged.window.search).toBe(50); // 搜索窗口下界
    expect(merged.window.trending).toBe(5000); // 热榜窗口上界
    expect(merged.heat.gravity).toBe(0.5); // 重力下界
    db.prepare('INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)').run(ALGORITHM_WEIGHTS_KEY, '{bad json', '2026-11-19T00:00:00.000Z'); // 写脏 JSON
    expect(loadAlgorithmWeights({}, db).source).toBe('default'); // 脏数据视为未配置
  }); // 用例结束
}); // 用例组结束

describe('算法参数后台端点', () => { // 用例组：HTTP 契约
  it('匿名不可读、带运营令牌可读默认值', async () => { // 鉴权边界
    const anonymous = await request(app).get('/api/v1/community/algorithm-weights'); // 无凭证
    expect(anonymous.status).toBe(401); // 非白名单读必须登录
    const admin = await request(app).get('/api/v1/community/algorithm-weights').set('x-admin-token', ADMIN_TOKEN); // 运营令牌
    expect(admin.status).toBe(200); // 可读
    expect(admin.body.defaults.bm25.title).toBe(3); // 回显默认值
    expect(admin.body.source).toBe('default'); // 来源
  }); // 用例结束

  it('运营可局部写权重，写入即对搜索生效', async () => { // 写入 + 生效
    insertThread('cfg-title', '漫剧工作台', '无关正文'); // 标题命中
    insertThread('cfg-body', '随手记录', '漫剧工作台 漫剧工作台'); // 正文命中
    const baseline = await request(app).get('/api/v1/community/search').query({ q: '漫剧工作台', limit: 5 }); // 默认权重
    const baselineIds = (baseline.body.items as Array<{ id: string }>).map((item) => item.id); // 主键序
    expect(baselineIds.indexOf('cfg-title')).toBeLessThan(baselineIds.indexOf('cfg-body')); // 默认标题权重大
    const put = await request(app).put('/api/v1/community/algorithm-weights').set(adminHeaders()).send({ bm25: { title: 0, body: 6 }, window: { search: 4000 } }); // 压掉标题权重、放大正文
    expect(put.status).toBe(200); // 写入成功
    expect(put.body.weights.bm25.body).toBe(6); // 回显新值
    const after = await request(app).get('/api/v1/community/search').query({ q: '漫剧工作台', limit: 5 }); // 新权重
    const afterIds = (after.body.items as Array<{ id: string }>).map((item) => item.id); // 主键序
    expect(afterIds.indexOf('cfg-body')).toBeLessThan(afterIds.indexOf('cfg-title')); // 正文命中反超，证明参数真实生效
    expect(after.body.candidate_limit).toBe(4000); // 窗口参数同步生效
    expect(after.body.weights_source).toBe('settings'); // 来源回显
  }); // 用例结束

  it('相关性排序默认窗口已扩到 5000：超过 200 条后仍可继续深翻页', async () => { // 全窗口
    for (let i = 0; i < 220; i += 1) insertThread(`deep-${i}`, `漫剧合集 ${i}`, '正文提到漫剧'); // 造 220 条同词命中
    const first = await request(app).get('/api/v1/community/search').query({ q: '漫剧', limit: 10 }); // 首页
    expect(first.status).toBe(200); // 请求成功
    expect(first.body.candidate_limit).toBe(5000); // 默认窗口已突破旧 200 条
    expect(first.body.total).toBeGreaterThanOrEqual(220); // 全量命中数
    const deep = await request(app).get('/api/v1/community/search').query({ q: '漫剧', limit: 10, offset: 200 }); // 第 200 条之后
    expect(deep.status).toBe(200); // 请求成功
    expect(deep.body.items.length).toBe(10); // 旧 200 窗口下这里会是空数组，现在仍能取到
  }); // 用例结束

  it('窗口参数直接决定热榜样本与响应窗口', async () => { // 热榜窗口
    const put = await request(app).put('/api/v1/community/algorithm-weights').set(adminHeaders()).send({ window: { trending: 300 } }); // 改写窗口
    expect(put.status).toBe(200); // 写入成功
    const res = await request(app).get('/api/v1/community/trending').query({ limit: 5 }); // 读热榜
    expect(res.status).toBe(200); // 匿名可读
    expect(res.body.window).toBe(300); // 响应回显配置窗口
    expect(Array.isArray(res.body.items)).toBe(true); // 结构稳定
  }); // 用例结束
}); // 用例组结束

