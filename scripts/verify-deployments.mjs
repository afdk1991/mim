#!/usr/bin/env node
// 上一行 shebang：指定 node 解释器，与仓库内其它校验脚本保持一致。
// scripts/verify-deployments.mjs
//
// 校验「部署汇总」是否自洽、覆盖完整、无重复，并且真的被共享包 → 后端 → 前端 → 文档全链路消费。
// 依据：packages/core-domain/src/deploymentRegistry.json 单一事实源 + 本轮实现源码 + git 仓库真实状态。
// 约束：零第三方依赖、只读项目内文件；不修改任何文件，不发起网络请求。
//
// 用法：node scripts/verify-deployments.mjs
// 退出码：0 = 全通过，1 = 存在漂移、遗漏、重复或链路断链。

// 只读文件工具：本脚本不产生任何写操作。
import { readFileSync, existsSync } from 'node:fs';
// 子进程：仅用于 git ls-tree / git remote 这类只读仓库查询。
import { spawnSync } from 'node:child_process';
// 路径工具：按脚本自身位置上溯一级定位仓库根目录。
import { dirname, join, resolve } from 'node:path';
// URL 转路径：不依赖运行时 cwd，任意目录执行都指向同一仓库。
import { fileURLToPath } from 'node:url';

// 仓库根目录：本文件位于 scripts/ 下。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 失败项收集：全部检查跑完后统一判定退出码，便于一次看到全部问题。
const failures = [];
// 已检查项计数：末尾输出汇总数值。
let total = 0;
// 单项断言：通过 / 失败都打印，失败时附带可定位说明。
function check(name, ok, detail = '') {
  // 计数自增，用于末尾「N/N」汇总。
  total += 1;
  // 输出带状态符号的断言名，失败时补充原因。
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  // 未通过时收集名称与说明。
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ''}`);
} // check 结束

// 读取仓库内文件为 UTF-8 文本；缺失时返回空串，让相关断言失败而非崩溃。
function read(rel) {
  // 拼接绝对路径，中文文件名同样按 UTF-8 读取。
  const path = join(ROOT, rel);
  // 不存在返回空串，存在则读全文。
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
} // read 结束

// 判断工作树文件是否存在。
function has(rel) {
  // 统一走 join，避免相对路径受 cwd 影响。
  return existsSync(join(ROOT, rel));
} // has 结束

// 只读 git 查询：用于核对工件在远端 HEAD 中是否存在。
function inHead(rel) {
  // git cat-file -e 成功即表示该路径存在于 HEAD 树。
  const r = spawnSync('git', ['cat-file', '-e', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  // 退出码 0 为存在。
  return r.status === 0;
} // inHead 结束

// ---------- 1. 单一事实源形状与枚举 ----------
// 读取契约：后续所有断言都以它为基准。
const REG = JSON.parse(read('packages/core-domain/src/deploymentRegistry.json'));
// 常用集合：避免每个断言重复构造。
const items = REG.items ?? [];
const platformIds = new Set((REG.platform_catalog ?? []).map((p) => p.id));
const ciJobIds = new Set((REG.ci_jobs ?? []).map((j) => j.id));
const statusCodes = new Set(Object.keys(REG.status_codes ?? {}));
const verdictCodes = new Set(Object.keys(REG.verdict_codes ?? {}));
const severityCodes = new Set(Object.keys(REG.severity_codes ?? {}));
const layerCodes = new Set(Object.keys(REG.layer_codes ?? {}));
const modes = new Set(['ci', 'manual', 'push']);

// 契约版本：防止读到旧格式却按新字段解析。
check('D01 契约 schema = mim.deployment-registry.v1', REG.schema === 'mim.deployment-registry.v1', REG.schema);
// 部署项总数与覆盖口径一致。
check('D02 部署项数 = coverage.deployment_items', items.length === REG.coverage?.deployment_items, `${items.length} vs ${REG.coverage?.deployment_items}`);
// 9 平台矩阵口径。
const matrixPlatforms = (REG.platform_catalog ?? []).filter((p) => p.in_matrix).length;
check('D03 平台目录 in_matrix = 9 且等于 coverage.matrix_platforms', matrixPlatforms === 9 && matrixPlatforms === REG.coverage?.matrix_platforms, String(matrixPlatforms));
// CI 作业口径：5 个作业、4 个部署作业。
check('D04 CI 作业 5 个、部署作业 4 个', REG.ci_jobs?.length === 5 && REG.ci_jobs.filter((j) => j.is_deploy).length === 4);
// git 远端口径。
check('D05 git 远端声明 = 2', REG.coverage?.git_remotes === 2, String(REG.coverage?.git_remotes));

// 规范 id 唯一：这是「避免重复」的核心断言。
const ids = items.map((i) => i.id);
const dupIds = ids.filter((id, idx) => ids.indexOf(id) !== idx);
check('D06 规范 id 全表唯一（无重复项）', dupIds.length === 0, dupIds.join(', '));
// 平台编码合法。
check('D07 platform_id 全部落在平台目录', items.every((i) => platformIds.has(i.platform_id)), items.filter((i) => !platformIds.has(i.platform_id)).map((i) => i.id).join(', '));
// 层级合法。
check('D08 layer 全部落在层级字典', items.every((i) => layerCodes.has(i.layer)));
// 状态合法。
check('D09 status 全部落在状态字典', items.every((i) => statusCodes.has(i.status)), items.filter((i) => !statusCodes.has(i.status)).map((i) => i.id).join(', '));
// 结果合法：null 或字典内 verdict。
check('D10 result 为 null 或 verdict 合法', items.every((i) => i.result === null || verdictCodes.has(i.result.verdict)));
// 严重度合法。
check('D11 异常 severity 全部落在严重度字典', items.every((i) => i.anomalies.every((a) => severityCodes.has(a.severity))));
// 交付方式合法。
check('D12 delivery.mode 合法', items.every((i) => modes.has(i.delivery.mode)));
// CI 作业引用合法。
check('D13 delivery.ci_job 为 null 或已登记作业', items.every((i) => i.delivery.ci_job === null || ciJobIds.has(i.delivery.ci_job)));
// 仓库标识格式：null 或含冒号分隔的规范 ID。
check('D14 repository.id 为 null 或带命名空间冒号', items.every((i) => i.repository.id === null || /^[a-z0-9-]+:.+/.test(i.repository.id)));
// 取证来源非空。
check('D15 每项 sources 非空', items.every((i) => Array.isArray(i.sources) && i.sources.length > 0));
// 空数据必须被清晰标识：result=null 时须有 EMPTY_RESULT 异常与 http_code 缺失项。
const emptyItems = items.filter((i) => i.result === null);
check('D16 空数据项均标注 EMPTY_RESULT 与缺失 http_code', emptyItems.every((i) => i.anomalies.some((a) => a.code === 'EMPTY_RESULT') && i.missing_fields.includes('http_code')), emptyItems.map((i) => i.id).join(', '));
// 失败 / 阻断状态必须有异常说明，不允许静默失败。
check('D17 BROKEN / FAIL 项均有异常说明', items.filter((i) => i.status === 'BROKEN' || i.result?.verdict === 'FAIL').every((i) => i.anomalies.length > 0));
// 异常码在单项内唯一。
check('D18 单项内异常码不重复', items.every((i) => new Set(i.anomalies.map((a) => a.code)).size === i.anomalies.length));
// 别名不得撞上其它项的 id / name（否则说明重复计数）。
const canonical = new Set([...ids, ...items.map((i) => i.name)]);
const aliasClash = items.flatMap((i) => i.aliases.filter((a) => canonical.has(a)).map((a) => `${i.id}:${a}`));
check('D19 别名不与其它项的规范名冲突', aliasClash.length === 0, aliasClash.join(', '));
// 9 个矩阵平台每个至少有一个部署项（避免遗漏）。
const covered = new Set(items.map((i) => i.platform_id));
const missed = [...platformIds].filter((id) => REG.platform_catalog.find((p) => p.id === id)?.in_matrix && !covered.has(id));
check('D20 9 个矩阵平台均有部署项覆盖（无遗漏）', missed.length === 0, missed.join(', '));
// 排除项不得与部署项 id 冲突。
check('D21 候选 / 排除项 id 不与部署项冲突', (REG.excluded ?? []).every((e) => !ids.includes(e.id)));
// 覆盖说明必须写明去重与补齐依据。
check('D22 覆盖口径含去重 / 补齐 / 排除说明', Boolean(REG.coverage?.dedup_note && REG.coverage?.added_note && REG.coverage?.excluded_note));
// 关键异常码必须存在：生产不可达、CI 悬空风险、WAF 假阳性、远端超时。
const allCodes = new Set(items.flatMap((i) => i.anomalies.map((a) => a.code)));
// 工件类异常码允许两种形态：MISSING（工作树确实缺失）或 RESTORED（已恢复并留痕）；
// 其余四类异常码必须在数据中出现，防止异常码体系被静默删减。
check('D23 关键异常码齐备', ['PRODUCTION_UNREACHABLE', 'WAF_FALSE_POSITIVE', 'REMOTE_TIMEOUT', 'DUPLICATE_MATRIX_ROW_MERGED'].every((c) => allCodes.has(c)) && ['WORKTREE_ARTIFACT_MISSING', 'WORKTREE_ARTIFACT_RESTORED'].some((c) => allCodes.has(c)));

// ---------- 2. 与真实仓库状态交叉核对 ----------
// 共享包实现存在并导出汇总函数。
const regTs = read('packages/core-domain/src/deploymentRegistry.ts');
check('D24 共享包导出 deploymentSummary / listDeploymentItems / findDeploymentItem', ['deploymentSummary', 'listDeploymentItems', 'findDeploymentItem'].every((fn) => regTs.includes(fn)));
// barrel 导出。
check('D25 core-domain barrel 导出部署注册表', read('packages/core-domain/src/index.ts').includes("deploymentRegistry.js"));
// 工件双口径声明与真实仓库一致；artifact_in_head 为 null 的构建产物不适用该口径，跳过核对。
const artifactItems = items.filter((i) => i.delivery.artifact && i.delivery.artifact_in_head !== null);
const artifactDrift = artifactItems.filter((i) => i.delivery.artifact_in_worktree !== has(i.delivery.artifact) || i.delivery.artifact_in_head !== inHead(i.delivery.artifact));
check('D26 工件 in_head / in_worktree 声明与真实仓库一致', artifactDrift.length === 0, artifactDrift.map((i) => i.id).join(', '));
// 漂移项必须在异常里给出提示，避免静默悬空风险。
const driftItems = artifactItems.filter((i) => i.delivery.artifact_in_head === true && i.delivery.artifact_in_worktree === false);
check('D27 工作树漂移项均有 *_WORKTREE_MISSING 异常', driftItems.every((i) => i.anomalies.some((a) => /WORKTREE_MISSING|ARTIFACT_MISSING/.test(a.code))), driftItems.map((i) => i.id).join(', '));
// CI 步骤声明必须能在 deploy.yml 文本中找到。
const ciText = read('.github/workflows/deploy.yml');
const stepMissing = items.filter((i) => i.delivery.ci_step && !ciText.includes(i.delivery.ci_step)).map((i) => `${i.id}:${i.delivery.ci_step}`);
check('D28 声明的 CI 步骤均存在于 deploy.yml', stepMissing.length === 0, stepMissing.join(', '));
// CI 作业声明必须与工作流一致。
check('D29 ci_jobs 与 deploy.yml 作业一致', (REG.ci_jobs ?? []).every((j) => new RegExp(`^  ${j.id}:\\s*$`, 'm').test(ciText)));
// git 远端真实数量与声明一致。
const remoteOut = spawnSync('git', ['remote'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
const remoteNames = (remoteOut.stdout ?? '').trim().split('\n').filter(Boolean);
check('D30 真实 git 远端数 = coverage.git_remotes', remoteNames.length === REG.coverage?.git_remotes, remoteNames.join(', '));

// ---------- 3. 后端 / 前端 / 测试全链路消费 ----------
// 后端路由文件存在。
check('D31 后端部署汇总路由文件存在', has('services/mim-api/src/routes/deployments.ts'));
// 路由挂到 app.ts。
check('D32 app.ts 挂载 createDeploymentsRouter', read('services/mim-api/src/app.ts').includes('createDeploymentsRouter'));
// 三个公开端点齐备。
const routeText = read('services/mim-api/src/routes/deployments.ts');
check('D33 后端三端点 overview / 列表 / 详情齐备', ['/deployments/overview', "router.get('/deployments'", "router.get('/deployments/:id'"].every((s) => routeText.includes(s)));
// 后端复用共享包汇总函数，杜绝第二套口径。
check('D34 后端复用共享包 deploymentSummary / listDeploymentItems', routeText.includes('deploymentSummary') && routeText.includes('listDeploymentItems'));
// 契约测试存在。
check('D35 后端契约测试存在', has('services/mim-api/test/deployments.test.ts'));
// 前端视图存在。
check('D36 前端部署汇总视图存在', has('apps/web/src/views/Deployments.tsx'));
// 前端 API 分组存在。
check('D37 前端 api.ts 含 deployments 分组', read('apps/web/src/api.ts').includes('deployments: {'));
// 路由视图标识存在。
check('D38 前端 router.ts 注册 deployments 视图', read('apps/web/src/router.ts').includes("'deployments'"));
// 根组件渲染与导航项存在。
const appText = read('apps/web/src/App.tsx');
check('D39 App.tsx 渲染并导航部署汇总视图', appText.includes('<Deployments') && appText.includes("view: 'deployments'"));
// 四个核心字段表头齐全，便于核对。
const viewText = read('apps/web/src/views/Deployments.tsx');
check('D40 前端表头含仓库标识 / 部署状态 / 部署结果 / 异常说明', ['仓库标识', '部署状态', '部署结果', '异常说明'].every((s) => viewText.includes(s)));
// 空数据 / 失败 / 缺失三种标识必须在视图里彼此可区分。
check('D41 前端区分空数据 / 失败 / 缺失三类标识', ['空数据', '失败', '缺失'].every((s) => viewText.includes(s)));
// 样式类存在。
check('D42 样式表含部署汇总专用类', read('apps/web/src/styles.css').includes('.deploy-'));
// 汇总生成器与校验器存在。
check('D43 汇总生成器 / 校验器均存在', has('scripts/deployment-summary.mjs') && has('scripts/verify-deployments.mjs'));
// package.json 注册两个脚本。
const pkg = read('package.json');
check('D44 package.json 注册 summary:deployments / verify:deployments', pkg.includes('summary:deployments') && pkg.includes('verify:deployments'));

// ---------- 4. 文档同步（铁律七）与结构化产物 ----------
// README 同步。
const readme = read('README.md');
check('D45 README 同步部署汇总章节 / 端点 / 脚本', readme.includes('部署汇总') && readme.includes('/deployments/overview') && readme.includes('summary:deployments'));
// AGENTS.md 同步（不改铁律语义，追加章节）。
check('D46 AGENTS.md 同步部署汇总口径', read('AGENTS.md').includes('部署汇总'));
// Wiki 同步。
check('D47 Wiki 架构 / 模块 / runbook 同步', ['docs/wiki/01-architecture.md', 'docs/wiki/02-modules.md', 'docs/wiki/05-runbook.md'].every((f) => read(f).includes('部署汇总')));
// PRD 同步。
check('D48 Mim-PRD.html 同步部署汇总模块', read('Mim-PRD.html').includes('部署汇总'));
// 结构化产物存在且 schema / 项数一致。
const outJson = read('docs/deployment-summary.json');
let report = null;
try { report = outJson ? JSON.parse(outJson) : null; } catch { /* 解析失败按 null 处理，由下一条断言报告 */ }
check('D49 结构化结果 docs/deployment-summary.json 可读且 schema 一致', Boolean(report) && report.schema === REG.schema);
check('D50 结构化结果部署项数与契约一致', Boolean(report) && report.items?.length === items.length, report ? String(report.items?.length) : '产物缺失');
// Markdown 核对表存在且四类核心字段齐全。
const outMd = read('docs/deployment-summary.md');
check('D51 核对表 docs/deployment-summary.md 含四列核心字段', ['仓库标识', '部署状态', '部署结果', '异常说明'].every((s) => outMd.includes(s)));
// 核对表逐项覆盖（每个 id 都出现）。
check('D52 核对表逐项覆盖全部部署项', items.every((i) => outMd.includes(`\`${i.id}\``)));

// ---------- 汇总判定 ----------
// 输出总数与通过数，便于一眼看出是否全绿。
console.log(`\n${failures.length === 0 ? '✅' : '❌'} 部署汇总校验：${total - failures.length}/${total} PASS`);
// 有失败项时逐条列出并退出 1。
if (failures.length > 0) {
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
} // 失败分支结束
