// 管理端运营域 API：批量改价 / 邀请码 / 实名 / 内容 / 工具 / 社区
// 由 api.ts 统一 re-export，视图仍从 '../api' 导入，保持调用面不变
import type { Credential } from './api'; // 凭证类型
import { request } from './api'; // 统一请求层（含凭证注入与错误信封解析）

// ── 批量改价（商业化三期）────────────────────────────────────────────────

/** 调价目标：功能模块或独立商城商品 */
export type PriceBatchTarget = 'module' | 'shop_product'; // 业务步骤
/** 调价模式：固定价 / 百分比 / 固定金额 */
export type PriceBatchMode = 'fixed' | 'percent' | 'amount'; // 业务步骤
/** 调价方向：固定 / 上调 / 下调 */
export type PriceBatchDirection = 'set' | 'increase' | 'decrease'; // 业务步骤

/** 批量改价筛选条件：全部可选，后端按在售集合取交集 */
export interface PriceBatchFilter { // 业务步骤
  // 仅模块：区域
  region?: string;
  // 仅模块：一级或二级分类 slug
  category_slug?: string;
  // 显式目标编码清单
  codes?: string[];
  // 是否纳入下架 / 归档目标
  include_inactive?: boolean;
} // 业务步骤

/** 批次明细：逐目标改前 / 改后快照 */
export interface PriceBatchItem { // 业务步骤
  // 目标类型
  target_type: PriceBatchTarget;
  // 目标主键
  target_id: string;
  // 对外编码
  target_code: string | null;
  // 币种
  currency: string | null;
  // 改前价格（分）
  before_amount_minor: number | null;
  // 改后价格（分）
  after_amount_minor: number | null;
  // 是否跳过
  skipped: boolean;
  // 跳过原因
  reason: string | null;
} // 业务步骤

/** 批次视图：含汇总计数与逐条快照 */
export interface PriceBatchView { // 业务步骤
  // 批次主键
  id: string;
  // 幂等键
  idempotency_key: string;
  // 目标类型
  target_type: PriceBatchTarget;
  // 调价模式
  mode: PriceBatchMode;
  // 调价方向
  direction: PriceBatchDirection;
  // 模式参数
  value: number;
  // 筛选条件快照
  filter: PriceBatchFilter;
  // 命中数
  total: number;
  // 实际改动数
  changed: number;
  // 跳过数
  skipped: number;
  // 创建时间
  created_at: string;
  // 回滚时间
  rolled_back_at: string | null;
  // 明细
  items: PriceBatchItem[];
} // 业务步骤

/** 提交一批调价：固定价方向固定 set，增减模式必须带方向 */
export async function createPriceBatch(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  payload: { // 对象字段 payload：记录一项配置或数据
    target_type: PriceBatchTarget; // 对象字段 target_type：记录一项配置或数据
    mode: PriceBatchMode; // 对象字段 mode：记录一项配置或数据
    direction?: PriceBatchDirection; // 执行当前业务步骤
    value: number; // 对象字段 value：记录一项配置或数据
    filter?: PriceBatchFilter; // 执行当前业务步骤
    idempotency_key: string; // 对象字段 idempotency_key：记录一项配置或数据
  }, // 代码块结束
): Promise<PriceBatchView> { // 执行当前业务步骤
  // POST 管理端批次端点，响应包裹 { batch }
  const data = await request<{ batch: PriceBatchView }>('/admin/commerce/price-batches', {
    method: 'POST', // 对象字段 method：记录一项配置或数据
    body: payload, // 对象字段 body：记录一项配置或数据
    credential, // 执行当前业务步骤
  }); // 代码块结束
  // 解包批次
  return data.batch; // 业务步骤
} // createPriceBatch 结束

/** 最近 50 批调价记录（倒序） */
export async function listPriceBatches(credential: Credential): Promise<PriceBatchView[]> {
  // 响应包裹 { batches }
  const data = await request<{ batches: PriceBatchView[] }>('/admin/commerce/price-batches', { credential });
  // 返回数组
  return data.batches; // 业务步骤
} // listPriceBatches 结束

