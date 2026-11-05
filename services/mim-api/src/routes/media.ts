/**
 * media 域（08 §2 / §8）：对象存储准入与产物下载
 *
 * 设计（08 §6）：
 * - 客户端不直连存储服务，统一由服务端签发短时预签名 URL；
 * - `object_key` 首段固定为上传者 user_id，跨用户一律按 404 处理，不泄漏存在性；
 * - 中间产物有保留期（generation_assets.expires_at），成片长期保留；
 * - 本地驱动（默认）真实读写 data/media，对象收发端点凭 HMAC 签名免鉴权；
 *   S3 兼容驱动由云厂商直接收发对象，本服务只签发预签名 URL。
 */

import express, { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, uuidv7 } from '@mim/core-domain';
import { clockOf } from '../domain.js';
import { idempotency, requireAuth, requireEntitlement } from '../middleware.js';
import {
  assertSafeObjectKey,
  extensionForMime,
  mimeForObjectKey,
  type StorageAdapter,
} from '../storage.js';
import { parse } from '../validate.js';
import type { ApiDeps, Db } from '../types.js';

/** 工作台的解锁模块编码（与 db.ts seedModules / comic 路由保持一致） */
const MODULE_CODE = 'comic.workbench';

const ASSET_TYPES = ['image', 'video', 'audio', 'text', 'final'] as const;

const presignUploadBody = z.object({
  asset_type: z.enum(ASSET_TYPES),
  mime: z.string().trim().min(3).max(120),
  project_id: z.string().min(1).optional(),
  size_bytes: z.number().int().min(0).max(1024 * 1024 * 1024).optional(),
  expires_seconds: z.number().int().min(60).max(604800).optional(),
});

const presignDownloadQuery = z.object({
  object_key: z.string().min(1).max(512),
  expires_seconds: z.coerce.number().int().min(60).max(604800).optional(),
});

