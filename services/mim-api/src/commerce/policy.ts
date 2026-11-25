/**
 * 交易透明化：退款政策口径与优惠码核验纯函数（2026-11-25 批次）。
 *
 * 为什么集中成一个模块：退款时限 / 服务费 / 退款路径 / 争议入口此前散落在路由文案里，
 * 接口、前端合规页与测试三处各写一份必然漂移。本文件是后端唯一口径来源，
 * 前端按同一数值与条目镜像展示（Legal.tsx 退款篇），不另起一套规则。
 *
 * 借鉴来源（口径对齐，不复制其条款文本）：
 *   - Stripe 定价页：附加费 / 折扣逐项列示，金额拆解前置到结账前（https://stripe.com/pricing ）
 *   - PayPal：买卖双方保障口径与结账信息最小化，退款路径与争议入口公开可查（https://www.paypal.com/business ）
 *   - 有赞：公开交易规则与合规入口，退款售后按品类分档说明（https://www.youzan.com/ ）
 *
 * 边界：本模块只做常量与纯计算，不读库、不发请求；文案面向中文界面，英文镜像后续补词典。
 */

import type { Db } from '../types.js'; // 数据库类型：仅在需要回源取数的辅助函数里使用

/** 订单状态机取值：与 shop_orders / 统一 orders 表的 CHECK 约束保持一致 */
export type OrderStatus = 'pending' | 'paid' | 'delivered' | 'refunded' | 'cancelled';

/** 订单状态对外展示顺序：待支付 → 已支付 → 已交付 → 已退款 / 已取消 */
export const ORDER_STATUS_FLOW: readonly OrderStatus[] = [
  'pending', // 待支付：已下单未完成付款
  'paid', // 已支付：款项到账，等待交付
  'delivered', // 已交付 / 已发货：权益发放或实物寄出
  'refunded', // 已退款：款项退回余额
  'cancelled', // 已取消：订单关闭
];

/** 退款政策默认口径（项目负责人 2026-11-25 拍定，接口与前端共用） */
export const REFUND_POLICY = {
  effective_date: '2026-11-25', // 政策生效日期，合规页与接口回显一致
  virtual_window_days: 7, // 虚拟商品（卡密 / 内容）可退窗口：7 天内未使用
  physical_window_days: 7, // 实物商品可退窗口：7 天无理由（不影响二次销售）
  refund_destination: 'balance', // 退款路径：一律退回平台余额，不走原支付通道
  platform_service_fee_cents: 0, // 平台服务费：0（分），退款不另扣服务费
  accept_deadline_workdays: 3, // 退款受理时限：3 个工作日内答复
  dispute_channel: '申诉通道', // 争议处理入口：订单售后申请 / 社区反馈
  legal_review_note: '涉及法定责任与消费者权益的表述需法务复核', // 保留占位：法务复核前不构成法律承诺
} as const;

/** 退款政策条目（结构化）：前端合规页逐条渲染，接口需要时可原样下发 */
export interface RefundPolicyItem {
  category: 'virtual' | 'physical' | 'destination' | 'fee' | 'deadline' | 'dispute'; // 条目分类
  title: string; // 条目标题
  body: string; // 条目正文
}

/** 退款政策正式条目：与 REFUND_POLICY 常量一一对应，避免文案与数值脱节 */
export const REFUND_POLICY_ITEMS: RefundPolicyItem[] = [
  {
    category: 'virtual',
    title: '虚拟商品',
    body: '卡密、付费内容等虚拟商品，自购买之日起 7 天内且未使用（卡密未兑换、内容权益未消耗）可申请退款。',
  },
  {
    category: 'physical',
    title: '实物商品',
    body: '实物商品支持 7 天无理由退货，退货商品应保持完好、不影响二次销售；已使用 / 损坏 / 定制影响转售的商品不在无理由退款范围内。',
  },
  {
    category: 'destination',
    title: '退款路径',
    body: '退款一律退回平台账户余额，可在站内继续消费或按提现规则申请提现；不退回到原支付渠道。',
  },
  {
    category: 'fee',
    title: '平台服务费',
    body: '平台服务费为 0，退款不向用户扣除任何服务费或手续费。',
  },
  {
    category: 'deadline',
    title: '受理时限',
    body: '退款申请提交后，平台在 3 个工作日内受理并答复；审核通过后退款计入余额。',
  },
  {
    category: 'dispute',
    title: '争议处理',
    body: '对退款结果有异议时，可通过订单售后申诉通道或社区反馈入口提交材料，平台按争议流程复核处理。',
  },
];

/** 优惠码类型：fixed 固定立减（value 单位分）/ percent 百分比折扣（value 为 1–100） */
export type CouponKind = 'fixed' | 'percent';

/** 优惠码核验入参形状：与 coupons 表字段对齐，不依赖具体查询层 */
export interface CouponPolicyRow {
  id: string; // 优惠码主键
  code: string; // 优惠码明文（入库大写）
  kind: CouponKind; // 立减 / 折扣
  value: number; // 面值：fixed 为分，percent 为百分比
  min_amount_cents: number; // 最低消费门槛（分）
  max_uses: number; // 总可用次数；0 表示不限次数
  used_count: number; // 已核销次数
  active: number; // 是否启用：1 启用 / 0 停用
  starts_at: string | null; // 生效开始时间（ISO），null 表示即刻生效
  expires_at: string | null; // 过期时间（ISO），null 表示长期有效
}

