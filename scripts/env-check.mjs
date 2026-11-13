#!/usr/bin/env node
/**
 * scripts/env-check.mjs
 *
 * 强制落实 docs/wiki/09-third-party-sdk-inventory.md §0 的三条硬约束：
 *  1. 密钥不入库：.env.example 只允许空值，真实 .env 必须被 .gitignore 覆盖。
 *  2. 变量名一一对应：.env.example 与 09 清单的 MIM_* 变量双向对齐。
 *  3. 先登记后接入：清单外的变量不得出现在模板中（清单通配符 `MIM_X_*` 可覆盖展开项）。
 *
 * 用法：
 *   node scripts/env-check.mjs
 *
 * 退出码：0 = 通过，1 = 存在违规。
 *
 * 重要实现细节：
 *  正则一律使用 [ \t]* 而非 \s，因为 JS 的 \s 包含换行符，
 *  会造成「空值变量」跨行误判为「非空赋值」（历史踩坑，务必保留）。
 */

// 引入 node:fs 的 existsSync / readFileSync：检测文件存在、读取文本内容
import { existsSync, readFileSync } from 'node:fs';
// 引入 node:path 的 join / dirname：跨平台拼接路径、取路径的目录部分
import { join, dirname } from 'node:path';
// 引入 node:url 的 fileURLToPath：把 file:// URL 转成本地文件系统路径
import { fileURLToPath } from 'node:url';

// ESM 无内置 __dirname，用 import.meta.url 推导脚本所在目录
const __dirname = dirname(fileURLToPath(import.meta.url));
// 仓库根目录 = 脚本所在 scripts 目录的上一级
const ROOT = join(__dirname, '..');

// 密钥占位模板路径
const TEMPLATE_PATH = join(ROOT, '.env.example');
// 第三方清单唯一真源路径
const INVENTORY_PATH = join(ROOT, 'docs', 'wiki', '09-third-party-sdk-inventory.md');
// 忽略规则文件路径
const GITIGNORE_PATH = join(ROOT, '.gitignore');
// 本地真实密钥文件路径（只探测是否存在，绝不读取内容）
const ENV_PATH = join(ROOT, '.env');

// 项目统一变量前缀
const NAME_PREFIX = 'MIM_';
// 赋值行正则：行首大写变量名 + 可选空格 + 等号（[ \t]* 杜绝跨行误匹配）
const ASSIGN_LINE_RE = /^([A-Z][A-Z0-9_]*)[ \t]*=/;
// 清单中反引号包裹的具体变量名（闭合反引号必须紧跟变量名，故通配符项不会被误捕）
const INVENTORY_VAR_RE = /`(MIM_[A-Z0-9_]+)`/g;
// 清单中反引号包裹的通配变量（如 `MIM_CDN_*`），捕获其前缀主干
const INVENTORY_WILDCARD_RE = /`(MIM_[A-Z0-9_]+)\*`/g;

// 进程退出码：默认 0 通过，任何违规置 1
let exitCode = 0;

// 打印 ❌ 并标记违规
function fail(msg) {
  console.log(`❌ ${msg}`); // 向控制台输出运行日志或错误信息
  exitCode = 1; // 赋值：更新变量 exitCode 的取值
} // 代码块结束

// 打印 ⚠️ 仅提示，不影响退出码
function warn(msg) {
  console.log(`⚠️  ${msg}`); // 向控制台输出运行日志或错误信息
} // 代码块结束

// 打印 ✅ 通过项
function ok(msg) {
  console.log(`✅ ${msg}`); // 向控制台输出运行日志或错误信息
} // 代码块结束

// 读取 .env.example 的逐行文本；文件缺失返回 null
function readTemplateLines() {
  // 模板不存在时直接返回 null，交由主流程判失败
  if (!existsSync(TEMPLATE_PATH)) return null;
  // 读取全文并按 CRLF / LF 双兼容方式拆行
  return readFileSync(TEMPLATE_PATH, 'utf-8').split(/\r?\n/);
} // 代码块结束

// 从模板行中抽取全部赋值项：{ lineNo, name, value }
function collectAssignments(lines) {
  // 结果数组
  const out = [];
  // 逐行扫描，索引用于报错定位行号
  lines.forEach((text, idx) => {
    // 只处理「变量 = 值」形态的赋值行，注释与分组标题跳过
    const m = text.match(ASSIGN_LINE_RE);
    // 非赋值行直接跳过
    if (!m) return;
    // 取等号右侧内容并去除两侧空白（空值即合规占位）
    const value = text.slice(text.indexOf('=') + 1).trim();
    // 记录行号、变量名、值
    out.push({ lineNo: idx + 1, name: m[1], value });
  }); // 代码块结束
  // 返回全部赋值项
  return out;
} // 代码块结束

