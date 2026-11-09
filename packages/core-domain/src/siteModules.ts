/**
 * 统一入口配置清单（v2）：把用户提供的「主机记录 + 备注」整理成前后端共用的模块定义。
 * 数据本体在同目录 siteModules.json；本文件只负责类型约束、索引与查询，不产生业务副作用。
 * 与 v1 的区别：模块不再绑定任何具体主机值，改用可配置占位标识；备注「入口｜业务系统说明」为唯一划分依据；
 * 新增 19 个业务域、核心功能、职责边界、后台/接口职责与相似模块关联区分。
 */
// 导入单一数据源 JSON：45 个去重入口 / 19 个业务域 / 135 个运行时能力 / 90 条演示数据。
import registry from './siteModules.json';

// 单个功能点：每个模块固定三类能力（清单 / 管理 / 记录），状态机由 states 定义。
export interface SiteCapability {
  // 能力编码：catalog / manage / record，模块内唯一。
  code: string;
  // 能力展示名，例如「文章目录」。
  name: string;
  // 该能力下业务条目的实体名，例如「文章」。
  itemKind: string;
  // 能力说明：标明该能力由哪个系统名派生。
  description: string;
  // 允许的状态列表，顺序即展示顺序；后端据此校验状态流转。
  states: string[];
} // SiteCapability 结束

// 演示数据条目：仅用于让每个模块首屏有可读内容，非真实业务数据。
export interface SiteSeedItem {
  // 归属能力编码，必须是所属模块 capabilities 中的一项。
  capability: string;
  // 条目标题。
  title: string;
  // 初始状态，必须落在该能力 states 内。
  status: string;
  // 条目说明，明确标注为演示数据。
  detail: string;
} // SiteSeedItem 结束

// 职责边界：明确模块「负责什么」与「不负责什么」，避免相似模块职责重叠。
export interface SiteResponsibility {
  // 本模块负责的范围，逐条列出。
  inScope: string[];
  // 明确排除、由其它模块承担的范围。
  outOfScope: string[];
} // SiteResponsibility 结束

// 相似模块关联：指向另一个入口，并写明两者的区分点。
export interface SiteRelation {
  // 关联入口的两位序号。
  entryId: string;
  // 关联入口的占位键，便于前端直接跳转。
  entryKey: string;
  // 关系类型：similar（相似需区分）/ depends（依赖）/ shares（共享能力）。
  relation: string;
  // 区分说明：一句话讲清两者边界。
  distinction: string;
} // SiteRelation 结束

// 单个站点模块：一条去重后的业务备注对应一个模块，含两个台账溯源行号。
export interface SiteModule {
  // 两位序号，与备注在清单中首次出现的顺序一致。
  id: string;
  // 稳定入口标识（占位键），例如 PORTAL_ROOT；不是具体主机值。
  entryKey: string;
  // 可配置占位标识，形如 {{HOST:PORTAL_ROOT}}。
  placeholder: string;
  // 运行期配置注入键，形如 MIM_HOST_PORTAL_ROOT。
  envKey: string;
  // 实际主机值：用户未提供，恒为 null；运行期由配置注入，代码不补写。
  hostValue: string | null;
  // 兼容别名：与 entryKey 同值，供既有 /sites/:host 路由按占位键寻址。
  host: string;
  // 备注前半段：入口描述。
  entry: string;
  // 备注后半段：业务系统/模块说明，是模块划分的唯一依据。
  system: string;
  // 备注原文，保留全角竖线，作为唯一比对基准。
  note: string;
  // 来源工作表名称，仅作行号溯源，不作为主机值依据。
  sheet: string;
  // 备注在台账内出现的两个行号。
  rows: number[];
  // 业务域编码，对应 registry.domains 中的 code。
  domain: string;
  // 业务域中文名。
  domainName: string;
  // 兼容别名：与 domain 同值，供既有分组筛选逻辑使用。
  group: string;
  // 核心功能：按业务系统语义逐条列出。
  coreFunctions: string[];
  // 职责边界：负责 / 不负责。
  responsibility: SiteResponsibility;
  // 后台管理职责。
  adminRole: string;
  // 接口职责。
  apiRole: string;
  // 相似模块关联与区分。
  related: SiteRelation[];
  // 该模块的三个运行时能力点。
  capabilities: SiteCapability[];
  // 该模块的两条演示数据。
  seed: SiteSeedItem[];
} // SiteModule 结束

// 业务域：按用户清单的 19 组业务用途归类，便于前端筛选与后端汇总。
export interface SiteDomain {
  // 业务域编码。
  code: string;
  // 业务域中文名。
  name: string;
  // 业务域覆盖说明。
  description: string;
  // 该域下的入口数。
  count: number;
  // 该域下的占位键清单。
  entryKeys: string[];
} // SiteDomain 结束

// 能力类型字典：三类能力的状态机与说明，前后端共用同一口径。
export interface SiteCapabilityKind {
  // 能力类型中文名。
  name: string;
  // 该类型允许的状态列表。
  states: string[];
  // 该类型的行为说明。
  description: string;
} // SiteCapabilityKind 结束

