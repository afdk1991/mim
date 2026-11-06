#!/usr/bin/env node
/**
 * scripts/comment-check.mjs
 * 铁律十一（全仓库逐行注释与解释）的覆盖率校验器。
 *
 * 判定规则（与 AGENTS.md 铁律十一一致）：
 *   1. 非空行计为「可注释行」；
 *   2. 该行本身含注释标记（//、/*、<!--）→ 视为已解释；
 *   3. 上一行是「纯注释行」（只有注释没有任何代码）→ 下一行视为已解释（紧邻解释）；
 *   4. 纯文档 *.md、锁文件、node_modules、构建产物均在扫描阶段排除（豁免项）。
 *
 * 用法：
 *   node scripts/comment-check.mjs              # 基线报告，始终退出 0
 *   node scripts/comment-check.mjs --strict     # CI 门禁：总体覆盖率低于阈值时退出 1
 *   node scripts/comment-check.mjs --threshold=0.9
 */

// 仅使用 Node 内置模块，符合仓库「校验脚本零第三方依赖」的既有范式。
import { readdirSync, readFileSync, statSync } from 'node:fs';
// path 工具：join 拼跨平台路径、relative 生成报告里的相对路径、extname 取扩展名做白名单判断
import { join, relative, extname } from 'node:path';

// 仓库根目录：以当前工作目录为准（pnpm 脚本默认在仓库根执行）。
const ROOT = process.cwd();

// 需要扫描的顶层目录（业务代码 + 脚本 + 静态站）。
const TARGET_DIRS = ['apps', 'services', 'packages', 'scripts', 'site'];

// 需要单独扫描的根级文件（PRD 是自包含 HTML，同样受铁律十一约束）。
const EXTRA_FILES = ['Mim-PRD.html'];

// 参与统计的文件扩展名白名单；其余（.md/.json/.yaml 等）属豁免项。
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html']);

// 扫描时跳过的目录：依赖、产物、版本库元数据，均属铁律十一豁免项。
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.vite', '.turbo']);

// 默认达标阈值；逐行注释是目标，0.8 作为「可接受基线」，--strict 下用于门禁判定。
const DEFAULT_THRESHOLD = 0.8;

// 解析命令行参数：--strict 开启门禁，--threshold=0.9 覆盖阈值。
const args = process.argv.slice(2);
// 门禁开关：只有显式传入 --strict 才在覆盖率不足时退出 1，默认走 baseline 基线模式
const STRICT = args.includes('--strict');
// 粗筛出 --threshold=... 形式的参数；没有时保持 undefined，供下一行回落默认值
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
// 取等号右侧的数字作为阈值；未传参时回落到 DEFAULT_THRESHOLD（0.8）
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : DEFAULT_THRESHOLD;
// 缺口清单展示条数：默认 20；--top=999 可一次看全，便于分批补齐时锁定完整待办列表。
const topArg = args.find((a) => a.startsWith('--top='));
// 解析展示条数；缺省 20 兼顾输出可读性，--top=999 可一次看全以便锁定完整待办
const TOP_N = topArg ? Number(topArg.split('=')[1]) : 20;

// 行内注释标记：// 前面不能是冒号或字母数字，避免把 https:// 误判为注释。
const LINE_COMMENT = /(^|[^:\w])\/\//;
// 纯行注释：整行只有 // 注释（允许前导空白）。
const LINE_COMMENT_ONLY = /^\s*\/\//;
// HTML 纯注释行：整行以 <!-- 开头。
const HTML_COMMENT_ONLY = /^\s*<!--/;

/**
 * 递归收集待统计文件。
 * @param {string} dir 绝对目录路径
 * @param {string[]} out 收集结果的累加数组
 */
function walk(dir, out) {
  // 先声明目录项数组：赋值放进 try，便于把「目录不存在」与「读取失败」统一兜住
  let entries;
  // 读取目录内容；withFileTypes 直接给出类型，省去后续逐项 stat 探测
  try {
    entries = readdirSync(dir, { withFileTypes: true }); // 读取目录项（文件/子目录）
    // 读取失败通常意味着目录不存在（如全新仓库没有 site 目录）或无权限：不中断整体扫描
  } catch {
    return; // 目录不存在时静默跳过，保证脚本可重复运行
  // catch 分支结束：目录缺失不产生任何副作用
  }
  // 逐个处理目录项：子目录继续递归，普通文件按扩展名白名单决定是否纳入
  for (const entry of entries) {
    const full = join(dir, entry.name); // 拼出绝对路径
    // 情况一：子目录 —— 先查豁免名单（依赖、产物目录），再决定是否深入
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue; // 跳过豁免目录
      walk(full, out); // 递归子目录
      // 情况二：普通文件 —— 扩展名命中白名单才计入统计，.md/.json 等属铁律十一豁免项
    } else if (EXTENSIONS.has(extname(entry.name))) {
      out.push(full); // 命中扩展名白名单则纳入统计
    // 单个目录项处理结束，回到 for 继续下一项
    }
    // 本目录处理完毕：out 已累加其中所有符合条件的文件
  }
  // 递归返回：由调用方继续处理同级的下一个目录项
}

