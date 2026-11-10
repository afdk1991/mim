/** SQLite 连接与结构迁移 */

import Database from 'better-sqlite3'; // 引入 better-sqlite3 同步驱动，SQLite 读写走同步 API 便于事务内顺序执行
import { SITE_MODULES } from '@mim/core-domain'; // 统一入口配置清单：45 个去重入口、19 个业务域、占位标识与运行时能力点
import { CATALOG_GROUPS, buildCatalogModuleSeeds } from '@mim/core-domain'; // 模块商城分类树与二级模块种子（19 组 / 205 条）
import { existsSync, mkdirSync, readFileSync } from 'node:fs'; // 文件系统工具：判断目录是否存在、递归建目录、读取建表脚本
import { dirname } from 'node:path'; // 取文件所在目录，用于从数据库文件路径推导数据目录
import { fileURLToPath } from 'node:url'; // 把 import.meta.url 转成文件系统路径，满足 ESM 下的路径解析
import type { Db } from './types.js'; // 仅引入数据库连接类型，编译期擦除不产生运行时代码

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url)); // 以模块自身位置解析 schema.sql 绝对路径，保证任意工作目录下都能找到建表脚本

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
  { table: 'generation_jobs', column: 'attempts', definition: 'INTEGER NOT NULL DEFAULT 0' }, // 超时回收重试计数
  { table: 'generation_assets', column: 'purged_at', definition: 'TEXT' }, // 过期产物字节清理时间
  { table: 'module_orders', column: 'channel_txn_id', definition: 'TEXT' }, // 外部渠道交易号（支付回调幂等依据）
  { table: 'modules', column: 'category_slug', definition: 'TEXT' }, // 模块所属二级分类标识（2026-11-10 分类树改造）
  { table: 'modules', column: 'license', definition: 'TEXT' }, // 模块开源许可（筛选维度，演示口径）
  { table: 'modules', column: 'language', definition: 'TEXT' }, // 模块编程语言（筛选维度，演示口径）
  { table: 'modules', column: 'stars', definition: 'INTEGER NOT NULL DEFAULT 0' }, // Star 数（「Stars」排序依据，确定性演示值）
]; // 清单结束：新增列必须先加到 schema.sql，再加到这里，两条路径才不会分叉

