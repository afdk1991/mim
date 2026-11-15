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

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'; // 引入依赖、类型或本地模块绑定
import { join, dirname, relative, basename } from 'node:path'; // 引入依赖、类型或本地模块绑定
import { fileURLToPath } from 'node:url'; // 引入依赖、类型或本地模块绑定

const __dirname = dirname(fileURLToPath(import.meta.url)); // 常量 __dirname：保存固定配置或一次性派生值
const ROOT = join(__dirname, '..'); // 常量 ROOT：保存固定配置或一次性派生值

// ---------- 路径常量 ----------
const API_SRC = join(ROOT, 'services', 'mim-api', 'src');
const ROUTE_DIR = join(API_SRC, 'routes'); // 常量 ROUTE_DIR：保存固定配置或一次性派生值
const APP_TS = join(API_SRC, 'app.ts'); // 常量 APP_TS：保存固定配置或一次性派生值
const SCHEMA_D_DIR = join(API_SRC, 'schema.d'); // 常量 SCHEMA_D_DIR：保存固定配置或一次性派生值
const API_BUILD_MJS = join(ROOT, 'services', 'mim-api', 'build.mjs'); // 常量 API_BUILD_MJS：保存固定配置或一次性派生值
const WEB_SRC = join(ROOT, 'apps', 'web', 'src'); // 常量 WEB_SRC：保存固定配置或一次性派生值
const VIEWS_DIR = join(WEB_SRC, 'views'); // 常量 VIEWS_DIR：保存固定配置或一次性派生值
const APP_TSX = join(WEB_SRC, 'App.tsx'); // 常量 APP_TSX：保存固定配置或一次性派生值
const ROUTER_TS = join(WEB_SRC, 'router.ts'); // 常量 ROUTER_TS：保存固定配置或一次性派生值
const ENV_EXAMPLE = join(ROOT, '.env.example'); // 常量 ENV_EXAMPLE：保存固定配置或一次性派生值
const INVENTORY = join(ROOT, 'docs', 'wiki', '09-third-party-sdk-inventory.md'); // 常量 INVENTORY：保存固定配置或一次性派生值
const REPORT_JSON = join(ROOT, 'docs', 'gap-scan.json'); // 常量 REPORT_JSON：保存固定配置或一次性派生值

// 源码扫描根（相对 ROOT）；部署脚本 / 脚本目录单独归类为 internal
const SOURCE_ROOTS = [
  'services/mim-api/src', // 执行当前业务步骤
  'apps/web/src', // 执行当前业务步骤
  'apps/admin/src', // 执行当前业务步骤
  'packages', // 执行当前业务步骤
  'functions', // 执行当前业务步骤
  'workers', // 执行当前业务步骤
]; // 执行当前业务步骤
const SCRIPT_ROOTS = ['scripts', 'deploy']; // 常量 SCRIPT_ROOTS：保存固定配置或一次性派生值
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.yml', '.yaml', '.sql', '.json']); // 常量 SCAN_EXTS：保存固定配置或一次性派生值

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
]); // 执行当前业务步骤

// 内部变量前缀：门禁 / 自检脚本与蓝图注册表注入键
const INTERNAL_ENV_PREFIXES = ['MIM_GATE_', 'MIM_HOST_'];

// ---------- 工具 ----------
function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc; // 条件分支：按判断结果选择后续处理路径
  for (const entry of readdirSync(dir, { withFileTypes: true })) { // 循环：逐项遍历集合并执行相同处理
    const full = join(dir, entry.name); // 常量 full：保存固定配置或一次性派生值
    if (entry.isDirectory()) { // 条件分支：按判断结果选择后续处理路径
      if (/node_modules|dist|\.git|data/.test(entry.name)) continue; // 条件分支：按判断结果选择后续处理路径
      walk(full, acc); // 调用 walk 并处理其返回结果
    } else if (SCAN_EXTS.has(basename(full).slice(basename(full).lastIndexOf('.')))) { // 代码块结束
      acc.push(full); // 执行当前业务步骤
    } // 代码块结束
  } // 代码块结束
  return acc; // 返回当前函数的处理结果
} // 代码块结束

