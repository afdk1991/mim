/**
 * 业务领域门户 API 封装（13 业务域平台化，2026-11-25）。
 *
 * 四个公开只读端点：overview / list / detail / features，统一走 request 出口，
 * 显式 auth:false（匿名可读）与 idempotency:false（GET 天然幂等），与社区 / 定价页口径一致。
 * 所有响应先归一化再交给视图：兼容顶层数组与 { items/domains/features } 包裹两种形状，
 * 避免后端并行开发期间 key 漂移导致门户白屏（统筹方案风险 R4）。
 *
 * 内置 FALLBACK_DOMAINS 与后端 catalog.ts 同一份 13 领域口径：slug 固定、状态与分组一一对应；
 * 网络失败 / 后端未上线时，视图仍能完整渲染 13 张卡与详情。
 */

import { request } from './request.js'; // 统一请求出口：鉴权 / 幂等 / 401 续期与其他业务域完全一致

/** 领域状态：active 已上线可复用，planned 规划中。 */
export type DomainStatus = 'active' | 'planned'; // 两种取值与后端 domains.status 一一对应

/** 领域摘要：总览卡片所需的全部字段。 */
export interface DomainSummary { // 声明结构 DomainSummary：列表项
  slug: string; // 唯一键，深链接 / 详情端点使用
  name_zh: string; // 中文名（卡片主标题）
  name_en: string; // 英文名（卡片副标题）
  description: string; // 一句话说明
  icon: string; // 图标字形（无第三方图标库，按文本徽标渲染）
  category: string; // 分组：支撑 / 商业 / 知识 / 生产 / 生活
  status: DomainStatus; // 上线状态：active 绿标 / planned 灰标
  reuse: string; // 复用的现有能力说明
} // 接口结束

/** 领域详情：在摘要基础上补功能点名称清单。 */
export interface Domain extends DomainSummary { // 继承摘要，详情多一个功能点字段
  features: string[]; // 功能点名称：网络失败时由前端转成详情列表
} // 接口结束

/** 单个功能点：详情端点 /domains/:slug/features 的条目。 */
export interface DomainFeature { // 声明结构 DomainFeature：功能点
  slug: string; // 功能点唯一键（前端按序号生成时保持稳定）
  name_zh: string; // 中文名
  name_en: string; // 英文名
  description: string; // 一句话说明，缺省空串
} // 接口结束

/** 概览统计：总数 / 已上线数 / 分组数。 */
export interface DomainOverview { // 声明结构 DomainOverview：顶部统计
  total: number; // 领域总数（固定 13）
  active: number; // 已上线领域数
  categories: number; // 分组数量
} // 接口结束

/**
 * 前端内置兜底清单：13 领域静态契约目录，与后端 catalog.ts 逐字段对齐。
 * 分组与状态严格照抄统筹方案 §二模块清单；功能点名称用于离线详情兜底。
 */
