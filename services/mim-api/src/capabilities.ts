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
import semver from 'semver'; // semver 版本与范围校验：package.json 体检用成熟库而非手写正则
import { AppError, blueprintGroupOfCapability, blueprintGroupOfCode, blueprintOfCode, buildCatalogModuleSeeds } from '@mim/core-domain'; // 统一业务错误 + 模块起盘蓝图数据（能力键 catalog.* 用它产出条目专属文档）
import type { BlueprintGroupMeta, ModuleBlueprint } from '@mim/core-domain'; // 蓝图分组模板与单条蓝图类型

/** 能力调用入参：文本主体 + 能力私有选项（选项由各 handler 自行校验，避免一个巨型 schema） */
export interface CapabilityInput {
  text: string; // 用户输入的文本主体（JSON / Markdown / 待编码文本 / cron 表达式等）
  options: Record<string, unknown>; // 能力私有选项（mode / algo / op / direction / size / count）
} // 代码块结束

/** 能力调用结果：output 为可直接展示的字符串，output_kind 决定前端用哪种渲染方式 */
export interface CapabilityResult {
  output: string; // 结果正文：纯文本 / JSON 字符串 / HTML / 图片 dataURL
  output_kind: 'text' | 'json' | 'html' | 'image'; // 输出形态，与 core-domain 定义保持一致
  meta: Record<string, unknown>; // 附加信息（字节数、算法、触发时间数量等），便于前端展示细节
} // 代码块结束

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
  try { // 异常捕获起点：包裹可能抛出错误的操作
    parsed = JSON.parse(text); // 严格解析：非法 JSON 直接抛错
  } catch (err) { // 代码块结束
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
  try { // 异常捕获起点：包裹可能抛出错误的操作
    interval = CronExpressionParser.parse(text.trim()); // 按当前时间解析表达式
  } catch (err) { // 代码块结束
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
  try { // 异常捕获起点：包裹可能抛出错误的操作
    return JSON.parse(text); // 严格解析
  } catch (err) { // 解析失败
    throw new AppError('VALIDATION_FAILED', `invalid JSON input: ${(err as Error).message}`, { capability }); // 统一错误码
  } // try 结束
} // parseJsonInput 结束

/** CSV 解析为对象数组：首行当表头，交给 csv-parse 处理引号与跨行字段 */
function readCsvRows(text: string, options: Record<string, unknown>, capability: string): Array<Record<string, string>> { // CSV → 行对象
  const rawDelimiter = optionString(options, 'delimiter', ','); // 分隔符，默认逗号
  const delimiter = rawDelimiter === '\\t' ? '\t' : rawDelimiter; // 支持前端传字面量 \t 表示制表符
  try { // 异常捕获起点：包裹可能抛出错误的操作
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
  else if (/^35/.test(digits)) brand = 'JCB'; // 35 开头为 JCB
  const output = JSON.stringify({ valid, brand, length: digits.length, masked: `${digits.slice(0, 6)}****${digits.slice(-4)}` }, null, 2); // 不回显完整卡号
  return { output, output_kind: 'json', meta: { valid } }; // 返回结论
}; // cardLuhn 结束

/** CSV ↔ JSON：两个方向都走 csv-parse 解析，输出带表头信息（程序开发 / Excel 工具包） */
const csvJson: CapabilityHandler = async ({ text, options }) => { // 表格互转
  const mode = optionString(options, 'mode', 'tojson'); // 取值：tojson / tocsv
  if (mode === 'tocsv') { // JSON 转 CSV
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
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const output = mustache.render(input.template, data); // mustache 渲染（默认转义 HTML 实体）
    return { output, output_kind: 'text', meta: { chars: output.length, vars: Object.keys(data).length } }; // 返回纯文本
  } catch (err) { // 模板语法错误
    throw new AppError('VALIDATION_FAILED', `template error: ${(err as Error).message}`, { capability: 'template.render' }); // 统一错误
  } // try 结束
}; // templateRender 结束

/** URL 解析：拆出协议、主机、路径、查询参数（程序开发 / 网络开发包） */
const urlParse: CapabilityHandler = async ({ text }) => { // URL 解析
  let parsed: URL; // 解析结果
  try { // 异常捕获起点：包裹可能抛出错误的操作
    parsed = new URL(text.trim()); // 需要带协议的完整 URL
  } catch (err) { // 非法 URL
    throw new AppError('VALIDATION_FAILED', `invalid URL: ${(err as Error).message}`, { capability: 'url.parse' }); // 统一错误
  } // try 结束
  const query: Record<string, string> = {}; // 查询参数展开
  parsed.searchParams.forEach((value, key) => { query[key] = value; }); // 同名参数后者覆盖，简化展示
  const output = JSON.stringify( // 常量 output：保存固定配置或一次性派生值
    { protocol: parsed.protocol, host: parsed.host, hostname: parsed.hostname, port: parsed.port, pathname: parsed.pathname, hash: parsed.hash, query, segments: parsed.pathname.split('/').filter(Boolean) }, // 执行当前业务步骤
    null, 2, // 执行当前业务步骤
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
  const output = JSON.stringify( // 常量 output：保存固定配置或一次性派生值
    { input: text.trim(), ip: ipv4ToString(ipNum), prefix, mask: ipv4ToString(mask), network: `${ipv4ToString(network)}/${prefix}`, broadcast: ipv4ToString(broadcast), range: { first: firstHost, last: lastHost }, usable_hosts: usableHosts, private: isPrivate, cidr_block: ipv4ToString(network) }, // 执行当前业务步骤
    null, 2, // 执行当前业务步骤
  ); // 结构化结论
  return { output, output_kind: 'json', meta: { prefix, usable_hosts: usableHosts } }; // 返回结果
}; // ipCidr 结束

/** SVG 图表：CSV 首列当标签、次列当数值，输出柱状图或折线图（程序开发 / 图表组件） */
const chartSvg: CapabilityHandler = async ({ text, options }) => { // 图表生成
  const rows = readCsvRows(text, options, 'chart.svg'); // 解析 CSV
  const chart = optionString(options, 'chart', 'bar'); // 取值：bar / line
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
  const format = optionString(options, 'format', 'html'); // 取值：html / markdown
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
  const topMessages = [...messages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([message, count]) => ({ message, count })); // 前 10 名
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
  try { // 异常捕获起点：包裹可能抛出错误的操作
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
    if (value === null) return { type: 'null' }; // 空值
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
  const type = optionString(options, 'type', typeof input.type === 'string' ? input.type : 'book'); // 取值：book / journal / web
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
const yamlJson: CapabilityHandler = async ({ text, options }) => { // YAML 与 JSON 互转
  const mode = optionString(options, 'mode', 'yaml2json'); // 取值：yaml2json / json2yaml
  try { // 异常捕获起点：包裹可能抛出错误的操作
    if (mode === 'json2yaml') { // JSON 转 YAML
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
    try { // 异常捕获起点：包裹可能抛出错误的操作
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
  const lang = optionString(options, 'lang', 'ts'); // 取值：ts / js / py / sh / sql / html
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
  try { // 异常捕获起点：包裹可能抛出错误的操作
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
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([token, count]) => ({ token, count })); // 前 10 名
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

/** 主题色阶：把主色分别向白与黑混合，产出可直接进 CSS 变量的 50–900 十档色 */
const uiTheme: CapabilityHandler = async ({ text }) => { // UI 主题色阶入口
  const primary = text.trim(); // 主色原文
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(primary); // 只接受 3 位或 6 位十六进制
  if (!match) throw new AppError('VALIDATION_FAILED', 'field "text" must be a hex color like #2f6feb', { capability: 'ui.theme' }); // 非法色值直接拒绝
  const hex = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1]; // 三位简写补成六位
  const rgb = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)); // 拆出 RGB 三通道
  const mix = (target: number[], weight: number): string => { // 与目标色按权重混合，weight 越大越接近目标
    const parts = rgb.map((value, index) => Math.round(value * (1 - weight) + target[index] * weight)); // 逐通道线性混合
    return '#' + parts.map((value) => value.toString(16).padStart(2, '0')).join(''); // 拼回十六进制
  }; // 混合函数结束
  const lightSteps = [50, 100, 200, 300, 400].map((step, index) => [step, mix([255, 255, 255], 0.92 - index * 0.16)] as const); // 向白混合，越靠前越浅
  const mid = [[500, '#' + hex] as const]; // 500 档保留原色
  const darkSteps = [600, 700, 800, 900].map((step, index) => [step, mix([0, 0, 0], 0.18 + index * 0.16)] as const); // 向黑混合，越靠后越深
  const pairs = [...lightSteps, ...mid, ...darkSteps]; // 合并十档
  const lines = pairs.map(([step, color]) => `  --brand-${step}: ${color};`); // 逐档生成 CSS 变量行
  const output = [':root {', ...lines, '}', '', `/* primary: ${primary} */`].join('\n'); // 组装为可直接粘进样式表的片段
  return { output, output_kind: 'text', meta: { primary, steps: pairs.length } }; // 返回 CSS 文本与档位数量
}; // uiTheme 结束

/** 语音 SSML：按句末标点切句并插入停顿，输出可供 TTS 直接使用的 SSML */
const speechSsml: CapabilityHandler = async ({ text, options }) => { // 语音合成入口
  const body = text.trim(); // 待朗读文本
  if (!body) throw new AppError('VALIDATION_FAILED', 'field "text" must not be empty', { capability: 'speech.ssml' }); // 空文本拒绝
  const voice = optionString(options, 'voice', 'zh-CN-XiaoxiaoNeural'); // 音色，默认中文女声
  const rate = optionString(options, 'rate', '0%'); // 语速，默认原速
  const sentences = body.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean); // 按句末标点切句，保留标点
  const inner = sentences.map((sentence, index) => `${sentence}${index < sentences.length - 1 ? '<break time="300ms"/>' : ''}`).join('\n  '); // 句间插停顿
  const output = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">\n  <voice name="${voice}">\n    <prosody rate="${rate}">\n      ${inner}\n    </prosody>\n  </voice>\n</speak>`; // 组装 SSML
  return { output, output_kind: 'text', meta: { sentences: sentences.length, voice, rate } }; // 返回 SSML 与句数
}; // speechSsml 结束

/** HTTP 状态码字典：覆盖 1xx–5xx 常见码，查询时按入参逐个回放 */
const HTTP_STATUS_TEXT: Record<number, { name: string; description: string }> = { // 码值 → 名称 + 说明
  100: { name: 'Continue', description: '继续发送请求体' }, // 1xx 信息类状态码
  101: { name: 'Switching Protocols', description: '协议切换（如升级 WebSocket）' }, // 1xx 信息类状态码
  200: { name: 'OK', description: '请求成功' }, // 2xx 成功状态码
  201: { name: 'Created', description: '资源已创建' }, // 2xx 成功状态码
  202: { name: 'Accepted', description: '已接受，异步处理' }, // 2xx 成功状态码
  204: { name: 'No Content', description: '成功但无响应体' }, // 2xx 成功状态码
  206: { name: 'Partial Content', description: '范围请求的部分内容' }, // 2xx 成功状态码
  301: { name: 'Moved Permanently', description: '永久重定向' }, // 3xx 重定向状态码
  302: { name: 'Found', description: '临时重定向' }, // 3xx 重定向状态码
  304: { name: 'Not Modified', description: '缓存仍然有效' }, // 3xx 重定向状态码
  307: { name: 'Temporary Redirect', description: '临时重定向，保持方法与请求体' }, // 3xx 重定向状态码
  308: { name: 'Permanent Redirect', description: '永久重定向，保持方法与请求体' }, // 3xx 重定向状态码
  400: { name: 'Bad Request', description: '请求语法或参数错误' }, // 4xx 客户端错误状态码
  401: { name: 'Unauthorized', description: '缺少或无效的身份凭证' }, // 4xx 客户端错误状态码
  403: { name: 'Forbidden', description: '已认证但无权限' }, // 4xx 客户端错误状态码
  404: { name: 'Not Found', description: '资源不存在' }, // 4xx 客户端错误状态码
  405: { name: 'Method Not Allowed', description: '方法不被允许' }, // 4xx 客户端错误状态码
  409: { name: 'Conflict', description: '与当前资源状态冲突' }, // 4xx 客户端错误状态码
  410: { name: 'Gone', description: '资源已被永久移除' }, // 4xx 客户端错误状态码
  412: { name: 'Precondition Failed', description: '前置条件不满足' }, // 4xx 客户端错误状态码
  413: { name: 'Payload Too Large', description: '请求体超出上限' }, // 4xx 客户端错误状态码
  415: { name: 'Unsupported Media Type', description: '媒体类型不受支持' }, // 4xx 客户端错误状态码
  422: { name: 'Unprocessable Entity', description: '语义校验失败' }, // 4xx 客户端错误状态码
  429: { name: 'Too Many Requests', description: '触发限流' }, // 4xx 客户端错误状态码
  500: { name: 'Internal Server Error', description: '服务端内部错误' }, // 5xx 服务端错误状态码
  501: { name: 'Not Implemented', description: '功能未实现' }, // 5xx 服务端错误状态码
  502: { name: 'Bad Gateway', description: '上游网关收到无效响应' }, // 5xx 服务端错误状态码
  503: { name: 'Service Unavailable', description: '服务暂不可用或过载' }, // 5xx 服务端错误状态码
  504: { name: 'Gateway Timeout', description: '上游响应超时' }, // 5xx 服务端错误状态码
  505: { name: 'HTTP Version Not Supported', description: 'HTTP 版本不受支持' }, // 5xx 服务端错误状态码
}; // 状态码字典结束

/** HTTP 状态码查询：支持一次查多个码，未收录的码给出分类但不给说明 */
const httpStatus: CapabilityHandler = async ({ text }) => { // 状态码入口
  const codes = text.split(/[^0-9]+/).filter(Boolean).map((raw) => Number.parseInt(raw, 10)).filter((code) => code >= 100 && code <= 599); // 抽出 100–599 的数字
  if (codes.length === 0) throw new AppError('VALIDATION_FAILED', 'field "text" must contain HTTP status codes', { capability: 'http.status' }); // 没有合法码就拒绝
  const items = [...new Set(codes)].slice(0, 20).map((code) => { // 去重并限制 20 条
    const known = HTTP_STATUS_TEXT[code]; // 查字典
    return { code, klass: `${Math.floor(code / 100)}xx`, name: known?.name ?? 'Unknown', description: known?.description ?? '该码未收录，按分类判断语义', known: Boolean(known) }; // 组装单条结果
  }); // map 结束
  const output = JSON.stringify({ total: items.length, items }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { total: items.length } }; // 返回结果
}; // httpStatus 结束

/** 数值画像：均值、中位数、四分位、标准差与 IQR 离群值，用于快速摸底一批数字 */
const dataProfile: CapabilityHandler = async ({ text }) => { // 数值画像入口
  const values = text.split(/[^\-0-9.eE]+/).map((raw) => Number.parseFloat(raw)).filter((num) => Number.isFinite(num)); // 抽出所有有限数字
  if (values.length === 0) throw new AppError('VALIDATION_FAILED', 'field "text" must contain numbers', { capability: 'data.profile' }); // 无数字拒绝
  const sorted = [...values].sort((a, b) => a - b); // 升序副本
  const quantile = (q: number): number => { // 线性插值分位数
    const pos = (sorted.length - 1) * q; // 目标位置
    const base = Math.floor(pos); // 下界索引
    const rest = pos - base; // 小数部分
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]; // 插值或取端点
  }; // 分位数函数结束
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length; // 均值
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length; // 方差
  const p25 = quantile(0.25); // 下四分位
  const p75 = quantile(0.75); // 上四分位
  const iqr = p75 - p25; // 四分位距
  const lowFence = p25 - 1.5 * iqr; // 下界
  const highFence = p75 + 1.5 * iqr; // 上界
  const outliers = values.filter((value) => value < lowFence || value > highFence); // 离群值
  const summary = { count: values.length, min: sorted[0], max: sorted[sorted.length - 1], mean: Number(mean.toFixed(4)), median: Number(quantile(0.5).toFixed(4)), p25: Number(p25.toFixed(4)), p75: Number(p75.toFixed(4)), stddev: Number(Math.sqrt(variance).toFixed(4)), iqr: Number(iqr.toFixed(4)), outliers: outliers.slice(0, 20) }; // 汇总对象
  return { output: JSON.stringify(summary, null, 2), output_kind: 'json', meta: { count: values.length, outliers: outliers.length } }; // 返回汇总
}; // dataProfile 结束

/** 语言识别：用关键字与语法特征投票，给出语言、置信度与命中证据 */
const codeDetect: CapabilityHandler = async ({ text }) => { // 语言识别入口
  const body = text.trim(); // 代码原文
  if (!body) throw new AppError('VALIDATION_FAILED', 'field "text" must not be empty', { capability: 'code.detect' }); // 空文本拒绝
  const rules: Array<{ language: string; patterns: RegExp[] }> = [ // 特征表：命中越多置信度越高
    { language: 'TypeScript', patterns: [/interface\s+\w+\s*\{/, /: (string|number|boolean)\b/, /\bexport\s+type\b/, /\bas const\b/] }, // TS 特征
    { language: 'JavaScript', patterns: [/\bconst\s+\w+\s*=/, /\bfunction\s+\w+\(/, /=>\s*\{/, /\bconsole\.log\(/] }, // JS 特征
    { language: 'Python', patterns: [/\bdef\s+\w+\(.*\):/, /\bimport\s+\w+/, /\bself\./, /if\s+__name__\s*==/] }, // Python 特征
    { language: 'Java', patterns: [/\bpublic\s+class\b/, /\bSystem\.out\./, /\bimport\s+java\./, /@Override/] }, // Java 特征
    { language: 'Go', patterns: [/\bfunc\s+\w+\(/, /\bpackage\s+main\b/, /:=/, /\bfmt\.Print/] }, // Go 特征
    { language: 'Rust', patterns: [/\bfn\s+\w+\(/, /\blet\s+mut\b/, /\buse\s+std::/, /->\s*Result</] }, // Rust 特征
    { language: 'SQL', patterns: [/\bSELECT\b/i, /\bFROM\b/i, /\bWHERE\b/i, /;$/] }, // SQL 特征
    { language: 'Shell', patterns: [/^#!/m, /\bexport\s+\w+=/, /\bif\s+\[\s/, /\becho\s+/] }, // Shell 特征
  ]; // 特征表结束
  const scored = rules.map((rule) => { // 逐语言计分
    const hits = rule.patterns.filter((pattern) => pattern.test(body)); // 命中的特征
    return { language: rule.language, score: hits.length, evidence: hits.map((pattern) => pattern.source).slice(0, 4) }; // 记录分数与证据
  }).sort((a, b) => b.score - a.score); // 按分数降序
  const best = scored[0]; // 最高分
  const confidence = best.score === 0 ? 0 : Number((best.score / 4).toFixed(2)); // 满分 4 个特征
  const output = JSON.stringify({ language: best.score > 0 ? best.language : 'Unknown', confidence, evidence: best.evidence, runners_up: scored.slice(1, 3).filter((item) => item.score > 0) }, null, 2); // 输出结论
  return { output, output_kind: 'json', meta: { language: best.language, confidence } }; // 返回结果
}; // codeDetect 结束

/** 缓存键规划：业务键加前缀并取摘要短串，附 TTL 与过期时间，避免长键与碰撞 */
const cacheKey: CapabilityHandler = async ({ text, options }) => { // 缓存键入口
  const businessKey = text.trim(); // 业务键
  if (!businessKey) throw new AppError('VALIDATION_FAILED', 'field "text" must not be empty', { capability: 'cache.key' }); // 空键拒绝
  const prefix = optionString(options, 'prefix', 'mim'); // 命名空间前缀
  const ttl = optionInt(options, 'ttl', 3600, 1, 604800); // TTL 秒，默认 1 小时，上限 7 天
  const digest = createHash('sha256').update(businessKey).digest('hex').slice(0, 16); // 取 16 位摘要短串
  const key = `${prefix}:${digest}`; // 最终键
  const expireAt = new Date(Date.now() + ttl * 1000).toISOString(); // 过期时间
  const output = JSON.stringify({ key, prefix, ttl_seconds: ttl, expire_at: expireAt, source_key: businessKey.slice(0, 120) }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { ttl_seconds: ttl } }; // 返回结果
}; // cacheKey 结束

/** 轻量检索排序：按查询词命中次数打分，并截取首个命中词附近的高亮片段 */
const searchRank: CapabilityHandler = async ({ text }) => { // 检索排序入口
  const input = parseJsonInput(text, 'search.rank') as { query?: unknown; docs?: unknown }; // 解析入参
  const query = typeof input.query === 'string' ? input.query.trim() : ''; // 查询串
  const docs = Array.isArray(input.docs) ? input.docs.map((doc) => String(doc)) : []; // 文档集合
  if (!query || docs.length === 0) throw new AppError('VALIDATION_FAILED', 'fields "query" and "docs" are required', { capability: 'search.rank' }); // 缺参拒绝
  const tokens = query.split(/[\s,，、]+/).filter(Boolean); // 查询词切分
  const ranked = docs.slice(0, 200).map((doc, index) => { // 逐文档打分
    let score = 0; // 累计得分
    let firstHit = -1; // 首个命中位置
    for (const token of tokens) { // 逐词统计
      const positions = doc.split(token).length - 1; // 出现次数
      score += positions; // 累加
      const pos = doc.indexOf(token); // 首次位置
      if (pos >= 0 && (firstHit < 0 || pos < firstHit)) firstHit = pos; // 更新首个命中
    } // 代码块结束
    const start = Math.max(0, firstHit - 20); // 片段起点
    const snippet = firstHit < 0 ? doc.slice(0, 60) : doc.slice(start, start + 100); // 片段内容
    return { index, score, snippet, doc_length: doc.length }; // 单条结果
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 20); // 过滤零分并排序
  const output = JSON.stringify({ query, tokens, total_docs: docs.length, hits: ranked.length, ranked }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { hits: ranked.length } }; // 返回结果
}; // searchRank 结束

/** 通用拓扑排序：给服务与 bean 两种图共用，返回装配顺序、分层与环 */
function topologicalOrder(nodes: Array<{ name: string; depends: string[] }>): { order: string[]; layers: string[][]; cycles: string[]; missing: string[] } { // 拓扑排序
  const known = new Set(nodes.map((node) => node.name)); // 已知节点集合
  const missing = [...new Set(nodes.flatMap((node) => node.depends).filter((dep) => !known.has(dep)))]; // 依赖了不存在的节点
  const indegree = new Map<string, number>(); // 入度表
  const children = new Map<string, string[]>(); // 反向边表
  for (const node of nodes) { // 初始化
    indegree.set(node.name, 0); // 默认 0 入度
    children.set(node.name, []); // 空出边表
  } // 初始化结束
  for (const node of nodes) { // 逐条依赖建边
    for (const dep of node.depends) { // 依赖项
      if (!known.has(dep)) continue; // 缺失依赖不计入图
      indegree.set(node.name, (indegree.get(node.name) ?? 0) + 1); // 入度 +1
      children.get(dep)?.push(node.name); // dep → node 边
    } // 代码块结束
  } // 建边结束
  const ready = nodes.filter((node) => (indegree.get(node.name) ?? 0) === 0).map((node) => node.name); // 初始无依赖节点
  const order: string[] = []; // 装配顺序
  const layers: string[][] = []; // 分层结果
  let frontier = ready; // 当前层
  while (frontier.length > 0) { // 层序推进
    layers.push([...frontier]); // 记录本层
    const next: string[] = []; // 下一层
    for (const name of frontier) { // 逐个出队
      order.push(name); // 追加顺序
      for (const child of children.get(name) ?? []) { // 解锁后继
        const remain = (indegree.get(child) ?? 0) - 1; // 入度减一
        indegree.set(child, remain); // 写回
        if (remain === 0) next.push(child); // 入度归零即入下一层
      } // 代码块结束
    } // 代码块结束
    frontier = next; // 推进
  } // 层序结束
  const cycles = nodes.filter((node) => !order.includes(node.name)).map((node) => node.name); // 未出队即处于环中
  return { order, layers, cycles, missing }; // 返回结果
} // topologicalOrder 结束

/** 微服务依赖拓扑：输出启动分层、启动顺序与环形依赖告警 */
const serviceTopology: CapabilityHandler = async ({ text }) => { // 服务拓扑入口
  const input = parseJsonInput(text, 'service.topology') as { services?: unknown }; // 解析入参
  const raw = Array.isArray(input.services) ? input.services : []; // 服务数组
  if (raw.length === 0) throw new AppError('VALIDATION_FAILED', 'field "services" must be a non-empty array', { capability: 'service.topology' }); // 缺参拒绝
  const services = raw.slice(0, 200).map((item) => { // 归一化
    const row = item as { name?: unknown; depends_on?: unknown }; // 断言结构
    return { name: String(row.name ?? '').trim(), depends: Array.isArray(row.depends_on) ? row.depends_on.map((dep) => String(dep)) : [] }; // 取名字与依赖
  }).filter((item) => item.name); // 过滤空名
  const graph = topologicalOrder(services); // 拓扑计算
  const output = JSON.stringify({ start_order: graph.order, layers: graph.layers, cycles: graph.cycles, missing_dependencies: graph.missing, healthy: graph.cycles.length === 0 && graph.missing.length === 0 }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { services: services.length, healthy: graph.cycles.length === 0 && graph.missing.length === 0 } }; // 返回结果
}; // serviceTopology 结束

/** 工作流 DAG 校验：检环、找不可达节点、算关键路径长度 */
const workflowCheck: CapabilityHandler = async ({ text }) => { // 工作流校验入口
  const input = parseJsonInput(text, 'workflow.check') as { steps?: unknown }; // 解析入参
  const raw = Array.isArray(input.steps) ? input.steps : []; // 步骤数组
  if (raw.length === 0) throw new AppError('VALIDATION_FAILED', 'field "steps" must be a non-empty array', { capability: 'workflow.check' }); // 缺参拒绝
  const steps = raw.slice(0, 300).map((item) => { // 归一化
    const row = item as { id?: unknown; next?: unknown }; // 断言结构
    return { id: String(row.id ?? '').trim(), colons: [] as string[], next: Array.isArray(row.next) ? row.next.map((n) => String(n)) : [] }; // id 与后继
  }).filter((item) => item.id); // 过滤空 id
  const ids = new Set(steps.map((step) => step.id)); // 全部 id
  const incoming = new Map<string, number>(); // 入度
  for (const step of steps) incoming.set(step.id, 0); // 初始化
  const dangling: string[] = []; // 指向不存在节点的边
  for (const step of steps) { // 统计入度
    for (const next of step.next) { // 逐个后继
      if (!ids.has(next)) { dangling.push(`${step.id}->${next}`); continue; } // 悬空边记录
      incoming.set(next, (incoming.get(next) ?? 0) + 1); // 入度 +1
    } // 代码块结束
  } // 统计结束
  const graph = topologicalOrder(steps.map((step) => ({ name: step.id, depends: [] }))); // 占位（保持返回结构一致）
  const queue = steps.filter((step) => (incoming.get(step.id) ?? 0) === 0).map((step) => step.id); // 入口节点
  const visited = new Set<string>(queue); // 已访问
  const depth = new Map<string, number>(queue.map((id) => [id, 1])); // 深度
  while (queue.length > 0) { // 自入口向下遍历
    const id = queue.shift() as string; // 出队
    const step = steps.find((item) => item.id === id); // 取步骤
    for (const next of step?.next ?? []) { // 遍历后继
      if (!ids.has(next)) continue; // 跳过悬空边
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1)); // 更新最长深度
      if (!visited.has(next)) { visited.add(next); queue.push(next); } // 首次访问入队
    } // 代码块结束
  } // 遍历结束
  const unreachable = steps.map((step) => step.id).filter((id) => !visited.has(id)); // 从入口不可达
  const criticalPath = Math.max(0, ...depth.values()); // 最长链长度
  const cycles = steps.map((step) => step.id).filter((id) => !visited.has(id) && (incoming.get(id) ?? 0) > 0); // 入度非零且不可达，多为环
  const output = JSON.stringify({ steps: steps.length, entry_points: steps.filter((step) => (incoming.get(step.id) ?? 0) === 0).map((step) => step.id), unreachable, dangling_edges: dangling, cycles, critical_path_length: criticalPath, healthy: unreachable.length === 0 && dangling.length === 0 }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { steps: steps.length, critical_path_length: criticalPath } }; // 返回结果
}; // workflowCheck 结束

/** RBAC 权限矩阵校验：把用户角色并成权限集，判断所需权限是否覆盖 */
const rbacCheck: CapabilityHandler = async ({ text }) => { // 权限校验入口
  const input = parseJsonInput(text, 'rbac.check') as { roles?: unknown; users?: unknown; required?: unknown }; // 解析入参
  const roles = (input.roles ?? {}) as Record<string, unknown>; // 角色 → 权限数组
  const users = Array.isArray(input.users) ? input.users : []; // 用户数组
  const required = typeof input.required === 'string' ? input.required.trim() : ''; // 所需权限
  if (!required || users.length === 0) throw new AppError('VALIDATION_FAILED', 'fields "users" and "required" are required', { capability: 'rbac.check' }); // 缺参拒绝
  const rolePerms = new Map<string, string[]>(); // 角色权限表
  for (const [role, perms] of Object.entries(roles)) rolePerms.set(role, Array.isArray(perms) ? perms.map((perm) => String(perm)) : []); // 归一化
  const checks = users.slice(0, 100).map((item) => { // 逐用户判定
    const row = item as { user?: unknown; roles?: unknown }; // 断言结构
    const user = String(row.user ?? '').trim(); // 用户名
    const owned = Array.isArray(row.roles) ? row.roles.map((role) => String(role)) : []; // 拥有角色
    const perms = new Set<string>(); // 权限并集
    const unknownRoles: string[] = []; // 未定义角色
    for (const role of owned) { // 逐角色并入
      const list = rolePerms.get(role); // 查表
      if (!list) { unknownRoles.push(role); continue; } // 未定义角色记录
      list.forEach((perm) => perms.add(perm)); // 并入
    } // 代码块结束
    return { user, roles: owned, permissions: [...perms].sort(), granted: perms.has(required), unknown_roles: unknownRoles }; // 单用户结果
  }); // map 结束
  const grantedCount = checks.filter((item) => item.granted).length; // 授权人数
  const output = JSON.stringify({ required, users: checks.length, granted: grantedCount, denied: checks.length - grantedCount, details: checks }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { required, granted: grantedCount } }; // 返回结果
}; // rbacCheck 结束

/** 模板代码生成：Mustache 模板 + 数据渲染成代码文本，限制长度防止刷屏 */
const codeGen: CapabilityHandler = async ({ text }) => { // 代码生成入口
  const input = parseJsonInput(text, 'code.gen') as { template?: unknown; data?: unknown }; // 解析入参
  const template = typeof input.template === 'string' ? input.template : ''; // 模板
  if (!template.trim()) throw new AppError('VALIDATION_FAILED', 'field "template" must not be empty', { capability: 'code.gen' }); // 空模板拒绝
  const data = input.data && typeof input.data === 'object' ? (input.data as Record<string, unknown>) : {}; // 渲染数据
  let rendered = ''; // 渲染结果
  try { // 异常捕获起点：包裹可能抛出错误的操作
    rendered = mustache.render(template, data); // 交给成熟模板引擎
  } catch (err) { // 模板语法错误
    throw new AppError('VALIDATION_FAILED', `template render failed: ${(err as Error).message}`, { capability: 'code.gen' }); // 统一错误
  } // 代码块结束
  if (rendered.length > 20000) throw new AppError('VALIDATION_FAILED', 'rendered output exceeds 20000 characters', { capability: 'code.gen' }); // 限制长度
  return { output: rendered, output_kind: 'text', meta: { template_bytes: Buffer.byteLength(template, 'utf8'), output_bytes: Buffer.byteLength(rendered, 'utf8') } }; // 返回代码
}; // codeGen 结束

/** IoC 装配顺序：按 bean 依赖排出可实例化顺序，并报循环依赖与缺失 bean */
const iocGraph: CapabilityHandler = async ({ text }) => { // IoC 装配入口
  const input = parseJsonInput(text, 'ioc.graph') as { beans?: unknown }; // 解析入参
  const raw = Array.isArray(input.beans) ? input.beans : []; // bean 数组
  if (raw.length === 0) throw new AppError('VALIDATION_FAILED', 'field "beans" must be a non-empty array', { capability: 'ioc.graph' }); // 缺参拒绝
  const beans = raw.slice(0, 200).map((item) => { // 归一化
    const row = item as { name?: unknown; depends_on?: unknown }; // 断言结构
    return { name: String(row.name ?? '').trim(), depends: Array.isArray(row.depends_on) ? row.depends_on.map((dep) => String(dep)) : [] }; // 名字与依赖
  }).filter((item) => item.name); // 过滤空名
  const graph = topologicalOrder(beans); // 拓扑计算
  const output = JSON.stringify({ instantiate_order: graph.order, layers: graph.layers, circular_dependencies: graph.cycles, missing_beans: graph.missing, healthy: graph.cycles.length === 0 && graph.missing.length === 0 }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { beans: beans.length } }; // 返回结果
}; // iocGraph 结束

/** 规则集求值：用表达式库对 facts 求值 when，命中即产出 then，表达式不做任意代码执行 */
const ruleEval: CapabilityHandler = async ({ text }) => { // 规则求值入口
  const input = parseJsonInput(text, 'rule.eval') as { rules?: unknown; facts?: unknown }; // 解析入参
  const rawRules = Array.isArray(input.rules) ? input.rules : []; // 规则数组
  const facts = input.facts && typeof input.facts === 'object' ? (input.facts as Record<string, number>) : {}; // 事实表
  if (rawRules.length === 0) throw new AppError('VALIDATION_FAILED', 'field "rules" must be a non-empty array', { capability: 'rule.eval' }); // 缺参拒绝
  const results = rawRules.slice(0, 100).map((item, index) => { // 逐条求值
    const row = item as { when?: unknown; then?: unknown }; // 断言结构
    const when = String(row.when ?? '').trim(); // 条件表达式
    const then = String(row.then ?? '').trim(); // 命中结果
    if (!when) return { index, when, fired: false, error: 'empty expression' }; // 空条件视为未命中
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const value = new ExpressionParser().parse(when).evaluate(facts as Record<string, number>); // 只做数值/布尔求值
      return { index, when, then, fired: Boolean(value), value: Number.isFinite(value) ? value : null }; // 记录结果
    } catch (err) { // 表达式非法
      return { index, when, then, fired: false, error: (err as Error).message }; // 记录错误但不中断整批
    } // 代码块结束
  }); // map 结束
  const fired = results.filter((item) => item.fired).map((item) => ({ when: item.when, then: item.then })); // 命中清单
  const errors = results.filter((item) => item.error).length; // 错误条数
  const output = JSON.stringify({ rules: results.length, fired, errors, details: results }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { rules: results.length, fired: fired.length, errors } }; // 返回结果
}; // ruleEval 结束

/** Spring Boot 配置生成：按 app / datasource / profiles 生成 application.yml 并给出校验告警 */
const springConfig: CapabilityHandler = async ({ text }) => { // Spring 配置入口
  const input = parseJsonInput(text, 'spring.config') as { app?: unknown; datasource?: unknown; profiles?: unknown }; // 解析入参
  const app = (input.app ?? {}) as { name?: unknown; port?: unknown }; // 应用信息
  const ds = (input.datasource ?? {}) as { url?: unknown; user?: unknown }; // 数据源
  const name = typeof app.name === 'string' ? app.name.trim() : ''; // 应用名
  const port = Number(app.port ?? 8080); // 端口
  const warnings: string[] = []; // 校验告警
  if (!name) warnings.push('spring.application.name 缺失'); // 缺应用名
  if (!Number.isInteger(port) || port < 1 || port > 65535) warnings.push('server.port 不是合法端口'); // 端口非法
  if (!ds.url && !ds.user) warnings.push('spring.datasource 未配置，运行时将使用默认内存库'); // 数据源缺失
  const config: Record<string, unknown> = { // 组装静态配置
    server: { port: Number.isInteger(port) ? port : 8080 }, // 端口
    spring: { // spring 段
      application: { name: name || 'application' }, // 应用名
      ...(ds.url || ds.user ? { datasource: { url: String(ds.url ?? ''), username: String(ds.user ?? '') } } : {}), // 按需挂数据源
    }, // 代码块结束
  }; // 配置对象结束
  if (Array.isArray(input.profiles) && input.profiles.length > 0) config['spring.profiles'] = input.profiles.map((p) => String(p)); // 允许显式列 profile
  const output = stringifyYamlText(config, { lineWidth: 0 }); // 生成 YAML
  return { output, output_kind: 'text', meta: { warnings, port } }; // 返回 YAML
}; // springConfig 结束

/** package.json 体检：校验名称规则、semver 版本、依赖范围是否可解析 */
const nodePkg: CapabilityHandler = async ({ text }) => { // package 体检入口
  const input = parseJsonInput(text, 'node.pkg') as { name?: unknown; version?: unknown; dependencies?: unknown; devDependencies?: unknown }; // 解析入参
  const issues: string[] = []; // 问题清单
  const name = typeof input.name === 'string' ? input.name : ''; // 包名
  if (!/^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) issues.push(`name 不符合 npm 包名规范: ${name || '(空)'}`); // 名称校验
  const version = typeof input.version === 'string' ? input.version : ''; // 版本
  const validVersion = semver.valid(version); // semver 校验
  if (!validVersion) issues.push(`version 不是合法 semver: ${version || '(空)'}`); // 版本校验
  const bundles: Array<[string, Record<string, unknown>]> = [['dependencies', (input.dependencies ?? {}) as Record<string, unknown>], ['devDependencies', (input.devDependencies ?? {}) as Record<string, unknown>]]; // 两段依赖
  const deps: Array<{ section: string; name: string; range: string; resolvable: boolean }> = []; // 依赖明细
  for (const [section, bucket] of bundles) { // 逐段扫描
    for (const [depName, range] of Object.entries(bucket)) { // 逐依赖
      const spec = String(range); // 版本范围
      const resolvable = Boolean(semver.validRange(spec)) || spec.startsWith('workspace:') || spec.startsWith('npm:') || spec.startsWith('file:') || spec.startsWith('link:'); // 允许 workspace / alias 形态
      deps.push({ section, name: depName, range: spec, resolvable }); // 记录明细
      if (!resolvable) issues.push(`${section}.${depName} 版本范围不可解析: ${spec}`); // 记入问题
    } // 代码块结束
  } // 扫描结束
  const output = JSON.stringify({ name, version: validVersion ?? version, dependencies_checked: deps.length, issues, ok: issues.length === 0, dependencies: deps.slice(0, 100) }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { dependencies: deps.length, issues: issues.length } }; // 返回结果
}; // nodePkg 结束

/** 流程节点完整性校验：开始/结束配对、悬空引用、孤立节点与不可达节点 */
const bpmnCheck: CapabilityHandler = async ({ text }) => { // 流程校验入口
  const input = parseJsonInput(text, 'bpmn.check') as { nodes?: unknown }; // 解析入参
  const raw = Array.isArray(input.nodes) ? input.nodes : []; // 节点数组
  if (raw.length === 0) throw new AppError('VALIDATION_FAILED', 'field "nodes" must be a non-empty array', { capability: 'bpmn.check' }); // 缺参拒绝
  const nodes = raw.slice(0, 300).map((item) => { // 归一化
    const row = item as { id?: unknown; type?: unknown; out?: unknown }; // 断言结构
    return { id: String(row.id ?? '').trim(), type: String(row.type ?? 'task').trim(), out: Array.isArray(row.out) ? row.out.map((n) => String(n)) : [] }; // id/类型/出边
  }).filter((node) => node.id); // 过滤空 id
  const ids = new Set(nodes.map((node) => node.id)); // 全部 id
  const starts = nodes.filter((node) => node.type === 'start'); // 开始节点
  const ends = nodes.filter((node) => node.type === 'end'); // 结束节点
  const dangling = nodes.flatMap((node) => node.out.filter((next) => !ids.has(next)).map((next) => `${node.id}->${next}`)); // 悬空出边
  const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0])); // 入度
  let danglingCount = 0; // 悬空计数（用于与 dangling 对齐）
  for (const node of nodes) { // 统计入度
    for (const next of node.out) { // 逐出边
      if (!ids.has(next)) { danglingCount += 1; continue; } // 悬空跳过
      incoming.set(next, (incoming.get(next) ?? 0) + 1); // 入度 +1
    } // 代码块结束
  } // 统计结束
  const orphans = nodes.filter((node) => node.type !== 'start' && (incoming.get(node.id) ?? 0) === 0).map((node) => node.id); // 非开始且无入边即孤立
  const deadEnds = nodes.filter((node) => node.type !== 'end' && node.out.length === 0).map((node) => node.id); // 非结束且无出边
  const output = JSON.stringify({ nodes: nodes.length, start_nodes: starts.length, end_nodes: ends.length, dangling_edges: dangling, orphan_nodes: orphans, dead_end_nodes: deadEnds, healthy: starts.length === 1 && ends.length >= 1 && dangling.length === 0 && orphans.length === 0 && deadEnds.length === 0 }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { nodes: nodes.length, dangling: dangling.length || danglingCount } }; // 返回结果
}; // bpmnCheck 结束

/** CSS 关键帧生成：把偏移与样式声明拼成 @keyframes 块，附一条示例 animation 用法 */
const animKeyframes: CapabilityHandler = async ({ text }) => { // 关键帧入口
  const input = parseJsonInput(text, 'anim.keyframes') as { name?: unknown; duration?: unknown; frames?: unknown }; // 解析入参
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().replace(/[^a-zA-Z0-9_-]/g, '') : 'mim-anim'; // 动画名只留安全字符
  const duration = typeof input.duration === 'string' ? input.duration : '1s'; // 时长
  const frames = Array.isArray(input.frames) ? input.frames : []; // 帧数组
  if (frames.length === 0) throw new AppError('VALIDATION_FAILED', 'field "frames" must be a non-empty array', { capability: 'anim.keyframes' }); // 缺参拒绝
  const blocks = frames.slice(0, 20).map((item) => { // 逐帧生成
    const row = item as { offset?: unknown; styles?: unknown }; // 断言结构
    const offset = String(row.offset ?? '0%'); // 偏移键
    const styles = row.styles && typeof row.styles === 'object' ? (row.styles as Record<string, unknown>) : {}; // 样式声明
    const decls = Object.entries(styles).map(([prop, value]) => `    ${prop}: ${String(value)};`); // 每条声明一行
    return `  ${offset} {\n${decls.join('\n')}\n  }`; // 单帧块
  }); // map 结束
  const output = `@keyframes ${name} {\n${blocks.join('\n')}\n}\n\n/* 用法：animation: ${name} ${duration} ease-in-out infinite; */`; // 组装 CSS
  return { output, output_kind: 'text', meta: { frames: frames.length, name, duration } }; // 返回 CSS
}; // animKeyframes 结束

/** 手机号规范化：清洗分隔符，按国家码与号段输出 E.164、地区、运营商与掩码 */
const phoneFormat: CapabilityHandler = async ({ text }) => { // 手机号入口
  const cleaned = text.trim().replace(/[()\s-]/g, '').replace(/^00/, '+'); // 去掉空格括号连字符，00 前缀换成 +
  const digits = cleaned.replace(/[^0-9]/g, ''); // 纯数字
  if (digits.length < 6 || digits.length > 15) throw new AppError('VALIDATION_FAILED', 'field "text" must be a phone number', { capability: 'phone.format' }); // 长度不合理拒绝
  const hasCnPrefix = cleaned.startsWith('+86') || (digits.length === 13 && digits.startsWith('86')); // 判断中国大陆
  const national = hasCnPrefix ? digits.replace(/^86/, '') : digits; // 去掉国家码
  const country = hasCnPrefix || (national.length === 11 && national.startsWith('1')) ? 'CN' : 'UNKNOWN'; // 粗判地区
  const e164 = country === 'CN' ? `+86${national}` : `+${digits}`; // E.164 手机号格式
  const carrier = (() => { // 号段粗判运营商
    if (country !== 'CN') return 'Unknown'; // 非中国大陆不判
    const prefix3 = national.slice(0, 3); // 前三位号段
    const mobile = ['134', '135', '136', '137', '138', '139', '147', '150', '151', '152', '157', '158', '159', '178', '182', '183', '184', '187', '188', '195', '197', '198']; // 移动号段
    const unicom = ['130', '131', '132', '145', '155', '156', '166', '175', '176', '185', '186', '196']; // 联通号段
    const telecom = ['133', '149', '153', '173', '177', '180', '181', '189', '190', '191', '193', '199']; // 电信号段
    if (mobile.includes(prefix3)) return '中国移动'; // 移动
    if (unicom.includes(prefix3)) return '中国联通'; // 联通
    if (telecom.includes(prefix3)) return '中国电信'; // 电信
    return '未知号段'; // 兜底
  })(); // 运营商判定结束
  const masked = national.length === 11 ? `${national.slice(0, 3)}****${national.slice(-4)}` : `${national.slice(0, 2)}****${national.slice(-2)}`; // 掩码形式
  const output = JSON.stringify({ input: text.trim(), e164, country, national: national, carrier, masked, valid_length: national.length === 11 || country !== 'CN' }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { country, carrier } }; // 返回结果
}; // phoneFormat 结束

/** Tauri 能力配置生成：校验标识与权限后输出 capability JSON，可直接落到 src-tauri/capabilities */
const tauriPerm: CapabilityHandler = async ({ text }) => { // Tauri 权限入口
  const input = parseJsonInput(text, 'tauri.perm') as { identifier?: unknown; windows?: unknown; permissions?: unknown }; // 解析入参
  const identifier = typeof input.identifier === 'string' ? input.identifier.trim() : 'default'; // 能力标识
  const windows = Array.isArray(input.windows) ? input.windows.map((w) => String(w)) : ['main']; // 适用窗口
  const permissions = Array.isArray(input.permissions) ? input.permissions.map((p) => String(p)) : []; // 权限清单
  const issues: string[] = []; // 校验问题
  if (!/^[a-z0-9-]+$/.test(identifier)) issues.push('identifier 只允许小写字母、数字与连字符'); // 标识规范
  if (windows.length === 0) issues.push('windows 不能为空'); // 窗口为空
  if (permissions.length === 0) issues.push('permissions 不能为空，至少应包含 core:default'); // 权限为空
  const capability = { $schema: '../gen/schemas/desktop-schema.json', identifier, description: `Mim capability generated for ${identifier}`, windows, permissions }; // 目标结构
  const output = JSON.stringify({ capability, issues, ok: issues.length === 0 }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { permissions: permissions.length, issues: issues.length } }; // 返回结果
}; // tauriPerm 结束

/** Web 项目脚手架：按框架与特性清单产出目录树，帮助快速判断项目骨架是否齐备 */
const webScaffold: CapabilityHandler = async ({ text }) => { // 脚手架入口
  const input = parseJsonInput(text, 'web.scaffold') as { name?: unknown; framework?: unknown; features?: unknown }; // 解析入参
  const name = String(input.name ?? '').trim(); // 项目名
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) throw new AppError('VALIDATION_FAILED', 'field "name" must be kebab-case (a-z0-9-)', { capability: 'web.scaffold' }); // 名称规范
  const framework = typeof input.framework === 'string' ? input.framework : 'vite-react'; // 默认 Vite + React
  const features = Array.isArray(input.features) ? input.features.map((f) => String(f)) : []; // 可选特性
  const files: Array<{ path: string; purpose: string }> = [ // 基础骨架
    { path: `${name}/package.json`, purpose: '依赖与脚本' }, // 包清单
    { path: `${name}/index.html`, purpose: '入口 HTML' }, // 入口页
    { path: `${name}/src/main.ts`, purpose: '应用入口' }, // 应用入口
    { path: `${name}/src/App.tsx`, purpose: '根组件' }, // 根组件
    { path: `${name}/vite.config.ts`, purpose: '构建配置' }, // 构建配置
  ]; // 基础清单结束
  if (features.includes('router')) files.push({ path: `${name}/src/router.ts`, purpose: '路由表' }); // 路由
  if (features.includes('test')) files.push({ path: `${name}/test/app.test.tsx`, purpose: '组件测试' }); // 测试
  if (features.includes('ci')) files.push({ path: `${name}/.github/workflows/ci.yml`, purpose: 'CI 流水线' }); // CI 流水线
  if (features.includes('docker')) files.push({ path: `${name}/Dockerfile`, purpose: '容器构建' }); // 容器
  const unknownFeatures = features.filter((f) => !['router', 'test', 'ci', 'docker'].includes(f)); // 未识别的特性
  const output = JSON.stringify({ name, framework, files, unknown_features: unknownFeatures }, null, 2); // 结构化输出
  return { output, output_kind: 'json', meta: { files: files.length, framework } }; // 返回骨架
}; // webScaffold 结束

/** jQuery 插件骨架：IIFE + $.fn 扩展 + 默认参数合并，直接可粘进项目 */
const jqueryPlugin: CapabilityHandler = async ({ text }) => { // jQuery 入口
  const name = text.trim(); // 插件名
  if (!/^[a-z][a-zA-Z0-9]{1,30}$/.test(name)) throw new AppError('VALIDATION_FAILED', 'field "text" must be a camelCase plugin name', { capability: 'jquery.plugin' }); // 名称规范
  const output = [ // 拼接骨架
    `/* ${name} 插件骨架：IIFE 隔离作用域，避免污染全局 */`, // 注释
    `(function ($) {`, // IIFE 开始
    `  $.fn.${name} = function (options) {`, // 扩展方法
    `    var settings = $.extend({ text: '', delay: 0 }, options);`, // 合并默认参数
    `    return this.each(function () {`, // 逐个元素处理
    `      var $el = $(this);`, // 当前元素
    `      $el.text(settings.text);`, // 示例动作
    `    });`, // each 结束
    `  };`, // 方法结束
    `})(jQuery);`, // IIFE 结束
  ].join('\n'); // 组装
  return { output, output_kind: 'text', meta: { plugin: name } }; // 返回代码
}; // jqueryPlugin 结束

/** 组件 Props 校验：schema 里 `type!` 表示必填，输出缺失、类型不符与多余字段 */
const uiProps: CapabilityHandler = async ({ text }) => { // Props 入口
  const input = parseJsonInput(text, 'ui.props') as { schema?: unknown; props?: unknown }; // 解析入参
  const schema = (input.schema ?? {}) as Record<string, string>; // schema 表
  const props = (input.props ?? {}) as Record<string, unknown>; // 实际传参
  if (Object.keys(schema).length === 0) throw new AppError('VALIDATION_FAILED', 'field "schema" must be a non-empty object', { capability: 'ui.props' }); // 缺参拒绝
  const typeOf = (value: unknown): string => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value); // 细分类型
  const issues: string[] = []; // 问题清单
  for (const [key, spec] of Object.entries(schema)) { // 逐字段校验
    const required = String(spec).endsWith('!'); // 是否必填
    const expectType = String(spec).replace('!', ''); // 期望类型
    const present = Object.prototype.hasOwnProperty.call(props, key); // 是否传入
    if (!present && required) issues.push(`缺少必填字段: ${key}`); // 必填缺失
    if (present && expectType && typeOf(props[key]) !== expectType) issues.push(`字段 ${key} 类型应为 ${expectType}，实际 ${typeOf(props[key])}`); // 类型不符
  } // 校验结束
  const extra = Object.keys(props).filter((key) => !Object.prototype.hasOwnProperty.call(schema, key)); // 多余字段
  if (extra.length > 0) issues.push(`多余字段: ${extra.join(',')}`); // 记入问题
  return { output: JSON.stringify({ valid: issues.length === 0, issues, extra_fields: extra }, null, 2), output_kind: 'json', meta: { issues: issues.length } }; // 返回结论
}; // uiProps 结束

/** JavaScript 值类型判定：按字面量给出精确类型、可安全转换的目标与常见坑 */
const jsType: CapabilityHandler = async ({ text }) => { // 类型判定入口
  const raw = text.trim(); // 原文
  let value: unknown = raw; // 默认按字符串
  let parsed = false; // 是否按 JSON 解析成功
  if (raw === 'null') { value = null; parsed = true; } else if (raw === 'undefined') { value = undefined; parsed = true; } else { // 关键字单独处理
    try { value = JSON.parse(raw); parsed = true; } catch { value = raw; } // 能解析就当字面量
  } // 解析分支结束
  const type = value === null ? 'null' : value === undefined ? 'undefined' : Array.isArray(value) ? 'array' : typeof value; // 精确类型
  const conversions: Record<string, string[]> = { array: ['join() → string', 'JSON.stringify → string', 'Array.from → array'], object: ['JSON.stringify → string', 'Object.keys → array'], number: ['String() → string', 'Number.isInteger → boolean'], string: ['JSON.parse → object/array（需合法）', 'Number() → number 或 NaN'], boolean: ['String() → "true"/"false"'], null: ['String(null) → "null"'], undefined: ['String(undefined) → "undefined"'] }; // 转换建议表
  const pitfalls: string[] = []; // 常见坑
  if (!parsed && raw.length > 0) pitfalls.push('输入被判为字符串（未加引号的字面量不会被 JSON 解析）'); // 未加引号
  if (typeof value === 'number' && !Number.isSafeInteger(value)) pitfalls.push('非安全整数，超过 2^53 会丢精度'); // 精度
  return { output: JSON.stringify({ input: raw.slice(0, 80), type, parsed_as_json: parsed, suggestions: conversions[type] ?? [], pitfalls }, null, 2), output_kind: 'json', meta: { type } }; // 输出结论
}; // jsType 结束

/** RESTful 路径检查：抓动词滥用、大小写混用、资源层级与版本前缀缺失 */
const restLint: CapabilityHandler = async ({ text }) => { // REST 检查入口
  const input = parseJsonInput(text, 'rest.lint') as { method?: unknown; path?: unknown }; // 解析入参
  const method = String(input.method ?? 'GET').toUpperCase(); // 方法
  const path = String(input.path ?? '').trim(); // 路径
  if (!path.startsWith('/')) throw new AppError('VALIDATION_FAILED', 'field "path" must start with "/"', { capability: 'rest.lint' }); // 路径格式
  const issues: string[] = []; // 问题
  const segments = path.split('/').filter(Boolean); // 路径段
  if (!/^\/api\/v\d+/.test(path) && !path.startsWith('/health')) issues.push('缺少版本前缀（建议 /api/v1/...）'); // 版本
  const verb = segments.find((seg) => /^(get|post|create|update|delete|remove|fetch|query|save)[A-Z]/.test(seg)); // 动词开头段
  if (verb) issues.push(`路径含动词: ${verb}（REST 用 HTTP 方法表达动作）`); // 动词滥用
  if (/[A-Z]/.test(path)) issues.push('路径含大写字母（建议 kebab-case 全小写）'); // 大小写
  if (segments.some((seg) => seg.includes('_'))) issues.push('路径含下划线（建议用连字符）'); // 下划线
  const collectionIndex = segments.findIndex((seg) => !seg.startsWith(':') && seg === segments[segments.length - 1]); // 末段是否集合
  if (!['GET', 'POST'].includes(method) && collectionIndex >= 0) issues.push('非 GET/POST 方法却指向集合资源（应指向单个资源）'); // 方法语义
  const suggestion = path.replace(/\/get([A-Z][a-zA-Z]*)/g, (_all, rest: string) => `/${rest.charAt(0).toLowerCase()}${rest.slice(1)}`).replace(/([A-Z])/g, (_all, ch: string) => `-${ch.toLowerCase()}`).replace(/--+/g, '-').toLowerCase(); // 建议路径
  return { output: JSON.stringify({ method, path, valid: issues.length === 0, issues, suggested_path: suggestion }, null, 2), output_kind: 'json', meta: { issues: issues.length } }; // 输出结论
}; // restLint 结束

/** 后台菜单树：按路径层级嵌套成树，标出重复路径与层级断裂 */
const adminMenu: CapabilityHandler = async ({ text }) => { // 菜单入口
  const input = parseJsonInput(text, 'admin.menu') as { routes?: unknown }; // 解析入参
  const raw = Array.isArray(input.routes) ? input.routes : []; // 路由清单
  if (raw.length === 0) throw new AppError('VALIDATION_FAILED', 'field "routes" must be a non-empty array', { capability: 'admin.menu' }); // 缺参拒绝
  const duplicates: string[] = []; // 重复路径
  const seen = new Set<string>(); // 已见路径
  const flat = raw.slice(0, 200).map((item) => { // 归一化
    const row = item as { path?: unknown; title?: unknown; order?: unknown }; // 断言
    const path = String(row.path ?? '').trim(); // 路径
    if (seen.has(path)) duplicates.push(path); // 重复记录
    seen.add(path); // 登记
    return { path, title: String(row.title ?? path), order: Number(row.order ?? 999) }; // 扁平项
  }).filter((item) => item.path.startsWith('/')); // 只留绝对路径
  const tree: Array<Record<string, unknown>> = []; // 树根
  const index = new Map<string, Record<string, unknown>>(); // path → 节点
  for (const item of [...flat].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.order - b.order)) { // 浅层先建
    const node: Record<string, unknown> = { path: item.path, title: item.title, order: item.order, children: [] }; // 新节点
    const parentPath = item.path.replace(/\/[^/]+$/, ''); // 父路径
    const parent = index.get(parentPath); // 查父节点
    if (parent) (parent.children as Record<string, unknown>[]).push(node); else tree.push(node); // 挂载
    index.set(item.path, node); // 登记
  } // 建树结束
  const orphans = flat.filter((item) => item.path !== '/' && !index.has(item.path.replace(/\/[^/]+$/, ''))).map((item) => item.path); // 父级缺失
  return { output: JSON.stringify({ total: flat.length, tree, duplicates, orphans }, null, 2), output_kind: 'json', meta: { total: flat.length, duplicates: duplicates.length } }; // 输出树
}; // adminMenu 结束

/** 设计令牌刻度：按基数生成间距阶与字号阶，统一设计系统数值 */
const themeTokens: CapabilityHandler = async ({ text }) => { // 令牌入口
  const base = Number.parseInt(text.trim(), 10); // 基数
  if (!Number.isInteger(base) || base < 1 || base > 16) throw new AppError('VALIDATION_FAILED', 'field "text" must be an integer base between 1 and 16', { capability: 'theme.tokens' }); // 基数范围
  const spacing = [1, 2, 3, 4, 5, 6, 8, 10].map((step) => ({ token: `space-${step}`, value: `${step * base}px` })); // 间距
  const fontSizes = [12, 14, 16, 20, 24, 32, 40, 48].map((size) => ({ token: `font-${size}`, value: `${size}px` })); // 字号
  const radius = [2, 4, 8, 12, 16].map((value) => ({ token: `radius-${value}`, value: `${value}px` })); // 圆角
  return { output: JSON.stringify({ base, spacing, font_sizes: fontSizes, radius }, null, 2), output_kind: 'json', meta: { base, tokens: spacing.length + fontSizes.length + radius.length } }; // 输出令牌
}; // themeTokens 结束

/** Vue 单文件组件骨架：`<script setup>` + props/emits 定义 + 模板 */
const vueSfc: CapabilityHandler = async ({ text }) => { // Vue 入口
  const input = parseJsonInput(text, 'vue.sfc') as { name?: unknown; props?: unknown; emits?: unknown }; // 解析入参
  const name = String(input.name ?? '').trim(); // 组件名
  if (!/^[A-Z][a-zA-Z0-9]{1,40}$/.test(name)) throw new AppError('VALIDATION_FAILED', 'field "name" must be PascalCase', { capability: 'vue.sfc' }); // 名称规范
  const props = Array.isArray(input.props) ? input.props.map((p) => String(p)) : []; // props 入参
  const emits = Array.isArray(input.emits) ? input.emits.map((e) => String(e)) : []; // emits 事件
  const propsBlock = props.length > 0 ? `const props = defineProps<{ ${props.map((p) => `${p}: string`).join('; ')} }>();` : 'const props = defineProps<Record<string, never>>();'; // props 声明
  const emitsBlock = emits.length > 0 ? `const emit = defineEmits<{ ${emits.map((e) => `(e: '${e}'): void`).join('; ')} }>();` : ''; // emits 声明
  const output = [ // 常量 output：保存固定配置或一次性派生值
    `<script setup lang="ts">`, // 脚本区
    propsBlock, // props 入参
    emitsBlock, // emits 事件
    `</script>`, // 脚本结束
    ``, // 空行
    `<template>`, // 模板区
    `  <div class="${name.toLowerCase()}">`, // 根节点
    `    <slot />`, // 默认插槽
    `  </div>`, // 根节点结束
    `</template>`, // 模板结束
  ].filter((line) => line !== '').join('\n'); // 去掉空行拼接
  return { output, output_kind: 'text', meta: { name, props: props.length, emits: emits.length } }; // 返回 SFC
}; // vueSfc 结束

/** 爬虫合规计划：URL 归一化 + 礼貌抓取参数 + 分页模板推断 */
const crawlerPlan: CapabilityHandler = async ({ text }) => { // 爬虫入口
  const input = parseJsonInput(text, 'crawler.plan') as { start?: unknown; pages?: unknown }; // 解析入参
  const start = String(input.start ?? '').trim(); // 起点
  let url: URL; // 解析结果
  try { url = new URL(start); } catch { throw new AppError('VALIDATION_FAILED', 'field "start" must be an absolute URL', { capability: 'crawler.plan' }); } // 必须是绝对地址
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('VALIDATION_FAILED', 'only http/https are supported', { capability: 'crawler.plan' }); // 协议限制
  const pages = Math.min(1000, Math.max(1, Number.parseInt(String(input.pages ?? 50), 10) || 50)); // 目标页数
  const tracking = ['utm_source', 'utm_medium', 'utm_campaign', 'spm', 'from']; // 跟踪参数
  for (const key of tracking) url.searchParams.delete(key); // 清理跟踪参数
  const delayMs = 800; // 礼貌延迟
  const estimateSeconds = Math.ceil((pages * delayMs) / 1000); // 预计耗时
  const hasPageParam = [...url.searchParams.keys()].some((key) => /page|p|offset|start/i.test(key)); // 是否已有分页参数
  const output = JSON.stringify({ normalized_url: url.toString(), pages, concurrency: 1, delay_ms: delayMs, estimated_seconds: estimateSeconds, page_param_detected: hasPageParam, robots_hint: `${url.origin}/robots.txt 需先读取并遵守 Disallow`, headers: { 'User-Agent': 'MimBot/0.0 (+https://mim.mixm.top)', 'Accept-Language': 'zh-CN,zh;q=0.9' } }, null, 2); // 计划
  return { output, output_kind: 'json', meta: { pages, estimated_seconds: estimateSeconds } }; // 返回计划
}; // crawlerPlan 结束

/** Angular standalone 组件骨架：inputs/outputs 以 signal 形式声明 */
const angularCmp: CapabilityHandler = async ({ text }) => { // Angular 入口
  const input = parseJsonInput(text, 'angular.cmp') as { name?: unknown; inputs?: unknown; outputs?: unknown }; // 解析入参
  const name = String(input.name ?? '').trim(); // 组件名（kebab-case）
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) throw new AppError('VALIDATION_FAILED', 'field "name" must be kebab-case', { capability: 'angular.cmp' }); // 名称规范
  const className = name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('') + 'Component'; // 类名
  const inputs = Array.isArray(input.inputs) ? input.inputs.map((i) => String(i)) : []; // 输入
  const outputs = Array.isArray(input.outputs) ? input.outputs.map((o) => String(o)) : []; // 输出
  const output = [ // 常量 output：保存固定配置或一次性派生值
    `import { Component, input, output } from '@angular/core';`, // 依赖
    ``, // 空行
    `@Component({`, // 装饰器
    `  selector: 'app-${name}',`, // 选择器
    `  standalone: true,`, // 独立组件
    `  template: \`<div class="${name}"><ng-content /></div>\`,`, // 模板
    `})`, // 装饰器结束
    `export class ${className} {`, // 类声明
    ...inputs.map((prop) => `  readonly ${prop} = input<string>('');`), // 输入声明
    ...outputs.map((prop) => `  readonly ${prop} = output<void>();`), // 输出声明
    `}`, // 类结束
  ].join('\n'); // 组装
  return { output, output_kind: 'text', meta: { inputs: inputs.length, outputs: outputs.length } }; // 返回组件
}; // angularCmp 结束

/** Bootstrap 栅格换算：断点 → col 类名，越界给出夹紧后的值 */
const bsGrid: CapabilityHandler = async ({ text }) => { // 栅格入口
  const input = parseJsonInput(text, 'bs.grid') as Record<string, unknown>; // 解析入参
  const breakpoints = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl']; // 合法断点
  const classes: string[] = []; // 类名
  const issues: string[] = []; // 提示
  for (const [bp, raw] of Object.entries(input)) { // 逐断点
    if (!breakpoints.includes(bp)) { issues.push(`未知断点: ${bp}`); continue; } // 非法断点
    const span = Number(raw); // 占比
    if (!Number.isInteger(span) || span < 1 || span > 12) { issues.push(`${bp} 取值应为 1–12 的整数`); continue; } // 越界
    classes.push(bp === 'xs' ? `col-${span}` : `col-${bp}-${span}`); // 类名
  } // 循环结束
  return { output: JSON.stringify({ classes, class_string: classes.join(' '), issues }, null, 2), output_kind: 'json', meta: { classes: classes.length } }; // 输出类名
}; // bsGrid 结束

/** React 函数组件骨架：TSX + props 接口 + 可选 memo 包裹 */
const reactCmp: CapabilityHandler = async ({ text }) => { // React 入口
  const input = parseJsonInput(text, 'react.cmp') as { name?: unknown; props?: unknown; memo?: unknown }; // 解析入参
  const name = String(input.name ?? '').trim(); // 组件名
  if (!/^[A-Z][a-zA-Z0-9]{1,40}$/.test(name)) throw new AppError('VALIDATION_FAILED', 'field "name" must be PascalCase', { capability: 'react.cmp' }); // 名称规范
  const props = Array.isArray(input.props) ? input.props.map((p) => String(p)) : []; // props 入参
  const useMemo = Boolean(input.memo); // 是否 memo
  const propsType = props.length > 0 ? props.map((p) => `  ${p}?: string;`).join('\n') : '  // 无外部 props'; // 接口字段
  const output = [ // 常量 output：保存固定配置或一次性派生值
    `import type { JSX } from 'react';`, // 类型导入
    ``, // 空行
    `export interface ${name}Props {`, // 接口
    propsType, // 字段
    `}`, // 接口结束
    ``, // 空行
    `/** ${name}：函数组件骨架 */`, // 注释
    `export function ${name}(props: ${name}Props): JSX.Element {`, // 函数
    `  return <div className="${name.toLowerCase()}">{props.${props[0] ?? 'title'} ?? '${name}'}</div>;`, // 渲染
    `}`, // 函数结束
    ...(useMemo ? ['', `export default memo(${name});`] : []), // 可选 memo
  ].join('\n'); // 组装
  return { output, output_kind: 'text', meta: { props: props.length, memo: useMemo } }; // 返回组件
}; // reactCmp 结束

/** RPC 方法签名校验：方法名分段小写、参数必须带类型且类型在白名单内 */
const rpcMethods: CapabilityHandler = async ({ text }) => { // RPC 入口
  const input = parseJsonInput(text, 'rpc.methods') as { methods?: unknown }; // 解析入参
  const raw = Array.isArray(input.methods) ? input.methods : []; // 方法清单
  const allowedTypes = ['string', 'number', 'boolean', 'object', 'array', 'any']; // 允许类型
  const issues: string[] = []; // 问题
  const methods = raw.slice(0, 100).map((item, index) => { // 逐方法
    const row = item as { name?: unknown; params?: unknown }; // 断言
    const name = String(row.name ?? '').trim(); // 方法名
    const params = Array.isArray(row.params) ? row.params.map((p) => String(p)) : []; // 参数
    const nameOk = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/.test(name); // 分段小写
    if (!nameOk) issues.push(`#${index} 方法名不合法: ${name || '(空)'}`); // 名称问题
    const badParams = params.filter((param) => { const [paramName, paramType] = param.split(':'); return !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName ?? '') || !allowedTypes.includes(paramType ?? ''); }); // 非法参数
    if (badParams.length > 0) issues.push(`#${index} 参数不合法: ${badParams.join(',')}`); // 参数问题
    return { name, params, name_ok: nameOk, param_issues: badParams.length }; // 单条结果
  }); // map 结束
  return { output: JSON.stringify({ total: methods.length, issues, methods }, null, 2), output_kind: 'json', meta: { methods: methods.length, issues: issues.length } }; // 输出结论
}; // rpcMethods 结束

/** 网关路由体检：把参数段归一后检测重复与参数命名漂移 */
const apiRoutes: CapabilityHandler = async ({ text }) => { // 网关入口
  const input = parseJsonInput(text, 'api.routes') as { routes?: unknown }; // 解析入参
  const raw = Array.isArray(input.routes) ? input.routes : []; // 路由清单
  if (raw.length === 0) throw new AppError('VALIDATION_FAILED', 'field "routes" must be a non-empty array', { capability: 'api.routes' }); // 缺参拒绝
  const seenShape = new Map<string, string>(); // 归一形 → 首次路径
  const duplicates: string[] = []; // 重复
  const drift: string[] = []; // 参数命名漂移
  const paramNameByShape = new Map<string, string>(); // 归一形 → 参数名
  const routes = raw.slice(0, 200).map((item) => { // 归一化
    const row = item as { method?: unknown; path?: unknown }; // 断言
    const method = String(row.method ?? 'GET').toUpperCase(); // 方法
    const path = String(row.path ?? '').trim(); // 路径
    const shape = `${method} ${path.replace(/:[^/]+/g, ':param')}`; // 归一形
    if (seenShape.has(shape)) duplicates.push(`${shape}（首次: ${seenShape.get(shape)}，重复: ${path}）`); else seenShape.set(shape, path); // 重复记录
    const paramMatch = /:([^/]+)/.exec(path); // 取参数名
    if (paramMatch) { const prev = paramNameByShape.get(shape); if (prev && prev !== paramMatch[1]) drift.push(`${shape} 参数名不一致: ${prev} vs ${paramMatch[1]}`); else paramNameByShape.set(shape, paramMatch[1]); } // 漂移检测
    return { method, path, shape }; // 单条
  }); // map 结束
  return { output: JSON.stringify({ total: routes.length, duplicates, param_naming_drift: drift, healthy: duplicates.length === 0 && drift.length === 0 }, null, 2), output_kind: 'json', meta: { routes: routes.length, duplicates: duplicates.length } }; // 输出结论
}; // apiRoutes 结束

/** 短链码生成：sha256 摘要映射到 Base62 取 6 位，附碰撞概率提示 */
const urlShort: CapabilityHandler = async ({ text }) => { // 短链入口
  const target = text.trim(); // 长链
  let url: URL; // 解析
  try { url = new URL(target); } catch { throw new AppError('VALIDATION_FAILED', 'field "text" must be an absolute URL', { capability: 'url.short' }); } // 必须绝对地址
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'; // Base62 字母表
  const digest = createHash('sha256').update(url.toString()).digest('hex'); // 摘要
  let code = ''; // 短码
  for (let i = 0; i < 6; i++) { // 取 6 位
    const chunk = Number.parseInt(digest.slice(i * 8, i * 8 + 8), 16); // 8 位十六进制转数值
    code += alphabet[chunk % 62]; // 映射到字母表
  } // 代码块结束
  const space = Math.pow(62, 6); // 6 位空间
  const collisionAt = Math.floor(Math.sqrt(2 * space * 0.01)); // 生日问题下 1% 碰撞所需条数
  return { output: JSON.stringify({ target: url.toString(), code, space, collision_notice: `约 ${collisionAt} 条后达到 1% 碰撞概率，建议入库前查重`, short_path: `/s/${code}` }, null, 2), output_kind: 'json', meta: { code } }; // 输出短码
}; // urlShort 结束

/** layui 表格列配置：按字段推断标题、排序与宽度，输出 cols 数组 */
const layuiTable: CapabilityHandler = async ({ text }) => { // layui 入口
  const input = parseJsonInput(text, 'layui.table') as { fields?: unknown }; // 解析入参
  const fields = Array.isArray(input.fields) ? input.fields.map((f) => String(f)) : []; // 字段清单
  if (fields.length === 0) throw new AppError('VALIDATION_FAILED', 'field "fields" must be a non-empty array', { capability: 'layui.table' }); // 缺参拒绝
  const labelOf = (field: string): string => ({ id: 'ID', name: '名称', title: '标题', status: '状态', created_at: '创建时间', updated_at: '更新时间' } as Record<string, string>)[field] ?? field; // 常用中文标题
  const cols = fields.slice(0, 50).map((field, index) => ({ field, title: labelOf(field), width: index === 0 ? 80 : undefined, sort: ['id', 'created_at', 'updated_at'].includes(field), fixed: index === 0 ? 'left' : undefined })); // 列配置
  const output = `cols: [[\n${cols.map((col) => `  { field: '${col.field}', title: '${col.title}'${col.width ? `, width: ${col.width}` : ''}${col.sort ? ', sort: true' : ''}${col.fixed ? `, fixed: '${col.fixed}'` : ''} }`).join(',\n')}\n]]`; // 生成 cols 片段
  return { output, output_kind: 'text', meta: { columns: cols.length } }; // 返回配置
}; // layuiTable 结束

/** 模块编码 → 中文条目名：蓝图文档首行必须写清「这是哪个导航条目」的交付，避免同组条目串味 */
const CATALOG_ITEM_NAME: Record<string, string> = Object.fromEntries(buildCatalogModuleSeeds().map((seed) => [seed.code, seed.name])); // 205 条在模块加载时算一次

/** 解析用户输入：首行当项目名，其余行当需求补充；纯空白时按分组目录名兜底 */
function blueprintProjectName(text: string, fallback: string): { project: string; note: string } {
  const lines = text.split(/\r?\n/); // 按行切分，容忍 Windows CRLF
  const first = (lines[0] ?? '').trim(); // 首行：项目名
  const rest = lines.slice(1).join('\n').trim(); // 其余行：需求补充
  const cleaned = (first || fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); // 去掉控制字符与连续空白，防止破坏 Markdown 结构
  return { project: cleaned.slice(0, 60) || fallback, note: rest.slice(0, 2000) }; // 项目名限 60 字，补充说明限 2000 字
} // blueprintProjectName 结束

/** 组装蓝图文档：目标 / 技术栈 / 起步代码 / 目录 / 交付物 / 验收清单六段，全部来自该条目自身数据 */
function buildBlueprintDoc(blueprint: ModuleBlueprint, group: BlueprintGroupMeta, project: string, note: string): string {
  const itemName = CATALOG_ITEM_NAME[blueprint.code] ?? blueprint.code; // 模块中文名，缺失时回落编码
  const fence = '```'; // 代码围栏常量，避免在模板里出现引号歧义
  const tree = [ // 建议目录：三条固定骨架 + 项目名根目录
    `${project}/`,
    '├── README.md        # 目标 / 运行命令 / 验收结果（可直接落盘）',
    `├── src/             # 起步代码放这里（扩展名 .${group.ext}）`,
    '└── docs/            # 设计说明、联调记录与截图（可选）',
  ]; // 目录树结束
  const lines: string[] = []; // 文档行缓冲：逐行 push 便于每行单独注释
  lines.push(`# ${itemName} · 模块起盘蓝图`); // 一级标题：条目名
  lines.push(''); // 空行分隔
  lines.push(`- 模块编码：${blueprint.code}`); // 编码：便于回到商城定位
  lines.push(`- 所属分组：${group.nameZh}（能力键 ${group.capability}）`); // 分组与能力键
  lines.push(`- 项目名：${project}`); // 本次落地使用的项目名
  lines.push(''); // 空行分隔
  lines.push('## 交付目标'); // 交付目标小节
  lines.push(blueprint.summary); // 该条目专属的交付定义
  lines.push(''); // 空行分隔
  lines.push('## 推荐技术栈'); // 技术栈小节
  lines.push(blueprint.stack); // 该条目的推荐依赖 / 工具链
  lines.push(''); // 空行分隔
  lines.push(`## 起步代码（.${group.ext}）`); // 起步代码小节
  lines.push(`${fence}${group.ext}`); // 打开围栏并标注语言
  lines.push(blueprint.starter); // 可直接粘贴运行的片段
  lines.push(fence); // 关闭围栏
  lines.push(''); // 空行分隔
  lines.push('## 建议目录'); // 目录小节
  lines.push(`${fence}text`); // 目录用 text 围栏，保留树形缩进
  lines.push(...tree); // 逐行输出目录树
  lines.push(fence); // 关闭围栏
  lines.push(''); // 空行分隔
  lines.push('## 交付物'); // 交付物小节
  group.deliverablesZh.forEach((item, index) => lines.push(`${index + 1}. ${item}`)); // 逐条编号输出
  lines.push(''); // 空行分隔
  lines.push('## 验收清单'); // 验收小节
  group.checksZh.forEach((item) => lines.push(`- [ ] ${item}`)); // 待勾选格式，便于直接当任务清单用
  lines.push(''); // 空行分隔
  lines.push('## 需求补充'); // 需求补充小节
  lines.push(note.length > 0 ? note : '（未填写，可在下次调用时作为首行项目名之后的内容补充）'); // 有补充就回显，没有给引导
  lines.push(''); // 空行分隔
  lines.push(`> ${group.nameZh} 的每一条模块都有独立蓝图：换一个模块编码调用，目标、技术栈与起步代码全部随之变化。`); // 结尾提示复用方式
  return lines.join('\n'); // 拼成 Markdown 文档
} // buildBlueprintDoc 结束

/** 蓝图能力工厂：同一份逻辑按能力键生成 handler，17 个分组不必各写一遍 */
function createBlueprintHandler(capability: string): CapabilityHandler {
  return async ({ text, options }) => { // 返回该能力键专用的处理函数
    const group = blueprintGroupOfCapability(capability); // 取分组模板（目录根、扩展名、交付物、验收项）
    if (!group) throw new AppError('FEATURE_NOT_AVAILABLE', `blueprint group is not registered for ${capability}`, { capability }); // 清单与数据不一致时明确报错
    const moduleCode = optionString(options, 'module_code', ''); // 路由在 options 里下发的模块码
    const blueprint = moduleCode.length > 0 ? blueprintOfCode(moduleCode) : undefined; // 按模块码取该条目蓝图
    if (!blueprint) throw new AppError('VALIDATION_FAILED', `unknown module_code for capability ${capability}`, { capability, module_code: moduleCode }); // 缺码或未登记即拒绝
    if (blueprintGroupOfCode(moduleCode)?.capability !== capability) throw new AppError('VALIDATION_FAILED', `module ${moduleCode} does not belong to ${capability}`, { capability, module_code: moduleCode }); // 防止跨组串用
    const { project, note } = blueprintProjectName(text, group.rootDir.split('/').pop() ?? 'mim-module'); // 解析项目名与需求补充
    const doc = buildBlueprintDoc(blueprint, group, project, note); // 组装该条目专属文档
    return { output: doc, output_kind: 'text', meta: { module_code: moduleCode, capability, group: group.slug, project, bytes: Buffer.byteLength(doc, 'utf8') } }; // 回传文档与可对账的元信息
  }; // handler 结束
} // createBlueprintHandler 结束

/** 17 条蓝图能力键：与 core-domain 中 MODULE_CAPABILITIES 的 catalog.* 键逐一对应 */
const BLUEPRINT_CAPABILITY_KEYS = ['catalog.frontier', 'catalog.openharmony', 'catalog.ai', 'catalog.industry', 'catalog.blockchain', 'catalog.wechat', 'catalog.enterprise', 'catalog.storefront', 'catalog.tools', 'catalog.devops', 'catalog.mobile', 'catalog.devtools', 'catalog.server', 'catalog.database', 'catalog.game', 'catalog.plugin', 'catalog.misc']; // 顺序与首页分组展示一致

/** 蓝图能力注册片段：用工厂批量展开，注册表里只需一行注入 */
const BLUEPRINT_HANDLERS: Record<string, CapabilityHandler> = Object.fromEntries(BLUEPRINT_CAPABILITY_KEYS.map((key) => [key, createBlueprintHandler(key)])); // 键 → handler

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
  'csv.json': csvJson, // CSV 与 JSON 互转
  'template.render': templateRender, // Mustache 模板渲染
  'url.parse': urlParse, // URL 解析
  'ip.cidr': ipCidr, // IPv4 CIDR 计算
  'chart.svg': chartSvg, // SVG 图表
  'report.table': reportTable, // 报表表格
  'image.dataurl': imageDataurl, // dataURL / Base64 互转
  'log.stats': logStats, // 日志分析
  'captcha.svg': captchaSvg, // SVG 验证码
  'math.eval': mathEval, // 数学表达式求值
  'json.schema': jsonSchema, // JSON 转 JSON Schema
  'cite.format': citeFormat, // 参考文献格式化
  'yaml.json': yamlJson, // YAML 与 JSON 互转
  'jwt.decode': jwtDecode, // JWT 解析
  'diff.text': diffText, // 文本差异
  'code.stats': codeStats, // 代码统计
  'sql.format': sqlFormat, // SQL 格式化
  'text.stats': textStats, // 文本统计
  'file.rename': fileRename, // 批量重命名预览
  'ui.theme': uiTheme, // UI 主题色阶
  'speech.ssml': speechSsml, // SSML 生成
  'http.status': httpStatus, // HTTP 状态码查询
  'data.profile': dataProfile, // 数值列画像
  'code.detect': codeDetect, // 代码语言识别
  'cache.key': cacheKey, // 缓存键规划
  'search.rank': searchRank, // 轻量检索排序
  'service.topology': serviceTopology, // 微服务依赖拓扑
  'workflow.check': workflowCheck, // 工作流 DAG 校验
  'rbac.check': rbacCheck, // RBAC 权限矩阵
  'code.gen': codeGen, // 模板代码生成
  'ioc.graph': iocGraph, // IoC 装配顺序
  'rule.eval': ruleEval, // 规则集求值
  'spring.config': springConfig, // Spring Boot 配置生成
  'node.pkg': nodePkg, // package.json 体检
  'bpmn.check': bpmnCheck, // 流程完整性校验
  'anim.keyframes': animKeyframes, // CSS 关键帧
  'phone.format': phoneFormat, // 手机号规范化
  'tauri.perm': tauriPerm, // Tauri 能力配置
  'web.scaffold': webScaffold, // Web 项目脚手架
  'jquery.plugin': jqueryPlugin, // jQuery 插件骨架
  'ui.props': uiProps, // 组件 Props 校验
  'js.type': jsType, // JS 值类型判定
  'rest.lint': restLint, // REST 路径检查
  'admin.menu': adminMenu, // 后台菜单树
  'theme.tokens': themeTokens, // 设计令牌
  'vue.sfc': vueSfc, // Vue SFC 骨架
  'crawler.plan': crawlerPlan, // 爬虫合规计划
  'angular.cmp': angularCmp, // Angular 组件骨架
  'bs.grid': bsGrid, // Bootstrap 栅格
  'react.cmp': reactCmp, // React 组件骨架
  'rpc.methods': rpcMethods, // RPC 签名校验
  'api.routes': apiRoutes, // 网关路由体检
  'url.short': urlShort, // 短链码
  'layui.table': layuiTable, // layui 表格列
  ...BLUEPRINT_HANDLERS, // 17 个分组的模块起盘蓝图能力（catalog.*）
}; // 注册表结束

/** 按能力键取 handler：未注册即返回 undefined，由路由决定是否 501 */
export function handlerOfCapability(key: string): CapabilityHandler | undefined {
  return CAPABILITY_HANDLERS[key]; // 直接读注册表，键不存在即 undefined
} // handlerOfCapability 结束
