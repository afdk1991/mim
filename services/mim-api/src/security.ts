/**
 * 安全工具边界（安全加固与性能包，2026-11-13）：
 *
 * 验证码：
 *   - 统一适配器层，模式 MIM_CAPTCHA_MODE = off | image | slider | tencent | geetest4；
 *   - 场景 register / login / report / post 可分别用 MIM_CAPTCHA_<SCENE>=1 强制；
 *   - 未配置第三方密钥时对应模式返回 503 明确错误码，绝不静默放行；off 模式不校验；
 *   - image / slider 一次性消费（先校验摘要与过期，再写 used_at），防重放。
 *
 * 内容审核：
 *   - 文本 / 图片适配器，access_token 进程内缓存；服务不可用时按 MIM_AUDIT_FALLBACK
 *     open（放行降级）/ closed（拒绝）处理；未配置密钥 provider=none，不伪装已审核。
 *
 * 出站 URL：
 *   - assertSafeOutboundUrl 协议白名单 + 内网/环回/链路本地/元数据地址拒绝 + 整数/八进制/
 *     十六进制 IP 解码 + DNS 解析后二次校验；safeFetch 手动跟随重定向并逐跳复核目标。
 *
 * 频控：
 *   - slidingWindow 基于 cache 适配层（Redis / 内存降级）做用户+目标滑动窗口。
 */

import { createHash, randomInt, randomUUID } from 'node:crypto'; // 引入依赖：声明本文件使用的外部能力
import { lookup } from 'node:dns/promises'; // 引入依赖：声明本文件使用的外部能力
import { isIP } from 'node:net'; // 引入依赖：声明本文件使用的外部能力
import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import type { Db } from './types.js'; // 数据库连接类型（编译期擦除）
import { getSharedCache, type CacheBackend } from './cache.js'; // 引入依赖：声明本文件使用的外部能力

const CAPTCHA_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉易混的 0/O/1/I
const CAPTCHA_TTL_MS = 10 * 60 * 1000; // 10 分钟过期
const SLIDER_TOLERANCE_PX = 12; // 滑动拼图容差：x 偏差在 ±12px 内视为通过
const AUDIT_HTTP_TIMEOUT_MS = 5_000; // 审核上游超时，避免挂起业务请求

// ===========================================================================
// 验证码：模式与场景配置
// ===========================================================================

export type CaptchaMode = 'off' | 'image' | 'slider' | 'tencent' | 'geetest4'; // 声明类型 CaptchaMode：约束跨模块数据结构
export type CaptchaScene = 'register' | 'login' | 'report' | 'post'; // 声明类型 CaptchaScene：约束跨模块数据结构

const CAPTCHA_MODES: ReadonlySet<string> = new Set(['off', 'image', 'slider', 'tencent', 'geetest4']); // 保存 CAPTCHA_MODES：承载本步骤的计算结果供后续使用
const SCENE_ENV: Record<CaptchaScene, string> = { // 保存 SCENE_ENV：承载本步骤的计算结果供后续使用
  register: 'MIM_CAPTCHA_REGISTER', // 对象字段：声明结构中的一项数据
  login: 'MIM_CAPTCHA_LOGIN', // 对象字段：声明结构中的一项数据
  report: 'MIM_CAPTCHA_REPORT', // 对象字段：声明结构中的一项数据
  post: 'MIM_CAPTCHA_POST', // 对象字段：声明结构中的一项数据
}; // 结束代码块：本层作用域收尾

