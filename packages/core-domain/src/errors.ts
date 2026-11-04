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
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_REFRESH_INVALID',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_REGION_MISMATCH',
  'ACCOUNT_DELETION_PENDING',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'PLAN_NOT_FOUND',
  'PLAN_PRICE_NOT_CONFIGURED',
  'QUOTA_PROJECTS_EXCEEDED',
  'QUOTA_COLLABORATORS_EXCEEDED',
  'FEATURE_NOT_AVAILABLE',
  'SUBSCRIPTION_ALREADY_ACTIVE',
  'SUBSCRIPTION_INVALID_TRANSITION',
  'ORDER_NOT_FOUND',
  'ORDER_INVALID_TRANSITION',
  'PAYMENT_DRIVER_UNAVAILABLE',
  'PROJECT_NOT_FOUND',
  'PROJECT_ARCHIVED',
  'MEMBER_NOT_FOUND',
  'MEMBER_LAST_OWNER',
  'INVITATION_NOT_FOUND',
  'INVITATION_INVALID',
  'INVITATION_EXPIRED',
  'TASK_NOT_FOUND',
  'TASK_PARENT_INVALID',
  'TASK_STATUS_INVALID',
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
  AUTH_ACCOUNT_LOCKED: 423,
  AUTH_REFRESH_INVALID: 401,
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_REGION_MISMATCH: 403,
  ACCOUNT_DELETION_PENDING: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PLAN_NOT_FOUND: 404,
  PLAN_PRICE_NOT_CONFIGURED: 409,
  QUOTA_PROJECTS_EXCEEDED: 403,
  QUOTA_COLLABORATORS_EXCEEDED: 403,
  FEATURE_NOT_AVAILABLE: 403,
  SUBSCRIPTION_ALREADY_ACTIVE: 409,
  SUBSCRIPTION_INVALID_TRANSITION: 409,
  ORDER_NOT_FOUND: 404,
  ORDER_INVALID_TRANSITION: 409,
  PAYMENT_DRIVER_UNAVAILABLE: 503,
  PROJECT_NOT_FOUND: 404,
  PROJECT_ARCHIVED: 409,
  MEMBER_NOT_FOUND: 404,
  MEMBER_LAST_OWNER: 409,
  INVITATION_NOT_FOUND: 404,
  INVITATION_INVALID: 400,
  INVITATION_EXPIRED: 410,
  TASK_NOT_FOUND: 404,
  TASK_PARENT_INVALID: 400,
  TASK_STATUS_INVALID: 409,
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
