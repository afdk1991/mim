/**
 * 站点模块地图（site 域）
 *
 * 数据源：dnspod_records_2026-11-05_21-42-26.xls 的「备注」列（2026-11-05 导出）。
 * 两个托管 zone 各 45 条主机记录，备注描述即该子站/服务模块的产品定位。
 * 本文件把备注落成结构化数据，供 GET /api/v1/site/modules 公开读取。
 *
 * 说明：记录值为 DNSPod 解析值（laal.top → 103.0.113.10、mixm.top → 103.0.113.20），
 * 仅取短主机记录（不含与 FQDN 重复的行）；gy 在 mixm.top 为 CNAME 指向疾风引擎边缘节点。
 */

// 两个托管 zone 的静态定义：id 与 apex 同值，record_value 为该 zone 的默认 A 记录值。
// 用 as const 固化字面量类型，SiteZoneId 才能从数组中反推出 'laal.top' | 'mixm.top'。
export const SITE_ZONES = [
  // laal.top 主 zone：默认解析到 103.0.113.10（DNSPod 导出值）
  { id: 'laal.top', apex: 'laal.top', record_value: '103.0.113.10' },
  // mixm.top 备用 zone：默认解析到 103.0.113.20（DNSPod 导出值）
  { id: 'mixm.top', apex: 'mixm.top', record_value: '103.0.113.20' },
] as const; // 冻结为只读元组，避免运行期被误改

/** 默认解析 TTL（秒），与 DNSPod 导出一致 */
const TTL = 600; // 600 秒即 10 分钟，是导出表中所有记录的统一 TTL

// 从 SITE_ZONES 反推 zone 字面量联合类型，供全文件做穷尽校验
export type SiteZoneId = (typeof SITE_ZONES)[number]['id'];

// 8 个站点分类的联合类型：用字面量联合保证「分类只能是这 8 个之一」，
// 新增分类必须同时改这里与 SITE_CATEGORIES，编译期即可发现遗漏。
export type SiteCategoryId =
  | 'portal' // 门户与入口
  | 'identity' // 身份与权限
  | 'ops' // 运营后台
  | 'api' // 接口与开发
  | 'content' // 内容与媒体
  | 'commerce' // 电商与交易
  | 'data' // 数据与存储
  | 'tools'; // 工具与服务

// 分类条目：id 用于接口过滤，name 提供中英双语展示名
export interface SiteCategory {
  id: SiteCategoryId; // 分类标识，与 SiteCategoryId 联合类型一一对应
  name: { zh: string; en: string }; // 双语名称，前端按 locale 取值
}

// 8 个分类的有序定义；顺序即前端分组展示顺序（门户 → 工具）
export const SITE_CATEGORIES: SiteCategory[] = [
  // 门户与入口：根域名、主站、移动端、登录页等对外第一触点
  { id: 'portal', name: { zh: '门户与入口', en: 'Portal & Entry' } },
  // 身份与权限：认证中心与安全防护
  { id: 'identity', name: { zh: '身份与权限', en: 'Identity & Access' } },
  // 运营后台：管理、用户、卖家、供应商、监控、BI
  { id: 'ops', name: { zh: '运营后台', en: 'Operations Console' } },
  // 接口与开发：网关、APP 接口、开发/测试环境、低代码
  { id: 'api', name: { zh: '接口与开发', en: 'API & Developer' } },
  // 内容与媒体：博客、资讯、短视频、长视频、图床
  { id: 'content', name: { zh: '内容与媒体', en: 'Content & Media' } },
  // 电商与交易：商城、店铺、B2B、C2C、货源、营销、支付
  { id: 'commerce', name: { zh: '电商与交易', en: 'Commerce & Trade' } },
  // 数据与存储：开放数据、采集、云盘、下载站
  { id: 'data', name: { zh: '数据与存储', en: 'Data & Storage' } },
  // 工具与服务：疾风引擎、导航、帮助、工单、语音、WordPress
  { id: 'tools', name: { zh: '工具与服务', en: 'Tools & Services' } },
];

