/**
 * 站点模块地图（site 域）公开路由
 *
 *   GET /site/overview                 全站概览：zone / 分类 / 模块数
 *   GET /site/modules?zone=&category=&q=  模块列表（可组合过滤，未知参数 400）
 *   GET /site/modules/:host            单模块详情（未知主机 404）
 *
 * 数据为静态常量（src/site.ts），不读写数据库、不要求鉴权。
 */

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@mim/core-domain';
import { parse } from '../validate.js';
import { pathParam } from '../utils.js';
import {
  SITE_CATEGORIES,
  SITE_MODULES,
  SITE_ZONES,
  isSiteCategory,
  isSiteZone,
} from '../site.js';
import type { SiteCategoryId, SiteModule, SiteZoneId } from '../site.js';

const querySchema = z.strictObject({
  zone: z.string().max(32).optional(),
  category: z.string().max(32).optional(),
  q: z.string().max(64).optional(),
});

const categoryName = (id: SiteCategoryId) => SITE_CATEGORIES.find((c) => c.id === id)!.name;

function present(module: SiteModule, zone?: SiteZoneId) {
  const records = zone ? module.records.filter((r) => r.zone === zone) : module.records;
  return {
    host: module.host,
    category: module.category,
    category_name: categoryName(module.category),
    label: module.label,
    description: module.description,
    urls: records.map((r) => `https://${r.fqdn}`),
    records,
  };
}

function matches(module: SiteModule, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    module.host,
    module.label,
    module.description,
    ...module.urls,
    ...module.records.flatMap((r) => [r.fqdn, r.record_value, r.label ?? '', r.description ?? '']),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function createSiteRouter(): Router {
  const router = Router();

  /** GET /site/overview — 分类与 zone 维度计数 */
  router.get('/site/overview', (_req, res) => {
    res.json({
      total: SITE_MODULES.length,
      zones: SITE_ZONES.map((zone) => ({
        id: zone.id,
        apex: zone.apex,
        default_record_value: zone.record_value,
        count: SITE_MODULES.filter((m) => m.records.some((r) => r.zone === zone.id)).length,
      })),
      categories: SITE_CATEGORIES.map((category) => ({
        id: category.id,
        name: category.name,
        count: SITE_MODULES.filter((m) => m.category === category.id).length,
      })),
    });
  });

  /** GET /site/modules — 组合过滤：zone / category / q */
  router.get('/site/modules', (req, res) => {
    const query = parse(querySchema, req.query);

    if (query.zone !== undefined && !isSiteZone(query.zone)) {
      throw new AppError('VALIDATION_FAILED', 'unknown zone', {
        zone: query.zone,
        allowed: SITE_ZONES.map((z) => z.id),
      });
    }
    if (query.category !== undefined && !isSiteCategory(query.category)) {
      throw new AppError('VALIDATION_FAILED', 'unknown category', {
        category: query.category,
        allowed: SITE_CATEGORIES.map((c) => c.id),
      });
    }

    const zone = query.zone as SiteZoneId | undefined;
    const items = SITE_MODULES.filter((m) => !zone || m.records.some((r) => r.zone === zone))
      .filter((m) => !query.category || m.category === query.category)
      .filter((m) => matches(m, query.q ?? ''))
      .map((m) => present(m, zone));

    res.json({
      total: items.length,
      module_total: SITE_MODULES.length,
      filters: {
        zone: zone ?? null,
        category: query.category ?? null,
        q: query.q?.trim() || null,
      },
      items,
    });
  });

  /** GET /site/modules/:host — 单模块（host 为主机记录，如 gy / api / @） */
  router.get('/site/modules/:host', (req, res) => {
    const host = pathParam(req, 'host').toLowerCase();
    const module = SITE_MODULES.find((m) => m.host.toLowerCase() === host);
    if (!module) {
      throw new AppError('NOT_FOUND', 'site module not found', { host });
    }
    res.json({ module: present(module) });
  });

  return router;
}
