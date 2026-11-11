/** 身份标识归一化、验证码、JWT 与不透明刷新令牌 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'; // 引入哈希、随机字节、安全随机整数与常数时间比较，均为 Node 内置无需第三方
import bcrypt from 'bcryptjs'; // 引入 bcrypt，用于验证码与口令的慢哈希存储，抵御离线爆破
import jwt from 'jsonwebtoken'; // 引入 JWT 签发与校验库，承载短期访问令牌
import { AppError } from '@mim/core-domain'; // 引入统一业务异常，错误码与状态码集中管理
import { ACCESS_TTL_SECONDS, CODE_LENGTH } from './config.js'; // 引入访问令牌有效期与验证码位数，便于统一调参
import type { Region } from './types.js'; // 仅引入区域类型，编译期擦除

export type IdentityProvider = 'phone' | 'email'; // 身份提供方：国内手机号与海外邮箱两种

export interface NormalizedIdentity { // 归一化后的身份结构，落库与查询都使用该形态
  provider: IdentityProvider; // 身份类型，决定验证码走短信还是邮件通道
  identifier: string; // 归一化标识：手机号去 +86 前缀、邮箱转小写
} // 接口结束

const PHONE_RE = /^1[3-9]\d{9}$/; // 中国大陆手机号：1 开头、第二位 3-9、共 11 位，排除座机与非法号段
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 邮箱最小校验：本地部分 + @ + 域名 + 点 + 顶级域，避免过度严格误杀合法地址

/** region 隔离：cn 只接受手机号，global 只接受邮箱；标识归一后落库 */
export function normalizeIdentity(region: Region, provider: string, raw: string): NormalizedIdentity { // 身份归一入口：校验区域与类型匹配并规范化标识
  const value = raw.trim(); // 去掉首尾空白，避免用户误输空格导致同一身份注册出多个账号
  if (provider === 'phone') { // 手机号分支
    if (region !== 'cn') { // 手机号仅在中国区可用，海外区必须走邮箱
      throw new AppError('VALIDATION_FAILED', 'phone identity is only available in cn region', { // 区域不匹配属参数错误，非权限问题
        field: 'identifier', // 指明出错字段，便于前端定位输入框
      }); // 异常构造结束
    } // 区域校验结束
    const phone = value.replace(/^\+?86/, ''); // 容忍用户带 +86 / 86 前缀，剥离后再统一校验
    if (!PHONE_RE.test(phone)) { // 格式不合法直接拒绝，避免脏数据落库
      throw new AppError('VALIDATION_FAILED', 'invalid CN mobile number', { field: 'identifier' }); // 统一错误码与字段提示
    } // 格式校验结束
    return { provider: 'phone', identifier: phone }; // 返回归一手机号，作为 users 表的唯一身份键
  } // 手机号分支结束
  if (provider === 'email') { // 邮箱分支
    if (region !== 'global') { // 邮箱仅面向海外区，国内区强制手机号
      throw new AppError('VALIDATION_FAILED', 'email identity is only available in global region', { // 与手机号分支对称的区域校验
        field: 'identifier', // 指明出错字段
      }); // 异常构造结束
    } // 区域校验结束
    const email = value.toLowerCase(); // 邮箱大小写不敏感，统一转小写避免同一邮箱注册多个账号
    if (!EMAIL_RE.test(email)) { // 格式不合法直接拒绝
      throw new AppError('VALIDATION_FAILED', 'invalid email address', { field: 'identifier' }); // 统一错误码与字段提示
    } // 格式校验结束
    return { provider: 'email', identifier: email }; // 返回归一邮箱，作为唯一身份键
  } // 邮箱分支结束
  throw new AppError('VALIDATION_FAILED', 'unsupported provider', { field: 'provider' }); // 未知 provider 一律拒绝，防止绕过区域限制
} // normalizeIdentity 结束

