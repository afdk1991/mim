import { describe, expect, it } from 'vitest'
import {
  clamp,
  cx,
  ellipsis,
  fenToYuan,
  formatCount,
  formatDuration,
  uniq,
  yuanText,
  yuanToFen,
} from '../src/core/utils'

describe('金额换算（分 ↔ 元）', () => {
  it('yuanToFen 保留两位小数精度', () => {
    expect(yuanToFen(19.99)).toBe(1999)
    expect(yuanToFen(0.1)).toBe(10)
    expect(yuanToFen(0)).toBe(0)
  })

  it('yuanToFen 对非法值回退 0', () => {
    expect(yuanToFen(Number.NaN)).toBe(0)
    expect(yuanToFen(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('yuanText 输出两位小数字符串', () => {
    expect(yuanText(1999)).toBe('19.99')
    expect(yuanText(0)).toBe('0.00')
    expect(yuanText(5)).toBe('0.05')
    expect(yuanText(Number.NaN)).toBe('0.00')
  })

  it('fenToYuan 四舍五入到整数元', () => {
    expect(fenToYuan(1999)).toBe(20)
    expect(fenToYuan(149)).toBe(1)
    expect(fenToYuan(Number.NaN)).toBe(0)
  })

  it('换算往返不丢分', () => {
    for (const fen of [1, 99, 100, 1999, 123456]) {
      expect(yuanToFen(Number(yuanText(fen)))).toBe(fen)
    }
  })
})

describe('formatCount 计数缩写', () => {
  it('万以下原样输出整数', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(9999)).toBe('9999')
  })

  it('万以上保留一位小数并去掉 .0', () => {
    expect(formatCount(10000)).toBe('1万')
    expect(formatCount(12345)).toBe('1.2万')
    expect(formatCount(99999)).toBe('9.9万')
  })

  it('非法值回退 0', () => {
    expect(formatCount(Number.NaN)).toBe('0')
  })
})

describe('formatDuration 媒体时长', () => {
  it('一小时以内输出 mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(9)).toBe('00:09')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(3599)).toBe('59:59')
  })

  it('超过一小时输出 h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3671)).toBe('1:01:11')
  })

  it('非法或负值回退 00:00', () => {
    expect(formatDuration(-1)).toBe('00:00')
    expect(formatDuration(Number.NaN)).toBe('00:00')
  })
})

describe('clamp 钳制', () => {
  it('夹在上下界之间', () => {
    expect(clamp(5, 1, 10)).toBe(5)
    expect(clamp(-5, 1, 10)).toBe(1)
    expect(clamp(50, 1, 10)).toBe(10)
  })

  it('非法值使用 fallback（默认下界）', () => {
    expect(clamp(Number.NaN, 1, 10)).toBe(1)
    expect(clamp(Number.NaN, 1, 10, 7)).toBe(7)
  })
})

describe('ellipsis / uniq / cx', () => {
  it('ellipsis 超长才截断并加省略号', () => {
    expect(ellipsis('abc', 3)).toBe('abc')
    expect(ellipsis('abcdef', 3)).toBe('abc…')
  })

  it('uniq 保持首次出现顺序', () => {
    expect(uniq([3, 1, 3, 2, 1])).toEqual([3, 1, 2])
  })

  it('cx 过滤空值后拼接', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b')
    expect(cx()).toBe('')
  })
})
