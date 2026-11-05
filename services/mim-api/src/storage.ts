/**
 * media 域：对象存储准入（08 §2 media 域 / 08 §5 generation_assets）。
 *
 * 设计原则：
 * - 默认 LocalDiskStorage：无需任何云凭证即可真实落盘，预签名 URL 由 HMAC-SHA256 保护；
 * - S3Storage：仅当 MIM_STORAGE_S3_* 齐全时启用（阿里云 OSS / R2 / MinIO 等 S3 兼容端点通用）；
 * - 云驱动缺凭证时抛 STORAGE_NOT_CONFIGURED(503)，绝不伪造外部产物。
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '@mim/core-domain';

export type StorageDriver = 'local' | 's3';

export interface PresignedUrl {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expires_at: string;
}

export interface PresignInput {
  key: string;
  mime?: string;
  expires_seconds?: number;
  /** 本地驱动用它拼绝对地址；优先 MIM_PUBLIC_BASE_URL，其次调用方传入（如 req 的 host） */
  base_url?: string;
}

export interface SignatureCheck {
  method: 'PUT' | 'GET';
  key: string;
  expires: number;
  signature: string;
}

export interface StorageAdapter {
  driver: StorageDriver;
  configured: boolean;
  presignUpload(input: PresignInput): Promise<PresignedUrl>;
  presignDownload(input: PresignInput): Promise<PresignedUrl>;
  putObject(key: string, body: Buffer, mime: string): Promise<{ size_bytes: number; checksum: string }>;
  getObject(key: string): Promise<{ body: Buffer; mime: string }>;
  headObject(key: string): Promise<{ size_bytes: number; checksum: string } | null>;
  deleteObject(key: string): Promise<void>;
  verifySignature(check: SignatureCheck): boolean;
}

/** object_key 只允许安全字符与层级：禁止 `..` 穿越、禁止绝对路径 */
const KEY_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function assertSafeObjectKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..')) {
    throw new AppError('VALIDATION_FAILED', 'invalid object key', { object_key: key });
  }
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
  'application/json': '.json',
  'text/plain': '.txt',
};

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

export function extensionForMime(mime: string): string {
  return MIME_EXT[mime] ?? '.bin';
}

export function mimeForObjectKey(key: string): string {
  return EXT_MIME[extname(key).toLowerCase()] ?? 'application/octet-stream';
}

