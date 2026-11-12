/** 契约测试：快递100 物流查询适配层（未配置回退、签名、轨迹归一化） */

import { afterEach, describe, expect, it, vi } from 'vitest'; // 测试框架与全局 mock
import { kuaidi100Sign, queryShipment } from '../src/logistics.js'; // 被测适配层

describe('快递100 物流适配', () => {
  afterEach(() => {
    vi.unstubAllGlobals(); // 每个用例后恢复真实 fetch
  });

  it('未配置凭证时不发起请求，返回 provider=none', async () => {
    const fetchMock = vi.fn(); // 记录是否被调用
    vi.stubGlobal('fetch', fetchMock); // 替换全局 fetch
    const result = await queryShipment({}, 'yuantong', 'YT123'); // 空 env
    expect(result).toMatchObject({ configured: false, provider: 'none', events: [] }); // 明确回退标记
    expect(fetchMock).not.toHaveBeenCalled(); // 未配置不得请求外网
  });

  it('签名与快递100规则一致：MD5(param+key+customer) 大写', () => {
    const param = JSON.stringify({ com: 'yuantong', num: 'YT123', resultv2: '4' }); // 与适配层一致的参数
    expect(kuaidi100Sign(param, 'test-key', 'test-customer')).toBe('96FC5FF6EE7776B1BA65CABD0526F34C'); // 固定向量锁定算法
  });

  it('成功响应按时间倒序归一化轨迹，并把 state=3 映射为已签收', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: '200', // 供应商成功
      state: '3', // 已签收
      data: [
        { time: '2026-11-12 10:00:00', context: '已揽收' }, // 较早轨迹
        { time: '2026-11-12 18:00:00', context: '已签收' }, // 较新轨迹
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))); // 模拟快递100响应
    const result = await queryShipment({ MIM_KUAIDI100_CUSTOMER: 'c', MIM_KUAIDI100_KEY: 'k' }, 'yuantong', 'YT123'); // 配置完整
    expect(result.configured).toBe(true); // 已配置
    expect(result.status).toBe('delivered'); // state=3 归一化为已签收
    expect(result.events[0].text).toBe('已签收'); // 最新轨迹在前
    expect(result.events[1].text).toBe('已揽收'); // 旧轨迹在后
  });

  it('网络异常时返回 error 且不抛出，保证订单详情可用', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down'); // 模拟网络故障
    }));
    const result = await queryShipment({ MIM_KUAIDI100_CUSTOMER: 'c', MIM_KUAIDI100_KEY: 'k' }, 'yuantong', 'YT123'); // 配置完整
    expect(result.configured).toBe(true); // 已配置但仍失败
    expect(result.error).toContain('network down'); // 错误透出给前端
    expect(result.events).toEqual([]); // 不伪造轨迹
  });
});
