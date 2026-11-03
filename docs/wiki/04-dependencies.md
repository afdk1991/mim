# 04 · 依赖关系

## 1. 当前实际依赖（证据：仓库无 package.json）

**第三方依赖：零。** 仓库当前没有任何包管理清单文件（无 `package.json` / `pnpm-workspace.yaml` / lock 文件），两个校验脚本（`version-check.mjs` / `env-check.mjs`）只使用 Node.js 内置模块：

| 内置模块 | 引入处 | 用途 |
|---|---|---|
| `node:child_process` | `version-check.mjs` 的 `execSync` | 调用 `git rev-parse` / `git tag`（`env-check.mjs` 不使用） |
| `node:fs` | 两个脚本共用 | `version-check.mjs` 探测并读取 `package.json` / `VERSION`；`env-check.mjs` 读取 `.env.example` / 09 清单 / `.gitignore` 并探测 `.env` 存在性 |
| `node:path` | 两个脚本共用 | `join` / `dirname` 拼接定位仓库根与文件路径 |
| `node:url` | 两个脚本共用 | `fileURLToPath` 在 ESM 下还原 `__dirname` |

外部进程依赖：**`git` CLI**（可选，仅 `version-check.mjs` 需要）。其 tag 校验段需要调用 git；未安装 git 或非 git 仓库时该段自动跳过（⚠️ 不判失败），脚本其余部分不受影响。`env-check.mjs` 为纯文件校验，**不调用任何外部进程**，在无 git 环境同样可运行。

## 2. 运行时要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 14（实际建议 ≥ 18） | 仅用到稳定内置 API；`node:` 前缀导入需 Node ≥ 14.18。两个脚本一致 |
| 包管理器 | 暂不需要 | 无依赖可装；引入依赖后按铁律五更新本文件 |
| 操作系统 | 跨平台 | 脚本为纯 Node，Windows/macOS/Linux 均可 |

## 3. 依赖治理规约（铁律五）

仓库对**未来引入依赖**有强制规则（AGENTS.md 铁律五）：

1. 通用能力（HTTP、日期、加密、日志、测试、UI 组件、解析等）**必须优先引入成熟第三方库**，禁止重复造轮子
2. 所有依赖**显式声明在依赖清单**（`package.json` 等）并同步提交锁文件
3. **禁止 vendor**：不得把第三方源码复制进仓库
4. 交付报告须登记：依赖名称、版本号、用途
5. 例外：确需自研（性能/许可证/环境限制）须说明理由并经用户确认；与铁律一（执行优先）冲突时可临时偏离，但必须在报告中标注「已偏离铁律五」

## 4. 规划中的依赖方向（来自 PRD 与调研文档，尚未落地）

> 以下为规划口径，**当前均未引入**，仅作路线图参考。

| 领域 | 规划方案 | 来源 |
|---|---|---|
| Monorepo | pnpm + Turborepo | 小程序调研 txt 第三部分 |
| 端侧架构 | `IPlatformAdapter` 契约 + 契约测试套件，业务层禁止平台判断 | 小程序调研 txt 第四部分 |
| 支付 | 国内：微信支付/支付宝/银联；海外：Stripe/PayPal；App 数字商品：Apple IAP / Google Play Billing（商店强制） | PRD FR-02 |
| IM / 音视频 / AI | P0 全部采购第三方驱动，不自研 SFU 与 AI 推理 | PRD §3 排除项 |
| 推送 | APNs / FCM / 国内厂商通道，平台适配层封装 | PRD FR-04 |
| 管理后台 | 直接用 Ant Design Pro / Arco Pro 模板，不定制设计 | team-hiring-plan.md 省钱杠杆 |
| 测试自动化 | Appium + Playwright | team-hiring-plan.md |
| 内容审核 | 第三方服务（数美、网易易盾等） | team-hiring-plan.md 坑 #1 |

### 4.1 规划引入清单的展开位置（与运行实况区分）

> **重要区分**：本文件 §1 记录的是「运行时实际依赖 = 零」的事实；而上表只是方向。**每个具体 SDK / 开放 API / 密钥的提供方、接入形态、用途、env 变量名、优先级与合规要求**，统一登记在 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)，密钥占位模板为仓库根目录 `.env.example`。

- 新增任何第三方能力：先更新 09 清单，再在对应模块编码时按铁律五写入 `package.json` + 锁文件，并回填本文件 §1。
- 北斗卫星导航系统（L1 系统定位 / L2 高精度 / L3 短报文）的接入边界与 PRD IoT 排除口径的处理，见 09 清单 §11。
- 因此「本文件 §1 仍为零依赖」与「09 已有全量规划清单」并不矛盾：前者是实况，后者是待接入基线。

## 5. 模块内部依赖图

```
scripts/version-check.mjs
  ├── node:child_process ──> git CLI（可选，缺失时降级跳过）
  ├── node:fs ──> package.json（可选）/ VERSION（可选）
  ├── node:path / node:url
  └── AGENTS.md 铁律四（规则来源，文档级依赖）

scripts/env-check.mjs
  ├── node:fs ──> .env.example / docs/wiki/09-third-party-sdk-inventory.md / .gitignore
  │               （另以 existsSync 探测本地 .env，只判存在性不读内容）
  ├── node:path / node:url
  ├── AGENTS.md 铁律七 + 09 清单 §0（规则来源，文档级依赖）
  └── 不调用外部进程（无 git 依赖）

README.md ──文档引用──> AGENTS.md, scripts/version-check.mjs, scripts/env-check.mjs
Mim-PRD.html ──论据引用──> 两份调研 txt（单向参考，无代码耦合）
```
