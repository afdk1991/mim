#!/usr/bin/env node
/**
 * scripts/verify-env-wiring.mjs
 *
 * 「配置即启用」接线一致性校验（零依赖，纯静态）。核对三处白名单是否同口径：
 *
 *  1. .github/workflows/deploy.yml
 *     - deploy job「远程发布」步骤 env: 段声明的 secret 名；
 *     - 同步骤 run 脚本里 `for v in ...; do` 透传循环列出的变量名。
 *  2. deploy/deploy.sh
 *     - 既有 SMS / SES / ADMIN_TOKEN / AUTH_ADMIN_PASSWORD 段；
 *     - 本轮新增 ADAPTER_VARS 幂等写入段。
 *  3. docs/wiki/09-third-party-sdk-inventory.md + .env.example
 *     - 透传变量必须已登记（精确名或前缀通配命中），避免「配了 secret 却没登记」漂移。
 *
 * 退出码：0 三处一致；1 存在不一致。
 *
 * 说明：本脚本只做文本静态核对，不访问 GitHub、不读取真实 secret 值。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const deployYml = join(ROOT, '.github', 'workflows', 'deploy.yml');
const deploySh = join(ROOT, 'deploy', 'deploy.sh');
const envExample = join(ROOT, '.env.example');
const inventory = join(ROOT, 'docs', 'wiki', '09-third-party-sdk-inventory.md');

function read(p) {
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

// --- 1. 解析 deploy.yml ---
const yml = read(deployYml);

// env: 段中 `NAME: ${{ secrets.NAME }}`（只纳入 MIM_ 前缀的业务变量；其它平台 Token 不参与本接线核对）
const envDeclared = new Set();
for (const m of yml.matchAll(/^\s*(MIM_[A-Z0-9_]*):\s*\$\{\{\s*secrets\.[A-Z][A-Z0-9_]*\s*\}\}/gm)) {
  envDeclared.add(m[1]);
}

// 透传循环：`for v in ...; do`（反斜杠续行拼接）
const loopBlock = yml.match(/for v in ([\s\S]*?); do/);
const loopNames = new Set();
if (loopBlock) {
  for (const name of loopBlock[1].split(/\s+/)) {
    if (/^MIM_[A-Z0-9_]+$/.test(name)) loopNames.add(name);
  }
}

// --- 2. 解析 deploy.sh ---
const sh = read(deploySh);
const shNames = new Set();
// 既有 SMS/SES 循环
const smsLoop = sh.match(/for VAR in ([\s\S]*?); do/);
if (smsLoop) {
  for (const name of smsLoop[1].split(/\s+/)) {
    if (/^MIM_[A-Z0-9_]+$/.test(name)) shNames.add(name);
  }
}
// 既有单独透传段
for (const name of ['MIM_ADMIN_TOKEN', 'MIM_AUTH_ADMIN_PASSWORD']) {
  if (sh.includes(`${name}:-`) || sh.includes(`$${name}`)) shNames.add(name);
}
// 新增 ADAPTER_VARS 块
const adapterBlock = sh.match(/ADAPTER_VARS="([\s\S]*?)"/);
if (adapterBlock) {
  for (const name of adapterBlock[1].split(/\s+/)) {
    if (/^MIM_[A-Z0-9_]+$/.test(name)) shNames.add(name);
  }
}

// --- 3. 解析登记口径（与 env-check 同源：精确 + 前缀通配）---
const tplNames = new Set();
for (const line of read(envExample).split(/\r?\n/)) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)[ \t]*=/);
  if (m) tplNames.add(m[1]);
}
const invText = read(inventory);
const invExact = new Set();
for (const m of invText.matchAll(/`(MIM_[A-Z0-9_]+)`/g)) invExact.add(m[1]);
const invStems = [];
for (const m of invText.matchAll(/`(MIM_[A-Z0-9_]+)\*`/g)) invStems.push(m[1]);

function registered(name) {
  if (tplNames.has(name) || invExact.has(name)) return true;
  return invStems.some((stem) => name.startsWith(stem));
}

// --- 比对 ---
const failures = [];

const ymlOnly = [...envDeclared].filter((n) => !loopNames.has(n));
const loopOnly = [...loopNames].filter((n) => !envDeclared.has(n));
for (const n of ymlOnly) failures.push(`deploy.yml env 段声明了 ${n}，但不在 ENV_ARGS 透传循环里`);
for (const n of loopOnly) failures.push(`deploy.yml ENV_ARGS 循环列出 ${n}，但 env 段未声明 secret`);

const loopNotInSh = [...loopNames].filter((n) => !shNames.has(n));
const shNotInLoop = [...shNames].filter((n) => !loopNames.has(n));
for (const n of loopNotInSh) failures.push(`deploy.yml 透传 ${n}，但 deploy.sh 写入段没有同名变量`);
for (const n of shNotInLoop) failures.push(`deploy.sh 写入段有 ${n}，但 deploy.yml 透传循环未列出`);

const unregistered = [...loopNames].filter((n) => !registered(n));
for (const n of unregistered) failures.push(`透传变量 ${n} 未在 .env.example / 09 清单登记`);

// --- 输出 ---
console.log('=== 环境变量接线一致性校验（verify-env-wiring）===');
console.log(`deploy.yml env 声明: ${envDeclared.size}；ENV_ARGS 循环: ${loopNames.size}；deploy.sh 写入: ${shNames.size}`);
if (failures.length === 0) {
  console.log('✅ 三处白名单口径一致，透传变量均已登记');
  process.exit(0);
}
console.error(`❌ 发现 ${failures.length} 处不一致：`);
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
