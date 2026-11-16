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
export const TEST_PASSWORD = 'test-pass-123'; // 全用例共用的合法口令

/** 登录成功后的最小凭据：令牌 + 用户主键 */
export interface TestAccount {
  token: string; // 访问令牌
  userId: string; // 用户主键
} // TestAccount 结束

/** 注册测试账号；已存在（409）时退回口令登录，保证同一应用内重复调用幂等 */
export async function registerTestAccount(
  target: Express, // 被测应用实例
  identifier: string, // 手机号 / 邮箱等登录标识
  password: string = TEST_PASSWORD, // 口令，默认取统一测试口令
): Promise<TestAccount> {
  // 先走自助注册：注册开启时应返回 201 与令牌
  const reg = await request(target).post('/api/v1/auth/register').send({
    region: 'cn', // 区域：国内
    provider: 'phone', // 渠道：手机号
    identifier, // 登录标识
    password, // 登录口令
    display_name: '测试用户', // 展示昵称
  });
  // 注册成功：直接复用注册返回的令牌，省去二次登录
  if (reg.status === 201) {
    return { token: reg.body.access_token as string, userId: reg.body.user?.id as string }; // 令牌 + 用户主键
  }
  // 非「账号已存在」的失败一律抛出，避免用例带着错误状态继续跑
  if (reg.status !== 409) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`); // 注册失败明细
  }
  // 已存在：退回口令登录，命中「账号必须真实存在」的登录链路
  const login = await request(target).post('/api/v1/auth/password').send({ region: 'cn', provider: 'phone', identifier, password }); // 口令登录
  // 登录必须成功，否则后续鉴权头无效
  if (login.status !== 200) {
    throw new Error(`password login failed: ${login.status} ${JSON.stringify(login.body)}`); // 登录失败明细
  }
  // 登录成功：返回与注册分支一致的结构
  return { token: login.body.access_token as string, userId: login.body.user?.id as string }; // 令牌 + 用户主键
} // registerTestAccount 结束

/** 注册并口令登录后返回鉴权头（替代旧的「管理员口令自动建号」登录） */
export async function loginHeaders(
  target: Express, // 被测应用实例
  identifier: string, // 登录标识
  password: string = TEST_PASSWORD, // 口令，默认取统一测试口令
): Promise<Record<string, string>> {
  const { token } = await registerTestAccount(target, identifier, password); // 拿到有效令牌
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }; // 可直接用于 supertest 的请求头
} // loginHeaders 结束
