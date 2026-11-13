/**
 * 入口落地状态注册表（2026-11-12）：把 44 个清单入口逐条对照项目现有真实模块，
 * 标注「已落地 / 部分相邻 / 规划中 / 语义冲突」，并登记可直达的站内视图、外链与现有真实能力。
 *
 * 口径与边界：
 *   - 本表是实现推导层，不改动 siteModules.json 的备注原文、职责边界与关联区分；
 *   - realFeatures 只登记代码里确实存在的视图 / 路由 / 能力，未实现的流程不臆造；
 *   - view 取值对齐 Web 端 AppView 字面量（store / products / cart / account / deployments /
 *     comic / chat / login），null 表示无站内直达视图；href 用于独立后台等站外路径；
 *   - planned 入口保留规划占位，不提供直达、不展示演示条目冒充真实业务。
 */

/** 落地状态四态：已落地 / 部分相邻 / 规划中 / 语义冲突 */
export type EntryImplementationStatus = 'implemented' | 'partial' | 'planned' | 'conflict';

/** 单个入口的落地映射：现有真实模块与边界说明 */
export interface EntryImplementation {
  // 落地状态：implemented=已有完整对应；partial=相邻能力；planned=无实现；conflict=语义冲突
  status: EntryImplementationStatus;
  // 站内可直达视图标识（对齐 AppView）；无站内视图时为 null
  view: string | null;
  // 站外路径（如独立运营后台 /admin/）；无外链时为 null
  href: string | null;
  // 现有真实能力清单：逐条对应已上线的视图功能或后端路由能力
  realFeatures: string[];
  // 对齐 / 冲突边界说明：讲清现有实现与备注语义的差距或区分点
  boundary: string;
} // 代码块结束

/** 规划中入口的缺省落地映射：无视图、无外链、无真实能力，仅保留边界说明 */
const PLANNED: EntryImplementation = {
  status: 'planned', // 规划中：当前无对应实现
  view: null, // 无站内直达视图
  href: null, // 无外链
  realFeatures: [], // 暂无真实能力可登记
  boundary: '备注未提供功能规格，项目内尚无对应模块；保留规划占位，不臆造业务流程。', // 规划边界
}; // PLANNED 结束

/**
 * 入口落地映射表：键为 entryKey。未在表内登记的入口按 PLANNED 兜底，
 * 避免新增清单入口时漏标状态导致默认被误判为已落地。
 */
