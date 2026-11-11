/**
 * 模块商城「真实能力」执行层。
 *
 * 每个能力键对应 `@mim/core-domain` 的 MODULE_CAPABILITIES 一条定义；
 * 路由 `POST /api/v1/modules/:code/invoke` 在「已登录 + 已解锁 + 模块有绑定能力」三条通过后，
 * 才会调用这里的 handler 真正干活，并把结果按 output_kind 交给前端渲染。
 *
 * 通用能力一律走成熟第三方库（铁律五）：Markdown 用 marked、二维码用 qrcode、
 * cron 解析用 cron-parser；JSON 与摘要/编码属语言内建能力，用原生实现避免引入无意义的包。
 */

import { createHash } from 'node:crypto'; // 摘要计算：MD5 / SHA 系列走 Node 内建加密模块
import { CronExpressionParser } from 'cron-parser'; // cron 表达式解析与未来触发时间推算
import { marked } from 'marked'; // Markdown → HTML 渲染（成熟库，避免自写解析器）
import QRCode from 'qrcode'; // 二维码生成：输出 PNG dataURL，前端可直接显示
import { parse as parseCsvSync } from 'csv-parse/sync'; // CSV / TSV 解析：成熟库处理引号、转义与跨行字段
import { createTwoFilesPatch } from 'diff'; // 统一差异（unified diff）文本生成
import { Parser as ExpressionParser } from 'expr-eval'; // 数学表达式求值：只做数值运算，不执行任意代码
import mustache from 'mustache'; // Mustache 模板渲染：成熟模板引擎，不手写替换逻辑
import { format as formatSqlText } from 'sql-formatter'; // SQL 语句格式化：支持多种方言
import { parse as parseYamlText, stringify as stringifyYamlText } from 'yaml'; // YAML ↔ JSON 互转
import { AppError } from '@mim/core-domain'; // 统一业务错误：校验失败一律抛 VALIDATION_FAILED

/** 能力调用入参：文本主体 + 能力私有选项（选项由各 handler 自行校验，避免一个巨型 schema） */
export interface CapabilityInput {
  text: string; // 用户输入的文本主体（JSON / Markdown / 待编码文本 / cron 表达式等）
  options: Record<string, unknown>; // 能力私有选项（mode / algo / op / direction / size / count）
}

/** 能力调用结果：output 为可直接展示的字符串，output_kind 决定前端用哪种渲染方式 */
export interface CapabilityResult {
  output: string; // 结果正文：纯文本 / JSON 字符串 / HTML / 图片 dataURL
  output_kind: 'text' | 'json' | 'html' | 'image'; // 输出形态，与 core-domain 定义保持一致
  meta: Record<string, unknown>; // 附加信息（字节数、算法、触发时间数量等），便于前端展示细节
}

/** 能力处理器签名：可能异步（二维码编码是 Promise），统一按异步处理 */
export type CapabilityHandler = (input: CapabilityInput) => Promise<CapabilityResult>;

/** 从选项里取字符串值：缺失时回落默认，避免各 handler 重复写类型判断 */
function optionString(options: Record<string, unknown>, key: string, fallback: string): string {
  const value = options[key]; // 取出原始值
  return typeof value === 'string' && value.length > 0 ? value : fallback; // 非空字符串才采用，否则回落默认值
} // optionString 结束

/** 从选项里取整数值并夹在闭区间内：防止前端传入超大尺寸把服务打爆 */
function optionInt(options: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const raw = options[key]; // 取出原始值
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN; // 兼容数字与数字字符串
  if (!Number.isFinite(parsed)) return fallback; // 非法值回落默认
  return Math.min(max, Math.max(min, Math.trunc(parsed))); // 夹紧到区间，避免越界参数
} // optionInt 结束

/** JSON 工具：格式化 / 压缩 / 校验，三种模式共用一次解析，报错给出位置提示 */
const jsonFormat: CapabilityHandler = async ({ text, options }) => { // JSON 能力入口
  const mode = optionString(options, 'mode', 'pretty'); // 模式：pretty / minify / validate
  let parsed: unknown; // 解析结果，三种模式都要先解析
  try {
    parsed = JSON.parse(text); // 严格解析：非法 JSON 直接抛错
  } catch (err) {
    throw new AppError('VALIDATION_FAILED', `invalid JSON: ${(err as Error).message}`, { capability: 'json.format' }); // 转成统一校验失败错误
  } // 解析异常分支结束
  if (mode === 'minify') { // 压缩模式
    const output = JSON.stringify(parsed); // 去掉所有空白
    return { output, output_kind: 'json', meta: { mode, bytes: Buffer.byteLength(output, 'utf8') } }; // 返回压缩结果与字节数
  } // 压缩模式结束
  if (mode === 'validate') { // 校验模式：只回合法与顶层结构，不回显原文
    const output = JSON.stringify({ valid: true, type: Array.isArray(parsed) ? 'array' : typeof parsed, bytes: Buffer.byteLength(text, 'utf8') }, null, 2); // 结构化结论
    return { output, output_kind: 'json', meta: { mode } }; // 返回校验结论
  } // 校验模式结束
  const output = JSON.stringify(parsed, null, 2); // 默认格式化：两空格缩进
  return { output, output_kind: 'json', meta: { mode: 'pretty', bytes: Buffer.byteLength(output, 'utf8') } }; // 返回格式化结果
}; // jsonFormat 结束

