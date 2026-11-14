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
  is_guest?: boolean; // 匿名访客会话标记：true 表示尚未绑定任何登录身份，可随时登录升级
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


// ---------- 漫剧 AI 剧（comic）共享类型，与 routes/comic.ts payload 一一对应 ----------

export interface ComicProject { // 漫剧项目：一部剧的元信息与生命周期状态
  id: string; // 项目主键
  region: Region; // 所属区域，决定可用模型与合规策略
  title: string; // 剧名
  synopsis: string | null; // 剧情梗概，草稿阶段常为空
  status: 'draft' | 'storyboarded' | 'generating' | 'rendered' | 'published' | 'archived'; // 状态机：草稿→分镜→生成→渲染→发布→归档
  version: number; // 乐观锁版本号，写操作需带上以防并发覆盖
  created_at: string; // 创建时间（ISO 字符串，服务端统一 UTC）
  updated_at: string; // 最近更新时间，用于列表排序与缓存失效
} // ComicProject 结束

export interface ComicCharacter { // 角色设定：用于跨分镜保持外观一致
  id: string; // 角色主键
  name: string; // 角色名，出现在分镜对白与画面提示中
  appearance_prompt: string; // 外观提示词，图像生成时注入以稳定形象
  seed: number | null; // 随机种子，固定后同一提示词可复现同一外观
  reference_asset_ids: string[]; // 参考图产物 id 列表，作为图生图的风格锚点
  voice_profile: string | null; // 音色配置标识（TTS 用），未配置为 null
  version: number; // 版本号，配合写接口做并发控制
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
} // ComicCharacter 结束

export interface StoryboardShot { // 单个分镜镜头
  index: number; // 镜头序号，前端按此顺序渲染播放
  description: string; // 画面描述，直接作为图像生成提示词
  dialogue?: string; // 该镜头台词，可空（纯画面镜头）
  [key: string]: unknown; // 允许服务端附加扩展字段，前端透传不解析
} // StoryboardShot 结束

export interface Storyboard { // 一份分镜稿（项目可多次保存，取 latest）
  id: string; // 分镜稿主键
  version_no: number; // 版本序号，用于展示与版本对比
  shots: StoryboardShot[]; // 镜头数组，顺序即播放顺序
  confirmed_at: string | null; // 确认时间；null 表示未确认、仍可编辑
  created_by: string; // 创建者用户 id，便于审计
  created_at: string; // 创建时间
} // Storyboard 结束

export type SuggestKind = 'script' | 'storyboard' | 'dialogue' | 'voice'; // AI 建议类型：剧本/分镜/台词/音色

export interface Suggestion { // AI 生成建议的统一包装
  kind: SuggestKind; // 建议类型，决定 items 的字段语义
  model: string; // 实际使用的模型标识，便于回显与成本核算
  generated_at: string; // 生成时间
  requires_confirmation: boolean; // 是否必须人工确认后才落库（防止 AI 直改用户数据）
  items: Array<Record<string, unknown>>; // 候选条目，前端渲染成可选项
} // Suggestion 结束

export type JobType = 'text' | 'image' | 'video' | 'tts' | 'compose'; // 任务类型：文本/图像/视频/配音/合成

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'; // 任务状态机，前端据此轮询或终止

export interface GenerationJob { // 一次异步生成任务
  id: string; // 任务主键
  project_id: string; // 所属项目
  storyboard_id: string | null; // 关联分镜稿；文本类任务可能为空
  job_type: JobType; // 任务类型，决定调度到哪个 worker
  status: JobStatus; // 当前状态
  retry_of: string | null; // 重试任务指向原任务 id，形成追溯链
  cost_estimate_minor: number | null; // 预估费用（最小货币单位），用于额度前置校验
  error_code: string | null; // 失败时的错误码，失败态才有值
  payload: Record<string, unknown>; // 任务入参快照，便于复现与审计
  result: Record<string, unknown> | null; // 执行结果，成功后才填充
  created_by: string; // 发起者用户 id
  created_at: string; // 创建时间
  started_at: string | null; // 开始执行时间
  finished_at: string | null; // 结束时间（成功或失败）
} // GenerationJob 结束

