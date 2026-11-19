/**
 * 自研算法包统一出口。
 *
 * 口径：本目录只放「纯函数、无数据库、无网络」的确定性算法，便于单测与跨模块复用；
 * 涉及落库与读写的编排逻辑留在 routes / service 层，不塞进算法包。
 */

export * from './text.js'; // 归一化、分词、词频、Jaccard、词项集合
export * from './bm25.js'; // BM25 相关性打分
export * from './heat.js'; // 时间衰减热度
export * from './mmr.js'; // 最大边际相关性重排
export * from './rank.js'; // 时效衰减与综合排序分
