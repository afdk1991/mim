/** 后台管理端 HTTP 客户端：统一处理基址、凭证注入与扁平错误信封解析 */

// 后端源站：留空表示同源（生产由 nginx 反代 /api，开发由 vite proxy 转发）
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');
// API 版本前缀：全部端点都挂在 /api/v1 下
const BASE = `${API_ORIGIN}/api/v1`;
// 凭证持久化键：带版本号，结构变更时可直接作废旧数据而不做迁移
const CREDENTIAL_KEY = 'mim.admin.credential.v1';

/** 两种后台身份凭证：引导令牌（x-admin-token）或登录后的 Bearer 令牌 */
export type Credential =
  // 超管引导通道：命中 MIM_ADMIN_TOKEN 即视为全权限，用于首个超管冷启动
  | { kind: 'token'; value: string }
  // 普通账号通道：登录接口签发的 JWT，权限由 RBAC 实时计算
  | { kind: 'bearer'; value: string };

/** 从 localStorage 读取凭证；解析失败一律按未登录处理，避免脏数据导致白屏 */
export function loadCredential(): Credential | null {
  // localStorage 在隐私模式或跨域 iframe 下可能抛错，统一兜底
  try {
    // 取出原始字符串
    const raw = window.localStorage.getItem(CREDENTIAL_KEY);
    // 无值即未登录
    if (!raw) return null;
    // 解析为结构化对象
    const parsed = JSON.parse(raw) as Partial<Credential>;
    // 校验 kind 与 value 同时合法才认为有效
    if ((parsed.kind === 'token' || parsed.kind === 'bearer') && typeof parsed.value === 'string' && parsed.value.length > 0) {
      // 类型收窄后返回
      return { kind: parsed.kind, value: parsed.value };
    } // 代码块结束
    // 结构不合法按未登录处理
    return null;
  } catch { // 代码块结束
    // 任何异常都视为无凭证
    return null;
  } // 代码块结束
} // 代码块结束

/** 写入或清除凭证；传 null 表示退出登录 */
export function saveCredential(credential: Credential | null): void {
  // 同样兜底存储异常
  try {
    // 清除场景
    if (!credential) {
      // 移除键值
      window.localStorage.removeItem(CREDENTIAL_KEY);
      // 结束
      return;
    } // 代码块结束
    // 写入序列化结果
    window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
  } catch { // 代码块结束
    // 存储失败不阻断主流程：本次会话仍持有内存中的凭证
  }
} // 代码块结束

/** 后端统一错误信封（扁平结构）：statusCode 由 HTTP 状态码提供，其余字段来自响应体 */
export class ApiError extends Error {
  // 业务错误码，如 AUTH_UNAUTHORIZED / FORBIDDEN / NOT_FOUND
  readonly code: string;
  // HTTP 状态码，便于视图区分未授权与其他失败
  readonly status: number;
  // 服务端请求 ID，用户报障时可直接定位日志
  readonly requestId: string;
  // 附加上下文，如 module_code / permission / unknown
  readonly details: unknown;

  /** 构造错误对象：message 直接使用服务端文案，避免前端二次翻译 */
  constructor(status: number, code: string, message: string, requestId: string, details: unknown) {
    // 传给 Error 的 message
    super(message);
    // 类名便于 devtools 识别
    this.name = 'ApiError';
    // 逐字段赋值
    this.code = code;
    // HTTP 状态码
    this.status = status;
    // 请求 ID
    this.requestId = requestId;
    // 附加详情
    this.details = details;
  } // 代码块结束
} // 代码块结束

/** 单次请求的可选参数 */
interface RequestOptions {
  // HTTP 方法，默认 GET
  method?: string;
  // 请求体：存在时序列化为 JSON 并自动补 Content-Type
  body?: unknown;
  // 本次请求所用凭证；显式传 null 表示匿名请求
  credential?: Credential | null;
  // 附加自定义请求头（如管理端区域通道 x-region），在凭证注入后合并以避免覆盖认证头
  headers?: Record<string, string>;
} // 代码块结束

/** 把任意异常转成可读文案：ApiError 取 message，其余兜底字符串化 */
export function describeError(error: unknown): string {
  // 业务错误直接展示服务端文案
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  // 原生 Error 取其 message
  if (error instanceof Error) return error.message;
  // 其他情况兜底
  return String(error);
} // 代码块结束

