#!/usr/bin/env node
/**
 * Mim API 关键端点性能基准（安全加固与性能包，2026-11-13）。
 *
 * 零第三方依赖：仅用 node:fetch + node:timers。
 * 对本机 API 的公开 GET 端点发压测请求，输出 p50 / p95 / p99 延迟，
 * 按 p95 ≤ 目标门槛（缺省 100ms）判定；任一端点超门槛以非零码退出。
 *
 * 用法：
 *   node scripts/perf-bench.mjs --help
 *   node scripts/perf-bench.mjs                       # 压测 http://127.0.0.1:8787
 *   node scripts/perf-bench.mjs --base http://127.0.0.1:8787 --target-ms 100 --requests 60 --concurrency 5
 *
 * 环境变量：
 *   MIM_API_BASE          API 基址，缺省 http://127.0.0.1:8787
 *   MIM_PERF_TARGET_MS   p95 门槛（毫秒），缺省 100
 *
 * 退出码：0 全部达标；1 存在端点 p95 超门槛；2 目标 API 不可达（未完成压测）。
 * 结果同时写入 docs/perf-bench-20261113.md（可被安全加固文档引用）。
 */

import { writeFileSync, mkdirSync } from 'node:fs'; // 引入依赖、类型或本地模块绑定
import { dirname, join, resolve } from 'node:path'; // 引入依赖、类型或本地模块绑定
import { fileURLToPath } from 'node:url'; // 引入依赖、类型或本地模块绑定

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // 仓库根目录

// ---------- 参数解析 ----------

function parseArgs(argv) { // 函数 parseArgs：封装一段可复用的处理逻辑
  const opts = { // 常量 opts：保存固定配置或一次性派生值
    base: process.env.MIM_API_BASE ?? 'http://127.0.0.1:8787', // 对象字段 base：记录一项配置或数据
    targetMs: Number(process.env.MIM_PERF_TARGET_MS ?? 100), // 对象字段 targetMs：记录一项配置或数据
    requests: 60, // 对象字段 requests：记录一项配置或数据
    concurrency: 5, // 对象字段 concurrency：记录一项配置或数据
    warmup: 5, // 对象字段 warmup：记录一项配置或数据
    help: false, // 对象字段 help：记录一项配置或数据
  }; // 代码块结束
  for (let i = 0; i < argv.length; i += 1) { // 循环：逐项遍历集合并执行相同处理
    const arg = argv[i]; // 常量 arg：保存固定配置或一次性派生值
    if (arg === '--help' || arg === '-h') opts.help = true; // 条件分支：按判断结果选择后续处理路径
    else if (arg === '--base') opts.base = argv[++i]; // 备选条件分支：上一条件不满足时再做判断
    else if (arg === '--target-ms') opts.targetMs = Number(argv[++i]); // 备选条件分支：上一条件不满足时再做判断
    else if (arg === '--requests') opts.requests = Number(argv[++i]); // 备选条件分支：上一条件不满足时再做判断
    else if (arg === '--concurrency') opts.concurrency = Number(argv[++i]); // 备选条件分支：上一条件不满足时再做判断
    else if (arg === '--warmup') opts.warmup = Number(argv[++i]); // 备选条件分支：上一条件不满足时再做判断
  } // 代码块结束
  return opts; // 返回当前函数的处理结果
} // 代码块结束

const HELP = `Mim API 性能基准

选项：
  --base <url>          API 基址（默认 $MIM_API_BASE 或 http://127.0.0.1:8787）
  --target-ms <n>       p95 延迟门槛毫秒数（默认 $MIM_PERF_TARGET_MS 或 100）
  --requests <n>        每个端点采样请求数（默认 60）
  --concurrency <n>     并发度（默认 5）
  --warmup <n>          每个端点预热请求数（默认 5，不计入统计）
  --help                打印本帮助

退出码：0 达标 / 1 超门槛 / 2 API 不可达
`;

// 公开只读端点清单：鉴权端点不在基准范围内（需登录态，另作专项压测）
const ENDPOINTS = [
  { name: 'health', path: '/health' }, // 执行当前业务步骤
  { name: 'navigation-summary', path: '/api/v1/navigation/summary' }, // 执行当前业务步骤
  { name: 'navigation-links', path: '/api/v1/navigation/links' }, // 执行当前业务步骤
]; // 执行当前业务步骤

function percentile(samples, p) { // 函数 percentile：封装一段可复用的处理逻辑
  if (samples.length === 0) return 0; // 条件分支：按判断结果选择后续处理路径
  const sorted = [...samples].sort((a, b) => a - b); // 常量 sorted：保存固定配置或一次性派生值
  const idx = Math.ceil((p / 100) * sorted.length) - 1; // 常量 idx：保存固定配置或一次性派生值
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]; // 返回当前函数的处理结果
} // 代码块结束

