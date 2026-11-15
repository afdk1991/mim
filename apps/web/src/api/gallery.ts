/**
 * 图库 / 视频端点（2026-11-15）：挂在社区路由下，复用帖子媒体表与解锁口径。
 *
 * 单独放一个文件，不改 endpoints.ts 的共享契约（并行线正在改它）：
 *   - 只用 request 出口，鉴权 / 幂等 / 401 续期与其他业务域完全一致；
 *   - 服务端返回的 url / poster_url 一律是短时签名地址，前端不感知对象键。
 */

import { request } from './request.js'; // 统一请求出口

/** 图库媒体项：锁定项的 url / poster_url 为空串，仅保留标题与元数据。 */
export interface GalleryItem { // 单条媒体
  id: string; // 媒体主键
  thread_id: string; // 原帖：用于跳转
  kind: 'image' | 'video'; // 媒体类型
  mime: string; // MIME
  size_bytes: number; // 体积
  duration_seconds: number; // 视频时长（秒）
  width: number; // 宽度
  height: number; // 高度
  created_at: string; // 上传时间
  thread_title: string; // 原帖标题
  thread_summary: string; // 原帖摘要
  author_id: string | null; // 作者
  author_name: string; // 作者名
  board_slug: string; // 板块 slug
  board_name: string; // 板块名
  locked: boolean; // 是否被付费墙拦住
  url: string; // 短时签名地址（锁定为空）
  poster_url: string; // 封面签名地址（锁定为空）
  favorited: boolean; // 我是否已收藏
  favorite_count: number; // 收藏总数
} // 接口结束

/** 图库分页响应。 */
export interface GalleryPage { // 列表响应
  items: GalleryItem[]; // 当前页
  total: number; // 命中总数
  offset: number; // 实际偏移
  limit: number; // 实际页长
  sort: string; // 生效排序
  vip_level: number; // 当前 VIP 等级
} // 接口结束

/** 图库聚合项：按帖或按作者。 */
export interface GalleryCollection { // 聚合分组
  key: string; // 分组键
  label: string; // 展示名
  thread_id: string; // 原帖
  author_id: string | null; // 作者
  author_name: string; // 作者名
  count: number; // 媒体数
  created_at: string; // 最新时间
  cover_url: string; // 封面签名地址
} // 接口结束

/** 图库聚合响应。 */
export interface GalleryCollections { // 聚合响应
  collections: GalleryCollection[]; // 当前页分组
  total: number; // 分组总数
  offset: number; // 实际偏移
  limit: number; // 实际页长
  group: 'thread' | 'author'; // 分组维度
} // 接口结束

/** 图库查询参数。 */
export interface GalleryQuery { // 查询条件
  q?: string; // 关键词
  kind?: 'image' | 'video' | ''; // 媒体类型
  author_id?: string; // 按作者
  thread_id?: string; // 按帖
  favorited?: boolean; // 只看我的收藏
  sort?: 'latest' | 'oldest' | 'favorites'; // 排序
  limit?: number; // 页长
  offset?: number; // 偏移
} // 接口结束

/** 把查询对象拼成 query string：空值不参与，避免后端把空串当筛选条件。 */
function toQuery(params: Record<string, string | number | boolean | undefined>): string { // 定义函数 toQuery
  const search = new URLSearchParams(); // 浏览器原生编码
  for (const [key, value] of Object.entries(params)) { // 逐项过滤空值
    if (value === undefined || value === '' || value === false) continue; // 空 / 假值跳过
    search.set(key, String(value)); // 写入
  } // 结束循环
  const text = search.toString(); // 序列化
  return text ? `?${text}` : ''; // 无参数时不留问号
} // 函数结束

/** 拉取图库 / 视频列表：匿名可读，锁定项由服务端隐藏地址。 */
export function fetchGalleryItems(query: GalleryQuery = {}): Promise<GalleryPage> { // 定义函数 fetchGalleryItems
  return request<GalleryPage>(`/community/gallery/items${toQuery({ // 拼接查询
    q: query.q, // 关键词
    kind: query.kind, // 类型
    author_id: query.author_id, // 作者
    thread_id: query.thread_id, // 帖子
    favorited: query.favorited, // 我的收藏
    sort: query.sort, // 排序
    limit: query.limit, // 页长
    offset: query.offset, // 偏移
  })}`, { idempotency: false }); // 只读 GET
} // 函数结束

/** 拉取图库聚合：按帖 / 按作者。 */
export function fetchGalleryCollections(group: 'thread' | 'author', query: GalleryQuery = {}): Promise<GalleryCollections> { // 定义函数 fetchGalleryCollections
  return request<GalleryCollections>(`/community/gallery/collections${toQuery({ // 拼接查询
    group, // 分组维度
    q: query.q, // 关键词
    kind: query.kind, // 类型
    limit: query.limit, // 页长
    offset: query.offset, // 偏移
  })}`, { idempotency: false }); // 只读 GET
} // 函数结束

/** 收藏媒体：未解锁的媒体服务端返回 403。 */
export function favoriteGalleryItem(mediaId: string): Promise<{ ok: boolean; favorited: boolean }> { // 定义函数 favoriteGalleryItem
  return request<{ ok: boolean; favorited: boolean }>(`/community/gallery/items/${encodeURIComponent(mediaId)}/favorite`, { method: 'POST', body: {} }); // 写操作自带幂等键
} // 函数结束

/** 取消收藏：天然幂等。 */
export function unfavoriteGalleryItem(mediaId: string): Promise<{ ok: boolean; favorited: boolean }> { // 定义函数 unfavoriteGalleryItem
  return request<{ ok: boolean; favorited: boolean }>(`/community/gallery/items/${encodeURIComponent(mediaId)}/favorite`, { method: 'DELETE' }); // 写操作自带幂等键
} // 函数结束