/** 核心请求函数：负责拼 URL、注入凭证、解析错误信封与空响应 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // 组装请求头；Accept 固定声明期望 JSON
  const headers: Record<string, string> = { Accept: 'application/json' };
  // 有请求体时声明 Content-Type
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  // 注入凭证：token 走自定义头，bearer 走标准 Authorization
  if (options.credential?.kind === 'token') {
    // 引导令牌头名与后端 CORS allowedHeaders 保持一致
    headers['X-Admin-Token'] = options.credential.value;
  } else if (options.credential?.kind === 'bearer') { // 代码块结束
    // 标准 Bearer 方案
    headers.Authorization = `Bearer ${options.credential.value}`;
  } // 代码块结束
  // 合并调用方自定义头：放在凭证注入之后，但不允许覆盖认证头，防止误把身份写丢
  if (options.headers) {
    // 逐个键合并
    for (const [key, value] of Object.entries(options.headers)) {
      // 跳过认证相关头，避免自定义头把凭证顶掉
      if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-admin-token') continue;
      // 写入其余自定义头
      headers[key] = value;
    } // 代码块结束
  } // 代码块结束
  // 写操作补幂等键：后端在 REQUIRE_IDEMPOTENCY 打开时会强制要求，缺失会 400
  if ((options.method ?? 'GET') !== 'GET' && !headers['idempotency-key'] && !headers['Idempotency-Key']) {
    // crypto.randomUUID 仅在安全上下文可用（HTTPS / localhost），局域网 http 下退化为时间戳+随机数
    headers['idempotency-key'] =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' // 执行当前业务步骤
        ? crypto.randomUUID() // 现代浏览器安全上下文
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; // 兜底方案，仍保证低碰撞
  } // 代码块结束
  // 发起请求
  const response = await fetch(`${BASE}${path}`, {
    // 默认 GET
    method: options.method ?? 'GET',
    // 请求头
    headers,
    // 只有带 body 时才序列化，避免 GET 请求出现空字符串体
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }); // 代码块结束
  // 读取文本：204 或非 JSON 响应下也能安全处理
  const text = await response.text();
  // 尝试解析 JSON，失败则保留 null
  let payload: unknown = null;
  // 仅在有内容时解析
  if (text.length > 0) {
    // 解析异常说明不是 JSON，按空处理让下面的错误分支兜底
    try {
      payload = JSON.parse(text) as unknown; // 赋值：更新变量 payload 的取值
    } catch { // 代码块结束
      // 非 JSON 响应体忽略
      payload = null;
    } // 代码块结束
  } // 代码块结束
  // 非 2xx 一律构造 ApiError
  if (!response.ok) {
    // 取出扁平信封字段，缺失时给出可读兜底
    const body = (payload ?? {}) as { code?: string; message?: string; request_id?: string; details?: unknown };
    // 抛出结构化错误，视图按 code/status 分支处理
    throw new ApiError(
      // HTTP 状态码
      response.status,
      // 业务错误码兜底为 HTTP_ERROR
      body.code ?? 'HTTP_ERROR',
      // 错误文案兜底为状态行
      body.message ?? `request failed with status ${response.status}`,
      // 请求 ID 缺失时给空串
      body.request_id ?? '',
      // 附加详情原样透出
      body.details,
    ); // 执行当前业务步骤
  } // 代码块结束
  // 空响应体（如 204）按 undefined 处理
  return (payload ?? undefined) as T;
} // 代码块结束

// ── 认证 ──────────────────────────────────────────────────────────────────

/** 登录后返回的用户主体：与后端 userPayload 字段严格对齐 */
export interface AuthUser {
  // 用户主键
  id: string;
  // 所属区域 cn / global
  region: string;
  // 账号状态
  status: string;
  // 展示名
  display_name: string;
  // 语言偏好
  locale: string;
  // 时区
  timezone: string;
  // 注销计划时间，null 表示未申请注销
  deletion_scheduled_at: string | null;
} // 代码块结束

/** 登录响应：令牌三元组 + 用户主体 */
interface LoginResponse {
  // 令牌类型，固定 Bearer
  token_type: string;
  // 访问令牌
  access_token: string;
  // 刷新令牌（本后台暂不做静默续期）
  refresh_token: string;
  // 过期秒数
  expires_in: number;
  // 用户主体
  user: AuthUser;
} // 代码块结束

/** 账号密码登录：成功返回访问令牌与用户信息 */
export function loginWithPassword(identifier: string, password: string, region: 'cn' | 'global' = 'cn'): Promise<LoginResponse> {
  // 调用密码登录端点，device 标记来源便于后端审计
  return request<LoginResponse>('/auth/password', {
    // POST 提交凭证
    method: 'POST',
    // 请求体字段与 auth.ts 的 passwordBody 一致
    body: { region, identifier, password, device: { platform: 'admin', name: 'Mim 管理后台' } },
    // 登录本身是匿名请求
    credential: null,
  }); // 代码块结束
} // 代码块结束

// ── 身份与权限 ────────────────────────────────────────────────────────────

/** /admin/me 响应：当前身份、角色与实时权限 */
export interface AdminIdentity {
  // 是否来自 x-admin-token 引导通道
  bootstrap: boolean;
  // 真实用户主体；引导通道为 null
  user: AuthUser | null;
  // 生效角色码
  roles: string[];
  // 生效权限码（已排序）
  permissions: string[];
} // 代码块结束

/** 查询当前身份：登录校验与首屏权限门禁都依赖它 */
export function getAdminMe(credential: Credential): Promise<AdminIdentity> {
  // 读取身份端点
  return request<AdminIdentity>('/admin/me', { credential });
} // 代码块结束

/** 权限点视图 */
export interface PermissionView {
  // 权限码，如 module:write
  code: string;
  // 多语言名称
  name: Record<string, string>;
  // 多语言描述
  description: Record<string, string>;
  // 是否内置权限点（内置不可删除）
  builtin: boolean;
  // 创建时间
  created_at: string;
  // 更新时间
  updated_at: string;
} // 代码块结束

