/**
 * Web 端 API 类型区（2026-11-14 P1-A 拆分，自 api.ts 原样搬出）
 *
 * 只放类型声明，无任何运行时副作用；request.ts 与 endpoints.ts 都从这里取类型。
 */

/**
 * Mim Web API 客户端。
 * 对齐 services/mim-api 契约：Bearer 鉴权、refresh 轮换、写操作强制 Idempotency-Key、
 * 统一错误信封 { code, message, request_id, details }。
 */


export type Region = 'cn' | 'global'; // 区域维度：国内/海外，决定数据驻留与可用模块
export type Provider = 'phone' | 'email'; // 凭证类型：手机号或邮箱

// ---------- 验证码（与 services/mim-api/src/security.ts 适配器契约一一对应）----------

/** 验证码模式：off 不校验；image 图形；slider 滑动拼图；tencent / geetest4 前端 SDK 取码、服务端二次校验 */
export type CaptchaMode = 'off' | 'image' | 'slider' | 'tencent' | 'geetest4';
/** 验证码强制场景：注册 / 登录 / 举报 / 发帖 */
export type CaptchaScene = 'register' | 'login' | 'report' | 'post';

/** 滑动拼图缺口几何信息（目标 x 不下发，前端只拿到可拖动的缺口形状） */
export interface SliderGap {
  y: number; // 缺口纵向位置
  width: number; // 缺口宽度（px）
  height: number; // 缺口高度（px）
} // 代码块结束

/** 滑动拼图题目：背景 SVG + 缺口几何 + 过期时间 */
export interface SliderChallenge {
  id: string; // 题目主键，提交时随 slider_x 回传
  expires_at: string; // 过期时间（ISO）
  background: string; // 背景 SVG 字符串
  gap: SliderGap; // 缺口几何
} // 代码块结束

/** 验证码签发响应：off/未强制 required=false；image 带 svg；slider 带 slider；第三方仅回模式 */
export interface CaptchaIssue {
  scene: CaptchaScene; // 回显场景
  required: boolean; // 本场景是否强制验证码
  mode: CaptchaMode; // 当前生效模式
  id?: string; // 题目主键（image / slider）
  svg?: string; // 图形验证码 SVG（image）
  slider?: SliderChallenge; // 滑动拼图题目（slider）
  expires_at?: string; // 过期时间（ISO）
} // 代码块结束

/** 安全能力状态：前端据此决定是否展示验证码与审核提示 */
export interface SecurityStatus {
  captcha_required: boolean; // 兼容旧字段：任一强制场景即视为需要验证码
  content_audit: boolean; // 是否启用内容审核
  captcha: { // 对象字段 captcha：记录一项配置或数据
    mode: CaptchaMode; // 当前验证码模式
    required_scenes: CaptchaScene[]; // 被环境变量强制的场景清单
    providers: { image: boolean; slider: boolean; tencent: boolean; geetest4: boolean }; // 第三方凭证齐备度
  }; // 代码块结束
  audit: { enabled: boolean; provider: string; fallback: string }; // 对象字段 audit：记录一项配置或数据
} // 代码块结束

/** 提交登录 / 注册时随请求体带上的验证码票据字段（按 mode 取对应一组；off 不带） */
export interface CaptchaTicket {
  captcha_id?: string; // image / slider 题目主键
  captcha_code?: string; // image 图形答案
  slider_x?: number; // slider 拼图落点 x 坐标（容差 ±12px）
  ticket?: string; // 腾讯 TCaptcha 票据
  randstr?: string; // 腾讯 TCaptcha 随机串
  lot_number?: string; // 极验 4.0 批次号
  captcha_output?: string; // 极验 4.0 输出
  pass_token?: string; // 极验 4.0 通过令牌
  gen_time?: string; // 极验 4.0 生成时间
} // 代码块结束

