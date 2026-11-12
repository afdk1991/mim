/** 安全加固包测试：百度内容审核适配器（provider=none 如实披露 / 降级策略 / 状态端点） */

import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { auditText, auditImage, auditConfigured, auditFallback } from '../src/security.js';
import type { Db } from '../src/types.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

let db: Db;
let app: Express;

beforeEach(() => {
  db = createDatabase(':memory:');
});

describe('审核适配器降级语义', () => {
  it('未配置密钥时文本 / 图片审核均返回 provider=none 放行，不伪装已审核', async () => {
    const text = await auditText({}, '待审核文本');
    expect(text).toEqual({ ok: true, provider: 'none' });
    const image = await auditImage({}, 'https://example.com/a.png');
    expect(image).toEqual({ ok: true, provider: 'none' });
  });

  it('auditConfigured 仅在双密钥齐备时为 true；fallback 缺省 closed，可配 open', () => {
    expect(auditConfigured({})).toBe(false);
    expect(auditConfigured({ MIM_BAIDU_AUDIT_API_KEY: 'k' })).toBe(false);
    expect(auditConfigured({ MIM_BAIDU_AUDIT_API_KEY: 'k', MIM_BAIDU_AUDIT_SECRET_KEY: 's' })).toBe(true);
    expect(auditFallback({})).toBe('closed');
    expect(auditFallback({ MIM_AUDIT_FALLBACK: 'open' })).toBe('open');
  });
});

describe('GET /security/status 如实回显审核与验证码状态', () => {
  it('未配置审核密钥：content_audit=false，audit.provider=none，fallback=closed', async () => {
    app = createApp({ db, jwtSecret: JWT_SECRET, env: {} });
    const res = await request(app).get('/api/v1/security/status');
    expect(res.status).toBe(200);
    expect(res.body.content_audit).toBe(false);
    expect(res.body.audit.enabled).toBe(false);
    expect(res.body.audit.provider).toBe('none');
    expect(res.body.audit.fallback).toBe('closed');
    expect(res.body.captcha.mode).toBe('off');
    expect(res.body.captcha.required_scenes).toEqual([]);
  });

  it('配置审核密钥后：content_audit=true，provider=baidu', async () => {
    app = createApp({
      db,
      jwtSecret: JWT_SECRET,
      env: { MIM_BAIDU_AUDIT_API_KEY: 'ak', MIM_BAIDU_AUDIT_SECRET_KEY: 'sk', MIM_AUDIT_FALLBACK: 'open' },
    });
    const res = await request(app).get('/api/v1/security/status');
    expect(res.status).toBe(200);
    expect(res.body.content_audit).toBe(true);
    expect(res.body.audit.enabled).toBe(true);
    expect(res.body.audit.provider).toBe('baidu');
    expect(res.body.audit.fallback).toBe('open');
  });
});
