#!/usr/bin/env node
/**
 * 2026-11-05 生产库迁移：移除 billing（套餐 / 订阅 / 订单 / 支付 / 退款 / 发票）与 audit 域
 *
 * ⛔ 2026-11-15 起本脚本禁止执行（代码内已加硬守卫，命中即中止）：
 *    统一交易域上线后，`orders` 与 `payments` 已不再属于 billing 域，
 *    生产 `orders` 是 12 列统一表（含 source / source_id / channel / total_cents 等），
 *    重放本脚本的 DROP 会直接删掉正在使用的交易表。守卫逻辑见 assertNotUnifiedTradeTables()。
 *
 * 背景：产品决策移除「套餐 / 订阅（mock）/ 审计」全部能力，仓库 schema.sql 已删除对应表，
 *       路由与前端视图同步移除；生产库需 DROP 残留表与索引，避免悬空数据与误用。
 *
 * 动作：
 *   1) DROP 9 张表：plans / plan_prices / subscriptions / subscription_events /
 *      orders / payments / refunds / invoices / audit_logs（索引随表自动删除）
 *   2) 打印迁移前后取证，并断言残留表与索引为 0
 *
 * 备份策略（2026-11-15）：本项目不创建任何数据库备份，本脚本不生成备份文件。
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

/**
 * 禁止执行守卫：识别「统一交易域」表结构。
 * orders 出现 source / source_id，或 payments 出现 channel，说明这两张表已被统一交易域接管，
 * 继续 DROP 会删除生产正在使用的交易数据，因此无论 DRY-RUN 还是 --apply 都直接跳过（不抛错）：
 * 本脚本的清理目标已由统一交易域接管，属于历史遗留迁移，命中即视为「已作废」，
 * 返回 true 让调用方提前结束并退出 0，避免把整个部署在迁移阶段中止。
 */
function isUnifiedTradeTables(db) {
  const columnsOf = (table) => {
    try {
      return db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name);
    } catch (_) {
      return [];
    }
  };
  const ordersCols = columnsOf('orders');
  const paymentsCols = columnsOf('payments');
  const hit = [];
  if (ordersCols.includes('source') || ordersCols.includes('source_id')) hit.push('orders.source/source_id');
  if (paymentsCols.includes('channel')) hit.push('payments.channel');
  if (!hit.length) return false;
  log(
    `⏭️ 跳过：检测到统一交易域表结构（${hit.join(', ')}），orders / payments 为在用交易表；` +
      '本迁移清理的 billing / audit 域已由统一交易域接管，故不再执行（退出 0，不影响部署）。',
  );
  return true;
}

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

  // 硬守卫：命中统一交易域结构即跳过（DRY-RUN 与 --apply 同一行为），绝不动在用交易表
  if (isUnifiedTradeTables(db)) { // 统一交易域已接管：本迁移作废，直接退出 0 保证部署继续
    db.close(); // 关闭连接，避免留下句柄
    return; // 提前结束 main，进程以 0 退出
  }

  const before = snapshot(db, '迁移前');
  const present = DROP_TABLES.filter((t) => before.tables.includes(t));
  const presentIdx = DROP_INDEXES.filter((i) => before.indexes.includes(i));
  log(`待删除：表 [${present.join(', ') || '无'}]；索引 [${presentIdx.join(', ') || '无'}]`);

  if (!APPLY) {
    log('DRY-RUN 结束，未做任何写入。加 --apply 执行。');
    db.close();
    return;
  }

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

  log(`✅ 迁移完成：${DROP_TABLES.length} 张表与 ${DROP_INDEXES.length} 个索引已清除`);
  db.close();
}

main().catch((e) => {
  console.error('[migrate] ❌ 失败：', e.message);
  process.exit(1);
});