/** 角色视图 */
export interface RoleView {
  // 角色码
  code: string;
  // 多语言名称
  name: Record<string, string>;
  // 多语言描述
  description: Record<string, string>;
  // 是否内置角色（内置不可改删）
  builtin: boolean;
  // 该角色当前权限码集合
  permissions: string[];
  // 创建时间
  created_at: string;
  // 更新时间
  updated_at: string;
} // 代码块结束

/** 列出全部权限点 */
export async function listPermissions(credential: Credential): Promise<PermissionView[]> {
  // 响应包了一层 permissions 字段
  const data = await request<{ permissions: PermissionView[] }>('/admin/permissions', { credential });
  // 直接取数组，视图无需再解构
  return data.permissions;
} // 代码块结束

/** 列出全部角色 */
export async function listRoles(credential: Credential): Promise<RoleView[]> {
  // 响应包了一层 roles 字段
  const data = await request<{ roles: RoleView[] }>('/admin/roles', { credential });
  // 返回数组
  return data.roles;
} // 代码块结束

/** 新建角色的入参 */
export interface RoleCreatePayload {
  // 角色码，3-32 位小写字母开头
  code: string;
  // 多语言名称
  name: Record<string, string>;
  // 多语言描述，选填
  description?: Record<string, string>;
  // 初始权限码
  permissions?: string[];
} // 代码块结束

/** 新建角色：成功返回完整角色视图 */
export async function createRole(credential: Credential, payload: RoleCreatePayload): Promise<RoleView> {
  // 管理员角色创建接口（POST /admin/roles）
  const data = await request<{ role: RoleView }>('/admin/roles', { method: 'POST', body: payload, credential });
  // 解包角色对象
  return data.role;
} // 代码块结束

/** 修改角色名称/描述（内置角色后端会拒绝） */
export async function updateRole(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  code: string, // 对象字段 code：记录一项配置或数据
  payload: { name?: Record<string, string>; description?: Record<string, string> }, // 对象字段 payload：记录一项配置或数据
): Promise<RoleView> { // 执行当前业务步骤
  // 角色码需编码，防止特殊字符破坏路径
  const data = await request<{ role: RoleView }>(`/admin/roles/${encodeURIComponent(code)}`, {
    // PATCH 局部更新
    method: 'PATCH',
    // 请求体只带需要修改的字段
    body: payload,
    // 携带凭证
    credential,
  }); // 代码块结束
  // 解包角色
  return data.role;
} // 代码块结束

/** 删除角色：被用户引用时后端返回 409 */
export function deleteRole(credential: Credential, code: string): Promise<{ code: string; deleted: boolean }> {
  // DELETE 无请求体
  return request<{ code: string; deleted: boolean }>(`/admin/roles/${encodeURIComponent(code)}`, {
    // 删除方法
    method: 'DELETE',
    // 携带凭证
    credential,
  }); // 代码块结束
} // 代码块结束

/** 整体替换角色权限：传空数组即清空 */
export async function replaceRolePermissions(credential: Credential, code: string, permissions: string[]): Promise<string[]> {
  // PUT 语义为整体覆盖
  const data = await request<{ role_code: string; permissions: string[] }>(`/admin/roles/${encodeURIComponent(code)}/permissions`, {
    // 覆盖方法
    method: 'PUT',
    // 权限码数组
    body: { permissions },
    // 携带凭证
    credential,
  }); // 代码块结束
  // 返回后端落库后的最终权限集合
  return data.permissions;
} // 代码块结束

// ── 用户与用户角色 ────────────────────────────────────────────────────────

/** 用户列表行：含已授予角色码 */
export interface UserListRow {
  // 用户主键
  id: string;
  // 所属区域
  region: string;
  // 账号状态
  status: string;
  // 展示名
  display_name: string;
  // 语言偏好
  locale: string;
  // 时区
  timezone: string;
  // 注册时间
  created_at: string;
  // 更新时间
  updated_at: string;
  // 已授予角色码
  roles: string[];
} // 代码块结束

/** 用户列表分页结果 */
export interface UserListPage {
  // 当前页用户
  users: UserListRow[];
  // 匹配总数
  total: number;
  // 每页条数
  limit: number;
  // 偏移量
  offset: number;
} // 代码块结束

/** 分页查询用户：q 同时匹配 ID / 展示名 / 登录标识 */
export function listUsers(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  query: { q?: string; limit?: number; offset?: number } = {}, // 对象字段 query：记录一项配置或数据
): Promise<UserListPage> { // 执行当前业务步骤
  // 组装查询串，空值不写入避免后端把空串当条件
  const params = new URLSearchParams();
  // 关键字
  if (query.q) params.set('q', query.q);
  // 每页条数
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  // 偏移量
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  // 拼接查询串：无参数时不带问号
  const suffix = params.toString().length > 0 ? `?${params.toString()}` : '';
  // 发起请求
  return request<UserListPage>(`/admin/users${suffix}`, { credential });
} // 代码块结束

/** 用户角色授权行 */
export interface UserRoleRow {
  // 用户 ID
  user_id: string;
  // 角色码
  role_code: string;
  // 授权人
  granted_by: string;
  // 授权时间
  created_at: string;
} // 代码块结束

