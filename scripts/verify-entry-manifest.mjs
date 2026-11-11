#!/usr/bin/env node
// 统一入口配置清单专项校验：核对用户列出的 19 组业务用途是否被 44 个入口完整覆盖，
// 并验证「完全相同且用途一致按一项」的去重结果、可配置占位标识与不补写具体主机值。
// 零第三方依赖、只读项目内文件；不读取 xls 本体。
//
// 用法：node scripts/verify-entry-manifest.mjs
// 退出码：0 = 全通过，1 = 有业务用途遗漏或契约漂移。

import { readFileSync, existsSync } from 'node:fs'; // 只读文件工具，本脚本不产生写操作
import { dirname, join, resolve } from 'node:path'; // 路径工具，按脚本自身位置定位仓库根
import { fileURLToPath } from 'node:url'; // URL 转路径，避免依赖运行时 cwd

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // 仓库根目录
const failures = []; // 失败项收集：全部检查跑完后统一判定
let total = 0; // 断言计数

function check(name, ok, detail = '') { // 单项断言：通过/失败都打印
  total += 1; // 计数自增
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ` — ${detail}`}`); // 输出断言名与失败原因
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ''}`); // 未通过时收集
} // check 结束

function read(rel) { // 读取仓库内 UTF-8 文本，缺失返回空串
  const path = join(ROOT, rel); // 拼接绝对路径
  return existsSync(path) ? readFileSync(path, 'utf8') : ''; // 存在则读全文
} // read 结束

const data = JSON.parse(read('packages/core-domain/src/siteModules.json')); // 单一权威清单
const modules = data.modules ?? []; // 44 个去重入口
const domains = data.domains ?? []; // 19 个业务域

// ---------- 1. 用户清单的 19 组业务用途 → 业务域编码 ----------
// 该表逐组来自用户 2026-11-09 消息中的业务用途清单，用于验证「不遗漏清单中的业务用途」。
const EXPECTED_DOMAINS = [
  ['portal', 1], // 主站跳转与分发
  ['admin', 1], // 管理后台
  ['gateway', 2], // API / APP 网关
  ['identity', 2], // 认证权限与单点登录
  ['member', 2], // 用户 / 会员中心
  ['content', 4], // 博客 / 资讯 / 自媒体 / WordPress
  ['storage', 3], // 云盘 / 图床 / 素材 / 下载分发
  ['commerce', 9], // B2C / 支付结算 / 对账 / 营销 / 多商户 / B2B / C2C / 供应商 / 货源 / 卖家管理
  ['video', 3], // UGC 短视频 / 长视频 / 独立播放页
  ['data', 3], // 数据开放 / BI / 爬虫调度与数据采集
  ['dev', 2], // 开发测试环境 / 接口文档
  ['ops', 3], // 运维监控 / 安全防护 / 服务治理
  ['support', 2], // 工单客服 / 帮助中心
  ['navigation', 1], // 导航
  ['lowcode', 1], // 低代码生成
  ['tools', 1], // 疾风引擎工具
  ['voice', 1], // 语音工具
  ['mobile', 2], // 移动端 H5 与全功能移动站
  ['intranet', 1], // 企业内部门户
]; // EXPECTED_DOMAINS 结束

check('用户业务用途清单为 19 组', EXPECTED_DOMAINS.length === 19, `实际 ${EXPECTED_DOMAINS.length}`); // 组数
check('业务域数量 19 且编码一一对应', domains.length === 19 &&
  EXPECTED_DOMAINS.every(([code]) => domains.some((d) => d.code === code)), '业务域缺项或漂移'); // 编码覆盖
check('每组业务用途的入口数正确', EXPECTED_DOMAINS.every(([code, count]) => {
  const d = domains.find((x) => x.code === code); // 定位业务域
  return d && d.count === count && d.entryKeys.length === count; // 域内入口数一致
}), '业务用途覆盖数量漂移'); // 数量检查
check('业务域入口数合计 44 且全部落在清单内', domains.reduce((n, d) => n + d.count, 0) === 44 &&
  domains.every((d) => d.entryKeys.every((k) => modules.some((m) => m.entryKey === k))), '入口归属漂移'); // 归属检查
check('每个入口恰好归属一个业务域', modules.every((m) =>
  domains.filter((d) => d.entryKeys.includes(m.entryKey)).length === 1), '存在重复归属'); // 唯一归属检查