export function generateCode(length: number = CODE_LENGTH): string { // 生成纯数字验证码，默认位数由配置决定
  let out = ''; // 逐位拼接结果，保证前导零不丢（如 000123）
  for (let i = 0; i < length; i += 1) out += String(randomInt(0, 10)); // 用 crypto.randomInt 取 0-9，避免 Math.random 可预测
  return out; // 返回定长数字串
} // generateCode 结束

export function hashCode(code: string): string { // 验证码哈希：库中只存哈希，即使库泄露也无法反推验证码
  return bcrypt.hashSync(code, 10); // 成本因子 10，兼顾安全强度与校验耗时
} // hashCode 结束

export function verifyCode(code: string, hash: string): boolean { // 校验用户提交的验证码与库中哈希是否匹配
  return bcrypt.compareSync(code, hash); // bcrypt 内部做常数时间比较，天然抵御时序攻击
} // verifyCode 结束

export function hashPassword(password: string): string { // 账号密码哈希：账号体系自建口令与验证码共用同一慢哈希
  return bcrypt.hashSync(password, 10); // 成本因子 10 与验证码一致，避免两套强度标准并存
} // hashPassword 结束

export function verifyPassword(password: string, hash: string): boolean { // 校验账号密码与库中哈希是否匹配
  return bcrypt.compareSync(password, hash); // 常数时间比较，错误口令与不存在账号的耗时特征一致
} // verifyPassword 结束

export function sha256(input: string): string { // 通用 SHA-256 十六进制摘要，用于请求指纹与令牌哈希
  return createHash('sha256').update(input).digest('hex'); // 无密钥一次性哈希，仅用于指纹比对，不承担保密职责
} // sha256 结束

/**
 * 常数时间字符串比较：两端统一哈希为等长摘要后再比，
 * 避免长度差异与逐字符短路带来的时序侧信道。
 */
export function secureEqual(a: string, b: string): boolean { // 安全比较（如校验第三方回调签名）
  const left = createHash('sha256').update(a).digest(); // 先哈希成等长 Buffer，隐藏原始长度差异
  const right = createHash('sha256').update(b).digest(); // 右值做同样处理，保证长度一致
  return timingSafeEqual(left, right); // 常数时间比较，耗时与内容无关
} // secureEqual 结束

export function newOpaqueToken(): string { // 生成不透明刷新令牌：随机且不可解析，服务端只存其哈希
  return randomBytes(32).toString('base64url'); // 32 字节熵 + base64url 编码，可直接放 Header/URL 无需转义
} // newOpaqueToken 结束

export function issueAccessToken(userId: string, region: string, secret: string): string { // 签发短期访问令牌
  return jwt.sign({ sub: userId, region, typ: 'access' }, secret, { // 载荷只放必要声明：sub 用户 ID、region 区域、typ 区分令牌类型
    algorithm: 'HS256', // 对称算法，单服务部署下密钥管理成本最低
    expiresIn: ACCESS_TTL_SECONDS, // 短期过期，配合刷新令牌以降低泄露后的风险窗口
  }); // 签发结束
} // issueAccessToken 结束

export function verifyAccessToken(token: string, secret: string): { sub: string; region: string } { // 校验访问令牌并取出用户 ID 与区域
  try { // 任何解析或校验异常都统一转成 AUTH_UNAUTHORIZED，避免泄露内部细节
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }); // 限定算法白名单，防止 alg=none 等降级攻击
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload'); // 载荷必须是对象，否则视为非法令牌
    const sub = (payload as jwt.JwtPayload).sub; // 取用户 ID 声明
    if (typeof sub !== 'string' || sub.length === 0) throw new Error('missing sub'); // sub 必填且非空，否则无法定位用户
    return { sub, region: String((payload as jwt.JwtPayload).region ?? '') }; // 区域缺失时给空串，由后续鉴权按真实用户行判断
  } catch { // 捕获过期、签名错误、格式错误等全部情况
    throw new AppError('AUTH_UNAUTHORIZED', 'access token is invalid or expired'); // 统一对外错误码，前端据此跳转登录
  } // try/catch 结束
} // verifyAccessToken 结束
