# Mim 安装指南（环境依赖与逐平台安装步骤）

> 面向**拿到仓库源码的人**：把本机从零装到能跑 `npm run dev` 与 `npm run server:up`。
> 只想看前端效果的话，装完 Node 就够 —— 不配置后端时前端完全可用。

---

## 一、依赖清单

| 依赖 | 版本要求 | 是否必需 | 用于 |
| --- | --- | --- | --- |
| Node.js | `>=20` | ✅ 必需 | 前端构建（`npm run dev/build`）、后端运行（`server/`） |
| npm | 随 Node 附带 | ✅ 必需 | 依赖安装 |
| Git | 近期版本 | ✅ 必需 | 拉取代码 |
| Docker Desktop / Docker Engine + Compose 插件 | 近期版本 | ⚠️ 后端用 Docker 时才需要 | 起 PostgreSQL 16 与 API 容器 |
| PostgreSQL | `16` | ⬜ 二选一 | 不想用 Docker 时自行准备数据库 |
| JDK 21 + Android SDK | — | ⬜ 可选 | Android 壳（`android/`） |
| Xcode | — | ⬜ 可选 | iOS 壳（`ios/`，仅 macOS） |
| DevEco Studio | — | ⬜ 可选 | HarmonyOS 壳（`harmony/`） |
| Rust 工具链 | — | ⬜ 可选 | 桌面壳（`src-tauri/`） |

版本约束的真源：

- 前端 Node 版本：`package.json` 的 `engines.node`（`>=20`）
- 后端 Node 版本：`server/package.json` 的 `engines.node`（`>=20`）
- 数据库版本：`server/docker-compose.yml` 的 `db.image`（`postgres:16-alpine`）

> CI（`.github/workflows/build.yml`）跑在 **Node 22** 上。`engines.node` 是 `>=20`，所以本机装 20 或 22 都能跑，**建议与 CI 对齐装 22**（下面命令里的 `20` 换成 `22` 即可）。

---

## 二、Windows

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

### 3) Docker Desktop（后端用 Docker 时）

1. <https://www.docker.com/products/docker-desktop/> 下载安装。
2. 安装时勾选 **Use WSL 2 instead of Hyper-V**；按提示完成 WSL 后端初始化并重启。
3. 启动 Docker Desktop，等到托盘图标显示 *Running*。
4. 验证：

```powershell
docker -v
docker compose version
docker run hello-world
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

### 3) Docker Desktop

```bash
brew install --cask docker
open -a Docker       # 首次启动会引导授权
docker compose version
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

### 3) Docker Engine + Compose 插件

```bash
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"     # 重新登录后生效，免 sudo 用 docker
docker compose version
```

### 4) 不用 Docker，直接用系统 Postgres 16

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE mim;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '换成你的密码';"
```

然后：

```bash
export DATABASE_URL=postgres://postgres:你的密码@127.0.0.1:5432/mim
npm run server:migrate
npm run server:dev
```

### 5) 可选：原生壳工具链

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

后端（需要 Docker）：

```bash
npm run server:install
npm run server:up
npm run server:migrate
npm run server:health
```

完整的 step by step（含创建首个管理员与常见问题）见 [`docs/rebuild/启动说明.md`](docs/rebuild/启动说明.md)。

---

## 六、常见安装问题

| 现象 | 处理 |
| --- | --- |
| `npm : 无法加载文件 … 因为在此系统上禁止运行脚本`（PowerShell） | 以管理员身份执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `node -v` 报「不是内部或外部命令」 | PATH 未生效，重新打开终端；Windows 上确认安装时勾选了 Add to PATH |
| `docker compose` 提示 `command not found` | 装的是旧版 `docker-compose`（带横杠）或没装 Compose 插件；Docker Desktop 自带 `docker compose` |
| `docker: permission denied`（Linux） | `sudo usermod -aG docker $USER` 后**重新登录** |
| `npm install` 卡住 / 报证书错误 | 换源：`npm config set registry https://registry.npmmirror.com` |
| Node 版本低于 20 导致 vite 启动失败 | 用 nvm 切到 20：`nvm install 20 && nvm use 20` |
| Windows 下 Git Bash 报路径相关错误 | 用 Git Bash 时路径写正斜杠（`f:/合并项目/Mim`），不要用反斜杠 |
