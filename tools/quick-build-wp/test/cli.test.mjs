/**
 * tools/quick-build-wp/test/cli.test.mjs
 *
 * Quick Build WP 测试（node:test，零新增依赖，不联网）：
 *   1. --plan 输出结构完整；
 *   2. --emit 产物含全部步骤且通过 --verify 静态自检；
 *   3. dry-run 路径不产生写操作（写操作全部走封装）；
 *   4. 重复 emit 幂等：同输入同输出（字节级一致）；
 *   5. --verify 能识别危险脚本与缺能力脚本。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { buildPlan } from '../lib/plan.mjs';
import { renderScript } from '../lib/render.mjs';
import { verifyScript } from '../lib/verify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli.mjs');

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'qbwp-'));
}

test('plan 输出结构完整：工具标识 / 选项 / 步骤字段齐全', () => {
  const plan = buildPlan({ domain: 'demo.com', phpVersion: '8.1', ssl: true });
  assert.equal(plan.tool, 'quick-build-wp');
  assert.equal(plan.options.domain, 'demo.com');
  assert.equal(plan.options.phpVersion, '8.1');
  assert.equal(plan.options.ssl, true);
  assert.ok(Array.isArray(plan.steps));
  assert.ok(plan.steps.length >= 7);
  for (const step of plan.steps) {
    assert.ok(step.id, 'step.id 存在');
    assert.ok(step.title, 'step.title 存在');
    assert.equal(typeof step.idempotent, 'boolean');
    assert.equal(typeof step.optional, 'boolean');
    assert.ok(Array.isArray(step.commands));
  }
  // 必备步骤：环境自检 / Nginx / MySQL / PHP / 建库 / 下载 WP / 伪静态 / 可选 SSL
  const ids = plan.steps.map((s) => s.id);
  for (const need of ['env-check', 'install-nginx', 'install-mysql', 'install-php', 'create-db', 'download-wp', 'nginx-site', 'ssl']) {
    assert.ok(ids.includes(need), `缺少步骤 ${need}`);
  }
});

test('CLI --plan 输出合法 JSON 且与库模型一致', () => {
  const r = spawnSync(process.execPath, [CLI, '--plan', '--domain', 'cli-test.com'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.tool, 'quick-build-wp');
  assert.equal(plan.options.domain, 'cli-test.com');
  assert.ok(plan.steps.length >= 7);
});

test('emit 产物含全部步骤关键词且通过 --verify 自检', () => {
  const dir = tempDir();
  const out = join(dir, 'install.sh');
  const script = renderScript({ domain: 'demo.com' });
  writeFileSync(out, script, 'utf8');

  const matrix = verifyScript(script);
  assert.equal(matrix.ok, true, JSON.stringify(matrix.checks.filter((c) => !c.pass), null, 2));

  for (const kw of ['nginx', 'mysql', 'php', 'curl', 'wp-load.php', 'try_files', 'certbot']) {
    assert.ok(script.toLowerCase().includes(kw.toLowerCase()), `脚本缺少关键词 ${kw}`);
  }
  // 步骤 id 注释落盘
  for (const step of buildPlan().steps) {
    assert.ok(script.includes(step.title) || script.includes(step.id), `脚本未覆盖步骤 ${step.id}`);
  }
});

test('dry-run 不产生写操作：写操作全部走 _run / _write_conf 封装', () => {
  const script = renderScript({});
  const matrix = verifyScript(script);
  assert.equal(matrix.dryRunRouting.unrouted.length, 0);
  assert.ok(matrix.dryRunRouting.mutations > 0, '应统计到写操作');
  assert.equal(matrix.dryRunRouting.routed, matrix.dryRunRouting.mutations);
  // 脚本必须自带 --dry-run 解析与打印分支
  assert.match(script, /DRY_RUN=0/);
  assert.match(script, /--dry-run/);
  assert.match(script, /\[dry-run\]/);
});

test('重复 emit 幂等：同输入两次生成字节级一致', () => {
  const a = renderScript({ domain: 'same.com', phpVersion: '8.2' });
  const b = renderScript({ domain: 'same.com', phpVersion: '8.2' });
  assert.equal(a, b);

  const dir = tempDir();
  const r1 = spawnSync(process.execPath, [CLI, '--emit', join(dir, 'a.sh'), '--domain', 'same.com'], { encoding: 'utf8' });
  const r2 = spawnSync(process.execPath, [CLI, '--emit', join(dir, 'b.sh'), '--domain', 'same.com'], { encoding: 'utf8' });
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(readFileSync(join(dir, 'a.sh'), 'utf8'), readFileSync(join(dir, 'b.sh'), 'utf8'));
});

test('--verify 拒绝含危险命令的脚本', () => {
  const bad = '#!/usr/bin/env bash\nrm -rf /\n';
  const matrix = verifyScript(bad);
  assert.equal(matrix.ok, false);
  assert.ok(matrix.checks.some((c) => c.id === 'danger-rm-root' && !c.pass));
});

test('--verify 拒绝缺少 Nginx / WordPress 能力的脚本', () => {
  const thin = '#!/usr/bin/env bash\nDOMAIN="${DOMAIN:-x}"\n';
  const matrix = verifyScript(thin);
  assert.equal(matrix.ok, false);
  assert.ok(matrix.checks.some((c) => c.id === 'cap-nginx' && !c.pass));
  assert.ok(matrix.checks.some((c) => c.id === 'cap-wordpress' && !c.pass));
});
