/**
 * OAuth 客户端：授权链接构造 + 回调换令牌 + 拉取统一用户资料。
 *
 * 实现分层：
 *   - standard / apple：交给 oauth4webapi 处理 state 校验、PKCE、令牌交换与 id_token 验签；
 *   - wechat / qq / douyin：三家的令牌与资料端点不是标准 OAuth 2.0（query 字符串响应、
 *     需要二次换取 openid、响应包在 data 字段内），用专用适配器逐家实现。
 *
 * 所有对外失败统一抛 AUTH_OAUTH_EXCHANGE_FAILED，避免把上游错误细节泄露给前端。
 */

import jwt from 'jsonwebtoken'; // 仅用于生成 Apple 的 ES256 client_secret JWT
import * as oauth from 'oauth4webapi'; // 标准 OAuth 2.0 / OIDC 客户端（state、PKCE、令牌交换、id_token 验签）
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { OAUTH_HTTP_TIMEOUT_MS } from '../config.js'; // 外部请求超时上限
import type { OAuthProfile, OAuthProviderSpec, ResolvedCredentials } from './providers.js'; // provider 契约

/** 构造授权链接的返回值 */
export interface AuthorizeUrlResult {
  url: string; // 浏览器应跳转的完整地址
  codeVerifier: string | null; // PKCE verifier，回调换令牌时原样带回；不支持的提供方为 null
} // AuthorizeUrlResult 结束

/** 回调换令牌所需的入参 */
export interface ExchangeInput {
  code: string; // 提供方回传的授权码
  state: string; // 提供方回传的 state，用于与发起记录比对
  codeVerifier: string | null; // 发起时生成的 PKCE verifier
  redirectUri: string; // 发起时固化的回调地址
  rawParams: Record<string, string>; // Apple form_post 会带 user 字段，需要一并传入
} // ExchangeInput 结束

/** 把 provider 定义转成 oauth4webapi 需要的 AuthorizationServer 描述 */
function authorizationServerOf(spec: OAuthProviderSpec, creds: ResolvedCredentials): oauth.AuthorizationServer { // 只填用得到的端点
  return { // 库要求 issuer 必填；非 OIDC 提供方填站点根仅作占位
    issuer: spec.issuer, // issuer 标识
    authorization_endpoint: creds.authorizeUrl, // 授权端点（validateAuthResponse 做协议校验时会用到）
    token_endpoint: creds.tokenUrl, // 令牌端点
    ...(creds.profileUrl ? { userinfo_endpoint: creds.profileUrl } : {}), // 有资料端点才填
    ...(creds.jwksUrl ? { jwks_uri: creds.jwksUrl } : {}), // Apple 必须显式给公钥集
  }; // 返回描述对象
} // authorizationServerOf 结束

/** 按 tokenAuth 选择客户端认证方式 */
function clientAuthOf(spec: OAuthProviderSpec, secret: string): oauth.ClientAuth { // basic 或 body 两种
  return spec.tokenAuth === 'basic' ? oauth.ClientSecretBasic(secret) : oauth.ClientSecretPost(secret); // 与提供方要求一致
} // clientAuthOf 结束

/**
 * Apple 的 client_secret 不是固定密钥，而是用 p8 私钥签发的 ES256 JWT：
 * iss=TeamID、sub=ServiceID、aud=appleid.apple.com，有效期不超过 6 个月，这里取 5 分钟。
 */
function appleClientSecret(spec: OAuthProviderSpec, creds: ResolvedCredentials, env: Record<string, string | undefined>): string { // 每次换令牌时现签
  const teamId = (env.MIM_AUTH_APPLE_TEAM_ID ?? '').trim(); // 开发者团队 ID
  const keyId = (env.MIM_AUTH_APPLE_KEY_ID ?? '').trim(); // 私钥 ID
  const privateKey = creds.clientSecret.replace(/\\n/g, '\n').trim(); // 支持把换行写成字面量 \n 的单行配置
  if (!teamId || !keyId || !privateKey) { // 缺任一要素都无法签发
    throw new AppError('AUTH_OAUTH_NOT_CONFIGURED', 'apple sign-in is not fully configured', { missing: ['MIM_AUTH_APPLE_TEAM_ID', 'MIM_AUTH_APPLE_KEY_ID', 'MIM_AUTH_APPLE_PRIVATE_KEY'] }); // 明确缺哪几项
  } // 配置校验结束
  const now = Math.floor(Date.now() / 1000); // 当前秒级时间
  return jwt.sign( // 签发短期 JWT 作为 client_secret
    { iss: teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: creds.clientId }, // Apple 规定的载荷
    privateKey, // p8 私钥
    { algorithm: 'ES256', keyid: keyId }, // Apple 只接受 ES256 + kid
  ); // 签名结束
} // appleClientSecret 结束

