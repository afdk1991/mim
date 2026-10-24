/* Supabase Edge Function mim-api · 纯策略模块单测（vitest，node 环境）。
   与 CloudBase 云函数（cloudfunctions/mim-api/index.js）同契约同规则，
   这些纯函数是两个后端共享的安全底线：表访问策略、令牌、存储 key 隔离。 */

import { describe, expect, it } from 'vitest'
import { pbkdf2Sync } from 'node:crypto'
import {
  AUTH_READ,
  AUTHOR_COL,
  BRIDGE_LOCK_MINUTES,
  BRIDGE_MAX_ATTEMPTS,
  LEGACY_PBKDF2_ITERATIONS,
  MIME_ALLOW,
  MIME_DENY,
  OWNER_COL,
  PUBLIC_READ,
  READ_ONLY_TABLES,
  RPC_ALLOW,
  SERVER_ONLY,
  TOKEN_TTL_MS,
  appendFilter,
  bridgeFailState,
  bridgeLoginPlan,
  buildMediaKey,
  constantTimeEqualHex,
  isBridgeLocked,
  ownKey,
  pbkdf2Hex,
  safeExt,
  signToken,
  toAuthEmail,
  validatePassword,
  validateUsername,
  verifyToken,
  type BridgeRow,
} from './_shared/policy.ts'

describe('用户名 → GoTrue 邮箱映射', () => {
  it('普通用户名拼接合成邮箱', () => {
    expect(toAuthEmail('alice')).toBe('alice@mim.app')
  })
  it('含 @ 的输入按邮箱直通（兼容邮箱老账号）', () => {
    expect(toAuthEmail('bob@example.com')).toBe('bob@example.com')
  })
  it('空输入返回空串', () => {
    expect(toAuthEmail('')).toBe('')
    expect(toAuthEmail('   ')).toBe('')
  })
})

describe('注册输入校验', () => {
  it('合法用户名/密码通过', () => {
    expect(validateUsername('alice_01')).toBeNull()
    expect(validateUsername('a-b.c')).toBeNull()
    expect(validatePassword('12345678')).toBeNull()
  })
  it('过短/过长/非法字符用户名拒绝', () => {
    expect(validateUsername('ab')).toBeTruthy()
    expect(validateUsername('a'.repeat(33))).toBeTruthy()
    expect(validateUsername('中文名')).toBeTruthy()
    expect(validateUsername('has space')).toBeTruthy()
  })
  it('密码长度需为 8-72 位', () => {
    expect(validatePassword('1234567')).toBeTruthy()
    expect(validatePassword('1'.repeat(73))).toBeTruthy()
  })
})

describe('表访问策略（与 CloudBase 版一致）', () => {
  it('公开表/参考表/私有表归属列正确', () => {
    expect(PUBLIC_READ.has('posts')).toBe(true)
    expect(PUBLIC_READ.has('documents')).toBe(false)
    expect(AUTH_READ.has('roles')).toBe(true)
    expect(OWNER_COL.messages).toBe('owner_id')
    expect(OWNER_COL.documents).toBe('user_id')
    expect(AUTHOR_COL.posts).toBe('author_id')
  })
  it('服务端专表与世界观点数据受保护', () => {
    expect(SERVER_ONLY.has('app_users')).toBe(true)
    expect(SERVER_ONLY.has('audit_logs')).toBe(true)
    expect(READ_ONLY_TABLES.has('topics')).toBe(true)
    expect(READ_ONLY_TABLES.has('posts')).toBe(false)
  })
  it('RPC 白名单仅含两个安全函数', () => {
    expect(RPC_ALLOW.has('bump_article_views')).toBe(true)
    expect(RPC_ALLOW.has('send_message')).toBe(true)
    expect(RPC_ALLOW.size).toBe(2)
  })
})

