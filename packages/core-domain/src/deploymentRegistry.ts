/**
 * 部署汇总注册表：把散落在 AGENTS.md / README / CI / git 远端的部署仓库与部署项收口为单一事实源。
 * 数据本体在同目录 deploymentRegistry.json；本文件只负责类型约束、索引、过滤与汇总，不产生业务副作用。
 * 统一字段一律 snake_case，与后端 API 响应字段一致；空数据用 null、缺失信息用 missing_fields 显式标注。
 */
// 导入单一数据源 JSON：11 个矩阵平台 / 12 个规范部署项 / 5 个 CI 作业 / 2 个 git 远端 / 7 个候选排除项。
import registry from './deploymentRegistry.json';

// 单个部署项的仓库标识：三字段统一，无仓库载体时 id 与 url 为 null。
export interface DeploymentRepository {
  // 规范仓库标识，例如 github:afdk1991/mim、ghcr:afdk1991/mim-api。
  id: string | null;
  // 仓库地址，可为空（直传型部署无仓库连接）。
  url: string | null;
  // 该仓库在本部署项中承担的角色。
  role: string;
} // DeploymentRepository 结束

// 交付链路：mode / ci_job / ci_step / artifact 与「远端 HEAD / 本地工作树」双口径工件存在性。
export interface DeploymentDelivery {
  // 交付方式：ci（CI 自动）/ manual（手工直传）/ push（git 推送）。
  mode: 'ci' | 'manual' | 'push';
  // 关联的 CI 作业 id，无则为 null。
  ci_job: string | null;
  // 关联的 CI 步骤名，无则为 null。
  ci_step: string | null;
  // 关键部署工件路径，无则为 null。
  artifact: string | null;
  // 工件是否仍存在于远端 HEAD（决定 CI 当前是否可读）。
  artifact_in_head: boolean | null;
  // 工件是否存在于本地工作树（决定本地能否复现）。
  artifact_in_worktree: boolean | null;
  // 所需凭证说明。
  credential: string | null;
  // 同一部署项的多种发布形态，合并展示以避免重复计数。
  modes: string[];
} // DeploymentDelivery 结束

// 部署结果：null 表示本轮无任何取证，属于「空数据」，不得渲染成 0 或成功。
export interface DeploymentResult {
  // 结论码：PASS / DEGRADED / FAIL / NOT_TESTED / EMPTY。
  verdict: string;
  // 本轮 HTTP 状态码字符串；git 通道取证时为 null。
  http_code: string | null;
  // 本轮耗时（毫秒）。
  latency_ms: number | null;
  // 响应体字节数。
  bytes: number | null;
  // 取证原文与判读说明。
  evidence: string;
  // 取证时间。
  captured_at: string | null;
} // DeploymentResult 结束

// 异常说明：统一 code + 严重度 + 中文说明，供表格与徽标共用。
export interface DeploymentAnomaly {
  // 异常码，全表可重复出现但同项内唯一。
  code: string;
  // 严重度：critical / warning / info，对应 🔴 / 🟡 / 🟢。
  severity: 'critical' | 'warning' | 'info';
  // 异常说明（含影响面与处置提示）。
  message: string;
} // DeploymentAnomaly 结束

// 单个部署项：所有同类项共用这一组字段，避免各文档自定义列名。
export interface DeploymentItem {
  // 规范唯一键，全表不得重复。
  id: string;
  // 统一中文名称。
  name: string;
  // 归并的历史别名，作为「不重复计数」的证据。
  aliases: string[];
  // 归属平台规范编码，必落平台目录。
  platform_id: string;
  // 归属平台展示名。
  platform: string;
  // 层级：production / distribution / source。
  layer: string;
  // 载体类型。
  kind: string;
  // 仓库标识。
  repository: DeploymentRepository;
  // 部署入口，可为空。
  entry_url: string | null;
  // 交付链路。
  delivery: DeploymentDelivery;
  // 部署状态，取值见状态字典。
  status: string;
  // 部署结果，null 为空数据。
  result: DeploymentResult | null;
  // 异常说明列表。
  anomalies: DeploymentAnomaly[];
  // 缺失信息清单。
  missing_fields: string[];
  // 取证来源。
  sources: string[];
} // DeploymentItem 结束

// 平台目录项：标明是否属于铁律九 9 平台矩阵。
export interface DeploymentPlatform {
  // 平台规范编码。
  id: string;
  // 平台展示名。
  name: string;
  // 是否计入 9 平台矩阵。
  in_matrix: boolean;
} // DeploymentPlatform 结束

