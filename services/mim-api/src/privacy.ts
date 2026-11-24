/**
 * 账号注销 · 数据清理引擎与进程内调度。
 *
 * 职责边界（契约 §3 / §4）：
 *   - 选人：status='pending_deletion' 且 deletion_scheduled_at 已到期的账号，按预约时间升序取批；
 *   - 单用户一个 BEGIN IMMEDIATE 事务：先子表后父表逐表 DELETE，最后删 users 行，任一步失败整体回滚；
 *   - 他人可见引用（板块 / 卡片 / 公告 / 通知 / 举报处理人）置空匿名化，不物理删公开内容；
 *   - audit_logs 不物理删：归属改写为 deleted-<sha256 前 12 位>，明细置脱敏占位；
 *   - 对象存储按 key 尽力删除，失败只记录不回滚；
 *   - 调度器仅在 JOBS_ENABLED 为真时注册定时器，启动先跑一轮，周期跑后续轮次，句柄 unref。
 */

import { sha256 } from './auth.js'; // 通用 SHA-256 摘要，用于审计归属改写与 id 摘要
import { writeAudit, type AuditActor } from './audit.js'; // 统一审计留痕：清理批次落 privacy.account_purge
import { deletionBatchSize, deletionSweepMinutes, JOBS_ENABLED } from './config.js'; // 调度与批量参数（env 派生）
import { jsonParse } from './utils.js'; // 解析媒体 JSON 数组，脏数据不抛错
import type { ApiDeps, Db } from './types.js'; // 依赖容器与数据库句柄类型
import type { StorageAdapter } from './storage.js'; // 对象存储适配器类型

/** 清理可选参数：注入固定时间 / 批大小，便于测试复现 */
export interface PurgeOptions {
  now?: Date; // 到期判定基准时间；缺省取系统当前时间
  batchSize?: number; // 单轮批量上限；缺省取配置 MIM_DELETION_BATCH
} // PurgeOptions 结束

/** 单轮清理结果：扫描候选数、实际回收数、逐表删除行数 */
export interface PurgeResult {
  scanned: number; // 命中到期条件的候选账号数
  purged: number; // 本轮成功物理删除的账号数
  deletedRows: Record<string, number>; // 表名 → 删除行数，按表聚合便于审计与对账
} // PurgeResult 结束

/** 待删除队列单项：管理端列表与倒计时展示用 */
export interface DeletionQueueItem {
  user_id: string; // 用户内部主键
  member_no: string | null; // 对外 Mim ID
  display_name: string; // 展示昵称
  region: string; // 所属区域
  status: string; // 账号状态（恒为 pending_deletion）
  deletion_scheduled_at: string; // 预约删除时间（ISO）
  remaining_seconds: number; // 距到期剩余秒数（已到期钳到 0）
  overdue: boolean; // 是否已到期
} // DeletionQueueItem 结束

/** 物理删除步骤：表名 + 命中本人的关联列（多列按 OR 命中即删） */
interface DeleteStep {
  table: string; // 目标表名（以 schema.sql / schema.d 实际表名为准）
  cols: string[]; // 关联列：user_id / author_id / owner_id 等
} // DeleteStep 结束

/**
 * 物理删除矩阵（子表先于父表；FK ON DELETE CASCADE 的子表由库级级联兜底，这里仍显式列出便于对账）。
 * 列名逐表核对 schema 源 SQL，不允许猜表名 / 猜列名。
 */
