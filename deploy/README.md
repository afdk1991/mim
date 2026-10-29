# Mim 部署与运维手册（宿主机直部署，全程无容器）

> 本项目**完全不使用容器**。后端是宿主机上的一个普通 Node 进程，数据库是宿主机上安装的
> PostgreSQL，静态资源由 nginx 直出。守护、自启、崩溃重启全部交给 systemd。
> GitHub 是唯一可写代码源（`afdk1991/mim`），镜像仓、制品、运行时全部单向同步。

---

## 一、部署后的形态

```
                     ┌──────────────────────────────────────┐
   浏览器/App  ─────▶│ nginx :80                            │
                     │   /           → /opt/mim/dist 静态文件 │
                     │   /assets/    → 长缓存               │
                     │   /api/*      → 反代 127.0.0.1:8787  │
                     └───────────────┬──────────────────────┘
                                     │ proxy_pass（保留 /api 前缀）
                     ┌───────────────▼──────────────────────┐
                     │ mim-server（systemd 守护）            │
                     │   node src/main.js                   │
                     │   监听 127.0.0.1:8787                │
                     └───────────────┬──────────────────────┘
                                     │ pg 协议
                     ┌───────────────▼──────────────────────┐
                     │ PostgreSQL  :5432（宿主机系统服务）    │
                     └──────────────────────────────────────┘
```

| 组件 | 形态 | 端口 | 说明 |
| --- | --- | --- | --- |
| 前端 | 静态文件 `/opt/mim/dist` | 80/443（nginx） | `vite build` 产物，`base: './'` + hash 路由，放任意目录都能跑 |
| 后端 | Node 20 进程 | 127.0.0.1:8787 | 只监听回环，不对公网暴露 |
| 数据库 | PostgreSQL 系统服务 | 127.0.0.1:5432 | 直接装在宿主机 |
| 守护 | systemd `mim-server.service` | — | 开机自启 + 崩溃自动重启 |

### 1.1 systemd 原生进程架构（容器编排文件的等价物）

> **N/A 决策说明**：通用方案包里的 `docker-compose.yml`（PostgreSQL + Node API + Redis +
> Nginx 五容器编排）在 Mim **不落地**——本项目任何位置都不新建容器编排文件、不使用容器
> 构建/推送。下表是它与 Mim 原生进程架构的逐项映射，仅作对照记录，容器一侧不构成 Mim 的
> 可用步骤。

| 通用方案容器服务 | Mim 原生等价物 | 说明 |
| --- | --- | --- |
| nginx 容器（静态 + 反代） | `deploy/nginx-mim.conf`（宿主机 nginx 站点） | 配置已就绪，见第九节 |
| api 容器（Node 长驻进程） | `mim-server.service`（systemd 单元） | 见第七节 |
| db 容器（PostgreSQL） | 宿主机 `postgresql` 系统服务 + `deploy/init-db.sh` | 见第三节与第五节 |
| worker 容器（后台任务） | **省略（N/A）** | Mim 后端是单体 node 进程，无独立 worker 角色；定时任务需求未出现，不预留组件 |
| redis 容器 | **省略（N/A）** | Mim 当前无缓存/队列需求，后端唯一外部依赖是 PostgreSQL；将来若需要再加宿主机原生 redis |
| healthcheck / restart 策略 | systemd `Restart=always` + `scripts/server-health.mjs` | 见第七、十四节 |

---

## 二、通用下载方案包 → Mim 落地形态对照表

通用部署方案包共 11 个文件，逐个去处如下（「落地」= 以新形态进入本项目；「改写落地」=
内容经适配后落地；「剔除」= 不引入项目，仅在此说明理由）。