export const ENTRY_IMPLEMENTATION: Readonly<Record<string, EntryImplementation>> = {
  // ---------- 主站门户与跳转 ----------
  PORTAL_ROOT: { // 根域名一次跳转，相邻落在商城目录
    status: 'partial', // 部分相邻：无独立门户落地页
    view: 'store', // 直达商城目录视图
    href: null, // 无站外路径
    realFeatures: [ // 现有真实导航能力
      '站点统一导航壳与跨模块视图跳转', // 侧边栏跨模块跳转
      '匿名 / 登录态入口收敛在侧边栏导航', // 导航入口按会话态收敛
    ], // 执行当前业务步骤
    boundary: '未做独立门户落地页；根路径按路由规则回落商城目录。', // 门户差距说明
  }, // PORTAL_ROOT 结束

  // ---------- 管理后台 ----------
  ADMIN_CONSOLE: { // 全站统一运营管理后台，已落地
    status: 'implemented', // 已落地：独立后台完整对应
    view: null, // 无站内 Web 视图
    href: '/admin/', // 直达独立运营后台
    realFeatures: [ // 后台已上线功能
      '运营总览与模块 / 分类管理', // 概览与分类导航
      '订单查询与权益发放 / 吊销', // 订单与权益管理
      '角色与权限点配置、用户角色分配', // 角色权限管理
    ], // 执行当前业务步骤
    boundary: '独立运营后台（apps/admin）经 /admin/ 路径访问；不承载会员 / 供应商 / 卖家等业务专属后台。', // 后台职责边界
  }, // ADMIN_CONSOLE 结束

  // ---------- 网关与 APP 接口 ----------
  API_GATEWAY: { // API 统一网关，相邻为单体 API 中间件层
    status: 'partial', // 部分相邻：仅中间件层
    view: null, // 无站内视图
    href: null, // 无外链
    realFeatures: [ // 已上线的网关相邻能力
      '/api/v1 统一前缀与路由聚合', // 统一前缀路由聚合
      'Bearer 鉴权中间件与 RBAC 权限校验', // 鉴权与权限中间件
      '写操作幂等键校验与统一错误信封', // 幂等与错误信封
    ], // 执行当前业务步骤
    boundary: '当前为单体 API 内的中间件层；独立网关的限流 / 配额 / 路由编排 / 鉴权代理尚未实现。', // 网关差距说明
  }, // API_GATEWAY 结束
  APP_API: { // 移动端专属接口，相邻为同源 REST 接口
    status: 'partial', // 部分相邻：无独立移动接口版本
    view: null, // 无站内视图
    href: null, // 无外链
    realFeatures: [ // 已复用的接口能力
      '同一套 REST 接口同源复用，区域（cn / global）与会话模型与 Web 一致', // 同源接口与会话模型
    ], // 执行当前业务步骤
    boundary: '无独立移动端接口版本；设备绑定、推送与移动端专属协议尚未实现。', // 移动接口差距说明
  }, // APP_API 结束

  // ---------- 认证权限与单点登录 ----------
  AUTH_CENTER: { // 统一身份认证与权限中心，已落地
    status: 'implemented', // 已落地：认证会话权限完整对应
    view: 'login', // 直达登录视图
    href: null, // 无外链
    realFeatures: [ // 已上线认证能力
      '自助注册、验证码登录、密码登录', // 三种登录 / 注册入口
      '访问令牌刷新轮换与登出吊销', // 令牌轮换与吊销
      '登录渠道查询、会话鉴权与 RBAC 权限点', // 渠道查询与会话鉴权
    ], // 执行当前业务步骤
    boundary: '账号资料在个人中心维护；本模块只负责认证、会话与权限分发。', // 认证职责边界
  }, // AUTH_CENTER 结束
  SSO_LOGIN: { // 统一单点登录页，已落地站内登录入口
    status: 'implemented', // 已落地：站内统一登录入口
    view: 'login', // 直达登录视图
    href: null, // 无外链
    realFeatures: [ // 已上线登录能力
      '统一登录页（验证码 / 密码）', // 站内统一登录页
      'OAuth 登录通道与自助注册入口', // 第三方 OAuth 通道
    ], // 执行当前业务步骤
    boundary: '跨站联邦单点登录（SAML / OIDC 联邦）尚未实现；当前为站内统一登录入口。', // 联邦 SSO 差距说明
  }, // SSO_LOGIN 结束

  // ---------- 用户与会员中心 ----------
  MEMBER_CENTER: { // 用户个人中心 / 会员工作台，已落地
    status: 'implemented', // 已落地：个人中心完整对应
    view: 'account', // 直达个人中心视图
    href: null, // 无外链
    realFeatures: [ // 已上线个人中心能力
      '个人资料查看与编辑', // 资料维护
      '我的权益、我的订单', // 权益与订单查看
      '账号注销与撤销、账号安全', // 注销与账号安全
    ], // 执行当前业务步骤
    boundary: '会员等级体系与成长值尚未实现；权益来自模块商城订单履约。', // 会员体系差距说明
  }, // MEMBER_CENTER 结束
  MEMBER_ADMIN: { // 用户会员管理后台，相邻在运营后台内承接
    status: 'partial', // 部分相邻：无会员专属后台面
    view: null, // 无站内 Web 视图
    href: '/admin/', // 直达运营后台
    realFeatures: [ // 后台已承接的会员相邻能力
      '用户列表与用户角色分配', // 用户与角色管理
      '权益发放 / 吊销、订单查询', // 权益与订单管理
    ], // 执行当前业务步骤
    boundary: '无会员等级 / 成长值 / 会员定价的专属后台面；相关能力在全站运营后台内承接。', // 会员后台差距说明
  }, // MEMBER_ADMIN 结束

  // ---------- 云盘 / 图床 / 素材 / 下载分发 ----------
  CLOUD_DRIVE: { // 私有云盘 / 网盘，相邻为产物存储
    status: 'partial', // 部分相邻：仅产物存取
    view: null, // 无站内视图
    href: null, // 无外链
    realFeatures: [ // 已上线存储相邻能力
      '媒体产物上传 / 下载预签名', // 产物预签名存取
      '本人可见产物清单与 WebP 缩略图', // 产物清单与缩略图
    ], // 执行当前业务步骤
    boundary: '无目录 / 文件夹 / 共享链接等网盘功能；产物按项目归属，不构成独立网盘。', // 网盘差距说明
  }, // CLOUD_DRIVE 结束
  IMAGE_ASSETS: { // 公共图床 + 素材资源站，相邻为媒体产物存取
    status: 'partial', // 部分相邻：无公共素材库
    view: null, // 无站内视图
    href: null, // 无外链
    realFeatures: [ // 已上线素材相邻能力
      '图片 / 媒体产物存取与预签名下载', // 媒体存取与预签名
      '服务端生成缩略图供内联预览', // 服务端缩略图
    ], // 执行当前业务步骤
    boundary: '无公共素材库、分类标签与外链图床分发能力。', // 素材库差距说明
  }, // IMAGE_ASSETS 结束
  DOWNLOAD_DIST: { // 软件源码下载分发站，与现有产物下载语义冲突
    status: 'conflict', // 语义冲突：下载对象类型不一致
    view: 'store', // 相邻直达商城目录
    href: null, // 无外链
    realFeatures: [ // 现有下载相关能力
      '模块能力在线调用', // 能力在线调用
      '成片 / 产物导出下载与预签名下载链接', // 产物导出下载
    ], // 执行当前业务步骤
    boundary: '现有下载对象为生成产物与工具能力结果，并非源码安装包分发；无版本目录、校验签名与镜像站，与备注「软件源码下载分发站」语义冲突。', // 冲突边界说明
  }, // DOWNLOAD_DIST 结束

  // ---------- 商城 / 支付 / 商贸 ----------
  MALL_B2C: { // B2C 官方商城，与现有数字商品商城语义冲突
    status: 'conflict', // 语义冲突：商品类型不一致
    view: 'store', // 相邻直达商城目录
    href: null, // 无外链
    realFeatures: [ // 现有商城能力
      '模块目录浏览、搜索筛选、详情与价格历史', // 目录浏览与详情
      '加购、购物车结算、下单与权益履约', // 下单与权益履约
    ], // 执行当前业务步骤
    boundary: '现有商城售卖功能模块 / 生成包等数字商品，并非实物 B2C 商品；无库存、物流与实物售后，与备注「B2C 官方商城」语义存在边界冲突。', // 冲突边界说明
  }, // MALL_B2C 结束
  PAYMENT_GATEWAY: { // 支付聚合网关 + 对账，相邻为结算下单
    status: 'partial', // 部分相邻：支付渠道为占位
    view: 'cart', // 直达购物车结算视图
    href: null, // 无外链
    realFeatures: [ // 已上线结算相邻能力
      '购物车结算、下单与订单状态流转', // 结算下单与状态流转
      '权益发放与支付回调接入位', // 权益发放与回调位
    ], // 执行当前业务步骤
    boundary: '聚合支付渠道（微信 / 支付宝 / Stripe）为占位；无独立对账与清结算后台。', // 支付对账差距说明
  }, // PAYMENT_GATEWAY 结束
  SOURCE_GOODS: { // 货源商品库，相邻为二级模块商品库
    status: 'partial', // 部分相邻：无供给侧入驻
    view: 'store', // 直达商城目录
    href: null, // 无外链
    realFeatures: [ // 已上线商品库相邻能力
      '二级模块商品库与分类树', // 模块商品库与分类
      '模块详情、价格历史与热门排行', // 详情价格与排行
    ], // 执行当前业务步骤
    boundary: '无货源供给侧入驻、供货价与库存管理。', // 货源侧差距说明
  }, // SOURCE_GOODS 结束

  // ---------- 视频 ----------
  UGC_VIDEO: { // UGC 短视频社区，相邻为 AI 生成成片
    status: 'partial', // 部分相邻：无社区互动
    view: 'comic', // 直达漫剧工作台
    href: null, // 无外链
    realFeatures: [ // 已上线视频相邻能力
      'AI 生成短视频成片、成片版本管理', // 成片与版本管理
      '成片导出与在线预览、演示片库', // 导出预览与片库
    ], // 执行当前业务步骤
    boundary: '无用户动态流、点赞 / 评论 / 关注等社区互动；内容由 AI 生成，非 UGC 上传。', // UGC 社区差距说明
  }, // UGC_VIDEO 结束
  VOD_LONG_VIDEO: { // 长视频点播，相邻为成片版本集
    status: 'partial', // 部分相邻：无 CDN 点播分发
    view: 'comic', // 直达漫剧工作台
    href: null, // 无外链
    realFeatures: [ // 已上线点播相邻能力
      '成片版本集、在线预览、导出下载与放映列表', // 版本集与放映列表
    ], // 执行当前业务步骤
    boundary: '无 CDN 点播分发、转码队列管理与独立播放器分发站。', // 点播分发差距说明
  }, // VOD_LONG_VIDEO 结束
  VIDEO_PLAYER: { // 独立视频播放页，相邻为成片在线预览
    status: 'partial', // 部分相邻：无独立播放器页
    view: 'comic', // 直达漫剧工作台
    href: null, // 无外链
    realFeatures: [ // 已上线播放相邻能力
      '成片在线预览、会话内视频通话', // 在线预览与视频通话
    ], // 执行当前业务步骤
    boundary: '无独立播放器页；播放列表、弹幕、倍速等播放器能力尚未实现。', // 播放器差距说明
  }, // VIDEO_PLAYER 结束

  // ---------- 运维 / 安全 / 治理 ----------
  OPS_MONITOR: { // 运维监控面板，相邻为部署矩阵汇总
    status: 'partial', // 部分相邻：无主机指标告警
    view: 'deployments', // 直达部署汇总视图
    href: null, // 无外链
    realFeatures: [ // 已上线监控相邻能力
      '多平台部署矩阵总览与健康检查分布', // 部署总览与健康分布
      '部署项结果与异常汇总', // 结果与异常汇总
    ], // 执行当前业务步骤
    boundary: '无主机指标、日志与告警链路；当前为部署状态只读汇总。', // 监控差距说明
  }, // OPS_MONITOR 结束
  SECURITY_CENTER: { // 安全防护中心，相邻为鉴权与会话安全
    status: 'partial', // 部分相邻：无独立安全中心
    view: null, // 无站内视图
    href: null, // 无外链
    realFeatures: [ // 已上线安全相邻能力
      '会话令牌轮换、登出吊销', // 令牌轮换与吊销
      'RBAC 角色权限点、账号注销宽限与接口鉴权', // 权限点与接口鉴权
    ], // 执行当前业务步骤
    boundary: '无独立安全中心；攻击防护、审计日志与风控面板尚未实现。', // 安全中心差距说明
  }, // SECURITY_CENTER 结束
  SERVICE_GOVERNANCE: { // 服务治理监控平台，相邻为部署与任务状态
    status: 'partial', // 部分相邻：无注册发现与链路追踪
    view: 'deployments', // 直达部署汇总视图
    href: null, // 无外链
    realFeatures: [ // 已上线治理相邻能力
      '部署矩阵状态、AI 任务执行状态', // 部署与任务状态
      '网关路由与接口清单', // 路由与接口清单
    ], // 执行当前业务步骤
    boundary: '无服务注册发现、链路追踪、限流熔断与治理配置面。', // 治理差距说明
  }, // SERVICE_GOVERNANCE 结束

  // ---------- 开发测试 / 工具 / 导航 / 低代码 / 语音 / 移动 / 内网 ----------
  NAVIGATION: { // 全站资源导航站（2026-11-12 已落成独立视图 /navigation）
    status: 'implemented', // 已落地：链接目录 + 服务端探测 + 失效标记 + 推荐位 + 检索均为真实功能
    view: 'navigation', // 独立导航站视图
    href: null, // 无外链
    realFeatures: [ // 已上线导航站能力
      '全站资源链接目录与分组分类（GET /api/v1/navigation/links 支持 q / group / status 过滤）', // 目录与检索
      '服务端可达性探测与失效标记（单条与全目录探测，回写 HTTP 码 / 耗时 / 探测时间）', // 探测闭环
      '推荐位标记与目录三态汇总（可达 / 失效 / 未探测）', // 推荐位
    ], // 执行当前业务步骤
    boundary: '只维护链接目录与可达性状态，不承载被链系统的内容，不负责 DNS 解析或跳转决策（跳转由浏览器直接发起）。', // 导航站边界
  }, // NAVIGATION 结束
  GALE_TOOLS: { // 疾风引擎在线工具平台，相邻为商城工具型能力
    status: 'partial', // 部分相邻：无工具编排保存
    view: 'store', // 直达商城目录
    href: null, // 无外链
    realFeatures: [ // 已上线工具相邻能力
      '在线工具型能力（JSON / 编码 / 哈希 / 二维码 / 图表等）经商城详情面板调用执行', // 工具型能力在线调用
    ], // 执行当前业务步骤
    boundary: '工具以单次演算为主；无工具编排与工作流保存。', // 工具编排差距说明
  }, // GALE_TOOLS 结束
  VOICE_TOOLS: { // 语音工具服务平台，相邻为配音与语音合成
    status: 'partial', // 部分相邻：无独立语音平台
    view: 'comic', // 直达漫剧工作台
    href: null, // 无外链
    realFeatures: [ // 已上线语音相邻能力
      '角色配音设定、配音生成任务', // 配音设定与生成
      '语音合成 SSML 工具能力', // SSML 语音合成
    ], // 执行当前业务步骤
    boundary: '无独立语音合成 / 转写平台与音色库管理。', // 语音平台差距说明
  }, // VOICE_TOOLS 结束
  MOBILE_H5: { // 移动端 H5 精简版官网，相邻为响应式 Web
    status: 'partial', // 部分相邻：无独立 H5 工程
    view: 'store', // 直达商城目录
    href: null, // 无外链
    realFeatures: [ // 已上线移动端相邻能力
      '响应式 Web，窄屏断点下导航与内容上下堆叠', // 窄屏响应式布局
    ], // 执行当前业务步骤
    boundary: '无独立 H5 工程与移动专属精简流程。', // H5 差距说明
  }, // MOBILE_H5 结束
  MOBILE_FULL: { // 全功能移动端站点，相邻为同一响应式 Web
    status: 'partial', // 部分相邻：无原生 App
    view: 'store', // 直达商城目录
    href: null, // 无外链
    realFeatures: [ // 已上线移动端相邻能力
      '同一响应式 Web 覆盖商城 / 列表 / 购物车 / 个人中心 / 漫剧 / 聊天', // 响应式覆盖各视图
    ], // 执行当前业务步骤
    boundary: '无原生 App 与移动端专属功能裁剪 / 推送。', // 原生 App 差距说明
  }, // MOBILE_FULL 结束

  // ---------- 以下为规划中入口：表内未显式登记，统一回落 PLANNED ----------
  // BLOG 官方博客系统
  // OPEN_DATA 开放数据集平台
  // DEV_PORTAL 开发环境门户 + 接口文档
  // LOWCODE 低代码生成平台
  // HELP_CENTER 产品帮助文档中心
  // MARKETING 营销活动管理平台
  // NEWS_PUBLISH 新闻资讯发布系统
  // INTRANET_PORTAL 企业内部统一门户 / 工作台
  // MULTI_MERCHANT 多商户店铺系统
  // CRAWLER_SCHEDULER 爬虫调度与数据采集
  // BI_DASHBOARD 全站数据 BI 看板
  // TICKET_SUPPORT 工单客服系统
  // TEST_ENV 测试环境统一入口
  // WORDPRESS WordPress 独立站点
  // SELF_MEDIA 自媒体资讯平台
  // B2B_TRADE B2B 企业批发采购平台
  // SUPPLIER_ADMIN 供应商后台管理系统
  // C2C_MARKET C2C 个人闲置 / 商品交易
  // SELLER_ADMIN 个人卖家店铺管理后台
}; // ENTRY_IMPLEMENTATION 结束

