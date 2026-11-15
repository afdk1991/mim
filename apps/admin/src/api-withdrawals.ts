// 后台提现审核 API：申请队列、通过 / 驳回 / 标记到账、创作分成结算
import { request } from './api'; // 统一请求出口（自动注入凭证与幂等键）
import type { Credential } from './api'; // 后台凭证类型

/** 提现申请状态 */
export type AdminWithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';

/** 队列行：在用户侧字段基础上带出申请人信息 */
export interface AdminWithdrawalRow {
  id: string; // 申请主键
  user_id: string; // 申请人
  display_name: string; // 申请人昵称
  member_no: string | null; // Mim ID
  amount_cents: number; // 金额（整数分）
  status: AdminWithdrawalStatus; // 状态
  method: 'alipay' | 'wechat' | 'bank'; // 收款方式
  account_name: string; // 收款人
  account_no: string; // 收款账号
  review_note: string; // 审核备注 / 驳回原因
  reviewer: string | null; // 审核人
  payout_ref: string | null; // 打款凭证号
  created_at: string; // 申请时间
  reviewed_at: string | null; // 审核时间
  paid_at: string | null; // 到账时间
}

/** 各状态计数 */
export interface WithdrawalSummary {
  pending: number;
  approved: number;
  rejected: number;
  paid: number;
  cancelled: number;
}

/** 队列响应 */
export interface WithdrawalQueue {
  items: AdminWithdrawalRow[];
  summary: WithdrawalSummary;
}

/** 拉取申请队列；status 为空表示全部 */
export function listAdminWithdrawals(credential: Credential, status?: AdminWithdrawalStatus | ''): Promise<WithdrawalQueue> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : ''; // 空状态不拼查询串
  return request<WithdrawalQueue>(`/admin/withdrawals${suffix}`, { credential });
}

/** 审核通过：内部同步扣减余额与可提现余额并落提现流水（只扣一次） */
export function approveWithdrawal(credential: Credential, id: string, note = ''): Promise<{ request: AdminWithdrawalRow }> {
  return request<{ request: AdminWithdrawalRow }>(`/admin/withdrawals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: { note },
    credential,
  });
}

/** 驳回：未扣款的直接关闭；已扣款的原路退回余额与可提现余额 */
export function rejectWithdrawal(credential: Credential, id: string, reason: string): Promise<{ request: AdminWithdrawalRow }> {
  return request<{ request: AdminWithdrawalRow }>(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: { reason },
    credential,
  });
}

/** 线下打款后标记到账：只记录凭证号，不再动账 */
export function markWithdrawalPaid(credential: Credential, id: string, payoutRef: string): Promise<{ request: AdminWithdrawalRow }> {
  return request<{ request: AdminWithdrawalRow }>(`/admin/withdrawals/${encodeURIComponent(id)}/paid`, {
    method: 'POST',
    body: { payout_ref: payoutRef },
    credential,
  });
}

/** 批量结算已过保护期的创作分成：净额并入可提现余额 */
export function settleCreatorEarnings(credential: Credential): Promise<{ ok: boolean; settled: number; total_cents: number }> {
  return request<{ ok: boolean; settled: number; total_cents: number }>('/admin/earnings/settle', {
    method: 'POST',
    body: {},
    credential,
  });
}
