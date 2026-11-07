#!/usr/bin/env bash
# SQLite 生产库一致性备份（铁律八：备份脚本随部署工件入库）
#
# 用法：
#   bash deploy/backup-db.sh              # 备份到默认目录
#   BACKUP_DIR=/var/backups/mim bash deploy/backup-db.sh
#
# 说明：
#   - 2026-11-07 修复：生产服务器未安装 sqlite3 CLI（deploy/migrations/*.cjs 注释已明示），
#     原脚本强依赖该命令，即使被 systemd timer 调度也会立刻失败退出；
#     现改为复用项目自带 better-sqlite3 的 backup API（WAL 模式下同样得到一致快照）。
#   - 调度由 deploy/mim-backup.timer 每日 03:00 触发，deploy/deploy.sh §6.5 幂等安装。
#   - 备份文件按时间戳命名，保留最近 KEEP 份。
set -euo pipefail

# 应用发布目录：用于 better-sqlite3 在 pnpm 依赖树中定位原生模块
APP_DIR="${APP_DIR:-/opt/mim/app}"
# 源库路径：与 config.ts 的 DATA_DIR 对齐
DB_PATH="${DB_PATH:-$APP_DIR/services/mim-api/data/mim.db}"
# 备份落盘目录：可按需覆盖到独立磁盘或挂载点
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mim}"
# 保留份数：轮转时只保留最近 KEEP 个文件
KEEP="${KEEP:-14}"

# 统一日志前缀：便于 journalctl -u mim-backup.service 检索
log() { printf '[backup %s] %s\n' "$(date '+%F %T')" "$*"; }

# 源库不存在时直接失败：避免把「空备份」误当成成功
if [ ! -f "$DB_PATH" ]; then
  log "❌ 数据库不存在: $DB_PATH"
  exit 1
fi

# 备份依赖 node（生产必装），不再要求系统 sqlite3 CLI
if ! command -v node >/dev/null 2>&1; then
  log "❌ 缺少 node，请先运行 deploy/bootstrap.sh"
  exit 1
fi

# 目标目录幂等创建；文件名含秒级时间戳，避免同分钟重复覆盖
mkdir -p "$BACKUP_DIR"
STAMP="$(date '+%Y%m%d-%H%M%S')"
TARGET="$BACKUP_DIR/mim-$STAMP.db"

# 在线热备份：把内联 CJS 交给 node 执行，db.backup() 不锁库、WAL 安全。
# 三个位置参数分别传源库、目标文件、发布目录，避免 shell 引号注入。
node - "$DB_PATH" "$TARGET" "$APP_DIR" <<'NODE'
// 标准库：fs 用于探测 pnpm 目录，path 用于拼原生模块绝对路径
const fs = require('node:fs');
const path = require('node:path');
// 从 argv 读取 shell 侧传入的三个路径，避免把可变内容拼进代码字符串
const [dbPath, target, appDir] = process.argv.slice(2);
// 优先按常规解析；pnpm 隔离存储下则回退到 .pnpm/<pkg>/node_modules 定位（与 migrations 同款写法）
function loadBetterSqlite3() {
  // 常规路径：服务自身 node_modules 能直接解析
  try {
    return require('better-sqlite3');
  } catch (_) {
    // 回退路径：在 .pnpm 中找版本号最新的一份 better-sqlite3
    const pnpmDir = path.join(appDir, 'node_modules/.pnpm');
    const hit = fs.readdirSync(pnpmDir).filter((d) => d.startsWith('better-sqlite3@')).sort().pop();
    // 仍找不到则明确报错，不静默产出空文件
    if (!hit) throw new Error('未找到 better-sqlite3，请检查依赖安装');
    return require(path.join(pnpmDir, hit, 'node_modules/better-sqlite3'));
  }
}
// 异步主流程：只读打开源库 → backup 到目标 → 关闭句柄
(async () => {
  // 以只读方式打开，确保备份进程不会改动生产库
  const Database = loadBetterSqlite3();
  const db = new Database(dbPath, { readonly: true });
  // backup API 返回 Promise，完成后目标文件即为一致性快照
  await db.backup(target);
  // 释放文件句柄，避免 Windows/容器环境下残留锁
  db.close();
  // 输出体积信息，运维可直接从 journalctl 核对备份规模
  console.log(`[backup] ✅ 快照完成: ${target} (${(fs.statSync(target).size / 1024 / 1024).toFixed(2)} MB)`);
})().catch((e) => {
  // 失败必须非零退出：让 systemd 标记为 failed，而不是被误判为备份成功
  console.error(`[backup] ❌ 备份失败: ${e.message}`);
  process.exit(1);
});
NODE
log "✅ 已备份: $TARGET ($(du -h "$TARGET" | cut -f1))"

# 轮转：仅保留最近 KEEP 份，避免备份目录无限增长
COUNT="$(ls -1 "$BACKUP_DIR"/mim-*.db 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$KEEP" ]; then
  # 按时间倒序取最旧的一批删除，xargs -r 防止空参数误执行
  ls -1t "$BACKUP_DIR"/mim-*.db | tail -n "$((COUNT - KEEP))" | xargs -r rm -f
  log "🧹 轮转完成，保留最近 $KEEP 份"
fi
