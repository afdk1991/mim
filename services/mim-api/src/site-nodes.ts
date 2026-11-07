/**
 * 站点地图节点的「可运行模块」规格表（45 个节点单一真源）
 *
 * 背景：src/site.ts 的 RAW 只描述 DNSPod 备注（host / 分类 / 备注），
 * 站点地图此前仅能渲染卡片，没有任何节点对应的页面、路由、导航与职责。
 * 本文件为每个节点补齐四层映射，供前端生成目录、导航与模块页：
 *   1. 层级：沿用 site.ts 的 8 个分类（category 由 RAW 提供，不在此重复）；
 *   2. 命名：nav 提供中英双语导航名，duty 描述模块职责；
 *   3. 路由：routeKey（'@' 冲突项为 'root'）→ 站内 hash 路由 #/site/<key>；
 *   4. 关联：links 指向其他节点的 host，形成可点击的关联网络。
 *
 * 设计约束：不改 DNSPod 原始备注，不在本文件重复 fqdn（由 site.ts 的
 * fqdnOf 统一生成，避免域名映射出现两份真源）；加载时做完整性断言，
 * 缺节点 / 重复路由 / 悬空关联一律直接抛错，杜绝「静默漏节点」。
 */

// 模块职责类型：与 8 个分类一一对应，驱动节点页的职责清单与图标分组
export type SiteNodeKind =
  | 'portal' // 门户与入口
  | 'identity' // 身份与权限
  | 'console' // 运营后台
  | 'gateway' // 接口与开发
  | 'content' // 内容与媒体
  | 'commerce' // 电商与交易
  | 'data' // 数据与存储
  | 'tools'; // 工具与服务

// 分类 id → 模块职责类型：只在此处映射一次，45 行数据不必重复写 kind
export const CATEGORY_KIND: Record<string, SiteNodeKind> = {
  portal: 'portal', // 门户与入口
  identity: 'identity', // 身份与权限
  ops: 'console', // 运营后台
  api: 'gateway', // 接口与开发
  content: 'content', // 内容与媒体
  commerce: 'commerce', // 电商与交易
  data: 'data', // 数据与存储
  tools: 'tools', // 工具与服务
}; // 分类映射结束

// 单个节点对外暴露的规格：由本文件派生，经 /api/v1/site/nodes 返回给前端
export interface SiteNodeSpec {
  host: string; // 主机名（与 site.ts 的 RAW 完全一致，根域名为 '@'）
  key: string; // 路由键：host 本身，'@' 特殊映射为 'root'
  route: string; // 站内 hash 路由，如 #/site/www
  kind: SiteNodeKind; // 模块职责类型
  nav: { zh: string; en: string }; // 导航名称（双语）
  duty: { zh: string; en: string }; // 模块职责一句话（双语）
  links: string[]; // 关联节点 host 列表（用于节点页的相关入口）
} // 节点规格定义结束

// 按职责类型给出的可运行能力清单：节点页据此渲染「模块职责」分栏
export const NODE_CAPABILITIES: Record<SiteNodeKind, { zh: string; en: string }[]> = {
  portal: [ // 门户与入口
    { zh: '按终端类型分流到主站、移动精简版与全功能移动站', en: 'Route clients to web, mobile-lite and full mobile sites' },
    { zh: '承载品牌首页、统一入口与登录跳转', en: 'Serve brand homepage, unified entry and sign-in redirects' },
    { zh: '对外输出可访问的 HTTPS 域名映射', en: 'Expose verified HTTPS domain mappings' },
  ], // 门户能力结束
  identity: [ // 身份与权限
    { zh: '统一身份认证、令牌签发与权限校验', en: 'Unified authentication, token issuing and permission checks' },
    { zh: '对接登录入口与运营后台的鉴权链路', en: 'Bridge sign-in and console authorization flows' },
    { zh: '提供安全防护与风控策略挂载点', en: 'Provide security and risk-control integration points' },
  ], // 身份能力结束
  console: [ // 运营后台
    { zh: '提供运营数据看板与用户 / 卖家 / 供应商管理入口', en: 'Operations dashboards and user / seller / supplier administration' },
    { zh: '复用 RBAC 权限点与超管引导令牌鉴权', en: 'Reuse RBAC permissions and bootstrap admin token' },
    { zh: '对接服务治理与 BI 统计节点', en: 'Connect service governance and BI nodes' },
  ], // 后台能力结束
  gateway: [ // 接口与开发
    { zh: '对外提供统一 API 网关与接口文档', en: 'Unified API gateway and endpoint documentation' },
    { zh: '区分 APP 专属接口与开发 / 测试环境入口', en: 'Separate app-only APIs from dev and test environments' },
    { zh: '为低代码生成平台提供元数据来源', en: 'Feed metadata to the low-code generator' },
  ], // 网关能力结束
  content: [ // 内容与媒体
    { zh: '承载博客、资讯、自媒体与视频内容的发布', en: 'Publish blogs, news, creator media and video content' },
    { zh: '复用公共图床与素材资源站', en: 'Reuse shared image hosting and asset library' },
    { zh: '把媒体入口关联到独立播放页与移动站', en: 'Link media entries to standalone player and mobile site' },
  ], // 内容能力结束
  commerce: [ // 电商与交易
    { zh: '覆盖 B2C 商城、多商户店铺、B2B 与 C2C 交易', en: 'Cover B2C mall, multi-vendor shops, B2B and C2C trade' },
    { zh: '对接货源商品库、营销活动与支付结算', en: 'Integrate sourcing catalog, campaigns and payments' },
    { zh: '与卖家 / 供应商后台共享商品数据', en: 'Share catalog data with seller and supplier consoles' },
  ], // 电商能力结束
  data: [ // 数据与存储
    { zh: '提供开放数据集、爬虫调度与私有云盘', en: 'Open datasets, crawler scheduling and private cloud drive' },
    { zh: '承载软件源码下载与素材分发', en: 'Host source downloads and asset distribution' },
    { zh: '为 BI 看板提供数据出口', en: 'Expose data feeds for BI dashboards' },
  ], // 数据能力结束
  tools: [ // 工具与服务
    { zh: '提供在线工具集合、资源导航与帮助文档', en: 'Online toolset, resource directory and help docs' },
    { zh: '承载工单客服、语音工具与 WordPress 站点', en: 'Support desk, voice tools and WordPress site' },
    { zh: '通过疾风引擎边缘节点对外服务', en: 'Served through the Gale Engine edge node' },
  ], // 工具能力结束
}; // 能力清单结束

