/** 契约测试：导航站（NAVIGATION）——目录 / 汇总 / 收录 / 修改 / 单条探测 / 全目录探测 / 鉴权与校验 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'; // vitest 编排：每例重建内存库，本文件再起一个真实本地 HTTP 服务供探测
import request from 'supertest'; // 进程内驱动 Express
import { createServer } from 'node:http'; // 本地探测目标：真实 200 响应
import type { AddressInfo } from 'node:net'; // 取监听端口
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase, seedNavLinks } from '../src/db.js'; // 内存库工厂 + 导航种子
import { NAV_LINK_SEEDS } from '@mim/core-domain'; // 种子清单作为断言基准

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库
let server: ReturnType<typeof createServer>; // 本地探测目标
let origin: string; // 本地目标 origin，同时作为 MIM_PUBLIC_ORIGIN

// 登录辅助：验证码换令牌，与其余契约测试同一口径
async function login(identifier: string): Promise<string> {
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier }); // 申请验证码
  expect(codeRes.status).toBe(201); // 201 已创建
  const loginRes = await request(app).post('/api/v1/auth/login').send({ // 换令牌
    region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, // 验证码
    device: { platform: 'web', name: 'test' }, // 设备必填
  }); // 代码块结束
  expect(loginRes.status).toBe(200); // 200 登录成功
  return loginRes.body.access_token as string; // 返回令牌
} // login 结束

beforeAll(async () => { // 调用 beforeAll 并处理其返回结果
  server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); }); // 固定 200
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); // 随机端口
  const port = (server.address() as AddressInfo).port; // 取端口
  origin = `http://127.0.0.1:${port}`; // 探测 origin
}); // beforeAll 结束

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); }); // 关闭本地服务

beforeEach(() => { // 每例重建库与应用，种子自动写入
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_PUBLIC_ORIGIN: origin } }); // 探测 origin 指向本地服务
}); // beforeEach 结束

describe('导航站公开目录', () => { // 浏览类端点匿名可访问
  it('summary 返回种子规模、全为未探测、分组计数', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).get('/api/v1/navigation/summary'); // 公开汇总
    expect(res.status).toBe(200); // 200
    expect(res.body.summary.total).toBe(NAV_LINK_SEEDS.length); // 数量等于种子数
    expect(res.body.summary.unknown).toBe(NAV_LINK_SEEDS.length); // 初始全为未知
    expect(res.body.summary.ok).toBe(0); // 未探测前无「可达」
    expect(res.body.summary.groups.length).toBeGreaterThan(0); // 分组非空
  }); // 代码块结束

  it('links 支持关键词 / 分组 / 状态过滤，且非法状态报 400', async () => { // 调用 it 并处理其返回结果
    const all = await request(app).get('/api/v1/navigation/links'); // 全量
    expect(all.status).toBe(200); // 200
    expect(all.body.items.length).toBe(NAV_LINK_SEEDS.length); // 条数一致
    const byGroup = await request(app).get('/api/v1/navigation/links').query({ group: '运维' }); // 单分组
    expect(byGroup.body.items.every((item: { group: string }) => item.group === '运维')).toBe(true); // 分组过滤生效
    const byQ = await request(app).get('/api/v1/navigation/links').query({ q: '商城' }); // 关键词
    expect(byQ.body.items.length).toBeGreaterThan(0); // 命中至少一条
    const bad = await request(app).get('/api/v1/navigation/links').query({ status: 'dead' }); // 非法状态
    expect(bad.status).toBe(400); // 400
  }); // 代码块结束
}); // 公开目录用例结束

describe('导航链接收录与修改', () => { // 写操作鉴权 + 校验
  it('未登录新建返回 401', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).post('/api/v1/navigation/links').send({ name: 'x', url: '/x' }); // 无令牌
    expect(res.status).toBe(401); // 401
  }); // 代码块结束

  it('非法地址返回 400，合法相对路径创建成功且初始为未探测', async () => { // 调用 it 并处理其返回结果
    const token = await login('13800000001'); // 登录
    const bad = await request(app).post('/api/v1/navigation/links').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-bad-1').send({ name: '坏地址', url: 'javascript:alert(1)' }); // 非 http(s) 也非相对路径
    expect(bad.status).toBe(400); // 400
    const ok = await request(app).post('/api/v1/navigation/links').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-ok-1').send({ name: '测试入口', url: '/navigation', group: '测试', recommended: true }); // 合法
    expect(ok.status).toBe(201); // 201
    expect(ok.body.item.status).toBe('unknown'); // 初始未探测
    expect(ok.body.item.recommended).toBe(true); // 推荐位生效
  }); // 代码块结束

  it('PATCH 修改分组与推荐位，空请求体返回 400', async () => { // 调用 it 并处理其返回结果
    const token = await login('13800000002'); // 登录
    const created = await request(app).post('/api/v1/navigation/links').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-patch-1').send({ name: '待改', url: '/marketplace', group: '旧组' }); // 先建
    const id = created.body.item.id as string; // 主键
    const empty = await request(app).patch(`/api/v1/navigation/links/${id}`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-patch-empty').send({}); // 空更新
    expect(empty.status).toBe(400); // 400
    const patched = await request(app).patch(`/api/v1/navigation/links/${id}`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-patch-2').send({ group: '新组', recommended: true }); // 改分组 + 推荐
    expect(patched.status).toBe(200); // 200
    expect(patched.body.item.group).toBe('新组'); // 分组已改
    expect(patched.body.item.recommended).toBe(true); // 推荐位已开
  }); // 代码块结束
}); // 收录与修改用例结束

describe('可达性探测与失效标记', () => { // 探测闭环
  it('单条探测指向本地 200 服务记为可达并回写 HTTP 码与耗时', async () => { // 调用 it 并处理其返回结果
    const token = await login('13800000003'); // 登录
    const created = await request(app).post('/api/v1/navigation/links').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-check-1').send({ name: '本地可 reachable', url: origin }); // 绝对地址
    const id = created.body.item.id as string; // 主键
    const checked = await request(app).post(`/api/v1/navigation/links/${id}/check`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-check-run-1').send({}); // 探测
    expect(checked.status).toBe(200); // 200
    expect(checked.body.item.status).toBe('ok'); // 200 判定可达
    expect(checked.body.item.http_status).toBe(200); // HTTP 码回写
    expect(checked.body.item.last_checked_at).toBeTruthy(); // 探测时间回写
  }); // 代码块结束

  it('单条探测指向已关闭端口记为失效且不写 HTTP 码', async () => { // 调用 it 并处理其返回结果
    const token = await login('13800000004'); // 登录
    const created = await request(app).post('/api/v1/navigation/links').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-broken-1').send({ name: '不可达', url: 'http://127.0.0.1:9/unreachable' }); // 关闭端口
    const id = created.body.item.id as string; // 主键
    const checked = await request(app).post(`/api/v1/navigation/links/${id}/check`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-broken-run').send({}); // 探测
    expect(checked.status).toBe(200); // 探测请求本身成功
    expect(checked.body.item.status).toBe('broken'); // 网络异常判失效
    expect(checked.body.item.http_status).toBeNull(); // 无 HTTP 码
  }); // 代码块结束

  it('全目录探测把相对路径按 origin 补齐并逐条回写', async () => { // 调用 it 并处理其返回结果
    const token = await login('13800000005'); // 登录
    const all = await request(app).post('/api/v1/navigation/check').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-check-all').send({}); // 全量探测
    expect(all.status).toBe(200); // 200
    expect(all.body.checked).toBe(NAV_LINK_SEEDS.length); // 种子全部探测
    expect(all.body.summary.ok).toBe(NAV_LINK_SEEDS.length); // 相对路径均指向本地 200 服务
    expect(all.body.summary.unknown).toBe(0); // 不再有未探测
  }); // 代码块结束

  it('种子重跑不会把已探测状态重置为未探测', async () => { // 调用 it 并处理其返回结果
    const token = await login('13800000006'); // 登录
    await request(app).post('/api/v1/navigation/check').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'nav-check-all-2').send({}); // 先探测
    seedNavLinks(db); // 再次执行种子
    const res = await request(app).get('/api/v1/navigation/summary'); // 读汇总
    expect(res.body.summary.unknown).toBe(0); // 状态保留
    expect(res.body.summary.total).toBe(NAV_LINK_SEEDS.length); // 不产生重复行
  }); // 代码块结束
}); // 探测用例结束
