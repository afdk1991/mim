/* 工具函数单测（node:test 零依赖，Node ≥ 22.18 原生 TS 剥离直接运行）
   覆盖 uid / cx / timeAgo / formatDate / formatCount —— 均为无副作用的纯函数。
   时间相关用例基于 Date.now() 相对偏移 + 足够余量，不依赖固定墙钟，任意时刻可跑。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uid, cx, timeAgo, formatDate, formatCount } from './utils.ts'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

test('uid：带前缀、长度足够、两次调用不重复', () => {
  const a = uid('t-')
  assert.ok(a.startsWith('t-'), `应带前缀: ${a}`)
  assert.ok(a.length > 8, `长度应大于 8: ${a}`)
  assert.notEqual(uid('t-'), uid('t-'), '两次调用不应重复')
  assert.ok(uid().length > 0, '无前缀也应非空')
})

test('cx：过滤假值后空格拼接', () => {
  assert.equal(cx('a', 'b'), 'a b')
  assert.equal(cx('a', false, null, undefined, 'b'), 'a b')
  assert.equal(cx('a'), 'a')
  assert.equal(cx(), '')
  assert.equal(cx(false, null, undefined), '')
})

test('timeAgo：刚刚 / 分钟前 / 小时前 / 昨天', () => {
  const now = Date.now()
  assert.equal(timeAgo(now - 30_000), '刚刚')
  assert.equal(timeAgo(now - 5 * MIN), '5分钟前')
  assert.equal(timeAgo(now - 59 * MIN), '59分钟前')
  assert.equal(timeAgo(now - 3 * HOUR), '3小时前')
  assert.equal(timeAgo(now - 23 * HOUR), '23小时前')
  assert.equal(timeAgo(now - 25 * HOUR), '昨天')
  assert.equal(timeAgo(now - 47 * HOUR), '昨天')
})

/** 复刻 timeAgo 日期分支的期望格式（本地时间组件），用于校验分支与格式而非具体日期 */
function expectDateFmt(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() === new Date().getFullYear()
    ? `${mm}-${dd}`
    : `${d.getFullYear()}-${mm}-${dd}`
}

test('timeAgo：日期分支（≥2 天走本地日期格式）', () => {
  const t10d = Date.now() - 10 * DAY
  assert.equal(timeAgo(t10d), expectDateFmt(t10d), '10 天前应走日期分支')
  const t400d = Date.now() - 400 * DAY
  assert.equal(timeAgo(t400d), expectDateFmt(t400d), '400 天前应走日期分支')
  assert.match(timeAgo(t400d), /^\d{4}-\d{2}-\d{2}$/, '400 天前必跨年，应为完整日期')
})

test('formatDate：本地时间 YYYY-MM-DD HH:mm（补零）', () => {
  assert.equal(formatDate(new Date(2026, 0, 5, 9, 8).getTime()), '2026-01-05 09:08')
  assert.equal(formatDate(new Date(2026, 11, 31, 23, 59).getTime()), '2026-12-31 23:59')
})

test('formatCount：万位截断与 .0 清理', () => {
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(9999), '9999')
  assert.equal(formatCount(10_000), '1万')
  assert.equal(formatCount(12_345), '1.2万')
  assert.equal(formatCount(100_000), '10万')
  assert.equal(formatCount(123_456), '12.3万')
})
