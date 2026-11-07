/** 契约测试：站点地图 45 个「可运行节点」的路由 / 导航 / 职责 / 域名映射完整性 */

// vitest 测试框架：describe / expect / it
import { describe, expect, it } from 'vitest'; // 仅用同步断言与 HTTP 请求
// supertest：对 Express app 发起真实 HTTP 请求（不监听端口）
import request from 'supertest'; // 复用既有契约测试的请求方式
// Express：只挂载 site 路由，绕开 app.ts 的编排器依赖（并行会话 WIP 不影响本测试）
import express from 'express'; // 构造最小应用
// 被测对象：site 域路由工厂
import { createSiteRouter } from '../src/routes/site.js'; // 含新增的 /site/nodes
// 站点静态真源：45 个模块与分类定义
import { SITE_MODULES, SITE_CATEGORIES } from '../src/site.js'; // 用于交叉核对
// 节点规格表（由 site.ts 构造并断言）
import { SITE_NODE_SPECS } from '../src/site.js'; // 45 条规格真源
// 节点规格工厂、能力清单与路由键工具
import { buildAndValidateNodeSpecs, NODE_CAPABILITIES, routeKeyOf } from '../src/site-nodes.js'; // 校验 '@' → root 的冲突处理

// 构造只含 site 路由的最小 Express 应用
const app = express(); // 不引入鉴权 / 数据库 / 编排器
app.use('/api/v1', createSiteRouter()); // 与生产 app.ts 的挂载前缀一致

