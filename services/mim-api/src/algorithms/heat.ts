/**
 * 自研热度算法（零第三方依赖）。
 *
 * 为什么自研：单纯按点赞/浏览总量排序会被历史爆款长期占位，按时间排序又看不到优质老帖。
 * 这里用「互动加权 / (年龄 + 常数)^重力」的时间衰减模型：互动越多越热，但越老衰减越快，
 * 常数项保证刚发布（年龄 0）的内容不会因为除零而无限大。
 */

/** 热度输入：全部为帖子当前的真实互动量。 */
export interface HeatInput {
  likes: number; // 点赞数
  replies: number; // 回复数
  views: number; // 浏览数
  favorites: number; // 收藏数
  createdAt: string; // 发布时间（ISO 串）
} // HeatInput 结束

/** 热度权重与衰减参数。 */
export interface HeatOptions {
  likes?: number; // 点赞权重，默认 3
  replies?: number; // 回复权重，默认 5
  views?: number; // 浏览权重，默认 0.3
  favorites?: number; // 收藏权重，默认 6
  gravity?: number; // 重力指数，默认 1.5，越大越偏向新内容
} // HeatOptions 结束

/** 默认参数：回复/收藏的创作成本最高，权重最大；浏览最廉价，权重最小。 */
export const DEFAULT_HEAT_OPTIONS: Required<HeatOptions> = { likes: 3, replies: 5, views: 0.3, favorites: 6, gravity: 1.5 }; // 内置默认值

/** 四舍五入到 4 位小数，便于跨轮对账。 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000; // 保留 4 位
} // round4 结束

/** 求年龄小时数；发布时间无法解析时按 0 小时处理（视为刚发布，宁可稍微放大也不丢内容）。 */
function ageHoursOf(createdAt: string, now: Date): number {
  const created = Date.parse(createdAt); // 解析发布时间
  if (!Number.isFinite(created)) return 0; // 脏时间按刚发布处理
  return Math.max(0, (now.getTime() - created) / 3_600_000); // 负数年龄归零
} // ageHoursOf 结束

/**
 * 计算热度分：engagement / (ageHours + 2)^gravity。
 * 纯函数：同一输入与同一 now 必得同一结果，便于单测断言。
 */
export function heatScore(input: HeatInput, now: Date = new Date(), options: HeatOptions = {}): number {
  const cfg = { ...DEFAULT_HEAT_OPTIONS, ...options }; // 合并默认与覆盖参数
  const engagement =
    cfg.likes * Math.max(0, input.likes ?? 0) + // 点赞加权
    cfg.replies * Math.max(0, input.replies ?? 0) + // 回复加权
    cfg.favorites * Math.max(0, input.favorites ?? 0) + // 收藏加权
    cfg.views * Math.max(0, input.views ?? 0); // 浏览加权
  const ageHours = ageHoursOf(input.createdAt, now); // 年龄小时数
  const denominator = Math.pow(ageHours + 2, Math.max(0.5, cfg.gravity)); // 分母：常数 2 防除零
  return round4(engagement / denominator); // 输出热度分
} // heatScore 结束

/** 单条热度结果：id 供回查业务行，heat 为热度分。 */
export interface HeatHit {
  id: string; // 业务主键
  heat: number; // 热度分
} // HeatHit 结束

/** 对一组条目按热度排序；同分按 id 稳定排序，保证分页结果稳定。 */
export function rankByHeat(
  items: Array<{ id: string } & HeatInput>, // 待排序条目：带主键与互动量
  now: Date = new Date(), // 统一时间基准，避免逐条取 now 造成抖动
  options: HeatOptions = {}, // 可选权重覆盖
): HeatHit[] {
  return items
    .map((item) => ({ id: item.id, heat: heatScore(item, now, options) })) // 逐条算分
    .sort((left, right) => right.heat - left.heat || (left.id < right.id ? -1 : 1)); // 降序并稳定排序
} // rankByHeat 结束
