# Mim 部署指南

> **本项目不使用容器。** 后端是宿主机上的一个普通 Node 进程，数据库是宿主机安装的 PostgreSQL，
> 静态资源由 nginx 直出，守护与自启交给 systemd。全程没有镜像、没有编排文件、没有卷。

部署对象只有两个：

1. **前端**：一份纯静态产物（`dist/`），nginx `root` 直出；
2. **后端**：宿主机上的 `node src/main.js` + 宿主机 PostgreSQL + nginx 反代 + systemd 守护。

前端是 hash 路由、构建 `base` 为相对路径 `./`，**不需要服务端 history fallback**，
因此可以放在任意目录、任意静态托管，甚至 CDN 任意层级。

> **未配置后端时前端仍然完全可用**：数据落 localStorage，云端写回自动 `skip`（不算错误）。
> 所以「先上前端、后上后端」是完全可行的上线顺序。
>
> **完整 step by step（装依赖、建库、迁 systemd、HTTPS、备份、排错）请直接看
> [`deploy/README.md`](deploy/README.md)** —— 那是部署与运维的唯一权威手册。
> 本文件只讲形态、端口与几个部署入口，不重复手册里的命令细节。

---

## 一、部署形态

```
                     ┌──────────────────────────────────────┐
   浏览器/App  ─────▶│ nginx :80                            │
                     │   /           → /opt/mim/dist        │
                     │   /assets/    → 长缓存（immutable）   │
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
                     │ PostgreSQL :5432（宿主机系统服务）     │
                     └──────────────────────────────────────┘
```

### 端口表

| 端口 | 组件 | 监听地址 | 是否对外 | 说明 |
| --- | --- | --- | --- | --- |
| `80` / `443` | nginx | `0.0.0.0` | ✅ 对外 | 静态资源 + `/api` 反代；HTTPS 在宿主机用 `certbot --nginx` 签发 |
| `8787` | mim-server（Node） | `127.0.0.1` | ❌ 仅回环 | 后端默认端口，由环境变量 `PORT` 控制；不经 nginx 不暴露给公网 |
| `5432` | PostgreSQL | `127.0.0.1` | ❌ 仅回环 | 宿主机系统服务，`systemctl status postgresql` 查看 |
| `5173` | vite dev | `127.0.0.1` | ❌ 仅开发 | 只有本地开发时出现，生产不存在 |

唯一有状态的东西是 **PostgreSQL 数据目录** 与 **`/opt/mim/server/data/uploads`**，备份策略围绕这两处做。

---

## 二、三个部署入口

三个入口都从仓库根目录出发，最终形态完全一致（`/opt/mim` + systemd + nginx）。

### 入口 1：一键脚本（推荐新机器）

```bash
git clone https://github.com/afdk1991/mim.git
cd mim
sudo MIM_DIR=/opt/mim DOMAIN=example.com ./deploy/install.sh
```

脚本**幂等**（重复执行不删库、不覆盖已存在的 `.env`），会依次完成：装系统依赖 → 同步源码到
`/opt/mim` → 建 `mim` 运行账号 → 生成 `.env`（随机 `JWT_SECRET` 与数据库口令）→ 建库建账号
→ `npm install` + 前端构建 → 应用迁移 → 装 systemd/nginx/logrotate → 启动并做健康检查。

只动了后端代码、前端没变时加 `SKIP_BUILD=1` 跳过前端构建；系统依赖已装好时加 `SKIP_PKGS=1`。

### 入口 2：手动分步（不想跑脚本时）

