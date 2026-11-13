/**
 * 第三方登录 provider 注册表。
 *
 * 设计原则：把「端点 / scope / 凭证环境变量 / 资料映射」集中在一张表里，
 * 路由与客户端只按 id 查表，新增提供方只需在此追加一条定义，不改流程代码。
 *
 * 三类实现：
 *   - standard：标准 OAuth 2.0 / OIDC（GitHub / Gitee / GitLab / Google / Microsoft），走 oauth4webapi；
 *   - apple：OIDC + form_post 回调 + ES256 client_secret（Apple 特有）；
 *   - wechat / qq / douyin：国内平台协议非标准（嵌套 data、query-string 响应、需二次拉 openid），
 *     由 client.ts 的专用适配器处理。
 */

import type { Region } from '../types.js'; // 地区类型，用于新账号归属与入口分区

/** 支持的全部第三方提供方标识；新增提供方必须同步前端文案与测试 */
export type OAuthProviderId =
  | 'github' // GitHub OAuth 应用
  | 'gitee' // Gitee 码云
  | 'gitlab' // GitLab.com 站点
  | 'google' // Google OIDC 登录
  | 'apple' // Apple 登录
  | 'microsoft' // Microsoft Entra ID / 个人账号
  | 'wechat' // 微信开放平台网站应用扫码
  | 'qq' // QQ 互联
  | 'douyin' // 抖音开放平台
  | 'weibo' // 微博开放平台
  | 'baidu' // 百度账号授权
  | 'alipay' // 支付宝授权登录
  | 'facebook' // Facebook 登录
  | 'twitter'; // Twitter（X）OAuth2 登录

/** 协议实现类型：决定走通用客户端还是专用适配器 */
export type OAuthFlavor = 'standard' | 'apple' | 'wechat' | 'qq' | 'douyin' | 'weibo' | 'alipay';

/** 单个 provider 的静态定义 */
export interface OAuthProviderSpec {
  id: OAuthProviderId; // 路由路径段与 oauth_accounts.provider 的取值
  label: string; // 中文展示名
  labelEn: string; // 英文展示名
  region: Region | 'both'; // 可用区域：cn 仅国内、global 仅海外、both 两边都可
  flavor: OAuthFlavor; // 协议实现类型
  issuer: string; // OIDC issuer；非 OIDC 提供方填站点根，仅用于库内必填字段
  authorizeUrl: string; // 授权页地址
  tokenUrl: string; // 令牌端点
  profileUrl?: string; // 用户资料端点（Apple 无此端点，资料取 id_token）
  jwksUrl?: string; // OIDC 公钥集（Apple 必须显式给出）
  scopes: string[]; // 默认 scope
  tokenAuth: 'basic' | 'post'; // 令牌端点的客户端认证方式
  extraAuthorizeParams?: Record<string, string>; // 授权页额外固定参数（如 Apple 的 response_mode）
  profileHeaders?: Record<string, string>; // 拉资料时附加请求头（GitHub 要求 User-Agent）
  // 凭证环境变量候选名：按顺序取第一个非空值，兼容既有模板命名
  env: { clientId: string[]; clientSecret: string[]; redirectUri?: string[] };
  // 资料映射：把提供方原始 JSON 转成统一结构
  mapProfile: (raw: Record<string, unknown>, claims?: Record<string, unknown>) => OAuthProfile;
} // OAuthProviderSpec 结束

/** 统一资料结构：账号绑定只依赖这些字段，提供方差异在 mapProfile 内消化 */
export interface OAuthProfile {
  providerUserId: string; // 提供方侧稳定 ID，绑定唯一键的一半
  unionId?: string; // 跨应用统一 ID（微信 unionid / 抖音 unionid）
  nickname: string; // 昵称，空串表示提供方未返回
  avatarUrl?: string; // 头像
  email?: string; // 邮箱（不用于自动合并账号，仅存档）
  raw: Record<string, unknown>; // 原始资料快照，便于排障
} // OAuthProfile 结束

