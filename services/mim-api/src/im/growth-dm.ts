/** 成长私信 · 复用现有 IM 通道的系统私信服务。
 *
 * 设计要点：
 *   - 不新建消息系统：所有私信仍写 im_conversations / im_conversation_members / im_messages。
 *   - 系统会话是 direct 会话的一种，用 system_kind 标记，成员为「目标用户 + 系统伪 ID」。
 *   - 系统伪 ID 不落 users 表，避免出现在用户检索与后台用户列表；发送者展示名由协议常量兜底。
 *   - 群发幂等：批次 dedupe_key 唯一 + 逐用户投递台账主键，重复请求不会二次发信。
 */

import { uuidv7 } from '@mim/core-domain'; // 时间有序 UUID
import type { Db } from '../types.js'; // 数据库连接类型
import { createMessage } from './db.js'; // 复用消息落库逻辑（含会话 updated_at 维护）
import { SYSTEM_DM_SENDER_ID, SYSTEM_DM_SENDER_NAME } from './protocol.js'; // 系统发送者常量
import type { MessageView } from './protocol.js'; // 消息视图

/** 成长私信对应的系统会话类型标记 */
export const GROWTH_DM_KIND = 'growth'; // 写入 im_conversations.system_kind

/** 群发受众筛选条件：user_ids 优先；其余条件按 AND 组合，仅命中 active 用户 */
export interface GrowthDmAudience {
  user_ids?: string[]; // 指定单人 / 多人（显式名单优先）
  region?: 'cn' | 'global'; // 按注册地区筛选
  created_after?: string; // 注册时间下界（ISO 时间）
  created_before?: string; // 注册时间上界（ISO 时间）
  query?: string; // 昵称或 Mim ID 模糊匹配
  limit?: number; // 最多投递人数（默认 500，上限 2000）
}

/** 受众命中项：后台预览与投递共用 */
export interface GrowthDmAudienceUser {
  id: string; // 用户 ID
  display_name: string; // 显示名
  member_no: string | null; // Mim ID 号码
  region: string; // 注册地区
}

/** 群发批次行（后台列表与回执使用） */
export interface GrowthDmCampaign {
  id: string; // 批次 ID
  dedupe_key: string; // 幂等键
  title: string; // 批次标题
  body: string; // 正文
  link_url: string | null; // 跳转地址
  link_label: string | null; // 跳转按钮文案
  status: 'sending' | 'sent' | 'failed'; // 批次状态
  target_count: number; // 命中人数
  sent_count: number; // 成功投递人数
  skipped_count: number; // 跳过人数
  operator_id: string | null; // 发起人
  created_at: string; // 创建时间
  sent_at: string | null; // 完成时间
}

/** 单次群发回执 */
export interface GrowthDmSendResult {
  campaign: GrowthDmCampaign; // 批次（新批次或幂等命中的历史批次）
  duplicate: boolean; // true 表示本次请求命中了既有幂等键，没有产生新私信
  deliveries: Array<{ user_id: string; conversation_id: string; message_id: string; message: MessageView }>; // 本次实际投递明细
}

/** 受众上限：防止一次请求锁库过久 */
const MAX_AUDIENCE = 2000; // 单次群发硬上限