const DELETE_STEPS: DeleteStep[] = [
  { table: 'member_no_history', cols: ['user_id'] }, // 改号审计：归属用户的历史号码记录
  { table: 'identities', cols: ['user_id'] }, // 登录身份（手机 / 邮箱 / 用户名）
  { table: 'credentials', cols: ['user_id'] }, // 口令凭据（secret_hash，禁导出，必删）
  { table: 'sessions', cols: ['user_id'] }, // 登录会话（refresh_token_hash，禁导出，必删）
  { table: 'devices', cols: ['user_id'] }, // 登记设备
  { table: 'account_merges', cols: ['primary_user_id', 'merged_user_id'] }, // 账号合并关系：任一端命中即删
  { table: 'oauth_accounts', cols: ['user_id'] }, // 第三方绑定记录
  { table: 'oauth_states', cols: ['link_user_id'] }, // 待绑定的授权 state 临时记录
  { table: 'oauth_login_tickets', cols: ['user_id'] }, // 一次性登录票据
  { table: 'idempotency_keys', cols: ['user_id'] }, // 写操作幂等键
  { table: 'user_roles', cols: ['user_id'] }, // RBAC 用户角色授权
  { table: 'sso_tickets', cols: ['user_id'] }, // 跨站 SSO 票据
  { table: 'realname_records', cols: ['user_id'] }, // 实名材料（name_hash / id_hash PII，必删）
  { table: 'invitation_redemptions', cols: ['user_id'] }, // 邀请码核销记录（先于 invitations 删，解除外键）
  { table: 'after_sales_requests', cols: ['user_id'] }, // 售后申请
  { table: 'payment_ext_intents', cols: ['user_id'] }, // 扩展渠道支付意图（events / refunds 级联）
  { table: 'circle_members', cols: ['user_id'] }, // 圈子成员关系
  { table: 'circle_posts', cols: ['author_id'] }, // 圈内动态
  { table: 'circle_notices', cols: ['author_id'] }, // 圈内公告
  { table: 'circles', cols: ['owner_id'] }, // 自有圈子（成员 / 动态 / 公告级联）
  { table: 'community_thread_views', cols: ['user_id'] }, // 浏览去重账本
  { table: 'community_notifications', cols: ['user_id'] }, // 收件通知（触发者 actor_id 另走匿名化）
  { table: 'community_reports', cols: ['reporter_id'] }, // 本人提交的社区举报（处理人 resolved_by 另走匿名化）
  { table: 'orders', cols: ['user_id'] }, // 统一订单（明细 / 支付 / 履约级联）
  { table: 'referral_commissions', cols: ['inviter_id', 'invitee_id'] }, // 返佣佣金明细：任一端命中即删
  { table: 'growth_dm_deliveries', cols: ['user_id'] }, // 成长私信逐用户投递台账
  { table: 'withdrawal_requests', cols: ['user_id'] }, // 提现申请（account_name / account_no PII，必删）
  { table: 'gallery_favorites', cols: ['user_id'] }, // 图库 / 视频收藏
  { table: 'user_badges', cols: ['user_id'] }, // 徽章授予记录
  { table: 'user_growth', cols: ['user_id'] }, // 成长档案
  { table: 'vip_memberships', cols: ['user_id'] }, // VIP 会员记录
  { table: 'wallets', cols: ['user_id'] }, // 钱包余额
  { table: 'wallet_transactions', cols: ['user_id'] }, // 钱包流水
  { table: 'checkins', cols: ['user_id'] }, // 签到记录
  { table: 'coupon_redemptions', cols: ['user_id'] }, // 优惠码核销（无级联，显式先删）
  { table: 'shop_orders', cols: ['user_id'] }, // 独立商城订单（发货单级联）
  { table: 'referral_codes', cols: ['user_id'] }, // 本人推广码
  { table: 'referrals', cols: ['inviter_id', 'invitee_id'] }, // 推广绑定关系：任一端命中即删
  { table: 'paid_assets', cols: ['author_id'] }, // 本人创作的数字资产（购买记录级联）
  { table: 'asset_purchases', cols: ['user_id'] }, // 数字资产购买记录
  { table: 'payment_intents', cols: ['user_id'] }, // 支付意图（回调事件级联）
  { table: 'creator_earnings', cols: ['user_id'] }, // 创作收益分成
  { table: 'direct_messages', cols: ['from_user_id', 'to_user_id'] }, // 裸私信：发出 / 收到任一端命中即删
  { table: 'community_thread_likes', cols: ['user_id'] }, // 帖子点赞
  { table: 'community_purchases', cols: ['user_id'] }, // 付费帖购买
  { table: 'community_poll_votes', cols: ['user_id'] }, // 投票记录
  { table: 'community_favorites', cols: ['user_id'] }, // 帖子收藏
  { table: 'community_ratings', cols: ['user_id'] }, // 帖子评分
  { table: 'community_board_memberships', cols: ['user_id'] }, // 付费板块加入记录
  { table: 'community_board_follows', cols: ['user_id'] }, // 板块关注
  { table: 'community_posts', cols: ['author_id'] }, // 本人发布的回复
  { table: 'community_threads', cols: ['author_id'] }, // 本人发布的主题帖（媒体 / 附件 / 投票 / 点赞等级联）
  { table: 'content_reports', cols: ['reporter_id'] }, // 统一内容举报
  { table: 'content_items', cols: ['author_id'] }, // 统一内容条目
  { table: 'messages', cols: ['sender_user_id'] }, // 统一消息：本人发出的消息
  { table: 'im_messages', cols: ['sender_user_id'] }, // IM 消息：本人发出的消息
  { table: 'im_conversation_members', cols: ['user_id'] }, // IM 会话成员关系
  { table: 'im_conversations', cols: ['owner_user_id'] }, // 本人创建的群聊（成员 / 消息级联）
  { table: 'conversations', cols: ['owner_user_id'] }, // 统一会话：群主本人的会话（成员数组另走匿名化）
  { table: 'invitations', cols: ['created_by'] }, // 本人创建的邀请码（核销记录已先删）
]; // DELETE_STEPS 结束