/** 字符串字段安全取值：提供方返回的 JSON 字段类型不可信，统一转成字符串 */
function str(value: unknown): string { // 只接受字符串与数字，其余一律空串
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''; // 避免把 object 塞进昵称列
} // str 结束

/** 从多个候选字段里取第一个非空值，兼容同一平台不同版本的字段命名 */
function first(raw: Record<string, unknown>, keys: string[]): string { // 按候选顺序短路
  for (const key of keys) { // 逐个尝试
    const value = str(raw[key]); // 统一转字符串
    if (value) return value; // 命中即返回
  } // 循环结束
  return ''; // 全空返回空串
} // first 结束

/**
 * provider 定义清单（顺序即前端按钮展示顺序）：
 * 国内优先微信 / QQ，海外优先 GitHub / Google，符合各自用户习惯。
 */
export const OAUTH_PROVIDERS: readonly OAuthProviderSpec[] = [
  { // GitHub：全球开发者最常用的第三方入口，中国区也可用
    id: 'github', // 路由段 /auth/oauth/github
    label: 'GitHub', // 展示名
    labelEn: 'GitHub', // 英文展示名
    region: 'both', // 双区可用
    flavor: 'standard', // 标准 OAuth 2.0
    issuer: 'https://github.com', // 非 OIDC，仅占位
    authorizeUrl: 'https://github.com/login/oauth/authorize', // 授权页
    tokenUrl: 'https://github.com/login/oauth/access_token', // 令牌端点
    profileUrl: 'https://api.github.com/user', // 资料端点
    scopes: ['read:user', 'user:email'], // 读资料 + 读邮箱
    tokenAuth: 'post', // GitHub 接受 body 传 client_secret
    profileHeaders: { 'User-Agent': 'mim-api', Accept: 'application/vnd.github+json' }, // GitHub 强制 UA
    env: { clientId: ['MIM_AUTH_GITHUB_CLIENT_ID'], clientSecret: ['MIM_AUTH_GITHUB_CLIENT_SECRET'] }, // 凭证变量
    mapProfile: (raw) => ({ // GitHub 字段：id / login / name / avatar_url / email
      providerUserId: first(raw, ['id', 'node_id']), // 数字 id 转字符串
      nickname: first(raw, ['name', 'login']), // 未设置姓名时退回登录名
      avatarUrl: first(raw, ['avatar_url']) || undefined, // 头像
      email: first(raw, ['email']) || undefined, // 公开邮箱可能为空
      raw, // 原始快照
    }), // mapProfile 结束
  }, // GitHub 定义结束
  { // Gitee：国内开源社区，中国区主力入口
    id: 'gitee', // 路由段
    label: 'Gitee', // 展示名
    labelEn: 'Gitee', // 英文展示名
    region: 'cn', // 仅中国区展示
    flavor: 'standard', // 标准 OAuth 2.0
    issuer: 'https://gitee.com', // 占位 issuer
    authorizeUrl: 'https://gitee.com/oauth/authorize', // 授权页
    tokenUrl: 'https://gitee.com/oauth/token', // 令牌端点
    profileUrl: 'https://gitee.com/api/v5/user', // 资料端点
    scopes: ['user_info', 'emails'], // 读资料与邮箱
    tokenAuth: 'post', // body 传 secret
    env: { clientId: ['MIM_AUTH_GITEE_CLIENT_ID'], clientSecret: ['MIM_AUTH_GITEE_CLIENT_SECRET'] }, // 凭证
    mapProfile: (raw) => ({ // Gitee 字段：id / name / login / avatar_url / email
      providerUserId: first(raw, ['id']), // 用户 id
      nickname: first(raw, ['name', 'login']), // 姓名优先
      avatarUrl: first(raw, ['avatar_url']) || undefined, // 头像
      email: first(raw, ['email']) || undefined, // 邮箱
      raw, // 原始快照
    }), // mapProfile 结束
  }, // Gitee 定义结束
  { // GitLab：海外代码托管，global 区可用
    id: 'gitlab', // 路由段
    label: 'GitLab', // 展示名
    labelEn: 'GitLab', // 英文展示名
    region: 'global', // 仅海外区
    flavor: 'standard', // 标准 OAuth 2.0
    issuer: 'https://gitlab.com', // 占位 issuer
    authorizeUrl: 'https://gitlab.com/oauth/authorize', // 授权页
    tokenUrl: 'https://gitlab.com/oauth/token', // 令牌端点
    profileUrl: 'https://gitlab.com/api/v4/user', // 资料端点
    scopes: ['read_user'], // 只读用户资料
    tokenAuth: 'post', // body 传 secret
    env: { clientId: ['MIM_AUTH_GITLAB_CLIENT_ID'], clientSecret: ['MIM_AUTH_GITLAB_CLIENT_SECRET'] }, // 凭证
    mapProfile: (raw) => ({ // GitLab 字段：id / name / username / avatar_url / email
      providerUserId: first(raw, ['id']), // 用户 id
      nickname: first(raw, ['name', 'username']), // 姓名优先
      avatarUrl: first(raw, ['avatar_url']) || undefined, // 头像
      email: first(raw, ['email']) || undefined, // 邮箱
      raw, // 原始快照
    }), // mapProfile 结束
  }, // GitLab 定义结束
  { // Google：OIDC 标准实现
    id: 'google', // 路由段
    label: 'Google', // 展示名
    labelEn: 'Google', // 英文展示名
    region: 'global', // 仅海外区
    flavor: 'standard', // OIDC 协议
    issuer: 'https://accounts.google.com', // OIDC 签发方
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', // 授权页
    tokenUrl: 'https://oauth2.googleapis.com/token', // 令牌端点
    profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo', // 资料端点
    scopes: ['openid', 'profile', 'email'], // OIDC 基础 scope
    tokenAuth: 'post', // body 传 secret
    env: { clientId: ['MIM_AUTH_GOOGLE_CLIENT_ID'], clientSecret: ['MIM_AUTH_GOOGLE_CLIENT_SECRET'] }, // 凭证
    mapProfile: (raw) => ({ // Google 字段：sub / name / picture / email
      providerUserId: first(raw, ['sub']), // OIDC 主体标识
      nickname: first(raw, ['name']), // 姓名
      avatarUrl: first(raw, ['picture']) || undefined, // 头像
      email: first(raw, ['email']) || undefined, // 邮箱
      raw, // 原始快照
    }), // mapProfile 结束
  }, // Google 定义结束
  { // Microsoft：Entra ID / 个人账号，资料端点与 scope 与 OIDC 不同
    id: 'microsoft', // 路由段
    label: 'Microsoft', // 展示名
    labelEn: 'Microsoft', // 英文展示名
    region: 'global', // 仅海外区
    flavor: 'standard', // OAuth 2.0 协议
    issuer: 'https://login.microsoftonline.com/common/v2.0', // 多租户 issuer
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', // 授权页
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', // 令牌端点
    profileUrl: 'https://graph.microsoft.com/v1.0/me', // Graph 资料端点
    scopes: ['openid', 'profile', 'email', 'User.Read'], // 读基本资料
    tokenAuth: 'post', // body 传 secret
    env: { clientId: ['MIM_AUTH_MICROSOFT_CLIENT_ID'], clientSecret: ['MIM_AUTH_MICROSOFT_CLIENT_SECRET'] }, // 凭证
    mapProfile: (raw) => ({ // Graph 字段：id / displayName / mail / userPrincipalName
      providerUserId: first(raw, ['id']), // 对象 id
      nickname: first(raw, ['displayName']), // 显示名
      email: first(raw, ['mail', 'userPrincipalName']) || undefined, // 邮箱或 UPN
      raw, // 原始快照
    }), // mapProfile 结束
  }, // Microsoft 定义结束
  { // Apple：OIDC + form_post，资料主要来自 id_token
    id: 'apple', // 路由段
    label: 'Apple', // 展示名
    labelEn: 'Apple', // 英文展示名
    region: 'global', // 仅海外区
    flavor: 'apple', // 专用实现
    issuer: 'https://appleid.apple.com', // OIDC 签发方
    authorizeUrl: 'https://appleid.apple.com/auth/authorize', // 授权页
    tokenUrl: 'https://appleid.apple.com/auth/token', // 令牌端点
    jwksUrl: 'https://appleid.apple.com/auth/keys', // 公钥集
    scopes: ['name', 'email'], // 只申请姓名与邮箱
    tokenAuth: 'post', // client_secret 以表单字段提交
    extraAuthorizeParams: { response_mode: 'form_post' }, // Apple 要求 form_post 才能拿到 name/email
    env: { // Apple 需要四个变量拼 client_secret JWT
      clientId: ['MIM_AUTH_APPLE_SERVICE_ID'], // Service ID 服务标识
      clientSecret: ['MIM_AUTH_APPLE_PRIVATE_KEY'], // p8 私钥内容（\n 转义后）
      redirectUri: ['MIM_AUTH_APPLE_REDIRECT_URI'], // 可与默认回调不同
    }, // env 结束
    mapProfile: (_raw, claims) => ({ // Apple 资料来自 id_token claims
      providerUserId: first(claims ?? {}, ['sub']), // 主体标识
      nickname: first(claims ?? {}, ['name', 'email']), // 只有首次授权可能带 name
      email: first(claims ?? {}, ['email']) || undefined, // 邮箱
      raw: { ...(claims ?? {}) }, // 快照只存 claims，避免存整枚 id_token
    }), // mapProfile 结束
  }, // Apple 定义结束
  { // 微信：开放平台网站应用扫码登录
    id: 'wechat', // 路由段
    label: '微信', // 展示名
    labelEn: 'WeChat', // 英文展示名
    region: 'cn', // 仅中国区
    flavor: 'wechat', // 专用适配器
    issuer: 'https://open.weixin.qq.com', // 占位
    authorizeUrl: 'https://open.weixin.qq.com/connect/qrconnect', // 扫码授权页
    tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token', // 令牌端点
    profileUrl: 'https://api.weixin.qq.com/sns/userinfo', // 资料端点
    scopes: ['snsapi_login'], // 扫码登录固定 scope
    tokenAuth: 'post', // 微信按 query 传参，tokenAuth 字段在此仅占位
    env: { clientId: ['MIM_AUTH_WECHAT_APP_ID'], clientSecret: ['MIM_AUTH_WECHAT_APP_SECRET'], redirectUri: ['MIM_AUTH_WECHAT_REDIRECT_URI'] }, // 兼容既有模板
    mapProfile: (raw) => ({ // 微信字段：openid / unionid / nickname / headimgurl
      providerUserId: first(raw, ['openid']), // 单应用内唯一
      unionId: first(raw, ['unionid']) || undefined, // 跨应用唯一
      nickname: first(raw, ['nickname']), // 昵称
      avatarUrl: first(raw, ['headimgurl']) || undefined, // 头像
      raw, // 原始快照
    }), // mapProfile 结束
  }, // 微信定义结束
  { // QQ：QQ 互联
    id: 'qq', // 路由段
    label: 'QQ', // 展示名
    labelEn: 'QQ', // 英文展示名
    region: 'cn', // 仅中国区
    flavor: 'qq', // 专用适配器（需二次拉 openid）
    issuer: 'https://graph.qq.com', // 占位
    authorizeUrl: 'https://graph.qq.com/oauth2.0/authorize', // 授权页
    tokenUrl: 'https://graph.qq.com/oauth2.0/token', // 令牌端点
    profileUrl: 'https://graph.qq.com/user/get_user_info', // 资料端点
    scopes: ['get_user_info'], // 读资料
    tokenAuth: 'post', // 占位
    env: { clientId: ['MIM_AUTH_QQ_APP_ID'], clientSecret: ['MIM_AUTH_QQ_APP_KEY'], redirectUri: ['MIM_AUTH_QQ_REDIRECT_URI'] }, // 凭证
    mapProfile: (raw) => ({ // QQ 字段：openid 由 /me 端点单独取，这里合并进 raw
      providerUserId: first(raw, ['openid']), // 由适配器注入
      nickname: first(raw, ['nickname']), // 昵称
      avatarUrl: first(raw, ['figureurl_qq_2', 'figureurl_qq_1']) || undefined, // 高清头像优先
      raw, // 原始快照
    }), // mapProfile 结束
  }, // QQ 定义结束
  { // 抖音：开放平台网站应用
    id: 'douyin', // 路由段
    label: '抖音', // 展示名
    labelEn: 'Douyin', // 英文展示名
    region: 'cn', // 仅中国区
    flavor: 'douyin', // 专用适配器（响应包在 data 内）
    issuer: 'https://open.douyin.com', // 占位
    authorizeUrl: 'https://open.douyin.com/platform/oauth/connect/', // 授权页
    tokenUrl: 'https://open.douyin.com/oauth/access_token/', // 令牌端点
    profileUrl: 'https://open.douyin.com/oauth/userinfo/', // 资料端点
    scopes: ['user_info'], // 读资料
    tokenAuth: 'post', // 占位
    env: { clientId: ['MIM_AUTH_DOUYIN_CLIENT_KEY'], clientSecret: ['MIM_AUTH_DOUYIN_CLIENT_SECRET'], redirectUri: ['MIM_AUTH_DOUYIN_REDIRECT_URI'] }, // 凭证
    mapProfile: (raw) => ({ // 抖音字段：open_id / union_id / nickname / avatar
      providerUserId: first(raw, ['open_id', 'openid']), // 单应用唯一
      unionId: first(raw, ['union_id', 'unionid']) || undefined, // 跨应用唯一
      nickname: first(raw, ['nickname', 'nick_name']), // 昵称
      avatarUrl: first(raw, ['avatar', 'avatar_larger']) || undefined, // 头像
      raw, // 原始快照
    }), // mapProfile 结束
  }, // 抖音定义结束
  { // 微博：开放平台 OAuth2，资料端点需回传 uid
    id: 'weibo', // 路由段
    label: '微博', // 展示名
    labelEn: 'Weibo', // 英文展示名
    region: 'cn', // 仅中国区
    flavor: 'weibo', // 专用适配器（uid 二次换取）
    issuer: 'https://open.weibo.com', // 占位
    authorizeUrl: 'https://open.weibo.com/oauth2/authorize', // 授权页
    tokenUrl: 'https://api.weibo.com/oauth2/access_token', // 令牌端点
    profileUrl: 'https://api.weibo.com/2/users/show.json', // 资料端点
    scopes: ['email'], // 读邮箱与基本资料
    tokenAuth: 'post', // 占位：weibo 适配器自行拼表单
    env: { clientId: ['MIM_AUTH_WEIBO_CLIENT_ID'], clientSecret: ['MIM_AUTH_WEIBO_CLIENT_SECRET'], redirectUri: ['MIM_AUTH_WEIBO_REDIRECT_URI'] }, // 凭证
    mapProfile: (raw) => ({ // 微博字段：id/uid、screen_name、profile_image_url、email
      providerUserId: first(raw, ['id', 'uid']), // 用户标识
      nickname: first(raw, ['screen_name', 'name']), // 昵称
      avatarUrl: first(raw, ['profile_image_url', 'profile_image_url_large']) || undefined, // 头像
      email: first(raw, ['email']) || undefined, // 邮箱可能为空
      raw, // 原始快照
    }), // mapProfile 结束
  }, // 微博定义结束
  { // 百度：账号授权中心，标准 OAuth2 表单换 token
    id: 'baidu', // 路由段
    label: '百度', // 展示名
    labelEn: 'Baidu', // 英文展示名
    region: 'cn', // 仅中国区
    flavor: 'standard', // 通用客户端处理
    issuer: 'https://openapi.baidu.com', // 占位
    authorizeUrl: 'https://openapi.baidu.com/oauth/2.0/authorize', // 授权页
    tokenUrl: 'https://openapi.baidu.com/oauth/2.0/token', // 令牌端点
    profileUrl: 'https://openapi.baidu.com/rest/2.0/user/getinfo', // 资料端点
    scopes: ['basic'], // 基础资料
    tokenAuth: 'post', // body 传 secret
    env: { clientId: ['MIM_AUTH_BAIDU_CLIENT_ID'], clientSecret: ['MIM_AUTH_BAIDU_CLIENT_SECRET'], redirectUri: ['MIM_AUTH_BAIDU_REDIRECT_URI'] }, // 凭证
    mapProfile: (raw) => ({ // 百度字段：openid/uid、username、portrait
      providerUserId: first(raw, ['openid', 'uid']), // 用户标识
      nickname: first(raw, ['username', 'realname']), // 昵称
      avatarUrl: first(raw, ['portrait', 'profile_img_url']) || undefined, // 头像
      email: first(raw, ['email']) || undefined, // 邮箱可能为空
      raw, // 原始快照
    }), // mapProfile 结束
  }, // 百度定义结束
  { // 支付宝：开放平台网关统一 method 调用，RSA2 签名由适配器按凭证拼装
    id: 'alipay', // 路由段
    label: '支付宝', // 展示名
    labelEn: 'Alipay', // 英文展示名
    region: 'cn', // 仅中国区
    flavor: 'alipay', // 专用适配器（网关 method + 签名）
    issuer: 'https://openauth.alipay.com', // 占位
    authorizeUrl: 'https://openauth.alipay.com/oauth2/publicAppAuthorize.htm', // 授权页
    tokenUrl: 'https://openapi.alipay.com/gateway.do', // 网关统一端点
    profileUrl: 'https://openapi.alipay.com/gateway.do', // 资料也走网关
    scopes: ['auth_user_info'], // 换取用户信息
    tokenAuth: 'post', // 占位：alipay 适配器自行拼表单
    env: { clientId: ['MIM_AUTH_ALIPAY_APP_ID'], clientSecret: ['MIM_AUTH_ALIPAY_PRIVATE_KEY'], redirectUri: ['MIM_AUTH_ALIPAY_REDIRECT_URI'] }, // 凭证：app_id + RSA2 私钥
    mapProfile: (raw) => ({ // 支付宝字段：user_id、nick_name、avatar
      providerUserId: first(raw, ['user_id', 'open_id']), // 买家开放标识
      nickname: first(raw, ['nick_name', 'nickname']), // 昵称
      avatarUrl: first(raw, ['avatar', 'avatar_url']) || undefined, // 头像
      raw, // 原始快照
    }), // mapProfile 结束
  }, // 支付宝定义结束
  { // Facebook：Graph API，公开资料 + 邮箱
    id: 'facebook', // 路由段
    label: 'Facebook', // 展示名
    labelEn: 'Facebook', // 英文展示名
    region: 'global', // 仅海外区
    flavor: 'standard', // 通用客户端处理
    issuer: 'https://www.facebook.com', // 占位
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth', // 授权页
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token', // 令牌端点
    profileUrl: 'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture', // 资料端点（显式声明字段）
    scopes: ['public_profile', 'email'], // 基础资料 + 邮箱
    tokenAuth: 'post', // body 传 secret
    env: { clientId: ['MIM_AUTH_FACEBOOK_CLIENT_ID'], clientSecret: ['MIM_AUTH_FACEBOOK_CLIENT_SECRET'], redirectUri: ['MIM_AUTH_FACEBOOK_REDIRECT_URI'] }, // 凭证
    mapProfile: (raw) => { // Facebook 头像嵌套在 picture.data.url 内
      const picture = raw.picture && typeof raw.picture === 'object' ? (raw.picture as Record<string, unknown>) : {}; // 取 picture 对象
      const data = picture.data && typeof picture.data === 'object' ? (picture.data as Record<string, unknown>) : {}; // 取 data 层
      return { // 统一资料结构
        providerUserId: first(raw, ['id']), // 用户 ID
        nickname: first(raw, ['name']), // 姓名
        email: first(raw, ['email']) || undefined, // 邮箱
        avatarUrl: first(data, ['url']) || undefined, // 嵌套头像
        raw, // 原始快照
      }; // 返回结构结束
    }, // mapProfile 结束
  }, // Facebook 定义结束
  { // Twitter（X）：OAuth2 PKCE，用户资料在 data 节点内，令牌端点走 Basic 认证
    id: 'twitter', // 路由段
    label: 'X', // 展示名
    labelEn: 'Twitter', // 英文展示名
    region: 'global', // 仅海外区
    flavor: 'standard', // 通用客户端处理（PKCE + Basic）
    issuer: 'https://twitter.com', // 占位
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize', // 授权页
    tokenUrl: 'https://api.twitter.com/2/oauth2/token', // 令牌端点
    profileUrl: 'https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url', // 资料端点（显式声明字段）
    scopes: ['tweet.read', 'users.read', 'offline.access'], // 读资料与离线刷新
    tokenAuth: 'basic', // X 令牌端点要求 HTTP Basic
    env: { clientId: ['MIM_AUTH_TWITTER_CLIENT_ID'], clientSecret: ['MIM_AUTH_TWITTER_CLIENT_SECRET'], redirectUri: ['MIM_AUTH_TWITTER_REDIRECT_URI'] }, // 凭证
    mapProfile: (raw) => { // X 资料包在 data 节点内
      const data = raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : {}; // 取 data 层
      return { // 统一资料结构
        providerUserId: first(data, ['id']), // 用户 ID
        nickname: first(data, ['name', 'username']), // 姓名优先，退回 handle
        avatarUrl: first(data, ['profile_image_url']) || undefined, // 头像
        raw, // 原始快照
      }; // 返回结构结束
    }, // mapProfile 结束
  }, // Twitter 定义结束
]; // provider 清单结束