export type FilmStatus = 'draft' | 'reviewing' | 'published' | 'archived'; // 成片状态机：草稿→审核中→已发布→已归档

export interface Film { // 成片（可发布的作品）
  id: string; // 成片主键
  project_id: string; // 所属项目
  title: string; // 成片标题
  status: FilmStatus; // 审核状态
  current_version_id: string | null; // 当前生效版本 id；无版本时为 null
  review_note: string | null; // 审核意见，驳回时填写
  version: number; // 乐观锁版本号
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
} // Film 结束

export interface FilmVersion { // 成片的一个版本（对应一次视频产物）
  id: string; // 版本主键
  film_id: string; // 所属成片
  version_no: number; // 版本序号，递增
  object_key: string | null; // 对象存储键；未上传产物时为 null
  duration_sec: number | null; // 时长（秒），未探测到为 null
  size_bytes: number | null; // 文件大小（字节）
  published_at: string | null; // 发布时间；未发布为 null
  created_by: string; // 创建者用户 id
  created_at: string; // 创建时间
} // FilmVersion 结束

/** 放映厅演示作品：匿名可看，片源由静态站托管（服务端返回绝对地址） */
export interface ShowcaseWork { // 一部演示作品
  id: string; // 稳定标识
  title: string; // 标题
  subtitle: string; // 副标题
  kind: 'comic-drama' | 'ai-drama'; // 漫剧 / AI 剧形态
  region: 'cn' | 'global'; // 内容分区
  tags: string[]; // 标签
  cover: string; // 封面绝对地址
  episodes: Array<{ no: number; title: string; src: string; duration_sec: number }>; // 可播放剧集
} // ShowcaseWork 结束

/** 我的放映厅条目：登录后由服务端签发播放地址（有效期 1 小时） */
export interface TheaterItem { // 一部本人成片
  id: string; // 成片 ID
  title: string; // 成片标题
  project_title: string; // 所属工程
  status: string; // 成片状态
  version_no: number; // 播放版本
  duration_sec: number | null; // 时长
  src: string; // 预签名播放地址
  updated_at: string; // 更新时间
} // TheaterItem 结束

// ---------- 成片导出（对齐 routes/comic.ts 的 POST /comic/films/:id/export） ----------

export type FilmExportFormat = 'mp4' | 'mov'; // 导出容器格式：mp4 走原片直下，mov 需服务端 ffmpeg 转码

export type FilmExportResolution = '720p' | '1080p'; // 导出分辨率：1080p 与 compose 产物一致，无需转码

export interface FilmExportResult { // 导出结果：一次性预签名下载地址，有效期由服务端限定
  film_id: string; // 成片主键，回显便于前端核对
  version_no: number; // 导出所基于的版本号（始终取最新版本）
  format: FilmExportFormat; // 实际导出格式
  resolution: FilmExportResolution; // 实际导出分辨率
  transcoded: boolean; // 是否经过 ffmpeg 转码；false 表示直接下载原片
  download_url: string; // 预签名下载地址，可能相对也可能绝对，交给 resolvePublicUrl 归一化
  expires_at: string; // 下载地址过期时间（ISO）
  method: string; // 下载请求方法，当前固定 GET
  headers: Record<string, string>; // 下载需携带的请求头，S3 驱动下可能非空
} // FilmExportResult 结束

// ---------- media / ai 类型（对齐 routes/media.ts、routes/ai.ts、orchestrator.ts、storage.ts） ----------

export type AssetType = 'image' | 'video' | 'audio' | 'text' | 'final'; // 产物类型，服务端据此校验 mime 与大小上限

export interface GenerationAsset { // 生成产物（图片/视频/音频等）的元信息
  id: string; // 产物主键
  job_id: string | null; // 来源任务；手工上传的产物可为空
  project_id: string | null; // 所属项目；与项目无关的产物为空
  asset_type: AssetType; // 产物类型
  object_key: string; // 对象存储键，下载需先换取预签名地址
  mime: string; // MIME 类型，前端据此选择渲染方式
  duration_ms: number | null; // 时长（毫秒），音视频才有值
  size_bytes: number | null; // 大小（字节）
  checksum: string | null; // 内容校验和，用于完整性校验与去重
  expires_at: string | null; // 产物过期时间，过期后需重新生成
  created_at: string; // 创建时间
} // GenerationAsset 结束

