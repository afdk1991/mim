/**
 * 功能模块商城（FR-03.1，07 §5.1 / §11.11）
 *
 * catalog 域 4 表已建：modules / module_prices / entitlements / entitlement_events；
 * 本文件补齐后端路由（此前仅有 requireEntitlement 中间件门禁，无商城侧写路径）。
 *
 * 路由一览：
 *   GET  /modules              公开 — 按 region 列出 active 模块（含当前有效价格）
 *   GET  /modules/:code        公开 — 模块详情（含前置依赖、当前有效价格）
 *   POST /entitlements         鉴权 — 请求解锁（校验前置依赖，发放 active entitlement + event）
 *   GET  /me/entitlements      鉴权 — 当前用户的有效解锁列表
 */

import { Router } from 'express';
import { z } from 'zod';
import { AppError, uuidv7 } from '@mim/core-domain';
import { clockOf } from '../domain.js';
import { idempotency, requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import { jsonParse } from '../utils.js';
import type { ApiDeps, Db } from '../types.js';

const MODULE_VISIBLE = new Set(['active']);

function activePrice(db: Db, moduleId: string, now: string) {
  return db
    .prepare(
      `SELECT currency, amount_minor, effective_from, effective_to
       FROM module_prices
       WHERE module_id = ? AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC
       LIMIT 1`,
    )
    .get(moduleId, now, now) as
    | { currency: string; amount_minor: number; effective_from: string; effective_to: string | null }
    | undefined;
}

function listPrices(db: Db, moduleId: string) {
  return db
    .prepare(
      `SELECT currency, amount_minor, effective_from, effective_to
       FROM module_prices
       WHERE module_id = ?
       ORDER BY effective_from DESC`,
    )
    .all(moduleId) as Array<{
    currency: string;
    amount_minor: number;
    effective_from: string;
    effective_to: string | null;
  }>;
}

function resolveActiveModules(db: Db, region: string) {
  const rows = db
    .prepare(
      `SELECT id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
              region, status, sort_order
       FROM modules
       WHERE region = ? AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(region) as Array<{
    id: string;
    code: string;
    name_i18n: string;
    summary_i18n: string;
    unlock_mode: string;
    entitlements_required: string;
    region: string;
    status: string;
    sort_order: number;
  }>;
  return rows;
}

export function createCatalogRouter(deps: ApiDeps): Router {
  const router = Router();
  const db = deps.db;

  // ---------- 公开：模块目录与详情 ----------

  /** GET /modules — 按 user.region 列出 active 模块（含当前有效价格） */
  router.get('/modules', (req, res) => {
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn';
    const now = deps.now ? deps.now() : new Date().toISOString();

    const rows = resolveActiveModules(db, region).filter((m) => MODULE_VISIBLE.has(m.status));
    const modules = rows.map((m) => {
      const price = activePrice(db, m.id, now);
      const requiredCodes = jsonParse<string[]>(m.entitlements_required) ?? [];
      const nameMap = jsonParse<Record<string, string>>(m.name_i18n) ?? { 'zh-CN': m.code };
      const summaryMap = jsonParse<Record<string, string>>(m.summary_i18n) ?? { 'zh-CN': '' };
      return {
        code: m.code,
        name: nameMap,
        summary: summaryMap,
        unlock_mode: m.unlock_mode,
        region: m.region,
        status: m.status,
        requires: requiredCodes,
        current_price: price
          ? { currency: price.currency, amount_minor: price.amount_minor }
          : null,
      };
    });
    res.json({ modules });
  });

  /** GET /modules/:code — 模块详情（含全部历史价格、前置依赖解析为模块码列表） */
  router.get('/modules/:code', (req, res) => {
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn';
    const now = deps.now ? deps.now() : new Date().toISOString();
    const code = pathSafe(req.params.code);

    const row = db
      .prepare(
        `SELECT id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
                region, status
         FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL`,
      )
      .get(code, region) as
      | {
          id: string;
          code: string;
          name_i18n: string;
          summary_i18n: string;
          unlock_mode: string;
          entitlements_required: string;
          region: string;
          status: string;
        }
      | undefined;
    if (!row) {
      throw new AppError('NOT_FOUND', 'module not found', { module_code: code, region });
    }

    const price = activePrice(db, row.id, now);
    const prices = listPrices(db, row.id);
    const requires = jsonParse<string[]>(row.entitlements_required) ?? [];
    const nameMap = jsonParse<Record<string, string>>(row.name_i18n) ?? { 'zh-CN': row.code };
    const summaryMap = jsonParse<Record<string, string>>(row.summary_i18n) ?? { 'zh-CN': '' };

    res.json({
      code: row.code,
      name: nameMap,
      summary: summaryMap,
      unlock_mode: row.unlock_mode,
      region: row.region,
      status: row.status,
      requires,
      current_price: price
        ? { currency: price.currency, amount_minor: price.amount_minor }
        : null,
      price_history: prices,
    });
  });

  // ---------- 鉴权：解锁与查询 ----------

  /** POST /entitlements — 请求解锁，校验前置依赖后发放 */
  router.post('/entitlements', requireAuth, idempotency, (req, res) => {
    const body = parse(
      z.object({
        module_code: z.string().min(1).max(64),
      }),
      req.body,
    );

    const user = req.user!;
    const now = deps.now ? deps.now() : new Date().toISOString();

    // 1. 模块存在且 active
    const moduleRow = db
      .prepare(
        `SELECT id, code, name_i18n, entitlements_required, unlock_mode, region, status
         FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL`,
      )
      .get(body.module_code, user.region) as
      | {
          id: string;
          code: string;
          name_i18n: string;
          entitlements_required: string;
          unlock_mode: string;
          region: string;
          status: string;
        }
      | undefined;
    if (!moduleRow) {
      throw new AppError('NOT_FOUND', 'module not found', { module_code: body.module_code });
    }
    if (moduleRow.status !== 'active') {
      throw new AppError('FEATURE_NOT_AVAILABLE', 'module is not available for unlock', {
        module_code: body.module_code,
      });
    }

    // 2. 重复解锁（已 active 且未过期）→ 409
    const existing = db
      .prepare(
        `SELECT id, status, expires_at FROM entitlements
         WHERE user_id = ? AND module_id = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(user.id, moduleRow.id, now) as
      | { id: string; status: string; expires_at: string | null }
      | undefined;
    if (existing?.status === 'active') {
      throw new AppError('CONFLICT', 'module already unlocked', {
        module_code: body.module_code,
        entitlement_id: existing.id,
      });
    }

    // 3. 前置依赖：每个 required 模块必须有 active entitlement
    const requiredCodes = jsonParse<string[]>(moduleRow.entitlements_required) ?? [];
    if (requiredCodes.length > 0) {
      const placeholders = requiredCodes.map(() => '?').join(',');
      const depRows = db
        .prepare(
          `SELECT m.code FROM modules m
           INNER JOIN entitlements e ON e.module_id = m.id
           WHERE m.region = ? AND m.code IN (${placeholders}) AND m.deleted_at IS NULL
             AND e.user_id = ? AND e.status = 'active'
             AND (e.expires_at IS NULL OR e.expires_at > ?)`,
        )
        .all(user.region, ...requiredCodes, user.id, now) as Array<{ code: string }>;
      const satisfied = new Set(depRows.map((d) => d.code));
      const missing = requiredCodes.filter((c) => !satisfied.has(c));
      if (missing.length > 0) {
        throw new AppError('FEATURE_NOT_AVAILABLE', 'module dependency not met', {
          required: missing,
        });
      }
    }

    // 4. 发放 entitlement + event（source CHECK 仅允许 'admin'，解锁请求走此通道）
    const entId = uuidv7();
    const evtId = uuidv7();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO entitlements (id, user_id, module_id, source, source_id, status, version, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', NULL, 'active', 1, ?, ?)`,
      ).run(entId, user.id, moduleRow.id, now, now);
      db.prepare(
        `INSERT INTO entitlement_events (id, entitlement_id, from_status, to_status, reason, actor, created_at)
         VALUES (?, ?, NULL, 'active', 'unlock_request', 'system', ?)`,
      ).run(evtId, entId, now);
    });
    tx();

    const ent = db
      .prepare(
        `SELECT id, status, expires_at, version, created_at, updated_at FROM entitlements WHERE id = ?`,
      )
      .get(entId) as {
      id: string;
      status: string;
      expires_at: string | null;
      version: number;
      created_at: string;
      updated_at: string;
    };
      const nameMap = jsonParse<Record<string, string>>(moduleRow.name_i18n) ?? { 'zh-CN': moduleRow.code };
      res.status(201).json({
        entitlement: {
          id: ent.id,
          module_code: moduleRow.code,
          module_name: nameMap,
          status: ent.status,
          expires_at: ent.expires_at,
          version: ent.version,
          created_at: ent.created_at,
        },
      });
  });

  /** GET /me/entitlements — 当前用户的有效解锁列表 */
  router.get('/me/entitlements', requireAuth, (req, res) => {
    const user = req.user!;
    const now = deps.now ? deps.now() : new Date().toISOString();

    const rows = db
      .prepare(
        `SELECT e.id, e.status, e.expires_at, e.created_at, m.code AS module_code, m.name_i18n AS module_name
         FROM entitlements e
         INNER JOIN modules m ON m.id = e.module_id
         WHERE e.user_id = ? AND m.region = ? AND m.deleted_at IS NULL
           AND (e.expires_at IS NULL OR e.expires_at > ?)
         ORDER BY e.created_at DESC`,
      )
      .all(user.id, user.region, now) as Array<{
      id: string;
      status: string;
      expires_at: string | null;
      created_at: string;
      module_code: string;
      module_name: string;
    }>;

    res.json({
      entitlements: rows.map((r) => {
        const nameMap = jsonParse<Record<string, string>>(r.module_name) ?? { 'zh-CN': r.module_code };
        return {
          id: r.id,
          module_code: r.module_code,
          module_name: nameMap,
          status: r.status,
          expires_at: r.expires_at,
          created_at: r.created_at,
        };
      }),
    });
  });

  return router;
}

function pathSafe(input: string): string {
  return input;
}