// 站点节点契约集合
describe('站点地图可运行节点（45 个）', () => {
  // 用例 1：目录接口的结构与全量计数
  it('/site/nodes 返回 45 节点、8 分类，分类计数合计 45', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 发起目录请求
    expect(res.status).toBe(200); // 成功响应
    expect(res.body.total).toBe(45); // 节点总数
    expect(res.body.items).toHaveLength(45); // 逐节点可枚举
    expect(res.body.categories).toHaveLength(8); // 8 个分类
    const sum = res.body.categories.reduce((a: number, c: { count: number }) => a + c.count, 0); // 分类计数求和
    expect(sum).toBe(45); // 与总数一致
  }); // 用例 1 结束

  // 用例 2：分类分布与 PRD FR-03 的 6/2/8/5/7/7/4/6 一致
  it('8 个分类的节点数符合站点地图定义', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 取目录
    const counts = Object.fromEntries(res.body.categories.map((c: { id: string; count: number }) => [c.id, c.count])); // id → count
    expect(counts).toEqual({ portal: 6, identity: 2, ops: 8, api: 5, content: 7, commerce: 7, data: 4, tools: 6 }); // 逐分类核对
  }); // 用例 2 结束

  // 用例 3：每个节点都有完整可运行规格
  it('每个节点都含 route / key / kind / 双语 nav 与 duty', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 取目录
    for (const item of res.body.items) { // 逐节点检查
      expect(item.node.host).toBe(item.host); // 规格与 DNSPod 主机一致
      expect(item.node.key).toBeTruthy(); // 路由键非空
      expect(item.node.route).toBe(`#/site/${item.node.key}`); // 路由格式统一
      expect(item.node.kind).toBeTruthy(); // 职责类型非空
      expect(item.node.nav.zh).toBeTruthy(); // 中文导航名
      expect(item.node.nav.en).toBeTruthy(); // 英文导航名
      expect(item.node.duty.zh).toBeTruthy(); // 中文职责
      expect(item.node.duty.en).toBeTruthy(); // 英文职责
      expect(Array.isArray(item.node.links)).toBe(true); // 关联节点数组
    } // 遍历结束
  }); // 用例 3 结束

  // 用例 4：域名映射规则（含 '@' 根记录与 gy 的 CNAME）
  it('fqdn 映射与记录类型正确，且根域名「@」的路由键为 root', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 取目录
    for (const item of res.body.items) { // 逐节点核对域名
      const expected = item.host === '@' ? 'mixm.top' : `${item.host}.mixm.top`; // 与 fqdnOf 一致
      expect(item.fqdn).toBe(expected); // 域名映射
      expect(item.urls[0]).toBe(`https://${expected}`); // HTTPS 入口
      expect(item.records[0].zone).toBe('mixm.top'); // 单 zone
      expect(item.records[0].record_value).toBeUndefined(); // 不暴露解析目标值
    } // 遍历结束
    const apex = res.body.items.find((i: { host: string }) => i.host === '@'); // 根记录
    expect(apex.node.key).toBe('root'); // 冲突映射：'@' → root
    expect(apex.node.route).toBe('#/site/root'); // 可直接在 hash 中使用
    const gy = res.body.items.find((i: { host: string }) => i.host === 'gy'); // CNAME 节点
    expect(gy.records[0].record_type).toBe('CNAME'); // 疾风引擎边缘节点
  }); // 用例 4 结束

  // 用例 5：路由键唯一、关联节点不悬空
  it('45 个路由键互不冲突，所有关联节点都指向真实节点', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 取目录
    const keys: string[] = res.body.items.map((i: { node: { key: string } }) => i.node.key); // 全部路由键
    expect(new Set(keys).size).toBe(45); // 无重复
    const hosts = new Set(res.body.items.map((i: { host: string }) => i.host)); // 合法 host 集合
    for (const item of res.body.items) { // 逐节点检查关联
      for (const link of item.node.links) { // 遍历关联 host
        expect(hosts.has(link)).toBe(true); // 必须存在
        expect(link).not.toBe(item.host); // 不自引用
      } // 关联遍历结束
    } // 节点遍历结束
  }); // 用例 5 结束

  // 用例 6：能力清单覆盖所有出现的职责类型
  it('每个职责类型都有可渲染的能力清单', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 取目录
    const kinds = new Set<string>(res.body.items.map((i: { node: { kind: string } }) => i.node.kind)); // 实际出现的类型
    expect(kinds.size).toBe(8); // 8 类职责全覆盖
    for (const kind of kinds) { // 逐类型检查
      expect(NODE_CAPABILITIES[kind as keyof typeof NODE_CAPABILITIES].length).toBeGreaterThan(0); // 有能力条目
    } // 遍历结束
    expect(res.body.capabilities).toEqual(NODE_CAPABILITIES); // 接口返回同一份清单
  }); // 用例 6 结束

  // 用例 7：既有 3 条 /site/* 接口也带上 node 规格（前后端类型一致）
  it('/site/modules 与单模块详情同样返回节点规格', async () => {
    const list = await request(app).get('/api/v1/site/modules'); // 列表
    expect(list.status).toBe(200); // 成功
    expect(list.body.items[0].node.route).toMatch(/^#\/site\//); // 列表含路由
    const one = await request(app).get('/api/v1/site/modules/www'); // 单模块
    expect(one.status).toBe(200); // 成功
    expect(one.body.module.node.key).toBe('www'); // 单模块含规格
    expect(one.body.module.fqdn).toBe('www.mixm.top'); // 单模块含域名映射
  }); // 用例 7 结束

  // 用例 8：完整性断言本身能拦截缺节点 / 重复路由 / 悬空关联
  it('规格表完整性断言对缺失节点与悬空关联直接抛错', () => {
    const hosts = SITE_MODULES.map((m) => m.host); // 45 个真实 host
    const categoryOf = (h: string) => SITE_MODULES.find((m) => m.host === h)!.category; // 回查分类
    expect(() => buildAndValidateNodeSpecs(hosts.slice(1), categoryOf)).toThrow(/missing/); // 缺一个节点即失败
    expect(() => buildAndValidateNodeSpecs([...hosts, 'ghost'], categoryOf)).toThrow(/extra/); // 多一个节点即失败
    expect(Object.keys(SITE_NODE_SPECS)).toHaveLength(45); // 规格表规模
    expect(routeKeyOf('@')).toBe('root'); // 冲突映射工具
    expect(SITE_CATEGORIES).toHaveLength(8); // 分类真源规模
  }); // 用例 8 结束

  // 用例 9：每个节点都带站点地图原始备注与逐条记录，保证「下属条目」零遗漏
  it('45 个节点均含备注两段、解析记录明细与一一对应的 HTTPS 入口', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 取目录
    for (const item of res.body.items) { // 逐节点核对
      expect(item.label).toBeTruthy(); // 备注第一段：模块定位
      expect(item.description).toBeTruthy(); // 备注第二段：站点说明
      expect(item.records.length).toBeGreaterThan(0); // 至少一条解析记录
      expect(item.urls).toHaveLength(item.records.length); // 入口与记录一一对应
      for (const rec of item.records) { // 逐条记录核对
        expect(rec.fqdn).toBeTruthy(); // 完整域名非空
        expect(rec.record_type).toMatch(/^(A|CNAME)$/); // 记录类型只能是 A / CNAME
        expect(rec.ttl).toBeGreaterThan(0); // TTL 为正数
        expect(rec.record_value).toBeUndefined(); // 解析目标不对外暴露
      } // 记录遍历结束
    } // 节点遍历结束
  }); // 用例 9 结束

  // 用例 10：冲突与覆盖映射（'@' → root、gy 的 CNAME 与 record 级备注）在目录中可见
  it('根域名与 gy 的冲突 / 覆盖映射在目录接口中可见', async () => {
    const res = await request(app).get('/api/v1/site/nodes'); // 取目录
    const apex = res.body.items.find((i: { host: string }) => i.host === '@'); // 根记录
    expect(apex.node.route).toBe('#/site/root'); // '@' 不能直接进 hash，映射为 root
    expect(apex.fqdn).toBe('mixm.top'); // 根域名即 zone 本身
    const gy = res.body.items.find((i: { host: string }) => i.host === 'gy'); // CNAME 节点
    expect(gy.records[0].record_type).toBe('CNAME'); // 疾风引擎边缘节点
    expect(gy.records[0].label).toContain('疾风引擎'); // record 级备注保留 zone 口径
    expect(gy.label).toBeTruthy(); // 模块级备注未被 record 级覆盖污染
  }); // 用例 10 结束

  // 用例 11：目录接口与既有列表接口同源，避免两份 45 节点清单漂移
  it('/site/nodes 与 /site/modules 的 45 个 host / fqdn / route 完全一致', async () => {
    const nodes = await request(app).get('/api/v1/site/nodes'); // 目录接口
    const modules = await request(app).get('/api/v1/site/modules'); // 列表接口
    const shape = (i: { host: string; fqdn: string; node: { route: string } }) => // 比较函数入参显式标注，避免隐式 any
      `${i.host}|${i.fqdn}|${i.node.route}`; // 统一比较口径，三字段拼成指纹
    expect(nodes.body.items.map(shape)).toEqual(modules.body.items.map(shape)); // 顺序与内容逐行一致
  }); // 用例 11 结束
}); // 契约集合结束