export const FALLBACK_DOMAINS: Domain[] = [ // 13 项完整数据：除图标字形外与后端 catalog.ts 逐字段对齐
  { // 1 办公管理
    slug: 'office', // 唯一键：办公管理
    name_zh: '办公管理', // 中文名
    name_en: 'Office', // 英文名（与后端一致）
    description: '协同办公、审批、文档', // 一句话说明（与后端一致）
    icon: '办', // 文本图标字形（后端下发 emoji，兜底用字形，渲染口径一致）
    category: 'production', // 分组编码：生产
    status: 'planned', // 状态：规划中
    reuse: '复用社区公告、IM 私信与附件上传能力', // 复用的现有能力
    features: ['协同文档', '审批流', '考勤打卡', '会议纪要'], // 功能点名称清单
  }, // 办公管理结束
  { // 2 金融
    slug: 'finance', // 唯一键：金融
    name_zh: '金融', // 中文名
    name_en: 'Finance', // 英文名
    description: '记账、资产负债、理财视图', // 一句话说明
    icon: '金', // 文本图标字形
    category: 'business', // 分组编码：商业
    status: 'planned', // 状态：规划中
    reuse: '复用钱包余额、订单流水与提现分成账目', // 复用的现有能力
    features: ['日常记账', '资产负债', '理财视图', '收支报表'], // 功能点名称清单
  }, // 金融结束
  { // 3 营销增长
    slug: 'marketing', // 唯一键：营销增长
    name_zh: '营销增长', // 中文名
    name_en: 'Marketing', // 英文名
    description: '推广活动、返佣、增长激励', // 一句话说明
    icon: '营', // 文本图标字形
    category: 'business', // 分组编码：商业
    status: 'active', // 状态：已上线
    reuse: '复用 growth 积分签到、referral 返佣与推广计划', // 复用的现有能力
    features: ['推广活动', '返佣结算', '签到积分', '增长看板'], // 功能点名称清单
  }, // 营销增长结束
  { // 4 电商
    slug: 'ecommerce', // 唯一键：电商
    name_zh: '电商', // 中文名
    name_en: 'E-commerce', // 英文名
    description: '商品、订单、收银（复用现有 commerce）', // 一句话说明
    icon: '电', // 文本图标字形
    category: 'business', // 分组编码：商业
    status: 'active', // 状态：已上线
    reuse: '复用现有 commerce 商品、订单、收银台与优惠码', // 复用的现有能力
    features: ['商品管理', '订单履约', '收银结算', '优惠码'], // 功能点名称清单
  }, // 电商结束
  { // 5 内容创作
    slug: 'content', // 唯一键：内容创作
    name_zh: '内容创作', // 中文名
    name_en: 'Content', // 英文名
    description: '帖子、文章、富文本内容', // 一句话说明
    icon: '内', // 文本图标字形
    category: 'knowledge', // 分组编码：知识
    status: 'active', // 状态：已上线
    reuse: '复用帖子、圈子、媒体附件与统一内容只读视图', // 复用的现有能力
    features: ['帖子发布', '文章编辑', '富文本渲染', '内容审核'], // 功能点名称清单
  }, // 内容创作结束
  { // 6 教育科研
    slug: 'education', // 唯一键：教育科研
    name_zh: '教育科研', // 中文名
    name_en: 'Education', // 英文名
    description: '课程、笔记、知识库', // 一句话说明
    icon: '教', // 文本图标字形
    category: 'knowledge', // 分组编码：知识
    status: 'planned', // 状态：规划中
    reuse: '复用内容域知识库与附件存储', // 复用的现有能力
    features: ['课程管理', '学习笔记', '知识库', '课程进度'], // 功能点名称清单
  }, // 教育科研结束
  { // 7 效率工具
    slug: 'efficiency', // 唯一键：效率工具
    name_zh: '效率工具', // 中文名
    name_en: 'Efficiency', // 英文名
    description: '待办、清单、快捷工具', // 一句话说明
    icon: '效', // 文本图标字形
    category: 'production', // 分组编码：生产
    status: 'planned', // 状态：规划中
    reuse: '复用现有待办入口与清单型交互组件', // 复用的现有能力
    features: ['待办事项', '清单管理', '快捷工具', '重复任务'], // 功能点名称清单
  }, // 效率工具结束
  { // 8 法律政务
    slug: 'legal', // 唯一键：法律政务
    name_zh: '法律政务', // 中文名
    name_en: 'Legal', // 英文名
    description: '合规文档、协议、申诉', // 一句话说明
    icon: '法', // 文本图标字形
    category: 'support', // 分组编码：支撑
    status: 'active', // 状态：已上线
    reuse: '复用申诉流程、实名认证与合规文档存档', // 复用的现有能力
    features: ['合规文档', '协议签署', '申诉处理', '留痕审计'], // 功能点名称清单
  }, // 法律政务结束
  { // 9 产品研发
    slug: 'product', // 唯一键：产品研发
    name_zh: '产品研发', // 中文名
    name_en: 'Product', // 英文名
    description: '部署汇总、版本、路线图', // 一句话说明
    icon: '产', // 文本图标字形
    category: 'production', // 分组编码：生产
    status: 'active', // 状态：已上线
    reuse: '复用部署汇总注册表、更新日志与版本记录', // 复用的现有能力
    features: ['部署汇总', '版本管理', '路线图', '更新日志'], // 功能点名称清单
  }, // 产品研发结束
  { // 10 医疗医药
    slug: 'medical', // 唯一键：医疗医药
    name_zh: '医疗医药', // 中文名
    name_en: 'Medical', // 英文名
    description: '健康档案、用药提醒、科普', // 一句话说明
    icon: '医', // 文本图标字形
    category: 'lifestyle', // 分组编码：生活
    status: 'planned', // 状态：规划中
    reuse: '复用个人档案结构与提醒类通知通道', // 复用的现有能力
    features: ['健康档案', '用药提醒', '医学科普', '就诊记录'], // 功能点名称清单
  }, // 医疗医药结束
  { // 11 财税支付
    slug: 'fiscal', // 唯一键：财税支付
    name_zh: '财税支付', // 中文名
    name_en: 'Fiscal', // 英文名
    description: '支付渠道、发票、钱包', // 一句话说明
    icon: '财', // 文本图标字形
    category: 'support', // 分组编码：支撑
    status: 'active', // 状态：已上线
    reuse: '复用支付渠道、钱包余额与提现结算', // 复用的现有能力
    features: ['支付渠道', '发票管理', '钱包余额', '对账报表'], // 功能点名称清单
  }, // 财税支付结束
  { // 12 工程
    slug: 'engineering', // 唯一键：工程
    name_zh: '工程', // 中文名
    name_en: 'Engineering', // 英文名
    description: '项目、缺陷、构建', // 一句话说明
    icon: '工', // 文本图标字形
    category: 'production', // 分组编码：生产
    status: 'planned', // 状态：规划中
    reuse: '复用部署注册表、CI 作业清单与部署异常记录', // 复用的现有能力
    features: ['项目管理', '缺陷跟踪', '构建记录', '质量门禁'], // 功能点名称清单
  }, // 工程结束
  { // 13 生活休闲
    slug: 'lifestyle', // 唯一键：生活休闲
    name_zh: '生活休闲', // 中文名
    name_en: 'Lifestyle', // 英文名
    description: '圈子、兴趣、社区', // 一句话说明
    icon: '生', // 文本图标字形
    category: 'lifestyle', // 分组编码：生活
    status: 'planned', // 状态：规划中
    reuse: '复用圈子成员制、板块帖子与会员成长体系', // 复用的现有能力
    features: ['兴趣圈子', '社区动态', '活动报名', '会员成长'], // 功能点名称清单
  }, // 生活休闲结束
]; // 兜底清单结束

