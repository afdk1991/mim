#!/usr/bin/env bash
# ==============================================================================
# Mim —— 多远程仓库注册（幂等，只注册，不推送）
#
# GitHub 是唯一可写源（afdk1991/mim）。其余平台只做只读镜像，
# 让仓库在被 GitHub 限流 / 不可达时仍有一个可查的副本。
#
# 用法：
#   ./scripts/init-multi-remote.sh
#   MIRROR_NS=someone ./scripts/init-multi-remote.sh    # 换命名空间
#
# 设计约束：
#   1. 幂等 —— 已存在且地址正确的 remote 直接跳过，不重复添加
#   2. 不推送 —— 脚本只写 .git/config，不发起任何网络写操作
#   3. 不用 --force —— 镜像推送由人工执行，见脚本末尾提示
# ==============================================================================
set -euo pipefail

NPX_NS="${MIRROR_NS:-afdk1991}"
REPO="${MIRROR_REPO:-mim}"

log()  { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

[ -d .git ] || { printf '\033[1;31m[error]\033[0m 当前目录不是 git 仓库\n' >&2; exit 1; }

# remote 名 → 地址
# 注：jihu 历史上指向云效 Codeup（gitcode.com），沿用现有命名不改地址。
# tencent-cnb 为可选镜像（腾讯云 CNB），不配对应用户可手动删除该行。
remotes=(
  "gitee|git@gitee.com:${NPX_NS}/${REPO}.git"
  "jihu|git@gitcode.com:${NPX_NS}/${REPO}.git"
  "atomgit|git@atomgit.com:${NPX_NS}/${REPO}.git"
  "tencent-cnb|https://git.code.tencent.com/${NPX_NS}/${REPO}.git"
)

log "注册只读镜像 remote（命名空间 ${NPX_NS}/${REPO}）"
for entry in "${remotes[@]}"; do
  name="${entry%%|*}"
  url="${entry##*|}"

  if git remote get-url "$name" >/dev/null 2>&1; then
    current="$(git remote get-url "$name")"
    if [ "$current" = "$url" ]; then
      printf '  跳过 %-9s 已存在：%s\n' "$name" "$current"
    else
      # 地址变了才更新，避免残留旧账号的地址导致推送打到错误仓库
      git remote set-url "$name" "$url"
      printf '  更新 %-9s %s → %s\n' "$name" "$current" "$url"
    fi
  else
    git remote add "$name" "$url"
    printf '  添加 %-9s %s\n' "$name" "$url"
  fi
done

echo
log "当前 remote"
git remote -v

cat <<EOF

------------------------------------------------------------------------------
下一步（手动执行，脚本不代劳）

  镜像推送（把 GitHub 上的全部分支与 tag 同步过去）：
    git push --mirror gitee
    git push --mirror jihu
    git push --mirror atomgit
    git push --mirror tencent-cnb      # 可选，未使用 CNB 时跳过

  说明：
    - 首次推送前需在各平台先建好空的 ${REPO} 仓库，否则会报 repository not found
    - --mirror 会删除目标仓库里多出来的分支，确认目标仓库是只读镜像后再用
    - 反向同步（镜像 → GitHub）不要做：GitHub 是唯一可写源
------------------------------------------------------------------------------
EOF
