// e2e 登录态 helper：经本地 API 注册 / 登录确定性测试账号，把双令牌会话写入前端 localStorage。
// 口径：仓库既有 e2e 无鉴权 fixture；注册默认关闭（MIM_REGISTRATION_ENABLED != 1）时，
// 拿不到登录态就返回 null，由用例 test.skip 写明原因，不假装验证过。
import { request, type APIRequestContext } from '@playwright/test';
import type { Page } from '@playwright/test';

/** 前端会话本地存储键：与 apps/web/src/api/request.ts 的 SESSION_KEY 保持一致 */
export const SESSION_KEY = 'mim.session.v1';

/** 前端会话快照结构（与 isValidSession 类型守卫对齐） */
export interface E2eSession {
  access_token: string; // 短期访问令牌，随请求以 Bearer 发送
  refresh_token: string; // 长期刷新令牌，注册接口一次性下发
  user: { id: string; [key: string]: unknown }; // 用户视图，结构校验以 id 存在为准
}

/** 确定性测试账号：手机号形态 + 字母数字混合口令；重复运行命中 409 后改走口令登录 */
const E2E_REGION = 'cn'; // 地区：国内通道
const E2E_PROVIDER = 'phone'; // 身份通道：手机号
const E2E_IDENTIFIER = '13900009999'; // 固定测试手机号，重复运行可复登
const E2E_PASSWORD = 'e2e-pass-123'; // 固定测试口令（仅 e2e 本地库使用，不进生产）
const E2E_DISPLAY_NAME = 'E2E 测试用户'; // 展示名，便于在库里识别 e2e 账号

/** 是否指向外部已部署环境（外部只读，不在该环境注册 / 造数据） */
export function isExternalTarget(): boolean {
  return Boolean(process.env.MIM_E2E_BASE_URL);
}

/**
 * 注册或登录 e2e 测试账号。
 * @returns 会话快照；注册关闭、账号不可用或网络失败时返回 null（用例据此 skip）
 */
export async function ensureE2eSession(baseURL: string): Promise<E2eSession | null> {
  const ctx: APIRequestContext = await request.newContext({
    baseURL,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  });
  try {
    // 先走自助注册：e2e 专用 API 由 playwright.config 注入 MIM_REGISTRATION_ENABLED=1
    const registerRes = await ctx.post('/api/v1/auth/register', {
      data: {
        region: E2E_REGION,
        provider: E2E_PROVIDER,
        identifier: E2E_IDENTIFIER,
        password: E2E_PASSWORD,
        display_name: E2E_DISPLAY_NAME,
        device: { platform: 'web', name: 'playwright-e2e' },
      },
    });
    if (registerRes.status() === 201) return (await registerRes.json()) as E2eSession;
    // 409 账号已存在 / 403 注册关闭：回退口令登录既有 e2e 账号；仍失败则返回 null
    const loginRes = await ctx.post('/api/v1/auth/password', {
      data: { region: E2E_REGION, provider: E2E_PROVIDER, identifier: E2E_IDENTIFIER, password: E2E_PASSWORD },
    });
    if (loginRes.ok()) return (await loginRes.json()) as E2eSession;
    return null;
  } catch {
    return null; // 网络 / 序列化异常：按拿不到登录态处理，交用例 skip
  } finally {
    await ctx.dispose();
  }
}

/** 把会话写入 localStorage：先同源打开首页，再落盘，避免跨源写入被浏览器拦截 */
export async function seedSessionIntoLocalStorage(page: Page, session: E2eSession): Promise<void> {
  await page.goto('/'); // 先进入同源页面，localStorage 才可用
  await page.evaluate(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session)); // 与前端 setSession 同口径落盘
  }, { key: SESSION_KEY, session });
}

/** 确定性公开圈子 slug：重复运行已存在时直接复用，不重复建圈 */
export const E2E_CIRCLE_SLUG = 'e2e-northstar';
/** 圈子名称：筛选关键词命中用，前后端断言共用 */
export const E2E_CIRCLE_NAME = 'E2E 北极星测试圈';

/** 经登录态 API 确保 e2e 专用公开圈子存在；返回 slug，失败返回 null */
export async function ensureE2eCircle(baseURL: string, token: string): Promise<string | null> {
  const ctx: APIRequestContext = await request.newContext({
    baseURL,
    // 写路由受幂等中间件强制校验（REQUIRE_IDEMPOTENCY=true），必须携带 Idempotency-Key，否则 400
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'e2e-circle-e2e-northstar',
    },
  });
  try {
    const res = await ctx.post('/api/v1/circles', {
      data: {
        slug: E2E_CIRCLE_SLUG,
        name: E2E_CIRCLE_NAME,
        intro: 'Playwright 端到端筛选用例专用公开圈子',
        visibility: 'public',
        join_mode: 'open',
        category: 'e2e',
      },
    });
    if (res.status() === 201) return E2E_CIRCLE_SLUG;
    if (res.status() === 409) return E2E_CIRCLE_SLUG; // 重复运行：圈子已存在，直接复用
    // 其他状态（400 校验 / 403 门槛 / 5xx）：打印状态与信封片段，便于复盘；返回 null 交用例跳过
    console.warn(`[e2e] 建圈未成功：HTTP ${res.status()}，响应 ${(await res.text()).slice(0, 200)}`);
    return null;
  } catch {
    return null;
  } finally {
    await ctx.dispose();
  }
}
