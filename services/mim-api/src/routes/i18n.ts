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
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 调百度翻译：未配置时返回 null，由上层回退原文。 */
async function translateByBaidu(deps: ApiDeps, text: string, target: string): Promise<string | null> {
  const appid = deps.env.MIM_BAIDU_TRANSLATE_APPID;
  const key = deps.env.MIM_BAIDU_TRANSLATE_KEY;
  if (!appid || !key) return null;
  const salt = String(Date.now());
  const sign = createHash('md5').update(`${appid}${text}${salt}${key}`).digest('hex');
  const params = new URLSearchParams({ q: text, from: 'auto', to: target, appid, salt, sign });
  const res = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`);
  const json = (await res.json()) as { trans_result?: Array<{ dst: string }>; error_code?: string };
  if (!res.ok || json.error_code || !json.trans_result?.length) return null;
  return json.trans_result.map((item) => item.dst).join('\n');
}

export function createI18nRouter(deps: ApiDeps): Router {
  const router = Router();

  /** 语言配置：前台与后台可分离。 */
  router.get('/i18n/settings', requireAuth, (_req, res) => {
    const row = deps.db.prepare("SELECT value FROM site_settings WHERE key = 'locales'").get() as { value: string } | undefined;
    const fallback = { front: 'zh-CN', admin: 'zh-CN', supported: ['zh-CN', 'en-US'], machine_translation: false };
    let settings: Record<string, unknown> = fallback;
    if (row) {
      try {
        settings = { ...fallback, ...(JSON.parse(row.value) as Record<string, unknown>) };
      } catch {
        settings = fallback; // 脏配置回退默认，避免整页失败
      }
    }
    res.json({ settings, provider_configured: !!(deps.env.MIM_BAIDU_TRANSLATE_APPID && deps.env.MIM_BAIDU_TRANSLATE_KEY) });
  });

  /** 更新语言配置：前台 / 后台语言分离。 */
  router.put('/i18n/settings', requirePermission('appearance:write'), (req, res) => {
    const body = parse(
      z.object({
        front: z.enum(['zh-CN', 'en-US']),
        admin: z.enum(['zh-CN', 'en-US']),
        machine_translation: z.boolean().default(false),
      }),
      req.body,
    );
    const value = JSON.stringify({ ...body, supported: ['zh-CN', 'en-US'] });
    deps.db
      .prepare('INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run('locales', value, new Date().toISOString());
    res.json({ ok: true, settings: JSON.parse(value) as unknown });
  });

  /** 翻译：命中缓存直接回；未配置供应商时明确返回未翻译。 */
  router.post('/i18n/translate', requireAuth, async (req, res) => {
    const body = parse(
      z.object({
        text: z.string().min(1).max(5000),
        target: z.enum(['zh-CN', 'en-US']),
        source: z.enum(['zh-CN', 'en-US']).optional(),
      }),
      req.body,
    );
    if (body.source === body.target) return res.json({ translated_text: body.text, provider: 'none', cached: false, translated: true });
    const hash = createHash('sha256').update(`${body.text}:${body.target}`).digest('hex');
    const cached = deps.db.prepare('SELECT translated_text, provider FROM translation_cache WHERE source_hash = ? AND target_lang = ?').get(hash, body.target) as
      | { translated_text: string; provider: string }
      | undefined;
    if (cached) return res.json({ translated_text: cached.translated_text, provider: cached.provider, cached: true, translated: true });
    const translated = await translateByBaidu(deps, body.text, langCode(body.target));
    if (!translated) {
      if (!deps.env.MIM_BAIDU_TRANSLATE_APPID) throw new AppError('PROVIDER_NOT_CONFIGURED', '机器翻译未配置，请设置 MIM_BAIDU_TRANSLATE_APPID / KEY');
      throw new AppError('INTERNAL_ERROR', '翻译服务暂时不可用');
    }
    deps.db
      .prepare('INSERT INTO translation_cache (id, source_hash, target_lang, source_text, translated_text, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`tr-${randomUUID()}`, hash, body.target, body.text, translated, 'baidu', new Date().toISOString());
    res.json({ translated_text: translated, provider: 'baidu', cached: false, translated: true });
  });

  return router;
}
