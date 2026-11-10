#!/usr/bin/env node
// 上一行 shebang：指定 node 解释器，与仓库内其它脚本保持一致。
// scripts/deployment-summary.mjs
//
// 部署汇总生成器：把「所有部署仓库 + 相关部署项」收口为一份可核对的结构化结果。
// 依据：packages/core-domain/src/deploymentRegistry.json（单一事实源）+ 本轮真实采集。
// 真实采集项：git remote / HEAD / git ls-tree HEAD / 工作树文件存在性 / CI 作业与步骤 /
//             AGENTS.md 与 README 矩阵表行数 / 可选 --live 逐平台 curl 探测。
// 输出：docs/deployment-summary.json（结构化）+ docs/deployment-summary.md（表格）+ 终端摘要。
// 约束：零第三方依赖；不修改单一事实源本身；不把历史快照冒充本轮结果。
//
// 用法：node scripts/deployment-summary.mjs            # 基线模式：采集仓库与工件，结果沿用契约取证快照
//       node scripts/deployment-summary.mjs --live     # 追加真实 curl 探测，覆盖各项 result
// 退出码：0 = 生成成功（探测失败属数据，不作为脚本失败）；1 = 契约或仓库读取失败。

// 文件系统：读契约 / 读 CI 与文档 / 判断工作树工件 / 写两份交付物。
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
// 子进程：执行 git 与 curl，取真实输出而非静态推断。
import { spawnSync } from 'node:child_process';
// 系统临时目录：探测响应体写在仓库外，不污染工作树。
import { tmpdir } from 'node:os';
// 路径工具：按脚本自身位置上溯一级定位仓库根，任意 cwd 执行结果一致。
import { dirname, join, resolve } from 'node:path';
// URL 转路径：ESM 下不能用 __dirname，统一用 import.meta.url。
import { fileURLToPath } from 'node:url';

// 仓库根目录：本文件位于 scripts/ 下。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 单一事实源路径：所有统一字段与 deploy item 均从此处读取。
const REGISTRY = join(ROOT, 'packages/core-domain/src/deploymentRegistry.json');
// 结构化结果输出路径。
const OUT_JSON = join(ROOT, 'docs/deployment-summary.json');
// 表格结果输出路径。
const OUT_MD = join(ROOT, 'docs/deployment-summary.md');
// CI 工作流路径：用于采集作业与步骤名。
const CI_FILE = join(ROOT, '.github/workflows/deploy.yml');
// 两份矩阵文档路径：用于交叉核对平台覆盖，防止遗漏或重复。
const MATRIX_FILES = ['AGENTS.md', 'README.md'];
// 命令行参数：--live 表示追加真实 curl 探测。
const LIVE = process.argv.includes('--live');
// 生成时间：ISO 字符串，保证跨时区可排序、可追溯。
const GENERATED_AT = new Date().toISOString();

// 读取仓库内 UTF-8 文本；缺失返回空串，让后续断言如实标注而非崩溃。
function read(rel) {
  // 拼接绝对路径。
  const path = join(ROOT, rel);
  // 不存在返回空串，存在则读全文。
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
} // read 结束

// 执行只读 git / curl 命令；失败时返回结构化错误，不抛异常阻断汇总。
function run(cmd, args, timeout = 12000) {
  // spawnSync 同步执行，避免并发探测导致取证顺序混乱。
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout, windowsHide: true });
  // 命令不存在或超时时 error 有值，统一转成可读文本。
  if (r.error) return { ok: false, out: '', err: String(r.error.message), status: r.status ?? null };
  // 正常执行：以退出码判定成功。
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), status: r.status };
} // run 结束

