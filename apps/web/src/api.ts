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

/** 归一化服务端下发的预签名地址：绝对地址原样用，同源相对路径在跨源托管构建下补上 API 源 */
export function resolvePublicUrl(url: string): string { // 避免 GitHub Pages / Cloudflare 等跨源站点把 /api/v1/... 打到自己域名
  if (!url) return url; // 空串原样返回，调用方按无链接处理
  if (/^https?:\/\//i.test(url)) return url; // 已是绝对地址（S3 或配置了 MIM_PUBLIC_BASE_URL）无需加工
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`; // 相对路径补 API 源；同源构建时 API_ORIGIN 为空即保持原样
  return `${BASE}/${url}`; // 非斜杠开头的裸路径按 API 前缀兜底，保证总有一个可达地址
} // resolvePublicUrl 结束

export const SESSION_KEY = 'mim.session.v1'; // 键名带版本号，便于结构升级时隔离旧数据；静态门禁脚本共用此键
// 会话变更事件名：登录 / 退出 / 令牌失效 / 跨标签页同步统一广播，App 据此锁定或解锁界面
export const SESSION_CHANGED_EVENT = 'mim:session-changed'; // 单一事件源，避免多处状态各自判断
// 会话变更原因：App 只对 expired 显示「登录状态已失效」提示
export type SessionChangeReason = 'login' | 'refresh' | 'logout' | 'expired' | 'sync'; // 五类来源，覆盖全部入口

// 校验会话结构：脏 localStorage 不能被视为已登录，避免门禁被伪造的空对象绕过
export function isValidSession(value: unknown): value is Session { // 类型守卫，调用后可安全当作 Session 使用
  // 非对象（null / 字符串 / 数组）一律不合法
  if (!value || typeof value !== 'object') return false; // 先挡住最常见的脏数据
  // 收窄为可选字段视图，逐项检查而不信任任何断言
  const s = value as Partial<Session>; // 仅用于读取字段，不做完整类型假设
  // 用户对象必须存在且带非空主键
  const user = s.user as Partial<UserInfo> | undefined; // 用户资料可能被手工删掉
  // 两个令牌与用户主键同时有效才算登录态，与静态门禁脚本保持同一口径
  return typeof s.access_token === 'string' && s.access_token.length > 0 // 访问令牌必须非空
    && typeof s.refresh_token === 'string' && s.refresh_token.length > 0 // 刷新令牌必须非空
    && !!user && typeof user.id === 'string' && user.id.length > 0; // 用户主键必须非空
} // isValidSession 结束

// 派发会话变更事件：同步广播，保证调用方返回前界面状态已更新
function emitSessionChange(session: Session | null, reason: SessionChangeReason): void { // detail 同时携带会话与原因
  // 构建期 / 测试环境没有 window，直接跳过
  if (typeof window === 'undefined') return; // 非浏览器环境无需广播
  try { // 个别宿主环境缺少 CustomEvent 时不能阻断登录主流程
    // detail 用扁平结构，App 侧读取成本低
    window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT, { detail: { session, reason } })); // 同步派发
  } catch { // 事件构造失败属于环境能力缺失
    /* 广播失败不影响会话读写本身，App 仍可通过 storage 与主动调用同步 */
  } // try/catch 结束
} // emitSessionChange 结束

// 解析并校验持久化的会话字符串：读失败 / 解析失败 / 结构不全都按未登录处理
function parseSession(raw: string | null): Session | null { // 返回 null 即锁定
  // 空值表示已退出或从未登录
  if (!raw) return null; // 无需解析
  try { // JSON.parse 对损坏数据会抛错
    // 先按 unknown 解析，再由类型守卫收窄，避免直接断言
    const parsed: unknown = JSON.parse(raw); // 只接受合法 JSON
    // 结构完整才返回会话对象
    return isValidSession(parsed) ? parsed : null; // 不完整即视为脏数据
  } catch { // 解析异常
    return null; // 统一按未登录处理
  } // try/catch 结束
} // parseSession 结束

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
    // 读取并统一走结构校验，脏数据不会让门禁误判为已登录
    return parseSession(localStorage.getItem(SESSION_KEY)); // 有值才解析，失败返回 null
  } catch { // 读取失败视为无会话，避免整页崩溃
    return null; // 返回 null 让调用方走未登录分支
  } // try/catch 结束
} // readSession 结束

let current: Session | null = readSession(); // 内存中的当前会话，避免每次请求都读 localStorage
let refreshing: Promise<boolean> | null = null; // 单飞锁：并发 401 只触发一次 refresh 请求

export function getSession(): Session | null { // 只读访问当前会话
  return current; // 直接返回内存引用，调用方不应修改
} // getSession 结束

export function setSession(session: Session, reason: SessionChangeReason = 'login'): void { // 登录或刷新成功后写回会话
  current = session; // 先更新内存，保证后续请求立刻生效
  try { // 隐私模式下写盘可能抛错，不应阻断本次登录
    localStorage.setItem(SESSION_KEY, JSON.stringify(session)); // 再落盘，保证刷新页面后仍保持登录
  } catch { // 写盘失败时内存态仍然有效
    /* 本次会话保持可用，仅失去刷新后的持久登录 */
  } // try/catch 结束
  // 广播解锁：全站门禁据此从登录页切换到完整布局
  emitSessionChange(session, reason); // 刷新令牌轮换时由调用方传 refresh
} // setSession 结束

export function clearSession(reason: 'logout' | 'expired' = 'logout'): void { // 登出或令牌失效时清空会话
  current = null; // 清内存
  try { // 隐私模式下移除可能抛错
    localStorage.removeItem(SESSION_KEY); // 清持久化，防止下次启动复活旧令牌
  } catch { // 移除失败不影响内存态
    /* 内存已清空，界面仍会立即重新锁定 */
  } // try/catch 结束
  // 广播重新锁定：退出与失效走同一条路径，仅提示文案不同
  emitSessionChange(null, reason); // expired 会让登录页显示重登提示
} // clearSession 结束

// 跨标签页同步：其它标签页登录或退出后，本标签页内存会话与界面必须立刻跟随
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') { // 仅浏览器环境注册
  window.addEventListener('storage', (event: StorageEvent) => { // storage 事件只在其它标签页触发
    // 只关心会话键，忽略无关设置项
    if (event.key !== SESSION_KEY) return; // 其它键的交动不影响门禁
    // 按新值重建内存会话（不回写 localStorage，避免事件循环）
    current = parseSession(event.newValue); // 新值为 null 表示对方已退出
    // 广播同步结果，App 据此解锁或重新锁定
    emitSessionChange(current, 'sync'); // sync 原因保持默认锁定文案
  }); // storage 监听结束
} // 浏览器环境判断结束

export function currentLocale(): Locale { // 派生当前界面语言
  return normalizeLocale(current?.user.locale); // 未登录时传 undefined，由 i18n 包回退默认语言
} // currentLocale 结束

// 启动静默校验：刷新或直接打开内部页面时，用 requireAuth 的 /me 确认本地会话仍在有效期
export async function verifySession(): Promise<boolean> { // true 保持解锁，false 必须重新锁定
  // 本地无有效会话时无需发请求
  if (!current) return false; // 直接判定为锁定态
  try { // 网络异常不应被误判成「登录失效」
    // /me 受 requireAuth 保护：令牌过期先尝试 refresh，续期失败由 request 内部清理并广播
    await request<MeResponse>('/me', { idempotency: false }); // 只读 GET，无需幂等键
    // 成功即会话有效（可能已被静默续期换成新令牌）
    return Boolean(current); // 以最新内存态为准
  } catch (err) { // 统一错误对象
    // 401 且续期失败：request 已清理会话并广播，这里只做兜底确认
    if (err instanceof ApiError && err.status === 401) return false; // 明确失效
    // 断网 / 5xx / 网关异常等不确定状态：保持解锁，避免误伤正常在线用户
    return true; // 等下一次真实业务请求再判定
  } // try/catch 结束
} // verifySession 结束

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
        setSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user }, 'refresh'); // 覆盖写回：refresh_token 已轮换，必须同步更新
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
    clearSession('expired'); // 续期失败说明登录态彻底失效，清理会话并广播重新锁定
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

export interface EntryModule { // 统一入口配置清单中的一项
  id: string; // 两位序号
  entryKey: string; // 稳定入口标识（占位键），不是具体主机值
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
  verdict: string; // PASS / DEGRADED / FAIL / NOT_TESTED / EMPTY
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
  layer: string; // production / distribution / source
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

  // ---------- 商城购物车（cart）----------

  cart: { // 购物车：加购 / 移除 / 清空 / 结算（免费即时解锁，付费生成待结算订单）
    get() { // 读我的购物车
      return request<CartSummary>('/cart', { idempotency: false }); // 只读 GET
    }, // get 结束
    add(module_code: string) { // 加购：重复加购由后端回放
      return request<{ added: boolean; item_id: string; cart: CartSummary }>('/cart/items', { method: 'POST', body: { module_code } }); // 写操作自动带幂等键
    }, // add 结束
    remove(moduleCode: string) { // 移除单个条目
      return request<{ ok: boolean; cart: CartSummary }>(`/cart/items/${encodeURIComponent(moduleCode)}`, { method: 'DELETE' }); // 路径编码防注入
    }, // remove 结束
    clear() { // 清空购物车
      return request<{ ok: boolean; cart: CartSummary }>('/cart', { method: 'DELETE' }); // 写操作带幂等键
    }, // clear 结束
    checkout(channel: 'manual' | 'alipay' | 'wechat' | 'stripe' = 'manual') { // 结算整车
      return request<{ results: CartCheckoutResult[]; cart: CartSummary }>('/cart/checkout', { method: 'POST', body: { channel } }); // 返回逐条结果与剩余车
    }, // checkout 结束
  }, // cart 分组结束

  // ---------- 功能模块商城（catalog）----------

  catalog: { // 模块商城：模块列表、详情、解锁、我的权益
    getTaxonomy() { // 拉取分类导航树：19 个一级分类 + 205 个二级条目（带模块计数）
      return request<{ // 导航树响应
        groups: Array<{ // 一级分类列表
          slug: string; // 一级分类标识，作为 category 过滤值
          name: string; // 一级分类中文名称
          name_en: string | null; // 一级分类英文名称（英文站点导航使用，未登记时为 null）
          count: number; // 该分类下模块总数
          items: Array<{ slug: string; name: string; name_en: string | null; count: number }>; // 二级条目（slug / 中英文名 / 模块数）
        }>; // 一级分类类型结束
        total_items: number; // 二级条目总数
        total_modules: number; // 可见模块总数
      }>('/taxonomy', { auth: false, idempotency: false }); // 公开只读接口
    }, // getTaxonomy 结束
    getModules(opts: { // 拉取可购买模块：支持关键词、分类、排序、许可、语言与分页
      q?: string; // 关键词（名称/编码模糊匹配）
      category?: string; // 分类过滤：一级或二级 slug，'all' 等价不过滤
      sort?: 'stars' | 'recommended' | 'updated'; // 排序方式
      licenses?: string[]; // 许可多选
      languages?: string[]; // 语言多选
      page?: number; // 页码，从 1 起
      pageSize?: number; // 每页条数
    } = {}) {
      // 逐项拼接查询串：空值一律不下发，避免缓存键被空参数污染
      const params: string[] = []; // 查询参数收集器
      if (opts.q) params.push(`q=${encodeURIComponent(opts.q)}`); // 关键词经编码防注入
      if (opts.category && opts.category !== 'all') params.push(`category=${encodeURIComponent(opts.category)}`); // 分类过滤
      if (opts.sort) params.push(`sort=${encodeURIComponent(opts.sort)}`); // 排序方式
      if (opts.licenses && opts.licenses.length > 0) params.push(`licenses=${encodeURIComponent(opts.licenses.join(','))}`); // 许可多选拼逗号串
      if (opts.languages && opts.languages.length > 0) params.push(`languages=${encodeURIComponent(opts.languages.join(','))}`); // 语言多选拼逗号串
      if (opts.page && opts.page > 1) params.push(`page=${opts.page}`); // 首页不必携带
      if (opts.pageSize) params.push(`pageSize=${opts.pageSize}`); // 每页条数
      const suffix = params.length > 0 ? `?${params.join('&')}` : ''; // 组装最终查询串
      return request<{ // 响应为模块数组 + 分页元信息
        modules: Array<{ // 模块条目列表
          code: string; // 模块唯一编码，下单与解锁都用它
          name: Record<string, string>; // 多语言名称，键为语言码
          summary: Record<string, string>; // 多语言简介
          unlock_mode: 'one_time'; // 解锁方式：当前仅一次性买断
          region: Region; // 所属区域
          status: string; // 上架状态
          requires: string[]; // 前置依赖模块编码，前端据此提示
          category_slug: string | null; // 所属二级分类
          license: string | null; // 开源许可
          language: string | null; // 编程语言
          stars: number; // Star 数（Stars 排序依据）
          capability: string | null; // 真实能力键；null 表示该模块功能规划中
          current_price: { currency: string; amount_minor: number } | null; // 当前价格；未定价为 null
        }>; // 模块条目类型结束
        total: number; // 过滤后的总条数
        page: number; // 当前页码
        page_size: number; // 每页条数
        total_pages: number; // 总页数
      }>(`/modules${suffix}`, { auth: false, idempotency: false }); // 公开目录接口，免鉴权、只读无需幂等键
    }, // getModules 结束
    getHotModules(opts: { range: 'today' | 'week'; category?: string; limit?: number }) { // 右侧「热门项目」卡片数据
      const params: string[] = [`range=${encodeURIComponent(opts.range)}`]; // 必带时间窗
      if (opts.category && opts.category !== 'all') params.push(`category=${encodeURIComponent(opts.category)}`); // 跟随当前分类
      if (opts.limit) params.push(`limit=${opts.limit}`); // 条数上限
      return request<{ // 热门列表响应
        range: 'today' | 'week'; // 回显时间窗
        window_hours: number; // 窗口小时数（24 / 168）
        category: string; // 回显分类，all 表示全站
        total: number; // 参与排序的模块总数
        items: Array<{ // 热门条目
          code: string; // 模块编码
          name: Record<string, string>; // 多语言名称
          stars: number; // Star 数
          category_slug: string | null; // 所属二级分类
          license: string | null; // 开源许可
          language: string | null; // 编程语言
          created_at: string; // 创建时间，用于「新」标记
          hotness: number; // 热度分值（Stars + 窗口内新建加权）
        }>; // 热门条目类型结束
      }>(`/modules/hot?${params.join('&')}`, { auth: false, idempotency: false }); // 公开只读接口
    }, // getHotModules 结束
    getModule(code: string) { // 拉取单个模块详情
      return request<{ // 详情比列表多价格历史
        code: string; // 模块编码
        name: Record<string, string>; // 多语言名称
        summary: Record<string, string>; // 多语言简介
        unlock_mode: 'one_time'; // 解锁方式
        region: Region; // 所属区域
        status: string; // 上架状态
        requires: string[]; // 前置依赖
        category_slug: string | null; // 所属二级分类，详情页显示归属
        license: string | null; // 开源许可，与列表徽标同源
        language: string | null; // 编程语言，与列表徽标同源
        stars: number; // Star 数
        capability: string | null; // 真实能力键；前端据此渲染「工具」区块或「规划中」标记
        current_price: { currency: string; amount_minor: number } | null; // 当前价格，未定价为 null
        price_history: Array<{ // 价格变更历史，供详情页展示走势
          currency: string; // 币种
          amount_minor: number; // 金额（最小货币单位）
          effective_from: string; // 生效开始时间
          effective_to: string | null; // 生效结束时间；null 表示仍在生效
        }>; // 价格历史类型结束
      }>(`/modules/${encodeURIComponent(code)}`, { auth: false, idempotency: false }); // 编码路径参数防注入；公开只读接口
    }, // getModule 结束
    invokeModule(module_code: string, text: string, options: Record<string, string | number | boolean> = {}) { // 调用模块绑定的真实能力
      return request<{ // 能力调用结果
        module_code: string; // 回显模块编码
        capability: string; // 回显能力键
        output: string; // 结果正文：文本 / JSON / HTML / 图片 dataURL
        output_kind: 'text' | 'json' | 'html' | 'image'; // 输出形态，决定前端渲染方式
        meta: Record<string, unknown>; // 附加信息（字节数 / 算法 / 尺寸等）
        elapsed_ms: number; // 服务端执行耗时
      }>(`/modules/${encodeURIComponent(module_code)}/invoke`, { method: 'POST', body: { text, options } }); // 写操作自动带幂等键；后端校验登录与权益
    }, // invokeModule 结束
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
    createOrder(module_code: string) { // 为付费模块下单（待结算）；重复点击由后端回放同一张单
      return request<{ // 返回订单对象
        order: { // 订单视图
          id: string; // 订单主键，取消订单要用
          status: string; // pending / paid / cancelled
          currency: string; // 结算币种
          amount_minor: number; // 成交金额（分）
          channel: string; // 结算渠道；当前为 manual 人工结算
          module_code: string; // 模块编码
          module_name: Record<string, string>; // 模块多语言名
          entitlement_id: string | null; // 结算后发放的权益主键
          created_at: string; // 下单时间
          paid_at: string | null; // 结算时间
        }; // 订单视图结束
      }>('/orders', { method: 'POST', body: { module_code } }); // 写操作自动带幂等键，避免重复下单
    }, // createOrder 结束
    getMyOrders() { // 拉取我的订单列表
      return request<{ // 响应为订单数组包装
        orders: Array<{ // 订单条目
          id: string; // 订单主键
          status: string; // 订单状态
          currency: string; // 币种
          amount_minor: number; // 金额（分）
          module_code: string; // 模块编码
          module_name: Record<string, string>; // 模块多语言名
          created_at: string; // 下单时间
          paid_at: string | null; // 结算时间
        }>; // 订单数组类型结束
        total: number; // 总条数
      }>('/orders', { idempotency: false }); // 只读 GET，无需幂等键
    }, // getMyOrders 结束
    cancelOrder(id: string) { // 取消自己的待结算订单
      return request<{ order: { id: string; status: string; cancelled_at: string } }>( // 返回取消结果
        `/orders/${encodeURIComponent(id)}/cancel`, // 订单子资源
        { method: 'POST', body: {} }, // 显式空体，确保幂等键被附加
      ); // 请求调用结束
    }, // cancelOrder 结束
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
    exportFilm( // 导出成片：按格式/分辨率换取一次性预签名下载地址
      id: string, // 成片 id
      payload: { format?: FilmExportFormat; resolution?: FilmExportResolution } = {}, // 省略时走服务端默认 mp4 + 1080p（原片直下）
    ) { // 形参定义结束
      return request<FilmExportResult>(`/comic/films/${encodeURIComponent(id)}/export`, { // 导出子资源
        method: 'POST', // 写操作（会签发新的下载凭证）
        body: payload, // 空对象也显式带上，保证 Content-Type 与幂等键生效
      }); // 请求调用结束
    }, // exportFilm 结束
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
    /** GET /media/thumb?object_key=…&size=…：带 Bearer 拉取 WebP 缩略图二进制，供产物列表内联预览；失败由调用方回退原图 */
    async thumbBlob(objectKey: string, size = 240): Promise<Blob> {
      // 查询串：对象键必填，边长限制在后端 32~512 区间内
      const qs = new URLSearchParams({ object_key: objectKey, size: String(size) });
      // 缩略图走鉴权端点（非预签名免鉴权），需手动注入 Bearer；统一 request 强制 text()+JSON 解析，不适配二进制，故独立 fetch
      const headers: Record<string, string> = {};
      if (current) headers.Authorization = `Bearer ${current.access_token}`; // 有会话才带令牌，避免 Bearer undefined
      const res = await fetch(`${BASE}/media/thumb?${qs.toString()}`, { headers }); // GET 缩略图端点
      // 非 2xx：读 JSON 信封抛结构化错误，与列表/下载错误口径一致；缩略图失败由视图回退原图，不阻断列表
      if (!res.ok) {
        const text = await res.text(); // 读取错误正文
        let payload: unknown = null;
        if (text) { try { payload = JSON.parse(text); } catch { payload = null; } } // 非 JSON 按空兜底
        const body = (payload ?? {}) as { code?: string; message?: string; request_id?: string; details?: unknown };
        throw new ApiError(
          body.code ?? 'INTERNAL_ERROR', // 业务错误码兜底
          body.message ?? res.statusText, // 错误文案兜底
          res.status, // HTTP 状态码
          body.details, // 详情原样透出
          body.request_id, // 请求 ID 追踪
        );
      }
      return res.blob(); // 返回 WebP 二进制，由调用方生成 BlobURL 喂给 <img>
    }, // thumbBlob 结束
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
  im: { // IM 即时通讯：会话 / 消息 / 用户搜索（需登录）
    /** GET /im/conversations：当前用户的会话列表 */
    listConversations() { // 拉取会话列表，含最后消息与未读数
      return request<{ items: ImConversation[] }>('/im/conversations', { auth: true, idempotency: false }); // 需鉴权，只读无需幂等键
    }, // listConversations 结束
    /** POST /im/conversations：创建会话（direct 或 group） */
    createConversation(body: { type: ImConversationType; target_user_id?: string; name?: string; member_user_ids?: string[] }) {
      return request<{ conversation_id: string; conversation: ImConversation }>('/im/conversations', { method: 'POST', body, auth: true }); // 写操作由 request 自动生成幂等键
    }, // createConversation 结束
    /** GET /im/conversations/:id/messages：分页拉取历史消息（before 向前翻页；around 定位到指定消息附近） */
    listMessages(conversationId: string, opts: { before?: string; around?: string; limit?: number } = {}) {
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.before) qs.set('before', opts.before); // 游标：取比该 ID 更早的消息
      if (opts.around) qs.set('around', opts.around); // 定位：取该消息前后各半页（搜索结果跳转用）
      if (opts.limit) qs.set('limit', String(opts.limit)); // 条数限制
      const suffix = qs.toString(); // 无参数时空串
      return request<{ items: ImMessage[] }>(`/im/conversations/${encodeURIComponent(conversationId)}/messages${suffix ? `?${suffix}` : ''}`, { auth: true, idempotency: false });
    }, // listMessages 结束
    /** POST /im/conversations/:id/messages：HTTP 方式发消息（兜底；实时通道走 WebSocket） */
    sendMessage(conversationId: string, body: { content_type: ImMessageContentType; content?: string; object_key?: string; object_mime?: string; object_name?: string; object_size?: number; reply_to_id?: string }) {
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
    /** GET /im/conversations/:id：会话详情 + 成员列表 */
    getConversation(conversationId: string) {
      return request<{ conversation: { id: string; type: ImConversationType; title: string; owner_user_id: string | null }; members: ImMember[] }>(
        `/im/conversations/${encodeURIComponent(conversationId)}`, // 会话 ID 编码
        { auth: true, idempotency: false }, // 只读
      ); // 请求结束
    }, // getConversation 结束
    /** PATCH /im/conversations/:id：群改名（仅群主/管理员） */
    renameConversation(conversationId: string, title: string) {
      return request<{ ok: boolean; title: string }>(`/im/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH', // 局部更新
        body: { title }, // 新群名
        auth: true, // 需登录
      }); // 请求结束
    }, // renameConversation 结束
    /** GET /im/conversations/:id/members：群成员列表 */
    listMembers(conversationId: string) {
      return request<{ items: ImMember[] }>(`/im/conversations/${encodeURIComponent(conversationId)}/members`, { auth: true, idempotency: false });
    }, // listMembers 结束
    /** POST /im/conversations/:id/members：邀请入群 */
    addMembers(conversationId: string, userIds: string[]) {
      return request<{ ok: boolean; added: number }>(`/im/conversations/${encodeURIComponent(conversationId)}/members`, {
        method: 'POST', // 新增
        body: { user_ids: userIds }, // 待邀请用户
        auth: true, // 需登录
      }); // 请求结束
    }, // addMembers 结束
    /** DELETE /im/conversations/:id/members/:userId：退群或踢人 */
    removeMember(conversationId: string, userId: string) {
      return request<{ ok: boolean }>(`/im/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`, {
        method: 'DELETE', // 移除成员
        auth: true, // 需登录
      }); // 请求结束
    }, // removeMember 结束
    /** PATCH /im/conversations/:id/members/:userId：设 / 撤管理员（仅群主） */
    setMemberRole(conversationId: string, userId: string, role: 'admin' | 'member') {
      return request<{ ok: boolean; role: 'admin' | 'member' }>(
        `/im/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`, // 成员端点
        { method: 'PATCH', body: { role }, auth: true }, // 局部更新角色
      ); // 请求结束
    }, // setMemberRole 结束
    /** POST /im/conversations/:id/transfer：转让群主（仅群主） */
    transferOwnership(conversationId: string, userId: string) {
      return request<{ ok: boolean; owner_user_id: string }>(`/im/conversations/${encodeURIComponent(conversationId)}/transfer`, {
        method: 'POST', // 转让动作
        body: { user_id: userId }, // 接任者
        auth: true, // 需登录
      }); // 请求结束
    }, // transferOwnership 结束
    /** PATCH /im/conversations/:id/preferences：置顶 / 免打扰 */
    setPreference(conversationId: string, patch: { pinned?: boolean; muted?: boolean }) {
      return request<{ ok: boolean }>(`/im/conversations/${encodeURIComponent(conversationId)}/preferences`, {
        method: 'PATCH', // 局部更新
        body: patch, // 开关
        auth: true, // 需登录
      }); // 请求结束
    }, // setPreference 结束
    /** DELETE /im/conversations/:id：删除会话（群主解散 / 成员退群 / 私聊移除自己） */
    deleteConversation(conversationId: string) {
      return request<{ ok: boolean; result: 'dissolved' | 'left' }>(`/im/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE', // 删除
        auth: true, // 需登录
      }); // 请求结束
    }, // deleteConversation 结束
    /** GET /im/conversations/:id/messages/search?q=：会话内消息搜索 */
    searchMessages(conversationId: string, q: string, limit = 30) {
      const suffix = new URLSearchParams({ q, limit: String(limit) }).toString(); // 查询串
      return request<{ items: ImMessage[] }>(`/im/conversations/${encodeURIComponent(conversationId)}/messages/search?${suffix}`, {
        auth: true, // 需登录
        idempotency: false, // 只读
      }); // 请求结束
    }, // searchMessages 结束
    /** POST /im/conversations/:id/messages/:messageId/recall：撤回消息（2 分钟内，仅本人） */
    recallMessage(conversationId: string, messageId: string) {
      return request<{ ok: boolean }>(
        `/im/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/recall`, // 消息撤回端点
        { method: 'POST', body: {}, auth: true }, // 写操作
      ); // 请求结束
    }, // recallMessage 结束
  }, // im 分组结束

  // ---------- 统一入口配置清单（entries / sites）----------

  // 统一入口配置清单：45 个去重入口 / 19 业务域 / 职责边界 / 关联区分 / 可配置占位标识，全部只读公开。
  entries: {
    overview() { // 清单总览：规模、去重整理口径与占位配置统计
      return request<EntryOverview>('/entries/overview', { auth: false, idempotency: false }); // 公开只读
    }, // overview 结束
    domains() { // 19 个业务域及其入口数
      return request<{ total: number; domains: EntryDomain[] }>('/entries/domains', { auth: false, idempotency: false }); // 公开只读
    }, // domains 结束
    list(opts: { q?: string; domain?: string } = {}) { // 入口清单，支持关键词与业务域过滤
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.q) qs.set('q', opts.q); // 关键词：占位键 / 系统名 / 备注原文 / 职责字段
      if (opts.domain) qs.set('domain', opts.domain); // 业务域编码
      const suffix = qs.toString(); // 无参数时空串
      return request<{ schema: string; domains: EntryDomain[]; total: number; entries: EntryModule[] }>(
        `/entries${suffix ? `?${suffix}` : ''}`, // 参数经 URLSearchParams 编码，防注入
        { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // list 结束
    detail(entryKey: string) { // 单入口详情：关联解析 + 运行时能力点
      return request<{ entry: EntryModule; hostConfig: Record<string, unknown>; capabilities: SiteCapability[] }>(
        `/entries/${encodeURIComponent(entryKey)}`, // 占位键编码；公开只读
        { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // detail 结束
    placeholders() { // 47 个占位标识及其配置状态
      return request<{ total: number; configured: number; items: Array<{ entryKey: string; placeholder: string; envKey: string; configured: boolean; kind: string; system: string }> }>(
        '/entries/placeholders', { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // placeholders 结束
    config() { // 可配置占位标识模板（值恒为空，不回传具体主机值）
      return request<{ schema: string; template: string; format: string; envPrefix: string; rule: string; resolutionOfMissing: string; hosts: Record<string, string> }>(
        '/entries/config', { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // config 结束
  }, // entries 分组结束

  // 站点模块运行时：入口占位键下的能力点与业务条目，写操作需登录。
  sites: { // 浏览类端点公开，写操作需登录（由 request 自动带 Bearer 与幂等键）
    overview() { // 全站汇总：入口 / 能力 / 业务域 / 占位状态 / 条目与状态分布
      return request<SiteOverview>('/sites/overview', { auth: false, idempotency: false }); // 公开只读
    }, // overview 结束
    list(opts: { q?: string; group?: string; domain?: string } = {}) { // 入口列表，支持关键词与业务域过滤
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.q) qs.set('q', opts.q); // 关键词：占位键 / 系统名 / 备注原文 / 职责字段
      if (opts.domain) qs.set('domain', opts.domain); // 业务域编码（新口径）
      else if (opts.group) qs.set('domain', opts.group); // 兼容旧调用：group 值按业务域处理
      const suffix = qs.toString(); // 无参数时空串
      return request<{ domains: EntryDomain[]; groups: SiteGroup[]; total: number; modules: SiteModuleSummary[] }>(
        `/sites${suffix ? `?${suffix}` : ''}`, // 参数经 URLSearchParams 编码，防注入
        { auth: false, idempotency: false }, // 公开只读
      ); // 请求结束
    }, // list 结束
    detail(host: string) { // 单模块详情：备注原文、行号、能力点与条目统计
      return request<{
        module: SiteModuleDetail; // 完整模块定义
        capability_kinds: Record<string, { name: string; states: string[]; description: string }>; // 能力状态机字典
        stats: { total: number; byCapability: Record<string, number>; byStatus: Record<string, number> }; // 条目统计
      }>(`/sites/${encodeURIComponent(host)}`, { auth: false, idempotency: false }); // 主机记录编码；公开只读
    }, // detail 结束
    listItems(host: string, opts: { capability?: string; status?: string } = {}) { // 业务条目列表
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.capability) qs.set('capability', opts.capability); // 按能力过滤
      if (opts.status) qs.set('status', opts.status); // 按状态过滤
      const suffix = qs.toString(); // 无参数时空串
      return request<{ host: string; items: SiteItem[]; total: number }>(
        `/sites/${encodeURIComponent(host)}/items${suffix ? `?${suffix}` : ''}`, // 路径参数编码
        { auth: false, idempotency: false }, // 公开只读：浏览匿名可访问
      ); // 请求结束
    }, // listItems 结束
    createItem(host: string, payload: { capability: string; title: string; detail?: string; status?: string }) { // 新建业务条目
      return request<{ item: SiteItem }>(`/sites/${encodeURIComponent(host)}/items`, { // 写操作：自动带幂等键防重复提交
        method: 'POST', // 新建语义
        body: payload, // 标题必填，状态省略时由后端取能力默认态
      }); // 请求结束
    }, // createItem 结束
    transitionItem(host: string, id: string, status: string) { // 推进条目状态
      return request<{ item: SiteItem }>(`/sites/${encodeURIComponent(host)}/items/${encodeURIComponent(id)}/transition`, { // 写操作：自动带幂等键
        method: 'POST', // 状态迁移语义
        body: { status }, // 目标状态，后端按能力 states 校验
      }); // 请求结束
    }, // transitionItem 结束
  }, // sites 分组结束

  // ---------- 部署汇总（deployments）：统一字段的部署仓库 / 部署项 / 状态 / 结果 / 异常，全公开只读 ----------

  deployments: { // 部署汇总：三个端点均匿名可访问，不提供写操作
    overview() { // 全量汇总：状态 / 结果 / 层级 / 平台 / 严重度分布 + 覆盖口径 + 字典
      return request<DeploymentOverview>('/deployments/overview', { auth: false, idempotency: false }); // 公开只读
    }, // overview 结束
    list(opts: { q?: string; layer?: string; status?: string; verdict?: string; platform_id?: string } = {}) { // 清单，支持五类过滤
      const qs = new URLSearchParams(); // 安全拼接查询串
      if (opts.q) qs.set('q', opts.q); // 关键词：id / 名称 / 别名 / 仓库标识 / 入口
      if (opts.layer) qs.set('layer', opts.layer); // 层级
      if (opts.status) qs.set('status', opts.status); // 部署状态
      if (opts.verdict) qs.set('verdict', opts.verdict); // 结果（EMPTY 命中空数据项）
      if (opts.platform_id) qs.set('platform_id', opts.platform_id); // 平台编码
      const suffix = qs.toString(); // 无参数时空串
      return request<{
        schema: string; // 契约版本
        captured_at: string; // 取证时间
        filters: Record<string, string>; // 过滤条件回显
        total: number; // 过滤后条数
        registry_total: number; // 注册表总数（区分「无命中」与「无数据」）
        items: DeploymentItem[]; // 部署项清单
        status_codes: Record<string, string>; // 状态字典
        verdict_codes: Record<string, string>; // 结果字典
        severity_codes: Record<string, string>; // 严重度字典
      }>(`/deployments${suffix ? `?${suffix}` : ''}`, { auth: false, idempotency: false }); // 公开只读
    }, // list 结束
    detail(id: string) { // 单项详情：仓库标识、交付链路、结果、异常、缺失信息、同类项
      return request<{
        schema: string; // 契约版本
        item: DeploymentItem; // 完整部署项
        related: Array<{ id: string; name: string; layer: string }>; // 同平台同类项
        status_codes: Record<string, string>; // 状态字典
        verdict_codes: Record<string, string>; // 结果字典
        severity_codes: Record<string, string>; // 严重度字典
      }>(`/deployments/${encodeURIComponent(id)}`, { auth: false, idempotency: false }); // 路径参数编码
    }, // detail 结束
  }, // deployments 分组结束
}; // api 对象结束
