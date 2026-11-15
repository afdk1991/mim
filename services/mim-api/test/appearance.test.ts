/** 契约测试：外观前台消费 —— 公开站点配置 / 页面区块匿名读取 / 写操作权限门禁 / 空配置回落 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排：每例重建内存库
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase, seedCommerce } from '../src/db.js'; // 内存库工厂，种子自动写入；seedCommerce 用于模拟重启再播种

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 引导通道令牌，与注入 env 保持一致

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库

beforeEach(() => { // 每例重建库与应用，种子主题 / 站点信息 / 区块自动写入
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 开启管理引导通道
}); // 代码块结束

describe('公开站点启动配置', () => { // 调用 describe 并处理其返回结果
  it('匿名可读 home_view / theme / site / locales，主题带主色与圆角回落值', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).get('/api/v1/site/config'); // 免登录启动配置
    expect(res.status).toBe(200); // 200
    expect(['store', 'community']).toContain(res.body.home_view); // 首页指向枚举内
    expect(res.body.theme).toBeTruthy(); // 主题对象存在
    expect(typeof res.body.theme.accent).toBe('string'); // 主色回落值
    expect(typeof res.body.theme.radius).toBe('number'); // 圆角回落值
    expect(res.body.site).toBeTruthy(); // 站点信息存在
  }); // 代码块结束

  it('主题配置被清空后，前台仍能拿到结构完整的兜底视图（不白屏）', async () => { // 调用 it 并处理其返回结果
    db.prepare("DELETE FROM site_settings WHERE key = 'theme'").run(); // 模拟配置缺失
    const res = await request(app).get('/api/v1/site/config'); // 重读配置
    expect(res.status).toBe(200); // 不抛 500
    expect(res.body.theme).toEqual({}); // 空对象回落，由前端默认外观兜底
  }); // 代码块结束
}); // 代码块结束

describe('页面区块公开只读', () => { // 调用 describe 并处理其返回结果
  it('匿名按 sort_order 升序返回启用区块，配置解析为 config 对象', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).get('/api/v1/pages/home'); // 公开读取首页区块
    expect(res.status).toBe(200); // 匿名 200，不再要求登录
    expect(res.body.page).toBe('home'); // 页面标识回显
    expect(Array.isArray(res.body.blocks)).toBe(true); // 区块清单
    expect(res.body.blocks.length).toBeGreaterThan(0); // 种子区块非空
    const orders = res.body.blocks.map((b: { sort_order: number }) => b.sort_order); // 排序口径
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b)); // 已按升序排列
    for (const block of res.body.blocks) { // 循环：逐项遍历集合并执行相同处理
      expect(block.config).toBeTruthy(); // 配置已 JSON 解析
    } // 代码块结束
  }); // 代码块结束

  it('未配置区块的页面返回空清单，不报错', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).get('/api/v1/pages/nonexistent-page'); // 无区块页面
    expect(res.status).toBe(200); // 200 而非 500
    expect(res.body.blocks).toEqual([]); // 空清单回落
  }); // 代码块结束

  it('单行配置是脏 JSON 时回落空对象，不把公开接口打成 500', async () => { // 调用 it 并处理其返回结果
    db.prepare("UPDATE page_blocks SET config_json = '{bad' WHERE id = 'block-home-hero'").run(); // 模拟坏数据
    const res = await request(app).get('/api/v1/pages/home'); // 公开读取
    expect(res.status).toBe(200); // 不抛 500
    const hero = res.body.blocks.find((b: { id: string }) => b.id === 'block-home-hero'); // 定位损坏区块
    expect(hero.config).toEqual({}); // 脏配置回落空对象
  }); // 代码块结束

  it('存量库仍是旧占位文案时，再播种一次即对齐为面向访客的文案', async () => { // 模拟线上旧种子行 + 重启
    db.prepare("UPDATE page_blocks SET config_json = ? WHERE id = 'block-home-hero'").run(JSON.stringify({ title: 'Mim 商业中台', subtitle: '知识付费、独立商城、社区与资金结算', cta: { label: '进入商城', href: '/marketplace' } })); // 旧种子原文
    seedCommerce(db); // 模拟服务重启时的播种
    const res = await request(app).get('/api/v1/pages/home'); // 匿名读取首页
    const hero = res.body.blocks.find((b: { id: string }) => b.id === 'block-home-hero'); // 定位头图
    expect(hero.config.title).toBe('Mim 社区'); // 标题已替换
    expect(hero.config.cta.href).toBe('/community'); // CTA 指向社区而非旧商城路径
    expect(JSON.stringify(hero.config)).not.toContain('商业中台'); // 占位词彻底消失
  }); // 代码块结束

  it('运营手改过的首页文案不会被播种对齐覆盖', async () => { // 幂等对齐只针对旧种子原文
    const custom = { title: '我们自己的首页', subtitle: '运营手写文案', cta: { label: '去看看', href: '/community' } }; // 自定义配置
    db.prepare("UPDATE page_blocks SET config_json = ? WHERE id = 'block-home-hero'").run(JSON.stringify(custom)); // 模拟运营编辑
    seedCommerce(db); // 再播种
    const row = db.prepare("SELECT config_json FROM page_blocks WHERE id = 'block-home-hero'").get() as { config_json: string }; // 读回配置
    expect(JSON.parse(row.config_json)).toEqual(custom); // 原样保留
  }); // 代码块结束
}); // 代码块结束

describe('页面搭建管理清单', () => { // 调用 describe 并处理其返回结果
  it('匿名读取管理清单返回 401', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).get('/api/v1/pages/home/manage'); // 管理端清单
    expect(res.status).toBe(401); // 未登录拒绝
  }); // 代码块结束

  it('管理令牌可读取含停用项的全量区块，公开接口只返回启用项', async () => { // 调用 it 并处理其返回结果
    db.prepare("UPDATE page_blocks SET enabled = 0 WHERE id = 'block-home-features'").run(); // 模拟运营隐藏区块
    const manage = await request(app).get('/api/v1/pages/home/manage').set('x-admin-token', ADMIN_TOKEN); // 管理端读取
    expect(manage.status).toBe(200); // 有权限放行
    const hidden = manage.body.blocks.find((b: { id: string }) => b.id === 'block-home-features'); // 定位隐藏区块
    expect(hidden).toBeTruthy(); // 停用项仍返回
    expect(hidden.enabled).toBe(0); // 可见性字段可供恢复
    const publicList = await request(app).get('/api/v1/pages/home'); // 公开读取
    expect(publicList.body.blocks.some((b: { id: string }) => b.id === 'block-home-features')).toBe(false); // 停用项不公开
  }); // 代码块结束
}); // 代码块结束

describe('外观总览读取与写同口径（appearance:write）', () => { // 引导令牌与 Bearer 管理员都该能读，不能出现「能写不能读」
  it('匿名读取总览返回 401', async () => { // 读接口不再是登录即放行，必须持有 appearance:write
    const res = await request(app).get('/api/v1/appearance'); // 不带任何凭证
    expect(res.status).toBe(401); // 未登录拒绝
  }); // 代码块结束

  it('引导令牌可读取当前主题配置', async () => { // 冷启动只有引导令牌，必须能读到现有配置
    const res = await request(app).get('/api/v1/appearance').set('x-admin-token', ADMIN_TOKEN); // 引导通道
    expect(res.status).toBe(200); // 放行
    expect(res.body.settings.theme).toBeTruthy(); // 主题配置已返回
    expect(Array.isArray(res.body.pages)).toBe(true); // 页面清单结构不变
  }); // 代码块结束

  it('Bearer 无角色 403；授予 operator 后可读，保存后读回一致', async () => { // 普通管理员走同一套 RBAC
    const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier: '13800000091' }); // 申请验证码
    expect(codeRes.status).toBe(201); // 验证码已创建
    const loginRes = await request(app) // 用验证码换令牌
      .post('/api/v1/auth/login') // 登录端点
      .send({ region: 'cn', provider: 'phone', identifier: '13800000091', code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } }); // 登录入参
    expect(loginRes.status).toBe(200); // 登录成功
    const bearer = { Authorization: `Bearer ${loginRes.body.access_token as string}` }; // 仅带 Bearer
    const denied = await request(app).get('/api/v1/appearance').set(bearer); // 未授权角色
    expect(denied.status).toBe(403); // 缺 appearance:write
    expect(denied.body.details.permission).toBe('appearance:write'); // 回显缺失权限点
    const granted = await request(app) // 用引导通道授予运营角色
      .post(`/api/v1/admin/users/${loginRes.body.user.id as string}/roles`) // 授权端点
      .set('x-admin-token', ADMIN_TOKEN) // 引导令牌
      .send({ role_code: 'operator' }); // 运营角色自带 appearance:write
    expect(granted.status).toBe(201); // 首次授权
    const read = await request(app).get('/api/v1/appearance').set(bearer); // Bearer 读取
    expect(read.status).toBe(200); // 与写同口径放行
    const saved = await request(app) // Bearer 保存主题
      .put('/api/v1/appearance/settings') // 写接口
      .set(bearer) // 仅带 Bearer
      .set('Idempotency-Key', 'appearance-bearer-save-1') // 写操作必传幂等键
      .send({ key: 'theme', value: { accent: '#0ea5e9', radius: 10, list_style: 'comfortable' } }); // 主题入参
    expect(saved.status).toBe(200); // 保存成功
    const readBack = await request(app).get('/api/v1/appearance').set(bearer); // 读回确认
    expect(readBack.body.settings.theme.accent).toBe('#0ea5e9'); // 保存后读回一致
  }); // 代码块结束
}); // 代码块结束

describe('外观写操作权限门禁', () => { // 调用 describe 并处理其返回结果
  it('匿名更新设置返回 401', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).put('/api/v1/appearance/settings').send({ key: 'theme', value: { accent: '#111111' } }); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(401); // 未登录拒绝
  }); // 代码块结束

  it('引导令牌可更新主题，公开配置随之生效', async () => { // 调用 it 并处理其返回结果
    const put = await request(app) // 准备：构造本用例需要的输入或句柄
      .put('/api/v1/appearance/settings') // 注册 PUT 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'appearance-theme-1') // 执行当前业务步骤
      .send({ key: 'theme', value: { accent: '#7c3aed', radius: 12, list_style: 'compact' } }); // 执行当前业务步骤
    expect(put.status).toBe(200); // 写入成功
    const cfg = await request(app).get('/api/v1/site/config'); // 重读公开配置
    expect(cfg.body.theme.accent).toBe('#7c3aed'); // 主色已生效
    expect(cfg.body.theme.list_style).toBe('compact'); // 列表样式已生效
  }); // 代码块结束

  it('引导令牌可新建区块并按排序出现在公开清单', async () => { // 调用 it 并处理其返回结果
    const create = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/pages/home/blocks') // 注册 POST 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'appearance-block-1') // 执行当前业务步骤
      .send({ kind: 'notice', sort_order: 99, config: { title: '测试公告' } }); // 执行当前业务步骤
    expect(create.status).toBe(201); // 新建成功
    const list = await request(app).get('/api/v1/pages/home'); // 公开读取
    expect(list.body.blocks.some((b: { kind: string }) => b.kind === 'notice')).toBe(true); // 新区块可见
  }); // 代码块结束
}); // 代码块结束
