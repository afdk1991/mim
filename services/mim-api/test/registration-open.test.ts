/** 契约测试：注册总开关打开后，自助注册走完整建号流程并可立即登录（测试库内建号，用完清理） */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // vitest 编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const OPEN_ENV = { MIM_REGISTRATION_ENABLED: '1' }; // 显式开启注册（非生产环境验证码默认 off）
const IDENTIFIER = '13900000001'; // 本用例专用手机号，避免与其它用例撞号
const PASSWORD = 'test-pass-123'; // 满足 >=8 位且含字母与数字的注册口令

let db: ReturnType<typeof createDatabase>; // 共享内存库
let app: Express; // 开启注册的应用实例
let createdUserId: string | null = null; // 本用例建出的用户主键，用于收尾清理

beforeEach(() => { // 每例重建，保证隔离
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: OPEN_ENV }); // 开启注册的应用
  createdUserId = null; // 重置清理锚点
});

afterEach(() => { // 用完清理：内存库随进程销毁，但按要求显式删除本用例建出的行
  if (!createdUserId) return; // 未建号则无需清理
  const userId = createdUserId; // 固定局部变量，避免闭包歧义
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); // 会话
  db.prepare('DELETE FROM credentials WHERE user_id = ?').run(userId); // 凭据
  db.prepare('DELETE FROM identities WHERE user_id = ?').run(userId); // 登录身份
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId); // 角色绑定
  db.prepare('DELETE FROM users WHERE id = ?').run(userId); // 用户主键
});

describe('注册总开关打开', () => {
  it('channels 上报 register=true，前端据此显示注册入口', async () => {
    const channels = await request(app).get('/api/v1/auth/channels'); // 读取渠道能力
    expect(channels.status).toBe(200); // 公开接口
    expect(channels.body.register).toBe(true); // 开关打开后入口可见
  });

  it('自助注册成功建号：返回 201、Mim ID 号码与令牌，且可立即用口令登录', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      region: 'cn', // 区域：国内
      provider: 'phone', // 渠道：手机号
      identifier: IDENTIFIER, // 登录标识
      password: PASSWORD, // 登录口令
      display_name: '注册开关测试', // 展示昵称
    });
    expect(reg.status).toBe(201); // 建号成功
    expect(reg.body.access_token).toBeTruthy(); // 建号后自动登录
    expect(reg.body.user?.member_no).toMatch(/^\d+$/); // 与后台手工建号同一套 Mim ID 规则（纯数字）
    createdUserId = reg.body.user?.id as string; // 记录主键供收尾清理

    const login = await request(app).post('/api/v1/auth/password').send({
      region: 'cn', // 区域：国内
      provider: 'phone', // 渠道：手机号
      identifier: IDENTIFIER, // 同一登录标识
      password: PASSWORD, // 同一口令
    });
    expect(login.status).toBe(200); // 注册后可正常登录
    expect(login.body.user?.id).toBe(createdUserId); // 登录落到同一个账号
  });

  it('重复手机号注册返回 409，不会建出第二个号', async () => {
    const first = await request(app).post('/api/v1/auth/register').send({
      region: 'cn', provider: 'phone', identifier: IDENTIFIER, password: PASSWORD,
    });
    expect(first.status).toBe(201); // 首个注册成功
    createdUserId = first.body.user?.id as string; // 记录主键供收尾清理

    const second = await request(app).post('/api/v1/auth/register').send({
      region: 'cn', provider: 'phone', identifier: IDENTIFIER, password: PASSWORD,
    });
    expect(second.status).toBe(409); // 同区域同类型标识唯一
  });
});
