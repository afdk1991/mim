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

export const SITE_ZONES = [
  { id: 'laal.top', apex: 'laal.top', record_value: '103.0.113.10' },
  { id: 'mixm.top', apex: 'mixm.top', record_value: '103.0.113.20' },
] as const;

/** 默认解析 TTL（秒），与 DNSPod 导出一致 */
const TTL = 600;

export type SiteZoneId = (typeof SITE_ZONES)[number]['id'];

export type SiteCategoryId =
  | 'portal'
  | 'identity'
  | 'ops'
  | 'api'
  | 'content'
  | 'commerce'
  | 'data'
  | 'tools';

export interface SiteCategory {
  id: SiteCategoryId;
  name: { zh: string; en: string };
}

export const SITE_CATEGORIES: SiteCategory[] = [
  { id: 'portal', name: { zh: '门户与入口', en: 'Portal & Entry' } },
  { id: 'identity', name: { zh: '身份与权限', en: 'Identity & Access' } },
  { id: 'ops', name: { zh: '运营后台', en: 'Operations Console' } },
  { id: 'api', name: { zh: '接口与开发', en: 'API & Developer' } },
  { id: 'content', name: { zh: '内容与媒体', en: 'Content & Media' } },
  { id: 'commerce', name: { zh: '电商与交易', en: 'Commerce & Trade' } },
  { id: 'data', name: { zh: '数据与存储', en: 'Data & Storage' } },
  { id: 'tools', name: { zh: '工具与服务', en: 'Tools & Services' } },
];

export interface SiteRecord {
  zone: SiteZoneId;
  fqdn: string;
  record_type: 'A' | 'CNAME';
  record_value: string;
  ttl: number;
  /** 该 zone 的备注与默认备注不同时覆盖 */
  label?: string;
  description?: string;
}

export interface SiteModule {
  host: string;
  category: SiteCategoryId;
  /** 备注第一段：模块定位 */
  label: string;
  /** 备注第二段：站点说明 */
  description: string;
  /** 可访问地址（按 zone 生成，CNAME 记录同样给出 https 入口） */
  urls: string[];
  records: SiteRecord[];
}

interface RawModule {
  host: string;
  category: SiteCategoryId;
  label: string;
  description: string;
  /** 仅 mixm.top 与默认 A 记录不同时覆盖 */
  mixm?: { record_type: 'A' | 'CNAME'; record_value: string; label?: string; description?: string };
}

