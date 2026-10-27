// 应用版本号 —— 全平台统一显示与 OTA 比较的唯一来源（唯一版本源 / Single Source of Truth）
//
// 版本体系（与 README.md「版本号约定」保持一致）：
//   四段式 major.minor.patch.build，当前统一为 0.0.0.0，每次递增 0.0.0.1
//   （V0.0.0.0 → V0.0.0.1 → ...，前三段恒为 0.0.0）
//
// 派生规则（因 npm / iOS / Tauri 强制三段 semver，无法承载四段式）：
//   三段式载体取「第1.第2.第4段」—— V0.0.0.0 → 0.0.0，V0.0.0.1 → 0.0.1
//   适用：package.json、src-tauri/{Cargo.toml,tauri.conf.json}、iOS MARKETING_VERSION、
//        harmony oh-package.json5
//   四段式载体直接用原值：Android/Harmony versionName、git tag（大写 V）
//
// 构建号（versionCode / CURRENT_PROJECT_VERSION）必须单调递增，不得随版本名回退，
// 否则 Android/iOS/Harmony 会拒绝 OTA 更新。
export const APP_VERSION = '0.0.0.0'
