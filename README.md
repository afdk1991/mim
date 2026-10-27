# Mim

[![CI/CD · 构建 & 部署](https://github.com/afdk1991/mim/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/afdk1991/mim/actions/workflows/ci-cd.yml) [![跨平台 Release](https://github.com/afdk1991/mim/actions/workflows/build-release.yml/badge.svg)](https://github.com/afdk1991/mim/actions/workflows/build-release.yml) ![GitHub Release Version](https://img.shields.io/github/v/release/afdk1991/mim?include_prereleases&label=release)

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
- **唯一版本源（Single Source of Truth）**：`src/version.ts` 的 `APP_VERSION`（四段式）。其余载体**全部由它派生，禁止手改**：
  | 载体 | 取值 |
  |---|---|
  | git tag（大写 `V`）、`android/app/build.gradle` versionName、`harmony/AppScope/app.json5` versionName | 原值四段式 |
  | `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、iOS `MARKETING_VERSION`、`harmony/**/oh-package.json5` | 三段派生「第1.第2.第4段」（`V0.0.0.0 → 0.0.0`、`V0.0.0.1 → 0.0.1`）——因 npm / iOS / Tauri 强制三段 semver |
  | `versionCode` / `CURRENT_PROJECT_VERSION` | 构建号，只增不减，不参与字面比对 |
- **更新流程**：① 只改 `src/version.ts` 的 `APP_VERSION` → ② 按上表同步各载体 → ③ `npm run version:check -- --remote` 校验 9 个载体 + 本地/远端 tag 全绿 → ④ 提交并打 `V<四段式>` tag → ⑤ push tag（`ci-cd.yml` 与 `build-release.yml` 均响应大写 `V*`；npm 包版本由 `scripts/prepare-package.mjs` 从 `APP_VERSION` 派生三段，不取 tag 字面值）
- **发版一致性保障**：`prepare-package.mjs` 读取唯一源派生版本，并在 tag 与 `APP_VERSION` 不符时直接失败，杜绝「打了 A 号却发布 B 版」；`ci-cd.yml` 的 tag 过滤同时匹配 `v*` 与 `V*`（GitHub Actions 区分大小写，只写小写会让大写 tag 既不构建也不发版）
- OTA 清单：`https://github.com/afdk1991/mim/releases/latest/download/manifest.json`
  ```json
  {
    "version": "0.0.0.0",
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

## 安装与交付（二次分发）

拿到源码后从零部署成**你自己的站点**，见 [INSTALL.md](INSTALL.md)：三条路径
（纯静态 Demo / 自建 Supabase / 六端全量）+ 8 项「去绑定」清单。

> ⚠️ 源码内置了示例后端地址作为兜底，部署前必须按 INSTALL.md §0 处理，
> 否则站点会连进示例项目的数据库。作者本人维护线上站的操作见 [DEPLOY.md](DEPLOY.md)。

## 仓库结构

- `src/` 前端源码（hash 路由，42 条可达路由：导航 39 条 + 管理后台 3 条）
- `src-tauri/` 桌面壳（Tauri 2）
- `android/`、`ios/` 移动壳（Capacitor 8）
- `harmony/` 鸿蒙壳（ArkTS，仅源码入库）
- `supabase/` 数据库：`schema.sql`（20 张业务表基线）+ `migrations/*.sql`
- `.github/workflows/`：`ci-cd.yml`（Pages/EdgeOne/云函数/npm 包 + 数据库迁移 + 线上冒烟）、`build-release.yml`（六平台发布）

## 数据库迁移

三条通道**共用同一份迁移计划**（`scripts/lib/migration-plan.mjs`），顺序与内容完全一致：
`0000_schema.sql`（基线）→ `0001` IAM 权限 → `0002` 对象存储 → `0003` 账号桥 →
`0004` 帖子富字段 → `0005` 商城目录（仅字段扩展，无演示商品）。

| 方式 | 命令 / 操作 | 适用 |
| --- | --- | --- |
| CI 自动（推荐） | push main 即由 `migrate-db` job 应用 | 已配 `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` |
| 一键补齐脚本 | 把 `supabase/apply-all-manual.sql` 全文粘贴到 Supabase Dashboard → SQL Editor → Run | 无数据库密码 |
| 本地执行 | `npm run db:apply` | 设了 `SUPABASE_DB_URL` |

补齐脚本由 `npm run db:gen-manual` 生成，改完 SQL 重新生成即可，保证与 CI 不产生分叉。
全部迁移幂等，`schema_migrations` 表记录已应用版本，重复执行不会产生重复数据。

## 许可

个人项目，代码仅供学习交流。
