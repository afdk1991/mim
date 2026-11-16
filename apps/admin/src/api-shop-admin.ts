// 独立商城后台写入面 API：商品 / 优惠码 / 充值卡密 / VIP 套餐四类 CRUD
// 与后端 services/mim-api/src/routes/shop-admin.ts 的路由字符串逐一对齐
import type { Credential } from './api'; // 凭证类型
import { request } from './api'; // 统一请求层（含凭证注入与错误信封解析）

// ── 商品 ────────────────────────────────────────────────────────────────────

/** 商品发货方式，与后端 CHECK 约束一致 */
export type ProductKind = 'physical' | 'virtual_auto' | 'virtual_manual';

/** 商品上架位：active 在售，off 下架 */
export type ProductStatus = 'active' | 'off';

/** 商品视图：与后端 productView 字段逐一对齐 */
export interface AdminProduct {
  // 商品主键
  id: string;
  // 商品编码，唯一，下单按 code 定位
  code: string;
  // 商品名
  name: string;
  // 简介
  summary: string;
  // 发货方式
  kind: ProductKind;
  // 售价（分）
  price_cents: number;
  // 封面图地址，可空
  cover_url: string | null;
  // 登记库存
  stock: number;
  // 可售数量（自动发货取未用卡密数）
  available: number;
  // 卡密库存总数
  key_count: number;
  // 发货说明
  delivery_note: string;
  // 上架位
  status: ProductStatus;
  // 展示排序权重
  sort_order: number;
  // 创建时间
  created_at: string;
} // AdminProduct 结束

/** 新建商品入参 */
export interface ProductPayload {
  // 商品编码，小写字母 / 数字开头，可含连字符与下划线
  code: string;
  // 商品名
  name: string;
  // 简介，选填
  summary?: string;
  // 发货方式
  kind: ProductKind;
  // 售价（分）
  price_cents: number;
  // 封面图地址，选填
  cover_url?: string | null;
  // 实物 / 人工发货库存
  stock?: number;
  // 发货说明，选填
  delivery_note?: string;
  // 上架位，默认在售
  status?: ProductStatus;
  // 排序权重，选填
  sort_order?: number;
  // 自动发货卡密批次（仅 virtual_auto 允许）
  card_keys?: string[];
} // ProductPayload 结束

/** 商品全量列表（含下架） */
export async function listAdminProducts(credential: Credential): Promise<AdminProduct[]> {
  const data = await request<{ products: AdminProduct[] }>('/admin/shop/products', { credential });
  return data.products;
} // listAdminProducts 结束

/** 新建商品：成功返回 201 与完整视图 */
export async function createAdminProduct(credential: Credential, payload: ProductPayload): Promise<AdminProduct> {
  const data = await request<{ product: AdminProduct }>('/admin/shop/products', { method: 'POST', body: payload, credential });
  return data.product;
} // createAdminProduct 结束