/** 查询某用户的角色授权列表 */
export async function listUserRoles(credential: Credential, userId: string): Promise<UserRoleRow[]> {
  // 路径参数编码，避免 ID 中的特殊字符破坏路由
  const data = await request<{ user_id: string; roles: UserRoleRow[] }>(
    // 目标路径
    `/admin/users/${encodeURIComponent(userId)}/roles`,
    // 携带凭证
    { credential },
  ); // 执行当前业务步骤
  // 返回授权数组
  return data.roles;
} // 代码块结束

/** 授予用户角色：首次 201、重复 200，两者都视为成功 */
export function grantUserRole(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  userId: string, // 对象字段 userId：记录一项配置或数据
  roleCode: string, // 对象字段 roleCode：记录一项配置或数据
): Promise<{ user_id: string; role_code: string; granted_by: string; created: boolean }> { // 执行当前业务步骤
  // POST 到用户角色集合
  return request(`/admin/users/${encodeURIComponent(userId)}/roles`, {
    // 新增语义
    method: 'POST',
    // 角色码请求体
    body: { role_code: roleCode },
    // 携带凭证
    credential,
  }); // 代码块结束
} // 代码块结束

/** 撤销用户角色 */
export function revokeUserRole(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  userId: string, // 对象字段 userId：记录一项配置或数据
  roleCode: string, // 对象字段 roleCode：记录一项配置或数据
): Promise<{ user_id: string; role_code: string; deleted: boolean }> { // 执行当前业务步骤
  // DELETE 精确到单个角色
  return request(`/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleCode)}`, {
    // 删除方法
    method: 'DELETE',
    // 携带凭证
    credential,
  }); // 代码块结束
} // 代码块结束

// ── 功能模块与权益 ────────────────────────────────────────────────────────

/** 模块视图：公开目录端点对外结构 */
export interface ModuleView {
  // 模块编码
  code: string;
  // 多语言名称
  name: Record<string, string>;
  // 多语言简介
  summary: Record<string, string>;
  // 解锁方式（当前仅 one_time 一次性买断，见 schema.sql 的 CHECK 约束）
  unlock_mode: string;
  // 所属地区
  region: string;
  // 状态 draft / active / archived
  status: string;
  // 前置依赖模块码
  requires: string[];
  // 当前有效价格，null 表示免费或未定价
  current_price: { currency: string; amount_minor: number } | null;
} // 代码块结束

/** 模块状态迁移目标，与后端枚举一致 */
export type ModuleStatus = 'draft' | 'active' | 'archived';

/** 列出模块：公开端点，但仍带凭证以便后端按登录用户地区返回 */
export async function listModules(credential: Credential | null): Promise<ModuleView[]> {
  // 响应包了一层 modules
  const data = await request<{ modules: ModuleView[] }>('/modules', { credential });
  // 返回数组
  return data.modules;
} // 代码块结束

/** 迁移模块状态：仅允许 draft→active→archived 单向流转 */
export async function updateModuleStatus(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  code: string, // 对象字段 code：记录一项配置或数据
  status: ModuleStatus, // 对象字段 status：记录一项配置或数据
  region?: string, // 执行当前业务步骤
): Promise<{ code: string; region: string; status: string; updated_at: string }> { // 执行当前业务步骤
  // PATCH 指定模块状态
  const data = await request<{ module: { code: string; region: string; status: string; updated_at: string } }>(
    // 目标路径
    `/modules/${encodeURIComponent(code)}/status`,
    // 局部更新
    { method: 'PATCH', body: { status, region }, credential },
  ); // 执行当前业务步骤
  // 解包模块
  return data.module;
} // 代码块结束

/** 管理端模块视图：在公开视图基础上补排序权重与时间戳 */
export interface ModuleManageView extends ModuleView {
  // 展示排序权重
  sort_order: number;
  // 创建时间
  created_at: string;
  // 更新时间
  updated_at: string;
} // 代码块结束

/** 价格行视图：与 module_prices 表结构对齐 */
export interface ModulePrice {
  // 价格行主键，调价（PUT/DELETE /modules/prices/:id）必须携带
  id: string;
  // 币种（CNY/USD）
  currency: string;
  // 金额最小单位，避免浮点误差
  amount_minor: number;
  // 生效起始时间
  effective_from: string;
  // 生效结束时间，null 表示长期有效
  effective_to: string | null;
} // 代码块结束

/** 模块详情：公开详情端点为扁平响应（顶层即模块字段，无 module 包裹层） */
export interface ModuleDetail extends ModuleView {
  // 展示排序权重
  sort_order: number;
  // 创建时间
  created_at: string;
  // 更新时间
  updated_at: string;
  // 全部历史价格（按生效时间倒序），供调价轨迹展示与管理端调价
  price_history: ModulePrice[];
} // 代码块结束

/** 管理端模块全量列表：含 draft/archived，支持 q/status 过滤；区域走 x-region 头 */
export async function listModulesManage(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  query: { q?: string; status?: ModuleStatus; region?: string } = {}, // 对象字段 query：记录一项配置或数据
): Promise<ModuleManageView[]> { // 执行当前业务步骤
  // 组装查询串，空值不写入避免后端把空串当条件
  const params = new URLSearchParams();
  // 关键字（编码/名称包含匹配）
  if (query.q) params.set('q', query.q);
  // 状态过滤
  if (query.status) params.set('status', query.status);
  // 拼接查询串：无参数时不带问号
  const suffix = params.toString().length > 0 ? `?${params.toString()}` : '';
  // 区域缺省 cn，与后端缺省保持一致
  const region = query.region ?? 'cn';
  // 响应包裹 { modules, total }；后端该端点只读 x-region 头，故走自定义头通道
  const data = await request<{ modules: ModuleManageView[]; total: number }>(`/modules/manage${suffix}`, {
    // 携带凭证
    credential,
    // 区域通道头
    headers: { 'x-region': region },
  }); // 代码块结束
  // 返回模块数组
  return data.modules;
} // 代码块结束

