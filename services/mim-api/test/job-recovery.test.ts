/** 单元测试：生成任务崩溃恢复（orchestrator 的 running 超时回收）——失联任务重入队 / 超上限判失败 / 在跑任务不误伤 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排；afterEach 负责清理临时落盘
import { mkdtempSync, rmSync } from 'node:fs'; // 真实落盘目录：mock 产物需要可写存储
import { tmpdir } from 'node:os'; // 系统临时目录
import { join } from 'node:path'; // 拼接临时目录
import { createDatabase } from '../src/db.js'; // 建库入口：内存库已含最新结构与增量列
import { createOrchestrator } from '../src/orchestrator.js'; // 待测工厂
import { createStorage } from '../src/storage.js'; // 生产同款本地驱动，避免用替身掩盖真实落盘问题

const NOW = '2026-11-07T05:00:00.000Z'; // 冻结时钟：回收阈值与时间窗口都以此为基准，断言可复现

let db: ReturnType<typeof createDatabase>; // 每例独立的内存库
let storageDir: string; // 每例独立的落盘目录
let storage: ReturnType<typeof createStorage>; // 复用同一个存储实例

beforeEach(() => { // 每例前置：全新库 + 全新目录，避免用例互相污染
  db = createDatabase(':memory:'); // 结构来自 schema.sql，同时验证新列已建好
  storageDir = mkdtempSync(join(tmpdir(), 'mim-recovery-')); // 建临时落盘目录
  storage = createStorage({ // 本地驱动，零云依赖
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir }, // 显式本地驱动
    jwtSecret: 'test-secret-for-hmac-signing-32ch', // 预签名密钥（本用例不校验签名）
    fallbackDir: storageDir, // 兜底目录同临时目录
  }); // 存储构造结束
}); // beforeEach 结束

/** 构造编排器：mock 提供方 + 冻结时钟，便于断言状态迁移而不触网 */
function makeOrchestrator(env: Record<string, string | undefined> = {}) { // env 可覆盖阈值配置
  return createOrchestrator({ // 工厂调用
    db, // 共享内存库
    storage, // 共享临时存储
    env: { MIM_AI_PROVIDER: 'mock', ...env }, // 显式 mock，保证 tick 不尝试外网调用
    now: () => NOW, // 固定时钟
    intervalMs: 60_000, // 用例内不靠定时器，给一个大间隔避免干扰
  }); // 工厂调用结束
} // makeOrchestrator 结束

/** 插入一条生成任务：状态与开始时间由用例控制，attempts 用于验证回收上限 */
function insertJob(id: string, status: string, startedAt: string | null, attempts = 0): void { // 只构造断言所需列
  db.prepare( // 预编译插入
    `INSERT INTO generation_jobs
       (id, project_id, job_type, status, attempts, payload, created_by, created_at, started_at)
     VALUES (?, 'proj-rec', 'text', ?, ?, '{"prompt":"hello"}', 'tester', ?, ?)`, // text + mock 可离线产出真实 JSON 产物
  ).run(id, status, attempts, NOW, startedAt); // 入队时间固定为 NOW，便于计算超时
} // insertJob 结束

/** 读取任务当前状态与回收计数，断言迁移结果 */
function jobState(id: string): { status: string; attempts: number; error_code: string | null } { // 只取断言需要的三列
  return db.prepare(`SELECT status, attempts, error_code FROM generation_jobs WHERE id = ?`).get(id) as { // 按主键定位
    status: string; // queued / running / succeeded / failed
    attempts: number; // 被回收重新入队的次数
    error_code: string | null; // 失败码
  }; // 结果类型结束
} // jobState 结束