| 下载包文件 | 去处决策 | 理由 / 落地形态 |
| --- | --- | --- |
| `docker-compose.yml.yml` | 剔除 | 项目禁用容器；等价物见 1.1 节 systemd 原生进程架构映射。**N/A，不构成 Mim 步骤** |
| `index.ts.ts`（Cloudflare Worker 网关） | 剔除 | Mim 为自托管 systemd+nginx 路线，server 已有 `/api/sync/posts` 增量同步；引入 Cloudflare 需账号/API Token/D1/KV 且增加一跳边缘转发，自托管单站无多运行时分流需求。仅借鉴其「健康探测带密钥、探测结果缓存 60s TTL、故障降级返回只读/错误页」思路——Mim 对应物是 `scripts/server-health.mjs` 与 nginx 错误页行为，不引入 Cloudflare 依赖 |
| `sync.ts.ts`（Hono 同步接口示例） | 剔除 | Mim 已有等价实现 `server/src/sync.js`（`GET /api/sync/posts`，`x-sync-token` 鉴权，未配置 `SYNC_TOKEN` 时端点直接关闭），语义见第十七节。不重复引入示例代码 |
| `build-publish.yml.yml`（tag 触发镜像构建+GHCR/ACR+npm） | 改写落地 | 新建 `.github/workflows/deploy-release.yml`：小写 `v*` tag 触发 → 质量闸门 → 构建 → 打包 `mim-deploy-<tag>.zip` → GitHub Release；全部镜像构建/推送步骤（含 GHCR、ACR）剔除，npm 发布改为默认关闭、经变量 `ENABLE_NPM_PUBLISH` 显式开启的可选项（复用 `scripts/prepare-package.mjs`） |
| `deploy.yml.yml`（CI 三运行时编排） | 合并进现有文件 | 现有 `.github/workflows/deploy.yml` 已覆盖「质量闸门 + SSH 发布到宿主机」，其 Cloudflare/Makers/Gitee 分发分支对自托管路线 N/A；不新建文件，分发关系见第十六节 CI/CD 总览 |
| `mirror.yml.yml`（GitHub→国内镜像仓） | 改写落地 | 新建 `.github/workflows/mirror.yml`：push main + 每日定时，目标按 Mim 实际 remote 改为 gitee.com / gitcode.com（云效 Codeup）/ atomgit.com，腾讯 CNB 为可选目标；Token 缺失的目标自动跳过 |
| `pipeline.yml.yml`（Gitee Go 流水线） | 改写落地（参考文件） | 新建 `.gitee/pipeline.yml`：适配 Mim 仓库与 Node 22、国内 npmmirror 源；CloudBase 部署步骤 N/A（Mim 不使用云托管），只保留构建+质量门禁校验。需在 Gitee 项目「持续集成 → 流水线」平台侧手动创建并导入 |
| `cleanup-images.sh.sh`（GHCR/ACR 旧镜像清理） | 剔除，策略替换 | 无容器仓库即无镜像清理对象（**N/A**）。等价物为制品保留策略：GitHub Release 上的 `mim-deploy-*.zip` 随 tag 长期保留（Release 不占 Actions 存储配额），工件保留 30 天（deploy-release.yml 内已设 `retention-days: 30`）；客户端安装包 Release 不自动删 |
| `init-multi-remote.sh.sh`（多 remote 初始化+镜像推送） | 以现有脚本为准，并入一个 remote | 现有 `scripts/init-multi-remote.sh` 是 Mim 已适配版（只注册不推送、幂等），保留其行为；本次仅按下载版补登 `tencent-cnb` 可选 remote。日常推送由 `mirror.yml` 承担 |
| `README.md`（方案包说明） | 重写为本文件 | 即本 `deploy/README.md` |
| `全栈全站项目部署上线_完整架构手册.docx` | 提炼改写 | 手册中的额度/降级/路线图按 Mim 无容器实况改写为第十八、十九、二十节；其中 Cloudflare 全家桶、Oracle 免费实例、EdgeOne Makers、R2 等平台内容对 Mim **未使用**，仅作对照记录 |

---

## 三、前置条件

宿主机需要（都不要用容器装）：

| 依赖 | 版本 | Debian/Ubuntu | RHEL 系 |
| --- | --- | --- | --- |
| Node.js | >= 20（CI 用 22） | `curl -fsSL https://deb.nodesource.com/setup_22.x \| bash - && apt-get install -y nodejs` | `dnf module enable -y nodejs:22 && dnf install -y nodejs` |
| PostgreSQL | 14+ | `apt-get install -y postgresql` | `dnf install -y postgresql-server && postgresql-setup --initdb` |
| nginx | 任意近期版本 | `apt-get install -y nginx` | `dnf install -y nginx` |
| rsync | 可选 | `apt-get install -y rsync` | `dnf install -y rsync` |

验证：

```bash
node -v          # v22.x
psql --version   # 14+ 或 16
nginx -v
```

---

## 四、一键部署

```bash
git clone https://github.com/afdk1991/mim.git
cd mim
sudo MIM_DIR=/opt/mim DOMAIN=example.com ./deploy/install.sh
```

脚本是**幂等**的：重复执行不会删除数据库或已有配置；`.env` 若已存在则保持不动。
它会依次完成：装系统依赖 → 同步源码到 `/opt/mim` → 建 `mim` 运行账号 → 生成 `.env`
（随机 `JWT_SECRET` 与数据库口令）→ 建库建账号 → `npm install` + 前端构建 → 应用迁移
→ 装 systemd/nginx/logrotate → 启动并做健康检查。

只想重部署后端（改了 server 代码、前端没动）时加 `SKIP_BUILD=1` 跳过前端构建。

---

## 五、手动分步部署（不想跑一键脚本时）

