/**
 * 交易透明化前端纯函数测试（2026-11-25 批次）
 *
 * 覆盖对象：
 *   - summarizeOrderAmount：订单金额拆解（原价 / 优惠 / 应付 / 平台服务费 0）；
 *   - previewCouponDiscount：优惠码命中预估（立减 / 折扣，封顶订单金额）。
 * 与后端 commerce/policy.ts 同口径，仅做本地预览，不核销次数、不发请求。
 */

import { describe, expect, it } from 'vitest'; // vitest 编排
import { previewCouponDiscount, summarizeOrderAmount } from './endpoints.js'; // 待测纯函数

describe('summarizeOrderAmount 金额拆解', () => {
  it('原价 / 优惠 / 应付原样带出，平台服务费固定为 0', () => {
    const summary = summarizeOrderAmount({ amount_cents: 5000, discount_cents: 1000, payable_cents: 4000 });
    expect(summary).toEqual({ amount_cents: 5000, discount_cents: 1000, payable_cents: 4000, service_fee_cents: 0 });
  });

  it('无优惠订单优惠与服务费均为 0，应付等于原价', () => {
    const summary = summarizeOrderAmount({ amount_cents: 3000, discount_cents: 0, payable_cents: 3000 });
    expect(summary.discount_cents).toBe(0); // 优惠为空
    expect(summary.service_fee_cents).toBe(0); // 服务费 0
    expect(summary.payable_cents).toBe(summary.amount_cents); // 应付等于原价
  });
});

describe('previewCouponDiscount 券命中预估', () => {
  it('立减按面值计算，且不超过订单金额', () => {
    expect(previewCouponDiscount('fixed', 1000, 5000)).toBe(1000); // 面值 1000，订单 5000
    expect(previewCouponDiscount('fixed', 99999, 5000)).toBe(5000); // 面值高于订单，封顶订单金额
  });

  it('折扣按百分比四舍五入到分，0 元单不产生优惠', () => {
    expect(previewCouponDiscount('percent', 20, 3000)).toBe(600); // 20% × 3000 = 600 分
    expect(previewCouponDiscount('percent', 20, 0)).toBe(0); // 0 元单优惠为 0
    expect(previewCouponDiscount('percent', 50, 999)).toBe(500); // 499.5 分四舍五入为 500 分
  });
});