/** 按快照回滚一批调价 */
export async function rollbackPriceBatch(credential: Credential, batchId: string): Promise<PriceBatchView> {
  // 路径编码 + POST 回滚，响应包裹 { batch }
  const data = await request<{ batch: PriceBatchView }>(
    `/admin/commerce/price-batches/${encodeURIComponent(batchId)}/rollback`, // 执行当前业务步骤
    { method: 'POST', body: {}, credential }, // 执行当前业务步骤
  ); // 执行当前业务步骤
  // 解包回滚后的批次
  return data.batch; // 业务步骤
} // rollbackPriceBatch 结束

// ── 邀请码管理 ────────────────────────────────────────────────────────────

/** 邀请码行 */
export interface InviteRow { // 业务步骤
  // 主键
  id: string;
  // 邀请码
  code: string;
  // 创建人
  created_by: string | null;
  // 可用次数
  max_uses: number;
  // 已用次数
  used_count: number;
  // 过期时间
  expires_at: string | null;
  // 绑定标识
  bound_identifier: string | null;
  // 状态 active / disabled / exhausted
  status: string;
  // 备注
  note: string | null;
  // 创建时间
  created_at: string;
  // 最近核销时间
  last_used_at: string | null;
} // 业务步骤

/** 邀请码汇总统计 */
export interface InviteStats { // 业务步骤
  // 码总量
  total: number;
  // 活跃码
  active: number;
  // 核销次数
  redemptions: number;
} // 业务步骤

/** 邀请码核销记录 */
export interface InviteRedemption { // 业务步骤
  // 记录主键
  id: string;
  // 邀请码主键
  invitation_id: string;
  // 邀请码
  code: string;
  // 注册用户
  user_id: string;
  // 注册标识
  identifier: string | null;
  // 核销时间
  created_at: string;
} // 业务步骤

/** 生成邀请码：count 支持 1–100 批量 */
export async function createInvites(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  payload: { count?: number; max_uses?: number; expires_in_days?: number; bound_identifier?: string; note?: string }, // 对象字段 payload：记录一项配置或数据
): Promise<Array<{ code: string; max_uses: number; expires_at: string | null }>> { // 执行当前业务步骤
  // POST 生成端点，响应 { count, invites }
  const data = await request<{ count: number; invites: Array<{ code: string; max_uses: number; expires_at: string | null }> }>(
    '/admin/invites', // 执行当前业务步骤
    { method: 'POST', body: payload, credential }, // 执行当前业务步骤
  ); // 执行当前业务步骤
  // 返回本次生成清单
  return data.invites; // 业务步骤
} // createInvites 结束

/** 邀请码列表 + 统计 */
export function listInvites(credential: Credential): Promise<{ invites: InviteRow[]; stats: InviteStats }> {
  // GET 管理端列表
  return request<{ invites: InviteRow[]; stats: InviteStats }>('/admin/invites', { credential });
} // listInvites 结束

/** 核销记录：可按码过滤 */
export async function listInviteRedemptions(credential: Credential, code?: string): Promise<InviteRedemption[]> {
  // 码过滤走查询串
  const suffix = code ? `?code=${encodeURIComponent(code)}` : ''; // 业务步骤
  // 响应包裹 { redemptions }
  const data = await request<{ redemptions: InviteRedemption[] }>(`/admin/invites/redemptions${suffix}`, { credential });
  // 返回数组
  return data.redemptions; // 业务步骤
} // listInviteRedemptions 结束

/** 禁用邀请码：幂等 */
export function disableInvite(credential: Credential, code: string): Promise<{ ok: boolean; code: string }> {
  // PATCH 指定码
  return request<{ ok: boolean; code: string }>(`/admin/invites/${encodeURIComponent(code)}/disable`, {
    method: 'PATCH', // 对象字段 method：记录一项配置或数据
    body: {}, // 对象字段 body：记录一项配置或数据
    credential, // 执行当前业务步骤
  }); // 代码块结束
} // disableInvite 结束