```bash
# 1) 源码就位
sudo mkdir -p /opt/mim && sudo rsync -a --exclude node_modules --exclude dist --exclude .git ./ /opt/mim/

# 2) 后端依赖（pg 是唯一外部依赖）
cd /opt/mim && npm install --no-audit --no-fund
npm --prefix server install --omit=dev --no-audit --no-fund

# 3) 前端构建。同一域名下由 nginx 反代 /api，构建期不需要填后端地址
VITE_MIM_API_BASE= npm run build        # 留空 → 前端回退同源 /api

# 4) 数据库：创建账号与库
PGUSER=mim PGPASSWORD='强口令' PGDATABASE=mim ./deploy/init-db.sh

# 5) 写配置
sudo cp /opt/mim/server/.env.example /opt/mim/server/.env
sudo chmod 600 /opt/mim/server/.env
sudo vi /opt/mim/server/.env           # 至少改 JWT_SECRET 与 DATABASE_URL

# 6) 迁移
cd /opt/mim/server && npm run migrate

# 7) 守护
sudo cp deploy/mim-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mim-server

# 8) 静态资源与反向代理
sudo cp deploy/nginx-mim.conf /etc/nginx/sites-available/mim
sudo ln -sf /etc/nginx/sites-available/mim /etc/nginx/sites-enabled/mim
sudo cp deploy/logrotate-mim.conf /etc/logrotate.d/mim
sudo nginx -t && sudo systemctl enable --now nginx

# 9) 验证
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://localhost/api/health          # 走 nginx
```

---

## 六、配置（密钥管理）

配置通过 **环境变量 / 配置文件** 管理：`/opt/mim/server/.env`，由 systemd 单元里的
`EnvironmentFile=` 注入。服务端只读 `process.env`，自身不解析 `.env` 文件。
`.env` 权限必须是 `600`，**严禁提交进 Git**（仓库里只有 `.env.example` 模板）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 后端监听端口，改了要同步改 nginx 的 `proxy_pass` |
| `HOST` | `0.0.0.0` | 生产建议 `127.0.0.1`，只让本机 nginx 访问 |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/mim` | 宿主机 PostgreSQL 连接串 |
| `JWT_SECRET` | `change-me-in-production` | **必须替换**：`openssl rand -hex 32` |
| `BOOTSTRAP_ADMIN_USERNAME` | 空 | 全新库建首个管理员的一次性出口 |
| `TOKEN_TTL_MS` | `604800000`（7 天） | 令牌有效期 |
| `SECKILL_LOCK_MS` | `900000`（15 分） | 秒杀锁库存时长，需与前端 `LIMITS.seckillLockMs` 一致 |
| `UPLOAD_DIR` | `./data/uploads` | 上传落盘目录，必须在 systemd 的 `ReadWritePaths` 里 |
| `UPLOAD_MAX_BYTES` | `3145728`（3MB） | 需与前端 `LIMITS.uploadMaxBytes`、nginx `client_max_body_size` 三者一致 |
| `PUBLIC_API_BASE` | 空 | 反代到公网时填写，决定 `/api/storage/<key>` 返回相对还是绝对地址 |
| `PG_POOL_MAX` | `10` | 连接池上限 |
| `MAX_BODY_BYTES` | `12582912`（12MB） | JSON 请求体上限 |
| `SYNC_TOKEN` | 空 | 只读增量同步令牌（`openssl rand -hex 32`）；**留空则该端点关闭**，见第十七节 |

前端构建期只有一个变量：

| 变量 | 说明 |
| --- | --- |
| `VITE_MIM_API_BASE` | 留空 → 同源 `/api`（**推荐**，配 nginx 反代即可）；填 `off` → 纯本地模式；填 `https://api.xxx` → 跨域直连 |

改完 `.env` 后执行 `sudo systemctl restart mim-server` 生效。

**CI 侧 Secrets 最小权限矩阵**（GitHub 仓库 Settings → Secrets and variables → Actions）：

| Secret / Variable | 用于 | 权限范围 |
| --- | --- | --- |
| `OCI_HOST` / `OCI_USER` / `OCI_SSH_KEY` | deploy.yml SSH 发布 | 仅部署账号，禁 root |
| `ENABLE_SERVER_DEPLOY`（Variable） | deploy.yml 服务器发布层开关 | 缺省关闭（job 跳过不红）；配好三项 Secrets 后显式置 `true` 激活 |
| `MIM_DIR`（Variable） | 服务器安装目录 | — |
| `MIM_API_BASE`（Variable） | 前端构建期注入 | — |
| `GITEE_TOKEN` / `GITCODE_TOKEN` / `ATOMGIT_TOKEN` / `CNB_TOKEN` | mirror.yml | 仅目标仓库写权限，不给删仓权限 |
| `ENABLE_NPM_PUBLISH`（Variable） | deploy-release.yml | 缺省不发布；显式置 `true` 才发 npm 包 |
| 客户端签名密钥（`TAURI_*`、`ANDROID_*`） | build-release.yml | 仅 Release 构建机可用 |

