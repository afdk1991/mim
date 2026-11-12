/** Mim ID 纯数字号与靓号预留规则的单元测试（2026-11-12「QQ 号样式」改造） */

import { describe, expect, it } from 'vitest'; // 测试框架：断言与用例组织
import { createDatabase } from '../src/db.js'; // 内存库：建表、种子与一次性重排都会真实执行
import { allocateMemberNo, renumberMemberNos } from '../src/identity.js'; // 发号器与存量重排
import { classifyPremiumNo, isPremiumMemberNo } from '../src/member-no.js'; // 靓号判定规则

/** 直接写一条最小用户行，便于控制注册时间与旧号，绕开注册接口 */
function insertUser(db: ReturnType<typeof createDatabase>, id: string, memberNo: string | null, createdAt: string): void {
  db.prepare( // 只写重排关心的字段，其余取默认值
    `INSERT INTO users (id, member_no, region, status, display_name, locale, timezone, created_at, updated_at)
     VALUES (?, ?, 'cn', 'active', '', 'zh-CN', 'Asia/Shanghai', ?, ?)`,
  ).run(id, memberNo, createdAt, createdAt); // 绑定参数
} // insertUser 结束

/** 把一次性重排开关复位为未完成，模拟「刚上线的存量库」 */
function resetRenumberFlag(db: ReturnType<typeof createDatabase>): void {
  db.prepare("UPDATE member_no_meta SET value = 'pending' WHERE key = 'renumber_v1'").run(); // 只改状态，不动已有号码
} // resetRenumberFlag 结束

describe('靓号判定', () => {
  it('个位与十位号按短号段正常发放，不判靓号', () => {
    for (let number = 1; number <= 99; number += 1) expect(classifyPremiumNo(number)).toBeNull(); // 1～99 全部可发
  }); // 结束用例

  it('豹子号（全同数字）', () => {
    expect(classifyPremiumNo(111)).toBe('repeat'); // 三位豹子
    expect(classifyPremiumNo(8888)).toBe('repeat'); // 四位豹子
    expect(classifyPremiumNo(99999)).toBe('repeat'); // 五位豹子
  }); // 结束用例

  it('顺子号（连续递增 / 递减）', () => {
    expect(classifyPremiumNo(123)).toBe('ladder'); // 递增顺子
    expect(classifyPremiumNo(987)).toBe('ladder'); // 递减顺子
    expect(classifyPremiumNo(1234)).toBe('ladder'); // 四位顺子
    expect(classifyPremiumNo(4321)).toBe('ladder'); // 四位倒顺
  }); // 结束用例

  it('回文号', () => {
    expect(classifyPremiumNo(121)).toBe('palindrome'); // 三位回文
    expect(classifyPremiumNo(1221)).toBe('palindrome'); // 四位回文
    expect(classifyPremiumNo(12321)).toBe('palindrome'); // 五位回文
  }); // 结束用例

  it('ABAB 对子号', () => {
    expect(classifyPremiumNo(1212)).toBe('abab'); // 两位一组重复
    expect(classifyPremiumNo(1313)).toBe('abab'); // 另一组对子
  }); // 结束用例

  it('整百 / 整千号', () => {
    expect(classifyPremiumNo(100)).toBe('round'); // 整百
    expect(classifyPremiumNo(2000)).toBe('round'); // 整千
    expect(classifyPremiumNo(100000)).toBe('round'); // 十万整数
  }); // 结束用例

  it('谐音 / 吉利号', () => {
    expect(classifyPremiumNo(520)).toBe('pronounce'); // 我爱你
    expect(classifyPremiumNo(1314)).toBe('pronounce'); // 一生一世
    expect(classifyPremiumNo(1888)).toBe('pronounce'); // 含 888 的发发发
  }); // 结束用例

  it('生日号只认合法日期', () => {
    expect(classifyPremiumNo(19900101)).toBe('birthday'); // 合法生日
    expect(classifyPremiumNo(20000229)).toBe('birthday'); // 闰日合法
    expect(classifyPremiumNo(19900230)).toBeNull(); // 2 月 30 日不存在，按普通号处理
  }); // 结束用例

  it('普通号与布尔入口', () => {
    expect(classifyPremiumNo(102)).toBeNull(); // 无任何花号的普通三位号
    expect(classifyPremiumNo('MIM-10000001')).toBeNull(); // 非纯数字不参与判定（留给重排处理）
    expect(isPremiumMemberNo(123)).toBe(true); // 布尔入口与分类结果一致
    expect(isPremiumMemberNo(102)).toBe(false); // 普通号返回 false
  }); // 结束用例
}); // describe 结束

