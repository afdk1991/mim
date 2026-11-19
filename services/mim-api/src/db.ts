/** SQLite 连接与结构迁移 */

import Database from 'better-sqlite3'; // 引入 better-sqlite3 同步驱动，SQLite 读写走同步 API 便于事务内顺序执行
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'; // 文件系统工具：判断目录是否存在、递归建目录、读取建表脚本、枚举 schema.d 域脚本
import { dirname, join } from 'node:path'; // 取文件所在目录 / 拼接 schema.d 下的脚本路径
import { fileURLToPath } from 'node:url'; // 把 import.meta.url 转成文件系统路径，满足 ESM 下的路径解析
import type { Db } from './types.js'; // 仅引入数据库连接类型，编译期擦除不产生运行时代码
import { backfillMemberNos, renumberMemberNos } from './identity.js'; // 存量用户号码：一次性全量重排 + 缺号兜底补发
import { backfillUnifiedCommerce } from './commerce/unified.js'; // 统一交易域回填：三套历史订单 → orders / order_items（幂等）
import { backfillUnifiedContentMessaging } from './content/unified.js'; // 统一内容/消息域回填：论坛/圈子 → content_items，IM/私信 → conversations + messages（幂等）

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url)); // 以模块自身位置解析 schema.sql 绝对路径，保证任意工作目录下都能找到建表脚本

/**
 * 域外挂建表目录：schema.d/*.sql 由各业务域自行持有 DDL，按文件名升序执行。
 * 存在意义：并行开发时多个域各写各的文件，避免同改 schema.sql 产生冲突与合并事故。
 * 脚本内的正常语句必须幂等（CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / 幂等 INSERT）。
 */
const SCHEMA_DIR = fileURLToPath(new URL('./schema.d/', import.meta.url)); // 与 schema.sql 同级，构建时整目录搬运到 dist

/** schema.d 里的补列指令行：`ALTER_ADD: 表 列 <列定义>`，列已存在则跳过，保证老库与新库同一结构 */
const ALTER_ADD_RE = /^\s*ALTER_ADD:\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/; // 只放行合法标识符，列定义原样透传；末尾 \s* 吃掉 CRLF 残留的 \r

/** 允许出现在迁移语句里的标识符：只放行字母数字下划线，杜绝把外部字符串拼进 DDL */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/; // 表名/列名都必须匹配该正则，避免 ALTER TABLE 被注入

/**
 * 增量列迁移清单：schema.sql 只保证「全新建库」结构正确。
 * 已经在生产跑的库（`CREATE TABLE IF NOT EXISTS` 不会改动既有表）需要单独补列，
 * 否则新代码 SELECT 新列会直接报 `no such column`。
 *
 * 这里只做「加列」这一类无破坏迁移：
 *   - SQLite 的 ALTER TABLE ADD COLUMN 不允许「无默认值的 NOT NULL 列」，故定义一律带 DEFAULT；
 *   - 可空列表直接追加，旧行读出来是 NULL，语义即「尚未清理 / 尚未被回收」。
 */
const ADDITIVE_COLUMNS: ReadonlyArray<{ table: string; column: string; definition: string }> = [ // 只列真正需要向后兼容的列
  { table: 'im_messages', column: 'reply_to_id', definition: 'TEXT' }, // 引用回复的目标消息 ID（2026-11-11 聊天增强）
  { table: 'im_messages', column: 'reply_excerpt', definition: 'TEXT' }, // 被引用消息的快照摘要（发送时固化）
  { table: 'users', column: 'member_no', definition: 'TEXT' }, // 对外 Mim ID 号码（2026-11-12 注册自动分配编号）
  { table: 'users', column: 'is_guest', definition: 'INTEGER NOT NULL DEFAULT 0' }, // 历史兼容列（2026-11-15 起不再写入，恒为 0）
  { table: 'community_boards', column: 'visibility', definition: "TEXT NOT NULL DEFAULT 'public'" }, // 板块可见性：public / followers
  { table: 'community_boards', column: 'post_min_level', definition: 'INTEGER NOT NULL DEFAULT 0' }, // 发帖最低等级
  { table: 'community_boards', column: 'created_by', definition: 'TEXT' }, // 用户自建板块创建者
  { table: 'community_boards', column: 'moderator_id', definition: 'TEXT' }, // 板块版主
  { table: 'community_threads', column: 'accepted_post_id', definition: 'TEXT' }, // 问答采纳的回复 ID
  { table: 'paid_assets', column: 'media_json', definition: "TEXT NOT NULL DEFAULT '[]'" }, // 图库 / 视频媒体数组
]; // 清单结束：新增列必须先加到 schema.sql，再加到这里，两条路径才不会分叉

// 依赖「后加列」的索引：必须在补列之后再建，否则老库全量执行 schema.sql 时会因列不存在直接报错崩溃
const ADDITIVE_INDEXES: ReadonlyArray<{ name: string; sql: string }> = [ // 只放列由 ADDITIVE_COLUMNS 补出来的索引
  { // Mim ID 号码全局唯一：发号器已保证不重号，唯一索引是最后一道防线（人工补数据也会被挡）
    name: 'uq_users_member_no', // 与 identity.ts 的发号逻辑配套
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_users_member_no ON users(member_no) WHERE member_no IS NOT NULL', // 部分唯一：补列前历史行为 NULL，不参与约束
  }, // 索引定义结束
]; // 清单结束：新增依赖后加列的索引请加在这里，不要写进 schema.sql

/**
 * 幂等补列：列已存在则什么都不做，缺失才 ALTER TABLE 追加。
 * @returns true 表示本次真的执行了 ALTER；false 表示列本来就存在。
 */
export function ensureColumn(db: Db, table: string, column: string, definition: string): boolean { // 单列迁移的最小实现
  if (!IDENT_RE.test(table) || !IDENT_RE.test(column)) { // 标识符来自常量清单，仍显式校验一次
    throw new Error(`invalid identifier for migration: ${table}.${column}`); // 非法标识符直接拒绝，不拼进 SQL
  } // 标识符校验结束
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>; // 读取现有列定义
  if (columns.length === 0) throw new Error(`migration target table not found: ${table}`); // 表不存在说明 schema.sql 未执行，直接报错
  if (columns.some((c) => c.name === column)) return false; // 列已存在：幂等返回，避免重复 ALTER 报错
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); // 追加列：旧行按定义里的 DEFAULT/NULL 补齐
  return true; // 告知调用方发生了结构变更，便于启动日志留证
} // ensureColumn 结束

/**
 * 批量补齐增量列，返回本次真正新增的列名（形如 `shop_products.delivery_note`）。
 * 全新建库时全部已存在，返回空数组，不做任何结构变更。
 */
export function migrateAdditiveColumns(db: Db): string[] { // 启动期调用一次，随 createDatabase 执行
  const applied: string[] = []; // 收集本次变更，供启动日志与测试断言
  for (const item of ADDITIVE_COLUMNS) { // 逐列尝试补齐
    if (ensureColumn(db, item.table, item.column, item.definition)) { // 仅真正执行了 ALTER 才记录
      applied.push(`${item.table}.${item.column}`); // 记录变更点，避免结构变化静默发生
    } // 变更判定结束
  } // 清单循环结束
  return applied; // 返回变更清单，空数组代表无需迁移
} // migrateAdditiveColumns 结束

/**
 * 创建依赖后加列的索引（幂等）。必须在 migrateAdditiveColumns 之后调用：
 * 老库在 schema.sql 阶段还没有这些列，索引若写在 schema.sql 里会让进程启动即失败。
 * @returns 本次真正新建的索引名列表
 */
export function ensureAdditiveIndexes(db: Db): string[] {
  const applied: string[] = []; // 记录本次新建的索引，便于启动日志留证
  for (const item of ADDITIVE_INDEXES) { // 逐条执行
    const existed = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(item.name) as { name: string } | undefined; // 先查索引是否已存在
    db.exec(item.sql); // IF NOT EXISTS 保证重复启动幂等
    if (!existed) applied.push(item.name); // 只有真的新建才记录
  } // 循环结束
  return applied; // 返回新建清单，空数组代表无需变更
} // ensureAdditiveIndexes 结束

/**
 * 执行 schema.d/*.sql 域外挂脚本（按文件名升序，幂等）。
 * 支持的指令行：`ALTER_ADD: 表 列 <列定义>` —— 列不存在时补列，随后执行脚本其余语句。
 * 这样「新建库」与「存量库升级」走同一条路径，各域不必把列改到 migrateAdditiveColumns 清单里抢同一处。
 */