/** 匿名化步骤：指向本人的他人可见引用置 NULL，公开内容与他人记录保留 */
const ANONYMIZE_STEPS: Array<{ table: string; col: string }> = [
  { table: 'community_boards', col: 'created_by' }, // 板块创建者：置空保留板块本身
  { table: 'community_boards', col: 'moderator_id' }, // 板块版主：置空
  { table: 'wallet_cards', col: 'used_by' }, // 充值卡使用人：置空，卡密库存保留
  { table: 'shop_card_keys', col: 'used_by' }, // 商城卡密使用人：置空，库存保留
  { table: 'announcements', col: 'author_id' }, // 公告作者：置空，公告保留
  { table: 'community_notifications', col: 'actor_id' }, // 通知触发者：置空，收件通知已按 user_id 删除时此句兜底
  { table: 'community_reports', col: 'resolved_by' }, // 举报处理人：置空，举报记录保留审计语义
]; // ANONYMIZE_STEPS 结束

/** 通用 DELETE：按命中列拼 OR 条件，返回实际删除行数 */
function runDelete(db: Db, step: DeleteStep, userId: string): number { // 单表删除辅助
  const where = step.cols.map((col) => `${col} = ?`).join(' OR '); // 多列按 OR 拼条件
  const info = db.prepare(`DELETE FROM ${step.table} WHERE ${where}`).run(...step.cols.map(() => userId)); // 占位符与列一一绑定
  return info.changes; // 返回删除行数供对账聚合
} // runDelete 结束

