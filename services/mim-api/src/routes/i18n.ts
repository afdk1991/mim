/** 国际化路由：机器翻译适配与前后台语言分离配置 */

import { Router } from 'express'; // 路由容器
import { createHash, randomUUID } from 'node:crypto'; // 缓存键与记录主键
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { requireAuth, requirePermission } from '../middleware.js'; // 鉴权
import { parse } from '../validate.js'; // 校验错误翻译
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 语言标签映射：站内 zh-CN / en-US 对应翻译服务的 zh / en。 */
function langCode(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'; // 返回当前函数的处理结果
} // 代码块结束

/** 调百度翻译：未配置时返回 null，由上层回退原文。 */
async function translateByBaidu(deps: ApiDeps, text: string, target: string): Promise<string | null> {
  const appid = deps.env.MIM_BAIDU_TRANSLATE_APPID; // 常量 appid：保存固定配置或一次性派生值
  const key = deps.env.MIM_BAIDU_TRANSLATE_KEY; // 常量 key：保存固定配置或一次性派生值
  if (!appid || !key) return null; // 条件分支：按判断结果选择后续处理路径
  const salt = String(Date.now()); // 常量 salt：保存固定配置或一次性派生值
  const sign = createHash('md5').update(`${appid}${text}${salt}${key}`).digest('hex'); // 常量 sign：保存固定配置或一次性派生值
  const params = new URLSearchParams({ q: text, from: 'auto', to: target, appid, salt, sign }); // 常量 params：保存固定配置或一次性派生值
  const res = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`); // 常量 res：保存固定配置或一次性派生值
  const json = (await res.json()) as { trans_result?: Array<{ dst: string }>; error_code?: string }; // 常量 json：保存固定配置或一次性派生值
  if (!res.ok || json.error_code || !json.trans_result?.length) return null; // 条件分支：按判断结果选择后续处理路径
  return json.trans_result.map((item) => item.dst).join('\n'); // 返回当前函数的处理结果
} // 代码块结束

export function createI18nRouter(deps: ApiDeps): Router { // 导出函数 createI18nRouter：对外暴露的调用入口
  const router = Router(); // 常量 router：保存固定配置或一次性派生值

  /** 语言配置：前台与后台可分离。 */
  router.get('/i18n/settings', requireAuth, (_req, res) => {
    const row = deps.db.prepare("SELECT value FROM site_settings WHERE key = 'locales'").get() as { value: string } | undefined; // 常量 row：保存固定配置或一次性派生值
    const fallback = { front: 'zh-CN', admin: 'zh-CN', supported: ['zh-CN', 'en-US'], machine_translation: false }; // 常量 fallback：保存固定配置或一次性派生值
    let settings: Record<string, unknown> = fallback; // 可变变量 settings：运行过程中会被重新赋值
    if (row) { // 条件分支：按判断结果选择后续处理路径
      try { // 异常捕获起点：包裹可能抛出错误的操作
        settings = { ...fallback, ...(JSON.parse(row.value) as Record<string, unknown>) }; // 赋值：更新变量 settings 的取值
      } catch { // 代码块结束
        settings = fallback; // 脏配置回退默认，避免整页失败
      } // 代码块结束
    } // 代码块结束
    res.json({ settings, provider_configured: !!(deps.env.MIM_BAIDU_TRANSLATE_APPID && deps.env.MIM_BAIDU_TRANSLATE_KEY) }); // 执行当前业务步骤
  }); // 代码块结束

  /** 更新语言配置：前台 / 后台语言分离。 */
  router.put('/i18n/settings', requirePermission('appearance:write'), (req, res) => {
    const body = parse( // 常量 body：保存固定配置或一次性派生值
      z.object({ // 执行当前业务步骤
        front: z.enum(['zh-CN', 'en-US']), // 对象字段 front：记录一项配置或数据
        admin: z.enum(['zh-CN', 'en-US']), // 对象字段 admin：记录一项配置或数据
        machine_translation: z.boolean().default(false), // 对象字段 machine_translation：记录一项配置或数据
      }), // 代码块结束
      req.body, // 执行当前业务步骤
    ); // 执行当前业务步骤
    const value = JSON.stringify({ ...body, supported: ['zh-CN', 'en-US'] }); // 常量 value：保存固定配置或一次性派生值
    deps.db // 执行当前业务步骤
      .prepare('INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at') // 执行当前业务步骤
      .run('locales', value, new Date().toISOString()); // 执行当前业务步骤
    res.json({ ok: true, settings: JSON.parse(value) as unknown }); // 执行当前业务步骤
  }); // 代码块结束

  /** 翻译：命中缓存直接回；未配置供应商时明确返回未翻译。 */
  router.post('/i18n/translate', requireAuth, async (req, res) => {
    const body = parse( // 常量 body：保存固定配置或一次性派生值
      z.object({ // 执行当前业务步骤
        text: z.string().min(1).max(5000), // 对象字段 text：记录一项配置或数据
        target: z.enum(['zh-CN', 'en-US']), // 对象字段 target：记录一项配置或数据
        source: z.enum(['zh-CN', 'en-US']).optional(), // 对象字段 source：记录一项配置或数据
      }), // 代码块结束
      req.body, // 执行当前业务步骤
    ); // 执行当前业务步骤
    if (body.source === body.target) return res.json({ translated_text: body.text, provider: 'none', cached: false, translated: true }); // 条件分支：按判断结果选择后续处理路径
    const hash = createHash('sha256').update(`${body.text}:${body.target}`).digest('hex'); // 常量 hash：保存固定配置或一次性派生值
    const cached = deps.db.prepare('SELECT translated_text, provider FROM translation_cache WHERE source_hash = ? AND target_lang = ?').get(hash, body.target) as // 常量 cached：保存固定配置或一次性派生值
      | { translated_text: string; provider: string } // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (cached) return res.json({ translated_text: cached.translated_text, provider: cached.provider, cached: true, translated: true }); // 条件分支：按判断结果选择后续处理路径
    const translated = await translateByBaidu(deps, body.text, langCode(body.target)); // 常量 translated：保存固定配置或一次性派生值
    if (!translated) { // 条件分支：按判断结果选择后续处理路径
      if (!deps.env.MIM_BAIDU_TRANSLATE_APPID) throw new AppError('PROVIDER_NOT_CONFIGURED', '机器翻译未配置，请设置 MIM_BAIDU_TRANSLATE_APPID / KEY'); // 条件分支：按判断结果选择后续处理路径
      throw new AppError('INTERNAL_ERROR', '翻译服务暂时不可用'); // 抛出错误：中断当前流程并向上层传递
    } // 代码块结束
    deps.db // 执行当前业务步骤
      .prepare('INSERT INTO translation_cache (id, source_hash, target_lang, source_text, translated_text, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)') // 执行当前业务步骤
      .run(`tr-${randomUUID()}`, hash, body.target, body.text, translated, 'baidu', new Date().toISOString()); // 执行当前业务步骤
    res.json({ translated_text: translated, provider: 'baidu', cached: false, translated: true }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