// 紧凑录入结构：host / 中文导航名 / 英文导航名 / 中文职责 / 英文职责 / 关联节点
type NodeRow = [string, string, string, string, string, string[]]; // 六元组，避免 45 个重复的对象字面量键

// 45 行节点规格，顺序与 site.ts 的 RAW 分类顺序完全一致，便于双表逐行核对
const ROWS: NodeRow[] = [
  // ---------- 门户与入口（6）----------
  ['@', '统一门户', 'Unified Portal', '根域名统一跳转，按终端分流到主站与移动端', 'Apex redirect routing clients by device', ['www', 'm', 'mobile', 'login', 'portal']], // 根域名
  ['www', '官方网站', 'Official Website', '承载官方门户首页与品牌信息', 'Serve official homepage and brand content', ['@', 'portal', 'blog', 'help']], // 常规官网入口
  ['portal', '统一工作台', 'Unified Workspace', '企业内部统一门户与员工工作台', 'Internal unified portal and workspace', ['www', 'center', 'admin', 'login']], // 企业门户
  ['m', '移动精简版', 'Mobile Lite', '移动端 H5 精简版官网', 'Lightweight H5 site for mobile', ['@', 'mobile', 'www']], // 移动短域名
  ['mobile', '移动端全功能', 'Mobile Full', '全功能移动端站点与 APP 接口对接', 'Full mobile site wired to app APIs', ['@', 'm', 'app', 'center']], // 全功能移动站
  ['login', '单点登录', 'Single Sign-On', '统一单点登录页，对接认证中心', 'Unified sign-in backed by identity center', ['@', 'auth', 'secure', 'center']], // 登录入口
  // ---------- 身份与权限（2）----------
  ['auth', '身份认证中心', 'Identity Center', '统一身份认证、令牌签发与权限中心', 'Authentication, tokens and permissions', ['login', 'secure', 'admin', 'api']], // 认证中心
  ['secure', '安全防护中心', 'Security Center', '安全防护与风控策略中心', 'Security protection and risk control', ['auth', 'login', 'api', 'admin']], // 安全中心
  // ---------- 运营后台（8）----------
  ['admin', '运营管理后台', 'Operations Console', '全站统一运营管理后台，复用 RBAC', 'Station-wide ops console with RBAC', ['user', 'stats', 'service', 'auth']], // 运营后台
  ['user', '用户会员管理', 'User Administration', '用户与会员资料管理后台', 'User and membership administration', ['admin', 'center', 'auth', 'stats']], // 用户管理
  ['center', '用户中心', 'Member Center', '用户个人中心与会员工作台', 'Personal center and member workspace', ['login', 'user', 'mall', 'support']], // 个人中心
  ['seller', '卖家后台', 'Seller Console', '个人卖家店铺与商品管理', 'Seller shop and catalog management', ['shop', 'mall', 'yp', 'market']], // 卖家后台
  ['supplier', '供应商后台', 'Supplier Console', '供应商入驻、供货与结算管理', 'Supplier onboarding and fulfillment', ['b2b', 'yp', 'seller', 'pay']], // 供应商后台
  ['fwq', '运维监控', 'Infrastructure Monitor', '服务器资源与运行状态监控面板', 'Server resource and health monitoring', ['service', 'stats', 'api', 'admin']], // 运维面板
  ['service', '服务治理', 'Service Governance', '服务注册、治理与调用链监控', 'Service governance and tracing', ['fwq', 'stats', 'api', 'dev']], // 服务治理
  ['stats', '数据 BI', 'BI Dashboard', '全站数据统计与 BI 看板', 'Station-wide analytics and BI dashboards', ['data', 'sj', 'admin', 'service']], // BI 看板
  // ---------- 接口与开发（5）----------
  ['api', 'API 网关', 'API Gateway', '对外统一 API 网关与接口聚合', 'Unified public API gateway', ['app', 'dev', 'test', 'service']], // 网关
  ['app', 'APP 接口', 'App API', '移动端专属接口服务', 'Mobile-only API service', ['mobile', 'api', 'test', 'dev']], // APP 接口
  ['dev', '开发者门户', 'Developer Portal', '开发环境门户与接口文档', 'Dev environment portal and API docs', ['api', 'test', 'dnpj', 'help']], // 开发门户
  ['test', '测试环境', 'Test Environment', '测试环境统一入口与契约验证', 'Unified test environment entry', ['dev', 'api', 'app', 'service']], // 测试环境
  ['dnpj', '低代码生成', 'Low-Code Generator', '低代码 / 代码生成平台', 'Low-code and code generation platform', ['dev', 'api', 'store', 'gy']], // 代码生成
  // ---------- 内容与媒体（7）----------
  ['blog', '官方博客', 'Official Blog', '官方博客与产品动态发布', 'Official blog and product updates', ['news', 'xw', 'help', 'www']], // 博客
  ['news', '资讯发布', 'Newsroom', '新闻资讯采编与发布系统', 'News editorial and publishing', ['xw', 'blog', 'img', 'www']], // 资讯
  ['xw', '自媒体平台', 'Creator Media', '自媒体资讯与创作者内容平台', 'Creator-driven media platform', ['news', 'blog', 'dy', 'img']], // 自媒体
  ['dy', '短视频社区', 'Short Video Community', 'UGC 短视频动态社区', 'UGC short-video community', ['sp', 'video', 'xw', 'img']], // 短视频
  ['sp', '长视频点播', 'Video On Demand', '长视频点播与媒资管理', 'Long-form VOD and media assets', ['video', 'dy', 'img', 'cloud']], // 长视频
  ['video', '独立播放页', 'Video Player', '独立视频播放页与分享入口', 'Standalone video player and sharing', ['sp', 'dy', 'img', 'm']], // 播放页
  ['img', '图床素材站', 'Image Hosting', '公共图床与素材资源站', 'Shared image hosting and assets', ['blog', 'dy', 'sp', 'store']], // 图床
  // ---------- 电商与交易（7）----------
  ['mall', '官方商城', 'Official Mall', 'B2C 官方商城与订单履约', 'B2C official mall and order fulfillment', ['shop', 'pay', 'market', 'yp']], // 商城
  ['shop', '多商户店铺', 'Multi-Vendor Shops', '多商户店铺与卖家入驻', 'Multi-vendor shops and onboarding', ['seller', 'mall', 'c2c', 'market']], // 店铺
  ['b2b', '企业批发', 'B2B Marketplace', 'B2B 企业批发采购平台', 'B2B wholesale procurement', ['supplier', 'yp', 'pay', 'c2c']], // B2B
  ['c2c', '个人交易', 'C2C Marketplace', 'C2C 个人闲置与商品交易', 'C2C peer-to-peer marketplace', ['shop', 'mall', 'yp', 'pay']], // C2C
  ['yp', '货源商品库', 'Sourcing Catalog', '货源商品库与选品数据', 'Sourcing catalog and product data', ['b2b', 'supplier', 'seller', 'store']], // 货源
  ['market', '营销活动', 'Campaign Manager', '营销活动配置与效果分析', 'Campaign configuration and analytics', ['mall', 'shop', 'pay', 'stats']], // 营销
  ['pay', '支付结算', 'Payment Gateway', '支付聚合网关与对账系统', 'Payment aggregation and reconciliation', ['mall', 'b2b', 'c2c', 'market']], // 支付
  // ---------- 数据与存储（4）----------
  ['data', '开放数据', 'Open Data', '开放数据集平台与数据出口', 'Open dataset platform and data feeds', ['sj', 'cloud', 'store', 'stats']], // 数据中心
  ['sj', '数据采集', 'Data Collector', '爬虫调度与数据采集平台', 'Crawler scheduling and collection', ['data', 'store', 'cloud', 'stats']], // 采集
  ['cloud', '私有云盘', 'Private Cloud Drive', '私有云盘与文件网盘系统', 'Private cloud drive and file storage', ['store', 'img', 'data', 'sp']], // 云盘
  ['store', '下载分发', 'Download Portal', '软件源码与资源下载分发站', 'Source and asset download portal', ['cloud', 'data', 'img', 'dnpj']], // 下载站
  // ---------- 工具与服务（6）----------
  ['gy', '在线工具平台', 'Online Tools', '在线工具集合，疾风引擎边缘节点承载', 'Online toolset served by Gale Engine edge', ['dh', 'dnpj', 'dev', 'wp']], // 工具主入口（CNAME）
  ['dh', '资源导航', 'Resource Directory', '全站 45 个节点的资源导航站', 'Directory for all 45 site nodes', ['@', 'help', 'gy', 'www']], // 导航
  ['help', '帮助中心', 'Help Center', '产品帮助文档与使用指南', 'Product help docs and guides', ['support', 'dev', 'blog', 'dh']], // 帮助
  ['support', '工单客服', 'Support Desk', '工单客服与问题跟踪系统', 'Ticket desk and issue tracking', ['help', 'center', 'service', 'admin']], // 客服
  ['yy', '语音工具', 'Voice Tools', '语音合成与语音处理工具服务', 'Speech synthesis and voice tooling', ['gy', 'dy', 'sp', 'app']], // 语音
  ['wp', 'WordPress 站点', 'WordPress Site', '独立 WordPress 内容站点', 'Standalone WordPress content site', ['blog', 'news', 'gy', 'img']], // WordPress
]; // 45 行结束

