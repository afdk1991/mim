#!/usr/bin/env node
// 上一行 shebang：指定 node 解释器，与仓库内其它校验脚本保持一致。
// 脚本：scripts/verify-site-modules.mjs
//
// 校验「统一入口配置清单」是否与用户给出的 44 类备注逐字一致、去重整理正确、
// 不含任何具体主机值，并确认它真的被后端 API、数据库、前端视图与测试全链路消费。
// 依据：用户 2026-11-09 消息中的「主机记录 + 备注」文本与备注列截图
// （等价于 dnspod_records_2026-11-05_21-42-26.xls 的 mixm.top 工作表第 4–93 行）。
// 约束：零第三方依赖、只读项目内文件；不读取 xls 本体，避免其它机器缺少该表格时误判。
//
// 用法：node scripts/verify-site-modules.mjs
// 退出码：0 = 全通过，1 = 存在漂移或链路断链。

// 只读文件工具：本脚本不产生任何写操作。
import { readFileSync, existsSync } from 'node:fs';
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

// ---------- 1. 用户依据：44 类备注原文 + 本轮占位键（顺序与 mixm.top 工作表一致） ----------
// 该表由用户 2026-11-09 消息逐字转录，每类备注在台账中出现两行，按「完全相同且用途一致按一项」去重；
// 原序号 02 条目已按要求于 2026-11-12 移除，剩余 44 条。
// 逐字比对的意义：任何人工改写、漏字、全角竖线替换都会让本脚本失败。
const EXPECTED_NOTES = [
  ['PORTAL_ROOT', '核心根域名，主站基础入口｜主站统一跳转门户'],
  ['ADMIN_CONSOLE', '管理后台入口｜全站统一运营管理后台'],
  ['API_GATEWAY', '接口服务入口｜API 统一网关'],
  ['APP_API', 'APP 端接口入口｜移动端专属接口服务'],
  ['AUTH_CENTER', '权限验证入口｜统一身份认证与权限中心'],
  ['BLOG', '博客模块入口｜官方博客系统'],
  ['MEMBER_CENTER', '用户中心入口｜用户个人中心 / 会员工作台'],
  ['CLOUD_DRIVE', '云服务模块入口｜私有云盘 / 网盘系统'],
  ['OPEN_DATA', '数据中心入口｜开放数据集平台'],
  ['DEV_PORTAL', '开发测试入口｜开发环境门户 + 接口文档'],
  ['NAVIGATION', '导航模块入口｜全站资源导航站'],
  ['LOWCODE', '代码生成工具入口｜低代码生成平台'],
  ['UGC_VIDEO', '视频动态模块入口｜UGC 短视频动态社区'],
  ['OPS_MONITOR', '服务器支撑入口｜运维监控面板'],
  ['GALE_TOOLS', '工具模块核心入口，疾风引擎承载节点｜疾风引擎在线工具平台'],
  ['HELP_CENTER', '帮助中心入口｜产品帮助文档中心'],
  ['IMAGE_ASSETS', '图片资源入口｜公共图床 + 素材资源站'],
  ['SSO_LOGIN', '登录验证入口｜统一单点登录页'],
  ['MALL_B2C', '电商商城入口｜B2C 官方商城系统'],
  ['MARKETING', '营销模块入口｜营销活动管理平台'],
  ['MOBILE_H5', '移动端适配入口｜移动端 H5 精简版官网'],
  ['MOBILE_FULL', '移动终端专用入口｜全功能移动端站点'],
  ['NEWS_PUBLISH', '资讯模块入口｜新闻资讯发布系统'],
  ['PAYMENT_GATEWAY', '支付结算入口｜支付聚合网关 + 对账系统'],
  ['INTRANET_PORTAL', '门户首页入口｜企业内部统一门户 / 工作台'],
  ['SECURITY_CENTER', '安全防护入口｜安全防护中心'],
  ['SERVICE_GOVERNANCE', '服务支撑入口｜服务治理监控平台'],
  ['MULTI_MERCHANT', '线上店铺入口｜多商户店铺系统'],
  ['CRAWLER_SCHEDULER', '数据采集入口｜爬虫调度与数据采集平台'],
  ['VOD_LONG_VIDEO', '视频模块入口｜长视频点播系统'],
  ['BI_DASHBOARD', '数据统计入口｜全站数据 BI 看板'],
  ['DOWNLOAD_DIST', '资源存储 / 下载站点｜软件源码下载分发站'],
  ['TICKET_SUPPORT', '技术支持入口｜工单客服系统'],
  ['TEST_ENV', '测试环境入口｜测试环境统一入口'],
  ['MEMBER_ADMIN', '用户管理入口｜用户会员管理后台'],
  ['VIDEO_PLAYER', '视频播放入口｜独立视频播放页'],
  ['WORDPRESS', 'WordPress 相关入口｜WordPress 独立站点'],
  ['SELF_MEDIA', '新闻资讯入口｜自媒体资讯平台'],
  ['SOURCE_GOODS', '商品资源入口｜货源商品库平台'],
  ['VOICE_TOOLS', '语音相关入口｜语音工具服务平台'],
  ['B2B_TRADE', 'B2B 大宗商贸平台主入口｜B2B 企业批发采购平台'],
  ['SUPPLIER_ADMIN', '供应商入驻管理入口｜供应商后台管理系统'],
  ['C2C_MARKET', 'C2C 个人交易市场入口｜C2C 个人闲置 / 商品交易平台'],
  ['SELLER_ADMIN', '个人卖家管理入口｜个人卖家店铺管理后台'],
]; // EXPECTED_NOTES 结束

