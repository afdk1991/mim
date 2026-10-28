#!/usr/bin/env bash
# ==============================================================================
# Mim —— 无 Docker 一键重建脚本（实例被终止后 10 分钟内可重建）
#
# 定位：新机器 / 重建机上从源码目录执行一次，把系统准备 + 部署串起来。
# 实际部署动作（建 mim 用户、.env 生成、建库、npm、systemd、nginx、日志轮转）
# 全部委托给 deploy/install.sh，本脚本只做「系统层准备」，不重复实现。
#
# 用法：
#   sudo ./deploy/bootstrap.sh                  # 全流程
#   sudo SKIP_UFW=1 ./deploy/bootstrap.sh       # 跳过防火墙配置
#   sudo MIM_DIR=/opt/mim DOMAIN=example.com ./deploy/bootstrap.sh
#
# 前置：本脚本必须在 Mim 源码目录里（git clone 后），以 root/sudo 执行。
# 设计约束：全程无容器；set -euo pipefail；纯 LF。
# ==============================================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请以 root 或 sudo 执行：sudo ./deploy/bootstrap.sh"
[ -f "$SRC_DIR/deploy/install.sh" ] || die "未找到 $SRC_DIR/deploy/install.sh，请在 Mim 源码根目录执行本脚本"

# ---------- 1. 基础工具 ----------
log "1/5 基础工具（git / curl）"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  command -v git  >/dev/null 2>&1 || apt-get install -y git
  command -v curl >/dev/null 2>&1 || apt-get install -y curl
elif command -v dnf >/dev/null 2>&1; then
  command -v git  >/dev/null 2>&1 || dnf install -y git
  command -v curl >/dev/null 2>&1 || dnf install -y curl
else
  warn "未识别的包管理器，请自行确认 git/curl/nginx/postgresql 已安装"
fi

# ---------- 2. Node.js >= 20 ----------
log "2/5 Node.js >= 20"
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge 20 ] || die "Node 版本过低（当前 $NODE_MAJOR），请先安装 Node 20+ 后重跑"
  echo "node $(node -v) 已就绪"
else
  warn "未找到 node。请先安装 Node.js >= 20（NodeSource 22.x）后重跑本脚本："
  warn "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
  die "缺少 Node.js，终止"
fi

# ---------- 3. 系统服务依赖（postgresql / nginx / ufw / fail2ban） ----------
log "3/5 系统服务依赖（PostgreSQL / nginx / ufw / fail2ban）"
if command -v apt-get >/dev/null 2>&1; then
  command -v psql       >/dev/null 2>&1 || apt-get install -y postgresql
  command -v nginx      >/dev/null 2>&1 || apt-get install -y nginx
  command -v ufw         >/dev/null 2>&1 || apt-get install -y ufw
  command -v fail2ban-client >/dev/null 2>&1 || apt-get install -y fail2ban
elif command -v dnf >/dev/null 2>&1; then
  command -v psql >/dev/null 2>&1 || { dnf install -y postgresql-server && postgresql-setup --initdb; }
  command -v nginx >/dev/null 2>&1 || dnf install -y nginx
  command -v fail2ban-client >/dev/null 2>&1 || dnf install -y fail2ban
fi
systemctl enable --now postgresql 2>/dev/null || warn "postgresql 未能 systemctl 启动，请手动检查"
systemctl enable --now fail2ban 2>/dev/null || warn "fail2ban 未能启动（非必需，可忽略）"

# ---------- 4. 防火墙（可跳过） ----------
if [ "${SKIP_UFW:-0}" = "1" ]; then
  warn "SKIP_UFW=1，跳过防火墙配置"
else
  log "4/5 防火墙：只放行 22 / 80 / 443"
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    warn "云平台控制台的安全组 / 安全列表需同样放行 22/80/443，两层缺一不可"
  else
    warn "无 ufw，跳过防火墙配置"
  fi
fi

# ---------- 5. 委托 deploy/install.sh 完成应用部署 ----------
log "5/5 应用部署（委托 deploy/install.sh）"
# install.sh 需要普通用户环境里有 sudo？这里已是 root，直接执行。
# 透传可选变量：MIM_DIR / DOMAIN / SKIP_BUILD 由调用方 export 后自然继承。
bash "$SRC_DIR/deploy/install.sh"

echo ""
log "重建完成"
echo "  安装目录: ${MIM_DIR:-/opt/mim}"
echo "  下一步: curl -fsS http://127.0.0.1:8787/api/health"