// 采集 git 远端清单：返回 [{ name, url, kind }]，并按远端名升序保证输出稳定。
function collectRemotes() {
  // git remote -v 每行形如「origin\thttps://... (fetch)」。
  const r = run('git', ['remote', '-v']);
  // 解析失败返回空数组，并在报告中标注取证失败。
  if (!r.ok) return [];
  // 用 Map 去重：fetch / push 两行只保留一条。
  const map = new Map();
  // 逐行解析。
  for (const line of r.out.split('\n')) {
    // 按空白切分，取前两段。
    const parts = line.trim().split(/\s+/);
    // 少于两段的行跳过。
    if (parts.length < 2) continue;
    // 去重写入。
    if (!map.has(parts[0])) map.set(parts[0], { name: parts[0], url: parts[1] });
  } // 远端解析循环结束
  // 按名称排序后返回。
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
} // collectRemotes 结束

// 采集单个远端的 main 分支 hash：本轮未取证时如实标注，不用另一个远端冒充。
function collectRemoteHead(name) {
  // 8 秒超时：Gitee 历史多轮超时，不能让汇总卡住。
  const r = run('git', ['ls-remote', name, 'refs/heads/main'], 8000);
  // 取第一行的 40 位 hash；无输出即未取证。
  const hash = r.ok && r.out ? (r.out.split('\n')[0].split(/\s+/)[0] ?? '') : '';
  // 返回结构化结果，含退出码与错误摘要。
  return { name, ok: Boolean(hash), hash: hash || null, exit: r.status, error: hash ? null : (r.err.split('\n')[0] || `exit ${r.status}`) };
} // collectRemoteHead 结束

// 采集 CI 作业 id：从 jobs: 段开始按两空格缩进的 key 解析，不依赖硬编码白名单。
function collectCiJobs() {
  // 读取工作流文本并按行切分。
  const lines = read('.github/workflows/deploy.yml').split('\n');
  // 定位 jobs: 顶层段起点。
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  // 未找到 jobs 段返回空数组，由校验脚本判定链路断链。
  if (start < 0) return [];
  // 只扫描 jobs 段内、遇到下一个非缩进行即停止。
  const jobs = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    // 遇到新的顶层 key（非空格开头且非空）即结束。
    if (/^\S/.test(lines[i]) && lines[i].trim() !== '') break;
    // 两空格缩进的 key 即作业 id。
    const m = lines[i].match(/^  ([a-z][a-z0-9-]*):\s*$/);
    // 命中即记录。
    if (m) jobs.push(m[1]);
  } // jobs 段扫描结束
  // 返回实际解析到的作业 id 列表。
  return jobs;
} // collectCiJobs 结束

// 采集 CI 步骤名：用于核对各部署项声明的 ci_step 是否仍在工作流里。
function collectCiSteps() {
  // 读取工作流文本。
  const text = read('.github/workflows/deploy.yml');
  // 匹配「- name: xxx」行。
  return [...text.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) => m[1].trim());
} // collectCiSteps 结束

// 采集部署工件双口径：远端 HEAD 是否存在 + 本地工作树是否存在。
function collectArtifacts(items) {
  // 去重工件路径，避免同一文件重复执行 git 查询。
  const paths = [...new Set(items.map((i) => i.delivery.artifact).filter(Boolean))];
  // 逐路径采集。
  return paths.map((artifact) => {
    // git cat-file -e 判断远端 HEAD 是否含该路径，-- 后接路径避免误当参数。
    const head = run('git', ['cat-file', '-e', `HEAD:${artifact}`]);
    // 工作树存在性直接用文件系统判断。
    const worktree = existsSync(join(ROOT, artifact));
    // 返回双口径与漂移标记。
    return { artifact, in_head: head.ok, in_worktree: worktree, drift: head.ok && !worktree };
  });
} // collectArtifacts 结束

