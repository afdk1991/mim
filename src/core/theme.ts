/* ==========================================================================
 * 主题 —— 浅色 / 深色切换
 *
 * 所有颜色必须走 CSS 变量（--primary / --text / --bg / --card / --line …），
 * 组件内禁止写死颜色，否则深色模式必然出现不可读文本。
 *
 * 系统偏好与落地动作都来自平台适配层：Web / Capacitor 写 `<html data-theme>`，
 * 小程序无 document 时由适配层做空实现，本文件不需要关心差异。
 * ======================================================================== */

import { getPlatform } from '../platform'
import type { ThemeMode } from '../platform'
import { readRaw, writeRaw } from './storage'

export type { ThemeMode }

const THEME_KEY = 'mim.theme'

export function getTheme(): ThemeMode {
  const saved = readRaw(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return getPlatform().env.prefersDark() ? 'dark' : 'light'
}

export function applyTheme(mode: ThemeMode): void {
  getPlatform().ui.applyTheme(mode)
}

export function setTheme(mode: ThemeMode): void {
  writeRaw(THEME_KEY, mode)
  applyTheme(mode)
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/** 应用启动时立即套用，避免首屏闪白 */
export function initTheme(): void {
  applyTheme(getTheme())
}
