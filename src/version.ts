// 应用版本号（四段式 major.minor.patch.build，每次递增 0.0.0.1）——全平台统一显示与 OTA 比较的唯一来源
// 注：npm 强制三段 semver（package.json 固定 0.0.0）；tauri.conf.json 三段由 Release CI 注入 tag「第1.第2.第4段」（V0.0.0.1 → 0.0.1）
export const APP_VERSION = '0.0.0.1'