// 从 09 清单中抽取具体变量集合 + 通配符前缀集合
function readInventory() {
  // 清单不存在时返回 null
  if (!existsSync(INVENTORY_PATH)) return null;
  // 读取清单全文
  const text = readFileSync(INVENTORY_PATH, 'utf-8');
  // 具体变量名集合（去重）
  const vars = new Set();
  // 逐条迭代匹配结果
  for (const m of text.matchAll(INVENTORY_VAR_RE)) vars.add(m[1]);
  // 通配符前缀数组（如 MIM_CDN_）
  const stems = [];
  // 逐条迭代通配符匹配结果
  for (const m of text.matchAll(INVENTORY_WILDCARD_RE)) stems.push(m[1]);
  // 返回两个集合
  return { vars, stems };
} // 代码块结束

// 检查 .gitignore 是否覆盖 .env
function checkGitignore() {
  // 文件不存在：既无忽略规则，也无法豁免模板
  if (!existsSync(GITIGNORE_PATH)) return { exists: false, coversEnv: false, keepsExample: false };
  // 读取忽略规则全文
  const lines = readFileSync(GITIGNORE_PATH, 'utf-8').split(/\r?\n/);
  // 去空白、去注释、去空行，得到有效规则列表
  const rules = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  // 是否含精确忽略 .env 的规则
  const coversEnv = rules.includes('.env');
  // 是否含反向豁免 .env.example 的规则
  const keepsExample = rules.includes('!.env.example');
  // 返回三项判定
  return { exists: true, coversEnv, keepsExample };
} // 代码块结束

// 打印标题与输入文件
console.log('=== Mim 密钥模板校验 (09 清单 §0) ===');
// 打印模板路径
console.log('模板: .env.example');
// 打印清单路径
console.log('清单: docs/wiki/09-third-party-sdk-inventory.md');
// 打印空行
console.log('');

// ---------- 1. 模板存在性 ----------
// 读取模板行
const lines = readTemplateLines();
// 模板缺失：直接判违规并结束
if (!lines) {
  // 报错
  fail('未找到 .env.example（密钥占位模板缺失）');
  // 空行
  console.log('');
  // 总结论
  console.log('❌ 密钥模板校验未通过');
  // 以失败码退出
  process.exit(exitCode);
} // 代码块结束

// ---------- 2. 变量统计与去重 ----------
// 抽取全部赋值项
const assignments = collectAssignments(lines);
// 变量名集合（去重）
const names = new Set(assignments.map((a) => a.name));
// 变量名出现次数表，用于查重
const counts = new Map();
// 逐项累计出现次数
assignments.forEach((a) => counts.set(a.name, (counts.get(a.name) || 0) + 1));
// 重复变量列表
const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
// 打印总量与去重后数量
console.log(`模板变量: total=${assignments.length} unique=${names.size}`);
// 存在重复：逐项报错
if (duplicates.length > 0) {
  // 报错并列出重复名
  fail(`存在重复变量: ${duplicates.join(', ')}`);
} else { // 代码块结束
  // 无重复：通过
  ok('变量名无重复');
} // 代码块结束

// ---------- 3. 空值检查（密钥不入库） ----------
// 过滤出真实赋值的项（空值占位是唯一允许形态）
const nonEmpty = assignments.filter((a) => a.value !== '');
// 存在真实赋值：逐行报错（只打印变量名，避免把疑似密钥回显到日志）
if (nonEmpty.length > 0) {
  // 拼接违规清单：行号 + 变量名
  const detail = nonEmpty.map((a) => `L${a.lineNo}:${a.name}`).join(', ');
  // 报错
  fail(`模板存在非空赋值（禁止提交真实密钥）: ${detail}`);
} else { // 代码块结束
  // 全部为空值：通过
  ok('模板全部为空值占位（无真实密钥）');
} // 代码块结束

