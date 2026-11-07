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
    }
    // 结构不合法按未登录处理
    return null;
  } catch {
    // 任何异常都视为无凭证
    return null;
  }
}

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
    }
    // 写入序列化结果
    window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
  } catch {
    // 存储失败不阻断主流程：本次会话仍持有内存中的凭证
  }
}

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
  }
}

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
}

/** 把任意异常转成可读文案：ApiError 取 message，其余兜底字符串化 */
export function describeError(error: unknown): string {
  // 业务错误直接展示服务端文案
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  // 原生 Error 取其 message
  if (error instanceof Error) return error.message;
  // 其他情况兜底
  return String(error);
}

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
  } else if (options.credential?.kind === 'bearer') {
    // 标准 Bearer 方案
    headers.Authorization = `Bearer ${options.credential.value}`;
  }
  // 合并调用方自定义头：放在凭证注入之后，但不允许覆盖认证头，防止误把身份写丢
  if (options.headers) {
    // 逐个键合并
    for (const [key, value] of Object.entries(options.headers)) {
      // 跳过认证相关头，避免自定义头把凭证顶掉
      if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-admin-token') continue;
      // 写入其余自定义头
      headers[key] = value;
    }
  }
  // 发起请求
  const response = await fetch(`${BASE}${path}`, {
    // 默认 GET
    method: options.method ?? 'GET',
    // 请求头
    headers,
    // 只有带 body 时才序列化，避免 GET 请求出现空字符串体
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  // 读取文本：204 或非 JSON 响应下也能安全处理
  const text = await response.text();
  // 尝试解析 JSON，失败则保留 null
  let payload: unknown = null;
  // 仅在有内容时解析
  if (text.length > 0) {
    // 解析异常说明不是 JSON，按空处理让下面的错误分支兜底
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      // 非 JSON 响应体忽略
      payload = null;
    }
  }
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
    );
  }
  // 空响应体（如 204）按 undefined 处理
  return (payload ?? undefined) as T;
}

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
}

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
}

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
  });
}

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
}

/** 查询当前身份：登录校验与首屏权限门禁都依赖它 */
export function getAdminMe(credential: Credential): Promise<AdminIdentity> {
  // 读取身份端点
  return request<AdminIdentity>('/admin/me', { credential });
}

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
}

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
}

/** 列出全部权限点 */
export async function listPermissions(credential: Credential): Promise<PermissionView[]> {
  // 响应包了一层 permissions 字段
  const data = await request<{ permissions: PermissionView[] }>('/admin/permissions', { credential });
  // 直接取数组，视图无需再解构
  return data.permissions;
}

/** 列出全部角色 */
export async function listRoles(credential: Credential): Promise<RoleView[]> {
  // 响应包了一层 roles 字段
  const data = await request<{ roles: RoleView[] }>('/admin/roles', { credential });
  // 返回数组
  return data.roles;
}

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
}

/** 新建角色：成功返回完整角色视图 */
export async function createRole(credential: Credential, payload: RoleCreatePayload): Promise<RoleView> {
  // POST /admin/roles
  const data = await request<{ role: RoleView }>('/admin/roles', { method: 'POST', body: payload, credential });
  // 解包角色对象
  return data.role;
}

/** 修改角色名称/描述（内置角色后端会拒绝） */
export async function updateRole(
  credential: Credential,
  code: string,
  payload: { name?: Record<string, string>; description?: Record<string, string> },
): Promise<RoleView> {
  // 角色码需编码，防止特殊字符破坏路径
  const data = await request<{ role: RoleView }>(`/admin/roles/${encodeURIComponent(code)}`, {
    // PATCH 局部更新
    method: 'PATCH',
    // 请求体只带需要修改的字段
    body: payload,
    // 携带凭证
    credential,
  });
  // 解包角色
  return data.role;
}

/** 删除角色：被用户引用时后端返回 409 */
export function deleteRole(credential: Credential, code: string): Promise<{ code: string; deleted: boolean }> {
  // DELETE 无请求体
  return request<{ code: string; deleted: boolean }>(`/admin/roles/${encodeURIComponent(code)}`, {
    // 删除方法
    method: 'DELETE',
    // 携带凭证
    credential,
  });
}

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
  });
  // 返回后端落库后的最终权限集合
  return data.permissions;
}

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
}

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
}

/** 分页查询用户：q 同时匹配 ID / 展示名 / 登录标识 */
export function listUsers(
  credential: Credential,
  query: { q?: string; limit?: number; offset?: number } = {},
): Promise<UserListPage> {
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
}

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
}