// 依据清单本身也做断言，防止有人误删期望行让「44 条」假通过。
check('用户依据清单为 44 类', EXPECTED_NOTES.length === 44, `实际 ${EXPECTED_NOTES.length}`);
// 依据清单不得出现重复占位键。
check('用户依据占位键无重复', new Set(EXPECTED_NOTES.map(([key]) => key)).size === 44, '存在重复占位键');
// 依据清单不得出现重复备注（完全相同且用途一致已按一项处理）。
check('用户依据备注无重复', new Set(EXPECTED_NOTES.map(([, note]) => note)).size === 44, '存在未合并的重复备注');

// ---------- 2. 共享清单：结构与逐条自洽 ----------
// 读取单一数据源 JSON；格式错误直接终止，避免后续访问 undefined 产生噪声。
let data;
try {
  // 按 UTF-8 解析，中文备注与全角分隔符不会被破坏。
  data = JSON.parse(read('packages/core-domain/src/siteModules.json'));
  // 解析成功记录一项通过断言。
  check('清单 JSON 可解析', true, '');
} catch (error) {
  // 解析失败给出原因并退出。
  check('清单 JSON 可解析', false, String(error));
  // 直接退出，后续断言无对象可用。
  process.exit(1);
} // 读取清单结束

// 数据格式版本：拒绝未知格式被静默消费。
check('数据格式版本 v2', data.schema === 'mim.site-modules.v2', `实际 ${data.schema}`);
// 清单标题必须明确「统一入口配置清单」。
check('清单标题正确', String(data.title).includes('统一入口配置清单'), '标题漂移');
// 取证范围必须明确为 mixm.top 工作表，防止混入 laal.top 的 gy 文案。
check('取证范围仅 mixm.top', String(data.scope).includes('mixm.top') && !String(data.scope).includes('laal.top'), '范围声明漂移');
// 模块划分依据必须锁定备注两段式的后半段。
check('模块划分依据为业务系统说明', String(data.moduleBasis).includes('业务系统'), '缺划分依据');
// 备注格式说明必须保留「未提供具体主机值 / 功能规格」的事实。
check('备注格式声明无具体主机值与功能规格', String(data.noteFormat).includes('具体主机值') && String(data.noteFormat).includes('功能规格'), '缺格式声明');
// 派生声明必须存在：职责、关联与能力均属实现推导，非备注原文。
check('实现推导声明存在', String(data.derivation).includes('派生') && String(data.derivation).includes('非备注原文'), '缺派生声明');
// 已清空列如实登记 6 列，标明信息缺口。
check('已清空列登记 6 列', Array.isArray(data.clearedColumns) && data.clearedColumns.length === 6, `实际 ${data.clearedColumns?.length}`);

