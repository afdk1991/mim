/**
 * API 请求核心（2026-11-14 P1-A 拆分，自 api.ts 原样搬出）
 *
 * 只负责「怎么发请求、怎么存会话、错误怎么翻译」；业务端点全部在 endpoints.ts。
 * 拆分原则：函数体一行未改，导出名与原 api.ts 完全一致，调用方无需改 import。
 */

import { errorMessage, normalizeLocale } from '@mim/i18n'; // 错误码翻译与语言标签归一化
import type { Locale } from '@mim/i18n'; // 仅类型导入，编译后擦除
import type { ErrorCode } from '@mim/core-domain'; // 领域错误码，用于把后端 code 映射到文案表
import type { UserInfo, Session, LoginResult, MeResponse } from './types.js'; // 会话与登录相关类型仍定义在 api.ts 的类型区，仅类型引用不产生运行时环依赖

// API 源：默认同源（自建服务器经 nginx 反代）；托管平台（GitHub Pages / Cloudflare / Vercel）
// 通过构建期 VITE_API_ORIGIN 指向生产 API。
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, ''); // 读构建期变量并去掉尾部斜杠，避免拼出双斜杠
export const BASE = `${API_ORIGIN}/api/v1`; // 统一路径前缀，集中定义便于未来整体迁移

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

export let current: Session | null = readSession(); // 内存中的当前会话，避免每次请求都读 localStorage
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

/**
 * 免登录体验：本地没有会话时自动向服务端领一个匿名访客会话。
 * 有了访客会话，商城下单、购物车、个人中心、聊天、漫剧工作台等原先「需登录」的功能
 * 全部按已登录路径工作，界面不再出现任何登录门禁；用户随时可以登录升级为正式账号。
 */
export async function ensureGuestSession(): Promise<boolean> { // true 表示当前已有可用会话（访客或正式）
  if (current) return true; // 已有会话（含正式登录与游客）直接复用，不再建号
  try { // 网络不可用时不能让整页阻塞在门禁上
    const result = await request<LoginResult>('/auth/guest', { // 直接走请求核心，不经 endpoints.ts，避免 request ↔ endpoints 运行时环依赖
      method: 'POST', // 建号属写操作
      body: { device: { platform: 'web', name: '浏览器' } }, // 区域走服务端缺省（中国区）；请求体形状与原 api.guest() 一致
      auth: false, // 此时还没有令牌
      idempotency: false, // 每次建号都是新访客，重复提交由服务端限流兜底
    }); // 请求调用结束
    setSession(result, 'login'); // 与登录同一条广播路径，界面立即进入可用态
    return true; // 访客会话就绪
  } catch { // 建号失败（限流 / 离线 / 服务端异常）
    return false; // 调用方保留只读降级界面
  } // try/catch 结束
} // ensureGuestSession 结束

/** 当前是否为匿名访客会话（前端据此显示「访客」标签与登录升级入口） */
export function isGuestSession(): boolean { // 正式登录用户同样可能保留旧 is_guest 标记，以服务端回传为准
  return Boolean(current?.user.is_guest); // 未登录时为 false
} // isGuestSession 结束

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

export async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> { // 所有接口的唯一出口：统一鉴权、幂等、错误信封与 401 重试
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
