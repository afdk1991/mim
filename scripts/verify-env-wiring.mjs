#!/usr/bin/env node
/**
 * scripts/verify-env-wiring.mjs
 *
 * 「配置即启用」接线一致性校验（零依赖，纯静态）。核对三处白名单是否同口径：
 *
 *  1. .github/workflows/deploy.yml
 *     - env: 段声明的 MIM_ 变量（secret 与 vars 两种来源都算已声明）；
 *     - 步骤 run 脚本里 `for v in ...; do` 透传循环列出的变量名。
 *  2. deploy/deploy.sh
 *     - 既有 SMS / SES / ADMIN_TOKEN 段与 ADAPTER_VARS 幂等写入段；
 *     - 脚本顶部 `${MIM_X:-默认值}` 兜底的端口 / 同机开关变量。
 *  3. docs/wiki/09-third-party-sdk-inventory.md + .env.example
 *     - 透传变量必须已登记（精确名或前缀通配命中），避免「配了 secret 却没登记」漂移。
 *
 * 退出码：0 三处一致；1 存在不一致。
 *
 * 说明：本脚本只做文本静态核对，不访问 GitHub、不读取真实 secret 值。
 */

import { existsSync, readFileSync } from 'node:fs'; // 引入依赖、类型或本地模块绑定
import { join, dirname } from 'node:path'; // 引入依赖、类型或本地模块绑定
import { fileURLToPath } from 'node:url'; // 引入依赖、类型或本地模块绑定

const __dirname = dirname(fileURLToPath(import.meta.url)); // 常量 __dirname：保存固定配置或一次性派生值
const ROOT = join(__dirname, '..'); // 常量 ROOT：保存固定配置或一次性派生值

const deployYml = join(ROOT, '.github', 'workflows', 'deploy.yml'); // 常量 deployYml：保存固定配置或一次性派生值
const deploySh = join(ROOT, 'deploy', 'deploy.sh'); // 常量 deploySh：保存固定配置或一次性派生值
const envExample = join(ROOT, '.env.example'); // 常量 envExample：保存固定配置或一次性派生值
const inventory = join(ROOT, 'docs', 'wiki', '09-third-party-sdk-inventory.md'); // 常量 inventory：保存固定配置或一次性派生值

function read(p) { // 函数 read：封装一段可复用的处理逻辑
  return existsSync(p) ? readFileSync(p, 'utf-8') : ''; // 返回当前函数的处理结果
} // 代码块结束

// --- 1. 解析 deploy.yml ---
const yml = read(deployYml);