// 去重整理口径：@ 记录、空白字段、重复备注都必须按一项处理。
const dedupe = data.dedupe ?? {};
check('去重规则为完全相同且用途一致按一项', String(dedupe.rule).includes('完全相同且用途一致'), '规则漂移');
check('88 行业务备注合并 44 项', dedupe.businessNoteRows === 88 && dedupe.duplicatePairs === 44 && dedupe.mergedEntries === 44, '重复备注未合并');
check('@ 两行合并为 1 项根域名占位', JSON.stringify(dedupe.atRecordRows) === '[2,3]' && dedupe.atRecordMergedInto === 'AT_ROOT', '@ 记录未合并');
check('11 行空白备注合并为 1 项', dedupe.blankNoteRows === 11 && dedupe.blankMergedInto === 'BLANK_UNSET', '空白字段未合并');
check('@ 与空白占位均不补写具体主机值', data.atRecord?.hostValue === null && data.blankRecord?.hostValue === null, '占位项含具体值');
check('空白行策略明确不引用台账主机值', String(data.blankRowPolicy).includes('不作为入口标识依据'), '缺空白行策略');

// 主机配置策略：占位模式 + 缺省 null + 不补写声明。
const hostConfig = data.hostConfig ?? {};
check('主机配置模式为 placeholder', hostConfig.mode === 'placeholder', '模式漂移');
check('占位格式与注入前缀正确', hostConfig.format === '{{HOST:<ENTRY_KEY>}}' && hostConfig.envPrefix === 'MIM_HOST_', '格式漂移');
check('缺省主机值为 null 且声明不补写', hostConfig.defaultValue === null && String(hostConfig.rule).includes('不补写'), '缺不补写声明');
check('未配置时禁止推导真实域名', String(hostConfig.resolutionOfMissing).includes('不得推导'), '缺降级口径');

// 清单数组：缺项时后续逐项检查仍能给出明细。
const modules = Array.isArray(data.modules) ? data.modules : [];
const domains = Array.isArray(data.domains) ? data.domains : [];
const blanks = Array.isArray(data.blankRows) ? data.blankRows : [];
// 去重后入口数量断言：44 类备注一一对应。
check('清单入口 44 个', modules.length === 44, `实际 ${modules.length}`);
// 业务域数量断言：19 组业务用途。
check('业务域 19 个', domains.length === 19, `实际 ${domains.length}`);
// 业务域入口数合计必须为 44，保证不遗漏清单中的业务用途。
check('业务域入口数合计 44', domains.reduce((n, d) => n + (d.count ?? 0), 0) === 44, '业务域覆盖不全');
// 台账空备注原始行数。
check('空备注行 13 行', blanks.length === 13, `实际 ${blanks.length}`);
// 用户明确给出的开头两行 @ 必须标记为 givenByUser=true。
check('用户给出的 2 行 @ 已标记', blanks.filter((b) => b.givenByUser === true).length === 2, 'givenByUser 标记缺失');
// 其余 11 行空备注来自同一工作表但用户未列出，须标记未决。
check('其余 11 行空备注标记未决', blanks.filter((b) => b.givenByUser === false && b.reasonCode === 'BLANK_NOTE').length === 11, '未决标记缺失');
// 空备注行不得残留台账具体主机值。
check('空备注行不含具体主机值', blanks.every((b) => b.hostValue === null && typeof b.placeholder === 'string' && !('host' in b)), '空备注行含具体值');

// 能力类型字典：三类状态机必须与后端校验口径一致。
const kinds = data.capabilityKinds ?? {};
// 清单状态机。
check('catalog 状态机', JSON.stringify(kinds.catalog?.states) === JSON.stringify(['active', 'archived']), '清单状态机漂移');
// 管理状态机。
check('manage 状态机', JSON.stringify(kinds.manage?.states) === JSON.stringify(['pending', 'active', 'archived']), '管理状态机漂移');
// 记录状态机。
check('record 状态机', JSON.stringify(kinds.record?.states) === JSON.stringify(['pending', 'done', 'archived']), '记录状态机漂移');