export function applyDomainSchema(db: Db): string[] { // 返回本轮新建的列清单，空数组代表无需变更
  if (!existsSync(SCHEMA_DIR)) return []; // 目录不存在（未启用域脚本）时静默跳过
  const applied: string[] = []; // 记录本轮补出来的列，便于启动日志留痕
  const files = readdirSync(SCHEMA_DIR) // 枚举域脚本
    .filter((name) => name.endsWith('.sql')) // 只认 .sql，忽略 README 等
    .sort(); // 文件名前缀即执行顺序（域名前缀保证稳定）
  for (const file of files) { // 逐脚本执行
    const body = readFileSync(join(SCHEMA_DIR, file), 'utf8'); // 读原文
    const rest: string[] = []; // 除指令行之外的正常 SQL
    // 本脚本自身会新建的表：指令行指向这些表时，全新库执行到指令那一刻表还不存在，
    // 此时跳过即可（列由下面的 CREATE TABLE 自带）；只有指向「非本脚本新建」的表才是真写错。
    const createdHere = new Set(
      Array.from(body.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)).map((m) => m[1]),
    );
    for (const line of body.split(/\r?\n/)) { // 逐行扫描，只剥离指令行；兼容 CRLF 检出（Windows 工作树），否则指令行漏匹配会在 exec 时报 ALTER_ADD 语法错
      const directive = line.match(ALTER_ADD_RE); // 命中补列指令
      if (!directive) { rest.push(line); continue; } // 普通语句原样保留
      const [, table, column, definition] = directive; // 解构出表 / 列 / 定义
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>; // 读现有列
      if (columns.length === 0) { // 表还不存在：两种情况要分开处理
        if (createdHere.has(table)) continue; // 全新库：本脚本马上会建表并自带该列，跳过即可（存量库走到这里说明表存在，不受影响）
        throw new Error(`ALTER_ADD target table not found: ${table}.${column}`); // 指向别处的表名写错，直接失败
      }
      if (columns.some((item) => item.name === column)) continue; // 已存在则跳过，保证重复启动幂等
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); // 补列：旧行按 DEFAULT 填充
      applied.push(`${table}.${column}`); // 留痕
    }
    const sql = rest.join('\n'); // 还原正常语句
    if (sql.trim().length > 0) db.exec(sql); // 空脚本不执行，避免 better-sqlite3 抛错
  }
  return applied; // 返回补列清单
} // applyDomainSchema 结束

/**
 * 统一订单来源约束扩容（2026-11-15 付费阅读）：orders.source 需要接纳 'community'。
 * SQLite 改不了既有 CHECK，按官方 12 步法重建表；关外键是为了让 DROP TABLE 的隐式 DELETE
 * 不触发 order_items / payments / fulfillments 的级联删除，重建后再按原主键挂回。
 * 新库由 50-unified-commerce.sql 直接建出含 community 的表，这里检测到后跳过（幂等）。
 * @returns 是否真的执行了重建
 */
export function ensureOrderSourceCommunity(db: Db): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string } | undefined; // 读建表原文
  if (!row || row.sql.includes("'community'")) return false; // 表不存在（未启用域脚本）或已扩容：无需处理
  db.pragma('foreign_keys = OFF'); // 重建期间关外键，避免删父表时级联清掉明细 / 支付 / 履约
  try {
    db.transaction(() => { // 建表 → 拷数据 → 删旧表 → 改名，全程原子
      db.exec(`CREATE TABLE orders_source_migrate (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL REFERENCES users(id),
        source         TEXT NOT NULL CHECK (source IN ('shop','asset','community')),
        source_id      TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','delivered','refunded','cancelled')),
        channel        TEXT NOT NULL DEFAULT 'manual',
        currency       TEXT NOT NULL DEFAULT 'CNY',
        total_cents    INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
        discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
        payable_cents  INTEGER NOT NULL DEFAULT 0 CHECK (payable_cents >= 0),
        created_at     TEXT NOT NULL,
        paid_at        TEXT,
        UNIQUE (source, source_id)
      )`); // 与 50-unified-commerce.sql 的 orders 完全同构，仅 CHECK 多一个 community
      db.exec(`INSERT INTO orders_source_migrate (id, user_id, source, source_id, status, channel, currency,
                 total_cents, discount_cents, payable_cents, created_at, paid_at)
               SELECT id, user_id, source, source_id, status, channel, currency,
                      total_cents, discount_cents, payable_cents, created_at, paid_at FROM orders`); // 原样搬数据
      db.exec('DROP TABLE orders'); // 旧约束随表一起消失
      db.exec('ALTER TABLE orders_source_migrate RENAME TO orders'); // 子表按表名引用，改回原名即恢复关联
      db.exec('CREATE INDEX IF NOT EXISTS ix_orders_user_created ON orders (user_id, created_at DESC)'); // 重建索引
      db.exec('CREATE INDEX IF NOT EXISTS ix_orders_source ON orders (source, source_id)'); // 重建索引
    })();
  } finally {
    db.pragma('foreign_keys = ON'); // 无论成败都恢复外键约束
  }
  return true;
}

/** 旧订阅制 payments 的特征列 */
const LEGACY_PAYMENT_COLUMNS = ['driver', 'amount_minor', 'provider_txn_id'] as const; // 三列同时存在且没有 provider/amount_cents，才认定是旧订阅结构

/** 读取表名对应的列名集合；表不存在返回空集合 */
function columnSet(db: Db, table: string): Set<string> { // 结构判定统一走 PRAGMA，避免解析 DDL 文本
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>; // 列定义列表
  return new Set(rows.map((row) => row.name)); // 转成集合便于 O(1) 判定
} // columnSet 结束

/**
 * 把「订阅制时代」的 orders / payments 原地升级为统一交易域结构。
 *
 * 背景：本地 data/mim.db 是早期快照，orders 还是 16 列订阅结构（plan_id / amount_minor / driver，没有 source）。
 * schema.d 的 CREATE TABLE IF NOT EXISTS 遇到同名旧表会整表跳过，随后 50-unified-commerce.sql 在旧 orders 上
 * 建 `ix_orders_source ON orders(source, source_id)` 时直接报 `no such column: source`，进程启动即失败。
 *
 * 处理原则：
 *   - orders 是否统一只看 source / source_id 两列：缺任一列即视为「非统一结构」，无论旧列签名是否完整都走原地重建。
 *     2026-11-16 复盘：此前要求 plan_id / amount_minor / driver 三列齐全才认旧表，缺 driver 的早期快照会绕过守卫，
 *     继续交给 50-unified-commerce.sql 建 ix_orders_source，最终仍以 no such column: source 崩在 applyDomainSchema 的 db.exec。
 *   - payments 仍按订阅签名识别；orders / payments 两侧结构不一致，或统一子表（order_items / fulfillments）仍有数据，
 *     一律抛错中止，绝不猜测性 DROP。
 *   - 旧行无法映射到统一交易域（订阅计划在现行代码里已无对应源订单），整行 JSON 归档到 legacy_archive_orders / legacy_archive_payments 后再重建空表。
 *   - 已是统一表时直接返回 false，重复启动无副作用；重建后由 50-unified-commerce.sql 负责建表与索引，避免 DDL 两处维护。
 * @returns 是否真的执行了重建
 */