/** 模块详情：扁平响应，直接返回顶层对象 */
export function getModule(credential: Credential, code: string, region?: string): Promise<ModuleDetail> {
  // 区域仅作请求头，不影响路径
  return request<ModuleDetail>(`/modules/${encodeURIComponent(code)}`, {
    // 携带凭证
    credential,
    // 显式区域头，缺省时由后端按登录用户地区兜底
    headers: region ? { 'x-region': region } : undefined,
  }); // 代码块结束
} // 代码块结束

/** 新建模块的入参：code 区域内唯一，默认落 draft */
export interface ModuleCreatePayload {
  // 模块编码，小写字母数字开头，可含 . _ -
  code: string;
  // 多语言名称
  name: Record<string, string>;
  // 多语言简介，选填
  summary?: Record<string, string>;
  // 所属地区，默认 cn
  region?: string;
  // 展示排序权重，选填
  sort_order?: number;
  // 前置依赖模块码，选填
  requires?: string[];
} // 代码块结束

/** 新建模块：成功返回 201 与完整模块视图 */
export async function createModule(credential: Credential, payload: ModuleCreatePayload): Promise<ModuleManageView> {
  // POST /modules，响应包裹 { module }
  const data = await request<{ module: ModuleManageView }>('/modules', { method: 'POST', body: payload, credential });
  // 解包模块
  return data.module;
} // 代码块结束

/** 编辑模块的入参：仅文案/排序/依赖可改，状态走 /status 路由 */
export interface ModuleUpdatePayload {
  // 多语言名称，选填
  name?: Record<string, string>;
  // 多语言简介，选填
  summary?: Record<string, string>;
  // 展示排序权重，选填
  sort_order?: number;
  // 前置依赖模块码，选填
  requires?: string[];
  // 区域仅用于定位模块行，不参与更新
  region?: string;
} // 代码块结束

/** 编辑模块：成功返回 200 与更新后的模块视图 */
export async function updateModule(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  code: string, // 对象字段 code：记录一项配置或数据
  payload: ModuleUpdatePayload, // 对象字段 payload：记录一项配置或数据
): Promise<ModuleManageView> { // 执行当前业务步骤
  // PATCH 指定模块，响应包裹 { module }
  const data = await request<{ module: ModuleManageView }>(`/modules/${encodeURIComponent(code)}`, {
    // 局部更新
    method: 'PATCH',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
  }); // 代码块结束
  // 解包模块
  return data.module;
} // 代码块结束

/** 软删除模块：active 须先归档；重复删除后端回放 200 */
export async function deleteModule(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  code: string, // 对象字段 code：记录一项配置或数据
  region?: string, // 执行当前业务步骤
): Promise<{ code: string; region: string; deleted: boolean; deleted_at: string }> { // 执行当前业务步骤
  // 区域走查询串，与后端 query>header>cn 的解析顺序对齐
  const suffix = region ? `?region=${encodeURIComponent(region)}` : '';
  // DELETE 无请求体；响应包裹 { module: { code, region, deleted, deleted_at } }
  const data = await request<{ module: { code: string; region: string; deleted: boolean; deleted_at: string } }>(
    // 目标路径
    `/modules/${encodeURIComponent(code)}${suffix}`,
    // 删除方法 + 凭证
    { method: 'DELETE', credential },
  ); // 执行当前业务步骤
  // 解包模块删除回执
  return data.module;
} // 代码块结束

/** 新增价格行的入参：按时间窗口生效，支持多币种 */
export interface ModulePricePayload {
  // 币种（CNY/USD）
  currency: string;
  // 金额最小单位
  amount_minor: number;
  // 生效起始时间（ISO 字符串），缺省表示立即生效
  effective_from?: string;
  // 生效结束时间（ISO 字符串），缺省表示长期有效
  effective_to?: string;
} // 代码块结束

/** 新增价格行：成功返回 201 与价格行（含 module_code）；region 走 x-region 头定位模块 */
export async function createModulePrice(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  code: string, // 对象字段 code：记录一项配置或数据
  payload: ModulePricePayload, // 对象字段 payload：记录一项配置或数据
  region?: string, // 执行当前业务步骤
): Promise<ModulePrice> { // 执行当前业务步骤
  // POST 到模块价格集合，响应包裹 { price }
  const data = await request<{ price: ModulePrice }>(`/modules/${encodeURIComponent(code)}/prices`, {
    // 新增语义
    method: 'POST',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
    // 区域定位头：缺省时后端按 cn 兜底
    headers: region ? { 'x-region': region } : undefined,
  }); // 代码块结束
  // 解包价格行
  return data.price;
} // 代码块结束