// 采集矩阵文档行数：定位各自矩阵小节，避免把 §0 / §9.1 / 额度表等其它表格一起算进来。
function collectMatrixRows(file) {
  // 读取文档文本并按行切分。
  const lines = read(file).split('\n');
  // 起点：AGENTS.md 为铁律九标题，README.md 为「多平台部署矩阵」标题。
  const startMark = file === 'AGENTS.md' ? '## 铁律九' : '### 多平台部署矩阵';
  // 终点：AGENTS.md 为 9.1 小节，README.md 为下一处二级标题或最新取证说明。
  const endMark = file === 'AGENTS.md' ? '### 9.1' : '## ';
  // 定位起点行号。
  const start = lines.findIndex((l) => l.startsWith(startMark));
  // 未找到段落时返回明确的缺失标记。
  if (start < 0) return { file, section: startMark, table_rows: 0, first_column: [], note: '未找到矩阵小节' };
  // 从起点下一行扫描到终点，收集表格行。
  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    // 遇到终点标题即停止（README 的终点不能包含起点自身，故从 start+1 起）。
    if (lines[i].startsWith(endMark) || lines[i].startsWith('> **最新取证')) break;
    // 只保留以竖线开头的表格数据行，排除分隔行。
    if (lines[i].trim().startsWith('|') && !/^\|\s*[-:| ]+\|$/.test(lines[i].trim())) rows.push(lines[i]);
  } // 矩阵段落扫描结束
  // 首列名称：去掉表头「平台」后即为数据行名称，便于人工核对覆盖范围。
  const names = rows.map((l) => (l.split('|')[1] ?? '').trim()).filter((n) => n && n !== '平台' && n !== '项');
  // 返回行数与名称。
  return { file, section: startMark, table_rows: names.length, first_column: names };
} // collectMatrixRows 结束

// 真实探测单个入口：返回 { http_code, latency_ms, bytes, ok, error }。
function probe(url) {
  // 无 URL 的项不发起探测，返回空数据标记。
  if (!url) return { http_code: null, latency_ms: null, bytes: null, ok: false, error: 'NO_ENTRY_URL' };
  // 响应体落系统临时目录，避免污染仓库工作树。
  const bodyPath = join(tmpdir(), 'mim-probe-body.tmp');
  // 与既有取证方式一致，使用 curl 的 -w 输出结构化指标。
  const r = run('curl', ['-sS', '-o', bodyPath, '-w', '%{http_code}|%{time_total}|%{size_download}', '--max-time', '6', url], 8000);
  // 探测结束即删除临时响应体，保持仓库干净。
  try { if (existsSync(bodyPath)) unlinkSync(bodyPath); } catch { /* 临时文件删除失败不影响取证结论 */ }
  // 解析 -w 输出。
  const parts = r.ok ? r.out.split('|') : [];
  // 退出码非 0 时保留 curl 错误摘要。
  if (!r.ok || parts.length !== 3) return { http_code: '000', latency_ms: null, bytes: 0, ok: false, error: (r.err.split('\n')[0] || `exit ${r.status}`) };
  // 成功：把秒转毫秒。
  return { http_code: parts[0], latency_ms: Math.round(Number(parts[1]) * 1000), bytes: Number(parts[2]), ok: true, error: null };
} // probe 结束

// 不参与 HTTP 探测的部署项：仓库项走 git 通道，另两项需私有凭证或本机 DNS 被污染。
const PROBE_SKIP = new Set(['pages.iga', 'worker.mim-store']);
// 跳过原因：写入报告，避免「未探测」被误读为「漏项」。
const PROBE_SKIP_REASON = {
  'pages.iga': '需 iga_token 私有凭证，保持空数据',
  'worker.mim-store': '本机 *.workers.dev DNS 污染，保持空数据',
}; // PROBE_SKIP_REASON 结束