/** 带超时的 fetch：外部提供方挂起时必须快速失败，不能拖住整个请求 */
async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> { // 统一入口
  try { // 超时或网络错误都转业务异常
    return await fetch(url, { ...init, signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS) }); // Node 20 原生 fetch
  } catch { // 超时、DNS、TLS 等全部归一
    throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'failed to reach oauth provider'); // 不泄露上游细节
  } // try/catch 结束
} // timedFetch 结束

/** 解析 JSON 响应；非 2xx 或非 JSON 一律视为上游失败 */
async function readJson(response: Response): Promise<Record<string, unknown>> { // 自定义适配器共用
  if (!response.ok) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'oauth provider returned an error status', { status: response.status }); // 状态码回传便于排障
  try { // 解析失败也要归一
    return (await response.json()) as Record<string, unknown>; // 提供方均返回 JSON
  } catch { // 非 JSON 响应
    throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'oauth provider returned a non-JSON body'); // 统一错误码
  } // try/catch 结束
} // readJson 结束

/** 取嵌套字段（抖音响应包在 data 内） */
function nested(raw: Record<string, unknown>, key: string): Record<string, unknown> { // 只处理一层
  const value = raw[key]; // 取目标字段
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}; // 非对象退化为空对象
} // nested 结束

/**
 * 构造授权链接。
 * 标准提供方使用 PKCE(S256)；微信 / QQ / 抖音不支持 PKCE，只带 state。
 */
export async function buildAuthorizeUrl(
  spec: OAuthProviderSpec,
  creds: ResolvedCredentials,
  state: string,
): Promise<AuthorizeUrlResult> {
  const url = new URL(creds.authorizeUrl); // 统一用 URL 对象处理 query 编码（端点已支持环境变量覆盖）
  if (spec.flavor === 'wechat') { // 微信参数名为 appid，且必须带 #wechat_redirect 锚点
    url.searchParams.set('appid', creds.clientId); // 应用 ID
    url.searchParams.set('redirect_uri', creds.redirectUri); // 回调地址
    url.searchParams.set('response_type', 'code'); // 授权码模式
    url.searchParams.set('scope', spec.scopes[0] ?? 'snsapi_login'); // 扫码登录 scope
    url.searchParams.set('state', state); // 防 CSRF
    return { url: `${url.toString()}#wechat_redirect`, codeVerifier: null }; // 锚点是微信硬性要求
  } // 微信分支结束

  if (spec.flavor === 'qq') { // QQ 参数名为 client_id，无 PKCE
    url.searchParams.set('response_type', 'code'); // 授权码模式
    url.searchParams.set('client_id', creds.clientId); // 应用 ID
    url.searchParams.set('redirect_uri', creds.redirectUri); // 回调地址
    url.searchParams.set('state', state); // 防 CSRF
    url.searchParams.set('scope', spec.scopes.join(' ')); // 申请资料权限
    return { url: url.toString(), codeVerifier: null }; // 无 PKCE
  } // QQ 分支结束

  if (spec.flavor === 'douyin') { // 抖音参数名为 client_key
    url.searchParams.set('client_key', creds.clientId); // 应用 key
    url.searchParams.set('response_type', 'code'); // 授权码模式
    url.searchParams.set('scope', spec.scopes.join(',')); // 抖音 scope 用逗号分隔
    url.searchParams.set('redirect_uri', creds.redirectUri); // 回调地址
    url.searchParams.set('state', state); // 防 CSRF
    return { url: url.toString(), codeVerifier: null }; // 无 PKCE
  } // 抖音分支结束

  // 标准 OAuth 2.0 / OIDC：带 PKCE 与 state
  const codeVerifier = oauth.generateRandomCodeVerifier(); // 高熵 verifier
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier); // S256 挑战值
  url.searchParams.set('client_id', creds.clientId); // 客户端 ID
  url.searchParams.set('redirect_uri', creds.redirectUri); // 回调地址
  url.searchParams.set('response_type', 'code'); // 授权码模式
  url.searchParams.set('scope', spec.scopes.join(' ')); // OAuth scope 用空格分隔
  url.searchParams.set('state', state); // 防 CSRF
  url.searchParams.set('code_challenge', codeChallenge); // PKCE 挑战
  url.searchParams.set('code_challenge_method', 'S256'); // 固定 S256
  for (const [key, value] of Object.entries(spec.extraAuthorizeParams ?? {})) { // Apple 的 response_mode 等固定参数
    url.searchParams.set(key, value); // 原样写入
  } // 额外参数循环结束
  return { url: url.toString(), codeVerifier }; // 交出 verifier 供回调使用
} // buildAuthorizeUrl 结束

