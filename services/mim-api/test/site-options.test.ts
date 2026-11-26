/** 站点选项契约：注册表默认值 / 公开裁剪 / 管理端读写 / 清洗与夹取 / 恢复默认 / 鉴权边界 */

import { describe, expect, it, beforeEach } from 'vitest'; // 测试框架
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库
import type { Db } from '../src/types.js'; // 连接类型
import { applyOptionPatch, mergeOptionValues, OPTION_DEFAULTS, optionSchema, pickPublicOptions, PUBLIC_OPTION_KEYS } from '../src/options/registry.js'; // 注册表被测层

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试用 JWT 密钥
const ADMIN_TOKEN = 'test-admin-token'; // 运营引导令牌，等同全权限
let app: Express; // 被测应用
let db: Db; // 内存库句柄

beforeEach(() => { // 每个用例独立建库
  db = createDatabase(':memory:'); // 新建内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 组装应用
}); // 前置结束

/** 运营请求头：引导令牌 + JSON + 独立幂等键 */
function adminHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json', 'idempotency-key': `opts-${Math.random().toString(36).slice(2)}` }; // 独立幂等键避免互相干扰
} // adminHeaders 结束

describe('站点选项注册表', () => { // 纯函数层
  it('默认值覆盖两个页签的全部分组且键唯一', () => { // 结构自检（含备案信息、注册与登录、商城与付费分组）
    const schema = optionSchema(); // 注册表结构
    expect(schema.tabs.length).toBe(2); // Global & Features + 账户与交易
    const groupKeys = schema.tabs[0].groups.map((group) => group.key); // 第一页签分组键
    expect(groupKeys).toEqual(['identity', 'seo', 'display', 'search', 'mobile_tab', 'floating', 'locale', 'social', 'email', 'custom', 'beian']); // 与主题后台分组对齐（含备案信息分组）
    const accountGroups = schema.tabs[1].groups.map((group) => group.key); // 第二页签分组键
    expect(accountGroups).toEqual(['auth', 'commerce']); // 注册与登录、商城与付费
    const fields = schema.tabs.flatMap((tab) => tab.groups).flatMap((group) => group.fields); // 全量字段（跨页签）
    expect(new Set(fields.map((field) => field.key)).size).toBe(fields.length); // 键唯一
    expect(fields.every((field) => Object.prototype.hasOwnProperty.call(OPTION_DEFAULTS, field.key))).toBe(true); // 每个字段都有默认值
  }); // 用例结束

  it('公开键不包含邮件等敏感分组', () => { // 公开裁剪
    expect(PUBLIC_OPTION_KEYS).toContain('layout_width'); // 布局宽度前端要用
    expect(PUBLIC_OPTION_KEYS).toContain('search_hot_words'); // 热词前端要用
    expect(PUBLIC_OPTION_KEYS).toContain('beian_icp'); // ICP 备案号前端页脚要用
    expect(PUBLIC_OPTION_KEYS).toContain('beian_police'); // 公安备案号前端页脚要用
    expect(PUBLIC_OPTION_KEYS).not.toContain('smtp_host'); // SMTP 主机不外泄
    expect(PUBLIC_OPTION_KEYS).not.toContain('smtp_user'); // SMTP 账号不外泄
  }); // 用例结束

  it('脏值与越界值被清洗回默认或夹取', () => { // 清洗口径
    const merged = mergeOptionValues({ layout_width: 5000, show_footer: 'no', card_radius: 'huge', floating_position: 'top', unknown_key: 'x' }); // 构造脏配置
    expect(merged.layout_width).toBe(1600); // 越界夹到上限
    expect(merged.show_footer).toBe(true); // 非布尔回落默认
    expect(merged.card_radius).toBe('md'); // 非法候选回落默认
    expect(merged.floating_position).toBe('right'); // 非法候选回落默认
    expect(Object.prototype.hasOwnProperty.call(merged, 'unknown_key')).toBe(false); // 未知键被丢弃
  }); // 用例结束

  it('局部补丁只登记真正变化的键', () => { // 差异口径
    const current = mergeOptionValues({}); // 全默认
    const same = applyOptionPatch(current, { layout_width: 1200 }); // 与默认相同
    expect(same.changed).toEqual([]); // 相同值不算改动
    const changed = applyOptionPatch(current, { layout_width: 1360, custom_css: 'body{}' }); // 两个真实改动
    expect(changed.changed.sort()).toEqual(['custom_css', 'layout_width']); // 只登记这两个键
    expect(changed.values.layout_width).toBe(1360); // 新值生效
  }); // 用例结束

  it('pickPublicOptions 只回公开字段', () => { // 公开视图
    const merged = mergeOptionValues({ smtp_host: 'smtp.example.com', seo_title: '站点标题' }); // 含敏感与公开字段
    const pub = pickPublicOptions(merged); // 裁剪
    expect(pub.seo_title).toBe('站点标题'); // 公开字段保留
    expect(Object.prototype.hasOwnProperty.call(pub, 'smtp_host')).toBe(false); // 敏感字段被剔除
  }); // 用例结束
}); // 纯函数组结束