```bash
# 1) 源码就位
sudo rsync -a --exclude node_modules --exclude dist --exclude .git ./ /opt/mim/

# 2) 依赖：后端唯一外部依赖是 pg
cd /opt/mim && npm install --omit=dev
npm --prefix server install --omit=dev

# 3) 前端构建。同源部署时留空，前端自动回退同源 /api
VITE_MIM_API_BASE= npm run build

# 4) 数据库：宿主机 PostgreSQL 里建账号与库（幂等）
PGPASSWORD='强口令' ./deploy/init-db.sh

# 5) 配置
sudo cp server/.env.example /opt/mim/server/.env && sudo chmod 600 /opt/mim/server/.env
sudo vi /opt/mim/server/.env        # 至少改 JWT_SECRET 与 DATABASE_URL

# 6) 迁移（幂等，随时可补跑）
npm run server:migrate

# 7) 守护：enable 才是开机自启，--now 才是立即启动
sudo cp deploy/mim-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mim-server

# 8) 静态资源与反向代理
sudo cp deploy/nginx-mim.conf /etc/nginx/sites-available/mim
sudo ln -sf /etc/nginx/sites-available/mim /etc/nginx/sites-enabled/mim
sudo nginx -t && sudo systemctl enable --now nginx

# 9) 验证
npm run server:health
curl -fsS http://localhost/api/health     # 走 nginx
```

### 入口 3：只更新后端（前端没动）

```bash
cd /opt/mim
git pull
npm --prefix server install --omit=dev    # 后端依赖有变化时
npm run server:migrate                    # 迁移幂等
sudo systemctl restart mim-server         # 注意：start 不等于 enable，自启要单独 enable
sudo journalctl -u mim-server -n 50 --no-pager
```

只更新前端则不需要动后端，也不用 reload nginx：

```bash
cd /opt/mim && npm run build
```

---

## 三、前端：静态托管（可选）

### GitHub Pages 自动部署

流水线已配好：[`.github/workflows/build.yml`](.github/workflows/build.yml)。

| 作业 | 触发条件 | 步骤 |
| --- | --- | --- |
| `verify`（类型检查与构建） | push / PR 到 `main`、`workflow_dispatch` | `npm install` → `npm run typecheck` → `npm run build`（注入 `VITE_MIM_API_BASE`）→ 上传 `dist` 为 Pages 产物 |
| `deploy-pages` | 仅 `refs/heads/main`，`needs: verify` | `actions/deploy-pages@v4` |

需要配两件事：

1. **Pages 来源**：仓库 **Settings → Pages → Source** 选 **GitHub Actions**（只需配一次）。
2. **后端地址变量**：**Settings → Secrets and variables → Actions → Variables → New repository variable**
   - Name：`MIM_API_BASE`
   - Value：后端公网地址，例如 `https://api.example.com`
   - 不填也可以：变量为空时 `VITE_MIM_API_BASE` 为空，前端回退同源 `/api`。

> 这是**仓库级 Variables**（不是 Secrets），只是公开地址。改完需要重新跑一次流水线才生效 ——
> `VITE_MIM_API_BASE` 是构建期内联进产物的。

### 任意静态托管

`vite.config.ts` 里 `base: './'`、路由是自研 hash 路由（`src/app/router.tsx`），产物对路径不敏感。

```bash
npm install
VITE_MIM_API_BASE= npm run build          # 留空 → 同源 /api
```

产物目录 `dist/`：

```
dist/
├─ index.html
├─ assets/          JS / CSS（相对路径引用）
├─ favicon.svg
├─ 404.html
└─ privacy.html
```

| 托管形态 | 注意点 |
| --- | --- |
| 对象存储（静态网站托管） | 直接上传 `dist/` 全部内容；**不要**开启「强制下载」的 Content-Type 规则 |
| Nginx | `root /opt/mim/dist;` + `try_files $uri $uri/ /index.html;`（hash 路由其实不需要 fallback，配上更稳） |
| 子目录部署 | 无需任何额外配置（相对 `base`），例如 `https://example.com/mim/` |
| 原生壳（Capacitor / Tauri / Harmony） | 同样用 `dist/`；`capacitor.config.ts` 的 `webDir` 已是 `dist` |