/** 标准提供方：用 oauth4webapi 换令牌，再按 Bearer 拉资料 */
async function exchangeStandard(
  spec: OAuthProviderSpec,
  creds: ResolvedCredentials,
  env: Record<string, string | undefined>,
  input: ExchangeInput,
): Promise<OAuthProfile> {
  const as = authorizationServerOf(spec, creds); // 端点描述
  const client: oauth.Client = { client_id: creds.clientId }; // 客户端标识
  const secret = spec.flavor === 'apple' ? appleClientSecret(spec, creds, env) : creds.clientSecret; // Apple 动态签发
  const clientAuth = clientAuthOf(spec, secret); // 认证方式
  try { // 上游任意失败都归一为 EXCHANGE_FAILED
    const params = new URLSearchParams(input.rawParams); // Apple form_post 的字段直接来自 body
    params.set('code', input.code); // 确保 code 存在
    params.set('state', input.state); // 确保 state 存在
    const callbackParams = oauth.validateAuthResponse(as, client, params, input.state); // state 必须在发起记录中匹配（路由已查库，这里再校验一次协议层）
    // 生产环境必须 HTTPS；本地与自建测试服务用 http 时显式放行，否则库会直接拒绝非 https 端点
    const allowInsecure = !/^https:/i.test(creds.tokenUrl) && env.NODE_ENV !== 'production'; // 仅非生产允许明文
    const tokenOptions = allowInsecure ? { [oauth.allowInsecureRequests]: true } : undefined; // 库的专用开关
    const tokenResponse = await oauth.authorizationCodeGrantRequest( // 发起令牌请求
      as, // 服务端描述
      client, // 客户端
      clientAuth, // 认证方式
      callbackParams, // 回调参数
      input.redirectUri, // 与授权时逐字一致
      input.codeVerifier ?? oauth.nopkce, // PKCE verifier（Apple 支持，其它 standard 也支持）
      tokenOptions, // 端点协议放行开关
    ); // 请求结束
    const tokens = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse); // 校验响应并取 access_token / id_token
    const claims = oauth.getValidatedIdTokenClaims(tokens); // OIDC 提供方会有 id_token claims；非 OIDC 为 undefined
    if (!creds.profileUrl) { // Apple 没有 userinfo 端点，资料只能来自 id_token
      return spec.mapProfile({}, claims as unknown as Record<string, unknown>); // 交给 provider 映射
    } // 无资料端点分支结束
    const request = await timedFetch(creds.profileUrl, { // 拉取用户资料
      headers: { Authorization: `Bearer ${tokens.access_token}`, ...(spec.profileHeaders ?? {}) }, // Bearer + 提供方要求附加头
    }); // 请求结束
    const raw = await readJson(request); // 解析资料
    // GitHub 的 /user 在用户未公开邮箱时返回 null，需要额外查一次已验证邮箱
    if (spec.id === 'github' && !raw.email) { // 仅 GitHub 需要
      const emails = await timedFetch('https://api.github.com/user/emails', { // 邮箱端点
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'mim-api', Accept: 'application/vnd.github+json' }, // 同样要求 UA
      }); // 请求结束
      const list = (await readJson(emails)) as unknown as Array<Record<string, unknown>>; // 返回数组
      const primary = Array.isArray(list) ? list.find((item) => item.primary === true && item.verified === true) : undefined; // 只认主邮箱且已验证
      if (primary?.email) raw.email = primary.email; // 补进资料，仅存档不用于自动合并
    } // GitHub 邮箱补充分支结束
    return spec.mapProfile(raw, claims as unknown as Record<string, unknown>); // 统一映射
  } catch (error) { // 已归一的错误原样抛，其余包装
    if (error instanceof AppError) throw error; // 保留业务错误码
    throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'oauth token exchange failed', { provider: spec.id }); // 统一错误码
  } // try/catch 结束
} // exchangeStandard 结束

