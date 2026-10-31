/* ============================================================================
 * 统一错误 —— 与前端 src/core/result.ts 的 ErrCode 一一对应
 *
 * 约定：HTTP 状态码 + { error: { code, message } } 同时生效。
 * 前端 core/http.ts 优先采用响应体里的 code，服务端必须保证两者一致，
 * 否则「409 却当成 bad_request 重试」这类行为漂移必然复现。
 * ========================================================================== */

export class ApiError extends Error {
  constructor(code, message, status, cause) {
    super(message)
    this.code = code
    this.status = status
    this.cause = cause
  }
}

export const badRequest = (message, cause) => new ApiError('bad_request', message, 400, cause)
export const noAuth = (message = '请先登录') => new ApiError('no_auth', message, 401)
export const forbidden = (message = '没有操作权限') => new ApiError('forbidden', message, 403)
export const notFound = (message = '资源不存在或已被删除') => new ApiError('not_found', message, 404)
export const conflict = (message = '操作冲突，请刷新后重试') => new ApiError('conflict', message, 409)
export const busy = (message = '系统繁忙，请稍后重试') => new ApiError('busy', message, 503)
export const schemaError = (message, cause) => new ApiError('schema', message, 400, cause)

/** 缺列提示文案刻意与 PostgREST 一致：前端 writeWithFallback 靠它做缺列降级 */
export function missingColumn(table, col) {
  return schemaError(`Could not find the '${col}' column of '${table}'`)
}

const PG_TO_CODE = {
  '23505': 'conflict', // unique_violation
  '23503': 'bad_request', // foreign_key_violation
  '23502': 'bad_request', // not_null_violation
  '23514': 'bad_request', // check_violation
  '22P02': 'bad_request', // invalid_text_representation（类型不匹配）
  '22001': 'bad_request', // string_data_right_truncation
  '22003': 'bad_request', // numeric_value_out_of_range
  '42P01': 'schema', // undefined_table
  '42703': 'schema', // undefined_column
  '40001': 'busy', // serialization_failure
  '40P01': 'busy', // deadlock_detected
  '53300': 'busy', // too_many_connections
}

/** 未知异常收敛为 ApiError：绝不把 PgSQL 原始错误原样抛给前端 */
export function toApiError(e) {
  if (e instanceof ApiError) return e
  if (e && typeof e.code === 'string' && PG_TO_CODE[e.code]) {
    const code = PG_TO_CODE[e.code]
    if (code === 'conflict') return conflict('唯一约束冲突（重复写入）', e)
    if (code === 'busy') return busy('系统繁忙，请稍后重试', e)
    if (code === 'schema') return schemaError('线上数据结构尚未就绪', e)
    return badRequest('请求参数不合法', e)
  }
  return new ApiError('server', '服务端异常，请稍后重试', 500, e)
}
