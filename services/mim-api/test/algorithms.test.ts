/** 自研算法包单元测试：分词 / BM25 / 热度 / MMR / 综合分，全部为纯函数，可固定输入断言 */

import { describe, expect, it } from 'vitest'; // 测试框架：断言与用例组织
import { tokenize, normalizeText, jaccard } from '../src/algorithms/text.js'; // 文本归一化与分词
import { bm25Rank } from '../src/algorithms/bm25.js'; // BM25 相关性
import { heatScore, rankByHeat } from '../src/algorithms/heat.js'; // 时间衰减热度
import { mmrRerank } from '../src/algorithms/mmr.js'; // 多样性重排
import { blendScore, freshnessDecay } from '../src/algorithms/rank.js'; // 综合分与时效衰减

describe('文本归一化与分词', () => { // 用例组：分词口径
  it('全角转半角并小写', () => { // 归一化行为
    expect(normalizeText('  ＭＩＭ　商城  ')).toBe('mim 商城'); // 全角字母与全角空格都应归一
  }); // 用例结束

  it('中文按二元切分', () => { // 中文切分
    expect(tokenize('漫剧工作台')).toEqual(['漫剧', '剧工', '工作', '作台']); // 四字词应为三个相邻二元词
  }); // 用例结束

  it('单字中文保留，拉丁词做轻量归一', () => { // 中英混排
    const tokens = tokenize('API 与 Threads 更新'); // 混排原文
    expect(tokens).toContain('api'); // 拉丁词小写保留
    expect(tokens).toContain('thread'); // 复数去尾
    expect(tokens).toContain('更新'); // 中文二元词
  }); // 用例结束

  it('停用词不进入词项', () => { // 停用词过滤
    expect(tokenize('the API')).not.toContain('the'); // 英文停用词丢弃
  }); // 用例结束

  it('Jaccard 相似度边界', () => { // 相似度
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1); // 完全相同
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0); // 完全不同
    expect(jaccard(new Set(), new Set())).toBe(1); // 两个空集视为同质
  }); // 用例结束
}); // 用例组结束

describe('BM25 相关性', () => { // 用例组：相关性打分
  const docs = [ // 固定语料
    { id: 'title-hit', fields: [{ text: '漫剧工作台发布', weight: 3 }, { text: '正文没有关键词', weight: 1 }] }, // 标题命中
    { id: 'body-hit', fields: [{ text: '普通标题', weight: 3 }, { text: '正文提到漫剧工作台一次', weight: 1 }] }, // 正文命中
    { id: 'no-hit', fields: [{ text: '完全无关的内容', weight: 3 }] }, // 未命中
  ]; // 语料结束

  it('标题命中得分高于正文命中', () => { // 字段权重生效
    const hits = bm25Rank('漫剧工作台', docs); // 打分
    expect(hits[0].id).toBe('title-hit'); // 首位应为标题命中
    expect(hits[0].score).toBeGreaterThan(hits[1].score); // 标题权重更高
  }); // 用例结束

  it('未命中文档得 0 分并排在后', () => { // 未命中
    const hits = bm25Rank('漫剧工作台', docs); // 打分
    expect(hits[hits.length - 1].id).toBe('no-hit'); // 0 分排末位
    expect(hits[hits.length - 1].score).toBe(0); // 未命中即 0
  }); // 用例结束

  it('空查询降级为全 0 分且保持原序', () => { // 退化场景
    const hits = bm25Rank('   ', docs); // 空查询
    expect(hits.map((hit) => hit.id)).toEqual(docs.map((doc) => doc.id)); // 顺序不变
    expect(hits.every((hit) => hit.score === 0)).toBe(true); // 全部 0 分
  }); // 用例结束
}); // 用例组结束

describe('时间衰减热度', () => { // 用例组：热度
  const now = new Date('2026-11-19T00:00:00.000Z'); // 固定当前时间
  const base = { likes: 10, replies: 5, views: 1000, favorites: 6, createdAt: '2026-11-19T00:00:00.000Z' }; // 刚发布基准

  it('同样互动量下越新越热', () => { // 衰减方向
    const fresh = heatScore(base, now); // 刚发布
    const old = heatScore({ ...base, createdAt: '2026-11-12T00:00:00.000Z' }, now); // 一周前
    expect(fresh).toBeGreaterThan(old); // 新内容热度更高
  }); // 用例结束

  it('点赞越多热度越高', () => { // 单调性
    expect(heatScore({ ...base, likes: 30 }, now)).toBeGreaterThan(heatScore(base, now)); // 点赞翻三倍应更热
  }); // 用例结束

  it('排序结果按热度降序', () => { // 排序
    const ranked = rankByHeat([ // 两条不同热度
      { id: 'old', ...base, createdAt: '2026-11-01T00:00:00.000Z' }, // 较旧
      { id: 'fresh', ...base }, // 刚发布
    ], now); // 排序
    expect(ranked[0].id).toBe('fresh'); // 新的在前
  }); // 用例结束
}); // 用例组结束

describe('MMR 多样性重排', () => { // 用例组：多样性
  const items = [ // 三条候选：前两条高度相似
    { id: 'a1', topic: '漫剧', rel: 10 }, // 最相关
    { id: 'a2', topic: '漫剧', rel: 9.5 }, // 与 a1 同质
    { id: 'b1', topic: '商城', rel: 8 }, // 相关性略低但话题不同
  ]; // 候选结束
  const similarity = (left: { topic: string }, right: { topic: string }): number => (left.topic === right.topic ? 1 : 0); // 同话题即完全相似

  it('λ=1 退化为纯相关性排序', () => { // 纯相关
    const ranked = mmrRerank(items, { relevance: (item) => item.rel, similarity, lambda: 1 }); // λ=1
    expect(ranked.map((item) => item.id)).toEqual(['a1', 'a2', 'b1']); // 原相关序
  }); // 用例结束

  it('低 λ 时优先插入不同话题', () => { // 去同质
    const ranked = mmrRerank(items, { relevance: (item) => item.rel, similarity, lambda: 0.3 }); // λ=0.3
    expect(ranked[1].id).toBe('b1'); // 第二位换成不同话题
  }); // 用例结束

  it('不改动输入数组', () => { // 纯函数约束
    const copy = [...items]; // 备份
    mmrRerank(items, { relevance: (item) => item.rel, similarity }); // 执行重排
    expect(items).toEqual(copy); // 入参不被修改
  }); // 用例结束
}); // 用例组结束

describe('综合排序分', () => { // 用例组：综合分
  it('半衰期衰减：零天为 1，一个半衰期折半', () => { // 衰减口径
    expect(freshnessDecay(0, 7)).toBe(1); // 当天不衰减
    expect(freshnessDecay(7, 7)).toBe(0.5); // 一个半衰期折半
  }); // 用例结束

  it('同等相关时更新的帖子得分更高', () => { // 时效优先
    const fresh = blendScore({ relevance: 5, ageDays: 0, likes: 3, replies: 1 }); // 新帖
    const old = blendScore({ relevance: 5, ageDays: 30, likes: 3, replies: 1 }); // 老帖
    expect(fresh).toBeGreaterThan(old); // 新帖更高
  }); // 用例结束
}); // 用例组结束