// 单条 DNS 解析记录：一个模块在每个 zone 各产生一条
export interface SiteRecord {
  zone: SiteZoneId; // 该记录所属 zone
  fqdn: string; // 完整域名，如 api.laal.top / laal.top（根记录）
  record_type: 'A' | 'CNAME'; // 记录类型；绝大多数为 A，gy@mixm.top 为 CNAME
  record_value: string; // 解析目标：A 记录为 IP，CNAME 记录为别名域名
  ttl: number; // 生存时间（秒）
  /** 该 zone 的备注与默认备注不同时覆盖 */
  label?: string; // record 级备注第一段；仅当该 zone 的备注与众模块不同才出现
  description?: string; // record 级备注第二段；同上
}

// 站点模块：把「一个主机 + 它的多 zone 解析记录」聚合为一个可展示单元
export interface SiteModule {
  host: string; // 主机名（不含 zone），根域名为 '@'
  category: SiteCategoryId; // 所属分类
  /** 备注第一段：模块定位 */
  label: string; // 模块级备注第一段（默认取自 laal.top 的备注）
  /** 备注第二段：站点说明 */
  description: string; // 模块级备注第二段
  /** 可访问地址（按 zone 生成，CNAME 记录同样给出 https 入口） */
  urls: string[]; // 与 records 一一对应的 https 入口地址
  records: SiteRecord[]; // 该模块在两个 zone 下的解析记录
}

// 原始录入结构：比 SiteModule 少一层展开，便于逐条手写 45 行备注
interface RawModule {
  host: string; // 主机名
  category: SiteCategoryId; // 分类
  label: string; // 备注第一段（laal.top 口径）
  description: string; // 备注第二段（laal.top 口径）
  /** 仅 mixm.top 与默认 A 记录不同时覆盖 */
  mixm?: { record_type: 'A' | 'CNAME'; record_value: string; label?: string; description?: string }; // mixm.top 的差异项，缺省则沿用默认值
}

