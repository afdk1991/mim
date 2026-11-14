/**
 * 联邦身份 · OIDC 客户端（授权码模式）。
 *
 * 能力边界（与「联邦 SSO」裁决对齐）：
 *   - 已落地：授权码模式发起（/authorize）、state/nonce 一次性防重放、回调换 token、
 *     ID Token claims 校验（iss 白名单 / aud / exp / sub / nonce）、绑定既有 oauth_accounts 表；
 *   - 未落地（上生产前必须补）：
 *       1. ID Token 签名验签：当前只校验 claims，未拉取 JWKS 做 RS256/ES256 签名验证。
 *          生产必须经 oauth4webapi 的 getValidatedIdTokenClaims / JWKS 校验，否则 claims 可被伪造；
 *       2. SAML 2.0 联邦：本仓库不实现（成本与边界见交付结论）；
 *       3. 多 issuer 白名单：当前只支持单一 MIM_OIDC_ISSUER，多 IdP 需扩表存储 issuer 白名单。
 *
 * 配置变量（全部缺省为空 → configured=false，登录端点诚实返回 503）：
 *   MIM_OIDC_ISSUER         OIDC Provider 颁发者标识（https://idp.example.com）
 *   MIM_OIDC_CLIENT_ID      客户端 ID
 *   MIM_OIDC_CLIENT_SECRET  客户端密钥
 *   MIM_OIDC_REDIRECT_URI   回调地址，须与 IdP 后台登记逐字一致
 */

import { AppError } from '@mim/core-domain'; // 统一业务异常
import { OAUTH_STATE_TTL_SECONDS, OAUTH_HTTP_TIMEOUT_MS } from './config.js'; // state 有效期与超时
import { sha256 } from './auth.js'; // state 只存摘要
import { clockOf } from './domain.js'; // 可注入时钟
import type { ApiDeps, Region } from './types.js'; // 依赖与区域类型

/** OIDC 运行配置 */
export interface OidcConfig {
  configured: boolean; // 四项凭证齐备才为 true；端点据此诚实返回 503
  issuer: string; // 颁发者标识（白名单基准）
  clientId: string; // 客户端 ID
  clientSecret: string; // 客户端密钥
  redirectUri: string; // 注册回调地址
}

/** 读取 OIDC 配置；env 缺省取 process.env，测试可注入替身环境 */
export function readOidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig {
  const issuer = (env.MIM_OIDC_ISSUER ?? '').trim().replace(/\/+$/, ''); // 去尾斜杠，便于拼端点
  const clientId = (env.MIM_OIDC_CLIENT_ID ?? '').trim(); // 客户端 ID
  const clientSecret = (env.MIM_OIDC_CLIENT_SECRET ?? '').trim(); // 客户端密钥
  const redirectUri = (env.MIM_OIDC_REDIRECT_URI ?? '').trim(); // 回调地址
  const configured = Boolean(issuer && clientId && clientSecret && redirectUri); // 缺一即视为未配置
  return { configured, issuer, clientId, clientSecret, redirectUri };
}

/** 拼接授权页地址（标准 OIDC /authorize） */
export function buildAuthorizeUrl(config: OidcConfig, state: string, nonce: string): string {
  const url = new URL(`${config.issuer}/authorize`); // 颁发者 + 标准路径
  url.searchParams.set('response_type', 'code'); // 授权码模式
  url.searchParams.set('client_id', config.clientId); // 客户端标识
  url.searchParams.set('redirect_uri', config.redirectUri); // 与发起时逐字一致
  url.searchParams.set('scope', 'openid profile email'); // OIDC 最小 scope 集
  url.searchParams.set('state', state); // 防 CSRF
  url.searchParams.set('nonce', nonce); // 防重放 / 会话绑定
  return url.toString();
}

