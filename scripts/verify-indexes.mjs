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

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // 仓库根目录
const API_DIR = join(ROOT, 'services', 'mim-api'); // 后端包目录
const RUNNER = join(API_DIR, '.verify-indexes.runner.ts'); // 临时 TS 运行器（执行后删除，不提交）

const args = process.argv.slice(2);
const asJson = args.includes('--json');

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

function failSelf(message) {
  console.error(`[verify-indexes] ${message}`);
  process.exit(2);
}

let runnerWritten = false;
try {
  mkdirSync(API_DIR, { recursive: true });
  writeFileSync(RUNNER, RUNNER_SOURCE, 'utf8');
  runnerWritten = true;

  // 优先直调本地 tsx CLI（node 进程），避免运行环境 PATH 缺少 pnpm；找不到再回退 pnpm exec。
  const tsxCli = join(API_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const usePnpm = !existsSync(tsxCli);
  const cmd = usePnpm ? 'pnpm' : process.execPath;
  const args = usePnpm ? ['--filter', '@mim/api', 'exec', 'tsx', RUNNER] : [tsxCli, RUNNER];
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: usePnpm, // 仅回退 pnpm 时经 shell 解析路径
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    failSelf(`巡检运行器退出码 ${result.status}`);
  }

  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
  const missing = Array.isArray(payload.missing) ? payload.missing : [];
  const slow = Array.isArray(payload.slowCandidates) ? payload.slowCandidates : [];

  console.log('[verify-indexes] 索引巡检结果');
  console.log(`  缺失索引建议：${missing.length} 条`);
  for (const item of missing) {
    console.log(`    - ${item.table}(${item.columns})：${item.reason}`);
  }
  console.log(`  慢查询候选（建议项，不阻断）：${slow.length} 条`);
  for (const item of slow) {
    console.log(`    - ${item.table}：${item.pattern}`);
  }

  if (asJson) console.log(JSON.stringify(payload, null, 2));

  if (missing.length > 0) {
    console.error(`[verify-indexes] 存在 ${missing.length} 条缺失索引建议，门禁未通过`);
    process.exit(1);
  }
  console.log('[verify-indexes] 门禁通过：无缺失索引建议');
  process.exit(0);
} catch (err) {
  failSelf(err instanceof Error ? err.message : String(err));
} finally {
  // Windows 下子进程句柄释放可能延迟；删除失败静默跳过，该文件为未跟踪临时产物，不提交。
  if (runnerWritten) {
    try { rmSync(RUNNER, { force: true }); } catch { /* 句柄占用时留待下次清理 */ }
  }
}