export interface UserInfo { // 当前登录用户的核心资料（登录响应与 /me 共用同一形状）
  id: string; // 用户主键，本地缓存与埋点都用它标识身份
  region: Region; // 所属区域，服务端据此路由到对应数据中心
  status: string; // 账号状态机（active/deleting 等），前端据此决定是否显示注销倒计时
  display_name: string; // 展示名，未设置时由服务端兜底填充
  locale: string; // 原始语言标签（如 zh-CN），交给 normalizeLocale 归一
  timezone: string; // IANA 时区名，用于把服务端 UTC 时间渲染成本地时间
  deletion_scheduled_at?: string | null; // 注销预约时间；仅注销流程中有值，其余为 null/缺省
  member_no: string; // 对外 Mim ID 号码（纯数字 QQ 号样式，如 10000001），与内部 uuid 主键解耦
  is_guest?: boolean; // 历史兼容字段：2026-11-15 起恒为 false，仅为读取存量响应保留
} // UserInfo 结构结束

export interface OAuthProviderInfo { // 第三方登录提供方（含是否已在当前部署配置好凭证）
  id: string; // 路由标识，如 github / wechat
  label: string; // 中文展示名
  label_en: string; // 英文展示名
  region: 'cn' | 'global' | 'both'; // 适用区域
  configured: boolean; // 当前部署是否已配置凭证；未配置时前端置灰
} // OAuthProviderInfo 结束

export interface OAuthBinding { // 已绑定的第三方身份（仅展示字段）
  provider: string; // 提供方标识
  nickname: string; // 提供方昵称
  avatar_url: string | null; // 头像
  email: string | null; // 邮箱
  created_at: string; // 绑定时间
} // OAuthBinding 结束

export interface RealnameRecord { // 实名记录对外视图：不含姓名 / 证件号明文
  id: string; // 记录主键
  status: 'pending' | 'approved' | 'rejected'; // 审核状态
  provider: 'manual' | 'third_party'; // 审核通道
  id_type: 'id_card' | 'passport' | 'other'; // 证件类型
  name_masked: string; // 脱敏姓名
  id_last4: string; // 证件号后四位
  reject_reason: string | null; // 驳回原因
  reviewed_at: string | null; // 审核时间
  created_at: string; // 提交时间
} // RealnameRecord 结束

export interface Session { // 本地会话快照：登录成功后整体持久化
  access_token: string; // 短期访问令牌，随每个请求以 Bearer 形式发送
  refresh_token: string; // 长期刷新令牌，仅用于换新 access_token（轮换后必须覆盖写回）
  user: UserInfo; // 冗余保存用户资料，避免每次启动都先调 /me
} // Session 结构结束

export interface LoginResult extends Session { // 登录/刷新响应：会话字段 + 令牌元数据
  token_type: 'Bearer'; // 令牌类型固定 Bearer，前端拼 Authorization 头时依赖它
  expires_in: number; // access_token 有效期（秒），可用于提前触发刷新
} // LoginResult 结构结束

export interface MeResponse { // GET /me 的响应包装，便于服务端后续扩展其它字段
  user: UserInfo; // 最新的用户资料
} // MeResponse 结构结束


// ---------- media 预签名类型（对齐 routes/media.ts） ----------

export type AssetType = 'image' | 'video' | 'audio' | 'text' | 'final'; // 产物类型，服务端据此校验 mime 与大小上限
export interface PresignedUrl { // 预签名地址（客户端直传/直下，绕过后端转发）
  url: string; // 完整可访问地址，含签名参数
  method: 'PUT' | 'GET'; // 该方法限定：上传用 PUT、下载用 GET
  headers: Record<string, string>; // 必须原样带上的请求头（如 Content-Type），否则签名校验失败
  expires_at: string; // 签名过期时间，过期需重新申请
} // PresignedUrl 结束

// ---------- IM 即时通讯域类型 ----------
export type ImConversationType = 'direct' | 'group'; // 会话类型：私聊 / 群聊
export type ImMessageContentType = 'text' | 'image' | 'file' | 'system'; // 消息内容类型
export type ImMessageStatus = 'sent' | 'delivered' | 'read'; // 投递状态

/** 单条消息视图 */
export interface ImMessage {
  id: string; // 消息 ID
  conversation_id: string; // 所属会话
  sender_user_id: string; // 发送者 ID
  sender_display_name: string; // 发送者显示名
  content_type: ImMessageContentType; // 内容类型
  content: string; // 文本内容
  object_key?: string | null; // 媒体对象键（image/file）
  object_mime?: string | null; // 媒体 MIME
  object_name?: string | null; // 原始文件名
  object_size?: number | null; // 文件大小
  reply_to_id?: string | null; // 引用回复的目标消息 ID
  reply_excerpt?: string | null; // 被引用消息的摘要（发送时固化）
  link_url?: string | null; // 系统私信跳转地址（普通消息为 null）
  link_label?: string | null; // 系统私信跳转按钮文案
  status: ImMessageStatus; // 投递状态
  created_at: string; // 创建时间
} // ImMessage 结束

