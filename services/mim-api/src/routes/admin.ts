/** 后台管理控制面（RBAC）：角色 / 权限 / 用户角色授权的读写端点，全部按细粒度权限点鉴权 */

import { Router } from 'express'; // 路由工厂：产出可挂到 /api/v1 的 Router 实例
import { z } from 'zod'; // 声明式请求体校验，统一经 parse 转译为 VALIDATION_FAILED
import { AppError } from '@mim/core-domain'; // 统一业务异常：错误码与 HTTP 状态码映射集中管理
import { RBAC_PERMISSIONS } from '../db.js'; // 内置权限点清单：超管引导通道直接回显全量权限
import { clockOf } from '../domain.js'; // 统一时钟：测试可注入固定时间，避免断言抖动
import { loadPermissions, requirePermission } from '../middleware.js'; // 实时权限加载 + 细粒度权限门禁
import { parse } from '../validate.js'; // zod 校验包装：失败抛 VALIDATION_FAILED 并透出 issues
import { jsonParse, pathParam } from '../utils.js'; // JSON 文本容错解析 + 路径参数类型收敛
import { runPriceBatch, listBatches, getBatch, rollbackBatch } from '../commerce/price-batch.js'; // 批量改价：执行 / 列表 / 回滚
import { listAllRules, replaceSubjectRules, deleteRule } from '../commerce/category-access.js'; // 分类级权限规则管理
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与数据库连接类型，仅编译期引用

/** permissions 表行结构：列名与 schema.sql 严格一一对应 */
interface PermissionRow {
  code: string; // 权限码，如 module:write
  name_i18n: string; // 多语言名称 JSON 文本
  description_i18n: string; // 多语言描述 JSON 文本
  builtin: number; // 1 表示内置权限点，后台不可删除
  created_at: string; // 创建时间（ISO-8601）
  updated_at: string; // 最近更新时间（ISO-8601）
} // PermissionRow 结束

/** roles 表行结构：列名与 schema.sql 严格一一对应 */
interface RoleRow {
  code: string; // 角色码，如 superadmin
  name_i18n: string; // 多语言名称 JSON 文本
  description_i18n: string; // 多语言描述 JSON 文本
  builtin: number; // 1 表示内置角色，名称/描述不可改、不可删
  created_at: string; // 创建时间（ISO-8601）
  updated_at: string; // 最近更新时间（ISO-8601）
} // RoleRow 结束

/** role_permissions 关联行结构：只取需要的两列 */
interface RolePermissionRow {
  role_code: string; // 角色码
  permission_code: string; // 权限码
} // RolePermissionRow 结束

/** user_roles 关联行结构：授权审计信息一并取出 */
interface UserRoleRow {
  user_id: string; // 被授权用户 ID
  role_code: string; // 授予的角色码
  granted_by: string; // 授权人（用户 ID 或 bootstrap 表示超管引导通道）
  created_at: string; // 授权时间（ISO-8601）
} // UserRoleRow 结束

/** users 表对外视图行结构：只取后台列表需要的列，不暴露手机号等敏感字段 */
interface UserListRow {
  id: string; // 用户主键
  region: string; // 所属区域 cn / global
  status: string; // 账号状态 active / pending_deletion / deleted
  display_name: string; // 展示名，可能为空串
  locale: string; // 语言偏好，如 zh-CN
  timezone: string; // 时区，如 Asia/Shanghai
  created_at: string; // 注册时间（ISO-8601）
  updated_at: string; // 最近更新时间（ISO-8601）
} // UserListRow 结束

/** 角色对外视图：把下划线列名与 JSON 文本翻译成前端友好的结构 */
interface RoleView {
  code: string; // 角色码
  name: Record<string, string>; // 多语言名称对象
  description: Record<string, string>; // 多语言描述对象
  builtin: boolean; // 是否内置角色
  permissions: string[]; // 该角色当前拥有的权限码集合
  created_at: string; // 创建时间
  updated_at: string; // 最近更新时间
} // RoleView 结束

/** 多语言映射入参：键为语言标签，值为文案；空对象无意义故一并拒绝 */
const i18nSchema = z
  .record(z.string(), z.string()) // zod v4 的 record 要求显式声明键与值类型
  .refine((value) => Object.keys(value).length > 0, { message: 'i18n map must not be empty' }); // 至少一条文案，避免写入空壳