/** 局部更新商品：编码不可改，可追加卡密批次 */
export async function updateAdminProduct(
  credential: Credential,
  code: string,
  payload: Partial<Omit<ProductPayload, 'code' | 'card_keys'>> & { card_keys?: string[] },
): Promise<AdminProduct> {
  const data = await request<{ product: AdminProduct }>(`/admin/shop/products/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: payload,
    credential,
  });
  return data.product;
} // updateAdminProduct 结束

/** 删除商品：已有订单引用时后端返回 409 */
export function deleteAdminProduct(credential: Credential, code: string): Promise<{ code: string; deleted: boolean }> {
  return request(`/admin/shop/products/${encodeURIComponent(code)}`, { method: 'DELETE', credential });
} // deleteAdminProduct 结束

// ── 优惠码 ──────────────────────────────────────────────────────────────────

/** 优惠码类型：fixed 固定立减 / percent 百分比折扣 */
export type CouponKind = 'fixed' | 'percent';

/** 优惠码视图：与后端 couponView 字段逐一对齐 */
export interface AdminCoupon {
  // 优惠码主键
  id: string;
  // 优惠码，入库统一大写
  code: string;
  // 类型
  kind: CouponKind;
  // fixed 为立减金额（分）；percent 为 1-100
  value: number;
  // 最低可用订单金额（分）
  min_amount_cents: number;
  // 最大核销次数，0 表示不限
  max_uses: number;
  // 已核销次数
  used_count: number;
  // 启停
  active: boolean;
  // 生效起始时间，null 表示立即生效
  starts_at: string | null;
  // 过期时间，null 表示长期有效
  expires_at: string | null;
} // AdminCoupon 结束

/** 新建优惠码入参 */
export interface CouponPayload {
  // 优惠码，大写字母 / 数字开头，可含连字符
  code: string;
  // 类型
  kind: CouponKind;
  // fixed 为立减金额（分）；percent 为 1-100
  value: number;
  // 最低可用金额（分），选填
  min_amount_cents?: number;
  // 最大核销次数，0 不限，选填
  max_uses?: number;
  // 启停，默认启用
  active?: boolean;
  // 生效起始（ISO 或日期串），选填
  starts_at?: string | null;
  // 过期时间，选填
  expires_at?: string | null;
} // CouponPayload 结束

/** 优惠码全量列表（含停用与已用完） */
export async function listAdminCoupons(credential: Credential): Promise<AdminCoupon[]> {
  const data = await request<{ coupons: AdminCoupon[] }>('/admin/coupons', { credential });
  return data.coupons;
} // listAdminCoupons 结束

/** 新建优惠码：成功返回 201 与完整视图 */
export async function createAdminCoupon(credential: Credential, payload: CouponPayload): Promise<AdminCoupon> {
  const data = await request<{ coupon: AdminCoupon }>('/admin/coupons', { method: 'POST', body: payload, credential });
  return data.coupon;
} // createAdminCoupon 结束

/** 局部更新优惠码（面值 / 门槛 / 次数 / 启停 / 有效期） */
export async function updateAdminCoupon(
  credential: Credential,
  code: string,
  payload: Partial<Omit<CouponPayload, 'code' | 'kind'>>,
): Promise<AdminCoupon> {
  const data = await request<{ coupon: AdminCoupon }>(`/admin/coupons/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: payload,
    credential,
  });
  return data.coupon;
} // updateAdminCoupon 结束

/** 删除优惠码：已被核销引用时后端返回 409 */
export function deleteAdminCoupon(credential: Credential, code: string): Promise<{ code: string; deleted: boolean }> {
  return request(`/admin/coupons/${encodeURIComponent(code)}`, { method: 'DELETE', credential });
} // deleteAdminCoupon 结束

// ── 充值卡密 ────────────────────────────────────────────────────────────────

/** 充值卡密视图：与后端 cardView 字段逐一对齐 */
export interface AdminCard {
  // 卡密主键
  id: string;
  // 卡密码，唯一
  code: string;
  // 面额（分）
  amount_cents: number;
  // 兑换状态
  status: 'unused' | 'used';
  // 兑换用户 ID
  used_by: string | null;
  // 兑换时间
  used_at: string | null;
  // 是否已作废
  voided: boolean;
  // 作废时间
  voided_at: string | null;
  // 生成时间
  created_at: string;
} // AdminCard 结束

/** 卡密用量统计 */
export interface CardStats {
  // 总数
  total: number;
  // 未使用且未作废
  unused: number;
  // 已兑换
  used: number;
  // 已作废
  voided: number;
} // CardStats 结束

/** 卡密列表 + 统计响应 */
export interface CardListResult {
  // 最近 500 张
  cards: AdminCard[];
  // 用量统计
  stats: CardStats;
} // CardListResult 结束

/** 批量生成卡密：返回本批生成的全部码 */
export async function createAdminCardBatch(
  credential: Credential,
  payload: { amount_cents: number; count: number },
): Promise<{ cards: AdminCard[]; count: number }> {
  return request<{ cards: AdminCard[]; count: number }>('/admin/cards/batch', { method: 'POST', body: payload, credential });
} // createAdminCardBatch 结束