/** 会话列表项 */
export interface ImConversation {
  id: string; // 会话 ID
  type: ImConversationType; // 类型
  title: string; // 展示标题
  avatar_object_key?: string | null; // 头像对象键
  other_user_id?: string | null; // 私聊对方 ID（群聊为 null）
  system_kind?: string | null; // 系统会话类型（普通会话为 null，成长私信为 growth）
  last_message: ImMessage | null; // 最后一条消息
  unread_count: number; // 未读数
  pinned: boolean; // 当前用户是否置顶
  muted: boolean; // 当前用户是否免打扰
  member_count: number; // 成员数（私聊为 2）
  updated_at: string; // 最后更新时间
} // ImConversation 结束

/** 群成员项 */
export interface ImMember {
  user_id: string; // 成员 ID
  display_name: string; // 显示名
  role: 'owner' | 'admin' | 'member'; // 群内角色
  joined_at: string; // 入群时间
} // ImMember 结束

/** 搜索到的用户项 */
export interface ImUser {
  id: string; // 用户 ID
  display_name: string; // 显示名
  region: string; // 区域
} // ImUser 结束

// ---------- 部署汇总共享类型已于 2026-11-15 随公开页面下线移除（运维数据仅后台可见） ----------



// ---------- 社区与变现共享类型，与 routes/community.ts 响应一一对应 ----------

export interface CommunityBoard { // 论坛板块
  slug: string; // 板块标识
  name: string; // 板块名称
  description: string; // 板块说明
  icon: string; // 图标
  thread_count: number; // 帖子数
  price_cents: number; // 付费加入价格（0 为免费）
  joined: number; // 是否已加入
  visibility: 'public' | 'followers'; // 可见性
  post_min_level: number; // 发帖最低等级
  followed: number; // 是否已关注
  is_moderator: number; // 是否版主 / 创建者
}

export type ThreadKind = 'text' | 'video' | 'gallery' | 'series' | 'qa' | 'poll'; // 帖子形态

export interface CommunityThreadMedia { // 帖子媒体
  id?: string; // 主键（服务端返回）
  kind: 'image' | 'video'; // 媒体类型
  url: string; // 地址
  poster_url?: string | null; // 视频封面
  sort_order?: number; // 排序
}

export interface ThreadAttachmentMeta { // 帖子附件（可下载文件）：与已上线的详情返回字段同名同形
  id: string; // 附件主键
  name: string; // 展示文件名
  mime: string; // 文件 MIME
  size_bytes: number; // 文件大小（字节），0 表示未知
  sort_order: number; // 排序
}

export interface CommunityPollOption { // 投票选项
  id: string; // 选项主键
  label: string; // 选项文案
  votes: number; // 票数
  mine: number; // 我是否投了该选项
}

export interface CommunityPoll { // 投票聚合
  options: CommunityPollOption[]; // 选项
  total: number; // 总票数
  my_option: string | null; // 我的选项
}

export interface CommunityThread { // 帖子列表项
  id: string; // 主键
  title: string; // 标题
  summary: string; // 摘要
  kind: ThreadKind; // 形态
  cover_url: string | null; // 封面
  price_cents: number; // 付费价格（分）
  views: number; // 浏览量
  likes: number; // 点赞数
  reply_count: number; // 回复数
  created_at: string; // 创建时间
  last_activity_at: string; // 最后活跃
  board_slug: string; // 所属板块
  board_name: string; // 板块名称
  board_price_cents?: number; // 板块加入价格（分）
  board_joined?: number; // 是否已加入板块
  board_visibility?: 'public' | 'followers'; // 板块可见性
  board_followed?: number; // 是否已关注板块
  author_name: string | null; // 作者昵称（null 为官方）
  purchased: number; // 是否已购
  favorited?: number; // 是否已收藏
  favorite_count?: number; // 收藏数
  rating_avg?: number | null; // 平均评分
  rating_count?: number; // 评分数
  locked: boolean; // 是否锁定
}

