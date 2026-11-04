/**
 * Mim Web API 客户端。
 * 对齐 services/mim-api 契约：Bearer 鉴权、refresh 轮换、写操作强制 Idempotency-Key、
 * 统一错误信封 { code, message, request_id, details }。
 */

import { errorMessage, normalizeLocale } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import type { ErrorCode, PlanFeatures } from '@mim/core-domain';

export type Region = 'cn' | 'global';
export type Provider = 'phone' | 'email';
export type ProjectRole = 'owner' | 'editor' | 'viewer';
export type TaskStatus = 'todo' | 'done';
export type BillingCycle = 'monthly' | 'yearly';

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

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  role: ProjectRole;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  parent_id: string | null;
  level: 1 | 2;
  title: string;
  description: string;
  status: TaskStatus;
  due_date: string | null;
  priority: number;
  version: number;
  seq: number;
  client_updated_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardTask extends Task {
  project_name: string;
}

export interface Member {
  user_id: string;
  role: ProjectRole;
  display_name: string;
  region: Region;
  created_at: string;
}

export interface Invitation {
  id: string;
  project_id: string;
  region: Region;
  provider: Provider;
  identifier: string;
  role: 'editor' | 'viewer';
  token: string;
  status: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface SubscriptionView {
  id: string;
  plan_id: string;
  status: string;
  cycle: BillingCycle;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: number;
  version: number;
}

export interface MeResponse {
  user: UserInfo;
  plan: {
    id: string;
    name_zh: string;
    name_en: string;
    features: PlanFeatures;
    source: string;
    expires_at: string | null;
  };
  subscription: {
    plan_id: string;
    status: string;
    cycle: BillingCycle;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: number;
  } | null;
  counts: { projects: number };
}

export interface PlanCatalogItem {
  id: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en: string;
  features: PlanFeatures;
  currency: string;
  prices: { monthly: number | null; yearly: number | null };
  configured: boolean;
}

export interface Order {
  id: string;
  plan_id: string;
  region: Region;
  cycle: BillingCycle;
  currency: string;
  amount_minor: number;
  status: string;
  driver: string;
  paid_at: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  order_id: string;
  amount_minor: number;
  currency: string;
  created_at: string;
}

export interface DashboardResponse {
  date: string;
  timezone: string;
  generated_at: string;
  today: DashboardTask[];
  next_7_days: DashboardTask[];
  overdue: DashboardTask[];
  unscheduled: DashboardTask[];
  completed_today: DashboardTask[];
  counts: {
    today: number;
    next_7_days: number;
    overdue: number;
    unscheduled: number;
    completed_today: number;
  };
}

const BASE = '/api/v1';
const SESSION_KEY = 'mim.session.v1';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

/** 下载类接口必须携带 Bearer，因此走 fetch + blob，而不是 <a href> */
async function requestBlob(path: string, retried = false): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (current) headers.Authorization = `Bearer ${current.access_token}`;
  const res = await fetch(`${BASE}${path}`, { headers });

