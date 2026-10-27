# 自托管 BaaS · 常用操作入口
# 说明：Makefile 只是 scripts/ 下脚本的便捷封装；没有 make 的机器直接跑对应脚本即可。
SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help

help: ## 列出全部目标
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ------------------------------ 初始化 ------------------------------
env: ## 由 .env.example 生成 .env（已存在则跳过）
	@test -f .env || cp .env.example .env
	@echo "已就绪：.env  —— 请先修改其中标了【必改】的项"

keys: ## 生成 anon / service_role 两个 JWT 并自验签
	@node scripts/gen-jwt.mjs --self-test

pull: ## 拉取镜像（首次或改过镜像 tag 后执行）
	$(COMPOSE) pull

# ------------------------------ 生命周期 ------------------------------
up: env ## 拉起全栈（可选 --profile s3 / studio）
	$(COMPOSE) up -d

down: ## 停止
	$(COMPOSE) down

restart: ## 重启
	$(COMPOSE) restart

logs: ## 跟随日志
	$(COMPOSE) logs -f

ps: ## 查看容器状态
	$(COMPOSE) ps

# ------------------------------ 数据库 ------------------------------
migrate: ## 应用 db/migrations 下未执行过的迁移（幂等）
	bash scripts/migrate.sh

reload: ## 通知 PostgREST 刷新 schema cache（迁移后必须执行）
	bash scripts/reload-postgrest.sh

new-migration: ## 新建迁移：make new-migration name=xxx
	bash scripts/new-migration.sh $(name)

psql: ## 进入 psql
	bash scripts/db-psql.sh

# ------------------------------ Storage ------------------------------
storage-init: ## 初始化默认 bucket（幂等）
	bash scripts/init-storage.sh

# ------------------------------ 验收 ------------------------------
sqlcheck: ## SQL 静态体检（不依赖 Docker）
	node scripts/check-sql.mjs

fn-check: ## Edge Functions 类型检查
	npx tsc -p functions/tsconfig.json --noEmit

verify: ## 全部可离线执行的检查
	node scripts/verify.mjs

health: ## 运行时健康探测（需栈已启动，可用 url=... 覆盖）
	node scripts/healthcheck.mjs $(if $(url),--url $(url),)

# ------------------------------ 备份 ------------------------------
backup: ## 逻辑备份到 backups/
	@mkdir -p backups
	bash scripts/db-psql.sh -c "select 1" >/dev/null 2>&1 || (echo "数据库不可达"; exit 1)
	docker compose exec -T db pg_dump -U postgres -d $${POSTGRES_DB:-postgres} \
	  | gzip > backups/baas-$$(date +%Y%m%d-%H%M%S).sql.gz
	@echo "已生成 backups/ 下的备份"
