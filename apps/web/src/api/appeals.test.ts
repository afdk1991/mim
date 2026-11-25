/**
 * 申诉窗口纯函数契约测试：7 天受理窗口判定。
 *
 * 不启动浏览器、不发真实请求；只冻结时钟校验时间区间边界，
 * 与后端 APPEAL_WINDOW_MS 同口径（7 个自然日，毫秒）。
 */

import { describe, expect, it } from 'vitest'; // vitest 编排
import { APPEAL_WINDOW_MS, appealWindowOpen } from './appeals.js'; // 待测常量与纯函数

const NOW = '2026-11-25T08:00:00.000Z'; // 冻结当前时间，便于边界断言

/** 按距今天数回推一个 ISO 时间串 */
function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString(); // 毫秒换算后回推
} // daysAgo 结束

describe('appealWindowOpen：7 天申诉窗口判定', () => {
  it('窗口内（当天 / 3 天前）判定为可申诉', () => {
    expect(appealWindowOpen(daysAgo(0), NOW)).toBe(true); // 刚处置，窗口内
    expect(appealWindowOpen(daysAgo(3), NOW)).toBe(true); // 3 天前处置，仍在窗口内
  });

  it('恰好第 7 天仍在窗口边界内', () => {
    expect(appealWindowOpen(daysAgo(7), NOW)).toBe(true); // 7×24h 临界值按含端点处理
  });

  it('超过 7 天（8 天前）判定为不可申诉', () => {
    expect(appealWindowOpen(daysAgo(8), NOW)).toBe(false); // 超窗口拒绝
  });

  it('非法 / 空时间串按不可申诉兜底，不放行脏数据', () => {
    expect(appealWindowOpen('', NOW)).toBe(false); // 空串不可解析
    expect(appealWindowOpen('not-a-date', NOW)).toBe(false); // 非法时间串不可解析
  });

  it('窗口常量与后端口径一致：7 个自然日', () => {
    expect(APPEAL_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000); // 7×24×60×60×1000 毫秒
  });
});
