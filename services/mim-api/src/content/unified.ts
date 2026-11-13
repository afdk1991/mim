/**
 * 统一内容与消息域（2026-11-14 P0-B 第 1 步）：启动期回填 + 只读查询。
 *
 * 解决的问题（诊断文档 §1.2 / §1.3）：
 *   内容侧：community_threads（论坛主题）与 circle_posts / circle_notices（圈子动态与公告）三套同构表，
 *          点赞 / 举报 / 收藏 / 评分只实现了一套，搜索要分两路查；
 *   消息侧：im_messages（会话式，带附件 / 引用 / 已读）与 direct_messages（裸私信，无会话模型）两套，
 *          做已读回执 / 撤回 / 引用时私信线要再写一遍。
 *
 * 边界与 P0-A 一致：只建表、只回填、只读；旧表与旧接口原样服务，写路径后续逐条迁移。
 */

import type { Db } from '../types.js'; // 数据库类型

/** 内容来源：论坛主题 / 圈内动态 / 圈内公告 */
export type ContentSource = 'community_thread' | 'circle_post' | 'circle_notice';

/** 统一内容条目 */
export interface ContentItem {
  id: string; // 统一主键
  source: ContentSource; // 来源
  source_id: string; // 源主键
  container_kind: 'board' | 'circle'; // 容器类型
  container_id: string; // 容器主键
  author_id: string | null; // 作者
  kind: string; // 内容形态
  title: string; // 标题
  summary: string; // 摘要
  body: string; // 正文
  status: string; // 状态
  created_at: string; // 发布时间
  updated_at: string; // 更新时间
}

/** 统一会话 */
export interface UnifiedConversation {
  id: string; // 统一主键
  source: 'im' | 'dm'; // 来源
  source_id: string; // 源主键（私信为排序后的用户对）
  type: 'direct' | 'group'; // 会话类型
  title: string; // 标题
  owner_user_id: string | null; // 群主
  members: string[]; // 成员 id 数组
  created_at: string; // 创建时间
  updated_at: string; // 最近活跃
}

/** 统一消息 */
export interface UnifiedMessage {
  id: string; // 统一主键
  conversation_id: string; // 所属统一会话
  source: 'im' | 'dm'; // 来源
  source_id: string; // 源主键
  sender_user_id: string; // 发送者
  content_type: string; // 消息类型
  content: string; // 正文
  object_key: string | null; // 附件对象键
  object_name: string | null; // 附件原名
  reply_to_id: string | null; // 引用目标
  status: string; // 送达状态
  created_at: string; // 发送时间
  deleted_at: string | null; // 撤回时间
}

/** 回填计数：启动日志与测试共用 */
export interface ContentBackfillResult {
  content: number; // 新写入的内容条目数
  conversations: number; // 新写入的会话数
  messages: number; // 新写入的消息数
}

/** 私信两侧用户的会话键：排序后拼接，保证 A→B 与 B→A 落到同一会话 */
function dmKeyOf(a: string, b: string): string {
  return a <= b ? `${a}__${b}` : `${b}__${a}`; // 字典序小者在前，避免双向各建一个会话
}

