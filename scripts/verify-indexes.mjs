#!/usr/bin/env node
/**
 * 索引巡检门禁（安全加固与性能包，2026-11-13）。
 *
 * 在空内存库上执行 inspectIndexes：
 *   - 缺失索引建议（missing）> 0 → 退出码 1，CI 阻断；
 *   - 慢查询候选（slowCandidates）为只读建议，仅打印，不作为退出码依据；
 *   - 不执行任何 DDL，不连真实数据库。
 *
 * 用法：
 *   node scripts/verify-indexes.mjs            # 巡检并按缺失索引判定退出码
 *   node scripts/verify-indexes.mjs --json     # 额外输出原始 JSON 清单
 *
 * CI 接入（仓库根目录）：
 *   pnpm --filter @mim/api typecheck && node scripts/verify-indexes.mjs
 *
 * 退出码：0 无缺失索引；1 存在缺失索引建议；2 巡检脚本自身执行失败。
 */

import { spawnSync } from 'node:child_process'; // 引入依赖、类型或本地模块绑定
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'; // 引入依赖、类型或本地模块绑定
import { dirname, join, resolve } from 'node:path'; // 引入依赖、类型或本地模块绑定
import { fileURLToPath } from 'node:url'; // 引入依赖、类型或本地模块绑定

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // 仓库根目录
const API_DIR = join(ROOT, 'services', 'mim-api'); // 后端包目录
const RUNNER = join(API_DIR, '.verify-indexes.runner.ts'); // 临时 TS 运行器（执行后删除，不提交）

const args = process.argv.slice(2); // 常量 args：保存固定配置或一次性派生值
const asJson = args.includes('--json'); // 常量 asJson：保存固定配置或一次性派生值

const RUNNER_SOURCE = `
import { createDatabase } from './src/db.js';
import { inspectIndexes } from './src/security.js';

const db = createDatabase(':memory:'); // 空内存库：仅校验 schema 与索引覆盖，不写真实库
const audit = inspectIndexes(db);
console.log(JSON.stringify({
  missing: audit.missing,
  slowCandidates: audit.slowCandidates,
}));
`;

function failSelf(message) { // 函数 failSelf：封装一段可复用的处理逻辑
  console.error(`[verify-indexes] ${message}`); // 向控制台输出运行日志或错误信息
  process.exit(2); // 执行当前业务步骤
} // 代码块结束

let runnerWritten = false; // 可变变量 runnerWritten：运行过程中会被重新赋值
try { // 异常捕获起点：包裹可能抛出错误的操作
  mkdirSync(API_DIR, { recursive: true }); // 调用 mkdirSync 并处理其返回结果
  writeFileSync(RUNNER, RUNNER_SOURCE, 'utf8'); // 调用 writeFileSync 并处理其返回结果
  runnerWritten = true; // 赋值：更新变量 runnerWritten 的取值

  // 优先直调本地 tsx CLI（node 进程），避免运行环境 PATH 缺少 pnpm；找不到再回退 pnpm exec。
  const tsxCli = join(API_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const usePnpm = !existsSync(tsxCli); // 常量 usePnpm：保存固定配置或一次性派生值
  const cmd = usePnpm ? 'pnpm' : process.execPath; // 常量 cmd：保存固定配置或一次性派生值
  const args = usePnpm ? ['--filter', '@mim/api', 'exec', 'tsx', RUNNER] : [tsxCli, RUNNER]; // 常量 args：保存固定配置或一次性派生值
  const result = spawnSync(cmd, args, { // 常量 result：保存固定配置或一次性派生值
    cwd: ROOT, // 对象字段 cwd：记录一项配置或数据
    encoding: 'utf8', // 对象字段 encoding：记录一项配置或数据
    shell: usePnpm, // 仅回退 pnpm 时经 shell 解析路径
  }); // 代码块结束

  if (result.status !== 0) { // 条件分支：按判断结果选择后续处理路径
    process.stderr.write(result.stdout ?? ''); // 执行当前业务步骤
    process.stderr.write(result.stderr ?? ''); // 执行当前业务步骤
    failSelf(`巡检运行器退出码 ${result.status}`); // 调用 failSelf 并处理其返回结果
  } // 代码块结束

  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).pop()); // 常量 payload：保存固定配置或一次性派生值
  const missing = Array.isArray(payload.missing) ? payload.missing : []; // 常量 missing：保存固定配置或一次性派生值
  const slow = Array.isArray(payload.slowCandidates) ? payload.slowCandidates : []; // 常量 slow：保存固定配置或一次性派生值

  console.log('[verify-indexes] 索引巡检结果'); // 向控制台输出运行日志或错误信息
  console.log(`  缺失索引建议：${missing.length} 条`); // 向控制台输出运行日志或错误信息
  for (const item of missing) { // 循环：逐项遍历集合并执行相同处理
    console.log(`    - ${item.table}(${item.columns})：${item.reason}`); // 向控制台输出运行日志或错误信息
  } // 代码块结束
  console.log(`  慢查询候选（建议项，不阻断）：${slow.length} 条`); // 向控制台输出运行日志或错误信息
  for (const item of slow) { // 循环：逐项遍历集合并执行相同处理
    console.log(`    - ${item.table}：${item.pattern}`); // 向控制台输出运行日志或错误信息
  } // 代码块结束

  if (asJson) console.log(JSON.stringify(payload, null, 2)); // 条件分支：按判断结果选择后续处理路径

  if (missing.length > 0) { // 条件分支：按判断结果选择后续处理路径
    console.error(`[verify-indexes] 存在 ${missing.length} 条缺失索引建议，门禁未通过`); // 向控制台输出运行日志或错误信息
    process.exit(1); // 执行当前业务步骤
  } // 代码块结束
  console.log('[verify-indexes] 门禁通过：无缺失索引建议'); // 向控制台输出运行日志或错误信息
  process.exit(0); // 执行当前业务步骤
} catch (err) { // 代码块结束
  failSelf(err instanceof Error ? err.message : String(err)); // 调用 failSelf 并处理其返回结果
} finally { // 代码块结束
  // Windows 下子进程句柄释放可能延迟；删除失败静默跳过，该文件为未跟踪临时产物，不提交。
  if (runnerWritten) {
    try { rmSync(RUNNER, { force: true }); } catch { /* 句柄占用时留待下次清理 */ }
  } // 代码块结束
} // 代码块结束
