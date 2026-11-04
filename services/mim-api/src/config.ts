/**
 * 运行期常量。
 * 数据库路径为本地文件方案；JWT 密钥优先读取 MIM_JWT_SECRET 环境变量
 * （已登记 docs/wiki/09「应用自有机密」段），非生产环境回退本地文件。
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
export const DELETION_GRACE_DAYS = 7;
export const AUDIT_RETENTION_DAYS = 180;

/** 写操作必须携带 Idempotency-Key（08 §3.3）；auth 端点天然非幂等，已豁免 */
export const REQUIRE_IDEMPOTENCY = true;

/**
 * JWT 密钥加载（优先级从高到低）：
 * 1. `MIM_JWT_SECRET` 环境变量（生产必配，systemd 经 /opt/mim/mim-api.env 注入）；
 * 2. 非生产环境回退到本地 `.mim-dev-secret/jwt.key`（首次运行自动生成，已在 .gitignore 中）。
 * 生产环境缺失密钥即拒绝启动，避免静默使用可预测的本地文件密钥。
 */
export function loadJwtSecret(): string {
  const fromEnv = process.env.MIM_JWT_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error('MIM_JWT_SECRET 长度不足 32 字符，无法满足 HS256 签名要求');
    }
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须通过 MIM_JWT_SECRET 注入 JWT 密钥（deploy.sh §5 生成 /opt/mim/mim-api.env）');
  }
  if (existsSync(SECRET_FILE)) {
    const value = readFileSync(SECRET_FILE, 'utf8').trim();
    if (value.length >= 32) return value;
  }
  mkdirSync(SECRET_DIR, { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(SECRET_FILE, secret, { encoding: 'utf8' });
  return secret;
}
