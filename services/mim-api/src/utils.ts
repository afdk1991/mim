/** 时间与通用小工具（无第三方依赖的必要逻辑，仅做 ISO-8601 归一） */

import type { Request } from 'express';
import { AppError } from '@mim/core-domain';

/** Express 5 的 req.params 值类型包含 string[]，统一收敛为 string */
export function pathParam(req: Request, name: string): string {
  const value: unknown = req.params[name];
  if (typeof value === 'string') return value;
  throw new AppError('VALIDATION_FAILED', `invalid path parameter: ${name}`, { param: name });
}

export function nowIso(clock?: () => string): string {
  return clock ? clock() : new Date().toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 3600 * 1000).toISOString();
}

/** UTC 日期字符串 YYYY-MM-DD */
export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

export function todayDate(clock?: () => string): string {
  return isoDate(nowIso(clock));
}

export function plusDaysDate(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(base + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(time);
}

export function jsonParse<T>(value: string | null): T | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
