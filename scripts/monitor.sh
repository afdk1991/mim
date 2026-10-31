#!/usr/bin/env bash
# ==============================================================================
# Mim —— 服务监控探活脚本（无容器，systemd 宿主机）
#
# 用途：
#   - cron 每分钟跑一次，失败时邮件/IM 告警；
#   - UptimeRobot/阿里云云监控等按「退出码」探活（0=健康，非 0=故障）；
#   - 运维本地巡检：`./scripts/monitor.sh` 人读输出。
#
# 用法：
#   MIM_DIR=/opt/mim ./scripts/monitor.sh
#   # cron 示例（每分钟，结果写日志）：
#   * * * * * /opt/mim/scripts/monitor.sh >> /var/log/mim-monitor.log 2>&1
#
# 环境变量（均可不设，有合理默认）：
#   MIM_DIR     安装目录（默认 /opt/mim；PORT 从 $MIM_DIR/server/.env 读，读不到回退 8787）
#   DISK_PCT    磁盘用量告警阈值百分比（默认 92）
#   LOG_MIN     回看日志的时间窗（分钟，默认 10）
#   ERR_MAX     时间窗内 error 日志条数上限（默认 20，超过判异常）
#
# 退出码：0=全部检查通过；1=至少一项失败（逐项打印 [OK]/[FAIL]）
# ==============================================================================
set -uo pipefail

MIM_DIR="${MIM_DIR:-/opt/mim}"
DISK_PCT="${DISK_PCT:-92}"
LOG_MIN="${LOG_MIN:-10}"
ERR_MAX="${ERR_MAX:-20}"

FAIL=0
say() { printf '%s\n' "$*"; }
ok()   { say "[OK]   $*"; }
bad()  { say "[FAIL] $*"; FAIL=1; }

# ---------- 1. 进程：systemd 优先，无 systemd 回退 pgrep ----------
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^mim-server.service'; then
  if systemctl is-active --quiet mim-server; then
    ok "systemd mim-server 进程在跑"
  else
    bad "systemd mim-server 未运行（systemctl status mim-server 看详情）"
  fi
else
  if pgrep -f 'server/src/main.js' >/dev/null 2>&1; then
    ok "node 进程在跑（pgrep server/src/main.js）"
  else
    bad "未找到 server/src/main.js 进程"
  fi
fi

# ---------- 2. 端口与健康接口 ----------
PORT="${PORT:-}"
if [ -z "$PORT" ] && [ -f "$MIM_DIR/server/.env" ]; then
  PORT="$(grep -E '^PORT=' "$MIM_DIR/server/.env" | cut -d= -f2- || true)"
fi
PORT="${PORT:-8787}"

BODY="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
if [ -z "$BODY" ]; then
  bad "http://127.0.0.1:$PORT/api/health 无响应（端口没监听或进程挂了）"
else
  # 健康契约：{data:{ok,db,rpcs,...}}。不依赖 jq，用 grep 判字段。
  if echo "$BODY" | grep -q '"db":true'; then
    ok "健康检查通过（db 已连，rpcs=$(echo "$BODY" | grep -o '"rpcs":[0-9]*' | cut -d: -f2)）"
  else
    bad "健康检查返回了内容但 db=false：$BODY"
  fi
fi

# ---------- 3. 磁盘余量（上传目录所在分区）----------
DATA_DIR="$MIM_DIR/server/data"
if [ -d "$DATA_DIR" ]; then
  USE="$(df -P "$DATA_DIR" | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
  if [ "${USE:-100}" -lt "$DISK_PCT" ]; then
    ok "磁盘用量 ${USE}% < 阈值 ${DISK_PCT}%（$DATA_DIR 所在分区）"
  else
    bad "磁盘用量 ${USE}% ≥ 阈值 ${DISK_PCT}%，上传/日志写不下风险"
  fi
else
  say "[SKIP] $DATA_DIR 不存在，跳过磁盘检查"
fi

# ---------- 4. 近期日志错误率（结构化 JSON 日志的 level=error 计数）----------
if command -v journalctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^mim-server.service'; then
  ERRS="$(journalctl -u mim-server --since "${LOG_MIN} min ago" 2>/dev/null | grep -c '"level":"error"' || true)"
  ERRS="${ERRS:-0}"
  if [ "$ERRS" -le "$ERR_MAX" ]; then
    ok "最近 ${LOG_MIN} 分钟 error 日志 ${ERRS} 条（≤ ${ERR_MAX}）"
  else
    bad "最近 ${LOG_MIN} 分钟 error 日志 ${ERRS} 条 > ${ERR_MAX}，看 journalctl -u mim-server -n 100"
  fi
else
  say "[SKIP] 无 systemd/journald，跳过日志错误率检查"
fi

say ""
if [ "$FAIL" -eq 0 ]; then
  say "==> Mim 监控：全部正常"
  exit 0
else
  say "==> Mim 监控：存在失败项（见上方 [FAIL]）"
  exit 1
fi