export function alignLegacyCommerceTables(db: Db): boolean {
  const ordersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string } | undefined; // 读 orders 建表原文
  if (!ordersSql) return false; // 表不存在（全新库 / 尚未由域脚本建表）：交给 50-unified-commerce.sql
  const orderCols = columnSet(db, 'orders'); // 现有 orders 列
  const paymentCols = columnSet(db, 'payments'); // 现有 payments 列（表不存在时为空集合）
  const hasPayments = paymentCols.size > 0; // payments 是否存在
  const unifiedOrders = orderCols.has('source') && orderCols.has('source_id'); // 统一交易域的判定只看这两列，避免旧表换一副面孔就绕过守卫
  const legacyPayments = hasPayments && !paymentCols.has('provider') && !paymentCols.has('amount_cents') && LEGACY_PAYMENT_COLUMNS.every((col) => paymentCols.has(col)); // 严格旧签名
  if (unifiedOrders) { // 已是统一表（生产库走这条）
    if (legacyPayments) {
      throw new Error('[db] orders 已是统一结构但 payments 仍是订阅结构：结构混合，已中止升级，请归档本地库后重建'); // 混合结构不动手
    }
    return false; // 已是统一结构：幂等返回，不对生产库做任何 DDL
  }
  if (hasPayments && !legacyPayments) {
    throw new Error('[db] orders 不是统一结构但 payments 也不是订阅结构：结构混合，已中止升级，请归档本地库后重建'); // 两侧结构不一致时不猜测性删除
  }
  const tableHasRows = (table: 'order_items' | 'fulfillments'): boolean => { // 统一子表若有数据，重建父表会级联清掉
    const exists = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { ok: number } | undefined; // 子表可能尚未创建
    if (!exists) return false; // 不存在即无数据
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n > 0; // 只判断是否有行
  }; // tableHasRows 结束
  if (tableHasRows('order_items') || tableHasRows('fulfillments')) {
    throw new Error('[db] orders 不是统一结构但 order_items/fulfillments 仍有数据：结构混合，已中止升级，请归档本地库后重建'); // 拒绝静默丢明细
  }
  const archivedAt = new Date().toISOString(); // 归档时间统一取一次，便于对照
  db.exec('CREATE TABLE IF NOT EXISTS legacy_archive_orders (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, archived_at TEXT NOT NULL)'); // 旧订单整行归档
  db.exec('CREATE TABLE IF NOT EXISTS legacy_archive_payments (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, archived_at TEXT NOT NULL)'); // 旧支付整行归档
  const archiveAll = (table: 'orders' | 'payments'): number => { // 把旧表所有行原样序列化归档
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>; // 读取旧行
    const insert = db.prepare(`INSERT OR REPLACE INTO legacy_archive_${table} (id, payload_json, archived_at) VALUES (?, ?, ?)`); // 幂等写入归档表
    for (const row of rows) insert.run(String(row.id), JSON.stringify(row), archivedAt); // 整行 JSON 保留所有旧字段
    return rows.length; // 返回归档行数
  }; // archiveAll 结束
  const archivedOrders = archiveAll('orders'); // 订单先归档
  const archivedPayments = hasPayments ? archiveAll('payments') : 0; // 支付表不存在时无需归档
  const unifiedSql = readFileSync(join(SCHEMA_DIR, '50-unified-commerce.sql'), 'utf8'); // 重建 DDL 直接复用域脚本，避免两处维护
  db.pragma('foreign_keys = OFF'); // 关外键：DROP 旧表不能级联清掉 order_items / fulfillments
  try {
    db.transaction(() => { // 删旧表 + 建统一表必须原子完成
      if (hasPayments) db.exec('DROP TABLE payments'); // 先删引用 orders 的子表
      db.exec('DROP TABLE orders'); // 再删父表
      db.exec(unifiedSql); // 按当前统一交易域 DDL 重建 orders / payments / order_items / fulfillments / products 与索引
    })();
  } finally {
    db.pragma('foreign_keys = ON'); // 无论成败都恢复外键约束
  }
  console.log(`[db] legacy subscription commerce rebuilt: archived ${archivedOrders} orders / ${archivedPayments} payments -> legacy_archive_orders/payments`); // 重建与归档必须留痕
  return true; // 告知调用方发生了结构变更
} // alignLegacyCommerceTables 结束

export function createDatabase(filename: string = ':memory:'): Db { // 创建数据库连接：默认内存库（测试用），传路径则落盘持久化
  if (filename !== ':memory:') { // 内存库没有文件系统目录，无需准备目录
    const dir = dirname(filename); // 取数据库文件所在目录
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); // 目录不存在则递归创建，避免首次启动因缺目录直接失败
  } // 目录准备结束
  const db = new Database(filename); // 打开或创建数据库文件 / 内存库
  db.pragma('foreign_keys = ON'); // 开启外键约束，保证关联表引用完整性
  if (filename !== ':memory:') db.pragma('journal_mode = WAL'); // 落盘库启用 WAL，提升读写并发并降低写阻塞（内存库不支持）
  db.exec(readFileSync(SCHEMA_PATH, 'utf8')); // 执行建表脚本，全部 IF NOT EXISTS 以便每次启动幂等
  alignLegacyCommerceTables(db); // 先处理订阅制老库：否则域脚本在旧 orders 上建 source 索引会直接崩溃
  const domainApplied = applyDomainSchema(db); // 各业务域的 schema.d 脚本：建新表 / 补新列，与主脚本同一幂等路径
  if (domainApplied.length > 0) console.log(`[db] domain schema applied: ${domainApplied.join(', ')}`); // 域脚本改结构必须留痕
  if (ensureOrderSourceCommunity(db)) console.log('[db] orders.source widened: community'); // 存量库放宽 CHECK，必须留痕
  const migrated = migrateAdditiveColumns(db); // 存量库补齐后加的列；全新建库时为空
  if (migrated.length > 0) console.log(`[db] additive migration applied: ${migrated.join(', ')}`); // 结构变更必须留痕，便于排查升级后的行为差异
  const indexed = ensureAdditiveIndexes(db); // 补列之后才建依赖这些列的唯一索引，避免老库启动即报 no such column
  if (indexed.length > 0) console.log(`[db] additive index created: ${indexed.join(', ')}`); // 同样留痕，便于确认回调幂等约束已生效
  seedRbac(db); // 写入内置权限点与内置角色，保证首启即有可用的 RBAC 基线
  seedCommunity(db); // 写入社区板块 / 官方帖 / VIP 套餐 / 独立商品 / 卡密 / 优惠码，保证新库开箱可用
  seedCommerce(db); // 写入付费资产 / 主题 / 页面区块，保证保留模块开箱有内容
  const unified = backfillUnifiedCommerce(db); // 统一交易域回填：把三套历史订单写进 orders（幂等，UNIQUE(source, source_id) 保证重复启动不加行）
  if (unified.orders > 0 || unified.items > 0) console.log(`[db] unified commerce backfilled: ${unified.orders} orders / ${unified.items} items / ${unified.products} products`); // 回填必须留痕，便于核对迁移结果
  const unifiedContent = backfillUnifiedContentMessaging(db); // 统一内容与消息域回填：论坛/圈子内容 → content_items，IM/私信 → conversations + messages
  if (unifiedContent.content > 0 || unifiedContent.messages > 0) console.log(`[db] unified content/messaging backfilled: ${unifiedContent.content} content / ${unifiedContent.conversations} conversations / ${unifiedContent.messages} messages`); // 同样留痕
  const renumbered = renumberMemberNos(db, new Date().toISOString()); // 存量用户一次性重排为纯数字 Mim ID（跳过全部靓号），幂等开关存在 member_no_meta
  if (renumbered.length > 0) console.log(`[db] member_no renumbered: ${renumbered.length} users`); // 改号必须留痕，旧号同时写入 member_no_history
  const backfilled = backfillMemberNos(db); // 缺号兜底补发（重排完成后通常为空操作）
  if (backfilled > 0) console.log(`[db] member_no backfilled: ${backfilled} users`); // 补号必须留痕，便于核对号码连续性
  return db; // 返回已完成初始化的连接
} // createDatabase 结束

/** 内置权限点清单：路由侧 requirePermission 与后台角色编辑页共用同一份定义 */
export const RBAC_PERMISSIONS = [ // 权限点数组，顺序即后台展示顺序
  { code: 'user:read', name: { 'zh-CN': '查看用户', 'en-US': 'Read users' } }, // 查询用户列表与详情
  { code: 'rbac:read', name: { 'zh-CN': '查看角色权限', 'en-US': 'Read roles' } }, // 读取角色、权限与授权关系
  { code: 'rbac:write', name: { 'zh-CN': '管理角色权限', 'en-US': 'Manage roles' } }, // 增删角色、改权限、改用户角色
  { code: 'commerce:write', name: { 'zh-CN': '处理交易与资金', 'en-US': 'Manage commerce' } }, // 发货、售后审核、提现审核等交易侧写操作
  { code: 'appearance:write', name: { 'zh-CN': '管理外观与页面', 'en-US': 'Manage appearance' } }, // 主题、导航、配色与页面区块配置
  { code: 'content:write', name: { 'zh-CN': '维护内容运营', 'en-US': 'Manage content' } }, // 公告、更新日志、推广计划的维护与发布归档
  { code: 'messaging:write', name: { 'zh-CN': '发送系统私信', 'en-US': 'Send system direct messages' } }, // 成长私信：按条件挑选用户并发送系统身份私信（含群发幂等台账）
  { code: 'deployments:read', name: { 'zh-CN': '查看部署汇总', 'en-US': 'Read deployments' } }, // 2026-11-15 运维数据收口：部署项清单仅后台可见，不再对访客公开
] as const; // 断言字面量常量，使 code 收窄为联合类型供 TS 校验

/** 权限点编码联合类型：路由调用处传错字符串会在编译期报错 */
export type RbacPermissionCode = (typeof RBAC_PERMISSIONS)[number]['code'];

