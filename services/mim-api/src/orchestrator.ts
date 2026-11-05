/**
 * ai-orchestrator：生成任务队列消费（08 §2/§3.2）。
 *
 * 职责：
 * 1. 轮询 queued 任务，`UPDATE ... WHERE status='queued'` 原子抢占为 running；
 * 2. 按 job_type 路由处理器；当前内置 mock 提供方（产物真实落盘，结果显式标注 provider=mock）；
 * 3. 真实提供方在未配置凭证时诚实失败（PROVIDER_NOT_CONFIGURED），不伪造外部产物；
 * 4. 成本预检（单任务上限 + 当日累计）超限直接失败（COST_LIMIT_EXCEEDED）；
 * 5. 成功产物写入 generation_assets；compose 成功驱动项目 generating → rendered。
 */

import { AppError } from '@mim/core-domain';
import { uuidv7 } from '@mim/core-domain';
import { checksumOf, extensionForMime, type StorageAdapter } from './storage.js';
import type { Db } from './types.js';

const JOB_TYPES = ['text', 'image', 'video', 'tts', 'compose'] as const;
type JobType = (typeof JOB_TYPES)[number];

const ASSET_TYPE_BY_JOB: Record<JobType, 'text' | 'image' | 'video' | 'audio' | 'final'> = {
  text: 'text',
  image: 'image',
  video: 'video',
  tts: 'audio',
  compose: 'final',
};

const MIME_BY_JOB: Record<JobType, string> = {
  text: 'application/json',
  image: 'image/png',
  video: 'application/json',
  tts: 'audio/wav',
  compose: 'application/json',
};

interface JobRow {
  id: string;
  project_id: string;
  storyboard_id: string | null;
  job_type: string;
  status: string;
  cost_estimate_minor: number | null;
  payload: string;
  created_by: string;
  created_at: string;
}

export interface RunResult {
  job_id: string;
  status: 'succeeded' | 'failed' | 'skipped';
  provider: string;
  asset_id?: string;
  object_key?: string;
  error_code?: string;
  message?: string;
}

export interface Orchestrator {
  readonly provider: string;
  readonly configured: boolean;
  readonly jobCostLimitMinor: number;
  readonly dailyCostLimitMinor: number;
  readonly assetTtlDays: number;
  capabilities(): Record<string, unknown>;
  tick(limit?: number): Promise<RunResult[]>;
  runOne(jobId: string): Promise<RunResult | null>;
  start(): void;
  stop(): void;
}

