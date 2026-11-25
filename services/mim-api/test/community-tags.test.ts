/**
 * 内容结构批次契约测试（2026-11-25）：
 *   1. 发帖标签：1–3 个、2–12 字、同 slug 去重；超限 / 非法长度 / 非法字符 400 且错误码明确；
 *   2. 列表按 tag 过滤并回带 tags 数组；热门标签按关联帖数倒序；
 *   3. 作者公开卡统计口径（昵称 / Mim ID / 等级 / 徽章数 / 发帖数 / 累计获赞 / 加入时间），匿名可读，不含收藏关注；不存在 404；
 *   4. 归档按月分组、检索聚合板块 / 帖子 / 标签三组，匿名可读。
 *
 * 全部只读端点匿名访问；写操作走注册账号 + 独立幂等键。
 */

import { randomUUID } from 'node:crypto'; // 幂等键：每个写请求独立，避免被幂等中间件当成回放
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // HTTP 断言客户端
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 真实 Express 应用，不 mock 路由
import { createDatabase } from '../src/db.js'; // 内存 SQLite
import type { Db } from '../src/types.js'; // 数据库类型
import { registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录辅助，返回令牌与用户主键

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 与其余社区用例保持同一密钥
let app: Express; // 被测应用
let db: Db; // 被测数据库

beforeEach(() => { // 每个用例独立内存库 + 应用，互不污染
  db = createDatabase(':memory:'); // 空内存库，种子板块 / 官方帖随启动写入
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 应用装配：路由 / 中间件 / 错误映射全量加载
}); // beforeEach 结束

/** 写请求头：附带独立幂等键 + Bearer 令牌。 */
function writeHeaders(token: string): Record<string, string> { // 函数 writeHeaders：组装写请求凭据
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 凭据集合
} // writeHeaders 结束

/** 以指定账号发一篇主题帖，可覆盖标题 / 正文 / 标签等字段。 */
async function postThread(account: { token: string }, extra: Record<string, unknown> = {}) { // 函数 postThread：发帖便捷封装
  return request(app) // 发起发帖请求
    .post('/api/v1/community/threads') // 社区发帖端点
    .set(writeHeaders(account.token)) // 携带写凭据
    .send({ // 基础载荷
      board_slug: 'general', // 种子板块「综合讨论」
      title: '标签验证帖', // 默认标题
      body: '标签验证正文，用于校验标签挂载与检索口径。', // 默认正文
      kind: 'text', // 默认图文类型
      ...extra, // 用例覆盖字段
    }); // 发送结束
} // postThread 结束

describe('社区标签：校验 / 去重 / 挂载', () => { // 标签写入与校验用例组
  it('合法标签去重后挂载；4 个标签、1 字、13 字与非法字符均返回 400', async () => { // 校验矩阵
    const author = await registerTestAccount(app, '13800000061'); // 发帖账号

    // 合法：重复传入同一归一化名只挂一次，上限内正常发布
    const ok = await postThread(author, { tags: ['前端', '前端', 'React'] }); // 两个去重后标签
    expect(ok.status).toBe(201); // 发帖成功
    const threadId = ok.body.thread_id as string; // 取回帖子主键

    // 详情回带标签：去重后应为 2 个
    const detail = await request(app).get(`/api/v1/community/threads/${threadId}`); // 匿名读详情
    expect(detail.status).toBe(200); // 详情公开可读
    const tags = detail.body.thread.tags as Array<{ slug: string; name: string }>; // 标签数组
    expect(tags).toHaveLength(2); // 重复标签只保留一份
    expect(tags.map((t) => t.slug).sort()).toEqual(['react', '前端']); // slug 归一化：英文小写、中文原样

    // 超限：4 个标签 → 400 TOO_MANY_TAGS
    const tooMany = await postThread(author, { tags: ['a1', 'b2', 'c3', 'd4'] }); // 四个标签
    expect(tooMany.status).toBe(400); // 超限拒绝
    expect(tooMany.body.code).toBe('VALIDATION_FAILED'); // 统一校验错误码
    expect(tooMany.body.details?.reason).toBe('TOO_MANY_TAGS'); // 明细原因明确

    // 非法长度：1 字 → 400 INVALID_TAG
    const tooShort = await postThread(author, { tags: ['前'] }); // 单字标签
    expect(tooShort.status).toBe(400); // 长度不足拒绝
    expect(tooShort.body.details?.reason).toBe('INVALID_TAG'); // 明细原因

    // 非法长度：13 字 → 400 INVALID_TAG
    const tooLong = await postThread(author, { tags: ['一二三四五六七八九十十一三'] }); // 13 字
    expect(tooLong.status).toBe(400); // 超长拒绝
    expect(tooLong.body.details?.reason).toBe('INVALID_TAG'); // 明细原因

    // 非法字符：问号不在白名单 → 400 INVALID_TAG
    const badChar = await postThread(author, { tags: ['a#b?'] }); // 含 ? 非法符号
    expect(badChar.status).toBe(400); // 字符拒绝
    expect(badChar.body.details?.reason).toBe('INVALID_TAG'); // 明细原因
  }); // 用例结束

  it('列表按 tag 过滤只返回命中帖并回带 tags；热门标签按关联帖数倒序', async () => { // 标签过滤与计数
    const authorA = await registerTestAccount(app, '13800000062'); // 作者 A
    const authorB = await registerTestAccount(app, '13800000063'); // 作者 B
    const threadA = await postThread(authorA, { title: '摄影随拍', tags: ['摄影'] }); // 帖 A 挂「摄影」
    expect(threadA.status).toBe(201); // A 发帖成功
    const threadB = await postThread(authorB, { title: '编程笔记', tags: ['编程'] }); // 帖 B 挂「编程」
    expect(threadB.status).toBe(201); // B 发帖成功

    // 列表按 tag=摄影 过滤：只命中帖 A
    const filtered = await request(app).get('/api/v1/community/threads?tag=%E6%91%84%E5%BD%B1'); // 匿名读列表
    expect(filtered.status).toBe(200); // 列表公开可读
    const items = filtered.body.items as Array<{ id: string; tags: Array<{ slug: string; name: string }> }>; // 列表项
    expect(items.every((item) => item.tags.some((tag) => tag.slug === '摄影'))).toBe(true); // 全部命中摄影标签
    expect(items.find((item) => item.id === threadB.body.thread_id)).toBeUndefined(); // 帖 B 不在结果内
    const tagged = items.find((item) => item.id === threadA.body.thread_id); // 命中帖 A
    expect(tagged?.tags).toEqual([{ slug: '摄影', name: '摄影' }]); // 回带标签数组

    // 热门标签：两个标签都在清单内，且各自关联 1 帖
    const popular = await request(app).get('/api/v1/community/tags'); // 匿名读热门标签
    expect(popular.status).toBe(200); // 公开可读
    const tagItems = popular.body.items as Array<{ slug: string; thread_count: number }>; // 标签清单
    const photo = tagItems.find((tag) => tag.slug === '摄影'); // 摄影条目
    const code = tagItems.find((tag) => tag.slug === '编程'); // 编程条目
    expect(photo?.thread_count).toBe(1); // 关联帖数 = 1
    expect(code?.thread_count).toBe(1); // 关联帖数 = 1
  }); // 用例结束
}); // 标签用例组结束

describe('作者公开卡：统计口径 + 匿名可读', () => { // 作者端点用例组
  it('回读发帖数 / 累计获赞 / 徽章数与徽章名；匿名 200，不存在 404，不下发收藏关注', async () => { // 统计与隐私口径
    const author = await registerTestAccount(app, '13800000064'); // 作者账号
    const first = await postThread(author, { title: '作者统计帖一' }); // 第一帖
    expect(first.status).toBe(201); // 发帖成功
    const second = await postThread(author, { title: '作者统计帖二' }); // 第二帖
    expect(second.status).toBe(201); // 发帖成功

    // 直接写库把两帖点赞置为 5 / 3，累计获赞口径 = 求和 8
    db.prepare('UPDATE community_threads SET likes = 5 WHERE id = ?').run(first.body.thread_id); // 第一帖 5 赞
    db.prepare('UPDATE community_threads SET likes = 3 WHERE id = ?').run(second.body.thread_id); // 第二帖 3 赞

    // 授予一枚徽章：先插徽章定义，再写授予记录
    const now = new Date().toISOString(); // 统一时间戳
    db.prepare(`INSERT INTO growth_badges (code, name, description, icon, condition_type, condition_value, active, sort_order, created_at, updated_at)
      VALUES (?, ?, '', '', 'post_count', 1, 1, 1, ?, ?)`) // 徽章定义
      .run('badge-writer', '创作新星', now, now); // 写入一行徽章
    db.prepare('INSERT INTO user_badges (id, user_id, badge_code, source, awarded_at) VALUES (?, ?, ?, ?, ?)') // 授予记录
      .run(`ub-${randomUUID()}`, author.userId, 'badge-writer', 'admin', now); // 关联作者与徽章（source 仅允许 auto / admin）

    // 匿名读取作者卡：无令牌也能拿到公开字段
    const card = await request(app).get(`/api/v1/community/authors/${author.userId}`); // 匿名 GET
    expect(card.status).toBe(200); // 公开可读
    const body = card.body; // 响应体
    expect(body.author.id).toBe(author.userId); // 主键一致
    expect(body.author.display_name).toBeTruthy(); // 昵称回读
    expect(typeof body.author.member_no).toBe('string'); // Mim ID（纯数字或空串口径）
    expect(body.author.level).toBeGreaterThanOrEqual(1); // 等级回落 1
    expect(body.author.post_count).toBe(2); // 发帖数 = 2
    expect(body.author.total_likes).toBe(8); // 累计获赞 = 5 + 3
    expect(body.author.badge_count).toBe(1); // 徽章数 = 1
    expect(body.badges[0]?.name).toBe('创作新星'); // 徽章名清单回读
    expect(body.author.joined_at).toBeTruthy(); // 加入时间存在
    // 隐私口径：收藏、关注等个人关系字段一律不下发
    expect(body.author).not.toHaveProperty('favorites'); // 不含收藏
    expect(body.author).not.toHaveProperty('follows'); // 不含关注
    expect(body.author).not.toHaveProperty('followers'); // 不含粉丝

    // 不存在的作者：404，不泄露是否被删
    const missing = await request(app).get('/api/v1/community/authors/no-such-user'); // 匿名 GET 不存在标识
    expect(missing.status).toBe(404); // 404 口径
  }); // 用例结束
}); // 作者卡用例组结束

describe('归档与检索分组：匿名可读 + 分组结构', () => { // 归档 / 检索用例组
  it('归档返回月份分组；检索返回板块 / 帖子 / 标签三组与各自总数', async () => { // 分组聚合口径
    const author = await registerTestAccount(app, '13800000065'); // 发帖账号
    const posted = await postThread(author, { title: '检索分组验证帖', tags: ['检索'] }); // 带「检索」标签的帖子
    expect(posted.status).toBe(201); // 发帖成功

    // 归档：近 12 个月按月分组，计数 + 最近标题
    const archive = await request(app).get('/api/v1/community/archive'); // 匿名 GET
    expect(archive.status).toBe(200); // 公开可读
    expect(Array.isArray(archive.body.months)).toBe(true); // months 为数组
    const currentMonth = archive.body.months.find((month: { month: string; items: Array<{ id: string }> }) =>
      month.items.some((ref) => ref.id === posted.body.thread_id)); // 命中当前月份桶
    expect(currentMonth).toBeDefined(); // 新帖落入当月分组
    expect(currentMonth!.count).toBeGreaterThanOrEqual(1); // 当月计数 ≥ 1
    expect(currentMonth!.items.length).toBeLessThanOrEqual(3); // 每月最多 3 条标题

    // 检索：关键词命中帖子，同时聚合板块与标签分组
    const search = await request(app).get('/api/v1/community/search?q=%E6%A3%80%E7%B4%A2'); // 匿名 GET「检索」
    expect(search.status).toBe(200); // 公开可读
    expect(Array.isArray(search.body.items)).toBe(true); // 帖子命中数组
    expect(Array.isArray(search.body.boards)).toBe(true); // 板块分组数组
    expect(Array.isArray(search.body.tags)).toBe(true); // 标签分组数组
    expect(search.body.counts).toMatchObject({ // 各组总数结构完整
      threads: expect.any(Number), // 帖子命中数
      boards: expect.any(Number), // 板块命中数
      tags: expect.any(Number), // 标签命中数
    }); // 结构断言结束
    const tagHit = search.body.tags.find((tag: { slug: string }) => tag.slug === '检索'); // 标签分组命中「检索」
    expect(tagHit?.thread_count).toBeGreaterThanOrEqual(1); // 标签关联帖数 ≥ 1
  }); // 用例结束
}); // 归档 / 检索用例组结束
