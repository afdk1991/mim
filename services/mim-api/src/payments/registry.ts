/** 九渠道注册表：渠道元数据矩阵 + 适配器查找；配置状态只读 env，不暴露任何密钥 */

import type { AnyChannelId, ChannelAdapter, ExtChannelId } from './types.js'; // 引入依赖：声明本文件使用的外部能力
import { hupijiaoAdapter } from './adapters/hupijiao.js'; // 引入依赖：声明本文件使用的外部能力
import { xunhuAdapter } from './adapters/xunhu.js'; // 引入依赖：声明本文件使用的外部能力
import { paypalAdapter } from './adapters/paypal.js'; // 引入依赖：声明本文件使用的外部能力
import { stripeAdapter } from './adapters/stripe.js'; // 引入依赖：声明本文件使用的外部能力
import { alipayEntAdapter } from './adapters/alipay-ent.js'; // 引入依赖：声明本文件使用的外部能力

/** 新增五渠道适配器清单 */
export const EXT_ADAPTERS: readonly ChannelAdapter[] = [ // 业务步骤：推进当前流程的下一项处理
  hupijiaoAdapter, // 业务步骤：推进当前流程的下一项处理
  xunhuAdapter, // 业务步骤：推进当前流程的下一项处理
  paypalAdapter, // 业务步骤：推进当前流程的下一项处理
  stripeAdapter, // 业务步骤：推进当前流程的下一项处理
  alipayEntAdapter, // 业务步骤：推进当前流程的下一项处理
]; // 集合结束：数组或索引表达式收尾

const ADAPTER_MAP = new Map<ExtChannelId, ChannelAdapter>(EXT_ADAPTERS.map((adapter) => [adapter.id, adapter])); // 保存 ADAPTER_MAP：承载本步骤的计算结果供后续使用