/** 落库一次性 state（复用 oauth_states 表，provider='oidc'；code_verifier 列暂存 nonce） */
export function createOidcState(
  deps: ApiDeps,
  state: string,
  nonce: string,
  region: Region,
  returnTo: string | null,
  now: string = clockOf(deps),
): void {
  deps.db
    .prepare(
      `INSERT INTO oauth_states
         (state_hash, provider, region, mode, link_user_id, code_verifier, redirect_uri, return_to, created_at, expires_at)
       VALUES (?, 'oidc', ?, 'login', NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      sha256(state),
      region,
      nonce, // code_verifier 列复用为 nonce 暂存位
      readOidcConfig(deps.env).redirectUri,
      returnTo,
      now,
      new Date(Date.parse(now) + OAUTH_STATE_TTL_SECONDS * 1000).toISOString(),
    );
}

/** state 记录视图（消费后返回 nonce 与回跳路径） */
export interface OidcStateRecord {
  region: Region;
  nonce: string;
  returnTo: string | null;
  redirectUri: string;
}

/** 一次性消费 state：不存在 / 过期 / 非 oidc 一律拒绝；命中即删，回调不可重放 */
export function consumeOidcState(deps: ApiDeps, state: string, now: string = clockOf(deps)): OidcStateRecord {
  const record = deps.db
    .prepare('SELECT region, code_verifier, redirect_uri, return_to, expires_at FROM oauth_states WHERE state_hash = ? AND provider = ?')
    .get(sha256(state), 'oidc') as
    | { region: Region; code_verifier: string | null; redirect_uri: string; return_to: string | null; expires_at: string }
    | undefined;
  if (!record || Date.parse(record.expires_at) <= Date.parse(now)) {
    throw new AppError('AUTH_OAUTH_STATE_INVALID', 'oidc state is invalid or expired'); // 400，防重放
  }
  deps.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(sha256(state)); // 一次性：无论后续成败都删除
  return { region: record.region, nonce: record.code_verifier ?? '', returnTo: record.return_to, redirectUri: record.redirect_uri };
}

/** ID Token 载荷的最小视图（claims 校验只取必需字段） */
export interface OidcClaims {
  sub: string; // 提供方稳定用户 ID
  email?: string; // 邮箱（仅存档，不用于自动合并）
  name?: string; // 展示名
  picture?: string; // 头像
  iss: string; // 颁发者
  aud: string | string[]; // 受众
  exp: number; // 过期时间戳（秒）
  nonce?: string; // 会话绑定随机串
}

/** base64url 解码 ID Token payload 段；畸形 token 抛 401 */
function decodeIdTokenPayload(idToken: string): OidcClaims {
  const parts = idToken.split('.'); // header.payload.signature
  if (parts.length !== 3) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'id_token is malformed'); // 结构不符
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/'); // base64url → base64
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='); // 补全填充
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')); // 解码 payload
  } catch {
    throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'id_token payload is not valid json'); // 解析失败
  }
  return claims as OidcClaims;
}

/** 校验 ID Token claims：iss 白名单 / aud / exp / nonce / sub */
function validateClaims(claims: OidcClaims, config: OidcConfig, nonce: string, now: string): void {
  if (claims.iss !== config.issuer) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'id_token issuer is not whitelisted', { iss: claims.iss }); // issuer 白名单
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]; // aud 可能是数组
  if (!aud.includes(config.clientId)) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'id_token audience mismatch'); // 受众必须含本客户端
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.parse(now)) {
    throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'id_token expired'); // 过期拒绝
  }
  if (nonce && claims.nonce !== nonce) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'id_token nonce mismatch'); // 绑定防重放
  if (!claims.sub) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'id_token missing sub'); // 无稳定主体无法绑定
}

/** 令牌响应体最小视图 */
interface TokenResponse {
  id_token?: string;
  access_token?: string;
}

/**
 * 用授权码换令牌并校验 ID Token。
 * 注意：签名验签尚未接入 JWKS（见文件头边界）；claims 层校验已完成。
 * 网络请求超时走 OAUTH_HTTP_TIMEOUT_MS，避免 IdP 挂起拖死请求。
 */
export async function exchangeOidcCode(
  deps: ApiDeps,
  code: string,
  stateRecord: OidcStateRecord,
  nonce: string,
  now: string = clockOf(deps),
): Promise<{ claims: OidcClaims; profile: { providerUserId: string; nickname: string; email?: string; avatarUrl?: string; raw: Record<string, unknown> } }> {
  const config = readOidcConfig(deps.env); // 重新读配置，保证端点与凭证一致
  const body = new URLSearchParams({ // 表单编码令牌请求
    grant_type: 'authorization_code', // 授权码模式
    code, // 一次性授权码
    redirect_uri: stateRecord.redirectUri, // 与发起时逐字一致
    client_id: config.clientId, // 客户端标识
    client_secret: config.clientSecret, // 客户端密钥（post 方式）
  });
  const controller = new AbortController(); // 超时控制器
  const timer = setTimeout(() => controller.abort(), OAUTH_HTTP_TIMEOUT_MS); // 超时中止
  try {
    const response = await fetch(`${config.issuer}/token`, { // 标准 OIDC token 端点
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!response.ok) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', `token endpoint responded ${response.status}`); // 非 2xx
    const token = (await response.json()) as TokenResponse; // 解析响应
    if (!token.id_token) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'token response missing id_token'); // 无 id_token
    const claims = decodeIdTokenPayload(token.id_token); // 解 payload
    validateClaims(claims, config, nonce, now); // claims 校验
    const profile = { // 映射统一资料结构
      providerUserId: claims.sub, // 稳定主体
      nickname: claims.name ?? claims.email ?? claims.sub.slice(0, 24), // 展示名优先 name，退回邮箱 / sub 片段
      email: claims.email, // 邮箱仅存档
      avatarUrl: claims.picture, // 头像
      raw: { iss: claims.iss, aud: claims.aud, sub: claims.sub, email: claims.email, name: claims.name }, // 快照
    };
    return { claims, profile };
  } finally {
    clearTimeout(timer); // 释放定时器
  }
}