/** 查询某用户的角色授权列表 */
export async function listUserRoles(credential: Credential, userId: string): Promise<UserRoleRow[]> {
  // 路径参数编码，避免 ID 中的特殊字符破坏路由
  const data = await request<{ user_id: string; roles: UserRoleRow[] }>(
    // 目标路径
    `/admin/users/${encodeURIComponent(userId)}/roles`,
    // 携带凭证
    { credential },
  );
  // 返回授权数组
  return data.roles;
}

/** 授予用户角色：首次 201、重复 200，两者都视为成功 */
export function grantUserRole(
  credential: Credential,
  userId: string,
  roleCode: string,
): Promise<{ user_id: string; role_code: string; granted_by: string; created: boolean }> {
  // POST 到用户角色集合
  return request(`/admin/users/${encodeURIComponent(userId)}/roles`, {
    // 新增语义
    method: 'POST',
    // 角色码请求体
    body: { role_code: roleCode },
    // 携带凭证
    credential,
  });
}

/** 撤销用户角色 */
export function revokeUserRole(
  credential: Credential,
  userId: string,
  roleCode: string,
): Promise<{ user_id: string; role_code: string; deleted: boolean }> {
  // DELETE 精确到单个角色
  return request(`/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleCode)}`, {
    // 删除方法
    method: 'DELETE',
    // 携带凭证
    credential,
  });
}

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
}

/** 模块状态迁移目标，与后端枚举一致 */
export type ModuleStatus = 'draft' | 'active' | 'archived';

/** 列出模块：公开端点，但仍带凭证以便后端按登录用户地区返回 */
export async function listModules(credential: Credential | null): Promise<ModuleView[]> {
  // 响应包了一层 modules
  const data = await request<{ modules: ModuleView[] }>('/modules', { credential });
  // 返回数组
  return data.modules;
}

/** 迁移模块状态：仅允许 draft→active→archived 单向流转 */
export async function updateModuleStatus(
  credential: Credential,
  code: string,
  status: ModuleStatus,
  region?: string,
): Promise<{ code: string; region: string; status: string; updated_at: string }> {
  // PATCH 指定模块状态
  const data = await request<{ module: { code: string; region: string; status: string; updated_at: string } }>(
    // 目标路径
    `/modules/${encodeURIComponent(code)}/status`,
    // 局部更新
    { method: 'PATCH', body: { status, region }, credential },
  );
  // 解包模块
  return data.module;
}

/** 管理端模块视图：在公开视图基础上补排序权重与时间戳 */
export interface ModuleManageView extends ModuleView {
  // 展示排序权重
  sort_order: number;
  // 创建时间
  created_at: string;
  // 更新时间
  updated_at: string;
}

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
}

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
}

/** 管理端模块全量列表：含 draft/archived，支持 q/status 过滤；区域走 x-region 头 */
export async function listModulesManage(
  credential: Credential,
  query: { q?: string; status?: ModuleStatus; region?: string } = {},
): Promise<ModuleManageView[]> {
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
  });
  // 返回模块数组
  return data.modules;
}

/** 模块详情：扁平响应，直接返回顶层对象 */
export function getModule(credential: Credential, code: string, region?: string): Promise<ModuleDetail> {
  // 区域仅作请求头，不影响路径
  return request<ModuleDetail>(`/modules/${encodeURIComponent(code)}`, {
    // 携带凭证
    credential,
    // 显式区域头，缺省时由后端按登录用户地区兜底
    headers: region ? { 'x-region': region } : undefined,
  });
}

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
}

/** 新建模块：成功返回 201 与完整模块视图 */
export async function createModule(credential: Credential, payload: ModuleCreatePayload): Promise<ModuleManageView> {
  // POST /modules，响应包裹 { module }
  const data = await request<{ module: ModuleManageView }>('/modules', { method: 'POST', body: payload, credential });
  // 解包模块
  return data.module;
}

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
}

/** 编辑模块：成功返回 200 与更新后的模块视图 */
export async function updateModule(
  credential: Credential,
  code: string,
  payload: ModuleUpdatePayload,
): Promise<ModuleManageView> {
  // PATCH 指定模块，响应包裹 { module }
  const data = await request<{ module: ModuleManageView }>(`/modules/${encodeURIComponent(code)}`, {
    // 局部更新
    method: 'PATCH',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
  });
  // 解包模块
  return data.module;
}