/** 新建角色入参：code 采用小写字母开头的短横线命名，便于 URL 与前端路由直接使用 */
const roleCreateSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_-]{2,31}$/, 'code must match ^[a-z][a-z0-9_-]{2,31}$'), // 3-32 位，首字符小写字母
  name: i18nSchema, // 角色名称，必填
  description: i18nSchema.optional(), // 角色描述，选填
  permissions: z.array(z.string()).default([]), // 初始权限码，默认空数组（先建角色后配权限也可）
}); // roleCreateSchema 结束

/** 修改角色入参：至少提供 name 或 description 之一，避免空 PATCH 产生无意义写库 */
const roleUpdateSchema = z
  .object({
    name: i18nSchema.optional(), // 可选新名称
    description: i18nSchema.optional(), // 可选新描述
  }) // 基础对象定义结束
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'at least one of name / description is required', // 空 PATCH 视为参数错误而非静默成功
  }); // refine 结束

/** 整体替换角色权限入参 */
const rolePermissionsSchema = z.object({
  permissions: z.array(z.string()), // 允许空数组，表示清空该角色全部权限
}); // rolePermissionsSchema 结束

/** 给用户授予角色入参 */
const userRoleGrantSchema = z.object({
  role_code: z.string().min(1), // 角色码必填，存在性在处理器内单独校验以返回 404
}); // userRoleGrantSchema 结束

/** 用户列表查询参数：q / limit / offset 全部走 coerce，容忍 query 里的字符串形态 */
const userListQuerySchema = z.object({
  q: z.string().trim().max(64).optional(), // 关键字，最长 64 字符，避免超长 LIKE 拖慢查询
  limit: z.coerce.number().int().min(1).max(100).default(20), // 每页条数，上限 100 防止大页拖库
  offset: z.coerce.number().int().min(0).default(0), // 偏移量，负数直接判参数错误
}); // userListQuerySchema 结束

/** 把 permissions 表行翻译成对外结构 */
function toPermissionView(row: PermissionRow) {
  return { // 返回前端可直接渲染的对象
    code: row.code, // 权限码
    name: jsonParse<Record<string, string>>(row.name_i18n) ?? {}, // 名称 JSON 容错解析，脏数据降级为空对象
    description: jsonParse<Record<string, string>>(row.description_i18n) ?? {}, // 描述 JSON 容错解析
    builtin: row.builtin === 1, // 数值 0/1 转布尔，前端按此禁用删除按钮
    created_at: row.created_at, // 创建时间
    updated_at: row.updated_at, // 更新时间
  }; // 视图对象结束
} // toPermissionView 结束

/** 查询单个角色的完整视图（含权限码集合）；不存在返回 null 由调用方决定错误码 */
function loadRoleView(db: Db, code: string): RoleView | null {
  const row = db
    .prepare(
      `SELECT code, name_i18n, description_i18n, builtin, created_at, updated_at
         FROM roles WHERE code = ?`, // 按主键精确取一行，避免全表扫描
    )
    .get(code) as RoleRow | undefined; // get 返回 undefined 表示角色不存在
  if (!row) return null; // 不存在时提前返回，交由调用方抛 NOT_FOUND
  const permissionRows = db
    .prepare(
      `SELECT permission_code FROM role_permissions WHERE role_code = ? ORDER BY permission_code`, // 按权限码排序保证输出稳定
    )
    .all(code) as Array<{ permission_code: string }>; // 只取权限码列，减少数据传输
  return {
    code: row.code, // 角色码
    name: jsonParse<Record<string, string>>(row.name_i18n) ?? {}, // 名称 JSON 容错解析
    description: jsonParse<Record<string, string>>(row.description_i18n) ?? {}, // 描述 JSON 容错解析
    builtin: row.builtin === 1, // 是否为内置角色
    permissions: permissionRows.map((item) => item.permission_code), // 拍平成字符串数组
    created_at: row.created_at, // 创建时间
    updated_at: row.updated_at, // 更新时间
  }; // RoleView 结束
} // loadRoleView 结束

