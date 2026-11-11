/** IM 数据访问层：封装会话、成员、消息的全部 SQL，供 HTTP 路由与 WS 处理器复用。
 *
 * 约定：
 *   - 所有写操作由调用方决定是否包事务；本层只提供单语句原子操作。
 *   - direct 会话的两人唯一性由 getOrCreateDirectConversation 保证（先查后建）。
 *   - 消息返回统一为 MessageView，含发送者显示名，避免前端二次查用户。
 */

import { uuidv7 } from '@mim/core-domain'; // 时间有序 UUID，作为会话与消息主键
import type { Db } from '../types.js'; // 数据库连接类型
import type { MessageContentType, MessageView } from './protocol.js'; // 消息类型与视图

/** 会话行结构（DB → 内存） */
interface ConversationRow {
  id: string; // 会话 ID
  type: 'direct' | 'group'; // 会话类型
  title: string; // 会话标题（群名；私聊为空）
  owner_user_id: string | null; // 群主 ID（私聊为空）
  avatar_object_key: string | null; // 群头像对象键
  created_at: string; // 创建时间
  updated_at: string; // 最后更新时间
} // ConversationRow 结束

/** 列表页的会话视图：含对方信息、最后一条消息与未读数 */
export interface ConversationListItem {
  id: string; // 会话 ID
  type: 'direct' | 'group'; // 类型
  title: string; // 展示标题（私聊取对方显示名）
  avatar_object_key: string | null; // 头像对象键
  other_user_id?: string | null; // 私聊的对方用户 ID（群聊为 null）
  last_message: MessageView | null; // 最后一条消息（无消息时为 null）
  unread_count: number; // 当前用户未读消息数
  pinned: boolean; // 当前用户是否置顶该会话（来自成员表，按人独立）
  muted: boolean; // 当前用户是否免打扰（来自成员表）
  member_count: number; // 群成员数（私聊恒为 2），前端用于群头像展示
  updated_at: string; // 最后更新时间
} // ConversationListItem 结束

/** 创建会话（direct 或 group）：同时写入成员表，返回会话 ID */
export function createConversation(
  db: Db,
  params: {
    type: 'direct' | 'group'; // 会话类型
    memberUserIds: string[]; // 初始成员列表（含创建者）
    title?: string; // 群标题（direct 忽略）
    ownerUserId?: string; // 群主（direct 可为空）
    now?: string; // 可注入时间戳，便于测试
  },
): string {
  const now = params.now ?? new Date().toISOString(); // 取当前时间或注入值
  const convId = uuidv7(); // 生成会话主键
  const title = params.type === 'group' ? (params.title ?? '群聊') : ''; // 群聊用传入标题，私聊留空
  const owner = params.type === 'group' ? params.ownerUserId ?? params.memberUserIds[0] : null; // 群主仅群聊有

  // 插入会话主体
  db.prepare(
    `INSERT INTO im_conversations (id, type, title, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(convId, params.type, title, owner, now, now);

  // 写入全部初始成员
  const insertMember = db.prepare(
    `INSERT INTO im_conversation_members (conversation_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?)`,
  );
  // 遍历成员列表逐个插入；创建者在群聊中为 owner 角色，其余为 member
  for (const uid of params.memberUserIds) {
    const role = params.type === 'group' && uid === owner ? 'owner' : 'member';
    insertMember.run(convId, uid, role, now);
  }
  return convId; // 返回新会话 ID
} // createConversation 结束

/** 获取或创建两人私聊会话：已存在则复用，不存在则新建 */
export function getOrCreateDirectConversation(db: Db, userA: string, userB: string, now?: string): string {
  const pair = [userA, userB].sort(); // 排序后比较，保证 (A,B) 与 (B,A) 命中同一会话
  // 查找同时包含两人的 direct 会话：通过成员表自连接
  const row = db
    .prepare(
      `SELECT c.id FROM im_conversations c
         JOIN im_conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
         JOIN im_conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
        WHERE c.type = 'direct' AND c.deleted_at IS NULL
        LIMIT 1`,
    )
    .get(pair[0], pair[1]) as { id: string } | undefined;
  // 已存在直接返回
  if (row) return row.id;
  // 不存在则新建
  return createConversation(db, { type: 'direct', memberUserIds: [userA, userB], now });
} // getOrCreateDirectConversation 结束

/** 判断某用户是否为会话成员 */
export function isMember(db: Db, conversationId: string, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM im_conversation_members WHERE conversation_id = ? AND user_id = ?`,
    )
    .get(conversationId, userId);
  return !!row; // 查到即成员
} // isMember 结束