// ── 实名审核 ──────────────────────────────────────────────────────────────

/** 实名脱敏视图：不含证件明文 */
export interface RealnameView { // 业务步骤
  // 记录主键
  id: string;
  // 审核状态 pending / approved / rejected
  status: string;
  // 审核通道
  provider: string;
  // 证件类型
  id_type: string;
  // 脱敏姓名
  name_masked: string;
  // 证件后四位
  id_last4: string;
  // 驳回原因
  reject_reason: string | null;
  // 审核时间
  reviewed_at: string | null;
  // 提交时间
  created_at: string;
} // 业务步骤

/** 待审队列条目：在脱敏视图上补归属用户 */
export interface RealnameQueueItem extends RealnameView { // 业务步骤
  // 归属用户
  user_id: string;
} // 业务步骤

/** 拉取待审实名队列（最多 50 条） */
export async function listRealnameQueue(credential: Credential): Promise<RealnameQueueItem[]> {
  // 响应包裹 { queue }
  const data = await request<{ queue: RealnameQueueItem[] }>('/admin/realname/queue', { credential });
  // 返回队列
  return data.queue; // 业务步骤
} // listRealnameQueue 结束

/** 审核实名：通过 / 驳回，驳回原因必填 */
export function reviewRealname(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  recordId: string, // 对象字段 recordId：记录一项配置或数据
  payload: { decision: 'approve' | 'reject'; reason?: string }, // 对象字段 payload：记录一项配置或数据
): Promise<RealnameView> { // 执行当前业务步骤
  // POST 审核端点
  return request<RealnameView>(`/admin/realname/${encodeURIComponent(recordId)}/review`, {
    method: 'POST', // 对象字段 method：记录一项配置或数据
    body: payload, // 对象字段 body：记录一项配置或数据
    credential, // 执行当前业务步骤
  }); // 代码块结束
} // reviewRealname 结束

// ── 内容运营：公告 / 更新日志 / 推广计划 ──────────────────────────────────

/** 公告管理行（库内完整字段） */
export interface AdminAnnouncement { // 业务步骤
  id: string; // 对象字段 id：记录一项配置或数据
  title: string; // 对象字段 title：记录一项配置或数据
  body: string; // 对象字段 body：记录一项配置或数据
  level: string; // 对象字段 level：记录一项配置或数据
  status: string; // 对象字段 status：记录一项配置或数据
  starts_at: string | null; // 对象字段 starts_at：记录一项配置或数据
  ends_at: string | null; // 对象字段 ends_at：记录一项配置或数据
  pinned: number; // 对象字段 pinned：记录一项配置或数据
  author_id: string | null; // 对象字段 author_id：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  updated_at: string; // 对象字段 updated_at：记录一项配置或数据
} // 业务步骤

/** 更新日志管理行：changes 为 JSON 字符串 */
export interface AdminChangelog { // 业务步骤
  id: string; // 对象字段 id：记录一项配置或数据
  version: string; // 对象字段 version：记录一项配置或数据
  title: string; // 对象字段 title：记录一项配置或数据
  body: string; // 对象字段 body：记录一项配置或数据
  changes: string; // 对象字段 changes：记录一项配置或数据
  published_at: string | null; // 对象字段 published_at：记录一项配置或数据
  status: string; // 对象字段 status：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  updated_at: string; // 对象字段 updated_at：记录一项配置或数据
} // 业务步骤