/** 1×1 透明 PNG：mock 产物是真实可解码图片，不是占位字符串 */
const MOCK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 0.5s 静音 WAV（8000Hz / 单声道 / 16bit）：可被播放器真实解码 */
function mockWav(): Buffer {
  const sampleRate = 8000;
  const durationMs = 500;
  const samples = (sampleRate * durationMs) / 1000;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function manifestOf(job: JobRow, note: string): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        provider: 'mock',
        job_id: job.id,
        job_type: job.job_type,
        project_id: job.project_id,
        storyboard_id: job.storyboard_id,
        payload: (() => {
          try {
            return JSON.parse(job.payload);
          } catch {
            return job.payload;
          }
        })(),
        note,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface CreateOrchestratorOptions {
  db: Db;
  storage: StorageAdapter;
  env: Record<string, string | undefined>;
  now?: () => string;
  /** 轮询间隔（毫秒），默认 2000 */
  intervalMs?: number;
}

export function createOrchestrator(options: CreateOrchestratorOptions): Orchestrator {
  const { db, storage, env } = options;
  const clock = options.now ?? (() => new Date().toISOString());
  const provider = (env.MIM_AI_PROVIDER ?? '').trim().toLowerCase() || 'mock';
  const configured = provider === 'mock';
  const jobCostLimitMinor = numberFromEnv(env.MIM_AI_JOB_COST_LIMIT_MINOR, 100000);
  const dailyCostLimitMinor = numberFromEnv(env.MIM_AI_DAILY_COST_LIMIT_MINOR, 500000);
  const assetTtlDays = numberFromEnv(env.MIM_AI_ASSET_TTL_DAYS, 90);
  const intervalMs = options.intervalMs ?? numberFromEnv(env.MIM_AI_WORKER_INTERVAL_MS, 2000);

  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function fail(job: JobRow, code: string, message: string): RunResult {
    db.prepare(
      `UPDATE generation_jobs SET status = 'failed', error_code = ?, result = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`,
    ).run(code, JSON.stringify({ error: message, provider }), clock(), job.id);
    return { job_id: job.id, status: 'failed', provider, error_code: code, message };
  }

  function expiresAtFor(jobType: JobType): string | null {
    // 成片长期保留（08 §6）；中间产物按保留期过期
    if (jobType === 'compose') return null;
    const at = new Date(Date.parse(clock()) + assetTtlDays * 86400000);
    return at.toISOString();
  }

  function bodyFor(jobType: JobType, job: JobRow): { body: Buffer; mime: string } {
    switch (jobType) {
      case 'image':
        return { body: Buffer.from(MOCK_PNG_BASE64, 'base64'), mime: 'image/png' };
      case 'tts':
        return { body: mockWav(), mime: 'audio/wav' };
      case 'video':
        return {
          body: manifestOf(job, 'mock provider does not fabricate binary video; manifest returned instead'),
          mime: 'application/json',
        };
      case 'compose':
        return {
          body: manifestOf(job, 'mock compose returns a manifest; connect a real renderer to emit MP4'),
          mime: 'application/json',
        };
      case 'text':
      default:
        return { body: manifestOf(job, 'mock text generation returns a structured manifest'), mime: 'application/json' };
    }
  }

  async function execute(job: JobRow): Promise<RunResult> {
    const jobType = JOB_TYPES.find((value) => value === job.job_type);
    if (!jobType) return fail(job, 'VALIDATION_FAILED', `unsupported job_type: ${job.job_type}`);

    const cost = job.cost_estimate_minor ?? 0;
    if (jobCostLimitMinor > 0 && cost > jobCostLimitMinor) {
      return fail(job, 'COST_LIMIT_EXCEEDED', `job cost ${cost} exceeds limit ${jobCostLimitMinor}`);
    }
    if (dailyCostLimitMinor > 0) {
      const dayStart = `${clock().slice(0, 10)}T00:00:00.000Z`;
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(cost_estimate_minor), 0) AS total FROM generation_jobs
           WHERE status = 'succeeded' AND created_at >= ?`,
        )
        .get(dayStart) as { total: number };
      if ((row?.total ?? 0) + cost > dailyCostLimitMinor) {
        return fail(job, 'COST_LIMIT_EXCEEDED', `daily cost exceeds limit ${dailyCostLimitMinor}`);
      }
    }

    if (!configured) {
      return fail(job, 'PROVIDER_NOT_CONFIGURED', `provider "${provider}" is not configured`);
    }

    const { body, mime } = bodyFor(jobType, job);
    const assetType = ASSET_TYPE_BY_JOB[jobType];
    const objectKey = `${job.created_by}/${job.project_id}/${job.id}-${assetType}${extensionForMime(mime)}`;
    const stored = await storage.putObject(objectKey, body, mime);
    const checksum = stored.checksum || checksumOf(body);
    const assetId = uuidv7();
    const now = clock();

    const finish = db.transaction(() => {
      db.prepare(
        `INSERT INTO generation_assets
           (id, job_id, project_id, asset_type, object_key, mime, duration_ms, size_bytes, checksum, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        assetId,
        job.id,
        job.project_id,
        assetType,
        objectKey,
        mime,
        jobType === 'tts' ? 500 : null,
        stored.size_bytes,
        checksum,
        expiresAtFor(jobType),
        now,
      );
      db.prepare(
        `UPDATE generation_jobs SET status = 'succeeded', result = ?, finished_at = ?
         WHERE id = ? AND status = 'running'`,
      ).run(
        JSON.stringify({
          provider,
          asset_id: assetId,
          object_key: objectKey,
          mime,
          size_bytes: stored.size_bytes,
          checksum,
        }),
        now,
        job.id,
      );
      // compose 成功 → 工程 generating → rendered（08 §3.2 联动）
      if (jobType === 'compose') {
        db.prepare(
          `UPDATE comic_projects SET status = 'rendered', updated_at = ?
           WHERE id = ? AND status = 'generating'`,
        ).run(now, job.project_id);
      }
    });
    finish();

    return { job_id: job.id, status: 'succeeded', provider, asset_id: assetId, object_key: objectKey };
  }

  async function runOne(jobId: string): Promise<RunResult | null> {
    const job = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as JobRow | undefined;
    if (!job) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId });
    if (job.status !== 'queued') {
      return { job_id: job.id, status: 'skipped', provider, message: `job is ${job.status}`, error_code: undefined };
    }

    const claimed = db
      .prepare(
        `UPDATE generation_jobs SET status = 'running', started_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(clock(), job.id);
    if (claimed.changes === 0) {
      return { job_id: job.id, status: 'skipped', provider, message: 'job was claimed by another worker' };
    }

    try {
      return await execute({ ...job, status: 'running' });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof Error ? err.message : String(err);
      return fail(job, code, message);
    }
  }

  async function tick(limit = 5): Promise<RunResult[]> {
    if (ticking) return [];
    ticking = true;
    try {
      const rows = db
        .prepare(
          `SELECT id FROM generation_jobs WHERE status = 'queued'
           ORDER BY created_at LIMIT ?`,
        )
        .all(limit) as Array<{ id: string }>;
      const results: RunResult[] = [];
      for (const row of rows) {
        const result = await runOne(row.id);
        if (result) results.push(result);
      }
      return results;
    } finally {
      ticking = false;
    }
  }

  function capabilities(): Record<string, unknown> {
    return {
      provider,
      provider_configured: configured,
      mock_provider: configured,
      supported_job_types: [...JOB_TYPES],
      job_cost_limit_minor: jobCostLimitMinor,
      daily_cost_limit_minor: dailyCostLimitMinor,
      asset_ttl_days: assetTtlDays,
      storage: { driver: storage.driver, configured: storage.configured },
      worker_enabled: (env.MIM_AI_WORKER ?? '1') !== '0',
      worker_interval_ms: intervalMs,
    };
  }

  return {
    provider,
    configured,
    jobCostLimitMinor,
    dailyCostLimitMinor,
    assetTtlDays,
    capabilities,
    tick,
    runOne,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick().catch((err) => console.error('[ai-orchestrator] tick failed', err));
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
