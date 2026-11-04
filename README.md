# Mim

> Mim 项目仓库。协作铁律见 [AGENTS.md](./AGENTS.md)。

## 版本

当前版本：**V0.0.0-preview**

版本号规约（与 [AGENTS.md 铁律四](./AGENTS.md#铁律四版本号每次添加功能模块更新等等规约与-readme-同步) 同步）：

- 首个对外正式发布版本 = **V0.0.0**，此后按 V0.0.1、V0.0.2… 递增，发布前不得占用。
- 内部 / 预览 / 草稿构建用 `RELEASE_CHANNEL`（`preview` / `draft` / `test`）区分，展示为 `V0.0.0-preview` 等，**不改 semver 数字**。
- 内部 git tag 命名为 `draft-*` / `pre-*`，不得为 `V<semver>` 形态。
- 校验由 `scripts/version-check.mjs` 强制。

### 校验命令

```bash
node scripts/version-check.mjs
RELEASE_CHANNEL=preview node scripts/version-check.mjs
node scripts/env-check.mjs
```

- `version-check.mjs`：铁律四版本规约校验（退出码 0 / 1）
- `env-check.mjs`：09 清单 §0 密钥治理校验——`.env.example` ↔ 09 清单 ↔ `.gitignore` 一致性（退出码 0 / 1）

## 项目铁律

所有 AI 协作者必须遵守 [AGENTS.md](./AGENTS.md) 中的七条铁律：

1. **铁律一**：AI 负责执行，不把任务丢回用户，全权接管浏览器等一切可自动化环境（最高优先级）。
2. **铁律二**：可逆操作直接做，不可逆操作先授权。
3. **铁律三**：基于证据，不空口断言。
4. **铁律四**：版本号规约（与本文件同步）。
5. **铁律五**：必须引入所有第三方依赖，不得重复造轮子。
6. **铁律六**：全角色全流程自动化——AI 承担所有人员职责，每轮交付前必须 BUG/代码检查。
7. **铁律七**：功能模块增删必须全量同步，交付报告附同步清单。

## 仓库结构

pnpm workspace Monorepo（`pnpm-workspace.yaml` 纳入 `apps/*`、`services/*`、`packages/*`）：

```
apps/web/            # Web 端薄壳（React 18 + Vite 5，端口 5173）
services/mim-api/    # 后端 API（Express 5 + SQLite，端口 8787，前缀 /api/v1）
packages/core-domain/# 共享领域层（错误码/套餐/权限/任务层级/金额/UUIDv7）
packages/i18n/       # 双语文案（zh-CN / en-US）与货币格式化
scripts/             # build / version-check / env-check
site/                # PRD 可视化阅读载体（本地预览）
docs/wiki/           # 结构化文档（01~09）
```

## 开发与运行

前置：Node >= 18（实测 v22.23.3）、pnpm 9.12.0。

```bash
pnpm install                              # 安装全部 workspace 依赖
pnpm -r typecheck                         # 全仓库类型检查
pnpm --filter @mim/api test               # API 契约测试（vitest + supertest，18 例）
pnpm --filter @mim/web build              # 前端类型检查 + 产物构建
pnpm --filter @mim/api dev                # 启动后端（http://127.0.0.1:8787）
pnpm --filter @mim/web dev                # 启动前端（http://127.0.0.1:5173，/api 代理到 8787）
npm run check                             # 版本规约 + 密钥模板校验
```

其他：`pnpm build`（`site/` → `dist/` 本地预览）、`pnpm test`（等价 `@mim/api test`）。

## 文档索引

| 入口 | 内容 |
|---|---|
| [docs/wiki/README.md](./docs/wiki/README.md) | Wiki 首页：01 架构 / 02 模块 / 03 代码参考 / 04 依赖 / 05 运行 / 06 治理 / 07 功能 / 08 开发实现 / 09 第三方 SDK 清单 |
| [docs/wiki/07-functional-modules.md](./docs/wiki/07-functional-modules.md) | FR-01~06 功能规格与实现状态（实况） |
| [docs/wiki/08-dev-implementation.md](./docs/wiki/08-dev-implementation.md) | 开发实现全景与「已实现 vs 规划」对照（§1.1） |
| [Mim-PRD.html](./Mim-PRD.html) | 产品需求文档（V0.0.0-preview，含登录与支付交互演示） |
| [team-hiring-plan.md](./team-hiring-plan.md) | 技术架构约束与团队分阶段配置规划 |

## 站点与部署

> **当前定位**：本仓库已是**可运行的功能产品底座**（P0：账号、订阅、项目/任务、同步、导出、仪表盘）。`site/` 仍仅作 PRD 的可视化阅读载体，本地预览，**不绑定生产域名**。

| 项 | 说明 |
|---|---|
| `apps/web` + `services/mim-api` | 实际功能代码；本地运行命令见上节 |
| `site/index.html` / `site/prd.html` | PRD 可视化入口与副本，本地双击可打开 |
| `package.json` / `scripts/build.mjs` | `site/` → `dist/` 的本地预览构建，**非生产部署** |
| 生产域名 | 无。当前无生产部署与域名绑定 |

本地构建（可选）：`npm run build`；校验：`npm run check`（版本 + 密钥模板）。

