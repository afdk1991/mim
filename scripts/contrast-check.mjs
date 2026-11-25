#!/usr/bin/env node
/**
 * scripts/contrast-check.mjs
 *
 * WCAG 2.1 AA 对比度校验器（零第三方依赖，纯 Node 内置模块）。
 *
 * 口径：
 *   1. 从 apps/web/src/tokens.css 解析亮（:root）/ 暗（:root[data-theme='dark']）两套令牌，
 *      解析 hsl / rgba / hex / color-mix / calc / var() 链，得到可计算的 RGB；
 *   2. 内置一组语义前景-背景色对（正文 / 次要文字 / 按钮 / 链接 / 状态色 / 描边），
 *      同时扫描 apps/web/src/styles.css 同规则内 color 与 background 成对出现的令牌；
 *   3. 按 WCAG 2.1 相对亮度公式计算对比度：
 *        正文（< 18pt 或 < 14pt 加粗）≥ 4.5:1；
 *        大字（≥ 18pt 或 ≥ 14pt 加粗）≥ 3:1；
 *        非文本 UI 边界（描边 / 控件边界）≥ 3:1。
 *
 * 用法：
 *   node scripts/contrast-check.mjs              # 基线报告，失败项标注 FAIL，退出 0
 *   node scripts/contrast-check.mjs --strict     # 门禁模式：存在 FAIL 时退出 1
 *   node scripts/contrast-check.mjs --json       # 额外输出 JSON 摘要到 stdout 末尾
 */

// Node 内置文件读取：按仓库相对路径定位样式令牌与组件样式表
import { readFileSync, existsSync } from 'node:fs';
// 路径拼接：以脚本所在目录反推仓库根，兼容在任意工作目录调用
import { join, dirname } from 'node:path';
// 文件 URL 转路径：ESM 下取当前脚本目录
import { fileURLToPath } from 'node:url';

// 当前脚本目录：scripts/，仓库根为上一级
const __dirname = dirname(fileURLToPath(import.meta.url)); // 脚本目录常量
const ROOT = join(__dirname, '..'); // 仓库根目录常量
// 令牌文件与组件样式表路径：对比度审计的唯一颜色真源
const TOKENS_CSS = join(ROOT, 'apps', 'web', 'src', 'tokens.css'); // 设计令牌表
const STYLES_CSS = join(ROOT, 'apps', 'web', 'src', 'styles.css'); // 组件样式表

// 命令行参数：strict 门禁模式、json 摘要开关
const args = process.argv.slice(2); // 取 node 之后的参数列表
const STRICT = args.includes('--strict'); // 是否门禁模式
const OUT_JSON = args.includes('--json'); // 是否追加 JSON 摘要

// WCAG 阈值：正文 4.5、大字 3.0、非文本 UI 边界 3.0（AA 口径）
const THRESHOLD = { body: 4.5, large: 3.0, ui: 3.0 }; // 各角色对比度下限
// 角色中文标签：报告里可读
const ROLE_LABEL = { body: '正文', large: '大字', ui: 'UI 边界' }; // 角色展示名

