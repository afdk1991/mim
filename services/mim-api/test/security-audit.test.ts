/** 安全加固包测试：百度内容审核适配器（provider=none 如实披露 / 降级策略 / 状态端点） */

import { describe, expect, it, beforeEach } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // 引入：声明测试所需依赖
import type { Express } from 'express'; // 引入：声明测试所需依赖
import { createApp } from '../src/app.js'; // 引入依赖、类型或本地模块绑定
import { createDatabase } from '../src/db.js'; // 引入依赖、类型或本地模块绑定
import { auditText, auditImage, auditConfigured, auditFallback } from '../src/security.js'; // 引入依赖、类型或本地模块绑定
import type { Db } from '../src/types.js'; // 引入：声明测试所需依赖

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 构造：准备本用例需要的输入、句柄或期望值

let db: Db; // 状态：保存跨步骤复用的值
let app: Express; // 状态：保存跨步骤复用的值

beforeEach(() => { // 调用 beforeEach 并处理其返回结果
  db = createDatabase(':memory:'); // 赋值：更新变量 db 的取值
}); // 代码块结束

describe('审核适配器降级语义', () => { // 调用 describe 并处理其返回结果
  it('未配置密钥时文本 / 图片审核均返回 provider=none 放行，不伪装已审核', async () => { // 调用 it 并处理其返回结果
    const text = await auditText({}, '待审核文本'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(text).toEqual({ ok: true, provider: 'none' }); // 断言：校验响应字段与冻结契约一致
    const image = await auditImage({}, 'https://example.com/a.png'); // 常量 image：保存固定配置或一次性派生值
    expect(image).toEqual({ ok: true, provider: 'none' }); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('auditConfigured 仅在双密钥齐备时为 true；fallback 缺省 closed，可配 open', () => { // 调用 it 并处理其返回结果
    expect(auditConfigured({})).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(auditConfigured({ MIM_BAIDU_AUDIT_API_KEY: 'k' })).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(auditConfigured({ MIM_BAIDU_AUDIT_API_KEY: 'k', MIM_BAIDU_AUDIT_SECRET_KEY: 's' })).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(auditFallback({})).toBe('closed'); // 断言：校验响应字段与冻结契约一致
    expect(auditFallback({ MIM_AUDIT_FALLBACK: 'open' })).toBe('open'); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束
}); // 代码块结束

describe('GET /security/status 如实回显审核与验证码状态', () => { // 调用 describe 并处理其返回结果
  it('未配置审核密钥：content_audit=false，audit.provider=none，fallback=closed', async () => { // 调用 it 并处理其返回结果
    app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 赋值：更新变量 app 的取值
    const res = await request(app).get('/api/v1/security/status'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(res.body.content_audit).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(res.body.audit.enabled).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(res.body.audit.provider).toBe('none'); // 断言：校验响应字段与冻结契约一致
    expect(res.body.audit.fallback).toBe('closed'); // 断言：校验响应字段与冻结契约一致
    expect(res.body.captcha.mode).toBe('off'); // 断言：校验响应字段与冻结契约一致
    expect(res.body.captcha.required_scenes).toEqual([]); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('配置审核密钥后：content_audit=true，provider=baidu', async () => { // 调用 it 并处理其返回结果
    app = createApp({ // 赋值：更新变量 app 的取值
      db, // 执行当前业务步骤
      jwtSecret: JWT_SECRET, // 对象字段 jwtSecret：记录一项配置或数据
      env: { MIM_BAIDU_AUDIT_API_KEY: 'ak', MIM_BAIDU_AUDIT_SECRET_KEY: 'sk', MIM_AUDIT_FALLBACK: 'open' }, // 对象字段 env：记录一项配置或数据
    }); // 代码块结束
    const res = await request(app).get('/api/v1/security/status'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(res.body.content_audit).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(res.body.audit.enabled).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(res.body.audit.provider).toBe('baidu'); // 断言：校验响应字段与冻结契约一致
    expect(res.body.audit.fallback).toBe('open'); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束
}); // 代码块结束
