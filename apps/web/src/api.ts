/**
 * Mim Web API 客户端。
 * 对齐 services/mim-api 契约：Bearer 鉴权、refresh 轮换、写操作强制 Idempotency-Key、
 * 统一错误信封 { code, message, request_id, details }。
 */

import { errorMessage, normalizeLocale } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import type { ErrorCode } from '@mim/core-domain';

export type Region = 'cn' | 'global';
export type Provider = 'phone' | 'email';

export interface UserInfo {
  id: string;
  region: Region;
  status: string;
  display_name: string;
  locale: string;
  timezone: string;
  deletion_scheduled_at?: string | null;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  user: UserInfo;
}

export interface LoginResult extends Session {
  token_type: 'Bearer';
  expires_in: number;
}

export interface MeResponse {
  user: UserInfo;
}

// API 源：默认同源（自建服务器经 nginx 反代）；托管平台（GitHub Pages / Cloudflare / Vercel）
// 通过构建期 VITE_API_ORIGIN 指向生产 API。
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');
const BASE = `${API_ORIGIN}/api/v1`;
const SESSION_KEY = 'mim.session.v1';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let current: Session | null = readSession();
let refreshing: Promise<boolean> | null = null;

export function getSession(): Session | null {
  return current;
}

export function setSession(session: Session): void {
  current = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  current = null;
  localStorage.removeItem(SESSION_KEY);
}

export function currentLocale(): Locale {
  return normalizeLocale(current?.user.locale);
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 保留调用方传入的幂等键，避免重试时生成新键 */
interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  idempotency?: string | false;
}

async function refreshSession(): Promise<boolean> {
  const session = current;
  if (!session) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as LoginResult;
        setSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && current) headers.Authorization = `Bearer ${current.access_token}`;

  let key: string | undefined;
  if (method !== 'GET' && opts.idempotency !== false) {
    key = typeof opts.idempotency === 'string' ? opts.idempotency : newKey();
    headers['Idempotency-Key'] = key;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (res.status === 401 && opts.auth !== false && current && !retried) {
    if (await refreshSession()) {
      return request<T>(path, { ...opts, idempotency: key ?? false }, true);
    }
    clearSession();
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const envelope = (data ?? {}) as {
      code?: string;
      message?: string;
      request_id?: string;
      details?: unknown;
    };
    throw new ApiError(
      envelope.code ?? 'INTERNAL_ERROR',
      envelope.message ?? res.statusText,
      res.status,
      envelope.details,
      envelope.request_id,
    );
  }

  return data as T;
}