/** 取会话全部成员的用户 ID 列表 */
export function getMemberUserIds(db: Db, conversationId: string): string[] {
  const rows = db
    .prepare(`SELECT user_id FROM im_conversation_members WHERE conversation_id = ?`)
    .all(conversationId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
} // getMemberUserIds 结束

/** 列出某用户的全部会话（按最后更新时间倒序），含最后一条消息与未读数 */
export function listConversations(db: Db, userId: string): ConversationListItem[] {
  // 查该用户参与的所有会话基础信息；置顶会话排在最前，其次按最后更新时间倒序
  const convs = db
    .prepare(
      `SELECT c.id, c.type, c.title, c.avatar_object_key, c.updated_at,
              m.last_read_message_id, m.pinned, m.muted
         FROM im_conversations c
         JOIN im_conversation_members m ON m.conversation_id = c.id
        WHERE m.user_id = ? AND c.deleted_at IS NULL
        ORDER BY m.pinned DESC, c.updated_at DESC`,
    )
    .all(userId) as Array<
    ConversationRow & { last_read_message_id: string | null; pinned: number; muted: number }
  >;

  // 预编译：取会话最后一条消息
  const lastMsgStmt = db.prepare(
    `SELECT m.*, u.display_name AS sender_display_name
       FROM im_messages m
       JOIN users u ON u.id = m.sender_user_id
      WHERE m.conversation_id = ? AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT 1`,
  );
  // 预编译：统计未读消息数（大于 last_read_message_id 的非本人消息）
  const unreadStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM im_messages
      WHERE conversation_id = ? AND deleted_at IS NULL
        AND sender_user_id != ?
        AND id > COALESCE(?, '')`, // last_read_message_id 作为参数传入；为空串时 id > '' 恒真（所有消息都未读）
  );

  // 逐会话组装列表项
  return convs.map((c) => {
    // 取最后一条消息并映射为 MessageView
    const lastRow = lastMsgStmt.get(c.id) as (Record<string, unknown> & { sender_display_name: string }) | undefined;
    const lastMessage: MessageView | null = lastRow ? rowToMessageView(lastRow) : null;

    // 取私聊对方的用户 ID（用于前端按对方渲染头像与标题）
    let otherUserId: string | null = null;
    if (c.type === 'direct') {
      const other = db
        .prepare(
          `SELECT user_id FROM im_conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1`,
        )
        .get(c.id, userId) as { user_id: string } | undefined;
      otherUserId = other?.user_id ?? null;
      // 私聊标题取对方显示名
      if (otherUserId) {
        const u = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(otherUserId) as
          | { display_name: string }
          | undefined;
        if (u) c.title = u.display_name || otherUserId.slice(0, 8);
      }
    }

    // 统计未读数：传入已读游标，空串时全部未读
    const unread = unreadStmt.get(c.id, userId, c.last_read_message_id ?? '') as { n: number };
    // 统计成员数：群聊用于展示「N 人」，私聊固定 2
    const memberCount = (db
      .prepare(`SELECT COUNT(*) AS n FROM im_conversation_members WHERE conversation_id = ?`)
      .get(c.id) as { n: number }).n;

    return {
      id: c.id,
      type: c.type,
      title: c.title,
      avatar_object_key: c.avatar_object_key,
      other_user_id: otherUserId,
      last_message: lastMessage,
      unread_count: unread.n,
      pinned: c.pinned === 1,
      muted: c.muted === 1,
      member_count: memberCount,
      updated_at: c.updated_at,
    };
  });
} // listConversations 结束

/** 单条消息的引用摘要：引用回复落库时固化，原消息被撤回后引用块仍可读 */
export interface QuotedMessage {
  id: string; // 被引用消息 ID
  excerpt: string; // 「发送者: 内容」摘要，超长截断
} // QuotedMessage 结束

/** 取可引用的消息：必须同会话、未撤回；不存在返回 undefined，由调用方回 400 */
export function getQuotedMessage(db: Db, conversationId: string, messageId: string): QuotedMessage | undefined {
  const row = db
    .prepare(
      `SELECT m.id, m.content_type, m.content, m.object_name, m.deleted_at, u.display_name
         FROM im_messages m LEFT JOIN users u ON u.id = m.sender_user_id
        WHERE m.id = ? AND m.conversation_id = ?`,
    )
    .get(messageId, conversationId) as
    | { id: string; content_type: MessageContentType; content: string; object_name: string | null; deleted_at: string | null; display_name: string | null }
    | undefined;
  if (!row || row.deleted_at) return undefined; // 已撤回或不存在都不允许引用
  const sender = row.display_name || '成员'; // 发送者显示名，缺失用通用称谓
  const body = row.content_type === 'image' ? '[图片]' : row.content_type === 'file' ? `[文件] ${row.object_name ?? ''}` : row.content || '[消息]'; // 按类型生成可读摘要
  return { id: row.id, excerpt: `${sender}: ${body}`.slice(0, 80) }; // 摘要限 80 字，避免引用块过长
} // getQuotedMessage 结束

/** 创建消息并落库，返回完整 MessageView（含发送者显示名） */
export function createMessage(
  db: Db,
  params: {
    conversationId: string; // 所属会话
    senderUserId: string; // 发送者
    contentType: MessageContentType; // 内容类型
    content?: string; // 文本内容
    objectKey?: string; // 媒体对象键
    objectMime?: string; // 媒体 MIME
    objectName?: string; // 原始文件名
    objectSize?: number; // 文件大小
    replyToId?: string; // 引用回复的目标消息 ID
    replyExcerpt?: string; // 被引用消息的摘要快照
    now?: string; // 可注入时间
  },
): MessageView {
  const now = params.now ?? new Date().toISOString(); // 取时间
  const msgId = uuidv7(); // 消息主键
  // 插入消息
  db.prepare(
    `INSERT INTO im_messages
       (id, conversation_id, sender_user_id, content_type, content,
        object_key, object_mime, object_name, object_size, reply_to_id, reply_excerpt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
  ).run(
    msgId,
    params.conversationId,
    params.senderUserId,
    params.contentType,
    params.content ?? '',
    params.objectKey ?? null,
    params.objectMime ?? null,
    params.objectName ?? null,
    params.objectSize ?? null,
    params.replyToId ?? null,
    params.replyExcerpt ?? null,
    now,
    now,
  );
  // 同步刷新会话的 updated_at，使该会话在列表中置顶
  db.prepare(`UPDATE im_conversations SET updated_at = ? WHERE id = ?`).run(now, params.conversationId);
  // 查出完整消息视图（含发送者显示名）
  const row = db
    .prepare(
      `SELECT m.*, u.display_name AS sender_display_name
         FROM im_messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.id = ?`,
    )
    .get(msgId) as Record<string, unknown> & { sender_display_name: string };
  return rowToMessageView(row);
} // createMessage 结束

/** 分页拉取某会话的历史消息：按 created_at 倒序，before 游标为消息 ID */
export function listMessages(
  db: Db,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): MessageView[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200); // 限制在 1-200 之间，防过大
  // 有游标时取比游标更早的消息，无游标时取最新
  const rows = opts.before
    ? (db
        .prepare(
          `SELECT m.*, u.display_name AS sender_display_name
             FROM im_messages m JOIN users u ON u.id = m.sender_user_id
            WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.id < ?
            ORDER BY m.created_at DESC
            LIMIT ?`,
        )
        .all(conversationId, opts.before, limit) as Array<Record<string, unknown> & { sender_display_name: string }>)
    : (db
        .prepare(
          `SELECT m.*, u.display_name AS sender_display_name
             FROM im_messages m JOIN users u ON u.id = m.sender_user_id
            WHERE m.conversation_id = ? AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC
            LIMIT ?`,
        )
        .all(conversationId, limit) as Array<Record<string, unknown> & { sender_display_name: string }>);
  // 倒序查出来后再反转为正序，前端按时间从上到下展示
  return rows.map(rowToMessageView).reverse();
} // listMessages 结束

