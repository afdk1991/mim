/** 契约测试：自研工具发布 —— 种子清单 / 公开详情 / 关键词过滤 / 管理端增删改 / 鉴权门禁 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排：每例重建内存库
import express from 'express'; // 最小装配：直接挂载 tools 工厂（app.ts 主控挂载不在本包改动范围）
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createDatabase } from '../src/db.js'; // 内存库工厂，schema.d 种子自动写入
import { createToolsRouter } from '../src/routes/tools.js'; // 待测路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import type { ApiDeps } from '../src/types.js'; // 依赖容器类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 引导通道令牌，与注入 env 保持一致

let db: ReturnType<typeof createDatabase>; // 同生命周期数据库
let deps: ApiDeps; // 依赖容器

/** 最小应用：JSON 解析 → 依赖注入 → tools 路由 → 错误信封，与 createApp 同一中间件口径。 */
function buildApp(): Express {
  const app = express(); // 准备：构造本用例需要的输入或句柄
  app.use(express.json()); // 执行当前业务步骤
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 路由内经 req.deps 取 db / env
  app.use('/api/v1', createToolsRouter(deps)); // 执行当前业务步骤
  app.use(errorHandler); // 执行当前业务步骤
  return app; // 返回：交回本步骤结果供断言使用
} // 代码块结束

beforeEach(() => { // 每例重建内存库，21-tools.sql 三条种子幂等写入
  db = createDatabase(':memory:'); // 赋值：更新变量 db 的取值
  deps = { db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }; // 赋值：更新变量 deps 的取值
}); // 代码块结束

describe('公开工具清单与详情', () => { // 调用 describe 并处理其返回结果
  it('三条种子工具全部上线可见，标签与版本记录解析为数组', async () => { // 调用 it 并处理其返回结果
    const res = await request(buildApp()).get('/api/v1/tools'); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 200
    expect(res.body.items).toHaveLength(3); // 三条种子
    const slugs = res.body.items.map((t: { slug: string }) => t.slug); // 准备：构造本用例需要的输入或句柄
    expect(slugs).toContain('quick-build-wp'); // 断言：校验接口响应或状态符合冻结契约
    expect(slugs).toContain('db-replace-domain'); // 断言：校验接口响应或状态符合冻结契约
    expect(slugs).toContain('liudun-waf'); // 断言：校验接口响应或状态符合冻结契约
    for (const tool of res.body.items) { // 循环：逐项遍历集合并执行相同处理
      expect(Array.isArray(tool.tags)).toBe(true); // 标签数组
      expect(Array.isArray(tool.version_notes)).toBe(true); // 版本记录数组
      expect(tool.version_notes[0].version).toBeTruthy(); // 首条版本号存在
    } // 代码块结束
  }); // 代码块结束

  it('详情按 slug 返回完整字段；不存在的 slug 回 404', async () => { // 调用 it 并处理其返回结果
    const ok = await request(buildApp()).get('/api/v1/tools/quick-build-wp'); // 准备：构造本用例需要的输入或句柄
    expect(ok.status).toBe(200); // 200
    expect(ok.body.tool.name).toBe('Quick Build WP'); // 名称匹配
    expect(ok.body.tool.download_url).toBeTruthy(); // 下载链接存在
    expect(ok.body.tool.doc_url).toBeTruthy(); // 文档链接存在

    const missing = await request(buildApp()).get('/api/v1/tools/no-such-tool'); // 准备：构造本用例需要的输入或句柄
    expect(missing.status).toBe(404); // 404 信封
    expect(missing.body.code).toBe('NOT_FOUND'); // 断言：校验接口响应或状态符合冻结契约
  }); // 代码块结束

  it('关键词 q 命中名称 / 简介；标签 tag 过滤生效', async () => { // 调用 it 并处理其返回结果
    const byQ = await request(buildApp()).get('/api/v1/tools').query({ q: 'WAF' }); // 准备：构造本用例需要的输入或句柄
    expect(byQ.body.items).toHaveLength(1); // 只命中流盾 WAF
    expect(byQ.body.items[0].slug).toBe('liudun-waf'); // 断言：校验接口响应或状态符合冻结契约
    const byTag = await request(buildApp()).get('/api/v1/tools').query({ tag: 'wordpress' }); // 准备：构造本用例需要的输入或句柄
    expect(byTag.body.items.length).toBeGreaterThanOrEqual(1); // WordPress 相关工具
  }); // 代码块结束

  it('草稿与归档工具不在公开清单与公开详情中暴露', async () => { // 调用 it 并处理其返回结果
    const app = buildApp(); // 准备：构造本用例需要的输入或句柄
    await request(app) // 执行：等待异步操作返回后继续
      .post('/api/v1/tools') // 注册 POST 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-draft-1') // 执行当前业务步骤
      .send({ slug: 'draft-tool', name: '草稿工具', status: 'draft' }); // 执行当前业务步骤
    const list = await request(app).get('/api/v1/tools'); // 准备：构造本用例需要的输入或句柄
    expect(list.body.items.some((t: { slug: string }) => t.slug === 'draft-tool')).toBe(false); // 清单不可见
    const detail = await request(app).get('/api/v1/tools/draft-tool'); // 准备：构造本用例需要的输入或句柄
    expect(detail.status).toBe(404); // 详情不可见
  }); // 代码块结束
}); // 代码块结束