/** 解析全局验证码模式；非法取值回落 off，避免把配置错误变成线上放行 */
export function captchaMode(env: Record<string, string | undefined>): CaptchaMode { // 定义函数 captchaMode：封装可复用业务步骤
  const raw = (env.MIM_CAPTCHA_MODE ?? '').trim().toLowerCase(); // 保存 raw：承载本步骤的计算结果供后续使用
  return CAPTCHA_MODES.has(raw) ? (raw as CaptchaMode) : 'off'; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 某场景是否强制验证码：模式 off 一律不强制；场景开关 1 才强制；旧 MIM_CAPTCHA_REQUIRED=1 视为全场景强制 */
export function sceneCaptchaRequired(env: Record<string, string | undefined>, scene: CaptchaScene): boolean { // 定义函数 sceneCaptchaRequired：封装可复用业务步骤
  if (captchaMode(env) === 'off') return false; // 条件分支：仅在满足业务前置条件时继续
  if ((env.MIM_CAPTCHA_REQUIRED ?? '').trim() === '1') return true; // 条件分支：仅在满足业务前置条件时继续
  return (env[SCENE_ENV[scene]] ?? '').trim() === '1'; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 第三方验证码凭证是否齐备（仅用于状态披露，不泄漏密钥本身） */
export function captchaProvidersConfigured(env: Record<string, string | undefined>): Record<'tencent' | 'geetest4', boolean> { // 定义函数 captchaProvidersConfigured：封装可复用业务步骤
  return { // 返回结果：把本步骤产物交给调用方
    tencent: Boolean(env.MIM_TENCENT_CAPTCHA_APP_ID?.trim() && env.MIM_TENCENT_CAPTCHA_SECRET_KEY?.trim()), // 对象字段：声明结构中的一项数据
    geetest4: Boolean(env.MIM_GEETEST4_CAPTCHA_ID?.trim() && env.MIM_GEETEST4_CAPTCHA_KEY?.trim()), // 对象字段：声明结构中的一项数据
  }; // 结束代码块：本层作用域收尾
} // 结束函数体：本层作用域收尾

// ===========================================================================
// 验证码：image（现有图形验证码，保留既有 DB 落库与一次性消费语义）
// ===========================================================================

/** 生成一个 5 位图形验证码：返回 id、SVG 与过期时间；答案摘要落库由调用方完成。 */
export function createCaptcha(): { id: string; answer: string; svg: string; expires_at: string } { // 定义函数 createCaptcha：封装可复用业务步骤
  const id = `cap-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
  const answer = Array.from({ length: 5 }, () => CAPTCHA_ALPHABET[randomInt(0, CAPTCHA_ALPHABET.length)]).join(''); // 保存 answer：承载本步骤的计算结果供后续使用
  const chars = answer // 保存 chars：承载本步骤的计算结果供后续使用
    .split('') // 链式调用：在上一步结果上继续处理
    .map((char, index) => { // 链式调用：在上一步结果上继续处理
      const x = 18 + index * 26 + randomInt(-3, 4); // 保存 x：承载本步骤的计算结果供后续使用
      const y = 30 + randomInt(-4, 5); // 保存 y：承载本步骤的计算结果供后续使用
      const rotate = randomInt(-18, 19); // 保存 rotate：承载本步骤的计算结果供后续使用
      return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" font-size="26" font-family="monospace" fill="#0f172a">${char}</text>`; // 返回结果：把本步骤产物交给调用方
    }) // 结束代码块：本层作用域收尾
    .join(''); // 链式调用：在上一步结果上继续处理
  const lines = Array.from({ length: 4 }, () => { // 保存 lines：承载本步骤的计算结果供后续使用
    const y1 = randomInt(8, 48); // 保存 y1：承载本步骤的计算结果供后续使用
    const y2 = randomInt(8, 48); // 保存 y2：承载本步骤的计算结果供后续使用
    return `<line x1="0" y1="${y1}" x2="160" y2="${y2}" stroke="#94a3b8" stroke-width="1" opacity="0.5"/>`; // 返回结果：把本步骤产物交给调用方
  }).join(''); // 结束代码块：本层作用域收尾
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="56" viewBox="0 0 160 56" role="img" aria-label="图形验证码"><rect width="160" height="56" fill="#f8fafc" rx="8"/>${lines}${chars}</svg>`;
  return { id, answer, svg, expires_at: new Date(Date.now() + CAPTCHA_TTL_MS).toISOString() }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 答案摘要：统一大写后 sha256，避免大小写误差。 */
export function captchaHash(answer: string): string { // 定义函数 captchaHash：封装可复用业务步骤
  return createHash('sha256').update(answer.trim().toUpperCase()).digest('hex'); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 校验并消费验证码：一次性使用，过期或错误均失败。 */
export function consumeCaptcha(db: Db, id: string, answer: string): boolean { // 定义函数 consumeCaptcha：封装可复用业务步骤
  const row = db.prepare('SELECT answer_hash, expires_at, used_at FROM captchas WHERE id = ?').get(id) as // 保存 row：承载本步骤的计算结果供后续使用
    | { answer_hash: string; expires_at: string; used_at: string | null } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return false; // 条件分支：仅在满足业务前置条件时继续
  if (row.answer_hash !== captchaHash(answer)) return false; // 条件分支：仅在满足业务前置条件时继续
  db.prepare('UPDATE captchas SET used_at = ? WHERE id = ?').run(new Date().toISOString(), id); // 预编译 SQL：固定语句结构后绑定参数执行
  return true; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

// ===========================================================================
// 验证码：slider（滑动拼图：背景 + 缺口坐标，容差校验，一次性消费）
// ===========================================================================

/** 滑动拼图题目：background SVG + 缺口位置（不含目标 x，前端只拿到可拖动的缺口形状） */
export interface SliderChallenge { // 声明类型 SliderChallenge：约束跨模块数据结构
  id: string; // 对象字段：声明结构中的一项数据
  expires_at: string; // 对象字段：声明结构中的一项数据
  background: string; // 对象字段：声明结构中的一项数据
  gap: { y: number; width: number; height: number }; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

const SLIDER_WIDTH = 300; // 保存 SLIDER_WIDTH：承载本步骤的计算结果供后续使用
const SLIDER_HEIGHT = 160; // 保存 SLIDER_HEIGHT：承载本步骤的计算结果供后续使用
const SLIDER_GAP_SIZE = 42; // 保存 SLIDER_GAP_SIZE：承载本步骤的计算结果供后续使用

/** 生成滑动拼图：目标 x 只以摘要形式落库，响应体不下发坐标。 */
export function createSliderCaptcha(): SliderChallenge & { answerX: number } { // 定义函数 createSliderCaptcha：封装可复用业务步骤
  const id = `slider-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
  const answerX = randomInt(50, SLIDER_WIDTH - SLIDER_GAP_SIZE - 20); // 保存 answerX：承载本步骤的计算结果供后续使用
  const gapY = randomInt(20, SLIDER_HEIGHT - SLIDER_GAP_SIZE - 20); // 保存 gapY：承载本步骤的计算结果供后续使用
  const noise = Array.from({ length: 6 }, () => { // 保存 noise：承载本步骤的计算结果供后续使用
    const y1 = randomInt(10, SLIDER_HEIGHT - 10); // 保存 y1：承载本步骤的计算结果供后续使用
    const y2 = randomInt(10, SLIDER_HEIGHT - 10); // 保存 y2：承载本步骤的计算结果供后续使用
    return `<line x1="0" y1="${y1}" x2="${SLIDER_WIDTH}" y2="${y2}" stroke="#cbd5e1" stroke-width="1" opacity="0.4"/>`; // 返回结果：把本步骤产物交给调用方
  }).join(''); // 结束代码块：本层作用域收尾
  const background = // 保存 background：承载本步骤的计算结果供后续使用
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDER_WIDTH}" height="${SLIDER_HEIGHT}" viewBox="0 0 ${SLIDER_WIDTH} ${SLIDER_HEIGHT}" role="img" aria-label="滑动拼图">` +
    `<rect width="${SLIDER_WIDTH}" height="${SLIDER_HEIGHT}" fill="#e2e8f0" rx="10"/>${noise}` + // 业务步骤：推进当前流程的下一项处理
    `<rect x="0" y="${gapY}" width="${SLIDER_GAP_SIZE}" height="${SLIDER_GAP_SIZE}" fill="#94a3b8" opacity="0.35" rx="8"/>` + // 业务步骤：推进当前流程的下一项处理
    `</svg>`; // 业务步骤：推进当前流程的下一项处理
  return { id, answerX, expires_at: new Date(Date.now() + CAPTCHA_TTL_MS).toISOString(), background, gap: { y: gapY, width: SLIDER_GAP_SIZE, height: SLIDER_GAP_SIZE } }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 滑动校验：偏差在容差内即通过；目标 x 只以 sha256 摘要落库，校验时在出题区间内反查摘要。 */
