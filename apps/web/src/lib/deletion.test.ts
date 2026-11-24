/**
 * 注销倒计时与导出文件名纯函数契约测试。
 *
 * 不启动浏览器、不发真实请求；只覆盖无副作用的时长格式化、逾期判定与文件名拼装，
 * 日期断言使用固定时刻，避免时区与系统时间抖动造成用例漂移。
 */

import { describe, expect, it } from 'vitest'; // vitest 编排
import { exportFileName, formatDateTime, formatRemaining, isOverdue } from './deletion.js'; // 待测纯函数

const MINUTE = 60_000; // 一分钟毫秒数，便于构造固定时长
const HOUR = 60 * MINUTE; // 一小时毫秒数
const DAY = 24 * HOUR; // 一天毫秒数

describe('formatRemaining：剩余时长分段展示', () => {
  it('超过一天：展示「剩余 X 天 Y 小时」', () => {
    expect(formatRemaining(6 * DAY + 3 * HOUR + 20 * MINUTE)).toBe('剩余 6 天 3 小时'); // 6 天 3 小时 20 分，分档后舍去分
  });

  it('不足一天：展示「剩余 Y 小时 Z 分」', () => {
    expect(formatRemaining(5 * HOUR + 40 * MINUTE)).toBe('剩余 5 小时 40 分'); // 小时 + 分两档
  });

  it('零、负数与非有限值一律显示「已到期」', () => {
    expect(formatRemaining(0)).toBe('已到期'); // 恰好到期
    expect(formatRemaining(-3 * HOUR)).toBe('已到期'); // 已过期一段时间
    expect(formatRemaining(Number.NaN)).toBe('已到期'); // 非法时长兜底
  });

  it('边界：整天与不足一小时按各自档位展示', () => {
    expect(formatRemaining(DAY)).toBe('剩余 1 天 0 小时'); // 整一天：小时档为 0
    expect(formatRemaining(45 * MINUTE)).toBe('剩余 0 小时 45 分'); // 不足一小时：小时档为 0
  });
});

describe('isOverdue：预约删除时刻逾期判定', () => {
  const now = new Date('2026-11-24T12:00:00Z').getTime(); // 固定当前时刻，便于构造前后时间

  it('未来预约不算逾期，过去预约判定逾期', () => {
    expect(isOverdue('2026-11-25T12:00:00Z', now)).toBe(false); // 晚于当前时刻
    expect(isOverdue('2026-11-24T10:00:00Z', now)).toBe(true); // 早于当前时刻
  });

  it('未申请注销（null / 空串）与非法时间串均不判逾期', () => {
    expect(isOverdue(null, now)).toBe(false); // 未申请注销
    expect(isOverdue('', now)).toBe(false); // 空串兜底
    expect(isOverdue('not-a-date', now)).toBe(false); // 非法串不误锁账号
  });
});

describe('exportFileName：导出数据包文件名拼装', () => {
  it('按 mim-data-<member_no>-<YYYYMMDD>.json 生成，日期取本地传入时刻', () => {
    expect(exportFileName('102', new Date(2026, 10, 24))).toBe('mim-data-102-20261124.json'); // 11 月按 0 基月份构造
  });

  it('剔除号段中的非法字符；空号段回落 unknown', () => {
    expect(exportFileName('102/ab?', new Date(2026, 10, 24))).toBe('mim-data-102ab-20261124.json'); // 斜杠问号被剔除
    expect(exportFileName('   ', new Date(2026, 10, 24))).toBe('mim-data-unknown-20261124.json'); // 空号段兜底
  });
});

describe('formatDateTime：本地日期时间展示串', () => {
  it('格式化为 YYYY-MM-DD HH:mm，非法串原样返回', () => {
    expect(formatDateTime('2026-11-24T03:05:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/); // 合法串走展示格式
    expect(formatDateTime('bad-date')).toBe('bad-date'); // 非法串不丢原值
  });
});