规则：任何密钥不跨平台复用；镜像仓 token 不给删除权限；生产数据库凭证只存在于服务器
`.env`，不进 GitHub Secrets。

**部署密钥对已预置**：`deploy/mim-deploy.pub`（ed25519，公钥可公开）与仓库 Secret
`OCI_SSH_KEY`（私钥，2026-10-29 生成并写入，本机未留副本）是一对。新服务器初始化时把
公钥追加到部署账号的 `~/.ssh/authorized_keys` 即可，无需再生成密钥对：

```bash
# 在服务器上（部署账号下）执行一次
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO/6QNNFABgTkxqzD1/COQtd8KlNyHHliuOAJJW7XwSu mim-deploy@github-actions
EOF
chmod 600 ~/.ssh/authorized_keys
```

之后只剩三项配置：`OCI_HOST`（服务器 IP）、`OCI_USER`（部署账号）、
Variable `ENABLE_SERVER_DEPLOY=true`，push main 即自动发布。

---

## 七、进程守护

systemd 单元 `deploy/mim-server.service` 已配置：

| 能力 | 配置 | 命令 |
| --- | --- | --- |
| 崩溃自动重启 | `Restart=always`、`RestartSec=3` | 无需干预，进程退出后 3 秒拉起 |
| 开机自启 | `[Install] WantedBy=multi-user.target` | `sudo systemctl enable mim-server` |
| 优雅停止 | `KillSignal=SIGTERM`、`TimeoutStopSec=20` | 后端已注册 SIGTERM 处理器，先关连接池再退出 |
| 重启风暴保护 | `StartLimitBurst=10` / `StartLimitIntervalSec=60` | 60 秒内重启超 10 次会停手，避免刷爆日志 |
| 最小权限 | `User=mim`、`NoNewPrivileges`、`ProtectSystem=full` | 只有上传目录 `ReadWritePaths` 可写 |

常用命令：

```bash
sudo systemctl status  mim-server
sudo systemctl start   mim-server
sudo systemctl stop    mim-server
sudo systemctl restart mim-server     # 改了 .env / 重新构建之后
sudo systemctl disable --now mim-server   # 停服并取消自启
```

重启后确认真的起来了：

```bash
systemctl is-active mim-server && curl -fsS http://127.0.0.1:8787/api/health
```

---

## 八、静态资源

- 产物目录：`/opt/mim/dist`，由 `npm run build` 生成，nginx `root` 直指向它
- `vite.config.ts` 里 `base: './'` 全部使用相对路径，因此**部署到子路径也不需要额外配置**
- `/assets/` 下是带 content-hash 的产物 → 配 `expires 1y` + `immutable`
- `index.html` 配 `no-cache`，否则发版后用户刷新也拿不到新页面
- 前端是自研 hash 路由（`#/xxx`），服务端永远只收到 `/`，但仍保留 `try_files` 兜底；
  `public/` 下的独立页面会被原样拷进 dist，可直接 `/privacy.html` 访问
- 更新流程：`cd /opt/mim && npm run build`（nginx 不需要 reload，静态文件即时生效）

---

## 九、反向代理

