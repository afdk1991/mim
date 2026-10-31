/* ==========================================================================
 * 版本体系 —— 三段式 semver major.minor.patch，全工程唯一版本源
 *
 * 所有载体（package.json / tauri.conf / Cargo.toml / Android / iOS /
 * HarmonyOS / worker / git tag）统一使用这同一个三段版本号，不再做四段投影。
 * git tag 形如 V0.0.0（大写 V + 三段）。
 * ======================================================================== */

export const APP_VERSION = '0.0.0'

/**
 * 发布通道：区分「正式对外发布版」与「内部测试版 / 预发布版 / 草稿版」。
 * 仅影响展示与发版校验，**绝不改变 APP_VERSION**（三段 semver 唯一源）。
 *   ''        正式对外发布版（项目首个正式版 = V0.0.0）
 *   'preview' 公网预览版（如后端暂缓、仅前端先上线的阶段）
 *   'draft'   内部草稿 / 开发构建
 *   'test'    内部测试版
 * 正式版号 V0.0.0 在正式发布前，禁止被任何内部构建以 V0.0.0 形态占用（见 version-check.mjs）。
 */
export type ReleaseChannel = '' | 'preview' | 'draft' | 'test'
export const RELEASE_CHANNEL: ReleaseChannel = 'preview'

/** 展示用版本号：正式版 = V0.0.0；预览/草稿 = V0.0.0-preview 等 */
export function displayVersion(v: string = APP_VERSION): string {
  return RELEASE_CHANNEL ? `V${v}-${RELEASE_CHANNEL}` : `V${v}`
}

/** 三段版本（统一后即唯一值，保留函数位以便调用方过渡） */
export function derivedVersion(v: string = APP_VERSION): string {
  return v
}

/** 比较版本号：next 严格大于 current 返回 true */
export function isNewer(current: string, next: string): boolean {
  const a = current.split('.').map((x) => Number(x) || 0)
  const b = next.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (y > x) return true
    if (y < x) return false
  }
  return false
}