**反向代理要求**：前端与后端不同源时，`/api`、`/auth`、`/storage` 三个前缀都要代理到后端，
**前缀不能 rewrite 掉** —— 前端 `src/data/client.ts` 拼的就是 `/rest/...`、`/auth/...`、`/storage/upload`，
与 `API_BASE` 组合使用。

---

## 四、静态资源与反向代理要点

### 静态资源

- 产物目录 `/opt/mim/dist`，nginx `root` 直接指向它
- `/assets/` 下是带 content-hash 的产物 → 配 `expires 1y` + `immutable`
- `index.html` 配 `no-cache`，否则发版后用户刷新也拿不到新页面
- 前端自研 hash 路由（`#/xxx`），服务端永远只收到 `/`，`try_files` 只是兜底
- `public/` 下的独立页面（如 `privacy.html`）会被原样拷进 dist，可直接 `/privacy.html` 访问

### 反向代理：**`proxy_pass` 末尾不能带 URI**

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;      # ✅ 保留 /api 前缀
    # proxy_pass http://127.0.0.1:8787/;   # ❌ 会被重写成 /xxx，后端全部 404
}
```

后端 `server/src/main.js` 要求所有接口带 `/api` 前缀（不带直接返回 404），所以这个斜杠是致命的 ——
现象是接口全部返回 `未知接口，请带 /api 前缀`。

其他注意项：

- `client_max_body_size 3m` 必须与后端 `UPLOAD_MAX_BYTES`、前端 `LIMITS.uploadMaxBytes` 三者一致
- HTTPS 直接在宿主机 `certbot --nginx` 签发，后端代码一行都不用改
- 跨域部署时把 `VITE_MIM_API_BASE` 指到后端公网地址即可，后端已全开 CORS
  （`Access-Control-Allow-Origin: *` + `Authorization` 头 + OPTIONS 预检）
- 改了 `.env` 里的 `PORT` 必须同步改 nginx 的 `proxy_pass`，否则 502

完整配置见 [`deploy/nginx-mim.conf`](deploy/nginx-mim.conf)。

---

## 五、日志

| 层 | 位置 | 查看方式 |
| --- | --- | --- |
| 后端 | journald（`StandardOutput=journal`） | `sudo journalctl -u mim-server -f` |
| nginx | `/var/log/nginx/mim.{access,error}.log` | `sudo tail -f /var/log/nginx/mim.access.log` |

```bash
sudo journalctl -u mim-server -n 200 --no-pager      # 最近 200 行
sudo journalctl -u mim-server --since "10 min ago"   # 最近 10 分钟
sudo journalctl -u mim-server -p err -b              # 本次开机以来的错误
sudo journalctl --vacuum-size=500M                   # 限制 journal 体积
```

nginx 日志由 `/etc/logrotate.d/mim` 每天轮转、保留 14 天、压缩归档，轮转后给 nginx 发 `USR1`
让它重开日志文件（不断连接）。干跑验证：`sudo logrotate -d /etc/logrotate.d/mim`。

后端每条请求都会打一行 `GET /api/rest/posts → 200 3ms`，500 会额外打印原始错误（只进日志，不下发给前端）。

---

## 六、部署后自检清单

- [ ] 前端能打开，`#/feed` 正常渲染，切换深浅色无不可读文本。
- [ ] `curl http://127.0.0.1:8787/api/health` 返回 `{"data":{"ok":true,"db":true,...}}`。
- [ ] 走 nginx 也通：`curl http://localhost/api/health`。
- [ ] `systemctl is-enabled mim-server` 输出 `enabled`（开机自启已配），`is-active` 输出 `active`。
- [ ] 注册 / 登录可用（`/api/auth/register`、`/api/auth/login`）。
- [ ] 首个管理员已建（`#/admin` 可进，`#/admin/roles` 可看）。
- [ ] 上传可用且返回可访问 `url`（检查 `PUBLIC_API_BASE`）。
- [ ] 若跨源：浏览器控制台无 CORS 报错。
- [ ] 生产环境的 `JWT_SECRET` 与数据库口令已替换掉默认值。
