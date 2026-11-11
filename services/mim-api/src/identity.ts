/**
 * 账号建号与 Mim ID 号码发放。
 *
 * 设计要点：
 *   1. 内部主键仍是 uuidv7（时间有序、不可枚举），对外标识改用 member_no（MIM-10000001）；
 *   2. 号码由 member_no_sequence 单行表在事务内「读 + 自增」，多入口并发注册不会重号；
 *   3. 所有建号入口（自助注册 / 验证码首登 / 密码首登 / 第三方 OAuth 首登）只走 createUser，
 *      避免各路由各写一遍 INSERT 导致某些入口漏发号码。
 */

import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import { MEMBER_NO_MAX, MEMBER_NO_PREFIX, MEMBER_NO_START } from './config.js'; // 号码前缀与号段边界集中配置
import type { Db, Region, UserRow } from './types.js'; // 数据库连接与用户行类型

/** 号码序号 → 对外字符串：八位补零，形如 MIM-10000001 */
export function formatMemberNo(seq: number): string { // 纯函数，便于前端与测试复用同一格式
  return `${MEMBER_NO_PREFIX}-${String(seq).padStart(8, '0')}`; // padStart 保证号码位数稳定，便于肉眼核对
} // formatMemberNo 结束

/**
 * 原子分配一个 Mim ID 号码。
 * better-sqlite3 是同步驱动，事务内的 SELECT + UPDATE 不会被同进程其它请求打断；
 * 多进程部署时 SQLite 的写锁同样保证串行，因此不需要额外的分布式发号器。
 */
export function allocateMemberNo(db: Db): string { // 所有建号入口共用
  const seq = db.transaction(() => { // 事务包裹读改写三步，保证不重号
    const row = db.prepare('SELECT next_no FROM member_no_sequence WHERE id = 1').get() as // 读取当前待分配序号
      | { next_no: number } // 正常发号器行
      | undefined; // 表缺失（异常情况）走兜底起点
    const next = row?.next_no ?? MEMBER_NO_START; // 缺行时从起始号开始，保证首次注册仍能发号
    if (!Number.isInteger(next) || next < MEMBER_NO_START || next > MEMBER_NO_MAX) { // 号段边界校验
      throw new AppError('MEMBER_NO_EXHAUSTED', 'member number range exhausted', { // 号码用尽属容量问题
        next, // 回传当前游标便于运维判断是否需要扩号段
        max: MEMBER_NO_MAX, // 回传上限
      }); // 结束错误构造
    } // 边界校验结束
    db.prepare('UPDATE member_no_sequence SET next_no = ? WHERE id = 1').run(next + 1); // 先把游标推进再返回，失败即整体回滚
    return next; // 交出本次可用序号
  })(); // 立即执行事务
  return formatMemberNo(seq); // 序列号转对外号码
} // allocateMemberNo 结束

/**
 * 存量库回填：为 member_no 为 NULL 的历史用户按注册时间顺序补号。
 * 只在启动期执行一次，已补过号的用户不会被再次处理。
 * @returns 本次补号数量，0 表示无需变更
 */
export function backfillMemberNos(db: Db): number { // 幂等：可重复调用
  const rows = db.prepare('SELECT id FROM users WHERE member_no IS NULL ORDER BY created_at ASC, id ASC').all() as Array<{ id: string }>; // 只取缺号用户，按注册顺序保证号码与资历一致
  if (rows.length === 0) return 0; // 无缺号用户直接返回，避免开事务
  let count = 0; // 统计实际补号数量
  db.transaction(() => { // 整体事务：号码与用户行要么全成、要么全不成
    for (const row of rows) { // 逐行补号
      const memberNo = allocateMemberNo(db); // 复用同一发号器，保证与新增用户共享号段
      db.prepare('UPDATE users SET member_no = ?, updated_at = ? WHERE id = ?').run(memberNo, new Date().toISOString(), row.id); // 写回号码
      count += 1; // 计数
    } // 循环结束
  })(); // 执行事务
  return count; // 返回补号数量
} // backfillMemberNos 结束

/** 建号入参：地区必填，其余按地区给默认值 */
export interface CreateUserInput { // 只声明真正需要外部决定的字段
  region: Region; // cn / global，决定默认语言与时区
  display_name?: string; // 展示名，可空
  locale?: string; // 语言偏好，缺省按地区推断
  timezone?: string; // 时区偏好，缺省按地区推断
  is_guest?: boolean; // 是否匿名访客账号（免登录体验自动建号），缺省为 false
  now: string; // 创建时间，由调用方统一取时保证与其它写入一致
} // CreateUserInput 结束

/** 按地区给默认语言：中国区中文，海外区英文 */
export function defaultLocaleOf(region: Region): string { // 多处复用，避免各自写死
  return region === 'cn' ? 'zh-CN' : 'en-US'; // 与既有注册逻辑保持一致
} // defaultLocaleOf 结束

/** 按地区给默认时区 */
export function defaultTimezoneOf(region: Region): string { // 与默认语言成对出现
  return region === 'cn' ? 'Asia/Shanghai' : 'UTC'; // 海外区用 UTC，避免臆测具体国家
} // defaultTimezoneOf 结束

/** 读取用户行（含 member_no），供建号后回读与登录流程复用 */
export function readUser(db: Db, id: string): UserRow | undefined { // 统一字段列表，避免各路由 SELECT 漏列
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined; // 单行读取
} // readUser 结束

/**
 * 创建新用户并自动分配 Mim ID 号码。
 * 只负责 users 表；身份（identities）与凭据（credentials）由调用方在同一事务内追加。
 */
export function createUser(db: Db, input: CreateUserInput): UserRow { // 唯一建号入口
  const id = uuidv7(); // 内部主键：时间有序，便于按注册顺序排查
  const memberNo = allocateMemberNo(db); // 先发号，再写行；写行失败时号码随事务回滚
  db.prepare( // 预编译插入语句
    `INSERT INTO users (id, member_no, region, status, display_name, locale, timezone, is_guest, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
  ).run( // 绑定参数
    id, // 内部主键
    memberNo, // 对外号码
    input.region, // 地区
    (input.display_name ?? '').trim().slice(0, 64), // 展示名限幅，空串表示待完善
    input.locale ?? defaultLocaleOf(input.region), // 默认语言
    input.timezone ?? defaultTimezoneOf(input.region), // 默认时区
    input.is_guest ? 1 : 0, // 匿名访客标记：登录升级后可清零，清库策略按此列筛选
    input.now, // 创建时间
    input.now, // 更新时间
  ); // 结束执行
  const row = readUser(db, id); // 回读落库结果，确保返回真实数据
  if (!row) throw new AppError('INTERNAL_ERROR', 'failed to create user'); // 写入后读不到属数据层异常
  return row; // 返回含号码的完整用户行
} // createUser 结束

/**
 * 历史用户缺号兜底：登录时若发现 member_no 为空，立即补一个。
 * 覆盖「回填任务尚未运行 / 用户是在回填后才从备份恢复」等边角情况。
 */
export function ensureMemberNo(db: Db, row: UserRow, now: string): UserRow { // 不改其它字段
  if (row.member_no) return row; // 已有号码直接返回
  const memberNo = allocateMemberNo(db); // 补发一个号码
  db.prepare('UPDATE users SET member_no = ?, updated_at = ? WHERE id = ?').run(memberNo, now, row.id); // 写回，时间由调用方注入保证可测
  return { ...row, member_no: memberNo }; // 返回更新后的内存视图
} // ensureMemberNo 结束
