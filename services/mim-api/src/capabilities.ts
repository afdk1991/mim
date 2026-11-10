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

/** 能力注册表：键必须与 core-domain 的 MODULE_CAPABILITIES.key 完全一致，否则路由回 501 */
export const CAPABILITY_HANDLERS: Record<string, CapabilityHandler> = { // 键为能力标识
  'json.format': jsonFormat, // JSON 工具
  'text.encode': textEncode, // 文本编解码
  'text.hash': textHash, // 摘要哈希
  'markdown.render': markdownRender, // Markdown 渲染
  'qrcode.generate': qrcodeGenerate, // 二维码生成
  'cron.describe': cronDescribe, // Cron 解析
}; // 注册表结束

/** 按能力键取 handler：未注册即返回 undefined，由路由决定是否 501 */
export function handlerOfCapability(key: string): CapabilityHandler | undefined {
  return CAPABILITY_HANDLERS[key]; // 直接读注册表，键不存在即 undefined
} // handlerOfCapability 结束
