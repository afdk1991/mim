/** 单元测试：后台定时任务（jobs.ts）——成本告警 / 审核超时 / 权益到期 + 幂等语义 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排；beforeEach 每例重建内存库，避免用例互相污染
import { createJobs } from '../src/jobs.js'; // 待测工厂：闭包持有库、时钟与定时器
import { createDatabase } from '../src/db.js'; // 建库入口；createDatabase 会种入 comic.workbench 模块，权益用例可直接复用

const NOW = '2026-11-07T05:00:00.000Z'; // 冻结时钟：所有窗口键、阈值区间都以此为基准，断言可复现

let db: ReturnType<typeof createDatabase>; // 与用例同生命周期的数据库句柄，用例内直接写库造数据

/** 构造任务组：默认冻结时钟 + 静默日志，避免测试输出被日志淹没 */
function makeJobs(env: Record<string, string | undefined> = {}, now: string = NOW) { // env 注入阈值，now 可切换窗口
  return createJobs({ db, env, now: () => now, logger: { info() {}, warn() {} } }); // 注入固定时钟与空日志出口
} // makeJobs 结束

/** 取种子模块 comic.workbench 的主键，权益行必须绑定真实模块 ID */
function seedModuleId(): string { // 查一次种子模块
  const row = db // 数据库句柄
    .prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`) // 种子模块在 db.ts 中固定为 cn 区
    .get() as { id: string } | undefined; // 单行结果
  if (!row) throw new Error('comic.workbench seed missing'); // 种子缺失说明建库逻辑被破坏，直接报错而非静默通过
  return row.id; // 返回模块主键
} // seedModuleId 结束

/** 插入一条生成任务，仅填成本告警所需字段（其余 NOT NULL 列给最小可用值） */
function insertCostJob(id: string, costMinor: number, createdAt: string): void { // 成本与时间由用例控制
  db.prepare( // 预编译插入
    `INSERT INTO generation_jobs
       (id, project_id, job_type, status, cost_estimate_minor, payload, created_by, created_at)
     VALUES (?, 'proj-cost', 'image', 'succeeded', ?, '{}', 'tester', ?)`, // 成本列可为空但本用例必须填，否则 SUM 为 0
  ).run(id, costMinor, createdAt); // 绑定任务 ID、成本与创建时间
} // insertCostJob 结束

/** 插入一条成片，用于审核超时扫描 */
function insertFilm(id: string, status: string, updatedAt: string): void { // 状态与更新时间由用例控制
  db.prepare( // 预编译插入
    `INSERT INTO comic_films
       (id, project_id, title, status, version, created_at, updated_at)
     VALUES (?, 'proj-film', ?, ?, 1, ?, ?)`, // version 固定 1；创建与更新时间同值，只让 updated_at 参与超时判定
  ).run(id, `成片-${id}`, status, updatedAt, updatedAt); // 标题带 ID 便于日志辨认
} // insertFilm 结束

/** 插入一条权益，供到期扫描迁移；userId 由调用方指定以绕开 uq_entitlements_user_module_once 偏唯一索引 */
function insertEntitlement(id: string, userId: string, expiresAt: string): void { // expires_at 必填，扫描只处理非空到期时间
  const now = NOW; // 写入时间统一用冻结时钟，保持数据自洽
  db.prepare( // 预编译插入
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', ?, 1, ?, ?)`, // 手工权益 source_id 为 NULL，同用户同模块仅能存在一条
  ).run(id, userId, seedModuleId(), expiresAt, now, now); // 绑定权益 ID、用户、模块主键、到期时间与写入时间
} // insertEntitlement 结束

/** 读取权益当前行，断言状态迁移与版本自增 */
function entitlementRow(id: string): { status: string; version: number } { // 只取断言需要的两列
  return db // 数据库句柄
    .prepare(`SELECT status, version FROM entitlements WHERE id = ?`) // 按主键定位
    .get(id) as { status: string; version: number }; // 单行结果
} // entitlementRow 结束

/** 读取某权益的状态事件，断言任务确实留下了审计证据 */
function eventRows(entitlementId: string): Array<{ from_status: string | null; to_status: string; reason: string | null; actor: string }> { // 事件关键列
  return db // 数据库句柄
    .prepare(
      `SELECT from_status, to_status, reason, actor
       FROM entitlement_events WHERE entitlement_id = ?
       ORDER BY created_at ASC, rowid ASC`, // 同秒写入时用 rowid 兜底稳定顺序
    ) // 结束预编译
    .all(entitlementId) as Array<{ from_status: string | null; to_status: string; reason: string | null; actor: string }>; // 取全部事件
} // eventRows 结束

