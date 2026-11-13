/**
 * tools/db-replace-domain/lib/replace.mjs
 *
 * 纯文本层面的域名批量替换核心（零新增依赖）。
 *
 * 覆盖三类形态：
 *   1. SQL/正文里的普通 URL：http/https、协议相对 //、www / 非 www 变体；
 *   2. PHP 序列化字符串：s:<len>:"..."; —— 域名变长 / 变短时按字节重算长度，
 *      否则反序列化会被截断或报错；
 *   3. 裸域名：old.com → new.com（在带协议 / www 的变体之后处理，避免二次替换）。
 */

import { Buffer } from 'node:buffer';

/** 正则转义。 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 规范化域名：去掉协议头、协议相对头与 www.，返回裸域名。
 * @param {string} raw
 * @returns {string}
 */
export function bareDomain(raw) {
  return String(raw || '')
    .replace(/^https?:\/\//, '')
    .replace(/^\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
}

/**
 * 构造有序替换对：变体齐全，按命中串长度降序，保证先替换长串再替换裸域名。
 * @param {string} from
 * @param {string} to
 * @returns {Array<[string, string]>}
 */
export function buildPairs(from, to) {
  const f = bareDomain(from);
  const t = bareDomain(to);
  if (!f || !t) throw new Error('from / to 域名不能为空');
  const pairs = [];
  for (const scheme of ['https://', 'http://', '//']) {
    pairs.push([`${scheme}www.${f}`, `${scheme}www.${t}`]);
    pairs.push([`${scheme}${f}`, `${scheme}${t}`]);
  }
  pairs.push([`www.${f}`, `www.${t}`]);
  pairs.push([f, t]);

  const seen = new Set();
  const out = [];
  for (const [a, b] of pairs) {
    if (!seen.has(a)) {
      seen.add(a);
      out.push([a, b]);
    }
  }
  out.sort((x, y) => y[0].length - x[0].length);
  return out;
}

/** PHP 序列化字符串：s:<字节长度>:"(内容)"; 内容内允许反斜杠转义。 */
const SERIALIZED_RE = /s:(\d+):"((?:[^"\\]|\\.)*)";/g;

/** 非序列化段的普通替换。 */
function ordinaryReplace(text, pairs) {
  let out = text;
  for (const [a, b] of pairs) out = out.split(a).join(b);
  return out;
}

/**
 * 替换整段文本，序列化串长度按 UTF-8 字节重算。
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function replaceText(text, from, to) {
  const pairs = buildPairs(from, to);
  let out = '';
  let last = 0;
  let m;
  SERIALIZED_RE.lastIndex = 0;
  while ((m = SERIALIZED_RE.exec(text))) {
    out += ordinaryReplace(text.slice(last, m.index), pairs);
    const inner = m[2];
    const newInner = ordinaryReplace(inner, pairs);
    const len = Buffer.byteLength(newInner, 'utf8');
    out += `s:${len}:"${newInner}";`;
    last = m.index + m[0].length;
  }
  out += ordinaryReplace(text.slice(last), pairs);
  return out;
}

/**
 * 统计将命中的替换次数（最长优先、非重叠扫描）。
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function countReplacements(text, from, to) {
  const pairs = buildPairs(from, to);
  const re = new RegExp(pairs.map(([a]) => escapeRe(a)).join('|'), 'g');
  return (text.match(re) || []).length;
}