/** 去除 CSS 块注释：解析令牌前先剥掉 /* ... *\/，避免注释文本干扰声明切分。 */
function stripComments(css) { // 注释剥离函数
  return css.replace(/\/\*[\s\S]*?\*\//g, ''); // 全局替换块注释为空串
} // 注释剥离结束

/** 按顶层分隔符切分字符串：忽略嵌套括号 / 引号内的分隔符。 */
function splitTopLevel(text, sep) { // 顶层切分函数
  const out = []; // 分段结果
  let depth = 0; // 括号深度
  let cur = ''; // 当前段
  for (const ch of text) { // 逐字符扫描
    if (ch === '(') depth += 1; // 进入嵌套
    if (ch === ')') depth -= 1; // 退出嵌套
    if (depth === 0 && ch === sep) { // 顶层命中分隔符
      out.push(cur.trim()); // 收段
      cur = ''; // 重置当前段
    } else { // 段内字符
      cur += ch; // 累积
    } // 分支结束
  } // 字符循环结束
  if (cur.trim()) out.push(cur.trim()); // 收尾段
  return out; // 返回分段
} // 顶层切分结束

/** 判断选择器列表是否为板块作用域块（仅挂 [data-theme-section]，不含 :root 基准块）。 */
function isSectionOnlyBlock(selector) { // 板块块判断函数
  const parts = selector.split(',').map((p) => p.trim()); // 拆分选择器列表
  // 基准块选择器：:root / :root, [data-theme-section] / :root[data-theme='dark'], ...
  const hasRootBase = parts.some((p) => p === ':root' || p.startsWith(':root,')); // 是否含 :root 基准
  if (hasRootBase) return false; // 含基准选择器，不算板块块
  // 其余选择器若全部以 [data-theme-section] 开头（含暗色板块），即板块作用域块
  return parts.every((p) => p.startsWith('[data-theme-section') || p.includes("[data-theme='dark'] [data-theme-section")); // 板块判定
} // 板块块判断结束

/** 解析令牌表为亮 / 暗两套声明映射。 */
function parseTokens(css) { // 令牌解析函数
  const light = {}; // 浅色令牌映射
  const dark = {}; // 暗色令牌映射
  // 逐块匹配「选择器 { 声明 }」，覆盖 tokens.css 现有书写形式
  const blockRe = /([^{}]+)\{([^{}]*)\}/g; // 块级正则
  let block; // 循环内当前匹配块
  // 遍历所有样式块
  while ((block = blockRe.exec(css)) !== null) { // 命中块则继续
    const selector = block[1].trim(); // 选择器文本
    const body = block[2]; // 块内声明文本
    if (isSectionOnlyBlock(selector)) continue; // 板块作用域块不进品牌基准审计
    const isDark = selector.includes("data-theme='dark'"); // 是否暗色作用域
    const target = isDark ? dark : light; // 暗色块进 dark，其余进 light
    // 逐行解析声明：--name: value;
    for (const raw of body.split(';')) { // 按分号切声明
      const decl = raw.trim(); // 去空白
      if (!decl) continue; // 空声明跳过
      const idx = decl.indexOf(':'); // 冒号分隔名与值
      if (idx < 0) continue; // 无冒号不是合法声明
      const name = decl.slice(0, idx).trim(); // 令牌名
      const value = decl.slice(idx + 1).trim(); // 令牌值
      if (name.startsWith('--')) target[name] = value; // 只收自定义属性
    } // 声明循环结束
  } // 块循环结束
  // 暗色以浅色为底再覆盖：暗色未重声明的令牌回落到浅色派生值
  const darkFull = { ...light, ...dark }; // 暗色完整映射
  return { light, dark: darkFull }; // 返回两套映射
} // 令牌解析结束

/** 取 var(--name) 引用名；非 var 形式返回 null。 */
function matchVar(expr) { // var 匹配函数
  const m = expr.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/); // var 正则
  return m ? m[1] : null; // 返回令牌名或 null
} // var 匹配结束

/** 把令牌值解析为数值（百分比转小数，纯数字直接取值，裸 var 沿作用域回退）。 */
function parseNumeric(text, scope, depth) { // 数值解析函数
  const expr = text.trim(); // 去空白
  const varName = matchVar(expr); // 是否裸 var
  if (varName) { // 命中裸 var
    const next = scope[varName]; // 取令牌值
    return next === undefined ? 0 : parseNumeric(next, scope, depth + 1); // 递归回退
  } // 裸 var 结束
  // calc(...)：剥离外壳后求算术
  const calcMatch = expr.match(/^calc\(([\s\S]*)\)$/); // calc 正则（末尾单括号收尾）
  const inner = calcMatch ? calcMatch[1].trim() : expr; // 剥 calc 外壳
  // 乘法：var(%) * 标量（令牌文件现有乘式形式）
  const mulMatch = inner.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*\)\s*\*\s*([0-9.]+)$/); // 乘式正则
  if (mulMatch) { // 命中乘式
    const baseText = scope[mulMatch[1]] ?? '0'; // 令牌原始文本
    const baseNum = baseText.endsWith('%') ? Number(baseText.slice(0, -1)) / 100 : Number(baseText) || 0; // 百分比转小数
    return baseNum * Number(mulMatch[2]); // 乘积返回
  } // 乘式结束
  if (inner.endsWith('%')) return Number(inner.slice(0, -1)) / 100; // 百分比转小数
  const num = Number(inner); // 纯数字
  return Number.isNaN(num) ? 0 : num; // 非数兜底 0
} // 数值解析结束