/** 卡密列表与用量统计 */
export async function listAdminCards(credential: Credential): Promise<CardListResult> {
  return request<CardListResult>('/admin/cards', { credential });
} // listAdminCards 结束

/** 作废未使用卡密；已兑换不可作废，重复作废幂等 200 */
export async function voidAdminCard(credential: Credential, code: string): Promise<AdminCard> {
  const data = await request<{ card: AdminCard }>(`/admin/cards/${encodeURIComponent(code)}/void`, { method: 'POST', body: {}, credential });
  return data.card;
} // voidAdminCard 结束

// ── VIP 套餐 ────────────────────────────────────────────────────────────────

/** VIP 套餐视图：与后端 planView 字段逐一对齐 */
export interface AdminVipPlan {
  // 套餐主键
  id: string;
  // 套餐编码，唯一
  code: string;
  // 套餐名
  name: string;
  // 会员等级 1-10
  level: number;
  // 售价（分）
  price_cents: number;
  // 有效期天数
  duration_days: number;
  // 权益清单
  perks: string[];
  // 展示排序权重
  sort_order: number;
  // 启停
  active: boolean;
} // AdminVipPlan 结束

/** 新建套餐入参 */
export interface PlanPayload {
  // 套餐编码，小写字母 / 数字开头
  code: string;
  // 套餐名
  name: string;
  // 会员等级 1-10
  level: number;
  // 售价（分）
  price_cents: number;
  // 有效期天数
  duration_days: number;
  // 权益清单，选填
  perks?: string[];
  // 排序权重，选填
  sort_order?: number;
  // 启停，默认启用
  active?: boolean;
} // PlanPayload 结束

/** 套餐全量列表（含停用） */
export async function listAdminVipPlans(credential: Credential): Promise<AdminVipPlan[]> {
  const data = await request<{ plans: AdminVipPlan[] }>('/admin/vip/plans', { credential });
  return data.plans;
} // listAdminVipPlans 结束

/** 新建套餐：成功返回 201 与完整视图 */
export async function createAdminVipPlan(credential: Credential, payload: PlanPayload): Promise<AdminVipPlan> {
  const data = await request<{ plan: AdminVipPlan }>('/admin/vip/plans', { method: 'POST', body: payload, credential });
  return data.plan;
} // createAdminVipPlan 结束