const RAW: RawModule[] = [
  // ---------- 门户与入口（6）----------
  { host: '@', category: 'portal', label: '核心根域名，主站基础入口', description: '主站统一跳转门户' },
  { host: 'www', category: 'portal', label: '主站常规访问入口', description: '官方门户网站' },
  { host: 'portal', category: 'portal', label: '门户首页入口', description: '企业内部统一门户 / 工作台' },
  { host: 'm', category: 'portal', label: '移动端适配入口', description: '移动端 H5 精简版官网' },
  { host: 'mobile', category: 'portal', label: '移动终端专用入口', description: '全功能移动端站点' },
  { host: 'login', category: 'portal', label: '登录验证入口', description: '统一单点登录页' },

  // ---------- 身份与权限（2）----------
  { host: 'auth', category: 'identity', label: '权限验证入口', description: '统一身份认证与权限中心' },
  { host: 'secure', category: 'identity', label: '安全防护入口', description: '安全防护中心' },

  // ---------- 运营后台（8）----------
  { host: 'admin', category: 'ops', label: '管理后台入口', description: '全站统一运营管理后台' },
  { host: 'user', category: 'ops', label: '用户管理入口', description: '用户会员管理后台' },
  { host: 'center', category: 'ops', label: '用户中心入口', description: '用户个人中心 / 会员工作台' },
  { host: 'seller', category: 'ops', label: '个人卖家管理入口', description: '个人卖家店铺管理后台' },
  { host: 'supplier', category: 'ops', label: '供应商入驻管理入口', description: '供应商后台管理系统' },
  { host: 'fwq', category: 'ops', label: '服务器支撑入口', description: '运维监控面板' },
  { host: 'service', category: 'ops', label: '服务支撑入口', description: '服务治理监控平台' },
  { host: 'stats', category: 'ops', label: '数据统计入口', description: '全站数据 BI 看板' },

  // ---------- 接口与开发（5）----------
  { host: 'api', category: 'api', label: '接口服务入口', description: 'API 统一网关' },
  { host: 'app', category: 'api', label: 'APP 端接口入口', description: '移动端专属接口服务' },
  { host: 'dev', category: 'api', label: '开发测试入口', description: '开发环境门户 + 接口文档' },
  { host: 'test', category: 'api', label: '测试环境入口', description: '测试环境统一入口' },
  { host: 'dnpj', category: 'api', label: '代码生成工具入口', description: '低代码生成平台' },

  // ---------- 内容与媒体（7）----------
  { host: 'blog', category: 'content', label: '博客模块入口', description: '官方博客系统' },
  { host: 'news', category: 'content', label: '资讯模块入口', description: '新闻资讯发布系统' },
  { host: 'xw', category: 'content', label: '新闻资讯入口', description: '自媒体资讯平台' },
  { host: 'dy', category: 'content', label: '视频动态模块入口', description: 'UGC 短视频动态社区' },
  { host: 'sp', category: 'content', label: '视频模块入口', description: '长视频点播系统' },
  { host: 'video', category: 'content', label: '视频播放入口', description: '独立视频播放页' },
  { host: 'img', category: 'content', label: '图片资源入口', description: '公共图床 + 素材资源站' },

  // ---------- 电商与交易（7）----------
  { host: 'mall', category: 'commerce', label: '电商商城入口', description: 'B2C 官方商城系统' },
  { host: 'shop', category: 'commerce', label: '线上店铺入口', description: '多商户店铺系统' },
  { host: 'b2b', category: 'commerce', label: 'B2B 大宗商贸平台主入口', description: 'B2B 企业批发采购平台' },
  { host: 'c2c', category: 'commerce', label: 'C2C 个人交易市场入口', description: 'C2C 个人闲置 / 商品交易平台' },
  { host: 'yp', category: 'commerce', label: '商品资源入口', description: '货源商品库平台' },
  { host: 'market', category: 'commerce', label: '营销模块入口', description: '营销活动管理平台' },
  { host: 'pay', category: 'commerce', label: '支付结算入口', description: '支付聚合网关 + 对账系统' },

  // ---------- 数据与存储（4）----------
  { host: 'data', category: 'data', label: '数据中心入口', description: '开放数据集平台' },
  { host: 'sj', category: 'data', label: '数据采集入口', description: '爬虫调度与数据采集平台' },
  { host: 'cloud', category: 'data', label: '云服务模块入口', description: '私有云盘 / 网盘系统' },
  { host: 'store', category: 'data', label: '资源存储 / 下载站点', description: '软件源码下载分发站' },

  // ---------- 工具与服务（6）----------
  {
    host: 'gy',
    category: 'tools',
    label: '工具模块入口',
    description: '在线工具集合平台',
    mixm: {
      record_type: 'CNAME',
      record_value: 'gale-engine-landing-6j02gsvv.edgeone.cool.',
      label: '工具模块核心入口，疾风引擎承载节点',
      description: '疾风引擎在线工具平台',
    },
  },
  { host: 'dh', category: 'tools', label: '导航模块入口', description: '全站资源导航站' },
  { host: 'help', category: 'tools', label: '帮助中心入口', description: '产品帮助文档中心' },
  { host: 'support', category: 'tools', label: '技术支持入口', description: '工单客服系统' },
  { host: 'yy', category: 'tools', label: '语音相关入口', description: '语音工具服务平台' },
  { host: 'wp', category: 'tools', label: 'WordPress 相关入口', description: 'WordPress 独立站点' },
];

function fqdnOf(host: string, zone: SiteZoneId): string {
  return host === '@' ? zone : `${host}.${zone}`;
}

function buildModule(raw: RawModule): SiteModule {
  const records: SiteRecord[] = SITE_ZONES.map((zone) => {
    const override = zone.id === 'mixm.top' ? raw.mixm : undefined;
    return {
      zone: zone.id,
      fqdn: fqdnOf(raw.host, zone.id),
      record_type: override?.record_type ?? 'A',
      record_value: override?.record_value ?? zone.record_value,
      ttl: TTL,
      ...(override?.label ? { label: override.label } : {}),
      ...(override?.description ? { description: override.description } : {}),
    };
  });

  return {
    host: raw.host,
    category: raw.category,
    label: raw.label,
    description: raw.description,
    urls: records.map((r) => `https://${r.fqdn}`),
    records,
  };
}

/** 45 条站点模块（按分类顺序、分类内保持备注原序） */
export const SITE_MODULES: SiteModule[] = RAW.map(buildModule);

export function isSiteCategory(value: string): value is SiteCategoryId {
  return SITE_CATEGORIES.some((c) => c.id === value);
}

export function isSiteZone(value: string): value is SiteZoneId {
  return SITE_ZONES.some((z) => z.id === value);
}
