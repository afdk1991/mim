/**
 * Mim ID 号码规则：QQ 号样式的纯数字编号 + 靓号预留判定（2026-11-12 改造，同日二次收紧）。
 *
 * 口径（与 README、AGENTS.md、docs/ 交付说明同一套说法）：
 *   1. 号码是纯十进制数字（1、2、3 … 9,999,999,999），不带前缀、不补零，位数随用户量自然增长；
 *   2. 1～99 属「短号段」，按用户 2026-11-12 指令**整段预留**，自动发号从 100 之后开始；
 *   3. 3 位及以上命中以下任一类即进靓号库：豹子 / 顺子 / 回文 / ABAB / 重复段 / 阶梯对子 /
 *      整百 / 经典号 / 谐音 / 生日号；自动发号器与存量重排都会跳过，改由运营定向授予；
 *   4. 纯函数、零数据库依赖：发号、迁移、测试共用同一份判定，避免口径分叉。
 */

/** 靓号类别：命中任意一类即视为靓号，自动发号一律跳过 */
export type PremiumReason =
  | 'short' // 短号段（1～99，整段预留）
  | 'repeat' // 豹子号（111、8888）
  | 'ladder' // 顺子号（123、987）
  | 'palindrome' // 回文号（121、1221）
  | 'abab' // 对子号（1212、1313）
  | 'repeatBlock' // 重复段（123123、12341234、520520）
  | 'staircase' // 阶梯对子（1122、112233、998877）
  | 'round' // 整百 / 整千（100、2000）
  | 'iconic' // 经典号（007、1024、10086、12306）
  | 'pronounce' // 谐音 / 吉利号（520、1314）
  | 'birthday'; // 生日号（19900101）

/** 谐音 / 吉利号串：号码中出现即预留；只收广泛认可的串，避免把大量正常号误判成靓号 */
const PRONOUNCE_SEGMENTS: readonly string[] = [
  '520', // 我爱你
  '521', // 我爱你（谐音变体）
  '1314', // 一生一世
  '5201314', // 我爱你一生一世
  '1314520', // 一生一世我爱你
  '7758', // 亲亲我吧
  '5188', // 我要发发
  '168', // 一路发
  '888', // 发发发（含尾号形态，如 1888、6888）
  '666', // 六六大顺（同上）
  '999', // 长长久久（同上）
  '886', // 拜拜了
  '588', // 我发发
  '5200', // 我爱你（存档口径）
]; // 列表结束：命中即归入 pronounce 类

/** 经典号：程序员梗 / 常用服务号，整串精确匹配（不做子串匹配，避免误伤海量普通号） */
const ICONIC_NUMBERS: readonly string[] = [
  '007', // 特工代号
  '1024', // 程序员节 / 2^10
  '2048', // 2^11（同名游戏）
  '4096', // 2^12
  '110', // 报警
  '114', // 查号台
  '119', // 火警
  '120', // 急救
  '10010', // 联通客服
  '10086', // 移动客服
  '12306', // 铁路客票
  '95588', // 工商银行
]; // 列表结束：命中即归入 iconic 类

/** 纯数字判定：带字母、负号、小数点的输入不参与靓号判定 */
const PURE_DIGITS = /^\d+$/;

/** 短号段判定：1～2 位（1～99）整段预留，不再自动发放 */
function isShort(text: string): boolean {
  return text.length <= 2; // 个位与十位号全部进靓号库
} // 代码块结束

/** 全同数字判定：3 位起才算豹子号 */
function isRepeat(text: string): boolean {
  return text.length >= 3 && /^(\d)\1+$/.test(text); // 逐位相同即豹子
} // 代码块结束

/** 顺子判定：相邻位差全为 +1 或全为 -1（含 123、321、9876 这类倒顺） */
function isLadder(text: string): boolean {
  if (text.length < 3) return false; // 3 位起判定
  const diffs: number[] = []; // 相邻位差集合
  for (let index = 1; index < text.length; index += 1) { // 循环：逐项遍历集合并执行相同处理
    diffs.push(Number(text[index]) - Number(text[index - 1])); // 逐位求差
  } // 逐位循环结束
  return diffs.every((diff) => diff === 1) || diffs.every((diff) => diff === -1); // 全递增或全递减
} // 代码块结束

/** 回文判定：正读反读一致，3 位起判定 */
function isPalindrome(text: string): boolean {
  if (text.length < 3) return false; // 两位号已在短号段口径里整段预留
  return text === text.split('').reverse().join(''); // 反转后逐字符相同
} // 代码块结束

