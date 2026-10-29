# Mim 多端发布与构建 · 可复用资源推荐清单

> 检索日期：2026-10-29（UTC+8）。项目：Mim（React 18 SPA + 自研 IPlatfformAdapter 适配层，四端契约：web/capacitor/miniprogram/mock）。
> 现有原生壳：android/、ios/（Capacitor 8.5.3）、harmony/（鸿蒙）、src-tauri/（Tauri 2 桌面端）。构建基线：GitHub Actions + 自有宿主机，无 Docker，Vite 8。
> 事实分级标注：【官方已核实】= 官方文档 / GitHub Release / npm / 定价页原文；【第三方称】= 仅社区或二手资料，未获官方确认。

---

## 一、Tauri 2 官方插件生态（对照 Mim 桌面端需求）

| 资源名 | 官网/仓库 URL | 许可 / 版本现状 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| tauri-plugin-updater | https://crates.io/crates/tauri-plugin-updater | Apache-2.0 OR MIT；最新 v2.14.0（2026-10-15 发布），维护极活跃【官方已核实】 | **高**：桌面端自托管分发的核心——GitHub Release 发布后由 tauri-action 自动生成 latest.json，客户端签名校验增量更新；与 Mim 无 Docker、宿主机构建基线兼容 | 低：cargo 依赖 + tauri.conf.json 配 updater endpoints + 1 对 minisign 密钥 | **立即用** |
| tauri-plugin-store | https://crates.io/crates/tauri-plugin-store | Apache-2.0 OR MIT；v2.5.0（2026-09-26 生态发布批次）【官方已核实】 | 中高：桌面端本地 KV 持久化（token、用户偏好），补齐 web 端 localStorage 在 Tauri WebView 中的行为差异 | 低 | **立即用** |
| tauri-plugin-notification | https://tauri.app/release/（ecosystem 发布索引） | Apache-2.0 OR MIT；v2.5.x 批次（2026-09-26）【官方已核实】 | 高：桌面端系统通知，与移动端 push-notifications 在适配层中统一抽象 | 低 | **立即用** |
| tauri-plugin-fs | https://tauri.app/release/ | Apache-2.0 OR MIT；v2.5.x 批次【官方已核实】 | 中：仅当桌面端需要文件导出/导入时引入；Mim 数据走 /api/rest，默认不需要全量 FS | 低-中（需配 scope 白名单） | **值得评估** |
| tauri-plugin-dialog | https://tauri.app/release/ | Apache-2.0 OR MIT；v2.5.x 批次【官方已核实】 | 中：文件保存/打开对话框，通常与 fs 配套出现 | 低 | **值得评估** |
| tauri-plugin-clipboard-manager | https://tauri.app/release/ | Apache-2.0 OR MIT；v2.5.x 批次【官方已核实】 | 高：复制链接/账号类功能刚需，适配层 clipboard 契约的桌面端后端 | 低 | **立即用** |
| tauri-plugin-shell / opener | https://tauri.app/release/ | Apache-2.0 OR MIT；v2.5.x 批次【官方已核实】 | 高：外部链接用系统浏览器打开（避免 WebView 内死链），platform 适配层 openUrl 契约的标准后端 | 低 | **立即用** |
| tauri-plugin-upload | https://tauri.app/release/ | Apache-2.0 OR MIT；v2.5.x 批次【官方已核实】 | 中：大文件分片上传原生进度支持；若 Mim 已有 web 端 fetch 上传可暂缓 | 中 | **仅参考** |
| tauri-plugin-http | https://crates.io/crates/tauri-plugin-http | Apache-2.0 OR MIT【官方已核实】 | **低**：主要价值是绕过 Web CORS；Mim 前端与自有后端同源部署，无此需求 | — | **不建议引入**（见文末清单） |
| tauri-plugin-sql | https://crates.io/crates/tauri-plugin-sql | Apache-2.0 OR MIT；v2.5.0（2026-09-26），**MSRV 已提至 Rust 1.90**【官方已核实】 | **低**：Mim 统一走 /api/rest/:table 单后端通道；桌面端直连 SQLite 会制造第二数据通道与双写问题 | — | **不建议引入**（仅离线模式立项后再评估） |

