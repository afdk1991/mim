# Mim 安装指南（环境依赖与逐平台安装步骤）

> 面向**拿到仓库源码的人**：把本机从零装到能跑 `npm run dev` 与 `npm run server:dev`。
> 只想看前端效果的话，装完 Node 就够 —— 不配置后端时前端完全可用。
>
> 本项目**不使用容器**：数据库是宿主机上直接安装的 PostgreSQL，后端是宿主机上的普通 Node 进程。

---

## 一、依赖清单

| 依赖 | 版本要求 | 是否必需 | 用于 |
| --- | --- | --- | --- |
| Node.js | `>=20` | ✅ 必需 | 前端构建（`npm run dev/build`）、后端运行（`server/`） |
| npm | 随 Node 附带 | ✅ 必需 | 依赖安装 |
| Git | 近期版本 | ✅ 必需 | 拉取代码 |
| PostgreSQL | `14+`（建议 16） | ⚠️ 跑后端时需要 | 后端唯一数据源，宿主机直接安装（`apt-get install -y postgresql`） |
| nginx | 近期版本 | ⬜ 部署到服务器时需要 | 静态资源直出 + `/api` 反向代理（`apt-get install -y nginx`） |
| JDK 21 + Android SDK | — | ⬜ 可选 | Android 壳（`android/`） |
| Xcode | — | ⬜ 可选 | iOS 壳（`ios/`，仅 macOS） |
| DevEco Studio | — | ⬜ 可选 | HarmonyOS 壳（`harmony/`） |
| Rust 工具链 | — | ⬜ 可选 | 桌面壳（`src-tauri/`） |

版本约束的真源：

- 前端 Node 版本：`package.json` 的 `engines.node`（`>=20`）
- 后端 Node 版本：`server/package.json` 的 `engines.node`（`>=20`）
- 数据库版本：`deploy/README.md` 「前置条件」表（`apt-get install -y postgresql` 装到的系统版本即可）
- nginx 无版本要求，配置模板是 [`deploy/nginx-mim.conf`](deploy/nginx-mim.conf)

> CI（`.github/workflows/build.yml`）跑在 **Node 22** 上。`engines.node` 是 `>=20`，所以本机装 20 或 22 都能跑，
> **建议与 CI 对齐装 22**（下面命令里的 `20` 换成 `22` 即可）。

---

## 二、Windows

Windows 只能作为**开发机**（systemd 部署手册面向 Linux 服务器）。

### 1) Node.js（>= 20）

**方式 A：官方安装包**

1. 打开 <https://nodejs.org/> ，下载 **LTS**（≥ 20）的 Windows Installer（`.msi`）。
2. 一路 Next，勾选「Add to PATH」。
3. 验证（重新打开一个终端）：

```powershell
node -v      # v20.x 或更高
npm -v
```

**方式 B：winget**

```powershell
winget install OpenJS.NodeJS.LTS
```

**方式 C：nvm-windows**（需要多版本切换时）

```powershell
winget install CoreyButler.NVMforWindows
nvm install 20
nvm use 20
```

### 2) Git

```powershell
winget install Git.Git
git -v
```

### 3) PostgreSQL（跑后端时需要）

```powershell
winget install PostgreSQL.PostgreSQL.16
```

安装向导里把**口令**记牢（后面 `DATABASE_URL` 要用），端口保持 `5432`。装完确认服务在跑：

```powershell
Get-Service -Name postgresql*          # Status 应为 Running
psql --version
```

> 若安装时没勾选加入 PATH，用安装目录下的 `psql.exe`，或在 PowerShell 里临时补：
> `$env:Path += ";C:\Program Files\PostgreSQL\16\bin"`。

然后建库并启动后端：

```powershell
$env:DATABASE_URL = "postgres://postgres:你的密码@127.0.0.1:5432/mim"
npm run server:migrate
npm run server:dev
```

### 4) 可选：原生壳工具链

| 目标 | 安装 |
| --- | --- |
| Android | 安装 **Android Studio**（自带 JDK 21 与 Android SDK），在 SDK Manager 里装 Android SDK Platform 34+ 与 Build-Tools |
| HarmonyOS | 安装 **DevEco Studio** |
| 桌面端（Tauri） | 先装 **Visual Studio C++ Build Tools**（MSVC）与 **WebView2 Runtime**，再按 <https://tauri.app/start/prerequisites/> 装 Rust（`winget install Rustlang.Rustup`） |
| iOS | 不支持 —— 需要 macOS + Xcode |

---

## 三、macOS

macOS 同样只作**开发机**用。

### 1) Node.js（>= 20）

```bash
# 方式 A：Homebrew
brew install node@20

# 方式 B：nvm（推荐，便于多版本切换）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use 20
```

验证：

```bash
node -v
npm -v
```

### 2) Git

macOS 装完 Xcode Command Line Tools 即有 Git：

```bash
xcode-select --install
git -v
```

### 3) PostgreSQL（跑后端时需要）

```bash
brew install postgresql@16
brew services start postgresql@16      # 开机自启 + 立即启动
psql --version
```

建库：

```bash
createdb mim
```

然后：