/** ABAB 判定：偶数位且两两重复（1212、1313、121212） */
function isAbab(text: string): boolean {
  if (text.length < 4 || text.length % 2 !== 0) return false; // 至少 4 位且为偶数位
  return /^(\d{2})\1+$/.test(text); // 两位一组重复
} // 代码块结束

/** 重复段判定：整串由同一个 2 位及以上片段重复构成（123123、12341234、123123123） */
function isRepeatBlock(text: string): boolean {
  if (text.length < 4) return false; // 至少 4 位才有「段」的意义
  for (let block = 2; block <= text.length / 2; block += 1) { // 循环：逐项遍历集合并执行相同处理
    if (text.length % block !== 0) continue; // 不能整除的段长不可能整串重复
    if (text.slice(0, block).repeat(text.length / block) === text) return true; // 命中即重复段
  } // 段长枚举结束
  return false; // 非重复段
} // 代码块结束

/** 阶梯对子判定：两两同数字、相邻对子连续（1122、112233、998877、11223344） */
function isStaircase(text: string): boolean {
  if (text.length < 4 || text.length % 2 !== 0) return false; // 至少两组、成对
  const pairs: number[] = []; // 每对取一位代表
  for (let index = 0; index < text.length; index += 2) { // 循环：逐项遍历集合并执行相同处理
    if (text[index] !== text[index + 1]) return false; // 必须两两相同
    pairs.push(Number(text[index])); // 记录对子数字
  } // 逐对扫描结束
  const diffs = pairs.slice(1).map((value, index) => value - pairs[index]); // 相邻对子的差
  return diffs.every((diff) => diff === 1) || diffs.every((diff) => diff === -1); // 递增或递减阶梯
} // 代码块结束

/** 整百 / 整千判定：末尾至少两个 0，3 位起（100、200、1000） */
function isRound(text: string): boolean {
  return text.length >= 3 && text.endsWith('00'); // 末尾两个 0 即整百
} // 代码块结束

/** 生日号判定：8 位且为 19xx / 20xx 的合法日期（19900101、20000101） */
function isBirthday(text: string): boolean {
  if (text.length !== 8 || !/^(19|20)\d{6}$/.test(text)) return false; // 只认 20 世纪的 8 位日期形态
  const year = Number(text.slice(0, 4)); // 年
  const month = Number(text.slice(4, 6)); // 月
  const day = Number(text.slice(6, 8)); // 日
  if (month < 1 || month > 12 || day < 1 || day > 31) return false; // 月日粗筛
  const parsed = new Date(Date.UTC(year, month - 1, day)); // 用 UTC 构造避免本地时区偏移
  return ( // 返回当前函数的处理结果
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day // 执行当前业务步骤
  ); // 构造回读一致才算合法日期（拦住 2 月 30 日这类）
} // 代码块结束

/**
 * 判定一个号码属于哪类靓号。
 * @param input 纯数字（number 或数字字符串）
 * @returns 命中返回类别，普通号返回 null
 */
export function classifyPremiumNo(input: number | string): PremiumReason | null {
  const text = String(input); // 统一转字符串逐位判定
  if (!PURE_DIGITS.test(text)) return null; // 非纯数字不参与（历史 MIM-xxx 由重排处理）
  if (isShort(text)) return 'short'; // 1～99 整段预留
  if (isBirthday(text)) return 'birthday'; // 生日号优先：8 位日期可能同时满足别的规则，按语义归类
  if (isRepeat(text)) return 'repeat'; // 豹子号
  if (isLadder(text)) return 'ladder'; // 顺子号
  if (isPalindrome(text)) return 'palindrome'; // 回文号
  if (isAbab(text)) return 'abab'; // 对子号
  if (isRepeatBlock(text)) return 'repeatBlock'; // 重复段
  if (isStaircase(text)) return 'staircase'; // 阶梯对子
  if (isRound(text)) return 'round'; // 整百 / 整千
  if (ICONIC_NUMBERS.includes(text)) return 'iconic'; // 经典号
  if (PRONOUNCE_SEGMENTS.some((segment) => text.includes(segment))) return 'pronounce'; // 谐音 / 吉利号
  return null; // 其余为普通号，可自动发放
} // 代码块结束

/** 是否为靓号（发号器、迁移脚本与前端提示共用的布尔入口） */
export function isPremiumMemberNo(input: number | string): boolean {
  return classifyPremiumNo(input) !== null; // 复用分类结果，避免两套判定
} // 代码块结束
