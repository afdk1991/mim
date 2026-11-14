/**
 * 后台定时任务（08-dev-implementation §8「定时任务」）
 *
 * 保留任务：
 *   entitlement-expiry — 每日，把 `expires_at <= now` 的 active 权益转 expired，并写 entitlement_events
 *
 * 幂等策略：复用 ops 域的 idempotency_keys（user_id 固定 'system'），
 * 以 `INSERT ... ON CONFLICT DO NOTHING` 抢占键，抢占成功者才执行；
 * response_status 为 NULL 表示「已认领未结算」，结算后回写结果作为审计证据。
 * 不用内存标记，保证多副本 / 重启后同一窗口不会重复执行。
 */

import { uuidv7 } from '@mim/core-domain'; // 事件主键需时间有序，复用领域层 UUIDv7 生成器
import type { Db } from './types.js'; // 数据库抽象类型，便于测试注入内存库

export type JobKind = 'entitlement-expiry'; // 任务的可辨识联合，供手动触发与测试断言

export interface JobRunResult { // 单次执行结果，便于日志与测试直接断言
  kind: JobKind; // 任务标识
  ran: boolean; // false 表示幂等键已被占用（同一窗口已执行过），本轮跳过
  affected: number; // 受影响行数，语义按任务而定
  detail: string; // 可直接读的结论描述，写入日志与响应体
} // JobRunResult 结束

export interface CreateJobsOptions { // 创建定时任务组的依赖注入参数
  db: Db; // 同步 SQLite 句柄，任务内直接 prepare/run
  env: Record<string, string | undefined>; // 环境变量，保留给后续任务扩展
  now?: () => string; // 可注入时钟，测试可冻结时间
  /** 日志出口；默认 console，测试可注入捕获器 */
  logger?: { info(message: string): void; warn(message: string): void }; // 只要求两个级别，避免耦合具体日志库
  /** 各任务的执行间隔（毫秒）；defaults 见 DEFAULT_INTERVALS */
  intervals?: Partial<Record<JobKind, number>>; // 测试可传极小间隔验证调度
} // CreateJobsOptions 结束

export interface Jobs { // 对外暴露的任务组契约
  runOnce(kind: JobKind): Promise<JobRunResult>; // 手动执行一次
  start(): void; // 启动全部定时器（幂等）
  stop(): void; // 停止全部定时器（幂等）
} // Jobs 结束

/** 默认间隔：权益到期每日一次（对齐 08 §8） */
const DEFAULT_INTERVALS: Record<JobKind, number> = { // 任务基准节拍
  'entitlement-expiry': 24 * 3600_000, // 每日一次，到期以天为粒度足够
}; // DEFAULT_INTERVALS 结束

/** 定时任务在 idempotency_keys 中的伪用户，与真实用户 ID 空间天然隔离 */
const SYSTEM_USER = 'system'; // 固定值，便于运维按 user_id 直接筛出所有任务记录