/** GET /media/assets 列表项：在产物字段上附带预签名下载地址 */
export interface ListedAsset extends GenerationAsset { // 列表接口专用：继承产物字段
  download_url: string; // 服务端即时签发的下载地址，前端无需自行拼接
} // ListedAsset 结束

/** 与 storage.ts PresignedUrl 一致 */
export interface PresignedUrl { // 预签名地址（客户端直传/直下，绕过后端转发）
  url: string; // 完整可访问地址，含签名参数
  method: 'PUT' | 'GET'; // 该方法限定：上传用 PUT、下载用 GET
  headers: Record<string, string>; // 必须原样带上的请求头（如 Content-Type），否则签名校验失败
  expires_at: string; // 签名过期时间，过期需重新申请
} // PresignedUrl 结束

/** 与 orchestrator.capabilities() 一致（routes/ai.ts 包装为 { ai, storage }） */
export interface AiCapabilities { // AI 编排能力自述，前端据此隐藏不可用功能
  provider: string; // 当前生效的模型供应商标识
  provider_configured: boolean; // 供应商密钥是否已配置；false 时只能跑 mock
  mock_provider: boolean; // 是否处于 mock 模式（不产生真实费用）
  supported_job_types: JobType[]; // 支持的任型列表，决定界面上可点的按钮
  base_url?: string; // 供应商网关地址，仅调试时展示
  text_model?: string; // 文本模型名
  image_model?: string; // 图像模型名
  job_cost_limit_minor: number; // 单任务费用上限（最小货币单位）
  daily_cost_limit_minor: number; // 每日费用上限
  asset_ttl_days: number; // 产物保留天数，过期自动清理
  storage: { driver: string; configured: boolean }; // 存储驱动与是否已配置
  worker_enabled: boolean; // 后台 worker 是否开启，关闭时需手动触发执行
  worker_interval_ms: number; // worker 轮询间隔，前端据此估算进度刷新频率
} // AiCapabilities 结束

/** 与 orchestrator.RunResult 一致 */
export interface RunJobResult { // 单次任务执行结果
  job_id: string; // 被执行的任务 id
  status: 'succeeded' | 'failed' | 'skipped'; // 执行结论；skipped 表示状态不符被跳过
  provider: string; // 实际调用的供应商
  asset_id?: string; // 产出的产物 id（成功且为生成类任务）
  object_key?: string; // 产物对象键，便于直接取用
  error_code?: string; // 失败错误码
  message?: string; // 附加说明（失败原因或跳过原因）
} // RunJobResult 结束

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

/** 购物车条目：模块信息 + 单价 + 已拥有 / 免费标记 */
export interface CartItem {
  module_code: string; // 模块编码
  name: Record<string, string>; // 多语言名称
  capability: string | null; // 真实能力键；null 表示功能规划中
  status: string; // 模块状态
  available: boolean; // 是否可结算（仅 active 为 true）
  owned: boolean; // 是否已拥有（已拥有则结算时跳过）
  free: boolean; // 是否免费（无价格行或 0 价）
  price: { currency: string; amount_minor: number } | null; // 单价；免费为 null
  added_at: string; // 加购时间
} // CartItem 结束

/** 购物车汇总视图 */
export interface CartSummary {
  items: CartItem[]; // 条目列表（最近加购在前）
  totals: Array<{ currency: string; amount_minor: number }>; // 按币种合计（只算可支付项）
  count: number; // 条目总数
  payable_count: number; // 需要结算的条目数（排除免费与已拥有）
} // CartSummary 结束