function rel(p) { // 函数 rel：封装一段可复用的处理逻辑
  return relative(ROOT, p).replace(/\\/g, '/'); // 返回当前函数的处理结果
} // 代码块结束

function readText(p) { // 函数 readText：封装一段可复用的处理逻辑
  return existsSync(p) ? readFileSync(p, 'utf-8') : null; // 返回当前函数的处理结果
} // 代码块结束

// ---------- 结果容器 ----------
const assertions = {
  routes: { title: 'A. 路由装配', status: 'PASS', failures: [], warnings: [], stats: {} }, // 对象字段 routes：记录一项配置或数据
  schema: { title: 'B. 表结构接缝', status: 'PASS', failures: [], warnings: [], stats: {} }, // 对象字段 schema：记录一项配置或数据
  env: { title: 'C. 环境变量登记', status: 'PASS', failures: [], warnings: [], stats: {} }, // 对象字段 env：记录一项配置或数据
  frontend: { title: 'D. 前端接线', status: 'PASS', failures: [], warnings: [], stats: {} }, // 对象字段 frontend：记录一项配置或数据
  markers: { title: 'E. 未完成标记', status: 'PASS', failures: [], warnings: [], stats: {} }, // 对象字段 markers：记录一项配置或数据
}; // 代码块结束