/** 定位拉取：以目标消息为中心取前后各半页，供会话内搜索点击后跳转（UUIDv7 主键天然按时间有序） */
export function listMessagesAround(
  db: Db,
  conversationId: string,
  messageId: string,
  limit = 40,
): MessageView[] {
  const total = Math.min(Math.max(limit ?? 40, 4), 200); // 限制总量，避免一次拉太多
  const half = Math.floor(total / 2); // 前后各半页
  const beforeRows = db
    .prepare(
      `SELECT m.*, u.display_name AS sender_display_name
         FROM im_messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.id < ?
        ORDER BY m.id DESC LIMIT ?`,
    )
    .all(conversationId, messageId, half) as Array<Record<string, unknown> & { sender_display_name: string }>; // 目标之前的半页（倒序查）
  const fromRows = db
    .prepare(
      `SELECT m.*, u.display_name AS sender_display_name
         FROM im_messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.id >= ?
        ORDER BY m.id ASC LIMIT ?`,
    )
    .all(conversationId, messageId, total - half) as Array<Record<string, unknown> & { sender_display_name: string }>; // 目标及其后的半页（正序查）
  return [...beforeRows.map(rowToMessageView).reverse(), ...fromRows.map(rowToMessageView)]; // 拼成从早到晚的正序列表
} // listMessagesAround 结束