/** 结算单条结果：订单 / 即时解锁 / 跳过 */
export interface CartCheckoutResult {
  module_code: string; // 模块编码
  kind: 'order' | 'unlocked' | 'skipped'; // 结果类型
  order?: { id: string; status: string; currency: string; amount_minor: number; module_code: string; module_name: Record<string, string> }; // kind=order 时存在
  entitlement_id?: string; // kind=unlocked 时存在
  reason?: string; // kind=skipped 时的原因
  points_spent?: number; // 本单实际消耗积分
  points_deduct_cents?: number; // 积分折抵金额（分）
  payable_cents?: number; // 抵扣后应付金额（分）
} // CartCheckoutResult 结束

// ---------- 统一入口配置清单（entries / sites）共享类型 ----------

export interface SiteCapability { // 单个功能点：由业务系统语义派生的最小可运行能力
  code: string; // 能力编码：catalog / manage / record
  name: string; // 能力展示名，例如「文章目录」
  itemKind: string; // 业务条目实体名，例如「文章」
  description: string; // 能力说明
  states: string[]; // 允许的状态列表，顺序即展示顺序
} // SiteCapability 结束

export interface EntryResponsibility { // 职责边界：负责 / 不负责
  inScope: string[]; // 本入口负责的范围
  outOfScope: string[]; // 明确排除、由其它入口承担的范围
} // EntryResponsibility 结束

export interface EntryRelation { // 相似入口关联与区分
  entryId: string; // 关联入口序号
  entryKey: string; // 关联入口占位键
  relation: string; // 关系类型：similar / depends / shares
  distinction: string; // 区分说明
  system?: string | null; // 关联入口业务系统说明（详情端点补充）
  domainName?: string | null; // 关联入口业务域（详情端点补充）
} // EntryRelation 结束

// 落地状态四态：已落地 / 部分相邻 / 规划中 / 语义冲突
export type EntryImplementationStatus = 'implemented' | 'partial' | 'planned' | 'conflict';

export interface EntryImplementation { // 入口落地映射：现有真实模块与边界说明
  status: EntryImplementationStatus; // 落地状态
  view: string | null; // 站内可直达视图标识（对齐 AppView）；无则 null
  href: string | null; // 站外路径（独立后台等）；无则 null
  realFeatures: string[]; // 现有真实能力清单
  boundary: string; // 对齐 / 冲突边界说明
} // EntryImplementation 结束

export interface EntryModule { // 统一入口配置清单中的一项
  id: string; // 两位序号
  entryKey: string; // 稳定入口标识（占位键），不是具体主机值
  implementation: EntryImplementation; // 落地状态映射（真实模块 / 视图 / 边界）
  placeholder: string; // 可配置占位标识
  envKey: string; // 运行期配置注入键
  configured: boolean; // 是否已由外部配置注入实际主机值
  note: string; // 备注原文（含全角竖线）
  entry: string; // 备注前半段：入口描述
  system: string; // 备注后半段：业务系统/模块说明
  domain: string; // 业务域编码
  domainName: string; // 业务域中文名
  coreFunctions: string[]; // 核心功能清单
  responsibility: EntryResponsibility; // 职责边界
  adminRole: string; // 后台管理职责
  apiRole: string; // 接口职责
  related: EntryRelation[]; // 相似入口关联与区分
  rows: number[]; // 台账溯源行号
  sheet: string; // 来源工作表
} // EntryModule 结束

export interface SiteModuleSummary extends EntryModule { // 运行时列表视图：清单字段 + 实时条目数
  host: string; // 兼容字段：等于 entryKey，不是具体主机值
  group: string; // 兼容字段：等于业务域编码
  capability_count: number; // 功能点数量
  item_count: number; // 该入口当前业务条目数
} // SiteModuleSummary 结束

export interface EntryDomain { // 业务域
  code: string; // 业务域编码
  name: string; // 业务域中文名
  description: string; // 业务域覆盖说明
  count: number; // 该域下的入口数
  entryKeys: string[]; // 该域下的占位键清单
} // EntryDomain 结束

export interface SiteGroup extends EntryDomain {} // 兼容别名：旧分组语义由业务域承接