/** 文本编解码：Base64 / Base64URL / Hex / URL，方向 encode 或 decode */
const textEncode: CapabilityHandler = async ({ text, options }) => { // 编码能力入口
  const op = optionString(options, 'op', 'base64'); // 编码方式
  const direction = optionString(options, 'direction', 'encode'); // 方向：encode / decode
  let output: string; // 结果文本
  if (op === 'base64' || op === 'base64url') { // Base64 两族
    if (direction === 'decode') { // 解码：先按 URL 变体还原字符再解
      const normalized = op === 'base64url' ? text.replace(/-/g, '+').replace(/_/g, '/') : text; // URL 安全变体还原
      output = Buffer.from(normalized, 'base64').toString('utf8'); // 按 UTF-8 还原文本
    } else { // 编码
      const encoded = Buffer.from(text, 'utf8').toString('base64'); // 先得到标准 Base64
      output = op === 'base64url' ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded; // URL 安全变体去填充
    } // 方向分支结束
  } else if (op === 'hex') { // 十六进制
    output = direction === 'decode' ? Buffer.from(text, 'hex').toString('utf8') : Buffer.from(text, 'utf8').toString('hex'); // 双向转换
  } else if (op === 'url') { // URL 组件编码
    output = direction === 'decode' ? decodeURIComponent(text) : encodeURIComponent(text); // 双向转换
  } else { // 未知编码方式
    throw new AppError('VALIDATION_FAILED', `unsupported op: ${op}`, { capability: 'text.encode', allowed: ['base64', 'base64url', 'hex', 'url'] }); // 明确列出允许值
  } // 编码方式分支结束
  return { output, output_kind: 'text', meta: { op, direction, bytes: Buffer.byteLength(output, 'utf8') } }; // 返回结果与字节数
}; // textEncode 结束

/** 摘要哈希：MD5 / SHA-1 / SHA-256 / SHA-512 十六进制摘要 */
const textHash: CapabilityHandler = async ({ text, options }) => { // 摘要能力入口
  const algo = optionString(options, 'algo', 'sha256').toLowerCase(); // 算法名，统一小写
  const allowed = new Set(['md5', 'sha1', 'sha256', 'sha512']); // 白名单：只放行这四种
  if (!allowed.has(algo)) { // 非白名单算法
    throw new AppError('VALIDATION_FAILED', `unsupported algo: ${algo}`, { capability: 'text.hash', allowed: [...allowed] }); // 拒绝并列出允许值
  } // 白名单判断结束
  const output = createHash(algo).update(text, 'utf8').digest('hex'); // 计算十六进制摘要
  return { output, output_kind: 'text', meta: { algo, length: output.length } }; // 返回摘要与长度
}; // textHash 结束

/** 转义 HTML 特殊字符：Markdown 里的原始 HTML 一律当纯文本，避免把用户输入当脚本渲染 */
function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string); // 逐字符映射为实体
} // escapeHtml 结束

// 覆盖 marked 的 html token 渲染器：原始 HTML 只转义输出，不原样透传（前端会用 dangerouslySetInnerHTML 渲染结果）
marked.use({ renderer: { html: (token) => escapeHtml(token.text) } }); // 全局注册一次，后续 parse 都生效

/** Markdown 渲染：marked 同步解析为 HTML；原始 HTML 已在上方被转义，前端可直接渲染 */
const markdownRender: CapabilityHandler = async ({ text }) => { // Markdown 能力入口
  const html = await marked.parse(text, { async: false }); // 同步解析，调用方 await 也安全
  return { output: html, output_kind: 'html', meta: { chars: html.length } }; // 返回 HTML 与字符数
}; // markdownRender 结束

/** 二维码生成：文本 → PNG dataURL，尺寸夹在 128–1024 之间 */
const qrcodeGenerate: CapabilityHandler = async ({ text, options }) => { // 二维码能力入口
  const size = optionInt(options, 'size', 256, 128, 1024); // 尺寸夹紧，避免超大图片拖垮内存
  const dataUrl = await QRCode.toDataURL(text, { width: size, margin: 2, errorCorrectionLevel: 'M' }); // 生成 PNG dataURL
  return { output: dataUrl, output_kind: 'image', meta: { size, bytes: dataUrl.length } }; // 返回图片与体积
}; // qrcodeGenerate 结束

/** Cron 解析：输出未来若干次触发时间（ISO 字符串），支持 5 段与 6 段表达式 */
const cronDescribe: CapabilityHandler = async ({ text, options }) => { // cron 能力入口
  const count = optionInt(options, 'count', 5, 1, 20); // 触发次数夹在 1–20
  let interval; // 解析后的表达式对象
  try {
    interval = CronExpressionParser.parse(text.trim()); // 按当前时间解析表达式
  } catch (err) {
    throw new AppError('VALIDATION_FAILED', `invalid cron expression: ${(err as Error).message}`, { capability: 'cron.describe' }); // 非法表达式统一转校验失败
  } // 解析异常分支结束
  const next: string[] = []; // 收集未来触发时间
  for (let i = 0; i < count; i += 1) { // 逐次取下一个时间点
    const item = interval.next(); // 取下一次触发
    next.push(item.toDate().toISOString()); // 统一 ISO 字符串，避免时区歧义
  } // 循环结束
  const output = JSON.stringify({ expression: text.trim(), next }, null, 2); // 结构化输出，前端按 json 渲染
  return { output, output_kind: 'json', meta: { count } }; // 返回结果与条数
}; // cronDescribe 结束

/** 从输入文本解析 JSON：失败统一转成 VALIDATION_FAILED，避免各 handler 重复写 try/catch */
function parseJsonInput(text: string, capability: string): unknown { // JSON 输入解析
  try {
    return JSON.parse(text); // 严格解析
  } catch (err) { // 解析失败
    throw new AppError('VALIDATION_FAILED', `invalid JSON input: ${(err as Error).message}`, { capability }); // 统一错误码
  } // try 结束
} // parseJsonInput 结束

/** CSV 解析为对象数组：首行当表头，交给 csv-parse 处理引号与跨行字段 */
function readCsvRows(text: string, options: Record<string, unknown>, capability: string): Array<Record<string, string>> { // CSV → 行对象
  const rawDelimiter = optionString(options, 'delimiter', ','); // 分隔符，默认逗号
  const delimiter = rawDelimiter === '\\t' ? '\t' : rawDelimiter; // 支持前端传字面量 \t 表示制表符
  try {
    return parseCsvSync(text, { columns: true, skip_empty_lines: true, trim: true, delimiter, relax_column_count: true }) as Array<Record<string, string>>; // 同步解析成对象数组
  } catch (err) { // 解析失败
    throw new AppError('VALIDATION_FAILED', `invalid CSV: ${(err as Error).message}`, { capability }); // 统一错误码
  } // try 结束
} // readCsvRows 结束

