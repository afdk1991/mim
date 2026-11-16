/**
 * 付费资产端点（2026-11-16）：列表 / 详情 / 我的资产 / 余额购买。
 *
 * 单独放一个文件，不改 endpoints.ts 的共享契约（并行线正在改它）：
 *   - 只用 request 出口，鉴权 / 幂等 / 401 续期与其他业务域完全一致；
 *   - 列表与详情匿名可读，登录后由服务端附带「是否已购」；
 *   - 未解锁时服务端只给试读，正文与文件地址不下发，前端不做二次拼装。
 */

import { request, resolvePublicUrl } from './request.js'; // 统一请求出口 + 相对地址补全

/** 资产类型：与后端 kind 枚举一致。 */
export type AssetKind = 'article' | 'download' | 'gallery' | 'video';

/** 资产列表项：匿名可读，unlocked 表示当前身份是否已解锁。 */
export interface AssetListItem {
  code: string; // 资产编码：详情 / 购买深链接的唯一键
  kind: AssetKind; // 资产类型
  title: string; // 标题
  summary: string; // 简介
  cover_url: string | null; // 封面（站内相对路径或绝对地址）
  price_cents: number; // 价格（分）；0 表示免费
  vip_free: number; // 会员是否免费（1/0）
  views: number; // 浏览量
  sales: number; // 销量
  updated_at: string; // 更新时间
  unlocked: boolean; // 当前身份是否已解锁
}

/** 资产媒体项：未解锁时服务端返回空数组。 */
export interface AssetMedia {
  kind: 'image' | 'video'; // 媒体类型
  url: string; // 媒体地址
  poster_url: string | null; // 视频封面
}

/** 资产详情：未解锁时 body 只含试读、file_url 为 null、media 为空。 */
export interface AssetDetail extends AssetListItem {
  body: string; // 正文（未解锁为试读片段）
  file_url: string | null; // 下载地址（未解锁为 null）
  media: AssetMedia[]; // 图集 / 视频（未解锁为空）
}

/** 我拥有的资产：附带访问方式（file_url）。 */
export interface MyAssetItem {
  code: string; // 资产编码
  kind: AssetKind; // 资产类型
  title: string; // 标题
  summary: string; // 简介
  cover_url: string | null; // 封面
  file_url: string | null; // 访问 / 下载地址
  amount_cents: number; // 实付金额（分）
  created_at: string; // 购买时间
}

/** 资产列表查询。 */
export interface AssetQuery {
  kind?: AssetKind | ''; // 类型筛选
  q?: string; // 关键词
}

/** 购买结果：via 标识免费 / 会员 / 已购 / 余额扣款。 */
export interface AssetPurchaseResult {
  ok: boolean; // 是否成功
  charged_cents: number; // 实扣金额（分）
  via: 'free' | 'vip' | 'owned' | 'balance'; // 解锁途径
}

/** 把查询对象拼成 query string：空值不参与。 */
function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams(); // 浏览器原生编码
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue; // 空值跳过
    search.set(key, value); // 写入
  }
  const text = search.toString(); // 序列化
  return text ? `?${text}` : ''; // 无参数时不留问号
}

/** 资产列表：匿名可读，登录后 unlocked 反映个人解锁状态。 */
export function fetchAssets(query: AssetQuery = {}): Promise<{ items: AssetListItem[]; vip_level: number }> {
  return request<{ items: AssetListItem[]; vip_level: number }>(`/assets${toQuery({ kind: query.kind, q: query.q })}`, { idempotency: false });
}

/** 资产详情：匿名可读，未解锁只返回试读。 */
export function fetchAsset(code: string): Promise<{ asset: AssetDetail }> {
  return request<{ asset: AssetDetail }>(`/assets/${encodeURIComponent(code)}`, { idempotency: false });
}

/** 我的资产：需登录。 */
export function fetchMyAssets(): Promise<{ items: MyAssetItem[] }> {
  return request<{ items: MyAssetItem[] }>('/assets/mine/list', { idempotency: false });
}

/** 余额购买：需登录；免费 / 会员 / 已购由服务端直接返回对应 via。 */
export function purchaseAsset(code: string): Promise<AssetPurchaseResult> {
  return request<AssetPurchaseResult>(`/assets/${encodeURIComponent(code)}/purchase`, { method: 'POST', body: {} });
}

/** 封面 / 媒体 / 下载地址补全：站内相对路径按 API 源拼绝对地址。 */
export function assetUrl(url: string | null): string {
  return url ? resolvePublicUrl(url) : '';
}