/** 微信：GET 换令牌 → GET 拉资料 */
async function exchangeWechat(spec: OAuthProviderSpec, creds: ResolvedCredentials, input: ExchangeInput): Promise<OAuthProfile> {
  const tokenUrl = new URL(creds.tokenUrl); // 令牌端点
  tokenUrl.searchParams.set('appid', creds.clientId); // 应用 ID
  tokenUrl.searchParams.set('secret', creds.clientSecret); // 应用密钥
  tokenUrl.searchParams.set('code', input.code); // 授权码
  tokenUrl.searchParams.set('grant_type', 'authorization_code'); // 固定授权码模式
  const tokenRaw = await readJson(await timedFetch(tokenUrl.toString())); // 微信令牌端点是 GET
  if (tokenRaw.errcode) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'wechat token rejected', { errcode: tokenRaw.errcode, errmsg: tokenRaw.errmsg }); // 微信用 errcode 表示失败
  const accessToken = String(tokenRaw.access_token ?? ''); // 访问令牌
  const openid = String(tokenRaw.openid ?? ''); // 单应用用户标识
  if (!accessToken || !openid) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'wechat token response is incomplete'); // 关键字段缺失
  const profileUrl = new URL(creds.profileUrl ?? creds.tokenUrl); // 资料端点
  profileUrl.searchParams.set('access_token', accessToken); // 令牌
  profileUrl.searchParams.set('openid', openid); // 用户标识
  profileUrl.searchParams.set('lang', 'zh_CN'); // 中文资料
  const raw = await readJson(await timedFetch(profileUrl.toString())); // 拉资料
  if (raw.errcode) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'wechat profile rejected', { errcode: raw.errcode, errmsg: raw.errmsg }); // 资料接口失败
  return spec.mapProfile(raw); // 统一映射
} // exchangeWechat 结束

/** QQ：GET 换令牌（需 fmt=json）→ 拉 openid → 拉资料 */
async function exchangeQq(spec: OAuthProviderSpec, creds: ResolvedCredentials, input: ExchangeInput): Promise<OAuthProfile> {
  const tokenUrl = new URL(creds.tokenUrl); // 令牌端点
  tokenUrl.searchParams.set('grant_type', 'authorization_code'); // 授权码模式
  tokenUrl.searchParams.set('client_id', creds.clientId); // 应用 ID
  tokenUrl.searchParams.set('client_secret', creds.clientSecret); // 应用密钥
  tokenUrl.searchParams.set('code', input.code); // 授权码
  tokenUrl.searchParams.set('redirect_uri', input.redirectUri); // 回调地址（QQ 要求逐字一致）
  tokenUrl.searchParams.set('fmt', 'json'); // 不指定时返回 query 字符串，解析成本高
  const tokenRaw = await readJson(await timedFetch(tokenUrl.toString())); // 换令牌
  if (tokenRaw.error) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'qq token rejected', { error: tokenRaw.error, error_description: tokenRaw.error_description }); // QQ 失败字段
  const accessToken = String(tokenRaw.access_token ?? ''); // 访问令牌
  if (!accessToken) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'qq token response is incomplete'); // 缺令牌
  const meUrl = new URL('https://graph.qq.com/oauth2.0/me'); // openid 端点
  meUrl.searchParams.set('access_token', accessToken); // 令牌
  meUrl.searchParams.set('fmt', 'json'); // JSON 输出
  const meRaw = await readJson(await timedFetch(meUrl.toString())); // 取 openid
  const openid = String(meRaw.openid ?? ''); // 用户标识
  if (!openid) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'qq openid is missing'); // 缺 openid
  const profileUrl = new URL(creds.profileUrl ?? 'https://graph.qq.com/user/get_user_info'); // 资料端点
  profileUrl.searchParams.set('access_token', accessToken); // 令牌
  profileUrl.searchParams.set('oauth_consumer_key', creds.clientId); // 应用 ID
  profileUrl.searchParams.set('openid', openid); // 用户标识
  const raw = await readJson(await timedFetch(profileUrl.toString())); // 拉资料
  if (raw.ret !== undefined && Number(raw.ret) !== 0) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'qq profile rejected', { ret: raw.ret, msg: raw.msg }); // ret 非 0 即失败
  return spec.mapProfile({ ...raw, openid }); // 把 openid 合并进资料后映射
} // exchangeQq 结束