// 逐项比对 44 条备注原文、占位键、行号与结构自洽性。
const noteMismatches = [];
const structureProblems = [];
// 占位键集合：检测重复入口。
const seenKeys = new Set();
// 功能点总数累加器。
let capTotal = 0;
// 演示数据总数累加器。
let seedTotal = 0;
// 相似模块关联总数累加器。
let relationTotal = 0;
// 序号计数：验证条目序号与 xls 行序一致（02 移除后不重排，故不连续）。
let seq = 0;
// 业务域占位键并集：验证每个入口都归属某个业务域。
const groupedKeys = new Set(domains.flatMap((d) => (Array.isArray(d.entryKeys) ? d.entryKeys : [])));
// 遍历全部入口。
for (const m of modules) {
  // 序号自增，期望与两位序号一致（02 已移除，故实际序号跳过 02）。
  seq += 1;
  // 期望的两位序号字符串：01 之后整体后移一位。
  const expectId = seq === 1 ? '01' : String(seq + 1).padStart(2, '0');
  // 取同位置的用户依据条目。
  const expected = EXPECTED_NOTES[seq - 1];
  // 逐字比对备注原文与占位键。
  if (!expected || m.entryKey !== expected[0] || m.note !== expected[1]) {
    // 记录差异明细，包含序号与实际值便于定位。
    noteMismatches.push(`${expectId}: key=${m.entryKey} note=${m.note}`);
  } // 备注比对结束
  // 序号连续性。
  if (m.id !== expectId) structureProblems.push(`${expectId} 序号漂移为 ${m.id}`);
  // 占位键唯一性。
  if (seenKeys.has(m.entryKey)) structureProblems.push(`${expectId} 占位键重复 ${m.entryKey}`);
  // 加入已见集合。
  seenKeys.add(m.entryKey);
  // 备注原文必须等于「入口描述｜业务系统说明」，全角竖线不可替换。
  if (m.note !== `${m.entry}｜${m.system}`) structureProblems.push(`${expectId} note 与 entry/system 不自洽`);
  // 来源工作表锁定 mixm.top，仅作行号溯源。
  if (m.sheet !== 'mixm.top') structureProblems.push(`${expectId} sheet 漂移`);
  // 行号必须是连续两个数字，且与台账行号（序号 n → 2n+2 / 2n+3）对应。
  if (!Array.isArray(m.rows) || m.rows.length !== 2 || m.rows[0] !== 2 * Number(m.id) + 2 || m.rows[1] !== 2 * Number(m.id) + 3) {
    // 记录行号问题。
    structureProblems.push(`${expectId} rows 漂移 ${JSON.stringify(m.rows)}`);
  } // 行号校验结束
  // 可配置占位标识：格式固定，且不得包含任何具体主机值。
  if (m.placeholder !== `{{HOST:${m.entryKey}}}`) structureProblems.push(`${expectId} 占位标识漂移 ${m.placeholder}`);
  if (m.envKey !== `MIM_HOST_${m.entryKey}`) structureProblems.push(`${expectId} 注入键漂移 ${m.envKey}`);
  if (m.hostValue !== null) structureProblems.push(`${expectId} 补写了具体主机值`);
  // 不得残留 v1 的具体主机值字段。
  if ('fqdn' in m || 'host' in m) structureProblems.push(`${expectId} 残留具体主机值字段`);
  // 业务域归属：必须出现在某个业务域的 entryKeys 里。
  if (!groupedKeys.has(m.entryKey)) structureProblems.push(`${expectId} 未归属任何业务域`);
  // 业务域编码一致性：模块 domain 必须与包含它的业务域 code 相同。
  const owning = domains.find((d) => Array.isArray(d.entryKeys) && d.entryKeys.includes(m.entryKey));
  // 比对业务域编码与中文名。
  if (!owning || owning.code !== m.domain || owning.name !== m.domainName) structureProblems.push(`${expectId} domain 与业务域清单不一致`);
  // 核心功能：至少 3 条，且不得为空。
  const funcs = Array.isArray(m.coreFunctions) ? m.coreFunctions : [];
  if (funcs.length < 3 || funcs.some((f) => !String(f).trim())) structureProblems.push(`${expectId} 核心功能缺失`);
  // 职责边界：负责与不负责都要给出。
  if (!Array.isArray(m.responsibility?.inScope) || m.responsibility.inScope.length === 0 ||
      !Array.isArray(m.responsibility?.outOfScope) || m.responsibility.outOfScope.length === 0) {
    structureProblems.push(`${expectId} 职责边界不完整`);
  } // 职责边界校验结束
  // 后台管理职责与接口职责必须齐备。
  if (!m.adminRole || !m.apiRole) structureProblems.push(`${expectId} 后台/接口职责缺失`);
  // 相似模块关联与区分：至少 1 条，且每条都要有区分说明。
  const rels = Array.isArray(m.related) ? m.related : [];
  relationTotal += rels.length;
  if (rels.length === 0 || rels.some((r) => !r.distinction || !r.entryKey)) structureProblems.push(`${expectId} 关联区分缺失`);
  // 功能点：每个模块恰好 3 个，编码固定为 catalog / manage / record。
  const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
  // 累加功能点总数。
  capTotal += caps.length;
  // 三个功能点断言。
  if (caps.length !== 3) structureProblems.push(`${expectId} 功能点数 ${caps.length}`);
  // 编码顺序与状态机一致性。
  const expectCodes = ['catalog', 'manage', 'record'];
  // 逐个能力校验。
  for (const [index, cap] of caps.entries()) {
    // 编码必须按固定顺序。
    if (cap.code !== expectCodes[index]) structureProblems.push(`${expectId} 能力编码漂移 ${cap.code}`);
    // 名称、实体名与说明不得为空。
    if (!cap.name || !cap.itemKind || !cap.description) structureProblems.push(`${expectId} 能力字段缺失`);
    // 状态集合必须与该类型的字典一致。
    if (JSON.stringify(cap.states) !== JSON.stringify(kinds[cap.code]?.states)) {
      // 记录状态机漂移。
      structureProblems.push(`${expectId} ${cap.code} states 漂移`);
    } // 状态校验结束
  } // 能力遍历结束
  // 演示数据：每个模块 2 条，能力必须存在，状态必须合法，隔离键必须是占位键。
  const seeds = Array.isArray(m.seed) ? m.seed : [];
  // 累加演示数据总数。
  seedTotal += seeds.length;
  // 两条演示数据断言。
  if (seeds.length !== 2) structureProblems.push(`${expectId} 演示数据数 ${seeds.length}`);
  // 逐条校验演示数据。
  for (const item of seeds) {
    // 定位对应能力。
    const cap = caps.find((c) => c.code === item.capability);
    // 能力必须存在且状态合法。
    if (!cap || !cap.states.includes(item.status)) structureProblems.push(`${expectId} 演示数据状态/能力非法`);
    // 标题与说明不得为空。
    if (!item.title || !item.detail) structureProblems.push(`${expectId} 演示数据字段缺失`);
    // 若演示数据自带隔离键，必须与占位键一致，不得残留具体主机值。
    if (item.host !== undefined && item.host !== m.entryKey) structureProblems.push(`${expectId} 演示数据隔离键漂移`);
  } // 演示数据遍历结束
} // 入口遍历结束

