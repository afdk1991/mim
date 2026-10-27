# Mim 部署指南

重建后的部署对象只有两个：

1. **前端**：一份纯静态产物（`dist/`），可丢到任意静态托管；
2. **后端**：`server/` 一个 Docker Compose 栈（Postgres 16 + Node API）。

前端是 hash 路由、构建 `base` 为相对路径 `./`，**不需要服务端 history fallback**，因此可以放在 GitHub Pages 子路径、对象存储子目录、甚至 CDN 任意层级。

---

## 一、部署拓扑

```
                       ┌──────────────────────────────────────────────┐
   浏览器 ─── HTTPS ──▶│ 静态托管（GitHub Pages / 对象存储 / Nginx）    │
                       │  dist/index.html + assets/*                  │
                       │  路由：#/feed、#/mall、#/admin …（hash）      │
                       └──────────────────┬───────────────────────────┘
                                          │ 同源 /api 或 VITE_MIM_API_BASE
                                          ▼
                       ┌──────────────────────────────────────────────┐
                       │  反向代理（Nginx / 网关 / CDN）               │
                       │  /api/*  /auth/*  /storage/*  →  后端        │
                       │  ⚠ 前缀必须保留，不能 rewrite 掉              │
                       └──────────────────┬───────────────────────────┘
                                          ▼
                       ┌──────────────────────────────────────────────┐
                       │  server/（Docker Compose）                    │
                       │   mim-api  :8787  Node 20 + node:http        │
                       │   mim-db   :5432  postgres:16-alpine         │
                       │   migrate  一次性任务（run --rm）             │
                       │   卷：pgdata（数据）/ uploads（对象存储）      │
                       └──────────────────────────────────────────────┘
```

> **未配置后端时前端仍然完全可用**：数据落 localStorage，云端写回自动 `skip`（不算错误）。所以「先上前端、后上后端」是完全可行的上线顺序。

---

## 二、前端：GitHub Pages 自动部署

流水线已配好：[`.github/workflows/build.yml`](.github/workflows/build.yml)。

### 工作流结构

| 作业 | 触发条件 | 步骤 |
| --- | --- | --- |
| `verify`（类型检查与构建） | push / PR 到 `main`、`workflow_dispatch` | `npm ci` → `npm run typecheck` → `npm run build`（注入 `VITE_MIM_API_BASE`）→ 上传 `dist` 为 Pages 产物 |
| `deploy-pages`（部署到 GitHub Pages） | 仅 `refs/heads/main`，`needs: verify` | `actions/deploy-pages@v4` |

### 需要配置的东西

1. **Pages 来源**：仓库 **Settings → Pages → Source** 选 **GitHub Actions**（只需配一次）。
2. **后端地址变量**：仓库 **Settings → Secrets and variables → Actions → Variables → New repository variable**
   - Name：`MIM_API_BASE`
   - Value：后端公网地址，例如 `https://api.example.com`
   - 不填也可以：工作流里 `VITE_MIM_API_BASE: ${{ vars.MIM_API_BASE }}` 为空时，前端回退同源 `/api`。

> 变量是**仓库级 Variables**（不是 Secrets）：它只是公开地址，不含密钥。改完需要重新跑一次流水线（push 或 `workflow_dispatch`）才会生效 —— 因为 `VITE_MIM_API_BASE` 是构建期内联的。

### 触发方式

```bash
git push origin main          # 自动触发
```

或在 GitHub 上 **Actions → build → Run workflow**（`workflow_dispatch`）。

---

## 三、前端：任意静态托管

因为 `vite.config.ts` 里 `base: './'`、路由是自研 hash 路由（`src/app/router.tsx`），构建产物对路径不敏感。

```bash
npm ci
VITE_MIM_API_BASE=https://api.example.com npm run build   # 留空则回退同源 /api
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

把它整个丢到任意静态服务器 / 对象存储即可：

| 托管形态 | 注意点 |
| --- | --- |
| 对象存储（静态网站托管） | 直接上传 `dist/` 全部内容；**不要**开启「强制下载」的 Content-Type 规则 |
| Nginx | `root /var/www/mim;` + `try_files $uri $uri/ /index.html;`（hash 路由其实不需要 fallback，配上更稳） |
| 子目录部署 | 无需任何额外配置（相对 `base`），例如 `https://example.com/mim/` |
| 原生壳（Capacitor / Tauri / Harmony） | 同样用 `dist/`；`capacitor.config.ts` 的 `webDir` 已是 `dist` |

