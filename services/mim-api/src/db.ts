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
  seedRbac(db); // 写入内置权限点与内置角色，保证首启即有可用的 RBAC 基线
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