/** 内置角色定义：code 稳定不变，名称与描述支持多语言，permissions 为基线权限集合 */
export const RBAC_ROLES = [ // 内置角色数组，同样决定后台展示顺序
  { // 超级管理员：拥有全部权限，不可删除
    code: 'superadmin', // 角色码，路由与后台按此判定超管
    name: { 'zh-CN': '超级管理员', 'en-US': 'Super Admin' }, // 多语言名称
    description: { 'zh-CN': '拥有全部权限，可管理角色与用户授权', 'en-US': 'Full access including role and user administration' }, // 多语言描述
    permissions: RBAC_PERMISSIONS.map((p) => p.code), // 基线权限即全部权限点，后续新增权限点会自动补齐
  }, // superadmin 结束
  { // 运营管理员：可处理交易与内容运营，不可改角色授权
    code: 'operator', // 角色码
    name: { 'zh-CN': '运营管理员', 'en-US': 'Operator' }, // 多语言名称
    description: { 'zh-CN': '可处理交易、内容与外观配置，可查看用户', 'en-US': 'Manage commerce, content and appearance, read users' }, // 多语言描述
    permissions: [ // 运营侧基线权限
      'user:read', // 需要按用户查业务记录
      'rbac:read', // 需要知道自己持有哪些权限
      'commerce:write', // 需要发货、审售后与审提现
      'appearance:write', // 需要维护首页与论坛的外观配置
      'messaging:write', // 需要向用户发送成长私信
    ] as const, // 断言常量，元素类型须落在 RbacPermissionCode 内
  }, // operator 结束
  { // 只读观察者：仅供审计与客服查询
    code: 'viewer', // 角色码
    name: { 'zh-CN': '只读观察员', 'en-US': 'Viewer' }, // 多语言名称
    description: { 'zh-CN': '只读查看用户与业务记录，不能产生任何写操作', 'en-US': 'Read-only access to users and business records' }, // 多语言描述
    permissions: [ // 只读基线权限
      'user:read', // 查看用户
      'rbac:read', // 查看自己的角色与权限
    ] as const, // 断言常量
  }, // viewer 结束
] as const; // 断言字面量常量，避免 code 等字段被拓宽为 string

/**
 * RBAC 种子：写入内置权限点、内置角色与角色权限映射。
 *
 * 幂等策略：
 *   - 权限点 / 角色用 ON CONFLICT DO UPDATE，刷新名称与描述；
 *   - 角色权限映射用 INSERT OR IGNORE，**只补不删**，
 *     避免每次启动把后台给内置角色额外追加的权限抹掉。
 */
export function seedRbac(db: Db): void { // RBAC 种子入口，随 createDatabase 每次启动执行
  const now = new Date().toISOString(); // 同一批次统一时间戳，便于事后按批次核对

  const upsertPermission = db.prepare( // 预编译权限点 upsert 语句
    `INSERT INTO permissions (code, name_i18n, description_i18n, builtin, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       name_i18n = excluded.name_i18n,
       builtin = 1,
       updated_at = excluded.updated_at`, // 冲突时只刷新名称与时间，保留原有 created_at
  ); // prepare 结束

  const upsertRole = db.prepare( // 预编译角色 upsert 语句
    `INSERT INTO roles (code, name_i18n, description_i18n, builtin, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       name_i18n = excluded.name_i18n,
       description_i18n = excluded.description_i18n,
       builtin = 1,
       updated_at = excluded.updated_at`, // 内置角色的名称与描述以代码为准，避免被后台随意改坏
  ); // prepare 结束

  const insertRolePermission = db.prepare( // 预编译角色权限映射插入语句
    `INSERT OR IGNORE INTO role_permissions (role_code, permission_code, created_at)
     VALUES (?, ?, ?)`, // OR IGNORE 保证重复执行不报主键冲突，且不删除后台追加的权限
  ); // prepare 结束

  const seed = db.transaction(() => { // 包成事务：任一语句失败整体回滚，避免出现半套角色
    for (const permission of RBAC_PERMISSIONS) { // 逐条写入内置权限点
      upsertPermission.run( // 按占位符顺序绑定
        permission.code, // 权限码，如 commerce:write
        JSON.stringify(permission.name), // 多语言名称序列化落库
        '{}', // 内置权限暂无描述，保留空对象以便后台后续补充
        now, // 创建时间
        now, // 更新时间
      ); // run 结束
    } // 权限点循环结束
    for (const role of RBAC_ROLES) { // 逐条写入内置角色
      upsertRole.run( // 按占位符顺序绑定
        role.code, // 角色码，如 operator
        JSON.stringify(role.name), // 多语言名称
        JSON.stringify(role.description), // 多语言描述
        now, // 创建时间
        now, // 更新时间
      ); // run 结束
      for (const permissionCode of role.permissions) { // 逐条补齐该角色的基线权限
        insertRolePermission.run(role.code, permissionCode, now); // 已存在则忽略，保证幂等
      } // 权限循环结束
    } // 角色循环结束
  }); // 事务函数准备完成
  seed(); // 执行事务
} // seedRbac 结束

/**
 * 社区与变现种子：板块、官方帖、VIP 套餐、独立商品、自动发货卡密、充值卡与优惠码。
 * 全部使用稳定主键 + INSERT OR IGNORE，重复启动不覆盖用户已产生的数据。
 */