/** 标记会话已读：更新该成员的 last_read_message_id，并把会话内状态为 delivered 的消息置为 read */
export function markConversationRead(db: Db, conversationId: string, userId: string, messageId: string): void {
  // 更新成员的已读游标
  db.prepare(
    `UPDATE im_conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?`,
  ).run(messageId, conversationId, userId);
  // 把该会话中由他人发送、状态为 sent/delivered 的消息置为 read（简化模型：任一成员已读即标记）
  db.prepare(
    `UPDATE im_messages SET status = 'read', updated_at = ?
      WHERE conversation_id = ? AND status != 'read' AND sender_user_id != ?`,
  ).run(new Date().toISOString(), conversationId, userId);
} // markConversationRead 结束

/** 按显示名或身份标识搜索用户（用于创建会话时选人），排除当前用户自身 */
export function searchUsers(db: Db, query: string, limit: number, excludeUserId: string): Array<{ id: string; display_name: string; region: string }> {
  const q = `%${query.trim()}%`; // 前后加通配符做模糊匹配
  const rows = db
    .prepare(
      `SELECT DISTINCT u.id, u.display_name, u.region
         FROM users u
         LEFT JOIN identities i ON i.user_id = u.id
        WHERE u.id != ? AND u.status = 'active'
          AND (u.display_name LIKE ? OR i.identifier LIKE ?)
        ORDER BY u.display_name
        LIMIT ?`,
    )
    .all(excludeUserId, q, q, Math.min(Math.max(limit, 1), 50)) as Array<{
    id: string;
    display_name: string;
    region: string;
  }>;
  return rows;
} // searchUsers 结束

