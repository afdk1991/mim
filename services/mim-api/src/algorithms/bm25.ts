/**
 * 自研 BM25 相关性打分（零第三方依赖）。
 *
 * 为什么自研：SQLite LIKE 只能判断「命中/未命中」，无法区分标题命中与正文附带命中，也无法压制常见词。
 * BM25 用「词频饱和 + 文档长度归一 + 逆文档频率」三项解决这三个问题，且完全可解释、可单测。
 * 口径：字段可加权（标题权重高于正文），同一词项在 query 中重复不计多次，分数四舍五入到 4 位小数。
 */

import { termFrequency, tokenize } from './text.js'; // 复用同一套分词，保证建索引与查询口径一致

/** 参与打分的字段：text 为字段原文，weight 为该字段的词频放大倍数（默认 1）。 */
export interface Bm25Field {
  text: string; // 字段原文
  weight?: number; // 字段权重：标题给 3，摘要 2，正文 1
} // Bm25Field 结束

/** 一个待打分文档：id 供回查业务行，fields 为参与打分的字段集合。 */
export interface Bm25Doc {
  id: string; // 业务主键
  fields: Bm25Field[]; // 字段集合
} // Bm25Doc 结束

/** BM25 参数：k1 控制词频饱和速度，b 控制长度归一强度。 */
export interface Bm25Options {
  k1?: number; // 词频饱和参数，默认 1.2
  b?: number; // 长度归一参数，默认 0.75
} // Bm25Options 结束

/** 单条打分结果。 */
export interface Bm25Hit {
  id: string; // 业务主键
  score: number; // 相关性得分
} // Bm25Hit 结束

/** 文档预处理结果：加权词频表与加权文档长度。 */
interface PreparedDoc {
  id: string; // 业务主键
  freq: Map<string, number>; // 加权词频
  length: number; // 加权长度（用于长度归一）
} // PreparedDoc 结束

/** 预处理单个文档：把多字段词频按权重合并成一张表。 */
function prepareDoc(doc: Bm25Doc): PreparedDoc {
  const freq = new Map<string, number>(); // 合并后的加权词频
  let length = 0; // 加权总长度
  for (const field of doc.fields) { // 逐字段累加
    const weight = field.weight && field.weight > 0 ? field.weight : 1; // 权重非法时回落 1
    const tokens = tokenize(field.text ?? ''); // 字段分词
    if (tokens.length === 0) continue; // 空字段跳过，避免污染平均长度
    for (const token of tokens) { // 逐词累加
      freq.set(token, (freq.get(token) ?? 0) + weight); // 按权重加权计数
      length += weight; // 长度同步按权重累加
    } // 词项遍历结束
  } // 字段遍历结束
  return { id: doc.id, freq, length }; // 返回预处理结果
} // prepareDoc 结束

/** 四舍五入到 4 位小数，避免浮点噪声让排序在等分时抖动。 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000; // 保留 4 位
} // round4 结束

/**
 * 对一组文档按查询词打 BM25 分并返回排序结果。
 * 空查询或无文档时返回全部 0 分且保持原顺序，调用方可安全降级到时间排序。
 */
export function bm25Rank(query: string, docs: Bm25Doc[], options: Bm25Options = {}): Bm25Hit[] {
  const k1 = options.k1 ?? 1.2; // 默认饱和参数
  const b = options.b ?? 0.75; // 默认长度归一强度
  const queryTerms = Array.from(new Set(tokenize(query))); // 查询词去重，重复词不重复加权
  const prepared = docs.map(prepareDoc); // 预处理全部文档
  if (prepared.length === 0 || queryTerms.length === 0) { // 退化场景
    return docs.map((doc) => ({ id: doc.id, score: 0 })); // 全 0 分保持原序
  } // 退化分支结束
  const totalLength = prepared.reduce((sum, item) => sum + item.length, 0); // 语料总长度
  const avgLength = totalLength > 0 ? totalLength / prepared.length : 1; // 平均长度，0 时兜底 1
  const docFreq = new Map<string, number>(); // 词项文档频率
  for (const term of queryTerms) { // 只统计查询词，减少无用计算
    let df = 0; // 命中该词的文档数
    for (const item of prepared) if (item.freq.has(term)) df += 1; // 命中即 +1
    docFreq.set(term, df); // 记录文档频率
  } // 查询词遍历结束
  const hits = prepared.map((item) => { // 逐文档打分
    let score = 0; // 累计得分
    const dl = item.length > 0 ? item.length : avgLength; // 空文档按平均长度处理
    for (const term of queryTerms) { // 逐查询词累加
      const tf = item.freq.get(term); // 该词的加权词频
      if (!tf) continue; // 未命中则该项为 0
      const df = docFreq.get(term) ?? 0; // 文档频率
      const idf = Math.log(1 + (prepared.length - df + 0.5) / (df + 0.5)); // 逆文档频率：常见词权重低
      const norm = k1 * (1 - b + (b * dl) / avgLength); // 长度归一项
      score += idf * ((tf * (k1 + 1)) / (tf + norm)); // BM25 词项得分
    } // 查询词累加结束
    return { id: item.id, score: round4(score) }; // 输出该文档得分
  }); // 打分结束
  return hits.sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1)); // 分数降序，同分按 id 稳定排序
} // bm25Rank 结束

/** 词频工具透出给调用方，避免各处重复实现。 */
export { termFrequency }; // 复用 text.ts 的词频统计