// ---------- 2. 用户清单关键词逐组核对（防止业务用途被名义覆盖、实际遗漏） ----------
// 关键词组来自用户消息原文，逐一在「备注原文 + 业务系统说明 + 核心功能 + 职责」里搜索。
const KEYWORD_GROUPS = [
  ['主站门户与跳转', ['主站统一跳转门户']],
  ['管理后台', ['全站统一运营管理后台']],
  ['API / APP 网关', ['API 统一网关', '移动端专属接口服务']],
  ['认证权限与单点登录', ['统一身份认证与权限中心', '统一单点登录页']],
  ['用户 / 会员中心', ['会员工作台', '用户会员管理后台']],
  ['博客 / 资讯 / 自媒体 / WordPress', ['官方博客系统', '新闻资讯发布系统', '自媒体资讯平台', 'WordPress 独立站点']],
  ['云盘 / 图床 / 素材 / 下载分发', ['网盘系统', '公共图床', '软件源码下载分发站']],
  ['电商与商贸', ['B2C 官方商城系统', '支付聚合网关', '对账系统', '营销活动管理平台', '多商户店铺系统',
    'B2B 企业批发采购平台', 'C2C 个人闲置', '供应商后台管理系统', '货源商品库平台', '个人卖家店铺管理后台']],
  ['视频', ['UGC 短视频动态社区', '长视频点播系统', '独立视频播放页']],
  ['数据', ['开放数据集平台', '全站数据 BI 看板', '爬虫调度与数据采集平台']],
  ['开发测试', ['开发环境门户', '接口文档', '测试环境统一入口']],
  ['运维与安全', ['运维监控面板', '安全防护中心', '服务治理监控平台']],
  ['工单与帮助', ['工单客服系统', '产品帮助文档中心']],
  ['导航', ['全站资源导航站']],
  ['低代码生成', ['低代码生成平台']],
  ['疾风引擎工具', ['疾风引擎在线工具平台']],
  ['语音工具', ['语音工具服务平台']],
  ['移动端', ['移动端 H5 精简版官网', '全功能移动端站点']],
  ['企业内部门户', ['企业内部统一门户']],
]; // KEYWORD_GROUPS 结束

// 依据文本：备注原文（唯一用户依据），不把实现推导内容当作覆盖证据。
const noteText = modules.map((m) => m.note).join('\n'); // 45 条备注原文
const missingKeywords = []; // 未命中的业务用途关键词
for (const [group, words] of KEYWORD_GROUPS) { // 逐组核对
  for (const word of words) { // 逐关键词核对
    if (!noteText.includes(word)) missingKeywords.push(`${group}: ${word}`); // 备注里必须出现
  } // 关键词循环结束
} // 分组循环结束
check('用户清单所有业务用途关键词在备注原文中命中', missingKeywords.length === 0, missingKeywords.slice(0, 4).join('; ')); // 零遗漏
check('19 组业务用途关键词组齐备', KEYWORD_GROUPS.length === 19, `实际 ${KEYWORD_GROUPS.length}`); // 组数

// ---------- 3. 相似模块关联与区分 ----------
// 用户要求明确「相似模块之间的关联与区分」，逐组抽查最易混淆的边界。
const byKey = new Map(modules.map((m) => [m.entryKey, m])); // 占位键索引
const RELATION_PAIRS = [
  ['PORTAL_ROOT', 'NAVIGATION'], // 根域名一次跳转 vs 资源导航站
  ['AUTH_CENTER', 'SSO_LOGIN'], // 认证能力 vs 登录页
  ['MEMBER_CENTER', 'MEMBER_ADMIN'], // 前台自助 vs 后台管理
  ['MALL_B2C', 'MULTI_MERCHANT'], // 自营零售 vs 多商户
  ['B2B_TRADE', 'C2C_MARKET'], // 企业批发 vs 个人闲置
  ['SUPPLIER_ADMIN', 'SELLER_ADMIN'], // 供应商后台 vs 个人卖家后台
  ['UGC_VIDEO', 'VOD_LONG_VIDEO'], // 短视频社区 vs 长视频点播
  ['VOD_LONG_VIDEO', 'VIDEO_PLAYER'], // 片库服务 vs 独立播放页
  ['OPEN_DATA', 'BI_DASHBOARD'], // 对外数据集 vs 内部 BI
  ['DEV_PORTAL', 'TEST_ENV'], // 开发文档 vs 测试环境
  ['OPS_MONITOR', 'SECURITY_CENTER'], // 指标监控 vs 安全防护
  ['TICKET_SUPPORT', 'HELP_CENTER'], // 工单交互 vs 静态文档
  ['MOBILE_H5', 'MOBILE_FULL'], // 精简官网 vs 全功能移动站
  ['ADMIN_CONSOLE', 'INTRANET_PORTAL'], // 平台运营后台 vs 企业内部工作台
  ['CLOUD_DRIVE', 'IMAGE_ASSETS'], // 私有云盘 vs 公共图床
]; // RELATION_PAIRS 结束
const relationProblems = []; // 关联缺失明细
for (const [a, b] of RELATION_PAIRS) { // 逐对核对
  const ma = byKey.get(a); // 入口 A
  const mb = byKey.get(b); // 入口 B
  if (!ma || !mb) { relationProblems.push(`缺入口 ${a}/${b}`); continue; } // 入口缺失
  const linked = ma.related.some((r) => r.entryKey === b) || mb.related.some((r) => r.entryKey === a); // 双向任一关联即可
  const distinct = ma.related.some((r) => r.entryKey === b && r.distinction) || mb.related.some((r) => r.entryKey === a && r.distinction); // 必须有区分说明
  if (!linked || !distinct) relationProblems.push(`${a}/${b}`); // 记录缺失
} // 关联对循环结束
check('15 组易混淆相似模块均有关联与区分', relationProblems.length === 0, relationProblems.slice(0, 4).join('; ')); // 关联检查

