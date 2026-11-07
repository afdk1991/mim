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
  // 查该用户参与的所有会话基础信息
  const convs = db
    .prepare(
      `SELECT c.id, c.type, c.title, c.avatar_object_key, c.updated_at,
              m.last_read_message_id
         FROM im_conversations c
         JOIN im_conversation_members m ON m.conversation_id = c.id
        WHERE m.user_id = ? AND c.deleted_at IS NULL
        ORDER BY c.updated_at DESC`,
    )
    .all(userId) as Array<
    ConversationRow & { last_read_message_id: string | null }
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

    return {
      id: c.id,
      type: c.type,
      title: c.title,
      avatar_object_key: c.avatar_object_key,
      other_user_id: otherUserId,
      last_message: lastMessage,
      unread_count: unread.n,
      updated_at: c.updated_at,
    };
  });
} // listConversations 结束

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
    now?: string; // 可注入时间
  },
): MessageView {
  const now = params.now ?? new Date().toISOString(); // 取时间
  const msgId = uuidv7(); // 消息主键
  // 插入消息
  db.prepare(
    `INSERT INTO im_messages
       (id, conversation_id, sender_user_id, content_type, content,
        object_key, object_mime, object_name, object_size, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
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
    status: row.status as MessageView['status'], // 投递状态
    created_at: String(row.created_at), // 创建时间
  };
} // rowToMessageView 结束
