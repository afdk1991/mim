/**
 * 商城购物车（FR-03.1 第 2 阶段）
 *
 * 购物车只做「收集待购模块」，成交语义完全复用既有两条写路径：
 *   - 免费模块（无有效价格或金额为 0）→ 结算时直接发放 active 权益（与 POST /entitlements 同口径）
 *   - 付费模块（金额 > 0）→ 结算时生成 pending 订单（与 POST /orders 同口径），结算仍走人工 / 渠道
 * 因此购物车不会绕过付费校验，也不会引入第二套成交规则。
 *
 * 路由一览（全部需要登录，写操作带幂等键）：
 *   GET    /cart                        我的购物车（含模块信息、单价、已拥有标记、合计）
 *   POST   /cart/items                  加购（同一模块重复加购幂等回放）
 *   DELETE /cart/items/:moduleCode      移除单个
 *   DELETE /cart                        清空
 *   POST   /cart/checkout               结算：免费即时解锁 + 付费生成待结算订单，成功的条目移出车
 */

import { Router } from 'express'; // 路由容器，按前缀挂到 /api/v1
import { z } from 'zod'; // 请求体校验
import { AppError, uuidv7 } from '@mim/core-domain'; // 业务错误码 + 时间有序主键
import { clockOf } from '../domain.js'; // 可注入时钟
import { idempotency, requireAuth } from '../middleware.js'; // 登录 + 写操作幂等
import { parse } from '../validate.js'; // zod 校验统一转 AppError
import { jsonParse } from '../utils.js'; // 安全解析多语言 JSON 列
import { assertDependenciesMet, currentPrice, orderView } from './catalog.js'; // 价格 / 依赖 / 订单视图与商城主路径共用一份口径
import { readPointsConfig } from '../commerce/config.js'; // 积分抵扣配置（兑换比例 / 单笔上限）
import { computeDeduction, deductPoints, getPointsBalance } from '../commerce/points.js'; // 积分抵扣纯计算 + 事务扣减
import { subjectFromUser, assertCategoryAllowed } from '../commerce/category-access.js'; // 分类级权限门禁
import type { ApiDeps, Db } from '../types.js'; // 依赖注入与数据库类型

/** 购物车行：cart_items 联表模块后的最小字段集 */
interface CartRow {
  id: string; // 购物车条目主键
  module_id: string; // 模块主键（跨区同码模块是不同行）
  module_code: string; // 模块编码（前端下单/解锁都用它）
  module_name: string; // 多语言名称 JSON
  module_capability: string | null; // 真实能力键；null 表示功能规划中
  module_status: string; // 模块状态（active 才可结算）
  module_category_slug: string | null; // 归属二级分类标识（分类级权限门禁用）
  created_at: string; // 加购时间
} // CartRow 结束

/** 结算单条结果：成功项（订单或权益）与跳过原因；订单项附带积分抵扣明细 */
type CheckoutOutcome =
  | { module_code: string; kind: 'order'; order: ReturnType<typeof orderView>; points_spent: number; points_deduct_cents: number; payable_cents: number } // 付费模块生成订单（可含积分抵扣）
  | { module_code: string; kind: 'unlocked'; entitlement_id: string } // 免费模块即时发放权益
  | { module_code: string; kind: 'skipped'; reason: string }; // 未处理项（已拥有 / 已下架 / 缺依赖等）

/** 按用户与区域取购物车行，附带模块信息与有效价格筛选所需字段 */
function listCartRows(db: Db, userId: string): CartRow[] {
  return db // 直接返回链式查询
    .prepare( // 预编译：联 modules 取名称与能力键，按加购顺序倒序（最近加的在前）
      `SELECT c.id, c.module_id, c.created_at,
              m.code AS module_code, m.name_i18n AS module_name,
              m.capability AS module_capability, m.status AS module_status,
              m.category_slug AS module_category_slug
       FROM cart_items c
       INNER JOIN modules m ON m.id = c.module_id AND m.deleted_at IS NULL
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC, c.id DESC`, // 同秒加购时按主键兜底排序，保证顺序稳定
    ) // 结束预编译
    .all(userId) as CartRow[]; // 绑定用户 ID
} // listCartRows 结束