export function checksumOf(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function ttlSeconds(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return 900;
  return Math.min(Math.floor(value as number), 604800);
}

function isoAt(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function normalizeBase(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? 'http://127.0.0.1:8787').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** 本地磁盘驱动：真实写入 data/media，签名 URL 直接由本服务收发 */
class LocalDiskStorage implements StorageAdapter {
  readonly driver = 'local' as const;
  readonly configured = true;

  constructor(
    private readonly rootDir: string,
    private readonly secret: string,
  ) {}

  private objectPath(key: string): string {
    assertSafeObjectKey(key);
    return join(this.rootDir, key);
  }

  private sign(method: 'PUT' | 'GET', key: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${method}\n${key}\n${expires}`).digest('hex');
  }

  private buildUrl(baseUrl: string | undefined, method: 'PUT' | 'GET', key: string, ttl: number): PresignedUrl {
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const signature = this.sign(method, key, expires);
    const url = `${normalizeBase(baseUrl)}/api/v1/media/objects/${key}?expires=${expires}&signature=${signature}`;
    return { url, method, headers: {}, expires_at: isoAt(expires) };
  }

  async presignUpload(input: PresignInput): Promise<PresignedUrl> {
    assertSafeObjectKey(input.key);
    const result = this.buildUrl(input.base_url, 'PUT', input.key, ttlSeconds(input.expires_seconds));
    if (input.mime) result.headers['content-type'] = input.mime;
    return result;
  }

  async presignDownload(input: PresignInput): Promise<PresignedUrl> {
    assertSafeObjectKey(input.key);
    return this.buildUrl(input.base_url, 'GET', input.key, ttlSeconds(input.expires_seconds));
  }

  async putObject(key: string, body: Buffer, _mime: string) {
    const path = this.objectPath(key);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, body);
    return { size_bytes: body.byteLength, checksum: checksumOf(body) };
  }

  async getObject(key: string) {
    const path = this.objectPath(key);
    if (!existsSync(path)) throw new AppError('NOT_FOUND', 'object not found', { object_key: key });
    return { body: readFileSync(path), mime: mimeForObjectKey(key) };
  }

  async headObject(key: string) {
    const path = this.objectPath(key);
    if (!existsSync(path)) return null;
    const body = readFileSync(path);
    return { size_bytes: statSync(path).size, checksum: checksumOf(body) };
  }

  async deleteObject(key: string) {
    const path = this.objectPath(key);
    if (existsSync(path)) rmSync(path);
  }

  verifySignature(check: SignatureCheck): boolean {
    if (!Number.isFinite(check.expires) || check.expires * 1000 <= Date.now()) return false;
    const expected = this.sign(check.method, check.key, check.expires);
    if (expected.length !== check.signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(check.signature, 'hex'));
    } catch {
      return false;
    }
  }
}

interface S3Options {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** S3 兼容驱动：预签名交给 AWS SDK，服务端不经手字节流 */
class S3Storage implements StorageAdapter {
  readonly driver = 's3' as const;
  readonly configured: boolean;
  private readonly client: S3Client | null;

  constructor(private readonly opts: S3Options | null) {
    this.configured = opts !== null;
    this.client = opts
      ? new S3Client({
          region: opts.region,
          ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
          forcePathStyle: opts.forcePathStyle,
          credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
        })
      : null;
  }

  private requireClient(): { client: S3Client; bucket: string } {
    if (!this.client || !this.opts) {
      throw new AppError('STORAGE_NOT_CONFIGURED', 'S3 storage credentials are incomplete');
    }
    return { client: this.client, bucket: this.opts.bucket };
  }

  async presignUpload(input: PresignInput): Promise<PresignedUrl> {
    assertSafeObjectKey(input.key);
    const { client, bucket } = this.requireClient();
    const ttl = ttlSeconds(input.expires_seconds);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      ...(input.mime ? { ContentType: input.mime } : {}),
    });
    const url = await getSignedUrl(client, command, { expiresIn: ttl });
    const headers: Record<string, string> = {};
    if (input.mime) headers['content-type'] = input.mime;
    return { url, method: 'PUT', headers, expires_at: isoAt(Math.floor(Date.now() / 1000) + ttl) };
  }

  async presignDownload(input: PresignInput): Promise<PresignedUrl> {
    assertSafeObjectKey(input.key);
    const { client, bucket } = this.requireClient();
    const ttl = ttlSeconds(input.expires_seconds);
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: input.key }), {
      expiresIn: ttl,
    });
    return { url, method: 'GET', headers: {}, expires_at: isoAt(Math.floor(Date.now() / 1000) + ttl) };
  }

  async putObject(key: string, body: Buffer, mime: string) {
    const { client, bucket } = this.requireClient();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mime }));
    return { size_bytes: body.byteLength, checksum: checksumOf(body) };
  }

  async getObject(key: string) {
    const { client, bucket } = this.requireClient();
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = Buffer.from((await out.Body?.transformToByteArray()) ?? new Uint8Array());
    return { body, mime: out.ContentType ?? mimeForObjectKey(key) };
  }

  async headObject(key: string) {
    const { client, bucket } = this.requireClient();
    try {
      const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size_bytes: out.ContentLength ?? 0, checksum: out.ETag?.replace(/"/g, '') ?? '' };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string) {
    const { client, bucket } = this.requireClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  verifySignature(): boolean {
    // S3 预签名由云厂商校验，本地不做二次验签
    return false;
  }
}

export interface CreateStorageOptions {
  env: Record<string, string | undefined>;
  jwtSecret: string;
  /** 本地驱动的默认落盘目录（通常为 data/media） */
  fallbackDir: string;
}

export function createStorage(options: CreateStorageOptions): StorageAdapter {
  const { env, jwtSecret, fallbackDir } = options;
  const requested = (env.MIM_STORAGE_DRIVER ?? '').trim().toLowerCase();
  const bucket = (env.MIM_STORAGE_S3_BUCKET ?? '').trim();
  const accessKeyId = (env.MIM_STORAGE_S3_ACCESS_KEY_ID ?? '').trim();
  const secretAccessKey = (env.MIM_STORAGE_S3_SECRET_ACCESS_KEY ?? '').trim();
  const region = (env.MIM_STORAGE_S3_REGION ?? '').trim() || 'auto';

  const s3Ready = Boolean(bucket && accessKeyId && secretAccessKey);
  const driver: StorageDriver =
    requested === 's3' || requested === 'local' ? (requested as StorageDriver) : s3Ready ? 's3' : 'local';

  if (driver === 's3') {
    return new S3Storage(
      s3Ready
        ? {
            endpoint: (env.MIM_STORAGE_S3_ENDPOINT ?? '').trim() || undefined,
            region,
            bucket,
            accessKeyId,
            secretAccessKey,
            forcePathStyle: (env.MIM_STORAGE_S3_FORCE_PATH_STYLE ?? '') === '1',
          }
        : null,
    );
  }

  const localDir = (env.MIM_STORAGE_LOCAL_DIR ?? '').trim() || join(fallbackDir, 'media');
  return new LocalDiskStorage(localDir, jwtSecret);
}
