/** 契约测试：图库 / 视频（媒体元数据、严格付费墙、收藏、按帖聚合、匿名白名单） */

// 引入临时目录创建与删除：每例独立本地存储，用例结束后清理
import { mkdtempSync, rmSync } from 'node:fs'; // 建 / 删临时存储目录
// 引入随机 UUID：为写操作生成幂等键
import { randomUUID } from 'node:crypto'; // 写操作幂等键
// 引入系统临时目录路径：拼临时存储目录前缀
import { tmpdir } from 'node:os'; // 系统临时目录
// 引入路径拼接工具：跨平台拼临时目录名
import { join } from 'node:path'; // 路径拼接
// 引入 vitest 套件与断言：组织用例、前后置钩子与结果比对
import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 测试框架
// 引入 supertest：对应用发起进程内 HTTP 调用并断言响应
import request from 'supertest'; // 进程内 HTTP 调用
// 引入 Express 应用类型：约束 app 句柄类型
import type { Express } from 'express'; // 应用类型
// 引入被测应用工厂：装配路由、中间件与错误信封
import { createApp } from '../src/app.js'; // 被测应用
// 引入建库函数：创建内存库并执行种子
import { createDatabase } from '../src/db.js'; // 内存库 + 种子
// 引入本地存储驱动工厂：按临时目录落盘上传字节
import { createStorage } from '../src/storage.js'; // 本地存储驱动
// 引入存储适配器类型：约束 storage 句柄类型
import type { StorageAdapter } from '../src/storage.js'; // 存储适配器类型
// 引入鉴权辅助：注册测试账号与口令登录拿鉴权头
import { loginHeaders, registerTestAccount } from './_auth-helper.js'; // 注册 + 登录

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const FREE_THREAD = 'thread-store-visual'; // 种子免费帖
const PAID_THREAD = 'thread-paid-store'; // 种子付费帖（1900 分）

let app: Express; // 应用句柄
let db: ReturnType<typeof createDatabase>; // 直接查库构造场景
let storageDir: string; // 每例独立存储目录
let storage: StorageAdapter; // 存储实例

/** 把预签名绝对地址转成同源路径 */
function pathOf(url: string): string {
  // 解析 URL，只保留路径与查询串（签名参数在内），供 supertest 同源请求
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/** 预签名上传一段字节，返回对象键 */
async function uploadFile(auth: Record<string, string>, mime: string, body: Buffer): Promise<string> {
  // 先申请上传预签名地址，声明媒体类型与字节数
  const presign = await request(app)
    .post('/api/v1/media/presign/upload')
    .set({ ...auth, 'idempotency-key': randomUUID() })
    .send({ asset_type: 'final', mime, size_bytes: body.byteLength });
  expect(presign.status).toBe(201); // 预签名签发成功
  // 按签名地址 PUT 原字节完成上传
  const uploaded = await request(app).put(pathOf(presign.body.upload.url as string)).set('content-type', mime).send(body);
  expect(uploaded.status).toBe(204); // 上传成功无返回体
  // 返回对象键，供发帖挂载媒体使用
  return presign.body.object_key as string;
}

/** 取某个帖子的媒体主键 */
function mediaIdOf(threadId: string): string {
  // 按排序顺序取该帖第一条媒体的主键
  return (db.prepare('SELECT id FROM community_thread_media WHERE thread_id = ? ORDER BY sort_order ASC LIMIT 1').get(threadId) as { id: string }).id;
}

// 每个用例前重建内存库、临时目录、本地存储与应用，保证场景隔离
beforeEach(() => {
  db = createDatabase(':memory:'); // 全新内存库带种子
  storageDir = mkdtempSync(join(tmpdir(), 'mim-gallery-')); // 新建每例独立临时目录
  storage = createStorage({
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir }, // 本地驱动指向临时目录
    jwtSecret: JWT_SECRET,
    fallbackDir: storageDir, // 兜底目录同样指向临时目录
  });
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage }); // 装配应用并注入存储实例
});

// 每个用例结束后删除临时目录，避免测试字节残留磁盘
afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

