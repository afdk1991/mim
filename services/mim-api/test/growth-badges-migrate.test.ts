/**
 * 社区激励链徽章表迁移（签到 500 修复）：
 * 旧版徽章体系的同名 user_badges(user_id, badge_id, awarded_at) 必须被归档，
 * 新结构 user_badges(id, user_id, badge_code, source, awarded_at) 才能承接自动授予。
 */

import { describe, expect, it } from 'vitest'; // 用例编排 API
import Database from 'better-sqlite3'; // 进程内 SQLite，直接构造旧结构库
import { ensureGrowthUserBadges } from '../src/db.js'; // 待测迁移函数

/** 构造含旧版同名 user_badges 的最小库：模拟升级前的存量库 */
function makeLegacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE growth_badges (code TEXT PRIMARY KEY)');
  db.exec(`CREATE TABLE user_badges (
    user_id    TEXT NOT NULL,
    badge_id   TEXT NOT NULL,
    awarded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, badge_id)
  )`);
  db.prepare('INSERT INTO users (id) VALUES (?)').run('u1');
  db.prepare('INSERT INTO user_badges (user_id, badge_id, awarded_at) VALUES (?, ?, ?)').run(
    'u1',
    'b1',
    '2026-11-20T00:00:00.000Z',
  );
  return db;
}

describe('ensureGrowthUserBadges', () => {
  it('旧同名表被归档，新表带 id 主键且可写入自动授予', () => {
    const db = makeLegacyDb();
    expect(ensureGrowthUserBadges(db)).toBe(true); // 首次调用必须执行重建

    const columns = db.prepare('PRAGMA table_info(user_badges)').all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toEqual(['id', 'user_id', 'badge_code', 'source', 'awarded_at']); // 与 85-growth-chain.sql 同构

    const legacyTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'user_badges_legacy_%'")
      .all() as Array<{ name: string }>;
    expect(legacyTables).toHaveLength(1); // 旧数据整表归档，不丢历史
    const legacyRows = db.prepare(`SELECT COUNT(*) AS n FROM ${legacyTables[0].name}`).get() as { n: number };
    expect(legacyRows.n).toBe(1); // 历史授予记录仍在

    db.prepare('INSERT INTO growth_badges (code) VALUES (?)').run('checkin-7');
    const inserted = db
      .prepare(`INSERT OR IGNORE INTO user_badges (id, user_id, badge_code, source, awarded_at) VALUES (?, ?, ?, 'auto', ?)`)
      .run('badge-row-1', 'u1', 'checkin-7', '2026-11-20T00:00:00.000Z');
    expect(inserted.changes).toBe(1); // 新结构可正常写入，签到授予不再 500

    expect(ensureGrowthUserBadges(db)).toBe(false); // 二次调用幂等，不再重复改名
  });

  it('已是新结构的库直接跳过', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE user_badges (id TEXT PRIMARY KEY, user_id TEXT, badge_code TEXT, source TEXT, awarded_at TEXT)');
    expect(ensureGrowthUserBadges(db)).toBe(false); // 无需迁移
  });
});
