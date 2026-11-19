/**
 * 自研文本归一化与分词（零第三方依赖）。
 *
 * 为什么自研：项目需要中文社区内容的检索与排序，而现成的中文分词库要么体积大、要么词典不可控。
 * 这里采用「CJK 二元切分 + 拉丁词归一」的确定性方案：不依赖词典、结果可复现，便于单测与线上对账。
 * 口径：中文按相邻两字成词（长度 1 的孤立字保留单字），拉丁/数字按连续字母数字成词并做轻量词形归一。
 */

// CJK 统一表意文字主区：覆盖日常简体/繁体正文
const CJK_MAIN_START = 0x4e00; // 主区起始码位
const CJK_MAIN_END = 0x9fff; // 主区结束码位
// 扩展 A 区：生僻字与部分古籍用字，避免被判成拉丁符号而丢词
const CJK_EXT_A_START = 0x3400; // 扩展 A 起始码位
const CJK_EXT_A_END = 0x4dbf; // 扩展 A 结束码位
// 兼容表意区：历史编码兼容字符，统一并入 CJK 处理
const CJK_COMPAT_START = 0xf900; // 兼容区起始码位
const CJK_COMPAT_END = 0xfaff; // 兼容区结束码位

/** 判断单个码位是否属于需要按字切分的 CJK 区段。 */
export function isCjkCode(code: number): boolean {
  return (
    (code >= CJK_MAIN_START && code <= CJK_MAIN_END) || // 主区判定
    (code >= CJK_EXT_A_START && code <= CJK_EXT_A_END) || // 扩展 A 区判定
    (code >= CJK_COMPAT_START && code <= CJK_COMPAT_END) // 兼容区判定
  ); // 三个区段任一命中即为 CJK
} // isCjkCode 结束

// 中文停用字：单字级别剔除，二元词不受影响，避免把「的」「了」这类高频字当成强相关信号
const CJK_STOP_CHARS = new Set(['的', '了', '是', '我', '你', '他', '她', '它', '在', '和', '就', '不', '有', '这', '那', '也', '很', '与', '及', '把', '被', '吗', '吧', '呢', '啊']); // 停用字集合

// 拉丁停用词：英文虚词会显著抬高常见文档得分，检索时直接忽略
const LATIN_STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'as', 'at', 'by', 'from']); // 停用词集合

/** 全角转半角：仅处理 ASCII 可见区与全角空格，其余字符保持原样。 */
function foldFullWidth(code: number): number {
  if (code === 0x3000) return 0x20; // 全角空格归一为普通空格
  if (code >= 0xff01 && code <= 0xff5e) return code - 0xfee0; // 全角 ASCII 区整体平移
  return code; // 其余码位不处理
} // foldFullWidth 结束

/**
 * 归一化原文：全角转半角、统一小写、压缩空白。
 * 归一化只影响匹配，不回写数据库，保证原始正文展示不变。
 */
export function normalizeText(input: string): string {
  const chars: string[] = []; // 逐字符重建，便于做码位级折叠
  for (const ch of input) { // 用 for..of 按码位遍历，避免代理对拆分
    const code = ch.codePointAt(0) ?? 0; // 取当前字符码位
    chars.push(String.fromCodePoint(foldFullWidth(code))); // 折叠后写回
  } // 遍历结束
  return chars.join('').toLowerCase().replace(/\s+/g, ' ').trim(); // 小写、压缩空白并去首尾
} // normalizeText 结束