/** 本地兜底统计：直接从内置清单派生，后端不可达时顶部数字仍然正确。 */
export function fallbackOverview(): DomainOverview { // 统计兜底
  return { // 组装本地统计
    total: FALLBACK_DOMAINS.length, // 总数即清单长度 13
    active: FALLBACK_DOMAINS.filter((domain) => domain.status === 'active').length, // 已上线按状态计数
    categories: new Set(FALLBACK_DOMAINS.map((domain) => domain.category)).size, // 分组数按去重集合计算
  }; // 返回结束
} // fallbackOverview 结束

/** 按 slug 在兜底清单里找领域；未命中返回 null 交给视图渲染空态。 */
export function fallbackDomain(slug: string): Domain | null { // 兜底单条查询
  return FALLBACK_DOMAINS.find((domain) => domain.slug === slug) ?? null; // 精确匹配 slug，找不到返回 null
} // fallbackDomain 结束

/** 把兜底功能点名称转成详情列表项，保证离线详情也能展示功能点说明位。 */
export function fallbackFeatures(domain: Domain | null): DomainFeature[] { // 功能点兜底
  if (!domain) return []; // 无领域时没有功能点
  return domain.features.map((name, index) => ({ // 逐个名称转成条目
    slug: `${domain.slug}-${index + 1}`, // 用领域 slug + 序号生成稳定键
    name_zh: name, // 中文名取名称原文
    name_en: name, // 英文名兜底同中文名（内置清单只维护中文）
    description: '', // 说明留空，视图按空串省略渲染
  })); // 转换结束
} // fallbackFeatures 结束

