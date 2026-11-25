/**
 * 13 业务领域平台静态目录（2026-11-25）：把分散在各业务模块的领域能力收口为一份可核对的契约清单。
 *
 * 设计边界：
 *   - 领域目录为静态契约（类似 deploymentRegistry.json），不查业务表、不提供写接口，避免引入新的数据写入面；
 *   - 前后端各内置同一份清单，以 DOMAIN_SCHEMA 与 slug 集合作为一致性口径，由契约测试保证 key 对齐；
 *   - 所有对外字段一律 snake_case；字典与清单分离，前端据此渲染徽标与筛选项；
 *   - ecommerce / content / marketing / legal / fiscal / product 为已上线（active），其余为规划中（planned）。
 */

// 契约版本号：字段增删或领域集合变化时必须升版，并同步更新前端内置清单。
export const DOMAIN_SCHEMA = 'mim.domain-catalog.v1'; // 导出供路由与测试共用，避免版本号在两处硬编码

// 分组编码联合类型：5 个固定分组，约束字典 key 与领域 category 的取值，防止拼写漂移。
export type DomainCategory = 'production' | 'business' | 'knowledge' | 'lifestyle' | 'support'; // 生产 / 商业 / 知识 / 生活 / 支撑

// 领域状态联合类型：active 表示已上线可用，planned 表示规划中尚未开放。
export type DomainStatus = 'active' | 'planned'; // 与前端状态筛选 option 一一对应

// 分组字典：key 为稳定编码，value 为中文显示名，按固定顺序供前端生成筛选器。
export const DOMAIN_CATEGORIES: Readonly<Record<DomainCategory, string>> = { // 冻结语义的只读字典，运行时不修改
  production: '生产', // 日常生产工作：办公、效率、产品、工程
  business: '商业', // 经营与交易：金融、营销、电商
  knowledge: '知识', // 内容沉淀：创作、教育科研
  lifestyle: '生活', // 生活相关：医疗医药、生活休闲
  support: '支撑', // 合规与资金支撑：法律政务、财税支付
}; // 分组字典结束

// 状态字典：key 为状态编码，value 为中文显示名，供徽标与筛选器文案复用。
export const DOMAIN_STATUSES: Readonly<Record<DomainStatus, string>> = { // 只读字典，避免被路由层意外改写
  active: '已上线', // 已有真实能力可复用，前端展示为可用入口
  planned: '规划中', // 仅给出路线图，前端展示为敬请期待
}; // 状态字典结束

// 单个领域的静态契约形状：9 个字段全部使用 snake_case 命名。
export interface Domain { // 一个领域条目即前端卡片与详情视图的共同数据源
  slug: string; // 领域唯一英文标识，URL 路径参数，全局小写且不可重复
  name_zh: string; // 中文名称，卡片主标题
  name_en: string; // 英文名称，用于国际化与双语标题
  description: string; // 一句话简述，卡片副标题
  icon: string; // emoji 图标字符串，前端直接渲染
  category: DomainCategory; // 所属分组编码，取值必须是 DOMAIN_CATEGORIES 的 key
  status: DomainStatus; // 上线状态，取值必须是 DOMAIN_STATUSES 的 key
  reuse: string; // 复用的现有能力说明，解释本域并非从零建设
  features: readonly string[]; // 3-5 个功能点，只读数组防止调用方篡改静态数据
} // Domain 接口结束

