/** 外观路由：站点主题、导航与配色设置，页面区块的自由组合 */

import { Router } from 'express'; // 路由容器
import { randomUUID } from 'node:crypto'; // 区块主键
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 鉴权与写权限
import { parse } from '../validate.js'; // 校验错误翻译
import { readPointsConfig } from '../commerce/config.js'; // 积分抵扣开关与兑换口径（公开只读，供前端决定是否展示抵扣面板）
import type { ApiDeps } from '../types.js'; // 依赖容器

const ALLOWED_SETTINGS = new Set(['theme', 'locales', 'site', 'home']); // 允许通过 API 修改的设置键

/** 读单个 JSON 设置；缺失或脏数据时返回兜底值，供公开启动接口使用。 */
function readSetting(deps: ApiDeps, key: string): Record<string, unknown> {
  const row = deps.db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createAppearanceRouter(deps: ApiDeps): Router {
  const router = Router();

  /** 公开站点启动配置：免登录即可读首页指向、主题、语言与积分抵扣口径，供前端根路径重定向与公共页面渲染。 */
  router.get('/site/config', (_req, res) => {
    const home = readSetting(deps, 'home');
    const view = typeof home.view === 'string' && ['store', 'community'].includes(home.view) ? home.view : 'store';
    const points = readPointsConfig(deps.env); // 积分抵扣总开关 / 兑换比例 / 单笔上限；总开关关闭时前端整块隐藏抵扣面板
    res.json({
      home_view: view,
      theme: readSetting(deps, 'theme'),
      site: readSetting(deps, 'site'),
      locales: readSetting(deps, 'locales'),
      points_deduction: { enabled: points.enabled, points_per_yuan: points.pointsPerYuan, max_ratio_percent: points.maxRatioPercent },
    });
  });

  /** 外观总览：主题、语言、站点信息与页面清单。 */
  router.get('/appearance', requireAuth, (_req, res) => {
    const rows = deps.db.prepare('SELECT key, value, updated_at FROM site_settings').all() as Array<{ key: string; value: string; updated_at: string }>;
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value) as unknown;
      } catch {
        settings[row.key] = row.value; // 历史脏数据按字符串返回，避免整页 500
      }
    }
    const pages = deps.db.prepare('SELECT page, COUNT(*) AS blocks FROM page_blocks WHERE enabled = 1 GROUP BY page ORDER BY page').all();
    res.json({ settings, pages });
  });

  /** 更新设置：只接受白名单键，value 必须是 JSON 对象。 */
  router.put('/appearance/settings', requirePermission('appearance:write'), idempotency, (req, res) => {
    const body = parse(z.object({ key: z.string().min(1).max(40), value: z.record(z.string(), z.unknown()) }), req.body);
    if (!ALLOWED_SETTINGS.has(body.key)) throw new AppError('VALIDATION_FAILED', '不支持的外观设置键');
    deps.db
      .prepare('INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(body.key, JSON.stringify(body.value), new Date().toISOString());
    res.json({ ok: true, key: body.key });
  });

  /** 页面区块：按 page 返回启用区块，公开只读，供前台渲染器匿名消费（写操作仍走权限门禁）。 */
  router.get('/pages/:page', (req, res) => {
    const blocks = deps.db
      .prepare('SELECT id, page, kind, sort_order, config_json, updated_at FROM page_blocks WHERE page = ? AND enabled = 1 ORDER BY sort_order ASC')
      .all(req.params.page) as Array<Record<string, unknown> & { config_json: string }>;
    res.json({ page: req.params.page, blocks: blocks.map((block) => ({ ...block, config: JSON.parse(block.config_json) as unknown })) });
  });

  /** 新建区块：运营可自由组合首页 / 论坛 / 商城。 */
  router.post('/pages/:page/blocks', requirePermission('appearance:write'), idempotency, (req, res) => {
    const body = parse(
      z.object({
        kind: z.string().min(1).max(40),
        sort_order: z.number().int().min(0).max(999).default(99),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
      req.body,
    );
    const id = `block-${randomUUID()}`;
    const ts = new Date().toISOString();
    deps.db
      .prepare('INSERT INTO page_blocks (id, page, kind, sort_order, config_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(id, req.params.page, body.kind, body.sort_order, JSON.stringify(body.config), ts, ts);
    res.status(201).json({ ok: true, id });
  });

  /** 修改区块：配置、排序与启停。 */
  router.put('/pages/:page/blocks/:id', requirePermission('appearance:write'), idempotency, (req, res) => {
    const body = parse(
      z.object({
        config: z.record(z.string(), z.unknown()).optional(),
        sort_order: z.number().int().min(0).max(999).optional(),
        enabled: z.boolean().optional(),
      }),
      req.body,
    );
    const row = deps.db.prepare('SELECT id FROM page_blocks WHERE id = ? AND page = ?').get(req.params.id, req.params.page);
    if (!row) throw new AppError('NOT_FOUND', '区块不存在');
    if (body.config !== undefined) deps.db.prepare('UPDATE page_blocks SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(body.config), new Date().toISOString(), req.params.id);
    if (body.sort_order !== undefined) deps.db.prepare('UPDATE page_blocks SET sort_order = ?, updated_at = ? WHERE id = ?').run(body.sort_order, new Date().toISOString(), req.params.id);
    if (body.enabled !== undefined) deps.db.prepare('UPDATE page_blocks SET enabled = ?, updated_at = ? WHERE id = ?').run(body.enabled ? 1 : 0, new Date().toISOString(), req.params.id);
    res.json({ ok: true });
  });

  /** 删除区块。 */
  router.delete('/pages/:page/blocks/:id', requirePermission('appearance:write'), idempotency, (req, res) => {
    const changed = deps.db.prepare('DELETE FROM page_blocks WHERE id = ? AND page = ?').run(req.params.id, req.params.page);
    if (changed.changes === 0) throw new AppError('NOT_FOUND', '区块不存在');
    res.json({ ok: true });
  });

  /** 批量排序：ids 顺序即最终顺序。 */
  router.put('/pages/:page/reorder', requirePermission('appearance:write'), idempotency, (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string().min(1)).max(100) }), req.body);
    const tx = deps.db.transaction(() => {
      body.ids.forEach((id, index) => {
        deps.db.prepare('UPDATE page_blocks SET sort_order = ?, updated_at = ? WHERE id = ? AND page = ?').run(index + 1, new Date().toISOString(), id, req.params.page);
      });
    });
    tx();
    res.json({ ok: true, count: body.ids.length });
  });

  return router;
}
