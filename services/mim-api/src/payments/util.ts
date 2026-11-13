/** 扩展渠道共享工具：凭证判定、签名 canonical 串、常量时间比较、URL 拼装与上游 HTTP 调用 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'; // 引入依赖、类型或本地模块绑定
import { AppError } from '@mim/core-domain'; // 引入依赖、类型或本地模块绑定

/** 读取一组凭证，返回缺失的变量名清单（空数组即齐全） */
export function missingEnv(env: Record<string, string | undefined>, keys: string[]): string[] {
  return keys.filter((key) => !(env[key] ?? '').trim()); // 返回当前函数的处理结果
} // 代码块结束

/** 凭证不齐时抛 503 PROVIDER_NOT_CONFIGURED，并在 details 指明缺失变量 */
export function requireConfigured(env: Record<string, string | undefined>, keys: string[], label: string): void {
  const missing = missingEnv(env, keys); // 常量 missing：保存固定配置或一次性派生值
  if (missing.length > 0) { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('PROVIDER_NOT_CONFIGURED', `${label}渠道未配置`, { env: missing }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
} // 代码块结束

/**
 * 字典序拼接 canonical 串：key1=value1&key2=value2。
 * 跳过空值与签名字段（hash/sign/sign_type），签名字段不参与签名是各家聚合支付的共同规则。
 */
export function canonicalSorted(params: Record<string, unknown>, skip: string[] = ['hash', 'sign', 'sign_type']): string {
  return Object.keys(params) // 返回当前函数的处理结果
    .filter((key) => !skip.includes(key)) // 执行当前业务步骤
    .sort() // 执行当前业务步骤
    .map((key) => [key, params[key]] as const) // 执行当前业务步骤
    .filter(([, value]) => value !== null && value !== undefined && String(value) !== '') // 执行当前业务步骤
    .map(([key, value]) => `${key}=${String(value)}`) // 执行当前业务步骤
    .join('&'); // 执行当前业务步骤
} // 代码块结束

/** MD5 小写十六进制（虎皮椒签名算法） */
export function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex'); // 返回当前函数的处理结果
} // 代码块结束

/** HMAC-SHA256 十六进制 */
export function hmacSha256Hex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input, 'utf8').digest('hex'); // 返回当前函数的处理结果
} // 代码块结束

/** 常量时间比较两个十六进制串，避免逐字节提前返回的计时侧信道 */
export function secureEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false; // 条件分支：按判断结果选择后续处理路径
  const left = Buffer.from(a, 'hex'); // 常量 left：保存固定配置或一次性派生值
  const right = Buffer.from(b, 'hex'); // 常量 right：保存固定配置或一次性派生值
  return left.length === right.length && timingSafeEqual(left, right); // 返回当前函数的处理结果
} // 代码块结束

/** 随机 32 位十六进制 nonce */
export function nonce(): string {
  return randomBytes(16).toString('hex'); // 返回当前函数的处理结果
} // 代码块结束

/** 分 → 元字符串（两位小数） */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2); // 返回当前函数的处理结果
} // 代码块结束

/** 元字符串 → 分（四舍五入到整数） */
export function yuanToCents(yuan: string | number): number {
  const value = typeof yuan === 'string' ? Number(yuan) : yuan; // 常量 value：保存固定配置或一次性派生值
  if (!Number.isFinite(value)) throw new AppError('VALIDATION_FAILED', '回调金额格式非法'); // 条件分支：按判断结果选择后续处理路径
  return Math.round(value * 100); // 返回当前函数的处理结果
} // 代码块结束

/** 去掉 URL 尾部斜杠 */
export function trimBase(base: string): string {
  return base.replace(/\/+$/, ''); // 返回当前函数的处理结果
} // 代码块结束

/**
 * 拼装回调 / 跳转地址：优先渠道专属 URL；否则用 MIM_PUBLIC_BASE_URL 拼站内路径。
 * 不硬编码任何域名；两者都缺省时返回空串，由 configured() 判为未配置。
 */
export function assembleUrl(
  env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
  channelUrl: string | undefined, // 对象字段 channelUrl：记录一项配置或数据
  path: string, // 对象字段 path：记录一项配置或数据
): string { // 执行当前业务步骤
  const explicit = (channelUrl ?? '').trim(); // 常量 explicit：保存固定配置或一次性派生值
  if (explicit) return explicit; // 条件分支：按判断结果选择后续处理路径
  const base = (env.MIM_PUBLIC_BASE_URL ?? '').trim(); // 常量 base：保存固定配置或一次性派生值
  if (!base) return ''; // 条件分支：按判断结果选择后续处理路径
  return `${trimBase(base)}${path}`; // 返回当前函数的处理结果
} // 代码块结束

/** 上游 JSON POST：统一抛 502 区分网络 / 上游故障，不吞错误 */
export async function upstreamJson(
  url: string, // 对象字段 url：记录一项配置或数据
  headers: Record<string, string>, // 对象字段 headers：记录一项配置或数据
  body: string, // 对象字段 body：记录一项配置或数据
  contentType: string, // 对象字段 contentType：记录一项配置或数据
): Promise<{ status: number; json: unknown; text: string }> { // 执行当前业务步骤
  let res: Response; // 可变变量 res：运行过程中会被重新赋值
  try { // 异常捕获起点：包裹可能抛出错误的操作
    res = await fetch(url, { method: 'POST', headers: { 'content-type': contentType, ...headers }, body }); // 赋值：更新变量 res 的取值
  } catch (error) { // 代码块结束
    throw new AppError('INTERNAL_ERROR', `上游渠道网络不可达: ${error instanceof Error ? error.message : String(error)}`); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  const text = await res.text(); // 常量 text：保存固定配置或一次性派生值
  let json: unknown = null; // 可变变量 json：运行过程中会被重新赋值
  try { // 异常捕获起点：包裹可能抛出错误的操作
    json = text ? (JSON.parse(text) as unknown) : null; // 赋值：更新变量 json 的取值
  } catch { // 代码块结束
    json = null; // 赋值：更新变量 json 的取值
  } // 代码块结束
  return { status: res.status, json, text }; // 返回当前函数的处理结果
} // 代码块结束

/** 把回调报文归一为对象：JSON 优先，失败再按 form-urlencoded 解析 */
export function parseNotifyBody(rawBody: string): Record<string, string> {
  const trimmed = (rawBody ?? '').trim(); // 常量 trimmed：保存固定配置或一次性派生值
  if (!trimmed) return {}; // 条件分支：按判断结果选择后续处理路径
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const parsed = JSON.parse(trimmed) as unknown; // 常量 parsed：保存固定配置或一次性派生值
    if (parsed && typeof parsed === 'object') { // 条件分支：按判断结果选择后续处理路径
      const out: Record<string, string> = {}; // 常量 out：保存固定配置或一次性派生值
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) { // 循环：逐项遍历集合并执行相同处理
        if (value === null || value === undefined) continue; // 条件分支：按判断结果选择后续处理路径
        out[key] = String(value); // 赋值：更新变量 out 的取值
      } // 代码块结束
      return out; // 返回当前函数的处理结果
    } // 代码块结束
  } catch { // 代码块结束
    // 落到 form 解析
  }
  const params = new URLSearchParams(trimmed); // 常量 params：保存固定配置或一次性派生值
  const out: Record<string, string> = {}; // 常量 out：保存固定配置或一次性派生值
  for (const [key, value] of params.entries()) out[key] = value; // 循环：逐项遍历集合并执行相同处理
  return out; // 返回当前函数的处理结果
} // 代码块结束
