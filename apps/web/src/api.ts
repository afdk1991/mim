/**
 * Mim Web API 客户端。
 * 对齐 services/mim-api 契约：Bearer 鉴权、refresh 轮换、写操作强制 Idempotency-Key、
 * 统一错误信封 { code, message, request_id, details }。
 */

import { errorMessage, normalizeLocale } from '@mim/i18n'; // 引入 i18n 运行时工具：错误码翻译与语言标签归一化
import type { Locale } from '@mim/i18n'; // 仅类型导入 Locale，编译后被擦除，不引入运行时依赖
import type { ErrorCode } from '@mim/core-domain'; // 领域错误码类型，用于把后端 code 安全映射到文案表

export type Region = 'cn' | 'global'; // 区域维度：国内/海外，决定数据驻留与可用模块
export type Provider = 'phone' | 'email'; // 凭证类型：手机号或邮箱

export interface UserInfo { // 当前登录用户的核心资料（登录响应与 /me 共用同一形状）
  id: string; // 用户主键，本地缓存与埋点都用它标识身份
  region: Region; // 所属区域，服务端据此路由到对应数据中心
  status: string; // 账号状态机（active/deleting 等），前端据此决定是否显示注销倒计时
  display_name: string; // 展示名，未设置时由服务端兜底填充
  locale: string; // 原始语言标签（如 zh-CN），交给 normalizeLocale 归一
  timezone: string; // IANA 时区名，用于把服务端 UTC 时间渲染成本地时间
  deletion_scheduled_at?: string | null; // 注销预约时间；仅注销流程中有值，其余为 null/缺省
} // UserInfo 结构结束

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

// API 源：默认同源（自建服务器经 nginx 反代）；托管平台（GitHub Pages / Cloudflare / Vercel）
// 通过构建期 VITE_API_ORIGIN 指向生产 API。
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, ''); // 读构建期变量并去掉尾部斜杠，避免拼出双斜杠
const BASE = `${API_ORIGIN}/api/v1`; // 统一路径前缀，集中定义便于未来整体迁移
const SESSION_KEY = 'mim.session.v1'; // 键名带版本号，便于结构升级时隔离旧数据

export class ApiError extends Error { // 统一错误类型，保留业务 code 与 HTTP 状态供页面分支处理
  readonly code: string; // 业务错误码（如 UNAUTHORIZED），供 i18n 查表
  readonly status: number; // HTTP 状态码，用于粗粒度判断（401/409/5xx）
  readonly requestId?: string; // 服务端 request_id，线上排障时提供给运维
  readonly details?: unknown; // 结构化细节（字段校验错误等），保持 unknown 避免过度约束

  constructor(code: string, message: string, status: number, details?: unknown, requestId?: string) { // 按后端信封字段顺序接收参数
    super(message); // 先初始化基类，保证 message/stack 可用
    this.name = 'ApiError'; // 改写 name，便于日志与 instanceof 之外的类型识别
    this.code = code; // 保存业务错误码
    this.status = status; // 保存 HTTP 状态
    this.details = details; // 保存细节载荷
    this.requestId = requestId; // 保存请求追踪 id
  } // 构造函数结束
} // ApiError 类结束

function readSession(): Session | null { // 从 localStorage 恢复会话，供模块加载时初始化内存态
  try { // 隐私模式或数据损坏时 localStorage 可能抛错，必须兜住
    const raw = localStorage.getItem(SESSION_KEY); // 读取持久化的 JSON 字符串
    return raw ? (JSON.parse(raw) as Session) : null; // 有值才解析；断言因信任自身写入格式
  } catch { // 解析失败视为无会话，避免整页崩溃
    return null; // 返回 null 让调用方走未登录分支
  } // try/catch 结束
} // readSession 结束

let current: Session | null = readSession(); // 内存中的当前会话，避免每次请求都读 localStorage
let refreshing: Promise<boolean> | null = null; // 单飞锁：并发 401 只触发一次 refresh 请求

export function getSession(): Session | null { // 只读访问当前会话
  return current; // 直接返回内存引用，调用方不应修改
} // getSession 结束

export function setSession(session: Session): void { // 登录或刷新成功后写回会话
  current = session; // 先更新内存，保证后续请求立刻生效
  localStorage.setItem(SESSION_KEY, JSON.stringify(session)); // 再落盘，保证刷新页面后仍保持登录
} // setSession 结束

export function clearSession(): void { // 登出或刷新失败时清空会话
  current = null; // 清内存
  localStorage.removeItem(SESSION_KEY); // 清持久化，防止下次启动复活旧令牌
} // clearSession 结束

export function currentLocale(): Locale { // 派生当前界面语言
  return normalizeLocale(current?.user.locale); // 未登录时传 undefined，由 i18n 包回退默认语言
} // currentLocale 结束