/** 回填：内容（论坛主题 / 圈内动态 / 圈内公告）+ 消息（IM 会话与消息 / 裸私信） */
export function backfillUnifiedContentMessaging(db: Db): ContentBackfillResult {
  const result: ContentBackfillResult = { content: 0, conversations: 0, messages: 0 }; // 计数器
  const insertContent = db.prepare(
    `INSERT OR IGNORE INTO content_items (id, source, source_id, container_kind, container_id, author_id, kind, title, summary, body, status, metrics_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ); // 内容插入：唯一键 (source, source_id) 保证幂等
  const insertConversation = db.prepare(
    `INSERT OR IGNORE INTO conversations (id, source, source_id, type, title, owner_user_id, members_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ); // 会话插入
  const insertMessage = db.prepare(
    `INSERT OR IGNORE INTO messages (id, conversation_id, source, source_id, sender_user_id, content_type, content, object_key, object_mime, object_name, object_size, reply_to_id, status, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ); // 消息插入

  // ---- 内容一：论坛主题 ----
  const threads = db
    .prepare(`SELECT id, board_id, author_id, title, summary, body, kind, status, views, likes, reply_count, created_at, updated_at FROM community_threads`)
    .all() as Array<{ id: string; board_id: string; author_id: string | null; title: string; summary: string; body: string; kind: string; status: string; views: number; likes: number; reply_count: number; created_at: string; updated_at: string }>; // 论坛线
  for (const row of threads) { // 逐行回填
    const metrics = JSON.stringify({ views: row.views, likes: row.likes, replies: row.reply_count }); // 计数集中到 metrics_json，避免为差异加列
    result.content += insertContent.run(`ci_community_thread_${row.id}`, 'community_thread', row.id, 'board', row.board_id, row.author_id, row.kind, row.title, row.summary, row.body, row.status, metrics, row.created_at, row.updated_at).changes; // 写入
  }

  // ---- 内容二：圈内动态（没有标题，kind 固定 post） ----
  const circlePosts = db.prepare(`SELECT id, circle_id, thread_id, author_id, body, created_at FROM circle_posts`).all() as Array<{ id: string; circle_id: string; thread_id: string | null; author_id: string; body: string; created_at: string }>; // 圈子动态
  for (const row of circlePosts) { // 逐行回填
    const metrics = JSON.stringify({ linked_thread: row.thread_id }); // 记录跨板块聚合的来源帖，迁移时可直接还原
    result.content += insertContent.run(`ci_circle_post_${row.id}`, 'circle_post', row.id, 'circle', row.circle_id, row.author_id, 'post', '', '', row.body, 'published', metrics, row.created_at, row.created_at).changes; // 写入
  }

  // ---- 内容三：圈内公告 ----
  const notices = db.prepare(`SELECT id, circle_id, author_id, body, created_at FROM circle_notices`).all() as Array<{ id: string; circle_id: string; author_id: string; body: string; created_at: string }>; // 圈子公告
  for (const row of notices) { // 逐行回填
    result.content += insertContent.run(`ci_circle_notice_${row.id}`, 'circle_notice', row.id, 'circle', row.circle_id, row.author_id, 'notice', '', '', row.body, 'published', '{}', row.created_at, row.created_at).changes; // 写入
  }

  // ---- 消息一：IM 会话（成员从 im_conversation_members 聚合） ----
  const imConversations = db.prepare(`SELECT id, type, title, owner_user_id, created_at, updated_at FROM im_conversations WHERE deleted_at IS NULL`).all() as Array<{ id: string; type: 'direct' | 'group'; title: string; owner_user_id: string | null; created_at: string; updated_at: string }>; // IM 会话
  const membersOf = db.prepare(`SELECT user_id FROM im_conversation_members WHERE conversation_id = ?`); // 成员查询
  for (const row of imConversations) { // 逐会话回填
    const members = (membersOf.all(row.id) as Array<{ user_id: string }>).map((item) => item.user_id); // 聚合成员
    result.conversations += insertConversation.run(`uc_im_${row.id}`, 'im', row.id, row.type, row.title, row.owner_user_id, JSON.stringify(members), row.created_at, row.updated_at).changes; // 写入
  }

  // ---- 消息二：IM 消息 ----
  const imMessages = db
    .prepare(`SELECT id, conversation_id, sender_user_id, content_type, content, object_key, object_mime, object_name, object_size, reply_to_id, status, created_at, deleted_at FROM im_messages`)
    .all() as Array<{ id: string; conversation_id: string; sender_user_id: string; content_type: string; content: string; object_key: string | null; object_mime: string | null; object_name: string | null; object_size: number | null; reply_to_id: string | null; status: string; created_at: string; deleted_at: string | null }>; // IM 消息
  for (const row of imMessages) { // 逐条回填
    const reply = row.reply_to_id && imMessages.some((candidate) => candidate.id === row.reply_to_id) ? `um_im_${row.reply_to_id}` : null; // 引用目标需映射成统一主键；目标不存在则不引用
    result.messages += insertMessage.run(`um_im_${row.id}`, `uc_im_${row.conversation_id}`, 'im', row.id, row.sender_user_id, row.content_type, row.content, row.object_key, row.object_mime, row.object_name, row.object_size, reply, row.status, row.created_at, row.deleted_at).changes; // 写入
  }

  // ---- 消息三：裸私信（按用户对合成会话，等价于把 direct_messages 升级成会话模型） ----
  const dms = db.prepare(`SELECT id, from_user_id, to_user_id, content, read_at, created_at FROM direct_messages`).all() as Array<{ id: string; from_user_id: string; to_user_id: string; content: string; read_at: string | null; created_at: string }>; // 私信
  const dmsByPair = new Map<string, Array<typeof dms[number]>>(); // 先按用户对归并，便于同时算出会话时间窗
  for (const row of dms) { // 归并
    const key = dmKeyOf(row.from_user_id, row.to_user_id); // 双向同一键
    const list = dmsByPair.get(key) ?? []; // 取已有列表
    list.push(row); // 追加
    dmsByPair.set(key, list); // 写回
  }
  for (const [pair, list] of dmsByPair) { // 每对用户建一个会话
    const created = list.reduce((min, row) => (row.created_at < min ? row.created_at : min), list[0].created_at); // 最早一条作为会话创建时间
    const updated = list.reduce((max, row) => (row.created_at > max ? row.created_at : max), list[0].created_at); // 最晚一条作为活跃时间
    const [userA, userB] = pair.split('__'); // 拆分回两个用户
    result.conversations += insertConversation.run(`uc_dm_${pair}`, 'dm', pair, 'direct', '', null, JSON.stringify([userA, userB]), created, updated).changes; // 写入会话
    for (const row of list) { // 逐条私信
      const status = row.read_at ? 'read' : 'sent'; // 已读回执映射到统一状态
      result.messages += insertMessage.run(`um_dm_${row.id}`, `uc_dm_${pair}`, 'dm', row.id, row.from_user_id, 'text', row.content, null, null, null, null, null, status, row.created_at, null).changes; // 写入消息
    }
  }

  return result; // 返回计数
}

/** 统一内容流：公开只读，按容器 / 形态过滤，按时间倒序 */
export function listContentItems(db: Db, options: { kind?: string; containerId?: string; limit?: number } = {}): ContentItem[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200); // 与订单接口同一分页口径
  const where: string[] = ['status = ?']; // 默认只出已发布内容，隐藏与归档不外泄
  const values: Array<string | number> = ['published']; // 对应占位符
  if (options.kind) { where.push('kind = ?'); values.push(options.kind); } // 按形态过滤（text / video / notice …）
  if (options.containerId) { where.push('container_id = ?'); values.push(options.containerId); } // 按板块 / 圈子过滤
  values.push(limit); // LIMIT 占位
  const rows = db
    .prepare(`SELECT id, source, source_id, container_kind, container_id, author_id, kind, title, summary, body, status, created_at, updated_at FROM content_items WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as ContentItem[]; // 查询
  return rows; // 返回统一条目
}

/** 我的会话：从 members_json 里判断成员身份，避免再 join 两套成员表 */
export function listConversations(db: Db, userId: string, limit = 50): UnifiedConversation[] {
  const rows = db
    .prepare(`SELECT id, source, source_id, type, title, owner_user_id, members_json, created_at, updated_at FROM conversations ORDER BY updated_at DESC`)
    .all() as Array<Omit<UnifiedConversation, 'members'> & { members_json: string }>; // 取全量再过滤：会话量级远小于消息量级
  return rows
    .filter((row) => { // 成员过滤
      try {
        return (JSON.parse(row.members_json) as string[]).includes(userId); // 在成员数组里
      } catch {
        return false; // 脏数据不让接口 500
      }
    })
    .slice(0, Math.min(Math.max(limit, 1), 200)) // 分页
    .map(({ members_json, ...rest }) => ({ ...rest, members: JSON.parse(members_json) as string[] })); // 还原 members 数组
}

/** 会话内消息：只允许会话成员读取，非成员返回 null（路由据此回 404） */
export function listConversationMessages(db: Db, conversationId: string, userId: string, limit = 100): UnifiedMessage[] | null {
  const conversation = listConversations(db, userId, 200).find((item) => item.id === conversationId); // 复用成员过滤，避免重复实现权限
  if (!conversation) return null; // 非成员 / 不存在
  const rows = db
    .prepare(`SELECT id, conversation_id, source, source_id, sender_user_id, content_type, content, object_key, object_name, reply_to_id, status, created_at, deleted_at FROM messages WHERE conversation_id = ? ORDER BY created_at LIMIT ?`)
    .all(conversationId, Math.min(Math.max(limit, 1), 500)) as UnifiedMessage[]; // 按时间正序，聊天场景从早到晚读
  return rows; // 返回消息
}