/** 某模块当前是否存在 active 且未过期的权益 */
function hasActiveEntitlement(db: Db, userId: string, moduleId: string, now: string): boolean {
  const row = db // 取最新一条未过期权益
    .prepare( // 预编译
      `SELECT status FROM entitlements
       WHERE user_id = ? AND module_id = ? AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC LIMIT 1`, // 与解锁/下单的「已拥有」判定完全一致
    ) // 结束预编译
    .get(userId, moduleId, now) as { status: string } | undefined; // 命中行
  return row?.status === 'active'; // 仅 active 视为已拥有
} // hasActiveEntitlement 结束

/** 把购物车行组装成对外视图（含单价、免费标记、已拥有标记与合计） */
function cartView(db: Db, userId: string, now: string) {
  const rows = listCartRows(db, userId); // 拉原始行
  const items = rows.map((row) => { // 逐行补价格与状态
    const price = currentPrice(db, row.module_id, now); // 当前有效价（无价为免费 / 待定价）
    const owned = hasActiveEntitlement(db, userId, row.module_id, now); // 是否已拥有
    const nameMap = jsonParse<Record<string, string>>(row.module_name) ?? { 'zh-CN': row.module_code }; // 名称坏数据回落编码
    return { // 单条对外视图
      module_code: row.module_code, // 模块编码
      name: nameMap, // 多语言名称
      capability: row.module_capability, // 能力键（null = 规划中）
      status: row.module_status, // 模块状态
      available: row.module_status === 'active', // 只有 active 可结算
      owned, // 已拥有：结算时跳过
      free: !price || price.amount_minor === 0, // 免费（无价或 0 价）
      price, // 单价视图（可为 null）
      added_at: row.created_at, // 加购时间
    }; // 视图结束
  }); // 映射结束
  const totalsMap = new Map<string, number>(); // 按币种汇总待付金额（已拥有与免费不计入）
  for (const item of items) { // 逐项累计
    if (item.owned || item.free || !item.price || !item.available) continue; // 跳过不可结算项
    totalsMap.set(item.price.currency, (totalsMap.get(item.price.currency) ?? 0) + item.price.amount_minor); // 累加同币种金额
  } // 汇总结束
  const totals = [...totalsMap.entries()].map(([currency, amount_minor]) => ({ currency, amount_minor })); // 转数组供前端渲染
  return { items, totals, count: items.length, payable_count: items.filter((item) => !item.owned && !item.free && item.available).length }; // 汇总视图
} // cartView 结束

