/* ==========================================================================
 * 主题 —— 浅色 / 深色切换，写入 <html data-theme>
 *
 * 所有颜色必须走 CSS 变量（--primary / --text / --bg / --card / --line …），
 * 组件内禁止写死颜色，否则深色模式必然出现不可读文本。
 * ======================================================================== */

import { readRaw, writeRaw } from './storage'

export type ThemeMode = 'light' | 'dark'

const THEME_KEY = 'mim.theme'

export function getTheme(): ThemeMode {
  const saved = readRaw(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode
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
