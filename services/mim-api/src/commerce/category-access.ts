/**
 * 分类级权限（商业化三期）
 *
 * 在既有 RBAC（角色 → 权限点）之上叠加「分类维度」：角色 / 用户可对 catalog
 * 一级 / 二级分类设置 allow / deny。判定口径：
 *   - 无任何规则命中 → 放行（兼容 0.0.6 现网公开行为，不配置即不变）；
 *   - deny 优先于 allow：同一分类只要存在一条 deny 规则即拦截；
 *   - 规则 slug 为二级标识时精确命中；为一级标识时前缀覆盖其全部二级条目；
 *   - 用户级规则与角色级规则合并计算，用户级不覆盖角色级 deny。
 *
 * 生效点：商城列表 / 热门列表过滤、模块详情 403、解锁与下单门禁、购物车加购与结算。
 */

import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 主键
import { verifyAccessToken } from '../auth.js'; // 可选 Bearer 校验（公开路由未挂 requireAuth）
import type { Db } from '../types.js'; // 数据库连接类型

/** 访问主体：登录用户 ID + 其持有的角色码集合；匿名主体为 null + 空数组 */
export interface AccessSubject {
  userId: string | null; // 用户主键；匿名为 null
  roleCodes: string[]; // 角色码列表，来自 user_roles 实时查询
}

/** 规则行结构：与 category_access_rules 表一一对应 */
export interface AccessRuleRow {
  id: string;
  subject_type: 'role' | 'user';
  subject_id: string;
  category_slug: string;
  effect: 'allow' | 'deny';
  created_at: string;
  updated_at: string;
}

/** 读取用户持有的角色码；匿名 / 无角色返回空数组 */
export function loadRoleCodes(db: Db, userId: string): string[] {
  const rows = db.prepare('SELECT role_code FROM user_roles WHERE user_id = ?').all(userId) as Array<{ role_code: string }>;
  return rows.map((row) => row.role_code); // 拍平成字符串数组
}

/** 由请求用户构造访问主体；req.user 缺失时按匿名处理（公开列表场景） */
export function subjectFromUser(db: Db, user: { id: string } | undefined | null): AccessSubject {
  if (!user) return { userId: null, roleCodes: [] }; // 匿名：无规则可命中，保持公开
  return { userId: user.id, roleCodes: loadRoleCodes(db, user.id) }; // 登录态：实时取角色，撤销即时生效
}

/**
 * 从请求构造主体：优先用 requireAuth 挂载的 req.user；
 * 公开路由未挂鉴权中间件时，再尝试可选解析 Bearer 令牌（失败按匿名，不抛 401）。
 */
export function subjectFromRequest(db: Db, req: { user?: { id: string }; header(name: string): string | undefined }, jwtSecret: string): AccessSubject {
  if (req.user) return subjectFromUser(db, req.user); // 已鉴权路由直接取用
  const header = req.header('authorization') ?? ''; // 取 Authorization 头
  const match = /^Bearer\s+(.+)$/i.exec(header); // 严格匹配 Bearer 方案
  if (!match) return { userId: null, roleCodes: [] }; // 无令牌按匿名
  try {
    const payload = verifyAccessToken(match[1], jwtSecret); // 校验签名与过期
    const row = db.prepare('SELECT id FROM users WHERE id = ? AND status != ?').get(payload.sub, 'deleted') as { id: string } | undefined;
    if (!row) return { userId: null, roleCodes: [] }; // 用户不存在/已注销按匿名
    return subjectFromUser(db, { id: row.id }); // 解析成功按登录主体计算规则
  } catch {
    return { userId: null, roleCodes: [] }; // 令牌无效不阻断公开浏览，规则按匿名放行
  }
}

/** 取某二级分类的一级父级 slug；查不到返回 null（老数据 / 脏数据按无父级处理） */
export function resolveParentSlug(db: Db, childSlug: string | null): string | null {
  if (!childSlug) return null; // 无分类标识直接回落
  const row = db
    .prepare('SELECT p.slug AS parent_slug FROM module_categories c LEFT JOIN module_categories p ON p.id = c.parent_id WHERE c.slug = ?')
    .get(childSlug) as { parent_slug: string | null } | undefined;
  return row?.parent_slug ?? null; // 未命中父级返回 null
}

/** 该主体在库中的全部规则（用户级 + 角色级合并） */
export function loadSubjectRules(db: Db, subject: AccessSubject): AccessRuleRow[] {
  if (!subject.userId && subject.roleCodes.length === 0) return []; // 匿名无规则
  const conditions: string[] = []; // 动态拼条件：用户一条 + 每个角色一条
  const params: Array<string> = []; // 与条件对齐的绑定参数
  if (subject.userId) {
    conditions.push('(subject_type = ? AND subject_id = ?)'); // 用户级规则
    params.push('user', subject.userId);
  }
  for (const roleCode of subject.roleCodes) {
    conditions.push('(subject_type = ? AND subject_id = ?)'); // 角色级规则
    params.push('role', roleCode);
  }
  return db.prepare(`SELECT * FROM category_access_rules WHERE ${conditions.join(' OR ')}`).all(...params) as AccessRuleRow[];
}