/** 通道夹取：RGB 限 0–255，透明度限 0–1。 */
function clamp255(n) { return Math.min(255, Math.max(0, Math.round(n))); } // 255 夹取
function clamp01(n) { return Math.min(1, Math.max(0, n)); } // 01 夹取

/** HSL 转 RGB（sRGB 空间，与 CSS hsl() 口径一致）。 */
function hslToRgb(h, s, l, a) { // HSL 转换函数
  const hh = ((h % 360) + 360) % 360; // 色相归一到 0–360
  const ss = clamp01(s); // 饱和度归一
  const ll = clamp01(l); // 明度归一
  const c = (1 - Math.abs(2 * ll - 1)) * ss; // 色度
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1)); // 中间值
  const m = ll - c / 2; // 明度偏移
  let r = 0, g = 0, b = 0; // 分色初值
  if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; } // 0–120 段
  else if (hh < 180) { g = c; b = x; } else if (hh < 240) { g = x; b = c; } // 120–240 段
  else if (hh < 300) { r = x; b = c; } else { r = c; b = x; } // 240–360 段
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255), a: clamp01(a) }; // 转 0–255
} // HSL 转换结束

/** 两端颜色按占比混合（占比含透明度时一并做 alpha 混合）。 */
function mixColors(a, pa, b, pb) { // 颜色混合函数
  const w = pa + pb === 0 ? 1 : pa + pb; // 总权重，避免除零
  const ra = pa / w, rb = pb / w; // 归一权重
  return { // 逐通道加权
    r: clamp255(a.r * ra + b.r * rb), // 红通道
    g: clamp255(a.g * ra + b.g * rb), // 绿通道
    b: clamp255(a.b * ra + b.b * rb), // 蓝通道
    a: clamp01(a.a * ra + b.a * rb), // 透明度
  }; // 混合结果结束
} // 混合结束

