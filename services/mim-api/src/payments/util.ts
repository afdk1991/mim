/** 扩展渠道共享工具：凭证判定、签名 canonical 串、常量时间比较、URL 拼装与上游 HTTP 调用 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '@mim/core-domain';

/** 读取一组凭证，返回缺失的变量名清单（空数组即齐全） */
export function missingEnv(env: Record<string, string | undefined>, keys: string[]): string[] {
  return keys.filter((key) => !(env[key] ?? '').trim());
}

/** 凭证不齐时抛 503 PROVIDER_NOT_CONFIGURED，并在 details 指明缺失变量 */
export function requireConfigured(env: Record<string, string | undefined>, keys: string[], label: string): void {
  const missing = missingEnv(env, keys);
  if (missing.length > 0) {
    throw new AppError('PROVIDER_NOT_CONFIGURED', `${label}渠道未配置`, { env: missing });
  }
}

/**
 * 字典序拼接 canonical 串：key1=value1&key2=value2。
 * 跳过空值与签名字段（hash/sign/sign_type），签名字段不参与签名是各家聚合支付的共同规则。
 */
export function canonicalSorted(params: Record<string, unknown>, skip: string[] = ['hash', 'sign', 'sign_type']): string {
  return Object.keys(params)
    .filter((key) => !skip.includes(key))
    .sort()
    .map((key) => [key, params[key]] as const)
    .filter(([, value]) => value !== null && value !== undefined && String(value) !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
}

/** MD5 小写十六进制（虎皮椒签名算法） */
export function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/** HMAC-SHA256 十六进制 */
export function hmacSha256Hex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input, 'utf8').digest('hex');
}

/** 常量时间比较两个十六进制串，避免逐字节提前返回的计时侧信道 */
export function secureEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 随机 32 位十六进制 nonce */
export function nonce(): string {
  return randomBytes(16).toString('hex');
}

/** 分 → 元字符串（两位小数） */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元字符串 → 分（四舍五入到整数） */
export function yuanToCents(yuan: string | number): number {
  const value = typeof yuan === 'string' ? Number(yuan) : yuan;
  if (!Number.isFinite(value)) throw new AppError('VALIDATION_FAILED', '回调金额格式非法');
  return Math.round(value * 100);
}

/** 去掉 URL 尾部斜杠 */
export function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

/**
 * 拼装回调 / 跳转地址：优先渠道专属 URL；否则用 MIM_PUBLIC_BASE_URL 拼站内路径。
 * 不硬编码任何域名；两者都缺省时返回空串，由 configured() 判为未配置。
 */
export function assembleUrl(
  env: Record<string, string | undefined>,
  channelUrl: string | undefined,
  path: string,
): string {
  const explicit = (channelUrl ?? '').trim();
  if (explicit) return explicit;
  const base = (env.MIM_PUBLIC_BASE_URL ?? '').trim();
  if (!base) return '';
  return `${trimBase(base)}${path}`;
}

/** 上游 JSON POST：统一抛 502 区分网络 / 上游故障，不吞错误 */
export async function upstreamJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  contentType: string,
): Promise<{ status: number; json: unknown; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': contentType, ...headers }, body });
  } catch (error) {
    throw new AppError('INTERNAL_ERROR', `上游渠道网络不可达: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

/** 把回调报文归一为对象：JSON 优先，失败再按 form-urlencoded 解析 */
export function parseNotifyBody(rawBody: string): Record<string, string> {
  const trimmed = (rawBody ?? '').trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === null || value === undefined) continue;
        out[key] = String(value);
      }
      return out;
    }
  } catch {
    // 落到 form 解析
  }
  const params = new URLSearchParams(trimmed);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}