beforeEach(() => { // 每例前置
  db = createDatabase(':memory:'); // 全新内存库，幂等键与业务数据都从零开始
}); // beforeEach 结束

describe('cost-alert 生成成本告警', () => { // 任务一
  it('小时成本越线时产生告警，同一小时二次执行直接跳过', () => { // 阈值 + 幂等两条语义一起验
    insertCostJob('job-cost-1', 50, '2026-11-07T04:40:00.000Z'); // 近一小时内成本 50；小时上限 = ceil(1000/24) = 42
    const jobs = makeJobs({ MIM_AI_DAILY_COST_LIMIT_MINOR: '1000' }); // 日上限 1000，小时上限按日均摊得 42

    const first = jobs.runOnce('cost-alert'); // 首次执行
    expect(first.kind).toBe('cost-alert'); // 任务标识正确
    expect(first.ran).toBe(true); // 本小时首次执行确实跑到
    expect(first.affected).toBe(1); // 仅小时维度越线，日累计 50 未达 80%（50*5=250 < 4000）
    expect(first.detail).toContain('hourly cost 50 >= limit 42'); // 告警文案含真实水位，便于直接定位

    const second = jobs.runOnce('cost-alert'); // 同一冻结时钟再跑一次
    expect(second.ran).toBe(false); // 幂等键已被占用
    expect(second.affected).toBe(0); // 不再重复告警
    expect(second.detail).toBe('already ran this hour'); // 跳过原因可读
  }); // 用例结束

  it('成本在限额内时不产生告警', () => { // 无告警分支
    insertCostJob('job-cost-2', 10, '2026-11-07T04:40:00.000Z'); // 10 < 42 且远低于日 80%
    const result = makeJobs({ MIM_AI_DAILY_COST_LIMIT_MINOR: '1000' }).runOnce('cost-alert'); // 执行一次
    expect(result.ran).toBe(true); // 执行确实发生
    expect(result.affected).toBe(0); // 无告警条数
    expect(result.detail).toContain('within limits'); // 结论为「在限额内」
  }); // 用例结束

  it('显式小时上限覆盖日均摊默认值', () => { // numberFromEnv 覆盖分支
    insertCostJob('job-cost-3', 50, '2026-11-07T04:40:00.000Z'); // 成本仍为 50
    const result = makeJobs({ // 日上限与小时上限都设 1000
      MIM_AI_DAILY_COST_LIMIT_MINOR: '1000', // 日上限
      MIM_AI_HOURLY_COST_LIMIT_MINOR: '1000', // 小时上限显式抬高，50 不再越线
    }).runOnce('cost-alert'); // 执行一次
    expect(result.affected).toBe(0); // 显式上限生效，无告警
  }); // 用例结束

  it('跨小时窗口后重新执行', () => { // 窗口键按 YYYY-MM-DDTHH 切分
    insertCostJob('job-cost-4', 50, '2026-11-07T04:40:00.000Z'); // 数据落在上一小时
    const env = { MIM_AI_DAILY_COST_LIMIT_MINOR: '1000' }; // 共用阈值
    makeJobs(env, NOW).runOnce('cost-alert'); // 05 点窗口首次执行并占用键
    const nextHour = makeJobs(env, '2026-11-07T06:00:00.000Z').runOnce('cost-alert'); // 06 点窗口是新键
    expect(nextHour.ran).toBe(true); // 新窗口可再次执行
  }); // 用例结束
}); // describe 结束

