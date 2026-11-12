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

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // 仓库根目录

// ---------- 参数解析 ----------

function parseArgs(argv) {
  const opts = {
    base: process.env.MIM_API_BASE ?? 'http://127.0.0.1:8787',
    targetMs: Number(process.env.MIM_PERF_TARGET_MS ?? 100),
    requests: 60,
    concurrency: 5,
    warmup: 5,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--base') opts.base = argv[++i];
    else if (arg === '--target-ms') opts.targetMs = Number(argv[++i]);
    else if (arg === '--requests') opts.requests = Number(argv[++i]);
    else if (arg === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (arg === '--warmup') opts.warmup = Number(argv[++i]);
  }
  return opts;
}

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
  { name: 'health', path: '/health' },
  { name: 'navigation-summary', path: '/api/v1/navigation/summary' },
  { name: 'navigation-links', path: '/api/v1/navigation/links' },
];

function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function fetchOnce(base, path) {
  const started = process.hrtime.bigint();
  const res = await fetch(`${base}${path}`, { method: 'GET', redirect: 'manual' });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  await res.body?.cancel().catch(() => undefined);
  return { status: res.status, ms };
}

async function benchmarkEndpoint(base, endpoint, opts) {
  // 预热：排除冷启动 / 编译首跳成本
  for (let i = 0; i < opts.warmup; i += 1) {
    await fetchOnce(base, endpoint.path).catch(() => undefined);
  }
  const samples = [];
  const statuses = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < opts.requests) {
      const index = cursor;
      cursor += 1;
      try {
        const { status, ms } = await fetchOnce(base, endpoint.path);
        samples.push(ms);
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      } catch (err) {
        statuses.set(`error:${err?.message ?? 'unknown'}`, (statuses.get(`error:${err?.message ?? 'unknown'}`) ?? 0) + 1);
      }
      void index;
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));

  return {
    name: endpoint.name,
    path: endpoint.path,
    samples: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    statuses: Object.fromEntries(statuses),
  };
}

function formatMs(n) {
  return `${n.toFixed(1)}ms`;
}

function renderMarkdown(results, opts, unreachable) {
  const date = '2026-11-13';
  const lines = [];
  lines.push(`# API 性能基准结果（${date}）`);
  lines.push('');
  lines.push(`- 基址：\`${opts.base}\``);
  lines.push(`- 门槛：p95 ≤ ${opts.targetMs}ms；采样 ${opts.requests} 次 / 端点，并发 ${opts.concurrency}，预热 ${opts.warmup} 次`);
  lines.push('');
  if (unreachable) {
    lines.push('> 目标 API 不可达，本次未完成压测；启动本机服务后重跑 `node scripts/perf-bench.mjs`。');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| 端点 | 路径 | 样本 | p50 | p95 | p99 | 状态 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const r of results) {
    const pass = r.p95 <= opts.targetMs;
    lines.push(`| ${r.name} | \`${r.path}\` | ${r.samples} | ${formatMs(r.p50)} | ${formatMs(r.p95)} | ${formatMs(r.p99)} | ${pass ? '✅ 达标' : '❌ 超门槛'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  // 探活：健康检查失败即判定 API 不可达，不伪造基准数据
  let reachable = true;
  try {
    const health = await fetchOnce(opts.base, '/health');
    if (health.status >= 500) reachable = false;
  } catch {
    reachable = false;
  }

  const docsDir = join(ROOT, 'docs');
  mkdirSync(docsDir, { recursive: true });
  const reportPath = join(docsDir, 'perf-bench-20261113.md');

  if (!reachable) {
    writeFileSync(reportPath, renderMarkdown([], opts, true), 'utf8');
    console.warn(`[perf-bench] 目标 API 不可达：${opts.base}（报告已写 ${reportPath}）`);
    return 2;
  }

  const results = [];
  for (const endpoint of ENDPOINTS) {
    // 逐端点压测，避免互相挤占并发槽位影响 p95 口径
    // eslint-disable-next-line no-await-in-loop
    const result = await benchmarkEndpoint(opts.base, endpoint, opts);
    results.push(result);
  }

  const breached = results.filter((r) => r.p95 > opts.targetMs);
  for (const r of results) {
    const pass = r.p95 <= opts.targetMs;
    console.log(`${pass ? '✅' : '❌'} ${r.name.padEnd(20)} p50=${formatMs(r.p50).padStart(9)} p95=${formatMs(r.p95).padStart(9)} p99=${formatMs(r.p99).padStart(9)} samples=${r.samples}`);
  }

  writeFileSync(reportPath, renderMarkdown(results, opts, false), 'utf8');
  console.log(`\n[perf-bench] 报告已写入 ${reportPath}`);
  if (breached.length > 0) {
    console.error(`[perf-bench] ${breached.length} 个端点 p95 超过 ${opts.targetMs}ms 门槛`);
    return 1;
  }
  console.log(`[perf-bench] 全部端点 p95 ≤ ${opts.targetMs}ms 门槛`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[perf-bench] 未处理异常', err);
    process.exit(2);
  });