/** 局部更新套餐；编码不可改 */
export async function updateAdminVipPlan(
  credential: Credential,
  code: string,
  payload: Partial<Omit<PlanPayload, 'code'>>,
): Promise<AdminVipPlan> {
  const data = await request<{ plan: AdminVipPlan }>(`/admin/vip/plans/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: payload,
    credential,
  });
  return data.plan;
} // updateAdminVipPlan 结束

/** 删除套餐：仍有会员归属时后端返回 409 */
export function deleteAdminVipPlan(credential: Credential, code: string): Promise<{ code: string; deleted: boolean }> {
  return request(`/admin/vip/plans/${encodeURIComponent(code)}`, { method: 'DELETE', credential });
} // deleteAdminVipPlan 结束

// ── 发货与售后 ──────────────────────────────────────────────────────────────

/** 发货筛选口径：待发货 / 已发货 / 已签收 / 待支付 / 已退款；all 由后端按全部处理 */
export type ShipmentFilter = 'to_ship' | 'shipped' | 'delivered' | 'pending_payment' | 'refunded' | 'all';

/** 物流单状态：与 shipments.status 的 CHECK 约束一致 */
export type ShipmentStatus = 'pending' | 'picked' | 'transit' | 'delivered' | 'exception';

/** 收货信息快照：下单时写入 shop_orders.shipping_json */
export interface ShippingSnapshot {
  // 收件人
  name: string;
  // 联系电话
  phone: string;
  // 收货地址
  address: string;
} // ShippingSnapshot 结束

/** 后台发货列表行：订单 + 物流 + 待处理售后计数 */
export interface AdminShipmentOrderRow {
  // 订单主键
  id: string;
  // 下单用户
  user_id: string;
  // 用户昵称
  user_nickname: string | null;
  // 购买数量
  quantity: number;
  // 实付金额（分）
  payable_cents: number;
  // 订单状态：pending / paid / delivered / refunded / cancelled
  status: string;
  // 发货方式：physical / virtual_auto / virtual_manual
  delivery_kind: string;
  // 商品编码
  product_code: string;
  // 商品名
  product_name: string;
  // 下单时间
  created_at: string;
  // 支付时间
  paid_at: string | null;
  // 签收时间
  delivered_at: string | null;
  // 发货单主键，null 表示尚未发货
  shipment_id: string | null;
  // 物流公司
  carrier: string | null;
  // 运单号
  tracking_no: string | null;
  // 物流状态
  shipment_status: ShipmentStatus | null;
  // 物流最后更新时间
  shipped_at: string | null;
  // 待处理售后申请数
  after_sales_pending: number;
  // 收货信息（由 shipping_json 摊平）
  shipping: ShippingSnapshot | null;
} // AdminShipmentOrderRow 结束

/** 拉取发货工作台列表 */
export async function listShipmentOrders(
  credential: Credential,
  status: ShipmentFilter,
  limit = 50,
): Promise<AdminShipmentOrderRow[]> {
  const data = await request<{ items: AdminShipmentOrderRow[]; total: number }>(
    `/admin/shop/orders?status=${encodeURIComponent(status)}&limit=${limit}`,
    { credential },
  );
  return data.items;
} // listShipmentOrders 结束

/** 建发货单：填写物流公司与运单号，默认直接推进为中转（已发货） */
export async function createShipment(
  credential: Credential,
  orderId: string,
  payload: { carrier: string; tracking_no: string; status?: 'pending' | 'picked' | 'transit'; note?: string },
): Promise<{ id: string; order_id: string; carrier: string; tracking_no: string; status: string }> {
  const data = await request<{ shipment: { id: string; order_id: string; carrier: string; tracking_no: string; status: string } }>(
    `/admin/shop/orders/${encodeURIComponent(orderId)}/shipments`,
    { method: 'POST', body: payload, credential },
  );
  return data.shipment;
} // createShipment 结束

/** 推进物流状态；delivered 会同步订单为已签收 */
export function updateShipment(
  credential: Credential,
  shipmentId: string,
  payload: { status: ShipmentStatus; note?: string },
): Promise<{ id: string; status: string; updated_at: string }> {
  return request(`/admin/shipments/${encodeURIComponent(shipmentId)}`, { method: 'PATCH', body: payload, credential });
} // updateShipment 结束

/** 售后申请行：申请 + 订单 + 商品 + 用户 */
export interface AdminAfterSalesRow {
  // 申请主键
  id: string;
  // 关联订单
  order_id: string;
  // 申请人
  user_id: string;
  // 用户昵称
  user_nickname: string | null;
  // 申请类型：refund_only / return_refund / repair
  kind: 'refund_only' | 'return_refund' | 'repair';
  // 申请理由
  reason: string;
  // 处理状态：pending / approved / rejected / cancelled
  status: string;
  // 后台备注
  admin_note: string | null;
  // 处理时间
  handled_at: string | null;
  // 申请时间
  created_at: string;
  // 订单实付金额（分）
  payable_cents: number;
  // 订单状态
  order_status: string;
  // 商品名
  product_name: string;
} // AdminAfterSalesRow 结束

/** 拉取售后列表：pending 默认只看待处理，all 看全部 */
export async function listAfterSales(credential: Credential, status: 'pending' | 'all' = 'pending'): Promise<AdminAfterSalesRow[]> {
  const data = await request<{ items: AdminAfterSalesRow[] }>(`/admin/after-sales?status=${status}`, { credential });
  return data.items;
} // listAfterSales 结束

/** 处理售后：approve 会把实付金额退回用户余额并把订单置 refunded */
export function handleAfterSales(
  credential: Credential,
  requestId: string,
  payload: { action: 'approve' | 'reject'; note?: string },
): Promise<{ id: string; status: string }> {
  return request(`/admin/after-sales/${encodeURIComponent(requestId)}/handle`, { method: 'POST', body: payload, credential });
} // handleAfterSales 结束