/** IPv4 整数转点分十进制 */
function ipv4ToString(value: number): string { // 32 位无符号整数转点分
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.'); // 按四个字节拼回
} // ipv4ToString 结束

/** 分词统计：汉字逐字计数 + 英文单词计数，输出词频 Top20 与切分样例（程序开发 / 中英文分词） */
const textSegment: CapabilityHandler = async ({ text }) => { // 中英文分词
  const cjkChars = text.match(/[\u4e00-\u9fff]/g) ?? []; // 汉字逐字统计
  const latinWords = (text.match(/[A-Za-z][A-Za-z0-9'’_-]*/g) ?? []).map((word) => word.toLowerCase()); // 英文单词统一小写
  const freq = new Map<string, number>(); // 词频表
  for (const ch of cjkChars) freq.set(ch, (freq.get(ch) ?? 0) + 1); // 汉字计数
  for (const word of latinWords) freq.set(word, (freq.get(word) ?? 0) + 1); // 单词计数
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([token, count]) => ({ token, count })); // Top20 词频
  const tokens = (text.match(/[\u4e00-\u9fff]|[A-Za-z][A-Za-z0-9'’_-]*/g) ?? []).slice(0, 80); // 前 80 个切分单元
  const output = JSON.stringify({ chars: text.length, cjk: cjkChars.length, words: latinWords.length, unique: freq.size, top, tokens }, null, 2); // 结构化结果
  return { output, output_kind: 'json', meta: { capability: 'text.segment' } }; // 返回 JSON
}; // textSegment 结束

/** 银行卡号 Luhn 校验与发卡行识别（程序开发 / 支付开发包） */
const cardLuhn: CapabilityHandler = async ({ text }) => { // 卡号校验
  const digits = text.replace(/[^0-9]/g, ''); // 去掉空格与分隔符
  if (digits.length < 12 || digits.length > 19) { // 长度合法性
    throw new AppError('VALIDATION_FAILED', 'card number length must be 12-19 digits', { capability: 'card.luhn' }); // 拒绝异常长度
  } // 长度判断结束
  let sum = 0; // Luhn 累加
  for (let i = digits.length - 1, doubled = false; i >= 0; i -= 1, doubled = !doubled) { // 自右向左逐位处理
    let digit = Number.parseInt(digits[i], 10); // 取当前数字
    if (doubled) { // 偶数位（从右起第 2、4…）
      digit *= 2; // 乘二
      if (digit > 9) digit -= 9; // 超过 9 则减 9
    } // 乘二分支结束
    sum += digit; // 累加
  } // 循环结束
  const valid = sum % 10 === 0; // 能被 10 整除即通过
  const prefix2 = digits.slice(0, 2); // 前两位
  const prefix4 = Number.parseInt(digits.slice(0, 4), 10); // 前四位
  let brand = 'unknown'; // 发卡行兜底
  if (/^4/.test(digits)) brand = 'Visa'; // 4 开头 Visa
  else if ((Number.parseInt(prefix2, 10) >= 51 && Number.parseInt(prefix2, 10) <= 55) || (prefix4 >= 2221 && prefix4 <= 2720)) brand = 'Mastercard'; // 51-55 / 2221-2720
  else if (/^3[47]/.test(digits)) brand = 'American Express'; // 34/37
  else if (/^62/.test(digits)) brand = 'UnionPay'; // 62 银联
  else if (/^35/.test(digits)) brand = 'JCB'; // 35 JCB
  const output = JSON.stringify({ valid, brand, length: digits.length, masked: `${digits.slice(0, 6)}****${digits.slice(-4)}` }, null, 2); // 不回显完整卡号
  return { output, output_kind: 'json', meta: { valid } }; // 返回结论
}; // cardLuhn 结束

/** CSV ↔ JSON：两个方向都走 csv-parse 解析，输出带表头信息（程序开发 / Excel 工具包） */
const csvJson: CapabilityHandler = async ({ text, options }) => { // 表格互转
  const mode = optionString(options, 'mode', 'tojson'); // tojson / tocsv
  if (mode === 'tocsv') { // JSON → CSV
    const parsed = parseJsonInput(text, 'csv.json'); // 解析 JSON 输入
    const rows = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : null; // 必须是对象数组
    if (!rows || rows.length === 0) throw new AppError('VALIDATION_FAILED', 'expect a non-empty JSON array of objects', { capability: 'csv.json' }); // 结构校验
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]; // 合并所有键当表头
    const escapeCell = (value: unknown): string => { // CSV 单元格转义
      const raw = value === null || value === undefined ? '' : String(value); // 空值转空串
      return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw; // 含逗号/引号/换行时加引号并双写引号
    }; // escapeCell 结束
    const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(','))]; // 逐行拼装
    return { output: lines.join('\n'), output_kind: 'text', meta: { rows: rows.length, columns: headers.length } }; // 返回 CSV 文本
  } // tocsv 结束
  const rows = readCsvRows(text, options, 'csv.json'); // CSV → 行对象
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []; // 表头
  const output = JSON.stringify({ columns, rows, total: rows.length }, null, 2); // 结构化结果
  return { output, output_kind: 'json', meta: { rows: rows.length, columns: columns.length } }; // 返回 JSON
}; // csvJson 结束

/** Mustache 模板渲染：输入为 {"template": "...", "data": {...}}，输出渲染后的纯文本（程序开发 / 模板引擎） */
const templateRender: CapabilityHandler = async ({ text }) => { // 模板渲染
  const input = parseJsonInput(text, 'template.render') as { template?: unknown; data?: unknown }; // 解析输入对象
  if (typeof input.template !== 'string' || input.template.length === 0) { // 模板必填
    throw new AppError('VALIDATION_FAILED', 'field "template" is required', { capability: 'template.render' }); // 缺字段即拒绝
  } // 校验结束
  const data = (input.data ?? {}) as Record<string, unknown>; // 变量表，缺省空对象
  try {
    const output = mustache.render(input.template, data); // mustache 渲染（默认转义 HTML 实体）
    return { output, output_kind: 'text', meta: { chars: output.length, vars: Object.keys(data).length } }; // 返回纯文本
  } catch (err) { // 模板语法错误
    throw new AppError('VALIDATION_FAILED', `template error: ${(err as Error).message}`, { capability: 'template.render' }); // 统一错误
  } // try 结束
}; // templateRender 结束

/** URL 解析：拆出协议、主机、路径、查询参数（程序开发 / 网络开发包） */
const urlParse: CapabilityHandler = async ({ text }) => { // URL 解析
  let parsed: URL; // 解析结果
  try {
    parsed = new URL(text.trim()); // 需要带协议的完整 URL
  } catch (err) { // 非法 URL
    throw new AppError('VALIDATION_FAILED', `invalid URL: ${(err as Error).message}`, { capability: 'url.parse' }); // 统一错误
  } // try 结束
  const query: Record<string, string> = {}; // 查询参数展开
  parsed.searchParams.forEach((value, key) => { query[key] = value; }); // 同名参数后者覆盖，简化展示
  const output = JSON.stringify(
    { protocol: parsed.protocol, host: parsed.host, hostname: parsed.hostname, port: parsed.port, pathname: parsed.pathname, hash: parsed.hash, query, segments: parsed.pathname.split('/').filter(Boolean) },
    null, 2,
  ); // 结构化输出
  return { output, output_kind: 'json', meta: { params: Object.keys(query).length } }; // 返回结果
}; // urlParse 结束

/** IPv4 CIDR 计算：网络地址、广播地址、可用主机范围与主机数（程序开发 / 网络工具） */
const ipCidr: CapabilityHandler = async ({ text }) => { // 网段计算
  const matched = text.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/); // 拆出四段与掩码
  if (!matched) throw new AppError('VALIDATION_FAILED', 'expect IPv4 or CIDR like 192.168.1.10/24', { capability: 'ip.cidr' }); // 格式校验
  const octets = matched.slice(1, 5).map((part) => Number.parseInt(part, 10)); // 四段八位组
  if (octets.some((value) => value < 0 || value > 255)) throw new AppError('VALIDATION_FAILED', 'octet out of range', { capability: 'ip.cidr' }); // 字节范围校验
  const prefix = matched[5] === undefined ? 32 : Number.parseInt(matched[5], 10); // 默认 /32
  if (prefix < 0 || prefix > 32) throw new AppError('VALIDATION_FAILED', 'prefix must be 0-32', { capability: 'ip.cidr' }); // 掩码范围校验
  const ipNum = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0; // IP 转整数
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; // 子网掩码
  const network = (ipNum & mask) >>> 0; // 网络地址
  const broadcast = (network | ((~mask) >>> 0)) >>> 0; // 广播地址
  const totalAddresses = 2 ** (32 - prefix); // 地址总数
  const usableHosts = prefix >= 31 ? 0 : totalAddresses - 2; // /31、/32 无可用主机
  const firstHost = prefix >= 31 ? ipv4ToString(network) : ipv4ToString((network + 1) >>> 0); // 首个可用地址
  const lastHost = prefix >= 31 ? ipv4ToString(broadcast) : ipv4ToString((broadcast - 1) >>> 0); // 末个可用地址
  const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ipv4ToString(ipNum)); // 私有网段判断
  const output = JSON.stringify(
    { input: text.trim(), ip: ipv4ToString(ipNum), prefix, mask: ipv4ToString(mask), network: `${ipv4ToString(network)}/${prefix}`, broadcast: ipv4ToString(broadcast), range: { first: firstHost, last: lastHost }, usable_hosts: usableHosts, private: isPrivate, cidr_block: ipv4ToString(network) },
    null, 2,
  ); // 结构化结论
  return { output, output_kind: 'json', meta: { prefix, usable_hosts: usableHosts } }; // 返回结果
}; // ipCidr 结束

