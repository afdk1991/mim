// 升级路径回归：把「新库」退回成老库形状（删新列 / 删新表），再用 createDatabase 重开，
// 断言域脚本能补齐列与表且种子不炸。线上 502 的根因就是这条路径没被测到：
// 07-content.sql 只把 published_at 写进 CREATE TABLE IF NOT EXISTS，老库不会被补列，
// 随后种子 INSERT 显式引用该列 → 启动即 SQLITE_ERROR（no column named published_at）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'; // 用例骨架与断言
import { mkdtempSync, rmSync } from 'node:fs'; // 临时目录创建与清理
import { tmpdir } from 'node:os'; // 系统临时目录根
import { join } from 'node:path'; // 路径拼接
import Database from 'better-sqlite3'; // 直接改库结构，模拟老库形状
import { alignLegacyCommerceTables, createDatabase } from '../src/db.js'; // 被测的建库与对齐入口

// 老库退化动作：先删子表再删父表，最后删本轮新增列
const LEGACY_DROPS = [
  // 先删引用方（子表），再删父表，避免外键约束拦截
  'DROP TABLE IF EXISTS circle_posts', // 圈子帖子
  'DROP TABLE IF EXISTS circle_notices', // 圈子公告
  'DROP TABLE IF EXISTS circle_members', // 圈子成员
  'DROP TABLE IF EXISTS circles', // 圈子主表
  'DROP TABLE IF EXISTS cdn_purge_audit', // CDN 刷新审计
  'DROP TABLE IF EXISTS promotion_conversions', // 推广转化
  // 再删本轮新增的列，模拟「老库没有这些列」的真实形态
  'ALTER TABLE announcements DROP COLUMN published_at', // 公告发布时间
  'ALTER TABLE shop_orders DROP COLUMN points_spent', // 已花积分
  'ALTER TABLE shop_orders DROP COLUMN points_deduct_cents', // 积分抵扣金额（分）
]; // LEGACY_DROPS 结束

