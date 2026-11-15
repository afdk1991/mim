// 升级路径回归：把「新库」退回成老库形状（删新列 / 删新表），再用 createDatabase 重开，
// 断言域脚本能补齐列与表且种子不炸。线上 502 的根因就是这条路径没被测到：
// 07-content.sql 只把 published_at 写进 CREATE TABLE IF NOT EXISTS，老库不会被补列，
// 随后种子 INSERT 显式引用该列 → 启动即 SQLITE_ERROR（no column named published_at）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { alignLegacyCommerceTables, createDatabase } from '../src/db.js';

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

// 订阅制时代的 orders / payments 是另一条更早的历史分支：表已存在但列完全是另一套。
// CREATE TABLE IF NOT EXISTS 会整表跳过，50-unified-commerce.sql 随后在旧 orders 上建 source 索引会直接报
// no such column: source —— 本地快照起不来就是这条路径。这里钉死「原地重建 + 旧行归档 + 幂等」。
const LEGACY_ORDERS_DDL = `CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id TEXT NOT NULL, region TEXT NOT NULL,
  cycle TEXT NOT NULL CHECK (cycle IN ('monthly','yearly')), currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','closed','refunded')),
  driver TEXT NOT NULL, provider_ref TEXT, idempotency_key TEXT, version INTEGER NOT NULL DEFAULT 1,
  paid_at TEXT, closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;

const LEGACY_PAYMENTS_DDL = `CREATE TABLE payments (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), driver TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
  provider_txn_id TEXT, created_at TEXT NOT NULL
)`;

describe('订阅制老库升级到统一交易域', () => {
  let dir = '';
  let file = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-legacy-commerce-'));
    file = join(dir, 'mim.sqlite');
  }); // beforeEach 结束

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // Windows 句柄释放有延迟，重试避免 EBUSY
  }); // afterEach 结束

  const downgrade = () => { // 把新库退回订阅制形态，并留一条旧订单 / 旧支付作为归档样本
    createDatabase(file).close(); // 先得到一份完整新库
    const legacy = new Database(file); // 直接改结构
    legacy.pragma('foreign_keys = OFF');
    for (const sql of ['DROP TABLE IF EXISTS order_items', 'DROP TABLE IF EXISTS fulfillments', 'DROP TABLE IF EXISTS payments', 'DROP TABLE IF EXISTS orders']) legacy.exec(sql);
    legacy.exec(LEGACY_ORDERS_DDL);
    legacy.exec(LEGACY_PAYMENTS_DDL);
    legacy.prepare("INSERT INTO orders (id, user_id, plan_id, region, cycle, currency, amount_minor, status, driver, created_at, updated_at) VALUES ('ord-legacy', 'u1', 'pro', 'cn', 'monthly', 'CNY', 1900, 'paid', 'wechat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    legacy.prepare("INSERT INTO payments (id, order_id, driver, amount_minor, currency, status, created_at) VALUES ('pay-legacy', 'ord-legacy', 'wechat', 1900, 'CNY', 'paid', '2026-01-01T00:00:00Z')").run();
    legacy.close();
  }; // downgrade 结束

  it('重开时原地重建为统一表，旧行整行归档且不丢字段', () => {
    downgrade();
    const upgraded = createDatabase(file); // 历史上这里会崩在 no such column: source
    const orderCols = (upgraded.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(orderCols).toContain('source');
    expect(orderCols).toContain('source_id');
    expect(orderCols).toContain('payable_cents');
    expect(orderCols).not.toContain('plan_id');
    const payCols = (upgraded.prepare('PRAGMA table_info(payments)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(payCols).toContain('provider');
    expect(payCols).toContain('amount_cents');
    expect(payCols).not.toContain('driver');
    // 旧行不能映射到统一交易域，必须原样进归档表，统一表保持干净
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(0);
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n).toBe(0);
    const archived = upgraded.prepare("SELECT payload_json FROM legacy_archive_orders WHERE id='ord-legacy'").get() as { payload_json: string } | undefined;
    expect(archived).toBeTruthy();
    expect(JSON.parse(archived!.payload_json).plan_id).toBe('pro');
    const archivedPay = upgraded.prepare("SELECT payload_json FROM legacy_archive_payments WHERE id='pay-legacy'").get() as { payload_json: string } | undefined;
    expect(archivedPay).toBeTruthy();
    expect(JSON.parse(archivedPay!.payload_json).provider_txn_id).toBeNull();
    const indexes = (upgraded.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toContain('ix_orders_source');
    upgraded.close();
  }); // it 结束

  it('结构混杂时抛错中止，不留任何副作用', () => {
    createDatabase(file).close(); // 先得到统一表（payments 保持统一结构）
    const mixed = new Database(file); // 只把 orders 退回订阅结构，构造混合形态
    mixed.pragma('foreign_keys = OFF');
    for (const sql of ['DROP TABLE IF EXISTS order_items', 'DROP TABLE IF EXISTS fulfillments', 'DROP TABLE IF EXISTS orders']) mixed.exec(sql);
    mixed.exec(LEGACY_ORDERS_DDL);
    mixed.prepare("INSERT INTO orders (id, user_id, plan_id, region, cycle, currency, amount_minor, status, driver, created_at, updated_at) VALUES ('ord-mixed', 'u1', 'pro', 'cn', 'monthly', 'CNY', 1900, 'paid', 'wechat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
    // orders=订阅结构 + payments=统一结构：守卫必须拒绝猜测，直接中止而不是删表
    expect(() => alignLegacyCommerceTables(mixed)).toThrow(/结构混合/);
    const cols = (mixed.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('plan_id'); // 旧行原样还在
    expect(cols).not.toContain('source'); // 没有被偷偷重建
    const tables = (mixed.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).not.toContain('legacy_archive_orders'); // 中止前不得产生归档表
    mixed.close();
  }); // it 结束

  it('重复启动不再重建、归档不膨胀', () => {
    downgrade();
    createDatabase(file).close(); // 第一次：执行重建
    const again = createDatabase(file); // 第二次：必须命中「已是统一表」直接返回
    expect((again.prepare('SELECT COUNT(*) AS n FROM legacy_archive_orders').get() as { n: number }).n).toBe(1);
    expect((again.prepare('SELECT COUNT(*) AS n FROM legacy_archive_payments').get() as { n: number }).n).toBe(1);
    expect((again.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(0);
    again.close();
  }); // it 结束
});
