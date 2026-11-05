/**
 * 统一错误码与错误信封（07 §9 横切 / 08 §2 契约）。
 * 业务层只抛 AppError，HTTP 层统一翻译为 { code, message, request_id, details? }。
 */

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'AUTH_UNAUTHORIZED',
  'AUTH_CODE_INVALID',
  'AUTH_CODE_EXPIRED',
  'AUTH_CODE_RATE_LIMITED',
  'AUTH_CHANNEL_NOT_CONFIGURED',
  'AUTH_CODE_DELIVERY_FAILED',
  'AUTH_PASSWORD_INVALID',
  'AUTH_PASSWORD_NOT_CONFIGURED',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_REFRESH_INVALID',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_REGION_MISMATCH',
  'ACCOUNT_DELETION_PENDING',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'FEATURE_NOT_AVAILABLE',
  'STORAGE_NOT_CONFIGURED',
  'PROVIDER_NOT_CONFIGURED',
  'COST_LIMIT_EXCEEDED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTH_UNAUTHORIZED: 401,
  AUTH_CODE_INVALID: 400,
  AUTH_CODE_EXPIRED: 400,
  AUTH_CODE_RATE_LIMITED: 429,
  AUTH_CHANNEL_NOT_CONFIGURED: 503,
  AUTH_CODE_DELIVERY_FAILED: 502,
  AUTH_PASSWORD_INVALID: 401,
  AUTH_PASSWORD_NOT_CONFIGURED: 503,
  AUTH_ACCOUNT_LOCKED: 423,
  AUTH_REFRESH_INVALID: 401,
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_REGION_MISMATCH: 403,
  ACCOUNT_DELETION_PENDING: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  FEATURE_NOT_AVAILABLE: 403,
  STORAGE_NOT_CONFIGURED: 503,
  PROVIDER_NOT_CONFIGURED: 503,
  COST_LIMIT_EXCEEDED: 402,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = HTTP_STATUS[code] ?? 500;
    this.details = details;
  }

  toEnvelope(requestId: string) {
    return {
      code: this.code,
      message: this.message,
      request_id: requestId,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function statusOf(code: ErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}