/** 把任意值收窄为普通对象；数组 / null / 非对象统一回落空对象。 */
function asRecord(value: unknown): Record<string, unknown> { // 对象收窄
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; // 只接受非数组对象
  return value as Record<string, unknown>; // 断言为可索引对象，调用方按可选字段读取
} // asRecord 结束

/** 把字段值安全转成字符串；非字符串一律回落空串。 */
function asText(value: unknown): string { // 文本收窄
  return typeof value === 'string' ? value : ''; // 数字 / 空值不当作展示文案
} // asText 结束

/** 把统计字段安全转成非负整数；脏值与负数归零。 */
function asCount(value: unknown): number { // 计数收窄
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0; // 仅接受有限非负数
} // asCount 结束

/** 兼容顶层数组与 { items/domains/features } 包裹两种响应形状。 */
function asItems(value: unknown): unknown[] { // 列表收窄
  if (Array.isArray(value)) return value; // 顶层即数组
  const record = asRecord(value); // 读取包裹对象
  for (const key of ['items', 'domains', 'features']) { // 依次尝试常见包裹键
    if (Array.isArray(record[key])) return record[key] as unknown[]; // 命中即返回该数组
  } // 遍历结束
  return []; // 都不命中回落空数组
} // asItems 结束

/** 单条摘要归一化；缺 slug 视为脏数据丢弃。 */
function normalizeSummary(value: unknown): DomainSummary | null { // 摘要归一化
  const record = asRecord(value); // 读取对象视图
  const slug = asText(record.slug).trim(); // slug 是唯一键，去空白后校验
  if (!slug) return null; // 无 slug 直接丢弃
  const status: DomainStatus = asText(record.status) === 'active' ? 'active' : 'planned'; // 仅 active 视为已上线
  return { // 组装摘要
    slug, // 唯一键
    name_zh: asText(record.name_zh) || slug, // 中文名缺失时回显 slug
    name_en: asText(record.name_en) || slug, // 英文名缺失时回显 slug
    description: asText(record.description), // 描述缺省空串
    icon: asText(record.icon) || '·', // 图标缺省用中点占位
    category: asText(record.category) || '其他', // 分组缺省其他
    status, // 归一化后的状态
    reuse: asText(record.reuse), // 复用能力缺省空串
  }; // 返回结束
} // normalizeSummary 结束

/** 功能点名称归一化：兼容字符串数组与对象数组两种下发口径。 */
function asFeatureNames(value: unknown): string[] { // 功能点名称收窄
  return asItems(value) // 取列表
    .map((item) => asText(typeof item === 'string' ? item : asRecord(item).name_zh)) // 字符串直接取，对象取中文名
    .filter((name) => name.length > 0); // 剔除空项
} // asFeatureNames 结束

/** 详情归一化：兼容 { domain: ... } 包裹与裸对象，并补齐 features。 */
function normalizeDomain(value: unknown): Domain | null { // 详情归一化
  const outer = asRecord(value); // 读取外层对象
  const inner = outer.item ?? outer.domain ?? value; // 兼容后端 { item }、{ domain } 与裸对象三种包裹
  const base = normalizeSummary(inner); // 归一化摘要字段
  if (!base) return null; // slug 缺失视为无效详情
  const featureSource = asRecord(inner).features ?? outer.features; // 优先内层 features，再退回外层
  return { ...base, features: asFeatureNames(featureSource) }; // 展开摘要并追加功能点名称清单
} // normalizeDomain 结束

