/**
 * 统一审计留痕：把后台敏感操作写入 audit_logs（操作人 / 动作 / 对象 / 结果 / 时间）。
 *
 * 表结构沿用 ops 域既有的 audit_logs（id / user_id / region / action / target /
 * request_id / payload / created_at），本次补 result 列。字段映射：
 *   - 操作人 → user_id（引导令牌记 admin-bootstrap，系统动作留空）
 *   - 对象   → target，格式 `类型:主键`
 *   - 结果   → result（success / failure）
 *   - 明细   → payload（JSON，写入前统一脱敏）
 *
 * 脱敏口径：口令、令牌、密钥、证件号、提现账号等键名一律改写为 [REDACTED]，
 * 禁止调用方把明文敏感值直接塞进 detail。
 */

import type { Request } from 'express'; // 仅类型引用：从请求里提取操作人与来源信息
import { uuidv7 } from '@mim/core-domain'; // 审计行主键
import type { Db } from './types.js'; // 数据库连接类型

/** 需要脱敏的键名片段：命中即整值替换，不做部分保留 */
const SENSITIVE_KEY_RE = /(password|passwd|pwd|secret|token|authorization|credential|id_?number|id_?card|account_?no|account_?name|verify_?code|invite_?code)/i; // 口令 / 令牌 / 证件号 / 提现账号

/** 单条明细最大字符数：超出只留截断标记，避免 payload 无限膨胀 */
const MAX_PAYLOAD_CHARS = 4000; // 约 4KB，足够还原一次后台操作

/** 嵌套最大深度：防止调用方误传大对象导致序列化成本失控 */
const MAX_DEPTH = 4; // 业务明细通常不超过 3 层

/** 操作人快照：一次请求内不变，便于同一处理链复用 */
export interface AuditActor {
  id: string | null; // 操作人用户 ID；引导令牌为 admin-bootstrap
  region: string | null; // 操作人所属区域，便于按区域筛选
  ip: string | null; // 来源 IP，仅作辅助定位
  requestId: string | null; // 请求链路 ID，可与日志对齐
}

/** 审计写入参数：调用方只提供业务语义，敏感键交给下方统一脱敏 */
export interface AuditInput {
  action: string; // 动作码，如 admin.user.role_grant
  targetType: string; // 对象类型，如 user / withdrawal / product / plan / card
  targetId?: string | null; // 对象主键或业务编码
  result?: 'success' | 'failure'; // 结果，缺省 success
  detail?: Record<string, unknown>; // 附加明细，禁止放敏感明文
  id?: string; // 可选审计主键；调用方需要回读 audit_id 时显式传入，缺省由本层生成 uuidv7
}

/** 从请求提取操作人快照：未登录（理论上不会出现）时操作人留空 */
export function auditActor(req: Request): AuditActor {
  const user = req.user as { id?: string; region?: string } | undefined; // 鉴权中间件挂载的用户
  return {
    id: req.adminBootstrap === true ? 'admin-bootstrap' : (user?.id ?? null), // 引导令牌没有真实用户主体
    region: user?.region ?? null, // 区域随用户，引导通道为空
    ip: req.ip ?? null, // trust proxy 已按配置解析
    requestId: req.requestId ?? null, // 请求追踪 ID
  };
}

/** 递归脱敏：敏感键整值替换，数组与嵌套对象逐层处理，超长字符串截断 */
function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null; // 统一空值形态，便于前端渲染
  if (depth >= MAX_DEPTH) return '[TRUNCATED]'; // 超深结构不再展开
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1)); // 数组最多保留 20 项
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}; // 逐键重建，避免原型污染
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitize(raw, depth + 1); // 命中敏感键直接替换
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value; // 长文本截断
  return value; // 数字 / 布尔原样保留
}

/** 组装 payload：合并业务明细与来源 IP，再统一序列化并限长 */
function buildPayload(actor: AuditActor, detail?: Record<string, unknown>): string {
  const merged = { ...(detail ?? {}), _ip: actor.ip }; // 来源 IP 放在保留键里，不污染业务明细
  const text = JSON.stringify(sanitize(merged)); // 先脱敏再序列化
  if (text.length <= MAX_PAYLOAD_CHARS) return text; // 正常体积直接返回
  return JSON.stringify({ truncated: true, chars: text.length }); // 超限只留标记，不落原始内容
}

/** 写入一条审计：调用方保证已经完成业务校验，这里只负责落库 */
export function writeAudit(db: Db, actor: AuditActor, input: AuditInput): void {
  const auditId = input.id ?? uuidv7(); // 调用方需要回读 audit_id 时传入显式主键，否则生成新 uuidv7
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, region, action, target, request_id, payload, created_at, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    auditId, // 审计主键
    actor.id, // 操作人
    actor.region, // 操作人区域
    input.action, // 动作码
    input.targetId ? `${input.targetType}:${input.targetId}` : input.targetType, // 对象统一编码
    actor.requestId, // 请求链路 ID
    buildPayload(actor, input.detail), // 已脱敏明细
    new Date().toISOString(), // 审计时间（UTC ISO-8601）
    input.result ?? 'success', // 结果
  );
}

/**
 * 带结果的审计包装：业务成功记 success，抛错记 failure 后原样抛出。
 * 审计写入本身失败会直接抛出，避免出现「操作成功但无留痕」的静默缺口。
 */
export function audited<T>(
  db: Db,
  actor: AuditActor,
  input: Omit<AuditInput, 'result'>,
  run: () => T,
): T {
  try {
    const out = run(); // 执行业务动作
    writeAudit(db, actor, { ...input, result: 'success' }); // 成功留痕
    return out; // 交回业务结果
  } catch (error) {
    writeAudit(db, actor, {
      ...input,
      result: 'failure',
      detail: { ...(input.detail ?? {}), error_code: errorCodeOf(error) }, // 只记错误码，不记堆栈与入参明文
    }); // 失败留痕
    throw error; // 保持原有错误语义
  }
}

/** 从异常里取稳定错误码：AppError 自带 code，其余按异常名兜底 */
function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code; // AppError.code
    if (typeof code === 'string' && code.length > 0) return code; // 业务错误码优先
  }
  return error instanceof Error ? error.name : 'Error'; // 兜底：TypeError 等
}

/** 审计查询行结构：对外视图按列映射，payload 解析后再脱敏一次 */
export interface AuditLogRow {
  id: string; // 主键
  user_id: string | null; // 操作人
  region: string | null; // 区域
  action: string; // 动作
  target: string | null; // 对象编码
  request_id: string | null; // 请求 ID
  payload: string | null; // 明细 JSON
  created_at: string; // 时间
  result: string; // 结果
}