export interface CommunityEpisode { // 剧集
  id: string; // 主键
  title: string; // 集标题
  media_url: string; // 播放地址
  poster_url: string | null; // 封面
  sort_order: number; // 顺序
}

export interface CommunityThreadDetail extends Omit<CommunityThread, 'locked'> { // 帖子详情
  body: string; // 正文（未解锁为空）
  locked: boolean; // 是否锁定
  board_locked?: boolean; // 板块是否未加入
  board_visibility?: 'public' | 'followers'; // 板块可见性
  board_followed?: number; // 是否已关注板块
  author_name: string | null; // 作者昵称
  author_id?: string | null; // 作者 ID
  accepted_post_id?: string | null; // 问答采纳的回复
  accepted_post?: { id: string; content: string; created_at: string; author_name: string | null } | null; // 采纳回复内容
  can_moderate?: boolean; // 是否可删除
  media?: CommunityThreadMedia[]; // 图集 / 视频
  attachments?: ThreadAttachmentMeta[]; // 附件位（未解锁时为空）
  episodes?: CommunityEpisode[]; // 剧集目录
  poll?: CommunityPoll | null; // 投票
  my_rating?: number | null; // 我的评分
}

export interface CommunityPost { // 回复
  id: string; // 主键
  content: string; // 内容
  created_at: string; // 时间
  author_name: string | null; // 作者昵称
  author_member_no: string | null; // Mim ID
}

// ---------- 圈子（circles）共享类型，与 routes/circles.ts 响应一一对应 ----------

export type CircleRole = 'owner' | 'admin' | 'member'; // 成员角色
export type CircleJoinMode = 'open' | 'approve' | 'invite'; // 加入方式

export interface CircleSummary { // 圈子列表项 / 详情投影
  slug: string; // 对外标识
  name: string; // 圈子名称
  intro: string; // 简介
  cover_url: string | null; // 封面
  owner_id: string; // 圈主用户 ID
  visibility: 'public' | 'private'; // 可见性
  join_mode: CircleJoinMode; // 加入方式
  member_limit: number; // 成员上限（0 不限）
  category: string | null; // 分类
  status: 'active' | 'archived'; // 状态
  member_count: number; // active 成员数
  i_am_member: boolean; // 当前用户是否已加入
  my_role: CircleRole | null; // 当前用户角色
}

export interface CircleMember { // 成员名单项
  user_id: string; // 用户 ID
  role: CircleRole; // 角色
  status: 'pending' | 'active' | 'left'; // 关系状态
  joined_at: string; // 加入时间
  name: string | null; // 展示名
  member_no: string | null; // Mim ID
}

export interface CirclePost { // 圈内动态
  id: string; // 主键
  thread_id: string | null; // 关联板块帖（可空；纯圈内动态为 null）
  author_id: string; // 作者 ID
  body: string; // 正文
  created_at: string; // 时间
  author_name: string | null; // 作者昵称
  author_member_no: string | null; // 作者 Mim ID
}

export interface CircleNotice { // 圈内公告
  id: string; // 主键
  author_id: string; // 发布者 ID
  body: string; // 公告正文
  created_at: string; // 时间
  author_name: string | null; // 发布者昵称
  author_member_no: string | null; // 发布者 Mim ID
}

export interface CircleCreatePayload { // 创建圈子入参
  slug: string; // 标识
  name: string; // 名称
  intro?: string; // 简介
  cover_url?: string | null; // 封面
  visibility?: 'public' | 'private'; // 可见性
  join_mode?: CircleJoinMode; // 加入方式
  member_limit?: number; // 成员上限
  category?: string | null; // 分类
}

export interface VipPlan { // 会员套餐
  code: string; // 套餐编码
  name: string; // 名称
  level: number; // 等级
  price_cents: number; // 价格（分）
  duration_days: number; // 有效天数
  perks: string[]; // 权益
}

export interface WalletSnapshot { // 钱包快照
  user_id: string; // 所属用户
  balance_cents: number; // 余额（分）
  points: number; // 积分
}