/** SVG 图表：CSV 首列当标签、次列当数值，输出柱状图或折线图（程序开发 / 图表组件） */
const chartSvg: CapabilityHandler = async ({ text, options }) => { // 图表生成
  const rows = readCsvRows(text, options, 'chart.svg'); // 解析 CSV
  const chart = optionString(options, 'chart', 'bar'); // bar / line
  if (rows.length === 0) throw new AppError('VALIDATION_FAILED', 'empty CSV', { capability: 'chart.svg' }); // 空数据拒绝
  const columns = Object.keys(rows[0]); // 列名
  if (columns.length < 2) throw new AppError('VALIDATION_FAILED', 'CSV needs at least 2 columns: label,value', { capability: 'chart.svg' }); // 至少两列
  const points = rows.map((row) => ({ label: String(row[columns[0]] ?? ''), value: Number.parseFloat(String(row[columns[1]] ?? '0')) || 0 })); // 提取标签与数值
  const width = 640; // 画布宽
  const height = 320; // 画布高
  const pad = { top: 24, right: 16, bottom: 40, left: 48 }; // 绘图内边距
  const plotW = width - pad.left - pad.right; // 绘图区宽
  const plotH = height - pad.top - pad.bottom; // 绘图区高
  const maxValue = Math.max(...points.map((p) => p.value), 1); // 最大值，避免除零
  const slot = plotW / points.length; // 每个数据点的横向槽宽
  const barWidth = Math.max(4, slot * 0.6); // 柱宽
  const bars = points.map((p, i) => { // 逐点生成柱/点
    const barH = (p.value / maxValue) * plotH; // 柱高按比例
    const x = pad.left + i * slot + (slot - barWidth) / 2; // 柱左边界
    const y = pad.top + plotH - barH; // 柱顶
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="var(--primary, #3b6ef5)" opacity="0.85" /><text x="${(pad.left + i * slot + slot / 2).toFixed(1)}" y="${(height - pad.bottom + 16).toFixed(1)}" font-size="11" text-anchor="middle" fill="#666">${escapeHtml(p.label.slice(0, 8))}</text><text x="${(pad.left + i * slot + slot / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="10" text-anchor="middle" fill="#333">${p.value}</text>`; // 柱 + 标签 + 数值
  }).join(''); // 拼接所有柱
  const polyline = points.map((p, i) => `${(pad.left + i * slot + slot / 2).toFixed(1)},${(pad.top + plotH - (p.value / maxValue) * plotH).toFixed(1)}`).join(' '); // 折线点串
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;display:block">${chart === 'line' ? `<polyline points="${polyline}" fill="none" stroke="var(--primary, #3b6ef5)" stroke-width="2" />` : ''}<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}" stroke="#ddd" />${chart === 'bar' ? bars : ''}</svg>`; // 完整 SVG（折线模式不画柱）
  return { output: svg, output_kind: 'html', meta: { points: points.length, chart, max: maxValue } }; // 返回 SVG
}; // chartSvg 结束

/** 报表：CSV → HTML 表格或 Markdown 表格（程序开发 / 报表工具） */
const reportTable: CapabilityHandler = async ({ text, options }) => { // 报表渲染
  const rows = readCsvRows(text, options, 'report.table'); // 解析 CSV
  if (rows.length === 0) throw new AppError('VALIDATION_FAILED', 'empty CSV', { capability: 'report.table' }); // 空数据拒绝
  const columns = Object.keys(rows[0]); // 表头
  const format = optionString(options, 'format', 'html'); // html / markdown
  if (format === 'markdown') { // Markdown 表格
    const header = `| ${columns.join(' | ')} |`; // 表头行
    const divider = `| ${columns.map(() => '---').join(' | ')} |`; // 分隔行
    const body = rows.map((row) => `| ${columns.map((c) => String(row[c] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`); // 数据行（转义竖线）
    return { output: [header, divider, ...body].join('\n'), output_kind: 'text', meta: { rows: rows.length, format } }; // 返回 Markdown
  } // markdown 结束
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`; // HTML 表头
  const body = rows.map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join(''); // HTML 数据行
  const output = `<table class="store-table"><thead>${head}</thead><tbody>${body}</tbody></table>`; // 完整表格
  return { output, output_kind: 'html', meta: { rows: rows.length, format } }; // 返回 HTML
}; // reportTable 结束

/** 图片与 dataURL / Base64 互转（程序开发 / 图像处理） */
const imageDataurl: CapabilityHandler = async ({ text, options }) => { // 数据 URL 互转
  const trimmed = text.trim(); // 去空白
  const dataUrlMatch = trimmed.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/); // 判断是否 dataURL
  if (dataUrlMatch) { // 输入是 dataURL → 输出元信息
    const mime = dataUrlMatch[1] || 'text/plain'; // MIME 兜底
    const isBase64 = dataUrlMatch[2] === ';base64'; // 是否 base64 编码
    const payload = dataUrlMatch[3]; // 载荷
    const bytes = isBase64 ? Buffer.from(payload.replace(/\s+/g, ''), 'base64').length : Buffer.byteLength(decodeURIComponent(payload), 'utf8'); // 计算字节数
    const output = JSON.stringify({ mime, is_base64: isBase64, bytes, base64: Buffer.from(isBase64 ? payload.replace(/\s+/g, '') : decodeURIComponent(payload), isBase64 ? 'base64' : 'utf8').toString('base64') }, null, 2); // 输出结构化信息
    return { output, output_kind: 'json', meta: { mime, bytes } }; // 返回
  } // dataURL 分支结束
  const mime = optionString(options, 'mime', 'image/png'); // 目标 MIME
  const base64 = trimmed.replace(/\s+/g, ''); // 去空白
  if (!/^[A-Za-z0-9+/=_-]+$/.test(base64)) throw new AppError('VALIDATION_FAILED', 'input must be a data URL or base64 string', { capability: 'image.dataurl' }); // 字符集校验
  const output = `data:${mime};base64,${base64}`; // 拼成 dataURL
  return { output, output_kind: 'text', meta: { mime, bytes: Buffer.from(base64, 'base64').length } }; // 返回
}; // imageDataurl 结束

/** 日志分析：按级别统计 + 首末时间 + 高频消息 Top10（程序开发 / 日志工具包） */
const logStats: CapabilityHandler = async ({ text }) => { // 日志统计
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0); // 非空行
  const levels = new Map<string, number>(); // 级别计数
  const messages = new Map<string, number>(); // 消息计数
  const times: string[] = []; // 时间戳集合
  for (const line of lines) { // 逐行解析
    const levelMatch = line.match(/\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\b/i); // 级别关键字
    if (levelMatch) { // 命中级别
      const level = levelMatch[1].toUpperCase().replace('WARNING', 'WARN').replace('CRITICAL', 'FATAL'); // 归一化
      levels.set(level, (levels.get(level) ?? 0) + 1); // 计数
      const rest = line.slice(levelMatch.index ?? 0).replace(/^\S+\s*/, '').trim().slice(0, 120); // 级别之后的消息片段
      if (rest) messages.set(rest, (messages.get(rest) ?? 0) + 1); // 消息计数
    } // 级别分支结束
    const timeMatch = line.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/) ?? line.match(/[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/); // ISO / syslog 时间
    if (timeMatch) times.push(timeMatch[0]); // 收集时间
  } // 循环结束
  const levelList = [...levels.entries()].sort((a, b) => b[1] - a[1]).map(([level, count]) => ({ level, count })); // 级别降序
  const topMessages = [...messages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([message, count]) => ({ message, count })); // Top10
  const output = JSON.stringify({ total_lines: lines.length, levels: levelList, error_rate: lines.length ? Number((((levels.get('ERROR') ?? 0) + (levels.get('FATAL') ?? 0)) / lines.length * 100).toFixed(2)) : 0, first_time: times[0] ?? null, last_time: times[times.length - 1] ?? null, top_messages: topMessages }, null, 2); // 结构化结论
  return { output, output_kind: 'json', meta: { lines: lines.length } }; // 返回
}; // logStats 结束

/** SVG 验证码：4 位大写字母数字，输出 dataURL 图片并在 meta 里给出答案（程序开发 / 验证码） */
const captchaSvg: CapabilityHandler = async ({ text, options }) => { // 验证码生成
  const length = optionInt(options, 'length', 4, 4, 8); // 位数夹在 4–8
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混字符
  let answer = ''; // 答案
  for (let i = 0; i < length; i += 1) answer += alphabet[Math.floor(Math.random() * alphabet.length)]; // 逐位随机
  const label = optionString(options, 'label', answer); // 自定义文案（默认答案本身）
  const chars = [...label].slice(0, 8).map((ch, i) => { // 逐字符生成 SVG 文本
    const x = 20 + i * (200 / Math.max(1, Math.min(label.length, 8))); // 横向均分
    const rotate = Math.random() * 18 - 9; // 轻微旋转
    const y = 52 + Math.random() * 6; // 轻微浮动
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="30" font-family="monospace" font-weight="700" fill="#3b6ef5" transform="rotate(${rotate.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${escapeHtml(ch)}</text>`; // 单字符节点
  }).join(''); // 拼接字符
  const noise = Array.from({ length: 6 }, () => { // 干扰线
    const x1 = Math.random() * 240; const y1 = Math.random() * 70; const x2 = Math.random() * 240; const y2 = Math.random() * 70; // 随机端点
    return `<line x1="${x1.toFixed(0)}" y1="${y1.toFixed(0)}" x2="${x2.toFixed(0)}" y2="${y2.toFixed(0)}" stroke="#c9d6f5" stroke-width="1" />`; // 浅色干扰线
  }).join(''); // 拼接干扰线
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" width="240" height="72"><rect width="240" height="72" fill="#f5f7ff" rx="6" />${noise}${chars}</svg>`; // 完整 SVG
  const output = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; // 转 dataURL
  return { output, output_kind: 'image', meta: { answer, length } }; // 返回图片与答案
}; // captchaSvg 结束

