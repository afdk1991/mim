/**
 * 自研 MMR（最大边际相关性）多样性重排（零第三方依赖）。
 *
 * 为什么自研：按相关性纯排序时，同一板块、同一话题的帖子容易连续霸占结果位，用户翻两屏都是同质内容。
 * MMR 用「相关性 − 与已选集合的最大相似度」的贪心选择在相关性与多样性之间取平衡：
 *   next = argmax( λ·rel(i) − (1−λ)·max_{j∈S} sim(i, j) )
 * λ=1 退化为纯相关性排序，λ 越小越强调多样性；同分时按输入顺序稳定选择。
 */

/** 重排所需的回调：相关性取值与任意两条的相似度。 */
export interface MmrOptions<T> {
  relevance: (item: T) => number; // 相关性得分（越大越相关）
  similarity: (left: T, right: T) => number; // 相似度（0~1，越大越重复）
  lambda?: number; // 相关性权重，默认 0.7（相关为主、去重为辅）
} // MmrOptions 结束

/** 把相似度夹到 [0,1]，避免调用方返回越界值破坏公式。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0; // 非有限值视为不相似
  if (value < 0) return 0; // 下界夹取
  if (value > 1) return 1; // 上界夹取
  return value; // 区间内原样返回
} // clamp01 结束

/**
 * 对候选集做 MMR 贪心重排，返回与输入等长的新数组（不改动入参）。
 * 复杂度 O(n²)：仅用于单次请求的候选窗口（通常 ≤ 200），不适用于全库排序。
 */
export function mmrRerank<T>(
  items: T[], // 候选集，顺序视为同等相关时的偏好顺序
  options: MmrOptions<T>, // 回调与 λ
): T[] {
  const lambda = Number.isFinite(options.lambda ?? 0.7) ? Math.min(1, Math.max(0, options.lambda ?? 0.7)) : 0.7; // λ 夹到 [0,1]，非法回落 0.7
  if (items.length <= 1) return [...items]; // 0/1 条无需重排
  const remaining = items.map((item, index) => ({ item, index, rel: options.relevance(item) })); // 预计算相关性
  const selected: Array<{ item: T; index: number; rel: number }> = []; // 已选队列
  while (remaining.length > 0) { // 直到选完
    let bestPos = 0; // 本轮最优候选下标
    let bestScore = -Infinity; // 本轮最优分数
    for (let pos = 0; pos < remaining.length; pos += 1) { // 逐候选评估
      const candidate = remaining[pos]; // 当前候选
      let maxSim = 0; // 与已选集合的最大相似度
      for (const chosen of selected) { // 逐个已选项比较
        const sim = clamp01(options.similarity(candidate.item, chosen.item)); // 计算相似度并夹取
        if (sim > maxSim) maxSim = sim; // 记录最大值
      } // 已选项遍历结束
      const score = lambda * candidate.rel - (1 - lambda) * maxSim; // MMR 综合分
      if (score > bestScore + 1e-12) { bestScore = score; bestPos = pos; } // 严格更优才替换，保证稳定
      else if (Math.abs(score - bestScore) <= 1e-12 && candidate.index < remaining[bestPos].index) { bestPos = pos; } // 同分按原始顺序
    } // 候选遍历结束
    selected.push(remaining[bestPos]); // 选入本轮最优
    remaining.splice(bestPos, 1); // 从候选池移除
  } // 选择循环结束
  return selected.map((entry) => entry.item); // 返回重排后的条目
} // mmrRerank 结束