export interface SiteModuleDetail extends EntryModule { // 运行时详情视图
  host: string; // 兼容字段：等于 entryKey
  group: string; // 兼容字段：等于业务域编码
  capabilities: SiteCapability[]; // 三个功能点
  seed: Array<{ capability: string; title: string; status: string; detail: string }>; // 演示数据定义
} // SiteModuleDetail 结束

export interface SiteItem { // 业务条目：每个入口能力下的可交互记录
  id: string; // 条目主键
  host: string; // 所属入口占位键（物理列沿用历史名）
  capability: string; // 所属能力编码
  title: string; // 条目标题
  detail: string; // 条目说明
  status: string; // 当前状态
  created_by: string; // 创建者：system 表示演示数据
  created_at: string; // 创建时间
  updated_at: string; // 最近更新时间
} // SiteItem 结束

export interface SiteOverview { // 全站汇总响应
  schema: string; // 契约版本
  title: string; // 清单标题
  source: string; // 依据说明
  scope: string; // 取证范围
  moduleBasis: string; // 模块划分依据
  note_format: string; // 备注格式说明
  derivation: string; // 实现推导声明
  modules: number; // 去重后入口总数
  capabilities: number; // 功能点总数
  groups: number; // 兼容字段：业务域总数
  domains: number; // 业务域总数
  blankRows: number; // 台账空备注原始行数
  placeholders: number; // 占位标识总数
  configured: number; // 已配置实际主机值的入口数
  unconfigured: number; // 仍为占位状态的入口数
  items: number; // 库内业务条目总数
  by_status: Record<string, number>; // 按状态分布
  implementation: Record<EntryImplementationStatus, number>; // 落地状态四态计数
} // SiteOverview 结束

export interface EntryOverview { // 清单总览响应
  schema: string; // 契约版本
  title: string; // 清单标题
  source: string; // 依据说明
  scope: string; // 取证范围
  moduleBasis: string; // 模块划分依据
  noteFormat: string; // 备注格式说明
  derivation: string; // 实现推导声明
  entries: number; // 去重后入口数
  domains: number; // 业务域数
  capabilities: number; // 运行时功能点数
  relations: number; // 相似模块关联条数
  placeholders: number; // 占位标识总数
  configured: number; // 已配置数
  unconfigured: number; // 未配置数
  implementation: Record<EntryImplementationStatus, number>; // 落地状态四态计数
  dedupe: Record<string, unknown>; // @ / 空白 / 重复备注整理结果
  atRecord: Record<string, unknown>; // @ 合并后的占位项
  blankRecord: Record<string, unknown>; // 空白字段合并后的占位项
  hostConfig: Record<string, unknown>; // 不补写具体主机值的策略
  blankRows: number; // 台账空备注原始行数
} // EntryOverview 结束

// ---------- 部署汇总（deployments）共享类型，与 routes/deployments.ts 响应一一对应 ----------

export interface DeploymentRepository { // 仓库标识统一三字段
  id: string | null; // 规范仓库标识，直传型部署为 null
  url: string | null; // 仓库地址
  role: string; // 该仓库在本部署项中的角色
} // DeploymentRepository 结束

export interface DeploymentDelivery { // 交付链路：含远端 HEAD / 本地工作树双口径
  mode: 'ci' | 'manual' | 'push'; // 交付方式
  ci_job: string | null; // 关联 CI 作业
  ci_step: string | null; // 关联 CI 步骤
  artifact: string | null; // 关键工件
  artifact_in_head: boolean | null; // 工件是否仍在远端 HEAD
  artifact_in_worktree: boolean | null; // 工件是否存在于本地工作树
  credential: string | null; // 所需凭证
  modes: string[]; // 同一部署项的多种发布形态（合并展示，避免重复计数）
} // DeploymentDelivery 结束

export interface DeploymentResult { // 部署结果；null 由前端按空数据渲染
  verdict: string; // 判定枚举：PASS / DEGRADED / FAIL / NOT_TESTED / EMPTY
  http_code: string | null; // HTTP 状态码
  latency_ms: number | null; // 耗时（毫秒）
  bytes: number | null; // 响应体字节数
  evidence: string; // 取证原文与判读
  captured_at: string | null; // 取证时间
} // DeploymentResult 结束