/** 数学表达式求值：expr-eval 只解析算术与内置函数，拒绝赋值与语句（程序开发 / 算法数学计算） */
const mathEval: CapabilityHandler = async ({ text, options }) => { // 数学求值
  const expression = text.trim(); // 表达式
  if (expression.length === 0) throw new AppError('VALIDATION_FAILED', 'empty expression', { capability: 'math.eval' }); // 空表达式
  if (/[=;\n]/.test(expression) || /\b(?:def|var|let|import|function)\b/.test(expression)) { // 拒绝赋值 / 语句 / 定义
    throw new AppError('VALIDATION_FAILED', 'only pure arithmetic expressions are allowed', { capability: 'math.eval' }); // 明确限制
  } // 安全检查结束
  const precision = optionInt(options, 'precision', 6, 0, 12); // 保留小数位
  let value: unknown; // 计算结果
  try {
    const parser = new ExpressionParser(); // 每次新建解析器，避免状态残留
    value = parser.evaluate(expression); // 求值
  } catch (err) { // 语法/数学错误
    throw new AppError('VALIDATION_FAILED', `invalid expression: ${(err as Error).message}`, { capability: 'math.eval' }); // 统一错误
  } // try 结束
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AppError('VALIDATION_FAILED', 'expression does not produce a finite number', { capability: 'math.eval' }); // 非数值拒绝
  const rounded = Number(value.toFixed(precision)); // 按精度取整
  const output = JSON.stringify({ expression, value: rounded, exact: value }, null, 2); // 结构化结果
  return { output, output_kind: 'json', meta: { precision } }; // 返回
}; // mathEval 结束

