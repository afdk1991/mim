/** 契约测试：注册总开关关闭时，所有新建账号路径均被后端硬拦，且存量账号登录不受影响 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { isRegistrationEnabled } from '../src/config.js'; // 开关读取函数
import { registerTestAccount, TEST_PASSWORD } from './_auth-helper.js'; // 建号辅助

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 管理令牌
const OPEN_ENV = { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_REGISTRATION_ENABLED: '1' }; // 显式开启（供货架建号用）
const CLOSED_ENV = { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_REGISTRATION_ENABLED: '0' }; // 显式关闭

let db: ReturnType<typeof createDatabase>; // 共享内存库：开启态建号，关闭态验证
let closed: Express; // 关闭注册的应用实例

beforeEach(() => { // 每例重建
  db = createDatabase(':memory:'); // 内存库
  closed = createApp({ db, jwtSecret: JWT_SECRET, env: CLOSED_ENV }); // 关闭注册的应用
});

describe('注册总开关', () => {
  it('开关默认关闭：未显式配置为 1 时不放行', () => {
    expect(isRegistrationEnabled({ MIM_REGISTRATION_ENABLED: '0' })).toBe(false); // 显式 0
    expect(isRegistrationEnabled({ MIM_REGISTRATION_ENABLED: 'true' })).toBe(false); // 非 1 一律关闭
    expect(isRegistrationEnabled({ MIM_REGISTRATION_ENABLED: '1' })).toBe(true); // 只有 1 开启
  });

  it('关闭后：自助注册返回 AUTH_REGISTER_DISABLED(403)，访客接口已移除(404)，channels.register=false', async () => {
    const reg = await request(closed).post('/api/v1/auth/register').send({
      region: 'cn',
      provider: 'phone',
      identifier: '13700000001',
      password: TEST_PASSWORD,
    });
    expect(reg.status).toBe(403); // 业务错误而非 500
    expect(reg.body.code).toBe('AUTH_REGISTER_DISABLED');

    const guest = await request(closed).post('/api/v1/auth/guest').send({});
    expect(guest.status).toBe(404); // 免登录建号接口已从路由表移除

    const channels = await request(closed).get('/api/v1/auth/channels');
    expect(channels.status).toBe(200);
    expect(channels.body.register).toBe(false); // 前端据此隐藏注册入口
  });

  it('关闭后：存量账号仍可正常登录', async () => {
    const open = createApp({ db, jwtSecret: JWT_SECRET, env: OPEN_ENV }); // 开启态应用，仅用于建号
    await registerTestAccount(open, '13700000002'); // 先建一个真实账号
    const login = await request(closed).post('/api/v1/auth/password').send({
      region: 'cn',
      provider: 'phone',
      identifier: '13700000002',
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200); // 存量登录不受开关影响
    expect(login.body.access_token).toBeTruthy();
  });
});