describe('appendFilter', () => {
  it('空 query 直接生成子句', () => {
    expect(appendFilter('', 'user_id', 'u1')).toBe('user_id=eq.u1')
  })
  it('已有 query 用 & 拼接并对 uid 编码', () => {
    expect(appendFilter('select=*', 'owner_id', 'u 1&x')).toBe('select=*&owner_id=eq.u%201%26x')
  })
})

describe('HMAC 令牌（30 天）', () => {
  const secret = 'test-secret'

  it('签发后校验通过并取回 payload', async () => {
    const token = await signToken({ uid: 'u_123', username: 'alice' }, secret)
    const payload = await verifyToken(token, secret)
    expect(payload?.uid).toBe('u_123')
    expect(payload?.username).toBe('alice')
    expect(typeof payload?.iat).toBe('number')
  })

  it('错误 secret 校验失败', async () => {
    const token = await signToken({ uid: 'u_123' }, secret)
    expect(await verifyToken(token, 'other-secret')).toBeNull()
  })

  it('篡改签名校验失败', async () => {
    const token = await signToken({ uid: 'u_123' }, secret)
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    expect(await verifyToken(flipped, secret)).toBeNull()
  })

  it('过期令牌（iat 超过 30 天）校验失败', async () => {
    const token = await signToken({ uid: 'u_123', iat: Date.now() - TOKEN_TTL_MS - 60_000 }, secret)
    expect(await verifyToken(token, secret)).toBeNull()
  })

  it('缺 uid 的 payload 校验失败', async () => {
    const token = await signToken({ username: 'alice' }, secret)
    expect(await verifyToken(token, secret)).toBeNull()
  })

  it('空令牌 / 空 secret 校验失败', async () => {
    expect(await verifyToken('', secret)).toBeNull()
    expect(await verifyToken('abc.def', '')).toBeNull()
  })
})

describe('存储 key 隔离', () => {
  const uid = 'u_123'

  it('自己的 key 放行', () => {
    expect(ownKey(uid, `${uid}/2026-10/abc.png`)).toBe(true)
  })
  it('他人的 key / 路径穿越拒绝', () => {
    expect(ownKey(uid, 'u_999/2026-10/abc.png')).toBe(false)
    expect(ownKey(uid, `${uid}/../../etc/passwd`)).toBe(false)
    expect(ownKey(uid, 42 as unknown as string)).toBe(false)
  })

  it('buildMediaKey 形如 <uid>/<yyyy-mm>/<uuid>.<ext>', () => {
    const key = buildMediaKey(uid, 'photo.PNG', 'image/png', 'fixed-uuid', new Date('2026-01-05T00:00:00Z'))
    expect(key).toBe('u_123/2026-01/fixed-uuid.png')
  })
  it('月份补零；无 MIME 时按文件名取扩展名', () => {
    const key = buildMediaKey(uid, 'clip.mp4', 'application/octet-stream', 'x', new Date('2026-03-09T00:00:00Z'))
    expect(key).toBe('u_123/2026-03/x.mp4')
  })
})

describe('safeExt 白名单收敛', () => {
  it('已知 MIME 优先映射', () => {
    expect(safeExt('a.xyz', 'image/jpeg')).toBe('jpg')
    expect(safeExt('a.xyz', 'video/mp4')).toBe('mp4')
  })
  it('未知 MIME 按文件名扩展名（小写）', () => {
    expect(safeExt('a.PNG', 'application/octet-stream')).toBe('png')
  })
  it('危险扩展名与无扩展名收敛为 bin', () => {
    expect(safeExt('a.php', 'application/octet-stream')).toBe('bin')
    expect(safeExt('a.sh', 'application/octet-stream')).toBe('bin')
    expect(safeExt('noext', 'application/octet-stream')).toBe('bin')
  })
})

describe('MIME 放行规则', () => {
  it('图片/音频/视频放行，svg 排除', () => {
    expect(MIME_ALLOW.some((p) => 'image/png'.startsWith(p))).toBe(true)
    expect(MIME_ALLOW.some((p) => 'video/mp4'.startsWith(p))).toBe(true)
    expect(MIME_ALLOW.some((p) => 'audio/mpeg'.startsWith(p))).toBe(true)
    expect(MIME_DENY.has('image/svg+xml')).toBe(true)
  })
})