// env: 段中 `NAME: ${{ secrets.NAME }}` 或 `NAME: ${{ vars.NAME || '默认值' }}`
// 两者都是「已声明」：敏感值走 secret，端口 / 开关这类非机密配置走仓库变量。
const envDeclared = new Set();
for (const m of yml.matchAll(/^\s*(MIM_[A-Z0-9_]*):\s*\$\{\{\s*(?:secrets|vars)\.[A-Za-z_][A-Za-z0-9_]*/gm)) { // 循环：逐项遍历集合并执行相同处理
  envDeclared.add(m[1]); // 执行当前业务步骤
} // 代码块结束

// 透传循环：`for v in ...; do`（反斜杠续行拼接）
const loopBlock = yml.match(/for v in ([\s\S]*?); do/);
const loopNames = new Set(); // 常量 loopNames：保存固定配置或一次性派生值
if (loopBlock) { // 条件分支：按判断结果选择后续处理路径
  for (const name of loopBlock[1].split(/\s+/)) { // 循环：逐项遍历集合并执行相同处理
    if (/^MIM_[A-Z0-9_]+$/.test(name)) loopNames.add(name); // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束
} // 代码块结束

// --- 2. 解析 deploy.sh ---
const sh = read(deploySh);
const shNames = new Set(); // 常量 shNames：保存固定配置或一次性派生值
// 既有 SMS/SES 循环
const smsLoop = sh.match(/for VAR in ([\s\S]*?); do/);
if (smsLoop) { // 条件分支：按判断结果选择后续处理路径
  for (const name of smsLoop[1].split(/\s+/)) { // 循环：逐项遍历集合并执行相同处理
    if (/^MIM_[A-Z0-9_]+$/.test(name)) shNames.add(name); // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束
} // 代码块结束
// 既有单独透传段
for (const name of ['MIM_ADMIN_TOKEN']) {
  if (sh.includes(`${name}:-`) || sh.includes(`$${name}`)) shNames.add(name); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束
// 纯部署机本地变量：只决定「写哪个文件」，不属于应用运行配置，不参与透传核对
const DEPLOY_LOCAL_VARS = new Set(['MIM_ENV_FILE']);
// 脚本顶部端口 / 同机开关：`MIM_X="${MIM_X:-默认值}"` 直接兜底，无需进入循环
for (const m of sh.matchAll(/^\s*(MIM_[A-Z0-9_]+)="\$\{\1:-/gm)) { // 循环：逐项遍历集合并执行相同处理
  if (!DEPLOY_LOCAL_VARS.has(m[1])) shNames.add(m[1]); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束
// 新增 ADAPTER_VARS 块
const adapterBlock = sh.match(/ADAPTER_VARS="([\s\S]*?)"/);
if (adapterBlock) { // 条件分支：按判断结果选择后续处理路径
  for (const name of adapterBlock[1].split(/\s+/)) { // 循环：逐项遍历集合并执行相同处理
    if (/^MIM_[A-Z0-9_]+$/.test(name)) shNames.add(name); // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束
} // 代码块结束

// --- 3. 解析登记口径（与 env-check 同源：精确 + 前缀通配）---
const tplNames = new Set();
for (const line of read(envExample).split(/\r?\n/)) { // 循环：逐项遍历集合并执行相同处理
  const m = line.match(/^([A-Z][A-Z0-9_]*)[ \t]*=/); // 常量 m：保存固定配置或一次性派生值
  if (m) tplNames.add(m[1]); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束
const invText = read(inventory); // 常量 invText：保存固定配置或一次性派生值
const invExact = new Set(); // 常量 invExact：保存固定配置或一次性派生值
for (const m of invText.matchAll(/`(MIM_[A-Z0-9_]+)`/g)) invExact.add(m[1]); // 循环：逐项遍历集合并执行相同处理
const invStems = []; // 常量 invStems：保存固定配置或一次性派生值
for (const m of invText.matchAll(/`(MIM_[A-Z0-9_]+)\*`/g)) invStems.push(m[1]); // 循环：逐项遍历集合并执行相同处理

function registered(name) { // 函数 registered：封装一段可复用的处理逻辑
  if (tplNames.has(name) || invExact.has(name)) return true; // 条件分支：按判断结果选择后续处理路径
  return invStems.some((stem) => name.startsWith(stem)); // 返回当前函数的处理结果
} // 代码块结束

// --- 比对 ---
const failures = [];

const ymlOnly = [...envDeclared].filter((n) => !loopNames.has(n)); // 常量 ymlOnly：保存固定配置或一次性派生值
const loopOnly = [...loopNames].filter((n) => !envDeclared.has(n)); // 常量 loopOnly：保存固定配置或一次性派生值
for (const n of ymlOnly) failures.push(`deploy.yml env 段声明了 ${n}，但不在 ENV_ARGS 透传循环里`); // 循环：逐项遍历集合并执行相同处理
for (const n of loopOnly) failures.push(`deploy.yml ENV_ARGS 循环列出 ${n}，但 env 段未声明 secret`); // 循环：逐项遍历集合并执行相同处理

const loopNotInSh = [...loopNames].filter((n) => !shNames.has(n)); // 常量 loopNotInSh：保存固定配置或一次性派生值
const shNotInLoop = [...shNames].filter((n) => !loopNames.has(n)); // 常量 shNotInLoop：保存固定配置或一次性派生值
for (const n of loopNotInSh) failures.push(`deploy.yml 透传 ${n}，但 deploy.sh 写入段没有同名变量`); // 循环：逐项遍历集合并执行相同处理
for (const n of shNotInLoop) failures.push(`deploy.sh 写入段有 ${n}，但 deploy.yml 透传循环未列出`); // 循环：逐项遍历集合并执行相同处理

const unregistered = [...loopNames].filter((n) => !registered(n)); // 常量 unregistered：保存固定配置或一次性派生值
for (const n of unregistered) failures.push(`透传变量 ${n} 未在 .env.example / 09 清单登记`); // 循环：逐项遍历集合并执行相同处理

// --- 输出 ---
console.log('=== 环境变量接线一致性校验（verify-env-wiring）===');
console.log(`deploy.yml env 声明: ${envDeclared.size}；ENV_ARGS 循环: ${loopNames.size}；deploy.sh 写入: ${shNames.size}`); // 向控制台输出运行日志或错误信息
if (failures.length === 0) { // 条件分支：按判断结果选择后续处理路径
  console.log('✅ 三处白名单口径一致，透传变量均已登记'); // 向控制台输出运行日志或错误信息
  process.exit(0); // 执行当前业务步骤
} // 代码块结束
console.error(`❌ 发现 ${failures.length} 处不一致：`); // 向控制台输出运行日志或错误信息
for (const f of failures) console.error(`  - ${f}`); // 循环：逐项遍历集合并执行相同处理
process.exit(1); // 执行当前业务步骤
