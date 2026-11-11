/** 契约测试：匿名访客会话（免登录体验入口）/ 访客令牌可用性 / 建号频控 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排 API：每例重建内存库，保证用例隔离
import request from 'supertest'; // supertest 在进程内驱动 Express，无需真实端口
import type { Express } from 'express'; // Express 类型，用于标注被测应用
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 建库函数，:memory: 保证每例干净

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，满足强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库句柄

beforeEach(() => { // 每例前置：全新内存库 + 全新应用
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 空 env：不依赖任何外部通道
}); // beforeEach 结束

/** 领取一个访客会话，返回原始响应 */
async function guest(payload: Record<string, unknown> = {}) {
  return request(app).post('/api/v1/auth/guest').send(payload); // 公开端点，不携带任何身份
} // guest 结束

describe('匿名访客会话', () => { // 免登录体验的核心入口
  it('不传任何参数即返回可用会话与访客标记', async () => { // 正常路径
    const res = await guest(); // 空请求体
    expect(res.status).toBe(200); // 与登录同形状的成功响应
    expect(res.body.access_token).toBeTypeOf('string'); // 直接下发访问令牌
    expect(res.body.refresh_token).toBeTypeOf('string'); // 刷新令牌同时下发
    expect(res.body.user.is_guest).toBe(true); // 标记为匿名访客
    expect(res.body.user.member_no).toMatch(/^MIM-\d{8}$/); // 访客同样自动分配 Mim ID 号码
    expect(res.body.user.region).toBe('cn'); // 缺省中国区
    expect(res.body.user.display_name).toBe('访客'); // 中文区展示名
  }); // 结束用例

  it('指定 global 区域时展示名与区域随之切换', async () => { // 区域分支
    const res = await guest({ region: 'global' }); // 海外区
    expect(res.body.user.region).toBe('global'); // 区域按请求
    expect(res.body.user.display_name).toBe('Guest'); // 英文展示名
    expect(res.body.user.locale).toBe('en-US'); // 默认语言随区域
  }); // 结束用例

  it('访客令牌可直接访问受保护接口 /me', async () => { // 证明功能不再需要登录
    const res = await guest(); // 领访客会话
    const me = await request(app) // 受 requireAuth 保护的接口
      .get('/api/v1/me') // 个人资料
      .set('Authorization', `Bearer ${res.body.access_token}`); // 访客令牌
    expect(me.status).toBe(200); // 鉴权通过
    expect(me.body.user.is_guest).toBe(true); // /me 同样回传访客标记
    expect(me.body.user.id).toBe(res.body.user.id); // 同一账号
  }); // 结束用例

  it('同一 IP 连续建号超过上限返回 429 AUTH_GUEST_RATE_LIMITED', async () => { // 频控
    let limited: request.Response | null = null; // 命中限流的那次响应
    for (let i = 0; i < 40 && limited === null; i += 1) { // 上限 30（本文件前面用例也已消耗计数），循环到命中为止
      const res = await guest(); // 连续领取
      if (res.status === 429) limited = res; // 命中即停止
    } // 循环结束
    expect(limited).not.toBeNull(); // 必须触发限流，否则建号无限增长
    expect(limited!.body.code).toBe('AUTH_GUEST_RATE_LIMITED'); // 专用错误码，前端据此提示稍后重试
  }); // 结束用例
}); // describe 结束
