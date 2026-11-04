/** FR-01 账号身份：验证码登录、刷新令牌轮换、登出 */

import { Router } from 'express';
import { z } from 'zod';
import { AppError, uuidv7 } from '@mim/core-domain';
import {
  ACCESS_TTL_SECONDS,
  CODE_MAX_ATTEMPTS,
  CODE_RATE_LIMIT,
  CODE_RATE_WINDOW_MINUTES,
  CODE_TTL_SECONDS,
  LOGIN_LOCK_AFTER_FAILURES,
  LOGIN_LOCK_MINUTES,
  REFRESH_TTL_SECONDS,
} from '../config.js';
import {
  generateCode,
  hashCode,
  issueAccessToken,
  newOpaqueToken,
  normalizeIdentity,
  sha256,
  verifyCode,
} from '../auth.js';
import { clockOf } from '../domain.js';
import { requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import { addSeconds } from '../utils.js';
import type { ApiDeps, Region } from '../types.js';

export interface UserRow {
  id: string;
  region: Region;
  status: string;
  display_name: string;
  locale: string;
  timezone: string;
  deletion_scheduled_at: string | null;
  created_at: string;
}

interface CodeRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  device_id: string | null;
  expires_at: string;
  revoked_at: string | null;
}

const codeBody = z.object({
  region: z.enum(['cn', 'global']),
  provider: z.enum(['phone', 'email']),
  identifier: z.string().min(1),
});

const loginBody = codeBody.extend({
  code: z.string().regex(/^\d{6}$/),
  device: z
    .object({
      platform: z.string().min(1).max(32),
      name: z.string().max(64).optional(),
    })
    .optional(),
});

function userPayload(row: UserRow) {
  return {
    id: row.id,
    region: row.region,
    status: row.status,
    display_name: row.display_name,
    locale: row.locale,
    timezone: row.timezone,
    deletion_scheduled_at: row.deletion_scheduled_at,
  };
}

function createSession(deps: ApiDeps, user: UserRow, deviceId: string | null) {
  const now = clockOf(deps);
  const refreshToken = newOpaqueToken();
  deps.db
    .prepare(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, device_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuidv7(),
      user.id,
      sha256(refreshToken),
      deviceId,
      addSeconds(now, REFRESH_TTL_SECONDS),
      now,
    );
  return {
    token_type: 'Bearer',
    access_token: issueAccessToken(user.id, user.region, deps.jwtSecret),
    refresh_token: refreshToken,
    expires_in: ACCESS_TTL_SECONDS,
  };
}

function failureKey(region: string, identifier: string): string {
  return `${region}:${identifier}`;
}

function assertNotLocked(deps: ApiDeps, key: string, now: string): void {
  const row = deps.db
    .prepare('SELECT locked_until FROM login_failures WHERE identifier = ?')
    .get(key) as { locked_until: string | null } | undefined;
  if (row?.locked_until && Date.parse(row.locked_until) > Date.parse(now)) {
    throw new AppError('AUTH_ACCOUNT_LOCKED', 'too many failed attempts, try again later', {
      locked_until: row.locked_until,
    });
  }
}

function recordFailure(deps: ApiDeps, key: string, region: string, now: string): void {
  const row = deps.db
    .prepare('SELECT failures FROM login_failures WHERE identifier = ?')
    .get(key) as { failures: number } | undefined;
  const failures = (row?.failures ?? 0) + 1;
  const lockedUntil =
    failures >= LOGIN_LOCK_AFTER_FAILURES ? addSeconds(now, LOGIN_LOCK_MINUTES * 60) : null;
  deps.db
    .prepare(
      `INSERT INTO login_failures (identifier, region, failures, locked_until, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET
         failures = excluded.failures,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`,
    )
    .run(key, region, failures, lockedUntil, now);
}

