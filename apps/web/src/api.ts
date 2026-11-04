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
}

export interface PlanCatalogItem {
  id: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en: string;
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

const BASE = '/api/v1';
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
};
