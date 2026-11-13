#!/usr/bin/env node
/**
 * tools/test-all.mjs
 *
 * 一次跑完 tools/ 下三套自研工具的 node:test 测试，末尾打印 PASS/FAIL 汇总；
 * 任意一套失败，进程退出码非 0。
 *
 * 用法:
 *   node tools/test-all.mjs
 *
 * 退出码: 0 全部通过 | 1 存在失败套件
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  { name: 'quick-build-wp', file: join(__dirname, 'quick-build-wp', 'test', 'cli.test.mjs') },
  { name: 'db-replace-domain', file: join(__dirname, 'db-replace-domain', 'test', 'cli.test.mjs') },
  { name: 'liudun-waf', file: join(__dirname, 'liudun-waf', 'test', 'waf.test.mjs') },
];

let failed = 0;
const summary = [];

for (const suite of SUITES) {
  process.stdout.write(`\n=== ${suite.name} ===\n`);
  const result = spawnSync(process.execPath, ['--test', suite.file], { stdio: 'inherit' });
  const ok = result.status === 0;
  if (!ok) failed += 1;
  summary.push({ name: suite.name, ok });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${suite.name}\n`);
}

process.stdout.write('\n=== 汇总 ===\n');
for (const s of summary) {
  process.stdout.write(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}\n`);
}
process.stdout.write(`\n${SUITES.length - failed}/${SUITES.length} PASS\n`);
process.exit(failed > 0 ? 1 : 0);