/** 解析受众：返回命中用户（按创建时间升序，保证分批可复现） */
export function resolveGrowthDmAudience(db: Db, audience: GrowthDmAudience): GrowthDmAudienceUser[] {
  const where: string[] = [`status = 'active'`]; // 只给活跃账号发信
  const params: unknown[] = []; // 占位参数
  if (audience.user_ids?.length) {
    const ids = [...new Set(audience.user_ids)].filter(Boolean); // 去重，避免同批重复投递
    if (!ids.length) return [];
    where.push(`id IN (${ids.map(() => '?').join(',')})`); // 显式名单
    params.push(...ids);
  }
  if (audience.region) {
    where.push('region = ?'); // 地区筛选
    params.push(audience.region);
  }
  if (audience.created_after) {
    where.push('created_at >= ?'); // 注册时间下界
    params.push(audience.created_after);
  }
  if (audience.created_before) {
    where.push('created_at <= ?'); // 注册时间上界
    params.push(audience.created_before);
  }
  const q = audience.query?.trim(); // 关键词
  if (q) {
    where.push('(display_name LIKE ? OR member_no LIKE ?)'); // 昵称或 Mim ID
    params.push(`%${q}%`, `%${q}%`);
  }
  const limit = Math.min(Math.max(audience.limit ?? 500, 1), MAX_AUDIENCE); // 夹逼上限
  return db
    .prepare(
      `SELECT id, display_name, member_no, region FROM users
        WHERE ${where.join(' AND ')}
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(...params, limit) as GrowthDmAudienceUser[];
}

/** 取或建用户的成长私信系统会话：同一用户同一 system_kind 只保留一个会话 */
export function getOrCreateSystemConversation(db: Db, userId: string, kind = GROWTH_DM_KIND): string {
  const existing = db
    .prepare(
      `SELECT c.id FROM im_conversations c
         JOIN im_conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
        WHERE c.type = 'direct' AND c.system_kind = ? AND c.deleted_at IS NULL
        ORDER BY c.created_at ASC LIMIT 1`,
    )
    .get(userId, kind) as { id: string } | undefined;
  if (existing) return existing.id; // 复用既有系统会话，不重复建
  const now = new Date().toISOString(); // 建会话时间
  const conversationId = uuidv7(); // 会话主键
  db.prepare(
    `INSERT INTO im_conversations (id, type, title, system_kind, created_at, updated_at)
     VALUES (?, 'direct', ?, ?, ?, ?)`,
  ).run(conversationId, SYSTEM_DM_SENDER_NAME, kind, now, now);
  const addMember = db.prepare(
    `INSERT INTO im_conversation_members (conversation_id, user_id, role, joined_at)
     VALUES (?, ?, 'member', ?)`,
  );
  addMember.run(conversationId, userId, now); // 目标用户
  addMember.run(conversationId, SYSTEM_DM_SENDER_ID, now); // 系统身份成员（不落 users 表）
  return conversationId;
}

/** 读取批次行 */
function getCampaign(db: Db, id: string): GrowthDmCampaign {
  return db.prepare(`SELECT * FROM growth_dm_campaigns WHERE id = ?`).get(id) as GrowthDmCampaign;
}

/** 按幂等键读取批次 */
export function findCampaignByDedupeKey(db: Db, dedupeKey: string): GrowthDmCampaign | undefined {
  return db.prepare(`SELECT * FROM growth_dm_campaigns WHERE dedupe_key = ?`).get(dedupeKey) as
    | GrowthDmCampaign
    | undefined;
}

/** 后台批次列表：最近 N 条 */
export function listGrowthDmCampaigns(db: Db, limit = 20): GrowthDmCampaign[] {
  const size = Math.min(Math.max(limit, 1), 100); // 限制单次返回条数
  return db
    .prepare(`SELECT * FROM growth_dm_campaigns ORDER BY created_at DESC LIMIT ?`)
    .all(size) as GrowthDmCampaign[];
}

/** 发送系统私信（幂等）：
 *   - dedupe_key 已存在 → 直接返回既有批次，duplicate=true，不再发信；
 *   - 否则在同一事务内：解析受众 → 建/复用系统会话 → 逐人写系统消息 → 记投递台账。
 */
export function sendGrowthDm(
  db: Db,
  input: {
    dedupeKey: string; // 幂等键
    title: string; // 批次标题（仅后台）
    body: string; // 私信正文
    linkUrl?: string; // 跳转地址
    linkLabel?: string; // 跳转按钮文案
    audience: GrowthDmAudience; // 受众条件
    operatorId: string; // 发起人
  },
): GrowthDmSendResult {
  const existing = findCampaignByDedupeKey(db, input.dedupeKey);
  if (existing) return { campaign: existing, duplicate: true, deliveries: [] }; // 幂等命中，直接回执
  const now = new Date().toISOString(); // 批次时间
  const campaignId = uuidv7(); // 批次主键
  const targets = resolveGrowthDmAudience(db, input.audience); // 解析受众
  const deliveries: GrowthDmSendResult['deliveries'] = []; // 本次投递明细
  const createCampaign = db.prepare(
    `INSERT INTO growth_dm_campaigns
       (id, dedupe_key, title, body, link_url, link_label, audience_json, status, target_count, operator_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?)`,
  );
  const finishCampaign = db.prepare(
    `UPDATE growth_dm_campaigns SET status = 'sent', sent_count = ?, skipped_count = ?, sent_at = ? WHERE id = ?`,
  );
  const insertDelivery = db.prepare(
    `INSERT OR IGNORE INTO growth_dm_deliveries (campaign_id, user_id, conversation_id, message_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    createCampaign.run(
      campaignId,
      input.dedupeKey,
      input.title,
      input.body,
      input.linkUrl ?? null,
      input.linkLabel ?? null,
      JSON.stringify(input.audience),
      targets.length,
      input.operatorId,
      now,
    );
    let skipped = 0; // 被台账挡下的重复投递数
    for (const target of targets) {
      const conversationId = getOrCreateSystemConversation(db, target.id); // 复用或新建系统会话
      const message: MessageView = createMessage(db, {
        conversationId,
        senderUserId: SYSTEM_DM_SENDER_ID, // 发件方固定为系统身份
        contentType: 'system', // 系统私信使用 system 类型，前端渲染为系统卡片
        content: input.body,
        linkUrl: input.linkUrl,
        linkLabel: input.linkLabel,
      });
      const inserted = insertDelivery.run(campaignId, target.id, conversationId, message.id, now);
      if (inserted.changes === 0) {
        skipped += 1; // 同一批次已投递过该用户
        continue;
      }
      deliveries.push({ user_id: target.id, conversation_id: conversationId, message_id: message.id, message });
    }
    finishCampaign.run(deliveries.length, skipped, new Date().toISOString(), campaignId);
  });
  tx(); // 单事务提交：要么全部发出，要么全部回滚
  return { campaign: getCampaign(db, campaignId), duplicate: false, deliveries };
}