export interface DeploymentAnomaly { // 异常说明
  code: string; // 异常码
  severity: 'critical' | 'warning' | 'info'; // 严重度
  message: string; // 说明与影响面
} // DeploymentAnomaly 结束

export interface DeploymentItem { // 单个部署项：所有同类项共用这一组统一字段
  id: string; // 规范唯一键
  name: string; // 统一名称
  aliases: string[]; // 归并的历史别名
  platform_id: string; // 平台编码
  platform: string; // 平台展示名
  layer: string; // 层级枚举：production / distribution / source
  kind: string; // 载体类型
  repository: DeploymentRepository; // 仓库标识
  entry_url: string | null; // 部署入口
  delivery: DeploymentDelivery; // 交付链路
  status: string; // 部署状态
  result: DeploymentResult | null; // 部署结果，null 为空数据
  anomalies: DeploymentAnomaly[]; // 异常说明
  missing_fields: string[]; // 缺失信息
  sources: string[]; // 取证来源
} // DeploymentItem 结束

export interface DeploymentOverview { // 全量汇总响应
  schema: string; // 契约版本
  captured_at: string; // 取证时间
  head: string; // 取证时本地 HEAD
  scope: string; // 覆盖范围
  sources: string[]; // 取证来源
  total: number; // 部署项总数
  matrix_platforms: number; // 矩阵平台数
  platform_catalog: number; // 平台目录总数
  git_remotes: number; // git 远端数
  ci_jobs: number; // CI 作业数
  deploy_ci_jobs: number; // 其中部署作业数
  excluded: number; // 候选池 / 排除项数
  with_result: number; // 有取证项数
  empty_result: number; // 空数据项数
  anomalies: number; // 异常总数
  missing_fields: number; // 缺失信息总数
  worktree_drift: number; // 工作树漂移项数
  by_status: Record<string, number>; // 状态分布
  by_verdict: Record<string, number>; // 结果分布
  by_layer: Record<string, number>; // 层级分布
  by_platform: Record<string, number>; // 平台分布
  by_severity: Record<string, number>; // 严重度分布
  status_codes: Record<string, string>; // 状态字典
  verdict_codes: Record<string, string>; // 结果字典
  severity_codes: Record<string, string>; // 严重度字典
  layer_codes: Record<string, string>; // 层级字典
  platforms: Array<{ id: string; name: string; in_matrix: boolean }>; // 平台目录
  ci_job_list: Array<{ id: string; role: string; is_deploy: boolean }>; // CI 作业明细
  excluded_items: Array<{ id: string; name: string; reason: string }>; // 候选池 / 排除项明细
  field_spec: Record<string, string>; // 统一字段说明
  coverage: { // 覆盖口径：解释平台数与部署项数为何不同
    matrix_platforms: number; // 矩阵平台数
    deployment_items: number; // 规范部署项数
    git_remotes: number; // git 远端数
    ci_jobs: number; // CI 作业数
    deploy_ci_jobs: number; // 部署作业数
    dedup_note: string; // 去重说明
    added_note: string; // 补齐说明
    excluded_note: string; // 排除说明
  }; // coverage 结束
} // DeploymentOverview 结束


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

// ---------- 导航站（navigation）共享类型，与 routes/navigation.ts 响应一一对应 ----------

export type NavStatus = 'ok' | 'broken' | 'unknown'; // 三态可达性

export interface NavLink { // 单条导航链接
  id: string; // 主键
  name: string; // 名称
  url: string; // 相对路径或绝对地址
  group: string; // 分组
  description: string; // 说明
  recommended: boolean; // 是否推荐位
  status: NavStatus; // 可达性
  http_status: number | null; // 最近探测 HTTP 码
  latency_ms: number | null; // 最近探测耗时
  last_checked_at: string | null; // 最近探测时间
  created_by: string; // 创建者（system 为种子）
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
} // NavLink 结束

export interface NavSummary { // 目录汇总
  total: number; // 总数
  ok: number; // 可达
  broken: number; // 失效
  unknown: number; // 未探测
  groups: Array<{ name: string; count: number }>; // 分组计数
  last_checked_at: string | null; // 最近探测时间
} // NavSummary 结束

