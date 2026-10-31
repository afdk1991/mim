# 全栈全站项目部署上线 — 交付文件包

## 目录结构

```
全栈部署交付文件/
├── .github/workflows/
│   ├── deploy.yml              # 统一 CI/CD 编排（测试 → 三运行时分发）
│   ├── build-publish.yml       # 构建镜像 + 推 GHCR/ACR + 发布 npm 包
│   └── mirror.yml              # GitHub → 国内镜像仓单向同步
├── .workflow/
│   └── pipeline.yml            # Gitee Go 流水线（国内构建校验兜底）
├── scripts/
│   ├── cleanup-images.sh       # GHCR + ACR 镜像清理脚本
│   └── init-multi-remote.sh    # 多 remote 初始化脚本
├── worker/src/
│   └── index.ts                # Workers 网关升级版（含 Makers 路由）
├── server/src/
│   └── sync.ts                 # OCI 主力层只读同步接口
├── nginx/
│   └── default.conf            # Nginx 配置
├── docker-compose.yml          # OCI 主力层服务编排
├── .env.example                # 环境变量模板
└── README.md                   # 本文件
```

## 快速开始

### 1. 初始化本地环境

```bash
# 复制环境变量模板
cp .env.example .env
# 编辑 .env 填入实际值

# 初始化多平台 Git remote
./scripts/init-multi-remote.sh git@github.com:your-org/app-core.git
```

### 2. 部署到各平台

```bash
# 推送代码到 GitHub（触发 GitHub Actions）
git add .
git commit -m "初始化部署配置 [deploy]"
git push origin main
```

### 3. 本地联调

```bash
# Cloudflare Workers 本地模拟
cd worker && wrangler dev

# OCI 本地 Docker Compose
docker compose up -d
```

## 平台部署说明

| 平台 | 部署方式 | 触发条件 |
|------|----------|----------|
| Cloudflare Workers | wrangler deploy | 每次 push main |
| Cloudflare Pages | wrangler pages deploy | 每次 push main |
| Oracle Cloud | SSH + docker compose | 每次 push main |
| EdgeOne Makers | edgeone-cli deploy | push main 或含 [makers] 标记 |
| 国内平台(Gitee) | Gitee Go 流水线 | push main 或含 [deploy-cn] 标记 |

## 安全注意事项

1. 所有密钥文件（.env、SSH Key）**严禁提交到 Git**
2. GitHub Secrets 按最小权限原则配置
3. 镜像仓 Token 不给删除权限
4. 生产数据库凭证只存在于 OCI，边缘侧只有只读副本凭证
5. 定期运行 cleanup-images.sh 清理过期镜像释放配额

## 运维脚本

```bash
# 清理过期容器镜像（每月执行）
./scripts/cleanup-images.sh your-org/app-core/api 10

# 初始化多平台镜像
./scripts/init-multi-remote.sh git@github.com:your-org/app-core.git
```
