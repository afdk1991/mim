/**
 * OAuth 注册表测试：14 家清单、configured 真假如实标注、区域过滤、
 * 未配置 503、state 不匹配拒绝。测试自建 mini app，只挂载 OAuth 路由。
 */

import express from 'express'; // 组装 mini app
import { describe, expect, it } from 'vitest'; // vitest 用例编排与断言
import request from 'supertest'; // HTTP 断言
import { createDatabase } from '../src/db.js'; // 内存库
import { createOAuthRouter } from '../src/routes/oauth.js'; // 被测路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import { OAUTH_PROVIDERS } from '../src/oauth/providers.js'; // 注册表
import type { ApiDeps } from '../src/types.js'; // 依赖容器

/** 组装只含 OAuth 路由的 mini app */
function miniApp(deps: ApiDeps) { // 依赖显式注入
  const app = express(); // 独立实例
  app.use(express.json()); // 解析 JSON
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createOAuthRouter(deps)); // 挂载被测路由
  app.use(errorHandler); // 统一错误处理
  return app; // 交出实例
} // miniApp 结束

/** 期望的 14 家标识，顺序与注册表一致 */
const EXPECTED_IDS = ['github', 'gitee', 'gitlab', 'google', 'microsoft', 'apple', 'wechat', 'qq', 'douyin', 'weibo', 'baidu', 'alipay', 'facebook', 'twitter']; // 准备：构造本用例需要的输入或句柄