describe('图库 / 视频', () => {
  it('发帖挂对象键图片与视频：详情回签名地址与时长 / 分辨率，绝不泄露对象键', async () => {
    // 注册登录普通用户，准备上传媒体并发帖
    const auth = await loginHeaders(app, '13700000301');
    const imageKey = await uploadFile(auth, 'image/png', Buffer.from('fake-png-bytes')); // 上传示例图片
    const videoKey = await uploadFile(auth, 'video/mp4', Buffer.from('fake-mp4-bytes')); // 上传示例视频
    const posterKey = await uploadFile(auth, 'image/jpeg', Buffer.from('fake-poster-bytes')); // 上传视频封面图

    // 发帖并挂载一条图片、一条视频媒体（含封面 / 时长 / 分辨率元数据）
    const created = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...auth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '图库与视频元数据',
        body: '这篇帖子携带图片与视频对象键，服务端需要回读真实元数据并在详情签发短时地址。',
        media: [
          { kind: 'image', object_key: imageKey, width: 1200, height: 800 },
          { kind: 'video', object_key: videoKey, poster_key: posterKey, duration_seconds: 42, width: 1920, height: 1080, mime: 'video/mp4' },
        ],
      });
    expect(created.status).toBe(201); // 发帖成功
    const threadId = created.body.thread_id as string; // 取新帖主键供后续详情请求

    // 匿名拉详情：校验媒体元数据与签名地址，对象键不得裸出
    const detail = await request(app).get(`/api/v1/community/threads/${threadId}`);
    expect(detail.status).toBe(200); // 详情可达
    expect(detail.body.thread.media).toHaveLength(2); // 两条媒体均已挂载
    const video = detail.body.thread.media[1]; // 取第二条（视频）媒体
    expect(video.kind).toBe('video'); // 媒体类型为视频
    expect(video.duration_seconds).toBe(42); // 时长元数据回读一致
    expect(video.width).toBe(1920); // 视频宽一致
    expect(video.height).toBe(1080); // 视频高一致
    expect(video.mime).toBe('video/mp4'); // MIME 类型一致
    expect(video.url).toContain('signature='); // 对象键已换成签名地址
    expect(video.poster_url).toContain('signature='); // 封面同样签发签名地址
    expect(String(detail.body.thread.cover_url)).toContain('signature='); // 未显式传封面时回落第一条带封面的媒体，并已签名
    expect(detail.body.thread.cover_url).not.toBe(posterKey); // 封面不是裸对象键

    // 全量响应序列化后核对：三个对象键均不得作为裸字段出现
    const raw = JSON.stringify(detail.body);
    expect(raw).not.toContain(`"${imageKey}"`); // 对象键只在签名地址内部出现，绝不作为裸字段下发
    expect(raw).not.toContain(`"${videoKey}"`); // 视频对象键不裸出
    expect(raw).not.toContain(`"${posterKey}"`); // 封面对象键不裸出

    // 用签名地址回源取字节：地址可访问且内容与上传一致
    const fetched = await request(app).get(pathOf(video.url as string));
    expect(fetched.status).toBe(200); // 签名地址能取回原字节
    expect(Buffer.from(fetched.body)).toEqual(Buffer.from('fake-mp4-bytes')); // 字节内容逐字一致
  });

  it('付费帖的视频与图片严格受付费墙约束：匿名 / 未购看不到地址，作者与 VIP 可见', async () => {
    // 注册作者并把种子付费帖作者改为本人，便于核对作者视角放行
    const author = await registerTestAccount(app, '13700000302');
    const authorAuth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };
    db.prepare('UPDATE community_threads SET author_id = ? WHERE id = ?').run(author.userId, PAID_THREAD);
    const imageKey = await uploadFile(authorAuth, 'image/png', Buffer.from('paid-image')); // 付费图片对象键
    const videoKey = await uploadFile(authorAuth, 'video/mp4', Buffer.from('paid-video')); // 付费视频对象键
    // 直写一条视频媒体记录：对象键落存储键字段，地址留空待付费墙裁剪
    db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, storage_key, poster_key, mime, size_bytes, duration_seconds, width, height, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`media-${randomUUID()}`, PAID_THREAD, 'video', '', null, videoKey, null, 'video/mp4', 10, 99, 1280, 720, 0, new Date().toISOString());
    // 直写一条图片媒体记录，排序在视频之后
    db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, storage_key, poster_key, mime, size_bytes, duration_seconds, width, height, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`media-${randomUUID()}`, PAID_THREAD, 'image', '', null, imageKey, null, 'image/png', 9, 0, 100, 100, 1, new Date().toISOString());

    // 匿名视角：媒体列表为空，响应不含视频对象键
    const anonymous = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`);
    expect(anonymous.status).toBe(200); // 详情本身匿名可达
    expect(anonymous.body.thread.media).toEqual([]); // 免费板块里的付费帖：板块开放也不能放行媒体
    expect(JSON.stringify(anonymous.body)).not.toContain(videoKey); // 匿名响应不泄露存储键

    // 已登录未购用户：同样看不到媒体地址
    const outsider = await loginHeaders(app, '13700000303');
    const notBought = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set(outsider);
    expect(notBought.body.thread.media).toEqual([]); // 未购视角媒体为空

    // 作者本人视角：两条媒体均可见
    const byAuthor = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set(authorAuth);
    expect(byAuthor.body.thread.media).toHaveLength(2); // 作者可见两条
    expect(byAuthor.body.thread.media[0].duration_seconds).toBe(99); // 第一条视频时长回读一致

    // 注册 VIP 用户并直写一条生效会籍，核对 VIP 免购视角
    const vip = await registerTestAccount(app, '13700000304');
    db.prepare('INSERT INTO vip_memberships (id, user_id, plan_id, level, starts_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`vip-${randomUUID()}`, vip.userId, 'vip-monthly', 1, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString(), 'active', new Date().toISOString());
    const byVip = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set({ authorization: `Bearer ${vip.token}` });
    expect(byVip.body.thread.media).toHaveLength(2); // VIP 免购可见两条媒体
  });

  it('图库列表按用户视角返回：锁定项隐藏地址，作者 / VIP / 收藏过滤与聚合可用', async () => {
    // 注册作者，准备发一条公开图与一条付费视频
    const author = await registerTestAccount(app, '13700000305');
    const authorAuth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };
    const freeKey = await uploadFile(authorAuth, 'image/png', Buffer.from('gallery-free')); // 公开图对象键
    // 发公开图库帖：匿名可读、可被收藏
    const free = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '公开图库：海边落日',
        body: '公开图库用于验证匿名可读与收藏链路，图片走对象键直传。',
        media: [{ kind: 'image', object_key: freeKey, width: 800, height: 600 }],
      });
    expect(free.status).toBe(201); // 公开帖发帖成功
    const freeThreadId = free.body.thread_id as string; // 公开帖主键

    const paidKey = await uploadFile(authorAuth, 'video/mp4', Buffer.from('gallery-paid')); // 付费视频对象键
    // 发付费视频帖：购买前列表不返回任何地址
    const paid = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '付费视频：完整课程',
        body: '付费视频用于验证图库锁定与收藏拦截，购买前不返回任何地址。',
        price_cents: 2600,
        media: [{ kind: 'video', object_key: paidKey, duration_seconds: 600, width: 1920, height: 1080 }],
      });
    expect(paid.status).toBe(201); // 付费帖发帖成功
    const paidThreadId = paid.body.thread_id as string; // 付费帖主键
    const paidMediaId = mediaIdOf(paidThreadId); // 付费媒体主键供收藏接口使用

    // 匿名拉图库列表：公开项带签名地址，锁定项地址为空且不泄露对象键
    const anonymous = await request(app).get('/api/v1/community/gallery/items?limit=60');
    expect(anonymous.status).toBe(200); // 列表匿名可达
    const freeItem = (anonymous.body.items as Array<Record<string, unknown>>).find((item) => item.thread_id === freeThreadId); // 定位公开项
    const paidItem = (anonymous.body.items as Array<Record<string, unknown>>).find((item) => item.thread_id === paidThreadId); // 定位付费项
    expect(freeItem?.locked).toBe(false); // 公开项未锁定
    expect(String(freeItem?.url)).toContain('signature='); // 公开项地址已签名
    expect(paidItem?.locked).toBe(true); // 付费项锁定
    expect(paidItem?.url).toBe(''); // 付费项地址为空串
    expect(JSON.stringify(anonymous.body)).not.toContain(paidKey); // 匿名响应不含付费对象键

    // 作者视角：自己的付费项不锁定
    const byAuthor = await request(app).get(`/api/v1/community/gallery/items?author_id=${author.userId}`).set(authorAuth);
    expect((byAuthor.body.items as Array<Record<string, unknown>>).find((item) => item.thread_id === paidThreadId)?.locked).toBe(false); // 作者条目不锁定

    // 未购用户收藏付费媒体：应被 403 拦截
    const outsider = await loginHeaders(app, '13700000306');
    const favoriteLocked = await request(app)
      .post(`/api/v1/community/gallery/items/${paidMediaId}/favorite`)
      .set({ ...outsider, 'idempotency-key': randomUUID() });
    expect(favoriteLocked.status).toBe(403); // 未解锁的媒体不能收藏

    // 收藏公开媒体：成功后收藏过滤能查到，取消收藏后移出
    const freeMediaId = mediaIdOf(freeThreadId);
    const favorite = await request(app)
      .post(`/api/v1/community/gallery/items/${freeMediaId}/favorite`)
      .set({ ...outsider, 'idempotency-key': randomUUID() });
    expect(favorite.status).toBe(200); // 收藏成功
    const mine = await request(app).get('/api/v1/community/gallery/items?favorited=1').set(outsider);
    expect((mine.body.items as Array<Record<string, unknown>>).map((item) => item.id)).toContain(freeMediaId); // 收藏过滤命中该媒体
    const unfavorite = await request(app)
      .delete(`/api/v1/community/gallery/items/${freeMediaId}/favorite`)
      .set({ ...outsider, 'idempotency-key': randomUUID() });
    expect(unfavorite.status).toBe(200); // 取消收藏成功

    // 按帖聚合：公开帖成组计数 1、封面已签名；锁定帖不进匿名聚合
    const collections = await request(app).get(`/api/v1/community/gallery/collections?group=thread&author_id=${author.userId}`);
    expect(collections.status).toBe(200); // 聚合接口可达
    const freeGroup = (collections.body.collections as Array<Record<string, unknown>>).find((item) => item.key === freeThreadId); // 定位公开帖分组
    expect(freeGroup?.count).toBe(1); // 公开帖媒体计数为 1
    expect(String(freeGroup?.cover_url)).toContain('signature='); // 分组封面已签名
    expect((collections.body.collections as Array<Record<string, unknown>>).find((item) => item.key === paidThreadId)).toBeUndefined(); // 匿名聚合不包含锁定帖
  });

  it('图库筛选：板块与上传时间区间可叠加，作者聚合复用 collections 路由', async () => {
    // 注册作者并发一条样本帖，直改媒体时间戳供区间筛选断言
    const author = await registerTestAccount(app, '13700000307');
    const authorAuth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };
    const imageKey = await uploadFile(authorAuth, 'image/png', Buffer.from('filter-image'));
    const created = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '筛选样本：板块与时间',
        body: '用于验证图库的板块与上传时间区间筛选，以及作者聚合入口。',
        media: [{ kind: 'image', object_key: imageKey }],
      });
    expect(created.status).toBe(201); // 样本帖发帖成功
    const threadId = created.body.thread_id as string; // 样本帖主键
    const mediaId = mediaIdOf(threadId); // 样本媒体主键
    db.prepare('UPDATE community_thread_media SET created_at = ? WHERE id = ?').run('2026-01-02T10:00:00.000Z', mediaId); // 固定媒体上传时间在区间内

    // 作者聚合入口：collections 复用同一批筛选参数（此时帖子仍在公开板块，匿名可见）
    const collections = await request(app).get(`/api/v1/community/gallery/collections?group=thread&author_id=${author.userId}&from=2026-01-01&to=2026-01-03`);
    expect(collections.status).toBe(200); // 聚合接口可达
    expect((collections.body.collections as Array<Record<string, unknown>>).map((item) => item.key)).toContain(threadId); // 区间内分组命中样本帖
    const filteredOut = await request(app).get(`/api/v1/community/gallery/collections?group=thread&author_id=${author.userId}&from=2026-01-03`);
    expect((filteredOut.body.collections as Array<Record<string, unknown>>).map((item) => item.key)).not.toContain(threadId); // 起点晚于样本时间，分组被排除

    // 把样本帖挪到付费板块，核对板块筛选
    db.prepare("UPDATE community_threads SET board_id = (SELECT id FROM community_boards WHERE slug = 'paid') WHERE id = ?").run(threadId);

    const byBoard = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&limit=60');
    expect(byBoard.status).toBe(200); // 板块列表可达
    expect((byBoard.body.items as Array<Record<string, unknown>>).every((item) => item.board_slug === 'paid')).toBe(true); // 返回项均属付费板块
    expect((byBoard.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(true); // 付费板块命中样本媒体

    const otherBoard = await request(app).get('/api/v1/community/gallery/items?board_slug=general&limit=60');
    expect((otherBoard.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(false); // 公开板块不再出现样本媒体

    // 时间区间叠加板块筛选：落在区间内命中，起点 / 终点越界均排除
    const inRange = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&from=2026-01-01&to=2026-01-03&limit=60');
    expect((inRange.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(true); // 区间内命中
    const tooLate = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&from=2026-01-03&limit=60');
    expect((tooLate.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(false); // 起点晚于样本时间，排除
    const tooEarly = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&to=2026-01-01&limit=60');
    expect((tooEarly.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(false); // 终点早于样本时间，排除

    // 匿名列表复核：新筛选不影响匿名可读，锁定项地址仍为空
    const anonymous = await request(app).get('/api/v1/community/gallery/items?limit=60');
    expect(anonymous.status).toBe(200); // 新筛选不影响匿名可读
    const lockedRows = (anonymous.body.items as Array<Record<string, unknown>>).filter((item) => item.locked === true);
    for (const row of lockedRows) expect(row.url).toBe(''); // 付费墙契约：锁定项地址仍为空
  });

  it('全站强制登录开启时：图库匿名可读，锁定规则不变', async () => {
    // 给种子付费帖补一条媒体，用于验证强制登录下的收藏门禁
    db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`media-${randomUUID()}`, PAID_THREAD, 'image', '/catalog/store.jpg', null, 0, new Date().toISOString()); // 种子付费帖补一条媒体，用于验证收藏门禁
    // 以强制登录环境变量重建应用，核对白名单只读接口仍匿名可达
    const guarded = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_FORCE_LOGIN: '1' }, storage });
    const list = await request(guarded).get('/api/v1/community/gallery/items?limit=20');
    expect(list.status).toBe(200); // 白名单内匿名可读
    expect(list.body.total).toBeGreaterThan(0); // 列表有种子数据
    const collections = await request(guarded).get('/api/v1/community/gallery/collections?group=author&limit=20');
    expect(collections.status).toBe(200); // 聚合同样匿名可读
    const anonymousPaid = await request(guarded).get(`/api/v1/community/threads/${PAID_THREAD}`);
    expect(anonymousPaid.status).toBe(200); // 详情仍匿名可读，但媒体为空
    expect(anonymousPaid.body.thread.media).toEqual([]); // 强制登录不改变付费墙裁剪
    const favorite = await request(guarded)
      .post(`/api/v1/community/gallery/items/${mediaIdOf(PAID_THREAD)}/favorite`)
      .set({ 'idempotency-key': randomUUID() });
    expect([401, 403]).toContain(favorite.status); // 收藏必须登录
  });
});
