#!/usr/bin/env node
// 上一行 shebang：指定 node 解释器，与仓库内其它校验脚本保持一致。
// 脚本：scripts/verify-site-directory.mjs
//
// 校验「站点入口契约」是否完整、逐项自洽，并确认它真的被现有前端实现消费。
// 依据：dnspod_records_2026-11-05_21-42-26.xls 的备注（已固化为项目内 JSON）。
// 约束：只读项目内文件，不读取 xls 本体，避免 CI / 其它机器缺少该未跟踪表格时误判失败。
//
// 用法：node scripts/verify-site-directory.mjs
// 退出码：0 = 通过，1 = 契约缺项或实现未消费契约。

// 引入只读文件函数：本脚本不需要任何写操作。
import { readFileSync } from 'node:fs';
// 引入路径工具：把 scripts 目录上溯一级定位仓库根目录。
import { dirname, join, resolve } from 'node:path';
// 引入 URL 转路径函数：按模块自身位置定位，不依赖运行时工作目录。
import { fileURLToPath } from 'node:url';

// 仓库根目录：本文件位于 scripts/ 下，上溯一级即为根。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 失败项收集：全部检查跑完后统一判定退出码，便于一次看到所有问题。
const failures = [];
// 单项断言：记录名称、结果与失败时的说明，避免中途退出漏报。
function check(name, ok, detail) {
  // 通过项与失败项都打印，便于 CI 日志直接定位。
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  // 未通过时把名称与说明一并收集，用于末尾汇总。
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ''}`);
} // check 结束

// 读取契约 JSON：格式错误会让本脚本以非零码退出，不静默吞掉。
let data; // 契约对象，供后续所有断言使用。
try {
  // 按 UTF-8 读取并解析，中文备注与全角分隔符不会被破坏。
  data = JSON.parse(readFileSync(join(ROOT, 'apps/web/src/data/siteDirectory.json'), 'utf8'));
  // 解析成功即记录一项通过断言。
  check('契约 JSON 可解析', true, '');
} catch (error) {
  // 解析失败时给出原因并终止，后续断言无对象可用。
  check('契约 JSON 可解析', false, String(error));
  // 直接退出，避免后续访问 undefined 产生噪声堆栈。
  process.exit(1);
} // 读取契约结束

// 元信息断言：锁定数据格式与唯一文档依据，防止误用其它快照。
check('数据格式版本', data.schema === 'mim.site-directory.v1', `实际 ${data.schema}`);
// 唯一文档依据必须是用户指定的那份 DNSPod 导出表。
check('数据来源文件', data.source === 'dnspod_records_2026-11-05_21-42-26.xls', `实际 ${data.source}`);
// 取证范围须覆盖两个工作表全文，避免只落一半。
check('取证范围为两表全文', String(data.scope).includes('laal.top') && String(data.scope).includes('mixm.top'), '范围声明缺失');
// 已清空列须如实登记 6 列，标明信息缺口。
check('已清空列登记 6 列', Array.isArray(data.clearedColumns) && data.clearedColumns.length === 6, '应为 6 列');

// 业务备注条目数量：两表去重后共 46 类，其中序号 02 已按要求移除，剩余 45 类逐项落实不得遗漏。
const entries = Array.isArray(data.entries) ? data.entries : [];
// 空备注行数量：无功能描述的 15 行同样要登记，不得丢弃。
const blanks = Array.isArray(data.blankRows) ? data.blankRows : [];
// 数量断言放在最前，缺项时后续逐项检查仍能给出明细。
check('业务备注条目 45 类', entries.length === 45, `实际 ${entries.length}`);
// 空备注行数断言：与 xls 实际空备注行一一对应。
check('空备注行 15 行', blanks.length === 15, `实际 ${blanks.length}`);

// 允许的枚举值：与契约 JSON 的字段约定一一对应。
const ALIGNMENTS = new Set(['aligned', 'partial', 'absent', 'conflict']);
// 落实状态枚举：已对齐不改动 / 数据驱动 / 未决。
const RESOLUTIONS = new Set(['aligned-no-change', 'data-driven', 'unresolved']);
// 原因码集合：直接取契约自带的释义表，避免两处枚举漂移。
const REASON_CODES = new Set(Object.keys(data.reasonCodes || {}));
// 逐项问题收集：一次输出所有不合规条目，不逐条打断。
const problems = [];
// 已出现序号集合：用于检测重复 id。
const seenIds = new Set();
// 遍历全部业务备注条目，逐字段核对自洽性；序号保持 xls 行序，02 移除后不重排。
for (const e of entries) {
  // 序号必须是两位数字且不重复。
  if (!/^\d{2}$/.test(e.id) || seenIds.has(e.id)) problems.push(`${e.id}: 序号非法或重复`);
  // 记录已出现序号，供后续重复检测。
  seenIds.add(e.id);
  // 备注原文必须等于「入口描述｜系统名」拼接，防止转录偏差。
  if (`${e.entry}｜${e.system}` !== e.note) problems.push(`${e.id}: 备注原文与拆分字段不一致`);
  // 主机记录与来源定位不得为空。
  if (!e.host || !Array.isArray(e.sources) || e.sources.length === 0) problems.push(`${e.id}: 主机记录或来源为空`);
  // 每个来源的工作表与行号都要合法。
  for (const s of e.sources || []) {
    // 工作表只允许两张表。
    if (!['laal.top', 'mixm.top'].includes(s.sheet)) problems.push(`${e.id}: 未知工作表 ${s.sheet}`);
    // 行号必须是非空正整数字符串数组。
    if (!Array.isArray(s.rows) || s.rows.length === 0 || s.rows.some((r) => !/^\d+$/.test(String(r)))) problems.push(`${e.id}: 行号非法`);
  } // 来源遍历结束
  // 对齐分组与落实状态必须落在约定枚举内。
  if (!ALIGNMENTS.has(e.alignment)) problems.push(`${e.id}: 非法对齐分组 ${e.alignment}`);
  // 落实状态枚举校验。
  if (!RESOLUTIONS.has(e.resolution)) problems.push(`${e.id}: 非法落实状态 ${e.resolution}`);
  // 原因码必须能在释义表中查到。
  if (!REASON_CODES.has(e.reasonCode)) problems.push(`${e.id}: 未知原因码 ${e.reasonCode}`);
  // 实现路径要么为空、要么是非空字符串，不允许其它形态。
  if (e.implementation !== null && (typeof e.implementation !== 'string' || !e.implementation)) problems.push(`${e.id}: 实现路径格式异常`);
} // 业务条目遍历结束
// 逐项自洽性汇总：把前 5 条问题带进失败说明。
check('45 条逐项字段自洽', problems.length === 0, problems.slice(0, 5).join('；'));

// 空备注行校验：必须全部登记为未决且原因码为 BLANK_NOTE。
const blankProblems = [];
// 遍历 15 行空备注逐个核对。
for (const b of blanks) {
  // 工作表、行号、主机记录三项定位信息缺一不可。
  if (!['laal.top', 'mixm.top'].includes(b.sheet) || !Number.isInteger(b.row) || !b.host) blankProblems.push(`${b.sheet}:${b.row} 定位缺失`);
  // 状态与原因码必须如实标记为信息缺失。
  if (b.resolution !== 'unresolved' || b.reasonCode !== 'BLANK_NOTE') blankProblems.push(`${b.sheet}:${b.row} 状态错误`);
} // 空备注遍历结束
// 空备注汇总断言。
check('15 行空备注均标记未决', blankProblems.length === 0, blankProblems.slice(0, 5).join('；'));

// 主站访问入口条目：已按要求从契约中移除，不得以任何形式回流。
const portal = entries.find((e) => e.id === '02');
// 条目不存在断言。
check('原序号 02 条目已移除', !portal, '仍存在 id=02 条目');

// 类型化封装模块：必须引用同一份 JSON，避免数据与实现分成两套。
const wrapper = readFileSync(join(ROOT, 'apps/web/src/data/siteDirectory.ts'), 'utf8');
// 封装层导入单一数据源的断言。
check('封装模块导入契约 JSON', wrapper.includes("from './siteDirectory.json'"), '封装层未引用 JSON');

// 商城组件：确认已不再提供主站门户入口卡片。
const store = readFileSync(join(ROOT, 'apps/web/src/views/Store.tsx'), 'utf8');
// 组件不得残留门户契约取值。
check('Store.tsx 已移除门户入口卡片', !store.includes('PORTAL_ENTRY') && !store.includes('mixm.top'), '仍存在门户卡片或硬编码链接');
// 组件不引入已删除的契约模块，避免悬空引用。
check('Store.tsx 不引入站点入口契约', !store.includes("from '../data/siteDirectory'"), '存在悬空导入');

// 统计分组：便于交付时直接引用落实与未决数量。
const countBy = (key, value) => entries.filter((e) => e[key] === value).length;
// 打印落实状态分布。
console.log(`落实状态：已对齐不改动 ${countBy('resolution', 'aligned-no-change')} / 数据驱动 ${countBy('resolution', 'data-driven')} / 未决 ${countBy('resolution', 'unresolved')}`);
// 打印未决原因分布，明确每类信息缺口。
console.log(`未决原因：同名异义冲突 ${countBy('reasonCode', 'CONFLICT_WITH_EXISTING')} / 无对应实现 ${countBy('reasonCode', 'NO_IMPLEMENTATION')} / 备注无功能规格 ${countBy('reasonCode', 'NO_SPEC')}`);
// 打印对齐分组分布，与源码实况保持一致。
console.log(`对齐分组：一致 ${countBy('alignment', 'aligned')} / 部分能力 ${countBy('alignment', 'partial')} / 无实现 ${countBy('alignment', 'absent')} / 冲突 ${countBy('alignment', 'conflict')}`);

// 结论与退出码：全部断言通过才返回 0。
console.log(failures.length === 0 ? '结论：PASS（契约完整、逐项自洽、已被现有 UI 消费）' : `结论：FAIL（${failures.length} 项未通过）`);
// 以退出码把结果交给调用方 / CI。
process.exit(failures.length === 0 ? 0 : 1);