> Tauri 2 版本基线提醒：tauri-cli 已到 2.10.x（2026 年），生态插件 2026-09-26 集中发版（store/sql/window-state 等齐 v2.5.0），updater 单独快速迭代至 v2.14.0。**Rust 工具链需 ≥ 1.90**（sql v2.5.0 发布说明明确 "Update MSRV to 1.90 to match tauri"）。

---

## 二、Tauri 2 跨平台签名与发布实践

| 资源名 | 官网/仓库 URL | 许可 / 额度 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| tauri-action（GitHub 官方 Action） | https://github.com/tauri-apps/tauri-action/releases | MIT；**现行 major = v1.0.0（2026-06-30 发布）**，此前 v0.6.2（2026-03）【官方已核实】。注意：任务背景中 "v3/v4 现行" 的猜测与实际不符 | **极高**：矩阵构建 win/mac/linux → 自动建 Release → 上传 .msi/.dmg/.AppImage → 生成 latest.json 供 updater 消费；v1.0.0 起新增 Android/iOS 构建支持（仅 build，商店上传仍手动），并移除 Gitea 支持 | 低：workflow 一个 job matrix + secrets | **立即用** |
| Windows 代码签名（官方 signtool 流程） | https://tauri.app/distribute/sign/windows/ | 官方免费流程：base64 证书存 GitHub Secret（WINDOWS_CERTIFICATE）→ runner 导入临时证书 → signtool 签名【官方已核实】 | 高：无 Docker 前提下直接跑在 windows-latest，证书物料一次性准备 | 中：需购买 OV/EV 代码签名证书（年付约数百美元） | **立即用（有钱后）/ 未签名先发可暂缓** |
| Azure Artifact Signing（原 Trusted Signing）云签名 | https://learn.microsoft.com/en-gb/azure/artifact-signing/how-to-signing-integrations | 微软云服务，付费订阅；支持 SignTool、GitHub Actions、Azure DevOps、PowerShell 集成【官方已核实】 | 中高：自托管项目若不想本地保管 .pfx，可用云签名替代；注意其证书有主体资质要求（个人/企业认证） | 中：需 Azure 订阅 + 证书申请 | **值得评估** |
| macOS 签名 + 公证（notarytool） | https://tauri.org.cn/distribute/sign/macos/ | 需 Apple Developer 账号（$99/年）；官方流程：APPLE_CERTIFICATE（base64）+ APPLE_SIGNING_IDENTITY 入 Keychain，公证凭据走 App Store Connect API Key（推荐，免 Apple ID 双因子）【官方已核实】 | 高：macOS 未签名/未公证会被 Gatekeeper 拦截；macos-latest runner 原生支持，无需 Docker | 中：Apple 账号费用 + 证书导出物料 | **立即用（若发布 macOS 版）** |
| updater 签名密钥管理 | https://v2.tauri.app/ko/reference/environment-variables/ | 官方 `tauri signer generate` 生成 minisign 密钥对；私钥入 Secret `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，公钥写入 tauri.conf.json；新版 cli 已强制私钥文件 0600 权限【官方已核实】 | 极高：与 updater 插件配套，是桌面端自动更新的信任根 | 低（一次性） | **立即用** |

---

## 三、Capacitor 8 官方插件 × 自研适配层对照

> 基线核实：@capacitor/core 8.5.3 为最新稳定版（npm，2026-10），官方插件全线 MIT、8.x 系列，维护活跃（如 @capacitor/push-notifications v8.1.3，发布于检索前 20 小时）。

