/* ==========================================================================
 * 埋点客户端单测 —— 对应 docs/qa/测试策略.md 的 L1 单元测试层
 *
 * 为什么值得测：埋点是全站基础设施，它一旦「吞掉错误藏在内部」或「把密码写进队列」，
 * 线上不会报错，只会静默丢失数据或泄漏隐私 —— 这类 bug 靠肉眼 review 必漏。
 *
 * 注意：刻意把入队条数控制在 BATCH_SIZE(20) 以下，避免单测里触发自动 flush 去打网络。
 * ========================================================================== */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetTelemetryForTest,
  telemetryQueueSnapshot,
  telemetrySelfCheck,
  track,
} from '../src/core/telemetry'

beforeEach(() => {
  resetTelemetryForTest()
})

describe('埋点：白名单与字段安全', () => {
  it('白名单内的事件正常入队', () => {
    track('app_launch')
    const q = telemetryQueueSnapshot()
    expect(q).toHaveLength(1)
    expect(q[0]?.event).toBe('app_launch')
  })

  it('不在白名单的事件被丢弃且计入 dropped', () => {
    // @ts-expect-error 故意传非法事件名：验证运行期护栏而非类型层
    track('hack_event', { x: 1 })
    expect(telemetryQueueSnapshot()).toHaveLength(0)
    const s = telemetrySelfCheck()
    expect(s.dropped).toBe(1)
    expect(s.lastError).toContain('白名单')
  })

  it('敏感字段一律剔除，常规字段保留', () => {
    track('auth_login', {
      password: 'p@ssw0rd',
      token: 'jwt-abc',
      phone: '13800000000',
      channel: 'web',
    })
    const props = telemetryQueueSnapshot()[0]?.props ?? {}
    expect(props.password).toBeUndefined()
    expect(props.token).toBeUndefined()
    expect(props.phone).toBeUndefined()
    expect(props.channel).toBe('web')
  })

  it('超长字符串不入队（防日志库被打满）', () => {
    track('content_post_view', { title: 'x'.repeat(500), ok: 1 })
    const props = telemetryQueueSnapshot()[0]?.props ?? {}
    expect(props.title).toBeUndefined()
    expect(props.ok).toBe(1)
  })

  it('必带公共属性：版本号与平台', () => {
    track('app_launch')
    const props = telemetryQueueSnapshot()[0]?.props ?? {}
    expect(typeof props.app_version).toBe('string')
    expect(typeof props.platform).toBe('string')
    expect(typeof props.session_id).toBe('string')
  })
})

describe('埋点：永不抛错（基础设施的底线）', () => {
  it('payload 传入循环引用也不抛错', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(() => {
      // @ts-expect-error 故意传非法形态：断言运行期护栏
      track('content_post_view', cyclic)
    }).not.toThrow()
  })

  it('同一会话 session_id 稳定（否则漏斗无法串联）', () => {
    track('app_launch')
    track('page_view', { path: '#/feed' })
    const q = telemetryQueueSnapshot()
    expect(q[0]?.props.session_id).toBe(q[1]?.props.session_id)
  })
})

describe('埋点：自检输出', () => {
  it('selfCheck 计数与实际入队一致', () => {
    track('app_launch')
    track('page_view', { path: '#/feed' })
    const s = telemetrySelfCheck()
    expect(s.enqueued).toBe(2)
    expect(s.queued).toBe(2)
    expect(s.dropped).toBe(0)
  })
})

describe('埋点：服务端幂等与匿名归因', () => {
  it('每条事件带唯一 eid（服务端据此去重，重传不重复计数）', () => {
    track('app_launch')
    track('app_launch')
    const q = telemetryQueueSnapshot()
    expect(q[0]?.eid).toBeTruthy()
    expect(q[1]?.eid).toBeTruthy()
    expect(q[0]?.eid).not.toBe(q[1]?.eid)
  })

  it('同一会话 anon_id 稳定且不被脱敏规则误删（未登录也能串联漏斗）', () => {
    track('app_launch')
    track('page_view', { path: '#/feed' })
    const q = telemetryQueueSnapshot()
    expect(q[0]?.props.anon_id).toBeTruthy()
    expect(q[0]?.props.anon_id).toBe(q[1]?.props.anon_id)
  })
})
