# Mim API 生产镜像（构造产物同时用于 GitHub Packages / ghcr、Render、Sealos、veFaaS 等容器平台）
#
# 说明：pnpm 9.12 的 `pnpm deploy` 在 Windows / 9.12 上实测报错（Unknown option: 'legacy' 且目标路径拼接异常），
# 因此运行阶段采用「原样搬运 pnpm 相对符号链接依赖树」的方式：builder 与 runtime 的 WORKDIR 均为 /app，
# node_modules 的相对 symlink 结构在搬运后仍然成立，无需二次安装。

# ---------- builder ----------
FROM node:22-bookworm AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# 依赖清单先行，最大化层缓存命中（覆盖 pnpm-workspace.yaml 的全部 4 个成员）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY services/mim-api/package.json ./services/mim-api/
COPY packages/core-domain/package.json ./packages/core-domain/
COPY packages/i18n/package.json ./packages/i18n/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @mim/api build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app

# config.ts: SRC_DIR=/app/services/mim-api/dist → REPO_ROOT=/app、DATA_DIR=/app/services/mim-api/data
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/services/mim-api/node_modules ./services/mim-api/node_modules
COPY --from=builder /app/services/mim-api/dist ./services/mim-api/dist
COPY --from=builder /app/services/mim-api/package.json ./services/mim-api/package.json
RUN mkdir -p /app/services/mim-api/data

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/services/mim-api/dist/index.js"]
