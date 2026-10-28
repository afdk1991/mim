#!/usr/bin/env bash
# ==============================================================================
# Mim —— GitHub Releases / Artifacts 过期制品清理
#
# 用法：
#   DRY_RUN=1 ./scripts/cleanup-images.sh afdk1991/mim 10    # 只看不动
#   ./scripts/cleanup-images.sh afdk1991/mim 10             # 保留最近 10 个 Release
#
# 前置：gh cli 已登录（gh auth login），GITHUB_TOKEN 可用时优先用环境变量。
# 建议：本地手动跑，或挂 crontab 每月一次。
#
# 【容器镜像清理 = N/A】本项目全程不使用 Docker，没有 GHCR/ACR 容器仓库，
# 因此不存在镜像标签清理对象。下方保留了 GHCR/ACR 清理的参考函数（默认
# 不调用、只在 COMPAT_REFERENCE=1 时打印），供将来若真要切镜像方案时参考，
# 当前 Mim 主路线不使用，也不构成运行步骤。
# ==============================================================================
set -euo pipefail

REPO="${1:?请提供仓库名，格式: owner/repo，例如 afdk1991/mim}"
KEEP_LATEST="${2:-10}"
DRY_RUN="${DRY_RUN:-false}"

log()  { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

command -v gh >/dev/null 2>&1 || { echo "错误：未找到 gh cli，请先安装并 gh auth login" >&2; exit 1; }

log "仓库: $REPO"
log "保留最近: $KEEP_LATEST 个 Release"
log "DRY_RUN: $DRY_RUN"

# ===== 1. 清理旧 Release（保留最近 KEEP_LATEST 个） =====
echo ""
log "GitHub Release 清理"

# gh api 返回按创建时间倒序的 Release 列表
releases_json="$(gh api "repos/$REPO/releases?per_page=100" --jq '.[] | .id | tostring' || true)"
if [ -z "$releases_json" ]; then
  warn "没有找到 Release"
else
  total="$(echo "$releases_json" | wc -l | tr -d ' ')"
  echo "共 $total 个 Release"
  if [ "$total" -gt "$KEEP_LATEST" ]; then
    to_delete="$(echo "$releases_json" | tail -n +"$((KEEP_LATEST + 1))")"
    echo "将删除 $(echo "$to_delete" | wc -l | tr -d ' ') 个旧 Release："
    echo "$to_delete" | while read -r rid; do
      echo "  删除 Release id=$rid"
      if [ "$DRY_RUN" = "false" ]; then
        gh api -X DELETE "repos/$REPO/releases/$rid" --silent || warn "删除失败 id=$rid（可能已被删）"
      fi
    done
  else
    echo "Release 数量未超限，无需清理"
  fi
fi

# ===== 2. 清理旧 git tag（与被删 Release 对应的 tag） =====
echo ""
log "旧 tag 清理（保留最近 $KEEP_LATEST 个）"
tags="$(gh api "repos/$REPO/tags?per_page=100" --jq '.[].name' || true)"
if [ -n "$tags" ]; then
  ttotal="$(echo "$tags" | wc -l | tr -d ' ')"
  if [ "$ttotal" -gt "$KEEP_LATEST" ]; then
    echo "$tags" | tail -n +"$((KEEP_LATEST + 1))" | while read -r t; do
      echo "  删除 tag: $t"
      if [ "$DRY_RUN" = "false" ]; then
        git push origin ":refs/tags/$t" || warn "tag 删除失败: $t"
      fi
    done
  else
    echo "tag 数量未超限，无需清理"
  fi
fi

# ===== 3. 参考：容器镜像清理（N/A，本项目不使用 Docker） =====
# 保留这段仅供镜像方案参考，当前不执行。若 COMPAT_REFERENCE=1 则打印说明。
if [ "${COMPAT_REFERENCE:-false}" = "1" ]; then
  echo ""
  warn "[参考] GHCR / ACR 容器镜像清理对 Mim = N/A（无 Docker 主路线）。"
  warn "将来若切换镜像方案：gh api 删除 GHCR package versions，"
  warn "ACR 个人版用 ACR_USER/ACR_PASSWORD 调 /v2.0/<ns>/<repo>/manifests/<digest> DELETE。"
fi

echo ""
log "清理完成（DRY_RUN=$DRY_RUN）"