// 关联目标必须指向清单内真实存在的入口（避免悬空引用）。
const allKeys = new Set(modules.map((m) => m.entryKey));
const dangling = [];
for (const m of modules) {
  for (const r of m.related ?? []) {
    if (!allKeys.has(r.entryKey)) dangling.push(`${m.id}→${r.entryKey}`);
  }
}
check('相似模块关联无悬空引用', dangling.length === 0, dangling.slice(0, 3).join('; '));

// 44 条备注逐字一致断言（一次性汇总差异）。
check('44 条备注逐字一致', noteMismatches.length === 0, noteMismatches.slice(0, 3).join('; '));
// 结构自洽断言（一次性汇总问题）。
check('入口字段 / 行号 / 业务域 / 占位标识 / 状态机自洽', structureProblems.length === 0, structureProblems.slice(0, 3).join('; '));
// 功能点总数断言：44 × 3。
check('功能点共 132 个', capTotal === 132, `实际 ${capTotal}`);
// 演示数据总数断言：44 × 2。
check('演示数据共 88 条', seedTotal === 88, `实际 ${seedTotal}`);
// 关联条数断言：每条至少 1 个相似模块区分。
check('相似模块关联不少于 44 条', relationTotal >= 44, `实际 ${relationTotal}`);
// 清单全文不得出现任何具体主机值（除来源说明与工作表名）。
const concrete = read('packages/core-domain/src/siteModules.json')
  .split('\n')
  .filter((line) => /(\.mixm\.top|www\.|https?:\/\/)/.test(line) && !/"(source|scope|sheet)"/.test(line));
check('清单不含具体主机值', concrete.length === 0, concrete.slice(0, 2).join('; '));