**反向代理要求**：若前端与后端不同源，务必把 `/api`、`/auth`、`/storage` 三个前缀都代理到后端，**前缀不能 rewrite 掉** —— 前端 `src/data/client.ts` 拼的就是 `/rest/...`、`/auth/...`、`/storage/upload`，配合 `API_BASE` 使用。

---

## 四、后端：Docker Compose 部署

### 1) 准备环境变量

```bash
cd server
cp .env.example .env
```

`docker compose` 会自动读取 `server/.env` 做变量插值。`server/.env.example` 里已有、部署前**必须修改**的项：

| 变量 | 说明 |
| --- | --- |
| `JWT_SECRET` | **必须改**：`openssl rand -hex 32` 生成 |
| `DATABASE_URL` | 容器内由 compose 自动拼装；**宿主直连**（跑 `npm run server:migrate`）时才需要手动设为 `127.0.0.1` 版本 |
| `BOOTSTRAP_ADMIN_USERNAME` | 全新库时填首个管理员用户名；已有管理员后失效 |
| `PUBLIC_API_BASE` | 有网关 / CDN 时填公网地址，决定 `/api/storage/<key>` 返回的 `url` 是否为绝对地址 |

`docker-compose.yml` 另外支持用这些变量覆盖默认值（均有默认值，未列在 `.env.example` 里）：

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `PGUSER` | `postgres` | 数据库用户 |
| `PGPASSWORD` | `postgres` | 数据库密码 |
| `PGDATABASE` | `mim` | 库名 |
| `PGPORT` | `5432` | 宿主映射端口 |
| `PORT` | `8787` | API 宿主映射端口 |
| `JWT_SECRET` | `change-me-in-production` | 令牌签名密钥 |
| `BOOTSTRAP_ADMIN_USERNAME` | 空 | 首个管理员 |

### 2) 构建并启动

```bash
cd server
docker compose up -d db                  # 只起库，等 healthy
docker compose run --rm migrate          # 应用迁移（一次性任务，幂等）
docker compose up -d --build api         # 再起服务
```

> `migrate` 是 `restart: 'no'` 的一次性任务。虽然 `docker compose up -d` 也会把它带起来，但 `api` 只等 `db` healthy、不等 `migrate` 完成，顺序不可控 —— 生产环境请按上面的顺序显式执行。

### 3) 验证

```bash
curl http://127.0.0.1:8787/api/health
# {"data":{"ok":true,"db":true,"service":"mim-server","uptime_ms":…,"rpcs":16}}

# 或在仓库根目录
npm run server:health
```

### 4) 生产反向代理示例（Nginx）

```nginx
# 前端
server {
    listen 443 ssl;
    server_name example.com;
    root /var/www/mim;          # dist/ 内容
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端：三个前缀都要保留
    # 注意 proxy_pass 末尾不要带 URI（不要写 http://127.0.0.1:8787/），
    # 否则 nginx 会把 /api/ 前缀剥掉再转发，后端收到的是 /rest/... 而不是 /api/rest/...
    location /api/     { proxy_pass http://127.0.0.1:8787; proxy_set_header Host $host; }
    location /auth/    { proxy_pass http://127.0.0.1:8787; proxy_set_header Host $host; }
    location /storage/ { proxy_pass http://127.0.0.1:8787; proxy_set_header Host $host; }
}
```

若前端与后端不同域，后端已全开 CORS（`Access-Control-Allow-Origin: *` + `Authorization` 头 + OPTIONS 预检），跨域可直接打通。

### 5) 更新与回滚

```bash
cd server
docker compose up -d --build api   # 重新构建并重启 API
docker compose run --rm migrate    # 迁移幂等，随时可补跑
docker compose logs -f api         # 看日志
docker compose down                # 停止（数据卷保留）
```

数据库迁移是幂等的，重复执行安全；`pgdata` 与 `uploads` 两个卷是**唯一有状态的东西**，备份策略围绕它们做。

---

## 五、部署后自检清单

- [ ] 前端能打开，`#/feed` 正常渲染，切换深浅色无不可读文本。
- [ ] 后端 `GET /api/health` 返回 `{"data":{"ok":true,"db":true,...}}`。
- [ ] 注册 / 登录可用（`/api/auth/register`、`/api/auth/login`）。
- [ ] 首个管理员已建（`#/admin` 可进，`#/admin/roles` 可看）。
- [ ] 上传可用且返回可访问 `url`（检查 `PUBLIC_API_BASE`）。
- [ ] 若跨源：浏览器控制台无 CORS 报错。
- [ ] 生产环境的 `JWT_SECRET` 与数据库密码已替换掉默认值。