/** 软删除模块：active 须先归档；重复删除后端回放 200 */
export async function deleteModule(
  credential: Credential,
  code: string,
  region?: string,
): Promise<{ code: string; region: string; deleted: boolean; deleted_at: string }> {
  // 区域走查询串，与后端 query>header>cn 的解析顺序对齐
  const suffix = region ? `?region=${encodeURIComponent(region)}` : '';
  // DELETE 无请求体；响应包裹 { module: { code, region, deleted, deleted_at } }
  const data = await request<{ module: { code: string; region: string; deleted: boolean; deleted_at: string } }>(
    // 目标路径
    `/modules/${encodeURIComponent(code)}${suffix}`,
    // 删除方法 + 凭证
    { method: 'DELETE', credential },
  );
  // 解包模块删除回执
  return data.module;
}

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
}

/** 新增价格行：成功返回 201 与价格行（含 module_code）；region 走 x-region 头定位模块 */
export async function createModulePrice(
  credential: Credential,
  code: string,
  payload: ModulePricePayload,
  region?: string,
): Promise<ModulePrice> {
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
  });
  // 解包价格行
  return data.price;
}

/** 更新价格行：金额、币种、生效窗口均可改；effective_to 传 null 表示转为长期有效 */
export async function updateModulePrice(
  credential: Credential,
  priceId: string,
  // 先从 Partial 中剔除 effective_to 再以可空类型覆盖：直接交集会把 null 收窄掉
  payload: Partial<Omit<ModulePricePayload, 'effective_to'>> & { effective_to?: string | null },
): Promise<ModulePrice> {
  // PUT 精确到价格行，响应包裹 { price }（注意后端回显的是 module_id 而非 module_code）
  const data = await request<{ price: ModulePrice }>(`/modules/prices/${encodeURIComponent(priceId)}`, {
    // 覆盖更新
    method: 'PUT',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
  });
  // 解包价格行
  return data.price;
}

/** 使价格行立即失效：后端软失效 effective_to = now，保留历史留痕；不存在或已过期返回 404 */
export async function deleteModulePrice(
  credential: Credential,
  priceId: string,
): Promise<{ id: string; effective_to: string; expired: boolean }> {
  // DELETE 无请求体，响应包裹 { price: { id, effective_to, expired } }
  const data = await request<{ price: { id: string; effective_to: string; expired: boolean } }>(
    // 目标路径精确到价格行
    `/modules/prices/${encodeURIComponent(priceId)}`,
    // 删除方法 + 凭证
    { method: 'DELETE', credential },
  );
  // 解包价格行失效回执
  return data.price;
}

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
}

/** 手工发放权益：已激活未过期时后端回放现有记录 */
export async function grantEntitlement(
  credential: Credential,
  payload: { user_id: string; module_code: string; region?: string; expires_at?: string },
): Promise<EntitlementView> {
  // POST 发放端点
  const data = await request<{ entitlement: EntitlementView }>('/entitlements/grant', {
    // 新增语义
    method: 'POST',
    // 请求体
    body: payload,
    // 携带凭证
    credential,
  });
  // 解包权益
  return data.entitlement;
}

/** 回收权益：已回收时后端回放当前状态 */
export async function revokeEntitlement(
  credential: Credential,
  entitlementId: string,
  reason?: string,
): Promise<{ id: string; user_id: string; status: string; version: number; updated_at: string }> {
  // POST 回收端点，路径参数为权益 ID
  const data = await request<{ entitlement: { id: string; user_id: string; status: string; version: number; updated_at: string } }>(
    // 目标路径
    `/entitlements/${encodeURIComponent(entitlementId)}/revoke`,
    // 请求体允许空对象
    { method: 'POST', body: reason ? { reason } : {}, credential },
  );
  // 解包权益
  return data.entitlement;
}

/** 权益列表行：在权益视图基础上补模块多语言名、区域与更新时间 */
export interface EntitlementListRow extends EntitlementView {
  // 模块多语言名称（用于列表展示，避免二次查模块表）
  module_name: Record<string, string>;
  // 所属区域
  region: string;
  // 更新时间
  updated_at: string;
}

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
}

/** 分页查询权益：q 匹配用户 ID / 模块码；status 过滤；region 留空表示跨区域 */
export function listEntitlements(
  credential: Credential,
  query: { q?: string; status?: 'active' | 'expired' | 'revoked'; region?: string; limit?: number; offset?: number } = {},
): Promise<EntitlementListPage> {
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
}

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
}

/** 查询某权益的状态流转审计事件（按写入顺序升序） */
export async function listEntitlementEvents(credential: Credential, entitlementId: string): Promise<EntitlementEventView[]> {
  // 响应包裹 { events }
  const data = await request<{ events: EntitlementEventView[] }>(
    // 目标路径
    `/entitlements/${encodeURIComponent(entitlementId)}/events`,
    // 携带凭证
    { credential },
  );
  // 返回事件数组
  return data.events;
}
