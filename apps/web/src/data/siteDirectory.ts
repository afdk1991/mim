// 站点入口契约：把 DNSPod 导出表格中的备注逐项固化为项目内可校验的数据。
// 数据本体在同名 JSON 中，本模块只负责类型约束与对外取值，不产生任何业务行为。
import contract from './siteDirectory.json'; // 导入单一数据源：46 类业务备注 + 15 行空备注行的取证结果

// 单条备注的来源定位：工作表名称 + 表内行号，便于回查原始 xls。
export interface SiteSource {
  // 工作表名称，取值为 laal.top 或 mixm.top。
  sheet: string;
  // 备注在该工作表内出现的行号列表（与表格显示行号一致，含表头行偏移）。
  rows: string[];
} // 来源结构结束

// 单条站点入口备注的完整契约字段。
export interface SiteEntry {
  // 两位序号，按备注在 xls 中首次出现的顺序编号。
  id: string;
  // 短主机记录，例如 www、admin、auth、store。
  host: string;
  // 备注前半段：入口描述，例如「管理后台入口」。
  entry: string;
  // 备注后半段：系统名，例如「全站统一运营管理后台」。
  system: string;
  // 备注原文，保留全角竖线分隔符，作为唯一比对基准。
  note: string;
  // 该备注在两个工作表中的全部出现位置。
  sources: SiteSource[];
  // 与现有源码的对齐分组：aligned / partial / absent / conflict。
  alignment: string;
  // 备注对应的现有实现路径；无对应实现时为 null。
  implementation: string | null;
  // 落实状态：aligned-no-change / data-driven / unresolved。
  resolution: string;
  // 未决原因码，释义见 JSON 的 reasonCodes 字段。
  reasonCode: string;
  // 仅 www 条目具备：门户卡片文案，与改造前渲染结果逐字一致。
  portalLabel?: string;
  // 仅 www 条目具备：门户卡片链接，沿用现有实现值而非备注推导。
  portalHref?: string;
  // 仅 www 条目具备：链接来源说明，标明记录值列已清空。
  hrefOrigin?: string;
} // 站点条目结构结束

// 空备注行：无功能描述，仅保留表内位置供后续确认。
export interface SiteBlankRow {
  // 工作表名称。
  sheet: string;
  // 表内行号。
  row: number;
  // 主机记录。
  host: string;
  // 落实状态，恒为 unresolved。
  resolution: string;
  // 未决原因码，恒为 BLANK_NOTE。
  reasonCode: string;
} // 空备注行结构结束

// 契约文件的顶层形状：元信息 + 原因码释义 + 业务条目 + 空备注行。
export interface SiteDirectory {
  // 数据格式版本号，校验脚本据此拒绝未知格式。
  schema: string;
  // 数据来源文件名，标明唯一文档依据。
  source: string;
  // 取证范围说明。
  scope: string;
  // 取证时间。
  capturedAt: string;
  // 备注格式说明：两段式，无功能规格。
  noteFormat: string;
  // 已被清空、因而无法提供信息的数据列。
  clearedColumns: string[];
  // 清空列造成的信息缺口说明。
  clearedColumnEffect: string;
  // 未决原因码到中文释义的映射。
  reasonCodes: Record<string, string>;
  // 46 类业务备注的逐项契约。
  entries: SiteEntry[];
  // 15 行空备注的位置与状态。
  blankRows: SiteBlankRow[];
} // 顶层结构结束

// JSON 是静态取证数据，用显式接口约束形状，避免数组字面量联合类型限制可选字段访问。
export const siteDirectory: SiteDirectory = contract as unknown as SiteDirectory;

// 取出 www 门户条目：备注「主站常规访问入口｜官方门户网站」对应的既有 UI 落点。
const portalEntry = siteDirectory.entries.find((item) => item.id === '02'); // 按固定序号取，避免受主机记录重复影响

// 门户卡片的对外取值：契约数据优先，缺失时回落到改造前的硬编码值，保证零行为变化。
export const PORTAL_ENTRY = {
  // 卡片文案：与改造前「主站常规访问入口 · www · 官方门户网站 ·」逐字一致。
  label: portalEntry?.portalLabel ?? '主站常规访问入口 · www · 官方门户网站 ·',
  // 卡片链接：xls 记录值列已清空，故沿用现有实现值，不从备注推导。
  href: portalEntry?.portalHref ?? 'https://www.mixm.top',
}; // 门户取值结束