export function createCartRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立 router，便于前缀挂载
  const db = deps.db; // 数据库句柄

  router.use('/cart', requireAuth); // 仅购物车前缀需要登录

  /** GET /cart — 我的购物车 */
  router.get('/cart', (req, res) => {
    const now = clockOf(deps); // 统一时间基准
    res.json(cartView(db, req.user!.id, now)); // 返回组装视图
  });

  /** POST /cart/items — 加购；重复加购回放既有条目 */
  router.post('/cart/items', idempotency, (req, res) => {
    const body = parse(z.object({ module_code: z.string().min(1).max(64) }), req.body); // 校验模块码
    const user = req.user!; // 登录用户
    const now = clockOf(deps); // 时间基准
    const moduleRow = db // 定位模块
      .prepare( // 仅同区域、未删除模块可加购
        `SELECT id, code, status, category_slug FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL`,
      ) // 结束预编译
      .get(body.module_code, user.region) as { id: string; code: string; status: string; category_slug: string | null } | undefined; // 命中行
    if (!moduleRow) throw new AppError('NOT_FOUND', 'module not found', { module_code: body.module_code }); // 模块不存在
    if (moduleRow.status !== 'active') throw new AppError('FEATURE_NOT_AVAILABLE', 'module is not available for purchase', { module_code: moduleRow.code }); // 非上架不可加购
    assertCategoryAllowed(db, subjectFromUser(db, user), moduleRow.category_slug, { module_code: moduleRow.code, region: user.region }); // 分类级权限：被 deny 拦截
    if (hasActiveEntitlement(db, user.id, moduleRow.id, now)) throw new AppError('CONFLICT', 'module already unlocked', { module_code: moduleRow.code }); // 已拥有无需加购
    const existing = db.prepare('SELECT id FROM cart_items WHERE user_id = ? AND module_id = ?').get(user.id, moduleRow.id) as { id: string } | undefined; // 查是否已在车里
    if (existing) { // 幂等回放
      db.prepare('UPDATE cart_items SET updated_at = ? WHERE id = ?').run(now, existing.id); // 只刷新时间，不新增行
      res.json({ added: false, item_id: existing.id, cart: cartView(db, user.id, now) }); // 回放结果
      return; // 提前返回
    } // 回放分支结束
    const id = uuidv7(); // 新条目主键
    db.prepare('INSERT INTO cart_items (id, user_id, module_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, user.id, moduleRow.id, now, now); // 落库
    res.status(201).json({ added: true, item_id: id, cart: cartView(db, user.id, now) }); // 新建结果
  });

  /** DELETE /cart/items/:moduleCode — 移除单个 */
  router.delete('/cart/items/:moduleCode', (req, res) => {
    const moduleCode = req.params.moduleCode; // 路径参数即模块编码
    const user = req.user!; // 登录用户
    const row = db // 找同区域模块
      .prepare('SELECT id FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL')
      .get(moduleCode, user.region) as { id: string } | undefined; // 命中行
    if (!row) throw new AppError('NOT_FOUND', 'module not found', { module_code: moduleCode }); // 模块不存在
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND module_id = ?').run(user.id, row.id); // 删除该条目（不存在时零影响，天然幂等）
    res.json({ ok: true, cart: cartView(db, user.id, clockOf(deps)) }); // 返回最新车
  });

  /** DELETE /cart — 清空 */
  router.delete('/cart', idempotency, (req, res) => {
    const user = req.user!; // 登录用户
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(user.id); // 清空本人车
    res.json({ ok: true, cart: cartView(db, user.id, clockOf(deps)) }); // 返回空车
  });

  /** POST /cart/checkout — 结算：免费即时解锁，付费生成待结算订单；可选积分抵扣 */
  router.post('/cart/checkout', idempotency, (req, res) => {
    const body = parse( // 渠道可选：未接在线网关时按人工结算；积分抵扣可选
      z.object({
        channel: z.enum(['manual', 'alipay', 'wechat', 'stripe']).optional(), // 允许空体（缺省 manual）
        use_points: z.boolean().optional(), // 是否使用积分抵扣；指定 points_to_use 视为开启
        points_to_use: z.number().int().min(1).optional(), // 指定消耗积分；缺省按可抵扣上限最大化
      }), // 结束 schema
      req.body ?? {}, // 空请求体按空对象校验
    ); // 解析结束
    const user = req.user!; // 登录用户
    const now = clockOf(deps); // 统一时间基准
    const subject = subjectFromUser(db, user); // 分类级权限主体（用户 + 角色）
    const pointsConfig = readPointsConfig(deps.env); // 积分兑换比例与单笔上限
    const usePoints = body.use_points === true || body.points_to_use !== undefined; // 显式开启或指定积分量
    let pointsBalance = usePoints ? getPointsBalance(db, user.id) : 0; // 本单可用积分余额；逐行扣减后滚动更新
    const rows = listCartRows(db, user.id); // 待结算条目
    const outcomes: CheckoutOutcome[] = []; // 逐条结果
    const processedIds: string[] = []; // 成功处理的购物车条目，最后统一移出车
    for (const row of rows) { // 逐条结算
      const module_code = row.module_code; // 便于构造结果
      if (row.module_status !== 'active') { outcomes.push({ module_code, kind: 'skipped', reason: 'module_not_active' }); continue; } // 已下架：保留在车
      assertCategoryAllowed(db, subject, row.module_category_slug, { module_code, region: user.region }); // 分类级权限：被 deny 即拦截整笔结算
      if (hasActiveEntitlement(db, user.id, row.module_id, now)) { outcomes.push({ module_code, kind: 'skipped', reason: 'already_owned' }); processedIds.push(row.id); continue; } // 已拥有：移出车
      const price = currentPrice(db, row.module_id, now); // 当前价
      const moduleMeta = db // 取依赖与名称，用于依赖校验与订单视图
        .prepare('SELECT name_i18n, entitlements_required FROM modules WHERE id = ?')
        .get(row.module_id) as { name_i18n: string; entitlements_required: string }; // 模块元信息
      try { // 依赖缺失等业务错误按条目跳过，不中断整批结算
        assertDependenciesMet(db, { region: user.region, requiredCodes: jsonParse<string[]>(moduleMeta.entitlements_required) ?? [], userId: user.id, now }); // 与解锁/下单同一校验
      } catch (err) { // 捕获 FEATURE_NOT_AVAILABLE
        const details = err instanceof AppError ? (err.details as { required?: string[] } | undefined) : undefined; // 取出错误明细
        const required = details?.required ?? []; // 缺失依赖清单（无明细时为空）
        outcomes.push({ module_code, kind: 'skipped', reason: required.length > 0 ? `missing_dependency:${required.join(',')}` : 'dependency_not_met' }); // 记录原因，保留在车
        continue; // 下一条
      } // 依赖校验结束
      if (!price || price.amount_minor === 0) { // 免费模块：直接发权益
        const entId = uuidv7(); // 权益主键
        const evtId = uuidv7(); // 事件主键
        const tx = db.transaction(() => { // 权益与事件同事务，审计链完整
          db.prepare( // 与 POST /entitlements 完全一致的插入形态
            `INSERT INTO entitlements (id, user_id, module_id, source, source_id, status, version, created_at, updated_at)
             VALUES (?, ?, ?, 'admin', NULL, 'active', 1, ?, ?)`,
          ).run(entId, user.id, row.module_id, now, now); // 发放 active 权益
          db.prepare( // 状态流转事件
            `INSERT INTO entitlement_events (id, entitlement_id, from_status, to_status, reason, actor, created_at)
             VALUES (?, ?, NULL, 'active', 'cart_checkout', 'system', ?)`,
          ).run(evtId, entId, now); // 原因标记为购物车结算，便于审计区分
        }); // 事务定义结束
        tx(); // 执行
        outcomes.push({ module_code, kind: 'unlocked', entitlement_id: entId }); // 记录结果
        processedIds.push(row.id); // 移出车
        continue; // 下一条
      } // 免费分支结束
      const pending = db // 已有待结算订单则回放，保证「点两次只生成一张单」
        .prepare(`SELECT * FROM module_orders WHERE user_id = ? AND module_id = ? AND status = 'pending'`)
        .get(user.id, row.module_id) as Parameters<typeof orderView>[0] | undefined; // 命中行
      if (pending) { // 回放既有订单
        outcomes.push({ // 复用订单视图；既有单无抵扣记录，抵扣字段归零
          module_code, kind: 'order',
          order: orderView({ ...pending, module_code, module_name: moduleMeta.name_i18n }),
          points_spent: pending.points_spent ?? 0,
          points_deduct_cents: pending.points_deduct_cents ?? 0,
          payable_cents: Math.max(0, (pending.amount_minor ?? 0) - (pending.points_deduct_cents ?? 0)),
        });
        processedIds.push(row.id); // 已生成订单即视为已处理
        continue; // 下一条
      } // 回放结束
      // 积分抵扣：位于优惠码之后、余额/渠道之前；纯函数计算，受兑换比例 / 单笔上限 / 余额三重约束
      const deduction = usePoints
        ? computeDeduction({ amountCents: price.amount_minor, pointsBalance, config: pointsConfig, pointsToUse: body.points_to_use })
        : { deduct_cents: 0, points_spent: 0, payable_cents: price.amount_minor, capped_by: 'none' as const }; // 未开启抵扣：全额应付
      const payableMinor = deduction.payable_cents; // 抵扣后应付（分）
      const settledByPoints = payableMinor <= 0; // 全额抵扣：同事务内即时结算并发权益
      const orderId = uuidv7(); // 新订单主键
      const entId = settledByPoints ? uuidv7() : null; // 全额抵扣时预生成权益主键
      const evtId = settledByPoints ? uuidv7() : null; // 全额抵扣时预生成事件主键
      const channel = body.channel ?? 'manual'; // 渠道缺省 manual
      const tx = db.transaction(() => { // 订单、积分扣减、权益发放同事务，保证扣积分与订单状态一致
        db.prepare( // 金额与币种在此刻快照；抵扣额单列留痕，原始成交价不被改写
          `INSERT INTO module_orders
             (id, user_id, module_id, region, currency, amount_minor, points_spent, points_deduct_cents, status, channel, entitlement_id, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(orderId, user.id, row.module_id, user.region, price.currency, price.amount_minor, deduction.points_spent, deduction.deduct_cents, settledByPoints ? 'paid' : 'pending', channel, entId, settledByPoints ? now : null, now, now); // 落库
        if (deduction.points_spent > 0) { // 有抵扣才扣积分并写流水，与订单同事务
          deductPoints(db, { userId: user.id, points: deduction.points_spent, deductCents: deduction.deduct_cents, refType: 'module_order', refId: orderId, note: `积分抵扣 ${module_code}`, now });
        }
        if (settledByPoints && entId && evtId) { // 全额抵扣：即时发放 active 权益并留事件
          db.prepare(
            `INSERT INTO entitlements (id, user_id, module_id, source, source_id, status, version, created_at, updated_at)
             VALUES (?, ?, ?, 'admin', NULL, 'active', 1, ?, ?)`,
          ).run(entId, user.id, row.module_id, now, now);
          db.prepare(
            `INSERT INTO entitlement_events (id, entitlement_id, from_status, to_status, reason, actor, created_at)
             VALUES (?, ?, NULL, 'active', 'cart_checkout_points_settled', 'system', ?)`,
          ).run(evtId, entId, now);
        }
      }); // 事务定义结束
      tx(); // 执行事务
      pointsBalance -= deduction.points_spent; // 滚动更新余额，供同车后续条目计算
      outcomes.push({ // 返回订单视图 + 抵扣明细
        module_code, // 模块编码
        kind: 'order', // 结果类型
        order: orderView({ // 组装视图
          id: orderId, // 订单主键
          user_id: user.id, // 下单用户
          region: user.region, // 区域
          currency: price.currency, // 币种
          amount_minor: price.amount_minor, // 原始成交价
          status: settledByPoints ? 'paid' : 'pending', // 全额抵扣即已结算，否则待结算
          channel, // 渠道
          channel_txn_id: null, // 尚无渠道交易号
          entitlement_id: entId, // 全额抵扣已发权益；否则为空
          created_at: now, // 下单时间
          updated_at: now, // 更新时间
          paid_at: settledByPoints ? now : null, // 全额抵扣结算时间
          cancelled_at: null, // 未取消
          module_code, // 模块编码
          module_name: moduleMeta.name_i18n, // 模块名
        }), // 视图结束
        points_spent: deduction.points_spent, // 本单消耗积分
        points_deduct_cents: deduction.deduct_cents, // 积分折抵金额（分）
        payable_cents: payableMinor, // 抵扣后应付（分）
      }); // 结果推入
      processedIds.push(row.id); // 移出车
    } // 逐条结算结束
    if (processedIds.length > 0) { // 统一清理已处理条目
      const placeholders = processedIds.map(() => '?').join(','); // 动态占位符
      db.prepare(`DELETE FROM cart_items WHERE user_id = ? AND id IN (${placeholders})`).run(user.id, ...processedIds); // 删除已处理
    } // 清理结束
    res.json({ results: outcomes, cart: cartView(db, user.id, now) }); // 返回逐条结果与剩余车
  });

  return router; // 返回装配完成的路由
} // createCartRouter 结束
