# Mim 安装与部署指南（二次分发 / 交付版）

> 面向**拿到本仓库源码的部署方**。
> 作者自己维护线上站的操作在 [DEPLOY.md](DEPLOY.md)；本文只讲「从零把这套代码变成你自己的站点」。
>
> ⚠️ 源码中保留了作者个人示例后端的地址作为兜底（原因见 [§0](#0-先做这一件事去绑定)）。
> **部署前必须先完成 §0**，否则你的站点会连进示例项目的数据库。

---

## 0. 先做这一件事：去绑定

源码里有 3 个后端地址是**作者个人项目**的公开地址（`src/lib/supabase.ts` 的
`PROD_SUPABASE_URL` / `PROD_SUPABASE_ANON_KEY` / `PROD_API_BASE`）。
它们被保留是因为 EdgeOne Makers 是远端构建、读不到仓库环境变量 —— 删掉会让作者
自己的线上站缺配置而无法启动。因此做法是**加开关**而不是删除：

```ini
# .env —— 二选一，不要都空着
# 方案 A（推荐，完整可用）：填你自己的 Supabase 项目
VITE_SUPABASE_URL=https://<你的项目ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<你的 publishable key>

# 方案 B（强制自有后端）：关掉内置示例后端，同时必须填入自有云端
# （至少配上面两个 Supabase 变量，或改用 VITE_MIM_API_BASE 走 CloudBase 云函数）
VITE_MIM_BUILTIN_BACKEND=0
```

自检方式：开发模式下若仍在用示例后端，控制台会打印
`[mim] 当前使用内置示例后端…`；也可直接看导出值 `usingBuiltinBackend` 是否为 `false`。

产物级验证（确认示例地址没被打进你的包）：

```bash
npm run build
grep -o 'sepfobukokrrivwyvhnd' dist/assets/*.js | wc -l   # 应为 0
```

### 去绑定完整清单

| # | 位置 | 说明 | 何时必改 |
|---|---|---|---|
| 1 | `src/lib/supabase.ts` 内置后端 | 见上方 `.env` 二选一 | **总是** |
| 2 | `src/ota.ts:22` `MANIFEST_URL` | OTA 清单指向作者 Releases → 桌面/安卓会**自动下载作者的更新包** | 打包桌面端/安卓前 |
| 3 | `src/ota.ts:24` `STORE_URL` | App Store 跳转地址（`https://apps.apple.com/app/mim` 为占位） | 上架 iOS 前 |
| 4 | `src/site-config.ts` | 主办单位 / ICP / 公安备案 / 域名 / 联系邮箱 / 收款码 —— 已刻意收成**单一数据源**，改一处全站信息页生效 | 国内上线前（合规） |
| 5 | `src-tauri/tauri.conf.json` | `identifier: com.afdk1991.mim`（包名）+ `updater.endpoints`（=作者 latest.json）+ CSP 白名单 | 打包桌面端前 |
| 6 | `android/app/build.gradle` | `namespace` / `applicationId` = `com.afdk1991.mim`；release 签名用 CI 环境变量中的固定 keystore | 打包安卓前 |
| 7 | `.github/workflows/*.yml` | 内联注入作者的两组公开配置与 Secrets；CI badge / 在线地址写在 `README.md` | fork 后自建 CI 时 |
| 8 | `src/version.ts` `APP_VERSION` | 四段式版本号，每次递增 `0.0.0.1` | 每次发版 |

> 第 5 项 CSP 已放宽为 `https://*.supabase.co`，自建 Supabase 不会被桌面端 CSP 拦截；
> 若改用其他后端域名，需自行在 `connect-src` 中补上。

---

## 1. 环境要求

| 项 | 版本 | 备注 |
|---|---|---|
| Node.js | **20+（推荐 22，CI 用 22）** | |
| npm | 10.9.9+ | CI 会先 `npm i -g npm@10.9.9` 规避 vite 8 optional peers 的 arborist 崩溃 |

依赖安装若报 peer 冲突，加 `--legacy-peer-deps`（CI 就是这么装的）。

---

## 2. 三条部署路径

### 路径 A：纯静态托管（最少配置：只需一组云端）

```bash
npm install --legacy-peer-deps
cp .env.example .env          # 至少填 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
                              # （或改用 VITE_MIM_API_BASE 走 CloudBase 云函数）
npm run build                 # 产出 dist/
```

把 `dist/` 丢到任意静态托管即可（Nginx / OSS / COS / GitHub Pages / EdgeOne / Vercel…）。

- 构建配置是 `base: './'` + hash 路由（`#/feed`），**任意子路径都能直接跑**，不需要 404 兜底或 rewrite；
- 本地演示模式已移除：**一组云端配置都没有时应用会直接渲染配置错误页**，构建前务必确认 `.env` 非空。

### 路径 B：自建 Supabase（完整可用，含账号/数据库/存储/实时）

1. 在 [supabase.com](https://supabase.com) 建项目（免费档：500MB 库 / 1GB 存储 / 5 万 MAU）；
2. 建库 —— **三选一**：

   | 方式 | 操作 | 适用 |
   |---|---|---|
   | 一键补齐（推荐） | 把 `supabase/apply-all-manual.sql` 全文粘贴到 Dashboard → SQL Editor → Run | 无数据库密码 |
   | 本地执行 | `SUPABASE_DB_URL=postgresql://… npm run db:apply` | 有连接串 |
   | CI 自动 | push main 由 `migrate-db` job 应用 | 已配 `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` |

   `apply-all-manual.sql` 由 `npm run db:gen-manual` 生成，改完 SQL 重新生成即可，保证与 CI 不产生分叉。
   迁移顺序：`0000_schema`（20 张业务表基线）→ `0001` IAM → `0002` 对象存储 → `0003` 账号桥
   → `0004` 帖子富字段 → `0005` 商城目录（仅字段扩展，无演示商品）。全部幂等。

3. 配 `.env`（§0 方案 A），`npm run build`，部署 `dist/`；
4. 可选：开启 GitHub OAuth（Dashboard → Authentication → Providers），回跳白名单加上你的域名。

安全模型：浏览器直连 Supabase，publishable key 按设计可暴露，数据安全由 **RLS 行级安全**
承担（全表已启用策略）。**不要**把 `service_role` key 写进前端。

### 路径 C：六端全量（桌面 / 安卓 / iOS / 鸿蒙）

先完成路径 B，再按平台打包：

| 平台 | 前置工具链 | 命令 |
|---|---|---|
| Windows / macOS / Linux | Rust 工具链 | `npx tauri build` |
| Android | JDK 21 + Android SDK | `npx cap sync android && cd android && ./gradlew assembleRelease` |
| iOS | macOS + Xcode | `npx cap sync ios && cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator build` |
| HarmonyOS | DevEco Studio | 打开 `harmony/`；`node scripts/sync-harmony.mjs` 同步 dist → rawfile |

打包前**务必**改掉 §0 清单第 2、3、5、6 项：
- 桌面端 OTA：`tauri.conf.json` 的 `updater.endpoints` 指向你的 `latest.json`；
- 安卓 OTA：`src/ota.ts` 的 `MANIFEST_URL` 指向你的 `manifest.json`；
  且 **release 必须用同一份 keystore 签名**，否则 OTA 下载后无法覆盖安装；
- iOS 红线：禁止应用内静默自装，一律弹窗跳 App Store。

---

## 3. 验证（交付前建议全跑）

需先起本地预览服务：`npx vite preview --port 5198`

| 命令 | 覆盖 |
|---|---|
| `npm run typecheck` | TypeScript 0 错误 |
| `npm run verify:routes` | 46 条路由：白屏 / JS 异常 |
| `npm run verify:mobile` | 全路由移动端横向溢出（默认 390×844；可传参：`npm run verify:mobile -- 320 720`） |
| `npm run verify:desktop` | 桌面端布局回归（侧栏 / 网格 / 表格） |
| `npm run verify:feed` | 信息流 + 成长页（12 项断言） |
| `npm run verify:manju` | 漫剧 / Openverse（21 项断言，离线 route mock 可跑） |

浏览器实测依赖系统 Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）
+ `playwright-core`，无需下载浏览器。

---

## 4. 合规与交接提示

- **ICP / 公安备案**：`src/site-config.ts` 中所有备案字段默认为空，页面显示
  「本项内容由站点运营方配置后展示」。国内上线必须由运营方按真实证照填写，
  **不要沿用示例值**（示例里 `filingNote` 写的「由 afdk1991 维护」属于作者本人声明）。
- **收款/商城**：`payQrCodeUrl` / `payQrNote` / `payConfirmKey` 为空时，扫码支付通道
  与管理员核销入口自动关闭。
- **版本与 OTA**：版本号统一四段式，初始 `0.0.0.0`，每次递增 `0.0.0.1`
  （`src/version.ts` 与 Android `versionName` 同步，`versionCode` 单调递增）。
- **许可**：`package.json` 标为 `UNLICENSED`，README 声明「个人项目，代码仅供学习交流」。
  若作为商业交付，需由双方另行约定授权范围。