/** 按 id 查定义；未登记的 id 返回 undefined，由路由统一 404/400 */
export function findProvider(id: string): OAuthProviderSpec | undefined { // 不抛异常，交由调用方决定错误码
  return OAUTH_PROVIDERS.find((provider) => provider.id === id); // 线性查找，清单只有个位数
} // findProvider 结束

/** 已解析的凭证：client_secret 对 Apple 可能是动态生成的 JWT */
export interface ResolvedCredentials {
  clientId: string; // 提供方分配的应用标识
  clientSecret: string; // 应用密钥或 Apple 的动态 JWT
  redirectUri: string; // 回调地址（必须与提供方后台登记一致）
  authorizeUrl: string; // 授权端点（可被 MIM_AUTH_<ID>_AUTHORIZE_URL 覆盖，便于私有化部署与测试）
  tokenUrl: string; // 令牌端点（同上，覆盖变量后缀 _TOKEN_URL）
  profileUrl?: string; // 资料端点（后缀 _PROFILE_URL）
  jwksUrl?: string; // OIDC 公钥集（后缀 _JWKS_URL）
} // ResolvedCredentials 结束

/** 从环境变量里取第一个非空值 */
function envFirst(env: Record<string, string | undefined>, keys: string[]): string { // 兼容多套命名
  for (const key of keys) { // 按候选顺序查找
    const value = (env[key] ?? '').trim(); // 去空白，避免复制粘贴带换行
    if (value) return value; // 命中即返回
  } // 循环结束
  return ''; // 全部缺失
} // envFirst 结束

