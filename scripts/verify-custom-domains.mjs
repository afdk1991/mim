#!/usr/bin/env node
// 上一行 shebang：指定 node 解释器，与仓库内其它校验脚本保持一致。
// 脚本：scripts/verify-custom-domains.mjs
//
// 校验「多平台自定义域名矩阵」：部署矩阵里每个平台的自定义域名是否都来自 DNSPod 导出（dnspod_records_2026-11-05_21-42-26.xls）的 mixm.top 主机记录，
// 是否覆盖完整、无重复，是否与部署注册表（packages/core-domain/src/deploymentRegistry.json）一一对应，并且文档已同步登记。
// 约束：零第三方依赖、只读项目内文件；不修改文件、不发起网络请求。
//
// 用法：node scripts/verify-custom-domains.mjs
// 退出码：0 = 全通过，1 = 存在缺漏、重复、越界域名或文档漂移。

import { readFileSync, existsSync } from 'node:fs'; // 引入依赖、类型或本地模块绑定
import { dirname, join, resolve } from 'node:path'; // 引入依赖、类型或本地模块绑定
import { fileURLToPath } from 'node:url'; // 引入依赖、类型或本地模块绑定

// 仓库根目录：本文件位于 scripts/ 下，向上取一级。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 失败项收集：全部检查跑完后统一判定退出码。
const failures = [];
// 已检查项计数：末尾输出「N/N」汇总。
let total = 0;
// 单项断言：通过 / 失败都打印，失败时补充可定位说明。
function check(name, ok, detail = '') {
  // 计数自增，末尾汇总用。
  total += 1;
  // 输出带状态符号的断言名。
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  // 失败收集名称与原因，供退出码判定。
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ''}`);
} // check 结束

// 读取仓库内 UTF-8 文本；缺失返回空串，让断言失败而不是抛异常。
function read(rel) {
  // 拼接绝对路径，中文文件名同样按 UTF-8 读取。
  const path = join(ROOT, rel);
  // 存在则读全文，缺失留给断言报错。
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
} // read 结束

// ---------- 1. 数据文件形状 ----------
// 自定义域名矩阵：本轮新增的单一事实源。
const DOM = JSON.parse(read('packages/core-domain/src/customDomains.json') || '{}');
// 部署注册表：平台与部署项的既有事实源。
const REG = JSON.parse(read('packages/core-domain/src/deploymentRegistry.json') || '{}');

check('D01 自定义域名矩阵存在且 schema 正确', DOM.schema === 'mim.custom-domains.v1', `schema=${DOM.schema}`); // 调用 check 并处理其返回结果
// 主机清单：来自 DNSPod 导出的 mixm.top 工作表。
const hosts = DOM.hostsInZone ?? [];
check('D02 主机清单非空且覆盖 45 类模块入口', hosts.length >= 45, `hosts=${hosts.length}`); // 调用 check 并处理其返回结果
// 每条主机记录须有 fqdn 与来源行号。
const hostOk = hosts.every((h) => typeof h.fqdn === 'string' && (h.fqdn === DOM.zone || h.fqdn.endsWith(`.${DOM.zone}`)) && Array.isArray(h.xls_rows) && h.xls_rows.length > 0);
check('D03 每条主机记录都有 fqdn 与 xls 行号', hostOk, hostOk ? '' : hosts.filter((h) => !(typeof h.fqdn === 'string' && (h.fqdn === DOM.zone || h.fqdn.endsWith(`.${DOM.zone}`)) && Array.isArray(h.xls_rows) && h.xls_rows.length > 0)).map((h) => h.fqdn).join(',')); // 调用 check 并处理其返回结果
// 行号必须落在导出的真实数据区内（上界取 source.raw_rows 里 mixm.top 工作表的行数）。
const maxRow = DOM.source?.raw_rows?.['mixm.top'] ?? 0;
const rowsOk = Number.isInteger(maxRow) && hosts.every((h) => h.xls_rows.every((r) => Number.isInteger(r) && r >= 1 && r <= maxRow)); // 常量 rowsOk：保存固定配置或一次性派生值
check('D04 主机记录行号在 mixm.top 工作表范围内', rowsOk, rowsOk ? '' : `maxRow=${maxRow}`); // 调用 check 并处理其返回结果

// ---------- 2. 矩阵行与注册表一一对应 ----------
// 矩阵行：本轮 11 个平台 + Worker 的域名归属。
const matrix = DOM.matrix ?? [];
// 注册表部署项索引：按 id 取，用于核对 deployment_id 真实存在。
const itemsById = new Map((REG.items ?? []).map((it) => [it.id, it]));
// 平台目录索引：用于核对 platform_id 与矩阵成员身份。
const platformsById = new Map((REG.platform_catalog ?? []).map((p) => [p.id, p]));

// 覆盖口径：只看注册表中标记为矩阵成员的平台；同一平台可有多条归属行（如 Cloudflare Pages 与独立 Worker），按平台去重
const inMatrixPlatformIds = (REG.platform_catalog ?? []).filter((p) => p.in_matrix).map((p) => p.id);
const coveredPlatforms = new Set([ // 常量 coveredPlatforms：保存固定配置或一次性派生值
  ...matrix.filter((m) => platformsById.get(m.platform_id)?.in_matrix).map((m) => m.platform_id), // 执行当前业务步骤
  ...(DOM.notApplicable ?? []).map((n) => n.platform_id), // 执行当前业务步骤
]); // 执行当前业务步骤
const missingPlatforms = inMatrixPlatformIds.filter((id) => !coveredPlatforms.has(id)); // 常量 missingPlatforms：保存固定配置或一次性派生值
check('D05 矩阵行与不适用说明合计覆盖 11 个平台', inMatrixPlatformIds.length === 11 && missingPlatforms.length === 0, `platforms=${inMatrixPlatformIds.length} rows=${matrix.length} na=${(DOM.notApplicable ?? []).length} missing=${missingPlatforms.join(',')}`); // 调用 check 并处理其返回结果
// 每行的 deployment_id 必须能在注册表里找到。
const depOk = matrix.every((m) => itemsById.has(m.deployment_id));
check('D06 每个矩阵行都指向注册表中真实存在的部署项', depOk, depOk ? '' : `missing=${matrix.filter((m) => !itemsById.has(m.deployment_id)).map((m) => m.deployment_id).join(',')}`); // 调用 check 并处理其返回结果
// platform_id 必须落在平台目录内。
const platOk = matrix.every((m) => platformsById.has(m.platform_id));
check('D07 每个矩阵行的平台编码都在 platform_catalog 中', platOk, platOk ? '' : `bad=${matrix.filter((m) => !platformsById.has(m.platform_id)).map((m) => m.platform_id).join(',')}`); // 调用 check 并处理其返回结果

// 反向覆盖：矩阵成员的每个平台都必须有域名归属（矩阵行或 notApplicable 说明）。
// matrix_platforms 在注册表里是「矩阵平台数量」，复用上方 inMatrixPlatformIds 清单。
const matrixCount = REG.coverage?.matrix_platforms;
check('D08a 注册表矩阵平台数量与 in_matrix 标记一致', matrixCount === inMatrixPlatformIds.length, `coverage=${matrixCount} catalog=${inMatrixPlatformIds.length}`); // 调用 check 并处理其返回结果
const naIds = new Set((DOM.notApplicable ?? []).map((n) => n.platform_id)); // 常量 naIds：保存固定配置或一次性派生值
const mappedIds = new Set(matrix.filter((m) => platformsById.get(m.platform_id)?.in_matrix).map((m) => m.platform_id)); // 常量 mappedIds：保存固定配置或一次性派生值
const uncovered = inMatrixPlatformIds.filter((id) => !mappedIds.has(id) && !naIds.has(id)); // 常量 uncovered：保存固定配置或一次性派生值
check('D08 部署矩阵 11 个平台全部有自定义域名归属', uncovered.length === 0, uncovered.join(',')); // 调用 check 并处理其返回结果

// ---------- 3. 域名合法性 ----------
// 所有自定义域名必须落在本仓自有 zone 内。
const zoneOk = matrix.every((m) => typeof m.custom_domain === 'string' && m.custom_domain.endsWith(`.${DOM.zone}`));
check('D09 自定义域名全部属于 mixm.top zone', zoneOk, zoneOk ? '' : matrix.filter((m) => !m.custom_domain.endsWith(`.${DOM.zone}`)).map((m) => m.custom_domain).join(',')); // 调用 check 并处理其返回结果
// 每个自定义域名必须能在导出的主机清单里找到（杜绝凭记忆编造域名）。
const hostSet = new Set(hosts.map((h) => h.fqdn));
const fromXls = matrix.every((m) => hostSet.has(m.custom_domain)); // 常量 fromXls：保存固定配置或一次性派生值
check('D10 自定义域名逐一来自 xls 主机清单', fromXls, fromXls ? '' : matrix.filter((m) => !hostSet.has(m.custom_domain)).map((m) => m.custom_domain).join(',')); // 调用 check 并处理其返回结果
// 同一域名不得分配给两个平台。
const dupes = matrix.map((m) => m.custom_domain).filter((d, i, arr) => arr.indexOf(d) !== i);
check('D11 自定义域名无重复分配', dupes.length === 0, dupes.join(',')); // 调用 check 并处理其返回结果
// 保留域名（已解析到生产 CVM 的 cloud）不得同时出现在矩阵里。
const reservedDup = (DOM.reserved ?? []).filter((r) => matrix.some((m) => m.custom_domain === r.fqdn));
check('D12 保留域名不出现在平台分配中', reservedDup.length === 0, reservedDup.map((r) => r.fqdn).join(',')); // 调用 check 并处理其返回结果

// ---------- 4. 状态与证据 ----------
// 状态枚举：live / pending_dns（其余状态由 reserved / notApplicable 承载）。
const statuses = new Set(['live', 'pending_dns']);
const statusOk = matrix.every((m) => statuses.has(m.status)); // 常量 statusOk：保存固定配置或一次性派生值
check('D13 矩阵行状态取值合法', statusOk, statusOk ? '' : matrix.filter((m) => !statuses.has(m.status)).map((m) => m.status).join(',')); // 调用 check 并处理其返回结果
// live 行必须带可核验的取证描述，避免「已上线」空口断言。
const liveOk = matrix.filter((m) => m.status === 'live').every((m) => typeof m.evidence === 'string' && m.evidence.length > 20);
check('D14 live 域名均带线上取证', liveOk); // 调用 check 并处理其返回结果
// pending 行必须写明下一步动作，便于交接。
const pendingOk = matrix.filter((m) => m.status === 'pending_dns').every((m) => Array.isArray(m.next_steps) && m.next_steps.length > 0);
check('D15 pending 域名均写明下一步', pendingOk); // 调用 check 并处理其返回结果
// 待办清单非空，确保后续动作可追踪。
check('D16 pendingActions 已登记', Array.isArray(DOM.pendingActions) && DOM.pendingActions.length >= 2);

// ---------- 5. 文档同步（铁律七） ----------
// 矩阵列出的每个域名都必须出现在 AGENTS.md 与 runbook 的自定义域名表中，缺一视为文档漂移。
const agents = read('AGENTS.md');
const runbook = read('docs/wiki/05-runbook.md'); // 常量 runbook：保存固定配置或一次性派生值
const missingAgents = matrix.filter((m) => !agents.includes(m.custom_domain)).map((m) => m.custom_domain); // 常量 missingAgents：保存固定配置或一次性派生值
const missingRunbook = matrix.filter((m) => !runbook.includes(m.custom_domain)).map((m) => m.custom_domain); // 常量 missingRunbook：保存固定配置或一次性派生值
check('D17 AGENTS.md 已登记全部自定义域名', missingAgents.length === 0, missingAgents.join(',')); // 调用 check 并处理其返回结果
check('D18 runbook 已登记全部自定义域名', missingRunbook.length === 0, missingRunbook.join(',')); // 调用 check 并处理其返回结果
// 数据文件本身也要被文档指向，避免后续找不到事实源。
check('D19 文档引用自定义域名矩阵文件路径', agents.includes('customDomains.json') && runbook.includes('customDomains.json'));

// ---------- 6. 汇总 ----------
console.log('');
if (failures.length === 0) { // 条件分支：按判断结果选择后续处理路径
  console.log(`✅ 自定义域名矩阵校验：${total}/${total} PASS`); // 向控制台输出运行日志或错误信息
  process.exit(0); // 执行当前业务步骤
} // 代码块结束
console.log(`❌ 自定义域名矩阵校验：${total - failures.length}/${total} PASS，失败项 ${failures.length} 条：`); // 向控制台输出运行日志或错误信息
for (const f of failures) console.log(`   - ${f}`); // 循环：逐项遍历集合并执行相同处理
process.exit(1); // 执行当前业务步骤
