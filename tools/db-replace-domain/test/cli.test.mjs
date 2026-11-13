/**
 * tools/db-replace-domain/test/cli.test.mjs
 *
 * 数据库批量替换 / 换域名测试（node:test，零新增依赖，不联网）：
 *   1. 普通 URL 与 http/https、www/非 www 变体替换；
 *   2. PHP 序列化字符串长度按字节重算（域名变长不破坏反序列化）；
 *   3. apply 前生成 .bak 备份；
 *   4. dry-run 不改文件；
 *   5. apply 后二次 apply 幂等（无新增改动）；
 *   6. SQLite 库模式：dry-run 只读、apply 写回、二次 apply 幂等。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';

import { replaceText, countReplacements } from '../lib/replace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli.mjs');

const FROM = 'old.com';
const TO = 'brand-new-site.com'; // 比旧域名长，强制触发序列化长度重算

const SAMPLE = [
  "INSERT INTO wp_options VALUES ('siteurl', 'https://old.com');",
  "INSERT INTO wp_options VALUES ('home', 'http://www.old.com/blog');",
  "INSERT INTO wp_posts VALUES (1, 'See http://old.com/page and https://www.old.com/x');",
  "INSERT INTO wp_postmeta VALUES (2, 's:18:\"http://old.com/abc\";');",
  "INSERT INTO wp_postmeta VALUES (3, 'a:2:{i:0;s:14:\"https://old.com\";i:1;s:22:\"http://www.old.com/y\";}');",
].join('\n');

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dbrd-'));
}

function runCli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

/** 校验文本里所有 s:<len>:"..." 的长度与内容字节数一致。 */
function assertSerializedLengths(text, label) {
  const re = /s:(\d+):"((?:[^"\\]|\\.)*)";/g;
  let m;
  while ((m = re.exec(text))) {
    const len = Number(m[1]);
    const real = Buffer.byteLength(m[2], 'utf8');
    assert.equal(len, real, `${label} 序列化长度不一致：声明 ${len} 实际 ${real}，内容 ${m[2]}`);
  }
}

test('普通 URL：http/https 与 www/非 www 变体全部替换', () => {
  const out = replaceText(SAMPLE, FROM, TO);
  assert.ok(out.includes(`https://${TO}`));
  assert.ok(out.includes(`http://www.${TO}/blog`));
  assert.ok(out.includes(`http://${TO}/page`));
  assert.ok(out.includes(`https://www.${TO}/x`));
  assert.ok(!out.includes('old.com'), '不应残留旧域名');
});

test('序列化字符串：域名变长后按字节重算长度', () => {
  const out = replaceText(SAMPLE, FROM, TO);
  // http://old.com/abc 长度 18 → http://brand-new-site.com/abc 长度 29
  assert.ok(out.includes(`s:29:"http://${TO}/abc";`), out);
  // https://old.com 长度 15 → https://brand-new-site.com 长度 26
  assert.ok(out.includes(`s:26:"https://${TO}";`), out);
  assertSerializedLengths(out, '替换后');
});

test('countReplacements 统计命中且不重叠', () => {
  const n = countReplacements(SAMPLE, FROM, TO);
  assert.ok(n >= 5, `应至少命中 5 处，实际 ${n}`);
});

test('dry-run 不改文件，只输出预览摘要', () => {
  const dir = tempDir();
  const sql = join(dir, 'dump.sql');
  writeFileSync(sql, SAMPLE, 'utf8');
  const before = readFileSync(sql, 'utf8');

  const r = runCli(['--input', sql, '--from', FROM, '--to', TO, '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.dryRun, true);
  assert.ok(r.json.replacements >= 5);
  assert.equal(readFileSync(sql, 'utf8'), before, 'dry-run 不得改写文件');
  assert.equal(existsSync(`${sql}.bak`), false, 'dry-run 不得生成备份');
});

test('apply 生成 .bak 备份，替换落盘且序列化长度正确', () => {
  const dir = tempDir();
  const sql = join(dir, 'dump.sql');
  writeFileSync(sql, SAMPLE, 'utf8');

  const r = runCli(['--input', sql, '--from', FROM, '--to', TO, '--apply']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.dryRun, false);
  assert.ok(r.json.backup.created, '应创建 .bak');
  assert.equal(readFileSync(`${sql}.bak`, 'utf8'), SAMPLE, '备份必须是原始内容');

  const after = readFileSync(sql, 'utf8');
  assert.ok(after.includes(`https://${TO}`));
  assertSerializedLengths(after, 'apply 后');
});

test('二次 apply 幂等：无新增改动，文件内容稳定', () => {
  const dir = tempDir();
  const sql = join(dir, 'dump.sql');
  writeFileSync(sql, SAMPLE, 'utf8');

  const first = runCli(['--input', sql, '--from', FROM, '--to', TO, '--apply']);
  assert.equal(first.status, 0, first.stderr);
  const afterFirst = readFileSync(sql, 'utf8');

  const second = runCli(['--input', sql, '--from', FROM, '--to', TO, '--apply']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.replacements, 0, '二次 apply 不应再有命中');
  assert.equal(readFileSync(sql, 'utf8'), afterFirst, '二次 apply 后文件不得变化');
});

test('SQLite 模式：dry-run 只读，apply 写回，二次 apply 幂等', () => {
  const dir = tempDir();
  const dbPath = join(dir, 'site.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT)');
  db.prepare('INSERT INTO posts (body) VALUES (?)').run('https://old.com/post s:14:"https://old.com";');
  db.prepare('INSERT INTO posts (body) VALUES (?)').run('http://www.old.com/y');
  db.close();

  // dry-run：库内容不变
  const dry = runCli(['--input', dbPath, '--from', FROM, '--to', TO, '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.json.mode, 'sqlite');
  assert.ok(dry.json.changedCells >= 2);
  const check1 = new DatabaseSync(dbPath, { readOnly: true });
  const row1 = check1.prepare('SELECT body FROM posts WHERE id=1').get();
  check1.close();
  assert.ok(row1.body.includes('old.com'), 'dry-run 后库内容不得变化');

  // apply：写回
  const apply = runCli(['--input', dbPath, '--from', FROM, '--to', TO, '--apply']);
  assert.equal(apply.status, 0, apply.stderr);
  assert.ok(apply.json.backup.created);
  const check2 = new DatabaseSync(dbPath, { readOnly: true });
  const row2 = check2.prepare('SELECT body FROM posts WHERE id=1').get();
  check2.close();
  assert.ok(row2.body.includes(TO));
  assert.ok(!row2.body.includes('old.com'));

  // 二次 apply 幂等
  const second = runCli(['--input', dbPath, '--from', FROM, '--to', TO, '--apply']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.changedCells, 0);
});

test('参数校验：缺少模式开关 / 缺必填参数退出码 2', () => {
  const dir = tempDir();
  const sql = join(dir, 'dump.sql');
  writeFileSync(sql, SAMPLE, 'utf8');
  const noMode = runCli(['--input', sql, '--from', FROM, '--to', TO]);
  assert.equal(noMode.status, 2);
  const missing = runCli(['--input', sql, '--to', TO, '--apply']);
  assert.equal(missing.status, 2);
});