/**
 * 统计单个文件的注释覆盖率。
 * @param {string} file 绝对文件路径
 * @returns {{total:number, covered:number, ratio:number}}
 */
function analyze(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/); // 统一按换行切分
  let total = 0; // 可注释行总数
  let covered = 0; // 已解释行数
  let inBlock = false; // 是否处于跨行块注释中（/* ... */ 或 <!-- ... -->）
  let prevCommentOnly = false; // 上一行是否为纯注释行

  // 逐行扫描：每行先做归一化，再判定它属于「块注释续行 / 行注释 / 纯 HTML 注释」中的哪种
  for (const raw of lines) {
    const line = raw.trim(); // 去掉首尾空白便于判定
    // 空行不参与统计：直接跳过，同时清掉「上一行是纯注释」的传递状态
    if (!line) {
      prevCommentOnly = false; // 空行重置「紧邻解释」的传递
      continue; // 空行不计入分母
    // 空行分支到此结束：continue 已把它排除在分母之外
    }

    total += 1; // 非空行计入分母
    let hasComment = false; // 本行是否含注释标记
    let commentOnly = false; // 本行是否「只有注释、没有代码」

    // 分支一：上一行开启了块注释且尚未闭合 —— 本行整行都处在注释内部
    if (inBlock) {
      // 块注释续行：整行默认都算注释内容
      hasComment = true;
      // 续行内没有代码，先按「纯注释」处理，等下面的结束标记判定再修正
      commentOnly = true;
      // 本行若出现块注释结束标记（星号紧跟斜杠，或连字符连大于号），则注释在此收尾
      if (line.includes('*/') || line.includes('-->')) {
        inBlock = false; // 块注释在本行结束
        const rest = line.split(/\*\/|-->/).pop().trim(); // 结束标记之后可能还有代码
        // 结束标记后若还有代码（例如右花括号），本行就不算「纯注释」
        commentOnly = rest === '';
      // 结束标记处理完毕：标记之后的残留内容已由 rest 截取并参与 commentOnly 判定
      }
      // 块注释状态已在上一个分支处理完；本分支只需判断本行自身是否含注释标记
    } else {
      // 行内出现块注释起始标记（JS 的 /* 或 HTML 的 <!--）
      if (line.includes('/*') || line.includes('<!--')) {
        hasComment = true;
        const closed = line.includes('*/') || line.includes('-->'); // 是否在同一行闭合
        if (!closed) inBlock = true; // 未闭合则进入跨行块注释状态
        // 定位本行最后一个块注释起始标记的位置，用它把「标记之前的代码」切出来
        const idx = Math.max(line.lastIndexOf('/*'), line.lastIndexOf('<!--'));
        const before = idx >= 0 ? line.slice(0, idx).trim() : ''; // 注释标记之前的代码
        const after = closed ? line.split(/\*\/|-->/).pop().trim() : ''; // 闭合标记之后的代码
        commentOnly = before === '' && after === '';
      // 起始标记处理完毕：commentOnly 已按标记前后是否残留代码确定
      }
      // 行注释判定（仅当本行尚未命中块注释逻辑）
      if (!hasComment && LINE_COMMENT.test(line)) {
        hasComment = true;
        commentOnly = LINE_COMMENT_ONLY.test(line);
      // 行注释判定结束：命中时 hasComment 已置真，commentOnly 取决于整行是否只有注释
      }
      // 纯 HTML 注释行
      if (!hasComment && HTML_COMMENT_ONLY.test(line)) {
        hasComment = true;
        commentOnly = true;
      }
    }

    if (hasComment || prevCommentOnly) covered += 1; // 本行有注释，或紧邻上一行的纯注释，均视为已解释
    prevCommentOnly = commentOnly; // 供下一行判定「紧邻解释」使用
  // 全部行扫描完毕：total 与 covered 已累加出本文件的统计值
  }

  const ratio = total === 0 ? 1 : covered / total; // 空文件视为 100% 达标
  return { total, covered, ratio };
