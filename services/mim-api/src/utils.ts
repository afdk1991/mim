/** 时间与通用小工具（无第三方依赖的必要逻辑，仅做 ISO-8601 归一） */

import type { Request } from 'express'; // 仅引入请求类型，用于 pathParam 的类型约束，编译期擦除
import { AppError } from '@mim/core-domain'; // 引入统一业务异常，参数非法时抛 VALIDATION_FAILED

/** Express 5 的 req.params 值类型包含 string[]，统一收敛为 string */
export function pathParam(req: Request, name: string): string { // 安全取路径参数：非字符串一律报参数错误
  const value: unknown = req.params[name]; // 显式收敛为 unknown，避免把 string[] 当字符串误用
  if (typeof value === 'string') return value; // 常规单值参数直接返回
  throw new AppError('VALIDATION_FAILED', `invalid path parameter: ${name}`, { param: name }); // 通配/数组参数或缺失时拒绝，防止后续拼接出意外路径或查询
} // pathParam 结束

export function nowIso(clock?: () => string): string { // 取当前 ISO 时间；可注入时钟以便测试固定时间
  return clock ? clock() : new Date().toISOString(); // 有注入用注入，否则取系统时间
} // nowIso 结束

export function addSeconds(iso: string, seconds: number): string { // 在 ISO 时间上加指定秒数
  return new Date(Date.parse(iso) + seconds * 1000).toISOString(); // 先解析为毫秒时间戳再偏移，避免手工处理月份与闰秒
} // addSeconds 结束

export function addDays(iso: string, days: number): string { // 在 ISO 时间上加指定天数
  return new Date(Date.parse(iso) + days * 24 * 3600 * 1000).toISOString(); // 天换算成毫秒统一偏移，输出仍是标准 ISO 串
} // addDays 结束

/** UTC 日期字符串 YYYY-MM-DD */
export function isoDate(iso: string): string { // 从 ISO 时间串截取日期部分
  return iso.slice(0, 10); // ISO 格式固定，前 10 位即 YYYY-MM-DD，无需解析
} // isoDate 结束

export function todayDate(clock?: () => string): string { // 取「今天」的 UTC 日期
  return isoDate(nowIso(clock)); // 复用 nowIso 与 isoDate，保证与其它时间口径一致
} // todayDate 结束

export function plusDaysDate(date: string, days: number): string { // 在 YYYY-MM-DD 日期上偏移天数
  const base = Date.parse(`${date}T00:00:00.000Z`); // 显式补 UTC 零点，避免本地时区造成跨天偏差
  return new Date(base + days * 24 * 3600 * 1000).toISOString().slice(0, 10); // 偏移后转回日期串，输出仍为 YYYY-MM-DD
} // plusDaysDate 结束

export function isIsoDate(value: string): boolean { // 校验是否为合法 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; // 先做格式快速失败，避免无效解析
  const time = Date.parse(`${value}T00:00:00.000Z`); // 再按 UTC 零点解析，排除 2026-13-40 这类格式正确但日期非法的值
  return !Number.isNaN(time); // NaN 表示日期非法
} // isIsoDate 结束

export function jsonParse<T>(value: string | null): T | null { // 解析数据库中的 JSON 文本，脏数据不抛错
  if (value === null) return null; // 空值直接返回 null
  try { // JSON 可能来自历史脏数据，解析失败不能拖垮整个请求
    return JSON.parse(value) as T; // 由调用方按泛型断言具体结构
  } catch { // 解析异常
    return null; // 降级为 null，由调用方决定默认值
  } // try/catch 结束
} // jsonParse 结束

export function csvEscape(value: string): string { // CSV 导出转义：含逗号/引号/换行时用双引号包裹
  if (/[",\r\n]/.test(value)) { // 只有特殊字符需要包裹，普通文本保持原样以免文件膨胀
    return `"${value.replace(/"/g, '""')}"`; // 内部双引号按 CSV 规范重复一次
  } // 特殊字符判定结束
  return value; // 无需转义时原样返回
} // csvEscape 结束
