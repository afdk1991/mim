/** SQLite 连接与结构迁移 */

import Database from 'better-sqlite3'; // 引入 better-sqlite3 同步驱动，SQLite 读写走同步 API 便于事务内顺序执行
import { existsSync, mkdirSync, readFileSync } from 'node:fs'; // 文件系统工具：判断目录是否存在、递归建目录、读取建表脚本
import { dirname } from 'node:path'; // 取文件所在目录，用于从数据库文件路径推导数据目录
import { fileURLToPath } from 'node:url'; // 把 import.meta.url 转成文件系统路径，满足 ESM 下的路径解析
import type { Db } from './types.js'; // 仅引入数据库连接类型，编译期擦除不产生运行时代码

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url)); // 以模块自身位置解析 schema.sql 绝对路径，保证任意工作目录下都能找到建表脚本

export function createDatabase(filename: string = ':memory:'): Db { // 创建数据库连接：默认内存库（测试用），传路径则落盘持久化
  if (filename !== ':memory:') { // 内存库没有文件系统目录，无需准备目录
    const dir = dirname(filename); // 取数据库文件所在目录
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); // 目录不存在则递归创建，避免首次启动因缺目录直接失败
  } // 目录准备分支结束
  const db = new Database(filename); // 打开或创建数据库文件 / 内存库
  db.pragma('foreign_keys = ON'); // 开启外键约束，保证关联表引用完整性
  if (filename !== ':memory:') db.pragma('journal_mode = WAL'); // 落盘库启用 WAL，提升读写并发并降低写阻塞（内存库不支持）
  db.exec(readFileSync(SCHEMA_PATH, 'utf8')); // 执行建表脚本，全部 IF NOT EXISTS 以便每次启动幂等
  seedModules(db); // 写入模块商城基础数据，保证新库启动即有可售模块
  return db; // 返回已完成初始化的连接
} // createDatabase 结束

/** 功能模块商城种子：第 1 期上线 comic.workbench（cn / global 双区各一行） */
export function seedModules(db: Db): void { // 模块种子入口：幂等 upsert，重复执行不会产生重复行
  const now = new Date().toISOString(); // 统一使用同一时间戳，保证同批数据 created_at / updated_at 一致
  const upsertModule = db.prepare( // 预编译 upsert 语句，循环内复用减少解析开销
    // 说明：按 (region, code) 唯一键冲突时更新可变字段，实现「存在则更新、不存在则插入」
    `INSERT INTO modules
       (id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
        region, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'one_time', '[]', ?, 'active', ?, ?, ?)
     ON CONFLICT(region, code) DO UPDATE SET
       name_i18n = excluded.name_i18n,
       summary_i18n = excluded.summary_i18n,
       unlock_mode = excluded.unlock_mode,
       entitlements_required = excluded.entitlements_required,
       status = excluded.status,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`, // 模板结束：unlock_mode 固定一次性买断，entitlements_required 空数组表示无前置权益要求
  ); // prepare 结束

  const modules = [ // 需要种入的区域清单：同一模块在 cn 与 global 各一条，靠区域隔离
    { // 中国大陆区配置
      region: 'cn', // 归属区域，与 users.region 口径一致
      nameI18n: { 'zh-CN': '漫剧创作工作台', 'en-US': 'Comic Creation Workbench' }, // 多语言名称，前端按 locale 取对应文案
      summaryI18n: { // 多语言简介
        'zh-CN': '剧本、分镜、角色一致性与对白由 AI 建议，人工确认后导出创作工程。', // 中文简介
        'en-US': 'AI-assisted script, storyboard, character consistency and dialogue, confirmed by humans before export.', // 英文简介
      }, // summaryI18n 结束
    }, // cn 配置结束
    { // 海外区配置
      region: 'global', // 归属海外区域
      nameI18n: { 'zh-CN': '漫剧创作工作台', 'en-US': 'Comic Creation Workbench' }, // 名称与国内保持一致，避免两区文案漂移
      summaryI18n: { // 多语言简介
        'zh-CN': '剧本、分镜、角色一致性与对白由 AI 建议，人工确认后导出创作工程。', // 中文简介
        'en-US': 'AI-assisted script, storyboard, character consistency and dialogue, confirmed by humans before export.', // 英文简介
      }, // summaryI18n 结束
    }, // global 配置结束
  ] as const; // 断言为字面量常量，保证 region 等字段类型收窄不被拓宽为 string

  const seed = db.transaction(() => { // 包成事务：任一区域写入失败则整体回滚，避免只写入半套数据
    for (const module of modules) { // 逐区域执行 upsert
      upsertModule.run( // 按占位符顺序绑定参数
        `mod:comic.workbench:${module.region}`, // 主键：模块 ID 拼区域后缀，保证跨区唯一
        'comic.workbench', // 模块业务编码，权限校验时按此值匹配
        JSON.stringify(module.nameI18n), // 多语言名称序列化为 JSON 文本落库
        JSON.stringify(module.summaryI18n), // 多语言简介序列化为 JSON 文本落库
        module.region, // 区域值，参与唯一键与后续查询过滤
        10, // 排序权重：数字越小越靠前，当前仅一个模块
        now, // created_at：仅首次插入生效，冲突更新时不变
        now, // updated_at：每次 upsert 都会刷新
      ); // run 调用结束
    } // 循环结束
  }); // 事务函数准备完成
  seed(); // 执行事务，完成种子数据写入
} // seedModules 结束
