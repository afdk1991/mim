/** 契约测试：分类导航树与目录筛选 —— /taxonomy 结构、/modules 的 category/sort/licenses/languages/page 语义（铁律十一：逐行中文注释） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排 API，每例重建内存库保证互不污染
import request from 'supertest'; // supertest 进程内驱动 Express，无需占用真实端口
import type { Express } from 'express'; // 仅引入类型，用于标注应用实例
import { createApp } from '../src/app.js'; // 唯一装配入口，走它才能保证路由挂载顺序与线上一致
import { createDatabase } from '../src/db.js'; // 内存库工厂：建库即执行 schema + 全部种子
import { CATALOG_GROUP_TOTAL, CATALOG_ITEM_TOTAL } from '@mim/core-domain'; // 分类总量基准，取自唯一权威数据源

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足构建期强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄

beforeEach(() => { // 每个用例独立建库，避免种子与用例写入相互影响
  db = createDatabase(':memory:'); // 内存库：建库时自动补齐 schema、补列迁移与全部种子
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 公开面无需管理令牌，env 留空即可
}); // 结束 beforeEach

describe('GET /taxonomy 分类导航树', () => { // 一级分组 + 二级条目 + 模块计数
  it('返回 19 个一级分类与全量二级条目，且计数与模块表一致', async () => { // 结构与口径同时校验
    const res = await request(app).get('/api/v1/taxonomy'); // 公开接口，不带任何令牌
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.groups.length).toBe(CATALOG_GROUP_TOTAL); // 一级分类数量与 core-domain 常量一致（19）
    expect(res.body.total_items).toBe(CATALOG_ITEM_TOTAL); // 二级条目总量与 core-domain 常量一致（205）
    const store = res.body.groups.find((group: { slug: string }) => group.slug === 'store'); // 取「建站系统」分组做定点校验
    expect(store.name).toBe('建站系统'); // 断言分组中文名与用户清单一致
    expect(store.name_en).toBe('Site builders'); // 断言分组英文名已翻译（不再用中文占位）
    expect(store.items[0].name_en).toBe('CMS site builders'); // 断言二级条目英文名与清单首条对齐
    expect(store.items.length).toBe(9); // 该组二级条目实数为 9（CMS/新零售/BBS/博客/问卷/SNS/学校/相册/RSS）
    const sum = res.body.groups.reduce((acc: number, group: { count: number }) => acc + group.count, 0); // 汇总各组模块数
    expect(res.body.total_modules).toBe(sum); // 断言顶层总计数等于各组之和
    expect(res.body.total_modules).toBeGreaterThanOrEqual(CATALOG_ITEM_TOTAL); // 每个二级条目至少一个模块
  }); // 结束结构校验用例

  it('全量二级条目与一级分类都带英文名，且与中文名逐项同序', async () => { // 英文名完整性契约
    const res = await request(app).get('/api/v1/taxonomy'); // 公开接口
    const groups: Array<{ name: string; name_en: string | null; items: Array<{ name: string; name_en: string | null }> }> = res.body.groups; // 结构标注
    expect(groups.every((group) => typeof group.name_en === 'string' && (group.name_en as string).length > 0)).toBe(true); // 一级分类英文名齐全
    const allItems = groups.flatMap((group) => group.items); // 展平全部二级条目
    expect(allItems.length).toBe(CATALOG_ITEM_TOTAL); // 条数仍是 205
    expect(allItems.every((item) => typeof item.name_en === 'string' && (item.name_en as string).length > 0)).toBe(true); // 二级条目英文名齐全
    const openharmony = groups.find((group) => group.name === 'OpenHarmony'); // OpenHarmony 组：中文清单英文在括号内，英文名不应带括号残留
    expect(openharmony?.items[0].name_en).toBe('Button'); // 首条「按钮(Button)」→ Button
    expect(openharmony?.items[36].name_en).toBe('Gesture control'); // 末条「手势控制(Gesture)」→ Gesture control（顺带守住顺序不错位）
  }); // 结束英文名契约用例
}); // 代码块结束

describe('模块英文名（双区）', () => { // 双区模块名走真实英文名
  it('en-US 名称取自英文清单，zh-CN 仍保留中文', async () => { // 两区名称分别校验
    const cn = await request(app).get('/api/v1/modules?category=store-01'); // 默认 cn 区
    const global = await request(app).get('/api/v1/modules?category=store-01').set('x-region', 'global'); // 显式切 global 区
    expect(cn.body.modules[0].name['zh-CN']).toBe('CMS建站系统'); // cn 区中文名来自清单原文
    expect(cn.body.modules[0].name['en-US']).toBe('CMS site builders'); // cn 区英文名也已是真实翻译
    expect(global.body.modules[0].name['en-US']).toBe('CMS site builders'); // global 区英文名一致
    expect(global.body.modules[0].name['zh-CN']).toBe('CMS建站系统'); // global 区仍保留中文，便于内部对账
  }); // 结束双区名称用例
}); // 结束模块英文名分组

describe('GET /modules 分类与筛选', () => { // 分类过滤、排序、多选与分页
  it('category 精确命中二级分类，且返回体带分类/许可/语言/Stars 字段', async () => { // 二级过滤
    const res = await request(app).get('/api/v1/modules?category=store-03'); // 建站系统第 3 条（BBS论坛/问答）
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.total).toBe(1); // 每条二级条目恰好一个模块
    const [module] = res.body.modules; // 取唯一结果
    expect(module.code).toBe('cat.store-03'); // 模块编码等于分类条目编码
    expect(module.category_slug).toBe('store-03'); // 分类字段回显二级 slug
    expect(module.license).toBe('GPL-3.0'); // 建站系统组默认许可
    expect(module.language).toBe('PHP'); // 建站系统组默认语言
    expect(typeof module.stars).toBe('number'); // Stars 为数值，前端可直接渲染
  }); // 结束二级精确过滤用例

  it('category 传一级 slug 时按前缀归属整组', async () => { // 一级过滤
    const res = await request(app).get('/api/v1/modules?category=store&pageSize=100'); // 取整组，放大每页条数以覆盖 9 条
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.total).toBe(9); // 建站系统组共 9 条
    expect(res.body.modules.every((m: { category_slug: string }) => m.category_slug.startsWith('store-'))).toBe(true); // 全部归属 store 前缀
  }); // 结束一级前缀过滤用例

  it('category=all 等价于不过滤，total 与不带参数一致', async () => { // 兼容「全部推荐项目」入口
    const withAll = await request(app).get('/api/v1/modules?category=all'); // 带 all 参数
    const without = await request(app).get('/api/v1/modules'); // 不带分类参数
    expect(withAll.status).toBe(200); // 断言 200
    expect(withAll.body.total).toBe(without.body.total); // 两种口径总数一致
  }); // 结束 all 兼容用例

  it('sort=stars 按 Stars 降序，非法 sort 直接 400', async () => { // 排序三档之一 + 校验分支
    const res = await request(app).get('/api/v1/modules?sort=stars&pageSize=100'); // 首页 100 条足够观察趋势
    expect(res.status).toBe(200); // 断言 200
    const stars = res.body.modules.map((m: { stars: number }) => m.stars); // 抽取 Stars 序列
    const sorted = [...stars].sort((a, b) => b - a); // 期望的降序序列
    expect(stars).toEqual(sorted); // 断言实际顺序等于降序
    const bad = await request(app).get('/api/v1/modules?sort=hot'); // 不在枚举内的排序值
    expect(bad.status).toBe(400); // 断言 400
    expect(bad.body.code).toBe('VALIDATION_FAILED'); // 断言错误码，避免静默回退
  }); // 结束排序用例

  it('licenses / languages 多选按并集过滤', async () => { // 许可与语言筛选
    const licenses = await request(app).get('/api/v1/modules?licenses=MIT,Apache-2.0&pageSize=100'); // 两项许可并集
    expect(licenses.status).toBe(200); // 断言 200
    expect(licenses.body.modules.every((m: { license: string }) => ['MIT', 'Apache-2.0'].includes(m.license))).toBe(true); // 断言许可在集合内
    const languages = await request(app).get('/api/v1/modules?languages=PHP&category=store'); // 语言与分类叠加
    expect(languages.status).toBe(200); // 断言 200
    expect(languages.body.modules.every((m: { language: string }) => m.language === 'PHP')).toBe(true); // 断言语言一致
    expect(languages.body.total).toBe(9); // 建站系统组默认语言即 PHP，仍是 9 条
  }); // 结束多选过滤用例

  it('page / pageSize 分页元信息自洽，越界页返回空列表但 total 不变', async () => { // 分页契约
    const res = await request(app).get('/api/v1/modules?page=2&pageSize=5'); // 固定每页 5 条取第 2 页
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.page).toBe(2); // 回显页码
    expect(res.body.page_size).toBe(5); // 回显每页条数
    expect(res.body.modules.length).toBe(5); // 第 2 页仍是满页
    expect(res.body.total_pages).toBe(Math.max(1, Math.ceil(res.body.total / 5))); // 总页数由 total 推出
    const beyond = await request(app).get('/api/v1/modules?page=99&pageSize=5'); // 远超实际页数
    expect(beyond.status).toBe(200); // 断言 200，越界不报错
    expect(beyond.body.modules.length).toBe(0); // 越界页为空列表
    expect(beyond.body.total).toBe(res.body.total); // total 与页码无关
  }); // 结束分页用例

  it('搜索词仍可叠加分类过滤，命中数为 1 与 0 两种边界', async () => { // 回归既有 q 语义
    const hit = await request(app).get('/api/v1/modules?q=cat.store-05&category=store'); // 编码 + 分类同时命中
    expect(hit.status).toBe(200); // 断言 200
    expect(hit.body.total).toBe(1); // 只应命中一条
    const miss = await request(app).get('/api/v1/modules?q=cat.store-05&category=web'); // 编码命中但分类不匹配
    expect(miss.status).toBe(200); // 断言 200
    expect(miss.body.total).toBe(0); // 应无命中
  }); // 结束搜索叠加用例
}); // 代码块结束

describe('GET /modules/hot 热门项目', () => { // 右侧「热门项目」卡片的数据契约
  it('默认今日窗口，返回条数受 limit 约束且热度降序', async () => { // 结构与排序同时校验
    const res = await request(app).get('/api/v1/modules/hot'); // 不带参数：range=today、limit=5
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.range).toBe('today'); // 默认档位为今日
    expect(res.body.window_hours).toBe(24); // 今日窗口 24 小时
    expect(res.body.items.length).toBeLessThanOrEqual(5); // 默认最多 5 条
    const scores = res.body.items.map((item: { hotness: number }) => item.hotness); // 抽取热度序列
    expect(scores).toEqual([...scores].sort((a, b) => b - a)); // 断言热度降序
  }); // 结束默认档位用例

  it('range=week 窗口 168 小时；非法 range 返回 400', async () => { // 档位切换与校验分支
    const week = await request(app).get('/api/v1/modules/hot?range=week'); // 本周档位
    expect(week.status).toBe(200); // 断言 200
    expect(week.body.range).toBe('week'); // 回显本周
    expect(week.body.window_hours).toBe(168); // 本周 168 小时
    const bad = await request(app).get('/api/v1/modules/hot?range=month'); // 非法档位
    expect(bad.status).toBe(400); // 断言 400
    expect(bad.body.code).toBe('VALIDATION_FAILED'); // 断言错误码
  }); // 结束档位用例

  it('跟随 category 收敛到当前分类，limit 上限 20', async () => { // 与左侧分类树联动
    const res = await request(app).get('/api/v1/modules/hot?category=store&limit=20'); // 建站系统组
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.category).toBe('store'); // 回显分类
    expect(res.body.total).toBe(9); // 该组可参与排序的模块实数为 9
    expect(res.body.items.length).toBeLessThanOrEqual(9); // 不超过该组总数
    expect(res.body.items.every((item: { category_slug: string }) => item.category_slug.startsWith('store-'))).toBe(true); // 全部归属该组
    const capped = await request(app).get('/api/v1/modules/hot?limit=999'); // 超过上限
    expect(capped.body.items.length).toBeLessThanOrEqual(20); // 上限被夹到 20
  }); // 结束分类联动用例
}); // 代码块结束

describe('管理端分类树 CRUD（/categories）', () => { // 一级 / 二级分类的后台增删改查
  const ADMIN_TOKEN = 'test-admin-token-0123456789'; // 引导令牌：命中 MIM_ADMIN_TOKEN 即视为全权限
  let adminApp: Express; // 已开启管理面的独立实例

  beforeEach(() => { // 本组专用前置：在共享 db 之上再建一个带管理令牌的应用
    adminApp = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // env 注入令牌才开启管理面
  }); // 结束本组 beforeEach

  it('未带令牌 → 401；带令牌可读到 19 组 / 205 条与模块计数', async () => { // 鉴权 + 读视图结构
    const denied = await request(adminApp).get('/api/v1/categories/manage'); // 不带任何凭据
    expect(denied.status).toBe(401); // 断言 401，未开启 Bearer 通道
    const ok = await request(adminApp).get('/api/v1/categories/manage').set('x-admin-token', ADMIN_TOKEN); // 带引导令牌
    expect(ok.status).toBe(200); // 断言 200
    expect(ok.body.groups.length).toBe(CATALOG_GROUP_TOTAL); // 一级分类 19 组
    expect(ok.body.total_items).toBe(CATALOG_ITEM_TOTAL); // 二级条目 205 条
    const store = ok.body.groups.find((group: { slug: string }) => group.slug === 'store'); // 取建站系统定点校验
    expect(store.items.length).toBe(9); // 该组 9 条二级
    expect(store.module_count).toBe(9); // 组内模块数汇总（每条约 1 个 active 模块）
    expect(store.items[0].module_count).toBe(1); // 单条二级分类下的模块数
    expect(store.name_en).toBe('Site builders'); // 管理视图同样带英文名，便于英文站与后台共用一份数据
  }); // 结束鉴权与结构用例

  it('POST 建一级与二级；二级 slug 前缀不符或 slug 重复时拒绝', async () => { // 新建规则
    const group = await request(adminApp).post('/api/v1/categories').set('x-admin-token', ADMIN_TOKEN).send({ slug: 'sandbox', name: '沙箱分类', name_en: 'Sandbox' }); // 建一级分类
    expect(group.status).toBe(201); // 断言 201
    expect(group.body.category.level).toBe(1); // 层级为 1
    expect(group.body.category.parent_id).toBeNull(); // 一级无父键

    const child = await request(adminApp).post('/api/v1/categories').set('x-admin-token', ADMIN_TOKEN).send({ slug: 'sandbox-01', name: '沙箱子项', parent_slug: 'sandbox' }); // 建二级条目
    expect(child.status).toBe(201); // 断言 201
    expect(child.body.category.level).toBe(2); // 层级为 2
    expect(child.body.category.parent_id).toBe('cat:sandbox'); // 父键指回一级分类主键

    const badPrefix = await request(adminApp).post('/api/v1/categories').set('x-admin-token', ADMIN_TOKEN).send({ slug: 'other-01', name: '错前缀', parent_slug: 'sandbox' }); // 前缀不符
    expect(badPrefix.status).toBe(400); // 断言 400
    expect(badPrefix.body.code).toBe('VALIDATION_FAILED'); // 断言错误码

    const dup = await request(adminApp).post('/api/v1/categories').set('x-admin-token', ADMIN_TOKEN).send({ slug: 'sandbox', name: '重复' }); // slug 重复
    expect(dup.status).toBe(409); // 断言 409，不静默覆盖
    expect(dup.body.code).toBe('CONFLICT'); // 断言错误码

    const missingParent = await request(adminApp).post('/api/v1/categories').set('x-admin-token', ADMIN_TOKEN).send({ slug: 'nope-01', name: '父不存在', parent_slug: 'nope' }); // 父分类不存在
    expect(missingParent.status).toBe(404); // 断言 404
  }); // 结束新建用例

  it('PATCH 改名与英文名；不存在返回 404', async () => { // 编辑规则
    const res = await request(adminApp).patch('/api/v1/categories/store').set('x-admin-token', ADMIN_TOKEN).send({ name: '建站系统（改）', name_en: 'Site builders (edited)' }); // 改名
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.category.name).toBe('建站系统（改）'); // 中文名已更新
    expect(res.body.category.name_en).toBe('Site builders (edited)'); // 英文名已更新
    const tree = await request(adminApp).get('/api/v1/taxonomy'); // 公开树复核
    const store = tree.body.groups.find((group: { slug: string }) => group.slug === 'store'); // 取建站系统
    expect(store.name).toBe('建站系统（改）'); // 公开接口同步读到新名（改的是同一张表）
    const missing = await request(adminApp).patch('/api/v1/categories/not-exist').set('x-admin-token', ADMIN_TOKEN).send({ name: 'x' }); // 不存在的 slug
    expect(missing.status).toBe(404); // 断言 404
    const empty = await request(adminApp).patch('/api/v1/categories/store').set('x-admin-token', ADMIN_TOKEN).send({}); // 空请求体
    expect(empty.status).toBe(400); // 断言 400，至少改一项
  }); // 结束编辑用例

  it('DELETE 有子级或有模块引用时 409，删空分类成功', async () => { // 删除保护规则
    const hasChildren = await request(adminApp).delete('/api/v1/categories/store').set('x-admin-token', ADMIN_TOKEN); // 一级且有条目
    expect(hasChildren.status).toBe(409); // 断言 409
    expect(hasChildren.body.code).toBe('CONFLICT'); // 断言错误码
    const hasModules = await request(adminApp).delete('/api/v1/categories/store-01').set('x-admin-token', ADMIN_TOKEN); // 二级且有模块
    expect(hasModules.status).toBe(409); // 断言 409
    const created = await request(adminApp).post('/api/v1/categories').set('x-admin-token', ADMIN_TOKEN).send({ slug: 'trash', name: '待删分类' }); // 先建一个空分类
    expect(created.status).toBe(201); // 断言建成功
    const removed = await request(adminApp).delete('/api/v1/categories/trash').set('x-admin-token', ADMIN_TOKEN); // 再删它
    expect(removed.status).toBe(200); // 断言 200
    expect(removed.body.category.deleted).toBe(true); // 回执已删除
    const again = await request(adminApp).delete('/api/v1/categories/trash').set('x-admin-token', ADMIN_TOKEN); // 重复删除
    expect(again.status).toBe(404); // 物理删除后不存在即 404
  }); // 结束删除用例
}); // 结束管理端分类 CRUD 分组

describe('GET /modules/:code 详情与列表字段同源', () => { // 详情页与卡片徽标必须读到同一份字段
  it('二级分类模块详情带 category_slug/license/language/stars，且免费无前置', async () => { // 新增二级模块
    const res = await request(app).get('/api/v1/modules/cat.store-03'); // 建站系统第 3 条
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.category_slug).toBe('store-03'); // 分类字段与列表一致
    expect(res.body.license).toBe('GPL-3.0'); // 许可字段与列表一致
    expect(res.body.language).toBe('PHP'); // 语言字段与列表一致
    expect(typeof res.body.stars).toBe('number'); // Stars 为数值
    expect(res.body.requires).toEqual([]); // 二级模块默认无前置依赖
    expect(res.body.current_price).toBeNull(); // 二级模块当前全部免费
  }); // 结束二级模块详情用例

  it('存量付费模块详情保留依赖链与价格，分类已归类', async () => { // 保护付费/依赖逻辑不被改造破坏
    const res = await request(app).get('/api/v1/modules/comic.genpack.pro'); // 存量「专业版」生成包
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.requires).toEqual(['comic.genpack.basic']); // 依赖链保持原样
    expect(res.body.current_price.amount_minor).toBe(29900); // 价格保持 ¥299.00
    expect(res.body.category_slug).toBe('ai-01'); // 已按 LEGACY_META 归入「人工智能」首条
    expect(res.body.license).toBe('MIT'); // 许可字段由种子补齐
  }); // 结束存量模块详情用例
}); // 代码块结束