const listAssetsQuery = z.object({
  project_id: z.string().min(1).optional(),
  asset_type: z.enum(ASSET_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

interface AssetRow {
  id: string;
  job_id: string;
  project_id: string;
  asset_type: string;
  object_key: string;
  mime: string;
  duration_ms: number | null;
  size_bytes: number | null;
  checksum: string;
  expires_at: string | null;
  created_at: string;
}

interface ProjectRow {
  id: string;
  title: string;
}

/** 只允许读取「本人 + 未删除」的创作工程；跨用户与不存在一律 404 */
function findOwnedProject(db: Db, userId: string, projectId: string): ProjectRow {
  const row = db
    .prepare(
      `SELECT id, title FROM comic_projects
       WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL`,
    )
    .get(projectId, userId) as ProjectRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'comic project not found', { project_id: projectId });
  return row;
}

/** object_key 首段是签名主体；不匹配本人即 404（不泄漏对象是否存在） */
function assertOwnedKey(userId: string, key: string): void {
  assertSafeObjectKey(key);
  if (!key.startsWith(`${userId}/`)) {
    throw new AppError('NOT_FOUND', 'object not found', { object_key: key });
  }
}

/** 本地驱动拼绝对地址；优先 MIM_PUBLIC_BASE_URL，其次按请求 host 推导（反代后仍是公网域名） */
function baseUrlOf(req: Request, env: Record<string, string | undefined>): string | undefined {
  const configured = (env.MIM_PUBLIC_BASE_URL ?? '').trim();
  if (configured) return configured;
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : undefined;
}

function requireStorage(deps: ApiDeps): StorageAdapter {
  if (!deps.storage) throw new AppError('STORAGE_NOT_CONFIGURED', 'object storage is not available');
  return deps.storage;
}

function assetPayload(row: AssetRow) {
  return {
    id: row.id,
    job_id: row.job_id,
    project_id: row.project_id,
    asset_type: row.asset_type,
    object_key: row.object_key,
    mime: row.mime,
    duration_ms: row.duration_ms,
    size_bytes: row.size_bytes,
    checksum: row.checksum,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

/** Express 5 的 `*splat` 参数为段数组，按 `/` 还原并做安全校验 */
function splatKey(req: Request): string {
  const raw: unknown = req.params.splat;
  const key = Array.isArray(raw) ? raw.join('/') : typeof raw === 'string' ? raw : '';
  if (!key) throw new AppError('VALIDATION_FAILED', 'object key is required');
  assertSafeObjectKey(key);
  return key;
}

/**
 * 对象收发端点（挂载在全局 JSON 解析之前）：
 * - 免鉴权，凭 URL 中的 expires + signature 校验；
 * - 仅本地驱动提供该端点；S3 驱动由云厂商直连，这里返回 404。
 */
export function createMediaObjectRouter(deps: ApiDeps): Router {
  const router = Router();

  function guard(req: Request): StorageAdapter {
    if (deps.storage?.driver !== 'local') {
      throw new AppError('NOT_FOUND', 'object endpoint is only served by the local storage driver');
    }
    return requireStorage(deps);
  }

  function signatureOf(req: Request): { expires: number; signature: string } {
    const expiresRaw = req.query.expires;
    const expires = Number(Array.isArray(expiresRaw) ? expiresRaw[0] : expiresRaw);
    const signatureRaw = req.query.signature;
    const signature = Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw;
    if (!Number.isInteger(expires) || !signature || typeof signature !== 'string') {
      throw new AppError('AUTH_UNAUTHORIZED', 'storage signature is missing');
    }
    return { expires, signature };
  }

  // 原始字节上传：该路由自带的 raw 解析器在全局 express.json 之前生效
  router.put('/media/objects/*splat', express.raw({ type: () => true, limit: '64mb' }), async (req, res) => {
    const storage = guard(req);
    const key = splatKey(req);
    const { expires, signature } = signatureOf(req);
    if (!storage.verifySignature({ method: 'PUT', key, expires, signature })) {
      throw new AppError('AUTH_UNAUTHORIZED', 'storage signature rejected');
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.byteLength === 0) {
      throw new AppError('VALIDATION_FAILED', 'uploaded object body is empty');
    }
    const mime = req.header('content-type') ?? mimeForObjectKey(key);
    const stored = await storage.putObject(key, body, mime);
    res.status(204).setHeader('x-object-checksum', stored.checksum);
    res.end();
  });

  router.get('/media/objects/*splat', async (req, res) => {
    const storage = guard(req);
    const key = splatKey(req);
    const { expires, signature } = signatureOf(req);
    if (!storage.verifySignature({ method: 'GET', key, expires, signature })) {
      throw new AppError('AUTH_UNAUTHORIZED', 'storage signature rejected');
    }
    const object = await storage.getObject(key);
    res.status(200).type(object.mime).send(object.body);
  });

  return router;
}

/** 受保护的 media 控制面：签发预签名 URL、查询产物 */
export function createMediaRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireEntitlement(MODULE_CODE));

  router.post('/media/presign/upload', idempotency, async (req, res) => {
    const body = parse(presignUploadBody, req.body);
    const user = req.user!;
    const storage = requireStorage(deps);

    let projectId: string | null = null;
    if (body.project_id) {
      projectId = findOwnedProject(deps.db, user.id, body.project_id).id;
    }

    const key = `${user.id}/${projectId ?? 'uploads'}/${uuidv7()}${extensionForMime(body.mime)}`;
    const presigned = await storage.presignUpload({
      key,
      mime: body.mime,
      expires_seconds: body.expires_seconds,
      base_url: baseUrlOf(req, deps.env),
    });

    res.status(201).json({
      upload: presigned,
      object_key: key,
      asset_type: body.asset_type,
      expires_at: presigned.expires_at,
    });
  });

  router.get('/media/presign/download', async (req, res) => {
    const query = parse(presignDownloadQuery, req.query);
    const user = req.user!;
    const storage = requireStorage(deps);
    assertOwnedKey(user.id, query.object_key);

    if ((await storage.headObject(query.object_key)) === null) {
      throw new AppError('NOT_FOUND', 'object not found', { object_key: query.object_key });
    }

    const presigned = await storage.presignDownload({
      key: query.object_key,
      expires_seconds: query.expires_seconds,
      base_url: baseUrlOf(req, deps.env),
    });
    res.json({ download: presigned, object_key: query.object_key, expires_at: presigned.expires_at });
  });

  router.get('/media/assets', async (req, res) => {
    const query = parse(listAssetsQuery, req.query);
    const user = req.user!;
    const storage = requireStorage(deps);

    const conditions = ['p.owner_user_id = ?', 'p.deleted_at IS NULL'];
    const values: unknown[] = [user.id];
    if (query.project_id) {
      conditions.push('a.project_id = ?');
      values.push(findOwnedProject(deps.db, user.id, query.project_id).id);
    }
    if (query.asset_type) {
      conditions.push('a.asset_type = ?');
      values.push(query.asset_type);
    }
    const now = clockOf(deps);
    conditions.push('(a.expires_at IS NULL OR a.expires_at > ?)');
    values.push(now);
    values.push(query.limit);

    const rows = deps.db
      .prepare(
        `SELECT a.* FROM generation_assets a
         JOIN comic_projects p ON p.id = a.project_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.created_at DESC
         LIMIT ?`,
      )
      .all(...values) as AssetRow[];

    const items = await Promise.all(
      rows.map(async (row) => {
        const presigned = await storage.presignDownload({
          key: row.object_key,
          base_url: baseUrlOf(req, deps.env),
        });
        return { ...assetPayload(row), download_url: presigned.url };
      }),
    );

    res.json({ items });
  });

  return router;
}

/** 供 ai 路由复用：校验任务经工程归属 */
export function ownedJobProjectId(db: Db, userId: string, jobId: string): string | null {
  const row = db
    .prepare(
      `SELECT j.project_id FROM generation_jobs j
       JOIN comic_projects p ON p.id = j.project_id
       WHERE j.id = ? AND p.owner_user_id = ? AND p.deleted_at IS NULL`,
    )
    .get(jobId, userId) as { project_id: string } | undefined;
  return row?.project_id ?? null;
}