export interface WalletTransaction { // 钱包流水
  id: string; // 主键
  kind: 'recharge' | 'consume' | 'refund' | 'commission' | 'withdraw' | 'points'; // 类型
  amount_cents: number; // 金额变化（分）
  points: number; // 积分变化
  note: string; // 备注
  created_at: string; // 时间
}

export interface ShopProduct { // 独立商品
  code: string; // 编码
  name: string; // 名称
  summary: string; // 简介
  kind: 'physical' | 'virtual_auto' | 'virtual_manual'; // 发货类型
  price_cents: number; // 价格（分）
  cover_url: string | null; // 封面
  stock: number; // 标称库存
  available: number; // 可售库存（自动发卡按卡密数）
  delivery_note: string; // 发货说明
}

export interface ShopOrder { // 商城订单
  id: string; // 订单号
  quantity: number; // 数量
  amount_cents: number; // 原价
  discount_cents: number; // 优惠
  payable_cents: number; // 实付
  status: 'pending' | 'paid' | 'delivered' | 'refunded' | 'cancelled'; // 状态
  delivery_kind: string; // 发货方式
  delivered_content: string | null; // 卡密 / 人工说明
  created_at: string; // 下单时间
  delivered_at: string | null; // 发货时间
  product_code: string; // 商品编码
  product_name: string; // 商品名称
  cover_url: string | null; // 封面
}

// ---------- 统一交易域（commerce/orders）只读视图，与服务端 commerce/unified.ts 一一对应 ----------

/** 统一订单来源产线：shop 实物卡密 / asset 付费资产 */
export type UnifiedOrderSource = 'shop' | 'asset';

export interface UnifiedOrderItem { // 统一订单明细行
  id: string; // 明细主键
  product_id: string; // 商品主键
  product_code: string | null; // 商品业务编码，寻址与回退展示用
  title: string; // 下单时商品名快照
  quantity: number; // 数量
  unit_price_cents: number; // 下单时单价（分）
}

export interface UnifiedOrder { // 统一订单视图
  id: string; // 统一订单主键（uo_<source>_<source_id>）
  user_id: string; // 下单用户
  source: UnifiedOrderSource; // 来源产线
  source_id: string; // 源订单主键；旧履约 / 写路径仍按它定位源订单
  status: string; // 统一状态机取值
  channel: string; // 结算通道
  currency: string; // 结算币种
  total_cents: number; // 原价合计
  discount_cents: number; // 优惠合计
  payable_cents: number; // 实付金额
  created_at: string; // 下单时间
  paid_at: string | null; // 支付完成时间
  product_code: string | null; // 首件商品编码
  delivery_kind: string | null; // 实物线发货方式，仅 shop 来源有值
  delivered_content: string | null; // 卡密 / 人工说明，仅 shop 来源有值
  shipping: { carrier: string; tracking_no: string; status: string; updated_at: string } | null; // 物流单，未发货为 null
  after_sales_status: string | null; // 最近一条售后申请状态
  items: UnifiedOrderItem[]; // 订单明细
}

/** 售后申请：用户对已付款订单发起，后台可同意（退款入余额）或驳回 */
export interface AfterSalesRequest { // 售后申请视图
  id: string; // 申请主键
  order_id: string; // 关联商城订单
  kind: 'refund_only' | 'return_refund' | 'repair'; // 申请类型
  reason: string; // 申请理由
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; // 处理状态
  admin_note: string | null; // 后台备注
  handled_at: string | null; // 处理时间
  created_at: string; // 申请时间
  product_name?: string; // 商品名（列表接口会联表带出）
}

export interface UnifiedOrderSummary { // 统一订单汇总口径
  total: number; // 订单总数
  paid: number; // 已支付（含已发货）
  pending: number; // 待支付
  refunded: number; // 已退款
  payable_cents: number; // 实付合计（分）
}
// ---------- 商业化中台共享类型，与 services/mim-api 新路由响应一一对应 ----------


export type PaymentProvider = 'alipay' | 'wechat' | 'manual' | 'sandbox'; // 支付渠道

export interface PaymentChannel { // 渠道状态
  id: PaymentProvider; // 渠道
  label: string; // 展示名
  configured: boolean; // 是否配置
  note: string; // 说明
}