describe('orchestrator 失联任务回收', () => { // 覆盖崩溃恢复的四条主路径
  it('running 超过阈值被放回队列，并在同一轮 tick 内重新执行成功', async () => { // 崩溃恢复主路径
    insertJob('job-stale', 'running', '2026-11-07T04:30:00.000Z', 0); // 30 分钟前开始执行，超过默认 15 分钟阈值
    const orchestrator = makeOrchestrator(); // 默认阈值

    const results = await orchestrator.tick(5); // tick 先回收再消费
    expect(results).toHaveLength(1); // 回收后立刻被同一轮消费到
    expect(results[0].status).toBe('succeeded'); // mock 提供方离线产出，任务应成功
    const state = jobState('job-stale'); // 复核落库状态
    expect(state.status).toBe('succeeded'); // 最终状态正确
    expect(state.attempts).toBe(1); // 回收次数已累加，便于限制无限重试
  }); // 用例结束

  it('回收次数达到上限时直接判失败，不再重入队', async () => { // 毒任务保护分支
    insertJob('job-poison', 'running', '2026-11-07T04:30:00.000Z', 2); // 已回收 2 次，达到默认上限
    const orchestrator = makeOrchestrator(); // 默认 maxReclaim = 2

    const result = orchestrator.reclaimStale(); // 直接调用回收，断言判定分支
    expect(result.failed).toEqual(['job-poison']); // 进入失败清单
    expect(result.reclaimed).toEqual([]); // 不再放回队列
    const state = jobState('job-poison'); // 复核落库状态
    expect(state.status).toBe('failed'); // 终态为失败
    expect(state.error_code).toBe('JOB_STALE_TIMEOUT'); // 错误码可被前端识别为「执行超时」
    const next = await orchestrator.tick(5); // 已判失败的任务不会重新进入消费队列
    expect(next).toHaveLength(0); // 本轮没有可消费任务，证明毒任务已被摘出
  }); // 用例结束

  it('刚开始执行的 running 任务不会被误伤', async () => { // 阈值边界：避免把在跑任务抢走导致重复产出
    insertJob('job-active', 'running', '2026-11-07T04:59:00.000Z', 0); // 1 分钟前开始，未到 15 分钟阈值
    const orchestrator = makeOrchestrator(); // 默认阈值

    const result = orchestrator.reclaimStale(); // 执行回收
    expect(result.reclaimed).toEqual([]); // 不应被回收
    expect(result.failed).toEqual([]); // 也不应被判失败
    expect(jobState('job-active').status).toBe('running'); // 状态保持不动
  }); // 用例结束

  it('可显式传入更短阈值做运维补偿，queued 任务照常消费', async () => { // 参数化阈值 + 正常消费不受影响
    insertJob('job-recent', 'running', '2026-11-07T04:59:00.000Z', 0); // 1 分钟前开始
    insertJob('job-queued', 'queued', null, 0); // 正常排队任务
    const orchestrator = makeOrchestrator(); // 默认阈值

    const shortResult = orchestrator.reclaimStale(60_000); // 阈值压到 1 分钟：刚过阈值即视为失联
    expect(shortResult.reclaimed).toEqual(['job-recent']); // 显式阈值生效
    expect(jobState('job-queued').attempts).toBe(0); // 排队任务不会被回收逻辑碰

    const results = await orchestrator.tick(5); // 回收后两个任务都应被消费
    expect(results).toHaveLength(2); // 两个任务各执行一次
    expect(jobState('job-queued').status).toBe('succeeded'); // 正常任务不受回收逻辑影响
  }); // 用例结束

  it('能力自检透出回收配置，运维可直接核对阈值', () => { // 可观测性
    const orchestrator = makeOrchestrator({ MIM_AI_JOB_STALE_MS: '600000', MIM_AI_JOB_MAX_RECLAIM: '1' }); // 显式配置
    const caps = orchestrator.capabilities(); // 读取能力清单
    expect(caps.stale_reclaim_ms).toBe(600000); // 阈值按配置透出
    expect(caps.max_reclaim).toBe(1); // 上限按配置透出
  }); // 用例结束
}); // describe 结束

// 用例执行完毕后清理临时落盘目录：避免在本机累积测试垃圾
afterEach(() => { // vitest 提供的每例后置钩子
  rmSync(storageDir, { recursive: true, force: true }); // 递归删除本次用例临时目录
}); // afterEach 结束