// 路由键生成：根域名 '@' 在 URL hash 中会被解析成保留字符，统一改用别名 'root'
export function routeKeyOf(host: string): string {
  return host === '@' ? 'root' : host; // 其余 host 本身就是合法的 hash 片段
} // routeKeyOf 结束

// 把 45 行展开成按 host 索引的规格表；kind 由分类映射补出（分类在校验阶段从 site.ts 注入）
function buildSpecs(categoryOf: (host: string) => string): Record<string, SiteNodeSpec> {
  const out: Record<string, SiteNodeSpec> = {}; // 以 host 为键，便于 O(1) 查找
  for (const [host, navZh, navEn, dutyZh, dutyEn, links] of ROWS) { // 解构六元组
    const key = routeKeyOf(host); // 处理 '@' 冲突
    out[host] = { // 写入单节点规格
      host, // 原始主机名
      key, // 路由键
      route: `#/site/${key}`, // 站内 hash 路由
      kind: CATEGORY_KIND[categoryOf(host)] ?? 'tools', // 分类 → 职责类型，缺省兜底 tools
      nav: { zh: navZh, en: navEn }, // 双语导航名
      duty: { zh: dutyZh, en: dutyEn }, // 双语职责
      links, // 关联节点
    }; // 单节点写入结束
  } // 遍历结束
  return out; // 返回规格表
} // buildSpecs 结束

