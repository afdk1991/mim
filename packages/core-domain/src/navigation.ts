/**
 * 全站资源导航站（NAVIGATION）共享契约：链接种子、状态判定与可达性探测口径。
 *
 * 设计边界（与入口清单里该模块的职责一致）：
 *   - 只维护「链接目录 + 可达性状态 + 检索推荐位」，不承载被链系统的内容；
 *   - 不负责 DNS 解析或跳转决策（跳转由浏览器直接完成，本模块只记录可达性）；
 *   - 探测口径与状态判定放在共享包，服务端探测与前端徽标共用同一套判定，避免两边结论不一致。
 */

/** 链接可达性状态：ok 可达 / broken 失效 / unknown 未探测 */
export type NavLinkStatus = 'ok' | 'broken' | 'unknown';

/** 允许出现在库里的状态值，供 zod 枚举与前端徽标共用 */
export const NAV_LINK_STATUSES: readonly NavLinkStatus[] = ['ok', 'broken', 'unknown'];

/** 初始种子：站内既有视图入口，全部为相对路径，不写任何具体域名 */
export interface NavLinkSeed {
  /** 展示名 */
  name: string;
  /** 相对路径或绝对地址 */
  url: string;
  /** 分组名，用于目录分类 */
  group: string;
  /** 一句说明 */
  description: string;
  /** 是否进入推荐位 */
  recommended: boolean;
} // 代码块结束

/**
 * 默认导航目录：只收录本项目已上线的视图入口。
 * 用相对路径表达，避免在仓库里写死生产域名；探测时由运行环境补齐 origin。
 */
export const NAV_LINK_SEEDS: readonly NavLinkSeed[] = [
  { name: '商城目录', url: '/marketplace', group: '业务入口', description: '模块目录与详情，匿名可浏览', recommended: true }, // 执行当前业务步骤
  { name: '入口配置清单', url: '/entry-catalog', group: '业务入口', description: '44 个去重入口的模块目录与业务条目', recommended: true }, // 执行当前业务步骤
  { name: '个人中心', url: '/account', group: '业务入口', description: '资料、权益、订单与账号设置', recommended: false }, // 执行当前业务步骤
  { name: '购物车', url: '/cart', group: '交易链路', description: '加购、结算与订单提交', recommended: false }, // 执行当前业务步骤
  { name: '漫剧工作台', url: '/comic-studio', group: '创作工具', description: '放映厅与创作工作台', recommended: true }, // 执行当前业务步骤
  { name: '聊天', url: '/chat', group: '协作', description: '会话、消息与视频通话', recommended: false }, // 执行当前业务步骤
  { name: '部署汇总', url: '/deployments', group: '运维', description: '部署仓库与部署项的统一核对表', recommended: false }, // 执行当前业务步骤
]; // 执行当前业务步骤

/**
 * 归一化链接地址：允许 http(s) 绝对地址或以 / 开头的站内相对路径；其余一律视为非法。
 * @returns 归一化后的地址；非法时返回 null，由路由层翻译成 VALIDATION_FAILED。
 */
export function normalizeNavUrl(raw: string): string | null {
  const value = raw.trim(); // 去首尾空白，避免粘贴带空格
  if (!value) return null; // 空串直接判非法
  if (value.startsWith('/') && !value.startsWith('//')) return value; // 站内相对路径：单斜杠开头，排除协议相对地址
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const parsed = new URL(value); // 绝对地址必须能被 URL 解析
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null; // 只接受 http(s)
    return parsed.toString(); // 统一序列化，去掉多余空白与默认端口
  } catch { // 代码块结束
    return null; // 解析失败即非法
  } // 代码块结束
} // 代码块结束

/**
 * 计算探测目标：相对路径按运行环境 origin 补齐；绝对地址原样使用。
 * @param url 库里存的地址
 * @param origin 运行环境对外 origin（如 https://mim.mixm.top），不含尾斜杠
 */
export function resolveProbeTarget(url: string, origin: string): string {
  if (url.startsWith('/')) return `${origin.replace(/\/+$/, '')}${url}`; // 相对路径拼 origin
  return url; // 绝对地址直接用
} // 代码块结束

/**
 * 判定探测结果：2xx / 3xx 视为可达，4xx / 5xx 与网络异常视为失效。
 * @param httpStatus 响应状态码；网络异常或超时为 null
 * @param error 网络层错误信息；正常返回时为 null
 */
export function classifyProbe(httpStatus: number | null, error: string | null): NavLinkStatus {
  if (error) return 'broken'; // 超时 / DNS / TLS 等一律记失效，不冒充可达
  if (httpStatus === null) return 'unknown'; // 既无状态又无错误：未完成探测
  return httpStatus >= 200 && httpStatus < 400 ? 'ok' : 'broken'; // 3xx 视为可达（跳转目标存在）
} // 代码块结束

/** 导航目录条目：对外视图字段 */
export interface NavLinkView {
  /** 主键 */
  id: string;
  /** 名称 */
  name: string;
  /** 地址（相对路径或绝对 URL） */
  url: string;
  /** 分组 */
  group: string;
  /** 说明 */
  description: string;
  /** 是否推荐 */
  recommended: boolean;
  /** 可达性状态 */
  status: NavLinkStatus;
  /** 最近一次探测的 HTTP 状态码 */
  http_status: number | null;
  /** 最近一次探测耗时（毫秒） */
  latency_ms: number | null;
  /** 最近一次探测时间 */
  last_checked_at: string | null;
  /** 创建者：种子为 system，用户新建为用户 id */
  created_by: string;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
} // 代码块结束

/** 目录汇总：给页面顶部与接口一次性返回计数 */
export interface NavLinkSummary {
  /** 链接总数 */
  total: number;
  /** 可达数 */
  ok: number;
  /** 失效数 */
  broken: number;
  /** 未探测数 */
  unknown: number;
  /** 分组计数，按数量降序 */
  groups: Array<{ name: string; count: number }>;
  /** 最近一次探测时间（全目录最大值） */
  last_checked_at: string | null;
} // 代码块结束

/** 汇总计算：纯函数，服务端与前端共用同一口径 */
export function summarizeNavLinks(items: readonly NavLinkView[]): NavLinkSummary {
  const counts = { ok: 0, broken: 0, unknown: 0 }; // 三态计数
  const groupMap = new Map<string, number>(); // 分组计数
  let latest: string | null = null; // 最近探测时间
  for (const item of items) { // 循环：逐项遍历集合并执行相同处理
    counts[item.status] += 1; // 状态计数
    groupMap.set(item.group, (groupMap.get(item.group) ?? 0) + 1); // 分组计数累加
    if (item.last_checked_at && (!latest || item.last_checked_at > latest)) latest = item.last_checked_at; // 取最大时间戳（ISO 字符串可直接比较）
  } // 代码块结束
  return { // 返回当前函数的处理结果
    total: items.length, // 总数
    ok: counts.ok, // 可达
    broken: counts.broken, // 失效
    unknown: counts.unknown, // 未探测
    groups: [...groupMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), // 分组按数量降序
    last_checked_at: latest, // 最近探测时间
  }; // 代码块结束
} // 代码块结束