// 按本轮探测刷新某项 result：只在 --live 模式调用，不回写单一事实源。
function refreshResult(item) {
  // 仓库项（source 层）一律以 git ls-remote 取证，不用网页 HTTP 覆盖。
  if (item.layer === 'source') return { item, probed: false, skipped: `${item.id}: git 通道取证，跳过 HTTP 探测` };
  // 需私有凭证或网络侧阻断的项保持空数据，避免伪造结论。
  if (PROBE_SKIP.has(item.id)) return { item, probed: false, skipped: `${item.id}: ${PROBE_SKIP_REASON[item.id]}` };
  // 无入口的项跳过探测。
  if (!item.entry_url) return { item, probed: false, skipped: `${item.id}: 无公开入口` };
  // 发起真实请求。
  const p = probe(item.entry_url);
  // 构造新的 result，判定码沿用既有字典语义。
  const verdict = !p.ok ? 'FAIL'
    : (item.id === 'pages.edgeone' && p.bytes < 2000) ? 'DEGRADED'
      : (item.id === 'packages.ghcr' && p.http_code === '401') ? 'PASS'
        : (p.http_code && p.http_code.startsWith('2')) ? 'PASS' : 'FAIL';
  // 返回带新 result 的浅拷贝。
  return {
    item: {
      ...item,
      result: {
        verdict,
        http_code: p.http_code,
        latency_ms: p.latency_ms,
        bytes: p.bytes,
        evidence: p.ok
          ? `curl ${item.entry_url} → ${p.http_code} / ${p.latency_ms}ms / ${p.bytes}B（本轮 --live 探测）`
          : `curl ${item.entry_url} 失败：${p.error}（本轮 --live 探测）`,
        captured_at: GENERATED_AT,
      },
    },
    probed: true,
    skipped: null,
  };
} // refreshResult 结束

// 把任意值渲染成表格单元格：空值统一用「—」，避免空白单元格被误读为漏填。
function cell(value) {
  // null / undefined / 空串 / 空数组均视为空数据。
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  // 其余转字符串并压缩换行，保持单行表格。
  return String(value).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
} // cell 结束

// 部署状态徽标：统一字段取值到可读标识，失败与未取证不混用。
function statusBadge(status) {
  // 按状态字典映射。
  return ({ OK: '✅ OK', BROKEN: '🔴 BROKEN', UNVERIFIED: '🟡 UNVERIFIED', MANUAL: '🟡 MANUAL', NOT_APPLICABLE: '⚪ N/A' })[status] ?? status;
} // statusBadge 结束

// 部署结果徽标：空数据、失败、降级必须彼此可区分。
function resultBadge(result) {
  // null 结果明确标注为空数据。
  if (result === null) return '⚪ 空数据';
  // 有结果时按结论码映射。
  const map = { PASS: '✅ PASS', DEGRADED: '🟡 DEGRADED', FAIL: '🔴 FAIL', NOT_TESTED: '🟡 未测', EMPTY: '⚪ 无记录' };
  // 附 HTTP / 字节数，便于与 curl 输出直接核对。
  return `${map[result.verdict] ?? result.verdict} ${result.http_code ?? '—'} / ${result.bytes ?? '—'}B`;
} // resultBadge 结束

// 异常说明单元格：按严重度排序后给出条数与最高级别摘要。
function anomalyCell(anomalies) {
  // 空数组表示无异常。
  if (anomalies.length === 0) return '—';
  // 严重度权重：critical 优先展示。
  const weight = { critical: 0, warning: 1, info: 2 };
  // 稳定排序，不修改原数组。
  const sorted = [...anomalies].sort((a, b) => weight[a.severity] - weight[b.severity]);
  // 取最高级别异常码 + 总条数。
  return `${sorted[0].code} 等 ${anomalies.length} 项`;
} // anomalyCell 结束