/**
 * 解析某 provider 的运行凭证。
 * @param backendBase 后端对外基址（如 https://mim.mixm.top），用于拼默认回调地址
 * @returns 凭证齐全时返回配置，否则 null（入口不可用，但不应让服务启动失败）
 */
export function resolveCredentials(
  spec: OAuthProviderSpec, // 对象字段 spec：记录一项配置或数据
  env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
  backendBase: string, // 对象字段 backendBase：记录一项配置或数据
): ResolvedCredentials | null { // 执行当前业务步骤
  const clientId = envFirst(env, spec.env.clientId); // 应用 ID
  const rawSecret = envFirst(env, spec.env.clientSecret); // 原始密钥（Apple 为私钥）
  if (!clientId || !rawSecret) return null; // 任一缺失即视为未配置
  // 回调地址优先取 provider 专属变量，其次取公共基址拼接；基址为空时返回 null（无法登记回调）
  const explicitRedirect = spec.env.redirectUri ? envFirst(env, spec.env.redirectUri) : ''; // 专属覆盖
  const base = (env.MIM_OAUTH_CALLBACK_BASE ?? backendBase).replace(/\/+$/, ''); // 公共回调基址，去尾斜杠
  const redirectUri = explicitRedirect || (base ? `${base}/api/v1/auth/oauth/${spec.id}/callback` : ''); // 拼默认回调
  if (!redirectUri) return null; // 没有可登记的回调地址，授权必然失败
  // 端点允许逐项覆盖：GitHub Enterprise / 自建 GitLab 与自动化测试都需要把请求指向别的地址
  const prefix = `MIM_AUTH_${spec.id.toUpperCase()}`; // 覆盖变量的统一前缀
  const authorizeUrl = envFirst(env, [`${prefix}_AUTHORIZE_URL`]) || spec.authorizeUrl; // 授权端点
  const tokenUrl = envFirst(env, [`${prefix}_TOKEN_URL`]) || spec.tokenUrl; // 令牌端点
  const profileUrl = envFirst(env, [`${prefix}_PROFILE_URL`]) || spec.profileUrl; // 资料端点（可空）
  const jwksUrl = envFirst(env, [`${prefix}_JWKS_URL`]) || spec.jwksUrl; // 公钥集（可空）
  // Apple 的 client_secret 是 ES256 签名的 JWT，由 client.ts 按需生成；此处先把私钥透传出去
  return { clientId, clientSecret: rawSecret, redirectUri, authorizeUrl, tokenUrl, profileUrl, jwksUrl }; // 交出解析结果
} // resolveCredentials 结束

/** 对外可展示的 provider 摘要（不含端点与凭证，避免泄露内部配置） */
export interface PublicProviderInfo {
  id: OAuthProviderId; // 前端按钮标识
  label: string; // 中文名
  label_en: string; // 英文名
  region: Region | 'both'; // 可用区域
  configured: boolean; // 该部署是否已配置凭证
} // PublicProviderInfo 结束

/** 生成公开清单：按当前地区过滤，未配置的仍返回但标记 configured=false，前端可置灰或隐藏 */
export function publicProviders(
  env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
  backendBase: string, // 对象字段 backendBase：记录一项配置或数据
  region?: Region, // 执行当前业务步骤
): PublicProviderInfo[] { // 执行当前业务步骤
  return OAUTH_PROVIDERS.filter((spec) => !region || spec.region === 'both' || spec.region === region) // 区域过滤
    .map((spec) => ({ // 映射为公开结构
      id: spec.id, // 标识
      label: spec.label, // 中文名
      label_en: spec.labelEn, // 英文名
      region: spec.region, // 区域
      configured: resolveCredentials(spec, env, backendBase) !== null, // 凭证是否齐全
    })); // map 结束
} // publicProviders 结束