/** 收集本人相关行上挂的对象存储键（删行前先取，提交后无法回查） */
function collectStorageKeys(db: Db, userId: string): string[] { // 对象键收集辅助
  const keys = new Set<string>(); // 去重：同一对象键不重复发起删除
  const push = (value: unknown): void => { // 单键入收集器
    if (typeof value === 'string' && value && !value.startsWith('http')) keys.add(value); // 外链不入本仓存储，跳过
  }; // push 结束
  // 本人主题帖挂的媒体（封面 / 内图 / 视频）
  const mediaRows = db.prepare(
    `SELECT m.storage_key, m.poster_key, m.url, m.poster_url
       FROM community_thread_media m
       JOIN community_threads t ON m.thread_id = t.id
      WHERE t.author_id = ?`,
  ).all(userId) as Array<Record<string, unknown>>; // 媒体行集合
  for (const row of mediaRows) { push(row.storage_key); push(row.poster_key); push(row.url); push(row.poster_url); } // 逐键收集
  // 本人主题帖挂的附件
  const attachmentRows = db.prepare(
    `SELECT a.url FROM community_thread_attachments a
       JOIN community_threads t ON a.thread_id = t.id
      WHERE t.author_id = ?`,
  ).all(userId) as Array<Record<string, unknown>>; // 附件行集合
  for (const row of attachmentRows) push(row.url); // 附件对象键收集
  // 本人发出的 IM / 统一消息附件
  for (const table of ['im_messages', 'messages'] as const) { // 两套消息表同口径收集
    const msgRows = db.prepare(`SELECT object_key FROM ${table} WHERE sender_user_id = ?`).all(userId) as Array<Record<string, unknown>>;
    for (const row of msgRows) push(row.object_key); // 消息附件键收集
  } // 消息表循环结束
  // 本人创作的数字资产文件与封面，media_json 内联媒体数组一并解析
  const assetRows = db.prepare(
    'SELECT file_url, cover_url, media_json FROM paid_assets WHERE author_id = ?',
  ).all(userId) as Array<Record<string, unknown>>; // 资产行集合
  for (const row of assetRows) {
    push(row.file_url); push(row.cover_url); // 单文件 / 封面键收集
    const media = jsonParse<Array<{ url?: string; poster_url?: string }>>(row.media_json as string | null); // 解析内联媒体数组
    for (const item of media ?? []) { push(item.url); push(item.poster_url); } // 数组内媒体键收集
  } // 资产循环结束
  // 本人主题帖封面
  const threadRows = db.prepare('SELECT cover_url FROM community_threads WHERE author_id = ?').all(userId) as Array<Record<string, unknown>>;
  for (const row of threadRows) push(row.cover_url); // 封面键收集
  return [...keys]; // 去重后的键数组
} // collectStorageKeys 结束

/** 匿名化本人在他人可见记录中的引用：置空 / 从成员数组移除 */
function anonymizeReferences(db: Db, userId: string): void { // 引用匿名化辅助
  for (const step of ANONYMIZE_STEPS) { // 逐表执行置空
    db.prepare(`UPDATE ${step.table} SET ${step.col} = NULL WHERE ${step.col} = ?`).run(userId); // 只改命中本人的行
  } // 匿名化步骤循环结束
  // 统一会话：从 members_json 移除本人；本人是群主时群主置空
  const convRows = db.prepare(
    `SELECT id, members_json, owner_user_id FROM conversations
      WHERE owner_user_id = ? OR members_json LIKE ?`,
  ).all(userId, `%${userId}%`) as Array<{ id: string; members_json: string; owner_user_id: string | null }>; // 命中本人的会话集合
  for (const conv of convRows) { // 逐会话改写成员数组
    const members = jsonParse<string[]>(conv.members_json) ?? []; // 解析成员 id 数组，脏数据回落空数组
    const kept = members.filter((mid) => mid !== userId); // 移除本人 id，保留其余成员
    const owner = conv.owner_user_id === userId ? null : conv.owner_user_id; // 本人是群主则群主置空
    db.prepare('UPDATE conversations SET members_json = ?, owner_user_id = ? WHERE id = ?').run(JSON.stringify(kept), owner, conv.id); // 回写会话
  } // 会话循环结束
} // anonymizeReferences 结束

/** 审计日志脱敏：不物理删，归属改写摘要引用，明细置固定占位 */
function redactAuditLogs(db: Db, userId: string): void { // 审计留痕脱敏辅助
  const digest = sha256(userId).slice(0, 12); // 取摘要前 12 位，不保留可反推原值的完整哈希
  db.prepare(
    `UPDATE audit_logs SET user_id = ?, payload = ? WHERE user_id = ?`,
  ).run(`deleted-${digest}`, JSON.stringify({ redacted: '账号已注销' }), userId); // 归属与明细一并改写
} // redactAuditLogs 结束

/** 对象存储尽力删除：失败只记录日志，不影响已提交的数据库事务 */
function purgeStorageObjects(storage: StorageAdapter | undefined, keys: string[]): void { // 存储清理辅助
  if (!storage || keys.length === 0) return; // 无适配器或无键直接跳过
  for (const key of keys) { // 逐键发起删除
    Promise.resolve(storage.deleteObject(key)).catch(() => { // 失败静默兜底：对象存储故障不应回滚已提交的清理
      console.error(`[privacy] storage deleteObject failed: ${key.slice(0, 24)}…`); // 只记键前缀，不打全量对象路径
    }); // catch 结束
  } // 键循环结束
} // purgeStorageObjects 结束

