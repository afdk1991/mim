# 05 · 项目运行方式

> 仓库当前无可「启动」的应用，唯一可运行项是版本规约校验脚本。本页同时覆盖其用法与未来应用代码落地后的衔接点。

## 1. 前置条件

| 依赖 | 必要性 | 检查命令 |
|---|---|---|
| Node.js（≥ 14.18） | **必需** | `node --version` |
| git CLI | 可选（仅 tag 校验段需要） | `git --version` |

无需 `npm install`——零第三方依赖。

## 2. 运行版本校验

### 基本用法（README.md §校验命令）

```bash
node scripts/version-check.mjs
RELEASE_CHANNEL=preview node scripts/version-check.mjs
```

Windows PowerShell 5.1 环境变量写法：

```powershell
$env:RELEASE_CHANNEL = 'preview'; node scripts/version-check.mjs
# 用毕清除，避免污染后续命令
Remove-Item Env:RELEASE_CHANNEL
```

### 退出码契约

| 退出码 | 含义 | CI 语义 |
|---|---|---|
| `0` | 校验通过（含「全跳过」情形） | 门禁绿 |
| `1` | 存在违规（版本格式错 / 通道非法 / 预览通道有正式 tag） | 门禁红 |

### 三种典型场景

| 场景 | 预期输出要点 | 退出码 |
|---|---|---|
| 当前仓库现状（无版本源、非 git 仓库） | 两条 ⚠️ 跳过提示 + ✅ 通过 | 0 |
| `package.json` 写 `"version": "0.0.0-preview"` | ❌ 版本号不符合 semver（预发行后缀只允许走 RELEASE_CHANNEL，不进版本数字） | 1 |
| `RELEASE_CHANNEL=preview` 且仓库已有 `V0.0.0` tag | ❌ 预览通道下已存在正式 tag | 1 |

完整判定逻辑与输出样例见 [03-code-reference.md](./03-code-reference.md)。

### 运行密钥模板校验（09 清单 §0）

把 `.env.example` 与 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) §0 的密钥治理硬约束做自动比对：

```bash
node scripts/env-check.mjs
```

| 检查项 | 判定 |
|---|---|
| 模板 ↔ 清单双向对齐 | 清单登记的变量未落位到模板 → ❌；模板出现清单外变量 → ❌；由清单通配符覆盖的项 → ⚠️ |
| 空值占位 | 任一变量存在非空值 → ❌（只打印变量名，不回显值） |
| `MIM_` 前缀 | 变量名不符合 `MIM_<领域>_<提供方>_<密钥类型>` → ❌ |
| 变量重复 | 同名变量出现多次 → ❌ |
| `.gitignore` 覆盖 | `.env` 未被忽略 → ❌；缺少 `!.env.example` 反向豁免 → ⚠️ |
| 本地 `.env` | 存在则提示（仅探测存在性，绝不读取内容） |

退出码契约与版本校验一致：`0` = 通过；`1` = 存在违规。检查清单与实现细节见 [03-code-reference.md](./03-code-reference.md) §7。

## 3. 版本号操作规约（铁律四）

| 动作 | 规则 |
|---|---|
| 对外正式发布 | 首版 `V0.0.0`，此后 `V0.0.1`… 递增；发布前不得占用 |
| 内部/预览/草稿构建 | 设 `RELEASE_CHANNEL=preview/draft/test`，展示为 `V0.0.0-preview`，**不改 semver 数字** |
| 内部 git tag | 仅允许 `draft-*` / `pre-*` 前缀；`V<semver>`（大写 V）保留给正式发布 |
| 版本号落盘位置 | `package.json` 的 `version` 字段（优先）或根目录 `VERSION` 文件 |

## 4. 环境变量与密钥模板

| 项 | 说明 |
|---|---|
| 占位模板 | 根目录 `.env.example`（140 个 `MIM_*` 空值变量，按领域分组，含北斗专项） |
| 本地使用 | 复制为 `.env` 后按需填写；根目录 `.gitignore` 已忽略 `.env`，禁止提交 |
| 生产使用 | CI Secret / 云 KMS / Secret Manager，不落盘、不入库 |
| 清单来源 | [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md)（变量名与提供方一一对应） |
| 核对方式 | `node scripts/env-check.mjs` 自动校验（见 §2「运行密钥模板校验」），失败即退出码 1 |

## 5. 查看产品规划文档

| 文档 | 打开方式 |
|---|---|
| `Mim-PRD.html` | 浏览器直接打开（自包含、零依赖，含 FR-01 登录 / FR-02 支付两个交互演示） |
| `team-hiring-plan.md`、两份调研 txt | 任意 Markdown/文本编辑器 |

## 6. 未来应用代码的衔接点（规划口径）

PRD 与调研文档规划的目标形态为 **pnpm + Turborepo Monorepo**，业务代码落地后预期结构：

```
apps/        # 各端薄壳：web / weapp / ios / android / pc
packages/    # 共享层：能力网关、领域模型、i18n、Design Token
```

届时本仓库将扩展为 Monorepo（`apps/` + `packages/`），依赖清单与构建脚本随之落地。当前根目录 `package.json` 已存在，承担版本号来源与站点构建脚本（`build` / `check`），业务代码尚未创建。

## 7. 站点与构建（本地预览，非生产部署）

> **定位**：本仓库为 PRD + 架构文档仓库，`site/` 是 PRD 的可视化阅读载体，**不作为线上产品部署、不绑定生产域名**。

### 7.1 本地构建（可选）

```bash
npm run build    # scripts/build.mjs 把 site/ 复制到 dist/
npm run check    # version-check + env-check（退出码 0 = 通过）
```

构建产物 `dist/index.html` + `dist/prd.html` 可本地双击打开，或用任意静态服务器预览。

### 7.2 不涉及的动作

- 不 push 到 GitHub 触发 EdgeOne 自动构建（仓库内容为文档，无功能代码可部署）。
- 不绑定 `data.mixm.top` 等生产域名。
- 线上域名归属与实际功能代码的部署由独立的应用仓库负责，不在本仓库范围内。