/** 更新价格行：金额、币种、生效窗口均可改；effective_to 传 null 表示转为长期有效 */
export async function updateModulePrice(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  priceId: string, // 对象字段 priceId：记录一项配置或数据
  // 先从 Partial 中剔除 effective_to 再以可空类型覆盖：直接交集会把 null 收窄掉
  payload: Partial<Omit<ModulePricePayload, 'effective_to'>> & { effective_to?: string | null },
): Promise<ModulePrice> { // 执行当前业务步骤
  // PUT 精确到价格行，响应包裹 { price }（注意后端回显的是 module_id 而非 module_code）
  const data = await request<{ price: ModulePrice }>(`/modules/prices/${encodeURIComponent(priceId)}`, {
    // 覆盖更新
    method: 'PUT',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
  }); // 代码块结束
  // 解包价格行
  return data.price;
} // 代码块结束

/** 使价格行立即失效：后端软失效 effective_to = now，保留历史留痕；不存在或已过期返回 404 */
export async function deleteModulePrice(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  priceId: string, // 对象字段 priceId：记录一项配置或数据
): Promise<{ id: string; effective_to: string; expired: boolean }> { // 执行当前业务步骤
  // DELETE 无请求体，响应包裹 { price: { id, effective_to, expired } }
  const data = await request<{ price: { id: string; effective_to: string; expired: boolean } }>(
    // 目标路径精确到价格行
    `/modules/prices/${encodeURIComponent(priceId)}`,
    // 删除方法 + 凭证
    { method: 'DELETE', credential },
  ); // 执行当前业务步骤
  // 解包价格行失效回执
  return data.price;
} // 代码块结束

/** 权益视图 */
export interface EntitlementView {
  // 权益主键
  id: string;
  // 持有用户
  user_id: string;
  // 对应模块码
  module_code: string;
  // 状态 active / revoked / expired
  status: string;
  // 过期时间，null 表示永久
  expires_at: string | null;
  // 版本号，用于乐观并发标识
  version: number;
  // 创建时间
  created_at: string;
} // 代码块结束

/** 手工发放权益：已激活未过期时后端回放现有记录 */
export async function grantEntitlement(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  payload: { user_id: string; module_code: string; region?: string; expires_at?: string }, // 对象字段 payload：记录一项配置或数据
): Promise<EntitlementView> { // 执行当前业务步骤
  // POST 发放端点
  const data = await request<{ entitlement: EntitlementView }>('/entitlements/grant', {
    // 新增语义
    method: 'POST',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
  }); // 代码块结束
  // 解包权益
  return data.entitlement;
} // 代码块结束

/** 回收权益：已回收时后端回放当前状态 */
export async function revokeEntitlement(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  entitlementId: string, // 对象字段 entitlementId：记录一项配置或数据
  reason?: string, // 执行当前业务步骤
): Promise<{ id: string; user_id: string; status: string; version: number; updated_at: string }> { // 执行当前业务步骤
  // POST 回收端点，路径参数为权益 ID
  const data = await request<{ entitlement: { id: string; user_id: string; status: string; version: number; updated_at: string } }>(
    // 目标路径
    `/entitlements/${encodeURIComponent(entitlementId)}/revoke`,
    // 请求体允许空对象
    { method: 'POST', body: reason ? { reason } : {}, credential },
  ); // 执行当前业务步骤
  // 解包权益
  return data.entitlement;
} // 代码块结束

/** 权益列表行：在权益视图基础上补模块多语言名、区域与更新时间 */
export interface EntitlementListRow extends EntitlementView {
  // 模块多语言名称（用于列表展示，避免二次查模块表）
  module_name: Record<string, string>;
  // 所属区域
  region: string;
  // 更新时间
  updated_at: string;
} // 代码块结束

/** 权益列表分页结果 */
export interface EntitlementListPage {
  // 当前页权益
  entitlements: EntitlementListRow[];
  // 匹配总数
  total: number;
  // 每页条数
  limit: number;
  // 偏移量
  offset: number;
} // 代码块结束

/** 分页查询权益：q 匹配用户 ID / 模块码；status 过滤；region 留空表示跨区域 */
export function listEntitlements(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  query: { q?: string; status?: 'active' | 'expired' | 'revoked'; region?: string; limit?: number; offset?: number } = {}, // 对象字段 query：记录一项配置或数据
): Promise<EntitlementListPage> { // 执行当前业务步骤
  // 组装查询串，空值不写入避免后端把空串当条件
  const params = new URLSearchParams();
  // 关键字
  if (query.q) params.set('q', query.q);
  // 状态过滤
  if (query.status) params.set('status', query.status);
  // 区域过滤：仅在显式给出时写入，缺省由后端按跨区域处理
  if (query.region) params.set('region', query.region);
  // 每页条数
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  // 偏移量
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  // 拼接查询串：无参数时不带问号
  const suffix = params.toString().length > 0 ? `?${params.toString()}` : '';
  // 发起请求，响应已是分页信封
  return request<EntitlementListPage>(`/entitlements${suffix}`, { credential });
} // 代码块结束

/** 权益审计事件视图 */
export interface EntitlementEventView {
  // 事件主键
  id: string;
  // 源状态，首次发放为 null
  from_status: string | null;
  // 目标状态
  to_status: string;
  // 事件原因，无则为 null
  reason: string | null;
  // 操作者（admin / system / user）
  actor: string;
  // 事件时间
  created_at: string;
} // 代码块结束