/** 解析 color-mix 单端：颜色 + 可选百分比占比；函数色（hsl/rgb/mix）内部百分号不算占比。 */
function splitMixSide(text) { // mix 端解析函数
  const side = text.trim(); // 去首尾空白
  // 函数色整体作为颜色，其内部 62% / 52% 是色相分量，不是混合占比
  if (/^(hsl|hsla|rgb|rgba|color-mix)\(/.test(side)) return { value: side, pct: undefined }; // 函数色无占比
  const pctMatch = side.match(/\s+(\d+(?:\.\d+)?)%$/); // 末尾空白 + 百分比（小数可选）
  if (pctMatch) return { value: side.slice(0, pctMatch.index).trim(), pct: Number(pctMatch[1]) / 100 }; // 返回颜色与占比
  return { value: side, pct: undefined }; // 无占比则留空
} // mix 端结束

/** 把 #hex / rgb() / rgba() / hsl() / color-mix() 文本归一为 {r,g,b,a}。 */
function parseColor(text, scope, depth) { // 颜色解析函数
  const expr = text.trim(); // 去首尾空白
  // 递归终止保护：var 链过深时回退透明，避免栈溢出
  if (depth > 12) return { r: 255, g: 255, b: 255, a: 0 }; // 兜底透白
  // var(--name)：沿当前作用域取值后递归解析
  const varName = matchVar(expr); // var 引用名
  if (varName) { // 命中 var 引用
    const next = scope[varName]; // 取令牌值
    return next === undefined ? { r: 255, g: 255, b: 255, a: 0 } : parseColor(next, scope, depth + 1); // 递归解析
  } // var 分支结束
  // 十六进制：#rgb / #rrggbb / #rrggbbaa
  if (expr.startsWith('#')) { // hex 颜色
    let hex = expr.slice(1); // 去掉 #
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join(''); // 简写扩六位
    const r = parseInt(hex.slice(0, 2), 16); // 红通道
    const g = parseInt(hex.slice(2, 4), 16); // 绿通道
    const b = parseInt(hex.slice(4, 6), 16); // 蓝通道
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1; // 透明度
    return { r, g, b, a }; // 返回归一颜色
  } // hex 分支结束
  // rgb() / rgba()：逗号分隔
  const rgbMatch = expr.match(/^rgba?\(([\s\S]*)\)$/); // rgb 函数正则
  if (rgbMatch) { // 命中 rgb 函数
    const parts = splitTopLevel(rgbMatch[1], ',').map((p) => parseNumeric(p, scope, depth + 1)); // 分段取值
    const [r, g, b, a = 1] = parts; // 解构通道
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a) }; // 归一返回
  } // rgb 分支结束
  // hsl() / hsla()：空格或逗号分隔，支持嵌套 calc 与 / 透明度
  const hslMatch = expr.match(/^hsla?\(([\s\S]*)\)$/); // hsl 函数正则
  if (hslMatch) { // 命中 hsl 函数
    const parts = splitTopLevel(hslMatch[1], ',').flatMap((seg) => splitTopLevel(seg, ' ')).filter((p) => p && p !== '/'); // 兼容空格 / 逗号 / 斜杠分隔
    const [h, s, l, a = 1] = parts.map((p) => parseNumeric(p, scope, depth + 1)); // 分段取值
    return hslToRgb(h, s, l, a); // 转 RGB 返回
  } // hsl 分支结束
  // color-mix(in srgb, A p%, B p%)：两端按不透明度在 sRGB 空间混合
  const mixMatch = expr.match(/^color-mix\(\s*in\s+srgb\s*,\s*([\s\S]*)\)$/); // mix 正则
  if (mixMatch) { // 命中 color-mix
    const sides = splitTopLevel(mixMatch[1], ','); // 顶层逗号切两端
    const aSide = splitMixSide(sides[0] ?? ''); // 第一端颜色与占比
    const bSide = splitMixSide(sides[1] ?? ''); // 第二端颜色与占比
    const aColor = parseColor(aSide.value, scope, depth + 1); // 第一端颜色
    const bColor = parseColor(bSide.value, scope, depth + 1); // 第二端颜色
    let pa = aSide.pct; // 第一端占比
    let pb = bSide.pct; // 第二端占比
    if (pa === undefined) pa = pb === undefined ? 0.5 : 1 - pb; // 缺省按互补
    if (pb === undefined) pb = 1 - pa; // 第二端互补
    const mixed = mixColors(aColor, pa, bColor, pb); // 混合后返回
    return mixed; // 混合后返回
  } // mix 分支结束
  // 无法识别：回退透明，报告里可一眼看出未覆盖表达式
  return { r: 0, g: 0, b: 0, a: 0 }; // 兜底黑色透明
} // 颜色解析结束

/** 前景透明时与背景做 alpha 合成，得到叠放后的最终不透明色。 */
function composite(fg, bg) { // 合成函数
  const a = fg.a; // 前景透明度
  if (a >= 1) return fg; // 不透明直接用前景
  return { // 前景压在背景之上
    r: clamp255(fg.r * a + bg.r * (1 - a)), // 红合成
    g: clamp255(fg.g * a + bg.g * (1 - a)), // 绿合成
    b: clamp255(fg.b * a + bg.b * (1 - a)), // 蓝合成
    a: 1, // 合成结果视为不透明
  }; // 合成结束
} // 合成结束

/** WCAG 相对亮度：sRGB 通道先线性化再加权求和。 */
function relativeLuminance({ r, g, b }) { // 亮度函数
  const lin = (v) => { // 单通道线性化
    const c = v / 255; // 归一 0–1
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); // 分段线性化
  }; // 通道函数结束
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); // 加权亮度
} // 亮度结束