/** 推广计划管理行：含点击 / 转化统计 */
export interface AdminPromotion { // 业务步骤
  id: string; // 对象字段 id：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  summary: string; // 对象字段 summary：记录一项配置或数据
  target_url: string; // 对象字段 target_url：记录一项配置或数据
  code: string | null; // 对象字段 code：记录一项配置或数据
  starts_at: string | null; // 对象字段 starts_at：记录一项配置或数据
  ends_at: string | null; // 对象字段 ends_at：记录一项配置或数据
  status: string; // 对象字段 status：记录一项配置或数据
  budget_cents: number; // 对象字段 budget_cents：记录一项配置或数据
  click_count: number; // 对象字段 click_count：记录一项配置或数据
  conversion_count: number; // 对象字段 conversion_count：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  updated_at: string; // 对象字段 updated_at：记录一项配置或数据
} // 业务步骤

/** 公告列表 */
export async function listAdminAnnouncements(credential: Credential): Promise<AdminAnnouncement[]> {
  // 响应包裹 { items }
  const data = await request<{ items: AdminAnnouncement[] }>('/admin/content/announcements', { credential });
  // 返回数组
  return data.items; // 业务步骤
} // listAdminAnnouncements 结束

/** 新建公告 */
export async function createAnnouncement(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  payload: { title: string; body?: string; level?: string; status?: string; pinned?: boolean; starts_at?: string | null; ends_at?: string | null }, // 对象字段 payload：记录一项配置或数据
): Promise<AdminAnnouncement> { // 执行当前业务步骤
  // POST 管理端公告，响应包裹 { item }
  const data = await request<{ item: AdminAnnouncement }>('/admin/content/announcements', { method: 'POST', body: payload, credential });
  // 返回新行
  return data.item; // 业务步骤
} // createAnnouncement 结束

/** 更新公告 */
export async function updateAnnouncement(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  id: string, // 对象字段 id：记录一项配置或数据
  payload: Partial<{ title: string; body: string; level: string; status: string; pinned: boolean; starts_at: string | null; ends_at: string | null }>, // 对象字段 payload：记录一项配置或数据
): Promise<AdminAnnouncement> { // 执行当前业务步骤
  // PATCH 指定公告
  const data = await request<{ item: AdminAnnouncement }>(`/admin/content/announcements/${encodeURIComponent(id)}`, {
    method: 'PATCH', // 对象字段 method：记录一项配置或数据
    body: payload, // 对象字段 body：记录一项配置或数据
    credential, // 执行当前业务步骤
  }); // 代码块结束
  // 返回更新行
  return data.item; // 业务步骤
} // updateAnnouncement 结束

/** 删除公告 */
export function deleteAnnouncement(credential: Credential, id: string): Promise<{ ok: boolean }> {
  // DELETE 指定公告
  return request<{ ok: boolean }>(`/admin/content/announcements/${encodeURIComponent(id)}`, { method: 'DELETE', credential });
} // deleteAnnouncement 结束

/** 更新日志列表 */
export async function listAdminChangelog(credential: Credential): Promise<AdminChangelog[]> {
  // 响应包裹 { items }
  const data = await request<{ items: AdminChangelog[] }>('/admin/content/changelog', { credential });
  // 返回数组
  return data.items; // 业务步骤
} // listAdminChangelog 结束

/** 新建更新日志：changes 传字符串数组，落库由后端 JSON 化 */
export async function createChangelog(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  payload: { version: string; title: string; body?: string; changes?: string[]; published_at?: string | null; status?: string }, // 对象字段 payload：记录一项配置或数据
): Promise<AdminChangelog> { // 执行当前业务步骤
  // POST 管理端更新日志
  const data = await request<{ item: AdminChangelog }>('/admin/content/changelog', { method: 'POST', body: payload, credential });
  // 返回新行
  return data.item; // 业务步骤
} // createChangelog 结束

/** 更新更新日志 */
export async function updateChangelog(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  id: string, // 对象字段 id：记录一项配置或数据
  payload: Partial<{ version: string; title: string; body: string; changes: string[]; published_at: string | null; status: string }>, // 对象字段 payload：记录一项配置或数据
): Promise<AdminChangelog> { // 执行当前业务步骤
  // PATCH 指定条目
  const data = await request<{ item: AdminChangelog }>(`/admin/content/changelog/${encodeURIComponent(id)}`, {
    method: 'PATCH', // 对象字段 method：记录一项配置或数据
    body: payload, // 对象字段 body：记录一项配置或数据
    credential, // 执行当前业务步骤
  }); // 代码块结束
  // 返回更新行
  return data.item; // 业务步骤
} // updateChangelog 结束

