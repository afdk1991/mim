/**
 * 联邦身份 · OIDC 客户端路由。
 *
 *   GET  /api/v1/auth/oidc/status    公开 — 配置状态（configured 仅在四项凭证齐备时为 true）
 *   GET  /api/v1/auth/oidc/login     发起授权 — 生成 state/nonce 并返回授权跳转地址
 *   GET  /api/v1/auth/oidc/callback  IdP 回调 — 换令牌、校验 ID Token、绑定 / 建号、签一次性票据
 *
 * 与既有 /auth/oauth 并存：本路由只对接单一外部 OIDC Provider（联邦 SSO）；
 * 账号绑定复用 oauth_accounts 表，provider='oidc'。SAML 不在本文件实现，边界见交付结论。
 */

import { Router } from 'express'; // 路由容器
import { randomBytes } from 'node:crypto'; // nonce / state 熵源
import { AppError } from '@mim/core-domain'; // 统一业务异常
import {
  buildAuthorizeUrl,
  consumeOidcState,
  createOidcState,
  exchangeOidcCode,
  readOidcConfig,
} from '../federation.js'; // OIDC 协议层
import {
  findOAuthAccount,
  issueLoginTicket,
  upsertOAuthAccount,
} from '../oauth/accounts.js'; // 绑定与票据数据层
import { createUser, readUser } from '../identity.js'; // 统一建号 / 读用户
import { clockOf } from '../domain.js'; // 可注入时钟
import type { OAuthProviderSpec } from '../oauth/providers.js'; // 绑定资料映射类型
import type { ApiDeps, Region, UserRow } from '../types.js'; // 依赖与用户类型

/** oidc 内部 provider 标识；写入 oauth_accounts.provider，不与注册表 12 家冲突 */
const OIDC_PROVIDER = 'oidc';

/** 绑定层只需要 spec.id，其余字段留空；类型断言规避注册表联合类型约束 */
const OIDC_SPEC = { id: OIDC_PROVIDER } as unknown as OAuthProviderSpec;

/** 校验回跳路径：只接受同源相对路径，挡住 //evil.com 开放重定向 */
function safeReturnTo(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value.slice(0, 200);
}

/** 后端对外基址：优先反向代理头，兼容本地直连 */
function backendBaseOf(req: { header: (name: string) => string | undefined; protocol: string }): string {
  const proto = (req.header('x-forwarded-proto') ?? req.protocol ?? 'http').split(',')[0]?.trim() || 'http';
  const host = (req.header('x-forwarded-host') ?? req.header('host') ?? 'localhost').split(',')[0]?.trim() || 'localhost';
  return `${proto}://${host}`;
}

/** 前端基址：MIM_WEB_BASE_URL 优先，缺省同源 */
function webBaseOf(deps: ApiDeps, req: { header: (name: string) => string | undefined; protocol: string }): string {
  const configured = (deps.env.MIM_WEB_BASE_URL ?? '').trim();
  return (configured || backendBaseOf(req)).replace(/\/+$/, '');
}

function regionOf(value: unknown): Region {
  return value === 'global' ? 'global' : 'cn'; // 非法区域回落 cn，与 OAuth 路由口径一致
}

export function createFederationRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  router.get('/auth/oidc/status', (_req, res) => { // 公开配置探测：前端据此决定是否渲染 OIDC 入口
    const config = readOidcConfig(deps.env);
    res.json({ configured: config.configured, issuer: config.configured ? config.issuer : null });
  });

  router.get('/auth/oidc/login', (req, res) => { // 发起授权（登录模式，可匿名）
    const config = readOidcConfig(deps.env);
    if (!config.configured) throw new AppError('AUTH_OAUTH_NOT_CONFIGURED', 'oidc provider is not configured'); // 503 诚实未配置
    const now = clockOf(deps);
    const state = randomBytes(24).toString('base64url'); // 高熵 state
    const nonce = randomBytes(16).toString('base64url'); // 会话绑定 nonce
    const returnTo = safeReturnTo(typeof req.query.return_to === 'string' ? req.query.return_to : undefined);
    createOidcState(deps, state, nonce, regionOf(req.query.region), returnTo, now); // state 一次性落库
    res.status(201).json({ // 与 OAuth 授权端点同款形状：前端拿 authorization_url 跳转
      authorization_url: buildAuthorizeUrl(config, state, nonce),
      state,
      provider: OIDC_PROVIDER,
    });
  });

  router.get('/auth/oidc/callback', async (req, res, _next) => { // IdP 回调
    const webBase = webBaseOf(deps, req);
    const rawReturnTo = safeReturnTo(typeof req.query.return_to === 'string' ? req.query.return_to : undefined);
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!state) throw new AppError('AUTH_OAUTH_STATE_INVALID', 'missing state');
      const now = clockOf(deps);
      const record = consumeOidcState(deps, state, now); // 一次性消费，防重放
      if (!code) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'authorization code is missing');
      const { profile } = await exchangeOidcCode(deps, code, record, record.nonce, now); // 换令牌 + claims 校验

      const existing = findOAuthAccount(deps.db, OIDC_PROVIDER, profile.providerUserId); // 主键身份绑定
      let user: UserRow | undefined;
      if (existing) { // 已绑定：直接登录并刷新资料
        user = readUser(deps.db, existing.user_id);
        if (!user || user.status === 'deleted') throw new AppError('AUTH_UNAUTHORIZED', 'account is not available');
        upsertOAuthAccount(deps.db, user.id, OIDC_SPEC, profile, now);
      } else { // 首次联邦登录：建号 + 绑定同事务
        user = deps.db.transaction(() => {
          const created = createUser(deps.db, { region: record.region, display_name: profile.nickname, now });
          upsertOAuthAccount(deps.db, created.id, OIDC_SPEC, profile, now);
          return created;
        })();
      }

      const ticket = issueLoginTicket(deps.db, user.id, now); // 一次性票据，正式令牌不在地址栏
      const targetUrl = new URL(`${webBase}/signin`);
      targetUrl.searchParams.set('oauth_ticket', ticket);
      if (record.returnTo) targetUrl.searchParams.set('return_to', record.returnTo);
      if (rawReturnTo) targetUrl.searchParams.set('return_to', rawReturnTo);
      res.redirect(302, targetUrl.toString());
    } catch (error) { // 任意失败回登录页带错误码，避免浏览器停在 JSON 信封
      const code = error instanceof AppError ? error.code : 'AUTH_OAUTH_EXCHANGE_FAILED';
      const url = new URL(`${webBase}/signin`);
      url.searchParams.set('oauth_error', code);
      if (rawReturnTo) url.searchParams.set('return_to', rawReturnTo);
      res.redirect(302, url.toString());
    }
  });

  return router; // 交出可挂载路由
}