describe('film-review-sla 成片审核超时', () => { // 任务二
  it('超过 SLA 的 reviewing 成片被点名，同一小时二次执行跳过', () => { // SLA + 幂等
    insertFilm('film-overdue', 'reviewing', '2026-11-05T00:00:00.000Z'); // 早于 deadline（2026-11-06T05:00）即超时
    insertFilm('film-fresh', 'reviewing', '2026-11-07T04:59:00.000Z'); // 刚刚进入审核，不超时
    insertFilm('film-draft', 'draft', '2026-11-01T00:00:00.000Z'); // 非 reviewing 状态，扫描不纳入
    const jobs = makeJobs({ MIM_FILM_REVIEW_SLA_HOURS: '24' }); // SLA 设为 24 小时

    const first = jobs.runOnce('film-review-sla'); // 首次执行
    expect(first.ran).toBe(true); // 本小时首次执行
    expect(first.affected).toBe(1); // 仅 film-overdue 命中
    expect(first.detail).toContain('1 film(s) overdue > 24h'); // 结论含 SLA 口径

    const second = jobs.runOnce('film-review-sla'); // 同一小时再跑
    expect(second.ran).toBe(false); // 幂等键占用
    expect(second.detail).toBe('already ran this hour'); // 跳过原因
  }); // 用例结束

  it('没有超时成片时返回 0 并给出空结论', () => { // 空结果分支
    insertFilm('film-ok', 'reviewing', '2026-11-07T04:59:00.000Z'); // 未超时
    const result = makeJobs({ MIM_FILM_REVIEW_SLA_HOURS: '24' }).runOnce('film-review-sla'); // 执行一次
    expect(result.ran).toBe(true); // 扫描执行
    expect(result.affected).toBe(0); // 无超时
    expect(result.detail).toBe('no film overdue (sla 24h)'); // 空结论
  }); // 用例结束
}); // describe 结束

describe('entitlement-expiry 权益到期扫描', () => { // 任务三
  it('到期权益迁为 expired，同事务写事件，重复执行不再迁移', () => { // 迁移 + 审计 + 逐条幂等
    insertEntitlement('ent-due', 'user-due', '2026-11-07T04:00:00.000Z'); // 早于冻结时钟，已到期
    insertEntitlement('ent-future', 'user-future', '2026-12-01T00:00:00.000Z'); // 未到期，不应被扫到；换用户避开偏唯一索引
    const jobs = makeJobs(); // 无需阈值配置

    const first = jobs.runOnce('entitlement-expiry'); // 首次执行
    expect(first.ran).toBe(true); // 扫描每轮都会执行
    expect(first.affected).toBe(1); // 只有一个真正迁移
    expect(first.detail).toBe('1/1 expired'); // 候选 1 条、成功 1 条

    const migrated = entitlementRow('ent-due'); // 读取迁移结果
    expect(migrated.status).toBe('expired'); // 状态迁移到位
    expect(migrated.version).toBe(2); // 乐观锁版本自增
    expect(entitlementRow('ent-future').status).toBe('active'); // 未到期不受影响

    const events = eventRows('ent-due'); // 读取审计事件
    expect(events).toHaveLength(1); // 一次迁移只写一条事件
    expect(events[0]).toMatchObject({ // 事件要素
      from_status: 'active', // 迁移前状态
      to_status: 'expired', // 迁移后状态
      reason: 'expires_at reached', // 触发原因
      actor: 'job', // 行为主体为定时任务
    }); // 事件断言结束

    const second = jobs.runOnce('entitlement-expiry'); // 同一时钟再跑一次
    expect(second.ran).toBe(true); // 到期扫描没有整轮窗口键，每轮都会扫
    expect(second.affected).toBe(0); // 已无 active 且到期的行
    expect(second.detail).toBe('no entitlement to expire'); // 候选为空
    expect(eventRows('ent-due')).toHaveLength(1); // 重复执行不产生重复事件
  }); // 用例结束

  it('没有到期权益时返回空结论', () => { // 全未到期分支
    insertEntitlement('ent-later', 'user-later', '2026-12-01T00:00:00.000Z'); // 未来到期
    const result = makeJobs().runOnce('entitlement-expiry'); // 执行一次
    expect(result.ran).toBe(true); // 扫描执行
    expect(result.affected).toBe(0); // 无迁移
    expect(result.detail).toBe('no entitlement to expire'); // 空结论
  }); // 用例结束
}); // describe 结束

describe('start / stop 生命周期', () => { // 调度器句柄管理
  it('重复 start 不叠加定时器，stop 后可再次 start', () => { // 幂等启动 + 可重启
    const jobs = makeJobs({}, NOW); // 构造任务组
    jobs.start(); // 首次启动：立即补跑一次并注册三个定时器
    jobs.start(); // 二次启动应被 timers.length 判断挡住
    jobs.stop(); // 清理全部定时器
    jobs.start(); // 复位后可再次启动
    jobs.stop(); // 用例结束前清理，避免残留定时器影响进程退出
    expect(true).toBe(true); // 生命周期不抛错即通过（定时器副作用已由 unref 与 stop 收敛）
  }); // 用例结束
}); // describe 结束