export function createJobs(options: CreateJobsOptions): Jobs { // 工厂：闭包持有 db、时钟与定时器句柄
  const { db } = options; // 解构稳定依赖
  const clock = options.now ?? (() => new Date().toISOString()); // 未注入时钟时取系统时间，口径与路由层一致
  const logger = options.logger ?? { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m) }; // 默认 console，测试可替换

  let timers: Array<ReturnType<typeof setInterval>> = []; // 全部定时器句柄，start/stop 幂等的依据

  function claim(key: string, path: string): boolean { // 抢占执行权：同一键只有第一个调用者拿到 true
    const info = db // 数据库句柄
      .prepare( // 预编译：冲突即忽略，天然原子
        `INSERT INTO idempotency_keys
           (key, user_id, method, path, request_hash, response_status, response_body, created_at)
         VALUES (?, ?, 'JOB', ?, '', NULL, NULL, ?)
         ON CONFLICT(key, user_id) DO NOTHING`,
      ) // 结束预编译
      .run(key, SYSTEM_USER, path, clock()); // 绑定键、伪用户、路径与当前时间
    return info.changes === 1; // changes 为 1 说明插入成功，即本次抢到执行权
  } // claim 结束

  function settle(key: string, status: number, body: unknown): void { // 回写执行结果，作为审计证据
    db.prepare( // 预编译更新语句
      `UPDATE idempotency_keys SET response_status = ?, response_body = ?
       WHERE key = ? AND user_id = ?`,
    ) // 结束预编译
      .run(status, JSON.stringify(body), key, SYSTEM_USER); // 记录状态码与 JSON 详情
  } // settle 结束

  async function runEntitlementExpiry(): Promise<JobRunResult> { // 任务：解锁到期扫描
    const now = clock(); // 当前时间，作为到期判定基准
    const rows = db // 数据库句柄
      .prepare( // 预编译：取已到期但仍标记为 active 的权益
        `SELECT id, user_id, module_id, expires_at
         FROM entitlements
         WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
      ) // 结束预编译
      .all(now) as Array<{ id: string; user_id: string; module_id: string; expires_at: string }>; // 待处理清单

    let affected = 0; // 累计真正完成状态迁移的权益数
    for (const row of rows) { // 逐条处理，单条失败不影响其余
      const key = `job:entitlement-expiry:${row.id}:${row.expires_at}`; // 幂等键含权益与到期时刻，同一期只结算一次
      if (!claim(key, '/jobs/entitlement-expiry')) continue; // 已处理过则跳过，重复执行不会产生重复事件

      const tx = db.transaction(() => { // 状态迁移与事件追加必须同事务，避免「迁了没事件」或「有事件没迁」
        const info = db // 数据库句柄
          .prepare( // 预编译：带上 active 与到期条件，防止并发下重复迁移
            `UPDATE entitlements
             SET status = 'expired', version = version + 1, updated_at = ?
             WHERE id = ? AND status = 'active' AND expires_at <= ?`,
          ) // 结束预编译
          .run(now, row.id, now); // 绑定时间、权益 ID 与到期基准
        if (info.changes === 1) { // 只有真正迁移成功才写事件
          db.prepare( // 预编译事件插入
            `INSERT INTO entitlement_events
               (id, entitlement_id, from_status, to_status, reason, actor, created_at)
             VALUES (?, ?, 'active', 'expired', 'expires_at reached', 'job', ?)`,
          ) // 结束预编译
            .run(uuidv7(), row.id, now); // 事件主键用 UUIDv7，时间有序便于按写入顺序排查
        } // 迁移成功分支结束
        return info.changes; // 返回本次变更行数
      }); // 事务构造结束

      const changes = tx(); // 执行事务
      affected += changes; // 累加真实迁移数
      settle(key, 200, { entitlement_id: row.id, user_id: row.user_id, module_id: row.module_id, expires_at: row.expires_at, changes }); // 回写单条结算结果
    } // 处理循环结束

    if (affected > 0) { // 有实际迁移时输出一条汇总日志
      logger.info(`[jobs] entitlement-expiry: ${affected} entitlement(s) moved to expired`); // 汇总便于运维核对
    } // 日志分支结束

    return { // 返回结构化结果
      kind: 'entitlement-expiry', // 任务标识
      ran: true, // 扫描每轮都会执行（是否真正迁移由 affected 体现）
      affected, // 迁移成功的权益数
      detail: rows.length ? `${affected}/${rows.length} expired` : 'no entitlement to expire', // 结论描述
    }; // 结果结束
  } // runEntitlementExpiry 结束

  const runners: Record<JobKind, () => Promise<JobRunResult>> = { // 任务标识到实现的映射，便于 start/runOnce 统一调度
    'entitlement-expiry': runEntitlementExpiry, // 到期扫描
  }; // runners 结束

  async function runOnce(kind: JobKind): Promise<JobRunResult> { // 手动执行单个任务
    return runners[kind](); // 直接委托到对应实现
  } // runOnce 结束

  async function safeRun(kind: JobKind): Promise<void> { // 调度器专用包装：任何异常都只记录，不打断定时器
    try { // 任务体可能因数据库锁或脏数据抛错
      const result = await runners[kind](); // 执行任务并等待完成
      logger.info(`[jobs] ${kind} ran=${result.ran} affected=${result.affected} — ${result.detail}`); // 记录执行结论
    } catch (err) { // 捕获异常
      logger.warn(`[jobs] ${kind} failed: ${err instanceof Error ? err.message : String(err)}`); // 只告警，下个周期自然重试
    } // try/catch 结束
  } // safeRun 结束

  return { // 返回任务组实现
    runOnce, // 手动执行入口
    start() { // 启动全部定时器
      if (timers.length > 0) return; // 已启动则不重复创建，避免多份定时器叠加
      for (const kind of Object.keys(runners) as JobKind[]) { // 遍历全部任务
        const interval = options.intervals?.[kind] ?? DEFAULT_INTERVALS[kind]; // 优先取调用方间隔，其次默认节拍
        void safeRun(kind); // 启动即补跑一次，覆盖进程重启错过的窗口（幂等键保证不会重复生效）；不阻塞启动流程
        const timer = setInterval(() => void safeRun(kind), interval); // 按间隔重复执行；Promise 由 safeRun 内部自行收敛
        if (typeof timer.unref === 'function') timer.unref(); // 不阻止进程退出，兼容测试与优雅停机
        timers.push(timer); // 记录句柄供 stop 清理
      } // 任务循环结束
    }, // start 结束
    stop() { // 停止全部定时器
      for (const timer of timers) clearInterval(timer); // 逐个清理
      timers = []; // 复位句柄，使 start 可再次生效
    }, // stop 结束
  }; // 任务组返回结束
} // createJobs 结束
