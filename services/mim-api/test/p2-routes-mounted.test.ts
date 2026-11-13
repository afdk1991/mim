/** P2 路由挂载冒烟：实名 / 邀请码 / SSO 必须挂在主应用上，不能只存在于测试 mini app。 */

import request from 'supertest'; // HTTP 断言
import { describe, expect, it } from 'vitest'; // 测试编排
import { createApp } from '../src/app.js'; // 主应用工厂
import { createDatabase } from '../src/db.js'; // 内存库

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试签名密钥

describe('P2 路由已接入主应用', () => { // 调用 describe 并处理其返回结果
  it('实名状态 / 邀请码管理 / SSO 兑换返回业务错误而不是 404', async () => { // 调用 it 并处理其返回结果
    const db = createDatabase(':memory:'); // 每次用例独立内存库
    const app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 不注入任何外部通道

    const realname = await request(app).get('/api/v1/auth/realname/status'); // 未登录访问实名状态
    expect(realname.status).toBe(401); // 证明路由已挂载并由 requireAuth 拦截

    const invites = await request(app).get('/api/v1/admin/invites'); // 未登录访问邀请码列表
    expect(invites.status).toBe(401); // 证明管理路由已挂载并由权限中间件拦截

    const sso = await request(app).post('/api/v1/auth/sso/exchange').send({ ticket: 'invalid-ticket' }); // 非法票据兑换
    expect(sso.status).toBe(401); // 证明 SSO 路由已挂载且票据校验生效
    expect(sso.body.code).toBe('AUTH_SSO_TICKET_INVALID'); // 返回明确业务错误码

    const announcements = await request(app).get('/api/v1/announcements'); // 公开公告列表
    expect(announcements.status).toBe(200); // 主应用已挂载内容运营路由
    expect(Array.isArray(announcements.body.items)).toBe(true); // 冻结契约返回 items 数组

    const changelog = await request(app).get('/api/v1/changelog'); // 公开更新日志
    expect(changelog.status).toBe(200); // 证明更新日志端点不是 404

    const tools = await request(app).get('/api/v1/tools'); // 自研工具公开目录
    expect(tools.status).toBe(200); // 证明工具路由已挂载
  }); // 代码块结束
}); // 代码块结束