/** 对比度比值：(L1+0.05)/(L2+0.05)，L1 为较亮一方。 */
function contrastRatio(fg, bg) { // 对比度函数
  const f = composite(fg, bg); // 前景合成到背景
  const l1 = relativeLuminance(f); // 前景亮度
  const l2 = relativeLuminance(bg); // 背景亮度
  const bright = Math.max(l1, l2); // 较亮
  const dark = Math.min(l1, l2); // 较暗
  return (bright + 0.05) / (dark + 0.05); // WCAG 比值
} // 对比度结束

/** 颜色转可读 hex：报告与调试用。 */
function toHex({ r, g, b }) { // hex 输出函数
  const h = (v) => v.toString(16).padStart(2, '0'); // 单通道转两位
  return `#${h(r)}${h(g)}${h(b)}`; // 拼 hex
} // hex 结束

// 语义色对清单：label / 角色 / 前景令牌 / 背景令牌。角色决定阈值。
// 背景取一级表面 --surface；表单标签等取填充底色 --bg 的另行标注。
const SEMANTIC_PAIRS = [
  // 浅色 / 暗色通用：正文层级与控件层级
  { label: '主文字 on 表面', role: 'body', fg: '--text', bg: '--surface' }, // 主文字
  { label: '正文 on 表面', role: 'body', fg: '--text-secondary', bg: '--surface' }, // 正文次级
  { label: '次要文字 on 表面', role: 'body', fg: '--text-muted', bg: '--surface' }, // 次要文字
  { label: '弱化文字 on 表面', role: 'body', fg: '--text-subtle', bg: '--surface' }, // 更弱文字
  { label: '链接 on 表面', role: 'body', fg: '--link', bg: '--surface' }, // 链接
  { label: '表单标签 on 输入底', role: 'body', fg: '--text-muted', bg: '--bg' }, // 表单标签
  { label: '主按钮文字 on 主色填充', role: 'body', fg: '--on-primary', bg: '--primary-fill' }, // 主按钮
  { label: '危险文字 on 表面', role: 'body', fg: '--danger', bg: '--surface' }, // 危险
  { label: '成功文字 on 表面', role: 'body', fg: '--success', bg: '--surface' }, // 成功
  { label: '警告文字 on 表面', role: 'body', fg: '--warning', bg: '--surface' }, // 警告
  { label: '信息文字 on 表面', role: 'body', fg: '--info', bg: '--surface' }, // 信息
  { label: '紫色文字 on 表面', role: 'body', fg: '--violet', bg: '--surface' }, // 紫色语义
  { label: '金色文字 on 表面', role: 'body', fg: '--premium', bg: '--surface' }, // 会员金
  { label: '琥珀文字 on 表面', role: 'body', fg: '--amber', bg: '--surface' }, // 星标琥珀
  { label: '导航选中文字 on 淡主色底', role: 'body', fg: '--nav-active-text', bg: '--nav-active-bg' }, // 导航选中
  { label: '常规描边 on 表面', role: 'ui', fg: '--border', bg: '--surface' }, // 常规边界
  { label: '强调描边 on 表面', role: 'ui', fg: '--border-strong', bg: '--surface' }, // 强调边界
  { label: '导航描边 on 表面', role: 'ui', fg: '--nav-ring', bg: '--surface' }, // 导航边界
]; // 色对清单结束

