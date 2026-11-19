/** 契约测试：全站强制登录（MIM_FORCE_LOGIN 默认开启）+ 后台豁免 + 超管手工建号 / 重置口令 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { isForceLoginEnabled } from '../src/config.js'; // 开关读取函数
import { registerTestAccount, TEST_PASSWORD } from './_auth-helper.js'; // 建号辅助

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 超管引导令牌
/** 强制登录开启 + 注册开启（建号辅助要用自助注册铺数据） */
const GUARDED_ENV = { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_REGISTRATION_ENABLED: '1', MIM_FORCE_LOGIN: '1' };
/** 强制登录关闭：恢复历史「公开读」模型，用于回归对照 */
const OPEN_ENV = { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_REGISTRATION_ENABLED: '1', MIM_FORCE_LOGIN: '0' };
const ADMIN_HEADERS = { 'x-admin-token': ADMIN_TOKEN }; // 引导通道请求头

let db: ReturnType<typeof createDatabase>; // 共享内存库
let guarded: Express; // 强制登录开启的应用

beforeEach(() => {
  db = createDatabase(':memory:'); // 每例独立内存库，避免角色授权互相污染
  guarded = createApp({ db, jwtSecret: JWT_SECRET, env: GUARDED_ENV }); // 默认构建「强制登录开启」应用
});

describe('强制登录总开关', () => {
  it('默认开启：只有显式 0 / false / off 才关闭', () => {
    const saved = process.env.MIM_FORCE_LOGIN; // vitest 全局 env 里置了 0，测默认值需临时摘掉回落
    delete process.env.MIM_FORCE_LOGIN;
    try {
      expect(isForceLoginEnabled({})).toBe(true); // 未配置 = 开启
    } finally {
      if (saved === undefined) delete process.env.MIM_FORCE_LOGIN;
      else process.env.MIM_FORCE_LOGIN = saved;
    }
    expect(isForceLoginEnabled({ MIM_FORCE_LOGIN: '1' })).toBe(true);
    expect(isForceLoginEnabled({ MIM_FORCE_LOGIN: 'true' })).toBe(true);
    expect(isForceLoginEnabled({ MIM_FORCE_LOGIN: '0' })).toBe(false);
    expect(isForceLoginEnabled({ MIM_FORCE_LOGIN: 'false' })).toBe(false);
    expect(isForceLoginEnabled({ MIM_FORCE_LOGIN: 'off' })).toBe(false);
  });
});

