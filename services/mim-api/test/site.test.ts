/** 契约测试：site 域（DNSPod 备注 → 站点模块地图）公开只读接口 */

// vitest 测试框架：beforeEach / describe / expect / it
import { beforeEach, describe, expect, it } from 'vitest';
// supertest：对 Express app 发起真实 HTTP 请求（不监听端口）
import request from 'supertest';
// 仅类型导入：Express 应用实例类型
import type { Express } from 'express';
// 被测对象：应用工厂
import { createApp } from '../src/app.js';
// 内存数据库工厂：每个用例独立、互不污染
import { createDatabase } from '../src/db.js';

// 测试用 JWT 密钥：长度满足校验要求，仅测试使用
const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

// 每个用例前重建 app，保证 case 间无状态残留
let app: Express;

// 钩子：为每个 it 准备一个全新的内存库 app 实例
beforeEach(() => {
  // 用 ':memory:' 建库，env 传空对象即可（site 域不需要额外环境变量）
  app = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: {} });
});

// 站点模块地图接口的契约测试集合
describe('站点模块地图', () => {
  // 用例 1：overview 的结构与计数
  it('overview 返回 1 个 zone、8 个分类，计数合计 45', async () => {
    // 发起 GET /api/v1/site/overview
    const res = await request(app).get('/api/v1/site/overview');
    // 期望 HTTP 200
    expect(res.status).toBe(200);
    // 模块总数应为 45（DNSPod 导出表的主机记录数）
    expect(res.body.total).toBe(45);
    // zone 列表仅剩 mixm.top（laal.top 已下线）
    expect(res.body.zones.map((z: { id: string }) => z.id)).toEqual(['mixm.top']);
    // zone 概览不再暴露默认解析值
    expect(res.body.zones[0].default_record_value).toBeUndefined();
    // 分类数量应为 8
    expect(res.body.categories).toHaveLength(8);
    // 各分类计数之和应等于 45
    const sum = res.body.categories.reduce((acc: number, c: { count: number }) => acc + c.count, 0);
    // 断言合计值
    expect(sum).toBe(45);
  });

  // 用例 2：列表全量结构
  it('模块列表返回 45 条，每条含 1 个 zone 解析记录且不含解析值', async () => {
    // 发起 GET /api/v1/site/modules（无过滤）
    const res = await request(app).get('/api/v1/site/modules');
    // 期望 200
    expect(res.status).toBe(200);
    // 命中数 = 45
    expect(res.body.total).toBe(45);
    // 全量数 = 45
    expect(res.body.module_total).toBe(45);
    // 逐条校验：每个模块都应有 1 条记录，zone 固定为 mixm.top
    for (const item of res.body.items) {
      // 每条模块仅 1 个 zone 的记录
      expect(item.records).toHaveLength(1);
      // 记录 zone 应为 mixm.top
      expect(item.records.map((r: { zone: string }) => r.zone)).toEqual(['mixm.top']);
      // 记录不再暴露解析目标（IP / CNAME 目标值）
      expect(item.records[0].record_value).toBeUndefined();
    }
  });

  // 用例 3：zone 过滤的裁剪效果
  it('zone 过滤只保留该 zone 的记录与地址', async () => {
    // 只请求 mixm.top 的记录
    const res = await request(app).get('/api/v1/site/modules?zone=mixm.top');
    // 期望 200
    expect(res.status).toBe(200);
    // 模块数仍为 45（每个模块在 mixm.top 均有记录）
    expect(res.body.total).toBe(45);
    // 逐条校验 zone 裁剪结果
    for (const item of res.body.items) {
      // 只剩 1 条记录
      expect(item.records).toHaveLength(1);
      // 该记录 zone 为 mixm.top
      expect(item.records[0].zone).toBe('mixm.top');
      // fqdn 以 mixm.top 结尾
      expect(item.records[0].fqdn.endsWith('mixm.top')).toBe(true);
      // urls 由记录重新推导，首项应与 fqdn 对应
      expect(item.urls[0]).toBe(`https://${item.records[0].fqdn}`);
    }
  });

  // 用例 4：分类过滤与关键词搜索
  it('category 过滤与 q 搜索可组合', async () => {
    // 按分类 tools 过滤，应为 6 条
    const tools = await request(app).get('/api/v1/site/modules?category=tools');
    // 期望 200
    expect(tools.status).toBe(200);
    // tools 分类共 6 条
    expect(tools.body.total).toBe(6);

    // 关键词「疾风引擎」应命中 gy 一条（record 级备注参与检索）
    const hit = await request(app).get('/api/v1/site/modules?q=' + encodeURIComponent('疾风引擎'));
    // 期望 200
    expect(hit.status).toBe(200);
    // 命中 1 条
    expect(hit.body.total).toBe(1);
    // 命中的 host 为 gy
    expect(hit.body.items[0].host).toBe('gy');
  });

  // 用例 5：单模块详情与 record 级覆盖
  it('单模块详情：gy 为 CNAME 指向疾风引擎节点（解析值不暴露）', async () => {
    // 请求 gy 的详情
    const res = await request(app).get('/api/v1/site/modules/gy');
    // 期望 200
    expect(res.status).toBe(200);
    // 取出 mixm.top 的那条记录
    const mixm = res.body.module.records.find((r: { zone: string }) => r.zone === 'mixm.top');
    // gy 应为 CNAME
    expect(mixm.record_type).toBe('CNAME');
    // CNAME 目标值不对外暴露
    expect(mixm.record_value).toBeUndefined();
    // record 级备注应包含「疾风引擎承载节点」
    expect(mixm.label).toContain('疾风引擎承载节点');
    // 模块级 label 保持 DNSPod 导出口径，未被 record 级覆盖污染
    expect(res.body.module.label).toBe('工具模块入口');
  });

  // 用例 6：根记录 '@' 的 fqdn 处理
  it('根域名 @ 的 fqdn 为 zone 本身', async () => {
    // 请求根记录模块
    const res = await request(app).get('/api/v1/site/modules/@');
    // 期望 200
    expect(res.status).toBe(200);
    // 根记录的 fqdn 不应拼成 '@.xxx'，而应等于 zone 本身
    expect(res.body.module.records.map((r: { fqdn: string }) => r.fqdn)).toEqual(['mixm.top']);
  });

  // 用例 7：错误分支（400 / 404）
  it('未知 zone / category / 查询参数返回 400，未知主机返回 404', async () => {
    // 非法 zone → 400
    const zone = await request(app).get('/api/v1/site/modules?zone=example.com');
    // 期望 400
    expect(zone.status).toBe(400);
    // 错误码为 VALIDATION_FAILED
    expect(zone.body.code).toBe('VALIDATION_FAILED');

    // 已下线的 laal.top 同样属于非法 zone → 400
    const laal = await request(app).get('/api/v1/site/modules?zone=laal.top');
    // 期望 400
    expect(laal.status).toBe(400);
    // 错误码为 VALIDATION_FAILED
    expect(laal.body.code).toBe('VALIDATION_FAILED');

    // 非法 category → 400
    const category = await request(app).get('/api/v1/site/modules?category=nope');
    // 期望 400
    expect(category.status).toBe(400);
    // 错误码为 VALIDATION_FAILED
    expect(category.body.code).toBe('VALIDATION_FAILED');

    // 未声明的查询参数 → 400（strictObject 拒绝）
    const unknownParam = await request(app).get('/api/v1/site/modules?foo=bar');
    // 期望 400
    expect(unknownParam.status).toBe(400);
    // 错误码为 VALIDATION_FAILED
    expect(unknownParam.body.code).toBe('VALIDATION_FAILED');

    // 未知主机 → 404
    const missing = await request(app).get('/api/v1/site/modules/not-exist');
    // 期望 404
    expect(missing.status).toBe(404);
    // 错误码为 NOT_FOUND
    expect(missing.body.code).toBe('NOT_FOUND');
  });
});