describe('账号桥 · PBKDF2 旧哈希验证（与 CloudBase 版同参同形）', () => {
  const password = 'correct-horse-battery'
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

  it('与 Node crypto.pbkdf2Sync 逐位一致（跨端兼容的硬证据）', async () => {
    const viaWebCrypto = await pbkdf2Hex(password, salt, 1000, 32)
    // Node 侧参考值：PBKDF2-SHA512(1000, 32B)，hex
    const expected = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 1000, 32, 'sha512').toString('hex')
    expect(viaWebCrypto).toBe(expected)
  })

  it('默认参数即 CloudBase 版参数（100k 迭代 / 64 字节）', async () => {
    const expected = pbkdf2Sync(password, Buffer.from(salt, 'hex'), LEGACY_PBKDF2_ITERATIONS, 64, 'sha512').toString('hex')
    expect(await pbkdf2Hex(password, salt)).toBe(expected)
  })

  it('密码差一位 → 哈希不同（验证有效）', async () => {
    const a = await pbkdf2Hex(password, salt, 1000, 32)
    const b = await pbkdf2Hex(`${password}x`, salt, 1000, 32)
    expect(constantTimeEqualHex(a, b)).toBe(false)
  })
})

describe('账号桥 · constantTimeEqualHex', () => {
  it('相等 / 不等 / 长度不同', () => {
    expect(constantTimeEqualHex('abcd', 'abcd')).toBe(true)
    expect(constantTimeEqualHex('abcd', 'abce')).toBe(false)
    expect(constantTimeEqualHex('abcd', 'abcde')).toBe(false)
  })
})

describe('账号桥 · 锁定策略', () => {
  const now = Date.parse('2026-10-24T12:00:00Z')

  it('无锁定 / 未来时刻锁定 / 已过时刻解锁', () => {
    expect(isBridgeLocked({ locked_until: null }, now)).toBe(false)
    expect(isBridgeLocked({ locked_until: new Date(now + 60_000).toISOString() }, now)).toBe(true)
    expect(isBridgeLocked({ locked_until: new Date(now - 60_000).toISOString() }, now)).toBe(false)
  })

  it('未达上限只计数；达到上限锁定 15 分钟', () => {
    const below = bridgeFailState(BRIDGE_MAX_ATTEMPTS - 2, now)
    expect(below.failed_attempts).toBe(BRIDGE_MAX_ATTEMPTS - 1)
    expect(below.locked_until).toBeNull()

    const at = bridgeFailState(BRIDGE_MAX_ATTEMPTS - 1, now)
    expect(at.failed_attempts).toBe(BRIDGE_MAX_ATTEMPTS)
    expect(new Date(at.locked_until!).getTime()).toBe(now + BRIDGE_LOCK_MINUTES * 60_000)
  })
})

describe('账号桥 · bridgeLoginPlan 分支', () => {
  const now = Date.parse('2026-10-24T12:00:00Z')
  const base: BridgeRow = {
    username: 'alice',
    cloudbase_uid: 'u_abc',
    password_hash: 'ff',
    salt: 'ab',
    migrated: false,
    failed_attempts: 0,
    locked_until: null,
  }

  it('无记录 → gone（前端不再重试）', () => {
    expect(bridgeLoginPlan(null, now)).toBe('gone')
  })
  it('锁定中 → locked', () => {
    expect(bridgeLoginPlan({ ...base, failed_attempts: 5, locked_until: new Date(now + 60_000).toISOString() }, now)).toBe('locked')
  })
  it('已升级 → migrated（引导走原生登录）', () => {
    expect(bridgeLoginPlan({ ...base, migrated: true }, now)).toBe('migrated')
  })
  it('正常待验 → verify', () => {
    expect(bridgeLoginPlan(base, now)).toBe('verify')
  })
})
