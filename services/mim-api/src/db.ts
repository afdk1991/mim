/** SQLite 连接、结构迁移与套餐种子数据 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS, PLAN_PRICES, REGION_CURRENCY } from '@mim/core-domain';
import type { Db } from './types.js';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

export function createDatabase(filename: string = ':memory:'): Db {
  if (filename !== ':memory:') {
    const dir = dirname(filename);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  seedPlans(db);
  seedModules(db);
  return db;
}

/** 功能模块商城种子：第 1 期上线 comic.workbench（cn / global 双区各一行） */
export function seedModules(db: Db): void {
  const now = new Date().toISOString();
  const upsertModule = db.prepare(
    `INSERT INTO modules
       (id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
        region, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'subscription', '[]', ?, 'active', ?, ?, ?)
     ON CONFLICT(region, code) DO UPDATE SET
       name_i18n = excluded.name_i18n,
       summary_i18n = excluded.summary_i18n,
       unlock_mode = excluded.unlock_mode,
       entitlements_required = excluded.entitlements_required,
       status = excluded.status,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
  );

  const modules = [
    {
      region: 'cn',
      nameI18n: { 'zh-CN': '漫剧创作工作台', 'en-US': 'Comic Creation Workbench' },
      summaryI18n: {
        'zh-CN': '剧本、分镜、角色一致性与对白由 AI 建议，人工确认后导出创作工程。',
        'en-US': 'AI-assisted script, storyboard, character consistency and dialogue, confirmed by humans before export.',
      },
    },
    {
      region: 'global',
      nameI18n: { 'zh-CN': '漫剧创作工作台', 'en-US': 'Comic Creation Workbench' },
      summaryI18n: {
        'zh-CN': '剧本、分镜、角色一致性与对白由 AI 建议，人工确认后导出创作工程。',
        'en-US': 'AI-assisted script, storyboard, character consistency and dialogue, confirmed by humans before export.',
      },
    },
  ] as const;

  const seed = db.transaction(() => {
    for (const module of modules) {
      upsertModule.run(
        `mod:comic.workbench:${module.region}`,
        'comic.workbench',
        JSON.stringify(module.nameI18n),
        JSON.stringify(module.summaryI18n),
        module.region,
        10,
        now,
        now,
      );
    }
  });
  seed();
}

/** 套餐与价格幂等落库（以 core-domain 为唯一事实源） */
export function seedPlans(db: Db): void {
  const now = new Date().toISOString();
  const upsertPlan = db.prepare(
    `INSERT INTO plans (id, name_zh, name_en, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name_zh = excluded.name_zh,
       name_en = excluded.name_en`,
  );
  const upsertPrice = db.prepare(
    `INSERT INTO plan_prices (id, plan_id, region, currency, cycle, amount_minor)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(plan_id, region, cycle) DO UPDATE SET
       currency = excluded.currency,
       amount_minor = excluded.amount_minor`,
  );

  const seed = db.transaction(() => {
    for (const plan of Object.values(PLANS)) {
      upsertPlan.run(plan.id, plan.nameZh, plan.nameEn, now);
    }
    for (const [region, byPlan] of Object.entries(PLAN_PRICES)) {
      for (const [planId, byCycle] of Object.entries(byPlan)) {
        for (const [cycle, amount] of Object.entries(byCycle)) {
          if (typeof amount !== 'number') continue;
          upsertPrice.run(
            `${planId}:${region}:${cycle}`,
            planId,
            region,
            REGION_CURRENCY[region as 'cn' | 'global'],
            cycle,
            amount,
          );
        }
      }
    }
  });
  seed();
}