// CI 作业：区分部署作业与质量门禁作业。
export interface DeploymentCiJob {
  // 作业 id，与 deploy.yml 的 job key 一致。
  id: string;
  // 作业职责说明。
  role: string;
  // 是否属于部署作业（verify 为门禁，不计入）。
  is_deploy: boolean;
} // DeploymentCiJob 结束

// 候选池 / 已排除项：明确非部署项，避免误纳入或争议性遗漏。
export interface DeploymentExcluded {
  // 规范键。
  id: string;
  // 平台或方案名。
  name: string;
  // 排除理由。
  reason: string;
} // DeploymentExcluded 结束

// 汇总覆盖口径：解释「9 平台 / 11 部署项」为何不相等，以及去重与补齐依据。
export interface DeploymentCoverage {
  // 铁律九矩阵平台数。
  matrix_platforms: number;
  // 规范部署项数。
  deployment_items: number;
  // git 远端数。
  git_remotes: number;
  // CI 作业总数。
  ci_jobs: number;
  // 其中部署作业数。
  deploy_ci_jobs: number;
  // 去重说明。
  dedup_note: string;
  // 补齐说明。
  added_note: string;
  // 排除说明。
  excluded_note: string;
} // DeploymentCoverage 结束

// 注册表顶层形状：元信息 + 字典 + 平台 / 作业 / 覆盖 / 排除 / 部署项。
export interface DeploymentRegistry {
  // 数据格式版本号，校验脚本据此拒绝未知格式。
  schema: string;
  // 取证时间。
  capturedAt: string;
  // 本轮本地 HEAD。
  head: string;
  // 取证范围。
  scope: string;
  // 取证来源清单。
  sources: string[];
  // 统一字段说明。
  field_spec: Record<string, string>;
  // 部署状态字典。
  status_codes: Record<string, string>;
  // 部署结果字典。
  verdict_codes: Record<string, string>;
  // 严重度字典。
  severity_codes: Record<string, string>;
  // 层级字典。
  layer_codes: Record<string, string>;
  // 平台目录。
  platform_catalog: DeploymentPlatform[];
  // CI 作业清单。
  ci_jobs: DeploymentCiJob[];
  // 覆盖口径。
  coverage: DeploymentCoverage;
  // 候选池 / 排除项。
  excluded: DeploymentExcluded[];
  // 规范部署项。
  items: DeploymentItem[];
} // DeploymentRegistry 结束

// JSON 是静态数据，用显式接口约束形状，避免字面量联合类型限制字段访问。
export const deploymentRegistry: DeploymentRegistry = registry as unknown as DeploymentRegistry;

// 部署项只读别名：业务代码一律通过该常量读取，不直接碰 JSON。
export const DEPLOYMENT_ITEMS: readonly DeploymentItem[] = deploymentRegistry.items;

// 平台目录只读别名。
export const DEPLOYMENT_PLATFORMS: readonly DeploymentPlatform[] = deploymentRegistry.platform_catalog;

// CI 作业只读别名。
export const DEPLOYMENT_CI_JOBS: readonly DeploymentCiJob[] = deploymentRegistry.ci_jobs;

// 候选池 / 排除项只读别名。
export const DEPLOYMENT_EXCLUDED: readonly DeploymentExcluded[] = deploymentRegistry.excluded;

// 部署状态字典只读别名：前端与后端共用同一份文案。
export const DEPLOYMENT_STATUS_CODES: Readonly<Record<string, string>> = deploymentRegistry.status_codes;

// 部署结果字典只读别名。
export const DEPLOYMENT_VERDICT_CODES: Readonly<Record<string, string>> = deploymentRegistry.verdict_codes;

// 严重度字典只读别名。
export const DEPLOYMENT_SEVERITY_CODES: Readonly<Record<string, string>> = deploymentRegistry.severity_codes;

// 层级字典只读别名。
export const DEPLOYMENT_LAYER_CODES: Readonly<Record<string, string>> = deploymentRegistry.layer_codes;

// 规范 id 索引：O(1) 定位部署项，同时供校验脚本判定唯一性。
const ITEM_INDEX: ReadonlyMap<string, DeploymentItem> = new Map(DEPLOYMENT_ITEMS.map((item) => [item.id, item]));

// 按规范 id 查询部署项；不存在返回 null，调用方据此回 404。
export function findDeploymentItem(id: string): DeploymentItem | null {
  // 统一按 Map 查询，空串与未登记 id 都落到 null。
  return ITEM_INDEX.get(id) ?? null;
} // findDeploymentItem 结束

