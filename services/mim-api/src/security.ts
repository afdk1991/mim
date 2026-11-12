/**
 * 内容与链接安全工具：
 *   - 图形验证码：本地生成 SVG，答案只存摘要；
 *   - 内容审核：可选接入百度文本审核，未配置时放行并明确标记；
 *   - 远程链接校验：拒绝回环、私网、链路本地与云元数据地址，降低 SSRF 风险。
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Db } from './types.js'; // 数据库连接类型（编译期擦除）

const CAPTCHA_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉易混的 0/O/1/I
const CAPTCHA_TTL_MS = 10 * 60 * 1000; // 10 分钟过期

/** 生成一个 5 位图形验证码：返回 id、SVG 与过期时间；答案摘要落库由调用方完成。 */
export function createCaptcha(): { id: string; answer: string; svg: string; expires_at: string } {
  const id = `cap-${randomUUID()}`;
  const answer = Array.from({ length: 5 }, () => CAPTCHA_ALPHABET[randomInt(0, CAPTCHA_ALPHABET.length)]).join('');
  const chars = answer
    .split('')
    .map((char, index) => {
      const x = 18 + index * 26 + randomInt(-3, 4);
      const y = 30 + randomInt(-4, 5);
      const rotate = randomInt(-18, 19);
      return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" font-size="26" font-family="monospace" fill="#0f172a">${char}</text>`;
    })
    .join('');
  const lines = Array.from({ length: 4 }, () => {
    const y1 = randomInt(8, 48);
    const y2 = randomInt(8, 48);
    return `<line x1="0" y1="${y1}" x2="160" y2="${y2}" stroke="#94a3b8" stroke-width="1" opacity="0.5"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="56" viewBox="0 0 160 56" role="img" aria-label="图形验证码"><rect width="160" height="56" fill="#f8fafc" rx="8"/>${lines}${chars}</svg>`;
  return { id, answer, svg, expires_at: new Date(Date.now() + CAPTCHA_TTL_MS).toISOString() };
}

/** 答案摘要：统一大写后 sha256，避免大小写误差。 */
export function captchaHash(answer: string): string {
  return createHash('sha256').update(answer.trim().toUpperCase()).digest('hex');
}

/** 校验并消费验证码：一次性使用，过期或错误均失败。 */
export function consumeCaptcha(db: Db, id: string, answer: string): boolean {
  const row = db.prepare('SELECT answer_hash, expires_at, used_at FROM captchas WHERE id = ?').get(id) as
    | { answer_hash: string; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return false;
  if (row.answer_hash !== captchaHash(answer)) return false;
  db.prepare('UPDATE captchas SET used_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return true;
}

/** 百度文本审核结果：pass 放行，review 需人工复核（按拒绝处理），reject 拒绝。 */
export interface AuditResult {
  ok: boolean;
  provider: 'baidu' | 'none';
  reason?: string;
}

let baiduToken: { token: string; expiresAt: number } | null = null; // 进程内缓存，避免每次审核都换 token

/** 获取百度 access_token：client_credentials 模式，缓存 25 小时。 */
async function baiduAccessToken(apiKey: string, secretKey: string): Promise<string | null> {
  if (baiduToken && baiduToken.expiresAt > Date.now()) return baiduToken.token;
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  baiduToken = { token: json.access_token, expiresAt: Date.now() + Math.min(json.expires_in ?? 90000, 90000) * 1000 };
  return json.access_token;
}

/** 审核文本：未配置百度审核时放行（provider=none），配置后按百度结论拒绝违规内容。 */
export async function auditText(env: Record<string, string | undefined>, text: string): Promise<AuditResult> {
  const apiKey = env.MIM_BAIDU_AUDIT_API_KEY?.trim();
  const secretKey = env.MIM_BAIDU_AUDIT_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) return { ok: true, provider: 'none' };
  const token = await baiduAccessToken(apiKey, secretKey);
  if (!token) return { ok: false, provider: 'baidu', reason: '内容审核服务不可用' };
  const res = await fetch(`https://aip.baidubce.com/rest/2.0/solution/v1/text_censor/v2/user_defined?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text }),
  });
  if (!res.ok) return { ok: false, provider: 'baidu', reason: '内容审核服务不可用' };
  const json = (await res.json()) as { conclusionType?: number; conclusion?: string };
  if (json.conclusionType === 1) return { ok: true, provider: 'baidu' };
  return { ok: false, provider: 'baidu', reason: json.conclusion || '内容未通过审核' };
}

/** 判断 IPv4 是否属于私网 / 回环 / 链路本地 / 云元数据段。 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** 判断 IPv6 是否属于回环 / 链路本地 / 唯一本地 / IPv4 映射私网。 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/** 校验远程 URL：只允许 http/https，解析所有 A/AAAA 记录并拒绝私网目标；相对路径由调用方放行。 */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported url protocol');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('private host is not allowed');
  if (isIP(host)) {
    if (isIP(host) === 4 ? isPrivateIPv4(host) : isPrivateIPv6(host)) throw new Error('private address is not allowed');
    return;
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (records.length === 0) throw new Error('host cannot be resolved');
  for (const record of records) {
    if (record.family === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address)) {
      throw new Error('private address is not allowed');
    }
  }
}
