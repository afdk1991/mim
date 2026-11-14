#!/usr/bin/env node
/**
 * 2026-11-15 生产库迁移：移除 10 个下线模块的残留数据表
 *
 * 背景：产品决策下线「功能模块商城 / 云存储 / 图床 / 下载分发 / 自研工具 / 统一搜索 /
 *       导航站 / 商业化中台 / 放映厅 / 创作工作台」，仓库 schema.sql 与 schema.d/*.sql
 *       已删除对应建表语句，路由与前端视图同步移除。
 *
 * 明确约束（用户指定）：本迁移不做数据库备份，仅做只读行数统计后直接 DROP。
 *       备份策略由运维侧既有定时任务负责，本脚本不新增任何备份动作。
 *
 * 动作：
 *   1) 只读统计待删表的行数并打印（迁移取证）
 *   2) DROP 17 张表（索引随表自动删除）
 *   3) 迁移后再次取证，断言残留表为 0
 *
 * 公告内容不删除：/announcements 页面下线但公告数据并入社区页「公告动态」页签，
 *   原有种子公告（含描述历史能力的条目）全部保留，避免内容丢失。
 *
 * 用法（服务器上）：
 *   node /opt/mim/app/deploy/migrations/2026-11-15-drop-removed-modules.cjs --apply
 *   （不带 --apply 时仅做只读巡检与行数统计）
 *
 * 幂等性：所有 DROP 均带 IF EXISTS，可反复重放。
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const APP_DIR = process.env.APP_DIR || '/opt/mim/app';
const DB_PATH = process.env.DB_PATH || path.join(APP_DIR, 'services/mim-api/data/mim.db');

const DROP_TABLES = [
  // 创作工作台 / 放映厅（comic 域）
  'comic_projects',
  'comic_characters',
  'storyboards',
  'generation_jobs',
  'generation_assets',
  'comic_films',
  'film_versions',
  // 导航站 / 入口清单
  'site_module_items',
  'nav_links',
  // 商业化中台（售后 / 评价 / 提现 / 徽章 / 用户信号）
  'after_sales',
  'product_reviews',
  'withdrawals',
  'badges',
  'user_badges',
  'user_signals',
  // 统一搜索多语言缓存
  'translation_cache',
  // 自研工具
  'mim_tools',
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

function snapshot(db, label) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const counts = {};
  for (const t of DROP_TABLES) {
    counts[t] = tables.includes(t) ? db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c : '不存在';
  }
  log(`--- ${label}：共 ${tables.length} 张表`);
  for (const t of DROP_TABLES) log(`    ${t} = ${counts[t]}`);
  return { tables, counts };
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在：${DB_PATH}`);
  log(`数据库：${DB_PATH}；模式：${APPLY ? 'APPLY（写入）' : 'DRY-RUN（只读）'}`);
  const Database = loadBetterSqlite3();
  const db = new Database(DB_PATH);

  snapshot(db, '迁移前行数统计');
  const present = DROP_TABLES.filter((t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
  log(`待删除：${present.join(', ') || '无（已全部移除）'}`);

  if (!APPLY) {
    log('DRY-RUN 结束，未做任何写入。加 --apply 执行。');
    db.close();
    return;
  }

  // 关闭外键约束，避免删除被引用的表时报错
  db.pragma('foreign_keys = OFF');
  const dropped = db.transaction(() => {
    const done = [];
    for (const t of DROP_TABLES) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
      if (!exists) continue;
      db.exec(`DROP TABLE IF EXISTS "${t}"`);
      done.push(t);
    }
    return done;
  })();
  db.pragma('foreign_keys = ON');

  const after = snapshot(db, '迁移后行数统计');
  const leftover = DROP_TABLES.filter((t) => after.tables.includes(t));
  if (leftover.length) throw new Error(`迁移后仍存在待删表：${leftover.join(', ')}`);

  log(`✅ 迁移完成：本次 DROP ${dropped.length} 张表 [${dropped.join(', ') || '无'}]`);
  log('ℹ️ 按用户要求未执行数据库备份；如需回滚请使用运维侧既有备份。');
  db.close();
}

main().catch((e) => {
  console.error('[migrate] ❌ 失败：', e.message);
  process.exit(1);
});