describe('发号器', () => {
  it('新库从个位数开始连续发号', () => {
    const db = createDatabase(':memory:'); // 全新内存库
    expect(allocateMemberNo(db)).toBe('1'); // 首个号码
    expect(allocateMemberNo(db)).toBe('2'); // 第二个号码
    expect(allocateMemberNo(db)).toBe('3'); // 第三个号码
  }); // 结束用例

  it('游标落在靓号上时自动跳过', () => {
    const db = createDatabase(':memory:'); // 全新内存库
    db.prepare('UPDATE member_no_sequence SET next_no = 100 WHERE id = 1').run(); // 把游标拨到整百号前
    expect(allocateMemberNo(db)).toBe('102'); // 100（整百）与 101（回文）被跳过，102 才是普通号
  }); // 结束用例

  it('已被人工占用的号不会二次发出', () => {
    const db = createDatabase(':memory:'); // 全新内存库
    insertUser(db, 'u-taken', '4', '2026-01-01T00:00:00.000Z'); // 人工占掉 4 号
    db.prepare('UPDATE member_no_sequence SET next_no = 4 WHERE id = 1').run(); // 游标指向已被占用的号
    expect(allocateMemberNo(db)).toBe('5'); // 跳过已占用的 4，发 5
  }); // 结束用例
}); // describe 结束

describe('存量全量重排', () => {
  it('按注册顺序发最短号，旧号写入审计表', () => {
    const db = createDatabase(':memory:'); // 全新内存库（重排此时已标记完成但无用户）
    insertUser(db, 'u-early', 'MIM-10000007', '2026-01-01T00:00:00.000Z'); // 最早注册的用户
    insertUser(db, 'u-middle', 'MIM-10000010', '2026-01-02T00:00:00.000Z'); // 第二个用户
    insertUser(db, 'u-late', 'MIM-10000011', '2026-02-01T00:00:00.000Z'); // 最晚注册的用户
    resetRenumberFlag(db); // 模拟存量库首次升级
    const changes = renumberMemberNos(db, '2026-11-12T00:00:00.000Z'); // 执行重排
    expect(changes.map((item) => item.new_no)).toEqual(['1', '2', '3']); // 老用户优先拿最短号
    expect(changes.map((item) => item.old_no)).toEqual(['MIM-10000007', 'MIM-10000010', 'MIM-10000011']); // 旧号原样留痕
    const rows = db.prepare('SELECT member_no FROM users ORDER BY created_at ASC').all() as Array<{ member_no: string }>; // 读回落库结果
    expect(rows.map((row) => row.member_no)).toEqual(['1', '2', '3']); // 落库与返回值一致
    const history = db.prepare('SELECT count(*) AS total FROM member_no_history').get() as { total: number }; // 审计行数
    expect(history.total).toBe(3); // 每用户一条改号记录
    const cursor = db.prepare('SELECT next_no FROM member_no_sequence WHERE id = 1').get() as { next_no: number }; // 游标
    expect(cursor.next_no).toBe(4); // 游标对齐到重排结束位置
  }); // 结束用例

  it('重排幂等：重复调用不再改号', () => {
    const db = createDatabase(':memory:'); // 全新内存库
    insertUser(db, 'u-1', 'MIM-10000001', '2026-01-01T00:00:00.000Z'); // 一个存量用户
    resetRenumberFlag(db); // 复位开关
    expect(renumberMemberNos(db, '2026-11-12T00:00:00.000Z').length).toBe(1); // 首次重排 1 人
    expect(renumberMemberNos(db, '2026-11-12T00:00:00.000Z')).toEqual([]); // 再次调用直接返回空数组
    expect(db.prepare('SELECT count(*) AS total FROM member_no_history').get()).toEqual({ total: 1 }); // 审计不重复写入
  }); // 结束用例

  it('重排不会占用靓号', () => {
    const db = createDatabase(':memory:'); // 全新内存库
    for (let index = 1; index <= 5; index += 1) {
      insertUser(db, `u-${index}`, `MIM-1000000${index}`, `2026-01-0${index}T00:00:00.000Z`); // 造五个存量用户
    } // 造数循环结束
    resetRenumberFlag(db); // 复位开关
    const changes = renumberMemberNos(db, '2026-11-12T00:00:00.000Z'); // 执行重排
    expect(changes.every((item) => !isPremiumMemberNo(item.new_no))).toBe(true); // 新号一律不是靓号
  }); // 结束用例
}); // describe 结束