export function errorText(locale: Locale, error: unknown): string {
  if (error instanceof ApiError) {
    const translated = errorMessage(locale, error.code as ErrorCode);
    return translated || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

// ---------- 漫剧 AI 剧（comic）共享类型，与 routes/comic.ts payload 一一对应 ----------

export interface ComicProject {
  id: string;
  region: Region;
  title: string;
  synopsis: string | null;
  status: 'draft' | 'storyboarded' | 'generating' | 'rendered' | 'published' | 'archived';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ComicCharacter {
  id: string;
  name: string;
  appearance_prompt: string;
  seed: number | null;
  reference_asset_ids: string[];
  voice_profile: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StoryboardShot {
  index: number;
  description: string;
  dialogue?: string;
  [key: string]: unknown;
}

export interface Storyboard {
  id: string;
  version_no: number;
  shots: StoryboardShot[];
  confirmed_at: string | null;
  created_by: string;
  created_at: string;
}

export type SuggestKind = 'script' | 'storyboard' | 'dialogue' | 'voice';

export interface Suggestion {
  kind: SuggestKind;
  model: string;
  generated_at: string;
  requires_confirmation: boolean;
  items: Array<Record<string, unknown>>;
}

export type JobType = 'text' | 'image' | 'video' | 'tts' | 'compose';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface GenerationJob {
  id: string;
  project_id: string;
  storyboard_id: string | null;
  job_type: JobType;
  status: JobStatus;
  retry_of: string | null;
  cost_estimate_minor: number | null;
  error_code: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export type FilmStatus = 'draft' | 'reviewing' | 'published' | 'archived';

export interface Film {
  id: string;
  project_id: string;
  title: string;
  status: FilmStatus;
  current_version_id: string | null;
  review_note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FilmVersion {
  id: string;
  film_id: string;
  version_no: number;
  object_key: string | null;
  duration_sec: number | null;
  size_bytes: number | null;
  published_at: string | null;
  created_by: string;
  created_at: string;
}

// ---------- media / ai 类型（对齐 routes/media.ts、routes/ai.ts、orchestrator.ts、storage.ts） ----------

export type AssetType = 'image' | 'video' | 'audio' | 'text' | 'final';

export interface GenerationAsset {
  id: string;
  job_id: string | null;
  project_id: string | null;
  asset_type: AssetType;
  object_key: string;
  mime: string;
  duration_ms: number | null;
  size_bytes: number | null;
  checksum: string | null;
  expires_at: string | null;
  created_at: string;
}

/** GET /media/assets 列表项：在产物字段上附带预签名下载地址 */
export interface ListedAsset extends GenerationAsset {
  download_url: string;
}

/** 与 storage.ts PresignedUrl 一致 */
export interface PresignedUrl {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expires_at: string;
}

/** 与 orchestrator.capabilities() 一致（routes/ai.ts 包装为 { ai, storage }） */
export interface AiCapabilities {
  provider: string;
  provider_configured: boolean;
  mock_provider: boolean;
  supported_job_types: JobType[];
  base_url?: string;
  text_model?: string;
  image_model?: string;
  job_cost_limit_minor: number;
  daily_cost_limit_minor: number;
  asset_ttl_days: number;
  storage: { driver: string; configured: boolean };
  worker_enabled: boolean;
  worker_interval_ms: number;
}

/** 与 orchestrator.RunResult 一致 */
export interface RunJobResult {
  job_id: string;
  status: 'succeeded' | 'failed' | 'skipped';
  provider: string;
  asset_id?: string;
  object_key?: string;
  error_code?: string;
  message?: string;
}

// ---------- 站点模块地图（site）类型，对齐 routes/site.ts 与 src/site.ts ----------

// zone 维度概览：laal.top / mixm.top
export interface SiteZone {
  // zone 标识，如 laal.top
  id: string;
  // zone 根域名（与 id 同值）
  apex: string;
  // 该 zone 的默认 A 记录值（IP）
  default_record_value: string;
  // 该 zone 下存在解析记录的模块数量
  count: number;
}

// 分类维度概览：8 个站点分类
export interface SiteCategory {
  // 分类标识，如 tools
  id: string;
  // 分类双语名称
  name: { zh: string; en: string };
  // 该分类下的模块数量
  count: number;
}

// GET /site/overview 的响应结构
export interface SiteOverview {
  // 模块总数（45）
  total: number;
  // 两个 zone 的概览
  zones: SiteZone[];
  // 8 个分类的概览
  categories: SiteCategory[];
}

// 单条 DNS 解析记录（一个模块在某个 zone 下的记录）
export interface SiteRecord {
  // 记录所属 zone
  zone: string;
  // 完整域名，如 api.laal.top / laal.top
  fqdn: string;
  // 记录类型：A 或 CNAME
  record_type: 'A' | 'CNAME';
  // 解析目标：A 为 IP，CNAME 为别名域名
  record_value: string;
  // 生存时间（秒）
  ttl: number;
  // record 级备注第一段（仅差异记录存在）
  label?: string;
  // record 级备注第二段（仅差异记录存在）
  description?: string;
}

// 单个站点模块（主机 + 多 zone 记录聚合）
export interface SiteModuleItem {
  // 主机名（不含 zone），根域名为 '@'
  host: string;
  // 所属分类 id
  category: string;
  // 分类双语名称
  category_name: { zh: string; en: string };
  // 备注第一段：模块定位
  label: string;
  // 备注第二段：站点说明
  description: string;
  // https 入口地址，与 records 一一对应
  urls: string[];
  // 该模块的解析记录明细
  records: SiteRecord[];
}

// GET /site/modules 的响应结构
export interface SiteModuleList {
  // 当前过滤条件下的命中数量
  total: number;
  // 全量模块数量（45）
  module_total: number;
  // 回显生效的过滤条件
  filters: { zone: string | null; category: string | null; q: string | null };
  // 模块列表本体
  items: SiteModuleItem[];
}

export const api = {
  requestCode(region: Region, provider: Provider, identifier: string) {
    return request<{
      delivery: 'dev';
      dev_code: string;
      identifier: string;
      provider: Provider;
      expires_in: number;
      note: string;
    }>('/auth/code', { method: 'POST', body: { region, provider, identifier }, auth: false, idempotency: false });
  },

  loginWithPassword(payload: {
    region: Region;
    provider?: Provider;
    identifier: string;
    password: string;
    device?: { platform: string; name?: string };
  }) {
    return request<LoginResult>('/auth/password', {
      method: 'POST',
      body: { ...payload, device: payload.device ?? { platform: 'web', name: '浏览器' } },
      auth: false,
      idempotency: false,
    });
  },

  login(payload: {
    region: Region;
    provider: Provider;
    identifier: string;
    code: string;
    device?: { platform: string; name?: string };
  }) {
    return request<LoginResult>('/auth/login', {
      method: 'POST',
      body: { ...payload, device: payload.device ?? { platform: 'web', name: '浏览器' } },
      auth: false,
      idempotency: false,
    });
  },

  logout() {
    return request<{ ok: true }>('/auth/logout', {
      method: 'POST',
      body: { refresh_token: current?.refresh_token ?? '' },
      idempotency: false,
    });
  },

  me() {
    return request<MeResponse>('/me');
  },

  updateMe(payload: { display_name?: string; locale?: Locale; timezone?: string }) {
    return request<{ user: UserInfo }>('/me', { method: 'PATCH', body: payload });
  },

  requestDeletion() {
    return request<{ status: string; deletion_scheduled_at: string | null }>('/me/deletion', {
      method: 'POST',
      body: {},
    });
  },

  cancelDeletion() {
    return request<{ status: string }>('/me/cancel-deletion', { method: 'POST', body: {} });
  },

  // ---------- 功能模块商城（catalog）----------

  catalog: {
    getModules() {
      return request<{
        modules: Array<{
          code: string;
          name: Record<string, string>;
          summary: Record<string, string>;
          unlock_mode: 'one_time';
          region: Region;
          status: string;
          requires: string[];
          current_price: { currency: string; amount_minor: number } | null;
        }>;
      }>('/modules', { auth: false, idempotency: false });
    },
    getModule(code: string) {
      return request<{
        code: string;
        name: Record<string, string>;
        summary: Record<string, string>;
        unlock_mode: 'one_time';
        region: Region;
        status: string;
        requires: string[];
        current_price: { currency: string; amount_minor: number } | null;
        price_history: Array<{
          currency: string;
          amount_minor: number;
          effective_from: string;
          effective_to: string | null;
        }>;
      }>(`/modules/${encodeURIComponent(code)}`, { auth: false, idempotency: false });
    },
    unlockModule(module_code: string) {
      return request<{
        entitlement: {
          id: string;
          module_code: string;
          module_name: Record<string, string>;
          status: string;
          expires_at: string | null;
          version: number;
          created_at: string;
        };
      }>('/entitlements', { method: 'POST', body: { module_code } });
    },
    getMyEntitlements() {
      return request<{
        entitlements: Array<{
          id: string;
          module_code: string;
          module_name: Record<string, string>;
          status: string;
          expires_at: string | null;
          created_at: string;
        }>;
      }>('/me/entitlements', { idempotency: false });
    },
  },

  // ---------- 漫剧 AI 剧（comic，契约对齐 services/mim-api/src/routes/comic.ts）----------

  comic: {
    listProjects() {
      return request<{ items: ComicProject[] }>('/comic/projects', { idempotency: false });
    },
    createProject(payload: { title: string; synopsis?: string }) {
      return request<{ project: ComicProject }>('/comic/projects', { method: 'POST', body: payload });
    },
    getProject(id: string) {
      return request<{
        project: ComicProject;
        characters: ComicCharacter[];
        latest_storyboard: Storyboard | null;
      }>(`/comic/projects/${encodeURIComponent(id)}`, { idempotency: false });
    },
    deleteProject(id: string) {
      return request<{ ok: true; project_id: string }>(`/comic/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: {},
      });
    },
    saveStoryboard(id: string, payload: { shots: StoryboardShot[]; confirm?: boolean }) {
      return request<{ storyboard: Storyboard; project_status: string }>(
        `/comic/projects/${encodeURIComponent(id)}/storyboard`,
        { method: 'POST', body: payload },
      );
    },
    addCharacter(
      id: string,
      payload: { name: string; appearance_prompt: string; seed?: number; voice_profile?: string },
    ) {
      return request<{ character: ComicCharacter; created: boolean }>(
        `/comic/projects/${encodeURIComponent(id)}/characters`,
        { method: 'POST', body: payload },
      );
    },
    suggest(id: string, kind: SuggestKind, prompt?: string) {
      return request<{ suggestion: Suggestion }>(
        `/comic/projects/${encodeURIComponent(id)}/suggest`,
        { method: 'POST', body: { kind, prompt: prompt?.trim() || undefined, count: 3 } },
      );
    },
    listJobs(projectId: string) {
      return request<{ items: GenerationJob[] }>(
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`,
        { idempotency: false },
      );
    },
    createJob(
      projectId: string,
      payload: {
        job_type: JobType;
        storyboard_id?: string;
        payload?: Record<string, unknown>;
        cost_estimate_minor?: number;
      },
    ) {
      return request<{ job: GenerationJob; project_status: string }>(
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`,
        { method: 'POST', body: payload },
      );
    },
    getJob(id: string) {
      return request<{ job: GenerationJob }>(`/comic/jobs/${encodeURIComponent(id)}`, {
        idempotency: false,
      });
    },
    jobAction(
      id: string,
      action: 'start' | 'complete' | 'fail' | 'cancel' | 'retry',
      body?: Record<string, unknown>,
    ) {
      return request<{ job: GenerationJob }>(`/comic/jobs/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: body ?? {},
      });
    },
    listFilms(projectId: string) {
      return request<{ items: Film[] }>(`/comic/projects/${encodeURIComponent(projectId)}/films`, {
        idempotency: false,
      });
    },
    createFilm(
      projectId: string,
      payload: { title: string; object_key?: string; duration_sec?: number; size_bytes?: number },
    ) {
      return request<{ film: Film; version: FilmVersion }>(
        `/comic/projects/${encodeURIComponent(projectId)}/films`,
        { method: 'POST', body: payload },
      );
    },
    getFilm(id: string) {
      return request<{ film: Film; versions: FilmVersion[] }>(
        `/comic/films/${encodeURIComponent(id)}`,
        { idempotency: false },
      );
    },
    publishFilm(id: string, action: 'submit-review' | 'publish' | 'archive') {
      return request<{ film: Film }>(`/comic/films/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: {},
      });
    },
    rejectFilm(id: string, reason: string) {
      return request<{ film: Film }>(`/comic/films/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: { reason },
      });
    },
  },

  // ---------- 对象存储（media）：object_key 一律由服务端生成，客户端不拼接 ----------

  media: {
    /** POST /media/presign/upload → 201；服务端校验 asset_type/mime 并生成 object_key */
    presignUpload(input: {
      asset_type: AssetType;
      mime: string;
      project_id?: string;
      size_bytes?: number;
      expires_seconds?: number;
    }) {
      return request<{
        upload: PresignedUrl;
        object_key: string;
        asset_type: AssetType;
        expires_at: string;
      }>('/media/presign/upload', { method: 'POST', body: input });
    },
    /** GET /media/presign/download?object_key=…（服务端为 GET，非 POST） */
    presignDownload(objectKey: string, expiresSeconds?: number) {
      const qs = new URLSearchParams({ object_key: objectKey });
      if (expiresSeconds !== undefined) qs.set('expires_seconds', String(expiresSeconds));
      return request<{ download: PresignedUrl; object_key: string; expires_at: string }>(
        `/media/presign/download?${qs.toString()}`,
      );
    },
    /** GET /media/assets?project_id=… → { items }，每项已附 download_url */
    listAssets(projectId: string, opts: { asset_type?: AssetType; limit?: number } = {}) {
      const qs = new URLSearchParams({ project_id: projectId });
      if (opts.asset_type) qs.set('asset_type', opts.asset_type);
      if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
      return request<{ items: ListedAsset[] }>(`/media/assets?${qs.toString()}`);
    },
  },

  // ---------- AI 编排控制面（ai-orchestrator） ----------

  ai: {
    /** GET /ai/capabilities：provider 能力、成本限额、存储与 worker 状态 */
    capabilities() {
      return request<{ ai: AiCapabilities; storage: { driver: string; configured: boolean } | null }>(
        '/ai/capabilities',
      );
    },
    /** POST /ai/jobs/:id/run：同步触发 queued 任务执行（幂等；非 queued 返回 409） */
    runJob(jobId: string) {
      return request<{ run: RunJobResult; job: GenerationJob }>(
        `/ai/jobs/${encodeURIComponent(jobId)}/run`,
        { method: 'POST', body: {} },
      );
    },
  },

  // ---------- 站点模块地图（site）：DNSPod 备注结构化，公开只读 ----------

  site: {
    /** GET /site/overview：zone / 分类 / 模块计数 */
    overview() {
      return request<SiteOverview>('/site/overview', { auth: false, idempotency: false });
    },
    /** GET /site/modules?zone=&category=&q=：模块列表（可组合过滤） */
    listModules(opts: { zone?: string; category?: string; q?: string } = {}) {
      // 用 URLSearchParams 安全拼接查询串，自动做 encode
      const qs = new URLSearchParams();
      // zone 过滤：存在才写入，避免空参数
      if (opts.zone) qs.set('zone', opts.zone);
      // category 过滤：存在才写入
      if (opts.category) qs.set('category', opts.category);
      // 关键词过滤：存在才写入
      if (opts.q) qs.set('q', opts.q);
      // 生成查询串；无参数时为空串
      const suffix = qs.toString();
      // 有查询串则拼 ?，无则直接请求列表路径
      return request<SiteModuleList>(`/site/modules${suffix ? `?${suffix}` : ''}`, {
        // 公开只读接口，不带鉴权头
        auth: false,
        // 只读 GET，无需幂等键
        idempotency: false,
      });
    },
    /** GET /site/modules/:host：单模块详情 */
    getModule(host: string) {
      return request<{ module: SiteModuleItem }>(`/site/modules/${encodeURIComponent(host)}`, {
        auth: false,
        idempotency: false,
      });
    },
  },
};