/** 概览统计归一化：任一字段缺失 / 为 0 时按内置清单兜底。 */
export function normalizeOverview(data: unknown): DomainOverview { // 概览归一化
  const record = asRecord(data); // 读取对象视图
  const fallback = fallbackOverview(); // 本地兜底统计
  const byCategory = asRecord(record.by_category ?? record.categories); // 分组分布：兼容 by_category 字典与 categories 字典
  return { // 组装统计
    total: asCount(record.total) || fallback.total, // 总数缺省用清单长度
    active: asCount(record.active_count) || asCount(record.active) || fallback.active, // 已上线数优先读后端 active_count
    categories: Object.keys(byCategory).length || fallback.categories, // 分组数按分布字典键数，后端 categories 是字典而非数字
  }; // 返回结束
} // normalizeOverview 结束

/** 列表归一化：逐条过滤脏数据；空结果交给视图用兜底清单补齐。 */
export function normalizeSummaries(data: unknown): DomainSummary[] { // 列表归一化
  return asItems(data) // 取列表
    .map((item) => normalizeSummary(item)) // 逐条归一化
    .filter((item): item is DomainSummary => item !== null); // 剔除无 slug 的脏条目
} // normalizeSummaries 结束

/** 功能点列表归一化：字段缺失的条目只保留 slug 占位。 */
export function normalizeFeatures(data: unknown): DomainFeature[] { // 功能点归一化
  const record = asRecord(data); // 读取外层对象
  const source = Array.isArray(record.features) ? record.features : asItems(data); // 优先用 features 字符串数组：后端 items 对象的 name_zh 是领域名而非功能点名
  return source.map((item, index) => { // 逐条归一化
    const row = asRecord(item); // 读取对象视图；字符串条目会收窄为空对象
    const text = typeof item === 'string' ? item : ''; // 后端 features 端点直接下发字符串数组
    return { // 组装功能点
      slug: asText(row.slug) || `feature-${index + 1}`, // 缺 slug 时用序号兜底
      name_zh: text || asText(row.name_zh) || asText(row.name), // 字符串取原文；对象取中文名，优先功能点文本
      name_en: asText(row.name_en), // 英文名缺省空串
      description: asText(row.description), // 说明缺省空串
    }; // 返回结束
  }); // 映射结束
} // normalizeFeatures 结束

/** GET /api/v1/domains/overview：顶部统计，匿名只读。 */
export function fetchDomainOverview(): Promise<DomainOverview> { // 概览请求
  return request<unknown>('/domains/overview', { auth: false, idempotency: false }).then(normalizeOverview); // 公开 GET 不做鉴权与幂等，响应统一归一化
} // fetchDomainOverview 结束

/** GET /api/v1/domains：领域摘要清单，匿名只读。 */
export function fetchDomains(): Promise<DomainSummary[]> { // 列表请求
  return request<unknown>('/domains', { auth: false, idempotency: false }).then(normalizeSummaries); // 公开 GET，兼容数组 / items 包裹
} // fetchDomains 结束

/** GET /api/v1/domains/:slug：单领域详情，匿名只读；404 由调用方转空态。 */
export function fetchDomain(slug: string): Promise<Domain | null> { // 详情请求
  return request<unknown>(`/domains/${encodeURIComponent(slug)}`, { auth: false, idempotency: false }).then(normalizeDomain); // slug 编码防注入，响应统一归一化
} // fetchDomain 结束

/** GET /api/v1/domains/:slug/features：功能点列表，匿名只读。 */
export function fetchDomainFeatures(slug: string): Promise<DomainFeature[]> { // 功能点请求
  return request<unknown>(`/domains/${encodeURIComponent(slug)}/features`, { auth: false, idempotency: false }).then(normalizeFeatures); // slug 编码防注入，兼容数组 / items 包裹
} // fetchDomainFeatures 结束
