/**
 * 联邦身份 OIDC 客户端契约测试（批次 6 · P1-4）。
 *
 * 测试环境四项凭证全部缺省 → configured=false，覆盖：
 *   - GET  /auth/oidc/status    未配置态：200，configured=false、issuer=null
 *   - GET  /auth/oidc/login     未配置态：503 AUTH_OAUTH_NOT_CONFIGURED（诚实降级，不伪造跳转）
 *   - GET  /auth/oidc/callback 错误态：缺 state / state 无效一律 302 回登录页带 oauth_error
 *
 * 不伪造 IdP：已配置态的换票 / 建号链路由既有 oauth-providers 测试与集成环境覆盖。
 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排 API，beforeEach 每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express
import type { Express } from 'express'; // 仅引入类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'federation-oidc-test-secret-0123456789abc'; // 固定测试密钥
const ADMIN_TOKEN = 'oidc-admin-token'; // 引导令牌（本套件不触发后台写，仅满足装配）

let app: Express; // 待测应用实例

beforeEach(() => { // 每例前置：重建内存库；env 不显式注入任何 MIM_OIDC_* 凭证
  const db = createDatabase(':memory:'); // 全新内存库，oauth_states 表为空
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 未配置 OIDC 四件套
}); // beforeEach 结束

describe('GET /auth/oidc/status 未配置态', () => {
  it('匿名 200：configured=false、issuer=null', async () => {
    const res = await request(app).get('/api/v1/auth/oidc/status'); // 公开探测端点
    expect(res.status).toBe(200); // 状态探测不拦鉴权
    expect(res.body.configured).toBe(false); // 四项凭证缺一即未配置
    expect(res.body.issuer).toBeNull(); // 未配置不回显 issuer 占位
  });
});

describe('GET /auth/oidc/login 未配置态', () => {
  it('未配置凭证 → 503 AUTH_OAUTH_NOT_CONFIGURED，不返回授权地址', async () => {
    const res = await request(app).get('/api/v1/auth/oidc/login'); // 发起授权
    expect(res.status).toBe(503); // 能力未就绪，语义为 503 而非参数错误
    expect(res.body.code).toBe('AUTH_OAUTH_NOT_CONFIGURED'); // 明确错误码
    expect(res.body.authorization_url).toBeUndefined(); // 未配置不伪造跳转地址
  });
});

describe('GET /auth/oidc/callback 错误态回跳', () => {
  it('缺 state → 302 回登录页，oauth_error=AUTH_OAUTH_STATE_INVALID', async () => {
    const res = await request(app).get('/api/v1/auth/oidc/callback?code=abc123'); // 只带 code 不带 state
    expect(res.status).toBe(302); // 任意失败统一 302 回登录页，避免浏览器停在 JSON 信封
    const location = String(res.headers.location); // 回跳地址
    expect(location).toContain('/signin'); // 回到前端登录页
    expect(location).toContain('oauth_error=AUTH_OAUTH_STATE_INVALID'); // 错误码进地址栏
  });

  it('state 不存在 / 已过期 → 302 回登录页，oauth_error=AUTH_OAUTH_STATE_INVALID', async () => {
    const res = await request(app).get('/api/v1/auth/oidc/callback?state=never-seen-state&code=abc123'); // 未知 state
    expect(res.status).toBe(302); // 防重放：一次性 state 校验失败同样回登录页
    const location = String(res.headers.location);
    expect(location).toContain('/signin');
    expect(location).toContain('oauth_error=AUTH_OAUTH_STATE_INVALID');
  });
});
