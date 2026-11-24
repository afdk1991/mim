// 后台账号注销 / 数据清理 API：待删除队列、清理策略、最近执行留痕与手动触发一轮清理。
// 与后端 routes/privacy-admin.ts 一一对应；读队列走 user:read，手动清理走 privacy:write。

import { request } from './api'; // 统一请求出口（自动注入凭证与幂等键）
import type { Credential } from './api'; // 后台凭证类型

/** 待删除队列行：对齐 GET /admin/deletions 的 items 元素 */
export interface DeletionQueueItem {
  user_id: string; // 用户主键（内部 uuid，仅后台展示）
  member_no: string; // 对外 Mim ID（纯数字号段）
  display_name: string; // 展示昵称
  region: string; // 所属区域 cn / global
  status: string; // 账号状态机取值（pending_deletion 等）
  deletion_scheduled_at: string; // 预约删除时刻（ISO8601）
  remaining_seconds: number; // 距到期剩余秒数；已到期为 0 或负值口径由后端保证
  overdue: boolean; // 是否已逾期（预约时刻不晚于当前时刻）
} // DeletionQueueItem 结束

/** 清理策略：冷静期天数 / 扫描间隔 / 单批大小 / 自动清理开关 */
export interface DeletionPolicy {
  auto_purge_enabled: boolean; // 调度器是否自动扫描清理
  grace_days: number; // 注销冷静期天数
  sweep_minutes: number; // 周期扫描间隔（分钟）
  batch_size: number; // 单轮清理最多处理账号数
} // DeletionPolicy 结束

/** 最近一次执行留痕：无记录时 at 为 null */
export interface DeletionLastRun {
  at: string | null; // 执行完成时刻（ISO8601）；从未执行为 null
  purged: number; // 本轮物理回收账号数
  source: 'startup' | 'interval' | 'manual'; // 触发来源：启动 / 周期调度 / 手动
} // DeletionLastRun 结束

/** 队列总览响应：列表 + 策略 + 最近执行 */
export interface DeletionQueuePayload {
  total: number; // 待删除账号总数
  items: DeletionQueueItem[]; // 当前队列行
  policy: DeletionPolicy; // 当前生效清理策略
  last_run: DeletionLastRun | null; // 最近一次执行留痕；无记录为 null
} // DeletionQueuePayload 结束

/** 手动触发一轮清理的响应：回收 / 扫描条数 + 执行时刻 + 审计 ID */
export interface PurgeRunResult {
  purged: number; // 本轮物理回收账号数
  scanned: number; // 本轮扫描命中账号数
  at: string; // 执行完成时刻（ISO8601）
  audit_id: string; // 本轮审计记录主键，便于回查审计流水
} // PurgeRunResult 结束

/** 拉取待删除队列与清理策略；GET 只读，无需幂等键 */
export function listDeletions(credential: Credential): Promise<DeletionQueuePayload> {
  return request<DeletionQueuePayload>('/admin/deletions', { credential }); // 携带后台凭证
} // listDeletions 结束

/** 立即执行一轮到期清理；POST 写操作，服务端按事务逐账号删除并写审计 */
export function runDeletionPurge(credential: Credential): Promise<PurgeRunResult> {
  return request<PurgeRunResult>('/admin/deletions/run', { method: 'POST', body: {}, credential }); // 显式空体，与既有写接口口径一致
} // runDeletionPurge 结束