/** 查询某权益的状态流转审计事件（按写入顺序升序） */
export async function listEntitlementEvents(credential: Credential, entitlementId: string): Promise<EntitlementEventView[]> {
  // 响应包裹 { events }
  const data = await request<{ events: EntitlementEventView[] }>(
    // 目标路径
    `/entitlements/${encodeURIComponent(entitlementId)}/events`,
    // 携带凭证
    { credential },
  ); // 执行当前业务步骤
  // 返回事件数组
  return data.events;
} // 代码块结束

// ── 商城订单（人工结算） ────────────────────────────────────────────────

/** 管理端订单行：跨用户可见，额外带模块与用户展示信息 */
export interface AdminOrderRow {
  // 订单主键
  id: string;
  // 下单用户 ID
  user_id: string;
  // 下单用户展示名（未设置时为空串）
  user_display_name: string | null;
  // 区域
  region: string;
  // 币种
  currency: string;
  // 成交金额（分）
  amount_minor: number;
  // 状态：pending / paid / cancelled
  status: 'pending' | 'paid' | 'cancelled' | string;
  // 结算渠道：manual / alipay / wechat / stripe
  channel: string;
  // 外部渠道交易号（人工结算为空）；与渠道账单对账时按此匹配
  channel_txn_id: string | null;
  // 结算后权益主键
  entitlement_id: string | null;
  // 模块编码
  module_code: string;
  // 模块多语言名
  module_name: Record<string, string>;
  // 下单时间
  created_at: string;
  // 更新时间
  updated_at: string;
  // 结算时间
  paid_at: string | null;
  // 取消时间
  cancelled_at: string | null;
} // 代码块结束

/** 管理端订单分页结果 */
export interface AdminOrderPage {
  // 当前页订单
  orders: AdminOrderRow[];
  // 匹配总数
  total: number;
  // 每页条数
  limit: number;
  // 偏移量
  offset: number;
} // 代码块结束

/** 拉取管理端订单列表：跨用户；status 过滤，q 匹配模块编码或用户 ID */
export function listOrders(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  query: { status?: 'pending' | 'paid' | 'cancelled'; region?: 'cn' | 'global'; q?: string; limit?: number; offset?: number } = {}, // 对象字段 query：记录一项配置或数据
): Promise<AdminOrderPage> { // 执行当前业务步骤
  // 组装查询串，空值不写入
  const params = new URLSearchParams();
  // 状态过滤
  if (query.status) params.set('status', query.status);
  // 区域过滤
  if (query.region) params.set('region', query.region);
  // 关键字：模块编码或用户 ID 片段
  if (query.q) params.set('q', query.q);
  // 每页条数
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  // 偏移量
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  // 无参数时不带问号
  const suffix = params.toString().length > 0 ? `?${params.toString()}` : '';
  // 发起只读请求
  return request<AdminOrderPage>(`/orders/manage${suffix}`, { credential });
} // 代码块结束

/** 导出订单清单 xlsx：与 /orders/manage 同口径过滤，返回二进制 Blob 与建议文件名，由视图触发浏览器下载 */
export async function exportOrders(
  credential: Credential, // 对象字段 credential：记录一项配置或数据
  query: { status?: 'pending' | 'paid' | 'cancelled'; region?: 'cn' | 'global'; q?: string } = {}, // 对象字段 query：记录一项配置或数据
): Promise<{ blob: Blob; filename: string }> { // 执行当前业务步骤
  // 组装过滤查询串，空值不写入
  const params = new URLSearchParams();
  // 状态过滤
  if (query.status) params.set('status', query.status);
  // 区域过滤
  if (query.region) params.set('region', query.region);
  // 关键字：模块编码或用户 ID 片段
  if (query.q) params.set('q', query.q);
  // 无参数时不带问号
  const suffix = params.toString().length > 0 ? `?${params.toString()}` : '';

  // 二进制下载不走统一 request（其强制 text()+JSON 解析），独立 fetch 并注入凭证头
  const headers: Record<string, string> = { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }; // 声明期望 xlsx
  // 凭证注入：token 走自定义头，bearer 走标准 Authorization（与 request 口径一致）
  if (credential.kind === 'token') headers['X-Admin-Token'] = credential.value;
  else headers.Authorization = `Bearer ${credential.value}`; // 兜底分支：前面所有条件均不满足时执行

  const response = await fetch(`${BASE}/orders/export${suffix}`, { headers }); // GET 导出端点

  // 非 2xx：读 JSON 信封抛结构化错误，与列表/结算错误口径一致
  if (!response.ok) {
    const text = await response.text(); // 读取错误正文
    let payload: unknown = null; // 可变变量 payload：运行过程中会被重新赋值
    if (text.length > 0) { // 条件分支：按判断结果选择后续处理路径
      try { payload = JSON.parse(text); } catch { payload = null; } // 非 JSON 按空兜底
    } // 代码块结束
    const body = (payload ?? {}) as { code?: string; message?: string; request_id?: string; details?: unknown }; // 常量 body：保存固定配置或一次性派生值
    throw new ApiError( // 抛出错误：中断当前流程并向上层传递
      response.status, // 执行当前业务步骤
      body.code ?? 'HTTP_ERROR', // 执行当前业务步骤
      body.message ?? `request failed with status ${response.status}`, // 执行当前业务步骤
      body.request_id ?? '', // 执行当前业务步骤
      body.details, // 执行当前业务步骤
    ); // 执行当前业务步骤
  } // 代码块结束

  const blob = await response.blob(); // 读取 xlsx 二进制
  // 从 Content-Disposition 解析建议文件名，缺失时兜底 orders.xlsx
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition); // 常量 match：保存固定配置或一次性派生值
  const filename = match?.[1] ?? 'orders.xlsx'; // 常量 filename：保存固定配置或一次性派生值
  return { blob, filename }; // 返回当前函数的处理结果
} // 代码块结束