/** 单条规则是否命中目标分类（二级精确 / 一级前缀 / 父级精确） */
function ruleMatches(ruleSlug: string, childSlug: string | null, parentSlug: string | null): boolean {
  if (!childSlug) return false; // 模块无分类标识：规则无从命中，保持公开
  if (ruleSlug === childSlug) return true; // 二级精确命中
  if (parentSlug && ruleSlug === parentSlug) return true; // 一级精确命中
  if (childSlug.startsWith(`${ruleSlug}-`)) return true; // 一级前缀覆盖二级条目
  return false;
}

/** 判定目标分类是否被该主体 deny；无规则 / 无 deny 均放行 */
export function isCategoryBlocked(db: Db, subject: AccessSubject, categorySlug: string | null): boolean {
  const rules = loadSubjectRules(db, subject); // 取主体全部规则
  if (rules.length === 0) return false; // 未配置：现网公开行为
  const parentSlug = resolveParentSlug(db, categorySlug); // 解析父级用于一级规则匹配
  return rules.some((rule) => rule.effect === 'deny' && ruleMatches(rule.category_slug, categorySlug, parentSlug)); // deny 优先
}

/** 门禁断言：被 deny 时抛 FEATURE_NOT_AVAILABLE(403)，不泄漏「存在但被禁」与「不存在」的差异 */
export function assertCategoryAllowed(db: Db, subject: AccessSubject, categorySlug: string | null, context: { module_code?: string; region?: string }): void {
  if (isCategoryBlocked(db, subject, categorySlug)) {
    throw new AppError('FEATURE_NOT_AVAILABLE', 'module category is not available for current account', {
      category_slug: categorySlug, // 回传分类标识便于前端提示
      ...context, // 附带模块码 / 区域等排查上下文
    });
  }
}

/** 管理端：列出全部分类规则（按主体 + 分类排序，便于后台渲染） */
export function listAllRules(db: Db): AccessRuleRow[] {
  return db.prepare('SELECT * FROM category_access_rules ORDER BY subject_type ASC, subject_id ASC, category_slug ASC').all() as AccessRuleRow[];
}

/** 管理端：整组替换某主体的规则清单（先清后写，同事务；空清单即清空该主体规则） */
export function replaceSubjectRules(db: Db, subject: { subject_type: 'role' | 'user'; subject_id: string }, rules: Array<{ category_slug: string; effect: 'allow' | 'deny' }>, now: string): AccessRuleRow[] {
  const collapsed = new Map<string, 'allow' | 'deny'>(); // 同 slug 去重：deny 优先，避免唯一键冲突
  for (const rule of rules) {
    const prev = collapsed.get(rule.category_slug);
    collapsed.set(rule.category_slug, prev === 'deny' || rule.effect === 'deny' ? 'deny' : 'allow');
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM category_access_rules WHERE subject_type = ? AND subject_id = ?').run(subject.subject_type, subject.subject_id); // 清掉该主体既有规则
    const insert = db.prepare( // 逐条 upsert 新规则
      `INSERT INTO category_access_rules (id, subject_type, subject_id, category_slug, effect, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [categorySlug, effect] of collapsed) { // 写入去重后的规则集
      insert.run(uuidv7(), subject.subject_type, subject.subject_id, categorySlug, effect, now, now);
    }
  });
  tx();
  return listAllRules(db).filter((rule) => rule.subject_type === subject.subject_type && rule.subject_id === subject.subject_id); // 回读该主体规则
}

/** 管理端：按主键删除单条规则；不存在返回 false */
export function deleteRule(db: Db, ruleId: string): boolean {
  const result = db.prepare('DELETE FROM category_access_rules WHERE id = ?').run(ruleId);
  return result.changes > 0; // 是否实际删除
}

/**
 * 列表过滤：批量判定模块集合，返回被 deny 的模块主键集合。
 * 规则只查一次、父级映射只查一次，避免列表 N+1。
 */
export function blockedModuleIds(db: Db, subject: AccessSubject, modules: Array<{ id: string; category_slug: string | null }>): Set<string> {
  const blocked = new Set<string>(); // 结果集合
  const rules = loadSubjectRules(db, subject); // 主体规则一次性取出
  if (rules.length === 0) return blocked; // 未配置：全量放行
  const parentCache = new Map<string, string | null>(); // 二级 slug → 一级 slug 缓存
  for (const module of modules) { // 逐条判定
    const childSlug = module.category_slug; // 模块归属二级分类
    const parentSlug = childSlug ? (parentCache.has(childSlug) ? parentCache.get(childSlug)! : resolveParentSlug(db, childSlug)) : null; // 取父级并缓存
    if (childSlug) parentCache.set(childSlug, parentSlug); // 回填缓存
    const denied = rules.some((rule) => rule.effect === 'deny' && ruleMatches(rule.category_slug, childSlug, parentSlug)); // deny 优先
    if (denied) blocked.add(module.id); // 记录被拦截模块主键
  }
  return blocked; // 交调用方从列表中剔除
}
