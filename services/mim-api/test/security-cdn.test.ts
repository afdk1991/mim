/** CDN 适配层测试：回源缓存策略分类 / 厂商齐备度判定 / 未配置不假装刷新成功（纯函数 + 未配置路径，不触网） */

import { beforeEach, describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // supertest 进程内驱动 Express
import type { Express } from 'express'; // 仅引入类型
import { classifyCachePolicy, describeCdn, purgeCdn, detectCdnProvider } from '../src/cdn.js'; // 引入依赖、类型或本地模块绑定
import { createCacheHeaderMiddleware } from '../src/middleware.js'; // 公共缓存头中间件：校验已认证请求不被公共缓存
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import type { Db } from '../src/types.js'; // 依赖与数据库类型
import { registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录

describe('CDN 回源缓存策略分类', () => { // 调用 describe 并处理其返回结果
  it('带 hash 的静态产物 → 不可变长缓存', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/assets/app.abc123456.js')).toEqual({ // 调用 expect 并处理其返回结果
      category: 'immutable-asset', // 对象字段 category：记录一项配置或数据
      'Cache-Control': 'public, max-age=31536000, immutable', // 执行当前业务步骤
    }); // 代码块结束
    expect(classifyCachePolicy('/static/logo-9f8e7d6c5b4a.png').category).toBe('immutable-asset'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('HTML 页面 → no-cache 协商缓存', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/index.html', 'text/html').category).toBe('html-swr'); // 调用 expect 并处理其返回结果
    expect(classifyCachePolicy('/about.htm').category).toBe('html-swr'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('API 路径 → 私有 no-store', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/api/v1/me').category).toBe('api-private'); // 调用 expect 并处理其返回结果
    expect(classifyCachePolicy('/api/v1/me')['Cache-Control']).toBe('private, no-store'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('其余静态资源 → 缺省短公共缓存', () => { // 调用 it 并处理其返回结果
    expect(classifyCachePolicy('/static/banner.png').category).toBe('default-public'); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('CDN 厂商齐备度如实判定', () => { // 调用 describe 并处理其返回结果
  it('未配置 / 非法 provider → none 且 configured=false', () => { // 调用 it 并处理其返回结果
    expect(detectCdnProvider({})).toBe('none'); // 调用 expect 并处理其返回结果
    expect(detectCdnProvider({ MIM_CDN_PROVIDER: 'cloudfrontx' })).toBe('none'); // 调用 expect 并处理其返回结果
    const status = describeCdn({}); // 常量 status：保存固定配置或一次性派生值
    expect(status.provider).toBe('none'); // 调用 expect 并处理其返回结果
    expect(status.configured).toBe(false); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudflare 缺 token/zone → configured=false 并列出缺失变量', () => { // 调用 it 并处理其返回结果
    const status = describeCdn({ MIM_CDN_PROVIDER: 'cloudflare' }); // 常量 status：保存固定配置或一次性派生值
    expect(status.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(status.missing).toContain('MIM_CDN_CLOUDFLARE_ZONE_ID'); // 调用 expect 并处理其返回结果
    expect(status.missing).toContain('MIM_CDN_CLOUDFLARE_API_TOKEN'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudflare 凭证齐备 → configured=true', () => { // 调用 it 并处理其返回结果
    const status = describeCdn({ // 常量 status：保存固定配置或一次性派生值
      MIM_CDN_PROVIDER: 'cloudflare', // 对象字段 MIM_CDN_PROVIDER：记录一项配置或数据
      MIM_CDN_CLOUDFLARE_ZONE_ID: 'zone', // 对象字段 MIM_CDN_CLOUDFLARE_ZONE_ID：记录一项配置或数据
      MIM_CDN_CLOUDFLARE_API_TOKEN: 'token', // 对象字段 MIM_CDN_CLOUDFLARE_API_TOKEN：记录一项配置或数据
    }); // 代码块结束
    expect(status.configured).toBe(true); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudfront 即使凭证齐备也显式标记不支持（supported=false，CDN_PROVIDER_UNSUPPORTED）', () => {
    const status = describeCdn({ // 常量 status：保存固定配置或一次性派生值
      MIM_CDN_PROVIDER: 'cloudfront', // 对象字段 MIM_CDN_PROVIDER：记录一项配置或数据
      MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID: 'dist', // 对象字段 MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID：记录一项配置或数据
      MIM_CDN_AWS_ACCESS_KEY_ID: 'ak', // 对象字段 MIM_CDN_AWS_ACCESS_KEY_ID：记录一项配置或数据
      MIM_CDN_AWS_SECRET_ACCESS_KEY: 'sk', // 对象字段 MIM_CDN_AWS_SECRET_ACCESS_KEY：记录一项配置或数据
    }); // 代码块结束
    expect(status.provider).toBe('cloudfront'); // 调用 expect 并处理其返回结果
    expect(status.supported).toBe(false); // 调用 expect 并处理其返回结果
    expect(status.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(status.note).toMatch(/CDN_PROVIDER_UNSUPPORTED/); // 调用 expect 并处理其返回结果
    expect(status.note).toMatch(/版本化文件名/); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('公共缓存头中间件：已认证请求不进缓存', () => { // 调用 describe 并处理其返回结果
  /** 最小 res/req 假件：只覆盖中间件会触碰的方法 */
  function fakeCtx(headers: Record<string, string>) { // 常量 fakeCtx：保存固定配置或一次性派生值
    const set: Record<string, string> = {}; // 记录被写入的响应头
    const res = { // 常量 res：保存固定配置或一次性派生值
      json: (body: unknown) => body, // 原样返回，便于断言
      setHeader: (k: string, v: string) => { set[k] = v; }, // 收集响应头
      status: () => res, // 链式调用
      removeHeader: () => undefined, // 304 分支用
      end: () => undefined, // 304 分支用
    }; // 代码块结束
    const req = { // 常量 req：保存固定配置或一次性派生值
      method: 'GET', // 只读方法
      header: (name: string) => headers[name.toLowerCase()], // 头读取（express 会小写化）
    }; // 代码块结束
    return { req, res, set }; // 返回三者供断言
  } // 代码块结束

  it('带 Authorization → private, no-store 且不下发 ETag / 304', () => { // 调用 it 并处理其返回结果
    const { req, res, set } = fakeCtx({ authorization: 'Bearer token' }); // 常量解构取值
    let nextCalled = false; // 记录是否放行到业务路由
    createCacheHeaderMiddleware({ maxAgeSeconds: 60, scope: 'public' })(req as never, res as never, () => { nextCalled = true; }); // 执行中间件
    expect(nextCalled).toBe(true); // 必须放行，不能被中间件拦下
    expect(set['Cache-Control']).toBe('private, no-store'); // 私有数据禁止缓存
    expect(set.ETag).toBeUndefined(); // 不做条件请求，避免 304 回旧数据
  }); // 代码块结束

  it('匿名只读请求仍按公共短缓存下发 ETag', () => { // 调用 it 并处理其返回结果
    const { req, res, set } = fakeCtx({}); // 常量解构取值
    createCacheHeaderMiddleware({ maxAgeSeconds: 60, scope: 'public' })(req as never, res as never, () => undefined); // 执行中间件
    (res.json as (b: unknown) => unknown)({ ok: true }); // 走一次响应输出，触发缓存头写入
    expect(set['Cache-Control']).toBe('public, max-age=60'); // 公开只读端点行为不变
    expect(set.ETag).toMatch(/^W\//); // 仍有弱 ETag
  }); // 代码块结束
}); // 代码块结束

describe('purgeCdn 未配置路径不假装成功', () => { // 调用 describe 并处理其返回结果
  it('none / 未配置 → ok=false、supported=false、configured=false、错误码 CDN_NOT_CONFIGURED', async () => { // 调用 it 并处理其返回结果
    const result = await purgeCdn({}, ['https://mim.mixm.top/a.js']); // 常量 result：保存固定配置或一次性派生值
    expect(result.ok).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.supported).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.error).toMatch(/CDN_NOT_CONFIGURED/); // 调用 expect 并处理其返回结果
    expect(result.purged).toEqual([]); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudflare 缺凭证 → 不发网络请求，返回 CDN_NOT_CONFIGURED，supported=true', async () => { // 调用 it 并处理其返回结果
    const result = await purgeCdn({ MIM_CDN_PROVIDER: 'cloudflare' }, ['https://mim.mixm.top/a.css']); // 常量 result：保存固定配置或一次性派生值
    expect(result.ok).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.supported).toBe(true); // 调用 expect 并处理其返回结果
    expect(result.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.error).toMatch(/CDN_NOT_CONFIGURED/); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('cloudfront → 显式不支持：supported=false、错误码 CDN_PROVIDER_UNSUPPORTED，不调用上游', async () => {
    const result = await purgeCdn( // 常量 result：保存固定配置或一次性派生值
      { MIM_CDN_PROVIDER: 'cloudfront', MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID: 'd' }, // 执行当前业务步骤
      ['https://mim.mixm.top/a.js'], // 执行当前业务步骤
    ); // 执行当前业务步骤
    expect(result.ok).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.supported).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(result.error).toMatch(/CDN_PROVIDER_UNSUPPORTED/); // 调用 expect 并处理其返回结果
    expect(result.error).toMatch(/版本化文件名/); // 调用 expect 并处理其返回结果
    expect(result.purged).toEqual([]); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('POST /security/cdn/purge 不支持口径与审计留痕', () => { // 调用 describe 并处理其返回结果
  const JWT_SECRET = 'cdn-route-test-secret-0123456789abcd'; // 固定测试密钥

  let db: Db; // 内存库
  let app: Express; // 待测应用

  beforeEach(() => { // 每例前置：重建内存库，厂商固定 cloudfront
    db = createDatabase(':memory:'); // 全新内存库
    app = createApp({ // 真实 Express 应用
      db, // 执行当前业务步骤
      jwtSecret: JWT_SECRET, // 对象字段 jwtSecret：记录一项配置或数据
      env: { MIM_CDN_PROVIDER: 'cloudfront' }, // 对象字段 env：记录一项配置或数据
    }); // 代码块结束
  }); // 代码块结束

  it('cloudfront 管理员 purge → 503，supported=false + CDN_PROVIDER_UNSUPPORTED，cdn_purge_audit 留痕 attempted/unsupported', async () => {
    const { token, userId } = await registerTestAccount(app, '13922000099'); // 注册真实账号
    const now = new Date().toISOString(); // 常量 now：记录审计时间戳
    const roleCode = 'role-cdn-unsupported'; // 常量 roleCode：自定义角色
    db.prepare("INSERT INTO roles (code, name_i18n, description_i18n, builtin, created_at, updated_at) VALUES (?, '{}', '{}', 0, ?, ?)").run(roleCode, now, now); // 建角色
    db.prepare('INSERT OR IGNORE INTO role_permissions (role_code, permission_code, created_at) VALUES (?, ?, ?)').run(roleCode, 'commerce:write', now); // 授管理权限
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_code, granted_by, created_at) VALUES (?, ?, ?, ?)').run(userId, roleCode, 'test', now); // 绑角色

    const res = await request(app) // 常量 res：保存固定配置或一次性派生值
      .post('/api/v1/security/cdn/purge') // 管理 purge 端点
      .set('Authorization', `Bearer ${token}`) // 正常 JWT 通道（该路由 requireAuth 先行）
      .set('idempotency-key', 'cdn-purge-unsupported-1') // 写操作幂等键
      .send({ urls: ['https://zy.laal.top/a.js'] }); // 常量 body：记录一项配置或数据
    expect(res.status).toBe(503); // 不支持 / 未配置口径回落 503
    expect(res.body.ok).toBe(false); // 调用 expect 并处理其返回结果
    expect(res.body.supported).toBe(false); // 调用 expect 并处理其返回结果
    expect(res.body.configured).toBe(false); // 调用 expect 并处理其返回结果
    expect(res.body.error).toMatch(/CDN_PROVIDER_UNSUPPORTED/); // 调用 expect 并处理其返回结果

    const row = db.prepare('SELECT provider, ok, configured, error FROM cdn_purge_audit WHERE provider = ?').get('cloudfront') as // 回读审计留痕
      | { provider: string; ok: number; configured: number; error: string | null } // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    expect(row).toBeTruthy(); // 即使不支持也必须落一条 attempted/unsupported 审计
    expect(row!.ok).toBe(0); // 调用 expect 并处理其返回结果
    expect(row!.configured).toBe(0); // 调用 expect 并处理其返回结果
    expect(row!.error).toMatch(/CDN_PROVIDER_UNSUPPORTED/); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束
