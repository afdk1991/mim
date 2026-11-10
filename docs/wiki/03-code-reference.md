# 03 · 关键代码说明

> 本页覆盖仓库级脚本 `scripts/version-check.mjs`（铁律四版本规约，§1–§6）与 `scripts/env-check.mjs`（09 清单 §0 密钥治理，§7）。两者均为 ESM、仅用 Node 内置模块、退出码契约一致（`0` 通过 / `1` 违规）。
> 业务代码（`services/mim-api` / `apps/web` / `packages/*`）的分层结构与实现对照见 [08-dev-implementation.md](./08-dev-implementation.md)，运行命令见 [05-runbook.md](./05-runbook.md)。

## 1. 文件元信息

| 项 | 值 |
|---|---|
| 路径 | [scripts/version-check.mjs](../../scripts/version-check.mjs) |
| 模块系统 | ES Module（`.mjs`） |
| Shebang | `#!/usr/bin/env node` |
| 运行时 | Node.js（无版本声明，用到 `node:child_process` / `node:fs` / `node:path` / `node:url`，Node ≥ 14 即可） |
| 退出码 | `0` = 通过；`1` = 存在违规 |
| 环境变量 | `RELEASE_CHANNEL`（可选，仅允许 `preview` / `draft` / `test`） |

## 2. 顶层常量

| 常量 | 定义 | 用途 |
|---|---|---|
| `__dirname` | `dirname(fileURLToPath(import.meta.url))` | ESM 下还原 `__dirname` |
| `ROOT` | `join(__dirname, '..')` | 仓库根目录（脚本位于 `scripts/` 下一级） |
| `SEMVER_RE` | `/^(\d+)\.(\d+)\.(\d+)$/` | 三段纯数字 semver（不支持预发行后缀） |
| `OFFICIAL_TAG_RE` | `/^V\d+\.\d+\.\d+$/` | 正式 tag 形态，**大写 V 开头** |
| `INTERNAL_TAG_RE` | `/^(draft\|pre)-/` | 内部 tag 合法前缀 |
| `VALID_CHANNELS` | `Set(['preview','draft','test'])` | 合法发布通道 |
| `exitCode` | 模块级 `let`，初始 0 | 任一检查失败置 1，最后 `process.exit(exitCode)` |
| `channel` | `(process.env.RELEASE_CHANNEL \|\| '').trim()` | 当前通道，空串 = 正式通道 |

## 3. 函数说明

### `readVersion() → { source, version } | null`

版本号来源探测，**短路优先级**：

1. `ROOT/package.json` 存在 → 尝试 `JSON.parse` → 有 `version` 字段则返回 `{ source: 'package.json', version }`；解析异常被静默吞掉（`catch {}`）继续向下
2. `ROOT/VERSION` 存在 → 返回 `{ source: 'VERSION', version: 文件内容 trim }`
3. 都没有 → 返回 `null`

调用处行为：`null` → 打印 ⚠️ 跳过建议（**不算违规**，exitCode 不变）；非 `X.Y.Z` → ❌ 置 `exitCode = 1`；合法 → ✅ 并打印展示版本号 `V{version}` 或 `V{version}-{channel}`。

### `isGitRepo() → boolean`

`execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'ignore' })`，异常即 `false`。非 git 仓库时整个 tag 校验段跳过（⚠️ 提示，不算违规）。

### `getGitTags() → string[] | null`

`execSync('git tag', { encoding: 'utf-8' })` → 按行 split → trim → 去空。异常返回 `null`（调用处以 `|| []` 兜底）。

## 4. 主流程（四个检查段）

```
① 版本号来源      readVersion()
                    ├─ null        → ⚠️ 跳过
                    ├─ 非 semver   → ❌ exitCode=1
                    └─ 合法        → ✅ + 打印展示版本号
② RELEASE_CHANNEL  非空且不在 VALID_CHANNELS → ❌ exitCode=1
③ git tag 校验     isGitRepo()=false → ⚠️ 跳过
                    ├─ 打印全部 tags 清单
                    ├─ 通道感知：channel ∈ {preview,draft,test} 且存在 OFFICIAL_TAG_RE 命中
                    │     → ❌ exitCode=1（预览通道不得有正式 tag）
                    ├─ 正式通道 + 有正式 tag → ℹ️ 仅提示
                    └─ 非规范 tag（既非 V<semver> 也非 draft-/pre-）→ ⚠️ 警告（不置 exitCode）
④ 结论            exitCode===0 → ✅ 通过；否则 ❌ 未通过；process.exit(exitCode)
```

## 5. 设计要点与边界

