/** 契约测试：site 域（DNSPod 备注 → 站点模块地图）公开只读接口 */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

let app: Express;

beforeEach(() => {
  app = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: {} });
});

describe('站点模块地图', () => {
  it('overview 返回 2 个 zone、8 个分类，计数合计 45', async () => {
    const res = await request(app).get('/api/v1/site/overview');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(45);
    expect(res.body.zones.map((z: { id: string }) => z.id)).toEqual(['laal.top', 'mixm.top']);
    expect(res.body.categories).toHaveLength(8);
    const sum = res.body.categories.reduce((acc: number, c: { count: number }) => acc + c.count, 0);
    expect(sum).toBe(45);
  });

  it('模块列表返回 45 条，每条含 2 个 zone 解析记录', async () => {
    const res = await request(app).get('/api/v1/site/modules');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(45);
    expect(res.body.module_total).toBe(45);
    for (const item of res.body.items) {
      expect(item.records).toHaveLength(2);
      expect(item.records.map((r: { zone: string }) => r.zone)).toEqual(['laal.top', 'mixm.top']);
    }
  });

  it('zone 过滤只保留该 zone 的记录与地址', async () => {
    const res = await request(app).get('/api/v1/site/modules?zone=mixm.top');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(45);
    for (const item of res.body.items) {
      expect(item.records).toHaveLength(1);
      expect(item.records[0].zone).toBe('mixm.top');
      expect(item.records[0].fqdn.endsWith('mixm.top')).toBe(true);
      expect(item.urls[0]).toBe(`https://${item.records[0].fqdn}`);
    }
  });

  it('category 过滤与 q 搜索可组合', async () => {
    const tools = await request(app).get('/api/v1/site/modules?category=tools');
    expect(tools.status).toBe(200);
    expect(tools.body.total).toBe(6);

    const hit = await request(app).get('/api/v1/site/modules?q=' + encodeURIComponent('疾风引擎'));
    expect(hit.status).toBe(200);
    expect(hit.body.total).toBe(1);
    expect(hit.body.items[0].host).toBe('gy');
  });

  it('单模块详情：gy 在 mixm.top 为 CNAME 指向疾风引擎节点', async () => {
    const res = await request(app).get('/api/v1/site/modules/gy');
    expect(res.status).toBe(200);
    const mixm = res.body.module.records.find((r: { zone: string }) => r.zone === 'mixm.top');
    expect(mixm.record_type).toBe('CNAME');
    expect(mixm.record_value).toBe('gale-engine-landing-6j02gsvv.edgeone.cool.');
    expect(mixm.label).toContain('疾风引擎承载节点');
    expect(res.body.module.label).toBe('工具模块入口');
  });

  it('根域名 @ 的 fqdn 为 zone 本身', async () => {
    const res = await request(app).get('/api/v1/site/modules/@');
    expect(res.status).toBe(200);
    expect(res.body.module.records.map((r: { fqdn: string }) => r.fqdn)).toEqual([
      'laal.top',
      'mixm.top',
    ]);
  });

  it('未知 zone / category / 查询参数返回 400，未知主机返回 404', async () => {
    const zone = await request(app).get('/api/v1/site/modules?zone=example.com');
    expect(zone.status).toBe(400);
    expect(zone.body.code).toBe('VALIDATION_FAILED');

    const category = await request(app).get('/api/v1/site/modules?category=nope');
    expect(category.status).toBe(400);
    expect(category.body.code).toBe('VALIDATION_FAILED');

    const unknownParam = await request(app).get('/api/v1/site/modules?foo=bar');
    expect(unknownParam.status).toBe(400);
    expect(unknownParam.body.code).toBe('VALIDATION_FAILED');

    const missing = await request(app).get('/api/v1/site/modules/not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });
});
