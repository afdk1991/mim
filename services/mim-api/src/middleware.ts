/** 请求 ID、鉴权、幂等回放与统一错误信封 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError, isAppError } from '@mim/core-domain';
import { REQUIRE_IDEMPOTENCY } from './config.js';
import { sha256, verifyAccessToken } from './auth.js';

interface AuthRow {
  id: string;
  region: 'cn' | 'global';
  status: 'active' | 'pending_deletion' | 'deleted';
  display_name: string;
  locale: string;
  timezone: string;
}

interface IdempotencyRow {
  key: string;
  user_id: string;
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const DELETION_WHITELIST = new Set(['GET /api/v1/me', 'POST /api/v1/me/cancel-deletion']);

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.header('x-request-id') ?? randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !match[1]) {
    throw new AppError('AUTH_UNAUTHORIZED', 'missing bearer token');
  }
  const payload = verifyAccessToken(match[1], req.deps.jwtSecret);
  const row = req.deps.db
    .prepare('SELECT id, region, status, display_name, locale, timezone FROM users WHERE id = ?')
    .get(payload.sub) as AuthRow | undefined;
  if (!row || row.status === 'deleted') {
    throw new AppError('AUTH_UNAUTHORIZED', 'account is not available');
  }
  const pathname = req.originalUrl.split('?')[0] ?? '';
  if (row.status === 'pending_deletion' && !DELETION_WHITELIST.has(`${req.method} ${pathname}`)) {
    throw new AppError('ACCOUNT_DELETION_PENDING', 'account is pending deletion');
  }
  req.user = row;
  next();
}

/**
 * 写操作幂等：同 Key 同请求体回放首次响应；同 Key 不同请求体 409；
 * 失败响应不落库，允许修正后重试。
 */
export function idempotency(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  const key = req.header('idempotency-key') ?? '';
  if (!key) {
    if (REQUIRE_IDEMPOTENCY) {
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header is required for write operations', {
        field: 'Idempotency-Key',
      });
    }
    next();
    return;
  }
  const userId = req.user?.id;
  if (!userId) throw new AppError('AUTH_UNAUTHORIZED', 'idempotency requires an authenticated user');

  const db = req.deps.db;
  const requestHash = sha256(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`);
  const existing = db
    .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND user_id = ?')
    .get(key, userId) as IdempotencyRow | undefined;

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was reused with a different payload');
    }
    if (existing.response_status === null || existing.response_body === null) {
      throw new AppError('CONFLICT', 'an identical request is still in progress');
    }
    res.status(existing.response_status).json(JSON.parse(existing.response_body));
    return;
  }

  db.prepare(
    `INSERT INTO idempotency_keys (key, user_id, method, path, request_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(key, userId, req.method, req.originalUrl, requestHash, new Date().toISOString());

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const status = res.statusCode;
    try {
      if (status < 400) {
        db.prepare(
          `UPDATE idempotency_keys SET response_status = ?, response_body = ?
           WHERE key = ? AND user_id = ?`,
        ).run(status, JSON.stringify(body), key, userId);
      } else {
        db.prepare('DELETE FROM idempotency_keys WHERE key = ? AND user_id = ?').run(key, userId);
      }
    } catch {
      // 幂等落库失败不应影响业务响应
    }
    return originalJson(body);
  }) as Response['json'];

  next();
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `route ${req.method} ${req.originalUrl} not found`,
    request_id: req.requestId,
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  const requestId = req.requestId ?? '';
  if (isAppError(err)) {
    res.status(err.status).json(err.toEnvelope(requestId));
    return;
  }
  console.error(`[${requestId}] unhandled error`, err);
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'internal server error',
    request_id: requestId,
  });
}