// ---------- 统一搜索（search）共享类型，与 routes/search.ts 响应一一对应 ----------

export type SearchScope = 'module' | 'entry' | 'navigation' | 'community' | 'shop'; // 五个可检索来源
export type SearchEngine = 'sqlite' | 'meilisearch'; // 当前实际使用的检索引擎

export interface SearchHit { // 单条命中
  id: string; // 全局键
  scope: SearchScope; // 来源
  title: string; // 标题
  subtitle: string; // 副标题
  snippet: string; // 命中片段
  href: string; // 跳转地址
  keywords: string; // 参与匹配的文本
  popularity: number; // 热度
  updated_at: string; // 更新时间
  score: number; // 匹配分
} // SearchHit 结束

export interface SearchGroup { // 按来源分组的结果
  scope: SearchScope; // 来源
  label: string; // 中文组名
  count: number; // 本组条数
  items: SearchHit[]; // 命中条目
} // SearchGroup 结束

export interface SearchResponse { // 检索响应
  schema: string; // 契约版本
  query: string; // 原查询
  scope: string; // 原来源参数
  engine: SearchEngine; // 实际引擎
  total: number; // 总命中
  took_ms: number; // 耗时
  groups: SearchGroup[]; // 分组结果
} // SearchResponse 结束

export interface SearchScopeCount { // 来源文档数
  scope: SearchScope; // 来源
  label: string; // 中文组名
  count: number; // 文档数
} // SearchScopeCount 结束

// ---------- 商业化中台共享类型，与 services/mim-api 新路由响应一一对应 ----------

export type PaidAssetKind = 'article' | 'download' | 'gallery' | 'video'; // 四类付费资产

export interface PaidAsset { // 资产列表项
  code: string; // 业务编码
  kind: PaidAssetKind; // 类型
  title: string; // 标题
  summary: string; // 简介
  cover_url: string | null; // 封面
  price_cents: number; // 价格（分）
  vip_free: boolean; // VIP 免费
  views: number; // 浏览
  sales: number; // 销量
  updated_at: string; // 更新时间
  unlocked: boolean; // 当前用户是否可读
}

export interface PaidAssetDetail extends PaidAsset { // 详情
  body: string; // 正文 / 试读
  file_url: string | null; // 文件地址（未解锁为 null）
  media: Array<{ kind: 'image' | 'video'; url: string; poster_url: string | null }>; // 图库 / 视频媒体
}

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

export interface Shipment { // 物流
  carrier: string; // 承运商
  tracking_no: string; // 单号
  status: string; // 状态
  events: Array<{ text: string; at: string }>; // 轨迹
  updated_at: string; // 更新时间
}

export interface AfterSale { // 售后
  id: string; // 主键
  order_id: string; // 订单
  kind: 'refund' | 'return'; // 类型
  reason: string; // 原因
  amount_cents: number; // 金额
  status: string; // 状态
  admin_note: string; // 审核备注
  created_at: string; // 创建时间
}

export interface ProductReview { // 商品评价
  id: string; // 主键
  rating: number; // 星级
  content: string; // 内容
  created_at: string; // 时间
  display_name: string; // 评价人
}

export interface Withdrawal { // 提现单
  id: string; // 主键
  amount_cents: number; // 金额
  channel: string; // 渠道
  account: string; // 收款账号
  status: string; // 状态
  admin_note: string; // 审核备注
  created_at: string; // 申请时间
  processed_at: string | null; // 处理时间
}

export interface CreatorEarning { // 创作者收益
  id: string; // 主键
  source_type: string; // 来源类型
  source_id: string; // 来源编号
  gross_cents: number; // 毛收入
  platform_fee_cents: number; // 平台抽成
  net_cents: number; // 净收入
  status: string; // 状态
  created_at: string; // 时间
}

export interface ThemeSettings { // 主题
  accent?: string; // 主色
  background?: string; // 背景
  nav_layout?: string; // 导航布局
  list_style?: string; // 列表样式：card / list / compact
  radius?: number; // 圆角
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
