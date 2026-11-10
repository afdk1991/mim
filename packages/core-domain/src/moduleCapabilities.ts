/**
 * 模块商城「模块 = 真实能力」清单（服务端种子、调用路由与前端工具面板共用同一份定义）。
 *
 * 口径（用户 2026-11-11 指令）：分类导航里的条目要能真正用起来，而不是只有价格与简介。
 * 因此每个可用的二级模块在这里登记一条能力：绑定模块编码（`cat.<一级slug>-<序号>`）、
 * 说明输入输出形态，服务端 `capabilities.ts` 提供同名 handler 真正执行。
 *
 * 未登记的模块属于「规划中」：商城仍展示，但详情面板不给解锁/调用入口，
 * 避免用户为没有实现的条目付费。
 */

/** 输出形态：前端据此决定渲染方式（纯文本 / 结构化 JSON / HTML / 图片 dataURL） */
export type ModuleCapabilityOutputKind = 'text' | 'json' | 'html' | 'image';

/** 单条能力定义：一条能力可绑定多个模块编码（同一实现服务多个导航条目） */
export interface ModuleCapabilitySeed {
  key: string; // 能力标识，与服务端 handler 注册键一一对应（如 json.format）
  name: { 'zh-CN': string; 'en-US': string }; // 能力名称，详情面板区块标题
  hint: { 'zh-CN': string; 'en-US': string }; // 使用提示，说明输入该填什么
  placeholder: { 'zh-CN': string; 'en-US': string }; // 输入框占位文案
  output_kind: ModuleCapabilityOutputKind; // 输出形态
  module_codes: readonly string[]; // 绑定的模块编码清单
}

/** 已实现的能力清单：按「程序开发」组的导航条目绑定，键与 `services/mim-api/src/capabilities.ts` 对齐 */
export const MODULE_CAPABILITIES: readonly ModuleCapabilitySeed[] = [ // 数组顺序即文档展示顺序
  { // JSON 工具：格式化 / 压缩 / 校验
    key: 'json.format', // 能力标识
    name: { 'zh-CN': 'JSON 格式化与校验', 'en-US': 'JSON format & validate' }, // 中文名给中文站用
    hint: { 'zh-CN': '粘贴任意 JSON，按所选模式格式化、压缩或校验合法性', 'en-US': 'Paste any JSON to pretty-print, minify or validate it' }, // 使用提示
    placeholder: { 'zh-CN': '{"name":"Mim","tags":["catalog","tool"]}', 'en-US': '{"name":"Mim","tags":["catalog","tool"]}' }, // 占位示例
    output_kind: 'json', // 输出结构化 JSON
    module_codes: ['cat.dev-28'], // 程序开发 / JSON工具
  }, // JSON 工具结束
  { // 编码转换：Base64 / Base64URL / Hex / URL 编解码
    key: 'text.encode', // 能力标识
    name: { 'zh-CN': '文本编解码', 'en-US': 'Text encode/decode' }, // 能力名
    hint: { 'zh-CN': '选择编码方式与方向，对文本做编码或解码', 'en-US': 'Pick an encoding and direction to encode or decode text' }, // 使用提示
    placeholder: { 'zh-CN': '要编码或解码的文本', 'en-US': 'Text to encode or decode' }, // 占位
    output_kind: 'text', // 输出纯文本
    module_codes: ['cat.dev-04'], // 程序开发 / 常用工具包
  }, // 编码转换结束
  { // 摘要哈希：MD5 / SHA-1 / SHA-256 / SHA-512
    key: 'text.hash', // 能力标识
    name: { 'zh-CN': '摘要与哈希', 'en-US': 'Digest & hash' }, // 能力名
    hint: { 'zh-CN': '输入文本，输出所选算法的十六进制摘要', 'en-US': 'Enter text and get the hex digest of the chosen algorithm' }, // 使用提示
    placeholder: { 'zh-CN': '待计算摘要的文本', 'en-US': 'Text to hash' }, // 占位
    output_kind: 'text', // 输出纯文本
    module_codes: ['cat.dev-03'], // 程序开发 / 安全开发相关
  }, // 摘要哈希结束
  { // Markdown 渲染：Markdown → HTML
    key: 'markdown.render', // 能力标识
    name: { 'zh-CN': 'Markdown 渲染', 'en-US': 'Markdown rendering' }, // 能力名
    hint: { 'zh-CN': '输入 Markdown，输出可直接渲染的 HTML', 'en-US': 'Enter Markdown and get renderable HTML' }, // 使用提示
    placeholder: { 'zh-CN': '# 标题\n\n- 列表项\n- **加粗**', 'en-US': '# Title\n\n- item\n- **bold**' }, // 占位示例
    output_kind: 'html', // 输出 HTML
    module_codes: ['cat.dev-17'], // 程序开发 / Markdown工具包
  }, // Markdown 渲染结束
  { // 二维码生成：文本 → PNG dataURL
    key: 'qrcode.generate', // 能力标识
    name: { 'zh-CN': '二维码生成', 'en-US': 'QR code generator' }, // 能力名
    hint: { 'zh-CN': '输入文本或链接，输出可保存的二维码图片', 'en-US': 'Enter text or a link to get a scannable QR image' }, // 使用提示
    placeholder: { 'zh-CN': 'https://mim.mixm.top', 'en-US': 'https://mim.mixm.top' }, // 占位示例
    output_kind: 'image', // 输出图片
    module_codes: ['cat.dev-06'], // 程序开发 / 条形码/二维码
  }, // 二维码生成结束
  { // Cron 表达式：解析 + 推算未来触发时间
    key: 'cron.describe', // 能力标识
    name: { 'zh-CN': 'Cron 表达式解析', 'en-US': 'Cron expression parser' }, // 能力名
    hint: { 'zh-CN': '输入 5 段或 6 段 cron 表达式，输出未来若干次触发时间', 'en-US': 'Enter a 5/6-field cron expression to list upcoming runs' }, // 使用提示
    placeholder: { 'zh-CN': '0 9 * * 1-5', 'en-US': '0 9 * * 1-5' }, // 占位示例
    output_kind: 'json', // 输出结构化 JSON
    module_codes: ['cat.dev-14'], // 程序开发 / 作业/任务调度
  }, // Cron 解析结束
]; // 能力清单结束

/** 按能力键取定义：前端工具面板与服务端路由都用它做存在性判断 */
export function capabilityOfKey(key: string): ModuleCapabilitySeed | undefined {
  return MODULE_CAPABILITIES.find((item) => item.key === key); // 线性查找即可，清单规模是个位数
} // capabilityOfKey 结束

/** 按模块编码取能力：模块没有登记能力即视为「规划中」 */
export function capabilityOfModule(code: string): ModuleCapabilitySeed | undefined {
  return MODULE_CAPABILITIES.find((item) => item.module_codes.includes(code)); // 编码在核心域唯一，命中第一条即可
} // capabilityOfModule 结束
