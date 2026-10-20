# Mim

[![CI/CD · 构建 & 部署](https://github.com/afdk1991/mim/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/afdk1991/mim/actions/workflows/ci-cd.yml) [![跨平台 Release](https://github.com/afdk1991/mim/actions/workflows/build-release.yml/badge.svg)](https://github.com/afdk1991/mim/actions/workflows/build-release.yml) [![Lighthouse CI](https://github.com/afdk1991/mim/actions/workflows/lighthouse.yml/badge.svg)](https://github.com/afdk1991/mim/actions/workflows/lighthouse.yml) ![GitHub Release Version](https://img.shields.io/github/v/release/afdk1991/mim?include_prereleases&label=release)

React + Vite + TypeScript 实现的内容聚合社区 Demo（动态流 + 技术文章），并通过 Tauri 2、Capacitor 8 与 ArkTS 壳工程覆盖六大平台，内置 OTA 自动更新。

## 在线访问

- **GitHub Pages（稳定入口）**：https://afdk1991.github.io/mim/
- **EdgeOne Pages**：https://mim-yrchrlps.edgeone.cool

## 跨平台矩阵

| 平台 | 技术 | 构建 / 分发 | OTA 更新 |
| --- | --- | --- | --- |
| Windows / macOS / Linux | Tauri 2 | GitHub Actions（tag `V*` 触发）→ GitHub Releases 安装包 | tauri-plugin-updater，静默检测 `latest.json` 自动下载校验安装 |
| Android | Capacitor 8 + 自研 MimOta 插件 | GitHub Actions 签名构建 → Releases `app-release.apk` | 下载 APK → SHA-256 校验 → 调起系统安装器（固定 keystore 保证签名一致） |
| iOS | Capacitor 8 | GitHub Actions 模拟器冒烟构建（免签名） | 应用内弹窗引导跳 App Store（上架后替换 `src/ota.ts` 中 `STORE_URL`） |
| HarmonyOS | ArkTS WebView 壳（`harmony/`） | DevEco Studio 本地构建（Actions 无 HarmonyOS 环境） | http 拉取 manifest → 四段版本比较 → 弹窗引导（上架 AppGallery 后启用跳转） |
| Web | Vite | push main 自动部署 Pages + EdgeOne | 直接访问即最新版 |

## 版本与 OTA 协议

- 版本号统一四段式，**初始 `0.0.0.0`，每次递增 `0.0.0.1`**（V0.0.0.0 → V0.0.0.1 → V0.0.0.2，前三段恒为 0.0.0；tag 与 `src/version.ts` / `android versionName` 同步演进，`android versionCode` 随版本重置从 1 起单调递增；`package.json` 固定三段；`tauri.conf.json` 三段 semver 由 Release CI 注入「第1.第2.第4段」（V0.0.0.0 → 0.0.0）——桌面 OTA 靠该三段递增触发）
- OTA 清单：`https://github.com/afdk1991/mim/releases/latest/download/manifest.json`
  ```json
  {
    "version": "0.0.0.1",
    "android": { "url": "https://…/app-release.apk", "sha256": "…" }
  }
  ```
- 桌面端清单（Tauri updater 格式）：`…/releases/latest/download/latest.json`
- Android OTA 链路：启动 8s 后检测 → 6h 节流 → 下载 → SHA-256 校验 → 系统安装器；iOS 红线为禁止应用内静默自装，一律弹窗跳商店

## 本地构建

```bash
npm install
npm run build          # Web 资产 → dist/

# 桌面端（需 Rust 工具链）
npx tauri build

# Android（需 JDK 21 + Android SDK）
npx cap sync android
cd android && ./gradlew assembleRelease

# iOS（需 macOS + Xcode）
npx cap sync ios
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator build

# HarmonyOS（DevEco Studio 打开 harmony/）
node scripts/sync-harmony.mjs   # dist → rawfile 同步
```

## 仓库结构

- `src/` 前端源码（hash 路由，33 条路由，14 个独立工具台模块）
- `src-tauri/` 桌面壳（Tauri 2）
- `android/`、`ios/` 移动壳（Capacitor 8）
- `harmony/` 鸿蒙壳（ArkTS，仅源码入库）
- `.github/workflows/`：`ci-cd.yml`（Pages/EdgeOne/npm 包）、`build-release.yml`（六平台发布）

## 许可

个人项目，代码仅供学习交流。