describe('站点选项接口', () => { // HTTP 层
  it('匿名可读公开字段，且不含 SMTP', async () => { // 公开读
    const res = await request(app).get('/api/v1/site/options'); // 免登录读取
    expect(res.status).toBe(200); // 匿名允许
    expect(res.body.values.layout_width).toBe(1200); // 默认宽度
    expect(res.body.values.search_default_sort).toBe('relevance'); // 默认排序
    expect(res.body.values.smtp_host).toBeUndefined(); // 不外泄邮件配置
  }); // 用例结束

  it('匿名写被拒绝，管理员可读写', async () => { // 鉴权与读写
    const denied = await request(app).put('/api/v1/admin/site-options').send({ values: { layout_width: 1400 } }); // 无凭证写入
    expect(denied.status).toBe(401); // 写操作必须 401

    const saved = await request(app).put('/api/v1/admin/site-options').set(adminHeaders()).send({ values: { layout_width: 1400, search_hot_words: '漫剧\n搜索', custom_css: ':root{--x:1}' } }); // 管理员写入
    expect(saved.status).toBe(200); // 写入成功
    expect(saved.body.changed).toContain('layout_width'); // 登记改动

    const pub = await request(app).get('/api/v1/site/options'); // 公开端回读
    expect(pub.body.values.layout_width).toBe(1400); // 公开字段已生效
    expect(pub.body.values.search_hot_words).toBe('漫剧\n搜索'); // 热词回读

    const admin = await request(app).get('/api/v1/admin/site-options').set(adminHeaders()); // 管理端回读
    expect(admin.status).toBe(200); // 管理端可读
    expect(admin.body.values.custom_css).toBe(':root{--x:1}'); // 敏感以外的私有字段也持久化
    expect(admin.body.updated_at).toBeTruthy(); // 保存时间已写入
  }); // 用例结束

  it('商城与付费开关真实作用于公开配置', async () => { // 开关不是前端假状态
    const before = await request(app).get('/api/v1/site/config'); // 关闭前
    expect(before.body.points_deduction.enabled).toBe(true); // 默认开启
    const saved = await request(app).put('/api/v1/admin/site-options').set(adminHeaders()).send({ values: { points_deduction_switch: false } }); // 后台关闭积分抵扣
    expect(saved.body.changed).toContain('points_deduction_switch'); // 登记改动
    const after = await request(app).get('/api/v1/site/config'); // 关闭后
    expect(after.body.points_deduction.enabled).toBe(false); // 公开配置同步关闭，前端据此隐藏面板
  }); // 用例结束

  it('重置只影响指定键，全量重置回默认', async () => { // 恢复默认
    await request(app).put('/api/v1/admin/site-options').set(adminHeaders()).send({ values: { show_footer: false, layout_width: 1300 } }); // 先改两项
    const one = await request(app).post('/api/v1/admin/site-options/reset').set(adminHeaders()).send({ keys: ['show_footer'] }); // 只重置页脚开关
    expect(one.body.values.show_footer).toBe(true); // 页脚恢复
    expect(one.body.values.layout_width).toBe(1300); // 另一项不受影响

    const all = await request(app).post('/api/v1/admin/site-options/reset').set(adminHeaders()).send({}); // 全量恢复
    expect(all.body.values.layout_width).toBe(1200); // 宽度回默认
    expect(all.body.values.show_footer).toBe(true); // 页脚回默认
  }); // 用例结束

  it('未知键写入被忽略，不污染存储', async () => { // 键白名单
    const res = await request(app).put('/api/v1/admin/site-options').set(adminHeaders()).send({ values: { not_a_field: 'x' } }); // 提交未知键
    expect(res.status).toBe(200); // 请求本身合法
    expect(res.body.changed).toEqual([]); // 没有任何字段被改
    const pub = await request(app).get('/api/v1/site/options'); // 回读公开字段
    expect(Object.prototype.hasOwnProperty.call(pub.body.values, 'not_a_field')).toBe(false); // 未知键未被写入
  }); // 用例结束
}); // HTTP 组结束