/** 单用户清理：事务内完成匿名化 + 逐表删除 + 审计脱敏，返回逐表删除行数 */
function purgeOneAccount(db: Db, storage: StorageAdapter | undefined, userId: string): Record<string, number> { // 单账号清理入口
  const deletedRows: Record<string, number> = {}; // 逐表行数聚合，供上层对账与审计
  const storageKeys = collectStorageKeys(db, userId); // 提交事务前先收集对象键，删行后无法回查
  const tx = db.transaction(() => { // 单用户事务：任一步失败整体回滚，不留半删状态
    anonymizeReferences(db, userId); // 先匿名化他人可见引用
    for (const step of DELETE_STEPS) { // 子表 → 父表逐表删除
      const count = runDelete(db, step, userId); // 执行单表 DELETE
      if (count > 0) deletedRows[step.table] = (deletedRows[step.table] ?? 0) + count; // 聚合行数
    } // 删除步骤循环结束
    redactAuditLogs(db, userId); // 审计日志脱敏（不物理删）
    const usersDeleted = db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes; // 最后删 users 主行
    if (usersDeleted > 0) deletedRows['users'] = (deletedRows['users'] ?? 0) + usersDeleted; // 主表行数入账
  }); // 事务函数准备完成
  tx.immediate(); // BEGIN IMMEDIATE：先拿写锁，多进程并发只允许一方真正清理
  purgeStorageObjects(storage, storageKeys); // 事务提交后尽力清理对象存储
  return deletedRows; // 交回逐表删除行数
} // purgeOneAccount 结束

/** 批量清理详细结果：除 PurgeResult 外带回已删用户 id（审计只存摘要，不存原值） */
export function purgeDueAccountsDetailed(db: Db, storage: StorageAdapter | undefined, opts: PurgeOptions): { result: PurgeResult; purgedIds: string[] } {
  const now = opts.now ?? new Date(); // 到期判定基准时间
  const batchSize = opts.batchSize ?? deletionBatchSize(); // 单轮批量上限（env 派生）
  const due = db.prepare(
    `SELECT id FROM users
      WHERE status = 'pending_deletion' AND deletion_scheduled_at <= ?
      ORDER BY deletion_scheduled_at ASC LIMIT ?`,
  ).all(now.toISOString(), batchSize) as Array<{ id: string }>; // 到期候选：按预约时间升序取批
  const result: PurgeResult = { scanned: due.length, purged: 0, deletedRows: {} }; // 聚合结果初值
  const purgedIds: string[] = []; // 本轮已删用户 id（仅用于生成 sha256 摘要，不回传原值）
  for (const account of due) { // 逐账号清理，单账号失败不阻断同批其余账号
    try {
      const deletedRows = purgeOneAccount(db, storage, account.id); // 事务内完成单账号清理
      result.purged += 1; // 回收计数 +1
      purgedIds.push(account.id); // 记入本轮已删集合
      for (const [table, count] of Object.entries(deletedRows)) { // 逐表聚合行数
        result.deletedRows[table] = (result.deletedRows[table] ?? 0) + count; // 累加同表删除行数
      } // 表循环结束
    } catch (error) { // 单账号事务失败已回滚，记录后继续处理下一个候选
      console.error('[privacy] purge account failed:', error); // 明细进服务日志，不进对外响应
    } // try/catch 结束
  } // 候选循环结束
  return { result, purgedIds }; // 交回结果与已删 id 集合
} // purgeDueAccountsInternal 结束

/** 到期清理一轮（契约导出签名）：返回扫描 / 回收 / 逐表行数 */
export function purgeDueAccounts(db: Db, storage: StorageAdapter | undefined, opts: PurgeOptions): PurgeResult {
  return purgeDueAccountsDetailed(db, storage, opts).result; // 对外只暴露聚合结果，不回传原始 id
} // purgeDueAccounts 结束

