# Mim 部署指南（GitHub Pages / GitHub Packages / EdgeOne Pages）

本项目已配置一条完整的 CI/CD 流水线：[.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)。

## 部署矩阵

| 事件 | 动作 |
| --- | --- |
| Push 到 `main` | 类型检查 → 构建 → 自动部署 **GitHub Pages** + **EdgeOne Pages** |
| Push tag `v*`（如 `v1.0.0`） | 类型检查 → 构建 → 发布 npm 包到 **GitHub Packages**（站点与 main 同提交，无需重复部署） |
| Pull Request | 只跑质量门禁（typecheck + build），不部署 |
| 手动触发 | 在仓库 Actions 页点 `Run workflow` 随时部署 |

## 一、首次上线（仅需做一次）

### 1. 把代码推上 GitHub

> 本机当前未安装 `git` 命令行，可任选其一：
> - 安装 Git：`winget install --id Git.Git -e`，然后执行下方命令；
> - 或在 GitHub 仓库网页端拖拽上传（Upload files），后续改动再装 Git。

```powershell
# 安装 Git 后执行
cd f:\合并项目\Mim
git init
git add .
git commit -m "feat: 项目初始化并接入 CI/CD 部署"
# 在 github.com 新建空仓库 mim（不要勾选自动生成 README）
git remote add origin https://github.com/<你的用户名>/mim.git
git branch -M main
git push -u origin main
```

推送后流水线会自动开始构建。在仓库 **Actions** 标签页可查看进度。

### 2. 开启 GitHub Pages（免费静态托管）

进入仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
之后每次 push main，流水线会自动发布到：

```
https://<你的用户名>.github.io/mim/
```

项目使用 hash 路由（`#/feed` 等），无需任何 404 兜底配置，子路径直接可用。

### 3. 配置 EdgeOne Pages（腾讯云免费托管）

1. 打开 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages) 并开通服务；
2. 在控制台生成 **API Token**（参考官方文档 [API Token](https://edgeone.cloud.tencent.com/pages/document/176921267881082880)）；
3. 回到 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**：
   - Name：`EDGEONE_API_TOKEN`
   - Secret：粘贴刚才的 Token；
4. 项目名默认为 `mim`（项目不存在会自动创建）。如需改名，编辑
   [.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml) 中 `deploy-edgeone` 的 `EDGEONE_PROJECT_NAME`。

配置完成后，push main 即自动把 `dist/` 通过官方 CLI `edgeone pages deploy` 发布上线。

### 4. GitHub Packages（npm 包托管，无需额外配置）

打 tag 发版即自动发布：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

发布出的包名为 `@<你的用户名>/mim`，地址在仓库 Packages 标签页。
拉取时在本机项目根目录建 `.npmrc`：

```ini
@<你的用户名>:registry=https://npm.pkg.github.com/
```

安装：`npm install @<你的用户名>/mim`（首次会要求用 GitHub PAT 登录）。

## 二、日常开发节奏（边开发边上线）

```powershell
git add .
git commit -m "..."
git push          # 自动构建并同步上线 GitHub Pages + EdgeOne Pages
```

安全网：

- PR 会先跑质量门禁，通过后再合并，避免坏版本上线；
- 同一分支的并发部署会自动取消旧的，只保留最新一次；
- 每次构建产物都会在 Actions 运行详情里保留 7 天，可手动下载排查。

## 三、本地手动部署（可选）

不经过 GitHub，直接用官方 CLI 发布到 EdgeOne：

```powershell
npm install -g edgeone
edgeone login
npm run build
edgeone pages deploy ./dist -n mim -e production
```

## 常见问题

- **Pages 部署按钮置灰**：未把 Settings → Pages 的 Source 切成 GitHub Actions。
- **EdgeOne 部署报 token 无效**：确认 Secret 名是 `EDGEONE_API_TOKEN`，且 Token 是在 Pages 控制台（非腾讯云主账号密钥）生成。
- **改了部署项目名后出现两个项目**：旧项目需在 EdgeOne 控制台手动删除。
