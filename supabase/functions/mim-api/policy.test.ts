/* Supabase Edge Function mim-api · 纯策略模块单测（vitest，node 环境）。
   与 CloudBase 云函数（cloudfunctions/mim-api/index.js）同契约同规则，
   这些纯函数是两个后端共享的安全底线：表访问策略、令牌、存储 key 隔离。 */

import { describe, expect, it } from 'vitest'
import {
  AUTH_READ,
  AUTHOR_COL,
  MIME_ALLOW,
  MIME_DENY,
  OWNER_COL,
  PUBLIC_READ,
  READ_ONLY_TABLES,
  RPC_ALLOW,
  SERVER_ONLY,
  TOKEN_TTL_MS,
  appendFilter,
  buildMediaKey,
  ownKey,
  safeExt,
  signToken,
  toAuthEmail,
  validatePassword,
  validateUsername,
  verifyToken,
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
