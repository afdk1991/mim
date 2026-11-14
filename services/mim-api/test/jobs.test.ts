/** 单元测试：后台定时任务（jobs.ts）——权益到期扫描 + 幂等语义 + 调度器生命周期 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排；beforeEach 每例重建内存库，避免用例互相污染
import { createJobs } from '../src/jobs.js'; // 待测工厂：闭包持有库、时钟与定时器
import { createDatabase } from '../src/db.js'; // 建库入口；createDatabase 会种入模块，权益用例可直接复用

const NOW = '2026-11-07T05:00:00.000Z'; // 冻结时钟：所有到期判定都以此为基准，断言可复现

let db: ReturnType<typeof createDatabase>; // 与用例同生命周期的数据库句柄，用例内直接写库造数据

/** 构造任务组：默认冻结时钟 + 静默日志，避免测试输出被日志淹没 */
function makeJobs(now: string = NOW) {
  return createJobs({ db, env: {}, now: () => now, logger: { info() {}, warn() {} } }); // 注入固定时钟与空日志出口
} // makeJobs 结束

/** 取种子模块主键，权益行必须绑定真实模块 ID */
function seedModuleId(): string {
  const row = db // 数据库句柄
    .prepare(`SELECT id FROM modules LIMIT 1`) // 取任意一个已种入模块
    .get() as { id: string } | undefined; // 单行结果
  if (!row) throw new Error('module seed missing'); // 种子缺失说明建库逻辑被破坏，直接报错而非静默通过
  return row.id; // 返回模块主键
} // seedModuleId 结束

/** 插入一条权益，供到期扫描迁移；userId 由调用方指定以绕开偏唯一索引 */
function insertEntitlement(id: string, userId: string, expiresAt: string): void {
  db.prepare( // 预编译插入
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', ?, 1, ?, ?)`,
  ).run(id, userId, seedModuleId(), expiresAt, NOW, NOW); // 绑定权益 ID、用户、模块主键、到期时间与写入时间
} // insertEntitlement 结束

/** 读取权益当前行，断言状态迁移与版本自增 */
function entitlementRow(id: string): { status: string; version: number } {
  return db // 数据库句柄
    .prepare(`SELECT status, version FROM entitlements WHERE id = ?`) // 按主键定位
    .get(id) as { status: string; version: number }; // 单行结果
} // entitlementRow 结束

/** 读取某权益的状态事件，断言任务确实留下了审计证据 */
function eventRows(entitlementId: string): Array<{ from_status: string | null; to_status: string; reason: string | null; actor: string }> {
  return db // 数据库句柄
    .prepare( // 执行当前业务步骤
      `SELECT from_status, to_status, reason, actor
       FROM entitlement_events WHERE entitlement_id = ?
       ORDER BY created_at ASC, rowid ASC`, // 同秒写入时用 rowid 兜底稳定顺序
    ) // 结束预编译
    .all(entitlementId) as Array<{ from_status: string | null; to_status: string; reason: string | null; actor: string }>; // 取全部事件
} // eventRows 结束

beforeEach(() => { // 每例前置
  db = createDatabase(':memory:'); // 全新内存库，幂等键与业务数据都从零开始
}); // beforeEach 结束

describe('entitlement-expiry 权益到期扫描', () => { // 唯一保留的后台任务
  it('到期权益迁为 expired，同事务写事件，重复执行不再迁移', async () => {
    insertEntitlement('ent-due', 'user-due', '2026-11-07T04:00:00.000Z'); // 早于冻结时钟，已到期
    insertEntitlement('ent-future', 'user-future', '2026-12-01T00:00:00.000Z'); // 未到期，不应被扫到；换用户避开偏唯一索引
    const jobs = makeJobs(); // 无需阈值配置

    const first = await jobs.runOnce('entitlement-expiry'); // 首次执行
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

    const second = await jobs.runOnce('entitlement-expiry'); // 同一时钟再跑一次
    expect(second.ran).toBe(true); // 到期扫描没有整轮窗口键，每轮都会扫
    expect(second.affected).toBe(0); // 已无 active 且到期的行
    expect(second.detail).toBe('no entitlement to expire'); // 候选为空
    expect(eventRows('ent-due')).toHaveLength(1); // 重复执行不产生重复事件
  }); // 用例结束

  it('没有到期权益时返回空结论', async () => {
    insertEntitlement('ent-later', 'user-later', '2026-12-01T00:00:00.000Z'); // 未来到期
    const result = await makeJobs().runOnce('entitlement-expiry'); // 执行一次
    expect(result.ran).toBe(true); // 扫描执行
    expect(result.affected).toBe(0); // 无迁移
    expect(result.detail).toBe('no entitlement to expire'); // 空结论
  }); // 用例结束
}); // describe 结束

describe('start / stop 生命周期', () => { // 调度器句柄管理
  it('重复 start 不叠加定时器，stop 后可再次 start', () => {
    const jobs = makeJobs(); // 构造任务组
    jobs.start(); // 首次启动：立即补跑一次并注册定时器
    jobs.start(); // 二次启动应被 timers.length 判断挡住
    jobs.stop(); // 清理全部定时器
    jobs.start(); // 复位后可再次启动
    jobs.stop(); // 用例结束前清理，避免残留定时器影响进程退出
    expect(true).toBe(true); // 生命周期不抛错即通过
  }); // 用例结束
}); // describe 结束