// 13 个领域的单一事实源：顺序即前端卡片展示顺序，运行时仅通过查询函数读取。
export const DOMAINS: readonly Domain[] = [ // 静态常量数组，不写入数据库
  { // 领域 1：办公管理
    slug: 'office', // 唯一标识：office
    name_zh: '办公管理', // 中文名：办公管理
    name_en: 'Office', // 英文名：Office
    description: '协同办公、审批、文档', // 简述：协作与审批链路
    icon: '📋', // emoji 图标：剪贴板
    category: 'production', // 分组：生产
    status: 'planned', // 状态：规划中
    reuse: '复用社区公告、IM 私信与附件上传能力', // 复用说明：沿用已有沟通与文件能力
    features: ['协同文档', '审批流', '考勤打卡', '会议纪要'], // 功能点：4 项
  }, // 领域 1 结束
  { // 领域 2：金融
    slug: 'finance', // 唯一标识：finance
    name_zh: '金融', // 中文名：金融
    name_en: 'Finance', // 英文名：Finance
    description: '记账、资产负债、理财视图', // 简述：个人资产负债视图
    icon: '💰', // emoji 图标：钱袋
    category: 'business', // 分组：商业
    status: 'planned', // 状态：规划中
    reuse: '复用钱包余额、订单流水与提现分成账目', // 复用说明：账目底层已在社区与钱包域存在
    features: ['日常记账', '资产负债', '理财视图', '收支报表'], // 功能点：4 项
  }, // 领域 2 结束
  { // 领域 3：营销增长
    slug: 'marketing', // 唯一标识：marketing
    name_zh: '营销增长', // 中文名：营销增长
    name_en: 'Marketing', // 英文名：Marketing
    description: '推广活动、返佣、增长激励', // 简述：拉新与留存激励
    icon: '📈', // emoji 图标：上升曲线
    category: 'business', // 分组：商业
    status: 'active', // 状态：已上线
    reuse: '复用 growth 积分签到、referral 返佣与推广计划', // 复用说明：三条激励链已在生产运行
    features: ['推广活动', '返佣结算', '签到积分', '增长看板'], // 功能点：4 项
  }, // 领域 3 结束
  { // 领域 4：电商
    slug: 'ecommerce', // 唯一标识：ecommerce
    name_zh: '电商', // 中文名：电商
    name_en: 'E-commerce', // 英文名：E-commerce
    description: '商品、订单、收银（复用现有 commerce）', // 简述：交易主链路
    icon: '🛒', // emoji 图标：购物车
    category: 'business', // 分组：商业
    status: 'active', // 状态：已上线
    reuse: '复用现有 commerce 商品、订单、收银台与优惠码', // 复用说明：直接复用社区商城交易面
    features: ['商品管理', '订单履约', '收银结算', '优惠码'], // 功能点：4 项
  }, // 领域 4 结束
  { // 领域 5：内容创作
    slug: 'content', // 唯一标识：content
    name_zh: '内容创作', // 中文名：内容创作
    name_en: 'Content', // 英文名：Content
    description: '帖子、文章、富文本内容', // 简述：内容生产与发布
    icon: '✍️', // emoji 图标：写作
    category: 'knowledge', // 分组：知识
    status: 'active', // 状态：已上线
    reuse: '复用帖子、圈子、媒体附件与统一内容只读视图', // 复用说明：内容域已有完整读写与浏览能力
    features: ['帖子发布', '文章编辑', '富文本渲染', '内容审核'], // 功能点：4 项
  }, // 领域 5 结束
  { // 领域 6：教育科研
    slug: 'education', // 唯一标识：education
    name_zh: '教育科研', // 中文名：教育科研
    name_en: 'Education', // 英文名：Education
    description: '课程、笔记、知识库', // 简述：课程与知识沉淀
    icon: '🎓', // emoji 图标：学士帽
    category: 'knowledge', // 分组：知识
    status: 'planned', // 状态：规划中
    reuse: '复用内容域知识库与附件存储', // 复用说明：知识载体可沿用现有内容能力
    features: ['课程管理', '学习笔记', '知识库', '课程进度'], // 功能点：4 项
  }, // 领域 6 结束
  { // 领域 7：效率工具
    slug: 'efficiency', // 唯一标识：efficiency
    name_zh: '效率工具', // 中文名：效率工具
    name_en: 'Efficiency', // 英文名：Efficiency
    description: '待办、清单、快捷工具', // 简述：轻量效率入口
    icon: '⚡', // emoji 图标：闪电
    category: 'production', // 分组：生产
    status: 'planned', // 状态：规划中
    reuse: '复用现有待办入口与清单型交互组件', // 复用说明：前端已有清单交互可复用
    features: ['待办事项', '清单管理', '快捷工具', '重复任务'], // 功能点：4 项
  }, // 领域 7 结束
  { // 领域 8：法律政务
    slug: 'legal', // 唯一标识：legal
    name_zh: '法律政务', // 中文名：法律政务
    name_en: 'Legal', // 英文名：Legal
    description: '合规文档、协议、申诉', // 简述：合规与争议处理
    icon: '⚖️', // emoji 图标：天平
    category: 'support', // 分组：支撑
    status: 'active', // 状态：已上线
    reuse: '复用申诉流程、实名认证与合规文档存档', // 复用说明：申诉与实名链路已在生产
    features: ['合规文档', '协议签署', '申诉处理', '留痕审计'], // 功能点：4 项
  }, // 领域 8 结束
  { // 领域 9：产品研发
    slug: 'product', // 唯一标识：product
    name_zh: '产品研发', // 中文名：产品研发
    name_en: 'Product', // 英文名：Product
    description: '部署汇总、版本、路线图', // 简述：研发交付视图
    icon: '🧩', // emoji 图标：拼图
    category: 'production', // 分组：生产
    status: 'active', // 状态：已上线
    reuse: '复用部署汇总注册表、更新日志与版本记录', // 复用说明：部署与发布数据已有静态契约
    features: ['部署汇总', '版本管理', '路线图', '更新日志'], // 功能点：4 项
  }, // 领域 9 结束
  { // 领域 10：医疗医药
    slug: 'medical', // 唯一标识：medical
    name_zh: '医疗医药', // 中文名：医疗医药
    name_en: 'Medical', // 英文名：Medical
    description: '健康档案、用药提醒、科普', // 简述：个人健康与用药管理
    icon: '🩺', // emoji 图标：听诊器
    category: 'lifestyle', // 分组：生活
    status: 'planned', // 状态：规划中
    reuse: '复用个人档案结构与提醒类通知通道', // 复用说明：档案字段与通知能力已有雏形
    features: ['健康档案', '用药提醒', '医学科普', '就诊记录'], // 功能点：4 项
  }, // 领域 10 结束
  { // 领域 11：财税支付
    slug: 'fiscal', // 唯一标识：fiscal
    name_zh: '财税支付', // 中文名：财税支付
    name_en: 'Fiscal', // 英文名：Fiscal
    description: '支付渠道、发票、钱包', // 简述：资金与票据链路
    icon: '🧾', // emoji 图标：收据
    category: 'support', // 分组：支撑
    status: 'active', // 状态：已上线
    reuse: '复用支付渠道、钱包余额与提现结算', // 复用说明：收款与结算能力已生产可用
    features: ['支付渠道', '发票管理', '钱包余额', '对账报表'], // 功能点：4 项
  }, // 领域 11 结束
  { // 领域 12：工程
    slug: 'engineering', // 唯一标识：engineering
    name_zh: '工程', // 中文名：工程
    name_en: 'Engineering', // 英文名：Engineering
    description: '项目、缺陷、构建', // 简述：研发工程闭环
    icon: '🛠️', // emoji 图标：工具
    category: 'production', // 分组：生产
    status: 'planned', // 状态：规划中
    reuse: '复用部署注册表、CI 作业清单与部署异常记录', // 复用说明：构建与交付取证已有数据源
    features: ['项目管理', '缺陷跟踪', '构建记录', '质量门禁'], // 功能点：4 项
  }, // 领域 12 结束
  { // 领域 13：生活休闲
    slug: 'lifestyle', // 唯一标识：lifestyle
    name_zh: '生活休闲', // 中文名：生活休闲
    name_en: 'Lifestyle', // 英文名：Lifestyle
    description: '圈子、兴趣、社区', // 简述：兴趣社交与社区
    icon: '🌱', // emoji 图标：幼苗
    category: 'lifestyle', // 分组：生活
    status: 'planned', // 状态：规划中
    reuse: '复用圈子成员制、板块帖子与会员成长体系', // 复用说明：社区底层能力可直接承接
    features: ['兴趣圈子', '社区动态', '活动报名', '会员成长'], // 功能点：4 项
  }, // 领域 13 结束
]; // DOMAINS 结束