export interface PaymentIntent { // 支付意图
  id: string; // 主键
  purpose: string; // 用途
  ref_id: string; // 关联对象
  provider: string; // 渠道
  amount_cents: number; // 金额
  status: string; // 状态
  pay_url: string | null; // 支付链接
  qr_text: string | null; // 二维码内容
  created_at: string; // 创建时间
}

export interface ThemeSettings { // 主题
  accent?: string; // 主色
  background?: string; // 背景
  nav_layout?: string; // 导航布局
  list_style?: string; // 列表样式：card / list / compact
  radius?: number; // 圆角
  mode?: string; // 站点默认明暗：light / dark（访客可在前台自行覆盖）
  font?: string; // 字体族（CSS font-family 取值）
  nav_items?: Array<{ view: string; label: string; icon?: string; visible?: boolean }>; // 后台配置的导航项（可选，缺省回落内置导航）
}

export interface I18nSettings { // 语言配置
  front: 'zh-CN' | 'en-US'; // 前台语言
  admin: 'zh-CN' | 'en-US'; // 后台语言
  supported: string[]; // 支持语言
  machine_translation: boolean; // 是否启用机器翻译
}

export interface PageBlock { // 页面区块
  id: string; // 主键
  page: string; // 页面
  kind: string; // 区块类型
  sort_order: number; // 排序
  config_json: string; // 原始配置
  config: Record<string, unknown>; // 解析后配置
  updated_at: string; // 更新时间
}

// ---------- 内容运营共享类型：公告 / 更新日志 / 推广计划，与冻结响应契约一一对应 ----------

/** 积分抵扣运行口径（公开只读；总开关关闭时前端整块隐藏抵扣面板） */
export interface PointsDeductionConfig {
  enabled: boolean; // 积分抵扣总开关
  points_per_yuan: number; // 多少积分折抵 1 元
  max_ratio_percent: number; // 单笔抵扣上限占应付金额的百分比（0–100）
} // 代码块结束

export interface AnnouncementItem { // 公告条目
  id: string; // 主键
  title: string; // 标题
  body: string; // 正文
  pinned: boolean; // 是否置顶
  published_at: string | null; // 发布时间
  level?: 'info' | 'warning' | 'success' | 'danger'; // 管理端：公告级别（公开清单缺省）
  status?: 'draft' | 'published' | 'archived'; // 管理端：审核状态（公开清单缺省）
  starts_at?: string | null; // 管理端：有效期起
  ends_at?: string | null; // 管理端：有效期止
} // 代码块结束

export interface ChangelogItem { // 更新日志条目
  id: string; // 主键
  version: string; // 语义版本号
  title: string; // 标题
  body: string; // 正文
  published_at: string | null; // 发布时间
  changes?: string[]; // 管理端：变更清单
  status?: 'draft' | 'published' | 'archived'; // 管理端：审核状态（公开清单缺省）
} // 代码块结束

export interface PromotionItem { // 推广计划条目
  id: string; // 主键
  name: string; // 计划名称
  summary: string; // 简介
  target_url: string; // 落地页
  starts_at: string | null; // 起始时间
  ends_at: string | null; // 截止时间
  status: string; // 状态
  code?: string | null; // 管理端：推广码
  budget_cents?: number; // 管理端：预算（分，仅统计）
} // 代码块结束

/** 统一内容来源：论坛主题 / 圈内动态 / 圈内公告（与后端 content/unified.ts 的 ContentSource 一致） */
export type ContentFeedSource = 'community_thread' | 'circle_post' | 'circle_notice';

/** 统一内容流条目（对应后端 GET /content/items 的 items 元素） */
export interface ContentFeedItem {
  id: string; // 统一主键
  source: ContentFeedSource; // 来源：论坛主题 / 圈内动态 / 圈内公告
  source_id: string; // 源表主键
  container_kind: 'board' | 'circle'; // 容器类型：板块 / 圈子
  container_id: string; // 容器主键
  author_id: string | null; // 作者用户 id，匿名 / 已删号为 null
  kind: string; // 内容形态（text / video / notice 等）
  title: string; // 标题
  summary: string; // 摘要
  body: string; // 正文
  status: string; // 状态
  created_at: string; // 发布时间
  updated_at: string; // 更新时间
} // 统一内容条目结束