/** 单个会话的基础信息（群管理端点需要 type / owner 判断权限） */
export interface ConversationInfo {
  id: string; // 会话 ID
  type: 'direct' | 'group'; // 会话类型
  title: string; // 群名（私聊为空串）
  owner_user_id: string | null; // 群主 ID（私聊为空）
} // ConversationInfo 结束

/** 取会话基础信息：不存在或已删除返回 undefined */
export function getConversation(db: Db, conversationId: string): ConversationInfo | undefined {
  return db
    .prepare(`SELECT id, type, title, owner_user_id FROM im_conversations WHERE id = ? AND deleted_at IS NULL`)
    .get(conversationId) as ConversationInfo | undefined;
} // getConversation 结束

/** 取成员角色：非成员返回 null，用于「群主才能改名/踢人」这类判断 */
export function getMemberRole(db: Db, conversationId: string, userId: string): 'owner' | 'admin' | 'member' | null {
  const row = db
    .prepare(`SELECT role FROM im_conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .get(conversationId, userId) as { role: 'owner' | 'admin' | 'member' } | undefined;
  return row?.role ?? null; // 未入表即非成员
} // getMemberRole 结束

/** 成员列表视图：带显示名，前端群成员面板直接渲染 */
export interface ConversationMember {
  user_id: string; // 成员 ID
  display_name: string; // 显示名（缺失时回落 ID 前 8 位）
  role: 'owner' | 'admin' | 'member'; // 群内角色
  joined_at: string; // 入群时间
} // ConversationMember 结束

/** 列出会话成员（按入群时间升序，群主天然排最前） */
export function listMembers(db: Db, conversationId: string): ConversationMember[] {
  const rows = db
    .prepare(
      `SELECT m.user_id, m.role, m.joined_at, u.display_name
         FROM im_conversation_members m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = ?
        ORDER BY m.joined_at ASC`,
    )
    .all(conversationId) as Array<{ user_id: string; role: ConversationMember['role']; joined_at: string; display_name: string | null }>;
  return rows.map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name || row.user_id.slice(0, 8), // 没设置显示名时回落 ID 前 8 位
    role: row.role,
    joined_at: row.joined_at,
  }));
} // listMembers 结束

/** 消息撤回结果：成功或被拒的具体原因，便于路由返回可读错误 */
export interface RecallResult {
  ok: boolean; // 是否撤回成功
  reason?: 'not_found' | 'not_owner' | 'expired' | 'already_deleted'; // 失败原因
} // RecallResult 结束

/** 撤回消息：仅发送者本人、且消息创建时间在窗口内（默认 2 分钟）可撤回；撤回即软删 */
export function recallMessage(
  db: Db,
  params: { conversationId: string; messageId: string; userId: string; windowMs?: number; now?: string },
): RecallResult {
  const nowIso = params.now ?? new Date().toISOString(); // 当前时间
  const windowMs = params.windowMs ?? 120000; // 微信式 2 分钟窗口
  const row = db
    .prepare(`SELECT id, sender_user_id, created_at, deleted_at FROM im_messages WHERE id = ? AND conversation_id = ?`)
    .get(params.messageId, params.conversationId) as
    | { id: string; sender_user_id: string; created_at: string; deleted_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' }; // 消息不存在
  if (row.deleted_at) return { ok: false, reason: 'already_deleted' }; // 已撤回/已删除
  if (row.sender_user_id !== params.userId) return { ok: false, reason: 'not_owner' }; // 只能撤回自己发的
  const elapsed = Date.parse(nowIso) - Date.parse(row.created_at); // 已过去毫秒
  if (!Number.isFinite(elapsed) || elapsed > windowMs) return { ok: false, reason: 'expired' }; // 超过撤回窗口
  // 软删并清空正文/对象键，避免历史内容残留
  db.prepare(
    `UPDATE im_messages SET deleted_at = ?, content = '', object_key = NULL, object_mime = NULL, object_name = NULL, updated_at = ?
      WHERE id = ?`,
  ).run(nowIso, nowIso, params.messageId);
  return { ok: true }; // 撤回成功
} // recallMessage 结束

/** 会话内消息搜索：按内容模糊匹配，只搜未删除消息，结果按时间倒序 */
export function searchMessages(db: Db, conversationId: string, query: string, limit = 30): MessageView[] {
  const q = `%${query.trim()}%`; // 通配符包裹
  const cap = Math.min(Math.max(limit, 1), 100); // 条数上限，避免一次拉爆
  const rows = db
    .prepare(
      `SELECT m.*, u.display_name AS sender_display_name
         FROM im_messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.content LIKE ?
        ORDER BY m.created_at DESC
        LIMIT ?`,
    )
    .all(conversationId, q, cap) as Array<Record<string, unknown> & { sender_display_name: string }>;
  return rows.map(rowToMessageView); // 倒序返回，前端按「最新命中在前」展示
} // searchMessages 结束

/** 群改名：同时刷新 updated_at，让该会话在列表里置顶 */
export function renameConversation(db: Db, conversationId: string, title: string, now?: string): void {
  const nowIso = now ?? new Date().toISOString(); // 当前时间
  db.prepare(`UPDATE im_conversations SET title = ?, updated_at = ? WHERE id = ?`).run(title, nowIso, conversationId);
} // renameConversation 结束

/** 批量加入成员：已存在的成员忽略（INSERT OR IGNORE，避免重复入群报错） */
export function addConversationMembers(db: Db, conversationId: string, userIds: string[], now?: string): number {
  const nowIso = now ?? new Date().toISOString(); // 当前时间
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO im_conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
  );
  let added = 0; // 实际新增人数
  for (const uid of userIds) added += stmt.run(conversationId, uid, nowIso).changes; // changes 为 0 表示已在群里
  if (added > 0) db.prepare(`UPDATE im_conversations SET updated_at = ? WHERE id = ?`).run(nowIso, conversationId); // 有新人则顶起会话
  return added; // 返回新增人数，路由用于回包
} // addConversationMembers 结束

/** 移除成员：同时清掉其已读游标，重新入群时从零开始统计未读 */
export function removeConversationMember(db: Db, conversationId: string, userId: string, now?: string): boolean {
  const nowIso = now ?? new Date().toISOString(); // 当前时间
  const result = db
    .prepare(`DELETE FROM im_conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .run(conversationId, userId);
  if (result.changes > 0) db.prepare(`UPDATE im_conversations SET updated_at = ? WHERE id = ?`).run(nowIso, conversationId); // 退群也让会话在对方列表刷新
  return result.changes > 0; // 是否真的移除了
} // removeConversationMember 结束

/** 删除会话（对当前用户生效）：群聊群主解散 → 整会话软删；成员退群 → 仅移除自己；私聊 → 仅移除自己 */
export function deleteConversationForUser(db: Db, conversationId: string, userId: string, now?: string): 'dissolved' | 'left' | 'not_found' {
  const info = getConversation(db, conversationId); // 先取会话信息
  if (!info) return 'not_found'; // 会话不存在
  const role = getMemberRole(db, conversationId, userId); // 当前用户角色
  if (!role) return 'not_found'; // 非成员视作不存在，避免越权探测
  const nowIso = now ?? new Date().toISOString(); // 当前时间
  if (info.type === 'group' && role === 'owner') { // 群主解散：整条会话软删，消息按 deleted_at 过滤不再返回
    db.prepare(`UPDATE im_conversations SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(nowIso, nowIso, conversationId);
    return 'dissolved';
  } // 解散分支结束
  removeConversationMember(db, conversationId, userId, nowIso); // 私聊/普通成员：只把自己移出
  return 'left'; // 返回「已退出」
} // deleteConversationForUser 结束

/** 设置置顶 / 免打扰：按人独立，写成员表，不影响对方 */
export function setConversationPreference(
  db: Db,
  conversationId: string,
  userId: string,
  patch: { pinned?: boolean; muted?: boolean },
): void {
  if (patch.pinned !== undefined) {
    db.prepare(`UPDATE im_conversation_members SET pinned = ? WHERE conversation_id = ? AND user_id = ?`).run(patch.pinned ? 1 : 0, conversationId, userId);
  } // 置顶分支
  if (patch.muted !== undefined) {
    db.prepare(`UPDATE im_conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?`).run(patch.muted ? 1 : 0, conversationId, userId);
  } // 免打扰分支
} // setConversationPreference 结束

/** 设置成员角色：仅允许在 admin 与 member 之间切换（owner 变换走 transferOwnership） */
export function setMemberRole(
  db: Db,
  conversationId: string,
  userId: string,
  role: 'admin' | 'member',
): boolean {
  const result = db
    .prepare(`UPDATE im_conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ? AND role != 'owner'`)
    .run(role, conversationId, userId); // 群主行不允许被这条语句改写
  return result.changes > 0; // 返回是否真的变更
} // setMemberRole 结束

/** 转让群主：新群主升为 owner、原群主降为 member，并同步会话表的 owner_user_id */
export function transferOwnership(
  db: Db,
  conversationId: string,
  fromUserId: string,
  toUserId: string,
  now?: string,
): boolean {
  const nowIso = now ?? new Date().toISOString(); // 当前时间
  const target = db
    .prepare(`SELECT 1 FROM im_conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .get(conversationId, toUserId); // 目标必须是现有成员
  if (!target) return false; // 非成员不能接任群主
  db.prepare(`UPDATE im_conversation_members SET role = 'member' WHERE conversation_id = ? AND user_id = ?`).run(conversationId, fromUserId); // 原群主降级
  db.prepare(`UPDATE im_conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?`).run(conversationId, toUserId); // 新群主上任
  db.prepare(`UPDATE im_conversations SET owner_user_id = ?, updated_at = ? WHERE id = ?`).run(toUserId, nowIso, conversationId); // 会话表同步
  return true; // 转让成功
} // transferOwnership 结束

/** 取单个用户的显示名（用于消息视图冗余展示） */
export function getUserDisplayName(db: Db, userId: string): string {
  const row = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(userId) as
    | { display_name: string }
    | undefined;
  return row?.display_name || userId.slice(0, 8); // 缺显示名时回退到 ID 前 8 位
} // getUserDisplayName 结束

/** 把 DB 行映射为 MessageView：统一字段命名与空值处理 */
function rowToMessageView(row: Record<string, unknown> & { sender_display_name: string }): MessageView {
  return {
    id: String(row.id), // 消息 ID
    conversation_id: String(row.conversation_id), // 会话 ID
    sender_user_id: String(row.sender_user_id), // 发送者 ID
    sender_display_name: row.sender_display_name || String(row.sender_user_id).slice(0, 8), // 发送者显示名
    content_type: row.content_type as MessageContentType, // 内容类型
    content: String(row.content ?? ''), // 文本内容
    object_key: (row.object_key as string | null) ?? null, // 媒体对象键
    object_mime: (row.object_mime as string | null) ?? null, // 媒体 MIME
    object_name: (row.object_name as string | null) ?? null, // 原始文件名
    object_size: (row.object_size as number | null) ?? null, // 文件大小
    reply_to_id: (row.reply_to_id as string | null) ?? null, // 引用回复目标消息 ID
    reply_excerpt: (row.reply_excerpt as string | null) ?? null, // 引用摘要快照
    status: row.status as MessageView['status'], // 投递状态
    created_at: String(row.created_at), // 创建时间
  };
} // rowToMessageView 结束
