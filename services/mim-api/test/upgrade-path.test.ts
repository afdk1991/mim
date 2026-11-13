// 升级路径回归：把「新库」退回成老库形状（删新列 / 删新表），再用 createDatabase 重开，
// 断言域脚本能补齐列与表且种子不炸。线上 502 的根因就是这条路径没被测到：
// 07-content.sql 只把 published_at 写进 CREATE TABLE IF NOT EXISTS，老库不会被补列，
// 随后种子 INSERT 显式引用该列 → 启动即 SQLITE_ERROR（no column named published_at）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createDatabase } from '../src/db.js';

const LEGACY_DROPS = [
  // 先删引用方（子表），再删父表，避免外键约束拦截
  'DROP TABLE IF EXISTS circle_posts',
  'DROP TABLE IF EXISTS circle_notices',
  'DROP TABLE IF EXISTS circle_members',
  'DROP TABLE IF EXISTS circles',
  'DROP TABLE IF EXISTS cdn_purge_audit',
  'DROP TABLE IF EXISTS promotion_conversions',
  // 再删本轮新增的列，模拟「老库没有这些列」的真实形态
  'ALTER TABLE announcements DROP COLUMN published_at',
  'ALTER TABLE shop_orders DROP COLUMN points_spent',
  'ALTER TABLE shop_orders DROP COLUMN points_deduct_cents',
];

describe('存量库升级路径', () => {
  let dir = '';
  let file = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-upgrade-'));
    file = join(dir, 'mim.sqlite');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // Windows 下句柄释放有延迟，重试几次避免 EBUSY
  });

  it('老库删掉新列新表后重开，域脚本自动补齐且不抛错', () => {
    const first = createDatabase(file); // 建出新库（含本轮新增列/表）
    first.close(); // 关掉，模拟一次正常部署后的产物

    const legacy = new Database(file); // 直接改结构，退化成老库
    legacy.pragma('foreign_keys = OFF');
    for (const sql of LEGACY_DROPS) legacy.exec(sql);
    const beforeCols = (legacy.prepare('PRAGMA table_info(announcements)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(beforeCols).not.toContain('published_at'); // 前置断言：确实退化成了缺列状态
    legacy.close();

    const upgraded = createDatabase(file); // 关键一步：新版代码打开老库，历史上这里会抛错
    const afterCols = (upgraded.prepare('PRAGMA table_info(announcements)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(afterCols).toContain('published_at'); // 列被 ALTER_ADD 补回
    const orderCols = (upgraded.prepare('PRAGMA table_info(shop_orders)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(orderCols).toContain('points_spent');
    expect(orderCols).toContain('points_deduct_cents');
    const tables = (upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const t of ['circles', 'circle_members', 'circle_posts', 'circle_notices', 'cdn_purge_audit', 'promotion_conversions']) {
      expect(tables).toContain(t);
    }
    // 种子必须完整落地：公告三条 + 权限点 content:write 已授予内置超管
    const annCount = (upgraded.prepare('SELECT COUNT(*) AS n FROM announcements').get() as { n: number }).n;
    expect(annCount).toBeGreaterThanOrEqual(3);
    const granted = upgraded.prepare("SELECT 1 AS ok FROM role_permissions WHERE role_code='superadmin' AND permission_code='content:write'").get() as { ok?: number } | undefined;
    expect(granted?.ok).toBe(1);
    upgraded.close();
  });

  it('补齐后再次重开不得重复补列（幂等）', () => {
    // 同一路径连续打开两次：第二次域脚本应全部命中「列已存在」分支，
    // 若幂等失效会抛 duplicate column name，这条用例把重复启动的场景钉死。
    createDatabase(file).close();
    const upgraded = createDatabase(file);
    const cols = (upgraded.prepare('PRAGMA table_info(announcements)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols.filter((c) => c === 'published_at')).toHaveLength(1);
    upgraded.close();
  });
});
