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

## 文档索引

| 入口 | 内容 |
|---|---|
| [docs/wiki/README.md](./docs/wiki/README.md) | Wiki 首页：01 架构 / 02 模块 / 03 代码参考 / 04 依赖 / 05 运行 / 06 治理 / 07 功能 / 08 开发实现 / 09 第三方 SDK 清单 |
| [Mim-PRD.html](./Mim-PRD.html) | 产品需求文档（V0.0.0-preview，含登录与支付交互演示） |
| [team-hiring-plan.md](./team-hiring-plan.md) | 技术架构约束与团队分阶段配置规划 |

## 站点与部署

> **当前定位**：本仓库为产品需求文档（PRD）+ 架构设计仓库，**不是可运行的功能产品**。`site/` 仅为 PRD 的可视化阅读载体（落地页 + PRD 副本），用于本地或临时预览，**不绑定生产域名、不作为线上产品部署**。

| 项 | 说明 |
|---|---|
| `site/index.html` | Mim 落地页（PRD 的可视化入口），本地双击可打开 |
| `site/prd.html` | `Mim-PRD.html` 的站点副本，供浏览器阅读 |
| `package.json` / `scripts/build.mjs` | 可选的本地构建脚本（`site/` → `dist/`），仅用于本地预览验证，**非生产部署** |
| 生产域名 | 无。`data.mixm.top` 等线上域名不归本仓库所有 |

本地构建（可选）：`npm run build`；校验：`npm run check`（版本 + 密钥模板）。

