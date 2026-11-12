/** 安全加固包测试：举报 用户+目标 滑动窗口限频 + 索引巡检输出 */

import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { createCache } from '../src/cache.js';
import { slidingWindow, inspectIndexes } from '../src/security.js';
import type { Db } from '../src/types.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

let db: Db;

beforeEach(() => {
  db = createDatabase(':memory:');
});

describe('slidingWindow 滑动窗口计数', () => {
  it('窗口内超出 limit 返回 ok=false，未超返回 ok=true', async () => {
    const cache = createCache({});
    const first = await slidingWindow(cache, 'user-1:thread:t1', 2, 60);
    const second = await slidingWindow(cache, 'user-1:thread:t1', 2, 60);
    const third = await slidingWindow(cache, 'user-1:thread:t1', 2, 60);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    expect(third.count).toBe(3);
    expect(third.limit).toBe(2);
    await cache.close();
  });

  it('不同目标分别计数，互不影响', async () => {
    const cache = createCache({});
    await slidingWindow(cache, 'u:thread:a', 1, 60);
    const other = await slidingWindow(cache, 'u:thread:b', 1, 60);
    expect(other.ok).toBe(true);
    await cache.close();
  });
});

describe('POST /reports 路由限频', () => {
  async function login(app: Express, identifier: string): Promise<string> {
    const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier });
    expect(codeRes.status).toBe(201);
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } });
    expect(loginRes.status).toBe(200);
    return loginRes.body.access_token as string;
  }

  it('同一用户对同一目标超过窗口上限返回 429 RATE_LIMITED', async () => {
    const app = createApp({
      db,
      jwtSecret: JWT_SECRET,
      env: { MIM_REPORT_LIMIT: '2', MIM_REPORT_WINDOW_MINUTES: '1' },
    });
    const token = await login(app, '13800000011');
    const payload = { target_type: 'thread', target_id: 'thread-store-visual', reason: '测试举报', detail: '限频验证' };

    const first = await request(app).post('/api/v1/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rep-1').send(payload);
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/v1/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rep-2').send(payload);
    expect(second.status).toBe(201);
    const third = await request(app).post('/api/v1/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rep-3').send(payload);
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('RATE_LIMITED');
  });
});

describe('inspectIndexes 索引巡检', () => {
  it('输出缺失索引建议与慢查询候选，不执行 DDL', () => {
    const audit = inspectIndexes(db);
    expect(Array.isArray(audit.missing)).toBe(true);
    expect(Array.isArray(audit.slowCandidates)).toBe(true);
    // 种子库已建既有索引；举报复合索引由 schema.d 补建，巡检应能识别其覆盖情况
    const reports = audit.missing.find((m) => m.table === 'content_reports');
    expect(reports === undefined ? true : reports.columns.includes('reporter_id')).toBe(true);
    expect(audit.slowCandidates.length).toBeGreaterThan(0);
  });
});