// 空备注行：无功能描述，仅保留占位标识、表内行号与用户是否明确给出的标记。
export interface SiteBlankRow {
  // 占位键：@ 两行合并为 AT_ROOT，其余按行号生成。
  entryKey: string;
  // 可配置占位标识。
  placeholder: string;
  // 实际主机值：用户未提供，恒为 null。
  hostValue: string | null;
  // 来源工作表（仅作行号溯源）。
  sheet: string;
  // 表内行号。
  row: number;
  // 用户本轮消息是否明确给出该行（仅第 2、3 行为 true）。
  givenByUser: boolean;
  // 落实状态，恒为 unresolved。
  resolution: string;
  // 未决原因码，恒为 BLANK_NOTE。
  reasonCode: string;
} // SiteBlankRow 结束

// 去重整理结果：把 @ 记录、空白字段与重复备注的合并口径写进契约。
export interface SiteDedupe {
  // 合并规则原文。
  rule: string;
  // 台账总行数。
  sourceRows: number;
  // 表头行数。
  headerRows: number;
  // 业务备注行数。
  businessNoteRows: number;
  // 重复备注对数。
  duplicatePairs: number;
  // 合并后的业务入口数。
  mergedEntries: number;
  // @ 记录所在行。
  atRecordRows: number[];
  // @ 记录合并后的占位键。
  atRecordMergedInto: string;
  // 其余空白备注行数。
  blankNoteRows: number;
  // 空白备注合并后的占位键。
  blankMergedInto: string;
  // 整理说明。
  note: string;
} // SiteDedupe 结束

// 未建模块的占位记录：@ 根域名或空白备注，合并后只剩一项。
export interface SitePlaceholderRecord {
  // 占位键。
  entryKey: string;
  // 可配置占位标识。
  placeholder: string;
  // 实际主机值，恒为 null。
  hostValue: string | null;
  // 原始出现次数。
  occurrences: number;
  // 原始备注内容（为空）。
  note: string;
  // 整理结论。
  resolution: string;
  // 台账溯源行号（空白记录可缺省）。
  rows?: number[];
} // SitePlaceholderRecord 结束

// 主机配置策略：代码不补写具体主机值，运行期由配置注入。
export interface SiteHostConfig {
  // 配置模式，恒为 placeholder。
  mode: string;
  // 占位标识格式。
  format: string;
  // 环境变量前缀。
  envPrefix: string;
  // 环境变量键格式。
  envKeyFormat: string;
  // 配置模板路径（仓库内只放空值模板）。
  template: string;
  // 缺省主机值，恒为 null。
  defaultValue: string | null;
  // 不补写规则说明。
  rule: string;
  // 未配置时的降级说明。
  resolutionOfMissing: string;
} // SiteHostConfig 结束

// 注册表顶层形状：元信息 + 整理口径 + 能力字典 + 业务域 + 模块 + 空备注行。
export interface SiteModulesRegistry {
  // 数据格式版本号，校验脚本据此拒绝未知格式。
  schema: string;
  // 清单标题。
  title: string;
  // 数据来源说明。
  source: string;
  // 取证范围说明。
  scope: string;
  // 备注格式说明：两段式，无功能规格、无具体主机值。
  noteFormat: string;
  // 模块划分依据说明。
  moduleBasis: string;
  // 实现推导声明：明确哪些字段由业务语义派生，非备注原文。
  derivation: string;
  // 去重整理结果。
  dedupe: SiteDedupe;
  // @ 记录合并后的占位项。
  atRecord: SitePlaceholderRecord;
  // 空白备注合并后的占位项。
  blankRecord: SitePlaceholderRecord;
  // 主机配置策略。
  hostConfig: SiteHostConfig;
  // 已被清空、无法提供信息的数据列。
  clearedColumns: string[];
  // 三类能力的状态机字典。
  capabilityKinds: Record<string, SiteCapabilityKind>;
  // 19 个业务域。
  domains: SiteDomain[];
  // 45 个去重入口。
  modules: SiteModule[];
  // 13 行空备注（占位标识 + 行号溯源）。
  blankRows: SiteBlankRow[];
  // 空白字段整理口径。
  blankRowPolicy: string;
} // SiteModulesRegistry 结束

// 占位解析结果：只回显是否配置，不把具体主机值带进清单契约。
export interface EntryHostResolution {
  // 入口占位键。
  entryKey: string;
  // 可配置占位标识。
  placeholder: string;
  // 运行期配置注入键。
  envKey: string;
  // 是否已由运行期配置注入实际值。
  configured: boolean;
} // EntryHostResolution 结束

// JSON 是静态数据，用显式接口约束形状，避免字面量联合类型限制字段访问。
export const siteModulesRegistry: SiteModulesRegistry = registry as unknown as SiteModulesRegistry;

// 兼容别名补齐：JSON 只保留 entryKey / domain，避免把「具体主机值」写回数据本体；
// host 与 group 在运行时指向占位键与业务域，供既有 /sites/:host 路由按占位标识寻址。
function withCompatAliases(module: SiteModule): SiteModule {
  // 返回浅拷贝并补齐两个别名，不修改 JSON 原始数据。
  return { ...module, host: module.entryKey, group: module.domain };
} // withCompatAliases 结束