// slug 索引：构建时一次性生成 O(1) 查询表，统一转小写以容忍大小写差异。
const DOMAIN_INDEX: ReadonlyMap<string, Domain> = new Map( // 不可变 Map，避免运行时被外部改动
  DOMAINS.map((domain) => [domain.slug.toLowerCase(), domain] as const), // 以小写 slug 为键建立索引
); // 索引构建结束

// 清单过滤条件：三项全部可选，空串或 undefined 等价于不过滤。
export interface DomainFilter { // 与路由 queryString 读出的三个参数一一对应
  q?: string; // 关键词：匹配 slug / 中英文名 / 简述 / 复用说明 / 功能点
  category?: string; // 分组编码精确匹配，例如 production
  status?: string; // 状态编码精确匹配，例如 active
} // DomainFilter 接口结束

// 按条件过滤领域：所有条件取交集，结果顺序保持 DOMAINS 原序便于前后端逐项核对。
export function listDomains(filter: DomainFilter = {}): Domain[] { // 纯函数，无副作用
  const q = (filter.q ?? '').trim().toLowerCase(); // 关键词归一化：去空白并转小写
  const category = (filter.category ?? '').trim().toLowerCase(); // 分组归一化
  const status = (filter.status ?? '').trim().toLowerCase(); // 状态归一化
  return DOMAINS.filter((domain) => { // 逐项判定，全部条件通过才保留
    if (category && domain.category !== category) return false; // 分组精确匹配，不匹配则淘汰
    if (status && domain.status !== status) return false; // 状态精确匹配，不匹配则淘汰
    if (q) { // 仅当关键词非空时才做包含匹配
      const haystack = [ // 汇总可搜索文本，覆盖中英文与功能点描述
        domain.slug, // 英文标识参与搜索
        domain.name_zh, // 中文名参与搜索
        domain.name_en, // 英文名参与搜索
        domain.description, // 简述参与搜索
        domain.reuse, // 复用说明参与搜索
        ...domain.features, // 功能点逐条展开参与搜索
      ].join(' ').toLowerCase(); // 拼接为单一小写字符串，供 includes 判定
      if (!haystack.includes(q)) return false; // 未命中关键词则淘汰
    } // 关键词过滤结束
    return true; // 通过全部条件
  }); // filter 回调结束
} // listDomains 结束

