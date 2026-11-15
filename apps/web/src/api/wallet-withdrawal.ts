/**
 * 提现（钱包结算层）的 Web 端只读契约与写操作封装。
 *
 * 独立成文件的原因：提现属于钱包结算域新增能力，不改动既有 endpoints.ts / types.ts，
 * 避免与其它工作线的共享文件产生冲突；全部金额字段均为整数分。
 */

import { request } from './request.js'; // 统一请求出口：自动带鉴权、幂等键与错误信封

/** 提现收款方式 */
export type WithdrawMethod = 'alipay' | 'wechat' | 'bank';

/** 提现申请状态：待审 → 通过 → 到账；待审/通过可被驳回，待审可由用户撤销 */
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';

/** 单笔提现申请（用户视角） */
export interface WithdrawalRequest {
  id: string; // 申请主键
  amount_cents: number; // 提现金额（整数分）
  status: WithdrawalStatus; // 当前状态
  method: WithdrawMethod; // 收款方式
  account_name: string; // 收款人
  account_no: string; // 收款账号
  review_note: string; // 审核备注 / 驳回原因
  payout_ref: string | null; // 打款凭证号
  created_at: string; // 申请时间
  reviewed_at: string | null; // 审核时间
  paid_at: string | null; // 到账时间
}

/** 可提现总览：三个数值口径分开展示，避免用户把充值余额当成可提现 */
export interface WithdrawalOverview {
  balance_cents: number; // 钱包可用余额（含充值余额与分成收益）
  withdrawable_cents: number; // 可提现余额（仅佣金 / 创作分成累积，且不超过余额）
  reserved_cents: number; // 处理中申请冻结的额度
  available_cents: number; // 当前真正可申请提现的额度
  min_withdraw_cents: number; // 单笔最低提现额
  methods: Array<{ value: WithdrawMethod; label: string }>; // 支持的收款方式
  items: WithdrawalRequest[]; // 最近申请记录
}

/** 读取可提现总览与申请记录 */
export function getWithdrawalOverview(): Promise<WithdrawalOverview> {
  return request<WithdrawalOverview>('/wallet/withdrawals'); // 只读接口，无需幂等键
}

/** 提交提现申请；金额必须是整数分 */
export function createWithdrawal(input: {
  amount_cents: number;
  method: WithdrawMethod;
  account_name: string;
  account_no: string;
}): Promise<{ request: WithdrawalRequest }> {
  return request<{ request: WithdrawalRequest }>('/wallet/withdrawals', { method: 'POST', body: input });
}

/** 撤销本人待审申请，释放冻结额度 */
export function cancelWithdrawal(id: string): Promise<{ request: WithdrawalRequest }> {
  return request<{ request: WithdrawalRequest }>(`/wallet/withdrawals/${id}/cancel`, { method: 'POST', body: {} });
}