/** 删除更新日志 */
export function deleteChangelog(credential: Credential, id: string): Promise<{ ok: boolean }> {
  // DELETE 指定条目
  return request<{ ok: boolean }>(`/admin/content/changelog/${encodeURIComponent(id)}`, { method: 'DELETE', credential });
} // deleteChangelog 结束

/** 推广计划列表 */
export async function listAdminPromotions(credential: Credential): Promise<AdminPromotion[]> {
  // 响应包裹 { items }
  const data = await request<{ items: AdminPromotion[] }>('/admin/content/promotions', { credential });
  // 返回数组
  return data.items; // 业务步骤
} // listAdminPromotions 结束

/** 新建推广计划 */
export async function createPromotion(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  payload: { name: string; summary?: string; target_url?: string; code?: string | null; starts_at?: string | null; ends_at?: string | null; status?: string; budget_cents?: number }, // 对象字段 payload：记录一项配置或数据
): Promise<AdminPromotion> { // 执行当前业务步骤
  // POST 管理端推广计划
  const data = await request<{ item: AdminPromotion }>('/admin/content/promotions', { method: 'POST', body: payload, credential });
  // 返回新行
  return data.item; // 业务步骤
} // createPromotion 结束

/** 更新推广计划 */
export async function updatePromotion(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  id: string, // 对象字段 id：记录一项配置或数据
  payload: Partial<{ name: string; summary: string; target_url: string; code: string | null; starts_at: string | null; ends_at: string | null; status: string; budget_cents: number }>, // 对象字段 payload：记录一项配置或数据
): Promise<AdminPromotion> { // 执行当前业务步骤
  // PATCH 指定计划
  const data = await request<{ item: AdminPromotion }>(`/admin/content/promotions/${encodeURIComponent(id)}`, {
    method: 'PATCH', // 对象字段 method：记录一项配置或数据
    body: payload, // 对象字段 body：记录一项配置或数据
    credential, // 执行当前业务步骤
  }); // 代码块结束
  // 返回更新行
  return data.item; // 业务步骤
} // updatePromotion 结束

/** 删除推广计划 */
export function deletePromotion(credential: Credential, id: string): Promise<{ ok: boolean }> {
  // DELETE 指定计划
  return request<{ ok: boolean }>(`/admin/content/promotions/${encodeURIComponent(id)}`, { method: 'DELETE', credential });
} // deletePromotion 结束

// ── 自研工具管理 ──────────────────────────────────────────────────────────

/** 工具版本记录 */
export interface ToolVersionNote { // 业务步骤
  version: string; // 对象字段 version：记录一项配置或数据
  title?: string; // 执行当前业务步骤
  notes?: string; // 执行当前业务步骤
  released_at?: string; // 执行当前业务步骤
} // 业务步骤

/** 工具视图 */
export interface AdminTool { // 业务步骤
  id: string; // 对象字段 id：记录一项配置或数据
  slug: string; // 对象字段 slug：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  summary: string; // 对象字段 summary：记录一项配置或数据
  version_notes: ToolVersionNote[]; // 对象字段 version_notes：记录一项配置或数据
  download_url: string; // 对象字段 download_url：记录一项配置或数据
  doc_url: string; // 对象字段 doc_url：记录一项配置或数据
  tags: string[]; // 对象字段 tags：记录一项配置或数据
  status: string; // 对象字段 status：记录一项配置或数据
  sort_order: number; // 对象字段 sort_order：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  updated_at: string; // 对象字段 updated_at：记录一项配置或数据
} // 业务步骤