/** 由 JSON 样例推导 JSON Schema（低代码表单/接口契约的起点） */
const jsonSchema: CapabilityHandler = async ({ text }) => { // Schema 推导
  const parsed = parseJsonInput(text, 'json.schema'); // 解析样例
  const MAX_DEPTH = 8; // 递归深度上限，防止超深结构
  const infer = (value: unknown, depth: number): Record<string, unknown> => { // 递归推导
    if (depth > MAX_DEPTH) return {}; // 超深直接留空
    if (Array.isArray(value)) { // 数组
      return { type: 'array', items: value.length > 0 ? infer(value[0], depth + 1) : {} }; // 以首元素为元素类型
    } // 数组分支结束
    if (value === null) return { type: 'null' }; // null
    if (typeof value === 'object') { // 对象
      const properties: Record<string, unknown> = {}; // 属性表
      for (const [key, sub] of Object.entries(value as Record<string, unknown>)) properties[key] = infer(sub, depth + 1); // 逐属性推导
      return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }; // 全部属性视为必填
    } // 对象分支结束
    if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' }; // 数字细分
    return { type: typeof value }; // 字符串 / 布尔
  }; // infer 结束
  const output = JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...infer(parsed, 0) }, null, 2); // 输出标准 schema
  return { output, output_kind: 'json', meta: { root: Array.isArray(parsed) ? 'array' : typeof parsed } }; // 返回
}; // jsonSchema 结束

