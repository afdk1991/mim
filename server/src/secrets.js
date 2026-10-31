/* ============================================================================
 * 密钥策略 —— 服务端唯一「凭据出口」
 *
 * 为什么单独一个模块（而不是散在各处读 process.env）：
 *   1. 令牌签发、IP 哈希都需要同一份盐，散着读会出现「改了环境变量却只有一半生效」；
 *   2. 生产启动要 fail-fast —— 密钥不合规必须在进程起来之前就死，
 *      而不是等第一个伪造令牌请求进来时才被发现。
 *
 * 安全基线（对应「不可伪造任意身份」这条硬要求）：
 *   · 生产（NODE_ENV=production）未注入 JWT_SECRET → 拒绝启动；
 *   · 生产注入了弱密钥 / 占位串（如 change-me、dev-secret）→ 拒绝启动；
 *   · 开发环境缺失 → 生成进程级随机密钥（重启即失效），
 *     绝不再退回任何写死在源码里的公开串（历史上的 'mim-dev-secret-change-me'
 *     等于把签发权公开，任何人都能伪造任意 uid 的令牌）。
 * ========================================================================== */

import { randomBytes, createHmac } from 'node:crypto'

/** 生产判定：只有显式配置为 production 才启用致命校验 */
export const isProduction = process.env.NODE_ENV === 'production'

/** 生产密钥最低长度（字符）。32 字符 ≈ 128bit 量级的配置串，低于此按弱密钥处理 */
export const MIN_PROD_SECRET_LEN = 32

/** 占位/示例串黑名单：命中即视为弱密钥（小写子串匹配） */
const WEAK_HINTS = [
  'change-me',
  'changeme',
  'change_me',
  'dev-secret',
  'devsecret',
  'default',
  'example',
  'placeholder',
  'password',
  'passwd',
  'secret',
  'test',
  'sample',
  'todo',
  'admin',
  '123456',
  'aaaaaa',
  'mim-dev',
]

const HOW_TO_GENERATE = '生成方式：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'

/**
 * 判定密钥是否「弱」。返回原因串，合规则返回 null。
 * 注意：长度与黑名单两条生产都致命；黑名单在开发态也提示（不致命）。
 */
export function weakSecretReason(raw) {
  const s = String(raw ?? '')
  if (!s) return '为空'
  if (s.length < MIN_PROD_SECRET_LEN) return `长度不足 ${MIN_PROD_SECRET_LEN}（当前 ${s.length}）`
  const lower = s.toLowerCase()
  const hit = WEAK_HINTS.find((w) => lower.includes(w))
  if (hit) return `包含占位/弱口令特征词 "${hit}"`
  if (/^([0-9a-f])\1+$/i.test(lower)) return '为重复字符，无有效熵值'
  return null
}

let cached = null

/**
 * 取得 JWT 密钥。首次调用即完成策略判定：
 *   · 生产不合规 → 抛错（调用方在模块加载期调用，因此等价于「启动即失败」）
 *   · 开发缺失   → 随机串 + 醒目告警
 */
export function jwtSecret() {
  if (cached) return cached

  const raw = (process.env.JWT_SECRET ?? '').trim()

  if (!raw) {
    if (isProduction) {
      throw new Error(
        `[secrets] 致命配置错误：生产环境未设置 JWT_SECRET。\n` +
          `  不设密钥等同于允许任何人用默认串签发令牌、冒充任意用户（含管理员）。\n  ${HOW_TO_GENERATE}`,
      )
    }
    cached = randomBytes(32).toString('hex')
    console.warn(
      '[secrets] 未设置 JWT_SECRET：已改用进程级随机密钥（重启后已签发令牌全部失效）。\n' +
        '  本地开发如需固定登录态，请在 server/.env 显式设置 JWT_SECRET。',
    )
    return cached
  }

  const weak = weakSecretReason(raw)
  if (weak) {
    if (isProduction) {
      throw new Error(`[secrets] 致命配置错误：JWT_SECRET ${weak}，生产部署拒绝启动。\n  ${HOW_TO_GENERATE}`)
    }
    console.warn(`[secrets] JWT_SECRET ${weak}：开发环境放行，但生产部署会被拒绝启动。`)
  }

  cached = raw
  return raw
}

/**
 * IP 单向哈希：埋点/审计需要区分来源，但明文 IP 属个人信息，不入库。
 * 用 JWT 密钥做盐，避免彩虹表反推；截断 16 字节足够做去重计数。
 */
export function hashIp(ip) {
  if (!ip) return null
  return createHmac('sha256', jwtSecret()).update(String(ip)).digest('hex').slice(0, 32)
}
