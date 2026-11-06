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
const STRICT = args.includes('--strict');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : DEFAULT_THRESHOLD;

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
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }); // 读取目录项（文件/子目录）
  } catch {
    return; // 目录不存在时静默跳过，保证脚本可重复运行
  }
  for (const entry of entries) {
    const full = join(dir, entry.name); // 拼出绝对路径
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue; // 跳过豁免目录
      walk(full, out); // 递归子目录
    } else if (EXTENSIONS.has(extname(entry.name))) {
      out.push(full); // 命中扩展名白名单则纳入统计
    }
  }
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

  for (const raw of lines) {
    const line = raw.trim(); // 去掉首尾空白便于判定
    if (!line) {
      prevCommentOnly = false; // 空行重置「紧邻解释」的传递
      continue; // 空行不计入分母
    }

    total += 1; // 非空行计入分母
    let hasComment = false; // 本行是否含注释标记
    let commentOnly = false; // 本行是否「只有注释、没有代码」

    if (inBlock) {
      // 块注释续行：整行默认都算注释内容
      hasComment = true;
      commentOnly = true;
      if (line.includes('*/') || line.includes('-->')) {
        inBlock = false; // 块注释在本行结束
        const rest = line.split(/\*\/|-->/).pop().trim(); // 结束标记之后可能还有代码
        commentOnly = rest === '';
      }
    } else {
      // 行内出现块注释起始标记（JS 的 /* 或 HTML 的 <!--）
      if (line.includes('/*') || line.includes('<!--')) {
        hasComment = true;
        const closed = line.includes('*/') || line.includes('-->'); // 是否在同一行闭合
        if (!closed) inBlock = true; // 未闭合则进入跨行块注释状态
        const idx = Math.max(line.lastIndexOf('/*'), line.lastIndexOf('<!--'));
        const before = idx >= 0 ? line.slice(0, idx).trim() : ''; // 注释标记之前的代码
        const after = closed ? line.split(/\*\/|-->/).pop().trim() : ''; // 闭合标记之后的代码
        commentOnly = before === '' && after === '';
      }
      // 行注释判定（仅当本行尚未命中块注释逻辑）
      if (!hasComment && LINE_COMMENT.test(line)) {
        hasComment = true;
        commentOnly = LINE_COMMENT_ONLY.test(line);
      }
      // 纯 HTML 注释行
      if (!hasComment && HTML_COMMENT_ONLY.test(line)) {
        hasComment = true;
        commentOnly = true;
      }
    }

    if (hasComment || prevCommentOnly) covered += 1; // 本行有注释，或紧邻上一行的纯注释，均视为已解释
    prevCommentOnly = commentOnly; // 供下一行判定「紧邻解释」使用
  }

  const ratio = total === 0 ? 1 : covered / total; // 空文件视为 100% 达标
  return { total, covered, ratio };
}

// ===== 主流程 =====
const files = [];
for (const dir of TARGET_DIRS) walk(join(ROOT, dir), files); // 扫描约定的顶层目录
for (const extra of EXTRA_FILES) {
  try {
    if (statSync(join(ROOT, extra)).isFile()) files.push(join(ROOT, extra)); // 根级文件存在才纳入
  } catch {
    // 文件不存在时跳过，不阻断脚本
  }
}

// 汇总每个文件的统计结果
const results = files.map((file) => {
  const stat = analyze(file);
  return { file: relative(ROOT, file).replace(/\\/g, '/'), ...stat };
});

// 按覆盖率升序排列，缺口最大的排在最前，便于直接看到待补清单
results.sort((a, b) => a.ratio - b.ratio);

const totalLines = results.reduce((sum, r) => sum + r.total, 0); // 全仓可注释行
const coveredLines = results.reduce((sum, r) => sum + r.covered, 0); // 全仓已解释行
const overall = totalLines === 0 ? 1 : coveredLines / totalLines; // 全仓覆盖率
const failing = results.filter((r) => r.ratio < THRESHOLD); // 未达阈值的文件

// 输出报告头：阈值与汇总数据，便于交付报告直接引用
console.log('== 铁律十一 注释覆盖率报告 ==');
console.log(`阈值: ${(THRESHOLD * 100).toFixed(0)}% | 模式: ${STRICT ? 'strict（门禁）' : 'baseline（基线）'}`);
console.log(`文件数: ${results.length} | 可注释行: ${totalLines} | 已解释行: ${coveredLines} | 总体覆盖率: ${(overall * 100).toFixed(1)}%`);
console.log(`未达标文件: ${failing.length}`);

// 输出缺口最大的前 20 个文件，便于分批补齐
console.log('\n-- 缺口 Top 20（覆盖率升序）--');
for (const r of results.slice(0, 20)) {
  const flag = r.ratio < THRESHOLD ? '❌' : '✅';
  console.log(`${flag} ${(r.ratio * 100).toFixed(1).padStart(6)}%  ${r.covered}/${r.total}  ${r.file}`);
}

// strict 模式：总体覆盖率不足阈值时以退出码 1 表达失败，供 CI 消费
if (STRICT && overall < THRESHOLD) {
  console.error(`\n❌ strict 未通过：总体覆盖率 ${(overall * 100).toFixed(1)}% < 阈值 ${(THRESHOLD * 100).toFixed(0)}%`);
  process.exit(1);
}

// baseline 模式或 strict 通过：退出 0，表示脚本本身执行成功
console.log(`\n${STRICT ? '✅ strict 通过' : 'ℹ️ baseline 完成（未达标文件已列出，按铁律十一分批补齐）'}`);
process.exit(0);