export function seedCommunity(db: Db): void {
  const now = new Date().toISOString();
  const insertBoard = db.prepare(
    `INSERT OR IGNORE INTO community_boards (id, slug, name, description, icon, sort_order, price_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ); // 价格随种子逐板块写入：付费板块带定价，其余板块为 0；INSERT OR IGNORE 不覆盖生产已有行
  const insertThread = db.prepare(
    `INSERT OR IGNORE INTO community_threads
       (id, board_id, author_id, title, summary, body, kind, cover_url, price_cents, status, views, likes, reply_count, recommend_score, created_at, updated_at, last_activity_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'published', ?, 0, 0, 0, ?, ?, ?)`, // likes / recommend_score 显式写 0：二者只由真实互动（点赞记录 / 浏览等）产生，不随种子预置
  );
  // 图库 / 视频示例媒体：复用帖子媒体表，稳定主键 + INSERT OR IGNORE，避免重启重复插入
  const insertMedia = db.prepare(
    `INSERT OR IGNORE INTO community_thread_media
       (id, thread_id, kind, url, poster_url, storage_key, poster_key, mime, size_bytes, duration_seconds, width, height, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, 0, 0, ?, ?)`,
  );
  // 灰度公告：独立于社区帖子，公开列表按置顶 + 时间展示
  const insertAnnouncement = db.prepare(
    `INSERT OR IGNORE INTO announcements
       (id, title, body, level, status, published_at, starts_at, ends_at, pinned, author_id, created_at, updated_at)
     VALUES (?, ?, ?, 'warning', 'published', ?, ?, '2099-12-31T23:59:59.000Z', 1, 'system', ?, ?)`,
  );
  const insertVip = db.prepare(
    `INSERT OR IGNORE INTO vip_plans (id, code, name, level, price_cents, duration_days, perks, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const insertProduct = db.prepare(
    `INSERT OR IGNORE INTO shop_products (id, code, name, summary, kind, price_cents, cover_url, stock, delivery_note, status, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  );
  const insertShopKey = db.prepare(
    `INSERT OR IGNORE INTO shop_card_keys (id, product_id, code, status, created_at) VALUES (?, ?, ?, 'unused', ?)`,
  );
  const insertWalletCard = db.prepare(
    `INSERT OR IGNORE INTO wallet_cards (id, code, amount_cents, status, created_at) VALUES (?, ?, ?, 'unused', ?)`,
  );
  const insertCoupon = db.prepare(
    `INSERT OR IGNORE INTO coupons (id, code, kind, value, min_amount_cents, max_uses, used_count, active)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
  );
  const seed = db.transaction(() => {
    // 元组结构：[主键, slug, 名称, 描述, 图标, 排序, 定价(分)]；付费板块与生产口径对齐为 1900 分
    const boards: Array<[string, string, string, string, string, number, number]> = [
      ['board-guides', 'guides', '使用指南', '各板块规则、玩法说明与常见问题', '📘', 0, 0],
      ['board-general', 'general', '综合讨论', '产品、技术与任何值得聊的话题', '💬', 1, 0],
      ['board-open-source', 'open-source', '开源项目', '自研工具与开源项目发布、更新日志', '📦', 2, 0],
      ['board-tools', 'tools', '自研工具', 'Quick Build WP、换域名插件、流盾 WAF 等工具', '🛠️', 3, 0],
      // 付费板块：描述与定价对齐生产（1900 分 = ¥19.00）；新库安装即一致，存量行由 INSERT OR IGNORE 保留
      ['board-paid', 'paid', '知识付费', '付费板块：付费阅读、资源下载、图库与视频，加入后可见完整正文与媒体。', '🔖', 4, 1900],
      ['board-help', 'help', '求助答疑', '部署、支付、短信、CDN 与伪静态问题', '🆘', 5, 0],
      ['board-announce', 'announce', '公告', '产品公告、更新日志与推广计划', '📣', 6, 0],
    ];
    for (const [id, slug, name, description, icon, sort, price] of boards) {
      insertBoard.run(id, slug, name, description, icon, sort, price, now);
    }
    // 公告板块种子帖的现行文案：2026-11-15 起全站强制登录，不再出现「全站免登录 / 访客交易」这类已废除口径。
    const announceTitle = '2026-11-12 更新：商城商品视觉上线'; // 标题只保留真实上线内容
    const announceSummary = '商品封面与参数详情图上线记录。'; // 摘要同步去掉访客口径
    const announceBody = '本轮更新：\n1. 商城卡片加封面、分类角标、价格角标。\n2. 商品详情加 11 项参数表与参数长图。\n3. 结算链路与积分抵扣口径统一。'; // 正文只写功能变化
    const threads: Array<[string, string, string, string, string, string, string | null, number, number, number]> = [
      ['thread-store-visual', 'board-open-source', 'Mim 商城商品视觉改造全记录：19 张分类封面 + 参数详情图', '从纯文字卡片到封面、参数键值表与 900×1180 参数长图，附线上取证。', '商城改造的关键不是“有图”，而是让 205 条模块都能被同一套数据驱动视觉覆盖。\n\n做法：19 个一级分类各一张 3:2 封面；卡片左上分类角标、右上价格角标；详情首屏 11 项参数键值表 + 900×1180 SVG 参数图。\n\n线上实测：cards=12、封面 naturalWidth=768、specRows=11、参数图 900×1180。', 'text', '/catalog/dev.jpg', 0, 0, 5],
      ['thread-quick-build', 'board-tools', 'Quick Build WP：宝塔 + 环境 + WordPress 一键装', '一条命令完成宝塔、LNMP 与 WordPress 初始化，附常见失败排查。', 'Quick Build WP 把建站最常见的三段工作合成一个可重放脚本：安装宝塔、拉起 LNMP、初始化 WordPress。\n\n失败排查顺序：先看 80/443 端口占用，再看 PHP 版本与伪静态，最后查数据库权限。', 'text', '/catalog/tools.jpg', 0, 0, 2],
      ['thread-paid-store', 'board-paid', '付费阅读：从 0 到 1 做一个能收款的独立商城', '商品类型、卡密、优惠码、物流、退款与分成的完整拆解。', '这篇是付费内容：把独立商城拆成商品、订单、支付、履约、售后、资金六层，并给出每层的最小可用实现。\n\n如果你只想先跑通，优先做“虚拟自动发货 + 卡密库存 + 余额扣款”，再接支付渠道。', 'text', '/catalog/store.jpg', 1900, 0, 3],
      ['thread-comic-demo', 'board-open-source', '漫剧 AI 剧成片演示：分镜到成片全链路', '从剧本、角色一致性到分镜、成片导出，附演示片入口。', '演示片覆盖：剧本拆场、角色设定、分镜图、镜头运动、配音与成片导出。\n\n放映厅可直接观看，创作工作台可复制同一条链路。', 'video', '/catalog/ai.jpg', 0, 0, 4],
      ['thread-cover-design', 'board-paid', '19 张分类封面设计拆解：为什么不是 205 张', '按一级分类复用封面的取舍、体积控制与子路径兼容。', '按分类复用封面的理由：205 张独立图会让仓库与构建体积膨胀，且分类内商品视觉一致性更重要。\n\n体积控制：768px 宽 3:2 JPEG，单张 32–82 KB；路径用 import.meta.env.BASE_URL 拼，兼容 GitHub Pages 的 /mim/ 子路径。', 'gallery', '/catalog/frontier.jpg', 0, 0, 3],
      ['thread-announce', 'board-announce', announceTitle, announceSummary, announceBody, 'text', '/catalog/misc.jpg', 0, 0, 6],
      // 八大板块使用指南：全部落在社区帖子体系内，匿名可读、可被搜索命中，正文不写内部实现与凭据
      ['thread-guide-forum', 'board-guides', '论坛使用指南：发帖、提问与互动规则', '板块与圈子的区别、发帖步骤、提问与采纳、举报与删帖口径。', '论坛是 Mim 社区的主体内容区。当前分为使用指南、综合讨论、开源项目、自研工具、知识付费、求助答疑与公告七个板块。\n\n怎么发帖：登录后进入论坛页，选择板块，点「发帖」，填写标题、正文与可选图集或视频后发布。标题写清问题或结论，正文补充环境、操作步骤与报错原文。\n\n提问与采纳：求助类帖子可在回复中选择一条「采纳」，采纳后问题标记为已解决，方便后来人检索。\n\n互动规则：禁止广告、人身攻击与侵权内容；转载需注明来源。违规内容会被删除，重复违规会限制发帖。\n\n常见问题：匿名可以浏览和搜索帖子，发帖、回复与点赞需要登录；找不到板块时先用搜索，再到「求助答疑」发帖。\n\n当前为灰度测试版，规则与栏目可能继续调整。', 'text', '/catalog/misc.jpg', 0, 0, 0],
      ['thread-guide-gallery', 'board-guides', '图库使用指南：浏览、检索、收藏与上传', '图库聚合什么、如何筛选与收藏、上传格式与付费帖可见性。', '图库把社区帖子里的图片媒体聚合成瀑布流，按最新上传排序，可按「帖子 / 作者」聚合浏览。\n\n浏览：匿名可直接查看公开图片；点开图片进入灯箱，可看到所属帖子标题与作者，点标题会跳回原帖。\n\n筛选：顶部支持按板块筛选；付费帖内的图片遵循原帖付费墙，未解锁只显示提示，不加载原图。\n\n收藏：登录后可收藏或取消收藏图片，收藏列表只对自己可见。\n\n上传：发帖时选择图片媒体上传，支持 JPG、PNG 与 WebP，单张建议不超过 5 MB；复用站内既有媒体链路，不额外保存副本。\n\n常见问题：看不到内容时先确认板块筛选是否过窄，或该帖子是否处于审核、下架状态。\n\n当前为灰度测试版，聚合方式与筛选维度可能调整。', 'text', '/catalog/frontier.jpg', 0, 0, 0],
      ['thread-guide-video', 'board-guides', '视频使用指南：播放、上传与付费可见性', '视频如何播放、上传要填什么、付费帖视频何时可见。', '视频页聚合社区帖子里的视频媒体，卡片显示封面、时长与所属帖子。\n\n播放：点击卡片进入灯箱播放，支持暂停、进度与全屏；移动端使用内联播放，不自动全屏。\n\n上传：发帖时选择视频媒体，并上传封面；建议 MP4（H.264 + AAC），单个文件不超过 200 MB。\n\n付费可见性：付费帖内的视频与原帖一致，作者与 VIP 会员免购；未解锁时列表只显示封面与提示，不加载视频地址。\n\n常见问题：视频一直转圈时先检查网络并刷新页面；仍失败请在「求助答疑」反馈帖子链接与设备信息。\n\n当前为灰度测试版，转码与清晰度策略可能调整。', 'text', '/catalog/ai.jpg', 0, 0, 0],
      ['thread-guide-announce', 'board-guides', '公告动态使用指南：公告、更新日志与推广计划', '四类信息的区别、置顶与有效期、如何查历史。', '公告动态集中展示四类信息：产品公告、更新日志、推广计划与社区动态。\n\n区别：公告用于临时通知，例如维护、灰度与活动；更新日志按版本记录功能变化；推广计划展示当前活动与合作；社区动态是社区内的最新帖子摘要。\n\n置顶与有效期：重要公告会置顶；过期公告自动从公开列表隐藏，历史仍可查询。\n\n查看：页签内可切换分类，列表按发布时间倒序；点击条目展开正文。\n\n提交：普通用户无需提交公告；发现问题或需要补充说明，请在「求助答疑」发帖。\n\n当前为灰度测试版，公告分类与展示顺序可能调整。', 'text', '/catalog/misc.jpg', 0, 0, 0],
      ['thread-guide-vip', 'board-guides', 'VIP 会员权益与开通说明', '月卡、年卡、终身三档权益，开通续费、积分发放与到期口径。', 'VIP 分月卡、年卡、终身三档，权益按等级叠加，不影响普通内容的浏览与搜索。\n\n权益：付费帖折扣、每月积分、专属徽章与答疑优先级；终身档额外包含创作分成加成。具体额度以 VIP 页套餐卡片为准。\n\n开通与续费：登录后在「VIP 会员」页选择套餐，使用钱包余额支付；已有同级或更高等级时按钮显示「续费」，到期时间顺延。\n\n积分发放：每月按套餐额度发放，签到积分独立计算，可在「钱包 / 积分」查看流水。\n\n到期：到期未续费则恢复普通权益，已购买的付费内容仍可继续阅读。\n\n常见问题：支付成功但权益未更新时，先刷新页面；仍未到账请附订单号在「求助答疑」反馈。\n\n当前为灰度测试版，价格与权益可能调整，已开通周期内不受影响。', 'text', '/catalog/store.jpg', 0, 0, 1],
      ['thread-guide-wallet', 'board-guides', '钱包、积分与提现规则', '余额与积分的区别、充值卡兑换、转积分、签到、提现门槛与到账口径。', '钱包分为「可用余额」「积分」「可提现余额」三个口径，互不混用。\n\n余额：用于付费帖、VIP 与社区商城下单，可通过充值卡兑换或推广分成获得。\n\n积分：每日签到 +5；可用于抵扣与转赠。转积分需填写接收方 Mim ID，提交后不可撤回。\n\n充值卡：在钱包页输入卡密兑换，一卡一次。演示卡密 MIM-DEMO-100 与 MIM-DEMO-500 仅用于功能演示。\n\n提现：只有佣金与创作分成进入「可提现余额」，充值余额不可提现；同一时间只允许一笔处理中的申请，可在提现记录中撤销或等待审核。\n\n常见问题：兑换失败先确认卡密未被使用；提现被驳回会在记录里显示原因。\n\n当前为灰度测试版，提现门槛与审核时效可能调整。', 'text', '/catalog/dev.jpg', 0, 0, 1],
      ['thread-guide-shop', 'board-guides', '社区商城下单、发货与售后指引', '三类商品、结算顺序、卡密查看、确认收货与售后申请。', '社区商城提供实物快递、虚拟自动发货（卡密）与虚拟人工发货三类商品。\n\n下单：登录后选商品与数量，可填优惠码；结算按「优惠码 → 余额」的顺序扣减，商城订单暂不支持积分抵扣。\n\n发货：自动发货商品支付成功后立即显示卡密；人工发货商品由工作人员在 24 小时内联系；实物商品按商品页说明的时效发出。\n\n确认与售后：收到商品后可确认收货；有问题在订单上申请售后，支持仅退款、退货退款与维修三类，提交后由后台审批。\n\n示例说明：灰度期商品与卡密为演示数据，会在商品说明或订单内容中标注，不作为真实成交记录。\n\n常见问题：余额不足时先到钱包充值；卡密不显示时刷新订单列表。\n\n当前为灰度测试版，商品池与发货时效会继续调整。', 'text', '/catalog/store.jpg', 0, 0, 2],
      ['thread-guide-referral', 'board-guides', '推广分成规则与结算说明', '邀请码绑定、返佣比例、结算入口、禁止行为与常见问题。', '推广分成用于奖励真实分享：邀请码绑定后，被邀请人首单按实付金额的 5% 返到邀请人的可提现余额。\n\n绑定：在「推广分成」页复制自己的邀请码发给朋友；新用户只能绑定一次，不能绑定自己的邀请码。\n\n结算：佣金在订单完成且过售后周期后入账，进入「可提现余额」，可在钱包页申请提现。\n\n统计：页面展示已邀请人数与累计佣金，明细以钱包流水为准。\n\n禁止行为：自邀、虚假交易、批量注册与诱导下单会被取消佣金并限制账号。\n\n常见问题：朋友忘记填邀请码时无法补绑；佣金未到账先确认订单是否已过售后周期。\n\n当前为灰度测试版，返佣比例与结算周期可能调整。', 'text', '/catalog/plugin.jpg', 0, 0, 2],
      ['thread-newbie-start', 'board-guides', '新手报到：Mim 能做什么、从哪里开始', '一页看懂社区、商城、付费内容与创作工具，附新手路径。', '第一次来 Mim，建议按下面的顺序逛：\n\n1. 先看「公告动态」了解当前灰度状态与功能边界。\n2. 到「论坛」翻使用指南板块，八个板块的规则都写在里面。\n3. 想找素材或灵感，去「图库」和「视频」，可按帖子或作者聚合。\n4. 需要买实物或卡密，进「社区商城」；余额与积分口径见「钱包 / 积分」。\n5. 想支持创作者，可开通「VIP 会员」或使用「推广分成」邀请朋友。\n\n发帖前先搜索，提问时写清环境与复现步骤。欢迎在「求助答疑」留下你的第一个问题。\n\n当前为灰度测试版，功能会持续补齐。', 'text', '/catalog/industry.jpg', 0, 0, 1],
      // 图库 / 视频示例帖：媒体挂在帖子上，标题带【示例】前缀，避免被误认为真实作品
      ['thread-demo-gallery', 'board-guides', '【示例】图库演示：三张站点视觉素材', '示例内容：用三张现有站点封面演示图库瀑布流、灯箱与原帖跳转。', '这是图库功能的示例内容，用于演示瀑布流、灯箱与原帖跳转，不代表真实作品发布。\n\n三张图来自站内已有的分类封面素材，仅作为演示数据挂在图库中。\n\n你可以点开任意一张查看灯箱，再点标题回到本帖。\n\n当前为灰度测试版；示例内容统一以【示例】前缀标注，后续可被运营替换为真实作品。', 'gallery', '/catalog/frontier.jpg', 0, 0, 1],
      ['thread-demo-video', 'board-guides', '【示例】视频演示：两段漫剧演示片', '示例内容：用站内已有演示片验证视频卡片、封面、时长与播放。', '这是视频功能的示例内容，用于验证视频卡片、封面、时长与灯箱播放，不代表正式剧集上线。\n\n两段演示片均为站内已有的功能演示素材，仅作为示例数据挂载。\n\n点开卡片可播放；移动端为内联播放。\n\n当前为灰度测试版；示例内容统一以【示例】前缀标注，后续可被运营替换为正式作品。', 'video', '/catalog/ai.jpg', 0, 0, 1],
    ];
    for (const [id, boardId, title, summary, body, kind, cover, price, views, daysAgo] of threads) {
      const created = new Date(Date.now() - daysAgo * 86400000).toISOString();
      insertThread.run(id, boardId, title, summary, body, kind, cover, price, views, created, created, created);
    }
    // 图库示例：三张站内分类封面挂在【示例】帖下，供匿名浏览、灯箱与原帖跳转
    const demoMedia: Array<[string, string, string, string, string, string, number, number]> = [
      ['media-demo-gallery-1', 'thread-demo-gallery', 'image', '/catalog/frontier.jpg', '', 'image/jpeg', 0, 1],
      ['media-demo-gallery-2', 'thread-demo-gallery', 'image', '/catalog/store.jpg', '', 'image/jpeg', 0, 2],
      ['media-demo-gallery-3', 'thread-demo-gallery', 'image', '/catalog/tools.jpg', '', 'image/jpeg', 0, 3],
      // 视频示例：复用 public/demo 下已有演示片，封面同目录，避免外链与额外存储
      ['media-demo-video-1', 'thread-demo-video', 'video', '/demo/stardust-ep1.mp4', '/demo/stardust-cover.jpg', 'video/mp4', 30, 1],
      ['media-demo-video-2', 'thread-demo-video', 'video', '/demo/bloom-ep1.mp4', '/demo/bloom-cover.jpg', 'video/mp4', 15, 2],
    ];
    for (const [id, threadId, kind, url, poster, mime, duration, sort] of demoMedia) {
      insertMedia.run(id, threadId, kind, url, poster, mime, duration, sort, now);
    }
    // 灰度公告：置顶说明当前为灰度测试版，示例内容会明确标注，避免被当成正式运营数据
    insertAnnouncement.run(
      'ann-seed-gray-release',
      '灰度测试版说明：功能可用，示例内容会标注',
      '当前站点处于灰度测试版：论坛、图库、视频、公告动态、VIP 会员、钱包 / 积分、社区商城与推广分成八个板块均已开放浏览。\n\n灰度期内部分商品、卡密与媒体为演示数据，统一以【示例】前缀或正文说明标注，不作为真实成交记录。\n\n遇到问题请在社区「求助答疑」板块发帖，或查看「使用指南」中的规则文章。付款、提现等资金操作前请再次确认页面提示。',
      '2026-11-16T00:00:00.000Z',
      '2026-11-16T00:00:00.000Z',
      now,
      now,
    );
    // 存量库口径校正：旧公告帖宣称「全站免登录」，与 2026-11-15 起的强制登录相反；仅旧标题 + 旧摘要同时命中才替换，运营改过的保持原样。
    const legacyAnnounceTitle = '2026-11-12 更新：全站免登录 + 商城商品视觉上线';
    const legacyAnnounceSummary = '门禁解除、商品封面与参数详情图、访客交易链路。';
    db.prepare(
      'UPDATE community_threads SET title = ?, summary = ?, body = ?, updated_at = ? WHERE id = ? AND title = ? AND summary = ?',
    ).run(
      announceTitle, // 新标题：只保留真实上线内容
      announceSummary, // 新摘要
      announceBody, // 新正文
      now, // 更新时间
      'thread-announce', // 目标公告帖主键
      legacyAnnounceTitle, // 旧标题精确匹配
      legacyAnnounceSummary, // 旧摘要精确匹配
    );
    const vips: Array<[string, string, string, number, number, number, string, number]> = [
      ['vip-monthly', 'vip-monthly', 'VIP 月卡', 1, 3000, 30, JSON.stringify(['付费帖 9 折', '每月 50 积分', '专属徽章']), 1],
      ['vip-yearly', 'vip-yearly', 'VIP 年卡', 2, 29800, 365, JSON.stringify(['付费帖 8 折', '每月 200 积分', '专属徽章', '优先答疑']), 2],
      ['vip-lifetime', 'vip-lifetime', 'VIP 终身', 3, 198000, 3650, JSON.stringify(['付费帖 7 折', '每月 500 积分', '终身徽章', '创作分成 +5%']), 3],
    ];
    for (const [id, code, name, level, price, days, perks, sort] of vips) {
      insertVip.run(id, code, name, level, price, days, perks, sort);
    }
    const products: Array<[string, string, string, string, string, number, string, number, string, number]> = [
      ['prod-keycap', 'mim-keycap', 'Mim 定制键帽', '铝合金阳极氧化，兼容 Cherry MX 轴体，附赠拔键器。', 'physical', 6900, '/catalog/plugin.jpg', 50, '顺丰陆运，48 小时内发出', 1],
      ['prod-pixi', 'pixi-pack', 'Pixi 素材包（自动发卡密）', '500+ 游戏 UI 切片与音效，购买后立即显示下载卡密。', 'virtual_auto', 1900, '/catalog/game.jpg', 20, '支付成功立即发放卡密', 2],
      ['prod-deploy', 'deploy-service', '远程部署指导（人工发货）', '1 对 1 远程协助：域名、HTTPS、Nginx、systemd 与日志排查。', 'virtual_manual', 19900, '/catalog/server.jpg', 10, '下单后 24 小时内联系排期', 3],
    ];
    for (const [id, code, name, summary, kind, price, cover, stock, note, sort] of products) {
      insertProduct.run(id, code, name, summary, kind, price, cover, stock, note, sort, now);
    }
    for (let i = 1; i <= 3; i += 1) {
      insertShopKey.run(`shop-key-pixi-${i}`, 'prod-pixi', `PIXI-MIM-${String(i).padStart(2, '0')}-2026`, now);
    }
    insertWalletCard.run('wallet-card-demo-100', 'MIM-DEMO-100', 10000, now);
    insertWalletCard.run('wallet-card-demo-500', 'MIM-DEMO-500', 50000, now);
    insertCoupon.run('coupon-mim10', 'MIM10', 'fixed', 1000, 5000, 100); // 优惠码表无 created_at 列，SQL 仅 6 个占位符
    insertCoupon.run('coupon-vip20', 'VIP20', 'percent', 20, 3000, 100); // 同上，避免多传一个参数导致种子整体回滚
  });
  seed();
}

/**
 * 商业化二期种子：付费资产、站点外观、页面区块。
 * 全部 INSERT OR IGNORE，便于运营在后台改过配置后重启不被覆盖。
 */
export function seedCommerce(db: Db): void {
  const now = new Date().toISOString(); // 同批种子共用时间戳
  const insertAsset = db.prepare(
    `INSERT OR IGNORE INTO paid_assets
       (id, code, kind, title, summary, body, cover_url, file_url, price_cents, vip_free, author_id, status, views, sales, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'published', ?, ?, ?, ?)`,
  );
  const insertSetting = db.prepare('INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)');
  const insertBlock = db.prepare(
    `INSERT OR IGNORE INTO page_blocks (id, page, kind, sort_order, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const updateMedia = db.prepare("UPDATE paid_assets SET media_json = ? WHERE code = ? AND (media_json IS NULL OR media_json = '[]')");
  // 存量图库 / 视频资产补媒体数组：只填空白行，运营已经改过的不覆盖。
  const seed = db.transaction(() => {
    const assets: Array<[string, string, string, string, string, string, string, string | null, number, number, number, number]> = [
      [
        'asset-paid-store',
        'paid-article-store',
        'article',
        '付费阅读：独立商城的六层结构与最小实现',
        '商品、订单、支付、履约、售后、资金六层拆解，附卡密与优惠码实现。',
        '这是一篇付费长文。\n\n第一层商品：实物、自动发货、人工发货三类，价格与库存分列。\n第二层订单：下单即锁定金额，优惠码只改应付，不改商品原价。\n第三层支付：余额、支付宝、微信三条通道，回调必须验签。\n第四层履约：卡密一码一用，实物写物流单，人工发货留远程排期。\n第五层售后：退款原路退回，退货先审后收。\n第六层资金：平台抽成与创作者分成必须分账记账，提现走人工审核。',
        '/catalog/store.jpg',
        null,
        1900,
        1,
        460,
        28,
      ],
      [
        'asset-download-kit',
        'paid-download-kit',
        'download',
        'Mim 部署工具包（Nginx + systemd + 备份脚本）',
        '一套可直接复用的生产部署脚本，含健康检查、回滚与 SQLite 备份。',
        '购买后可下载 mim-deploy-kit.zip。工具包包含：nginx 站点模板、systemd 单元、SQLite 热备份脚本、发布回滚脚本。',
        '/catalog/server.jpg',
        '/downloads/mim-deploy-kit.zip',
        2900,
        0,
        320,
        16,
      ],
      [
        'asset-gallery-covers',
        'paid-gallery-covers',
        'gallery',
        '19 张分类封面与 205 条模块视觉规范',
        '3:2 封面、分类角标、价格角标与 900×1180 参数长图源文件。',
        '/catalog/dev.jpg\n/catalog/tools.jpg\n/catalog/store.jpg\n/catalog/ai.jpg\n/catalog/frontier.jpg\n/catalog/wechat.jpg\n/catalog/game.jpg\n/catalog/plugin.jpg\n/catalog/misc.jpg',
        '/catalog/frontier.jpg',
        '/downloads/mim-covers.zip',
        3900,
        1,
        210,
        9,
      ],
      [
        'asset-video-comic',
        'paid-video-comic',
        'video',
        '漫剧 AI 成片：从分镜到导出的完整演示',
        '28 分钟演示，覆盖剧本拆场、角色一致性、镜头运动与成片导出。',
        '付费视频：分镜设计、角色一致性、镜头运动、配音与成片导出全链路演示。',
        '/catalog/ai.jpg',
        '/downloads/mim-comic-demo.mp4',
        4900,
        1,
        180,
        7,
      ],
      [
        'asset-open-tools',
        'open-source-tools',
        'download',
        '自研工具与开源项目合集（免费）',
        'Quick Build WP、数据库换域名插件、流盾 WAF 的说明与仓库地址。',
        '免费资源：Quick Build WP 一键装宝塔与环境；数据库批量替换 / 换域名插件；流盾 WAF 开源防护。仓库地址见社区「自研工具」板块。',
        '/catalog/tools.jpg',
        '/downloads/mim-open-tools.md',
        0,
        0,
        900,
        64,
      ],
    ];
    for (const [id, code, kind, title, summary, body, cover, file, price, vipFree, views, sales] of assets) {
      insertAsset.run(id, code, kind, title, summary, body, cover, file, price, vipFree, views, sales, now, now);
    }
    // 付费图库：9 张分类封面作为可翻页图集
    updateMedia.run(JSON.stringify([
      { kind: 'image', url: '/catalog/dev.jpg' },
      { kind: 'image', url: '/catalog/tools.jpg' },
      { kind: 'image', url: '/catalog/store.jpg' },
      { kind: 'image', url: '/catalog/ai.jpg' },
      { kind: 'image', url: '/catalog/frontier.jpg' },
      { kind: 'image', url: '/catalog/wechat.jpg' },
      { kind: 'image', url: '/catalog/game.jpg' },
      { kind: 'image', url: '/catalog/plugin.jpg' },
      { kind: 'image', url: '/catalog/misc.jpg' },
    ]), 'paid-gallery-covers');
    // 付费视频：内置演示片源 + 封面，前台用 <video controls> 直接播放
    updateMedia.run(JSON.stringify([
      { kind: 'video', url: '/demo/stardust-ep1.mp4', poster_url: '/demo/stardust-cover.jpg' },
      { kind: 'video', url: '/demo/bloom-ep1.mp4', poster_url: '/demo/bloom-cover.jpg' },
    ]), 'paid-video-comic');
    insertSetting.run('home', JSON.stringify({ view: 'store' }), now);
    insertSetting.run('theme', JSON.stringify({ accent: '#3b6ef5', background: '#f5f6f7', nav_layout: 'top', list_style: 'card', radius: 12, mode: 'light' }), now);
    // 存量库外观对齐：旧种子为 teal #0f766e / #f8fafc / 14px，只有这三个键仍是旧默认值时才同步到新令牌口径；
    // 运营手动改过的颜色、圆角以及 nav_layout / list_style / font 等其他外观项一律保持原样，重复启动无副作用。
    const themeRow = db.prepare("SELECT value FROM site_settings WHERE key = 'theme'").get() as { value: string } | undefined;
    if (themeRow) {
      try {
        const parsed: unknown = JSON.parse(themeRow.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const theme = parsed as Record<string, unknown>;
          let changed = false;
          if (theme.accent === '#0f766e') { theme.accent = '#3b6ef5'; changed = true; }
          // 粉色主色 #f53dbb 压暗后配白字仅 3.76:1，不达 AA；回到品牌蓝保证浅色主按钮 ≥4.5:1
          if (theme.accent === '#f53dbb') { theme.accent = '#3b6ef5'; changed = true; }
          if (theme.background === '#f8fafc') { theme.background = '#f5f6f7'; changed = true; }
          if (theme.radius === 14) { theme.radius = 12; changed = true; }
          if (changed) {
            db.prepare('UPDATE site_settings SET value = ?, updated_at = ? WHERE key = ?').run(JSON.stringify(theme), now, 'theme');
          }
        }
      } catch {
        // 脏 JSON 不处理：保持原值，避免把运营配置清空
      }
    }
    insertSetting.run('locales', JSON.stringify({ front: 'zh-CN', admin: 'zh-CN', supported: ['zh-CN', 'en-US'], machine_translation: false }), now);
    insertSetting.run('site', JSON.stringify({ title: 'Mim', subtitle: 'Mim-内容、社区与交易一体化', footer: 'Mim · 开源与商业化并行' }), now);
    // 站点副标题对齐：旧种子写的是「跨平台商业级项目」，INSERT OR IGNORE 对线上存量库不生效，
    // 因此这里只在存量副标题仍是旧默认值时替换；运营手动改过的名称与副标题一律保持原样，重复启动无副作用。
    const siteRow = db.prepare("SELECT value FROM site_settings WHERE key = 'site'").get() as { value: string } | undefined;
    if (siteRow) {
      try {
        const parsed: unknown = JSON.parse(siteRow.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const site = parsed as Record<string, unknown>;
          if (site.subtitle === '跨平台商业级项目') {
            site.subtitle = 'Mim-内容、社区与交易一体化';
            db.prepare('UPDATE site_settings SET value = ?, updated_at = ? WHERE key = ?').run(JSON.stringify(site), now, 'site');
          }
        }
      } catch {
        // 脏 JSON 不处理：保持原值，避免把运营配置清空
      }
    }
    const blocks: Array<[string, string, string, number, string]> = [ // 页面区块种子：文案全部面向访客，不使用内部口径
      ['block-home-hero', 'home', 'hero', 1, JSON.stringify({ title: 'Mim 社区', subtitle: '分享图文、视频与图集作品，开通付费阅读，也能逛社区商城。', cta: { label: '进入社区', href: '/community' } })], // 首页头图：一句话说清这是什么、能做什么
      ['block-home-features', 'home', 'features', 2, JSON.stringify({ items: [{ title: '付费内容', text: '图文、视频与图集作品，支持单篇解锁阅读' }, { title: '社区商城', text: '实物商品、自动发卡与人工发货' }, { title: '论坛互动', text: '按板块与圈子交流，可发帖、回帖和收藏' }] })], // 三张特性卡：改用访客能直接理解的运营文案
      ['block-home-announce', 'home', 'announcements', 3, JSON.stringify({ source: '/api/v1/community/threads?board=announce&limit=3' })], // 公告入口：数据仍取社区公告板块
      ['block-forum-tabs', 'forum', 'tabs', 1, JSON.stringify({ tabs: ['最新', '热门', '精华', '公告'] })], // 论坛页栏目
    ]; // blocks 结束
    for (const [id, page, kind, sort, config] of blocks) { // 逐块写入种子
      insertBlock.run(id, page, kind, sort, config, now, now); // INSERT OR IGNORE：已存在则不覆盖
    } // 循环结束
    // 存量库首页文案对齐：旧种子把首屏标题写成「Mim 商业中台」等占位措辞，INSERT OR IGNORE 不会更新已有行。
    // 只有区块配置仍与旧种子一致时才替换；运营在后台改过的文案保持原样，重复启动无副作用。
    // 旧头图指纹只比对标题 / 副标题 / 按钮文案三个稳定字段；旧 CTA href 是已下线路径段，不再纳入指纹，
    // 旧行点击时由前端旧段映射兜底到 /community，种子代码内不再保留该旧段字面量。
    const legacyHeroFingerprint = { // 旧首页头图：未被运营改动过的判定字段
      title: 'Mim 商业中台', // 旧标题
      subtitle: '知识付费、独立商城、社区与资金结算', // 旧副标题
      cta: { label: '进入商城' }, // 旧按钮文案；href 旧段已下线，不参与比对
    }; // legacyHeroFingerprint 结束
    const legacyHomeConfig: Record<string, string> = { // 其余旧种子原文：作为「未被运营改动过」的判定依据
      'block-home-features': JSON.stringify({ items: [{ title: '付费资产', text: '阅读 / 下载 / 图库 / 视频' }, { title: '独立商城', text: '实物、卡密与人工发货' }, { title: '社区论坛', text: '板块、圈子与帖子权限' }] }), // 旧特性卡
    }; // legacyHomeConfig 结束
    for (const [id, page, kind, sort, config] of blocks) { // 复用新种子作为对齐目标
      const row = db.prepare('SELECT config_json FROM page_blocks WHERE id = ?').get(id) as { config_json: string } | undefined; // 读当前存量配置
      if (!row) continue; // 行不存在说明新种子已写入，无需对齐
      try { // 脏 JSON 视为运营数据异常，保持原样
        const parsed: Record<string, unknown> = JSON.parse(row.config_json); // 解析当前存量配置
        let same = false; // 是否命中旧种子
        if (id === 'block-home-hero') { // 头图走字段子集比对，避免把已下线旧段写进指纹
          const cta = (parsed.cta ?? {}) as { label?: unknown }; // 取按钮配置，缺失按空对象处理
          same = parsed.title === legacyHeroFingerprint.title // 标题未被改过
            && parsed.subtitle === legacyHeroFingerprint.subtitle // 副标题未被改过
            && cta.label === legacyHeroFingerprint.cta.label; // 按钮文案未被改过
        } else { // 其余区块走整对象结构化比对
          const legacy = legacyHomeConfig[id]; // 取对应旧种子原文
          if (!legacy) continue; // 不在对齐清单内的区块跳过
          same = JSON.stringify(parsed) === legacy; // 结构化比对，忽略键序与空白
        } // 分支结束
        if (same) db.prepare('UPDATE page_blocks SET config_json = ?, updated_at = ? WHERE id = ?').run(config, now, id); // 命中旧种子才替换并刷新时间
      } catch { // 解析失败不做任何写入
        // 保持原值，避免把坏数据覆盖成默认文案
      } // try/catch 结束
    } // 对齐循环结束
  });
  seed();
}