/** 工具管理清单：含草稿 / 归档 */
export async function listToolsManage(credential: Credential): Promise<AdminTool[]> {
  // 响应包裹 { items }
  const data = await request<{ items: AdminTool[] }>('/tools/manage', { credential });
  // 返回数组
  return data.items; // 业务步骤
} // listToolsManage 结束

/** 新建工具 */
export async function createTool(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  payload: { slug: string; name: string; summary?: string; version_notes?: ToolVersionNote[]; download_url?: string; doc_url?: string; tags?: string[]; status?: string; sort_order?: number }, // 对象字段 payload：记录一项配置或数据
): Promise<AdminTool> { // 执行当前业务步骤
  // POST 工具端点，响应 { ok, tool }
  const data = await request<{ ok: boolean; tool: AdminTool }>('/tools', { method: 'POST', body: payload, credential });
  // 返回工具
  return data.tool; // 业务步骤
} // createTool 结束

/** 更新工具：slug 不可改 */
export async function updateTool(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  slug: string, // 对象字段 slug：记录一项配置或数据
  payload: Partial<{ name: string; summary: string; version_notes: ToolVersionNote[]; download_url: string; doc_url: string; tags: string[]; status: string; sort_order: number }>, // 对象字段 payload：记录一项配置或数据
): Promise<AdminTool> { // 执行当前业务步骤
  // PUT 指定 slug
  const data = await request<{ ok: boolean; tool: AdminTool }>(`/tools/${encodeURIComponent(slug)}`, {
    method: 'PUT', // 对象字段 method：记录一项配置或数据
    body: payload, // 对象字段 body：记录一项配置或数据
    credential, // 执行当前业务步骤
  }); // 代码块结束
  // 返回工具
  return data.tool; // 业务步骤
} // updateTool 结束

/** 删除工具 */
export function deleteTool(credential: Credential, slug: string): Promise<{ ok: boolean }> {
  // DELETE 指定 slug
  return request<{ ok: boolean }>(`/tools/${encodeURIComponent(slug)}`, { method: 'DELETE', credential });
} // deleteTool 结束

// ── 社区运营：待审板块 / 论坛首页 / 审核开关 ────────────────────────────────

/** 待审板块行 */
export interface PendingBoard { // 业务步骤
  id: string; // 对象字段 id：记录一项配置或数据
  slug: string; // 对象字段 slug：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  description: string; // 对象字段 description：记录一项配置或数据
  icon: string | null; // 对象字段 icon：记录一项配置或数据
  price_cents: number; // 对象字段 price_cents：记录一项配置或数据
  visibility: string; // 对象字段 visibility：记录一项配置或数据
  status: string; // 对象字段 status：记录一项配置或数据
  created_by: string | null; // 对象字段 created_by：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  creator_name: string | null; // 对象字段 creator_name：记录一项配置或数据
} // 业务步骤

/** 待审板块队列 */
export async function listPendingBoards(credential: Credential): Promise<PendingBoard[]> {
  // 响应包裹 { boards }
  const data = await request<{ boards: PendingBoard[] }>('/community/boards/pending', { credential });
  // 返回数组
  return data.boards; // 业务步骤
} // listPendingBoards 结束

/** 审核通过板块 */
export function approveBoard(credential: Credential, slug: string): Promise<{ ok: boolean }> {
  // POST 通过端点
  return request<{ ok: boolean }>(`/community/boards/${encodeURIComponent(slug)}/approve`, { method: 'POST', body: {}, credential });
} // approveBoard 结束

/** 驳回板块：原因写入 review_note，可留空 */
export function rejectBoard(credential: Credential, slug: string, reason: string): Promise<{ ok: boolean }> {
  // POST 驳回端点，请求字段为 note
  return request<{ ok: boolean }>(`/community/boards/${encodeURIComponent(slug)}/reject`, { method: 'POST', body: { note: reason }, credential });
} // rejectBoard 结束