// 依赖「后加列」的索引：必须在补列之后再建，否则老库全量执行 schema.sql 时会因列不存在直接报错崩溃
const ADDITIVE_INDEXES: ReadonlyArray<{ name: string; sql: string }> = [ // 只放列由 ADDITIVE_COLUMNS 补出来的索引
  { // 渠道交易号全局唯一（NULL 不参与）：同一笔渠道交易重复回调不能结算出第二张单／第二份权益
    name: 'uq_module_orders_txn', // 索引名，与 wiki 记录一致
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS uq_module_orders_txn ON module_orders(channel_txn_id) WHERE channel_txn_id IS NOT NULL", // 部分唯一索引：人工结算（NULL）不受约束
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
 * 批量补齐增量列，返回本次真正新增的列名（形如 `generation_jobs.attempts`）。
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

export function createDatabase(filename: string = ':memory:'): Db { // 创建数据库连接：默认内存库（测试用），传路径则落盘持久化
  if (filename !== ':memory:') { // 内存库没有文件系统目录，无需准备目录
    const dir = dirname(filename); // 取数据库文件所在目录
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); // 目录不存在则递归创建，避免首次启动因缺目录直接失败
  } // 目录准备分支结束
  const db = new Database(filename); // 打开或创建数据库文件 / 内存库
  db.pragma('foreign_keys = ON'); // 开启外键约束，保证关联表引用完整性
  if (filename !== ':memory:') db.pragma('journal_mode = WAL'); // 落盘库启用 WAL，提升读写并发并降低写阻塞（内存库不支持）
  db.exec(readFileSync(SCHEMA_PATH, 'utf8')); // 执行建表脚本，全部 IF NOT EXISTS 以便每次启动幂等
  const migrated = migrateAdditiveColumns(db); // 存量库补齐后加的列；全新建库时为空
  if (migrated.length > 0) console.log(`[db] additive migration applied: ${migrated.join(', ')}`); // 结构变更必须留痕，便于排查升级后的行为差异
  const indexed = ensureAdditiveIndexes(db); // 补列之后才建依赖这些列的唯一索引，避免老库启动即报 no such column
  if (indexed.length > 0) console.log(`[db] additive index created: ${indexed.join(', ')}`); // 同样留痕，便于确认回调幂等约束已生效
  seedModules(db); // 写入模块商城基础数据，保证新库启动即有可售模块
  seedCatalogCategories(db); // 写入模块分类树（19 个一级 + 205 个二级），导航与过滤依赖它
  seedCategoryModules(db); // 按分类树展开写入 205 个二级模块（cn/global 双区），实现「二级条目即模块」
  seedRbac(db); // 写入内置权限点与内置角色，保证首启即有可用的 RBAC 基线
  seedSiteModules(db); // 写入入口配置清单演示数据，并把存量隔离键幂等迁移到占位标识
  return db; // 返回已完成初始化的连接
} // createDatabase 结束

/**
 * 入口配置清单演示数据种子：把静态契约中每个入口的 seed 条目写入 site_module_items。
 * 主键由「入口序号 + 能力编码 + 序号」拼接而成，天然幂等；INSERT OR IGNORE 保证
 * 重复启动不会覆盖用户在演示条目上的状态流转，也不会产生重复行。
 *
 * v2 迁移：v1 曾用台账短主机记录作为数据隔离键，而本轮明确「不补写未提供的具体主机值」，
 * 故按稳定主键把存量演示条目的隔离键幂等改写为占位键；用户的状态流转与时间字段保持不变，
 * 语句中不含任何具体主机值字面量，也不依赖旧值的取值。
 */
export function seedSiteModules(db: Db): void { // 入口清单种子入口，测试内存库同样会执行
  const now = new Date().toISOString(); // 统一时间戳，保证同批数据 created_at / updated_at 一致
  const insert = db.prepare( // 预编译插入语句，逐条绑定参数避免拼接 SQL
    `INSERT OR IGNORE INTO site_module_items
       (id, host, capability, title, detail, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'system', ?, ?)`, // created_by 固定 system，标识这是演示数据
  ); // prepare 结束
  const align = db.prepare( // 幂等迁移：把 v1 演示条目的隔离键改写为占位键，只按主键定位
    'UPDATE site_module_items SET host = ? WHERE id = ? AND host <> ?', // host 列物理名保留，语义已变为占位键
  ); // prepare 结束
  const seed = db.transaction(() => { // 包成事务：任一语句失败整体回滚，避免出现半套演示数据
    for (const module of SITE_MODULES) { // 逐入口写入，模块定义仍以静态契约为准
      for (const [index, item] of module.seed.entries()) { // 逐条演示条目写入
        const id = `site-seed-${module.id}-${item.capability}-${index + 1}`; // 稳定主键，保证重复启动幂等
        insert.run( // 按占位符顺序绑定九个参数
          id, // 主键
          module.entryKey, // 占位键作为数据隔离键，不是具体主机值
          item.capability, // 能力编码：catalog / manage / record
          item.title, // 演示条目标题
          item.detail, // 演示条目说明，明确标注非真实业务数据
          item.status, // 初始状态，取值落在该能力 states 内
          now, // created_at
          now, // updated_at
        ); // run 结束
        align.run(module.entryKey, id, module.entryKey); // 存量 v1 行按主键迁移，保留用户状态流转
      } // 演示条目循环结束
    } // 入口循环结束
  }); // 事务函数准备完成
  seed(); // 执行事务
} // seedSiteModules 结束

/**
 * 功能模块商城种子：第 1 期上架一组真实模块（漫剧 AI 剧工作台 + 生成包三档 + AI 配音/剧本 + 素材扩容 + 模板包），
 * cn / global 双区各一套，按区域独立币种定价；幂等 upsert，重复执行不会产生重复行。
 */
export function seedModules(db: Db): void { // 模块种子入口
  const now = new Date().toISOString(); // 统一时间戳，保证同批数据 created_at / updated_at 一致

  // 单条价格定义：币种 + 最小货币单位金额（避免浮点误差）
  type PriceDef = { currency: 'CNY' | 'USD'; amount_minor: number };
  // 模块定义：code 稳定、双语名称/简介、排序、前置依赖、按区域可选价格
  interface SeedModule {
    code: string; // 模块业务编码，权限校验时按此值匹配
    sortOrder: number; // 展示排序权重，数字越小越靠前
    requires: string[]; // 前置依赖模块编码，空数组表示无前置
    nameI18n: Record<string, string>; // 多语言名称
    summaryI18n: Record<string, string>; // 多语言简介
    price?: { cn?: PriceDef; global?: PriceDef }; // 按区域独立币种定价；缺省即免费
  } // SeedModule 接口结束

  const defs: SeedModule[] = [ // 第 1 期上架模块清单
    { // 漫剧创作工作台：核心入口，免费
      code: 'comic.workbench', // 模块编码
      sortOrder: 10, // 排序权重
      requires: [], // 无前置依赖
      nameI18n: { 'zh-CN': '漫剧创作工作台', 'en-US': 'Comic Creation Workbench' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '剧本、分镜、角色一致性与对白由 AI 建议，人工确认后导出创作工程。', // 中文简介
        'en-US': 'AI-assisted script, storyboard, character consistency and dialogue, confirmed by humans before export.', // 英文简介
      }, // summaryI18n 结束
    }, // comic.workbench 结束
    { // 漫剧生成包·基础版：付费，无前置
      code: 'comic.genpack.basic', // 模块编码
      sortOrder: 20, // 排序权重
      requires: [], // 无前置依赖
      nameI18n: { 'zh-CN': '漫剧生成包·基础版', 'en-US': 'Comic Generation Pack · Basic' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '为漫剧工作台提供基础 AI 生成额度：文生图、图生视频与 TTS 配音。', // 中文简介
        'en-US': 'Base AI generation quota for the workbench: text-to-image, image-to-video and TTS dubbing.', // 英文简介
      }, // summaryI18n 结束
      price: { cn: { currency: 'CNY', amount_minor: 9900 }, global: { currency: 'USD', amount_minor: 1499 } }, // ¥99.00 / $14.99
    }, // comic.genpack.basic 结束
    { // 漫剧生成包·专业版：付费，依赖基础版
      code: 'comic.genpack.pro', // 模块编码
      sortOrder: 30, // 排序权重
      requires: ['comic.genpack.basic'], // 前置：基础版
      nameI18n: { 'zh-CN': '漫剧生成包·专业版', 'en-US': 'Comic Generation Pack · Pro' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '在基础版之上提升额度与并发，解锁高清成片与批量导出。', // 中文简介
        'en-US': 'Higher quota and concurrency on top of Basic, unlocking HD output and batch export.', // 英文简介
      }, // summaryI18n 结束
      price: { cn: { currency: 'CNY', amount_minor: 29900 }, global: { currency: 'USD', amount_minor: 4299 } }, // ¥299.00 / $42.99
    }, // comic.genpack.pro 结束
    { // 漫剧生成包·团队版：付费，依赖专业版
      code: 'comic.genpack.team', // 模块编码
      sortOrder: 40, // 排序权重
      requires: ['comic.genpack.pro'], // 前置：专业版
      nameI18n: { 'zh-CN': '漫剧生成包·团队版', 'en-US': 'Comic Generation Pack · Team' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '面向小团队的共享额度与协作席位，支持成员管理与用量分摊。', // 中文简介
        'en-US': 'Shared quota and seats for small teams, with member management and usage split.', // 英文简介
      }, // summaryI18n 结束
      price: { cn: { currency: 'CNY', amount_minor: 99900 }, global: { currency: 'USD', amount_minor: 13999 } }, // ¥999.00 / $139.99
    }, // comic.genpack.team 结束
    { // AI 配音合成：付费，无前置
      code: 'ai.dubbing', // 模块编码
      sortOrder: 50, // 排序权重
      requires: [], // 无前置依赖
      nameI18n: { 'zh-CN': 'AI 配音合成', 'en-US': 'AI Dubbing Studio' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '多语种、多音色的 AI 配音与情感语调控制，导出字幕对齐音频。', // 中文简介
        'en-US': 'Multilingual, multi-voice AI dubbing with emotional prosody and subtitle-aligned export.', // 英文简介
      }, // summaryI18n 结束
      price: { cn: { currency: 'CNY', amount_minor: 19900 }, global: { currency: 'USD', amount_minor: 2899 } }, // ¥199.00 / $28.99
    }, // ai.dubbing 结束
    { // AI 剧本扩写：免费，无前置
      code: 'ai.script', // 模块编码
      sortOrder: 60, // 排序权重
      requires: [], // 无前置依赖
      nameI18n: { 'zh-CN': 'AI 剧本扩写', 'en-US': 'AI Script Expansion' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '基于角色设定与世界观，自动扩写分镜对白与桥段，保持一致性。', // 中文简介
        'en-US': 'Auto-expand storyboard dialogue and beats from character and world settings while staying consistent.', // 英文简介
      }, // summaryI18n 结束
    }, // ai.script 结束
    { // 素材云存储扩容：付费，无前置
      code: 'media.storage', // 模块编码
      sortOrder: 70, // 排序权重
      requires: [], // 无前置依赖
      nameI18n: { 'zh-CN': '素材云存储扩容', 'en-US': 'Media Storage Add-on' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '为工程素材与成片提供额外云存储空间，按容量一次性购买。', // 中文简介
        'en-US': 'Additional cloud storage for assets and films, purchased once by capacity.', // 英文简介
      }, // summaryI18n 结束
      price: { cn: { currency: 'CNY', amount_minor: 4900 }, global: { currency: 'USD', amount_minor: 699 } }, // ¥49.00 / $6.99
    }, // media.storage 结束
    { // 分镜模板包：免费，无前置
      code: 'template.pack', // 模块编码
      sortOrder: 80, // 排序权重
      requires: [], // 无前置依赖
      nameI18n: { 'zh-CN': '分镜模板包', 'en-US': 'Storyboard Template Pack' }, // 多语言名称
      summaryI18n: { // 多语言简介
        'zh-CN': '精选分镜与镜头模板，一键套用到新工程，加速起步。', // 中文简介
        'en-US': 'Curated storyboard and shot templates applied to new projects in one click.', // 英文简介
      }, // summaryI18n 结束
    }, // template.pack 结束
  ]; // defs 结束

  /**
   * 存量 8 个模块的归类口径（2026-11-10 分类树改造时新增）：
   * 用户要求「现有模块保留并归类」，故不删不并，只补上二级分类与筛选属性；
   * 未列出的模块统一落到 `misc`（其他开源）。
   */
  const LEGACY_META: Record<string, { category: string; license: string; language: string; stars: number }> = {
    'comic.workbench': { category: 'ai-01', license: 'MIT', language: 'TypeScript', stars: 8900 }, // 漫剧工作台归入「AI-人工智能」
    'comic.genpack.basic': { category: 'ai-01', license: 'MIT', language: 'TypeScript', stars: 7200 }, // 生成包基础版同属 AI 组
    'comic.genpack.pro': { category: 'ai-01', license: 'MIT', language: 'TypeScript', stars: 6400 }, // 生成包专业版同属 AI 组
    'comic.genpack.team': { category: 'ai-01', license: 'MIT', language: 'TypeScript', stars: 5100 }, // 生成包团队版同属 AI 组
    'ai.dubbing': { category: 'ai-06', license: 'MIT', language: 'Python', stars: 6700 }, // 配音合成归入「自然语言处理」
    'ai.script': { category: 'ai-07', license: 'MIT', language: 'Python', stars: 5600 }, // 剧本扩写归入「大模型」
    'media.storage': { category: 'server-12', license: 'Apache-2.0', language: 'Go', stars: 4300 }, // 素材存储归入「分布式存储系统」
    'template.pack': { category: 'tools-03', license: 'MIT', language: 'JavaScript', stars: 3800 }, // 模板包归入「文本编辑」
  }; // 归类映射结束

  const REGIONS = ['cn', 'global'] as const; // 双区常量，类型收窄为联合类型

  // 模块行 upsert：按 (region, code) 唯一键冲突时更新可变字段，实现「存在则更新、不存在则插入」
  const upsertModule = db.prepare(
    `INSERT INTO modules
       (id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
        region, status, sort_order, category_slug, license, language, stars, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'one_time', ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(region, code) DO UPDATE SET
       name_i18n = excluded.name_i18n,
       summary_i18n = excluded.summary_i18n,
       unlock_mode = excluded.unlock_mode,
       entitlements_required = excluded.entitlements_required,
       status = excluded.status,
       sort_order = excluded.sort_order,
       category_slug = excluded.category_slug,
       license = excluded.license,
       language = excluded.language,
       stars = excluded.stars,
       updated_at = excluded.updated_at`,
  ); // prepare 结束

  // 价格行 upsert：按 id 唯一键冲突时刷新价格，避免重复写入多行历史价
  const upsertPrice = db.prepare(
    `INSERT INTO module_prices (id, module_id, currency, amount_minor, effective_from, effective_to, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       currency = excluded.currency,
       amount_minor = excluded.amount_minor,
       effective_from = excluded.effective_from,
       created_at = excluded.created_at`,
  ); // prepare 结束

  const seed = db.transaction(() => { // 包成事务：任一写入失败则整体回滚，避免只写入半套数据
    for (const def of defs) { // 逐模块
      for (const region of REGIONS) { // 逐区域（cn / global 各一行）
        const meta = LEGACY_META[def.code] ?? { category: 'misc-01', license: 'MIT', language: 'TypeScript', stars: 1000 }; // 未登记的模块落到「其他开源」并给默认属性
        upsertModule.run( // 按占位符顺序绑定参数
          `mod:${def.code}:${region}`, // 主键：模块 ID 拼区域后缀，保证跨区唯一
          def.code, // 模块业务编码
          JSON.stringify(def.nameI18n), // 多语言名称序列化为 JSON 文本落库
          JSON.stringify(def.summaryI18n), // 多语言简介序列化为 JSON 文本落库
          JSON.stringify(def.requires), // 前置依赖序列化为 JSON 数组，空数组表示无前置
          region, // 区域值，参与唯一键与后续查询过滤
          def.sortOrder, // 排序权重
          meta.category, // 二级分类标识（归类口径见 LEGACY_META）
          meta.license, // 开源许可
          meta.language, // 编程语言
          meta.stars, // Star 数
          now, // created_at：仅首次插入生效，冲突更新时不变
          now, // updated_at：每次 upsert 都会刷新
        ); // run 调用结束
        // 该区域有定价才写入价格行（免费模块不落价格，前端显示「免费」）
        const price = def.price?.[region]; // 取本区域价格定义
        if (price) { // 仅付费模块写价格
          upsertPrice.run( // 写入/刷新价格行
            `price:${def.code}:${region}`, // 价格行主键：模块 + 区域
            `mod:${def.code}:${region}`, // 关联模块主键
            price.currency, // 币种（CNY / USD）
            price.amount_minor, // 金额（最小货币单位）
            now, // 生效起始：种子时间，长期有效
            now, // 创建时间
          ); // run 调用结束
        } // 价格写入结束
      } // 区域循环结束
    } // 模块循环结束
  }); // 事务函数准备完成
  seed(); // 执行事务，完成种子数据写入
} // seedModules 结束

/**
 * 分类树种子：把 core-domain 的 19 个一级分类与 205 个二级条目写入 module_categories。
 * 幂等策略与模块种子一致——按 slug 唯一键 upsert，重复启动只刷新名称/排序，不产生重复行；
 * 父键指向一级分类主键，保证导航查询可按 parent_id 直接组装两层结构。
 */
export function seedCatalogCategories(db: Db): void { // 分类树种子入口，测试内存库同样执行
  const now = new Date().toISOString(); // 统一时间戳，保证同批数据创建时间一致
  // 分类行 upsert：slug 全局唯一，名称/排序变更随代码更新自动刷新
  const upsert = db.prepare(
    `INSERT INTO module_categories (id, parent_id, level, slug, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       parent_id = excluded.parent_id,
       level = excluded.level,
       name = excluded.name,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
  ); // prepare 结束

  const seed = db.transaction(() => { // 整棵树同一事务写入，失败即整体回滚
    CATALOG_GROUPS.forEach((group, groupIndex) => { // 逐一级分类
      const groupNo = groupIndex + 1; // 一级序号从 1 开始
      upsert.run(`cat:${group.slug}`, null, 1, group.slug, group.name, groupNo, now, now); // 一级分类：parent_id 为空
      group.items.forEach((item, itemIndex) => { // 逐二级条目
        const itemNo = itemIndex + 1; // 二级序号从 1 开始
        const itemSlug = `${group.slug}-${String(itemNo).padStart(2, '0')}`; // 二级标识，与模块编码共享同一规则
        upsert.run( // 二级条目行
          `cat:${itemSlug}`, // 主键
          `cat:${group.slug}`, // 父键指回一级分类
          2, // 层级
          itemSlug, // 全局唯一 slug
          item, // 条目名称
          groupNo * 100 + itemNo, // 排序权重与模块一致
          now, // 创建时间
          now, // 更新时间
        ); // run 结束
      }); // 二级遍历结束
    }); // 一级遍历结束
  }); // 事务定义结束
  seed(); // 执行事务
} // seedCatalogCategories 结束

/**
 * 二级模块种子：把分类树里每个二级条目落成一个模块（cn/global 各一行，共 410 行）。
 * 语义口径（用户 2026-11-10 指令）：只有二级条目是「模块」，一级分类仅作导航；
 * 这些模块一律免费（不写价格行）、无前置依赖，许可/语言/Star 取自已确定的演示映射。
 */
export function seedCategoryModules(db: Db): void { // 二级模块种子入口
  const now = new Date().toISOString(); // 统一时间戳
  const seeds = buildCatalogModuleSeeds(); // 由分类树展开 205 条模块定义
  const REGIONS = ['cn', 'global'] as const; // 双区常量
  // 模块行 upsert：与存量模块同表，靠 (region, code) 唯一键共存
  const upsert = db.prepare(
    `INSERT INTO modules
       (id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
        region, status, sort_order, category_slug, license, language, stars, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'one_time', '[]', ?, 'active', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(region, code) DO UPDATE SET
       name_i18n = excluded.name_i18n,
       summary_i18n = excluded.summary_i18n,
       status = excluded.status,
       sort_order = excluded.sort_order,
       category_slug = excluded.category_slug,
       license = excluded.license,
       language = excluded.language,
       stars = excluded.stars,
       updated_at = excluded.updated_at`,
  ); // prepare 结束

  const seed = db.transaction(() => { // 整批同一事务
    for (const item of seeds) { // 逐条二级模块
      // 名称与简介：英文暂沿用中文原名（人工翻译前的占位口径，已在文档标注）
      const nameI18n = JSON.stringify({ 'zh-CN': item.name, 'en-US': item.name }); // 多语言名称
      const summaryI18n = JSON.stringify({ // 多语言简介
        'zh-CN': `${item.name} 方向的模块化能力集合，可在商城内一次性解锁后使用。`, // 中文简介
        'en-US': `Modular capability set for ${item.name}; unlock once in the store.`, // 英文简介
      }); // 简介序列化结束
      for (const region of REGIONS) { // 逐个区域
        upsert.run( // 写入模块行
          `mod:${item.code}:${region}`, // 主键：模块码 + 区域
          item.code, // 模块编码
          nameI18n, // 名称 JSON
          summaryI18n, // 简介 JSON
          region, // 区域
          item.sort_order, // 排序权重
          item.item_slug, // 二级分类标识
          item.license, // 许可
          item.language, // 语言
          item.stars, // Star 数
          now, // 创建时间
          now, // 更新时间
        ); // run 结束
      } // 区域循环结束
    } // 模块循环结束
  }); // 事务定义结束
  seed(); // 执行事务
} // seedCategoryModules 结束

/** 内置权限点清单：路由侧 requirePermission 与后台角色编辑页共用同一份定义 */
export const RBAC_PERMISSIONS = [ // 权限点数组，顺序即后台展示顺序
  { code: 'module:read', name: { 'zh-CN': '查看模块', 'en-US': 'Read modules' } }, // 读取模块目录与详情
  { code: 'module:write', name: { 'zh-CN': '变更模块状态', 'en-US': 'Change module status' } }, // 模块状态迁移 draft→active→archived
  { code: 'entitlement:read', name: { 'zh-CN': '查看权益', 'en-US': 'Read entitlements' } }, // 查询任意用户的权益记录
  { code: 'entitlement:grant', name: { 'zh-CN': '发放权益', 'en-US': 'Grant entitlements' } }, // 手工发放模块权益
  { code: 'entitlement:revoke', name: { 'zh-CN': '回收权益', 'en-US': 'Revoke entitlements' } }, // 回收已发放权益
  { code: 'user:read', name: { 'zh-CN': '查看用户', 'en-US': 'Read users' } }, // 查询用户列表与详情
  { code: 'rbac:read', name: { 'zh-CN': '查看角色权限', 'en-US': 'Read roles' } }, // 读取角色、权限与授权关系
  { code: 'rbac:write', name: { 'zh-CN': '管理角色权限', 'en-US': 'Manage roles' } }, // 增删角色、改权限、改用户角色
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
  { // 运营管理员：可改模块、发放与回收权益，不可改角色授权
    code: 'operator', // 角色码
    name: { 'zh-CN': '运营管理员', 'en-US': 'Operator' }, // 多语言名称
    description: { 'zh-CN': '可变更模块状态、发放与回收权益，可查看用户', 'en-US': 'Change module status, grant/revoke entitlements, read users' }, // 多语言描述
    permissions: [ // 运营侧基线权限
      'module:read', // 需要看到模块列表才能操作
      'module:write', // 允许上下线模块
      'entitlement:read', // 需要查看权益现状
      'entitlement:grant', // 允许发放权益
      'entitlement:revoke', // 允许回收权益
      'user:read', // 需要按用户查权益
      'rbac:read', // 需要知道自己持有哪些权限
    ] as const, // 断言常量，元素类型须落在 RbacPermissionCode 内
  }, // operator 结束
  { // 只读观察者：仅供审计与客服查询
    code: 'viewer', // 角色码
    name: { 'zh-CN': '只读观察员', 'en-US': 'Viewer' }, // 多语言名称
    description: { 'zh-CN': '只读查看模块、权益与用户，不能产生任何写操作', 'en-US': 'Read-only access to modules, entitlements and users' }, // 多语言描述
    permissions: [ // 只读基线权限
      'module:read', // 查看模块
      'entitlement:read', // 查看权益
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
        permission.code, // 权限码，如 module:write
        JSON.stringify(permission.name), // 多语言名称序列化落库
        '{}', // 内置权限暂无描述，保留空对象以便后台后续补充
        now, // created_at
        now, // updated_at
      ); // run 结束
    } // 权限点循环结束
    for (const role of RBAC_ROLES) { // 逐条写入内置角色
      upsertRole.run( // 按占位符顺序绑定
        role.code, // 角色码，如 operator
        JSON.stringify(role.name), // 多语言名称
        JSON.stringify(role.description), // 多语言描述
        now, // created_at
        now, // updated_at
      ); // run 结束
      for (const permissionCode of role.permissions) { // 逐条补齐该角色的基线权限
        insertRolePermission.run(role.code, permissionCode, now); // 已存在则忽略，保证幂等
      } // 权限循环结束
    } // 角色循环结束
  }); // 事务函数准备完成
  seed(); // 执行事务
} // seedRbac 结束
