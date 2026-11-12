/** 契约测试：外观前台消费 —— 公开站点配置 / 页面区块匿名读取 / 写操作权限门禁 / 空配置回落 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排：每例重建内存库
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂，种子自动写入

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 引导通道令牌，与注入 env 保持一致

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库

beforeEach(() => { // 每例重建库与应用，种子主题 / 站点信息 / 区块自动写入
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 开启管理引导通道
});

describe('公开站点启动配置', () => {
  it('匿名可读 home_view / theme / site / locales，主题带主色与圆角回落值', async () => {
    const res = await request(app).get('/api/v1/site/config'); // 免登录启动配置
    expect(res.status).toBe(200); // 200
    expect(['store', 'community']).toContain(res.body.home_view); // 首页指向枚举内
    expect(res.body.theme).toBeTruthy(); // 主题对象存在
    expect(typeof res.body.theme.accent).toBe('string'); // 主色回落值
    expect(typeof res.body.theme.radius).toBe('number'); // 圆角回落值
    expect(res.body.site).toBeTruthy(); // 站点信息存在
  });

  it('主题配置被清空后，前台仍能拿到结构完整的兜底视图（不白屏）', async () => {
    db.prepare("DELETE FROM site_settings WHERE key = 'theme'").run(); // 模拟配置缺失
    const res = await request(app).get('/api/v1/site/config'); // 重读配置
    expect(res.status).toBe(200); // 不抛 500
    expect(res.body.theme).toEqual({}); // 空对象回落，由前端默认外观兜底
  });
});

describe('页面区块公开只读', () => {
  it('匿名按 sort_order 升序返回启用区块，配置解析为 config 对象', async () => {
    const res = await request(app).get('/api/v1/pages/home'); // 公开读取首页区块
    expect(res.status).toBe(200); // 匿名 200，不再要求登录
    expect(res.body.page).toBe('home'); // 页面标识回显
    expect(Array.isArray(res.body.blocks)).toBe(true); // 区块清单
    expect(res.body.blocks.length).toBeGreaterThan(0); // 种子区块非空
    const orders = res.body.blocks.map((b: { sort_order: number }) => b.sort_order); // 排序口径
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b)); // 已按升序排列
    for (const block of res.body.blocks) {
      expect(block.config).toBeTruthy(); // 配置已 JSON 解析
    }
  });

  it('未配置区块的页面返回空清单，不报错', async () => {
    const res = await request(app).get('/api/v1/pages/nonexistent-page'); // 无区块页面
    expect(res.status).toBe(200); // 200 而非 500
    expect(res.body.blocks).toEqual([]); // 空清单回落
  });
});

describe('外观写操作权限门禁', () => {
  it('匿名更新设置返回 401', async () => {
    const res = await request(app).put('/api/v1/appearance/settings').send({ key: 'theme', value: { accent: '#111111' } }); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(401); // 未登录拒绝
  });

  it('引导令牌可更新主题，公开配置随之生效', async () => {
    const put = await request(app) // 准备：构造本用例需要的输入或句柄
      .put('/api/v1/appearance/settings')
      .set('x-admin-token', ADMIN_TOKEN)
      .set('Idempotency-Key', 'appearance-theme-1')
      .send({ key: 'theme', value: { accent: '#7c3aed', radius: 12, list_style: 'compact' } });
    expect(put.status).toBe(200); // 写入成功
    const cfg = await request(app).get('/api/v1/site/config'); // 重读公开配置
    expect(cfg.body.theme.accent).toBe('#7c3aed'); // 主色已生效
    expect(cfg.body.theme.list_style).toBe('compact'); // 列表样式已生效
  });

  it('引导令牌可新建区块并按排序出现在公开清单', async () => {
    const create = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/pages/home/blocks')
      .set('x-admin-token', ADMIN_TOKEN)
      .set('Idempotency-Key', 'appearance-block-1')
      .send({ kind: 'notice', sort_order: 99, config: { title: '测试公告' } });
    expect(create.status).toBe(201); // 新建成功
    const list = await request(app).get('/api/v1/pages/home'); // 公开读取
    expect(list.body.blocks.some((b: { kind: string }) => b.kind === 'notice')).toBe(true); // 新区块可见
  });
});
