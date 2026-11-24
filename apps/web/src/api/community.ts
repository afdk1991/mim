/**
 * 社区互动补齐端点（2026-11-15）：分页、编辑、治理、举报、通知、全文搜索。
 *
 * 单独放一个文件，不改 endpoints.ts 的共享契约：
 *   - 只用 request 出口，鉴权 / 幂等 / 401 续期与其他业务域完全一致；
 *   - 类型就近声明，避免为新增字段去动共享 types.ts（并行线正在改它）。
 */

import { request } from './request.js'; // 统一请求出口
import type { CommunityPost, CommunityThreadDetail, ThreadAttachmentMeta } from './types.js'; // 复用详情 / 回复 / 附件元数据既有类型（附件命名与详情返回一致）

/** 详情里帖子的扩展字段：HEAD 类型未声明，读取时按可选字段解释。 */
export interface ThreadExtras { // 帖子扩展列
  pinned?: number | boolean; // 是否置顶
  reply_locked?: boolean; // 是否锁定回复（服务端已与付费锁解耦）
  can_edit?: boolean; // 是否作者本人可编辑
  attachments?: ThreadAttachmentMeta[]; // 附件清单（不含对象键）
}

/** 帖子详情分页响应：回复分页与锁定态都在根上。 */
export interface ThreadDetailPage { // 详情响应
  thread: CommunityThreadDetail & ThreadExtras; // 帖子（含置顶 / 锁定回复 / 可编辑）
  posts: CommunityPost[]; // 当前页回复
  liked: boolean; // 我是否已赞
  unlocked: boolean; // 是否已解锁正文
  favorited: boolean; // 我是否已收藏
  posts_total?: number; // 回复总数（未解锁为 0）
  post_limit?: number; // 回复页长
  post_offset?: number; // 回复偏移
  reply_locked?: boolean; // 锁定回复（根级同名冗余，便于直接读取）
  can_edit?: boolean; // 作者可编辑
}

/** 搜索结果项：snippet 已由服务端转义并插入 <mark>。 */
export interface CommunitySearchItem { // 搜索命中
  id: string; // 帖子主键
  title: string; // 标题
  kind: string; // 形态
  cover_url: string | null; // 封面
  price_cents: number; // 定价
  views: number; // 浏览
  likes: number; // 点赞
  reply_count: number; // 回复
  board_slug: string; // 板块
  board_name: string; // 板块名
  snippet: string; // 高亮摘要（HTML 安全）
  locked: boolean; // 是否付费
  relevance?: number; // 相关性得分：仅相关性排序分支有值
}

/** 热榜项：heat 为自研热度算法得分。 */
export interface CommunityTrendingItem { // 热榜一条
  id: string; // 帖子主键
  title: string; // 标题
  summary: string; // 摘要
  kind: string; // 形态
  cover_url: string | null; // 封面
  price_cents: number; // 定价
  views: number; // 浏览
  likes: number; // 点赞
  reply_count: number; // 回复
  board_slug: string; // 板块
  board_name: string; // 板块名
  heat: number; // 热度分
}

/** 热榜响应：window 为参与排序的候选窗口，算法可对账。 */
export interface CommunityTrendingPage { // 热榜分页响应
  items: CommunityTrendingItem[]; // 当前榜
  limit: number; // 请求上限
  algorithm: string; // 算法版本标识
  window: number; // 候选窗口
  weights_source?: string; // 参数来源：env / settings / default
}

/** 搜索结果分页。 */
export interface CommunitySearchPage { // 搜索分页响应
  items: CommunitySearchItem[]; // 当前页
  total: number; // 总数
  offset: number; // 偏移
  limit: number; // 页长
  q: string; // 生效关键词
}

/** 站内通知项：reply / accept / like / favorite / report。 */
export interface CommunityNotification { // 收件箱一行
  id: string; // 主键
  kind: string; // 事件类型
  thread_id: string | null; // 关联帖子
  post_id: string | null; // 关联回复
  actor_id: string | null; // 触发者
  actor_name: string | null; // 触发者昵称
  thread_title: string | null; // 帖子标题
  content: string; // 摘要
  read_at: string | null; // 已读时间
  created_at: string; // 产生时间
}

/** 通知分页响应。 */
export interface NotificationPage { // 通知分页
  items: CommunityNotification[]; // 当前页
  total: number; // 总数
  offset: number; // 偏移
  limit: number; // 页长
  unread: number; // 未读数
}

/** 举报项：版主工作台按板块读取。 */
export interface CommunityReportItem { // 举报一行
  id: string; // 主键
  reporter_id: string; // 举报人
  reporter_name: string | null; // 举报人昵称
  target_type: 'thread' | 'post'; // 对象类型
  target_id: string; // 对象主键
  thread_id: string | null; // 归属帖子
  thread_title: string | null; // 帖子标题
  reason: string; // 原因
  detail: string; // 补充说明
  status: string; // 状态
  created_at: string; // 提交时间
}

/** 举报分页响应。 */
export interface ReportPage { // 举报分页
  items: CommunityReportItem[]; // 当前页
  total: number; // 总数
  offset: number; // 偏移
  limit: number; // 页长
  status: string; // 生效状态
}

/** 把可选参数拼成查询串；空值不落键。 */
function query(params: Record<string, string | number | undefined>): string { // 查询串构造
  const qs = new URLSearchParams(); // 逐项累积
  for (const [key, value] of Object.entries(params)) { // 跳过 undefined / 空串
    if (value === undefined || value === '') continue; // 空值不落键
    qs.set(key, String(value)); // 统一转字符串
  } // 遍历结束
  const text = qs.toString(); // 序列化
  return text ? `?${text}` : ''; // 无参数时不带问号
}

