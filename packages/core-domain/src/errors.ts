/**
 * 统一错误码与错误信封（07 §9 横切 / 08 §2 契约）。
 * 业务层只抛 AppError，HTTP 层统一翻译为 { code, message, request_id, details? }。
 */

// 全仓唯一错误码清单；用 as const 锁定字面量类型，供 ErrorCode 与状态码映射做穷举校验
export const ERROR_CODES = [
  // 入参校验失败：字段缺失、格式不合法等 400 类问题
  'VALIDATION_FAILED',
  // 未登录或令牌缺失/无效，需要重新认证
  'AUTH_UNAUTHORIZED',
  // 短信/邮箱验证码不匹配
  'AUTH_CODE_INVALID',
  // 验证码已超过有效时长
  'AUTH_CODE_EXPIRED',
  // 验证码发送过于频繁，触发频控
  'AUTH_CODE_RATE_LIMITED',
  // 服务端未配置任何验证码下发通道（短信/邮件）
  'AUTH_CHANNEL_NOT_CONFIGURED',
  // 第三方通道下发验证码失败（上游超时或报错）
  'AUTH_CODE_DELIVERY_FAILED',
  // 密码登录时密码不匹配
  'AUTH_PASSWORD_INVALID',
  // 该地区/租户尚未开启密码登录能力
  'AUTH_PASSWORD_NOT_CONFIGURED',
  // 连续登录失败次数超限，账号被临时锁定
  'AUTH_ACCOUNT_LOCKED',
  // 刷新令牌无效或已被轮换失效，需重新登录
  'AUTH_REFRESH_INVALID',
  // 账号主体不存在（可能已注销或从未注册）
  'ACCOUNT_NOT_FOUND',
  // 账号注册地区与当前请求地区不一致，拒绝跨区登录
  'ACCOUNT_REGION_MISMATCH',
  // 账号处于注销冷静期，业务操作被拦截
  'ACCOUNT_DELETION_PENDING',
  // 已登录但无权执行该操作（角色/归属校验失败）
  'FORBIDDEN',
  // 目标资源不存在
  'NOT_FOUND',
  // 写入冲突（唯一键重复、版本号落后等）
  'CONFLICT',
  // 同一个幂等键被复用于不同的请求内容
  'IDEMPOTENCY_CONFLICT',
  // 当前套餐未解锁该功能（付费墙）
  'FEATURE_NOT_AVAILABLE',
  // 对象存储（S3/OSS）未配置，附件类能力不可用
  'STORAGE_NOT_CONFIGURED',
  // AI 模型提供方未配置，生成类能力不可用
  'PROVIDER_NOT_CONFIGURED',
  // 超出单任务或当日的生成成本上限
  'COST_LIMIT_EXCEEDED',
  // AI 生成任务执行失败（上游模型/存储/合成环节报错）
  'GENERATION_FAILED',
  // 通用接口频控触发
  'RATE_LIMITED',
  // 未归类的服务端异常兜底
  'INTERNAL_ERROR',
  // 清单以 as const 收尾，使每个元素保持字面量类型，供 ErrorCode 反推联合类型
] as const;

// 由清单推导出的错误码联合类型，任何新增码都必须先在此数组登记，避免拼写漂移
export type ErrorCode = (typeof ERROR_CODES)[number];