function findOrCreateUser(deps: ApiDeps, region: Region, provider: string, identifier: string): UserRow {
  const identity = deps.db
    .prepare('SELECT user_id FROM identities WHERE region = ? AND provider = ? AND identifier = ?')
    .get(region, provider, identifier) as { user_id: string } | undefined;

  if (identity) {
    const row = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(identity.user_id) as
      | UserRow
      | undefined;
    if (!row) throw new AppError('ACCOUNT_NOT_FOUND', 'account not found');
    if (row.status === 'deleted') throw new AppError('AUTH_UNAUTHORIZED', 'account has been deleted');
    return row;
  }

  const now = clockOf(deps);
  const userId = uuidv7();
  const insertUser = deps.db.prepare(
    `INSERT INTO users (id, region, status, display_name, locale, timezone, created_at, updated_at)
     VALUES (?, ?, 'active', '', ?, ?, ?, ?)`,
  );
  const insertIdentity = deps.db.prepare(
    `INSERT INTO identities (id, user_id, region, provider, identifier, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  deps.db.transaction(() => {
    insertUser.run(
      userId,
      region,
      region === 'cn' ? 'zh-CN' : 'en-US',
      region === 'cn' ? 'Asia/Shanghai' : 'UTC',
      now,
      now,
    );
    insertIdentity.run(uuidv7(), userId, region, provider, identifier, now);
  })();

  const row = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
  return row;
}

export function createAuthRouter(deps: ApiDeps): Router {
  const router = Router();

  router.post('/auth/code', (req, res) => {
    const body = parse(codeBody, req.body);
    const identity = normalizeIdentity(body.region, body.provider, body.identifier);
    const now = clockOf(deps);
    const windowStart = addSeconds(now, -CODE_RATE_WINDOW_MINUTES * 60);
    const recent = deps.db
      .prepare(
        `SELECT COUNT(*) AS n FROM verification_codes
         WHERE region = ? AND provider = ? AND identifier = ? AND created_at >= ?`,
      )
      .get(body.region, identity.provider, identity.identifier, windowStart) as { n: number };
    if (recent.n >= CODE_RATE_LIMIT) {
      throw new AppError('AUTH_CODE_RATE_LIMITED', 'too many code requests, try again later', {
        retry_after_seconds: CODE_RATE_WINDOW_MINUTES * 60,
      });
    }

    // 生产环境禁止直下发验证码：未接入真实短信/邮件通道前直接拒绝，
    // 避免 dev_code 明文出现在生产响应中（安全审计项）。
    if (deps.env.NODE_ENV === 'production') {
      throw new AppError(
        'AUTH_CHANNEL_NOT_CONFIGURED',
        'verification channel is not configured in production',
        { identifier: identity.identifier, provider: identity.provider },
      );
    }

    const code = generateCode();
    deps.db
      .prepare(
        `INSERT INTO verification_codes
         (id, region, provider, identifier, code_hash, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        uuidv7(),
        body.region,
        identity.provider,
        identity.identifier,
        hashCode(code),
        addSeconds(now, CODE_TTL_SECONDS),
        now,
      );

    res.status(201).json({
      delivery: 'dev',
      dev_code: code,
      identifier: identity.identifier,
      provider: identity.provider,
      expires_in: CODE_TTL_SECONDS,
      note: '开发模式：真实短信/邮件通道未接入，验证码直接下发；上线前须替换为第三方通道',
    });
  });

  router.post('/auth/login', (req, res) => {
    const body = parse(loginBody, req.body);
    const identity = normalizeIdentity(body.region, body.provider, body.identifier);
    const now = clockOf(deps);
    const key = failureKey(body.region, identity.identifier);
    assertNotLocked(deps, key, now);

    const codeRow = deps.db
      .prepare(
        `SELECT id, code_hash, attempts, expires_at FROM verification_codes
         WHERE region = ? AND provider = ? AND identifier = ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(body.region, identity.provider, identity.identifier) as CodeRow | undefined;

    if (!codeRow) throw new AppError('AUTH_CODE_INVALID', 'verification code is invalid');
    if (Date.parse(codeRow.expires_at) <= Date.parse(now)) {
      throw new AppError('AUTH_CODE_EXPIRED', 'verification code has expired');
    }
    if (codeRow.attempts >= CODE_MAX_ATTEMPTS) {
      throw new AppError('AUTH_CODE_RATE_LIMITED', 'verification code attempts exhausted');
    }
    if (!verifyCode(body.code, codeRow.code_hash)) {
      deps.db
        .prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?')
        .run(codeRow.id);
      recordFailure(deps, key, body.region, now);
      throw new AppError('AUTH_CODE_INVALID', 'verification code is invalid');
    }

    deps.db
      .prepare('UPDATE verification_codes SET consumed_at = ? WHERE id = ?')
      .run(now, codeRow.id);
    deps.db.prepare('DELETE FROM login_failures WHERE identifier = ?').run(key);

    const user = findOrCreateUser(deps, body.region, identity.provider, identity.identifier);

    let deviceId: string | null = null;
    if (body.device) {
      deviceId = uuidv7();
      deps.db
        .prepare(
          `INSERT INTO devices (id, user_id, platform, name, last_seen_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(deviceId, user.id, body.device.platform, body.device.name ?? '', now, now);
    }

    const tokens = createSession(deps, user, deviceId);
    res.json({ ...tokens, user: userPayload(user) });
  });

  router.post('/auth/refresh', (req, res) => {
    const body = parse(z.object({ refresh_token: z.string().min(1) }), req.body);
    const now = clockOf(deps);
    const session = deps.db
      .prepare('SELECT * FROM sessions WHERE refresh_token_hash = ?')
      .get(sha256(body.refresh_token)) as SessionRow | undefined;
    if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.parse(now)) {
      throw new AppError('AUTH_REFRESH_INVALID', 'refresh token is invalid or expired');
    }
    const user = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as
      | UserRow
      | undefined;
    if (!user || user.status === 'deleted') {
      throw new AppError('AUTH_REFRESH_INVALID', 'account is not available');
    }

    deps.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now, session.id);
    const tokens = createSession(deps, user, session.device_id);
    res.json({ ...tokens, user: userPayload(user) });
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    const body = parse(z.object({ refresh_token: z.string().min(1) }), req.body);
    deps.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE refresh_token_hash = ? AND user_id = ?')
      .run(clockOf(deps), sha256(body.refresh_token), req.user!.id);
    res.json({ ok: true });
  });

  return router;
}