| 资源名 | 官网/仓库 URL | 许可 | 与 Mim 自研适配层关系 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| @capacitor/push-notifications（FCM/APNs） | https://www.npmjs.com/package/@capacitor/push-notifications?activeTab=versions | MIT，v8.1.3【官方已核实】 | 适配层 "push" 契约的**原生后端**，自研层只留接口、不重写原生逻辑 | 中：需 FCM 工程 + APNs 证书 | **立即用** |
| @capacitor/filesystem | https://capacitorjs.jp/docs/apis/ | MIT，v8.x【官方已核实】 | 作为适配层 storage/file 契约的 capacitor 端后端；与 tauri-plugin-fs 在桌面/移动两侧对称 | 低 | **立即用** |
| @capacitor/preferences | https://capacitorjs.jp/docs/apis/ | MIT，v8.x【官方已核实】 | 适配层 KV 持久化后端；与 tauri-plugin-store 对称 | 低 | **立即用** |
| @capacitor/network | https://capacitorjs.jp/docs/apis/ | MIT，v8.x【官方已核实】 | 适配层 online/offline 检测后端 | 低 | **立即用** |
| @capacitor/share | https://capacitorjs.jp/docs/apis/ | MIT，v8.x【官方已核实】 | 适配层 share 契约后端 | 低 | **立即用** |
| @capacitor/status-bar / splash-screen | https://capacitorjs.jp/docs/apis/ | MIT，v8.x【官方已核实】 | 启动与状态栏基础体验，壳工程配置项级别 | 低 | **立即用** |
| @capawesome/capacitor-app-update（商店内原生更新提示） | https://www.npmjs.com/package/@capawesome/capacitor-app-update?activeTab=versions | MIT，社区活跃（27 个版本，2026-10-16 仍在更新）【官方已核实 npm】 | 不是 OTA 热更，而是查 Play Store / App Store 有无新版本并引导跳转；与 OTA 互补 | 低 | **值得评估** |

---

## 四、移动端 OTA 更新：Capgo vs 自托管

| 资源名 | 官网/仓库 URL | 许可 / 免费额度（2026-10 核实） | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| @capgo/capacitor-updater（Capgo 云托管） | https://www.npmjs.com/package/@capgo/capacitor-updater?activeTab=dependents | MIT 插件本体 + **云服务已无永久免费层**：仅 14 天无额度试用，之后 $12/月起（Solo：1,000 MAU / 2GB 存储 / 50GB 流量）【官方已核实定价页】 | **低**：热更包与遥测数据出域，违背 Mim 自托管定位 | — | **不建议引入云服务**（插件可参考其协议设计） |
| @capawesome/capacitor-live-update（可自托管 OTA） | https://www.npmjs.com/package/@capawesome/capacitor-live-update?activeTab=dependents | MIT，插件开源，**配套服务端可自托管**；2026-09 仍活跃【官方已核实 npm】 | **高**：OTA 包托管在 Mim 自有后端 /api 下，签名校验链与桌面 updater 思路一致；适合无 Docker 的宿主机静态托管 | 中：需在自有后端加一个 update manifest 接口 | **立即用（若做移动端热更）** |
| Ionic AppFlow | — | 企业服务，2026 年已列入停用路线（第三方称 2026） | 低：闭源 SaaS、无自托管 | — | **不建议引入** |

---

## 五、HarmonyOS 路线（2026 现行核实）

| 资源名 | 官网/仓库 URL | 现状 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| DevEco Studio 26.0.0 + HarmonyOS SDK 26.0.0 | https://developer.huawei.com/consumer/cn/doc/doccenter-release-notes/overview-2600 | **现行最新：DevEco Studio 26.0.0 Release（26.0.0.851，2026-09-23 Patch）**，配套 HarmonyOS 26.0.0 Release SDK；构建工具为 hvigor 体系【官方已核实】 | Mim harmony/ 目录的官方工具链，无替代 | 中：IDE 仅 Windows/macOS，宿主机安装 | **立即用** |
| ArkWeb（Web 组件）SPA 壳 | https://developer.huawei.com/consumer/en/doc/harmonyos-guides/web-component-overview | Chromium 内核 WebView，需声明 ohos.permission.INTERNET【官方已核实】 | **高**：Mim 是 SPA 壳方案，harmony/ 直接复用 React 构建产物，ArkTS 仅作壳；与 Capacitor 移动端壳同构 | 低：壳工程已存在 | **立即用** |
| AGC 发布签名（.cer 发布证书 + .p7b Profile） | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app | 上架 AppGallery 必须：AGC 申请发布证书与 Profile，DevEco CertificateTool 签名【官方已核实】 | 必需项，一次性物料 | 中：需华为开发者账号实名 | **立即用（上架前）** |
| HarmonyOS 应用核准备案 | https://developer.huawei.com/consumer/cn/doc/50130 | 鸿蒙应用需在接入商（如华为云）处做 APP 核准备案，平台选"鸿蒙"【官方已核实】 | 合规必需，与 Android/iOS 备案并列 | 中：主体资质材料 | **上架前必办** |
| Capacitor 鸿蒙社区移植（hionic / openharmony-capacitor / Oniro） | https://jishuzhan.net/article/2108011752235753474 ; https://docs.oniroproject.org/application-development/codeLabs/cross-platform/ionic-capacitor-tutorial/ | **无官方 Capacitor 鸿蒙平台**；社区仅有面向 OpenHarmony 旧分支的实验性移植（HAR 源码拷入工程）【第三方称】 | **低**：不成熟、面向旧 API，与 DevEco 26 / HarmonyOS 26 未经验证 | 高（踩坑） | **不建议引入** |