// ---------- 3. 全链路消费：共享包 → 后端 → 前端 → 测试 → 脚本 ----------
// 共享包 barrel 必须导出清单，否则 API 与 Web 都无法引用。
const barrel = read('packages/core-domain/src/index.ts');
// 断言导出语句存在。
check('core-domain 导出 siteModules', barrel.includes("export * from './siteModules.js'"), 'barrel 缺导出');
// 落地状态注册表必须由 barrel 导出，供后端汇总与前端徽标共用。
check('core-domain 导出 entryImplementation', barrel.includes("export * from './entryImplementation.js'"), '落地映射未导出');
// 类型化封装必须提供查询、状态机与占位解析工具函数。
const wrapper = read('packages/core-domain/src/siteModules.ts');
// 断言关键导出齐备。
check('封装层提供完整工具函数', ['findSiteModule', 'findSiteCapability', 'isSiteState', 'defaultSiteState', 'siteModulesSummary', 'resolveEntryHost', 'entryHostTemplate'].every((fn) => wrapper.includes(`export function ${fn}`)), '工具函数缺失');
// 落地注册表：四态计数与按占位键取映射必须齐备。
const implFile = read('packages/core-domain/src/entryImplementation.ts');
check('落地注册表提供四态计数与查询', implFile.includes('implementationOf') && implFile.includes('implementationSummary') && implFile.includes("'implemented'") && implFile.includes("'conflict'"), '落地映射缺失');
// 封装层必须导入同名 JSON，保证单一数据源。
check('封装层消费清单 JSON', wrapper.includes("from './siteModules.json'"), '未引用 JSON');
// 封装层不得把具体主机值写回数据本体。
check('兼容别名只在运行时补齐', wrapper.includes('function withCompatAliases') && wrapper.includes('host: module.entryKey'), '兼容别名缺失');