// analyze 结束：把「分母 / 分子 / 覆盖率」三元组交回调用方汇总
}

// ===== 主流程 =====
const files = [];
for (const dir of TARGET_DIRS) walk(join(ROOT, dir), files); // 扫描约定的顶层目录
// 补充扫描根级单文件（如自包含 PRD），它们不在上面那批顶层目录里
for (const extra of EXTRA_FILES) {
  // 用 statSync 探测：只有真实存在的普通文件才纳入，避免目录或缺失路径污染统计
  try {
    if (statSync(join(ROOT, extra)).isFile()) files.push(join(ROOT, extra)); // 根级文件存在才纳入
    // 文件缺失或不可读：跳过该文件即可，不影响其余文件的统计结果
  } catch {
    // 文件不存在时跳过，不阻断脚本
  // 结束 catch：缺文件属正常情况，静默忽略即可
  }
}

// 汇总每个文件的统计结果
const results = files.map((file) => {
  // 逐个文件执行逐行判定，拿到该文件的分母、分子与覆盖率
  const stat = analyze(file);
  // 路径统一转成正斜杠，保证 Windows 与 Linux 上的报告输出可直接对比
  return { file: relative(ROOT, file).replace(/\\/g, '/'), ...stat };
// map 结束：results 即逐文件统计数组，供排序与汇总使用
});

// 按覆盖率升序排列，缺口最大的排在最前，便于直接看到待补清单
results.sort((a, b) => a.ratio - b.ratio);

const totalLines = results.reduce((sum, r) => sum + r.total, 0); // 全仓可注释行
const coveredLines = results.reduce((sum, r) => sum + r.covered, 0); // 全仓已解释行
const overall = totalLines === 0 ? 1 : coveredLines / totalLines; // 全仓覆盖率
const failing = results.filter((r) => r.ratio < THRESHOLD); // 未达阈值的文件

// 输出报告头：阈值与汇总数据，便于交付报告直接引用
console.log('== 铁律十一 注释覆盖率报告 ==');
// 报告头：阈值与运行模式，便于把输出原样贴进交付报告
console.log(`阈值: ${(THRESHOLD * 100).toFixed(0)}% | 模式: ${STRICT ? 'strict（门禁）' : 'baseline（基线）'}`);
// 汇总行：文件数与分子/分母都列出，避免只看百分比而无法判断样本量
console.log(`文件数: ${results.length} | 可注释行: ${totalLines} | 已解释行: ${coveredLines} | 总体覆盖率: ${(overall * 100).toFixed(1)}%`);
// 未达标文件数：strict 门禁据此判断是否需要以退出码 1 失败
console.log(`未达标文件: ${failing.length}`);

// 输出缺口最大的前 N 个文件（默认 20），便于分批补齐
console.log(`\n-- 缺口 Top ${TOP_N}（覆盖率升序）--`);
// 只取前 TOP_N 条，按覆盖率升序，缺口最大的排最前，补齐时从上往下处理
for (const r of results.slice(0, TOP_N)) {
  // 达标打 ✅、未达标打 ❌，便于在长清单里快速扫读
  const flag = r.ratio < THRESHOLD ? '❌' : '✅';
  // 百分比右对齐 6 位，配合固定的分子/分母与路径列，方便两轮结果逐行比对
  console.log(`${flag} ${(r.ratio * 100).toFixed(1).padStart(6)}%  ${r.covered}/${r.total}  ${r.file}`);
// 缺口清单输出结束
}

// strict 模式：总体覆盖率不足阈值时以退出码 1 表达失败，供 CI 消费
if (STRICT && overall < THRESHOLD) {
  console.error(`\n❌ strict 未通过：总体覆盖率 ${(overall * 100).toFixed(1)}% < 阈值 ${(THRESHOLD * 100).toFixed(0)}%`);
  process.exit(1);
// strict 门禁分支结束：退出码已置 1，CI 会据此判定失败
}

// baseline 模式或 strict 通过：退出 0，表示脚本本身执行成功
console.log(`\n${STRICT ? '✅ strict 通过' : 'ℹ️ baseline 完成（未达标文件已列出，按铁律十一分批补齐）'}`);
// 进程以 0 退出：baseline 模式下即使存在未达标文件，也视为脚本本身执行成功
process.exit(0);
