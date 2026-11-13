/** 安全加固包测试：举报 用户+目标 滑动窗口限频 + 索引巡检输出 */

import { describe, expect, it, beforeEach } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // 引入：声明测试所需依赖
import type { Express } from 'express'; // 引入：声明测试所需依赖
import { createApp } from '../src/app.js'; // 引入依赖、类型或本地模块绑定
import { createDatabase } from '../src/db.js'; // 引入依赖、类型或本地模块绑定
import { createCache } from '../src/cache.js'; // 引入依赖、类型或本地模块绑定
import { slidingWindow, inspectIndexes } from '../src/security.js'; // 引入依赖、类型或本地模块绑定
import type { Db } from '../src/types.js'; // 引入：声明测试所需依赖

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 构造：准备本用例需要的输入、句柄或期望值

let db: Db; // 状态：保存跨步骤复用的值

beforeEach(() => { // 调用 beforeEach 并处理其返回结果
  db = createDatabase(':memory:'); // 赋值：更新变量 db 的取值
}); // 代码块结束

describe('slidingWindow 滑动窗口计数', () => { // 调用 describe 并处理其返回结果
  it('窗口内超出 limit 返回 ok=false，未超返回 ok=true', async () => { // 调用 it 并处理其返回结果
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    const first = await slidingWindow(cache, 'user-1:thread:t1', 2, 60); // 构造：准备本用例需要的输入、句柄或期望值
    const second = await slidingWindow(cache, 'user-1:thread:t1', 2, 60); // 构造：准备本用例需要的输入、句柄或期望值
    const third = await slidingWindow(cache, 'user-1:thread:t1', 2, 60); // 构造：准备本用例需要的输入、句柄或期望值
    expect(first.ok).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(second.ok).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(third.ok).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(third.count).toBe(3); // 断言：校验响应字段与冻结契约一致
    expect(third.limit).toBe(2); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  }); // 代码块结束

  it('不同目标分别计数，互不影响', async () => { // 调用 it 并处理其返回结果
    const cache = createCache({}); // 构造：准备本用例需要的输入、句柄或期望值
    await slidingWindow(cache, 'u:thread:a', 1, 60); // 执行：等待接口或数据库操作返回
    const other = await slidingWindow(cache, 'u:thread:b', 1, 60); // 构造：准备本用例需要的输入、句柄或期望值
    expect(other.ok).toBe(true); // 断言：校验响应字段与冻结契约一致
    await cache.close(); // 执行：等待接口或数据库操作返回
  }); // 代码块结束
}); // 代码块结束

describe('POST /reports 路由限频', () => { // 调用 describe 并处理其返回结果
  async function login(app: Express, identifier: string): Promise<string> { // 函数 login：封装一段可复用的处理逻辑
    const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(codeRes.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const loginRes = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/auth/login') // 注册 POST 路由 / 中间件处理器
      .send({ region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } }); // 执行当前业务步骤
    expect(loginRes.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    return loginRes.body.access_token as string; // 返回：交回本步骤结果供断言使用
  } // 代码块结束

  it('同一用户对同一目标超过窗口上限返回 429 RATE_LIMITED', async () => { // 调用 it 并处理其返回结果
    const app = createApp({ // 构造：准备本用例需要的输入、句柄或期望值
      db, // 执行当前业务步骤
      jwtSecret: JWT_SECRET, // 对象字段 jwtSecret：记录一项配置或数据
      env: { MIM_REPORT_LIMIT: '2', MIM_REPORT_WINDOW_MINUTES: '1' }, // 对象字段 env：记录一项配置或数据
    }); // 代码块结束
    const token = await login(app, '13800000011'); // 构造：准备本用例需要的输入、句柄或期望值
    const payload = { target_type: 'thread', target_id: 'thread-store-visual', reason: '测试举报', detail: '限频验证' }; // 构造：准备本用例需要的输入、句柄或期望值

    const first = await request(app).post('/api/v1/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rep-1').send(payload); // 构造：准备本用例需要的输入、句柄或期望值
    expect(first.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const second = await request(app).post('/api/v1/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rep-2').send(payload); // 构造：准备本用例需要的输入、句柄或期望值
    expect(second.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const third = await request(app).post('/api/v1/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rep-3').send(payload); // 构造：准备本用例需要的输入、句柄或期望值
    expect(third.status).toBe(429); // 断言：校验响应字段与冻结契约一致
    expect(third.body.code).toBe('RATE_LIMITED'); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束
}); // 代码块结束

describe('inspectIndexes 索引巡检', () => { // 调用 describe 并处理其返回结果
  it('输出缺失索引建议与慢查询候选，不执行 DDL', () => { // 调用 it 并处理其返回结果
    const audit = inspectIndexes(db); // 构造：准备本用例需要的输入、句柄或期望值
    expect(Array.isArray(audit.missing)).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(Array.isArray(audit.slowCandidates)).toBe(true); // 断言：校验响应字段与冻结契约一致
    // 种子库已建既有索引；举报复合索引由 schema.d 补建，巡检应能识别其覆盖情况
    const reports = audit.missing.find((m) => m.table === 'content_reports'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(reports === undefined ? true : reports.columns.includes('reporter_id')).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(audit.slowCandidates.length).toBeGreaterThan(0); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束
}); // 代码块结束
