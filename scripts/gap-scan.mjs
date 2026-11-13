#!/usr/bin/env node
/**
 * scripts/gap-scan.mjs
 *
 * 全仓缺口扫描器（零依赖，纯静态分析）。覆盖五类断言：
 *
 *  A. 路由装配：services/mim-api/src/routes/*.ts 导出的 create*Router 是否都在
 *     src/app.ts 被 import 且 app.use 挂载（含受保护路由 for 循环内注册）。
 *  B. 表结构接缝：src/schema.d/*.sql 是否存在非幂等语句（DROP / DELETE / 无 WHERE 的 UPDATE）
 *     与非法 `ALTER_ADD:` 指令；services/mim-api/build.mjs 是否确实搬运 schema.d。
 *  C. 环境变量：源码中出现的 MIM_* 是否都在 .env.example 与 09 清单登记
 *     （与 env-check 同源口径，额外检查「代码用了但没登记」方向）。
 *  D. 前端接线：apps/web/src/views/*.tsx 是否都在 App.tsx 注册（静态 import 或 lazy），
 *     router.ts 的 VIEW_SEGMENTS 是否覆盖全部 AppView 视图标识。
 *  E. 未完成标记：源码目录内 TODO / FIXME / XXX / HACK / 未实现 / 待实现逐条列出
 *     （注释 / 描述性字符串里的合法历史说明降级为提示，不计硬缺口）。
 *
 * 用法：
 *   node scripts/gap-scan.mjs            # 打印表格 + 写 docs/gap-scan.json；有硬缺口退出码 1
 *
 * 退出码：0 = 无硬缺口（允许 WARN 提示）；1 = 存在 FAIL 项。
 *
 * 口径说明：
 *  - 不执行任何代码、不访问外部服务；只读取仓库内文本。
 *  - 静态分析存在边界（模板字符串动态拼出的变量名、注释内 SQL 文本），相关项在 JSON
 *    的 note 字段标注，不作为硬失败依据。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------- 路径常量 ----------
const API_SRC = join(ROOT, 'services', 'mim-api', 'src');
const ROUTE_DIR = join(API_SRC, 'routes');
const APP_TS = join(API_SRC, 'app.ts');
const SCHEMA_D_DIR = join(API_SRC, 'schema.d');
const API_BUILD_MJS = join(ROOT, 'services', 'mim-api', 'build.mjs');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');
const VIEWS_DIR = join(WEB_SRC, 'views');
const APP_TSX = join(WEB_SRC, 'App.tsx');
const ROUTER_TS = join(WEB_SRC, 'router.ts');
const ENV_EXAMPLE = join(ROOT, '.env.example');
const INVENTORY = join(ROOT, 'docs', 'wiki', '09-third-party-sdk-inventory.md');
const REPORT_JSON = join(ROOT, 'docs', 'gap-scan.json');

// 源码扫描根（相对 ROOT）；部署脚本 / 脚本目录单独归类为 internal
const SOURCE_ROOTS = [
  'services/mim-api/src',
  'apps/web/src',
  'apps/admin/src',
  'packages',
  'functions',
  'workers',
];
const SCRIPT_ROOTS = ['scripts', 'deploy'];
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.yml', '.yaml', '.sql', '.json']);

// 环境变量：纯脚本 / 部署编排 / 蓝图示例性质的内部变量，未登记不算适配器缺口（WARN）
const INTERNAL_ENV_VARS = new Set([
  'MIM_DB_PATH', // 蓝图 compose 示例串，非运行时读取
  'MIM_ENV_FILE', // deploy.sh 自身路径参数
  'MIM_ENABLE_BACKUP_TIMER', // deploy.sh timer 开关
  'MIM_SERVICE_VERSION', // 健康检查回显覆盖值
  'MIM_PERF_TARGET_MS', // scripts/perf-bench.mjs 基准门槛，非运行时
  'MIM_PUBLIC_ORIGIN', // 导航站兜底起源，与 MIM_PUBLIC_BASE_URL 同族的遗留别名
  'MIM_FILM_REVIEW_SLA_HOURS', // 内部运营 SLA 配置
  'MIM_AI_HOURLY_COST_LIMIT_MINOR', // 内部成本上限派生配置（缺省按日均摊）
  'MIM_CONTENT_CLICK_WINDOW_SECONDS', // 内部推广点击窗口配置
  'MIM_CONTENT_CLICK_MAX', // 内部推广点击上限
  'MIM_CONTENT_CONVERSION_MAX', // 内部转化频控上限
  'MIM_AI_ALLOW_INSECURE_BASE', // AI 厂商 baseUrl http 放行 opt-in 开关（安全内部开关）
  'MIM_API_BASE', // perf-bench 脚本探测目标
  'MIM_APP', // 蓝图注册表 JSON 内的示例键名
  'MIM_E2E_PNG', // 端到端校验脚本截图路径
]);

// 内部变量前缀：门禁 / 自检脚本与蓝图注册表注入键
const INTERNAL_ENV_PREFIXES = ['MIM_GATE_', 'MIM_HOST_'];

// ---------- 工具 ----------
function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|dist|\.git|data/.test(entry.name)) continue;
      walk(full, acc);
    } else if (SCAN_EXTS.has(basename(full).slice(basename(full).lastIndexOf('.')))) {
      acc.push(full);
    }
  }
  return acc;
}

function rel(p) {
  return relative(ROOT, p).replace(/\\/g, '/');
}

function readText(p) {
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

// ---------- 结果容器 ----------
const assertions = {
  routes: { title: 'A. 路由装配', status: 'PASS', failures: [], warnings: [], stats: {} },
  schema: { title: 'B. 表结构接缝', status: 'PASS', failures: [], warnings: [], stats: {} },
  env: { title: 'C. 环境变量登记', status: 'PASS', failures: [], warnings: [], stats: {} },
  frontend: { title: 'D. 前端接线', status: 'PASS', failures: [], warnings: [], stats: {} },
  markers: { title: 'E. 未完成标记', status: 'PASS', failures: [], warnings: [], stats: {} },
};

function fail(assertion, item) {
  assertions[assertion].failures.push(item);
  assertions[assertion].status = 'FAIL';
}
function warn(assertion, item) {
  assertions[assertion].warnings.push(item);
  if (assertions[assertion].status === 'PASS') assertions[assertion].status = 'WARN';
}

// =====================================================================
// A. 路由装配
// =====================================================================
function checkRoutes() {
  const appText = readText(APP_TS);
  if (appText === null) {
    fail('routes', { file: rel(APP_TS), reason: 'app.ts 缺失，无法核对路由装配' });
    return;
  }
  const routeFiles = existsSync(ROUTE_DIR)
    ? readdirSync(ROUTE_DIR).filter((f) => f.endsWith('.ts'))
    : [];
  const factories = [];
  for (const file of routeFiles) {
    const text = readText(join(ROUTE_DIR, file)) ?? '';
    const names = [...text.matchAll(/export\s+(?:async\s+)?function\s+(create[A-Za-z0-9_]*Router)/g)].map(
      (m) => m[1],
    );
    for (const name of names) factories.push({ file: rel(join(ROUTE_DIR, file)), name });
  }

  const unmounted = [];
  for (const { file, name } of factories) {
    const imported = new RegExp(`import\\s*{[^}]*\\b${name}\\b`).test(appText);
    // 挂载：app.use('...', createXxxRouter(...)) 直接调用，或受保护路由 for 循环数组内引用工厂
    const mounted =
      new RegExp(`app\\.use\\([^\\n]*\\b${name}\\b`).test(appText) ||
      new RegExp(`\\b${name}\\s*\\(`).test(appText);
    if (!imported || !mounted) {
      unmounted.push({ file, factory: name, imported, mounted });
    }
  }

  assertions.routes.stats = { routeFiles: routeFiles.length, factories: factories.length, unmounted: unmounted.length };
  for (const item of unmounted) {
    fail('routes', {
      file: item.file,
      detail: `工厂 ${item.factory} 未挂载（import=${item.imported}, mounted=${item.mounted}）`,
    });
  }
}

// =====================================================================
// B. 表结构接缝
// =====================================================================
function stripSqlLineComment(line) {
  // 去掉 -- 之后的行注释；单引号字符串内的 -- 不当作注释（DDL 默认值极少含 --，静态口径可接受）
  let inStr = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "'") inStr = !inStr;
    if (!inStr && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}

function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkSchema() {
  const sqlFiles = existsSync(SCHEMA_D_DIR)
    ? readdirSync(SCHEMA_D_DIR).filter((f) => f.endsWith('.sql'))
    : [];
  let nonIdempotent = 0;
  let badDirectives = 0;

  const ALTER_ADD_RE = /^\s*ALTER_ADD:\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/;

  for (const file of sqlFiles) {
    const full = join(SCHEMA_D_DIR, file);
    const lines = (readText(full) ?? '').split(/\r?\n/);
    const codeLines = lines.map(stripSqlLineComment);

    // 指令行合法性校验
    lines.forEach((raw, idx) => {
      if (/^\s*ALTER_ADD:/.test(raw) && !ALTER_ADD_RE.test(raw)) {
        badDirectives += 1;
        fail('schema', {
          file: rel(full),
          line: idx + 1,
          detail: `非法 ALTER_ADD 指令（格式应为 \`ALTER_ADD: 表名 列名 <列定义>\`）: ${raw.trim()}`,
        });
      }
    });

    // 语句级幂等性校验
    const sqlCode = codeLines.join('\n');
    for (const stmt of splitStatements(sqlCode)) {
      const head = stmt.toUpperCase();
      if (/^\s*DROP\s+(TABLE|INDEX)/.test(head)) {
        nonIdempotent += 1;
        fail('schema', { file: rel(full), detail: `非幂等 DROP 语句: ${stmt.slice(0, 80)}` });
      } else if (/^\s*DELETE\s+FROM/.test(head)) {
        nonIdempotent += 1;
        fail('schema', { file: rel(full), detail: `DELETE 语句禁止出现在 schema.d: ${stmt.slice(0, 80)}` });
      } else if (/^\s*UPDATE\s+\w+/.test(head) && !/\bWHERE\b/.test(head)) {
        nonIdempotent += 1;
        fail('schema', { file: rel(full), detail: '无条件 UPDATE（缺 WHERE）: ' + stmt.slice(0, 80) });
      }
    }
  }

  // build.mjs 必须搬运 schema.d 目录
  const buildText = readText(API_BUILD_MJS);
  let copiesSchemaD = false;
  if (buildText === null) {
    fail('schema', { file: rel(API_BUILD_MJS), reason: 'mim-api build.mjs 缺失' });
  } else {
    copiesSchemaD = /cp\(\s*'src\/schema\.d'/.test(buildText) || /cp\(\s*"src\/schema\.d"/.test(buildText);
    if (!copiesSchemaD) {
      fail('schema', { file: rel(API_BUILD_MJS), detail: 'build.mjs 未搬运 src/schema.d → dist/schema.d' });
    }
  }

  assertions.schema.stats = {
    sqlFiles: sqlFiles.length,
    nonIdempotent,
    badDirectives,
    copiesSchemaD,
  };
}

// =====================================================================
// C. 环境变量登记
// =====================================================================
function collectRegistered() {
  const templateNames = new Set();
  const tplLines = readText(ENV_EXAMPLE)?.split(/\r?\n/) ?? [];
  for (const line of tplLines) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)[ \t]*=/);
    if (m) templateNames.add(m[1]);
  }
  const inventoryText = readText(INVENTORY) ?? '';
  const inventoryVars = new Set();
  for (const m of inventoryText.matchAll(/`(MIM_[A-Z0-9_]+)`/g)) inventoryVars.add(m[1]);
  const stems = [];
  for (const m of inventoryText.matchAll(/`(MIM_[A-Z0-9_]+)\*`/g)) stems.push(m[1]);
  return { templateNames, inventoryVars, stems };
}

function checkEnv() {
  const registered = collectRegistered();
  const sourceVars = new Map(); // var -> [{file, line}]

  const roots = [...SOURCE_ROOTS, ...SCRIPT_ROOTS];
  for (const root of roots) {
    for (const file of walk(join(ROOT, root))) {
      const lines = (readText(file) ?? '').split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const m of line.matchAll(/MIM_[A-Z0-9_]+/g)) {
          const name = m[0];
          if (name.endsWith('_')) continue; // 模板字符串动态前缀（MIM_AUTH_${ID}），跳过
          if (!sourceVars.has(name)) sourceVars.set(name, []);
          sourceVars.get(name).push({ file: rel(file), line: idx + 1 });
        }
      });
    }
  }

  for (const [name, occurrences] of [...sourceVars.entries()].sort()) {
    const exact = registered.templateNames.has(name) || registered.inventoryVars.has(name);
    const covered = registered.stems.some((stem) => name.startsWith(stem));
    if (exact || covered) continue;
    const files = occurrences.map((o) => o.file);
    const inScripts = files.some((f) => f.startsWith('scripts/') || f.startsWith('deploy/'));
    const inBlueprint = files.some((f) => /(deploymentRegistry|siteModules)\.json$/.test(f));
    const internal =
      INTERNAL_ENV_VARS.has(name) ||
      INTERNAL_ENV_PREFIXES.some((p) => name.startsWith(p)) ||
      inScripts ||
      inBlueprint;
    const item = {
      var: name,
      internal,
      locations: occurrences.slice(0, 5),
      locationCount: occurrences.length,
    };
    if (internal) {
      warn('env', item);
    } else {
      fail('env', item);
    }
  }

  assertions.env.stats = {
    sourceVars: sourceVars.size,
    templateVars: registered.templateNames.size,
    inventoryVars: registered.inventoryVars.size,
    wildcardStems: registered.stems.length,
    unregistered: assertions.env.failures.length + assertions.env.warnings.length,
    unregisteredAdapter: assertions.env.failures.length,
    unregisteredInternal: assertions.env.warnings.length,
  };
}

// =====================================================================
// D. 前端接线
// =====================================================================
function checkFrontend() {
  const appText = readText(APP_TSX) ?? '';
  const routerText = readText(ROUTER_TS) ?? '';
  const viewFiles = existsSync(VIEWS_DIR) ? readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.tsx')) : [];

  // 收集其它视图之间的引用（用于识别「嵌套子组件」而非漏挂路由）
  const otherRefs = new Set();
  for (const file of viewFiles) {
    if (file === 'App.tsx') continue;
    const text = readText(join(VIEWS_DIR, file)) ?? '';
    for (const m of text.matchAll(/from\s+'\.\/([A-Za-z0-9_]+)'/g)) otherRefs.add(m[1]);
  }

  const unregistered = [];
  for (const file of viewFiles) {
    const base = file.replace(/\.tsx$/, '');
    const inApp = new RegExp(`views/${base}`).test(appText);
    const nested = otherRefs.has(base);
    if (!inApp) {
      unregistered.push({ file: rel(join(VIEWS_DIR, file)), nested });
      if (nested) {
        warn('frontend', { file: rel(join(VIEWS_DIR, file)), detail: '未在 App.tsx 直接注册，但被其它视图作为子组件引用' });
      } else {
        fail('frontend', { file: rel(join(VIEWS_DIR, file)), detail: '视图既未在 App.tsx 注册，也未被其它视图引用' });
      }
    }
  }

  // VIEW_SEGMENTS 覆盖全部 AppView 标识
  const typeBlock = routerText.match(/export\s+type\s+AppView\s*=\s*([\s\S]*?);/);
  const viewIds = typeBlock
    ? [...typeBlock[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    : [];
  const segBlock = routerText.match(/const\s+VIEW_SEGMENTS[^=]*=\s*\{([\s\S]*?)\n\}/);
  const segKeys = segBlock ? [...segBlock[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((m) => m[1]) : [];
  const missingSegments = viewIds.filter((id) => !segKeys.includes(id));
  for (const id of missingSegments) {
    fail('frontend', { detail: `AppView '${id}' 未在 VIEW_SEGMENTS 登记路径段` });
  }

  assertions.frontend.stats = {
    viewFiles: viewFiles.length,
    unregistered: unregistered.length,
    nested: unregistered.filter((u) => u.nested).length,
    appViews: viewIds.length,
    segments: segKeys.length,
    missingSegments: missingSegments.length,
  };
}

// =====================================================================
// E. 未完成标记
// =====================================================================
const MARKER_RE = /\b(TODO|FIXME|XXX|HACK)\b|未实现|待实现/;

function classifyLine(line) {
  const trimmed = line.trim();
  // 纯注释行
  if (/^(\/\/|\/\*|\*|--|#)/.test(trimmed)) return 'comment';
  // 去掉行尾 // 注释后再判断
  let inStr = false;
  let code = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === '`') inStr = !inStr;
    if (!inStr && ch === '/' && line[i + 1] === '/') break;
    code += ch;
  }
  if (!MARKER_RE.test(code)) return 'comment'; // 标记只出现在注释里
  // 标记留在代码中：区分硬标记与描述性字符串
  if (/\b(TODO|FIXME|XXX|HACK)\b/.test(code)) return 'marker';
  return 'string-note';
}

function checkMarkers() {
  const hard = [];
  const notes = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const lines = (readText(file) ?? '').split(/\r?\n/);
      lines.forEach((line, idx) => {
        const m = line.match(MARKER_RE);
        if (!m) return;
        const kind = classifyLine(line);
        const item = {
          file: rel(file),
          line: idx + 1,
          marker: m[0],
          kind,
          text: line.trim().slice(0, 120),
        };
        if (kind === 'marker') {
          hard.push(item);
          fail('markers', item);
        } else {
          notes.push(item);
          warn('markers', item);
        }
      });
    }
  }
  assertions.markers.stats = { hard: hard.length, notes: notes.length, total: hard.length + notes.length };
}

// ---------- 执行 ----------
checkRoutes();
checkSchema();
checkEnv();
checkFrontend();
checkMarkers();

// ---------- 汇总输出 ----------
const summary = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  overall: Object.values(assertions).some((a) => a.status === 'FAIL') ? 'FAIL' : 'PASS',
  assertions: Object.fromEntries(
    Object.entries(assertions).map(([key, a]) => [
      key,
      { title: a.title, status: a.status, stats: a.stats, failures: a.failures, warnings: a.warnings },
    ]),
  ),
};

console.log('=== Mim 全仓缺口扫描（gap-scan）===');
console.log('');
for (const [key, a] of Object.entries(assertions)) {
  const icon = a.status === 'PASS' ? '✅' : a.status === 'WARN' ? '⚠️ ' : '❌';
  console.log(`${icon} ${a.title} — ${a.status}（fail=${a.failures.length}, warn=${a.warnings.length}）`);
  for (const [k, v] of Object.entries(a.stats)) console.log(`    ${k}: ${v}`);
  for (const f of a.failures.slice(0, 50)) {
    console.log(`    ❌ ${f.file ?? ''}${f.line ? `:${f.line}` : ''} ${f.detail ?? f.reason ?? JSON.stringify(f)}`);
  }
  for (const w of a.warnings.slice(0, 50)) {
    console.log(`    ⚠️  ${w.file ?? ''}${w.line ? `:${w.line}` : ''} ${w.detail ?? w.var ?? JSON.stringify(w)}`);
  }
}
console.log('');
console.log(`总体结论: ${summary.overall}`);

// 写 JSON 报告（docs 目录不存在则创建）
mkdirSync(dirname(REPORT_JSON), { recursive: true });
writeFileSync(REPORT_JSON, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
console.log(`JSON 报告: ${rel(REPORT_JSON)}`);

process.exit(summary.overall === 'FAIL' ? 1 : 0);