describe('OAuth 注册表（14 家）', () => { // 注册表维度
  it('注册表包含 14 家且顺序固定', () => { // 清单完整性
    expect(OAUTH_PROVIDERS.map((item) => item.id)).toEqual(EXPECTED_IDS); // 逐位比对
    expect(OAUTH_PROVIDERS).toHaveLength(14); // 数量断言
  }); // 结束清单用例

  it('新增五家区域归属正确：微博/百度/支付宝 cn，Facebook/Twitter global', () => { // 区域维度
    const byId = Object.fromEntries(OAUTH_PROVIDERS.map((item) => [item.id, item])); // 索引化
    expect(byId.weibo.region).toBe('cn'); // 微博国内
    expect(byId.baidu.region).toBe('cn'); // 百度国内
    expect(byId.alipay.region).toBe('cn'); // 支付宝国内
    expect(byId.facebook.region).toBe('global'); // Facebook 海外
    expect(byId.twitter.region).toBe('global'); // X 海外
  }); // 结束区域用例

  it('公开清单返回 14 家；无任何凭证时 configured 全部为 false', async () => { // 默认未配置态
    const deps: ApiDeps = { db: createDatabase(':memory:'), jwtSecret: 'test-secret', env: {} }; // 空环境
    const app = miniApp(deps); // 挂载
    const res = await request(app).get('/api/v1/auth/oauth/providers'); // 公开能力查询
    expect(res.status).toBe(200); // 清单公开
    expect(res.body.providers).toHaveLength(14); // 14 家都回显
    for (const provider of res.body.providers) { // 逐家核查
      expect(provider.configured).toBe(false); // 未配置一律 false
      expect(provider.label).toBeTruthy(); // 展示名存在
      expect(provider.label_en).toBeTruthy(); // 英文名存在
    } // 逐家结束
  }); // 结束默认态用例

  it('只有配齐凭证的一家 configured=true，其余仍为 false', async () => { // 配置如实标注
    const deps: ApiDeps = { // 只给 GitHub 凭证
      db: createDatabase(':memory:'), // 内存库
      jwtSecret: 'test-secret', // 签名密钥
      env: { // 环境变量
        MIM_OAUTH_CALLBACK_BASE: 'http://localhost:3000', // 回调基址
        MIM_AUTH_GITHUB_CLIENT_ID: 'gh-client', // GitHub 应用 ID
        MIM_AUTH_GITHUB_CLIENT_SECRET: 'gh-secret', // GitHub 密钥
      }, // env 结束
    }; // deps 结束
    const app = miniApp(deps); // 挂载
    const res = await request(app).get('/api/v1/auth/oauth/providers'); // 清单
    const byId = Object.fromEntries(res.body.providers.map((item: { id: string; configured: boolean }) => [item.id, item])); // 索引化
    expect(byId.github.configured).toBe(true); // GitHub 配齐
    expect(byId.weibo.configured).toBe(false); // 微博未配齐
    expect(byId.facebook.configured).toBe(false); // Facebook 未配齐
    expect(byId.twitter.configured).toBe(false); // X 未配齐
  }); // 结束配置标注用例

  it('region=cn 过滤掉仅海外提供方，region=global 过滤掉仅国内提供方', async () => { // 区域过滤
    const deps: ApiDeps = { db: createDatabase(':memory:'), jwtSecret: 'test-secret', env: {} }; // 空环境
    const app = miniApp(deps); // 挂载
    const cn = await request(app).get('/api/v1/auth/oauth/providers?region=cn'); // 国内视角
    const global = await request(app).get('/api/v1/auth/oauth/providers?region=global'); // 海外视角
    const cnIds = cn.body.providers.map((item: { id: string }) => item.id); // 国内清单
    const globalIds = global.body.providers.map((item: { id: string }) => item.id); // 海外清单
    expect(cnIds).toContain('weibo'); // 微博在国内
    expect(cnIds).toContain('alipay'); // 支付宝在国内
    expect(cnIds).not.toContain('facebook'); // Facebook 不在国内
    expect(cnIds).not.toContain('twitter'); // X 不在国内
    expect(globalIds).toContain('facebook'); // Facebook 在海外
    expect(globalIds).toContain('twitter'); // X 在海外
    expect(globalIds).not.toContain('weibo'); // 微博不在海外
  }); // 结束区域过滤用例

  it('未配置凭证的提供方发起授权返回 503 明确错误码', async () => { // 503 语义
    const deps: ApiDeps = { db: createDatabase(':memory:'), jwtSecret: 'test-secret', env: {} }; // 空环境
    const app = miniApp(deps); // 挂载
    const res = await request(app).post('/api/v1/auth/oauth/weibo/authorize').send({ mode: 'login' }); // 微博未配置
    expect(res.status).toBe(503); // 未配置即不可用
    expect(res.body.code).toBe('AUTH_OAUTH_NOT_CONFIGURED'); // 明确错误码
  }); // 结束 503 用例

  it('回调 state 不匹配（查不到一次性 state）时 302 回登录页并带 STATE_INVALID', async () => { // state 校验
    const deps: ApiDeps = { db: createDatabase(':memory:'), jwtSecret: 'test-secret', env: {} }; // 空环境
    const app = miniApp(deps); // 挂载
    const res = await request(app).get('/api/v1/auth/oauth/weibo/callback?state=random-bogus-state&code=auth-code'); // 伪造 state
    expect(res.status).toBe(302); // 浏览器重定向回登录页
    expect(res.headers.location).toContain('oauth_error=AUTH_OAUTH_STATE_INVALID'); // 错误码入回跳地址
  }); // 结束 state 用例

  it('配齐凭证的 GitHub 发起授权返回授权地址与一次性 state', async () => { // 发起链路
    const deps: ApiDeps = { // GitHub 已配置
      db: createDatabase(':memory:'), // 内存库
      jwtSecret: 'test-secret', // 密钥
      env: { MIM_OAUTH_CALLBACK_BASE: 'http://localhost:3000', MIM_AUTH_GITHUB_CLIENT_ID: 'gh-client', MIM_AUTH_GITHUB_CLIENT_SECRET: 'gh-secret' }, // 凭证
    }; // deps 结束
    const app = miniApp(deps); // 挂载
    const res = await request(app).post('/api/v1/auth/oauth/github/authorize').send({ mode: 'login' }); // 发起
    expect(res.status).toBe(201); // 签发成功
    expect(res.body.authorization_url).toContain('github.com/login/oauth/authorize'); // 指向 GitHub 授权页
    expect(typeof res.body.state).toBe('string'); // 一次性 state
    expect(res.body.state.length).toBeGreaterThan(16); // 高熵 state
  }); // 结束发起链路用例
}); // 结束 describe
