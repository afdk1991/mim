---
name: deploy-loop
description: Mim 项目「提交 → CI → 生产取证」闭环部署流程。每轮代码改动完成后，按固定顺序执行：本地质量门禁 → commit+push → 监控 GitHub Actions run 至全绿 → curl 生产域名健康检查与关键接口取证。触发词：部署、上线、push 后确认、delpoy、交付收尾。铁律八强制：无线上取证不得宣称已上线。
---

# deploy-loop — Mim 闭环部署流程

适用于 `f:\合并项目\Mim` 仓库每轮改动的交付收尾。严格按阶段顺序执行，任一阶段失败则修复后重跑，不得跳过。

## 阶段 1：本地质量门禁（全部通过才可提交）

```powershell
pnpm -r typecheck            # 全部包 TS 类型检查
pnpm --filter @mim/api test  # 后端 vitest
pnpm --filter @mim/web build # 前端 vite build
node scripts/env-check.mjs   # env 声明与 schema 一致性
```

有命令输出才算证据；失败必须修复后重跑。

## 阶段 2：提交并推送

- PowerShell **不支持** bash heredoc，commit message 用 Write 工具写临时文件：
  1. `Write` → `.git/COMMIT_EDITMSG_TMP`（完整 conventional message）
  2. `git commit -F .git/COMMIT_EDITMSG_TMP`
  3. `Remove-Item .git/COMMIT_EDITMSG_TMP`
- `git push origin main` 触发 deploy.yml。

## 阶段 3：监控 CI（deploy.yml 5 个 job 全绿）

PowerShell 下 `gh run list --jq` 的 `\(...)` 插值会被吞，用对象形式或简单格式：

```powershell
gh run list --branch main --limit 3
gh run view <run-id> --json status,conclusion,jobs
```

- run 状态为 `in_progress`/`queued` 时，间隔 30~60s 轮询，不得空等不查。
- 5 个 job（verify / deploy / pages / packages / platforms）必须全部 `success`；任一 `failure` 用 `gh run view <run-id> --log-failed` 取日志定位修复，修复后回到阶段 1。

## 阶段 4：线上取证（铁律八）

```powershell
curl.exe -s -o NUL -w "%{http_code}" https://mim.mixm.top/health   # 期望 200
curl.exe -s https://mim.mixm.top/api/v1/modules                    # 关键接口结构与数据
```

- 本轮改动涉及的接口逐条 curl 取证（含鉴权接口用真实 token 走浏览器或 curl 验证）。
- 前端页面变更需浏览器实际打开 `https://mim.mixm.top` 验证渲染与交互。
- 取证输出贴入交付报告；无取证不得宣称「已上线」。

## 多提交场景

同一轮任务产生多个 commit 时（如主提交 + 修复提交），每个 commit 独立走完阶段 2~4，最终交付报告列出全部 run id 与取证结果。
