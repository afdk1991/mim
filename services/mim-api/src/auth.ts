/** 身份标识归一化、验证码、JWT 与不透明刷新令牌 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '@mim/core-domain';
import { ACCESS_TTL_SECONDS, CODE_LENGTH } from './config.js';
import type { Region } from './types.js';

export type IdentityProvider = 'phone' | 'email';

export interface NormalizedIdentity {
  provider: IdentityProvider;
  identifier: string;
}

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** region 隔离：cn 只接受手机号，global 只接受邮箱；标识归一后落库 */
export function normalizeIdentity(region: Region, provider: string, raw: string): NormalizedIdentity {
  const value = raw.trim();
  if (provider === 'phone') {
    if (region !== 'cn') {
      throw new AppError('VALIDATION_FAILED', 'phone identity is only available in cn region', {
        field: 'identifier',
      });
    }
    const phone = value.replace(/^\+?86/, '');
    if (!PHONE_RE.test(phone)) {
      throw new AppError('VALIDATION_FAILED', 'invalid CN mobile number', { field: 'identifier' });
    }
    return { provider: 'phone', identifier: phone };
  }
  if (provider === 'email') {
    if (region !== 'global') {
      throw new AppError('VALIDATION_FAILED', 'email identity is only available in global region', {
        field: 'identifier',
      });
    }
    const email = value.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new AppError('VALIDATION_FAILED', 'invalid email address', { field: 'identifier' });
    }
    return { provider: 'email', identifier: email };
  }
  throw new AppError('VALIDATION_FAILED', 'unsupported provider', { field: 'provider' });
}

export function generateCode(length: number = CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(randomInt(0, 10));
  return out;
}

export function hashCode(code: string): string {
  return bcrypt.hashSync(code, 10);
}

export function verifyCode(code: string, hash: string): boolean {
  return bcrypt.compareSync(code, hash);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function issueAccessToken(userId: string, region: string, secret: string): string {
  return jwt.sign({ sub: userId, region, typ: 'access' }, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string, secret: string): { sub: string; region: string } {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload');
    const sub = (payload as jwt.JwtPayload).sub;
    if (typeof sub !== 'string' || sub.length === 0) throw new Error('missing sub');
    return { sub, region: String((payload as jwt.JwtPayload).region ?? '') };
  } catch {
    throw new AppError('AUTH_UNAUTHORIZED', 'access token is invalid or expired');
  }
}