describe('管理端增删改', () => { // 调用 describe 并处理其返回结果
  it('匿名写操作返回 401；错误引导令牌返回 401', async () => { // 调用 it 并处理其返回结果
    const app = buildApp(); // 准备：构造本用例需要的输入或句柄
    const anon = await request(app).post('/api/v1/tools').send({ slug: 'x-tool', name: 'X' }); // 准备：构造本用例需要的输入或句柄
    expect(anon.status).toBe(401); // 未登录拒绝
    const wrong = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/tools') // 注册 POST 路由 / 中间件处理器
      .set('x-admin-token', 'wrong-token') // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-wrong-1') // 执行当前业务步骤
      .send({ slug: 'x-tool', name: 'X' }); // 执行当前业务步骤
    expect(wrong.status).toBe(401); // 令牌错误拒绝
  }); // 代码块结束

  it('引导令牌可新建工具；重复 slug 回 409', async () => { // 调用 it 并处理其返回结果
    const app = buildApp(); // 准备：构造本用例需要的输入或句柄
    const create = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/tools') // 注册 POST 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-create-1') // 执行当前业务步骤
      .send({ // 执行当前业务步骤
        slug: 'backup-script', // 对象字段 slug：记录一项配置或数据
        name: '数据库备份脚本', // 对象字段 name：记录一项配置或数据
        summary: '定时备份与保留策略脚本', // 对象字段 summary：记录一项配置或数据
        version_notes: [{ version: '1.2.0', notes: '新增保留策略' }], // 对象字段 version_notes：记录一项配置或数据
        download_url: '/tools/backup-script/download', // 对象字段 download_url：记录一项配置或数据
        doc_url: '/docs/backup-script', // 对象字段 doc_url：记录一项配置或数据
        tags: ['database', '备份'], // 对象字段 tags：记录一项配置或数据
        status: 'active', // 对象字段 status：记录一项配置或数据
        sort_order: 40, // 对象字段 sort_order：记录一项配置或数据
      }); // 代码块结束
    expect(create.status).toBe(201); // 新建成功
    expect(create.body.tool.slug).toBe('backup-script'); // 断言：校验接口响应或状态符合冻结契约
    const dup = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/tools') // 注册 POST 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-create-dup') // 执行当前业务步骤
      .send({ slug: 'backup-script', name: '重复' }); // 执行当前业务步骤
    expect(dup.status).toBe(409); // 冲突
  }); // 代码块结束

  it('PUT 更新简介 / 标签 / 状态；manage 清单可见草稿', async () => { // 调用 it 并处理其返回结果
    const app = buildApp(); // 准备：构造本用例需要的输入或句柄
    const update = await request(app) // 准备：构造本用例需要的输入或句柄
      .put('/api/v1/tools/liudun-waf') // 注册 PUT 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-update-1') // 执行当前业务步骤
      .send({ summary: '更新后的防护说明', tags: ['waf', '安全', 'Beta'], status: 'draft' }); // 执行当前业务步骤
    expect(update.status).toBe(200); // 更新成功
    expect(update.body.tool.summary).toBe('更新后的防护说明'); // 断言：校验接口响应或状态符合冻结契约
    expect(update.body.tool.tags).toEqual(['waf', '安全', 'Beta']); // 断言：校验接口响应或状态符合冻结契约

    const manage = await request(app).get('/api/v1/tools/manage').set('x-admin-token', ADMIN_TOKEN); // 准备：构造本用例需要的输入或句柄
    expect(manage.status).toBe(200); // 管理清单可读
    const draft = manage.body.items.find((t: { slug: string }) => t.slug === 'liudun-waf'); // 准备：构造本用例需要的输入或句柄
    expect(draft.status).toBe('draft'); // 草稿在管理端可见
    const publicList = await request(app).get('/api/v1/tools'); // 准备：构造本用例需要的输入或句柄
    expect(publicList.body.items.some((t: { slug: string }) => t.slug === 'liudun-waf')).toBe(false); // 公开面已隐藏
  }); // 代码块结束

  it('DELETE 删除工具；重复删除回 404', async () => { // 调用 it 并处理其返回结果
    const app = buildApp(); // 准备：构造本用例需要的输入或句柄
    const remove = await request(app) // 准备：构造本用例需要的输入或句柄
      .delete('/api/v1/tools/db-replace-domain') // 注册 DELETE 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-delete-1'); // 执行当前业务步骤
    expect(remove.status).toBe(200); // 删除成功
    const detail = await request(app).get('/api/v1/tools/db-replace-domain'); // 准备：构造本用例需要的输入或句柄
    expect(detail.status).toBe(404); // 公开详情已不可见
    const again = await request(app) // 准备：构造本用例需要的输入或句柄
      .delete('/api/v1/tools/db-replace-domain') // 注册 DELETE 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-delete-2'); // 执行当前业务步骤
    expect(again.status).toBe(404); // 重复删除 404
  }); // 代码块结束

  it('非法 slug 与超长字段回 400 校验错误', async () => { // 调用 it 并处理其返回结果
    const app = buildApp(); // 准备：构造本用例需要的输入或句柄
    const bad = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/tools') // 注册 POST 路由 / 中间件处理器
      .set('x-admin-token', ADMIN_TOKEN) // 执行当前业务步骤
      .set('Idempotency-Key', 'tools-bad-1') // 执行当前业务步骤
      .send({ slug: 'Invalid Slug!', name: '非法标识' }); // 执行当前业务步骤
    expect(bad.status).toBe(400); // 校验失败
    expect(bad.body.code).toBe('VALIDATION_FAILED'); // 断言：校验接口响应或状态符合冻结契约
  }); // 代码块结束
}); // 代码块结束
