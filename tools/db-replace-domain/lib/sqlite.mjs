/**
 * tools/db-replace-domain/lib/sqlite.mjs
 *
 * SQLite 库模式：遍历所有用户表的 TEXT 列，在 JS 层完成替换（序列化长度重算复用
 * replace.mjs），再用参数化 UPDATE 写回；dry-run 以只读方式打开，不落盘。
 *
 * 依赖 Node 22 内置 node:sqlite（DatabaseSync），零新增 npm 依赖。
 * 限制：WITHOUT ROWID 表无 rowid，会被跳过并计入 skippedTables。
 */

import { replaceText, countReplacements } from './replace.mjs';

/** 标识符加引号转义。 */
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** 判断列是否按文本处理。 */
function isTextColumn(type) {
  const t = String(type || '').toLowerCase();
  return t === '' || /char|clob|text|json/.test(t);
}

/**
 * 对 SQLite 库执行域名替换。
 * @param {string} dbPath
 * @param {string} from
 * @param {string} to
 * @param {{dryRun?:boolean}} opts
 * @returns {{tables:number, scanned:number, changedCells:number, changedRows:number, skippedTables:string[], dryRun:boolean}}
 */
export async function replaceSqlite(dbPath, from, to, opts = {}) {
  const dryRun = opts.dryRun === true;
  // 动态加载内置实验模块：文本模式不会触发 SQLite 警告。
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: dryRun });

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();

  const summary = {
    tables: tables.length,
    scanned: 0,
    changedCells: 0,
    changedRows: 0,
    skippedTables: [],
    dryRun,
  };

  for (const { name: table } of tables) {
    let cols;
    try {
      cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
    } catch {
      summary.skippedTables.push(table);
      continue;
    }
    const textCols = cols.filter((c) => isTextColumn(c.type)).map((c) => c.name);
    if (textCols.length === 0) continue;

    let rows;
    try {
      rows = db
        .prepare(`SELECT rowid AS __rid, ${textCols.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)}`)
        .all();
    } catch {
      // 无 rowid（WITHOUT ROWID）等情况：跳过，不强行写库
      summary.skippedTables.push(table);
      continue;
    }

    for (const row of rows) {
      const updates = {};
      for (const col of textCols) {
        const v = row[col];
        if (typeof v !== 'string') continue;
        summary.scanned += 1;
        const nv = replaceText(v, from, to);
        if (nv !== v) {
          updates[col] = nv;
          summary.changedCells += 1;
        }
      }
      if (Object.keys(updates).length > 0) {
        summary.changedRows += 1;
        if (!dryRun) {
          const set = Object.keys(updates).map((c) => `${quoteIdent(c)} = ?`).join(', ');
          const stmt = db.prepare(`UPDATE ${quoteIdent(table)} SET ${set} WHERE rowid = ?`);
          stmt.run(...Object.values(updates), row.__rid);
        }
      }
    }
  }

  db.close();
  return summary;
}

/** 供测试复用：统计某条字符串命中次数。 */
export { countReplacements };