/** 结算订单：后端在同一事务内把订单置 paid 并发放订单来源权益 */
export async function settleOrder(credential: Credential, orderId: string, reason?: string): Promise<AdminOrderRow> {
  // 响应包裹 { order }
  const data = await request<{ order: AdminOrderRow }>(
    // 目标路径：订单子资源
    `/orders/${encodeURIComponent(orderId)}/settle`,
    // 写操作，原因可选
    { method: 'POST', body: reason ? { reason } : {}, credential },
  ); // 执行当前业务步骤
  // 返回结算后的订单
  return data.order;
} // 代码块结束

// ── 分类导航（两级分类树 CRUD）──────────────────────────────────────────────

/** 二级条目视图：与后端 /categories/manage 的 items 元素逐字段对齐 */
export interface CategoryItemView {
  // 分类主键（cat:<slug>）
  id: string;
  // 分类标识（全局唯一，参与模块编码与前缀判定）
  slug: string;
  // 中文名
  name: string;
  // 英文名，null 表示未登记（英文站点回落中文）
  name_en: string | null;
  // 同级展示权重
  sort_order: number;
  // 该条目下 active 模块数
  module_count: number;
} // CategoryItemView 结束

/** 一级分类视图：在一级字段之上再带二级条目清单 */
export interface CategoryGroupView extends CategoryItemView {
  // 二级条目列表（按 sort_order 升序）
  items: CategoryItemView[];
} // CategoryGroupView 结束

/** 分类树响应：区域 + 两级树 + 总量 */
export interface CategoryTreeView {
  // 计数口径对应的区域
  region: string;
  // 一级分类列表
  groups: CategoryGroupView[];
  // 一级分类总数
  total_groups: number;
  // 二级条目总数
  total_items: number;
} // CategoryTreeView 结束

/** 读取分类树（管理视图）：需 module:read */
export function listCategories(credential: Credential, region?: string): Promise<CategoryTreeView> {
  // 区域走请求头，缺省由后端按 cn 兜底
  return request<CategoryTreeView>('/categories/manage', { credential, headers: region ? { 'x-region': region } : undefined });
} // listCategories 结束

/** 新建分类入参：parent_slug 缺省即一级分类 */
export interface CategoryCreatePayload {
  // 标识：小写字母开头，可含数字与连字符
  slug: string;
  // 中文名
  name: string;
  // 英文名，选填
  name_en?: string;
  // 父分类标识，二级条目必填且 slug 须以「父 slug-」开头
  parent_slug?: string;
  // 展示权重，缺省追加到同级末尾
  sort_order?: number;
} // CategoryCreatePayload 结束

/** 新建分类：返回 201 与创建后的行 */
export async function createCategory(credential: Credential, payload: CategoryCreatePayload): Promise<CategoryItemView> {
  // POST /categories，响应包裹 { category }
  const data = await request<{ category: CategoryItemView }>('/categories', { method: 'POST', body: payload, credential });
  // 解包分类行
  return data.category;
} // createCategory 结束

/** 编辑分类入参：仅文案与排序可改 */
export interface CategoryUpdatePayload {
  // 中文名，选填
  name?: string;
  // 英文名，传 null 表示清空
  name_en?: string | null;
  // 排序权重，选填
  sort_order?: number;
} // CategoryUpdatePayload 结束

/** 编辑分类：返回 200 与更新后的行 */
export async function updateCategory(credential: Credential, slug: string, payload: CategoryUpdatePayload): Promise<CategoryItemView> {
  // PATCH 指定分类，响应包裹 { category }
  const data = await request<{ category: CategoryItemView }>(`/categories/${encodeURIComponent(slug)}`, {
    // 局部更新
    method: 'PATCH',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
  }); // 代码块结束
  // 解包分类行
  return data.category;
} // updateCategory 结束

/** 删除分类：有子级或有模块引用时后端 409；成功返回删除回执 */
export async function deleteCategory(credential: Credential, slug: string): Promise<{ slug: string; level: number; deleted: boolean }> {
  // DELETE 无请求体，响应包裹 { category }
  const data = await request<{ category: { slug: string; level: number; deleted: boolean } }>(`/categories/${encodeURIComponent(slug)}`, {
    // 删除方法
    method: 'DELETE',
    // 携带凭证
    credential,
  }); // 代码块结束
  // 解包删除回执
  return data.category;
} // deleteCategory 结束

export { request }; // 执行当前业务步骤
export * from './api-ops'; // 执行当前业务步骤
export * from './api-shop-admin'; // 独立商城后台写入面：商品 / 优惠码 / 卡密 / VIP 套餐
