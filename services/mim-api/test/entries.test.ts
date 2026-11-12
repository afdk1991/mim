/** 契约测试：统一入口配置清单（44 个去重入口 / 19 个业务域 / 可配置占位标识） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排：每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 仅类型导入，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，保证中间件挂载顺序与生产一致
import { createDatabase } from '../src/db.js'; // 内存库工厂，启动即写入 44 入口演示数据
import { SITE_DOMAINS, SITE_MODULES } from '@mim/core-domain'; // 共享清单，作为断言基准

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄

beforeEach(() => { // 每例前置：重建内存库与应用
  db = createDatabase(':memory:'); // 内存库全新创建，入口演示数据自动种入
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 不启用管理面，保持最小依赖
}); // beforeEach 结束

describe('统一入口配置清单：规模与去重整理', () => { // 清单总览与整理口径
  it('overview 返回 44 入口 / 19 业务域 / 116 关联 / 46 占位标识与落地四态计数，且全部未配置', async () => {
    const res = await request(app).get('/api/v1/entries/overview'); // 公开只读
    expect(res.status).toBe(200); // 200
    expect(res.body.schema).toBe('mim.site-modules.v2'); // v2 契约
    expect(res.body.entries).toBe(44); // 去重后业务入口
    expect(res.body.domains).toBe(19); // 19 组业务用途
    expect(res.body.capabilities).toBe(132); // 运行时功能点
    expect(res.body.relations).toBe(116); // 相似模块关联条数
    expect(res.body.placeholders).toBe(46); // 44 入口 + @ 根域名 + 空白占位
    expect(res.body.configured).toBe(0); // 未提供具体主机值
    expect(res.body.unconfigured).toBe(44); // 全部仍为占位状态
    // 落地状态四态计数：已落地 5 / 部分相邻 18 / 规划中 19 / 语义冲突 2
    expect(res.body.implementation).toEqual({ implemented: 5, partial: 18, planned: 19, conflict: 2 }); // 断言：校验接口响应或状态符合冻结契约
  }); // overview 用例结束

  it('去重口径：88 行业务备注合并 44 项，@ 两行与 11 行空白各合并为 1 项', async () => {
    const res = await request(app).get('/api/v1/entries/overview'); // 公开只读
    expect(res.status).toBe(200); // 200
    const d = res.body.dedupe; // 整理结果
    expect(d.rule).toContain('完全相同且用途一致'); // 合并规则原文
    expect(d.businessNoteRows).toBe(88); // 原始业务备注行
    expect(d.duplicatePairs).toBe(44); // 每类重复两行
    expect(d.mergedEntries).toBe(44); // 合并后入口数
    expect(d.atRecordRows).toEqual([2, 3]); // @ 两行
    expect(d.atRecordMergedInto).toBe('AT_ROOT'); // @ 合并占位键
    expect(d.blankNoteRows).toBe(11); // 其余空白行
    expect(d.blankMergedInto).toBe('BLANK_UNSET'); // 空白合并占位键
    expect(res.body.atRecord.hostValue).toBeNull(); // @ 占位不补写具体值
    expect(res.body.blankRecord.hostValue).toBeNull(); // 空白占位不补写具体值
  }); // 去重用例结束

  it('hostConfig 明确禁止补写具体主机值，缺省值恒为 null', async () => {
    const res = await request(app).get('/api/v1/entries/overview'); // 公开只读
    expect(res.body.hostConfig.mode).toBe('placeholder'); // 占位模式
    expect(res.body.hostConfig.defaultValue).toBeNull(); // 无具体值
    expect(res.body.hostConfig.rule).toContain('不补写'); // 规则声明
    expect(res.body.hostConfig.format).toBe('{{HOST:<ENTRY_KEY>}}'); // 占位格式
  }); // 配置策略用例结束
}); // 规模与整理分组结束

describe('统一入口配置清单：业务域与职责', () => { // 19 域覆盖与职责元数据
  it('domains 返回 19 个业务域，入口数合计 44 且编码唯一', async () => {
    const res = await request(app).get('/api/v1/entries/domains'); // 公开只读
    expect(res.status).toBe(200); // 200
    expect(res.body.total).toBe(19); // 19 组业务用途
    const codes = res.body.domains.map((d: { code: string }) => d.code); // 编码清单
    expect(new Set(codes).size).toBe(19); // 编码不重复
    const sum = res.body.domains.reduce((n: number, d: { count: number }) => n + d.count, 0); // 入口数合计
    expect(sum).toBe(44); // 完整覆盖，不遗漏
    for (const d of res.body.domains) { // 逐域核对
      expect(d.name).toBeTruthy(); // 业务域名
      expect(d.description).toBeTruthy(); // 覆盖说明
      expect(d.entryKeys.length).toBe(d.count); // 占位键数量与入口数一致
    } // 逐域循环结束
  }); // domains 用例结束

  it('GET /entries 返回 44 项，每项备注逐字一致且职责/后台/接口/关联/落地映射齐备', async () => {
    const res = await request(app).get('/api/v1/entries'); // 公开只读
    expect(res.status).toBe(200); // 200
    expect(res.body.total).toBe(44); // 全量
    for (const module of SITE_MODULES) { // 逐条比对
      const row = res.body.entries.find((e: { entryKey: string }) => e.entryKey === module.entryKey); // 按占位键定位
      expect(row).toBeTruthy(); // 不得缺项
      expect(row.note).toBe(module.note); // 备注原文逐字一致
      expect(row.placeholder).toBe(`{{HOST:${module.entryKey}}}`); // 占位标识格式
      expect(row.configured).toBe(false); // 未补写具体值
      expect(row.envKey).toBe(`MIM_HOST_${module.entryKey}`); // 注入键格式
      expect(row.domain).toBe(module.domain); // 业务域
      expect(row.coreFunctions.length).toBeGreaterThanOrEqual(3); // 核心功能
      expect(row.responsibility.inScope.length).toBeGreaterThan(0); // 负责范围
      expect(row.responsibility.outOfScope.length).toBeGreaterThan(0); // 排除范围
      expect(row.adminRole).toBeTruthy(); // 后台管理职责
      expect(row.apiRole).toBeTruthy(); // 接口职责
      expect(row.related.length).toBeGreaterThan(0); // 相似模块关联与区分
      // 落地映射：状态合法、边界说明非空
      expect(['implemented', 'partial', 'planned', 'conflict']).toContain(row.implementation.status); // 断言：校验接口响应或状态符合冻结契约
      expect(row.implementation.boundary).toBeTruthy(); // 断言：校验接口响应或状态符合冻结契约
    } // 比对循环结束
  }); // 清单逐项用例结束

  it('q 与 domain 过滤生效，且相似模块关联指向真实存在的入口', async () => {
    const byNote = await request(app).get('/api/v1/entries?q=' + encodeURIComponent('官方博客系统')); // 按系统名搜索
    expect(byNote.body.total).toBe(1); // 命中唯一一条
    expect(byNote.body.entries[0].entryKey).toBe('BLOG'); // 博客入口
    const byDomain = await request(app).get('/api/v1/entries?domain=commerce'); // 电商与商贸域
    expect(byDomain.body.total).toBe(9); // 9 个商贸入口
    const byDuty = await request(app).get('/api/v1/entries?q=' + encodeURIComponent('对账')); // 按职责字段搜索
    expect(byDuty.body.total).toBeGreaterThan(0); // 职责字段可被检索
    const keys = new Set(SITE_MODULES.map((m) => m.entryKey)); // 全部合法占位键
    for (const module of SITE_MODULES) { // 逐条校验关联
      for (const r of module.related) { // 逐关联
        expect(keys.has(r.entryKey)).toBe(true); // 关联目标必须存在
        expect(r.distinction).toBeTruthy(); // 必须有区分说明
      } // 关联循环结束
    } // 入口循环结束
  }); // 过滤与关联用例结束

  it('单入口详情返回关联解析结果与运行时能力点；未登记占位键 404', async () => {
    const res = await request(app).get('/api/v1/entries/BLOG'); // 公开详情
    expect(res.status).toBe(200); // 200
    expect(res.body.entry.entryKey).toBe('BLOG'); // 占位键
    expect(res.body.entry.related.length).toBeGreaterThan(0); // 关联清单
    for (const r of res.body.entry.related) { // 逐关联解析
      expect(r.system).toBeTruthy(); // 关联入口业务系统说明
      expect(r.domainName).toBeTruthy(); // 关联入口业务域
      expect(r.distinction).toBeTruthy(); // 区分说明
    } // 关联解析循环结束
    expect(res.body.capabilities.length).toBe(3); // 运行时能力点
    const missing = await request(app).get('/api/v1/entries/NOT_AN_ENTRY'); // 未登记占位键
    expect(missing.status).toBe(404); // 404
    expect(missing.body.code).toBe('NOT_FOUND'); // 统一错误码
  }); // 详情用例结束
}); // 业务域与职责分组结束

describe('统一入口配置清单：可配置占位标识', () => { // 占位配置与模板
  it('placeholders 返回 46 项，44 个业务入口 + @ 根域名 + 空白占位', async () => {
    const res = await request(app).get('/api/v1/entries/placeholders'); // 公开只读
    expect(res.status).toBe(200); // 200
    expect(res.body.total).toBe(46); // 占位标识总数
    expect(res.body.configured).toBe(0); // 默认全部未配置
    expect(res.body.items.filter((i: { kind: string }) => i.kind === 'entry').length).toBe(44); // 业务入口
    expect(res.body.items.filter((i: { kind: string }) => i.kind === 'placeholder').length).toBe(2); // 两个非模块占位
    expect(res.body.items.find((i: { entryKey: string }) => i.entryKey === 'AT_ROOT')).toBeTruthy(); // @ 合并项
    expect(res.body.items.find((i: { entryKey: string }) => i.entryKey === 'BLANK_UNSET')).toBeTruthy(); // 空白合并项
  }); // 占位清单用例结束

  it('config 模板 44 个键全部空值，不含任何具体主机值', async () => {
    const res = await request(app).get('/api/v1/entries/config'); // 公开只读
    expect(res.status).toBe(200); // 200
    expect(res.body.schema).toBe('mim.entry-hosts.v1'); // 模板版本
    const hosts = res.body.hosts; // 模板键值
    expect(Object.keys(hosts).length).toBe(44); // 44 个注入键
    for (const [key, value] of Object.entries(hosts)) { // 逐键校验
      expect(key.startsWith('MIM_HOST_')).toBe(true); // 前缀一致
      expect(value).toBe(''); // 值恒为空，不补写具体主机值
    } // 逐键循环结束
    expect(JSON.stringify(hosts)).not.toContain('.mixm.top'); // 不得出现真实域名
  }); // 配置模板用例结束

  it('运行时数据隔离键已迁移为占位键，旧短主机值不再被使用', async () => {
    const rows = db.prepare('SELECT DISTINCT host FROM site_module_items').all() as Array<{ host: string }>; // 库内隔离键
    const keys = new Set(SITE_MODULES.map((m) => m.entryKey)); // 合法占位键
    for (const row of rows) expect(keys.has(row.host)).toBe(true); // 全部为占位键
    expect(rows.length).toBe(44); // 44 个入口各 2 条演示数据
    const res = await request(app).get('/api/v1/sites/BLOG/items'); // 按占位键读取条目
    expect(res.status).toBe(200); // 200
    expect(res.body.total).toBe(2); // 两条演示数据
    const legacy = await request(app).get('/api/v1/sites/blog'); // 旧具体主机值不再可寻址
    expect(legacy.status).toBe(404); // 404
  }); // 隔离键迁移用例结束
}); // 占位配置分组结束

describe('统一入口配置清单：只读边界', () => { // 清单端点不接受写操作
  it('清单端点全部只读，写操作返回 404，不产生副作用', async () => {
    const post = await request(app).post('/api/v1/entries').send({ entryKey: 'X' }); // 尝试写入清单
    expect(post.status).toBe(404); // 无写路由
    const put = await request(app).put('/api/v1/entries/config').send({ hosts: {} }); // 尝试覆盖模板
    expect(put.status).toBe(404); // 无写路由
    const after = await request(app).get('/api/v1/entries/overview'); // 复查清单
    expect(after.body.entries).toBe(44); // 规模未变
  }); // 只读边界用例结束
}); // 只读边界分组结束

// 保证 SITE_DOMAINS 被真实消费，避免只导入不校验造成假绿。
it('共享业务域清单与 API 返回一致', async () => { // 共享包一致性
  const res = await request(app).get('/api/v1/entries/domains'); // 公开只读
  expect(res.body.domains.map((d: { code: string }) => d.code)).toEqual(SITE_DOMAINS.map((d) => d.code)); // 顺序与编码一致
}); // 共享一致性用例结束
