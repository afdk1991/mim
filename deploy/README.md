# Mim 部署与运维手册（宿主机直部署，不使用 Docker）

> 本项目**完全不使用容器**。后端是宿主机上的一个普通 Node 进程，数据库是宿主机上安装的
> PostgreSQL，静态资源由 nginx 直出。守护、自启、崩溃重启全部交给 systemd。

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

---

## 二、前置条件

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

## 三、一键部署

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

## 四、手动分步部署（不想跑一键脚本时）

```bash
# 1) 源码就位
sudo mkdir -p /opt/mim && sudo rsync -a --exclude node_modules --exclude dist --exclude .git ./ /opt/mim/

# 2) 后端依赖（pg 是唯一外部依赖）
cd /opt/mim && npm install --no-audit --no-fund
npm --prefix server install --omit=dev --no-audit --no-fund

# 3) 前端构建。同一域名下由 nginx 反代 /api，构建期不需要填后端地址
VITE_MIM_API_BASE= npm run build        # 留空 → 前端回退同源 /api

# 4) 数据库：创建账号与库
sudo -u postgres ./deploy/init-db.sh    # 会提示需要 PGPASSWORD，见下节配置

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

## 五、配置

配置通过 **环境变量 / 配置文件** 管理：`/opt/mim/server/.env`，由 systemd 单元里的
`EnvironmentFile=` 注入。服务端只读 `process.env`，自身不解析 `.env` 文件。

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

前端构建期只有一个变量：

| 变量 | 说明 |
| --- | --- |
| `VITE_MIM_API_BASE` | 留空 → 同源 `/api`（**推荐**，配 nginx 反代即可）；填 `off` → 纯本地模式，一个后端请求都不发；填 `https://api.xxx` → 跨域直连 |

改完 `.env` 后执行 `sudo systemctl restart mim-server` 生效。

---

## 六、进程守护

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

## 七、静态资源

- 产物目录：`/opt/mim/dist`，由 `npm run build` 生成，nginx `root` 直指向它
- `vite.config.ts` 里 `base: './'` 全部使用相对路径，因此**部署到子路径也不需要额外配置**
- `/assets/` 下是带 content-hash 的产物 → 配 `expires 1y` + `immutable`
- `index.html` 配 `no-cache`，否则发版后用户刷新也拿不到新页面
- 前端是自研 hash 路由（`#/xxx`），服务端永远只收到 `/`，但仍保留 `try_files` 兜底；
  `public/` 下的独立页面（如 `privacy.html`）会被原样拷进 dist，可直接 `/privacy.html` 访问
- 更新流程：`cd /opt/mim && npm run build`（nginx 不需要 reload，静态文件即时生效）

---

## 八、反向代理

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
  后端已全开 CORS（`Access-Control-Allow-Origin: *`）并允许 `Authorization` 头，无需额外配置
- 想让 TLS 卸载后后端拿到正确协议，已配 `X-Forwarded-Proto`；后端不读该头，仅便于 nginx 侧排障

---

## 九、日志

分两层：

| 层 | 位置 | 查看方式 |
| --- | --- | --- |
| 后端 | journald（`StandardOutput=journal`） | `sudo journalctl -u mim-server -f` |
| nginx | `/var/log/nginx/mim.{access,error}.log` | `sudo tail -f /var/log/nginx/mim.access.log` |

常用操作：

```bash
sudo journalctl -u mim-server -n 200 --no-pager        # 最近 200 行
sudo journalctl -u mim-server --since "10 min ago"     # 最近 10 分钟
sudo journalctl -u mim-server -p err -b                # 本次开机以来的错误
sudo journalctl --vacuum-size=500M                     # 限制 journal 体积
```

nginx 日志由 `/etc/logrotate.d/mim` 每天轮转、保留 14 天、压缩归档，轮转后给 nginx 发
`USR1` 让它重开日志文件（不断连接）。干跑验证：`sudo logrotate -d /etc/logrotate.d/mim`。

后端每条请求都会打一行 `GET /api/rest/posts → 200 3ms`，500 会额外打印原始错误（只进日志，
不下发给前端）。

---

## 十、更新发版

```bash
cd /opt/mim
git pull                                  # 或重新 rsync 源码
npm install --no-audit --no-fund          # 前端依赖有变化时
npm run build                             # 静态资源即时生效，nginx 不用 reload
npm --prefix server install --omit=dev    # 后端依赖有变化时
cd server && npm run migrate              # 迁移幂等，随时可补跑
sudo systemctl restart mim-server
curl -fsS http://127.0.0.1:8787/api/health
```

数据库迁移是幂等的（`server/db/migrations/*.sql` 全部 `create table if not exists` 风格），
重复执行安全。

---

## 十一、备份与回滚

```bash
# 备份（逻辑导出，不含容器概念，就是普通 pg_dump）
sudo -u postgres pg_dump mim | gzip > /var/backups/mim-$(date +%F).sql.gz

# 恢复
sudo -u postgres psql -c 'DROP DATABASE IF EXISTS mim;'
sudo -u postgres createdb --owner=mim mim
zcat /var/backups/mim-2026-10-28.sql.gz | sudo -u postgres psql mim

# 上传的文件也要一起备份
tar czf /var/backups/mim-uploads-$(date +%F).tar.gz /opt/mim/server/data/uploads
```

代码回滚：`git checkout <上一个 tag>` 后重新执行第十节的更新步骤；迁移只增不改，
回滚代码通常不需要回滚数据库结构。

---

## 十二、故障排查

| 现象 | 原因与处理 |
| --- | --- |
| `systemctl status` 显示 failed | `journalctl -u mim-server -n 100` 看栈顶；最常见是 `DATABASE_URL` 连不上 |
| `/api/health` 返回 `{"ok":true,"db":false,...}` | 进程活着但连不上库。检查连接串、PostgreSQL 是否在跑（`systemctl status postgresql`）、`pg_hba.conf` 是否允许该账号 |
| 接口全部 404（`未知接口，请带 /api 前缀`） | nginx 的 `proxy_pass` 末尾多了斜杠，把 `/api` 前缀剥掉了 |
| 上传报体积超限 | `UPLOAD_MAX_BYTES`、`client_max_body_size`、前端 `LIMITS.uploadMaxBytes` 三者要一致 |
| 改了迁移后仍报未知列 | 重启后端刷新列名缓存：`sudo systemctl restart mim-server` |
| 前端一直读旧数据 | `index.html` 被缓存了，检查是否漏了 `no-cache`；或 `VITE_MIM_API_BASE` 指向了别的后端 |
| 502 Bad Gateway | 后端没起来或 `PORT` 与 nginx 的 `proxy_pass` 不一致 |
| 重启后没有自动拉起 | 忘了 `systemctl enable mim-server`（注意：`start` 不等于 `enable`） |
| 一直重启失败到被 systemd 停手 | `StartLimitBurst` 触发，排完错执行 `systemctl reset-failed mim-server && systemctl start mim-server` |