/** 优惠码失效原因：null 表示当前可用；前端按码展示可读文案 */
export type CouponInvalidReason =
  | 'inactive' // 已停用
  | 'not_started' // 尚未生效
  | 'expired' // 已过期
  | 'exhausted' // 总次数用完
  | 'already_used' // 本人已使用过（限单次场景）
  | 'min_amount' // 未达最低消费门槛
  | null; // 可用

/** 优惠码核验结果：valid 为是否可用于当前订单；discount_cents 为预估实减（分） */
export interface CouponEvaluation {
  valid: boolean; // 是否核验通过
  invalid_reason: CouponInvalidReason; // 失效原因，可用时为 null
  discount_cents: number; // 预估优惠金额（分），不可用时为 0
}

/**
 * 按券型与订单金额计算优惠金额（纯函数）：
 * fixed 立减不超过订单金额；percent 折扣四舍五入到分，同样不超过订单金额。
 */
export function previewCouponDiscount(kind: CouponKind, value: number, amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0; // 0 元单不产生优惠
  if (kind === 'fixed') return Math.min(Math.max(value, 0), amountCents); // 立减封顶为订单金额
  return Math.min(Math.round((amountCents * Math.max(value, 0)) / 100), amountCents); // 折扣封顶为订单金额
}

/**
 * 核验一张优惠码对当前用户 / 当前订单是否可用（纯函数）。
 * 校验顺序：停用 → 未生效 → 已过期 → 次数用完 → 本人已用 → 未达门槛；
 * 任一环节不通过即返回对应失效原因，不再继续计算优惠。
 */
export function evaluateCoupon(
  coupon: CouponPolicyRow, // 待核验优惠码
  amountCents: number | null, // 当前订单金额（分）；无购物车上下文时传 null，跳过门槛判定
  opts: { redeemedByMe: boolean; nowIso?: string }, // redeemedByMe：本人是否已核销过；nowIso：可注入固定时间便于测试
): CouponEvaluation {
  const now = opts.nowIso ?? new Date().toISOString(); // 缺省取当前时刻
  if (!coupon.active) return { valid: false, invalid_reason: 'inactive', discount_cents: 0 }; // 停用券不展示优惠
  if (coupon.starts_at && coupon.starts_at > now) return { valid: false, invalid_reason: 'not_started', discount_cents: 0 }; // 未到生效时间
  if (coupon.expires_at && coupon.expires_at < now) return { valid: false, invalid_reason: 'expired', discount_cents: 0 }; // 已过有效期
  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) return { valid: false, invalid_reason: 'exhausted', discount_cents: 0 }; // 总次数耗尽
  if (opts.redeemedByMe) return { valid: false, invalid_reason: 'already_used', discount_cents: 0 }; // 本人已用，不重复享受
  if (amountCents !== null && amountCents < coupon.min_amount_cents) {
    return { valid: false, invalid_reason: 'min_amount', discount_cents: 0 }; // 未达最低消费
  }
  const discount_cents = previewCouponDiscount(coupon.kind, coupon.value, amountCents ?? 0); // 预估实减
  return { valid: true, invalid_reason: null, discount_cents }; // 核验通过
}

/** 时间线节点：node 为状态机取值，at 为节点到达时间，缺时间戳时为 null（不编造时刻） */
export interface OrderTimelineNode {
  node: OrderStatus; // 订单状态节点
  at: string | null; // 到达时间（ISO），未到达 / 无记录时为 null
}

/**
 * 组装订单状态时间线：按固定顺序输出五个节点，有时间戳的填时刻，
 * 缺失的节点统一标 null；前端据此渲染进度与「未到达」状态。
 */
export function buildStatusTimeline(
  order: { created_at: string; paid_at: string | null; delivered_at: string | null; refunded_at: string | null; cancelled_at: string | null },
): OrderTimelineNode[] {
  return [
    { node: 'pending', at: order.created_at }, // 下单即进入待支付
    { node: 'paid', at: order.paid_at }, // 支付完成时刻
    { node: 'delivered', at: order.delivered_at }, // 交付 / 发货时刻
    { node: 'refunded', at: order.refunded_at }, // 退款到账时刻（可能无记录）
    { node: 'cancelled', at: order.cancelled_at }, // 取消时刻（可能无记录）
  ];
}

/** 退款记录条目：统一 shop_orders 退款与扩展渠道退款两种来源的回显形状 */
export interface OrderRefundRecord {
  amount_cents: number; // 退款金额（分）
  status: string; // 退款状态：processed / refunded / pending 等
  created_at: string | null; // 退款发生时间，无记录时为 null
  source: 'shop_order' | 'ext_refund'; // 来源：商城订单 / 扩展渠道退款表
  reason: string | null; // 退款原因（渠道回调或售后备注）
}

/** 供路由层复用的数据库句柄类型，避免每个文件重复引 types.js */
export type PolicyDb = Db;