// 用例组一：存量库结构补齐
describe('存量库升级路径', () => {
  let dir = ''; // 临时目录
  let file = ''; // 临时库文件

  // 每个用例独立建库文件，避免互相污染
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-upgrade-')); // 新建临时目录
    file = join(dir, 'mim.sqlite'); // 库文件落在临时目录内
  }); // beforeEach 结束

  // 用例结束即删目录，防止残留影响下一次运行
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // Windows 下句柄释放有延迟，重试几次避免 EBUSY
  }); // afterEach 结束

  // 主用例：退化 → 重开 → 断言列与表被补齐
  it('老库删掉新列新表后重开，域脚本自动补齐且不抛错', () => {
    const first = createDatabase(file); // 建出新库（含本轮新增列/表）
    first.close(); // 关掉，模拟一次正常部署后的产物

    const legacy = new Database(file); // 直接改结构，退化成老库
    legacy.pragma('foreign_keys = OFF'); // 关外键，允许按任意顺序删表
    for (const sql of LEGACY_DROPS) legacy.exec(sql); // 逐条执行退化语句
    // 记录退化后的公告列，作为补齐前的对照
    const beforeCols = (legacy.prepare('PRAGMA table_info(announcements)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(beforeCols).not.toContain('published_at'); // 前置断言：确实退化成了缺列状态
    legacy.close(); // 关闭句柄，模拟「老库文件交给新版本」

    const upgraded = createDatabase(file); // 关键一步：新版代码打开老库，历史上这里会抛错
    // 补齐后 published_at 必须重新出现
    const afterCols = (upgraded.prepare('PRAGMA table_info(announcements)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(afterCols).toContain('published_at'); // 列被 ALTER_ADD 补回
    // 订单表的两个积分列同样应被补回
    const orderCols = (upgraded.prepare('PRAGMA table_info(shop_orders)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(orderCols).toContain('points_spent'); // 已花积分
    expect(orderCols).toContain('points_deduct_cents'); // 抵扣金额
    // 被删掉的表应由域脚本重建
    const tables = (upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const t of ['circles', 'circle_members', 'circle_posts', 'circle_notices', 'cdn_purge_audit', 'promotion_conversions']) {
      expect(tables).toContain(t); // 逐表确认已重建
    } // 重建表校验结束
    // 种子必须完整落地：公告三条 + 权限点 content:write 已授予内置超管
    const annCount = (upgraded.prepare('SELECT COUNT(*) AS n FROM announcements').get() as { n: number }).n;
    expect(annCount).toBeGreaterThanOrEqual(3); // 种子公告至少三条
    // 超管必须拿到 content:write，否则后台内容操作全 403
    const granted = upgraded.prepare("SELECT 1 AS ok FROM role_permissions WHERE role_code='superadmin' AND permission_code='content:write'").get() as { ok?: number } | undefined;
    expect(granted?.ok).toBe(1); // 授权行存在
    upgraded.close(); // 释放句柄
  }); // 主用例结束

  // 幂等用例：连续两次打开不得重复补列
  it('补齐后再次重开不得重复补列（幂等）', () => {
    // 同一路径连续打开两次：第二次域脚本应全部命中「列已存在」分支，
    // 若幂等失效会抛 duplicate column name，这条用例把重复启动的场景钉死。
    createDatabase(file).close(); // 第一次：建库并补列
    const upgraded = createDatabase(file); // 第二次：必须安全通过
    // 列只应出现一次，重复补列会变成两列
    const cols = (upgraded.prepare('PRAGMA table_info(announcements)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols.filter((c) => c === 'published_at')).toHaveLength(1); // 只保留一列
    upgraded.close(); // 释放句柄
  }); // 幂等用例结束
}); // 用例组一结束

// 订阅制时代的 orders / payments 是另一条更早的历史分支：表已存在但列完全是另一套。
// CREATE TABLE IF NOT EXISTS 会整表跳过，50-unified-commerce.sql 随后在旧 orders 上建 source 索引会直接报
// no such column: source —— 本地快照起不来就是这条路径。这里钉死「原地重建 + 旧行归档 + 幂等」。
const LEGACY_ORDERS_DDL = `CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id TEXT NOT NULL, region TEXT NOT NULL,
  cycle TEXT NOT NULL CHECK (cycle IN ('monthly','yearly')), currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','closed','refunded')),
  driver TEXT NOT NULL, provider_ref TEXT, idempotency_key TEXT, version INTEGER NOT NULL DEFAULT 1,
  paid_at TEXT, closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`; // 订阅制 orders 建表语句：列名与统一交易域不兼容

const LEGACY_PAYMENTS_DDL = `CREATE TABLE payments (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), driver TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
  provider_txn_id TEXT, created_at TEXT NOT NULL
)`; // 订阅制 payments 建表语句：driver 在统一域里改名为 provider

// 用例组二：订阅制老库迁移到统一交易域
describe('订阅制老库升级到统一交易域', () => {
  let dir = ''; // 临时目录
  let file = ''; // 临时库文件

  // 每个用例独立建库
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-legacy-commerce-')); // 新建临时目录
    file = join(dir, 'mim.sqlite'); // 库文件路径
  }); // beforeEach 结束

  // 用例结束即删目录
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // Windows 句柄释放有延迟，重试避免 EBUSY
  }); // afterEach 结束

  // 把新库退回订阅制形态，并留一条旧订单 / 旧支付作为归档样本
  const downgrade = () => {
    createDatabase(file).close(); // 先得到一份完整新库
    const legacy = new Database(file); // 直接改结构
    legacy.pragma('foreign_keys = OFF'); // 关外键，允许删父表
    // 删掉统一交易域的四张表，准备换成订阅制结构
    for (const sql of ['DROP TABLE IF EXISTS order_items', 'DROP TABLE IF EXISTS fulfillments', 'DROP TABLE IF EXISTS payments', 'DROP TABLE IF EXISTS orders']) legacy.exec(sql);
    legacy.exec(LEGACY_ORDERS_DDL); // 建订阅制 orders
    legacy.exec(LEGACY_PAYMENTS_DDL); // 建订阅制 payments
    legacy.prepare("INSERT INTO orders (id, user_id, plan_id, region, cycle, currency, amount_minor, status, driver, created_at, updated_at) VALUES ('ord-legacy', 'u1', 'pro', 'cn', 'monthly', 'CNY', 1900, 'paid', 'wechat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run(); // 写入一条旧订单样本
    legacy.prepare("INSERT INTO payments (id, order_id, driver, amount_minor, currency, status, created_at) VALUES ('pay-legacy', 'ord-legacy', 'wechat', 1900, 'CNY', 'paid', '2026-01-01T00:00:00Z')").run(); // 写入一条旧支付样本
    legacy.close(); // 释放句柄
  }; // downgrade 结束

  // 迁移主用例：原地重建 + 旧行整行归档
  it('重开时原地重建为统一表，旧行整行归档且不丢字段', () => {
    downgrade(); // 先造出订阅制老库
    const upgraded = createDatabase(file); // 历史上这里会崩在 no such column: source
    // orders 必带统一交易域的新增列
    const orderCols = (upgraded.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(orderCols).toContain('source'); // 来源
    expect(orderCols).toContain('source_id'); // 来源侧单号
    expect(orderCols).toContain('payable_cents'); // 应付金额（分）
    expect(orderCols).not.toContain('plan_id'); // 订阅制列必须消失
    // payments 由 driver 改名为 provider，金额列改名 amount_cents
    const payCols = (upgraded.prepare('PRAGMA table_info(payments)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(payCols).toContain('provider'); // 支付渠道
    expect(payCols).toContain('amount_cents'); // 金额（分）
    expect(payCols).not.toContain('driver'); // 旧列必须消失
    // 旧行不能映射到统一交易域，必须原样进归档表，统一表保持干净
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(0);
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n).toBe(0);
    // 归档表里应能按主键找回旧订单
    const archived = upgraded.prepare("SELECT payload_json FROM legacy_archive_orders WHERE id='ord-legacy'").get() as { payload_json: string } | undefined;
    expect(archived).toBeTruthy(); // 归档行存在
    expect(JSON.parse(archived!.payload_json).plan_id).toBe('pro'); // 旧字段原样保留
    // 旧支付同样整行归档，空字段不能丢
    const archivedPay = upgraded.prepare("SELECT payload_json FROM legacy_archive_payments WHERE id='pay-legacy'").get() as { payload_json: string } | undefined;
    expect(archivedPay).toBeTruthy(); // 归档行存在
    expect(JSON.parse(archivedPay!.payload_json).provider_txn_id).toBeNull(); // 空字段保持 null
    // 统一域索引必须建好，否则后续按来源查询会退化
    const indexes = (upgraded.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toContain('ix_orders_source'); // 来源索引存在
    upgraded.close(); // 释放句柄
  }); // 迁移主用例结束

  // 2026-11-16 回归：本地早期快照未必带全 driver 列，旧签名不完整也必须兜住
  it('orders 缺 source 且旧列签名不完整时同样重建，不再崩在 source 索引', () => {
    createDatabase(file).close(); // 先得到一份完整新库作底
    const partial = new Database(file); // 直接改结构，模拟更早期的半截订阅表
    partial.pragma('foreign_keys = OFF'); // 关外键，允许删父表
    for (const sql of ['DROP TABLE IF EXISTS order_items', 'DROP TABLE IF EXISTS fulfillments', 'DROP TABLE IF EXISTS payments', 'DROP TABLE IF EXISTS orders']) partial.exec(sql);
    // 只有 plan_id / amount_minor，没有 driver：修复前旧守卫因签名不全直接跳过，
    // 随后 50-unified-commerce.sql 在缺 source 的 orders 上建 ix_orders_source，启动崩在 no such column: source。
    partial.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id TEXT NOT NULL, amount_minor INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)');
    partial.prepare("INSERT INTO orders (id, user_id, plan_id, amount_minor, created_at) VALUES ('ord-partial', 'u1', 'pro', 1900, '2026-01-01T00:00:00Z')").run(); // 留一条旧行验证归档
    partial.close(); // 释放句柄
    const upgraded = createDatabase(file); // 修复前这里抛 SqliteError: no such column: source
    const cols = (upgraded.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((c) => c.name); // 重建后的列
    expect(cols).toContain('source'); // 统一域来源列已建出
    expect(cols).toContain('source_id'); // 来源侧单号
    const indexes = (upgraded.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((i) => i.name); // 索引清单
    expect(indexes).toContain('ix_orders_source'); // 关键索引建成功
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(0); // 统一表保持干净
    const archived = upgraded.prepare("SELECT payload_json FROM legacy_archive_orders WHERE id='ord-partial'").get() as { payload_json: string } | undefined; // 旧行归档
    expect(archived).toBeTruthy(); // 归档存在
    expect(JSON.parse(archived!.payload_json).plan_id).toBe('pro'); // 旧字段原样保留
    upgraded.close(); // 释放句柄
  }); // 半截订阅表回归结束

  // 统一子表仍有数据时不得重建父表（否则级联删明细）
  it('orders 非统一但 order_items 仍有数据时中止，不留副作用', () => {
    createDatabase(file).close(); // 完整新库作底
    const mixed = new Database(file); // 直接改结构
    mixed.pragma('foreign_keys = OFF'); // 关外键，允许换表
    for (const sql of ['DROP TABLE IF EXISTS order_items', 'DROP TABLE IF EXISTS payments', 'DROP TABLE IF EXISTS orders']) mixed.exec(sql);
    mixed.exec(LEGACY_ORDERS_DDL); // 换回订阅制 orders
    mixed.exec('CREATE TABLE order_items (id TEXT PRIMARY KEY)'); // 保留一张有数据的明细表
    mixed.exec("INSERT INTO order_items (id) VALUES ('oi-1')"); // 一行明细
    expect(() => alignLegacyCommerceTables(mixed)).toThrow(/order_items/); // 必须中止而不是级联清掉明细
    const cols = (mixed.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((c) => c.name); // 中止后 orders 原样
    expect(cols).toContain('plan_id'); // 旧表未被替换
    mixed.close(); // 释放句柄
  }); // 明细保护用例结束

  // 混杂结构必须中止而不是猜测
  it('结构混杂时抛错中止，不留任何副作用', () => {
    createDatabase(file).close(); // 先得到统一表（payments 保持统一结构）
    const mixed = new Database(file); // 只把 orders 退回订阅结构，构造混合形态
    mixed.pragma('foreign_keys = OFF'); // 关外键
    // 只删 orders 一侧，payments 保持统一结构
    for (const sql of ['DROP TABLE IF EXISTS order_items', 'DROP TABLE IF EXISTS fulfillments', 'DROP TABLE IF EXISTS orders']) mixed.exec(sql);
    mixed.exec(LEGACY_ORDERS_DDL); // 换回订阅制 orders
    mixed.prepare("INSERT INTO orders (id, user_id, plan_id, region, cycle, currency, amount_minor, status, driver, created_at, updated_at) VALUES ('ord-mixed', 'u1', 'pro', 'cn', 'monthly', 'CNY', 1900, 'paid', 'wechat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run(); // 写入一条旧订单
    // orders=订阅结构 + payments=统一结构：守卫必须拒绝猜测，直接中止而不是删表
    expect(() => alignLegacyCommerceTables(mixed)).toThrow(/结构混合/); // 抛结构混合错误
    // 中止后 orders 必须保持原样
    const cols = (mixed.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('plan_id'); // 旧行原样还在
    expect(cols).not.toContain('source'); // 没有被偷偷重建
    // 中止前不得留下归档表
    const tables = (mixed.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).not.toContain('legacy_archive_orders'); // 中止前不得产生归档表
    mixed.close(); // 释放句柄
  }); // 混杂用例结束

  // 幂等用例：重复启动不重建、归档不膨胀、生产结构原样保留
  it('重复启动不再重建、归档不膨胀，生产结构原样保留', () => {
    downgrade(); // 造订阅制老库
    const first = createDatabase(file); // 第一次：执行重建
    // 记下重建后的 DDL，作为「生产库不会被再次改动」的对照
    const ordersDdl = (first.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get() as { sql: string }).sql;
    const paymentsDdl = (first.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get() as { sql: string }).sql;
    first.close(); // 释放句柄
    const again = createDatabase(file); // 第二次：必须命中「已是统一表」直接返回
    expect(alignLegacyCommerceTables(again)).toBe(false); // 对齐逻辑不再动手
    expect((again.prepare('SELECT COUNT(*) AS n FROM legacy_archive_orders').get() as { n: number }).n).toBe(1); // 订单只归档一次
    expect((again.prepare('SELECT COUNT(*) AS n FROM legacy_archive_payments').get() as { n: number }).n).toBe(1); // 支付只归档一次
    expect((again.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n).toBe(0); // 统一表保持干净
    // 结构必须逐字一致：第二次启动不得替换或重建 orders / payments
    expect((again.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get() as { sql: string }).sql).toBe(ordersDdl); // orders DDL 未变
    expect((again.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get() as { sql: string }).sql).toBe(paymentsDdl); // payments DDL 未变
    again.close(); // 释放句柄
  }); // 幂等用例结束
}); // 用例组二结束