// ---------- 4. 与 09 清单双向对齐 ----------
// 读取清单
const inventory = readInventory();
// 清单缺失：判违规（唯一真源不可缺）
if (!inventory) {
  // 报错
  fail('未找到 docs/wiki/09-third-party-sdk-inventory.md（清单唯一真源缺失）');
} else { // 代码块结束
  // 清单有、模板无 → 漏落位
  const missingInTemplate = [...inventory.vars].filter((v) => !names.has(v));
  // 模板有、清单无 → 需进一步判断是否被通配符覆盖
  const notInInventory = [...names].filter((v) => !inventory.vars.has(v));
  // 被清单通配符覆盖的展开项（如 Stripe 月度/年度价格 ID）
  const coveredByWildcard = notInInventory.filter((v) =>
    inventory.stems.some((stem) => v.startsWith(stem)), // 执行当前业务步骤
  ); // 执行当前业务步骤
  // 既不在清单、也不被通配符覆盖 → 真正的未登记变量
  const unregistered = notInInventory.filter((v) => !coveredByWildcard.includes(v));

  // 打印对齐统计
  console.log(
    `清单对齐: inventory=${inventory.vars.size} missing=${missingInTemplate.length} ` + // 执行当前业务步骤
      `extra=${unregistered.length} wildcardCovered=${coveredByWildcard.length}`, // 执行当前业务步骤
  ); // 执行当前业务步骤
  // 漏落位变量：逐项报错
  if (missingInTemplate.length > 0) {
    // 报错并列出清单中有但模板缺失的变量
    fail(`模板缺少清单已登记变量: ${missingInTemplate.join(', ')}`);
  } else { // 代码块结束
    // 全部落位：通过
    ok('清单登记变量已全部落位到模板');
  } // 代码块结束
  // 通配符覆盖项：仅提示
  if (coveredByWildcard.length > 0) {
    // 提示这些变量由清单通配符覆盖
    warn(`以下变量由清单通配符覆盖: ${coveredByWildcard.join(', ')}`);
  } // 代码块结束
  // 未登记变量：报错（违反「先登记后接入」）
  if (unregistered.length > 0) {
    // 报错并列出
    fail(`模板存在清单未登记变量: ${unregistered.join(', ')}`);
  } else { // 代码块结束
    // 无未登记变量：通过
    ok('模板无清单外变量（先登记后接入合规）');
  } // 代码块结束
} // 代码块结束

// ---------- 5. 命名规范 ----------
// 所有变量必须以 MIM_ 前缀开头
const badPrefix = [...names].filter((n) => !n.startsWith(NAME_PREFIX));
// 存在不合规前缀：报错
if (badPrefix.length > 0) {
  // 报错并列出
  fail(`变量名缺少 ${NAME_PREFIX} 前缀: ${badPrefix.join(', ')}`);
} else { // 代码块结束
  // 全部合规：通过
  ok(`全部变量均使用 ${NAME_PREFIX} 前缀`);
} // 代码块结束

// ---------- 6. .gitignore 覆盖检查（密钥不入库） ----------
// 执行忽略规则检查
const gi = checkGitignore();
// .gitignore 不存在：判违规
if (!gi.exists) {
  // 报错
  fail('缺少 .gitignore（无法阻止 .env 误提交）');
} else if (!gi.coversEnv) { // 代码块结束
  // 存在但未忽略 .env：判违规
  fail('.gitignore 未包含 .env 忽略规则');
} else { // 代码块结束
  // 覆盖到位：通过
  ok('.gitignore 已忽略 .env');
  // 反向豁免缺失：仅提示（避免模板自身被误忽略）
  if (!gi.keepsExample) {
    // 提示
    warn('.gitignore 建议补充 !.env.example 反向豁免');
  } // 代码块结束
} // 代码块结束

// ---------- 7. 本地 .env 探测（只探测存在性，不读内容） ----------
// 本地存在真实 .env
if (existsSync(ENV_PATH)) {
  // 已被忽略则提示「存在但安全」
  if (gi.coversEnv) {
    // 提示
    console.log('ℹ️  本地 .env 存在，且已被 .gitignore 忽略');
  } else { // 代码块结束
    // 未忽略：前面已判违规，这里再显式点名风险
    fail('本地 .env 存在且未被忽略，存在密钥泄露风险');
  } // 代码块结束
} else { // 代码块结束
  // 不存在：无泄露风险
  console.log('ℹ️  本地未创建 .env（无泄露风险）');
} // 代码块结束

// ---------- 8. 结论 ----------
// 打印空行
console.log('');
// 根据累计退出码输出总结论
if (exitCode === 0) {
  // 通过
  console.log('✅ 密钥模板校验通过');
} else { // 代码块结束
  // 未通过
  console.log('❌ 密钥模板校验未通过，请根据上方提示修正');
} // 代码块结束

// 以累计退出码结束进程
process.exit(exitCode);