// 按 slug 查询单个领域：不存在（含空串）返回 null，调用方据此回 404。
export function findDomain(slug: string): Domain | null { // 查询函数供详情与 features 端点共用
  return DOMAIN_INDEX.get(slug.trim().toLowerCase()) ?? null; // 统一小写查索引，未命中回落 null
} // findDomain 结束

// 全量汇总：给出领域总数、分组 / 状态分布与上线计数，供 overview 卡片直接渲染。
export function domainSummary() { // 返回结构与 API /domains/overview 顶层字段一一对应
  const by_category: Record<string, number> = {}; // 分组分布容器，键为分组编码
  for (const key of Object.keys(DOMAIN_CATEGORIES)) by_category[key] = 0; // 预置全部分组为 0，空分组也要显示
  const by_status: Record<string, number> = {}; // 状态分布容器，键为状态编码
  for (const key of Object.keys(DOMAIN_STATUSES)) by_status[key] = 0; // 预置两种状态为 0，避免前端缺键
  let active_count = 0; // 已上线领域计数
  let planned_count = 0; // 规划中领域计数
  for (const domain of DOMAINS) { // 逐项累加，数字由数据推导而非硬编码
    by_category[domain.category] = (by_category[domain.category] ?? 0) + 1; // 分组计数加一
    by_status[domain.status] = (by_status[domain.status] ?? 0) + 1; // 状态计数加一
    if (domain.status === 'active') active_count += 1; // 已上线计数加一
    else planned_count += 1; // 否则计入规划中
  } // 汇总循环结束
  return { // 返回结构化汇总，字段名全部 snake_case
    schema: DOMAIN_SCHEMA, // 契约版本，便于前端拒绝未知格式
    total: DOMAINS.length, // 领域总数（13）
    by_category, // 分组分布，合计等于 total
    by_status, // 状态分布，合计等于 total
    active_count, // 已上线数量，等于 by_status.active
    planned_count, // 规划中数量，等于 by_status.planned
  }; // 返回对象结束
} // domainSummary 结束