/** 扫描 styles.css：同规则内 color 与 background（-color）都用 var 令牌时补一条色对。 */
function scanStylesheet(css, scope) { // 样式表扫描函数
  const pairs = []; // 扫描出的附加色对
  const blockRe = /([^{}]+)\{([^{}]*)\}/g; // 块正则
  let block; // 当前块
  while ((block = blockRe.exec(css)) !== null) { // 遍历块
    const selector = block[1].trim().split('\n')[0].trim(); // 选择器首行
    const body = block[2]; // 声明体
    const colorMatch = body.match(/(?:^|[\s;])color:\s*(var\(--[A-Za-z0-9_-]+\))/); // color 声明
    const bgMatch = body.match(/(?:^|[\s;])(?:background|background-color):\s*(var\(--[A-Za-z0-9_-]+\))/); // 背景声明
    if (colorMatch && bgMatch) { // 前后景都是令牌才成对
      const fg = colorMatch[1].match(/--[A-Za-z0-9_-]+/)[0]; // 前景令牌名
      const bg = bgMatch[1].match(/--[A-Za-z0-9_-]+/)[0]; // 背景令牌名
      if (scope[fg] !== undefined && scope[bg] !== undefined) { // 两套令牌都可解析
        pairs.push({ label: `${selector}`, role: 'body', fg, bg }); // 收入附加色对
      } // 可解析判断结束
    } // 成对判断结束
  } // 块循环结束
  return pairs; // 返回附加色对
} // 样式表扫描结束

/** 解析 styles.css 内 :root / 暗色块的令牌覆盖：样式表晚于令牌表加载，覆盖值进入审计。 */
function parseStyleOverrides(css) { // 样式表覆盖解析函数
  const light = {}; // 浅色覆盖
  const dark = {}; // 暗色覆盖
  const blockRe = /([^{}]+)\{([^{}]*)\}/g; // 块正则
  let block; // 当前块
  while ((block = blockRe.exec(css)) !== null) { // 遍历块
    const selector = block[1].trim(); // 选择器
    const isRoot = selector === ':root' || selector.startsWith(':root,'); // 浅色根块
    const isDark = selector.includes("data-theme='dark'"); // 暗色根块
    if (!isRoot && !isDark) continue; // 只收根作用域令牌覆盖
    const target = isDark ? dark : light; // 分流
    for (const raw of block[2].split(';')) { // 逐声明
      const decl = raw.trim(); // 去空白
      if (!decl) continue; // 空声明
      const idx = decl.indexOf(':'); // 冒号切分
      if (idx < 0) continue; // 非法声明
      const name = decl.slice(0, idx).trim(); // 令牌名
      const value = decl.slice(idx + 1).trim(); // 令牌值
      if (name.startsWith('--')) target[name] = value; // 收自定义属性
    } // 声明循环结束
  } // 块循环结束
  return { light, dark }; // 返回两套覆盖
} // 覆盖解析结束

// ===== 主流程 =====
if (!existsSync(TOKENS_CSS)) { // 令牌文件缺失属于环境异常
  console.error(`❌ 未找到令牌文件: ${TOKENS_CSS}`); // 报错路径
  process.exit(1); // 以 1 退出
} // 缺失判断结束

const tokensText = stripComments(readFileSync(TOKENS_CSS, 'utf-8')); // 读令牌并剥注释
const { light, dark } = parseTokens(tokensText); // 解析两套令牌
const stylesText = existsSync(STYLES_CSS) ? stripComments(readFileSync(STYLES_CSS, 'utf-8')) : ''; // 读组件样式表
const overrides = parseStyleOverrides(stylesText); // 解析样式表令牌覆盖
const lightFinal = { ...light, ...overrides.light }; // 浅色叠加覆盖
const darkFinal = { ...dark, ...overrides.dark }; // 暗色叠加覆盖

// 逐主题计算：light / dark 两套分别跑语义清单 + 样式表扫描结果
const themes = [
  { name: '浅色', scope: lightFinal }, // 浅色主题
  { name: '暗色', scope: darkFinal }, // 暗色主题
]; // 主题列表结束

