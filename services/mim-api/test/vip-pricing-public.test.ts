/**
 * 公开定价与权益页契约测试：GET /api/v1/vip/pricing/public
 *
 * 口径：匿名只读；返回档位与权益，不带任何管理字段；未配置档位时空数组兜底。
 * 价格 / 周期 / 权益全部来自 vip_plans 表现有配置，前端不硬编码。
 */

import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库（含种子档位）
import type { Db } from '../src/types.js'; // 连接类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试用 JWT 密钥
let app: Express; // 被测应用
let db: Db; // 内存库句柄

beforeEach(() => { // 每个用例独立建库，种子库含 3 个启用档位
  db = createDatabase(':memory:'); // 新建内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 组装应用，env 空对象走默认配置
}); // 前置结束

describe('GET /api/v1/vip/pricing/public', () => {
  it('匿名可读，返回种子档位且字段形状正确', async () => { // 匿名 GET 默认放行
    const res = await request(app).get('/api/v1/vip/pricing/public'); // 不带任何鉴权头
    expect(res.status).toBe(200); // 公开只读接口必须 200
    expect(Array.isArray(res.body.plans)).toBe(true); // plans 为数组
    expect(res.body.plans).toHaveLength(3); // 种子库三档启用套餐
    for (const plan of res.body.plans) { // 逐档核对公开字段形状
      expect(typeof plan.code).toBe('string'); // 套餐编码
      expect(typeof plan.name).toBe('string'); // 档位名称
      expect(typeof plan.level).toBe('number'); // 等级
      expect(typeof plan.price_cents).toBe('number'); // 价格（分）
      expect(typeof plan.duration_days).toBe('number'); // 有效天数
      expect(Array.isArray(plan.perks)).toBe(true); // 权益清单为数组
      expect(plan.perks.every((item: unknown) => typeof item === 'string')).toBe(true); // 权益逐项为字符串
    }
  }); // 用例结束

  it('不泄漏管理字段：档位与顶层均无内部列', async () => { // 公开视图裁剪
    const res = await request(app).get('/api/v1/vip/pricing/public');
    const forbidden = ['id', 'sort_order', 'active', 'created_at', 'updated_at']; // 内部管理列不得下发
    for (const plan of res.body.plans) { // 逐档断言
      for (const key of forbidden) expect(plan).not.toHaveProperty(key); // 任一内部列出现即失败
    }
    expect(res.body).not.toHaveProperty('rules'); // 顶层不混入维度折扣规则等其它结构
  }); // 用例结束

  it('服务费 / 生效日期 / 合规链接来自策略常量', async () => { // 脚注口径与退款政策同源
    const res = await request(app).get('/api/v1/vip/pricing/public');
    expect(res.body.policy.platform_service_fee_cents).toBe(0); // 平台服务费 0，与 REFUND_POLICY 对齐
    expect(typeof res.body.policy.effective_date).toBe('string'); // 生效日期
    expect(res.body.policy.effective_date.length).toBeGreaterThan(0); // 非空
    expect(res.body.legal.refund_path).toBe('/legal/refund'); // 退款说明入口
    expect(res.body.legal.help_path).toBe('/legal/help'); // 帮助中心入口
  }); // 用例结束

  it('未配置档位时返回空 plans 数组，接口仍 200', async () => { // 空态兜底
    db.prepare('DELETE FROM vip_plans').run(); // 清空档位模拟未配置
    const res = await request(app).get('/api/v1/vip/pricing/public');
    expect(res.status).toBe(200); // 空配置不报错
    expect(res.body.plans).toEqual([]); // 空数组交前端渲染空态
  }); // 用例结束
}); // 描述块结束
