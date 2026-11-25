/** 契约测试：13 业务领域平台（静态目录）——总览 / 清单 / 过滤 / 详情 / 功能点 / 匿名只读 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排：每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 仅类型导入，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，保证中间件挂载顺序与生产一致
import { createDatabase } from '../src/db.js'; // 内存库工厂，领域目录不查库但装配需要 db
import { // 静态目录常量与函数，作为断言基准
  DOMAIN_CATEGORIES, // 分组字典
  DOMAIN_SCHEMA, // 契约版本
  DOMAIN_STATUSES, // 状态字典
  DOMAINS, // 13 个领域单一事实源
  domainSummary, // 汇总函数
} from '../src/domains/catalog.js'; // 被测静态目录模块

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄

beforeEach(() => { // 每例前置：重建内存库与应用
  db = createDatabase(':memory:'); // 内存库全新创建
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 不注入管理员令牌，全部端点按匿名访问验证
}); // beforeEach 结束

describe('领域总览（匿名可读）', () => { // overview 端点
  it('overview 返回 13 领域与分组 / 状态分布，合计自洽', async () => { // 规模与分布断言
    const res = await request(app).get('/api/v1/domains/overview'); // 匿名 GET 总览
    expect(res.status).toBe(200); // 匿名 200
    expect(res.body).toMatchObject(domainSummary()); // 与静态汇总函数零漂移
    expect(res.body.total).toBe(13); // 领域总数固定为 13
    expect(res.body.active_count).toBe(6); // 已上线 6 个
    expect(res.body.planned_count).toBe(7); // 规划中 7 个
    const sum = (obj: Record<string, number>) => Object.values(obj).reduce((a, b) => a + b, 0); // 求和辅助
    expect(sum(res.body.by_category)).toBe(13); // 分组分布合计等于总数
    expect(sum(res.body.by_status)).toBe(13); // 状态分布合计等于总数
    expect(res.body.by_category.production).toBe(4); // 生产组 4 个
    expect(res.body.by_category.business).toBe(3); // 商业组 3 个
    expect(res.body.by_category.knowledge).toBe(2); // 知识组 2 个
    expect(res.body.by_category.lifestyle).toBe(2); // 生活组 2 个
    expect(res.body.by_category.support).toBe(2); // 支撑组 2 个
  }); // 规模用例结束

  it('overview 返回分组 / 状态字典与 13 项精简信息', async () => { // 字典与精简项
    const res = await request(app).get('/api/v1/domains/overview'); // 匿名 GET 总览
    expect(res.body.schema).toBe(DOMAIN_SCHEMA); // 契约版本一致
    expect(res.body.categories).toBe(Object.keys(DOMAIN_CATEGORIES).length); // 前端计数别名：分组数 5
    expect(res.body.active).toBe(6); // 前端计数别名：已上线数 6
    expect(res.body.category_codes).toEqual(DOMAIN_CATEGORIES); // 分组字典零漂移
    expect(res.body.statuses).toEqual(DOMAIN_STATUSES); // 状态字典零漂移
    expect(res.body.items).toHaveLength(13); // 精简项数量
    expect(res.body.items.map((i: { slug: string }) => i.slug)).toEqual(DOMAINS.map((d) => d.slug)); // 顺序与清单一致
    for (const item of res.body.items) { // 逐项核对精简字段
      expect(Object.keys(item).sort()).toEqual(['category', 'icon', 'name_en', 'name_zh', 'slug', 'status'].sort()); // 只回显 6 个精简字段
      expect(DOMAINS.some((d) => d.slug === item.slug && d.name_zh === item.name_zh)).toBe(true); // 与静态目录对齐
    } // 逐项循环结束
  }); // 字典用例结束
}); // 总览分组结束

describe('领域清单与过滤', () => { // GET /domains
  it('GET /domains 返回全量 13 项且字段统一为 snake_case', async () => { // 零漂移与命名断言
    const res = await request(app).get('/api/v1/domains'); // 匿名 GET 清单
    expect(res.status).toBe(200); // 匿名 200
    expect(res.body.schema).toBe(DOMAIN_SCHEMA); // schema 契约版本
    expect(res.body.total).toBe(13); // 全量条数
    expect(res.body.items).toHaveLength(13); // 数组长度
    const fields = ['slug', 'name_zh', 'name_en', 'description', 'icon', 'category', 'status', 'reuse', 'features']; // 统一字段清单
    for (const item of res.body.items) { // 逐项核对
      for (const field of fields) expect(item).toHaveProperty(field); // 9 个字段齐备
      expect(Array.isArray(item.features)).toBe(true); // features 为数组
      expect(item.features.length).toBeGreaterThanOrEqual(3); // 功能点至少 3 个
      expect(item.features.length).toBeLessThanOrEqual(5); // 功能点至多 5 个
      expect(Object.keys(item).every((k) => !/[A-Z]/.test(k))).toBe(true); // 所有 key 均无大写字母，符合 snake_case
      const source = DOMAINS.find((d) => d.slug === item.slug); // 找静态目录对应项
      expect(source).toBeTruthy(); // 不得出现目录外条目
      expect(item).toEqual(source); // 全字段零漂移
    } // 逐项循环结束
  }); // 字段用例结束

  it('category 过滤只返回指定分组且回显过滤条件', async () => { // 分组过滤
    const res = await request(app).get('/api/v1/domains?category=business'); // 商业组
    expect(res.status).toBe(200); // 200
    expect(res.body.filters.category).toBe('business'); // 过滤条件回显
    expect(res.body.total).toBe(3); // 商业组 3 个
    expect(res.body.items.every((i: { category: string }) => i.category === 'business')).toBe(true); // 全部命中
    expect(res.body.items.map((i: { slug: string }) => i.slug)).toEqual(['finance', 'marketing', 'ecommerce']); // 顺序与目录一致
  }); // 分组用例结束

  it('status 过滤区分 active 与 planned 两组', async () => { // 状态过滤
    const active = await request(app).get('/api/v1/domains?status=active'); // 已上线
    expect(active.body.total).toBe(6); // 6 个已上线
    expect(active.body.items.every((i: { status: string }) => i.status === 'active')).toBe(true); // 全部命中
    const planned = await request(app).get('/api/v1/domains?status=planned'); // 规划中
    expect(planned.body.total).toBe(7); // 7 个规划中
    expect(planned.body.items.every((i: { status: string }) => i.status === 'planned')).toBe(true); // 全部命中
    expect(active.body.total + planned.body.total).toBe(13); // 两组之和等于总数
  }); // 状态用例结束

  it('q 关键词支持中文名与英文 slug，且大小写不敏感', async () => { // 关键词过滤
    const zh = await request(app).get('/api/v1/domains?q=' + encodeURIComponent('电商')); // 中文名搜索
    expect(zh.body.total).toBe(1); // 命中电商
    expect(zh.body.items[0].slug).toBe('ecommerce'); // slug 正确
    const en = await request(app).get('/api/v1/domains?q=FINANCE'); // 大写英文搜索
    expect(en.body.total).toBe(1); // 大小写不敏感
    expect(en.body.items[0].slug).toBe('finance'); // 命中金融
    const feature = await request(app).get('/api/v1/domains?q=' + encodeURIComponent('用药提醒')); // 功能点搜索
    expect(feature.body.items[0].slug).toBe('medical'); // 功能点也参与匹配
  }); // 关键词用例结束

  it('组合过滤取交集；无命中时 total=0 且过滤条件仍回显', async () => { // 交集与空结果
    const both = await request(app).get('/api/v1/domains?category=business&status=active'); // 分组 + 状态
    expect(both.body.total).toBe(2); // 商业组中已上线 2 个（marketing / ecommerce）
    expect(both.body.items.every((i: { category: string; status: string }) => i.category === 'business' && i.status === 'active')).toBe(true); // 交集命中
    const none = await request(app).get('/api/v1/domains?q=not-exist-domain-xyz'); // 无命中关键词
    expect(none.status).toBe(200); // 200 而非 404
    expect(none.body.total).toBe(0); // 过滤结果为空
    expect(none.body.items).toEqual([]); // 空数组
    expect(none.body.filters.q).toBe('not-exist-domain-xyz'); // 条件回显
  }); // 组合用例结束
}); // 清单分组结束

describe('领域详情与功能点（匿名可读）', () => { // 详情与 features 端点
  it('GET /domains/:slug 返回完整字段与分组 / 状态中文文案', async () => { // 详情命中
    const res = await request(app).get('/api/v1/domains/ecommerce'); // 已上线领域
    expect(res.status).toBe(200); // 匿名 200
    expect(res.body.schema).toBe(DOMAIN_SCHEMA); // schema 契约版本
    expect(res.body.item).toEqual(DOMAINS.find((d) => d.slug === 'ecommerce')); // 与静态目录一致
    expect(res.body.domain).toEqual(res.body.item); // 前端期望的 domain 别名与 item 同值
    expect(res.body.category_label).toBe(DOMAIN_CATEGORIES.business); // 分组中文名
    expect(res.body.status_label).toBe(DOMAIN_STATUSES.active); // 状态中文名
    expect(Object.keys(res.body.item).every((k: string) => !/[A-Z]/.test(k))).toBe(true); // 字段 snake_case
  }); // 详情用例结束

  it('GET /domains/:slug 未找到时回 404 统一错误信封并回显 slug', async () => { // 404
    const res = await request(app).get('/api/v1/domains/not-a-domain'); // 未登记 slug
    expect(res.status).toBe(404); // 404
    expect(res.body.code).toBe('NOT_FOUND'); // 统一错误码（ERROR_CODES 未登记 DOMAIN_NOT_FOUND）
    expect(res.body.details.slug).toBe('not-a-domain'); // 明细回显请求的 slug
    expect(res.body).toHaveProperty('request_id'); // 请求追踪 ID 齐备
  }); // 404 用例结束

  it('GET /domains/:slug/features 返回该领域功能点清单', async () => { // features 命中
    const res = await request(app).get('/api/v1/domains/finance/features'); // 金融领域功能点
    expect(res.status).toBe(200); // 匿名 200
    expect(res.body.schema).toBe(DOMAIN_SCHEMA); // schema 契约版本
    expect(res.body.slug).toBe('finance'); // slug 回显
    expect(res.body.name_zh).toBe('金融'); // 中文名回显
    const source = DOMAINS.find((d) => d.slug === 'finance')!; // 静态目录对应项
    expect(res.body.features).toEqual(source.features); // 功能点零漂移
    expect(res.body.total).toBe(source.features.length); // 数量由数组长度推导
    expect(res.body.items).toHaveLength(source.features.length); // 前端对象化清单同长
    for (const item of res.body.items) { // 逐项核对前端 DomainFeature 形状
      expect(Object.keys(item).sort()).toEqual(['description', 'name_en', 'name_zh', 'slug'].sort()); // 4 个字段齐备
      expect(item.slug).toBe('finance'); // 对象所属领域标识
      expect(source.features).toContain(item.description); // 描述来自功能点数组
    } // 逐项循环结束
  }); // features 用例结束

  it('features 端点未找到时同样回 404，且 overview 不被详情路由吞掉', async () => { // 边界：路由顺序
    const missing = await request(app).get('/api/v1/domains/missing/features'); // 未登记 slug 的功能点
    expect(missing.status).toBe(404); // 404
    expect(missing.body.code).toBe('NOT_FOUND'); // 统一错误码
    const overview = await request(app).get('/api/v1/domains/overview'); // 静态路径不能被 :slug 吞掉
    expect(overview.status).toBe(200); // 仍命中 overview
    expect(overview.body.total).toBe(13); // 汇总数据正确
  }); // 边界用例结束
}); // 详情分组结束