/** 校验权限码是否全部存在，返回不存在的那部分（空数组代表全部合法） */
function unknownPermissionCodes(db: Db, codes: string[]): string[] {
  if (codes.length === 0) return []; // 空集合无需查库，直接判定合法
  const known = new Set(
    (db.prepare(`SELECT code FROM permissions`).all() as Array<{ code: string }>).map((row) => row.code), // 一次性取出全部已知权限码建集合
  ); // 集合查表为 O(1)，避免循环内逐条查库
  return codes.filter((code) => !known.has(code)); // 过滤出不存在的权限码
} // unknownPermissionCodes 结束

/** 取用户已授予的角色码列表 */
function loadUserRoleCodes(db: Db, userId: string): string[] {
  const rows = db
    .prepare(`SELECT role_code FROM user_roles WHERE user_id = ? ORDER BY role_code`) // 排序保证响应稳定便于断言
    .all(userId) as Array<{ role_code: string }>; // 只关心角色码
  return rows.map((row) => row.role_code); // 拍平成字符串数组
} // loadUserRoleCodes 结束

/** 判断用户是否存在（含软删除用户，后台仍可查历史） */
function userExists(db: Db, userId: string): boolean {
  const row = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId) as { id: string } | undefined; // 主键查询开销极低
  return row !== undefined; // 命中即存在
} // userExists 结束

/** 判断角色是否存在，返回其内置标记 */
function loadRoleMeta(db: Db, code: string): { code: string; builtin: number } | null {
  const row = db.prepare(`SELECT code, builtin FROM roles WHERE code = ?`).get(code) as
    | { code: string; builtin: number }
    | undefined; // 只取判定所需的两列
  return row ?? null; // 统一 null 语义，避免 undefined 泄漏到调用方
} // loadRoleMeta 结束

