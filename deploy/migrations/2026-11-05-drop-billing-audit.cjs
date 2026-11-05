#!/usr/bin/env node
/**
 * 2026-11-05 生产库迁移：移除 billing（套餐 / 订阅 / 订单 / 支付 / 退款 / 发票）与 audit 域
 *
 * 背景：产品决策下线「套餐 / 订阅（mock）/ 审计」全部能力，仓库 schema.sql 已删除对应表，
 *       路由与前端视图同步移除；生产库需 DROP 残留表与索引，避免悬空数据与误用。
 *
 * 动作：
 *   1) better-sqlite3 backup API 生成一致性备份（WAL 安全，服务器无 sqlite3 CLI）
 *   2) DROP 9 张表：plans / plan_prices / subscriptions / subscription_events /
 *      orders / payments / refunds / invoices / audit_logs（索引随表自动删除）
 *   3) 打印迁移前后取证，并断言残留表与索引为 0
 *
 * 用法（服务器上）：
 *   sudo -n node /opt/mim/app/deploy/migrations/2026-11-05-drop-billing-audit.cjs --apply
 *   （不带 --apply 时仅做只读巡检）
 *
 * 幂等性：所有 DROP 均带 IF EXISTS，可反复重放。
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const APP_DIR = process.env.APP_DIR || '/opt/mim/app';
const DB_PATH = process.env.DB_PATH || path.join(APP_DIR, 'services/mim-api/data/mim.db');
const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/mim';

const DROP_TABLES = [
  'plans',
  'plan_prices',
  'subscriptions',
  'subscription_events',
  'orders',
  'payments',
  'refunds',
  'invoices',
  'audit_logs',
];

const DROP_INDEXES = ['idx_subscriptions_user', 'idx_orders_user', 'idx_audit_user'];

function log(msg) {
  console.log(`[migrate ${new Date().toISOString()}] ${msg}`);
}

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3');
  } catch (_) {
    const pnpmDir = path.join(APP_DIR, 'node_modules/.pnpm');
    const hit = fs
      .readdirSync(pnpmDir)
      .filter((d) => d.startsWith('better-sqlite3@'))
      .sort()
      .pop();
    if (!hit) throw new Error('未找到 better-sqlite3，请检查依赖安装');
    return require(path.join(pnpmDir, hit, 'node_modules/better-sqlite3'));
  }
}

async function backup(db) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const target = path.join(BACKUP_DIR, `mim-${stamp}.db`);
  await db.backup(target);
  const size = fs.statSync(target).size;
  log(`✅ 备份完成：${target} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  return target;
}

function snapshot(db, label) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const counts = {};
  for (const t of DROP_TABLES) {
    counts[t] = tables.includes(t) ? db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c : '不存在';
  }
  log(`--- ${label}：${tables.length} 张表 / ${indexes.length} 个索引`);
  log(`    billing+audit 计数：${DROP_TABLES.map((t) => `${t}=${counts[t]}`).join(', ')}`);
  return { tables, indexes, counts };
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在：${DB_PATH}`);
  log(`数据库：${DB_PATH}；模式：${APPLY ? 'APPLY（写入）' : 'DRY-RUN（只读）'}`);
  const Database = loadBetterSqlite3();
  const db = new Database(DB_PATH);

  const before = snapshot(db, '迁移前');
  const present = DROP_TABLES.filter((t) => before.tables.includes(t));
  const presentIdx = DROP_INDEXES.filter((i) => before.indexes.includes(i));
  log(`待删除：表 [${present.join(', ') || '无'}]；索引 [${presentIdx.join(', ') || '无'}]`);

  if (!APPLY) {
    log('DRY-RUN 结束，未做任何写入。加 --apply 执行。');
    db.close();
    return;
  }

  const backupFile = await backup(db);

  // 关闭外键约束，避免删除被引用的父表时报错
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const idx of DROP_INDEXES) db.exec(`DROP INDEX IF EXISTS "${idx}"`);
    for (const t of DROP_TABLES) db.exec(`DROP TABLE IF EXISTS "${t}"`);
  })();
  db.pragma('foreign_keys = ON');

  // 取证与断言
  const after = snapshot(db, '迁移后');
  const leftover = DROP_TABLES.filter((t) => after.tables.includes(t));
  if (leftover.length) throw new Error(`迁移后仍存在 billing/audit 表：${leftover.join(', ')}`);
  const leftoverIdx = DROP_INDEXES.filter((i) => after.indexes.includes(i));
  if (leftoverIdx.length) throw new Error(`迁移后仍存在 billing/audit 索引：${leftoverIdx.join(', ')}`);

  log(`✅ 备份文件：${backupFile}`);
  log(`✅ 迁移完成：${DROP_TABLES.length} 张表与 ${DROP_INDEXES.length} 个索引已清除`);
  db.close();
}

main().catch((e) => {
  console.error('[migrate] ❌ 失败：', e.message);
  process.exit(1);
});