// 45 条原始录入，严格对应 DNSPod 导出表的 45 个主机记录备注
const RAW: RawModule[] = [
  // ---------- 门户与入口（6）----------
  // 根域名：所有子站的统一跳转起点
  { host: '@', category: 'portal', label: '核心根域名，主站基础入口', description: '主站统一跳转门户' },
  // www：最常规的官网访问前缀
  { host: 'www', category: 'portal', label: '主站常规访问入口', description: '官方门户网站' },
  // portal：面向企业内部员工的门户工作台
  { host: 'portal', category: 'portal', label: '门户首页入口', description: '企业内部统一门户 / 工作台' },
  // m：移动端短域名（H5 精简版）
  { host: 'm', category: 'portal', label: '移动端适配入口', description: '移动端 H5 精简版官网' },
  // mobile：移动端全功能站点
  { host: 'mobile', category: 'portal', label: '移动终端专用入口', description: '全功能移动端站点' },
  // login：统一单点登录页
  { host: 'login', category: 'portal', label: '登录验证入口', description: '统一单点登录页' },

  // ---------- 身份与权限（2）----------
  // auth：认证与授权中心
  { host: 'auth', category: 'identity', label: '权限验证入口', description: '统一身份认证与权限中心' },
  // secure：安全防护与风控
  { host: 'secure', category: 'identity', label: '安全防护入口', description: '安全防护中心' },

  // ---------- 运营后台（8）----------
  // admin：全站最高权限的运营后台
  { host: 'admin', category: 'ops', label: '管理后台入口', description: '全站统一运营管理后台' },
  // user：C 端用户与会员管理
  { host: 'user', category: 'ops', label: '用户管理入口', description: '用户会员管理后台' },
  // center：用户个人中心 / 会员工作台
  { host: 'center', category: 'ops', label: '用户中心入口', description: '用户个人中心 / 会员工作台' },
  // seller：个人卖家店铺后台
  { host: 'seller', category: 'ops', label: '个人卖家管理入口', description: '个人卖家店铺管理后台' },
  // supplier：供应商入驻与供货管理
  { host: 'supplier', category: 'ops', label: '供应商入驻管理入口', description: '供应商后台管理系统' },
  // fwq（服务器）：运维监控面板
  { host: 'fwq', category: 'ops', label: '服务器支撑入口', description: '运维监控面板' },
  // service：服务治理与监控
  { host: 'service', category: 'ops', label: '服务支撑入口', description: '服务治理监控平台' },
  // stats：全站数据 BI 看板
  { host: 'stats', category: 'ops', label: '数据统计入口', description: '全站数据 BI 看板' },

  // ---------- 接口与开发（5）----------
  // api：对外统一 API 网关
  { host: 'api', category: 'api', label: '接口服务入口', description: 'API 统一网关' },
  // app：移动端专属接口
  { host: 'app', category: 'api', label: 'APP 端接口入口', description: '移动端专属接口服务' },
  // dev：开发环境门户与接口文档
  { host: 'dev', category: 'api', label: '开发测试入口', description: '开发环境门户 + 接口文档' },
  // test：测试环境统一入口
  { host: 'test', category: 'api', label: '测试环境入口', description: '测试环境统一入口' },
  // dnpj：低代码/代码生成平台
  { host: 'dnpj', category: 'api', label: '代码生成工具入口', description: '低代码生成平台' },

  // ---------- 内容与媒体（7）----------
  // blog：官方博客
  { host: 'blog', category: 'content', label: '博客模块入口', description: '官方博客系统' },
  // news：新闻资讯发布
  { host: 'news', category: 'content', label: '资讯模块入口', description: '新闻资讯发布系统' },
  // xw（新闻）：自媒体资讯平台
  { host: 'xw', category: 'content', label: '新闻资讯入口', description: '自媒体资讯平台' },
  // dy（抖音/动态）：UGC 短视频社区
  { host: 'dy', category: 'content', label: '视频动态模块入口', description: 'UGC 短视频动态社区' },
  // sp（视频）：长视频点播
  { host: 'sp', category: 'content', label: '视频模块入口', description: '长视频点播系统' },
  // video：独立视频播放页
  { host: 'video', category: 'content', label: '视频播放入口', description: '独立视频播放页' },
  // img：公共图床与素材站
  { host: 'img', category: 'content', label: '图片资源入口', description: '公共图床 + 素材资源站' },

  // ---------- 电商与交易（7）----------
  // mall：B2C 官方商城
  { host: 'mall', category: 'commerce', label: '电商商城入口', description: 'B2C 官方商城系统' },
  // shop：多商户店铺系统
  { host: 'shop', category: 'commerce', label: '线上店铺入口', description: '多商户店铺系统' },
  // b2b：企业批发采购平台
  { host: 'b2b', category: 'commerce', label: 'B2B 大宗商贸平台主入口', description: 'B2B 企业批发采购平台' },
  // c2c：个人闲置/商品交易
  { host: 'c2c', category: 'commerce', label: 'C2C 个人交易市场入口', description: 'C2C 个人闲置 / 商品交易平台' },
  // yp（样品/货源）：货源商品库
  { host: 'yp', category: 'commerce', label: '商品资源入口', description: '货源商品库平台' },
  // market：营销活动管理
  { host: 'market', category: 'commerce', label: '营销模块入口', description: '营销活动管理平台' },
  // pay：支付聚合与对账
  { host: 'pay', category: 'commerce', label: '支付结算入口', description: '支付聚合网关 + 对账系统' },

  // ---------- 数据与存储（4）----------
  // data：开放数据集平台（与 EdgeOne Pages 静态站对应）
  { host: 'data', category: 'data', label: '数据中心入口', description: '开放数据集平台' },
  // sj（数据）：爬虫调度与采集
  { host: 'sj', category: 'data', label: '数据采集入口', description: '爬虫调度与数据采集平台' },
  // cloud：私有云盘/网盘
  { host: 'cloud', category: 'data', label: '云服务模块入口', description: '私有云盘 / 网盘系统' },
  // store：软件源码下载分发
  { host: 'store', category: 'data', label: '资源存储 / 下载站点', description: '软件源码下载分发站' },

  // ---------- 工具与服务（6）----------
  {
    host: 'gy', // 工具模块主入口（疾风引擎）
    category: 'tools', // 归属工具与服务分类
    label: '工具模块入口', // laal.top 口径备注第一段
    description: '在线工具集合平台', // laal.top 口径备注第二段
    mixm: {
      // mixm.top 是 CNAME 而非 A 记录，直接指向 EdgeOne 边缘节点
      record_type: 'CNAME',
      // 疾风引擎在 EdgeOne 的落地域名（含末尾点，保持 DNSPod 原样）
      record_value: 'gale-engine-landing-6j02gsvv.edgeone.cool.',
      // mixm.top 侧的备注描述与 laal.top 不同，故在 record 级覆盖
      label: '工具模块核心入口，疾风引擎承载节点',
      // mixm.top 侧的站点说明
      description: '疾风引擎在线工具平台',
    },
  },
  // dh（导航）：全站资源导航
  { host: 'dh', category: 'tools', label: '导航模块入口', description: '全站资源导航站' },
  // help：产品帮助文档
  { host: 'help', category: 'tools', label: '帮助中心入口', description: '产品帮助文档中心' },
  // support：工单客服
  { host: 'support', category: 'tools', label: '技术支持入口', description: '工单客服系统' },
  // yy（语音）：语音工具服务
  { host: 'yy', category: 'tools', label: '语音相关入口', description: '语音工具服务平台' },
  // wp（WordPress）：独立 WP 站点
  { host: 'wp', category: 'tools', label: 'WordPress 相关入口', description: 'WordPress 独立站点' },
];

