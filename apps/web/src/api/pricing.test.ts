/**
 * 纯函数契约测试：定价页权益对比整形（buildPricingComparison）。
 *
 * 不启动浏览器、不发真实请求；只覆盖无副作用的权益汇总与布尔矩阵推导。
 */

import { describe, expect, it } from 'vitest'; // 测试框架
import { buildPricingComparison } from './endpoints.js'; // 待测纯函数
import type { PublicPricingPlan } from './types.js'; // 仅类型导入

/** 构造测试档位：字段形状对齐公开定价响应，权益清单按入参给定 */
function plan(code: string, perks: string[]): PublicPricingPlan {
  return { code, name: code, level: 1, price_cents: 1000, duration_days: 30, perks }; // 固定价格仅用于形状占位，断言不依赖金额
} // plan 结束

describe('buildPricingComparison：权益对比矩阵整形', () => {
  it('按首次出现顺序汇总权益，各档包含布尔矩阵正确', () => { // 行顺序与勾选矩阵
    const rows = buildPricingComparison([ // 两档权益交叉：乙共有，甲 / 丙各自独有
      plan('vip-monthly', ['权益甲', '权益乙']),
      plan('vip-yearly', ['权益乙', '权益丙']),
    ]);
    expect(rows.map((row) => row.feature)).toEqual(['权益甲', '权益乙', '权益丙']); // 权益按首次出现顺序成行
    expect(rows[0].included).toEqual({ 'vip-monthly': true, 'vip-yearly': false }); // 甲仅月卡包含
    expect(rows[1].included).toEqual({ 'vip-monthly': true, 'vip-yearly': true }); // 乙两档共有
    expect(rows[2].included).toEqual({ 'vip-monthly': false, 'vip-yearly': true }); // 丙仅年卡包含
  }); // 用例结束

  it('空档位输入返回空数组', () => { // 未配置档位时对比表无行
    expect(buildPricingComparison([])).toEqual([]); // 空数组交前端隐藏对比表
  }); // 用例结束

  it('重复权益只占一行，不重复成行', () => { // 去重口径
    const rows = buildPricingComparison([plan('a', ['同权益']), plan('b', ['同权益'])]); // 两档共有同一权益
    expect(rows).toHaveLength(1); // 只生成一行
    expect(rows[0].included).toEqual({ a: true, b: true }); // 两档均勾选
  }); // 用例结束
}); // 描述块结束