- **失败容错分级**：⚠️（缺版本源/非 git 仓库/非规范 tag）不影响退出码；❌（版本格式错/通道非法/预览通道有正式 tag）才失败
- **正式 tag 判定严格大写**：`v0.0.0`（小写）不会命中 `OFFICIAL_TAG_RE`，会落入「非规范内部 tag」警告而非正式 tag——这是刻意设计，正式 tag 约定为大写 `V`
- **SEMVER_RE 不接受预发行后缀**：`package.json` 里写 `0.0.0-preview` 会判 ❌；预发行信息只允许通过 `RELEASE_CHANNEL` 环境变量在**展示层**拼接，不落盘到版本号数字
- **幂等与无副作用**：脚本只读文件与 git tag，不写任何文件，可任意重复执行
- **CI 集成预期**：退出码语义即 CI 门禁语义（非零即红）；当前仓库尚无 workflow 文件，接入时在质量门禁 job 中加一步 `node scripts/version-check.mjs` 即可

## 6. 输出样例（当前仓库实际运行结果）

当前仓库 `package.json` 版本为 `0.0.0`、git 仓库存在但无 tag，运行 `node scripts/version-check.mjs` 输出为：

```
=== Mim 版本号校验 (铁律四) ===
RELEASE_CHANNEL = (unset / 正式通道)

✅ [package.json] 版本号 0.0.0 格式正确
   展示版本号: V0.0.0

现有 git tags (0): (none)

✅ 版本号校验通过
```

退出码 `0`——版本号来源（`package.json`）合法且无正式 tag，tag 校验段以「无 tag」空集通过。

> 历史上（引入 `package.json` 之前）该脚本会输出「⚠️ 未找到版本号来源 / ⚠️ 当前目录不是 git 仓库」并以「全跳过」方式通过；当前仓库已不适用该情形。

## 7. scripts/env-check.mjs 速览

> 规则来源为 [09-third-party-sdk-inventory.md](./09-third-party-sdk-inventory.md) §0 的三条硬约束：密钥不入库 / 按 region 隔离 / 先登记后接入。

### 7.1 文件元信息

| 项 | 值 |
|---|---|
| 路径 | [scripts/env-check.mjs](../../scripts/env-check.mjs) |
| 模块系统 | ES Module（`.mjs`） |
| Shebang | `#!/usr/bin/env node` |
| 运行时 | Node.js ≥ 14.18（仅 `node:fs` / `node:path` / `node:url`，**不调用 git**） |
| 退出码 | `0` = 通过；`1` = 存在违规 |
| 环境变量 | 无（不读取 `RELEASE_CHANNEL`） |
| 输入文件 | `.env.example` / `docs/wiki/09-third-party-sdk-inventory.md` / `.gitignore`；另以 `existsSync` 探测 `.env` 是否存在（不读内容） |

### 7.2 关键常量（维护时不可改动）

| 常量 | 定义 | 必要性 |
|---|---|---|
| `NAME_PREFIX` | `'MIM_'` | 命名前缀门禁 |
| `ASSIGN_LINE_RE` | `/^([A-Z][A-Z0-9_]*)[ \t]*=/` | **必须用 `[ \t]*` 而非 `\s*`**：JS 的 `\s` 含换行符，会把下一行变量名误判为本行非空值，造成大量假 ❌ |
| `INVENTORY_VAR_RE` | ``/`(MIM_[A-Z0-9_]+)`/g`` | 闭合反引号紧跟变量名，天然排除通配符写法 |
| `INVENTORY_WILDCARD_RE` | ``/`(MIM_[A-Z0-9_]+)\*`/g`` | 捕获通配项 stem（如 `MIM_STORAGE_S3_*`），用于前缀匹配模板中的展开项 |

### 7.3 八段检查

```
① 模板存在性      .env.example 不存在 → ❌ 直接终止
② 变量去重        total / unique 对比，重复 → ❌
③ 空值占位        任一变量有非空值 → ❌（只打印变量名，不回显值）
④ 清单 → 模板     清单变量未落位 → ❌；由通配符 stem 覆盖 → ⚠️（不算违规）
⑤ 模板 → 清单     模板变量不在清单 → ❌（先接入后登记）
⑥ MIM_ 前缀       不符合命名规范 → ❌
⑦ .gitignore      .env 未被忽略 → ❌；缺 !.env.example → ⚠️
⑧ 本地 .env       存在则 ℹ️ 提示（仅探测存在性，不读内容）
结论              exitCode===0 → ✅ 通过；否则 ❌ 未通过；process.exit(exitCode)
```

### 7.4 输出样例（当前仓库实际运行）

```
=== Mim 密钥模板校验 (09 清单 §0) ===
模板: .env.example
清单: docs/wiki/09-third-party-sdk-inventory.md

模板变量: total=138 unique=138
✅ 变量名无重复
✅ 模板全部为空值占位（无真实密钥）
清单对齐: inventory=138 missing=0 extra=0 wildcardCovered=0
✅ 清单登记变量已全部落位到模板
✅ 模板无清单外变量（先登记后接入合规）
✅ 全部变量均使用 MIM_ 前缀
✅ .gitignore 已忽略 .env
ℹ️  本地未创建 .env（无泄露风险）

✅ 密钥模板校验通过
```

退出码 `0`。模板变量数与清单具体变量数均为 138，双向完全对齐、无通配符覆盖项。
