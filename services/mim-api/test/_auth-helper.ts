/**
 * 测试公共登录辅助（SEC-01 修复配套）
 *
 * 背景：/auth/password 不再允许凭 MIM_AUTH_ADMIN_PASSWORD 对任意标识自动建号，
 * 账号必须真实存在。测试统一改为「先自助注册 → 再口令登录」，
 * 既覆盖口令登录链路，又不需要在测试里伪造数据库记录。
 */

import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型

/** 测试账号统一口令（满足 >=8 位、含字母与数字的注册策略） */
export const TEST_PASSWORD = 'test-pass-123';

export interface TestAccount {
  token: string; // 访问令牌
  userId: string; // 用户主键
}

/** 注册测试账号；已存在（409）时退回口令登录，保证同一应用内重复调用幂等 */
export async function registerTestAccount(
  target: Express,
  identifier: string,
  password: string = TEST_PASSWORD,
): Promise<TestAccount> {
  const reg = await request(target).post('/api/v1/auth/register').send({
    region: 'cn',
    provider: 'phone',
    identifier,
    password,
    display_name: '测试用户',
  });
  if (reg.status === 201) {
    return { token: reg.body.access_token as string, userId: reg.body.user?.id as string };
  }
  if (reg.status !== 409) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  }
  const login = await request(target).post('/api/v1/auth/password').send({ region: 'cn', provider: 'phone', identifier, password });
  if (login.status !== 200) {
    throw new Error(`password login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  return { token: login.body.access_token as string, userId: login.body.user?.id as string };
}

/** 注册并口令登录后返回鉴权头（替代旧的「管理员口令自动建号」登录） */
export async function loginHeaders(
  target: Express,
  identifier: string,
  password: string = TEST_PASSWORD,
): Promise<Record<string, string>> {
  const { token } = await registerTestAccount(target, identifier, password);
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}
