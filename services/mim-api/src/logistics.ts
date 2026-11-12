/**
 * 物流查询适配层：可选接入快递100实时查询。
 * 未配置凭证时不发起网络请求，由调用方回退到本地登记轨迹；
 * 查询失败只返回错误说明，不让「查不到物流」把订单详情接口打成 500。
 */

import { createHash } from 'node:crypto'; // 快递100 签名使用 MD5

/** 快递100 查询结果中的单条轨迹。 */
export interface LogisticsEvent {
  at: string; // 轨迹时间（提供方原样返回）
  text: string; // 轨迹描述
  status?: string; // 提供方状态码
}

/** 对外统一的物流查询结果：configured=false 表示没有可用供应商。 */
export interface LogisticsResult {
  configured: boolean; // 是否配置了快递100
  provider: 'kuaidi100' | 'none'; // 实际使用的供应商
  state?: string; // 快递100 物流状态码
  status?: string; // 归一化状态：pending / picked / transit / delivered / exception
  events: LogisticsEvent[]; // 轨迹列表，按时间倒序
  error?: string; // 网络或供应商错误，仅用于展示
}

/** 快递100 sign：MD5(param + key + customer) 后转大写。 */
export function kuaidi100Sign(param: string, key: string, customer: string): string {
  return createHash('md5').update(`${param}${key}${customer}`).digest('hex').toUpperCase();
}

/** 把快递100 的 state 映射为站内统一状态，未知状态按运输中处理。 */
function mapState(state: string | undefined): string {
  if (state === '1') return 'picked'; // 已揽收
  if (state === '3') return 'delivered'; // 已签收
  if (state === '2' || state === '4' || state === '5' || state === '6') return 'exception'; // 疑难 / 退回 / 派件异常
  return 'transit'; // 0 在途，其余未知状态保持运输中
}

/** 查询单号：凭证缺失直接返回 none，不产生任何外网请求。 */
export async function queryShipment(
  env: Record<string, string | undefined>,
  carrier: string,
  trackingNo: string,
  phone?: string,
): Promise<LogisticsResult> {
  const customer = env.MIM_KUAIDI100_CUSTOMER?.trim(); // 快递100 客户编号
  const key = env.MIM_KUAIDI100_KEY?.trim(); // 快递100 授权密钥
  if (!customer || !key) return { configured: false, provider: 'none', events: [] }; // 未配置即回退本地轨迹

  const param = JSON.stringify({
    com: carrier, // 承运商编码，如 yuantong / shunfeng
    num: trackingNo, // 运单号
    ...(phone ? { phone } : {}), // 顺丰等隐私运单需要收件人手机号后四位
    resultv2: '4', // 返回国际化 / 多状态轨迹
  });
  const body = new URLSearchParams({
    customer, // 客户编号
    sign: kuaidi100Sign(param, key, customer), // 请求签名
    param, // 查询参数 JSON
  });

  try {
    const res = await fetch('https://poll.kuaidi100.com/poll/query.do', {
      method: 'POST', // 快递100 实时查询为 POST 表单
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, // 表单编码
      body, // 已编码的请求体
      signal: AbortSignal.timeout(8000), // 8 秒超时，避免拖垮订单详情
    });
    const json = (await res.json()) as {
      message?: string; // 错误说明
      state?: string; // 物流状态
      status?: string; // 响应状态
      data?: Array<{ time?: string; context?: string; status?: string }>; // 轨迹数组
    };
    if (!res.ok || (json.status && json.status !== '200')) {
      return { configured: true, provider: 'kuaidi100', events: [], error: json.message ?? `快递100 返回 ${res.status}` }; // 供应商错误降级
    }
    const events = (json.data ?? [])
      .filter((item) => item.time && item.context) // 丢弃缺时间或缺描述的脏数据
      .map((item) => ({ at: item.time as string, text: item.context as string, status: item.status })) // 归一化字段
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at)); // 最新轨迹在前
    return {
      configured: true, // 已配置并成功调用
      provider: 'kuaidi100', // 供应商标识
      state: json.state, // 原始状态码
      status: mapState(json.state), // 站内统一状态
      events, // 轨迹列表
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '物流查询失败'; // 兜底错误文案
    return { configured: true, provider: 'kuaidi100', events: [], error: message }; // 网络异常不抛到路由层
  }
}
