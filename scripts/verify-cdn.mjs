#!/usr/bin/env node
/**
 * CDN 接入实测探测（安全加固与性能包，2026-11-13）。
 *
 * 对同一静态资源连发两次，读取回源 / 边缘响应头证据：
 *   - cf-cache-status（Cloudflare）、x-cache（CloudFront / 通用）、age（边缘缓存时长）、server；
 *   - 命中任一缓存特征头判定 CDN: detected，否则 CDN: not-detected。
 *
 * 诚实约定：未检测到边缘特征不伪造结论；探测失败 / 无网络记 not-detected 并打印 not-configured。
 * 退出码恒为 0（探测类门禁，仅给证据；阻断由 CI 人工或后续阈值规则决定）。
 *
 * 用法：
 *   node scripts/verify-cdn.mjs
 *   MIM_CDN_BASE=https://mim.mixm.top MIM_CDN_PROBE_PATH=/ node scripts/verify-cdn.mjs
 */

const BASE = (process.env.MIM_CDN_BASE ?? 'https://mim.mixm.top').replace(/\/+$/, ''); // 常量 BASE：保存固定配置或一次性派生值
const PATHNAME = process.env.MIM_CDN_PROBE_PATH ?? '/'; // 常量 PATHNAME：保存固定配置或一次性派生值
const PROBE_URL = `${BASE}${PATHNAME.startsWith('/') ? PATHNAME : `/${PATHNAME}`}`; // 常量 PROBE_URL：保存固定配置或一次性派生值
const TIMEOUT_MS = 10_000; // 常量 TIMEOUT_MS：保存固定配置或一次性派生值

const CACHE_HEADERS = ['cf-cache-status', 'x-cache', 'age', 'server', 'via', 'x-served-by']; // 常量 CACHE_HEADERS：保存固定配置或一次性派生值

function evidence(headers) { // 函数 evidence：封装一段可复用的处理逻辑
  const out = {}; // 常量 out：保存固定配置或一次性派生值
  for (const name of CACHE_HEADERS) { // 循环：逐项遍历集合并执行相同处理
    const value = headers.get(name); // 常量 value：保存固定配置或一次性派生值
    if (value !== null) out[name] = value; // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束
  return out; // 返回当前函数的处理结果
} // 代码块结束

function looksCached(headers) { // 函数 looksCached：封装一段可复用的处理逻辑
  const cf = headers.get('cf-cache-status'); // 常量 cf：保存固定配置或一次性派生值
  if (cf && !/^(off|no-cache)$/i.test(cf)) return { by: 'cf-cache-status', value: cf }; // 条件分支：按判断结果选择后续处理路径
  const xCache = headers.get('x-cache'); // 常量 xCache：保存固定配置或一次性派生值
  if (xCache && /hit|miss|cached|cloudfront|edge/i.test(xCache)) return { by: 'x-cache', value: xCache }; // 条件分支：按判断结果选择后续处理路径
  if (headers.has('age') && headers.get('age') !== null && headers.get('age') !== undefined) { // 条件分支：按判断结果选择后续处理路径
    return { by: 'age', value: headers.get('age') }; // 返回当前函数的处理结果
  } // 代码块结束
  return null; // 返回当前函数的处理结果
} // 代码块结束

async function probeOnce(tag) { // 函数 probeOnce：封装一段可复用的处理逻辑
  const res = await fetch(PROBE_URL, { // 常量 res：保存固定配置或一次性派生值
    method: 'GET', // 对象字段 method：记录一项配置或数据
    signal: AbortSignal.timeout(TIMEOUT_MS), // 对象字段 signal：记录一项配置或数据
    redirect: 'follow', // 对象字段 redirect：记录一项配置或数据
  }); // 代码块结束
  return { tag, status: res.status, headers: evidence(res.headers) }; // 返回当前函数的处理结果
} // 代码块结束

async function main() { // 函数 main：封装一段可复用的处理逻辑
  console.log(`[verify-cdn] 探测目标: ${PROBE_URL}`); // 向控制台输出运行日志或错误信息
  const samples = []; // 常量 samples：保存固定配置或一次性派生值
  let failure = null; // 可变变量 failure：运行过程中会被重新赋值

  for (const tag of ['第 1 次', '第 2 次']) { // 循环：逐项遍历集合并执行相同处理
    try { // 异常捕获起点：包裹可能抛出错误的操作
      samples.push(await probeOnce(tag)); // 执行当前业务步骤
    } catch (err) { // 代码块结束
      failure = err instanceof Error ? err.message : String(err); // 赋值：更新变量 failure 的取值
      console.error(`[verify-cdn] ${tag} 请求失败: ${failure}`); // 向控制台输出运行日志或错误信息
    } // 代码块结束
  } // 代码块结束

  let detected = null; // 可变变量 detected：运行过程中会被重新赋值
  for (const sample of samples) { // 循环：逐项遍历集合并执行相同处理
    const hit = looksCached(new Map(Object.entries(sample.headers))); // 常量 hit：保存固定配置或一次性派生值
    if (hit) { detected = hit; break; } // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束

  for (const sample of samples) { // 循环：逐项遍历集合并执行相同处理
    console.log(`  ${sample.tag} HTTP ${sample.status}`); // 向控制台输出运行日志或错误信息
    for (const [k, v] of Object.entries(sample.headers)) console.log(`    ${k}: ${v}`); // 循环：逐项遍历集合并执行相同处理
  } // 代码块结束

  if (detected) { // 条件分支：按判断结果选择后续处理路径
    console.log(`CDN: detected（${detected.by}=${detected.value}）`); // 向控制台输出运行日志或错误信息
  } else { // 代码块结束
    console.log('CDN: not-detected'); // 向控制台输出运行日志或错误信息
    console.log('not-configured: 响应头中未观察到边缘缓存特征（cf-cache-status / x-cache / age）；如已接入 CDN，请复核回源头是否被回源服务覆盖。'); // 向控制台输出运行日志或错误信息
    if (failure) console.log(`probe-error: ${failure}`); // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束

  process.exit(0); // 执行当前业务步骤
} // 代码块结束

main().catch((err) => { // 调用 main 并处理其返回结果
  console.error(`[verify-cdn] 执行异常: ${err instanceof Error ? err.message : String(err)}`); // 向控制台输出运行日志或错误信息
  console.log('CDN: not-detected'); // 向控制台输出运行日志或错误信息
  console.log('not-configured: 探测脚本自身异常，未取得边缘证据。'); // 向控制台输出运行日志或错误信息
  process.exit(0); // 执行当前业务步骤
}); // 代码块结束