> **Mim harmony/ 实际可行路线结论**：原生 ArkTS 壳 + ArkWeb 加载 React SPA 产物 → hvigor 构建 → AGC 发布证书签名 → 核准备案 → AppGallery 上架；不依赖任何 Capacitor 鸿蒙移植。元服务（原子化服务）路线对 Mim 这种完整 SPA 收益低，不推荐。

---

## 六、GitHub Actions 跨平台矩阵（无 Docker 前提）

| 资源名 | 官网/仓库 URL | 现状 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| 矩阵 runner：windows-latest / macos-latest / ubuntu-latest | https://docs.github.com/en/actions/reference/runners/github-hosted-runners | 2026-10 现行：macos-latest ≈ macos-26（默认 Xcode 26.6）；**Xcode 27 镜像（macOS 27）2026-10-15 GA**；macos-14 于 2026-11-02 退役【官方已核实 GitHub Changelog】 | 高：桌面端 tauri-action 矩阵 + 移动端原生构建全部跑官方 runner，无需 Docker | 低 | **立即用** |
| macOS runner 上构建 Capacitor iOS（xcodebuild） | https://github.blog/changelog/2026-10-15-xcode-27-runner-image-generally-available/ | macos runner 预装 Xcode/Apple SDK 与 Android SDK，cap sync + xcodebuild 原生可行【官方已核实】 | 高：Mim ios/ 壳直接受益 | 低 | **立即用** |
| Android（Gradle）构建 | runner 镜像预装 Android SDK（同 runner-images 仓库） | windows/ubuntu/macos 均可跑 gradlew assembleRelease；签名走 base64 keystore Secret | 高：与 Mim 现有 native:android 脚本衔接 | 低 | **立即用** |
| 签名证书 Secrets 管理 | https://tauri.app/distribute/sign/windows/ | 统一模式：证书/p12/keystore → base64 → GitHub Secrets → runner 还原导入 | 高：无 Docker 下的标准做法 | 低 | **立即用** |
| arm64 原生 runner（ubuntu-24.04-arm） | https://v2.tauri.org.cn/distribute/pipelines/github/ | 2025-08 起公开可用，Tauri 官方文档已收录 Arm 构建工作流【官方已核实】 | 中：如需 Linux arm64 发行包再开 | 低 | **仅参考** |

---

## 七、不建议引入清单（含原因）

1. **tauri-plugin-sql**：Mim 已统一 /api/rest/:table 单后端数据通道；桌面端内嵌 SQLite 会制造第二数据通道、双写一致性与多端同步问题。除非立项"桌面离线模式"。
2. **tauri-plugin-http**：其核心价值是绕过 WebView CORS 限制；Mim 前端与自有后端同源部署，无此痛点，徒增攻击面。
3. **Capgo 云服务版（付费托管）**：2026-10 已无永久免费层（仅 14 天试用，$12/月起），且热更包/遥测出域，违背自托管定位；需要 OTA 时改用可自托管的 @capawesome/capacitor-live-update。
4. **Ionic AppFlow**：闭源 SaaS、无自托管、2026 年已列入停用路线。
5. **Capacitor 鸿蒙社区移植（hionic / openharmony-capacitor / Oniro 教程）**：面向 OpenHarmony 旧分支、实验性质，与 HarmonyOS 26 / DevEco 26 兼容性未获官方验证；Mim 走原生 ArkTS + ArkWeb 壳更稳。
6. **鸿蒙元服务（原子化服务）发布路线**：为完整 SPA 应用做轻量化元服务拆分收益低，审核与资质成本高。
7. **重复封装官方插件**：自研 IPlatfformAdapter 只保留跨端契约接口，capacitor/tauri 官方插件直接作为后端实现，不要再在适配层里二次包一层同类原生能力（避免契约膨胀与漂移）。