function newKey(): string { // 生成幂等键，服务端据此去重重复提交
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') { // 优先用原生 UUID，熵高且几乎无碰撞
    return crypto.randomUUID(); // 返回标准 v4 UUID
  } // 原生能力判断结束
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`; // 降级：时间戳 + 随机十六进制，兼容老浏览器
} // newKey 结束

/** 保留调用方传入的幂等键，避免重试时生成新键 */
interface RequestOptions { // 内部请求参数：集中描述方法、请求体、鉴权与幂等策略
  method?: string; // HTTP 方法，缺省 GET
  body?: unknown; // 请求体；存在时才设置 Content-Type 并序列化
  auth?: boolean; // 是否需要 Bearer 头；公开接口显式传 false
  idempotency?: string | false; // 自定义幂等键，或 false 表示不发送该头
} // RequestOptions 结束

async function refreshSession(): Promise<boolean> { // 用 refresh_token 换新 access_token
  const session = current; // 先取快照，避免 await 期间 current 被清空导致读到 null
  if (!session) return false; // 无会话无从刷新，直接失败
  if (!refreshing) { // 没有进行中的刷新才发起，保证并发安全
    refreshing = (async () => { // 立即执行并保存 Promise，其它调用方复用同一结果
      try { // 网络异常不应冒泡成未处理的拒绝
        const res = await fetch(`${BASE}/auth/refresh`, { // 刷新接口不携带 Authorization（凭据是 refresh_token）
          method: 'POST', // 生成新令牌属写操作，用 POST
          headers: { 'Content-Type': 'application/json' }, // 明确告知服务端请求体是 JSON
          body: JSON.stringify({ refresh_token: session.refresh_token }), // 只提交 refresh_token，避免多余暴露
        }); // fetch 调用结束
        if (!res.ok) return false; // 刷新失败（如令牌过期）交由调用方清理会话
        const data = (await res.json()) as LoginResult; // 解析新会话，字段由服务端保证完整
        setSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user }); // 覆盖写回：refresh_token 已轮换，必须同步更新
        return true; // 刷新成功
      } catch { // 网络中断或 JSON 解析失败
        return false; // 统一按失败处理
      } finally { // 无论成功失败都要释放单飞锁
        refreshing = null; // 允许下一次 401 重新发起刷新
      } // try/catch/finally 结束
    })(); // IIFE 结束
  } // if 结束
  return refreshing; // 复用进行中的请求，等待同一结果
} // refreshSession 结束

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> { // 所有接口的唯一出口：统一鉴权、幂等、错误信封与 401 重试
  const method = opts.method ?? 'GET'; // 未指定方法时按 GET 处理（多数为读操作）
  const headers: Record<string, string> = {}; // 逐项累积请求头，避免出现 undefined 值
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'; // 只有带体时才声明 JSON，无体请求不带
  if (opts.auth !== false && current) headers.Authorization = `Bearer ${current.access_token}`; // 默认带鉴权；无会话时跳过，避免发出 Bearer undefined

  let key: string | undefined; // 记录本次使用的幂等键，重试时必须原样复用
  if (method !== 'GET' && opts.idempotency !== false) { // 写操作必须幂等；GET 天然幂等无需键
    key = typeof opts.idempotency === 'string' ? opts.idempotency : newKey(); // 调用方给了字符串就复用，否则新生成
    headers['Idempotency-Key'] = key; // 服务端据此拦截重复提交
  } // 幂等键处理结束

  const res = await fetch(`${BASE}${path}`, { // 拼接前缀与相对路径发出请求
    method, // 使用上面解析出的方法
    headers, // 带上累积好的请求头
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body), // 无体传 undefined，避免发送字符串 "undefined"
  }); // fetch 调用结束

  if (res.status === 401 && opts.auth !== false && current && !retried) { // 令牌过期且未重试过：尝试静默续期而非直接踢用户
    if (await refreshSession()) { // 续期成功
      return request<T>(path, { ...opts, idempotency: key ?? false }, true); // 透传原幂等键重放一次，标记 retried 防止无限递归
    } // 续期成功分支结束
    clearSession(); // 续期失败说明登录态彻底失效，清理本地会话
  } // 401 处理结束

  const text = await res.text(); // 先读文本再决定解析方式，兼容空响应与非 JSON 响应
  let data: unknown = null; // 缺省按 null 处理，如 204 无内容
  if (text) { // 有内容才尝试解析
    try { // 非 JSON（如网关 HTML 错误页）不应抛错中断流程
      data = JSON.parse(text); // 正常路径：解析后端 JSON
    } catch { // 解析失败时保留原始文本
      data = text; // 便于错误提示里显示原始内容
    } // try/catch 结束
  } // if 结束

  if (!res.ok) { // 非 2xx 统一抛 ApiError，调用方只需在一处 catch
    const envelope = (data ?? {}) as { // 后端错误信封形状；data 为 null 时用空对象兜底
      code?: string; // 业务错误码
      message?: string; // 人类可读信息（已是当前语言）
      request_id?: string; // 服务端追踪 id
      details?: unknown; // 结构化细节
    }; // 信封类型断言结束
    throw new ApiError( // 构造统一错误对象抛出
      envelope.code ?? 'INTERNAL_ERROR', // 缺码时退回内部错误，避免 undefined 传到 UI
      envelope.message ?? res.statusText, // 无 message 时用 HTTP 状态文本兜底
      res.status, // 保留状态码供上层分支判断
      envelope.details, // 细节原样透传
      envelope.request_id, // 追踪 id 原样透传
    ); // throw 结束
  } // if 结束

  return data as T; // 2xx 时把解析结果按调用方声明的类型返回
} // request 结束

export function errorText(locale: Locale, error: unknown): string { // 把任意异常转成可直接展示的本地化文案
  if (error instanceof ApiError) { // 接口错误优先走错误码翻译表
    const translated = errorMessage(locale, error.code as ErrorCode); // 用业务 code 查当前语言文案
    return translated || error.message; // 查不到译文时回退服务端原文
  } // instanceof 分支结束
  return error instanceof Error ? error.message : String(error); // 普通异常取 message，其余值强制转字符串
} // errorText 结束

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

// ---------- 站点模块地图（site）类型，对齐 routes/site.ts 与 src/site.ts ----------

// zone 维度概览：当前仅 mixm.top
export interface SiteZone { // 按 zone（根域名）聚合的统计
  // zone 标识，如 mixm.top
  id: string; // zone 唯一标识
  // zone 根域名（与 id 同值）
  apex: string; // 根域名，与 id 保持同值便于直接展示
  // 该 zone 下存在解析记录的模块数量
  count: number; // 已配置记录的模块计数
} // SiteZone 结束

// 分类维度概览：8 个站点分类
export interface SiteCategory { // 按业务分类聚合的统计
  // 分类标识，如 tools
  id: string; // 分类唯一标识
  // 分类双语名称
  name: { zh: string; en: string }; // 双语名称，前端按当前语言取用
  // 该分类下的模块数量
  count: number; // 该分类模块计数
} // SiteCategory 结束

// GET /site/overview 的响应结构
export interface SiteOverview { // 站点地图总览
  // 模块总数（45）
  total: number; // 模块总数
  // zone 概览（当前仅 mixm.top）
  zones: SiteZone[]; // 各 zone 的统计
  // 8 个分类的概览
  categories: SiteCategory[]; // 各分类的统计
} // SiteOverview 结束

// 单条 DNS 解析记录（一个模块在某个 zone 下的记录）
export interface SiteRecord { // 一条解析记录
  // 记录所属 zone
  zone: string; // 所属 zone 标识
  // 完整域名，如 api.mixm.top / mixm.top
  fqdn: string; // 完整域名
  // 记录类型：A 或 CNAME
  record_type: 'A' | 'CNAME'; // 记录类型
  // 生存时间（秒）
  ttl: number; // TTL（秒）
  // record 级备注第一段（仅差异记录存在）
  label?: string; // 备注第一段；仅与默认值有差异的记录才有
  // record 级备注第二段（仅差异记录存在）
  description?: string; // 备注第二段；仅差异记录才有
} // SiteRecord 结束

// 节点可运行模块规格：对齐 services/mim-api/src/site-nodes.ts
export interface SiteNodeSpec { // 站点地图每个节点的路由 / 导航 / 职责 / 关联
  host: string; // 原始主机名（根域名为 '@'）
  key: string; // 路由键（'@' 映射为 'root'）
  route: string; // 站内 hash 路由，如 #/site/www
  kind: string; // 职责类型：portal / identity / console / gateway / content / commerce / data / tools
  nav: { zh: string; en: string }; // 双语导航名
  duty: { zh: string; en: string }; // 双语模块职责
  links: string[]; // 关联节点 host 列表
} // SiteNodeSpec 结束

// 站点目录响应：一次返回 45 个节点 + 8 分类 + 能力清单
export interface SiteNodeList { // GET /site/nodes 的响应结构
  total: number; // 节点总数（45）
  categories: SiteCategory[]; // 8 个分类（含双语名与节点数）
  capabilities: Record<string, { zh: string; en: string }[]>; // 按职责类型的能力清单
  items: SiteModuleItem[]; // 45 个节点完整信息（含 fqdn / records / node）
} // SiteNodeList 结束

// 单个站点模块（主机 + zone 记录聚合）
export interface SiteModuleItem { // 一个站点模块（主机名维度）
  // 主机名（不含 zone），根域名为 '@'
  host: string; // 主机名，根域名用 @
  // 所属分类 id
  category: string; // 分类 id
  // 分类双语名称
  category_name: { zh: string; en: string }; // 分类双语名称，避免前端再查表
  // 备注第一段：模块定位
  label: string; // 模块定位说明
  // 备注第二段：站点说明
  description: string; // 站点功能说明
  // https 入口地址，与 records 一一对应
  urls: string[]; // 各 zone 对应的 https 入口，与 records 顺序一致
  // 主域名（单 zone 下即唯一记录的 fqdn），供目录与节点页展示域名映射
  fqdn: string; // 完整域名，如 api.mixm.top / mixm.top
  // 该模块的解析记录明细
  records: SiteRecord[]; // 该模块的解析记录明细
  // 可运行模块规格（路由 / 导航 / 职责 / 关联节点）
  node: SiteNodeSpec; // 与后端 45 条规格一一对应
} // SiteModuleItem 结束

// GET /site/modules 的响应结构
export interface SiteModuleList { // 模块列表响应（带分页/过滤回显）
  // 当前过滤条件下的命中数量
  total: number; // 命中数量
  // 全量模块数量（45）
  module_total: number; // 全量模块数，用于展示「x / 45」
  // 回显生效的过滤条件
  filters: { zone: string | null; category: string | null; q: string | null }; // 服务端回显实际生效的过滤条件
  // 模块列表本体
  items: SiteModuleItem[]; // 模块列表
} // SiteModuleList 结束

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
  updated_at: string; // 最后更新时间
} // ImConversation 结束

/** 搜索到的用户项 */
export interface ImUser {
  id: string; // 用户 ID
  display_name: string; // 显示名
  region: string; // 区域
} // ImUser 结束

export const api = { // 接口集合：按业务域分组，调用方按 api.xxx.yyy 使用
  requestCode(region: Region, provider: Provider, identifier: string) { // 请求发送验证码（开发环境直接回传 dev_code）
    return request<{ // 发码响应结构
      delivery: 'dev'; // 投递方式：当前仅开发态直返验证码
      dev_code: string; // 明文验证码，仅开发环境存在
      identifier: string; // 回显被发送的账号，便于前端校验输入
      provider: Provider; // 回显凭证类型
      expires_in: number; // 验证码有效期（秒）
      note: string; // 提示文案，说明当前为开发模式
    }>('/auth/code', { method: 'POST', body: { region, provider, identifier }, auth: false, idempotency: false }); // 公开接口免鉴权；重复发码无副作用，禁用幂等键
  }, // requestCode 结束

  loginWithPassword(payload: { // 密码登录：手机号/邮箱 + 密码
    region: Region; // 区域
    provider?: Provider; // 凭证类型；省略时由服务端按 identifier 形态推断
    identifier: string; // 手机号或邮箱
    password: string; // 明文密码，经 HTTPS 传输，前端不做哈希
    device?: { platform: string; name?: string }; // 设备信息，未传时下面兜底为 web/浏览器
  }) { // 形参定义结束
    return request<LoginResult>('/auth/password', { // 走统一请求层拿会话
      method: 'POST', // 登录属写操作
      body: { ...payload, device: payload.device ?? { platform: 'web', name: '浏览器' } }, // 展开原参数并补默认设备标识，便于服务端区分登录来源
      auth: false, // 登录时还没有令牌
      idempotency: false, // 登录无需幂等键：重复提交由密码校验兜底
    }); // 请求调用结束
  }, // loginWithPassword 结束

  login(payload: { // 验证码登录
    region: Region; // 区域
    provider: Provider; // 凭证类型
    identifier: string; // 手机号或邮箱
    code: string; // 收到的验证码
    device?: { platform: string; name?: string }; // 设备信息，未传时兜底 web/浏览器
  }) { // 形参定义结束
    return request<LoginResult>('/auth/login', { // 换取会话
      method: 'POST', // 登录属写操作
      body: { ...payload, device: payload.device ?? { platform: 'web', name: '浏览器' } }, // 同样补默认设备信息
      auth: false, // 尚未登录，不能带 Bearer
      idempotency: false, // 验证码一次性使用，幂等键无意义
    }); // 请求调用结束
  }, // login 结束

  logout() { // 登出：让服务端吊销 refresh_token
    return request<{ ok: true }>('/auth/logout', { // 只需成功标记，不做复杂返回
      method: 'POST', // 吊销属写操作
      body: { refresh_token: current?.refresh_token ?? '' }, // 上交待吊销的令牌；无会话时传空串由服务端忽略
      idempotency: false, // 重复登出应视为成功，不需要幂等键
    }); // 请求调用结束
  }, // logout 结束

  me() { // 拉取当前用户资料
    return request<MeResponse>('/me'); // 默认带鉴权；失败会走统一错误处理
  }, // me 结束

  updateMe(payload: { display_name?: string; locale?: Locale; timezone?: string }) { // 局部更新资料，仅提交要改的字段
    return request<{ user: UserInfo }>('/me', { method: 'PATCH', body: payload }); // PATCH 语义为局部更新，写操作自动带幂等键
  }, // updateMe 结束

  requestDeletion() { // 申请注销账号（进入冷静期）
    return request<{ status: string; deletion_scheduled_at: string | null }>('/me/deletion', { // 返回最新状态与生效时间
      method: 'POST', // 写操作
      body: {}, // 服务端要求显式空体，保证 Content-Type 与幂等键生效
    }); // 请求调用结束
  }, // requestDeletion 结束

  cancelDeletion() { // 撤销注销申请
    return request<{ status: string }>('/me/cancel-deletion', { method: 'POST', body: {} }); // 同样显式空体，返回恢复后的状态
  }, // cancelDeletion 结束

  // ---------- 功能模块商城（catalog）----------

  catalog: { // 模块商城：模块列表、详情、解锁、我的权益
    getModules() { // 拉取全部可购买模块
      return request<{ // 响应为模块数组包装
        modules: Array<{ // 模块条目列表
          code: string; // 模块唯一编码，下单与解锁都用它
          name: Record<string, string>; // 多语言名称，键为语言码
          summary: Record<string, string>; // 多语言简介
          unlock_mode: 'one_time'; // 解锁方式：当前仅一次性买断
          region: Region; // 所属区域
          status: string; // 上架状态
          requires: string[]; // 前置依赖模块编码，前端据此提示
          current_price: { currency: string; amount_minor: number } | null; // 当前价格；未定价为 null
        }>; // 模块条目类型结束
      }>('/modules', { auth: false, idempotency: false }); // 公开目录接口，免鉴权、只读无需幂等键
    }, // getModules 结束
    getModule(code: string) { // 拉取单个模块详情
      return request<{ // 详情比列表多价格历史
        code: string; // 模块编码
        name: Record<string, string>; // 多语言名称
        summary: Record<string, string>; // 多语言简介
        unlock_mode: 'one_time'; // 解锁方式
        region: Region; // 所属区域
        status: string; // 上架状态
        requires: string[]; // 前置依赖
        current_price: { currency: string; amount_minor: number } | null; // 当前价格，未定价为 null
        price_history: Array<{ // 价格变更历史，供详情页展示走势
          currency: string; // 币种
          amount_minor: number; // 金额（最小货币单位）
          effective_from: string; // 生效开始时间
          effective_to: string | null; // 生效结束时间；null 表示仍在生效
        }>; // 价格历史类型结束
      }>(`/modules/${encodeURIComponent(code)}`, { auth: false, idempotency: false }); // 编码路径参数防注入；公开只读接口
    }, // getModule 结束
    unlockModule(module_code: string) { // 解锁（购买）模块，生成权益
      return request<{ // 返回新建/更新的权益
        entitlement: { // 权益对象
          id: string; // 权益主键
          module_code: string; // 对应模块编码
          module_name: Record<string, string>; // 模块多语言名，便于直接展示
          status: string; // 权益状态（active/expired 等）
          expires_at: string | null; // 到期时间；永久有效为 null
          version: number; // 版本号，供并发控制
          created_at: string; // 创建时间
        }; // 权益对象结束
      }>('/entitlements', { method: 'POST', body: { module_code } }); // 写操作：下单并解锁，自动带幂等键防重复扣费
    }, // unlockModule 结束
    getMyEntitlements() { // 拉取我拥有的权益
      return request<{ // 响应为权益数组包装
        entitlements: Array<{ // 权益列表
          id: string; // 权益主键
          module_code: string; // 模块编码
          module_name: Record<string, string>; // 模块多语言名
          status: string; // 权益状态
          expires_at: string | null; // 到期时间
          created_at: string; // 创建时间
        }>; // 权益数组类型结束
      }>('/me/entitlements', { idempotency: false }); // 只读 GET，无需幂等键
    }, // getMyEntitlements 结束
  }, // catalog 分组结束

  // ---------- 漫剧 AI 剧（comic，契约对齐 services/mim-api/src/routes/comic.ts）----------

  comic: { // 漫剧业务：项目、角色、分镜、任务、成片
    listProjects() { // 列出我的项目
      return request<{ items: ComicProject[] }>('/comic/projects', { idempotency: false }); // 只读 GET，默认带鉴权
    }, // listProjects 结束
    createProject(payload: { title: string; synopsis?: string }) { // 新建项目，仅需标题与可选梗概
      return request<{ project: ComicProject }>('/comic/projects', { method: 'POST', body: payload }); // 写操作自动生成幂等键，防止重复建项目
    }, // createProject 结束
    getProject(id: string) { // 项目详情：项目 + 角色 + 最新分镜一次取回
      return request<{ // 详情响应结构
        project: ComicProject; // 项目本体
        characters: ComicCharacter[]; // 角色列表
        latest_storyboard: Storyboard | null; // 最新分镜稿，未创建为 null
      }>(`/comic/projects/${encodeURIComponent(id)}`, { idempotency: false }); // 路径参数编码；只读无需幂等键
    }, // getProject 结束
    deleteProject(id: string) { // 删除项目
      return request<{ ok: true; project_id: string }>(`/comic/projects/${encodeURIComponent(id)}`, { // 返回删除标记与被删 id
        method: 'DELETE', // 删除语义
        body: {}, // 显式空体，确保 Content-Type 与幂等键被正确附加
      }); // 请求调用结束
    }, // deleteProject 结束
    saveStoryboard(id: string, payload: { shots: StoryboardShot[]; confirm?: boolean }) { // 保存/确认分镜
      return request<{ storyboard: Storyboard; project_status: string }>( // 返回新分镜稿与项目新状态
        `/comic/projects/${encodeURIComponent(id)}/storyboard`, // 项目下的分镜子资源
        { method: 'POST', body: payload }, // 写操作：整稿覆盖提交，confirm 决定是否推进项目状态
      ); // 请求调用结束
    }, // saveStoryboard 结束
    addCharacter( // 新增角色
      id: string, // 项目 id
      payload: { name: string; appearance_prompt: string; seed?: number; voice_profile?: string }, // 角色必填外观提示；种子与音色可选
    ) { // 形参定义结束
      return request<{ character: ComicCharacter; created: boolean }>( // created 区分新建与复用同名角色
        `/comic/projects/${encodeURIComponent(id)}/characters`, // 项目下的角色集合
        { method: 'POST', body: payload }, // 写操作
      ); // 请求调用结束
    }, // addCharacter 结束
    suggest(id: string, kind: SuggestKind, prompt?: string) { // 请求 AI 生成建议
      return request<{ suggestion: Suggestion }>( // 返回建议包装
        `/comic/projects/${encodeURIComponent(id)}/suggest`, // 建议接口挂在项目下，便于带上项目上下文
        { method: 'POST', body: { kind, prompt: prompt?.trim() || undefined, count: 3 } }, // 提示词去空白，空串转 undefined 避免传空字段；固定取 3 条候选
      ); // 请求调用结束
    }, // suggest 结束
    listJobs(projectId: string) { // 列出项目下的生成任务
      return request<{ items: GenerationJob[] }>( // 任务数组包装
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`, // 项目下的任务集合
        { idempotency: false }, // 只读 GET
      ); // 请求调用结束
    }, // listJobs 结束
    createJob( // 创建生成任务（入队）
      projectId: string, // 项目 id
      payload: { // 任务参数
        job_type: JobType; // 任务类型
        storyboard_id?: string; // 关联分镜稿
        payload?: Record<string, unknown>; // 任务自定义入参
        cost_estimate_minor?: number; // 预估费用，服务端可据此做额度校验
      }, // 任务参数结束
    ) { // 形参定义结束
      return request<{ job: GenerationJob; project_status: string }>( // 返回新任务与项目新状态
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`, // 项目下的任务集合
        { method: 'POST', body: payload }, // 写操作：自动带幂等键防止重复扣费
      ); // 请求调用结束
    }, // createJob 结束
    getJob(id: string) { // 查询单个任务
      return request<{ job: GenerationJob }>(`/comic/jobs/${encodeURIComponent(id)}`, { // 任务详情
        idempotency: false, // 只读 GET
      }); // 请求调用结束
    }, // getJob 结束
    jobAction( // 推进任务状态
      id: string, // 任务 id
      action: 'start' | 'complete' | 'fail' | 'cancel' | 'retry', // 状态机动作
      body?: Record<string, unknown>, // 动作附加参数（如失败原因）
    ) { // 形参定义结束
      return request<{ job: GenerationJob }>(`/comic/jobs/${encodeURIComponent(id)}/${action}`, { // 动作作为路径段，符合 REST 风格
        method: 'POST', // 状态迁移属写操作
        body: body ?? {}, // 无附加参数时传空对象，保证头部与幂等键生效
      }); // 请求调用结束
    }, // jobAction 结束
    listFilms(projectId: string) { // 列出项目成片
      return request<{ items: Film[] }>(`/comic/projects/${encodeURIComponent(projectId)}/films`, { // 项目下的成片集合
        idempotency: false, // 只读 GET
      }); // 请求调用结束
    }, // listFilms 结束
    createFilm( // 新建成片（可同时登记首版产物）
      projectId: string, // 项目 id
      payload: { title: string; object_key?: string; duration_sec?: number; size_bytes?: number }, // 标题必填，产物元信息可选
    ) { // 形参定义结束
      return request<{ film: Film; version: FilmVersion }>( // 返回成片与生成的版本
        `/comic/projects/${encodeURIComponent(projectId)}/films`, // 项目下的成片集合
        { method: 'POST', body: payload }, // 写操作
      ); // 请求调用结束
    }, // createFilm 结束
    getFilm(id: string) { // 成片详情：含全部版本
      return request<{ film: Film; versions: FilmVersion[] }>( // 成片与版本列表
        `/comic/films/${encodeURIComponent(id)}`, // 成片资源
        { idempotency: false }, // 只读 GET
      ); // 请求调用结束
    }, // getFilm 结束
    publishFilm(id: string, action: 'submit-review' | 'publish' | 'archive') { // 发布流程动作
      return request<{ film: Film }>(`/comic/films/${encodeURIComponent(id)}/${action}`, { // 动作作为路径段
        method: 'POST', // 状态迁移属写操作
        body: {}, // 显式空体，保证头部与幂等键生效
      }); // 请求调用结束
    }, // publishFilm 结束
    rejectFilm(id: string, reason: string) { // 驳回成片并给出原因
      return request<{ film: Film }>(`/comic/films/${encodeURIComponent(id)}/reject`, { // 驳回子资源
        method: 'POST', // 写操作
        body: { reason }, // 原因必传，供作者修改
      }); // 请求调用结束
    }, // rejectFilm 结束
  }, // comic 分组结束

  // ---------- 对象存储（media）：object_key 一律由服务端生成，客户端不拼接 ----------

  media: { // 对象存储相关接口
    /** POST /media/presign/upload → 201；服务端校验 asset_type/mime 并生成 object_key */
    presignUpload(input: { // 申请上传预签名地址
      asset_type: AssetType; // 产物类型，服务端据此校验 mime 合法性
      mime: string; // 文件 MIME，需与产物类型匹配
      project_id?: string; // 归属项目，可为空
      size_bytes?: number; // 文件大小，服务端用于额度与上限校验
      expires_seconds?: number; // 期望签名有效期
    }) { // 形参定义结束
      return request<{ // 上传凭证响应
        upload: PresignedUrl; // 直传地址与必需请求头
        object_key: string; // 服务端生成的对象键，后续接口都用它引用
        asset_type: AssetType; // 回显产物类型
        expires_at: string; // 签名过期时间
      }>('/media/presign/upload', { method: 'POST', body: input }); // 写操作：由服务端签发凭证，客户端无法自行构造
    }, // presignUpload 结束
    /** GET /media/presign/download?object_key=…（服务端为 GET，非 POST） */
    presignDownload(objectKey: string, expiresSeconds?: number) { // 申请下载预签名地址
      const qs = new URLSearchParams({ object_key: objectKey }); // 用 URLSearchParams 自动编码对象键（含斜杠等特殊字符）
      if (expiresSeconds !== undefined) qs.set('expires_seconds', String(expiresSeconds)); // 仅在显式传入时附加，避免覆盖服务端默认有效期
      return request<{ download: PresignedUrl; object_key: string; expires_at: string }>( // 下载凭证响应
        `/media/presign/download?${qs.toString()}`, // 查询串拼接在路径上，参数已被安全编码
      ); // 请求调用结束
    }, // presignDownload 结束
    /** GET /media/assets?project_id=… → { items }，每项已附 download_url */
    listAssets(projectId: string, opts: { asset_type?: AssetType; limit?: number } = {}) { // 列出项目产物，可选类型与条数过滤
      const qs = new URLSearchParams({ project_id: projectId }); // project_id 为必填过滤条件
      if (opts.asset_type) qs.set('asset_type', opts.asset_type); // 有类型才附加，保持查询串精简
      if (opts.limit !== undefined) qs.set('limit', String(opts.limit)); // 分页条数需转字符串，0 也要保留
      return request<{ items: ListedAsset[] }>(`/media/assets?${qs.toString()}`); // 返回带 download_url 的产物列表
    }, // listAssets 结束
  }, // media 分组结束

  // ---------- AI 编排控制面（ai-orchestrator） ----------

  ai: { // AI 控制面：能力查询与任务触发
    /** GET /ai/capabilities：provider 能力、成本限额、存储与 worker 状态 */
    capabilities() { // 查询当前 AI 能力
      return request<{ ai: AiCapabilities; storage: { driver: string; configured: boolean } | null }>( // storage 独立返回，未配置时为 null
        '/ai/capabilities', // 能力自述接口
      ); // 请求调用结束
    }, // capabilities 结束
    /** POST /ai/jobs/:id/run：同步触发 queued 任务执行（幂等；非 queued 返回 409） */
    runJob(jobId: string) { // 手动触发任务执行（worker 关闭时使用）
      return request<{ run: RunJobResult; job: GenerationJob }>( // 同时返回执行结果与最新任务状态
        `/ai/jobs/${encodeURIComponent(jobId)}/run`, // 任务 id 编码后作为路径段
        { method: 'POST', body: {} }, // 写操作；空体保证头部与幂等键生效，重复触发由服务端 409 拦截
      ); // 请求调用结束
    }, // runJob 结束
  }, // ai 分组结束

  // ---------- 站点模块地图（site）：DNSPod 备注结构化，公开只读 ----------

  site: { // 站点地图：公开只读接口
    /** GET /site/overview：zone / 分类 / 模块计数 */
    overview() { // 取总览统计
      return request<SiteOverview>('/site/overview', { auth: false, idempotency: false }); // 公开只读：免鉴权、无需幂等键
    }, // overview 结束
    /** GET /site/modules?zone=&category=&q=：模块列表（可组合过滤） */
    listModules(opts: { zone?: string; category?: string; q?: string } = {}) { // 过滤条件全部可选，缺省拉全量
      // 用 URLSearchParams 安全拼接查询串，自动做 encode
      const qs = new URLSearchParams(); // 空构造，逐个条件按需写入
      // zone 过滤：存在才写入，避免空参数
      if (opts.zone) qs.set('zone', opts.zone); // 空串视为未过滤
      // category 过滤：存在才写入
      if (opts.category) qs.set('category', opts.category); // 空串视为未过滤
      // 关键词过滤：存在才写入
      if (opts.q) qs.set('q', opts.q); // 空串视为未过滤
      // 生成查询串；无参数时为空串
      const suffix = qs.toString(); // 无条件时返回空串，便于下面分支拼接
      // 有查询串则拼 ?，无则直接请求列表路径
      return request<SiteModuleList>(`/site/modules${suffix ? `?${suffix}` : ''}`, { // 避免出现孤立的 ? 导致缓存键分裂
        // 公开只读接口，不带鉴权头
        auth: false, // 未登录用户也能浏览站点地图
        // 只读 GET，无需幂等键
        idempotency: false, // 读操作天然幂等
      }); // 请求调用结束
    }, // listModules 结束
    /** GET /site/nodes：站点目录，一次取全量 45 个可运行节点规格 */
    listNodes() { // 供目录页与节点页共享一份缓存数据
      return request<SiteNodeList>('/site/nodes', { // 公开只读：免鉴权、无需幂等键
        auth: false, // 未登录也能浏览站点目录
        idempotency: false, // 读操作天然幂等
      }); // 请求调用结束
    }, // listNodes 结束
    /** GET /site/modules/:host：单模块详情 */
    getModule(host: string) { // 取单模块详情
      return request<{ module: SiteModuleItem }>(`/site/modules/${encodeURIComponent(host)}`, { // host 可能含 @ 等字符，需编码
        auth: false, // 公开只读
        idempotency: false, // 读操作无需幂等键
      }); // 请求调用结束
    }, // getModule 结束
  }, // site 分组结束
  im: { // IM 即时通讯：会话 / 消息 / 用户搜索（需登录）
    /** GET /im/conversations：当前用户的会话列表 */
    listConversations() { // 拉取会话列表，含最后消息与未读数
      return request<{ items: ImConversation[] }>('/im/conversations', { auth: true, idempotency: false }); // 需鉴权，只读无需幂等键
    }, // listConversations 结束
    /** POST /im/conversations：创建会话（direct 或 group） */
    createConversation(body: { type: ImConversationType; target_user_id?: string; name?: string; member_user_ids?: string[] }) {
      return request<{ conversation_id: string; conversation: ImConversation }>('/im/conversations', { method: 'POST', body, auth: true }); // 写操作由 request 自动生成幂等键
    }, // createConversation 结束
    /** GET /im/conversations/:id/messages：分页拉取历史消息 */
    listMessages(conversationId: string, opts: { before?: string; limit?: number } = {}) {
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.before) qs.set('before', opts.before); // 游标：取比该 ID 更早的消息
      if (opts.limit) qs.set('limit', String(opts.limit)); // 条数限制
      const suffix = qs.toString(); // 无参数时空串
      return request<{ items: ImMessage[] }>(`/im/conversations/${encodeURIComponent(conversationId)}/messages${suffix ? `?${suffix}` : ''}`, { auth: true, idempotency: false });
    }, // listMessages 结束
    /** POST /im/conversations/:id/messages：HTTP 方式发消息（兜底；实时通道走 WebSocket） */
    sendMessage(conversationId: string, body: { content_type: ImMessageContentType; content?: string; object_key?: string; object_mime?: string; object_name?: string; object_size?: number }) {
      return request<{ message: ImMessage }>(`/im/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body, auth: true }); // 写操作由 request 自动生成幂等键
    }, // sendMessage 结束
    /** POST /im/conversations/:id/read：标记已读到指定消息 */
    markRead(conversationId: string, messageId: string) {
      return request<{ ok: boolean }>(`/im/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', body: { message_id: messageId }, auth: true, idempotency: false });
    }, // markRead 结束
    /** GET /im/users?q=：搜索用户（创建会话时选人） */
    searchUsers(q: string, limit = 20) {
      const suffix = new URLSearchParams({ q, limit: String(limit) }).toString(); // 拼接查询串
      return request<{ items: ImUser[] }>(`/im/users?${suffix}`, { auth: true, idempotency: false });
    }, // searchUsers 结束
  }, // im 分组结束
}; // api 对象结束