/** 落地状态枚举顺序：汇总与前端徽标共用同一排列 */
export const IMPLEMENTATION_STATUSES: readonly EntryImplementationStatus[] = [
  'implemented', // 已落地
  'partial', // 部分相邻
  'planned', // 规划中
  'conflict', // 语义冲突
]; // IMPLEMENTATION_STATUSES 结束

/** 按占位键取落地映射；未登记入口回落 PLANNED，保证任何清单入口都有确定状态 */
export function implementationOf(entryKey: string): EntryImplementation {
  // 命中显式登记直接返回；否则兜底为规划中
  return ENTRY_IMPLEMENTATION[entryKey] ?? PLANNED;
} // implementationOf 结束

/** 统计各落地状态的入口数量，供 /sites/overview 与前端总览复用 */
export function implementationSummary(
  modules: readonly { entryKey: string }[], // 对象字段 modules：记录一项配置或数据
): Record<EntryImplementationStatus, number> { // 执行当前业务步骤
  // 四态初始化为 0，逐入口累加
  const summary: Record<EntryImplementationStatus, number> = {
    implemented: 0, // 已落地
    partial: 0, // 部分相邻
    planned: 0, // 规划中
    conflict: 0, // 语义冲突
  }; // 初始计数结束
  for (const module of modules) { // 逐入口归类
    summary[implementationOf(module.entryKey).status] += 1; // 累加到对应状态桶
  } // 遍历结束
  return summary; // 返回四态计数
} // implementationSummary 结束