  if (res.status === 401 && current && !retried) {
    if (await refreshSession()) return requestBlob(path, true);
    clearSession();
  }
  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = res.statusText;
    try {
      const envelope = (await res.json()) as { code?: string; message?: string };
      code = envelope.code ?? code;
      message = envelope.message ?? message;
    } catch {
      /* 保持默认值 */
    }
    throw new ApiError(code, message, res.status);
  }
  return res.blob();
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

  plans(region: Region) {
    return request<{ region: Region; items: PlanCatalogItem[] }>(`/plans?region=${region}`, {
      auth: false,
    });
  },

  subscriptionCurrent() {
    return request<{
      plan_id: string;
      source: string;
      expires_at: string | null;
      features: PlanFeatures;
      subscription: SubscriptionView | null;
    }>('/subscriptions/current');
  },

  checkout(planId: string, cycle: BillingCycle) {
    return request<{ order: Order; subscription: SubscriptionView | null }>(
      '/subscriptions/checkout',
      { method: 'POST', body: { plan_id: planId, cycle, driver: 'mock' } },
    );
  },

  cancelSubscription() {
    return request<{ subscription: SubscriptionView | null }>('/subscriptions/cancel', {
      method: 'POST',
      body: {},
    });
  },

  orders() {
    return request<{ items: Order[] }>('/orders');
  },

  invoices() {
    return request<{ items: Invoice[] }>('/invoices');
  },

  dashboard() {
    return request<DashboardResponse>('/dashboard');
  },

  projects() {
    return request<{ items: Project[] }>('/projects');
  },

  createProject(payload: { name: string; description?: string }) {
    return request<{ project: Project }>('/projects', { method: 'POST', body: payload });
  },

  project(projectId: string) {
    return request<{ project: Project }>(`/projects/${projectId}`);
  },

  updateProject(projectId: string, payload: { name?: string; description?: string; version: number }) {
    return request<{ project: Project }>(`/projects/${projectId}`, { method: 'PATCH', body: payload });
  },

  archiveProject(projectId: string) {
    return request<{ project: Project }>(`/projects/${projectId}/archive`, { method: 'POST', body: {} });
  },

  deleteProject(projectId: string) {
    return request<{ status: string; id: string; cascaded_tasks: number; cascaded_subtasks: number }>(
      `/projects/${projectId}`,
      { method: 'DELETE' },
    );
  },

  members(projectId: string) {
    return request<{ items: Member[] }>(`/projects/${projectId}/members`);
  },

  removeMember(projectId: string, userId: string) {
    return request<{ status: string; id: string }>(`/projects/${projectId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  invitations(projectId: string) {
    return request<{ items: Invitation[] }>(`/projects/${projectId}/invitations`);
  },

  createInvitation(projectId: string, payload: { provider: Provider; identifier: string; role: 'editor' | 'viewer' }) {
    return request<{ invitation: Invitation }>(`/projects/${projectId}/invitations`, {
      method: 'POST',
      body: payload,
    });
  },

  revokeInvitation(projectId: string, invitationId: string) {
    return request<{ status: string; id: string }>(
      `/projects/${projectId}/invitations/${invitationId}`,
      { method: 'DELETE' },
    );
  },

  acceptInvitation(token: string) {
    const clean = token.trim();
    const matched = clean.match(UUID_RE);
    const value = matched ? matched[0] : clean;
    return request<{ project_id: string; role: ProjectRole }>(`/invitations/${value}/accept`, {
      method: 'POST',
      body: {},
    });
  },

  tasks(projectId: string) {
    return request<{ items: Task[] }>(`/projects/${projectId}/tasks`);
  },

  /** FR-03 增量同步：按 task_events.seq 拉取游标之后的事件（前端 4s 轮询） */
  syncChanges(projectId: string, sinceSeq: number) {
    return request<{
      items: Array<{ seq: number; type: string; task_id: string; project_id: string }>;
      next_seq: number;
      has_more: boolean;
    }>(`/sync/changes?project_id=${projectId}&since_seq=${sinceSeq}`);
  },

  createTask(
    projectId: string,
    payload: { title: string; description?: string; parent_id?: string; due_date?: string; priority?: number },
  ) {
    return request<{ task: Task }>(`/projects/${projectId}/tasks`, { method: 'POST', body: payload });
  },

  updateTask(
    taskId: string,
    payload: {
      title?: string;
      description?: string;
      due_date?: string | null;
      priority?: number;
      status?: TaskStatus;
      version: number;
      client_updated_at: string;
    },
  ) {
    return request<{ task: Task }>(`/tasks/${taskId}`, { method: 'PATCH', body: payload });
  },

  setTaskStatus(taskId: string, payload: { status: TaskStatus; version: number; client_updated_at: string }) {
    return request<{ task: Task }>(`/tasks/${taskId}/status`, { method: 'POST', body: payload });
  },

  deleteTask(taskId: string) {
    return request<{ status: string; id: string; cascaded_children: number }>(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
  },

  createExport(projectId: string) {
    return request<{ export: { id: string; status: string; created_at: string }; rows: number }>(
      `/projects/${projectId}/exports`,
      { method: 'POST', body: {} },
    );
  },

  exportDownload(exportId: string) {
    return requestBlob(`/exports/${exportId}/download`);
  },
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