describe('业务接口门禁（MIM_FORCE_LOGIN=1）', () => {
  it('匿名可读公开接口，写操作与私密读仍 401', async () => {
    const products = await request(guarded).get('/api/v1/shop/products');
    expect(products.status).toBe(200); // 独立商城商品匿名可读

    const boards = await request(guarded).get('/api/v1/community/boards');
    expect(boards.status).toBe(200); // 板块列表匿名可读

    const threads = await request(guarded).get('/api/v1/community/threads');
    expect(threads.status).toBe(200); // 社区列表匿名可读

    const overview = await request(guarded).get('/api/v1/community/overview');
    expect(overview.status).toBe(200); // 社区首页聚合匿名可读
    expect(overview.body.wallet).toMatchObject({ balance_cents: 0, points: 0 }); // 匿名不建钱包行

    const write = await request(guarded).post('/api/v1/community/threads').send({});
    expect(write.status).toBe(401); // 同一个前缀下的写操作仍需登录
    expect(write.body.code).toBe('AUTH_UNAUTHORIZED');

    const like = await request(guarded).post('/api/v1/community/threads/t_1/like').send({});
    expect(like.status).toBe(401); // 读详情的路径 + 写方法 → 仍被拦住

    const me = await request(guarded).get('/api/v1/me');
    expect(me.status).toBe(401); // 个人中心属私密读

    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    expect(users.n).toBe(0); // 门禁不落库建号
  });

  it('健康检查与登录链路保持公开', async () => {
    const health = await request(guarded).get('/health');
    expect(health.status).toBe(200);
    const healthz = await request(guarded).get('/api/v1/healthz');
    expect(healthz.status).toBe(200);
    const channels = await request(guarded).get('/api/v1/auth/channels');
    expect(channels.status).toBe(200); // 登录页据此渲染
    const site = await request(guarded).get('/api/v1/site/config');
    expect(site.status).toBe(200); // 登录页公开元数据
  });

  it('带有效令牌可正常访问业务接口', async () => {
    const { token } = await registerTestAccount(guarded, '13700000101');
    const me = await request(guarded).get('/api/v1/me').set('authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
  });

  it('存量令牌 / 无效令牌一律 401', async () => {
    const bad = await request(guarded).get('/api/v1/me').set('authorization', 'Bearer not-a-jwt');
    expect(bad.status).toBe(401);
  });

  it('MIM_FORCE_LOGIN=0 时恢复匿名读', async () => {
    const open = createApp({ db, jwtSecret: JWT_SECRET, env: OPEN_ENV });
    const products = await request(open).get('/api/v1/shop/products');
    expect(products.status).toBe(200); // 旧模型下公开商品仍可读
  });
});

describe('支付回调免登录', () => {
  it('扩展渠道回调不要求登录（验签失败也不是 401 门禁）', async () => {
    const res = await request(guarded).post('/api/v1/payments/sandbox/notify').send({});
    expect(res.status).not.toBe(401); // 未被门禁拦下；具体错误由回调自身验签决定
  });

});

describe('推广统计匿名上报（缺陷 D2 回归）', () => {
  it('点击 / 转化两个统计端点匿名放行，其它推广写仍 401', async () => {
    const click = await request(guarded).post('/api/v1/promotions/promo-seed-launch/click').send({}); // 匿名访客上报点击
    expect(click.status).toBe(200); // 不再被强制登录门禁拦成 401
    expect(click.body.ok).toBe(true); // 处理器正常入账
    const conversion = await request(guarded).post('/api/v1/promotions/promo-seed-launch/conversion').send({}); // 匿名访客上报转化
    expect(conversion.status).toBe(200); // 同上豁免
    expect(conversion.body.ok).toBe(true);
    const adminWrite = await request(guarded).post('/api/v1/admin/content/promotions').send({}); // 管理端推广 CRUD 不在豁免范围
    expect(adminWrite.status).toBe(401); // 仍要求登录 + RBAC 权限
  });
});

describe('后台豁免与管理员身份单独校验', () => {
  it('未认证访问 /api/v1/admin/* 返回 401，而非白屏或放行', async () => {
    const res = await request(guarded).get('/api/v1/admin/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('超管引导令牌可读取自身身份与全量权限', async () => {
    const res = await request(guarded).get('/api/v1/admin/me').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.bootstrap).toBe(true);
    expect(res.body.roles).toContain('superadmin');
    expect(res.body.permissions.length).toBe(8); // 与 RBAC_PERMISSIONS 一致（模块商城 4 个权限点已删除）
  });

  it('超管可手工建号：指定标识 / 初始口令 / 角色，建完即可登录', async () => {
    const created = await request(guarded)
      .post('/api/v1/admin/users')
      .set(ADMIN_HEADERS)
      .send({
        region: 'cn',
        provider: 'phone',
        identifier: '13700000201',
        password: 'Admin-pass-1',
        display_name: '手工账号',
        role_codes: ['viewer'],
      });
    expect(created.status).toBe(201);
    expect(created.body.roles).toEqual(['viewer']);

    const login = await request(guarded).post('/api/v1/auth/password').send({
      region: 'cn',
      provider: 'phone',
      identifier: '13700000201',
      password: 'Admin-pass-1',
    });
    expect(login.status).toBe(200); // 新账号可直接登录
    expect(login.body.access_token).toBeTruthy();

    const roles = db.prepare('SELECT role_code FROM user_roles WHERE user_id = ?').all(created.body.user.id) as Array<{
      role_code: string;
    }>;
    expect(roles.map((r) => r.role_code)).toEqual(['viewer']); // 角色已落库
  });

  it('重复标识建号返回 AUTH_IDENTITY_EXISTS(409)', async () => {
    await registerTestAccount(guarded, '13700000202');
    const dup = await request(guarded)
      .post('/api/v1/admin/users')
      .set(ADMIN_HEADERS)
      .send({ region: 'cn', provider: 'phone', identifier: '13700000202', password: 'Admin-pass-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('AUTH_IDENTITY_EXISTS');
  });

  it('弱口令被拒绝，未知角色返回 404', async () => {
    const weak = await request(guarded)
      .post('/api/v1/admin/users')
      .set(ADMIN_HEADERS)
      .send({ region: 'cn', provider: 'phone', identifier: '13700000203', password: '12345678' });
    expect(weak.status).toBe(400); // 缺字母，强度不足

    const unknownRole = await request(guarded)
      .post('/api/v1/admin/users')
      .set(ADMIN_HEADERS)
      .send({ region: 'cn', provider: 'phone', identifier: '13700000204', password: 'Admin-pass-1', role_codes: ['nope'] });
    expect(unknownRole.status).toBe(404);
  });

  it('超管可重置口令：旧口令失效、新口令可用、旧会话被吊销', async () => {
    const { userId } = await registerTestAccount(guarded, '13700000205');
    const reset = await request(guarded)
      .post(`/api/v1/admin/users/${userId}/password`)
      .set(ADMIN_HEADERS)
      .send({ password: 'Reset-pass-9' });
    expect(reset.status).toBe(200);
    expect(reset.body.sessions_revoked).toBeGreaterThanOrEqual(1); // 注册即建会话

    const liveAfterReset = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL').get(userId) as {
      n: number;
    };
    expect(liveAfterReset.n).toBe(0); // 重置前签发的会话已全部吊销（刷新令牌无法续期）

    const oldLogin = await request(guarded).post('/api/v1/auth/password').send({
      region: 'cn',
      provider: 'phone',
      identifier: '13700000205',
      password: TEST_PASSWORD,
    });
    expect(oldLogin.status).toBe(401); // 旧口令已失效

    const newLogin = await request(guarded).post('/api/v1/auth/password').send({
      region: 'cn',
      provider: 'phone',
      identifier: '13700000205',
      password: 'Reset-pass-9',
    });
    expect(newLogin.status).toBe(200); // 新口令可登录
  });
});