/** 抖音：POST 换令牌（响应包在 data）→ GET 拉资料（同样包在 data） */
async function exchangeDouyin(spec: OAuthProviderSpec, creds: ResolvedCredentials, input: ExchangeInput): Promise<OAuthProfile> {
  const body = new URLSearchParams({ // 抖音要求表单编码
    client_key: creds.clientId, // 应用 key
    client_secret: creds.clientSecret, // 应用密钥
    code: input.code, // 授权码
    grant_type: 'authorization_code', // 授权码模式
  }); // body 构造结束
  const tokenResponse = await timedFetch(creds.tokenUrl, { // 换令牌
    method: 'POST', // 抖音令牌端点只接受 POST
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, // 表单类型
    body: body.toString(), // 序列化
  }); // 请求结束
  const tokenRaw = await readJson(tokenResponse); // 解析
  const tokenData = nested(tokenRaw, 'data'); // 抖音把业务字段包在 data
  if (tokenRaw.data === undefined && tokenRaw.message) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'douyin token rejected', { message: tokenRaw.message }); // 无 data 视为失败
  const accessToken = String(tokenData.access_token ?? ''); // 访问令牌
  const openId = String(tokenData.open_id ?? tokenData.openid ?? ''); // 用户标识
  if (!accessToken || !openId) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'douyin token response is incomplete', { description: tokenData.description }); // 关键字段缺失
  const profileUrl = new URL(creds.profileUrl ?? creds.tokenUrl); // 资料端点
  profileUrl.searchParams.set('access_token', accessToken); // 令牌
  profileUrl.searchParams.set('open_id', openId); // 用户标识
  const profileRaw = await readJson(await timedFetch(profileUrl.toString())); // 拉资料
  const profileData = nested(profileRaw, 'data'); // 资料也在 data 内
  return spec.mapProfile({ ...profileData, open_id: openId, union_id: tokenData.union_id }); // 合并标识后映射
} // exchangeDouyin 结束

/**
 * 回调换令牌并取资料。
 * 调用方负责先用 state 查库校验一次性与有效期；这里只做协议层交换。
 */
export async function exchangeOAuthCode(
  spec: OAuthProviderSpec,
  creds: ResolvedCredentials,
  env: Record<string, string | undefined>,
  input: ExchangeInput,
): Promise<OAuthProfile> {
  switch (spec.flavor) { // 按实现类型分流
    case 'wechat': // 微信专用
      return exchangeWechat(spec, creds, input); // 交给专用适配器
    case 'qq': // QQ 专用
      return exchangeQq(spec, creds, input); // 交给专用适配器
    case 'douyin': // 抖音专用
      return exchangeDouyin(spec, creds, input); // 交给专用适配器
    default: // 标准 OIDC + Apple
      return exchangeStandard(spec, creds, env, input); // 走通用客户端
  } // switch 结束
} // exchangeOAuthCode 结束