/** 公告管理入参（与 /admin/content/announcements 契约对齐） */
export interface AnnouncementUpsertPayload {
  title: string; // 标题（必填）
  body?: string; // 正文
  level?: 'info' | 'warning' | 'success' | 'danger'; // 级别
  status?: 'draft' | 'published' | 'archived'; // 状态
  starts_at?: string | null; // 有效期起
  ends_at?: string | null; // 有效期止
  pinned?: boolean; // 是否置顶
} // 代码块结束

/** 更新日志管理入参（与 /admin/content/changelog 契约对齐） */
export interface ChangelogUpsertPayload {
  version: string; // 语义版本号（必填）
  title: string; // 标题（必填）
  body?: string; // 正文
  changes?: string[]; // 变更清单
  published_at?: string | null; // 发布时间
  status?: 'draft' | 'published' | 'archived'; // 状态
} // 代码块结束

/** 推广计划管理入参（与 /admin/content/promotions 契约对齐） */
export interface PromotionUpsertPayload {
  name: string; // 名称（必填）
  summary?: string; // 简介
  target_url?: string; // 落地页
  code?: string | null; // 推广码
  starts_at?: string | null; // 有效期起
  ends_at?: string | null; // 有效期止
  status?: 'draft' | 'active' | 'paused' | 'archived'; // 状态
  budget_cents?: number; // 预算（分，仅统计）
} // 代码块结束

// ---------- 板块 Tab 栏目：兼容后端 sort_order/sort_by 与冻结契约 order/sort 两套字段名 ----------

export interface BoardTab { // 板块 Tab 配置视图
  key: string; // 栏目标识：latest / hot / recommend / rating / favorites ...
  label: string; // 展示名
  order?: number; // 展示顺序（冻结契约字段）
  sort_order?: number; // 展示顺序（后端字段，优先于 order）
  visible: boolean; // 是否展示
  sort?: string; // 排序口径（冻结契约字段）
  sort_by?: string; // 排序口径（后端字段，优先于 sort）
} // 代码块结束

export interface BoardTabInput { // 保存栏目入参
  key: string; // 栏目标识
  label?: string; // 展示名
  visible?: boolean; // 是否展示
  sort_order?: number; // 展示顺序
  sort_by?: string; // 排序口径
} // 代码块结束

// ---------- 自研工具目录类型 ----------

export interface ToolVersionNote { // 版本记录条目
  version: string; // 语义版本号
  title?: string; // 版本标题
  notes?: string; // 更新说明
  released_at?: string; // 发布时间
} // 代码块结束

export interface ToolItem { // 工具清单 / 详情视图
  id: string; // 主键
  slug: string; // 对外短标识
  name: string; // 名称
  summary: string; // 一句话简介
  version_notes: ToolVersionNote[]; // 版本记录
  download_url: string; // 下载地址
  doc_url: string; // 文档地址
  tags: string[]; // 标签
  status: string; // 状态：draft / active / archived
  sort_order: number; // 展示顺序
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
} // 代码块结束

export interface ToolUpsertPayload { // 新建 / 更新工具入参
  slug?: string; // 新建时必填；更新时不可改
  name: string; // 名称
  summary?: string; // 简介
  version_notes?: ToolVersionNote[]; // 版本记录
  download_url?: string; // 下载地址
  doc_url?: string; // 文档地址
  tags?: string[]; // 标签
  status?: 'draft' | 'active' | 'archived'; // 状态
  sort_order?: number; // 排序
} // 代码块结束

export interface GrowthBadge { // 徽章
  code: string; // 编码
  name: string; // 名称
  description: string; // 说明
  icon: string; // 图标
  awarded: number; // 是否已获得
  awarded_at: string | null; // 获得时间
} // 代码块结束

export interface GrowthSnapshot { // 成长快照
  level: number; // 等级
  next_points: number; // 下一级所需积分
  stats: { points: number; orders: number; assets: number; checkins: number; vip_level: number }; // 统计
  badges: GrowthBadge[]; // 徽章
} // 代码块结束

export interface DirectMessage { // 私信
  id: string; // 主键
  content: string; // 内容
  read_at: string | null; // 已读时间
  created_at: string; // 时间
  peer_member_no: string; // 对方 Mim ID
  peer_name: string; // 对方昵称
} // 代码块结束


// ---- 以下为拆分后的桶导出：调用方 import 路径与符号名保持不变 ----