// 列表过滤条件：全部可选，空值表示不过滤。
export interface DeploymentFilter {
  // 按层级过滤。
  layer?: string;
  // 按部署状态过滤。
  status?: string;
  // 按结果结论过滤；'EMPTY' 特判 result 为 null 的空数据项。
  verdict?: string;
  // 按平台编码过滤。
  platform_id?: string;
  // 关键词：匹配 id / 名称 / 别名 / 仓库标识 / 入口。
  q?: string;
} // DeploymentFilter 结束

// 按条件过滤部署项：所有条件取交集，顺序保持注册表原序以便核对。
export function listDeploymentItems(filter: DeploymentFilter = {}): DeploymentItem[] {
  // 关键词统一小写化并去空白，避免大小写差异造成漏项。
  const q = (filter.q ?? '').trim().toLowerCase();
  // 逐项判定，纯函数无副作用。
  return DEPLOYMENT_ITEMS.filter((item) => {
    // 层级精确匹配。
    if (filter.layer && item.layer !== filter.layer) return false;
    // 状态精确匹配。
    if (filter.status && item.status !== filter.status) return false;
    // 平台精确匹配。
    if (filter.platform_id && item.platform_id !== filter.platform_id) return false;
    // 结果结论：EMPTY 命中 result 为 null，其余命中 result.verdict。
    if (filter.verdict) {
      if (filter.verdict === 'EMPTY') {
        if (item.result !== null) return false;
      } else if (item.result?.verdict !== filter.verdict) return false;
    } // 结果过滤结束
    // 关键词跨多字段包含匹配，覆盖名称异写与仓库标识。
    if (q) {
      const haystack = [item.id, item.name, item.platform, ...item.aliases, item.repository.id ?? '', item.entry_url ?? '']
        .join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    } // 关键词过滤结束
    // 全部条件通过。
    return true;
  });
} // listDeploymentItems 结束

// 全量汇总：按状态 / 结果 / 层级 / 平台 / 严重度分布，供总览卡片与交付报告复用。
export function deploymentSummary() {
  // 状态分布。
  const by_status: Record<string, number> = {};
  // 结果分布，空数据单独归到 EMPTY 桶。
  const by_verdict: Record<string, number> = {};
  // 层级分布。
  const by_layer: Record<string, number> = {};
  // 平台分布。
  const by_platform: Record<string, number> = {};
  // 严重度分布。
  const by_severity: Record<string, number> = { critical: 0, warning: 0, info: 0 };
  // 有取证的项数。
  let with_result = 0;
  // 空数据项数。
  let empty_result = 0;
  // 异常总数。
  let anomalies = 0;
  // 缺失字段总数。
  let missing_fields = 0;
  // 工件在远端 HEAD 存在但工作树缺失的项数（悬空风险）。
  let worktree_drift = 0;
  // 逐项累加，避免把数字硬编码进前后端两处。
  for (const item of DEPLOYMENT_ITEMS) {
    by_status[item.status] = (by_status[item.status] ?? 0) + 1;
    const verdict = item.result?.verdict ?? 'EMPTY';
    by_verdict[verdict] = (by_verdict[verdict] ?? 0) + 1;
    by_layer[item.layer] = (by_layer[item.layer] ?? 0) + 1;
    by_platform[item.platform_id] = (by_platform[item.platform_id] ?? 0) + 1;
    if (item.result === null) empty_result += 1;
    else with_result += 1;
    anomalies += item.anomalies.length;
    missing_fields += item.missing_fields.length;
    for (const a of item.anomalies) by_severity[a.severity] = (by_severity[a.severity] ?? 0) + 1;
    if (item.delivery.artifact_in_head === true && item.delivery.artifact_in_worktree === false) worktree_drift += 1;
  } // 汇总循环结束
  // 返回结构化汇总，字段与 API 响应一一对应。
  return {
    schema: deploymentRegistry.schema,
    captured_at: deploymentRegistry.capturedAt,
    head: deploymentRegistry.head,
    total: DEPLOYMENT_ITEMS.length,
    matrix_platforms: deploymentRegistry.coverage.matrix_platforms,
    platform_catalog: DEPLOYMENT_PLATFORMS.length,
    git_remotes: deploymentRegistry.coverage.git_remotes,
    ci_jobs: DEPLOYMENT_CI_JOBS.length,
    deploy_ci_jobs: deploymentRegistry.coverage.deploy_ci_jobs,
    excluded: DEPLOYMENT_EXCLUDED.length,
    with_result,
    empty_result,
    anomalies,
    missing_fields,
    worktree_drift,
    by_status,
    by_verdict,
    by_layer,
    by_platform,
    by_severity,
    coverage: deploymentRegistry.coverage,
  };
} // deploymentSummary 结束
