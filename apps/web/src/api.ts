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

  // ---------- 漫剧 AI 剧（comic）----------

  comic: {
    listProjects() {
      return request<{
        projects: Array<{
          id: string;
          title: string;
          status: string;
          updated_at: string;
          version: number;
        }>;
      }>('/comic/projects', { idempotency: false });
    },
    createProject(payload: { title: string; synopsis?: string }) {
      return request<{
        id: string;
        title: string;
        status: string;
        created_at: string;
      }>('/comic/projects', { method: 'POST', body: payload });
    },
    getProject(id: string) {
      return request<{
        id: string;
        title: string;
        synopsis: string | null;
        status: string;
        region: Region;
        version: number;
        storyboard?: unknown;
        characters?: unknown[];
        created_at: string;
        updated_at: string;
      }>(`/comic/projects/${encodeURIComponent(id)}`, { idempotency: false });
    },
    updateProject(id: string, payload: { title?: string; synopsis?: string }) {
      return request<{ id: string; updated_at: string }>(
        `/comic/projects/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: payload },
      );
    },
    deleteProject(id: string) {
      return request<{ ok: true }>(`/comic/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    saveStoryboard(id: string, payload: { shots: unknown[]; confirmed?: boolean }) {
      return request<{
        id: string;
        project_id: string;
        version_no: number;
        confirmed_at: string | null;
      }>(`/comic/projects/${encodeURIComponent(id)}/storyboard`, {
        method: 'POST',
        body: payload,
      });
    },
    addCharacter(
      id: string,
      payload: { name: string; appearance_prompt: string; seed?: number; voice_profile?: string },
    ) {
      return request<{
        id: string;
        project_id: string;
        name: string;
        created_at: string;
      }>(`/comic/projects/${encodeURIComponent(id)}/characters`, {
        method: 'POST',
        body: payload,
      });
    },
    suggest(id: string, kind: 'script' | 'storyboard' | 'dialogue' | 'tts', context?: unknown) {
      return request<{
        kind: string;
        model: string;
        suggestion: unknown;
        requires_confirmation: boolean;
      }>(`/comic/projects/${encodeURIComponent(id)}/suggest`, {
        method: 'POST',
        body: { kind, context },
      });
    },
    listJobs(projectId: string) {
      return request<{ jobs: unknown[] }>(
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`,
        { idempotency: false },
      );
    },
    createJob(
      projectId: string,
      payload: { job_type: 'text' | 'image' | 'video' | 'tts' | 'compose'; payload?: unknown },
    ) {
      return request<{ id: string; status: string }>(
        `/comic/projects/${encodeURIComponent(projectId)}/jobs`,
        { method: 'POST', body: payload },
      );
    },
    getJob(id: string) {
      return request<{ id: string; status: string; payload: unknown; result: unknown }>(
        `/comic/jobs/${encodeURIComponent(id)}`,
        { idempotency: false },
      );
    },
    jobAction(id: string, action: 'start' | 'complete' | 'fail' | 'cancel' | 'retry') {
      return request<{ ok: true }>(`/comic/jobs/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      });
    },
    listFilms(projectId: string) {
      return request<{ films: unknown[] }>(
        `/comic/projects/${encodeURIComponent(projectId)}/films`,
        { idempotency: false },
      );
    },
    createFilm(projectId: string, payload: { title: string }) {
      return request<{ id: string; title: string; status: string }>(
        `/comic/projects/${encodeURIComponent(projectId)}/films`,
        { method: 'POST', body: payload },
      );
    },
    getFilm(id: string) {
      return request<unknown>(`/comic/films/${encodeURIComponent(id)}`, { idempotency: false });
    },
    publishFilm(id: string, action: 'submit-review' | 'publish' | 'archive') {
      return request<{ ok: true }>(`/comic/films/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      });
    },
    rejectFilm(id: string, reason: string) {
      return request<{ ok: true }>(`/comic/films/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: { reason },
      });
    },
  },

  // ---------- 对象存储（media）----------

  media: {
    presignUpload(object_key: string) {
      return request<{ upload_url: string; method: string; headers: Record<string, string> }>(
        '/media/presign/upload',
        { method: 'POST', body: { object_key } },
      );
    },
    presignDownload(object_key: string) {
      return request<{ download_url: string; expires_in: number }>('/media/presign/download', {
        method: 'POST',
        body: { object_key },
      });
    },
    listAssets(project_id: string) {
      return request<{ assets: unknown[] }>(`/media/assets?project_id=${encodeURIComponent(project_id)}`, {
        method: 'GET',
        idempotency: false,
      });
    },
  },
};