/** 读取论坛首页设置 */
export async function getCommunityHome(credential: Credential): Promise<'community' | 'portal'> {
  // 响应包裹 { home }
  const data = await request<{ home: 'community' | 'portal' }>('/community/home-setting', { credential });
  // 返回设置值
  return data.home; // 业务步骤
} // getCommunityHome 结束

/** 写入论坛首页设置 */
export function setCommunityHome(credential: Credential, home: 'community' | 'portal'): Promise<{ home: string }> {
  // PUT 设置端点
  return request<{ home: string }>('/community/home-setting', { method: 'PUT', body: { home }, credential });
} // setCommunityHome 结束

/** 读取建板块审核开关 */
export async function getCommunityReview(credential: Credential): Promise<boolean> {
  // 响应包裹 { review_enabled }
  const data = await request<{ review_enabled: boolean }>('/community/review-setting', { credential });
  // 返回开关
  return data.review_enabled; // 业务步骤
} // getCommunityReview 结束

/** 写入建板块审核开关：请求字段为 enabled */
export async function setCommunityReview(credential: Credential, required: boolean): Promise<boolean> {
  // PUT 开关端点
  const data = await request<{ review_enabled: boolean }>('/community/review-setting', { method: 'PUT', body: { enabled: required }, credential });
  // 返回后端归一后的开关
  return data.review_enabled; // 业务步骤
} // setCommunityReview 结束

/** 推荐指数权重：各因子权重 + 时间半衰期 */
export interface RecommendWeights { // 业务步骤
  views: number; // 对象字段 views：记录一项配置或数据
  replies: number; // 对象字段 replies：记录一项配置或数据
  favorites: number; // 对象字段 favorites：记录一项配置或数据
  rating: number; // 对象字段 rating：记录一项配置或数据
  halfLifeDays: number; // 对象字段 halfLifeDays：记录一项配置或数据
} // 业务步骤

/** 读取推荐指数权重与默认值 */
export function getRecommendWeights(credential: Credential): Promise<{ weights: RecommendWeights; defaults: RecommendWeights }> {
  // GET 公开读端点，带凭证也允许
  return request<{ weights: RecommendWeights; defaults: RecommendWeights }>('/community/recommend-weights', { credential });
} // getRecommendWeights 结束

/** 写入推荐指数权重：只传需要调整的因子 */
export async function setRecommendWeights(credential: Credential, weights: Partial<RecommendWeights>): Promise<RecommendWeights> {
  // PUT 权重端点
  const data = await request<{ weights: RecommendWeights }>('/community/recommend-weights', { method: 'PUT', body: weights, credential });
  // 返回合并后的权重
  return data.weights; // 业务步骤
} // setRecommendWeights 结束

/** 板块 Tab 配置项 */
export interface BoardTab { // 业务步骤
  key: string; // 对象字段 key：记录一项配置或数据
  label?: string; // 执行当前业务步骤
  visible?: boolean; // 执行当前业务步骤
  sort_order?: number; // 执行当前业务步骤
  sort_by?: string; // 执行当前业务步骤
} // 业务步骤

/** 读取指定板块的 Tab 配置 */
export async function getBoardTabs(credential: Credential, slug: string): Promise<BoardTab[]> {
  // 响应包裹 { tabs }
  const data = await request<{ tabs: BoardTab[] }>(`/community/boards/${encodeURIComponent(slug)}/tabs`, { credential });
  // 返回配置
  return data.tabs; // 业务步骤
} // getBoardTabs 结束

/** 保存指定板块的 Tab 配置：全量覆盖 */
export async function saveBoardTabs(credential: Credential, slug: string, tabs: BoardTab[]): Promise<BoardTab[]> {
  // PUT 全量配置
  const data = await request<{ tabs: BoardTab[] }>(`/community/boards/${encodeURIComponent(slug)}/tabs`, { method: 'PUT', body: { tabs }, credential });
  // 返回落库后的配置
  return data.tabs; // 业务步骤
} // saveBoardTabs 结束