const results = []; // 全部校验结果行
for (const theme of themes) { // 逐主题计算
  const extra = scanStylesheet(stylesText, theme.scope); // 样式表附加色对
  const all = [...SEMANTIC_PAIRS, ...extra]; // 合并语义与附加
  for (const pair of all) { // 逐色对计算
    const backdrop = parseColor(theme.scope['--surface'] ?? '#ffffff', theme.scope, 0); // 半透明底色先叠到一级表面
    const fgRaw = parseColor(theme.scope[pair.fg] ?? 'transparent', theme.scope, 0); // 前景色
    const bgRaw = parseColor(theme.scope[pair.bg] ?? '#ffffff', theme.scope, 0); // 背景色
    const bgColor = bgRaw.a < 1 ? composite(bgRaw, backdrop) : bgRaw; // 半透明背景合成到表面
    const fgColor = composite(fgRaw, bgColor); // 前景合成到背景
    const ratio = contrastRatio(fgColor, bgColor); // 对比度比值
    const threshold = THRESHOLD[pair.role]; // 对应阈值
    results.push({ // 结果行
      theme: theme.name, // 主题
      label: pair.label, // 色对说明
      role: pair.role, // 角色
      fg: pair.fg, // 前景令牌
      bg: pair.bg, // 背景令牌
      fgHex: toHex(fgColor), // 合成后前景 hex
      bgHex: toHex(bgColor), // 背景 hex
      ratio, // 比值
      threshold, // 阈值
      pass: ratio >= threshold, // 是否达标
    }); // 结果行结束
  } // 色对循环结束
} // 主题循环结束

// 输出报告表头
console.log('== Mim 前端 WCAG 2.1 AA 对比度报告 =='); // 报告标题
console.log(`阈值: 正文 ≥ ${THRESHOLD.body}:1 / 大字 ≥ ${THRESHOLD.large}:1 / UI 边界 ≥ ${THRESHOLD.ui}:1`); // 阈值说明
console.log(''); // 空行分隔

// 表格列宽：主题 / 角色 / 色对 / 前景 / 背景 / 比值 / 阈值 / 结论
const header = `主题 角色     比值      阈值    结论  色对（前景 on 背景）`; // 表头
console.log(header); // 打印表头
console.log('-'.repeat(header.length + 24)); // 分隔线

// 逐行打印：未达标行标 ❌，达标行标 ✅
for (const r of results) { // 遍历结果
  const flag = r.pass ? '✅' : '❌'; // 结论标记
  const ratio = r.ratio.toFixed(2).padStart(5); // 比值补齐位数
  const threshold = r.threshold.toFixed(1); // 阈值格式
  const fg = r.fg.replace(/^--/, ''); // 前景简写
  const bg = r.bg.replace(/^--/, ''); // 背景简写
  console.log(`${r.theme} ${ROLE_LABEL[r.role].padEnd(5)} ${ratio}:1 ${threshold}:1 ${flag} ${r.label}（${fg} on ${bg} · ${r.fgHex}/${r.bgHex}）`); // 结果行
} // 结果循环结束

// 汇总统计：总数 / 达标数 / 未达标数
const total = results.length; // 总色对数
const failed = results.filter((r) => !r.pass); // 未达标清单
const passed = total - failed.length; // 达标数

console.log(''); // 空行
console.log(`汇总: 共 ${total} 对 | ✅ 达标 ${passed} | ❌ 未达标 ${failed.length}`); // 汇总行

// 未达标明细：便于逐项定位配色
if (failed.length > 0) { // 存在未达标项
  console.log(''); // 空行
  console.log('-- 未达标明细 --'); // 明细标题
  for (const r of failed) { // 逐未达标项
    console.log(`❌ [${r.theme}] ${r.label}: ${r.ratio.toFixed(2)}:1 < ${r.threshold}:1（${r.fg} on ${r.bg}）`); // 明细行
  } // 明细循环结束
} // 未达标判断结束

// JSON 摘要：供门禁脚本或报告复用
if (OUT_JSON) { // 要求 JSON 输出
  console.log(''); // 空行分隔
  console.log(JSON.stringify({ total, passed, failed: failed.length, results }, null, 2)); // JSON 块
} // JSON 结束

// strict 门禁：有未达标则退出 1，否则退出 0
if (STRICT && failed.length > 0) { // 门禁模式且存在失败
  console.error(`\n❌ strict 未通过：${failed.length} 对配色对比度低于 AA 阈值`); // 报错
  process.exit(1); // 阻断退出
} // strict 结束

console.log(`\n${STRICT ? '✅ strict 通过' : 'ℹ️ baseline 完成'}`); // 收尾提示
process.exit(0); // 正常退出