export function createAdminRouter(deps: ApiDeps): Router {
  const router = Router(); // 创建独立 Router，避免影响其它命名空间的路由注册顺序
  const db = deps.db; // 依赖提升为局部变量，处理器内少一次属性访问

  // ── 当前身份：给后台首屏回显「我是谁、我有哪些权限」 ────────────────────────────

  router.get('/admin/me', requirePermission('rbac:read'), (req, res) => {
    // 三个内置角色均含 rbac:read，因此该端点对全部合法后台身份开放
    if (req.adminBootstrap === true) {
      // 超管引导通道（x-admin-token）没有对应真实用户，用内置全量权限代替
      res.json({
        bootstrap: true, // 标记本次身份来自引导令牌
        user: null, // 无真实用户主体
        roles: ['superadmin'], // 视作超级管理员
        permissions: RBAC_PERMISSIONS.map((permission) => permission.code), // 全量权限码
      }); // 响应体结束
      return; // 引导通道分支处理完毕，直接返回
    } // if 结束：引导通道分支
    const user = req.user!; // requirePermission 已保证此处存在真实用户
    res.json({
      bootstrap: false, // 常规 Bearer 身份
      user, // 回显 AuthUser（不含敏感字段）
      roles: loadUserRoleCodes(db, user.id), // 该用户实际授予的角色
      permissions: [...loadPermissions(db, user.id)].sort(), // 实时计算的有效权限，撤销后立即消失
    }); // 响应体结束
  }); // GET /admin/me 结束

  // ── 权限点：只读，内置清单由种子维护 ──────────────────────────────────────────

  router.get('/admin/permissions', requirePermission('rbac:read'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT code, name_i18n, description_i18n, builtin, created_at, updated_at
           FROM permissions ORDER BY code`, // 按权限码排序，前端勾选矩阵顺序稳定
      )
      .all() as PermissionRow[]; // 权限点总量很小，一次性全取
    res.json({ permissions: rows.map(toPermissionView) }); // 统一包一层 permissions 字段便于前端解构
  }); // GET /admin/permissions 结束

  // ── 角色：读列表 / 建 / 改 / 删 / 权限替换 ───────────────────────────────────

  router.get('/admin/roles', requirePermission('rbac:read'), (_req, res) => {
    const roleRows = db
      .prepare(
        `SELECT code, name_i18n, description_i18n, builtin, created_at, updated_at
           FROM roles ORDER BY builtin DESC, code`, // 内置角色置顶，其余按字母序
      )
      .all() as RoleRow[]; // 角色数量有限，全量返回
    const mappingRows = db
      .prepare(`SELECT role_code, permission_code FROM role_permissions`) // 一次取出全部映射，避免 N+1 查询
      .all() as RolePermissionRow[]; // 映射总量 = 角色数 × 权限数，规模很小
    const permissionMap = new Map<string, string[]>(); // 角色码 → 权限码数组
    for (const mapping of mappingRows) {
      // 逐条归档到对应角色
      const list = permissionMap.get(mapping.role_code) ?? []; // 不存在则初始化空数组
      list.push(mapping.permission_code); // 追加权限码
      permissionMap.set(mapping.role_code, list); // 回写映射
    } // for 结束：权限映射归集完毕
    const roles: RoleView[] = roleRows.map((row) => ({
      code: row.code, // 角色码
      name: jsonParse<Record<string, string>>(row.name_i18n) ?? {}, // 名称 JSON 容错解析
      description: jsonParse<Record<string, string>>(row.description_i18n) ?? {}, // 描述 JSON 容错解析
      builtin: row.builtin === 1, // 是否内置
      permissions: permissionMap.get(row.code) ?? [], // 该角色的权限码集合
      created_at: row.created_at, // 创建时间
      updated_at: row.updated_at, // 更新时间
    })); // map 结束
    res.json({ roles }); // 统一包一层 roles 字段
  }); // GET /admin/roles 结束

  router.post('/admin/roles', requirePermission('rbac:write'), (req, res) => {
    const body = parse(roleCreateSchema, req.body); // 先校验入参形态，非法直接 400
    if (loadRoleMeta(db, body.code)) {
      // 主键冲突（含与内置角色同名）统一按 CONFLICT 处理
      throw new AppError('CONFLICT', 'role code already exists', { code: body.code }); // 409 让前端提示换一个码
    } // if 结束：角色码占用检查
    const permissionCodes = [...new Set(body.permissions)]; // 去重，避免 PRIMARY KEY 冲突刷屏
    const unknown = unknownPermissionCodes(db, permissionCodes); // 校验权限码是否都已存在
    if (unknown.length > 0) {
      // 引用不存在的权限点属于入参错误，不是服务端故障
      throw new AppError('VALIDATION_FAILED', 'unknown permission codes', { unknown }); // 400 并回传非法清单
    } // if 结束：权限码合法性检查
    const now = clockOf(deps); // 统一时间源，事务内所有写入共用同一时刻
    const createRole = db.transaction(() => {
      // 角色与权限映射必须同批生效，避免出现「有角色无权限」的中间态
      db.prepare(
        `INSERT INTO roles (code, name_i18n, description_i18n, builtin, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`, // builtin 固定 0：后台创建的角色一律非内置
      ).run(body.code, JSON.stringify(body.name), JSON.stringify(body.description ?? {}), now, now); // 写入角色主体
      const insertMapping = db.prepare(
        `INSERT OR IGNORE INTO role_permissions (role_code, permission_code, created_at) VALUES (?, ?, ?)`, // 已去重，OR IGNORE 仅作兜底
      ); // prepare 结束
      for (const permissionCode of permissionCodes) {
        // 逐条建立角色与权限的映射
        insertMapping.run(body.code, permissionCode, now); // 绑定角色码、权限码与时间
      } // for 结束：权限映射写入完毕
    }); // 事务函数准备完成
    createRole(); // 执行事务
    res.status(201).json({ role: loadRoleView(db, body.code) }); // 回传创建后的完整角色，前端免二次请求
  }); // POST /admin/roles 结束

  router.patch('/admin/roles/:code', requirePermission('rbac:write'), (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数并收敛为 string
    const meta = loadRoleMeta(db, code); // 先确认角色存在
    if (!meta) {
      // 不存在与无权限要区分开，便于排障
      throw new AppError('NOT_FOUND', 'role not found', { role_code: code }); // 404
    } // if 结束：角色存在性检查
    if (meta.builtin === 1) {
      // 内置角色的名称与描述以代码种子为唯一真源，禁止后台改写
      throw new AppError('FORBIDDEN', 'builtin role cannot be modified', { role_code: code }); // 403
    } // if 结束：内置角色写保护
    const body = parse(roleUpdateSchema, req.body); // 校验至少提供一个可改字段
    const sets: string[] = ['updated_at = ?']; // SET 子句首项固定刷新更新时间
    const values: unknown[] = [clockOf(deps)]; // 与 SET 顺序对齐的占位值
    if (body.name !== undefined) {
      // 仅当显式提供名称时才写该列，未提供的字段保持原值
      sets.push('name_i18n = ?'); // 追加名称列
      values.push(JSON.stringify(body.name)); // 序列化多语言对象
    } // if 结束：名称更新分支
    if (body.description !== undefined) {
      // 描述同理，避免把未传字段误清空
      sets.push('description_i18n = ?'); // 追加描述列
      values.push(JSON.stringify(body.description)); // 序列化多语言对象
    } // if 结束：描述更新分支
    values.push(code); // 末尾补主键，对应 WHERE code = ?
    db.prepare(`UPDATE roles SET ${sets.join(', ')} WHERE code = ?`).run(...values); // 动态拼 SET 但列名全部来自代码常量，无注入风险
    res.json({ role: loadRoleView(db, code) }); // 回传更新后的完整角色
  }); // PATCH /admin/roles/:code 结束

  router.delete('/admin/roles/:code', requirePermission('rbac:write'), (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const meta = loadRoleMeta(db, code); // 存在性 + 内置标记
    if (!meta) {
      // 已删除或从未存在
      throw new AppError('NOT_FOUND', 'role not found', { role_code: code }); // 404
    } // if 结束：角色存在性检查
    if (meta.builtin === 1) {
      // 内置角色是系统基线，删除会导致种子与库不一致
      throw new AppError('FORBIDDEN', 'builtin role cannot be deleted', { role_code: code }); // 403
    } // if 结束：内置角色删除保护
    const assignment = db
      .prepare(`SELECT COUNT(*) AS total FROM user_roles WHERE role_code = ?`) // 统计仍被引用的授权数
      .get(code) as { total: number }; // COUNT 一定返回一行
    if (assignment.total > 0) {
      // 有用户仍在用该角色时删除会静默剥夺权限，必须显式拒绝
      throw new AppError('CONFLICT', 'role is still assigned to users', {
        role_code: code, // 回传冲突角色
        assignments: assignment.total, // 回传引用计数，便于前端提示先解绑
      }); // 409 结束
    } // if 结束：引用检查
    db.prepare(`DELETE FROM roles WHERE code = ?`).run(code); // role_permissions 由外键 ON DELETE CASCADE 级联清理
    res.json({ code, deleted: true }); // 明确告知删除成功
  }); // DELETE /admin/roles/:code 结束

  router.get('/admin/roles/:code/permissions', requirePermission('rbac:read'), (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    if (!loadRoleMeta(db, code)) {
      // 角色不存在时返回 404 而不是空数组，避免前端误以为权限被清空
      throw new AppError('NOT_FOUND', 'role not found', { role_code: code }); // 404
    } // if 结束：角色存在性检查
    res.json({ role_code: code, permissions: loadRoleView(db, code)!.permissions }); // 复用视图函数，保证口径与列表一致
  }); // GET /admin/roles/:code/permissions 结束

  router.put('/admin/roles/:code/permissions', requirePermission('rbac:write'), (req, res) => {
    const code = pathParam(req, 'code'); // 取路径参数
    const body = parse(rolePermissionsSchema, req.body); // 校验入参为字符串数组
    const meta = loadRoleMeta(db, code); // 存在性 + 内置标记
    if (!meta) {
      // 角色不存在
      throw new AppError('NOT_FOUND', 'role not found', { role_code: code }); // 404
    } // if 结束：角色存在性检查
    if (code === 'superadmin') {
      // 超管权限集合是最后的兜底通道，整体替换可能把管理员自己锁在门外
      throw new AppError('FORBIDDEN', 'superadmin permissions cannot be replaced', { role_code: code }); // 403
    } // if 结束：超管权限保护（operator / viewer 等内置角色允许按需调整）
    const permissionCodes = [...new Set(body.permissions)]; // 去重
    const unknown = unknownPermissionCodes(db, permissionCodes); // 校验权限码存在性
    if (unknown.length > 0) {
      // 引用不存在的权限点属参数错误
      throw new AppError('VALIDATION_FAILED', 'unknown permission codes', { unknown }); // 400
    } // if 结束：权限码合法性检查
    const now = clockOf(deps); // 统一时间源
    const replacePermissions = db.transaction(() => {
      // 先清空再写入，保证「整体替换」语义且不残留旧权限
      db.prepare(`DELETE FROM role_permissions WHERE role_code = ?`).run(code); // 删除该角色全部映射
      const insertMapping = db.prepare(
        `INSERT OR IGNORE INTO role_permissions (role_code, permission_code, created_at) VALUES (?, ?, ?)`, // 已去重，OR IGNORE 仅兜底
      ); // prepare 结束
      for (const permissionCode of permissionCodes) {
        // 逐条写入新映射
        insertMapping.run(code, permissionCode, now); // 绑定角色码、权限码与时间
      } // for 结束：新映射写入完毕
    }); // 事务函数准备完成
    replacePermissions(); // 执行事务，失败自动回滚到替换前状态
    res.json({ role_code: code, permissions: permissionCodes }); // 回传最终生效的权限码
  }); // PUT /admin/roles/:code/permissions 结束

  // ── 用户：列表检索 + 角色授权 ───────────────────────────────────────────────

  router.get('/admin/users', requirePermission('user:read'), (req, res) => {
    const query = parse(userListQuerySchema, req.query); // 校验并收敛 query 参数
    const keyword = query.q ?? ''; // 未提供时用空串占位，SQL 里据此短路
    const like = `%${keyword}%`; // LIKE 模糊匹配模式（SQLite 参数化绑定，注入无风险）
    // users 表没有手机号/邮箱列，标识信息在 identities 表，故用 EXISTS 子查询覆盖按手机号/邮箱搜索
    const whereSql = `(? = '' OR u.id LIKE ? OR u.display_name LIKE ? OR EXISTS (
      SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.identifier LIKE ?
    ))`; // 空关键字时恒真，等价于不过滤
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${whereSql}`) // 先取总数供前端分页
      .get(keyword, like, like, like) as { total: number }; // 四个占位：keyword、id、display_name、identifier
    const rows = db
      .prepare(
        `SELECT u.id, u.region, u.status, u.display_name, u.locale, u.timezone, u.created_at, u.updated_at
           FROM users u WHERE ${whereSql}
          ORDER BY u.created_at DESC
          LIMIT ? OFFSET ?`, // 按注册时间倒序，新用户在前
      )
      .all(keyword, like, like, like, query.limit, query.offset) as UserListRow[]; // 五个占位与上面顺序一致
    const roleMap = new Map<string, string[]>(); // 用户 ID → 角色码数组
    if (rows.length > 0) {
      // 当前页有数据时才查授权表，避免空查询
      const placeholders = rows.map(() => '?').join(','); // 动态占位符数量与当页用户数一致
      const roleRows = db
        .prepare(`SELECT user_id, role_code FROM user_roles WHERE user_id IN (${placeholders}) ORDER BY role_code`) // 一次取回整页授权，规避 N+1
        .all(...rows.map((row) => row.id)) as Array<{ user_id: string; role_code: string }>; // 绑定当页所有用户 ID
      for (const roleRow of roleRows) {
        // 逐条归集到对应用户
        const list = roleMap.get(roleRow.user_id) ?? []; // 不存在则初始化
        list.push(roleRow.role_code); // 追加角色码
        roleMap.set(roleRow.user_id, list); // 回写映射
      } // for 结束：整页授权归集完毕
    } // if 结束：授权批量查询
    res.json({
      users: rows.map((row) => ({ ...row, roles: roleMap.get(row.id) ?? [] })), // 展开行数据并附加角色
      total: totalRow.total, // 满足关键字的全量条数
      limit: query.limit, // 回显生效的分页大小
      offset: query.offset, // 回显生效的偏移量
    }); // 响应体结束
  }); // GET /admin/users 结束

  router.get('/admin/users/:userId/roles', requirePermission('rbac:read'), (req, res) => {
    const userId = pathParam(req, 'userId'); // 取路径参数
    if (!userExists(db, userId)) {
      // 用户不存在时返回 404，避免前端把「查无此人」当成「无任何角色」
      throw new AppError('NOT_FOUND', 'user not found', { user_id: userId }); // 404
    } // if 结束：用户存在性检查
    const rows = db
      .prepare(
        `SELECT user_id, role_code, granted_by, created_at FROM user_roles WHERE user_id = ? ORDER BY role_code`, // 排序保证输出稳定
      )
      .all(userId) as UserRoleRow[]; // 单用户授权量很小
    res.json({ user_id: userId, roles: rows }); // 附带 granted_by / created_at 供审计
  }); // GET /admin/users/:userId/roles 结束

  router.post('/admin/users/:userId/roles', requirePermission('rbac:write'), (req, res) => {
    const userId = pathParam(req, 'userId'); // 取路径参数
    const body = parse(userRoleGrantSchema, req.body); // 校验 role_code 形态
    if (!userExists(db, userId)) {
      // 用户不存在时不允许写入悬空授权
      throw new AppError('NOT_FOUND', 'user not found', { user_id: userId }); // 404
    } // if 结束：用户存在性检查
    if (!loadRoleMeta(db, body.role_code)) {
      // 角色不存在时同样拒绝
      throw new AppError('NOT_FOUND', 'role not found', { role_code: body.role_code }); // 404
    } // if 结束：角色存在性检查
    const grantedBy = req.user?.id ?? 'bootstrap'; // 引导通道没有真实用户，用固定标记留痕
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO user_roles (user_id, role_code, granted_by, created_at) VALUES (?, ?, ?, ?)`, // 重复授权不报错，天然幂等
      )
      .run(userId, body.role_code, grantedBy, clockOf(deps)); // 写入授权记录
    const created = result.changes > 0; // changes 为 0 表示该授权已存在
    res.status(created ? 201 : 200).json({
      user_id: userId, // 被授权用户
      role_code: body.role_code, // 授予的角色
      granted_by: grantedBy, // 操作人留痕
      created, // 区分首次授权与幂等回放，便于前端提示
    }); // 响应体结束
  }); // POST /admin/users/:userId/roles 结束

  router.delete('/admin/users/:userId/roles/:roleCode', requirePermission('rbac:write'), (req, res) => {
    const userId = pathParam(req, 'userId'); // 取用户 ID
    const roleCode = pathParam(req, 'roleCode'); // 取角色码
    const result = db
      .prepare(`DELETE FROM user_roles WHERE user_id = ? AND role_code = ?`) // 精确删除单条授权
      .run(userId, roleCode); // 执行删除
    if (result.changes === 0) {
      // 未删除任何行说明授权不存在，按 404 反馈而不是静默成功
      throw new AppError('NOT_FOUND', 'user role assignment not found', {
        user_id: userId, // 回传用户 ID
        role_code: roleCode, // 回传角色码
      }); // 404 结束
    } // if 结束：删除结果检查
    res.json({ user_id: userId, role_code: roleCode, deleted: true }); // 明确告知回收成功
  }); // DELETE /admin/users/:userId/roles/:roleCode 结束

  // ---------- 商业化三期：批量改价（模块 / 商城商品，三模式 + 快照回滚 + 审计留痕） ----------

  /** POST /admin/commerce/price-batches — 提交一批调价；同幂等键重复提交回放既有批次 */
  router.post('/admin/commerce/price-batches', requirePermission('commerce:write'), (req, res) => {
    const body = parse( // 请求体校验：目标类型 / 模式 / 方向 / 参数 / 筛选条件 / 幂等键
      z.object({
        target_type: z.enum(['module', 'shop_product']), // 调价目标：模块或独立商城商品
        mode: z.enum(['fixed', 'percent', 'amount']), // 固定价 / 百分比 / 固定金额
        direction: z.enum(['set', 'increase', 'decrease']).optional(), // fixed 缺省 set；增减模式必填
        value: z.number().int().min(0), // 模式参数：新价 / 百分点 / 金额（分），非负整数
        filter: z.object({ // 筛选条件快照，全部可选
          region: z.string().min(1).max(16).optional(), // 仅模块：区域
          category_slug: z.string().min(1).max(64).optional(), // 仅模块：一级前缀或二级精确
          codes: z.array(z.string().min(1).max(64)).max(500).optional(), // 显式编码清单
          include_inactive: z.boolean().optional(), // 是否纳入下架目标；缺省只改在售
        }).optional(),
        idempotency_key: z.string().min(1).max(120), // 批次幂等键（操作人作用域内唯一）
      }),
      req.body,
    );
    const now = clockOf(deps); // 统一时间基准
    const batch = runPriceBatch(db, { // 调用服务层：事务内快照 / 计算 / 写入 / 留痕
      targetType: body.target_type, // 目标类型
      mode: body.mode, // 调价模式
      direction: body.direction ?? 'set', // 方向缺省固定
      value: body.value, // 模式参数
      filter: body.filter ?? {}, // 筛选条件
      idempotencyKey: body.idempotency_key, // 幂等键
      actorId: req.user?.id ?? 'bootstrap', // 操作人；引导通道无 req.user 落 bootstrap 标记
    }, now);
    res.status(201).json({ batch }); // 返回批次视图（含逐条快照）
  }); // POST /admin/commerce/price-batches 结束

  /** GET /admin/commerce/price-batches — 最近批次列表（倒序） */
  router.get('/admin/commerce/price-batches', requirePermission('commerce:write'), (_req, res) => {
    res.json({ batches: listBatches(db, 50) }); // 最近 50 批，明细随批次视图一并带出
  }); // GET 列表结束

  /** GET /admin/commerce/price-batches/:id — 批次详情（改前 / 改后快照） */
  router.get('/admin/commerce/price-batches/:id', requirePermission('commerce:write'), (req, res) => {
    const id = pathParam(req, 'id'); // 批次主键
    const batch = getBatch(db, id); // 查批次
    if (!batch) throw new AppError('NOT_FOUND', 'price batch not found', { batch_id: id }); // 不存在 404
    res.json({ batch }); // 返回批次视图
  }); // GET 详情结束

  /** POST /admin/commerce/price-batches/:id/rollback — 按快照回滚一批调价（同事务） */
  router.post('/admin/commerce/price-batches/:id/rollback', requirePermission('commerce:write'), (req, res) => {
    const id = pathParam(req, 'id'); // 批次主键
    res.json({ batch: rollbackBatch(db, id, clockOf(deps)) }); // 回滚后回读最新视图
  }); // POST 回滚结束

  // ---------- 商业化三期：分类级权限规则（角色 / 用户 → 分类 allow / deny） ----------

  /** GET /admin/category-access — 全部分类规则 */
  router.get('/admin/category-access', requirePermission('rbac:write'), (_req, res) => {
    res.json({ rules: listAllRules(db) }); // 全量规则供后台渲染
  }); // GET 规则结束

  /** PUT /admin/category-access — 整组替换某主体（角色 / 用户）的分类规则；空清单即清空 */
  router.put('/admin/category-access', requirePermission('rbac:write'), (req, res) => {
    const body = parse( // 主体类型 + 主体标识 + 规则清单
      z.object({
        subject_type: z.enum(['role', 'user']), // role 按角色码，user 按用户 ID
        subject_id: z.string().min(1).max(64), // 角色码或用户 ID
        rules: z.array(z.object({ // 规则条目
          category_slug: z.string().min(1).max(64), // 一级或二级分类 slug
          effect: z.enum(['allow', 'deny']), // 放行 / 拦截；deny 优先
        })).max(200), // 单主体规则上限，防止脏数据膨胀
      }),
      req.body,
    );
    const rules = replaceSubjectRules(db, { subject_type: body.subject_type, subject_id: body.subject_id }, body.rules, clockOf(deps)); // 同事务清后写
    res.json({ subject_type: body.subject_type, subject_id: body.subject_id, rules }); // 回读该主体最新规则
  }); // PUT 规则结束

  /** DELETE /admin/category-access/:id — 删除单条规则 */
  router.delete('/admin/category-access/:id', requirePermission('rbac:write'), (req, res) => {
    const id = pathParam(req, 'id'); // 规则主键
    if (!deleteRule(db, id)) throw new AppError('NOT_FOUND', 'category access rule not found', { rule_id: id }); // 不存在 404
    res.json({ id, deleted: true }); // 删除成功
  }); // DELETE 规则结束

  return router; // 返回装配完成的管理面路由
} // createAdminRouter 结束
