/* ==========================================================================
 * 统一结果类型 —— 全工程错误与写回状态的唯一约定
 *
 * 背景：原实现里「失败」有四种表达（throw / null / undefined / toast 后继续），
 * 调用方无法一致处理，导致「云端写失败但前端显示成功」这类静默不一致。
 * 本层把「可预期的失败」收敛为返回值而非异常，异常只保留给真正的程序错误。
 * ======================================================================== */

/** 业务错误码：与后端 server/api 的错误码一一对应，前端按码取中文文案 */
export type ErrCode =
  | 'offline' // 未配置后端 / 网络不可达
  | 'no_auth' // 未登录
  | 'forbidden' // 已登录但无权限
  | 'not_found' // 资源不存在
  | 'conflict' // 唯一约束冲突（重复锁 / 重复发码）
  | 'bad_request' // 参数不合法
  | 'schema' // 线上库结构不匹配（缺列 / 缺表）
  | 'busy' // 并发冲突，可重试
  | 'server' // 5xx
  | 'unknown'

export interface AppError {
  code: ErrCode
  /** 面向用户的中文说明，已由错误码映射或后端 message 填充 */
  message: string
  /** 原始错误，仅用于排查，不展示给用户 */
  cause?: unknown
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })

export const err = (code: ErrCode, message: string, cause?: unknown): AppError => ({
  code,
  message,
  ...(cause === undefined ? {} : { cause }),
})

export const fail = <T>(code: ErrCode, message: string, cause?: unknown): Result<T> => ({
  ok: false,
  error: err(code, message, cause),
})

/** 三态写回协议：本地已乐观更新后，云端回写的结果。
 *  - ok   ：云端已确认
 *  - skip ：不具备云端条件（未登录 / 未配置），本地态即最终态，不报错
 *  - fail ：云端拒绝，调用方必须回滚本地乐观更新并提示
 */
export type WriteBack = 'ok' | 'skip' | 'fail'

export function isErrCode(v: unknown): v is ErrCode {
  return (
    v === 'offline' ||
    v === 'no_auth' ||
    v === 'forbidden' ||
    v === 'not_found' ||
    v === 'conflict' ||
    v === 'bad_request' ||
    v === 'schema' ||
    v === 'busy' ||
    v === 'server' ||
    v === 'unknown'
  )
}

/** 后端错误码 → 中文文案（唯一真源，页面不得各自翻译） */
export const ERR_CN: Record<ErrCode, string> = {
  offline: '后端未配置或网络不可达，已保存在本机',
  no_auth: '请先登录',
  forbidden: '没有操作权限',
  not_found: '资源不存在或已被删除',
  conflict: '操作冲突，请刷新后重试',
  bad_request: '请求参数不合法',
  schema: '线上数据结构尚未就绪，已保存在本机',
  busy: '系统繁忙，请稍后重试',
  server: '服务端异常，请稍后重试',
  unknown: '操作失败，请稍后重试',
}

export function errText(e: AppError): string {
  return e.message || ERR_CN[e.code]
}