// ---------- 4. 去重整理与可配置占位标识 ----------
const dedupe = data.dedupe ?? {}; // 整理口径
check('重复备注 44 对合并为 44 项', dedupe.businessNoteRows === 88 && dedupe.duplicatePairs === 44 && dedupe.mergedEntries === 44, '重复备注未合并'); // 重复备注
check('@ 两行合并为 1 项且不建业务模块', dedupe.atRecordRows?.length === 2 && dedupe.atRecordRows[0] === 2 &&
  data.atRecord?.occurrences === 2 && !modules.some((m) => m.entryKey === 'AT_ROOT'), '@ 记录未整理'); // @ 记录
check('11 行空白字段合并为 1 项且不建业务模块', dedupe.blankNoteRows === 11 &&
  data.blankRecord?.occurrences === 11 && !modules.some((m) => m.entryKey === 'BLANK_UNSET'), '空白字段未整理'); // 空白字段
check('44 个入口占位标识格式统一', modules.every((m) => m.placeholder === `{{HOST:${m.entryKey}}}` &&
  m.envKey === `MIM_HOST_${m.entryKey}` && m.hostValue === null), '占位标识漂移'); // 占位格式
check('清单无具体主机值字段（无 host / fqdn）', modules.every((m) => !('host' in m) && !('fqdn' in m)), '残留具体主机值字段'); // 字段检查
check('空备注行无具体主机值', (data.blankRows ?? []).every((b) => b.hostValue === null && !('host' in b)), '空备注行含具体值'); // 空行检查

// 配置模板：45 键全空，键与清单一一对应。
let tpl = {}; // 模板对象
try { tpl = JSON.parse(read('config/entry-hosts.example.json')); } catch { /* 解析失败由后续断言报告 */ } // 读取模板
const hosts = tpl.hosts ?? {}; // 模板键值
check('配置模板 44 键且值全为空', Object.keys(hosts).length === 44 && Object.values(hosts).every((v) => v === ''), '模板含具体值'); // 模板值
check('配置模板键与入口 envKey 一一对应', modules.every((m) => Object.prototype.hasOwnProperty.call(hosts, m.envKey)), '模板键漂移'); // 模板键

// ---------- 5. 命名、业务说明与整体结构一致 ----------
check('每个入口的 domainName 与业务域 name 一致', modules.every((m) =>
  domains.find((d) => d.code === m.domain)?.name === m.domainName), '业务域名漂移'); // 命名一致
check('每个入口都有核心功能 / 职责边界 / 后台与接口职责', modules.every((m) =>
  m.coreFunctions.length >= 3 && m.responsibility.inScope.length > 0 && m.responsibility.outOfScope.length > 0 &&
  m.adminRole && m.apiRole), '职责元数据缺失'); // 职责齐备
check('每个入口的备注原文与入口/系统两段自洽', modules.every((m) => m.note === `${m.entry}｜${m.system}`), '备注拆分漂移'); // 两段式
check('实现推导声明覆盖职责与关联字段', String(data.derivation).includes('responsibility') &&
  String(data.derivation).includes('related') && String(data.derivation).includes('非备注原文'), '缺推导声明'); // 推导声明

// 可读清单文档与交付说明存在，且逐项列出 45 个占位键。
const catalog = read('docs/统一入口配置清单-20261109.md'); // 可读清单
check('可读清单文档逐项列出 44 个占位键', modules.every((m) => catalog.includes(`\`${m.entryKey}\``)), '文档入口不全'); // 文档覆盖
check('可读清单文档覆盖 19 个业务域标题', domains.every((d) => catalog.includes(`\`${d.code}\``)), '文档业务域不全'); // 文档域覆盖
check('交付说明文档存在', existsSync(join(ROOT, 'docs/统一入口配置清单与模块化实现说明-20261109.md')), '缺交付说明'); // 交付文档

// ---------- 汇总 ----------
console.log(`\n== 统一入口配置清单专项校验：${total - failures.length}/${total} 通过 ==`); // 汇总数值
if (failures.length > 0) { // 有失败项
  for (const item of failures) console.error(`  ❌ ${item}`); // 逐条输出
  process.exit(1); // 非零退出码
} // 失败分支结束
console.log('✅ 19 组业务用途完整覆盖、去重整理与占位配置校验 PASS'); // 全通过标记
process.exit(0); // 正常退出