/**
 * 完整性断言：由 site.ts 在构造 SITE_MODULES 时调用。
 * 任何「缺节点 / 多节点 / 路由冲突 / 悬空关联」都会直接抛错，避免静默漏实现。
 * @param hosts site.ts 的 45 个原始 host
 * @param categoryOf 按 host 取分类的函数
 */
export function buildAndValidateNodeSpecs(
  hosts: string[],
  categoryOf: (host: string) => string,
): Record<string, SiteNodeSpec> {
  const specs = buildSpecs(categoryOf); // 先展开规格表
  const specHosts = Object.keys(specs); // 规格表覆盖的 host
  const missing = hosts.filter((h) => !specHosts.includes(h)); // RAW 有、规格无
  const extra = specHosts.filter((h) => !hosts.includes(h)); // 规格有、RAW 无
  if (missing.length || extra.length) { // 双向不一致即失败
    throw new Error(`站点节点规格不完整: missing=[${missing.join(',')}] extra=[${extra.join(',')}]`); // 暴露具体差异
  }
  const keys = specHosts.map((h) => specs[h].key); // 全部路由键
  if (new Set(keys).size !== keys.length) { // 路由键必须唯一
    throw new Error('站点节点路由键冲突: 存在重复的 routeKey'); // 冲突即失败
  }
  for (const h of specHosts) { // 逐节点检查关联关系
    for (const link of specs[h].links) { // 遍历该节点的关联 host
      if (!specs[link]) throw new Error(`站点节点 ${h} 的关联节点 ${link} 不存在`); // 悬空关联即失败
    } // 关联遍历结束
  } // 节点遍历结束
  return specs; // 全部通过才返回
} // buildAndValidateNodeSpecs 结束