/** 待删除队列：按预约时间升序，计算剩余秒数与逾期标记，供管理端列表展示 */
export function listDeletionQueue(db: Db, now: Date, limit = 50): DeletionQueueItem[] {
  const rows = db.prepare(
    `SELECT id, member_no, display_name, region, status, deletion_scheduled_at
       FROM users
      WHERE status = 'pending_deletion'
      ORDER BY deletion_scheduled_at ASC LIMIT ?`,
  ).all(limit) as Array<{ // 队列行结构断言
    id: string; member_no: string | null; display_name: string; region: string; status: string; deletion_scheduled_at: string;
  }>; // 查询结果集
  const nowMs = now.getTime(); // 基准时间毫秒数
  return rows.map((row) => { // 逐行计算倒计时字段
    const scheduledMs = Date.parse(row.deletion_scheduled_at); // 预约时间转毫秒
    const remainingMs = scheduledMs - nowMs; // 剩余毫秒（负数表示已到期）
    const overdue = remainingMs <= 0; // 逾期判定
    return { // 组装队列单项
      user_id: row.id, // 用户主键
      member_no: row.member_no, // Mim ID
      display_name: row.display_name, // 昵称
      region: row.region, // 区域
      status: row.status, // 状态
      deletion_scheduled_at: row.deletion_scheduled_at, // 预约时间
      remaining_seconds: Math.max(0, Math.round(remainingMs / 1000)), // 剩余秒数（到期钳到 0）
      overdue, // 逾期标记
    }; // 单项结束
  }); // map 结束
} // listDeletionQueue 结束

/** 系统动作审计操作人：无请求上下文，主体留空 */
const SYSTEM_ACTOR: AuditActor = { id: null, region: null, ip: null, requestId: null }; // 调度器 / 系统批次共用快照

/**
 * 启动进程内隐私调度器（契约 §4）。
 * 仅 JOBS_ENABLED 为真时注册定时器；返回 stop 句柄供优雅停机清理。
 */
export function startPrivacyScheduler(deps: ApiDeps): () => void {
  if (!JOBS_ENABLED) return () => undefined; // 总开关关闭：不跑首轮也不注册定时器
  /** 执行一轮清理并写 privacy.account_purge 审计；source 标记触发来源 */
  const runOnce = (source: 'startup' | 'interval'): void => { // 单轮执行封装
    try {
      const { result, purgedIds } = purgeDueAccountsDetailed(deps.db, deps.storage, {}); // 跑一轮到期清理
      const idsSha256 = purgedIds.map((id) => sha256(id).slice(0, 8)); // id 只存 sha256 前 8 位摘要
      writeAudit(deps.db, SYSTEM_ACTOR, { // 批次留痕：审计链可追溯本轮扫描 / 回收规模
        action: 'privacy.account_purge', // 动作码：账号注销清理
        targetType: 'privacy_purge', // 对象类型：清理批次
        targetId: 'batch', // 批次口径
        detail: { // 明细只含计数与摘要集合，不含用户原值
          scanned: result.scanned, // 候选数
          purged: result.purged, // 回收数
          deleted_rows: result.deletedRows, // 逐表行数
          ids_sha256: idsSha256, // 已删 id 摘要（前 8 位）
          source, // 触发来源：startup / interval / manual
        },
      }); // 审计写入结束
    } catch (error) { // 调度轮次异常不得拖垮进程
      console.error('[privacy] scheduler sweep failed:', error); // 异常进服务日志
    } // try/catch 结束
  }; // runOnce 结束
  runOnce('startup'); // 启动先跑一轮，避免长驻进程首次轮询前积压到期账号
  const intervalMs = deletionSweepMinutes(deps.env) * 60_000; // 扫描间隔换算毫秒（env 派生）
  const timer = setInterval(() => runOnce('interval'), intervalMs); // 周期轮询到期账号
  timer.unref(); // 句柄不阻止进程退出：优雅停机时无需等待定时器
  return () => clearInterval(timer); // 返回 stop 句柄：停机时清除定时器
} // startPrivacyScheduler 结束