// 错误码到 HTTP 状态码的映射表：让 HTTP 层无需 switch，保持翻译逻辑单一
const HTTP_STATUS: Record<ErrorCode, number> = {
  // 参数类问题统一 400
  VALIDATION_FAILED: 400,
  // 未认证 401
  AUTH_UNAUTHORIZED: 401,
  // 验证码填错按参数错误处理，返回 400 而非 401
  AUTH_CODE_INVALID: 400,
  // 验证码过期同样按参数错误处理
  AUTH_CODE_EXPIRED: 400,
  // 验证码频控用 429，便于客户端按限流语义退避
  AUTH_CODE_RATE_LIMITED: 429,
  // 通道未配置属服务端能力缺失，用 503 表示暂时不可用
  AUTH_CHANNEL_NOT_CONFIGURED: 503,
  // 上游下发失败属网关错误，用 502 区分「我方无问题」
  AUTH_CODE_DELIVERY_FAILED: 502,
  // 密码错误视为认证失败 401
  AUTH_PASSWORD_INVALID: 401,
  // 密码登录未开启，属服务不可用 503
  AUTH_PASSWORD_NOT_CONFIGURED: 503,
  // 账号锁定使用 423 Locked，语义最贴切
  AUTH_ACCOUNT_LOCKED: 423,
  // 刷新令牌失效需重新认证 401
  AUTH_REFRESH_INVALID: 401,
  // 账号不存在 404，避免泄露多余信息
  ACCOUNT_NOT_FOUND: 404,
  // 跨区访问被拒绝 403
  ACCOUNT_REGION_MISMATCH: 403,
  // 注销冷静期内禁止操作 403
  ACCOUNT_DELETION_PENDING: 403,
  // 无权限 403
  FORBIDDEN: 403,
  // 资源不存在 404
  NOT_FOUND: 404,
  // 数据冲突 409
  CONFLICT: 409,
  // 幂等冲突同属状态冲突，沿用 409 让客户端重取最新数据
  IDEMPOTENCY_CONFLICT: 409,
  // 功能未解锁用 403，提示这是权限/套餐问题
  FEATURE_NOT_AVAILABLE: 403,
  // 存储未配置 503
  STORAGE_NOT_CONFIGURED: 503,
  // 模型提供方未配置 503
  PROVIDER_NOT_CONFIGURED: 503,
  // 成本超限用 402 Payment Required，提示需付费或等待额度重置
  COST_LIMIT_EXCEEDED: 402,
  // 生成任务失败属上游环节报错，用 502 区分「我方调度无问题、模型/合成失败」
  GENERATION_FAILED: 502,
  // 通用限流 429
  RATE_LIMITED: 429,
  // 兜底 500
  INTERNAL_ERROR: 500,
  // 映射表结束：键已穷举 ErrorCode，若清单新增错误码而此处漏配，类型检查会直接报错
};

// 业务异常基类：携带错误码、HTTP 状态与可选明细，供上层统一捕获
export class AppError extends Error {
  // 机器可读的错误码，前端据此做文案映射与分支处理
  readonly code: ErrorCode;
  // 与错误码绑定的 HTTP 状态码，HTTP 层直接取用
  readonly status: number;
  // 可选的结构化明细（字段级校验错误等），仅调试与表单回填使用
  readonly details?: unknown;

  // 构造函数：message 缺省时回落为错误码本身，保证响应中 message 永不为空
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    // 调用父类 Error 构造，写入可读消息
    super(message ?? code);
    // 覆盖 name，便于日志里快速识别是业务异常而非运行时异常
    this.name = 'AppError';
    // 保存错误码
    this.code = code;
    // 查表得到状态码，映射缺失时兜底 500，避免出现 undefined 状态
    this.status = HTTP_STATUS[code] ?? 500;
    // 保存可选明细，未传时为 undefined
    this.details = details;
  // 构造函数结束：实例的 code、status、details 已全部就绪
  }

  // 序列化为对外错误信封；details 为空时不输出该字段，保持响应体干净
  toEnvelope(requestId: string) {
    // 返回符合 08 §2 契约的固定字段结构
    return {
      // 错误码，客户端按码做文案与重试策略
      code: this.code,
      // 人类可读消息，已按调用方语言本地化
      message: this.message,
      // 请求追踪 ID，便于与服务端日志对齐排障
      request_id: requestId,
      // 仅在存在明细时展开 details，undefined 时完全不出现该键
      ...(this.details === undefined ? {} : { details: this.details }),
    // 信封对象字面量结束，字段顺序已与契约文档一致
    };
  // 方法结束：调用方拿到的对象可直接序列化为响应体
  }
// 类定义结束：各服务通过 instanceof 或 isAppError 统一识别业务异常
}

// 类型守卫：用于 catch 到的 unknown 值收窄为 AppError，避免到处做 as 断言
export function isAppError(value: unknown): value is AppError {
  // 用 instanceof 判定，可正确识别跨 ES 模块实例的 AppError
  return value instanceof AppError;
// 守卫结束：返回值同时具备布尔判断与类型收窄两种作用
}

// 纯查表函数：无异常对象、只需状态码的场景（如中间件预判）直接调用
export function statusOf(code: ErrorCode): number {
  // 映射缺失时同样兜底 500，与构造函数保持一致
  return HTTP_STATUS[code] ?? 500;
// 函数结束：HTTP 层可直接用它决定响应状态，无需构造异常对象
}