// 模块列表的只读别名：业务代码一律通过该常量读取，不直接碰 JSON。
export const SITE_MODULES: readonly SiteModule[] = siteModulesRegistry.modules.map(withCompatAliases);

// 业务域列表的只读别名：前端筛选与后端汇总共用。
export const SITE_DOMAINS: readonly SiteDomain[] = siteModulesRegistry.domains;

// 兼容别名：v1 的分组语义在 v2 中由 19 个业务域承接。
export const SITE_GROUPS: readonly SiteDomain[] = SITE_DOMAINS;

// 能力类型字典的只读别名：后端校验状态流转时按 code 取值。
export const SITE_CAPABILITY_KINDS: Readonly<Record<string, SiteCapabilityKind>> = siteModulesRegistry.capabilityKinds;

// 占位键索引：O(1) 按占位标识定位模块，避免每次请求线性扫描。
const ENTRY_INDEX: ReadonlyMap<string, SiteModule> = new Map(SITE_MODULES.map((m) => [m.entryKey, m]));

// 按占位标识（兼容旧参数名 host）查询模块；不存在时返回 null，调用方据此回 404。
export function findSiteModule(host: string): SiteModule | null {
  // 统一按 Map 查询，空串与未登记占位键都落到 null。
  return ENTRY_INDEX.get(host) ?? null;
} // findSiteModule 结束

// 按占位标识 + 能力编码查询功能点；任一缺失返回 null。
export function findSiteCapability(host: string, code: string): SiteCapability | null {
  // 先定位模块，模块不存在直接返回 null。
  const module = findSiteModule(host);
  // 再在模块内按编码查找能力。
  return module?.capabilities.find((cap) => cap.code === code) ?? null;
} // findSiteCapability 结束

// 判断某状态是否属于指定能力的合法状态集合。
export function isSiteState(capability: SiteCapability, status: string): boolean {
  // 用 includes 做线性判定，states 长度最多 3，开销可忽略。
  return capability.states.includes(status);
} // isSiteState 结束

// 取指定能力的默认状态（states 首项），新建业务条目时由后端调用。
export function defaultSiteState(capability: SiteCapability): string {
  // 能力字典保证 states 非空，缺失时回落到 active 保证不写入非法值。
  return capability.states[0] ?? 'active';
} // defaultSiteState 结束

// 运行期环境读取：浏览器无 process，统一走可选链避免前端打包报错。
function runtimeEnv(): Record<string, string | undefined> {
  // 用 globalThis 兜住非 Node 运行时，返回空对象表示未注入任何配置。
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  // 未注入时返回空对象，所有入口保持未配置状态。
  return proc?.env ?? {};
} // runtimeEnv 结束

// 解析单个入口的可配置占位标识：只判断配置是否存在，不回传具体主机值。
export function resolveEntryHost(entryKey: string, env: Record<string, string | undefined> = runtimeEnv()): EntryHostResolution {
  // 先按占位键定位模块，未登记时仍返回规范化结构供调用方判定。
  const module = ENTRY_INDEX.get(entryKey);
  // 环境变量键由前缀与占位键拼接，缺省时用同一规则推导。
  const envKey = module?.envKey ?? `${siteModulesRegistry.hostConfig.envPrefix}${entryKey}`;
  // 非空字符串才算已配置；空值等同未配置，避免把空串当真实主机值。
  const configured = typeof env[envKey] === 'string' && (env[envKey] as string).trim().length > 0;
  // 返回配置状态，不携带实际主机值。
  return {
    // 入口占位键。
    entryKey,
    // 可配置占位标识。
    placeholder: module?.placeholder ?? `{{HOST:${entryKey}}}`,
    // 配置注入键。
    envKey,
    // 是否已配置。
    configured,
  };
} // resolveEntryHost 结束

// 生成配置模板：45 个环境变量键全部为空值，仓库内不写任何具体主机值。
export function entryHostTemplate(): Record<string, string> {
  // 逐入口生成空值键，值恒为空串。
  const template: Record<string, string> = {};
  // 遍历模块清单，保证模板与清单一一对应。
  for (const module of SITE_MODULES) template[module.envKey] = '';
  // 返回纯空值模板。
  return template;
} // entryHostTemplate 结束

// 汇总注册表规模，供 /api/v1/entries/overview 与前端统计卡片复用。
export function siteModulesSummary(): { modules: number; capabilities: number; groups: number; blankRows: number; domains: number } {
  // 逐项统计，避免把数字硬编码进前后端两处。
  return {
    // 去重后的入口总数。
    modules: SITE_MODULES.length,
    // 运行时能力点总数：每个模块三项能力。
    capabilities: SITE_MODULES.reduce((sum, m) => sum + m.capabilities.length, 0),
    // 业务域总数（兼容 v1 的 groups 字段名）。
    groups: SITE_DOMAINS.length,
    // 台账空备注原始行数。
    blankRows: siteModulesRegistry.blankRows.length,
    // 业务域总数（v2 显式字段）。
    domains: SITE_DOMAINS.length,
  };
} // siteModulesSummary 结束