/** 参考文献格式化：按 GB/T 7714 生成专著 / 期刊 / 电子资源条目（科研论文） */
const citeFormat: CapabilityHandler = async ({ text, options }) => { // 文献格式化
  const input = parseJsonInput(text, 'cite.format') as { authors?: unknown; title?: unknown; year?: unknown; type?: unknown; publisher?: unknown; journal?: unknown; volume?: unknown; issue?: unknown; pages?: unknown; url?: unknown; accessed?: unknown }; // 解析字段
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : null; // 题名必填
  if (!title) throw new AppError('VALIDATION_FAILED', 'field "title" is required', { capability: 'cite.format' }); // 缺题名拒绝
  const authors = Array.isArray(input.authors) ? input.authors.map((a) => String(a)).filter(Boolean) : []; // 作者数组
  const authorText = authors.length === 0 ? '佚名' : authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, 等` : authors.join(', '); // 超过 3 人用「等」
  const type = optionString(options, 'type', typeof input.type === 'string' ? input.type : 'book'); // book / journal / web
  const year = input.year === undefined ? '' : String(input.year); // 年份
  const pages = input.pages === undefined ? '' : String(input.pages); // 页码
  let output: string; // 结果
  if (type === 'journal') { // 期刊
    const journal = String(input.journal ?? '未注明刊名'); // 刊名
    const volume = input.volume === undefined ? '' : String(input.volume); // 卷
    const issue = input.issue === undefined ? '' : String(input.issue); // 期
    output = `${authorText}. ${title}[J]. ${journal}, ${year}${volume ? `, ${volume}` : ''}${issue ? `(${issue})` : ''}${pages ? `: ${pages}` : ''}.`; // GB/T 7714 期刊格式
  } else if (type === 'web') { // 电子资源
    output = `${authorText}. ${title}[EB/OL]. ${year ? `(${year})` : ''}[${String(input.accessed ?? new Date().toISOString().slice(0, 10))}]. ${String(input.url ?? '')}.`; // 电子资源格式
  } else { // 专著
    output = `${authorText}. ${title}[M]. ${String(input.publisher ?? '未注明出版者')}, ${year}${pages ? `: ${pages}` : ''}.`; // 专著格式
  } // 类型分支结束
  return { output, output_kind: 'text', meta: { type, authors: authors.length } }; // 返回条目
}; // citeFormat 结束

/** YAML 与 JSON 互转（云原生配置的日常体操） */
const yamlJson: CapabilityHandler = async ({ text, options }) => { // YAML ↔ JSON
  const mode = optionString(options, 'mode', 'yaml2json'); // yaml2json / json2yaml
  try {
    if (mode === 'json2yaml') { // JSON → YAML
      const parsed = parseJsonInput(text, 'yaml.json'); // 先解 JSON
      const output = stringifyYamlText(parsed); // 序列化为 YAML
      return { output, output_kind: 'text', meta: { mode, chars: output.length } }; // 返回
    } // json2yaml 结束
    const parsed = parseYamlText(text); // 解析 YAML
    const output = JSON.stringify(parsed, null, 2); // 转 JSON 文本
    return { output, output_kind: 'json', meta: { mode, chars: output.length } }; // 返回
  } catch (err) { // 解析 / 序列化失败
    throw new AppError('VALIDATION_FAILED', `invalid ${mode}: ${(err as Error).message}`, { capability: 'yaml.json' }); // 统一错误
  } // try 结束
}; // yamlJson 结束

/** JWT 解析：拆出 header 与 payload 并标注过期状态（不做签名验证，避免误当鉴权结论） */
const jwtDecode: CapabilityHandler = async ({ text }) => { // JWT 解析
  const parts = text.trim().split('.'); // 三段式
  if (parts.length !== 3) throw new AppError('VALIDATION_FAILED', 'expect a three-part JWT', { capability: 'jwt.decode' }); // 结构校验
  const decodePart = (part: string, name: string): Record<string, unknown> => { // base64url 解码
    try {
      const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); // 还原 base64 后转文本
      return JSON.parse(json) as Record<string, unknown>; // 解析对象
    } catch (err) { // 非法片段
      throw new AppError('VALIDATION_FAILED', `invalid JWT ${name}: ${(err as Error).message}`, { capability: 'jwt.decode' }); // 明确指出哪段坏了
    } // try 结束
  }; // decodePart 结束
  const header = decodePart(parts[0], 'header'); // 头部
  const payload = decodePart(parts[1], 'payload'); // 载荷
  const exp = typeof payload.exp === 'number' ? payload.exp : null; // 过期时间（秒）
  const expired = exp === null ? null : exp * 1000 < Date.now(); // 是否已过期
  const output = JSON.stringify({ header, payload, expires_at: exp === null ? null : new Date(exp * 1000).toISOString(), expired, signature_verified: false }, null, 2); // 明确未验签
  return { output, output_kind: 'json', meta: { expired, note: 'signature not verified' } }; // 返回
}; // jwtDecode 结束

/** 文本差异：输入 {"a": "...", "b": "..."}，输出统一 diff（开发/调试） */
const diffText: CapabilityHandler = async ({ text, options }) => { // 文本对比
  const input = parseJsonInput(text, 'diff.text') as { a?: unknown; b?: unknown; filename?: unknown }; // 解析输入
  if (typeof input.a !== 'string' || typeof input.b !== 'string') throw new AppError('VALIDATION_FAILED', 'fields "a" and "b" must be strings', { capability: 'diff.text' }); // 结构校验
  const context = optionInt(options, 'context', 3, 0, 10); // 上下文行数
  const filename = typeof input.filename === 'string' ? input.filename : 'text'; // 文件名标签
  const patch = createTwoFilesPatch(`${filename}.a`, `${filename}.b`, input.a, input.b, undefined, undefined, { context }); // 生成 unified diff
  const added = (patch.match(/^\+[^+]/gm) ?? []).length; // 新增行数
  const removed = (patch.match(/^-[^-]/gm) ?? []).length; // 删除行数
  return { output: patch, output_kind: 'text', meta: { added, removed, context } }; // 返回 diff
}; // diffText 结束

/** 代码统计：按语言注释语法统计代码行 / 注释行 / 空行与注释率（代码扫描分析） */
const codeStats: CapabilityHandler = async ({ text, options }) => { // 代码行统计
  const lang = optionString(options, 'lang', 'ts'); // ts / js / py / sh / sql / html
  const commentTokens: Record<string, string[]> = { ts: ['//', '/*', '*', '*/'], js: ['//', '/*', '*', '*/'], py: ['#'], sh: ['#'], sql: ['--'], html: ['<!--'] }; // 各语言行注释前缀
  const tokens = commentTokens[lang] ?? ['//']; // 未知语言按 JS 口径
  const lines = text.split(/\r?\n/); // 全部行
  let blank = 0; let comment = 0; let code = 0; // 三类计数
  for (const line of lines) { // 逐行判定
    const trimmed = line.trim(); // 去缩进
    if (trimmed.length === 0) { blank += 1; continue; } // 空行
    if (tokens.some((token) => trimmed.startsWith(token))) { comment += 1; continue; } // 纯注释行
    code += 1; // 其余视为代码行
  } // 循环结束
  const commentRate = code + comment === 0 ? 0 : Number((comment / (code + comment) * 100).toFixed(2)); // 注释率（不含空行）
  const output = JSON.stringify({ lang, total_lines: lines.length, code_lines: code, comment_lines: comment, blank_lines: blank, comment_rate: commentRate }, null, 2); // 结构化结论
  return { output, output_kind: 'json', meta: { lang } }; // 返回
}; // codeStats 结束

/** SQL 格式化：按方言重排关键字与缩进（数据库开发包） */
const sqlFormat: CapabilityHandler = async ({ text, options }) => { // SQL 格式化
  const dialect = optionString(options, 'dialect', 'sql'); // 方言：sql / mysql / postgresql / sqlite / tsql
  if (text.trim().length === 0) throw new AppError('VALIDATION_FAILED', 'empty SQL', { capability: 'sql.format' }); // 空输入拒绝
  try {
    const output = formatSqlText(text, { language: dialect as 'sql', keywordCase: optionString(options, 'keywordCase', 'upper') as 'upper' }); // 格式化
    return { output, output_kind: 'text', meta: { dialect } }; // 返回
  } catch (err) { // 非法 SQL
    throw new AppError('VALIDATION_FAILED', `invalid SQL: ${(err as Error).message}`, { capability: 'sql.format' }); // 统一错误
  } // try 结束
}; // sqlFormat 结束

/** 文本统计：字符 / 汉字 / 字母 / 数字 / 行 / 段落与高频词（应用工具 / 文本编辑） */
const textStats: CapabilityHandler = async ({ text }) => { // 文本统计
  const noSpace = text.replace(/\s/g, ''); // 去空白后的字符
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0).length; // 段落数
  const lines = text.split(/\r?\n/).length; // 行数
  const wordTokens = (text.match(/[\u4e00-\u9fff]|[A-Za-z][A-Za-z0-9'’_-]*/g) ?? []); // 词元
  const freq = new Map<string, number>(); // 词频
  for (const token of wordTokens) freq.set(token, (freq.get(token) ?? 0) + 1); // 计数
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([token, count]) => ({ token, count })); // Top10
  const output = JSON.stringify({ chars: text.length, chars_no_space: noSpace.length, cjk: (text.match(/[\u4e00-\u9fff]/g) ?? []).length, letters: (text.match(/[A-Za-z]/g) ?? []).length, digits: (text.match(/[0-9]/g) ?? []).length, lines, paragraphs, tokens: wordTokens.length, top }, null, 2); // 结构化结论
  return { output, output_kind: 'json', meta: { lines, paragraphs } }; // 返回
}; // textStats 结束

/** 批量重命名方案预览：只生成新文件名映射，不触碰磁盘（文件管理工具） */
const fileRename: CapabilityHandler = async ({ text, options }) => { // 重命名预览
  const input = parseJsonInput(text, 'file.rename') as { files?: unknown; pattern?: unknown }; // 解析输入
  const files = Array.isArray(input.files) ? input.files.map((f) => String(f)).filter(Boolean) : []; // 文件名清单
  if (files.length === 0) throw new AppError('VALIDATION_FAILED', 'field "files" must be a non-empty array', { capability: 'file.rename' }); // 校验
  const pattern = typeof input.pattern === 'string' && input.pattern.trim() ? input.pattern.trim() : '{n}-{name}{ext}'; // 默认「序号-原名.扩展名」
  const list = files.slice(0, 200).map((file, index) => { // 逐文件生成新名（上限 200 条防止刷屏）
    const dot = file.lastIndexOf('.'); // 找扩展名分隔点
    const name = dot > 0 ? file.slice(0, dot) : file; // 主干
    const ext = dot > 0 ? file.slice(dot) : ''; // 含点的扩展名
    const next = pattern.replace(/\{n\}/g, String(index + 1)).replace(/\{name\}/g, name).replace(/\{ext\}/g, ext).replace(/\{index\}/g, String(index)); // 变量替换
    return { from: file, to: next, changed: next !== file }; // 映射项
  }); // map 结束
  const conflicts = list.length > 0 ? [...new Map(list.map((item) => [item.to, 1])).keys()].length : 0; // 目标名去重数
  const output = JSON.stringify({ pattern, total: list.length, conflicts: list.length - conflicts, items: list }, null, 2); // 预览结果
  return { output, output_kind: 'json', meta: { total: list.length, dry_run: true } }; // 标注 dry run
}; // fileRename 结束

/** 能力注册表：键必须与 core-domain 的 MODULE_CAPABILITIES.key 完全一致，否则路由回 501 */
export const CAPABILITY_HANDLERS: Record<string, CapabilityHandler> = { // 键为能力标识
  'json.format': jsonFormat, // JSON 工具
  'text.encode': textEncode, // 文本编解码
  'text.hash': textHash, // 摘要哈希
  'markdown.render': markdownRender, // Markdown 渲染
  'qrcode.generate': qrcodeGenerate, // 二维码生成
  'cron.describe': cronDescribe, // Cron 解析
  'text.segment': textSegment, // 中英文分词统计
  'card.luhn': cardLuhn, // 银行卡号 Luhn 校验
  'csv.json': csvJson, // CSV ↔ JSON
  'template.render': templateRender, // Mustache 模板渲染
  'url.parse': urlParse, // URL 解析
  'ip.cidr': ipCidr, // IPv4 CIDR 计算
  'chart.svg': chartSvg, // SVG 图表
  'report.table': reportTable, // 报表表格
  'image.dataurl': imageDataurl, // dataURL / Base64 互转
  'log.stats': logStats, // 日志分析
  'captcha.svg': captchaSvg, // SVG 验证码
  'math.eval': mathEval, // 数学表达式求值
  'json.schema': jsonSchema, // JSON → JSON Schema
  'cite.format': citeFormat, // 参考文献格式化
  'yaml.json': yamlJson, // YAML ↔ JSON
  'jwt.decode': jwtDecode, // JWT 解析
  'diff.text': diffText, // 文本差异
  'code.stats': codeStats, // 代码统计
  'sql.format': sqlFormat, // SQL 格式化
  'text.stats': textStats, // 文本统计
  'file.rename': fileRename, // 批量重命名预览
}; // 注册表结束

/** 按能力键取 handler：未注册即返回 undefined，由路由决定是否 501 */
export function handlerOfCapability(key: string): CapabilityHandler | undefined {
  return CAPABILITY_HANDLERS[key]; // 直接读注册表，键不存在即 undefined
} // handlerOfCapability 结束