---

## 八、来源 URL（逐条对应，已去重）

1. tauri-plugin-updater v2.14.0（crates.io，2026-10-15）：https://crates.io/crates/tauri-plugin-updater/range/%5E2.0.0-rc.2
2. updater 发布历史 v2.13.3（2026-10-10）：https://v2.tauri.app/release/updater/
3. tauri-action Releases（v1.0.0，2026-06-30）：https://github.com/tauri-apps/tauri-action/releases
4. Tauri 官方 GitHub Actions 指南：https://tauri.app/distribute/pipelines/github/
5. Windows 代码签名官方文档：https://tauri.app/distribute/sign/windows/
6. macOS 签名与公证官方文档：https://tauri.org.cn/distribute/sign/macos/
7. Tauri 环境变量（TAURI_SIGNING_PRIVATE_KEY 等）：https://v2.tauri.app/ko/reference/environment-variables/
8. tauri-signer 私钥文件权限加固（@tauri-apps/cli release）：https://tauri.app/release/@tauri-apps/cli/
9. tauri-plugin-sql（Apache-2.0 OR MIT）：https://crates.io/crates/tauri-plugin-sql
10. sql@2.5.0（MSRV 1.90）：https://tauri.app/release/sql/v2.5.0/
11. Tauri 生态发布索引（store/window-state v2.5.0，2026-09-26）：https://tauri.app/release/
12. @capacitor/push-notifications v8.1.3（npm）：https://www.npmjs.com/package/@capacitor/push-notifications?activeTab=versions
13. @capacitor/core 8.5.3 latest（npm）：https://www.npmjs.com/package/@capacitor/core?activeTab=versions
14. Capacitor 官方插件索引：https://capacitorjs.jp/docs/apis/
15. Capgo 定价页（无免费层，$12/月起）：https://capgo.app/pricing.md
16. @capgo/capacitor-updater（npm，活跃）：https://www.npmjs.com/package/@capgo/capacitor-updater?activeTab=dependents
17. @capawesome/capacitor-live-update（npm，可自托管）：https://www.npmjs.com/package/@capawesome/capacitor-live-update?activeTab=dependents
18. @capawesome/capacitor-app-update（npm）：https://www.npmjs.com/package/@capawesome/capacitor-app-update?activeTab=versions
19. DevEco Studio 26.0.0 版本概览（华为官方）：https://developer.huawei.com/consumer/cn/doc/doccenter-release-notes/overview-2600
20. ArkWeb Web 组件官方文档：https://developer.huawei.com/consumer/en/doc/harmonyos-guides/web-component-overview
21. HarmonyOS 应用签名发布（.cer/.p7b）：https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app
22. HarmonyOS 应用核准备案要求：https://developer.huawei.com/consumer/cn/doc/50130
23. hionic/openharmony-capacitor 实战（第三方称）：https://jishuzhan.net/article/2108011752235753474
24. Oniro Project Ionic/Capacitor 教程（第三方/社区）：https://docs.oniroproject.org/application-development/codeLabs/cross-platform/ionic-capacitor-tutorial/
25. Azure Artifact Signing 集成（SignTool/GitHub Actions）：https://learn.microsoft.com/en-gb/azure/artifact-signing/how-to-signing-integrations
26. GitHub Changelog：Xcode 27 runner GA（2026-10-15）：https://github.blog/changelog/2026-10-15-xcode-27-runner-image-generally-available/
27. GitHub Changelog：macos-14 退役（2026-11-02）：https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/
28. GitHub-hosted runners reference：https://docs.github.com/en/actions/reference/runners/github-hosted-runners