// 后端 schema 必须建表并建索引。
const schema = read('services/mim-api/src/schema.sql');
// 断言建表语句。
check('schema 建 site_module_items 表', schema.includes('CREATE TABLE IF NOT EXISTS site_module_items'), '缺建表语句');
// 断言三类能力的 CHECK 约束与索引。
check('schema 约束三类能力并建索引', schema.includes("'catalog','manage','record'") && schema.includes('idx_site_items_host_cap'), '缺约束或索引');
// schema 注释必须说明 host 列语义已改为占位键。
check('schema 声明隔离键为占位键', schema.includes('可配置占位标识键') && schema.includes('不是具体主机值'), '缺语义声明');
// 数据库初始化必须调用入口清单种子。
const dbTs = read('services/mim-api/src/db.ts');
// 断言导入静态契约。
check('db 导入 SITE_MODULES', dbTs.includes('SITE_MODULES') && dbTs.includes('@mim/core-domain'), '缺导入');
// 断言 createDatabase 调用 seedSiteModules。
check('db 启动时写入演示数据', /seedSiteModules\(db\)/.test(dbTs) && dbTs.includes('export function seedSiteModules'), '缺种子调用');
// 种子必须按占位键写入并做幂等迁移，不得硬编码旧具体主机值。
check('种子隔离键为占位键且含幂等迁移', dbTs.includes('module.entryKey') && dbTs.includes('UPDATE site_module_items SET host'), '缺占位键迁移');
// 运行时路由必须覆盖七个端点。
const route = read('services/mim-api/src/routes/sites.ts');
// 断言七个端点路径齐备。
const routePaths = ['/sites/overview', "'/sites'", "'/sites/:host'", "'/sites/:host/capabilities'", "'/sites/:host/items'", "'/sites/:host/items/:id/transition'"];
// 逐路径检查。
check('后端覆盖 6 组运行时端点', routePaths.every((p) => route.includes(p)), '端点缺失');
// 写操作必须同时挂 requireAuth 与 idempotency；只统计 router.post 声明行，忽略 import 行。
check('写操作挂鉴权与幂等', (route.match(/router\.post\([^\n]*requireAuth, idempotency/g) ?? []).length === 2, '写路径门禁缺失');
// 运行时路由不得再引用 fqdn 具体主机值字段。
check('运行时接口不含 fqdn', !route.includes('m.fqdn') && route.includes('m.placeholder'), '仍引用具体主机值');
// 运行时路由必须透出落地状态映射与四态汇总。
check('sites 路由透出落地状态', route.includes('implementation: m.implementation') && route.includes('implementationSummary'), '落地状态未透出');

// 清单路由必须覆盖六个只读端点。
const entryRoute = read('services/mim-api/src/routes/entries.ts');
const entryPaths = ['/entries/overview', '/entries/domains', '/entries/placeholders', '/entries/config', "'/entries'", "'/entries/:entryKey'"];
check('清单路由覆盖 6 个只读端点', entryPaths.every((p) => entryRoute.includes(p)), '清单端点缺失');
check('清单路由静态路径先于动态参数', entryRoute.indexOf("router.get('/entries/overview'") < entryRoute.indexOf("router.get('/entries/:entryKey'"), '注册顺序错误');
check('清单路由不回显具体主机值', entryRoute.includes('resolveEntryHost') && !entryRoute.includes('hostValue:'), '配置状态泄露风险');
// 清单路由同样透出落地状态映射与四态汇总。
check('entries 路由透出落地状态', entryRoute.includes('implementation: m.implementation') && entryRoute.includes('implementationSummary'), '落地状态未透出');
// 应用装配必须挂载两个路由。
const appTs = read('services/mim-api/src/app.ts');
// 断言导入与挂载两处都在。
check('app 挂载 createSitesRouter', appTs.includes('createSitesRouter') && appTs.includes("app.use('/api/v1', createSitesRouter(resolved))"), '运行时路由未挂载');
check('app 挂载 createEntriesRouter', appTs.includes('createEntriesRouter') && appTs.includes("app.use('/api/v1', createEntriesRouter(resolved))"), '清单路由未挂载');
// 契约测试必须存在且覆盖清单与运行时。
const testTs = read('services/mim-api/test/sites.test.ts');
// 断言关键用例存在。
check('运行时契约测试覆盖去重入口与状态流转', testTs.includes('去重入口') && testTs.includes('状态流转') && testTs.includes('幂等'), '测试覆盖不足');
const entryTest = read('services/mim-api/test/entries.test.ts');
check('清单契约测试覆盖 19 域 / 去重 / 占位配置', entryTest.includes('19') && entryTest.includes('dedupe') && entryTest.includes('config'), '清单测试缺失');

// 前端 API 客户端必须提供 sites 与 entries 两组方法。
const apiTs = read('apps/web/src/api.ts');
// 断言运行时接口方法齐备。
check('前端 API 提供 sites 分组 6 方法', ['overview()', 'list(opts:', 'detail(host:', 'listItems(host:', 'createItem(host:', 'transitionItem(host:'].every((fn) => apiTs.includes(fn)), '方法缺失');
// 断言清单接口方法齐备。
check('前端 API 提供 entries 分组方法', ['entries: {', 'domains()', 'detail(entryKey:', 'placeholders()', 'config()', 'list(opts:'].every((fn) => apiTs.includes(fn)), '清单方法缺失');
// 路由必须登记 sites 视图。
const routerTs = read('apps/web/src/router.ts');
// 断言类型联合与 VIEWS 数组都包含 sites。
check('router 登记 sites 视图', routerTs.includes("| 'sites'") && routerTs.includes("'sites'"), '视图未登记');
// 应用根组件必须新增导航项与渲染分支。
const appTsx = read('apps/web/src/App.tsx');
// 断言导入、导航与渲染三处齐备。
check('App 接入清单视图并注入直达回调', appTsx.includes("import { Sites }") && appTsx.includes("view: 'sites'") && appTsx.includes('<Sites') && appTsx.includes('onOpenView'), '视图未接入');
// 免登录体验模型不得被破坏：收费视图集合仍为商品列表 / 购物车 / 个人中心（漫剧放映厅匿名可看），且旧的 GATED_VIEWS 门禁集合不得回退。
check('免登录收费视图集合未漂移', !/GATED_VIEWS/.test(appTsx) && /const needsSession = route\.view === 'products' \|\| route\.view === 'cart' \|\| route\.view === 'account'/.test(appTsx), '收费视图集合漂移或门禁集合回退');
// 视图组件必须真实调用接口并渲染备注原文、占位标识与职责字段。
const sitesTsx = read('apps/web/src/views/Sites.tsx');
// 断言关键消费点齐备。
check('视图消费清单 / 占位标识 / 职责 / 关联 / 落地状态', ['api.entries.overview()', 'api.entries.placeholders()', 'api.sites.overview()', 'api.sites.list(', 'api.sites.detail(', 'm.note', 'm.placeholder', 'm.coreFunctions', 'm.responsibility', 'm.adminRole', 'm.apiRole', 'm.related', 'm.implementation', 'realFeatures', 'boundary'].every((s) => sitesTsx.includes(s)), '视图未消费清单字段');
// 匿名浏览、写操作引导登录的按需登录模型必须在视图内保持。
check('视图匿名可浏览且写操作引导登录', sitesTsx.includes('getSession()') && sitesTsx.includes("navigate({ view: 'login' })"), '按需登录模型缺失');
// 视图不得展示任何具体域名。
check('视图不展示具体主机值', !sitesTsx.includes('mixm.top') && sitesTsx.includes('可配置占位标识'), '视图含具体主机值');
// 样式表必须补齐清单视图所需类。
const css = read('apps/web/src/styles.css');
// 断言新增样式类存在。
check('样式补齐清单视图类', ['.entry-intake', '.entry-functions', '.entry-boundary', '.entry-config', '.entry-relations', '.site-stats', '.site-detail'].every((c) => css.includes(c)), '样式类缺失');

// 可配置占位标识模板必须存在，且值全部为空。
const tplText = read('config/entry-hosts.example.json');
let tpl = {};
try { tpl = JSON.parse(tplText); } catch { /* 解析失败由后续断言报告 */ }
const tplHosts = tpl.hosts ?? {};
check('配置模板存在且为 44 个键', Object.keys(tplHosts).length === 44, `实际 ${Object.keys(tplHosts).length}`);
check('配置模板值全为空，不含具体主机值', Object.values(tplHosts).every((v) => v === '') && !/\.mixm\.top|https?:\/\//.test(tplText), '模板含具体值');
check('配置模板键与清单一一对应', modules.every((m) => Object.prototype.hasOwnProperty.call(tplHosts, m.envKey)), '模板键漂移');
// 可读清单文档必须存在且覆盖 19 个业务域。
const catalog = read('docs/统一入口配置清单-20261109.md');
check('统一入口配置清单文档存在', catalog.length > 0, '缺清单文档');
check('清单文档覆盖 19 个业务域', domains.every((d) => catalog.includes(`\`${d.code}\``)), '文档业务域不全');
check('清单文档逐项列出 44 个占位键', modules.every((m) => catalog.includes(`\`${m.entryKey}\``)), '文档入口不全');
check('清单文档声明不补写具体主机值', catalog.includes('不补写未提供的具体主机值'), '缺约束声明');

// 根 package.json 必须提供两个校验脚本入口。
const pkg = read('package.json');
// 断言脚本入口存在。
check('package.json 提供 verify:site-modules', pkg.includes('"verify:site-modules"'), '缺脚本入口');
check('package.json 提供 verify:entry-manifest', pkg.includes('"verify:entry-manifest"'), '缺清单校验入口');
// 既有 check 链必须保持原样，避免改变既有门禁退出条件。
check('既有 check 链未改动', pkg.includes('"check": "node scripts/version-check.mjs && node scripts/env-check.mjs && node scripts/comment-check.mjs && node scripts/verify-custom-domains.mjs"'), 'check 链漂移');
// 上一轮站点入口契约校验脚本必须仍在，历史成果不得被本轮覆盖。
check('上一轮站点入口契约校验仍在', existsSync(join(ROOT, 'scripts/verify-site-directory.mjs')), '旧校验脚本缺失');
// 源 xls 不得被本轮改动（文件名仍存在即可，内容比对由 Python 侧单独取证）。
check('源 xls 仍在仓库根', existsSync(join(ROOT, 'dnspod_records_2026-11-05_21-42-26.xls')), '源文件缺失');

// ---------- 汇总 ----------
// 打印通过数与失败数，便于 CI 日志直接引用。
console.log(`\n== 统一入口配置清单校验：${total - failures.length}/${total} 通过 ==`);
// 有失败项时逐条列出并以退出码 1 结束。
if (failures.length > 0) {
  // 逐条输出失败原因。
  for (const item of failures) console.error(`  ❌ ${item}`);
  // 非零退出码表达门禁失败。
  process.exit(1);
} // 失败分支结束
// 全通过时给出明确标记并退出 0。
console.log('✅ 统一入口配置清单与全链路消费校验 PASS');
// 正常退出。
process.exit(0);