function verifySliderAnswer(db: Db, id: string, sliderX: unknown): boolean { // 定义函数 verifySliderAnswer：封装可复用业务步骤
  const row = db.prepare('SELECT answer_hash, expires_at, used_at FROM captchas WHERE id = ?').get(id) as // 保存 row：承载本步骤的计算结果供后续使用
    | { answer_hash: string; expires_at: string; used_at: string | null } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return false; // 条件分支：仅在满足业务前置条件时继续
  const x = Number(sliderX); // 保存 x：承载本步骤的计算结果供后续使用
  if (!Number.isFinite(x)) return false; // 条件分支：仅在满足业务前置条件时继续
  const minX = 50; // 保存 minX：承载本步骤的计算结果供后续使用
  const maxX = SLIDER_WIDTH - SLIDER_GAP_SIZE - 20; // 保存 maxX：承载本步骤的计算结果供后续使用
  let expected: number | null = null; // 保存 expected：承载本步骤的计算结果供后续使用
  for (let candidate = minX; candidate <= maxX; candidate += 1) { // 循环处理：逐项完成批量数据操作
    if (createHash('sha256').update(String(candidate)).digest('hex') === row.answer_hash) { // 条件分支：仅在满足业务前置条件时继续
      expected = candidate; // 赋值：更新当前作用域中的状态
      break; // 业务步骤：推进当前流程的下一项处理
    } // 结束条件分支：本层作用域收尾
  } // 结束循环体：本层作用域收尾
  if (expected === null || Math.abs(x - expected) > SLIDER_TOLERANCE_PX) return false; // 条件分支：仅在满足业务前置条件时继续
  db.prepare('UPDATE captchas SET used_at = ? WHERE id = ?').run(new Date().toISOString(), id); // 预编译 SQL：固定语句结构后绑定参数执行
  return true; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 落库 slider 题目的目标 x：answer_hash 存 sha256(x)，目标 x 不以明文入库。 */
function persistSlider(db: Db, challenge: SliderChallenge & { answerX: number }): void { // 定义函数 persistSlider：封装可复用业务步骤
  const digest = createHash('sha256').update(String(challenge.answerX)).digest('hex'); // 保存 digest：承载本步骤的计算结果供后续使用
  db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run( // 预编译 SQL：固定语句结构后绑定参数执行
    challenge.id, // 业务步骤：推进当前流程的下一项处理
    digest, // 业务步骤：推进当前流程的下一项处理
    challenge.expires_at, // 业务步骤：推进当前流程的下一项处理
    new Date().toISOString(), // 业务步骤：推进当前流程的下一项处理
  ); // 调用结束：参数列表与链式调用收尾
} // 结束代码块：本层作用域收尾

// ===========================================================================
// 验证码：第三方服务端二次校验（腾讯 TCaptcha / 极验 4.0）
// ===========================================================================

async function postJson(url: string, body: Record<string, string>, timeoutMs: number): Promise<Record<string, unknown>> { // 定义函数 postJson：封装可复用业务步骤
  const res = await fetch(url, { // 保存 res：承载本步骤的计算结果供后续使用
    method: 'POST', // 对象字段：声明结构中的一项数据
    headers: { 'content-type': 'application/json' }, // 对象字段：声明结构中的一项数据
    body: JSON.stringify(body), // 对象字段：声明结构中的一项数据
    signal: AbortSignal.timeout(timeoutMs), // 对象字段：声明结构中的一项数据
  }); // 结束代码块：本层作用域收尾
  if (!res.ok) throw new AppError('PROVIDER_NOT_CONFIGURED', 'captcha provider unreachable', { status: res.status }); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  return (await res.json()) as Record<string, unknown>; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 腾讯 TCaptcha 票据服务端校验：ticket + randstr 换取 response=1 */
async function verifyTencent(env: Record<string, string | undefined>, ticket: string, randstr: string): Promise<boolean> { // 定义函数 verifyTencent：封装可复用业务步骤
  const appId = env.MIM_TENCENT_CAPTCHA_APP_ID?.trim(); // 保存 appId：承载本步骤的计算结果供后续使用
  const secret = env.MIM_TENCENT_CAPTCHA_SECRET_KEY?.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
  if (!appId || !secret) throw new AppError('PROVIDER_NOT_CONFIGURED', '腾讯验证码未配置密钥'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  const params = new URLSearchParams({ aid: appId, AppSecretKey: secret, Ticket: ticket, Randstr: randstr }); // 保存 params：承载本步骤的计算结果供后续使用
  const res = await fetch(`https://ssl.captcha.qq.com/ticket/verify?${params.toString()}`, {
    method: 'GET', // 对象字段：声明结构中的一项数据
    signal: AbortSignal.timeout(AUDIT_HTTP_TIMEOUT_MS), // 对象字段：声明结构中的一项数据
  }); // 结束函数体：本层作用域收尾
  if (!res.ok) throw new AppError('PROVIDER_NOT_CONFIGURED', '腾讯验证码校验服务不可用'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  const json = (await res.json()) as { response?: string | number }; // 保存 json：承载本步骤的计算结果供后续使用
  return String(json.response) === '1'; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 极验 4.0 二次校验：captcha_output / lot_number / pass_token / gen_time */
async function verifyGeetest4( // 定义函数 verifyGeetest4：封装可复用业务步骤
  env: Record<string, string | undefined>, // 对象字段：声明结构中的一项数据
  payload: { lotNumber: string; captchaOutput: string; passToken: string; genTime: string }, // 对象字段：声明结构中的一项数据
): Promise<boolean> { // 调用结束：参数列表与链式调用收尾
  const captchaId = env.MIM_GEETEST4_CAPTCHA_ID?.trim(); // 保存 captchaId：承载本步骤的计算结果供后续使用
  const captchaKey = env.MIM_GEETEST4_CAPTCHA_KEY?.trim(); // 保存 captchaKey：承载本步骤的计算结果供后续使用
  if (!captchaId || !captchaKey) throw new AppError('PROVIDER_NOT_CONFIGURED', '极验验证码未配置密钥'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  const json = await postJson( // 保存 json：承载本步骤的计算结果供后续使用
    'https://gcaptcha4.geetest.com/captcha/v1/validate',
    { // 业务步骤：推进当前流程的下一项处理
      captcha_id: captchaId, // 对象字段：声明结构中的一项数据
      lot_number: payload.lotNumber, // 对象字段：声明结构中的一项数据
      captcha_output: payload.captchaOutput, // 对象字段：声明结构中的一项数据
      pass_token: payload.passToken, // 对象字段：声明结构中的一项数据
      gen_time: payload.genTime, // 对象字段：声明结构中的一项数据
      // 服务端二次校验携带密钥，极验据此确认请求来源合法
      captcha_key: captchaKey, // 对象字段：声明结构中的一项数据
    }, // 结束代码块：本层作用域收尾
    AUDIT_HTTP_TIMEOUT_MS, // 业务步骤：推进当前流程的下一项处理
  ); // 调用结束：参数列表与链式调用收尾
  const result = json.result as { status?: string } | undefined; // 保存 result：承载本步骤的计算结果供后续使用
  return result?.status === 'success'; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

// ===========================================================================
// 验证码：统一签发 / 校验入口
// ===========================================================================

/** 签发题目。off 模式返回 required=false；第三方模式缺凭证抛 503。 */
export function issueCaptcha(db: Db, env: Record<string, string | undefined>, scene: CaptchaScene): { // 定义函数 issueCaptcha：封装可复用业务步骤
  required: boolean; // 对象字段：声明结构中的一项数据
  mode: CaptchaMode; // 对象字段：声明结构中的一项数据
  id?: string; // 业务步骤：推进当前流程的下一项处理
  svg?: string; // 业务步骤：推进当前流程的下一项处理
  slider?: SliderChallenge; // 业务步骤：推进当前流程的下一项处理
  expires_at?: string; // 业务步骤：推进当前流程的下一项处理
} { // 结束代码块：本层作用域收尾
  const mode = captchaMode(env); // 保存 mode：承载本步骤的计算结果供后续使用
  if (mode === 'off' || !sceneCaptchaRequired(env, scene)) return { required: false, mode: 'off' }; // 条件分支：仅在满足业务前置条件时继续

  if (mode === 'image') { // 条件分支：仅在满足业务前置条件时继续
    const captcha = createCaptcha(); // 保存 captcha：承载本步骤的计算结果供后续使用
    db.prepare('DELETE FROM captchas WHERE expires_at <= ?').run(new Date().toISOString()); // 预编译 SQL：固定语句结构后绑定参数执行
    db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run( // 预编译 SQL：固定语句结构后绑定参数执行
      captcha.id, // 业务步骤：推进当前流程的下一项处理
      captchaHash(captcha.answer), // 业务步骤：推进当前流程的下一项处理
      captcha.expires_at, // 业务步骤：推进当前流程的下一项处理
      new Date().toISOString(), // 业务步骤：推进当前流程的下一项处理
    ); // 调用结束：参数列表与链式调用收尾
    return { required: true, mode, id: captcha.id, svg: captcha.svg, expires_at: captcha.expires_at }; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾

  if (mode === 'slider') { // 条件分支：仅在满足业务前置条件时继续
    const challenge = createSliderCaptcha(); // 保存 challenge：承载本步骤的计算结果供后续使用
    persistSlider(db, challenge); // 业务步骤：推进当前流程的下一项处理
    return { required: true, mode, id: challenge.id, slider: { ...challenge }, expires_at: challenge.expires_at }; // 返回结果：把本步骤产物交给调用方
  } // 结束函数体：本层作用域收尾

  // tencent / geetest4 为前端 SDK 取码，服务端只做二次校验；先校验凭证是否齐备，缺失直接 503
  const providers = captchaProvidersConfigured(env); // 保存 providers：承载本步骤的计算结果供后续使用
  if (mode === 'tencent' && !providers.tencent) throw new AppError('PROVIDER_NOT_CONFIGURED', '腾讯验证码未配置密钥，模式不可用'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  if (mode === 'geetest4' && !providers.geetest4) throw new AppError('PROVIDER_NOT_CONFIGURED', '极验验证码未配置密钥，模式不可用'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  return { required: true, mode }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 校验提交的验证码；失败抛 400（答案错误/过期）或 503（第三方未配置/不可用）。off 模式直接放行。 */
export async function verifyCaptcha( // 定义函数 verifyCaptcha：封装可复用业务步骤
  db: Db, // 对象字段：声明结构中的一项数据
  env: Record<string, string | undefined>, // 对象字段：声明结构中的一项数据
  scene: CaptchaScene, // 对象字段：声明结构中的一项数据
  body: Record<string, unknown>, // 对象字段：声明结构中的一项数据
): Promise<void> { // 调用结束：参数列表与链式调用收尾
  const mode = captchaMode(env); // 保存 mode：承载本步骤的计算结果供后续使用
  if (mode === 'off' || !sceneCaptchaRequired(env, scene)) return; // 条件分支：仅在满足业务前置条件时继续

  const str = (key: string): string => (typeof body[key] === 'string' ? (body[key] as string) : ''); // 保存 str：承载本步骤的计算结果供后续使用

  if (mode === 'image') { // 条件分支：仅在满足业务前置条件时继续
    const id = str('captcha_id') || str('id'); // 保存 id：承载本步骤的计算结果供后续使用
    const answer = str('captcha_code') || str('answer'); // 保存 answer：承载本步骤的计算结果供后续使用
    if (!id || !answer || !consumeCaptcha(db, id, answer)) throw new AppError('AUTH_CODE_INVALID', '图形验证码错误或已过期'); // 业务拒绝 AUTH_CODE_INVALID：以统一错误码终止当前请求
    return; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾

  if (mode === 'slider') { // 条件分支：仅在满足业务前置条件时继续
    const id = str('captcha_id') || str('id'); // 保存 id：承载本步骤的计算结果供后续使用
    if (!id || !verifySliderAnswer(db, id, body.slider_x)) throw new AppError('AUTH_CODE_INVALID', '滑动拼图未通过校验'); // 业务拒绝 AUTH_CODE_INVALID：以统一错误码终止当前请求
    return; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾

  if (mode === 'tencent') { // 条件分支：仅在满足业务前置条件时继续
    const ticket = str('ticket'); // 保存 ticket：承载本步骤的计算结果供后续使用
    const randstr = str('randstr'); // 保存 randstr：承载本步骤的计算结果供后续使用
    if (!ticket || !randstr) throw new AppError('VALIDATION_FAILED', '缺少腾讯验证码 ticket / randstr'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const ok = await verifyTencent(env, ticket, randstr); // 保存 ok：承载本步骤的计算结果供后续使用
    if (!ok) throw new AppError('AUTH_CODE_INVALID', '腾讯验证码校验未通过'); // 业务拒绝 AUTH_CODE_INVALID：以统一错误码终止当前请求
    return; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾

  if (mode === 'geetest4') { // 条件分支：仅在满足业务前置条件时继续
    const lotNumber = str('lot_number'); // 保存 lotNumber：承载本步骤的计算结果供后续使用
    const captchaOutput = str('captcha_output'); // 保存 captchaOutput：承载本步骤的计算结果供后续使用
    const passToken = str('pass_token'); // 保存 passToken：承载本步骤的计算结果供后续使用
    const genTime = str('gen_time'); // 保存 genTime：承载本步骤的计算结果供后续使用
    if (!lotNumber || !captchaOutput || !passToken || !genTime) throw new AppError('VALIDATION_FAILED', '缺少极验验证码二次校验字段'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const ok = await verifyGeetest4(env, { lotNumber, captchaOutput, passToken, genTime }); // 保存 ok：承载本步骤的计算结果供后续使用
    if (!ok) throw new AppError('AUTH_CODE_INVALID', '极验验证码校验未通过'); // 业务拒绝 AUTH_CODE_INVALID：以统一错误码终止当前请求
  } // 结束条件分支：本层作用域收尾
} // 结束代码块：本层作用域收尾

// ===========================================================================
// 内容审核：文本 / 图片适配器 + 降级策略
// ===========================================================================

/** 审核结果：pass 放行，review/reject 按拒绝处理；provider=none 表示未接入审核 */
export interface AuditResult { // 声明类型 AuditResult：约束跨模块数据结构
  ok: boolean; // 对象字段：声明结构中的一项数据
  provider: 'baidu' | 'none'; // 对象字段：声明结构中的一项数据
  reason?: string; // 业务步骤：推进当前流程的下一项处理
  degraded?: boolean; // 配置了上游但本次服务不可用、按 fallback 降级
} // 结束代码块：本层作用域收尾

let baiduToken: { token: string; expiresAt: number } | null = null; // 进程内缓存，避免每次审核都换 token

/** 审核降级策略：open=服务不可用时放行（宽松），closed=服务不可用时拒绝（严格） */
export type AuditFallback = 'open' | 'closed'; // 声明类型 AuditFallback：约束跨模块数据结构

export function auditFallback(env: Record<string, string | undefined>): AuditFallback { // 定义函数 auditFallback：封装可复用业务步骤
  return (env.MIM_AUDIT_FALLBACK ?? 'closed').trim().toLowerCase() === 'open' ? 'open' : 'closed'; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

export function auditConfigured(env: Record<string, string | undefined>): boolean { // 定义函数 auditConfigured：封装可复用业务步骤
  return Boolean(env.MIM_BAIDU_AUDIT_API_KEY?.trim() && env.MIM_BAIDU_AUDIT_SECRET_KEY?.trim()); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 获取百度 access_token：client_credentials 模式，缓存 25 小时。 */
async function baiduAccessToken(apiKey: string, secretKey: string): Promise<string | null> { // 定义函数 baiduAccessToken：封装可复用业务步骤
  if (baiduToken && baiduToken.expiresAt > Date.now()) return baiduToken.token; // 条件分支：仅在满足业务前置条件时继续
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(AUDIT_HTTP_TIMEOUT_MS) }); // 保存 res：承载本步骤的计算结果供后续使用
  if (!res.ok) return null; // 条件分支：仅在满足业务前置条件时继续
  const json = (await res.json()) as { access_token?: string; expires_in?: number }; // 保存 json：承载本步骤的计算结果供后续使用
  if (!json.access_token) return null; // 条件分支：仅在满足业务前置条件时继续
  baiduToken = { token: json.access_token, expiresAt: Date.now() + Math.min(json.expires_in ?? 2592000, 2592000) * 1000 }; // 赋值：更新当前作用域中的状态
  return json.access_token; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 按降级策略把「上游不可用」收敛为统一结果 */
function degrade(env: Record<string, string | undefined>, reason: string): AuditResult { // 定义函数 degrade：封装可复用业务步骤
  if (auditFallback(env) === 'open') return { ok: true, provider: 'baidu', reason, degraded: true }; // 条件分支：仅在满足业务前置条件时继续
  return { ok: false, provider: 'baidu', reason }; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 审核文本：未配置密钥 provider=none 放行；配置后按百度结论拒绝违规内容；上游故障按 fallback 处理。 */
export async function auditText(env: Record<string, string | undefined>, text: string): Promise<AuditResult> { // 定义函数 auditText：封装可复用业务步骤
  if (!auditConfigured(env)) return { ok: true, provider: 'none' }; // 条件分支：仅在满足业务前置条件时继续
  const apiKey = env.MIM_BAIDU_AUDIT_API_KEY!.trim(); // 保存 apiKey：承载本步骤的计算结果供后续使用
  const secretKey = env.MIM_BAIDU_AUDIT_SECRET_KEY!.trim(); // 保存 secretKey：承载本步骤的计算结果供后续使用
  let token: string | null; // 保存 token：承载本步骤的计算结果供后续使用
  try { // 异常保护：确保失败路径可回收资源
    token = await baiduAccessToken(apiKey, secretKey); // 赋值：更新当前作用域中的状态
  } catch { // 结束代码块：本层作用域收尾
    return degrade(env, '内容审核服务不可用（取 token 超时）'); // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
  if (!token) return degrade(env, '内容审核服务不可用（token 换取失败）'); // 条件分支：仅在满足业务前置条件时继续
  try { // 异常保护：确保失败路径可回收资源
    const res = await fetch(`https://aip.baidubce.com/rest/2.0/solution/v1/text_censor/v2/user_defined?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', // 对象字段：声明结构中的一项数据
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, // 对象字段：声明结构中的一项数据
      body: new URLSearchParams({ text }), // 对象字段：声明结构中的一项数据
      signal: AbortSignal.timeout(AUDIT_HTTP_TIMEOUT_MS), // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    if (!res.ok) return degrade(env, '内容审核服务不可用'); // 条件分支：仅在满足业务前置条件时继续
    const json = (await res.json()) as { conclusionType?: number; conclusion?: string }; // 保存 json：承载本步骤的计算结果供后续使用
    if (json.conclusionType === 1) return { ok: true, provider: 'baidu' }; // 条件分支：仅在满足业务前置条件时继续
    return { ok: false, provider: 'baidu', reason: json.conclusion || '内容未通过审核' }; // 返回结果：把本步骤产物交给调用方
  } catch { // 结束代码块：本层作用域收尾
    return degrade(env, '内容审核服务不可用（请求超时）'); // 返回结果：把本步骤产物交给调用方
  } // 结束函数体：本层作用域收尾
} // 结束代码块：本层作用域收尾

/** 审核图片：支持图片公网 URL；未配置密钥 provider=none 放行；上游故障按 fallback 处理。 */
export async function auditImage(env: Record<string, string | undefined>, imageUrl: string): Promise<AuditResult> { // 定义函数 auditImage：封装可复用业务步骤
  if (!auditConfigured(env)) return { ok: true, provider: 'none' }; // 条件分支：仅在满足业务前置条件时继续
  const apiKey = env.MIM_BAIDU_AUDIT_API_KEY!.trim(); // 保存 apiKey：承载本步骤的计算结果供后续使用
  const secretKey = env.MIM_BAIDU_AUDIT_SECRET_KEY!.trim(); // 保存 secretKey：承载本步骤的计算结果供后续使用
  let token: string | null; // 保存 token：承载本步骤的计算结果供后续使用
  try { // 异常保护：确保失败路径可回收资源
    token = await baiduAccessToken(apiKey, secretKey); // 赋值：更新当前作用域中的状态
  } catch { // 结束代码块：本层作用域收尾
    return degrade(env, '图片审核服务不可用（取 token 超时）'); // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
  if (!token) return degrade(env, '图片审核服务不可用（token 换取失败）'); // 条件分支：仅在满足业务前置条件时继续
  try { // 异常保护：确保失败路径可回收资源
    const res = await fetch(`https://aip.baidubce.com/rest/2.0/solution/v1/img_censor/v2/user_defined?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', // 对象字段：声明结构中的一项数据
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, // 对象字段：声明结构中的一项数据
      body: new URLSearchParams({ imgUrl: imageUrl }), // 对象字段：声明结构中的一项数据
      signal: AbortSignal.timeout(AUDIT_HTTP_TIMEOUT_MS), // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    if (!res.ok) return degrade(env, '图片审核服务不可用'); // 条件分支：仅在满足业务前置条件时继续
    const json = (await res.json()) as { conclusionType?: number; conclusion?: string }; // 保存 json：承载本步骤的计算结果供后续使用
    if (json.conclusionType === 1) return { ok: true, provider: 'baidu' }; // 条件分支：仅在满足业务前置条件时继续
    return { ok: false, provider: 'baidu', reason: json.conclusion || '图片未通过审核' }; // 返回结果：把本步骤产物交给调用方
  } catch { // 结束代码块：本层作用域收尾
    return degrade(env, '图片审核服务不可用（请求超时）'); // 返回结果：把本步骤产物交给调用方
  } // 结束函数体：本层作用域收尾
} // 结束代码块：本层作用域收尾

// ===========================================================================
// SSRF 防护：协议白名单 + 私网/环回/元数据拒绝 + 编码 IP 解码 + DNS 二次校验
// ===========================================================================

/** 判断 IPv4 是否属于私网 / 回环 / 链路本地 / 云元数据段。 */
function isPrivateIPv4(ip: string): boolean { // 定义函数 isPrivateIPv4：封装可复用业务步骤
  const parts = ip.split('.').map((part) => Number(part)); // 保存 parts：承载本步骤的计算结果供后续使用
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true; // 条件分支：仅在满足业务前置条件时继续
  const [a, b] = parts; // 业务步骤：推进当前流程的下一项处理
  return ( // 返回结果：把本步骤产物交给调用方
    a === 0 || // 赋值：更新当前作用域中的状态
    a === 10 || // 赋值：更新当前作用域中的状态
    a === 127 || // 赋值：更新当前作用域中的状态
    (a === 169 && b === 254) || // 链路本地 + 云元数据 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // 业务步骤：推进当前流程的下一项处理
    (a === 192 && b === 168) || // 业务步骤：推进当前流程的下一项处理
    (a === 100 && b >= 64 && b <= 127) || // 业务步骤：推进当前流程的下一项处理
    a >= 224 // 业务步骤：推进当前流程的下一项处理
  ); // 调用结束：参数列表与链式调用收尾
} // 结束函数体：本层作用域收尾

/** 解析 IPv4 映射 IPv6（::ffff:a.b.c.d 或 ::ffff:hhhh:hhhh 两种形态）对应的 IPv4 文本 */
function mappedIPv4(normalized: string): string | null { // 定义函数 mappedIPv4：封装可复用业务步骤
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // 保存 dotted：承载本步骤的计算结果供后续使用
  if (dotted) return dotted[1]!; // 条件分支：仅在满足业务前置条件时继续
  const hex = normalized.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/); // 保存 hex：承载本步骤的计算结果供后续使用
  if (hex) { // 条件分支：仅在满足业务前置条件时继续
    const high = Number.parseInt(hex[1]!, 16); // 保存 high：承载本步骤的计算结果供后续使用
    const low = Number.parseInt(hex[2]!, 16); // 保存 low：承载本步骤的计算结果供后续使用
    if (Number.isInteger(high) && Number.isInteger(low) && high <= 0xffff && low <= 0xffff) { // 条件分支：仅在满足业务前置条件时继续
      return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.'); // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
  } // 结束条件分支：本层作用域收尾
  return null; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 判断 IPv6 是否属于回环 / 链路本地 / 唯一本地 / IPv4 映射私网。 */
function isPrivateIPv6(ip: string): boolean { // 定义函数 isPrivateIPv6：封装可复用业务步骤
  const normalized = ip.toLowerCase(); // 保存 normalized：承载本步骤的计算结果供后续使用
  if (normalized === '::1' || normalized === '::') return true; // 条件分支：仅在满足业务前置条件时继续
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // 条件分支：仅在满足业务前置条件时继续
  const mapped = mappedIPv4(normalized); // 保存 mapped：承载本步骤的计算结果供后续使用
  if (mapped) return isPrivateIPv4(mapped); // 条件分支：仅在满足业务前置条件时继续
  return false; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 把单个 octet 文本按十进制 / 0x 十六进制 / 0 八进制解码；非法返回 null */
function decodeOctet(token: string): number | null { // 定义函数 decodeOctet：封装可复用业务步骤
  const trimmed = token.toLowerCase(); // 保存 trimmed：承载本步骤的计算结果供后续使用
  let value: number; // 保存 value：承载本步骤的计算结果供后续使用
  if (trimmed.startsWith('0x')) value = Number.parseInt(trimmed.slice(2), 16); // 条件分支：仅在满足业务前置条件时继续
  else if (trimmed.startsWith('0') && trimmed.length > 1) value = Number.parseInt(trimmed, 8); // 业务步骤：推进当前流程的下一项处理
  else value = Number.parseInt(trimmed, 10); // 业务步骤：推进当前流程的下一项处理
  if (!Number.isInteger(value) || value < 0 || value > 255) return null; // 条件分支：仅在满足业务前置条件时继续
  return value; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 解码整数型 IPv4（十进制/十六进制整数，如 2130706433 / 0x7f000001）；非法返回 null */
function decodeIntegerIPv4(host: string): string | null { // 定义函数 decodeIntegerIPv4：封装可复用业务步骤
  const trimmed = host.toLowerCase(); // 保存 trimmed：承载本步骤的计算结果供后续使用
  const value = trimmed.startsWith('0x') ? Number.parseInt(trimmed.slice(2), 16) : Number.parseInt(trimmed, 10); // 保存 value：承载本步骤的计算结果供后续使用
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null; // 条件分支：仅在满足业务前置条件时继续
  const octets = [24, 16, 8, 0].map((shift) => (value >> shift) & 0xff); // 保存 octets：承载本步骤的计算结果供后续使用
  return octets.join('.'); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 把可能被编码的主机名归一化为普通 IPv4 文本；无法识别为 IP 时返回 null */
function normalizeIPv4Host(host: string): string | null { // 定义函数 normalizeIPv4Host：封装可复用业务步骤
  if (isIP(host) === 4) return host; // 条件分支：仅在满足业务前置条件时继续
  if (host.includes('.')) { // 条件分支：仅在满足业务前置条件时继续
    const tokens = host.split('.'); // 保存 tokens：承载本步骤的计算结果供后续使用
    if (tokens.length === 4) { // 条件分支：仅在满足业务前置条件时继续
      const octets = tokens.map(decodeOctet); // 保存 octets：承载本步骤的计算结果供后续使用
      if (octets.every((o) => o !== null)) return (octets as number[]).join('.'); // 条件分支：仅在满足业务前置条件时继续
    } // 结束条件分支：本层作用域收尾
    return null; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾
  return decodeIntegerIPv4(host); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

export interface OutboundUrlOptions { // 声明类型 OutboundUrlOptions：约束跨模块数据结构
  /** 受信来源主机（host:port）：与配置站点 origin 一致的自指目标跳过私网/环回复核，仅保留协议白名单 */
  trustedHost?: string; // 业务步骤：推进当前流程的下一项处理
} // 结束代码块：本层作用域收尾

/**
 * 校验出站 URL：只允许 http/https；拒绝 localhost / 私网 / 环回 / 链路本地 / 元数据地址；
 * 域名先做编码 IP 解码，再解析全部 A/AAAA 记录并逐个复核私网（防 DNS 解析后指向内网）。
 * 相对路径（站内）由调用方自行放行，本函数只面对绝对出站地址。
 * 唯一例外：与受信 origin 主机完全一致的自指目标（站内相对路径补齐后的地址）不做私网拦截。
 */
export async function assertSafeOutboundUrl(raw: string, opts?: OutboundUrlOptions): Promise<void> { // 定义函数 assertSafeOutboundUrl：封装可复用业务步骤
  let url: URL; // 保存 url：承载本步骤的计算结果供后续使用
  try { // 异常保护：确保失败路径可回收资源
    url = new URL(raw); // 赋值：更新当前作用域中的状态
  } catch { // 结束代码块：本层作用域收尾
    throw new AppError('VALIDATION_FAILED', 'invalid url'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
  } // 结束代码块：本层作用域收尾
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError('VALIDATION_FAILED', 'unsupported url protocol'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
  if (opts?.trustedHost && url.host === opts.trustedHost) return; // 自指受信 origin：协议白名单已过，放行
  const host = url.hostname.replace(/^\[|\]$/g, ''); // 保存 host：承载本步骤的计算结果供后续使用
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new AppError('VALIDATION_FAILED', 'private host is not allowed'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求

  const normalizedV4 = normalizeIPv4Host(host); // 保存 normalizedV4：承载本步骤的计算结果供后续使用
  if (normalizedV4) { // 条件分支：仅在满足业务前置条件时继续
    if (isPrivateIPv4(normalizedV4)) throw new AppError('VALIDATION_FAILED', 'private address is not allowed'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    return; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾
  if (isIP(host) === 6) { // 条件分支：仅在满足业务前置条件时继续
    if (isPrivateIPv6(host)) throw new AppError('VALIDATION_FAILED', 'private address is not allowed'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    return; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾

  const records = await lookup(host, { all: true, verbatim: true }); // 保存 records：承载本步骤的计算结果供后续使用
  if (records.length === 0) throw new AppError('VALIDATION_FAILED', 'host cannot be resolved'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
  for (const record of records) { // 循环处理：逐项完成批量数据操作
    if (record.family === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('VALIDATION_FAILED', 'private address is not allowed'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
  } // 结束循环体：本层作用域收尾
} // 结束函数体：本层作用域收尾

/** 兼容既有调用方：旧名保留为 SSRF 加固后的同一实现 */
export async function assertPublicHttpUrl(raw: string): Promise<void> { // 定义函数 assertPublicHttpUrl：封装可复用业务步骤
  return assertSafeOutboundUrl(raw); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

const MAX_REDIRECTS = 5; // 保存 MAX_REDIRECTS：承载本步骤的计算结果供后续使用

/**
 * 安全出站 fetch：先复核目标，手动跟随重定向并逐跳校验 Location，
 * 防止 302 把请求带到内网 / 元数据地址；重定向次数超限即拒绝。
 */
export async function safeOutboundFetch(rawUrl: string, init?: RequestInit): Promise<Response> { // 定义函数 safeOutboundFetch：封装可复用业务步骤
  let current = rawUrl; // 保存 current：承载本步骤的计算结果供后续使用
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) { // 循环处理：逐项完成批量数据操作
    await assertSafeOutboundUrl(current); // 等待异步结果：串行完成依赖操作
    const res = await fetch(current, { ...init, redirect: 'manual' }); // 保存 res：承载本步骤的计算结果供后续使用
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { // 条件分支：仅在满足业务前置条件时继续
      const next = new URL(res.headers.get('location')!, current).toString(); // 保存 next：承载本步骤的计算结果供后续使用
      current = next; // 赋值：更新当前作用域中的状态
      continue; // 业务步骤：推进当前流程的下一项处理
    } // 结束条件分支：本层作用域收尾
    return res; // 返回结果：把本步骤产物交给调用方
  } // 结束循环体：本层作用域收尾
  throw new AppError('VALIDATION_FAILED', 'too many redirects to outbound url'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
} // 结束函数体：本层作用域收尾

// ===========================================================================
// 滑动窗口频控（基于 cache 适配层，Redis / 内存降级统一语义）
// ===========================================================================

export interface RateLimitResult { // 声明类型 RateLimitResult：约束跨模块数据结构
  ok: boolean; // 对象字段：声明结构中的一项数据
  count: number; // 对象字段：声明结构中的一项数据
  limit: number; // 对象字段：声明结构中的一项数据
  resetAt: string; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

/**
 * 滑动窗口计数：键维度为 scope（调用方拼 用户+目标 等），窗口内记录时间戳列表。
 * 超出 limit 返回 ok=false；不做硬删键，条目随 TTL 自然清理。
 */
export async function slidingWindow( // 定义函数 slidingWindow：封装可复用业务步骤
  cache: CacheBackend, // 对象字段：声明结构中的一项数据
  scope: string, // 对象字段：声明结构中的一项数据
  limit: number, // 对象字段：声明结构中的一项数据
  windowSeconds: number, // 对象字段：声明结构中的一项数据
): Promise<RateLimitResult> { // 调用结束：参数列表与链式调用收尾
  const key = `rl:${scope}`; // 保存 key：承载本步骤的计算结果供后续使用
  const now = Date.now(); // 保存 now：承载本步骤的计算结果供后续使用
  const windowMs = windowSeconds * 1000; // 保存 windowMs：承载本步骤的计算结果供后续使用
  const raw = await cache.get(key); // 保存 raw：承载本步骤的计算结果供后续使用
  let hits: number[] = []; // 保存 hits：承载本步骤的计算结果供后续使用
  try { // 异常保护：确保失败路径可回收资源
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown); // 保存 parsed：承载本步骤的计算结果供后续使用
    if (Array.isArray(parsed)) hits = parsed.filter((t): t is number => typeof t === 'number'); // 条件分支：仅在满足业务前置条件时继续
  } catch { // 结束代码块：本层作用域收尾
    hits = []; // 赋值：更新当前作用域中的状态
  } // 结束代码块：本层作用域收尾
  hits = hits.filter((t) => now - t < windowMs); // 赋值：更新当前作用域中的状态
  hits.push(now); // 业务步骤：推进当前流程的下一项处理
  await cache.set(key, JSON.stringify(hits), windowSeconds + 5); // 等待异步结果：串行完成依赖操作
  const resetAt = new Date(now + windowMs).toISOString(); // 保存 resetAt：承载本步骤的计算结果供后续使用
  return { ok: hits.length <= limit, count: hits.length, limit, resetAt }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 取共享缓存（供路由与中间件复用同一后端） */
export function cacheOf(env: Record<string, string | undefined>): CacheBackend { // 定义函数 cacheOf：封装可复用业务步骤
  return getSharedCache(env); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

// ===========================================================================
// 索引巡检：缺失索引建议 + 慢查询候选
// ===========================================================================

export interface MissingIndex { // 声明类型 MissingIndex：约束跨模块数据结构
  table: string; // 对象字段：声明结构中的一项数据
  columns: string; // 对象字段：声明结构中的一项数据
  reason: string; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

export interface SlowCandidate { // 声明类型 SlowCandidate：约束跨模块数据结构
  table: string; // 对象字段：声明结构中的一项数据
  pattern: string; // 对象字段：声明结构中的一项数据
  note: string; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

export interface IndexAudit { // 声明类型 IndexAudit：约束跨模块数据结构
  missing: MissingIndex[]; // 对象字段：声明结构中的一项数据
  slowCandidates: SlowCandidate[]; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

/** 业务高频过滤 / 排序字段 → 期望索引（列顺序与 WHERE 等值条件、排序方向对齐） */
const EXPECTED_INDEXES: ReadonlyArray<{ table: string; columns: string[]; reason: string }> = [ // 保存 EXPECTED_INDEXES：承载本步骤的计算结果供后续使用
  { table: 'content_reports', columns: ['reporter_id', 'target_type', 'target_id', 'created_at'], reason: '举报按 用户+目标 滑动窗口与我的举报列表' }, // 业务步骤：推进当前流程的下一项处理
  { table: 'community_threads', columns: ['board_id', 'status'], reason: '板块列表按板块 + 状态过滤（排序走 last_activity_at 既有索引）' }, // 业务步骤：推进当前流程的下一项处理
  { table: 'community_posts', columns: ['thread_id', 'created_at'], reason: '帖子回复按主题分组并按时间排序' }, // 业务步骤：推进当前流程的下一项处理
  { table: 'nav_links', columns: ['group_name'], reason: '导航目录按分组过滤（状态过滤走既有 status 单列索引）' }, // 业务步骤：推进当前流程的下一项处理
  { table: 'paid_assets', columns: ['kind', 'status', 'created_at'], reason: '资产列表按类型 / 状态过滤并按时间倒序' }, // 业务步骤：推进当前流程的下一项处理
]; // 集合结束：数组或索引表达式收尾

/** 已知慢查询候选：缺覆盖索引或 SELECT 列过宽的高频模式，供 DBA 复核执行计划 */
const SLOW_CANDIDATES: ReadonlyArray<SlowCandidate> = [ // 保存 SLOW_CANDIDATES：承载本步骤的计算结果供后续使用
  { table: 'community_threads', pattern: 'WHERE board_id = ? AND status = ? ORDER BY created_at DESC', note: '板块热帖列表；确认索引覆盖排序，避免 filesort' }, // 业务步骤：推进当前流程的下一项处理
  { table: 'community_posts', pattern: 'WHERE thread_id = ? ORDER BY created_at ASC', note: '长帖回复分页；关注深翻页 OFFSET 成本' }, // 业务步骤：推进当前流程的下一项处理
  { table: 'paid_assets', pattern: 'WHERE status = ? AND (title LIKE ? OR summary LIKE ?)', note: '模糊匹配无法走索引前缀；量大后需转全文检索' }, // 业务步骤：推进当前流程的下一项处理
  { table: 'content_reports', pattern: 'WHERE reporter_id = ? AND created_at > ?', note: '举报滑动窗口计数；见缺失索引建议' }, // 业务步骤：推进当前流程的下一项处理
]; // 集合结束：数组或索引表达式收尾

/** 巡检现有索引覆盖情况：返回缺失建议与慢查询候选，不执行任何 DDL。 */
export function inspectIndexes(db: Db): IndexAudit { // 定义函数 inspectIndexes：封装可复用业务步骤
  const missing: MissingIndex[] = []; // 保存 missing：承载本步骤的计算结果供后续使用
  for (const expected of EXPECTED_INDEXES) { // 循环处理：逐项完成批量数据操作
    const existing = db.prepare(`PRAGMA index_list(${expected.table})`).all() as Array<{ name: string }>; // 保存 existing：承载本步骤的计算结果供后续使用
    let covered = false; // 保存 covered：承载本步骤的计算结果供后续使用
    for (const idx of existing) { // 循环处理：逐项完成批量数据操作
      const info = db.prepare(`PRAGMA index_info(${idx.name})`).all() as Array<{ name: string }>; // 保存 info：承载本步骤的计算结果供后续使用
      const cols = info.map((c) => c.name); // 保存 cols：承载本步骤的计算结果供后续使用
      if (expected.columns.every((col) => cols.includes(col))) { // 条件分支：仅在满足业务前置条件时继续
        covered = true; // 赋值：更新当前作用域中的状态
        break; // 业务步骤：推进当前流程的下一项处理
      } // 结束条件分支：本层作用域收尾
    } // 结束函数体：本层作用域收尾
    if (!covered) missing.push({ table: expected.table, columns: expected.columns.join(', '), reason: expected.reason }); // 条件分支：仅在满足业务前置条件时继续
  } // 结束代码块：本层作用域收尾
  return { missing, slowCandidates: [...SLOW_CANDIDATES] }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾
