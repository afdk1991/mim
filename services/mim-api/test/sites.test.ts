/** 契约测试：站点模块（44 个去重入口驱动）——目录 / 详情 / 能力点 / 业务条目 / 鉴权 / 幂等 / 状态流转 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排：每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 仅类型导入，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，保证中间件挂载顺序与生产一致
import { createDatabase } from '../src/db.js'; // 内存库工厂，启动即写入 44 模块演示数据
import { SITE_MODULES } from '@mim/core-domain'; // 共享注册表，作为断言基准

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄

// 登录辅助：先取验证码再换令牌，与其余契约测试保持同一口径。
async function login(identifier: string): Promise<string> { // 返回 Bearer 访问令牌
  const codeRes = await request(app) // 申请验证码
    .post('/api/v1/auth/code') // 验证码端点
    .send({ region: 'cn', provider: 'phone', identifier }); // 固定 cn + 手机号通道
  expect(codeRes.status).toBe(201); // 断言 201，验证码已创建
  const loginRes = await request(app) // 用验证码换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ // 登录请求体
      region: 'cn', // 区域固定 cn
      provider: 'phone', // 通道固定手机号
      identifier, // 与验证码阶段一致
      code: codeRes.body.dev_code, // 测试环境服务端直返 dev_code
      device: { platform: 'web', name: 'test' }, // 设备信息为登录契约必填项
    }); // 请求体结束
  expect(loginRes.status).toBe(200); // 断言 200，登录成功
  return loginRes.body.access_token as string; // 返回访问令牌
} // login 结束

beforeEach(() => { // 每例前置：重建内存库与应用
  db = createDatabase(':memory:'); // 内存库全新创建，模块/角色/站点演示数据自动种入
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 不启用管理面，保持最小依赖
}); // beforeEach 结束

describe('站点模块注册表与公开目录', () => { // 浏览类端点匿名可访问
  it('overview 返回 44 入口 / 132 能力 / 19 业务域 / 46 占位标识 / 88 演示条目与落地四态计数', async () => { // 注册表规模断言
    const res = await request(app).get('/api/v1/sites/overview'); // 公开汇总
    expect(res.status).toBe(200); // 200
    expect(res.body.modules).toBe(44); // 44 类业务备注
    expect(res.body.capabilities).toBe(132); // 每模块 3 个功能点
    expect(res.body.domains).toBe(19); // 19 个业务域
    expect(res.body.groups).toBe(19); // 兼容字段同值
    expect(res.body.placeholders).toBe(46); // 44 入口 + @ 根域名 + 空白占位
    expect(res.body.configured).toBe(0); // 未提供具体主机值，默认全未配置
    expect(res.body.schema).toBe('mim.site-modules.v2'); // v2 契约
    expect(res.body.blankRows).toBe(13); // mixm.top 工作表 13 行空备注
    expect(res.body.items).toBe(88); // 每模块 2 条演示数据
    expect(res.body.source).toContain('主机记录与备注'); // 依据说明
    expect(res.body.moduleBasis).toContain('业务系统'); // 模块划分依据
    // 落地状态四态计数：已落地 4 / 部分相邻 19 / 规划中 19 / 语义冲突 2，合计 44
    expect(res.body.implementation).toEqual({ implemented: 4, partial: 19, planned: 19, conflict: 2 });
  }); // overview 用例结束

  it('GET /sites 返回 44 模块且每条备注原文与共享注册表逐字一致', async () => { // 零漂移断言
    const res = await request(app).get('/api/v1/sites'); // 公开列表
    expect(res.status).toBe(200); // 200
    expect(res.body.total).toBe(44); // 全量
    expect(res.body.domains.length).toBe(19); // 19 个业务域清单
    for (const module of SITE_MODULES) { // 逐条比对备注原文
      const row = res.body.modules.find((m: { entryKey: string }) => m.entryKey === module.entryKey); // 按占位键定位
      expect(row).toBeTruthy(); // 不得缺项
      expect(row.note).toBe(module.note); // 备注原文逐字一致
      expect(row.placeholder).toBe(module.placeholder); // 可配置占位标识一致
      expect(row.configured).toBe(false); // 未补写具体主机值
      expect(row.coreFunctions.length).toBeGreaterThan(0); // 核心功能齐备
      expect(row.responsibility.outOfScope.length).toBeGreaterThan(0); // 职责边界齐备
      expect(row.adminRole).toBeTruthy(); // 后台管理职责
      expect(row.apiRole).toBeTruthy(); // 接口职责
      expect(row.related.length).toBeGreaterThan(0); // 相似模块关联与区分
      expect(row.rows).toEqual(module.rows); // 表内行号一致
      expect(row.capability_count).toBe(3); // 三个功能点
      expect(row.item_count).toBe(2); // 两条演示数据
      // 落地映射随列表透出：状态合法、视图为 null 或已登记视图、边界说明非空
      expect(['implemented', 'partial', 'planned', 'conflict']).toContain(row.implementation.status);
      expect(row.implementation.boundary).toBeTruthy();
    } // 比对循环结束
  }); // 零漂移用例结束

  it('GET /sites?q= 与 domain 过滤生效', async () => { // 搜索与分组
    const byNote = await request(app).get('/api/v1/sites?q=' + encodeURIComponent('官方博客系统')); // 按系统名搜索
    expect(byNote.status).toBe(200); // 200
    expect(byNote.body.total).toBe(1); // 命中唯一一条
    expect(byNote.body.modules[0].entryKey).toBe('BLOG'); // 命中博客入口占位键
    const byDomain = await request(app).get('/api/v1/sites?domain=commerce'); // 电商与商贸业务域
    expect(byDomain.body.total).toBe(9); // B2C / 支付 / 营销 / 多商户 / B2B / C2C / 供应商 / 货源 / 卖家
    const byLegacy = await request(app).get('/api/v1/sites?group=content'); // 兼容旧 group 参数
    expect(byLegacy.body.total).toBe(4); // 博客 / 资讯 / 自媒体 / WordPress
    const byPlaceholder = await request(app).get('/api/v1/sites?q=' + encodeURIComponent('{{HOST:B2B_TRADE}}')); // 按占位标识搜索
    expect(byPlaceholder.body.total).toBe(1); // 命中唯一一条
  }); // 过滤用例结束

  it('未登记的占位键返回 404 NOT_FOUND 信封', async () => { // 非法主机
    const res = await request(app).get('/api/v1/sites/NOT_AN_ENTRY'); // 未登记占位键
    expect(res.status).toBe(404); // 404
    expect(res.body.code).toBe('NOT_FOUND'); // 统一错误码
    expect(res.body.request_id).toBeTruthy(); // 携带追踪 ID
  }); // 404 用例结束
}); // 公开目录分组结束

describe('模块详情与能力点', () => { // 详情视图
  it('GET /sites/BLOG 返回备注原文、占位标识、3 个能力点与条目统计', async () => { // 博客模块
    const res = await request(app).get('/api/v1/sites/BLOG'); // 公开详情
    expect(res.status).toBe(200); // 200
    expect(res.body.module.note).toBe('博客模块入口｜官方博客系统'); // 备注原文
    expect(res.body.module.rows).toEqual([16, 17]); // mixm.top 第 16、17 行
    expect(res.body.module.placeholder).toBe('{{HOST:BLOG}}'); // 可配置占位标识
    expect(res.body.module.entryKey).toBe('BLOG'); // 入口标识
    expect(res.body.module.hostValue).toBeNull(); // 不补写具体主机值
    expect(res.body.module.domain).toBe('content'); // 业务域
    expect(res.body.module.coreFunctions.length).toBe(3); // 核心功能
    expect(res.body.module.related.length).toBeGreaterThan(0); // 相似模块关联与区分
    expect(res.body.module.capabilities.map((c: { code: string }) => c.code)).toEqual(['catalog', 'manage', 'record']); // 三类能力
    expect(res.body.stats.total).toBe(2); // 两条演示数据
    expect(res.body.capability_kinds.catalog.states).toEqual(['active', 'archived']); // 清单状态机
    expect(res.body.capability_kinds.manage.states).toEqual(['pending', 'active', 'archived']); // 管理状态机
    expect(res.body.capability_kinds.record.states).toEqual(['pending', 'done', 'archived']); // 记录状态机
  }); // 博客详情用例结束

  it('GET /sites/:host/capabilities 返回该模块能力点', async () => { // 独立能力端点
    const res = await request(app).get('/api/v1/sites/PAYMENT_GATEWAY/capabilities'); // 支付结算入口占位键
    expect(res.status).toBe(200); // 200
    expect(res.body.host).toBe('PAYMENT_GATEWAY'); // 回显占位键
    expect(res.body.capabilities.length).toBe(3); // 三个功能点
    expect(res.body.capabilities[0].name).toBe('交易流水'); // 能力名按系统名派生
  }); // 能力端点用例结束

  it('GET /sites/:host/items 支持 capability / status 过滤', async () => { // 条目查询
    const all = await request(app).get('/api/v1/sites/BLOG/items'); // 不过滤
    expect(all.status).toBe(200); // 200
    expect(all.body.total).toBe(2); // 两条演示数据
    const catalog = await request(app).get('/api/v1/sites/BLOG/items?capability=catalog'); // 仅清单能力
    expect(catalog.body.total).toBe(1); // 一条
    expect(catalog.body.items[0].status).toBe('active'); // 清单默认态
    const pending = await request(app).get('/api/v1/sites/BLOG/items?status=pending'); // 仅待处理
    expect(pending.body.total).toBe(1); // 一条
    expect(pending.body.items[0].capability).toBe('manage'); // 管理能力的演示条目
    const badCap = await request(app).get('/api/v1/sites/BLOG/items?capability=nope'); // 非法能力
    expect(badCap.status).toBe(400); // 400
    expect(badCap.body.code).toBe('VALIDATION_FAILED'); // 统一校验错误码
  }); // 条目过滤用例结束
}); // 详情分组结束

describe('写操作鉴权 / 幂等 / 状态流转', () => { // 写路径
  it('匿名新建条目返回 401 AUTH_UNAUTHORIZED', async () => { // 按需登录门禁
    const res = await request(app).post('/api/v1/sites/BLOG/items') // 新建
      .send({ capability: 'catalog', title: '匿名条目' }); // 合法请求体
    expect(res.status).toBe(401); // 401
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 统一错误码
  }); // 匿名写用例结束

  it('登录后可新建条目，默认状态取能力首态', async () => { // 新建成功路径
    const token = await login('13800000001'); // 取令牌
    const res = await request(app).post('/api/v1/sites/BLOG/items') // 新建
      .set('Authorization', `Bearer ${token}`) // 带 Bearer
      .set('Idempotency-Key', 'site-create-1') // 显式幂等键
      .send({ capability: 'manage', title: '新稿件', detail: '测试说明' }); // 请求体
    expect(res.status).toBe(201); // 201
    expect(res.body.item.title).toBe('新稿件'); // 标题回显
    expect(res.body.item.status).toBe('pending'); // manage 默认态
    expect(res.body.item.capability).toBe('manage'); // 能力回显
    expect(res.body.item.created_by).not.toBe('system'); // 创建者为登录用户，非演示数据
    const list = await request(app).get('/api/v1/sites/BLOG/items?capability=manage'); // 复查列表
    expect(list.body.total).toBe(2); // 演示 1 条 + 新建 1 条
  }); // 新建成功用例结束

  it('同一幂等键重复提交回放首次响应，不产生第二条', async () => { // 幂等
    const token = await login('13800000002'); // 取令牌
    const payload = { capability: 'record', title: '阅读记录' }; // 固定请求体
    const first = await request(app).post('/api/v1/sites/BLOG/items') // 首次
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-create-dup') // 幂等键
      .send(payload); // 请求体
    expect(first.status).toBe(201); // 201
    const second = await request(app).post('/api/v1/sites/BLOG/items') // 重放
      .set('Authorization', `Bearer ${token}`) // 同一用户
      .set('Idempotency-Key', 'site-create-dup') // 同键
      .send(payload); // 同体
    expect(second.status).toBe(201); // 回放首次状态码
    expect(second.body.item.id).toBe(first.body.item.id); // 同一条目主键
    const list = await request(app).get('/api/v1/sites/BLOG/items?capability=record'); // 复查
    expect(list.body.total).toBe(1); // 仅一条，未重复写入
  }); // 幂等用例结束

  it('非法能力 / 非法状态 / 空标题返回 400 VALIDATION_FAILED', async () => { // 入参校验
    const token = await login('13800000003'); // 取令牌
    const badCap = await request(app).post('/api/v1/sites/BLOG/items') // 非法能力
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-bad-cap') // 幂等键
      .send({ capability: 'nope', title: 'x' }); // 请求体
    expect(badCap.status).toBe(400); // 400
    expect(badCap.body.code).toBe('VALIDATION_FAILED'); // 统一错误码
    const badStatus = await request(app).post('/api/v1/sites/BLOG/items') // 非法状态
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-bad-status') // 幂等键
      .send({ capability: 'catalog', title: 'x', status: 'pending' }); // catalog 不含 pending
    expect(badStatus.status).toBe(400); // 400
    const emptyTitle = await request(app).post('/api/v1/sites/BLOG/items') // 空标题
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-empty-title') // 幂等键
      .send({ capability: 'catalog', title: '   ' }); // zod trim 后为空
    expect(emptyTitle.status).toBe(400); // 400
  }); // 入参校验用例结束

  it('状态流转：pending → active → archived，归档为终态且同态 409', async () => { // 状态机
    const token = await login('13800000004'); // 取令牌
    const created = await request(app).post('/api/v1/sites/BLOG/items') // 新建管理条目
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-transition-create') // 幂等键
      .send({ capability: 'manage', title: '待审稿件' }); // 请求体
    const id = created.body.item.id as string; // 取条目主键
    const toActive = await request(app).post(`/api/v1/sites/BLOG/items/${id}/transition`) // 推进到 active
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-transition-1') // 幂等键
      .send({ status: 'active' }); // 目标状态
    expect(toActive.status).toBe(200); // 200
    expect(toActive.body.item.status).toBe('active'); // 状态已更新
    const same = await request(app).post(`/api/v1/sites/BLOG/items/${id}/transition`) // 同态重复
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-transition-same') // 新键
      .send({ status: 'active' }); // 当前已是 active
    expect(same.status).toBe(409); // 409 冲突
    const toArchived = await request(app).post(`/api/v1/sites/BLOG/items/${id}/transition`) // 归档
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-transition-2') // 幂等键
      .send({ status: 'archived' }); // 目标状态
    expect(toArchived.status).toBe(200); // 200
    const revive = await request(app).post(`/api/v1/sites/BLOG/items/${id}/transition`) // 尝试复活
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-transition-3') // 幂等键
      .send({ status: 'active' }); // 目标状态
    expect(revive.status).toBe(409); // 归档终态拒绝
    expect(revive.body.code).toBe('CONFLICT'); // 统一错误码
  }); // 状态机用例结束

  it('跨模块引用条目返回 404，非法目标状态返回 400', async () => { // 作用域与校验
    const token = await login('13800000005'); // 取令牌
    const created = await request(app).post('/api/v1/sites/BLOG/items') // 在 BLOG 占位键下新建
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-scope-create') // 幂等键
      .send({ capability: 'manage', title: '作用域条目' }); // 请求体
    const id = created.body.item.id as string; // 取主键
    const cross = await request(app).post(`/api/v1/sites/news/items/${id}/transition`) // 用 news 路径操作 blog 条目
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-scope-cross') // 幂等键
      .send({ status: 'active' }); // 目标状态
    expect(cross.status).toBe(404); // 404，作用域隔离生效
    const badStatus = await request(app).post(`/api/v1/sites/BLOG/items/${id}/transition`) // 非法目标状态
      .set('Authorization', `Bearer ${token}`) // Bearer 令牌
      .set('Idempotency-Key', 'site-scope-bad') // 幂等键
      .send({ status: 'done' }); // manage 能力不含 done
    expect(badStatus.status).toBe(400); // 400
    expect(badStatus.body.details.allowed).toEqual(['pending', 'active', 'archived']); // 回显允许值
  }); // 作用域用例结束

  it('每个模块的演示数据都落在合法能力与该能力状态集合内', () => { // 种子数据自洽
    const rows = db.prepare('SELECT host, capability, status FROM site_module_items WHERE created_by = ?').all('system') as Array<{ host: string; capability: string; status: string }>; // 取全部演示行
    expect(rows.length).toBe(88); // 44 模块 × 2 条
    for (const row of rows) { // 逐行校验
      const module = SITE_MODULES.find((m) => m.host === row.host); // 定位模块
      expect(module).toBeTruthy(); // 占位键必须已登记
      const cap = module!.capabilities.find((c) => c.code === row.capability); // 定位能力
      expect(cap).toBeTruthy(); // 能力必须存在
      expect(cap!.states).toContain(row.status); // 状态必须合法
    } // 校验循环结束
  }); // 种子自洽用例结束
}); // 写路径分组结束
