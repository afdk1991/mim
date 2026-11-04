/**
 * 运行期常量。
 * 刻意不新增任何 MIM_* 环境变量：09 清单未登记「应用自有配置」段，
 * env-check 会把模板外变量判为违规。数据库路径与 JWT 密钥均为本地文件方案。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(SRC_DIR, '../../..');
export const DATA_DIR = resolve(SRC_DIR, '../data');
export const DB_PATH = resolve(DATA_DIR, 'mim.db');
export const SECRET_DIR = resolve(REPO_ROOT, '.mim-dev-secret');
export const SECRET_FILE = resolve(SECRET_DIR, 'jwt.key');

/** 标准环境变量，非 MIM_ 命名，不触发 env-check 模板校验 */
export const PORT = Number(process.env.PORT ?? 8787);

export const ACCESS_TTL_SECONDS = 900;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600;
export const CODE_TTL_SECONDS = 300;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_LENGTH = 6;
export const CODE_RATE_LIMIT = 5;
export const CODE_RATE_WINDOW_MINUTES = 10;
export const LOGIN_LOCK_AFTER_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;
export const INVITATION_TTL_DAYS = 7;
export const DELETION_GRACE_DAYS = 7;
export const SYNC_PAGE_SIZE = 200;
export const AUDIT_RETENTION_DAYS = 180;

/** 写操作必须携带 Idempotency-Key（08 §3.3）；auth 端点天然非幂等，已豁免 */
export const REQUIRE_IDEMPOTENCY = true;

/** 首次运行生成本地开发 JWT 密钥；`.mim-dev-secret/` 已在 .gitignore 中 */
export function loadJwtSecret(): string {
  if (existsSync(SECRET_FILE)) {
    const value = readFileSync(SECRET_FILE, 'utf8').trim();
    if (value.length >= 32) return value;
  }
  mkdirSync(SECRET_DIR, { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(SECRET_FILE, secret, { encoding: 'utf8' });
  return secret;
}