/**
 * 把主机名拼成完整域名。
 * 根记录 '@' 直接返回 zone 本身（如 laal.top），其余拼成 host.zone。
 */
function fqdnOf(host: string, zone: SiteZoneId): string {
  return host === '@' ? zone : `${host}.${zone}`; // '@' 是 DNS 根记录写法，不能拼成 @.laal.top
}

/**
 * 把一条 RawModule 展开为 SiteModule：
 * 依次为两个 zone 生成解析记录，mixm.top 有差异项时以 record 级覆盖。
 */
function buildModule(raw: RawModule): SiteModule {
  // 每个 zone 生成一条记录，顺序与 SITE_ZONES 一致（laal.top 在前）
  const records: SiteRecord[] = SITE_ZONES.map((zone) => {
    // 只有 mixm.top 存在覆盖项，其余 zone 一律走默认 A 记录
    const override = zone.id === 'mixm.top' ? raw.mixm : undefined;
    return {
      zone: zone.id, // 记录所属 zone
      fqdn: fqdnOf(raw.host, zone.id), // 按该 zone 拼出完整域名
      record_type: override?.record_type ?? 'A', // 有覆盖用覆盖类型，否则默认 A
      record_value: override?.record_value ?? zone.record_value, // 有覆盖用覆盖值，否则用 zone 默认 IP
      ttl: TTL, // 统一 TTL，与 DNSPod 导出一致
      ...(override?.label ? { label: override.label } : {}), // 仅在有覆盖时写入 label，避免空字段污染响应
      ...(override?.description ? { description: override.description } : {}), // 同上，按需写入 description
    };
  });

  // 组装模块级字段；urls 与 records 一一对应，保证前端可按下标配对
  return {
    host: raw.host, // 主机名
    category: raw.category, // 分类
    label: raw.label, // 模块级备注第一段（保持 laal.top 口径，不被 mixm 覆盖）
    description: raw.description, // 模块级备注第二段
    urls: records.map((r) => `https://${r.fqdn}`), // 每条记录给出一个 https 入口
    records, // 两 zone 的解析记录
  };
}

/** 45 条站点模块（按分类顺序、分类内保持备注原序） */
export const SITE_MODULES: SiteModule[] = RAW.map(buildModule); // 模块级派生一次，运行期只读使用

/** 类型守卫：判断任意字符串是否为合法分类 id，供路由做参数校验 */
export function isSiteCategory(value: string): value is SiteCategoryId {
  return SITE_CATEGORIES.some((c) => c.id === value); // 与分类常量表比对，避免手写 if 链
}

/** 类型守卫：判断任意字符串是否为合法 zone id，供路由做参数校验 */
export function isSiteZone(value: string): value is SiteZoneId {
  return SITE_ZONES.some((z) => z.id === value); // 与 zone 常量表比对
}
