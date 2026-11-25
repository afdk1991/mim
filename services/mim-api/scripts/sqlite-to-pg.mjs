#!/usr/bin/env node
/**
 * SQLite → PostgreSQL 一次性数据迁移脚本。
 *
 * 用法：
 *   DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mim \
 *     node scripts/sqlite-to-pg.mjs [--sqlite <path>] [--fresh] [--dry-run]
 *
 * --sqlite   源 SQLite 文件，默认 ../data/mim.db（相对本脚本）
 * --fresh    迁移前清空目标库中所有同名表（TRUNCATE ... CASCADE）
 * --dry-run  只统计源表行数与目标表匹配情况，不写入
 *
 * 设计口径：
 *   - 用 session_replication_role=replica 关闭外键触发器，避免表间插入顺序问题（需超级用户）
 *   - 整型按 BigInt 读取后转字符串，避免 64 位 ID 精度丢失
 *   - 列名以目标库 information_schema 为准做交集，源库多出的列只告警不中断
 *   - 逐表 ON CONFLICT DO NOTHING，脚本可重复执行
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const sqlitePath = resolve(HERE, argValue('--sqlite', '../data/mim.db'));
const databaseUrl = process.env.DATABASE_URL;
const fresh = args.includes('--fresh');
const dryRun = args.includes('--dry-run');

if (!existsSync(sqlitePath)) {
  console.error(`[migrate] 源库不存在：${sqlitePath}`);
  process.exit(1);
}
if (!dryRun && !databaseUrl) {
  console.error('[migrate] 缺少 DATABASE_URL');
  process.exit(1);
}

const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
db.defaultSafeIntegers(true);

/** SQLite 值 → PostgreSQL 参数：BigInt 转字符串，其余原样（null / string / number） */
function toParam(value) {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function listSqliteTables() {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

function listSqliteColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function countSqlite(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

const SUMMARY = [];

async function main() {
  const tables = listSqliteTables();
  console.log(`[migrate] 源库：${sqlitePath}`);
  console.log(`[migrate] 源表数量：${tables.length}`);

  if (dryRun) {
    for (const table of tables) {
      SUMMARY.push({ table, source: countSqlite(table).toString(), inserted: '-', target: '-' });
    }
    printSummary();
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SET session_replication_role = replica');

    if (fresh) {
      const existing = await existingTargetTables(client);
      const toTruncate = tables.filter((t) => existing.has(t));
      if (toTruncate.length > 0) {
        console.log(`[migrate] TRUNCATE ${toTruncate.length} 张目标表`);
        await client.query(`TRUNCATE TABLE ${toTruncate.map(quote).join(', ')} CASCADE`);
      }
    }

    for (const table of tables) {
      const columns = await targetColumns(client, table);
      if (!columns) {
        SUMMARY.push({ table, source: countSqlite(table).toString(), inserted: 0, target: '目标库无此表，跳过' });
        continue;
      }

      const sqliteColumns = listSqliteColumns(table);
      const usable = sqliteColumns.filter((c) => columns.has(c));
      const dropped = sqliteColumns.filter((c) => !columns.has(c));
      if (dropped.length > 0) {
        console.warn(`[migrate] ${table} 目标库缺少列，已忽略：${dropped.join(', ')}`);
      }
      if (usable.length === 0) {
        SUMMARY.push({ table, source: countSqlite(table).toString(), inserted: 0, target: '无共同列，跳过' });
        continue;
      }

      const rows = db.prepare(`SELECT ${usable.map(quote).join(', ')} FROM ${table}`).all();
      const inserted = await insertRows(client, table, usable, rows);
      SUMMARY.push({ table, source: rows.length.toString(), inserted, target: '-' });
      console.log(`[migrate] ${table}: ${rows.length} 行读取，${inserted} 行写入`);
    }

    await client.query('SET session_replication_role = DEFAULT');

    for (const item of SUMMARY) {
      item.target = await targetCount(client, item.table);
    }
  } finally {
    await client.end();
  }

  printSummary();
}

function quote(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function existingTargetTables(client) {
  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  return new Set(rows.map((r) => r.table_name));
}

async function targetColumns(client, table) {
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table],
  );
  if (rows.length === 0) return null;
  return new Set(rows.map((r) => r.column_name));
}

async function targetCount(client, table) {
  const cols = await targetColumns(client, table);
  if (!cols) return '无此表';
  const { rows } = await client.query(`SELECT COUNT(*)::bigint AS n FROM ${quote(table)}`);
  return rows[0].n;
}

async function insertRows(client, table, columns, rows) {
  if (rows.length === 0) return 0;

  const width = columns.length;
  const batchSize = Math.max(1, Math.min(500, Math.floor(60000 / width)));
  let inserted = 0;

  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize);
    const params = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(toParam(row[col]));
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql =
      `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES ${tuples.join(', ')} ` +
      'ON CONFLICT DO NOTHING';
    const result = await client.query(sql, params);
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

function printSummary() {
  console.log('\n[migrate] 表 | 源行数 | 写入 | 目标行数');
  for (const item of SUMMARY) {
    console.log(`${item.table} | ${item.source} | ${item.inserted} | ${item.target}`);
  }
}

main().catch((error) => {
  console.error('[migrate] 失败：', error);
  process.exit(1);
});
