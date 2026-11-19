/**
 * 自研综合排序分（零第三方依赖）。
 *
 * 为什么自研：相关性高但三年前的帖子不该压过上周的优质帖，纯互动量又不能代表「和搜索词有多相关」。
 * 这里把三路信号合成一个可解释的分数：相关性 · 时效衰减 + 互动微调项。
 * 时效沿用半衰期模型（每过一个半衰期，相关性贡献折半），互动项取对数以避免大数霸榜。
 */

/** 综合打分输入。 */
export interface BlendInput {
  relevance: number; // 相关性原始分（通常来自 BM25）
  ageDays: number; // 距今天数
  likes: number; // 点赞数
  replies: number; // 回复数
} // BlendInput 结束

/** 综合打分参数。 */
export interface BlendOptions {
  halfLifeDays?: number; // 相关性半衰期（天），默认 7
  engagementWeight?: number; // 互动微调权重，默认 0.02
} // BlendOptions 结束

/** 半衰期衰减因子：ageDays=0 时为 1，等于半衰期时为 0.5。 */
export function freshnessDecay(ageDays: number, halfLifeDays = 7): number {
  const hl = Math.max(0.5, halfLifeDays); // 半衰期下限 0.5 天，避免除零
  const age = Math.max(0, Number.isFinite(ageDays) ? ageDays : 0); // 负年龄与非法值归零
  return Math.pow(0.5, age / hl); // 指数衰减
} // freshnessDecay 结束

/** 四舍五入到 4 位小数，保证排序对账稳定。 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000; // 保留 4 位
} // round4 结束

/**
 * 计算综合排序分：relevance·decay + w·ln(1 + 2·likes + 3·replies)。
 * 纯函数，同输入同输出；调用方可用其结果直接做降序排序。
 */
export function blendScore(input: BlendInput, options: BlendOptions = {}): number {
  const halfLifeDays = options.halfLifeDays ?? 7; // 默认半衰期 7 天
  const engagementWeight = options.engagementWeight ?? 0.02; // 默认互动权重 2%
  const relevance = Number.isFinite(input.relevance) ? Math.max(0, input.relevance) : 0; // 相关性非法归零
  const decay = freshnessDecay(input.ageDays, halfLifeDays); // 时效衰减
  const engagement = Math.log1p(2 * Math.max(0, input.likes ?? 0) + 3 * Math.max(0, input.replies ?? 0)); // 对数压缩的互动项
  return round4(relevance * decay + engagementWeight * engagement); // 合成并四舍五入
} // blendScore 结束

/** 带综合分的排序结果。 */
export interface BlendHit {
  id: string; // 业务主键
  score: number; // 综合分
} // BlendHit 结束

/** 对候选集按综合分降序排序；同分按 id 稳定排序。 */
export function rankByBlend(
  items: Array<{ id: string } & BlendInput>, // 候选集
  options: BlendOptions = {}, // 可选参数
): BlendHit[] {
  return items
    .map((item) => ({ id: item.id, score: blendScore(item, options) })) // 逐条算分
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1)); // 降序稳定排序
} // rankByBlend 结束