// 生成 Markdown 报告：总览 + 主表 + 异常明细 + 覆盖说明 + 排除项 + 取证来源。
function renderMarkdown(report) {
  // 报告行缓冲，最后统一拼接，避免多次字符串拼接开销。
  const lines = [];
  // 标题与生成元信息。
  lines.push('# Mim 部署汇总（结构化核对表）');
  lines.push('');
  lines.push(`- 生成时间：${report.generated_at}`);
  lines.push(`- 本地 HEAD：\`${report.head}\``);
  lines.push(`- 采集模式：${report.mode === 'live' ? '--live（真实 curl 探测已覆盖 result）' : 'baseline（沿用契约取证快照）'}`);
  lines.push(`- 单一事实源：\`packages/core-domain/src/deploymentRegistry.json\`（schema ${report.schema}）`);
  // --live 模式下说明哪些项被有意跳过探测，避免「未探测」被误读为漏项。
  if (report.probe_skipped.length > 0) lines.push(`- 有意跳过 HTTP 探测 ${report.probe_skipped.length} 项：${report.probe_skipped.join('；')}`);
  lines.push('');
  // 总览统计。
  lines.push('## 1. 总览');
  lines.push('');
  lines.push('| 指标 | 数值 | 说明 |');
  lines.push('|---|---|---|');
  lines.push(`| 矩阵平台 | ${report.coverage_check.matrix_platforms} | 铁律九 10 个免费平台 |`);
  lines.push(`| 规范部署项 | ${report.summary.total} | 去重后的部署仓库 + 部署项 |`);
  lines.push(`| git 远端 | ${report.remotes.length} | ${report.remotes.map((r) => r.name).join(' / ') || '—'} |`);
  lines.push(`| CI 作业 | ${report.ci_jobs.length} | 其中部署作业 ${report.summary.deploy_ci_jobs} 个 |`);
  lines.push(`| 有取证 | ${report.summary.with_result} | 本轮存在可信取证 |`);
  lines.push(`| 空数据 | ${report.summary.empty_result} | result 为 null，明确标识而非填 0 |`);
  lines.push(`| 异常 | ${report.summary.anomalies} | 🔴 ${report.summary.by_severity.critical} / 🟡 ${report.summary.by_severity.warning} / 🟢 ${report.summary.by_severity.info} |`);
  lines.push(`| 缺失信息 | ${report.summary.missing_fields} | 字段名或工件路径 |`);
  lines.push(`| 工作树漂移 | ${report.summary.worktree_drift} | 工件在远端 HEAD 存在、本地工作树缺失 |`);
  lines.push('');
  // 主表：用户要求的四类核心字段全部为独立列。
  lines.push('## 2. 部署项主表（统一字段）');
  lines.push('');
  lines.push('| 规范 ID | 仓库标识 | 平台 / 层级 | 交付链路 | 部署状态 | 部署结果 | 异常说明 | 缺失信息 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  // 逐项输出一行，空值统一为「—」。
  for (const item of report.items) {
    lines.push(`| \`${item.id}\` | ${cell(item.repository.id)} | ${cell(item.platform)} / ${cell(item.layer)} | ${cell(item.delivery.mode)} ${cell(item.delivery.ci_job)} | ${statusBadge(item.status)} | ${resultBadge(item.result)} | ${anomalyCell(item.anomalies)} | ${item.missing_fields.length ? `⚠ ${item.missing_fields.length} 项` : '—'} |`);
  } // 主表循环结束
  lines.push('');
  // 异常明细：便于逐条核对异常说明与严重度。
  lines.push('## 3. 异常说明明细');
  lines.push('');
  lines.push('| 部署项 | 严重度 | 异常码 | 说明 |');
  lines.push('|---|---|---|---|');
  // 逐项逐异常展开。
  for (const item of report.items) {
    for (const a of item.anomalies) {
      const icon = { critical: '🔴', warning: '🟡', info: '🟢' }[a.severity] ?? '⚪';
      lines.push(`| \`${item.id}\` | ${icon} ${a.severity} | \`${a.code}\` | ${cell(a.message)} |`);
    } // 异常循环结束
  } // 部署项循环结束
  lines.push('');
  // 仓库与工件：区分「远端 HEAD」与「本地工作树」两个口径。
  lines.push('## 4. 仓库标识与部署工件');
  lines.push('');
  lines.push('| 远端 | 地址 | 本轮 main hash | 判定 |');
  lines.push('|---|---|---|---|');
  for (const r of report.remotes) {
    const head = report.remote_heads.find((h) => h.name === r.name);
    lines.push(`| \`${r.name}\` | ${cell(r.url)} | ${cell(head?.hash)} | ${head?.ok ? '✅ 已取证' : `⚪ 未取证（${cell(head?.error)}）`} |`);
  } // 远端循环结束
  lines.push('');
  lines.push('| 工件 | 远端 HEAD | 本地工作树 | 判定 |');
  lines.push('|---|---|---|---|');
  for (const a of report.artifacts) {
    lines.push(`| \`${a.artifact}\` | ${a.in_head ? '✅ 存在' : '❌ 缺失'} | ${a.in_worktree ? '✅ 存在' : '❌ 缺失'} | ${a.drift ? '🟡 漂移（提交删除后 CI 悬空）' : '✅ 一致'} |`);
  } // 工件循环结束
  lines.push('');
  // 覆盖与去重说明：解释 9 平台与 11 部署项的差异。
  lines.push('## 5. 覆盖、去重与排除');
  lines.push('');
  lines.push(`- 矩阵文档行数核对：${report.matrix_rows.map((m) => `${m.file} ${m.table_rows} 行表格`).join('；')}。`);
  lines.push(`- 去重：${report.coverage.dedup_note}`);
  lines.push(`- 补齐：${report.coverage.added_note}`);
  lines.push(`- 排除：${report.coverage.excluded_note}`);
  lines.push('');
  lines.push('| 候选 / 排除项 | 理由 |');
  lines.push('|---|---|');
  for (const e of report.excluded) lines.push(`| ${e.name} | ${cell(e.reason)} |`);
  lines.push('');
  // 取证来源。
  lines.push('## 6. 取证来源');
  lines.push('');
  for (const s of report.sources) lines.push(`- ${s}`);
  lines.push('');
  // 拼接为单一字符串，末尾保留换行。
  return lines.join('\n') + '\n';
} // renderMarkdown 结束

// ---------- 主流程 ----------
// 读取单一事实源：读不到直接失败退出，避免生成一份没有依据的汇总。
let registry;
try {
  registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
} catch (err) {
  // 输出可读错误并以 1 退出。
  console.error(`❌ 无法读取部署注册表：${String(err.message)}`);
  process.exit(1);
} // try/catch 结束

// 采集本地 HEAD：失败时标注 unknown，不伪造 commit。
const headRun = run('git', ['rev-parse', '--short', 'HEAD']);
const head = headRun.ok ? headRun.out : 'unknown';
// 采集远端清单与各自 main hash。
const remotes = collectRemotes();
const remoteHeads = remotes.map((r) => collectRemoteHead(r.name));
// 采集 CI 作业与步骤名。
const ciJobs = collectCiJobs();
const ciSteps = collectCiSteps();
// 采集工件双口径存在性。
const artifacts = collectArtifacts(registry.items);
// 采集两份文档的矩阵表行数。
const matrixRows = MATRIX_FILES.map(collectMatrixRows);

// --live 模式：对有入口的部署项真实探测并刷新 result；其余项保留契约快照。
let items = registry.items;
let probedCount = 0;
const probeSkipped = [];
if (LIVE) {
  items = registry.items.map((item) => {
    const r = refreshResult(item);
    if (r.probed) probedCount += 1;
    if (r.skipped) probeSkipped.push(r.skipped);
    return r.item;
  });
} // LIVE 分支结束

// 汇总统计：与共享包 deploymentSummary() 同口径，脚本内独立实现以免引入构建产物依赖。
const summary = {
  total: items.length,
  matrix_platforms: registry.coverage.matrix_platforms,
  platform_catalog: registry.platform_catalog.length,
  git_remotes: remotes.length,
  ci_jobs: ciJobs.length,
  deploy_ci_jobs: registry.ci_jobs.filter((j) => j.is_deploy).length,
  excluded: registry.excluded.length,
  with_result: items.filter((i) => i.result !== null).length,
  empty_result: items.filter((i) => i.result === null).length,
  anomalies: items.reduce((n, i) => n + i.anomalies.length, 0),
  missing_fields: items.reduce((n, i) => n + i.missing_fields.length, 0),
  worktree_drift: artifacts.filter((a) => a.drift).length,
  by_status: {},
  by_verdict: {},
  by_layer: {},
  by_platform: {},
  by_severity: { critical: 0, warning: 0, info: 0 },
};
// 逐项累加各维度分布。
for (const item of items) {
  summary.by_status[item.status] = (summary.by_status[item.status] ?? 0) + 1;
  const v = item.result?.verdict ?? 'EMPTY';
  summary.by_verdict[v] = (summary.by_verdict[v] ?? 0) + 1;
  summary.by_layer[item.layer] = (summary.by_layer[item.layer] ?? 0) + 1;
  summary.by_platform[item.platform_id] = (summary.by_platform[item.platform_id] ?? 0) + 1;
  for (const a of item.anomalies) summary.by_severity[a.severity] = (summary.by_severity[a.severity] ?? 0) + 1;
} // 汇总循环结束

// 覆盖核对：声明值 vs 实际采集值，出现偏差即在报告中可见。
const coverageCheck = {
  matrix_platforms: registry.platform_catalog.filter((p) => p.in_matrix).length,
  matrix_platforms_expected: registry.coverage.matrix_platforms,
  deployment_items: items.length,
  deployment_items_declared: registry.coverage.deployment_items,
  ci_jobs_found: ciJobs.length,
  ci_jobs_declared: registry.ci_jobs.length,
  ci_steps_found: ciSteps.length,
  remotes_found: remotes.length,
  remotes_declared: registry.coverage.git_remotes,
  probed_items: probedCount,
};
// 组装最终结构化报告。
const report = {
  schema: registry.schema,
  generated_at: GENERATED_AT,
  head,
  mode: LIVE ? 'live' : 'baseline',
  sources: registry.sources,
  registry_path: 'packages/core-domain/src/deploymentRegistry.json',
  coverage: registry.coverage,
  coverage_check: coverageCheck,
  summary,
  remotes,
  remote_heads: remoteHeads,
  ci_jobs: ciJobs,
  ci_steps: ciSteps,
  probe_skipped: probeSkipped,
  artifacts,
  matrix_rows: matrixRows,
  excluded: registry.excluded,
  status_codes: registry.status_codes,
  verdict_codes: registry.verdict_codes,
  severity_codes: registry.severity_codes,
  field_spec: registry.field_spec,
  items,
};

// 确保 docs 目录存在（仓库已有，仍做幂等保护）。
mkdirSync(dirname(OUT_JSON), { recursive: true });
// 写结构化 JSON：两空格缩进，中文不转义，便于人工核对与 diff。
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');
// 写 Markdown 表格：便于在编辑器 / PR 中直接核对。
writeFileSync(OUT_MD, renderMarkdown(report), 'utf8');

// 终端摘要：只给关键数值与两个产物路径，完整表格落文件。
console.log('✅ 部署汇总已生成');
console.log(`   模式：${report.mode}｜HEAD：${head}｜本地远端：${remotes.length}｜CI 作业：${ciJobs.length}`);
console.log(`   部署项：${summary.total}｜有取证：${summary.with_result}｜空数据：${summary.empty_result}｜异常：${summary.anomalies}（🔴${summary.by_severity.critical}/🟡${summary.by_severity.warning}/🟢${summary.by_severity.info}）`);
console.log(`   工件漂移：${summary.worktree_drift}｜缺失信息：${summary.missing_fields}｜探测项：${probedCount}`);
console.log(`   结构化结果：docs/deployment-summary.json`);
console.log(`   核对表格：  docs/deployment-summary.md`);