/** 帖子详情：回复按 post_limit / post_offset 真分页。 */
export function threadDetail(id: string, opts: { post_limit?: number; post_offset?: number } = {}) { // 详情
  return request<ThreadDetailPage>( // 读接口不幂等
    `/community/threads/${encodeURIComponent(id)}${query({ post_limit: opts.post_limit, post_offset: opts.post_offset })}`,
    { idempotency: false },
  ); // 请求结束
}

/** 全文搜索：默认相关性排序；sort=latest 回旧时间序，diversify=1 去同质。 */
export function searchThreads(opts: { q: string; board?: string; limit?: number; offset?: number; sort?: 'relevance' | 'latest'; diversify?: boolean }) { // 搜索
  return request<CommunitySearchPage>( // 读接口不幂等
    `/community/search${query({ q: opts.q, board: opts.board === 'all' ? undefined : opts.board, limit: opts.limit, offset: opts.offset, sort: opts.sort === 'latest' ? 'latest' : undefined, diversify: opts.diversify ? 1 : undefined })}`, // 只传非默认值，保持请求干净
    { idempotency: false },
  ); // 请求结束
}

/** 社区热榜：匿名只读，按自研热度算法排序。 */
export function trendingThreads(opts: { limit?: number; board?: string } = {}) { // 热榜
  return request<CommunityTrendingPage>( // 匿名可读
    `/community/trending${query({ limit: opts.limit, board: opts.board === 'all' ? undefined : opts.board })}`, // 板块 all 不传
    { idempotency: false },
  ); // 请求结束
}

/** 通知列表（默认 20 条一页）。 */
export function notifications(opts: { offset?: number; limit?: number; unread?: boolean } = {}) { // 通知列表
  return request<NotificationPage>( // 私有读
    `/community/notifications${query({ offset: opts.offset, limit: opts.limit, unread: opts.unread ? 1 : undefined })}`,
    { idempotency: false },
  ); // 请求结束
}

/** 标记通知已读：传 ids 精确标，不传全部标。 */
export function markNotificationsRead(ids?: string[]) { // 标记已读
  return request<{ ok: boolean; unread: number }>('/community/notifications/read', { method: 'POST', body: ids && ids.length > 0 ? { ids } : {} }); // 写操作带幂等键
}

/** 作者编辑帖子：只提交需要改的字段，未传字段由服务端保持原值。 */
export function updateThread(id: string, patch: { title?: string; summary?: string; body?: string; cover_url?: string | null; price_cents?: number }) { // 编辑
  return request<{ ok: boolean }>(`/community/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }); // 写操作带幂等键
}

/** 治理动作：置顶 / 取消置顶 / 隐藏 / 恢复 / 锁定 / 解锁。 */
export function moderateThread(id: string, action: 'pin' | 'unpin' | 'hide' | 'restore' | 'lock' | 'unlock') { // 治理
  return request<{ ok: boolean }>(`/community/threads/${encodeURIComponent(id)}/moderate`, { method: 'POST', body: { action } }); // 写操作带幂等键
}

/** 删除回复（作者 / 版主）：服务端软删并回退回复计数。 */
export function deletePost(postId: string) { // 删除回复
  return request<{ ok: boolean }>(`/community/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' }); // 写操作带幂等键
}

/** 回复帖子 / 楼中楼：parent_id 必须是本帖未删楼层。 */
export function postReply(threadId: string, content: string, parentId?: string) { // 回复
  return request<{ ok: boolean; id: string }>(`/community/threads/${encodeURIComponent(threadId)}/reply`, { method: 'POST', body: { content, parent_id: parentId || undefined } }); // 写操作带幂等键
}

/** 举报帖子或回复。 */
export function createReport(payload: { target_type: 'thread' | 'post'; target_id: string; reason: 'spam' | 'abuse' | 'illegal' | 'porn' | 'other'; detail?: string }) { // 举报
  return request<{ ok: boolean; id: string }>('/community/reports', { method: 'POST', body: payload }); // 写操作带幂等键
}

/** 版主工作台：按板块读取举报队列。 */
export function boardReports(slug: string, opts: { status?: 'open' | 'resolved' | 'dismissed'; limit?: number; offset?: number } = {}) { // 举报队列
  return request<ReportPage>( // 私有读，非版主 403
    `/community/boards/${encodeURIComponent(slug)}/reports${query({ status: opts.status, limit: opts.limit, offset: opts.offset })}`,
    { idempotency: false },
  ); // 请求结束
}

/** 处理举报：忽略 / 隐藏帖子 / 删除回复。 */
export function resolveReport(id: string, action: 'dismiss' | 'hide_thread' | 'delete_post') { // 处理举报
  return request<{ ok: boolean; action: string }>(`/community/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { action } }); // 写操作带幂等键
}

/** 读取置顶标记：HEAD 类型没有该列，运行时存在。 */
export function isPinned(thread: object | null | undefined): boolean { // 置顶判定
  return Boolean((thread as { pinned?: number | boolean } | null | undefined)?.pinned); // 0 / 缺省均为否
}

/** 读取「锁定回复」标记：与付费锁 locked 区分。 */
export function replyLockedOf(thread: object | null | undefined): boolean { // 回复锁定判定
  return Boolean((thread as { reply_locked?: boolean } | null | undefined)?.reply_locked); // 缺省为未锁定
}
