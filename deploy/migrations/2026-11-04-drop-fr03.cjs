#!/usr/bin/env node
/**
 * 2026-11-04 生产库迁移：移除 FR-03 内容域（项目 / 任务 / 成员 / 邀请 / 同步 / 导出）
 *
 * 背景：生产库沿用旧 schema，plans 表带有 `features TEXT NOT NULL` 列，
 *       新代码不再写入该列 → `SQLITE_CONSTRAINT_NOTNULL` 导致服务启动失败。
 *       同时 8 张内容域表已从仓库 schema.sql 删除，生产库需同步清理。
 *
 * 动作：
 *   1) 用 better-sqlite3 的 backup API 生成一致性备份（WAL 安全，服务器无 sqlite3 CLI）
 *   2) 重建 plans 表，去除 features 列（保留 id/name_zh/name_en/created_at 数据）
 *   3) DROP 8 张内容域表（索引随表自动删除）
 *   4) 打印迁移前后取证
 *
 * 用法（服务器上）：
 *   sudo -n node /opt/mim/app/deploy/migrations/2026-11-04-drop-fr03.cjs --apply
 *   （不带 --apply 时仅做只读巡检）
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const APP_DIR = process.env.APP_DIR || '/opt/mim/app';
const DB_PATH = process.env.DB_PATH || path.join(APP_DIR, 'services/mim-api/data/mim.db');
const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/mim';

const CONTENT_TABLES = [
  'projects',
  'project_members',
  'project_invitations',
  'tasks',
  'task_tags',
  'task_events',
  'sync_cursors',
  'content_exports',
];

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
  const counts = {};
  for (const t of tables) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    } catch (e) {
      counts[t] = 'ERR ' + e.message;
    }
  }
  const plansCols = tables.includes('plans')
    ? db.prepare('PRAGMA table_info(plans)').all().map((c) => `${c.name}${c.notnull ? ' NOT NULL' : ''}`)
    : [];
  log(`--- ${label}：${tables.length} 张表；plans 列 = [${plansCols.join(', ')}]`);
  log(`    内容域计数：${CONTENT_TABLES.map((t) => `${t}=${counts[t] ?? '不存在'}`).join(', ')}`);
  return { tables, counts, plansCols };
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在：${DB_PATH}`);
  log(`数据库：${DB_PATH}；模式：${APPLY ? 'APPLY（写入）' : 'DRY-RUN（只读）'}`);
  const Database = loadBetterSqlite3();
  const db = new Database(DB_PATH);

  const before = snapshot(db, '迁移前');
  if (before.plansCols.includes('features NOT NULL')) {
    log('确认：plans.features 带 NOT NULL 约束（与当前代码不兼容）');
  } else {
    log('plans 表已不含 features NOT NULL 约束，无需重建');
  }
  if (!APPLY) {
    log('DRY-RUN 结束，未做任何写入。加 --apply 执行。');
    db.close();
    return;
  }

  const backupFile = await backup(db);

  db.pragma('foreign_keys = OFF');
  // legacy_alter_table = ON 防止 ALTER TABLE RENAME 把 plan_prices 的 FK 改写成 plans_old
  db.pragma('legacy_alter_table = ON');
  const migrate = db.transaction(() => {
    // 1) 重建 plans（去 features）
    const cols = db.prepare('PRAGMA table_info(plans)').all().map((c) => c.name);
    if (cols.includes('features')) {
      db.exec('ALTER TABLE plans RENAME TO plans_old');
      db.exec(`CREATE TABLE plans (
        id          TEXT PRIMARY KEY,
        name_zh     TEXT NOT NULL,
        name_en     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      )`);
      db.exec(`INSERT INTO plans (id, name_zh, name_en, created_at)
               SELECT id, name_zh, name_en, created_at FROM plans_old`);
      db.exec('DROP TABLE plans_old');
    }
    // 2) 删除 8 张内容域表（索引随表自动 DROP）
    for (const t of CONTENT_TABLES) {
      db.exec(`DROP TABLE IF EXISTS "${t}"`);
    }
  });
  migrate();
  db.pragma('legacy_alter_table = OFF');
  db.pragma('foreign_keys = ON');

  // 自愈：若历史上曾以 legacy_alter_table=OFF 执行，plan_prices 的 FK 会指向已删除的 plans_old
  const dangling = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%plans_old%'")
    .all();
  if (dangling.length) {
    log(`检测到悬空引用，重建：${dangling.map((d) => d.name).join(', ')}`);
    db.pragma('foreign_keys = OFF');
    const hasPlanPrices = Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='plan_prices'").get(),
    );
    db.transaction(() => {
      if (hasPlanPrices) {
        db.exec(`CREATE TABLE plan_prices_fix (
          id            TEXT PRIMARY KEY,
          plan_id       TEXT NOT NULL REFERENCES plans(id),
          region        TEXT NOT NULL,
          currency      TEXT NOT NULL,
          cycle         TEXT NOT NULL CHECK (cycle IN ('monthly','yearly')),
          amount_minor  INTEGER NOT NULL,
          UNIQUE (plan_id, region, cycle)
        )`);
        db.exec(`INSERT INTO plan_prices_fix (id, plan_id, region, currency, cycle, amount_minor)
                 SELECT id, plan_id, region, currency, cycle, amount_minor FROM plan_prices`);
        db.exec('DROP TABLE plan_prices');
        db.exec('ALTER TABLE plan_prices_fix RENAME TO plan_prices');
      } else {
        // plan_prices 已被后续迁移删除，直接清理悬空的 plans_old
        for (const d of dangling) db.exec(`DROP TABLE IF EXISTS "${d.name}"`);
      }
    })();
    db.pragma('foreign_keys = ON');
  }

  // 校验迁移结果（plans 可能已被后续迁移 2026-11-05 删除，此处做存在性守卫，保证本脚本可幂等重放）
  const afterTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  if (afterTables.includes('plans')) {
    const plans = db.prepare('SELECT id, name_zh, name_en, created_at FROM plans ORDER BY id').all();
    log(`✅ plans 剩余 ${plans.length} 行：${plans.map((p) => p.id).join(', ')}`);
  } else {
    log('plans 表已不存在（由后续迁移删除），跳过 plans 行数校验');
  }
  const after = snapshot(db, '迁移后');
  const leftover = CONTENT_TABLES.filter((t) => after.tables.includes(t));
  if (leftover.length) throw new Error(`迁移后仍存在内容域表：${leftover.join(', ')}`);
  const leftIndexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_projects_user','idx_members_user','idx_tasks_project','idx_tasks_due','idx_task_events_project')")
    .all();
  if (leftIndexes.length) throw new Error(`迁移后仍存在内容域索引：${leftIndexes.map((i) => i.name).join(', ')}`);
  const residual = db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%plans_old%'").all();
  if (residual.length) throw new Error(`迁移后仍存在 plans_old 悬空引用：${residual.map((r) => r.name).join(', ')}`);

  log(`✅ 备份文件：${backupFile}`);
  log('✅ 迁移完成：plans 去 features；8 张内容域表与 5 个索引已清除');
  db.close();
}

main().catch((e) => {
  console.error('[migrate] ❌ 失败：', e.message);
  process.exit(1);
});
