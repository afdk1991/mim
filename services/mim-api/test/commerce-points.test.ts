/** 契约测试：积分抵扣纯函数（购物车链路已随模块商城下线，积分计算规则保留） */

import { describe, expect, it } from 'vitest'; // 测试编排
import { computeDeduction } from '../src/commerce/points.js'; // 纯计算函数直测
import { readPointsConfig as readConfig } from '../src/commerce/config.js'; // 配置读取

describe('积分抵扣 · 纯函数边界', () => { // 调用 describe 并处理其返回结果
  const config = readConfig({}); // 缺省配置：100 积分/元，上限 30%

  it('0 元订单不抵扣、不消耗积分', () => { // 调用 it 并处理其返回结果
    const result = computeDeduction({ amountCents: 0, pointsBalance: 5000, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
    expect(result.points_spent).toBe(0); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('无积分余额时抵扣为 0', () => { // 调用 it 并处理其返回结果
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 0, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
    expect(result.payable_cents).toBe(9900); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('单笔上限百分比截断：9900 分订单最多抵 30% = 2970 分', () => { // 调用 it 并处理其返回结果
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 5000, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(2970); // 上限约束
    expect(result.capped_by).toBe('ratio'); // 断言：校验响应字段与冻结契约一致
    expect(result.payable_cents).toBe(6930); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('余额不足时按余额可折金额截断', () => { // 调用 it 并处理其返回结果
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 100, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(100); // 100 积分 = 100 分
    expect(result.points_spent).toBe(100); // 断言：校验响应字段与冻结契约一致
    expect(result.capped_by).toBe('balance'); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('总开关关闭时不抵扣', () => { // 调用 it 并处理其返回结果
    const disabled = readConfig({ MIM_POINTS_DEDUCTION_ENABLED: '0' }); // 构造：准备本用例需要的输入、句柄或期望值
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 5000, config: disabled }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('指定积分超过单笔上限报错 POINTS_CAP_EXCEEDED', () => { // 调用 it 并处理其返回结果
    expect(() => computeDeduction({ amountCents: 9900, pointsBalance: 5000, config, pointsToUse: 5000 })) // 断言：校验响应字段与冻结契约一致
      .toThrowError(/本单抵扣积分超过上限/); // 执行当前业务步骤
  }); // 代码块结束

  it('指定积分超过余额报错 INSUFFICIENT_POINTS', () => { // 调用 it 并处理其返回结果
    expect(() => computeDeduction({ amountCents: 9900, pointsBalance: 50, config, pointsToUse: 100 })) // 断言：校验响应字段与冻结契约一致
      .toThrowError(/积分余额不足/); // 执行当前业务步骤
  }); // 代码块结束
}); // 代码块结束