`deploy/nginx-mim.conf` 的关键点是 **`proxy_pass` 末尾不能带 URI**：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;      # ✅ 保留 /api 前缀
    # proxy_pass http://127.0.0.1:8787/;   # ❌ 会被重写成 /xxx，后端全部 404
}
```

后端 `server/src/main.js` 要求所有接口带 `/api` 前缀（不带直接返回 404），所以这个斜杠是致命的。

其他注意项：

- `client_max_body_size 3m` 必须与后端 `UPLOAD_MAX_BYTES`、前端 `LIMITS.uploadMaxBytes` 三者一致
- 需要 HTTPS 时用 `certbot --nginx` 在宿主机直接签发，配置里不用改任何后端代码
- 前端若部署在**不同域名**（跨域），构建时要把 `VITE_MIM_API_BASE` 指到后端公网地址，
  后端已全开 CORS 并允许 `Authorization` 头，无需额外配置
- 想让 TLS 卸载后后端拿到正确协议，已配 `X-Forwarded-Proto`

---

## 十、日志

分两层：

| 层 | 位置 | 查看方式 |
| --- | --- | --- |
| 后端 | journald（`StandardOutput=journal`） | `sudo journalctl -u mim-server -f` |
| nginx | `/var/log/nginx/mim.{access,error}.log` | `sudo tail -f /var/log/nginx/mim.access.log` |

常用操作：

```bash
sudo journalctl -u mim-server -n 200 --no-pager
sudo journalctl -u mim-server --since "10 min ago"
sudo journalctl -u mim-server -p err -b
sudo journalctl --vacuum-size=500M
```

nginx 日志由 `/etc/logrotate.d/mim` 每天轮转、保留 14 天、压缩归档。

---

## 十一、升级与回滚

### 11.1 git 流程（服务器上直接更新，CI 默认走这条）

```bash
cd /opt/mim
git pull --ff-only                        # 或重新 rsync 源码
npm install --no-audit --no-fund         # 前端依赖有变化时
npm run build                            # 静态资源即时生效，nginx 不用 reload
npm --prefix server install --omit=dev   # 后端依赖有变化时
cd server && npm run migrate              # 迁移幂等，随时可补跑
sudo systemctl restart mim-server
curl -fsS http://127.0.0.1:8787/api/health
```

数据库迁移是幂等的（`server/db/migrations/*.sql` 全部 `create table if not exists` 风格），
重复执行安全。此流程已固化进 `.github/workflows/deploy.yml`：`main` 推送后先跑质量闸门，
再 SSH 登录服务器按同样顺序执行。

### 11.2 Release zip 流程（服务器拉不到 GitHub / 离线部署时）

```bash
# 1) 在 GitHub Releases 下载 mim-deploy-vX.Y.Z.N.zip（由 deploy-release.yml 自动产出）
# 2) 传到服务器后解压到安装目录旁
unzip mim-deploy-v0.0.0.5.zip -d /tmp/mim-release
sudo rsync -a --exclude node_modules --exclude .git /tmp/mim-release/ /opt/mim/

# 3) 重新装依赖 + 重启（zip 内已含 dist，可 SKIP_BUILD=1 跳过前端构建）
cd /opt/mim
npm install --no-audit --no-fund
npm --prefix server install --omit=dev --no-audit --no-fund
cd server && npm run migrate
sudo systemctl restart mim-server
curl -fsS http://127.0.0.1:8787/api/health
```

### 11.3 回滚

```bash
# 代码回滚：回到上一个 tag / Release zip 重新 11.2 解压覆盖
cd /opt/mim && git checkout <上一个 tag>     # git 流程
# 然后重跑依赖安装 → 迁移 → 重启（同 11.1）

# 数据库迁移只增不改，回滚代码通常不需要回滚数据库结构；
# 必要时先按第十二节做备份再操作。
```

---

## 十二、备份

```bash
# 备份（逻辑导出，普通 pg_dump）
sudo -u postgres pg_dump mim | gzip > /var/backups/mim-$(date +%F).sql.gz

# 恢复
sudo -u postgres psql -c 'DROP DATABASE IF EXISTS mim;'
sudo -u postgres createdb --owner=mim mim
zcat /var/backups/mim-2026-10-28.sql.gz | sudo -u postgres psql mim

# 上传的文件也要一起备份
tar czf /var/backups/mim-uploads-$(date +%F).tar.gz /opt/mim/server/data/uploads
```

建议：`crontab` 每天凌晨跑一次 pg_dump，保留最近 14 天；每季度做一次恢复演练
（新建临时库还原 → 抽查关键表行数），没演练过的备份等于没有备份。

---

## 十三、故障排查

| 现象 | 原因与处理 |
| --- | --- |
| `systemctl status` 显示 failed | `journalctl -u mim-server -n 100` 看栈顶；最常见是 `DATABASE_URL` 连不上 |
| `/api/health` 返回 `{"ok":true,"db":false,...}` | 进程活着但连不上库。检查连接串、PostgreSQL 是否在跑、`pg_hba.conf` |
| 接口全部 404（带 `/api` 前缀要求） | nginx 的 `proxy_pass` 末尾多了斜杠 |
| 上传报体积超限 | `UPLOAD_MAX_BYTES`、`client_max_body_size`、前端 `LIMITS.uploadMaxBytes` 三者一致 |
| 改了迁移后仍报未知列 | 重启后端刷新列名缓存：`sudo systemctl restart mim-server` |
| 前端一直读旧数据 | `index.html` 被缓存；或 `VITE_MIM_API_BASE` 指向了别的后端 |
| 502 Bad Gateway | 后端没起来或 `PORT` 与 nginx 的 `proxy_pass` 不一致 |
| 重启后没有自动拉起 | 忘了 `systemctl enable mim-server` |
| 一直重启失败到被 systemd 停手 | `systemctl reset-failed mim-server && systemctl start mim-server` |

---

## 十四、健康检查

| 手段 | 命令 / 入口 | 说明 |
| --- | --- | --- |
| 进程内健康接口 | `curl -fsS http://127.0.0.1:8787/api/health` | 返回 `ok` 与 `db` 连通状态 |
| 端到端脚本 | `node scripts/server-health.mjs`（或 `npm run server:health`） | 探测 `/api/health` + 一条真实 REST 查询，CI 与本地通用 |
| systemd 状态 | `systemctl status mim-server` | 开机自启与崩溃重启是否正常 |
| nginx 链路 | `curl -fsS http://localhost/api/health`（走 80 端口） | 验证静态直出 + 反代整链路 |
| 外部拨测 | UptimeRobot 等免费拨测打 `/api/health` | 周期性发现故障（可选） |

---

## 十五、镜像与多仓（GitHub 唯一可写源）

```bash
# 首次在新机器上注册只读镜像 remote（幂等，只注册不推送）
./scripts/init-multi-remote.sh
# MIRROR_NS=someone ./scripts/init-multi-remote.sh   # 换命名空间
```

注册的 remote：`gitee`（gitee.com）、`jihu`（gitcode.com 云效 Codeup，沿用历史命名）、
`atomgit`（atomgit.com）、`tencent-cnb`（腾讯云 CNB，可选）。
首次全量镜像由人工执行 `git push --mirror <remote>`（脚本末尾有提示）。

日常增量同步由 `.github/workflows/mirror.yml` 自动完成（push main + 每天 04:00 UTC 兜底），
需要的 Secrets 见第六节矩阵。镜像仓在平台侧开启保护分支，**不要反向同步**。

容量提醒：Gitee 单仓库 500 MB、单文件 50 MB；大二进制（安装包、zip）一律走 GitHub
Releases，不进 Git。

---

## 十六、CI/CD 总览

| Workflow | 触发条件 | 职责 |
| --- | --- | --- |
| `build.yml` | push main、PR、手动 | 质量闸门（typecheck/test/后端 check）+ 前端构建产物部署到 GitHub Pages（只读展示用） |
| `deploy.yml` | push main、手动（可跳过前端构建） | 质量闸门 + SSH 发布到宿主机：git pull → 装依赖 → 构建 → 迁移 → 重启 → 健康检查 |
| `build-release.yml` | tag `V*.*.*.*`（客户端版本 tag） | 桌面三平台/Android/iOS/鸿蒙构建，tauri-action 建 Release 并挂安装包与 OTA manifest |
| `deploy-release.yml`（新增） | tag `v*`（小写，服务器部署包 tag）、手动 | 质量闸门 → 构建 → 打包 `mim-deploy-<tag>.zip` → GitHub Release；可选 npm 发布（默认关闭） |
| `mirror.yml`（新增） | push main、每日 04:00 UTC、手动 | GitHub → Gitee/gitcode/AtomGit（+可选 CNB）单向镜像 |
| `release-notes.yml` | Release published | 自动归纳变更说明追加到 Release 正文 |
| `.gitee/pipeline.yml`（参考文件） | 需 Gitee 平台侧手动创建流水线 | 国内网络构建校验（npmmirror 源），不做部署 |

tag 约定（避免同一事件多文件重复触发）：

- `V*.*.*.*` = 客户端发布（唯一版本源 `src/core/version.ts` 的 `APP_VERSION`，大写 V）
- `v*` = 服务器端部署包发布，建议与 APP_VERSION 对应（如 `v0.0.0.5`）
- 客户端安装包与服务器部署包分开 Release，互不干扰

---

## 十七、只读增量同步接口

外部镜像站 / 静态站要拿到最新公开动态时用这个端点，**只读，不接受任何写操作**。
（这就是通用方案 `sync.ts` 示例对应的 Mim 既有实现 `server/src/sync.js`。）

```bash
curl -fsS -H "x-sync-token: $SYNC_TOKEN" \
  'http://127.0.0.1:8787/api/sync/posts?since=0&limit=200'
```

| 参数 | 说明 |
| --- | --- |
| `since` | 上次拿到的 `next` 水位（毫秒时间戳），首次传 `0` |
| `limit` | 单次返回条数，默认 200，上限 500 |

请求头 `x-sync-token` 必须等于 `SYNC_TOKEN`；**未配置 `SYNC_TOKEN` 时端点直接关闭**（403），
不会因为漏配环境变量把数据裸奔出去。调用方循环：`since = next`，直到 `has_more` 为 `false`。

语义约束：只返回 `visibility = 'public'` 且未过期的动态；水位取 `updated_at`，编辑过的旧动态
也会被同步；同一 `since` 反复请求结果稳定。

---

## 十八、降级矩阵（Mim 无容器实况）

| 故障 | 检测 | 动作 | 用户感知 |
| --- | --- | --- | --- |
| GitHub 不可用 | 定时 `git ls-remote` | 从 Gitee/gitcode/AtomGit 镜像拉取部署；CI 暂停发布 | 服务不受影响 |
| 宿主机后端进程崩溃 | systemd 自动重启 / `/api/health` 探测 | `Restart=always` 3 秒拉起；连续 10 次失败则排错后 `reset-failed` | 短暂 502 |
| PostgreSQL 挂了 | `/api/health` 返回 `db:false` | `systemctl status postgresql` 排障；从 pg_dump 备份恢复 | 接口报错，静态页仍可访问 |
| 前端静态资源异常 | nginx 200 校验 | 重新 `npm run build` 或回滚上一个 Release zip | 刷新即恢复 |
| 部署发布失败（deploy.yml） | SSH 步骤非 0 / 健康检查失败 | 健康检查失败会自动 dump 最近 50 行日志；服务器保持上一版本运行 | 无变更 |
| 镜像仓任一不可达 | mirror.yml 失败告警 | 跳过该目标，其余镜像照常；稍后手动重跑 | 无 |
| 磁盘写满（journal/上传） | 监控 | `journalctl --vacuum-size=500M`、清旧备份、核查上传目录 | 视情况 |

> **未使用云服务说明**：通用手册中的 Cloudflare（Workers/D1/R2/KV）、Oracle 免费实例、
> EdgeOne Makers、CloudBase、容器镜像仓（GHCR/ACR）等降级项对 Mim **不适用（N/A）**——
> Mim 没有这些组件，也就没有对应的故障模式；唯一外部云依赖是 GitHub（代码 + Releases +
> Pages）与自建宿主机。

---

## 十九、成本与限额（按 Mim 实况）

| 项目 | Mim 使用方式 | 费用/超额行为 |
| --- | --- | --- |
| GitHub Actions（公开仓） | 不限分钟 | 公开仓标准 runner 免费；私有仓 2000 分钟/月，本项目均为 Linux runner |
| GitHub Releases | 挂部署 zip 与安装包 | 不计入 Packages 存储配额，长期保留 |
| GitHub Pages | build.yml 部署静态展示站 | 免费 |
| GitHub Packages（npm） | 默认关闭（`ENABLE_NPM_PUBLISH`） | 500 MB 共享配额，计费型；不用不产生费用 |
| 镜像仓（Gitee/gitcode/AtomGit） | 只读副本 | 免费额度内；注意 Gitee 500 MB 仓容量墙 |
| 宿主机服务器 | systemd + nginx + PostgreSQL 原生进程 | 自管服务器费用（与本方案包无关）；无容器层资源开销 |
| 外部拨测 | UptimeRobot 免费档 | 免费 |

---

## 二十、已知取舍与后续路线（只作记录，不行动）

1. **Cloudflare Worker 网关不引入**：通用方案的地理路由/故障转移网关面向「多运行时并行」
   架构；Mim 是单台自托管服务器，nginx + systemd 已足够。若未来出现第二台境外服务器，
   可重新评估边缘网关（届时再决定 Cloudflare 或自建 nginx 上游）。
2. **Redis/worker 角色被省略**：当前无缓存与异步队列需求；若秒杀锁、导出任务等出现规模化
   需求，再以宿主机原生方式引入（systemd 单元），仍不使用容器。
3. **Docker 化是/否**：本项目硬约束为全程无容器。未来若要容器化，需整体重写 deploy/ 与
   CI 闸门（build.yml、deploy.yml、deploy-release.yml 内均有「禁止容器化产物」检查，
   会拦住任何 Dockerfile/compose 入库）——即容器化不是「加个 compose 文件」，而是一次
   显式的、评审过的路线切换，此处仅记录该选项存在。
4. **npm 发布默认关闭**：Mim 是应用而非库，dist 发 npm 包价值有限，故 deploy-release.yml
   中该 job 需显式置 `ENABLE_NPM_PUBLISH=true` 才会运行。
5. **Gitee Go 仅兜底**：国内源构建校验每天最多 1–2 次，避免消耗 Gitee Go 分钟额度；
   正式发布始终由 GitHub Actions 完成。

---

## 二十一、本次新增 / 改动文件清单

**新增 workflow：**

| 文件 | 职责 | 触发条件 |
| --- | --- | --- |
| `.github/workflows/mirror.yml` | GitHub → 国内镜像仓单向同步 | push main / 每日 04:00 UTC / 手动 |
| `.github/workflows/deploy-release.yml` | 构建打包部署 zip 并发 GitHub Release（可选 npm 发布） | tag `v*` / 手动 |

**新增参考文件：**

| 文件 | 职责 |
| --- | --- |
| `.gitee/pipeline.yml` | Gitee Go 国内构建校验流水线（需平台侧手动导入创建） |

**改动文件：**

| 文件 | 改动 |
| --- | --- |
| `scripts/init-multi-remote.sh` | 注册列表补登可选 `tencent-cnb` remote，末尾提示同步加一行；其余行为不变 |
| `deploy/README.md` | 重写为本文（保留原有安装/运维内容，补对照表、CI/CD、降级矩阵等章节） |

**未触碰**：`src/`、`server/` 业务代码、`docs/` 目录、既有四个 workflow 的内容。

---

## 二十二、3.txt 交付清单对照表（13 个文件逐项落地）

3.txt 要求把通用架构手册落成具体仓库文件，共 13 个交付文件。Mim 按「全程无 Docker、
GitHub 唯一可写源」主路线逐项落地如下：

| # | 3.txt 交付文件 | Mim 落地位置 | 决策 |
| --- | --- | --- | --- |
| 1 | `.env.example`（密钥矩阵模板） | 根 `.env.example` + `server/.env.example` | 补齐：根模板新增可选边缘层变量段（CLOUDFLARE_API_TOKEN/ACCOUNT_ID、EO_TOKEN、AI_GATEWAY_API_KEY/BASE_URL、SYNC_TOKEN），均标注「可选边缘层用」；server 模板补 PG_POOL_MAX/MAX_BODY_BYTES |
| 2 | `build-publish.yml`（镜像构建+GHCR/ACR+npm） | `.github/workflows/deploy-release.yml` | 改写落地：tag 触发构建 zip + GitHub Release；GHCR/ACR 容器镜像步骤**剔除（无 Docker 约束）**；npm 发布为默认关闭的可选 job（复用 scripts/prepare-package.mjs） |
| 3 | `cleanup-images.sh`（GHCR/ACR 镜像清理） | `scripts/cleanup-images.sh` | 无 Docker 适配：改为 GitHub Releases/旧 tag 过期清理（gh api，保留最近 N 个，DRY_RUN）；GHCR/ACR 容器清理函数保留为标注 **N/A 的参考实现**，不默认执行 |
| 4 | `deploy.yml`（三运行时 CI 编排） | `.github/workflows/deploy.yml`（既有） | 已落地：质量闸门 + SSH 发布到宿主机（无容器）；Cloudflare/Makers 分发分支对自托管路线 **N/A** |
| 5 | `docker-compose.yml` | — | **决策剔除**：项目禁用容器；等价物为第一节 systemd 原生进程架构（nginx↔nginx-mim.conf、api↔mim-server.service、db↔宿主机 PostgreSQL，worker/redis 省略并注明原因） |
| 6 | `index.ts`（Workers 网关升级版，含 Makers 路由） | `worker/src/index.ts`（新建） | 新建**可选边缘层**：健康探测 + 故障转移 + Cron 拉取主站 `/api/sync/posts` 写 D1；主路线仍是自托管 systemd+nginx，不强制启用。**不参与主构建**（主 tsconfig include 仅 `src/`）；本地校验：`cd worker && npm install && npx tsc --noEmit` |
| 7 | `init-multi-remote.sh` | `scripts/init-multi-remote.sh`（既有） | 已落地并补 tencent-cnb remote；日常推送由 mirror.yml 承担 |
| 8 | `mirror.yml`（GitHub→国内镜像仓） | `.github/workflows/mirror.yml`（既有） | 已落地：gitee/gitcode(Codeup)/atomgit + 可选 CNB，Token 缺失自动跳过 |
| 9 | `nginx/default.conf`（SPA + API 代理 + 安全头） | `deploy/nginx-mim.conf`（等价物，不新建） | 核对通过：`try_files ... /index.html` SPA 回退、`/api/` 反代保留前缀、CSP/X-Content-Type-Options/X-Frame-Options/Referrer-Policy 安全头齐备，与现状兼容 |
| 10 | `pipeline.yml`（Gitee Go） | `.gitee/pipeline.yml`（既有） | 已落地：国内 npmmirror 源构建校验，不做部署；需 Gitee 平台侧手动导入 |
| 11 | `README.md`（交付文件说明） | 本文件 `deploy/README.md` | 已重写为本手册 |
| 12 | `sync.ts`（主库只读同步接口） | `server/src/sync.js`（既有） | 已落地：`GET /api/sync/posts`，x-sync-token 鉴权，留空即关闭 |
| 13 | `wrangler.jsonc` + D1 迁移 SQL + `bootstrap.sh` + 备份脚本（手册另列要求） | `worker/wrangler.jsonc`、`worker/migrations/0001_init.sql`、`deploy/bootstrap.sh`、`scripts/backup.sh` | 新建：wrangler 参考配置（占位标注「创建后回填」）、D1 只读副本表、无 Docker 一键重建脚本（委托 install.sh）、pg_dump 本地轮转 + 可选 rclone 异地 |

**无 Docker 适配说明**：3.txt 的容器相关产物（docker-compose、GHCR/ACR 双推、镜像清理）
在 Mim 全部剔除或改写——制品分发走 GitHub Releases zip + npm（可选），进程守护走
systemd，数据库是宿主机原生 PostgreSQL。worker/ 与 D1 副本属于**可选边缘层**，
不启用时对主路线零影响。
