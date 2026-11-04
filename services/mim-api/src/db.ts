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
  return db;
}

/** 套餐与价格幂等落库（以 core-domain 为唯一事实源） */
export function seedPlans(db: Db): void {
  const now = new Date().toISOString();
  const upsertPlan = db.prepare(
    `INSERT INTO plans (id, name_zh, name_en, features, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name_zh = excluded.name_zh,
       name_en = excluded.name_en,
       features = excluded.features`,
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
      upsertPlan.run(plan.id, plan.nameZh, plan.nameEn, JSON.stringify(plan.features), now);
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