async function fetchOnce(base, path) { // 函数 fetchOnce：封装一段可复用的处理逻辑
  const started = process.hrtime.bigint(); // 常量 started：保存固定配置或一次性派生值
  const res = await fetch(`${base}${path}`, { method: 'GET', redirect: 'manual' }); // 常量 res：保存固定配置或一次性派生值
  const ms = Number(process.hrtime.bigint() - started) / 1e6; // 常量 ms：保存固定配置或一次性派生值
  await res.body?.cancel().catch(() => undefined); // 异步等待：挂起至 Promise 落定后再继续
  return { status: res.status, ms }; // 返回当前函数的处理结果
} // 代码块结束

async function benchmarkEndpoint(base, endpoint, opts) { // 函数 benchmarkEndpoint：封装一段可复用的处理逻辑
  // 预热：排除冷启动 / 编译首跳成本
  for (let i = 0; i < opts.warmup; i += 1) {
    await fetchOnce(base, endpoint.path).catch(() => undefined); // 异步等待：挂起至 Promise 落定后再继续
  } // 代码块结束
  const samples = []; // 常量 samples：保存固定配置或一次性派生值
  const statuses = new Map(); // 常量 statuses：保存固定配置或一次性派生值
  let cursor = 0; // 可变变量 cursor：运行过程中会被重新赋值
  async function worker() { // 函数 worker：封装一段可复用的处理逻辑
    while (cursor < opts.requests) { // 循环：条件成立时重复执行循环体
      const index = cursor; // 常量 index：保存固定配置或一次性派生值
      cursor += 1; // 执行当前业务步骤
      try { // 异常捕获起点：包裹可能抛出错误的操作
        const { status, ms } = await fetchOnce(base, endpoint.path); // 执行当前业务步骤
        samples.push(ms); // 执行当前业务步骤
        statuses.set(status, (statuses.get(status) ?? 0) + 1); // 执行当前业务步骤
      } catch (err) { // 代码块结束
        statuses.set(`error:${err?.message ?? 'unknown'}`, (statuses.get(`error:${err?.message ?? 'unknown'}`) ?? 0) + 1); // 执行当前业务步骤
      } // 代码块结束
      void index; // 执行当前业务步骤
    } // 代码块结束
  } // 代码块结束
  await Promise.all(Array.from({ length: opts.concurrency }, () => worker())); // 异步等待：挂起至 Promise 落定后再继续

  return { // 返回当前函数的处理结果
    name: endpoint.name, // 对象字段 name：记录一项配置或数据
    path: endpoint.path, // 对象字段 path：记录一项配置或数据
    samples: samples.length, // 对象字段 samples：记录一项配置或数据
    p50: percentile(samples, 50), // 对象字段 p50：记录一项配置或数据
    p95: percentile(samples, 95), // 对象字段 p95：记录一项配置或数据
    p99: percentile(samples, 99), // 对象字段 p99：记录一项配置或数据
    statuses: Object.fromEntries(statuses), // 对象字段 statuses：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

function formatMs(n) { // 函数 formatMs：封装一段可复用的处理逻辑
  return `${n.toFixed(1)}ms`; // 返回当前函数的处理结果
} // 代码块结束

function renderMarkdown(results, opts, unreachable) { // 函数 renderMarkdown：封装一段可复用的处理逻辑
  const date = '2026-11-13'; // 常量 date：保存固定配置或一次性派生值
  const lines = []; // 常量 lines：保存固定配置或一次性派生值
  lines.push(`# API 性能基准结果（${date}）`); // 执行当前业务步骤
  lines.push(''); // 执行当前业务步骤
  lines.push(`- 基址：\`${opts.base}\``); // 执行当前业务步骤
  lines.push(`- 门槛：p95 ≤ ${opts.targetMs}ms；采样 ${opts.requests} 次 / 端点，并发 ${opts.concurrency}，预热 ${opts.warmup} 次`); // 执行当前业务步骤
  lines.push(''); // 执行当前业务步骤
  if (unreachable) { // 条件分支：按判断结果选择后续处理路径
    lines.push('> 目标 API 不可达，本次未完成压测；启动本机服务后重跑 `node scripts/perf-bench.mjs`。'); // 执行当前业务步骤
    lines.push(''); // 执行当前业务步骤
    return lines.join('\n'); // 返回当前函数的处理结果
  } // 代码块结束
  lines.push('| 端点 | 路径 | 样本 | p50 | p95 | p99 | 状态 |'); // 执行当前业务步骤
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | --- |'); // 执行当前业务步骤
  for (const r of results) { // 循环：逐项遍历集合并执行相同处理
    const pass = r.p95 <= opts.targetMs; // 常量 pass：保存固定配置或一次性派生值
    lines.push(`| ${r.name} | \`${r.path}\` | ${r.samples} | ${formatMs(r.p50)} | ${formatMs(r.p95)} | ${formatMs(r.p99)} | ${pass ? '✅ 达标' : '❌ 超门槛'} |`); // 执行当前业务步骤
  } // 代码块结束
  lines.push(''); // 执行当前业务步骤
  return lines.join('\n'); // 返回当前函数的处理结果
} // 代码块结束

async function main() { // 函数 main：封装一段可复用的处理逻辑
  const opts = parseArgs(process.argv.slice(2)); // 常量 opts：保存固定配置或一次性派生值
  if (opts.help) { // 条件分支：按判断结果选择后续处理路径
    process.stdout.write(HELP); // 执行当前业务步骤
    return 0; // 返回当前函数的处理结果
  } // 代码块结束

  // 探活：健康检查失败即判定 API 不可达，不伪造基准数据
  let reachable = true;
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const health = await fetchOnce(opts.base, '/health'); // 常量 health：保存固定配置或一次性派生值
    if (health.status >= 500) reachable = false; // 条件分支：按判断结果选择后续处理路径
  } catch { // 代码块结束
    reachable = false; // 赋值：更新变量 reachable 的取值
  } // 代码块结束

  const docsDir = join(ROOT, 'docs'); // 常量 docsDir：保存固定配置或一次性派生值
  mkdirSync(docsDir, { recursive: true }); // 调用 mkdirSync 并处理其返回结果
  const reportPath = join(docsDir, 'perf-bench-20261113.md'); // 常量 reportPath：保存固定配置或一次性派生值

  if (!reachable) { // 条件分支：按判断结果选择后续处理路径
    writeFileSync(reportPath, renderMarkdown([], opts, true), 'utf8'); // 调用 writeFileSync 并处理其返回结果
    console.warn(`[perf-bench] 目标 API 不可达：${opts.base}（报告已写 ${reportPath}）`); // 向控制台输出运行日志或错误信息
    return 2; // 返回当前函数的处理结果
  } // 代码块结束

  const results = []; // 常量 results：保存固定配置或一次性派生值
  for (const endpoint of ENDPOINTS) { // 循环：逐项遍历集合并执行相同处理
    // 逐端点压测，避免互相挤占并发槽位影响 p95 口径
    // eslint-disable-next-line no-await-in-loop
    const result = await benchmarkEndpoint(opts.base, endpoint, opts);
    results.push(result); // 执行当前业务步骤
  } // 代码块结束

  const breached = results.filter((r) => r.p95 > opts.targetMs); // 常量 breached：保存固定配置或一次性派生值
  for (const r of results) { // 循环：逐项遍历集合并执行相同处理
    const pass = r.p95 <= opts.targetMs; // 常量 pass：保存固定配置或一次性派生值
    console.log(`${pass ? '✅' : '❌'} ${r.name.padEnd(20)} p50=${formatMs(r.p50).padStart(9)} p95=${formatMs(r.p95).padStart(9)} p99=${formatMs(r.p99).padStart(9)} samples=${r.samples}`); // 向控制台输出运行日志或错误信息
  } // 代码块结束

  writeFileSync(reportPath, renderMarkdown(results, opts, false), 'utf8'); // 调用 writeFileSync 并处理其返回结果
  console.log(`\n[perf-bench] 报告已写入 ${reportPath}`); // 向控制台输出运行日志或错误信息
  if (breached.length > 0) { // 条件分支：按判断结果选择后续处理路径
    console.error(`[perf-bench] ${breached.length} 个端点 p95 超过 ${opts.targetMs}ms 门槛`); // 向控制台输出运行日志或错误信息
    return 1; // 返回当前函数的处理结果
  } // 代码块结束
  console.log(`[perf-bench] 全部端点 p95 ≤ ${opts.targetMs}ms 门槛`); // 向控制台输出运行日志或错误信息
  return 0; // 返回当前函数的处理结果
} // 代码块结束

main() // 调用 main 并处理其返回结果
  .then((code) => process.exit(code)) // 执行当前业务步骤
  .catch((err) => { // 执行当前业务步骤
    console.error('[perf-bench] 未处理异常', err); // 向控制台输出运行日志或错误信息
    process.exit(2); // 执行当前业务步骤
  }); // 代码块结束