function fail(assertion, item) { // 函数 fail：封装一段可复用的处理逻辑
  assertions[assertion].failures.push(item); // 执行当前业务步骤
  assertions[assertion].status = 'FAIL'; // 执行当前业务步骤
} // 代码块结束
function warn(assertion, item) { // 函数 warn：封装一段可复用的处理逻辑
  assertions[assertion].warnings.push(item); // 执行当前业务步骤
  if (assertions[assertion].status === 'PASS') assertions[assertion].status = 'WARN'; // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

// =====================================================================
// A. 路由装配
// =====================================================================
function checkRoutes() {
  const appText = readText(APP_TS); // 常量 appText：保存固定配置或一次性派生值
  if (appText === null) { // 条件分支：按判断结果选择后续处理路径
    fail('routes', { file: rel(APP_TS), reason: 'app.ts 缺失，无法核对路由装配' }); // 调用 fail 并处理其返回结果
    return; // 返回当前函数的处理结果
  } // 代码块结束
  const routeFiles = existsSync(ROUTE_DIR) // 常量 routeFiles：保存固定配置或一次性派生值
    ? readdirSync(ROUTE_DIR).filter((f) => f.endsWith('.ts')) // 执行当前业务步骤
    : []; // 执行当前业务步骤
  const factories = []; // 常量 factories：保存固定配置或一次性派生值
  for (const file of routeFiles) { // 循环：逐项遍历集合并执行相同处理
    const text = readText(join(ROUTE_DIR, file)) ?? ''; // 常量 text：保存固定配置或一次性派生值
    const names = [...text.matchAll(/export\s+(?:async\s+)?function\s+(create[A-Za-z0-9_]*Router)/g)].map( // 常量 names：保存固定配置或一次性派生值
      (m) => m[1], // 执行当前业务步骤
    ); // 执行当前业务步骤
    for (const name of names) factories.push({ file: rel(join(ROUTE_DIR, file)), name }); // 循环：逐项遍历集合并执行相同处理
  } // 代码块结束

  const unmounted = []; // 常量 unmounted：保存固定配置或一次性派生值
  for (const { file, name } of factories) { // 循环：逐项遍历集合并执行相同处理
    const imported = new RegExp(`import\\s*{[^}]*\\b${name}\\b`).test(appText); // 常量 imported：保存固定配置或一次性派生值
    // 挂载：app.use('...', createXxxRouter(...)) 直接调用，或受保护路由 for 循环数组内引用工厂
    const mounted =
      new RegExp(`app\\.use\\([^\\n]*\\b${name}\\b`).test(appText) || // 执行当前业务步骤
      new RegExp(`\\b${name}\\s*\\(`).test(appText); // 执行当前业务步骤
    if (!imported || !mounted) { // 条件分支：按判断结果选择后续处理路径
      unmounted.push({ file, factory: name, imported, mounted }); // 执行当前业务步骤
    } // 代码块结束
  } // 代码块结束

  assertions.routes.stats = { routeFiles: routeFiles.length, factories: factories.length, unmounted: unmounted.length }; // 执行当前业务步骤
  for (const item of unmounted) { // 循环：逐项遍历集合并执行相同处理
    fail('routes', { // 调用 fail 并处理其返回结果
      file: item.file, // 对象字段 file：记录一项配置或数据
      detail: `工厂 ${item.factory} 未挂载（import=${item.imported}, mounted=${item.mounted}）`, // 对象字段 detail：记录一项配置或数据
    }); // 代码块结束
  } // 代码块结束
} // 代码块结束

// =====================================================================
// B. 表结构接缝
// =====================================================================
function stripSqlLineComment(line) {
  // 去掉 -- 之后的行注释；单引号字符串内的 -- 不当作注释（DDL 默认值极少含 --，静态口径可接受）
  let inStr = false;
  for (let i = 0; i < line.length; i += 1) { // 循环：逐项遍历集合并执行相同处理
    if (line[i] === "'") inStr = !inStr; // 条件分支：按判断结果选择后续处理路径
    if (!inStr && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i); // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束
  return line; // 返回当前函数的处理结果
} // 代码块结束

function splitStatements(sql) { // 函数 splitStatements：封装一段可复用的处理逻辑
  return sql // 返回当前函数的处理结果
    .split(';') // 执行当前业务步骤
    .map((s) => s.trim()) // 执行当前业务步骤
    .filter(Boolean); // 执行当前业务步骤
} // 代码块结束

function checkSchema() { // 函数 checkSchema：封装一段可复用的处理逻辑
  const sqlFiles = existsSync(SCHEMA_D_DIR) // 常量 sqlFiles：保存固定配置或一次性派生值
    ? readdirSync(SCHEMA_D_DIR).filter((f) => f.endsWith('.sql')) // 执行当前业务步骤
    : []; // 执行当前业务步骤
  let nonIdempotent = 0; // 可变变量 nonIdempotent：运行过程中会被重新赋值
  let badDirectives = 0; // 可变变量 badDirectives：运行过程中会被重新赋值

  const ALTER_ADD_RE = /^\s*ALTER_ADD:\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/; // 常量 ALTER_ADD_RE：保存固定配置或一次性派生值

  for (const file of sqlFiles) { // 循环：逐项遍历集合并执行相同处理
    const full = join(SCHEMA_D_DIR, file); // 常量 full：保存固定配置或一次性派生值
    const lines = (readText(full) ?? '').split(/\r?\n/); // 常量 lines：保存固定配置或一次性派生值
    const codeLines = lines.map(stripSqlLineComment); // 常量 codeLines：保存固定配置或一次性派生值

    // 指令行合法性校验
    lines.forEach((raw, idx) => {
      if (/^\s*ALTER_ADD:/.test(raw) && !ALTER_ADD_RE.test(raw)) { // 条件分支：按判断结果选择后续处理路径
        badDirectives += 1; // 执行当前业务步骤
        fail('schema', { // 调用 fail 并处理其返回结果
          file: rel(full), // 对象字段 file：记录一项配置或数据
          line: idx + 1, // 对象字段 line：记录一项配置或数据
          detail: `非法 ALTER_ADD 指令（格式应为 \`ALTER_ADD: 表名 列名 <列定义>\`）: ${raw.trim()}`, // 对象字段 detail：记录一项配置或数据
        }); // 代码块结束
      } // 代码块结束
    }); // 代码块结束

    // 语句级幂等性校验
    const sqlCode = codeLines.join('\n');
    for (const stmt of splitStatements(sqlCode)) { // 循环：逐项遍历集合并执行相同处理
      const head = stmt.toUpperCase(); // 常量 head：保存固定配置或一次性派生值
      if (/^\s*DROP\s+(TABLE|INDEX)/.test(head)) { // 条件分支：按判断结果选择后续处理路径
        nonIdempotent += 1; // 执行当前业务步骤
        fail('schema', { file: rel(full), detail: `非幂等 DROP 语句: ${stmt.slice(0, 80)}` }); // 调用 fail 并处理其返回结果
      } else if (/^\s*DELETE\s+FROM/.test(head)) { // 代码块结束
        nonIdempotent += 1; // 执行当前业务步骤
        fail('schema', { file: rel(full), detail: `DELETE 语句禁止出现在 schema.d: ${stmt.slice(0, 80)}` }); // 调用 fail 并处理其返回结果
      } else if (/^\s*UPDATE\s+\w+/.test(head) && !/\bWHERE\b/.test(head)) { // 代码块结束
        nonIdempotent += 1; // 执行当前业务步骤
        fail('schema', { file: rel(full), detail: '无条件 UPDATE（缺 WHERE）: ' + stmt.slice(0, 80) }); // 调用 fail 并处理其返回结果
      } // 代码块结束
    } // 代码块结束
  } // 代码块结束

  // build.mjs 必须搬运 schema.d 目录
  const buildText = readText(API_BUILD_MJS);
  let copiesSchemaD = false; // 可变变量 copiesSchemaD：运行过程中会被重新赋值
  if (buildText === null) { // 条件分支：按判断结果选择后续处理路径
    fail('schema', { file: rel(API_BUILD_MJS), reason: 'mim-api build.mjs 缺失' }); // 调用 fail 并处理其返回结果
  } else { // 代码块结束
    copiesSchemaD = /cp\(\s*'src\/schema\.d'/.test(buildText) || /cp\(\s*"src\/schema\.d"/.test(buildText); // 赋值：更新变量 copiesSchemaD 的取值
    if (!copiesSchemaD) { // 条件分支：按判断结果选择后续处理路径
      fail('schema', { file: rel(API_BUILD_MJS), detail: 'build.mjs 未搬运 src/schema.d → dist/schema.d' }); // 调用 fail 并处理其返回结果
    } // 代码块结束
  } // 代码块结束

  assertions.schema.stats = { // 执行当前业务步骤
    sqlFiles: sqlFiles.length, // 对象字段 sqlFiles：记录一项配置或数据
    nonIdempotent, // 执行当前业务步骤
    badDirectives, // 执行当前业务步骤
    copiesSchemaD, // 执行当前业务步骤
  }; // 代码块结束
} // 代码块结束

// =====================================================================
// C. 环境变量登记
// =====================================================================
function collectRegistered() {
  const templateNames = new Set(); // 常量 templateNames：保存固定配置或一次性派生值
  const tplLines = readText(ENV_EXAMPLE)?.split(/\r?\n/) ?? []; // 常量 tplLines：保存固定配置或一次性派生值
  for (const line of tplLines) { // 循环：逐项遍历集合并执行相同处理
    const m = line.match(/^([A-Z][A-Z0-9_]*)[ \t]*=/); // 常量 m：保存固定配置或一次性派生值
    if (m) templateNames.add(m[1]); // 条件分支：按判断结果选择后续处理路径
  } // 代码块结束
  const inventoryText = readText(INVENTORY) ?? ''; // 常量 inventoryText：保存固定配置或一次性派生值
  const inventoryVars = new Set(); // 常量 inventoryVars：保存固定配置或一次性派生值
  for (const m of inventoryText.matchAll(/`(MIM_[A-Z0-9_]+)`/g)) inventoryVars.add(m[1]); // 循环：逐项遍历集合并执行相同处理
  const stems = []; // 常量 stems：保存固定配置或一次性派生值
  for (const m of inventoryText.matchAll(/`(MIM_[A-Z0-9_]+)\*`/g)) stems.push(m[1]); // 循环：逐项遍历集合并执行相同处理
  return { templateNames, inventoryVars, stems }; // 返回当前函数的处理结果
} // 代码块结束

function checkEnv() { // 函数 checkEnv：封装一段可复用的处理逻辑
  const registered = collectRegistered(); // 常量 registered：保存固定配置或一次性派生值
  const sourceVars = new Map(); // var -> [{file, line}]

  const roots = [...SOURCE_ROOTS, ...SCRIPT_ROOTS]; // 常量 roots：保存固定配置或一次性派生值
  for (const root of roots) { // 循环：逐项遍历集合并执行相同处理
    for (const file of walk(join(ROOT, root))) { // 循环：逐项遍历集合并执行相同处理
      const lines = (readText(file) ?? '').split(/\r?\n/); // 常量 lines：保存固定配置或一次性派生值
      lines.forEach((line, idx) => { // 执行当前业务步骤
        for (const m of line.matchAll(/MIM_[A-Z0-9_]+/g)) { // 循环：逐项遍历集合并执行相同处理
          const name = m[0]; // 常量 name：保存固定配置或一次性派生值
          if (name.endsWith('_')) continue; // 模板字符串动态前缀（MIM_AUTH_${ID}），跳过
          if (!sourceVars.has(name)) sourceVars.set(name, []); // 条件分支：按判断结果选择后续处理路径
          sourceVars.get(name).push({ file: rel(file), line: idx + 1 }); // 执行当前业务步骤
        } // 代码块结束
      }); // 代码块结束
    } // 代码块结束
  } // 代码块结束

  for (const [name, occurrences] of [...sourceVars.entries()].sort()) { // 循环：逐项遍历集合并执行相同处理
    const exact = registered.templateNames.has(name) || registered.inventoryVars.has(name); // 常量 exact：保存固定配置或一次性派生值
    const covered = registered.stems.some((stem) => name.startsWith(stem)); // 常量 covered：保存固定配置或一次性派生值
    if (exact || covered) continue; // 条件分支：按判断结果选择后续处理路径
    const files = occurrences.map((o) => o.file); // 常量 files：保存固定配置或一次性派生值
    const inScripts = files.some((f) => f.startsWith('scripts/') || f.startsWith('deploy/')); // 常量 inScripts：保存固定配置或一次性派生值
    const inBlueprint = files.some((f) => /(deploymentRegistry|siteModules)\.json$/.test(f)); // 常量 inBlueprint：保存固定配置或一次性派生值
    const internal = // 常量 internal：保存固定配置或一次性派生值
      INTERNAL_ENV_VARS.has(name) || // 执行当前业务步骤
      INTERNAL_ENV_PREFIXES.some((p) => name.startsWith(p)) || // 执行当前业务步骤
      inScripts || // 执行当前业务步骤
      inBlueprint; // 执行当前业务步骤
    const item = { // 常量 item：保存固定配置或一次性派生值
      var: name, // 对象字段 var：记录一项配置或数据
      internal, // 执行当前业务步骤
      locations: occurrences.slice(0, 5), // 对象字段 locations：记录一项配置或数据
      locationCount: occurrences.length, // 对象字段 locationCount：记录一项配置或数据
    }; // 代码块结束
    if (internal) { // 条件分支：按判断结果选择后续处理路径
      warn('env', item); // 调用 warn 并处理其返回结果
    } else { // 代码块结束
      fail('env', item); // 调用 fail 并处理其返回结果
    } // 代码块结束
  } // 代码块结束

  assertions.env.stats = { // 执行当前业务步骤
    sourceVars: sourceVars.size, // 对象字段 sourceVars：记录一项配置或数据
    templateVars: registered.templateNames.size, // 对象字段 templateVars：记录一项配置或数据
    inventoryVars: registered.inventoryVars.size, // 对象字段 inventoryVars：记录一项配置或数据
    wildcardStems: registered.stems.length, // 对象字段 wildcardStems：记录一项配置或数据
    unregistered: assertions.env.failures.length + assertions.env.warnings.length, // 对象字段 unregistered：记录一项配置或数据
    unregisteredAdapter: assertions.env.failures.length, // 对象字段 unregisteredAdapter：记录一项配置或数据
    unregisteredInternal: assertions.env.warnings.length, // 对象字段 unregisteredInternal：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

// =====================================================================
// D. 前端接线
// =====================================================================
function checkFrontend() {
  const appText = readText(APP_TSX) ?? ''; // 常量 appText：保存固定配置或一次性派生值
  const routerText = readText(ROUTER_TS) ?? ''; // 常量 routerText：保存固定配置或一次性派生值
  const viewFiles = existsSync(VIEWS_DIR) ? readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.tsx')) : []; // 常量 viewFiles：保存固定配置或一次性派生值

  // 收集其它视图之间的引用（用于识别「嵌套子组件」而非漏挂路由）
  const otherRefs = new Set();
  for (const file of viewFiles) { // 循环：逐项遍历集合并执行相同处理
    if (file === 'App.tsx') continue; // 条件分支：按判断结果选择后续处理路径
    const text = readText(join(VIEWS_DIR, file)) ?? ''; // 常量 text：保存固定配置或一次性派生值
    for (const m of text.matchAll(/from\s+'\.\/([A-Za-z0-9_]+)'/g)) otherRefs.add(m[1]); // 循环：逐项遍历集合并执行相同处理
  } // 代码块结束

  const unregistered = []; // 常量 unregistered：保存固定配置或一次性派生值
  for (const file of viewFiles) { // 循环：逐项遍历集合并执行相同处理
    const base = file.replace(/\.tsx$/, ''); // 常量 base：保存固定配置或一次性派生值
    const inApp = new RegExp(`views/${base}`).test(appText); // 常量 inApp：保存固定配置或一次性派生值
    const nested = otherRefs.has(base); // 常量 nested：保存固定配置或一次性派生值
    if (!inApp) { // 条件分支：按判断结果选择后续处理路径
      unregistered.push({ file: rel(join(VIEWS_DIR, file)), nested }); // 执行当前业务步骤
      if (nested) { // 条件分支：按判断结果选择后续处理路径
        warn('frontend', { file: rel(join(VIEWS_DIR, file)), detail: '未在 App.tsx 直接注册，但被其它视图作为子组件引用' }); // 调用 warn 并处理其返回结果
      } else { // 代码块结束
        fail('frontend', { file: rel(join(VIEWS_DIR, file)), detail: '视图既未在 App.tsx 注册，也未被其它视图引用' }); // 调用 fail 并处理其返回结果
      } // 代码块结束
    } // 代码块结束
  } // 代码块结束

  // VIEW_SEGMENTS 覆盖全部 AppView 标识
  const typeBlock = routerText.match(/export\s+type\s+AppView\s*=\s*([\s\S]*?);/);
  const viewIds = typeBlock // 常量 viewIds：保存固定配置或一次性派生值
    ? [...typeBlock[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]) // 执行当前业务步骤
    : []; // 执行当前业务步骤
  const segBlock = routerText.match(/const\s+VIEW_SEGMENTS[^=]*=\s*\{([\s\S]*?)\n\}/); // 常量 segBlock：保存固定配置或一次性派生值
  const segKeys = segBlock ? [...segBlock[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((m) => m[1]) : []; // 常量 segKeys：保存固定配置或一次性派生值
  const missingSegments = viewIds.filter((id) => !segKeys.includes(id)); // 常量 missingSegments：保存固定配置或一次性派生值
  for (const id of missingSegments) { // 循环：逐项遍历集合并执行相同处理
    fail('frontend', { detail: `AppView '${id}' 未在 VIEW_SEGMENTS 登记路径段` }); // 调用 fail 并处理其返回结果
  } // 代码块结束

  assertions.frontend.stats = { // 执行当前业务步骤
    viewFiles: viewFiles.length, // 对象字段 viewFiles：记录一项配置或数据
    unregistered: unregistered.length, // 对象字段 unregistered：记录一项配置或数据
    nested: unregistered.filter((u) => u.nested).length, // 对象字段 nested：记录一项配置或数据
    appViews: viewIds.length, // 对象字段 appViews：记录一项配置或数据
    segments: segKeys.length, // 对象字段 segments：记录一项配置或数据
    missingSegments: missingSegments.length, // 对象字段 missingSegments：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

// =====================================================================
// E. 未完成标记
// =====================================================================
const MARKER_RE = /\b(TODO|FIXME|XXX|HACK)\b|未实现|待实现/;

function classifyLine(line) { // 函数 classifyLine：封装一段可复用的处理逻辑
  const trimmed = line.trim(); // 常量 trimmed：保存固定配置或一次性派生值
  // 纯注释行
  if (/^(\/\/|\/\*|\*|--|#)/.test(trimmed)) return 'comment';
  // 去掉行尾 // 注释后再判断
  let inStr = false;
  let code = ''; // 可变变量 code：运行过程中会被重新赋值
  for (let i = 0; i < line.length; i += 1) { // 循环：逐项遍历集合并执行相同处理
    const ch = line[i]; // 常量 ch：保存固定配置或一次性派生值
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