/** 拉丁词轻量词形归一：只做最常见复数/所有格收缩，避免过度词干化误伤专有名词。 */
function stemLatin(word: string): string {
  if (word.length <= 3) return word; // 短词一律保留原形（如 api、ui）
  if (word.endsWith("'s")) return word.slice(0, -2); // 所有格去尾
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`; // studies → study
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2); // boxes → box
  if (word.endsWith('s')) return word.slice(0, -1); // 普通复数去尾
  return word; // 无匹配则保持原形
} // stemLatin 结束

/** 把一段 CJK 字符序列展开为词项：单字保留、多字取相邻二元词。 */
function flushCjkRun(run: string, out: string[]): void {
  if (run.length === 1) { // 孤立单字
    if (!CJK_STOP_CHARS.has(run)) out.push(run); // 非停用字才入词
    return; // 单字处理完毕
  } // 单字分支结束
  for (let i = 0; i + 1 < run.length; i += 1) { // 逐对滑动取二元词
    const pair = run.slice(i, i + 2); // 取相邻两字
    if (CJK_STOP_CHARS.has(pair[0]) && CJK_STOP_CHARS.has(pair[1])) continue; // 两字都是停用字则丢弃
    out.push(pair); // 二元词入列
  } // 滑动结束
} // flushCjkRun 结束

/** 把一段拉丁/数字序列归一后入词。 */
function flushLatinRun(run: string, out: string[]): void {
  if (!run) return; // 空串直接返回
  const word = stemLatin(run.toLowerCase()); // 小写并做轻量词形归一
  if (word.length < 2) return; // 单字符不构成有效词项
  if (LATIN_STOP_WORDS.has(word)) return; // 停用词丢弃
  out.push(word); // 有效词入列
} // flushLatinRun 结束

/**
 * 分词主函数：中文二元切分 + 拉丁词归一。
 * 同一段文本重复调用结果完全一致（确定性），便于单测与排序对账。
 */
export function tokenize(input: string): string[] {
  const text = normalizeText(input); // 先归一化再切分
  const out: string[] = []; // 词项输出
  let cjkRun = ''; // 当前累积的 CJK 连续串
  let latinRun = ''; // 当前累积的拉丁/数字连续串
  const flushAll = (): void => { // 收尾函数：处理到边界时统一提交两段缓冲
    if (cjkRun) { flushCjkRun(cjkRun, out); cjkRun = ''; } // 提交 CJK 缓冲并清空
    if (latinRun) { flushLatinRun(latinRun, out); latinRun = ''; } // 提交拉丁缓冲并清空
  }; // 收尾函数结束
  for (const ch of text) { // 逐字符扫描
    const code = ch.codePointAt(0) ?? 0; // 取码位
    const isCjk = isCjkCode(code); // 是否 CJK
    const isLatin = /[a-z0-9]/.test(ch); // 是否拉丁字母或数字
    if (isCjk) { // CJK 分支
      if (latinRun) { flushLatinRun(latinRun, out); latinRun = ''; } // 先提交拉丁缓冲
      cjkRun += ch; // 累积 CJK 串
      continue; // 进入下一字符
    } // CJK 分支结束
    if (isLatin) { // 拉丁分支
      if (cjkRun) { flushCjkRun(cjkRun, out); cjkRun = ''; } // 先提交 CJK 缓冲
      latinRun += ch; // 累积拉丁串
      continue; // 进入下一字符
    } // 拉丁分支结束
    flushAll(); // 其它字符（空格/标点）作为边界统一提交
  } // 扫描结束
  flushAll(); // 文本结尾补一次提交，避免尾部缓冲丢失
  return out; // 返回最终词项
} // tokenize 结束

/** 统计词频：用于 BM25 的词频项与相似度计算。 */
export function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>(); // 词 → 次数
  for (const token of tokens) freq.set(token, (freq.get(token) ?? 0) + 1); // 累加计数
  return freq; // 返回词频表
} // termFrequency 结束

/** Jaccard 相似度：集合交并比，用于衡量两段文本的词项重合度。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1; // 两个空集视为完全相似（都无信息量）
  let intersection = 0; // 交集大小
  for (const item of a) if (b.has(item)) intersection += 1; // 统计交集
  const union = a.size + b.size - intersection; // 并集大小
  return union === 0 ? 0 : intersection / union; // 并集为 0 时返回 0，避免除零
} // jaccard 结束

/** 生成词项集合（去重），供 Jaccard 与多样性重排使用。 */
export function tokenSet(input: string): Set<string> {
  return new Set(tokenize(input)); // 直接复用分词结果
} // tokenSet 结束
