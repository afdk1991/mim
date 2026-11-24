/**
 * 账号注销倒计时与导出文件名纯函数（无 React / 无网络依赖，可独立单测）。
 *
 * 对齐后端账号注销契约：
 * - `deletion_scheduled_at` 为 ISO8601；null 表示未申请注销；
 * - 冷静期内按「天 / 小时 / 分」向下取整展示，到期即提示已到期；
 * - 导出数据包文件名固定为 `mim-data-<member_no>-<YYYYMMDD>.json`。
 */

const MINUTE_MS = 60_000; // 一分钟对应的毫秒数
const HOUR_MS = 60 * MINUTE_MS; // 一小时对应的毫秒数
const DAY_MS = 24 * HOUR_MS; // 一天对应的毫秒数

/** 把数字补零到两位，用于本地日期时间展示 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
} // pad2 结束

/**
 * 格式化剩余时长。
 * @param ms 距删除时刻的毫秒数；≤ 0 或非有限数视为已到期
 * @returns 「剩余 X 天 Y 小时」/「剩余 Y 小时 Z 分」/「已到期」
 */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '已到期'; // 非有限值或零负时长直接按到期处理
  const days = Math.floor(ms / DAY_MS); // 整天数
  if (days > 0) {
    const hours = Math.floor((ms % DAY_MS) / HOUR_MS); // 扣除整天后剩余的整小时
    return `剩余 ${days} 天 ${hours} 小时`; // 超过一天：天 + 小时两档展示
  }
  const hours = Math.floor(ms / HOUR_MS); // 不足一天：整小时数
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS); // 扣除整小时后剩余的整分
  return `剩余 ${hours} 小时 ${minutes} 分`; // 不足一天：小时 + 分两档展示
} // formatRemaining 结束

/**
 * 判断预约删除时刻是否已到期。
 * @param scheduledAt ISO8601 时间串；null / 空串表示未申请注销，不算逾期
 * @param now 当前时间戳（毫秒），缺省取 Date.now()，测试时可注入固定时刻
 */
export function isOverdue(scheduledAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!scheduledAt) return false; // 未申请注销：不存在逾期概念
  const time = new Date(scheduledAt).getTime(); // 解析为时间戳
  if (!Number.isFinite(time)) return false; // 非法时间串不判逾期，避免误锁账号
  return time <= now; // 预约时刻不晚于当前时刻即视为到期
} // isOverdue 结束

/**
 * 生成数据包导出文件名：`mim-data-<member_no>-<YYYYMMDD>.json`。
 * @param memberNo 对外 Mim ID；非法字符剔除后为空时回落 `unknown`
 * @param date 导出时刻，缺省取当前时间；日期按本地时区取 YYYYMMDD
 */
export function exportFileName(memberNo: string, date: Date | number = new Date()): string {
  const d = date instanceof Date ? date : new Date(date); // 统一收敛为 Date 实例
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; // 本地日期戳 YYYYMMDD
  const safe = (memberNo ?? '').replace(/[^A-Za-z0-9_-]/g, ''); // 只保留字母数字与 _ -，避免文件名注入特殊字符
  return `mim-data-${safe || 'unknown'}-${stamp}.json`; // 拼接固定前缀、号段、日期戳与 json 后缀
} // exportFileName 结束

/** 把 ISO 时间格式化为本地展示串 `YYYY-MM-DD HH:mm`；非法串原样返回 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso); // 解析时间串
  if (!Number.isFinite(d.getTime())) return iso; // 解析失败不丢原值，便于排障
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; // 年月日 + 时分
} // formatDateTime 结束