```bash
export DATABASE_URL=postgres://$(whoami)@127.0.0.1:5432/mim
npm run server:migrate
npm run server:dev
```

### 4) 可选：原生壳工具链

| 目标 | 安装 |
| --- | --- |
| iOS | App Store 装 **Xcode**，首次打开执行 `sudo xcode-select -s /Applications/Xcode.app`，并跑一次 `xcodebuild -license accept` |
| Android | 装 **Android Studio** + Android SDK Platform 34+；`brew install --cask android-studio` |
| 桌面端（Tauri） | `xcode-select --install`，再按 <https://tauri.app/start/prerequisites/> 装 Rust（`curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf \| sh`） |
| HarmonyOS | DevEco Studio（macOS 版） |

---

## 四、Linux（Ubuntu / Debian 系）

这是唯一的**部署目标平台**：systemd 单元与 Nginx 配置都按 Debian 系的路径写。

### 1) Node.js（>= 20）

```bash
# 方式 A：nvm（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# 方式 B：NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

验证：

```bash
node -v
npm -v
```

### 2) Git

```bash
sudo apt-get update && sudo apt-get install -y git
git -v
```

### 3) PostgreSQL（宿主机系统服务）

```bash
sudo apt-get install -y postgresql
sudo systemctl enable --now postgresql          # enable = 开机自启，--now = 立即启动
systemctl status postgresql                     # 期望 active (running)
psql --version                                  # 14+ 即可
```

建库建账号（幂等，可重复执行；口令换成你自己的）：

```bash
PGUSER=mim PGPASSWORD='换成你的密码' PGDATABASE=mim ./deploy/init-db.sh
```

数据库连接串随后填进 `server/.env` 的 `DATABASE_URL`：

```bash
DATABASE_URL=postgres://mim:换成你的密码@127.0.0.1:5432/mim
```

### 4) nginx（部署服务器需要）

```bash
sudo apt-get install -y nginx
sudo systemctl enable --now nginx
nginx -v
```

配置直接用仓库里的模板，详见 [`deploy/README.md`](deploy/README.md) 第四、八节。

### 5) RHEL / CentOS / Rocky（命令差异速查）

```bash
# Node.js
sudo dnf module enable -y nodejs:22 && sudo dnf install -y nodejs

# PostgreSQL（RHEL 需要先初始化数据目录）
sudo dnf install -y postgresql-server
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql

# nginx
sudo dnf install -y nginx && sudo systemctl enable --now nginx
```

### 6) 可选：原生壳工具链

| 目标 | 安装 |
| --- | --- |
| Android | 装 Android Studio 或命令行 SDK；`sudo apt-get install -y openjdk-21-jdk` |
| 桌面端（Tauri） | `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev`，再装 Rust |
| iOS / HarmonyOS | 不支持（分别需要 macOS / DevEco） |

---

## 五、装完之后：拉代码并跑起来

```bash
git clone <你的仓库地址>
cd mim
npm install
npm run dev
```

打开 <http://localhost:5173/> 。

后端（宿主机原生，不需要任何虚拟化环境）：

```bash
npm run server:install                  # 安装后端依赖（只有 pg）
PGPASSWORD='你的密码' ./deploy/init-db.sh   # 建库建账号（幂等）
npm run server:migrate                  # 应用迁移（幂等）
npm run server:dev                      # node src/main.js → http://127.0.0.1:8787
npm run server:health                   # 健康探测
```

完整的 step by step（含创建首个管理员与常见问题）见 [`docs/rebuild/启动说明.md`](docs/rebuild/启动说明.md)。
上线部署（systemd + nginx + 日志轮转）见 [`deploy/README.md`](deploy/README.md)。

---

## 六、常见安装问题

| 现象 | 处理 |
| --- | --- |
| `npm : 无法加载文件 … 因为在此系统上禁止运行脚本`（PowerShell） | 以管理员身份执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `node -v` 报「不是内部或外部命令」 | PATH 未生效，重新打开终端；Windows 上确认安装时勾选了 Add to PATH |
| `psql: command not found` | PostgreSQL 客户端没进 PATH。Linux：`sudo apt-get install -y postgresql-client`；macOS：`brew link --force postgresql@16`；Windows：见第二节第 3 步 |
| `systemctl status postgresql` 不是 `active` | `sudo systemctl enable --now postgresql`；仍失败看 `sudo journalctl -u postgresql -n 50` |
| 连不上库（`could not connect to server`） | 确认 PostgreSQL 在跑、端口是 `5432`、`DATABASE_URL` 的账号口令与 `init-db.sh` 建的一致 |
| `认证失败 password authentication failed` | 口令不对。**重新执行一次 `PGPASSWORD=xxx ./deploy/init-db.sh`** —— 它只重置口令，不删库不动数据 |
| `npm install` 卡住 / 报证书错误 | 换源：`npm config set registry https://registry.npmmirror.com` |
| Node 版本低于 20 导致 vite 启动失败 | 用 nvm 切到 20：`nvm install 20 && nvm use 20` |
| Windows 下 Git Bash 报路径相关错误 | 用 Git Bash 时路径写正斜杠（`f:/合并项目/Mim`），不要用反斜杠 |