/** 按渠道 id 取适配器；非扩展渠道返回 undefined（走既有四渠道链路） */
export function getAdapter(id: string): ChannelAdapter | undefined { // 定义函数 getAdapter：封装可复用业务步骤
  return ADAPTER_MAP.get(id as ExtChannelId); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

export interface ChannelMeta { // 声明类型 ChannelMeta：约束跨模块数据结构
  id: AnyChannelId; // 对象字段：声明结构中的一项数据
  label: string; // 对象字段：声明结构中的一项数据
  /** 渠道是否对外可用（未配置即关闭，前端据此置灰） */
  enabled: boolean; // 对象字段：声明结构中的一项数据
  /** 凭证是否齐全；未配置显式 false，绝不伪造已启用 */
  configured: boolean; // 对象字段：声明结构中的一项数据
  /** 是否沙箱 / 测试环境 */
  sandbox: boolean; // 对象字段：声明结构中的一项数据
  /** 支持的能力点 */
  methods: Array<'order' | 'notify' | 'refund' | 'offline_confirm'>; // 对象字段：声明结构中的一项数据
  note: string; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

/** 既有四渠道的配置判定（与 src/payments.ts 历史口径保持一致） */
function legacyChannels(env: Record<string, string | undefined>): ChannelMeta[] { // 定义函数 legacyChannels：封装可复用业务步骤
  const hasAlipay = !!(env.MIM_ALIPAY_APP_ID && env.MIM_ALIPAY_PRIVATE_KEY); // 保存 hasAlipay：承载本步骤的计算结果供后续使用
  const hasWechat = !!( // 保存 hasWechat：承载本步骤的计算结果供后续使用
    env.MIM_WECHAT_APP_ID && // 业务步骤：推进当前流程的下一项处理
    env.MIM_WECHAT_MCH_ID && // 业务步骤：推进当前流程的下一项处理
    env.MIM_WECHAT_API_V3_KEY && // 业务步骤：推进当前流程的下一项处理
    env.MIM_WECHAT_SERIAL_NO && // 业务步骤：推进当前流程的下一项处理
    env.MIM_WECHAT_PRIVATE_KEY && // 业务步骤：推进当前流程的下一项处理
    env.MIM_WECHAT_NOTIFY_URL && // 业务步骤：推进当前流程的下一项处理
    env.MIM_WECHAT_PLATFORM_PUBLIC_KEY // 业务步骤：推进当前流程的下一项处理
  ); // 调用结束：参数列表与链式调用收尾
  const sandboxOn = env.MIM_PAYMENT_SANDBOX === '1'; // 保存 sandboxOn：承载本步骤的计算结果供后续使用
  return [ // 返回结果：把本步骤产物交给调用方
    { // 业务步骤：推进当前流程的下一项处理
      id: 'manual', // 对象字段：声明结构中的一项数据
      label: '人工转账 / 线下收款', // 对象字段：声明结构中的一项数据
      enabled: true, // 对象字段：声明结构中的一项数据
      configured: true, // 对象字段：声明结构中的一项数据
      sandbox: false, // 对象字段：声明结构中的一项数据
      methods: ['offline_confirm'], // 对象字段：声明结构中的一项数据
      note: '展示收款说明，运营核对到账后手动履约', // 对象字段：声明结构中的一项数据
    }, // 结束代码块：本层作用域收尾
    { // 业务步骤：推进当前流程的下一项处理
      id: 'alipay', // 对象字段：声明结构中的一项数据
      label: '支付宝当面付', // 对象字段：声明结构中的一项数据
      enabled: hasAlipay, // 对象字段：声明结构中的一项数据
      configured: hasAlipay, // 对象字段：声明结构中的一项数据
      sandbox: false, // 对象字段：声明结构中的一项数据
      methods: ['order', 'notify', 'refund'], // 对象字段：声明结构中的一项数据
      note: hasAlipay ? '已配置，可生成扫码订单' : '缺 MIM_ALIPAY_APP_ID / MIM_ALIPAY_PRIVATE_KEY', // 对象字段：声明结构中的一项数据
    }, // 结束代码块：本层作用域收尾
    { // 业务步骤：推进当前流程的下一项处理
      id: 'wechat', // 对象字段：声明结构中的一项数据
      label: '微信企业支付（Native）', // 对象字段：声明结构中的一项数据
      enabled: hasWechat, // 对象字段：声明结构中的一项数据
      configured: hasWechat, // 对象字段：声明结构中的一项数据
      sandbox: false, // 对象字段：声明结构中的一项数据
      methods: ['order', 'notify', 'refund'], // 对象字段：声明结构中的一项数据
      note: hasWechat ? '已配置，可生成扫码订单并接收回调' : '缺 AppID / 商户号 / APIv3 密钥 / 证书私钥 / 回调地址 / 平台公钥', // 对象字段：声明结构中的一项数据
    }, // 结束代码块：本层作用域收尾
    { // 业务步骤：推进当前流程的下一项处理
      id: 'sandbox', // 对象字段：声明结构中的一项数据
      label: '沙箱支付（仅测试）', // 对象字段：声明结构中的一项数据
      enabled: sandboxOn, // 对象字段：声明结构中的一项数据
      configured: sandboxOn, // 对象字段：声明结构中的一项数据
      sandbox: true, // 对象字段：声明结构中的一项数据
      methods: ['order', 'notify'], // 对象字段：声明结构中的一项数据
      note: '仅当 MIM_PAYMENT_SANDBOX=1 时可用', // 对象字段：声明结构中的一项数据
    }, // 结束代码块：本层作用域收尾
  ]; // 集合结束：数组或索引表达式收尾
} // 结束函数体：本层作用域收尾

/** 九渠道矩阵：既有四渠道 + 新增五渠道；未配置渠道 configured=false 并给出缺变量说明 */
export function channelMatrix(env: Record<string, string | undefined>): ChannelMeta[] { // 定义函数 channelMatrix：封装可复用业务步骤
  const ext: ChannelMeta[] = EXT_ADAPTERS.map((adapter) => { // 保存 ext：承载本步骤的计算结果供后续使用
    const configured = adapter.configured(env); // 保存 configured：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      id: adapter.id, // 对象字段：声明结构中的一项数据
      label: adapter.label, // 对象字段：声明结构中的一项数据
      enabled: configured, // 对象字段：声明结构中的一项数据
      configured, // 业务步骤：推进当前流程的下一项处理
      sandbox: adapter.sandbox(env), // 对象字段：声明结构中的一项数据
      methods: ['order', 'notify', 'refund'], // 对象字段：声明结构中的一项数据
      note: configured ? '凭证齐全，可下单与接收回调' : '凭证未配置，下单 / 回调将返回 503', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }); // 结束函数体：本层作用域收尾
  return [...legacyChannels(env), ...ext]; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾
