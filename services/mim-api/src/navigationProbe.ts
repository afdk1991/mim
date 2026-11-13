/**
 * 导航站出站可达性探测（安全加固包抽离）。
 *
 * 与 routes/navigation.ts 的边界：
 *   - 本模块只负责「校验出站目标安全 → 发起探测 → 归一结果」，不碰库表；
 *   - 所有出站请求先过 assertSafeOutboundUrl（协议白名单 / 私网 / 环回 / 元数据 / 编码 IP / DNS 二次校验）；
 *   - fetch 保持 redirect=manual：3xx 本身即视为目标存在，不跟随到跳转目标（避免探测链路被带到内网）；
 *   - 网络异常 / 超时 / 命中内网一律记 broken，不冒充可达。
 */

import { classifyProbe, type NavLinkStatus } from '@mim/core-domain'; // 引入依赖、类型或本地模块绑定
import { assertSafeOutboundUrl } from './security.js'; // 引入依赖、类型或本地模块绑定

/** 探测超时上限：外部站点不可达时不能拖住请求 */
const PROBE_TIMEOUT_MS = 8_000;

export interface ProbeResult { // 导出接口 ProbeResult：跨模块共享的对象契约
  status: NavLinkStatus; // 对象字段 status：记录一项配置或数据
  httpStatus: number | null; // 对象字段 httpStatus：记录一项配置或数据
  latencyMs: number; // 对象字段 latencyMs：记录一项配置或数据
} // 代码块结束

/**
 * 对单条出站链接发起可达性探测。
 * @param target 已补齐 origin 的绝对地址（相对路径由路由层先 resolveProbeTarget）
 * @param trustedHost 受信站点 origin 的 host:port；自指目标跳过私网/环回复核
 */
export async function probeOutbound(target: string, trustedHost?: string): Promise<ProbeResult> {
  const started = Date.now(); // 常量 started：保存固定配置或一次性派生值
  try { // 异常捕获起点：包裹可能抛出错误的操作
    // 先做 SSRF 校验：协议白名单 + 私网/环回/元数据拒绝 + DNS 解析后二次复核；
    // 站内相对路径补齐到配置 origin 的自指目标走受信例外。
    await assertSafeOutboundUrl(target, { trustedHost });
    const res = await fetch(target, { // 常量 res：保存固定配置或一次性派生值
      method: 'GET', // 对象字段 method：记录一项配置或数据
      redirect: 'manual', // 不跟随跳转，3xx 记录为可达；跳转目标由后续访问方自行走安全 fetch
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), // 对象字段 signal：记录一项配置或数据
      headers: { 'user-agent': 'mim-navigation-probe/1.0' }, // 对象字段 headers：记录一项配置或数据
    }); // 代码块结束
    const latencyMs = Date.now() - started; // 常量 latencyMs：保存固定配置或一次性派生值
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await res.body?.cancel(); // 主动丢弃响应体，避免连接悬挂
    } catch { // 代码块结束
      /* 响应体取消失败不影响探测结论 */
    }
    return { status: classifyProbe(res.status, null), httpStatus: res.status, latencyMs }; // 返回当前函数的处理结果
  } catch (err) { // 代码块结束
    return { status: classifyProbe(null, (err as Error).message), httpStatus: null, latencyMs: Date.now() - started }; // 返回当前函数的处理结果
  } // 代码块结束
} // 代码块结束
