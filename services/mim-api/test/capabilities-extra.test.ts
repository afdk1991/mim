/** 契约测试：本轮新增的 19 条「程序开发」组能力 —— 每条都必须有真实、可断言的产出。 */

import { describe, expect, it } from 'vitest'; // vitest 测试框架
import { CAPABILITY_HANDLERS } from '../src/capabilities.js'; // 执行层注册表

/** 小工具：取 handler 并执行，返回结果 */
async function run(key: string, text: string, options: Record<string, unknown> = {}) {
  const handler = CAPABILITY_HANDLERS[key]; // 直接读注册表
  expect(handler, `未注册: ${key}`).toBeTypeOf('function'); // 必须存在
  return handler!({ text, options }); // 执行
} // run 结束

describe('程序开发组新增能力', () => {
  it('ui.theme 生成十档色阶', async () => {
    const result = await run('ui.theme', '#2f6feb'); // 主色
    expect(result.output).toContain('--brand-500'); // 500 档保留原色
    expect(result.output).toContain('--brand-900'); // 深色档存在
    expect(result.meta.steps).toBe(10); // 十档
  });

  it('ui.theme 拒绝非十六进制色值', async () => {
    await expect(run('ui.theme', 'blue')).rejects.toThrow(); // 非 hex 直接失败
  });

  it('speech.ssml 按句插停顿', async () => {
    const result = await run('speech.ssml', '你好。欢迎使用 Mim。'); // 两句
    expect(result.output.startsWith('<speak')).toBe(true); // SSML 根节点
    expect(result.output).toContain('<break time="300ms"/>'); // 句间停顿
    expect(result.meta.sentences).toBe(2); // 句数
  });

  it('http.status 查询多个状态码', async () => {
    const result = await run('http.status', '200,429,999'); // 含一个越界码
    const parsed = JSON.parse(result.output) as { items: Array<{ code: number; klass: string; known: boolean }> }; // 解析输出
    expect(parsed.items).toHaveLength(2); // 999 被过滤
    expect(parsed.items[0].klass).toBe('2xx'); // 分类正确
    expect(parsed.items[1].known).toBe(true); // 429 已收录
  });

  it('data.profile 计算分位与离群', async () => {
    const result = await run('data.profile', '1,2,3,4,100'); // 一个明显离群值
    const parsed = JSON.parse(result.output) as { median: number; outliers: number[] }; // 解析输出
    expect(parsed.median).toBe(3); // 中位数
    expect(parsed.outliers).toContain(100); // 离群值被识别
  });

  it('code.detect 识别 TypeScript 与 Python', async () => {
    const ts = await run('code.detect', 'interface A { id: number }\nexport type B = string;'); // TS 特征
    expect(JSON.parse(ts.output).language).toBe('TypeScript'); // 语言判定
    const py = await run('code.detect', 'def main():\n    import os'); // Python 特征
    expect(JSON.parse(py.output).language).toBe('Python'); // 语言判定
  });

  it('cache.key 生成短键与过期时间', async () => {
    const result = await run('cache.key', 'user:42:profile', { prefix: 'app', ttl: 60 }); // 60 秒 TTL
    const parsed = JSON.parse(result.output) as { key: string; ttl_seconds: number; expire_at: string }; // 解析
    expect(parsed.key.startsWith('app:')).toBe(true); // 前缀生效
    expect(parsed.key.length).toBeLessThan(30); // 短键
    expect(parsed.ttl_seconds).toBe(60); // TTL
    expect(Number.isNaN(Date.parse(parsed.expire_at))).toBe(false); // 合法时间
  });

  it('search.rank 按命中次数排序', async () => {
    const result = await run('search.rank', JSON.stringify({ query: '购物车', docs: ['商城购物车结算流程', 'IM 聊天'] })); // 一个命中一个不命中
    const parsed = JSON.parse(result.output) as { hits: number; ranked: Array<{ score: number }> }; // 解析
    expect(parsed.hits).toBe(1); // 仅一条命中
    expect(parsed.ranked[0].score).toBeGreaterThan(0); // 得分大于 0
  });

  it('service.topology 排出启动分层', async () => {
    const result = await run('service.topology', JSON.stringify({ services: [{ name: 'api', depends_on: ['db'] }, { name: 'db', depends_on: [] }] })); // 两层依赖
    const parsed = JSON.parse(result.output) as { start_order: string[]; layers: string[][]; healthy: boolean }; // 解析
    expect(parsed.start_order).toEqual(['db', 'api']); // 依赖优先
    expect(parsed.layers).toHaveLength(2); // 两层
    expect(parsed.healthy).toBe(true); // 健康
  });

  it('service.topology 检出环形依赖', async () => {
    const result = await run('service.topology', JSON.stringify({ services: [{ name: 'a', depends_on: ['b'] }, { name: 'b', depends_on: ['a'] }] })); // 互依赖
    const parsed = JSON.parse(result.output) as { cycles: string[]; healthy: boolean }; // 解析
    expect(parsed.cycles.sort()).toEqual(['a', 'b']); // 两个都在环里
    expect(parsed.healthy).toBe(false); // 不健康
  });

  it('workflow.check 报告环形依赖与悬空边', async () => {
    const result = await run('workflow.check', JSON.stringify({ steps: [{ id: 'a', next: ['b', 'ghost'] }, { id: 'b', next: ['a'] }] })); // a/b 互指成环，并带一条悬空边
    const parsed = JSON.parse(result.output) as { unreachable: string[]; dangling_edges: string[]; healthy: boolean }; // 解析
    expect(parsed.unreachable.sort()).toEqual(['a', 'b']); // 环内节点都从入口不可达
    expect(parsed.dangling_edges[0]).toBe('a->ghost'); // 悬空边
    expect(parsed.healthy).toBe(false); // 不健康
  });

  it('rbac.check 合并角色权限', async () => {
    const result = await run('rbac.check', JSON.stringify({ roles: { admin: ['user:read'] }, users: [{ user: 'u1', roles: ['admin'] }, { user: 'u2', roles: ['guest'] }], required: 'user:read' })); // 一授一拒
    const parsed = JSON.parse(result.output) as { granted: number; denied: number; details: Array<{ user: string; granted: boolean; unknown_roles: string[] }> }; // 解析
    expect(parsed.granted).toBe(1); // u1 通过
    expect(parsed.denied).toBe(1); // u2 拒绝
    expect(parsed.details[1].unknown_roles).toContain('guest'); // 未定义角色
  });

  it('code.gen 渲染模板', async () => {
    const result = await run('code.gen', JSON.stringify({ template: 'export const {{name}} = {{value}};', data: { name: 'LIMIT', value: 20 } })); // 简单模板
    expect(result.output).toBe('export const LIMIT = 20;'); // 逐字匹配
    expect(result.output_kind).toBe('text'); // 纯文本
  });

  it('ioc.graph 给出实例化顺序', async () => {
    const result = await run('ioc.graph', JSON.stringify({ beans: [{ name: 'service', depends_on: ['repo'] }, { name: 'repo', depends_on: [] }] })); // 两层
    const parsed = JSON.parse(result.output) as { instantiate_order: string[]; healthy: boolean }; // 解析
    expect(parsed.instantiate_order).toEqual(['repo', 'service']); // 被依赖者先
    expect(parsed.healthy).toBe(true); // 健康
  });

  it('rule.eval 命中断言与报错并存', async () => {
    const result = await run('rule.eval', JSON.stringify({ rules: [{ when: 'amount > 100', then: 'high' }, { when: 'bad (', then: 'never' }], facts: { amount: 120 } })); // 一条正常一条语法错
    const parsed = JSON.parse(result.output) as { fired: Array<{ then: string }>; errors: number }; // 解析
    expect(parsed.fired[0].then).toBe('high'); // 命中
    expect(parsed.errors).toBe(1); // 错误计数
  });

  it('spring.config 生成 application.yml', async () => {
    const result = await run('spring.config', JSON.stringify({ app: { name: 'mim', port: 8080 }, datasource: { url: 'jdbc:h2:mem', user: 'sa' } })); // 完整配置
    expect(result.output).toContain('application:'); // spring 段
    expect(result.output).toContain('port: 8080'); // 端口
    expect(result.meta.warnings).toEqual([]); // 无告警
  });

  it('spring.config 对非法端口给告警', async () => {
    const result = await run('spring.config', JSON.stringify({ app: { name: 'mim', port: 70000 } })); // 越界端口
    expect((result.meta.warnings as string[]).length).toBeGreaterThan(0); // 有告警
  });

  it('node.pkg 用 semver 校验依赖范围', async () => {
    const result = await run('node.pkg', JSON.stringify({ name: 'mim', version: '0.0.0', dependencies: { semver: '^7.6.0', broken: 'not-a-range' }, devDependencies: { '@mim/api': 'workspace:*' } })); // 混入一个坏范围
    const parsed = JSON.parse(result.output) as { ok: boolean; issues: string[]; dependencies_checked: number }; // 解析
    expect(parsed.dependencies_checked).toBe(3); // 三段依赖都扫到
    expect(parsed.issues.some((issue) => issue.includes('broken'))).toBe(true); // 坏范围被抓
    expect(parsed.ok).toBe(false); // 体检不通过
  });

  it('bpmn.check 校验开始结束配对', async () => {
    const result = await run('bpmn.check', JSON.stringify({ nodes: [{ id: 's', type: 'start', out: ['t'] }, { id: 't', type: 'task', out: ['e'] }, { id: 'e', type: 'end', out: [] }] })); // 完整流程
    const parsed = JSON.parse(result.output) as { start_nodes: number; end_nodes: number; healthy: boolean }; // 解析
    expect(parsed.start_nodes).toBe(1); // 一个开始
    expect(parsed.end_nodes).toBe(1); // 一个结束
    expect(parsed.healthy).toBe(true); // 健康
  });

  it('bpmn.check 抓出孤立与断头节点', async () => {
    const result = await run('bpmn.check', JSON.stringify({ nodes: [{ id: 's', type: 'start', out: [] }, { id: 'x', type: 'task', out: [] }] })); // 开始无出边 + 孤立任务
    const parsed = JSON.parse(result.output) as { orphan_nodes: string[]; dead_end_nodes: string[] }; // 解析
    expect(parsed.orphan_nodes).toContain('x'); // 孤立任务
    expect(parsed.dead_end_nodes).toContain('s'); // 断头开始
  });

  it('anim.keyframes 生成 CSS 关键帧', async () => {
    const result = await run('anim.keyframes', JSON.stringify({ name: 'fade', duration: '1s', frames: [{ offset: '0%', styles: { opacity: '0' } }, { offset: '100%', styles: { opacity: '1' } }] })); // 两帧
    expect(result.output).toContain('@keyframes fade'); // 动画名
    expect(result.output).toContain('opacity: 0;'); // 首帧样式
    expect(result.meta.frames).toBe(2); // 帧数
  });

  it('phone.format 输出 E.164 与运营商', async () => {
    const result = await run('phone.format', '138 0000 0001'); // 大陆手机号
    const parsed = JSON.parse(result.output) as { e164: string; country: string; carrier: string; masked: string }; // 解析
    expect(parsed.e164).toBe('+8613800000001'); // E.164
    expect(parsed.country).toBe('CN'); // 地区
    expect(parsed.carrier).toBe('中国移动'); // 号段判定
    expect(parsed.masked).toBe('138****0001'); // 掩码
  });

  it('tauri.perm 生成 capability JSON', async () => {
    const result = await run('tauri.perm', JSON.stringify({ identifier: 'default', windows: ['main'], permissions: ['core:default'] })); // 合法输入
    const parsed = JSON.parse(result.output) as { capability: { identifier: string; permissions: string[] }; ok: boolean }; // 解析
    expect(parsed.capability.identifier).toBe('default'); // 标识
    expect(parsed.capability.permissions).toContain('core:default'); // 权限
    expect(parsed.ok).toBe(true); // 校验通过
  });
}); // 新增能力用例结束

describe('WEB 应用开发组新增能力', () => {
  it('web.scaffold 生成骨架清单', async () => {
    const result = await run('web.scaffold', JSON.stringify({ name: 'shop', framework: 'vite-react', features: ['router', 'test'] })); // 两个特性
    const parsed = JSON.parse(result.output) as { files: Array<{ path: string }>; unknown_features: string[] }; // 解析
    expect(parsed.files.length).toBe(7); // 5 基础 + 2 特性
    expect(parsed.files.some((f) => f.path.endsWith('router.ts'))).toBe(true); // 路由文件
    expect(parsed.unknown_features).toEqual([]); // 无未知特性
  });

  it('web.scaffold 拒绝非 kebab-case 名称', async () => {
    await expect(run('web.scaffold', JSON.stringify({ name: 'My Shop' }))).rejects.toThrow(); // 名称非法
  });

  it('jquery.plugin 生成 IIFE 骨架', async () => {
    const result = await run('jquery.plugin', 'tooltip'); // 插件名
    expect(result.output).toContain('$.fn.tooltip'); // 扩展点
    expect(result.output).toContain('})(jQuery);'); // IIFE 收口
  });

  it('ui.props 校验必填与类型', async () => {
    const result = await run('ui.props', JSON.stringify({ schema: { size: 'string!', count: 'number' }, props: { extra: 1 } })); // 缺必填 size + 多余 extra
    const parsed = JSON.parse(result.output) as { valid: boolean; issues: string[]; extra_fields: string[] }; // 解析
    expect(parsed.valid).toBe(false); // 不通过
    expect(parsed.issues.some((issue) => issue.includes('size'))).toBe(true); // 必填缺失
    expect(parsed.extra_fields).toContain('extra'); // 多余字段
  });

  it('js.type 区分数组与对象', async () => {
    const arr = await run('js.type', '[1,2,3]'); // 数组
    expect(JSON.parse(arr.output).type).toBe('array'); // 类型
    const obj = await run('js.type', '{"a":1}'); // 对象
    expect(JSON.parse(obj.output).type).toBe('object'); // 类型
  });

  it('js.type 识别未加引号字面量坑', async () => {
    const result = await run('js.type', 'hello'); // 裸字面量
    const parsed = JSON.parse(result.output) as { type: string; pitfalls: string[] }; // 解析
    expect(parsed.type).toBe('string'); // 判为字符串
    expect(parsed.pitfalls.length).toBeGreaterThan(0); // 有提示
  });

  it('rest.lint 抓动词与大小写', async () => {
    const result = await run('rest.lint', JSON.stringify({ method: 'POST', path: '/api/v1/getUsers' })); // 动词 + 大写
    const parsed = JSON.parse(result.output) as { valid: boolean; issues: string[]; suggested_path: string }; // 解析
    expect(parsed.valid).toBe(false); // 不通过
    expect(parsed.issues.some((issue) => issue.includes('动词'))).toBe(true); // 动词问题
    expect(parsed.suggested_path.includes('users')).toBe(true); // 建议路径
  });

  it('admin.menu 建出父子层级', async () => {
    const result = await run('admin.menu', JSON.stringify({ routes: [{ path: '/mods', title: '模块', order: 1 }, { path: '/mods/list', title: '列表', order: 2 }] })); // 两层
    const parsed = JSON.parse(result.output) as { tree: Array<{ path: string; children: Array<{ path: string }> }> }; // 解析
    expect(parsed.tree).toHaveLength(1); // 一个根
    expect(parsed.tree[0].children[0].path).toBe('/mods/list'); // 子节点
  });

  it('admin.menu 标出重复路径', async () => {
    const result = await run('admin.menu', JSON.stringify({ routes: [{ path: '/a', title: 'A' }, { path: '/a', title: 'B' }] })); // 重复
    expect(JSON.parse(result.output).duplicates).toContain('/a'); // 重复清单
  });

  it('theme.tokens 按基数生成刻度', async () => {
    const result = await run('theme.tokens', '4'); // 基数 4
    const parsed = JSON.parse(result.output) as { spacing: Array<{ token: string; value: string }> }; // 解析
    expect(parsed.spacing[0].value).toBe('4px'); // 第一档
    expect(parsed.spacing[7].value).toBe('40px'); // 第八档
  });

  it('theme.tokens 拒绝越界基数', async () => {
    await expect(run('theme.tokens', '200')).rejects.toThrow(); // 越界
  });

  it('vue.sfc 生成带 props 的 SFC', async () => {
    const result = await run('vue.sfc', JSON.stringify({ name: 'UserCard', props: ['title'], emits: ['select'] })); // 组件
    expect(result.output).toContain('defineProps'); // props 声明
    expect(result.output).toContain("(e: 'select'): void"); // emits 类型
    expect(result.output).toContain('<template>'); // 模板
  });

  it('crawler.plan 清理跟踪参数并给礼貌参数', async () => {
    const result = await run('crawler.plan', JSON.stringify({ start: 'https://example.com/list?utm_source=newsletter&page=1', pages: 50 })); // 带跟踪参数
    const parsed = JSON.parse(result.output) as { normalized_url: string; delay_ms: number; page_param_detected: boolean; robots_hint: string }; // 解析
    expect(parsed.normalized_url.includes('utm_source')).toBe(false); // 跟踪参数被清
    expect(parsed.page_param_detected).toBe(true); // 分页参数识别
    expect(parsed.robots_hint.includes('/robots.txt')).toBe(true); // robots 提示
    expect(parsed.delay_ms).toBeGreaterThan(0); // 有延迟
  });

  it('angular.cmp 生成 standalone 组件', async () => {
    const result = await run('angular.cmp', JSON.stringify({ name: 'user-card', inputs: ['title'], outputs: ['select'] })); // 组件
    expect(result.output).toContain("selector: 'app-user-card'"); // 选择器
    expect(result.output).toContain('UserCardComponent'); // 类名
    expect(result.output).toContain('output<void>()'); // 输出声明
  });

  it('bs.grid 换算 col 类名并夹紧越界', async () => {
    const result = await run('bs.grid', JSON.stringify({ xs: 12, md: 6, lg: 20 })); // lg 越界
    const parsed = JSON.parse(result.output) as { class_string: string; issues: string[] }; // 解析
    expect(parsed.class_string).toBe('col-12 col-md-6'); // 有效类名
    expect(parsed.issues.length).toBe(1); // 一条越界提示
  });

  it('react.cmp 生成 TSX 组件', async () => {
    const result = await run('react.cmp', JSON.stringify({ name: 'UserCard', props: ['title'], memo: true })); // 带 memo
    expect(result.output).toContain('export function UserCard'); // 函数组件
    expect(result.output).toContain('memo(UserCard)'); // memo 包裹
    expect(result.output).toContain('title?: string;'); // props 字段
  });

  it('rpc.methods 校验命名与参数类型', async () => {
    const result = await run('rpc.methods', JSON.stringify({ methods: [{ name: 'user.get', params: ['id:string'] }, { name: 'Bad.Name', params: ['id:str'] }] })); // 一好一坏
    const parsed = JSON.parse(result.output) as { issues: string[] }; // 解析
    expect(parsed.issues.length).toBeGreaterThanOrEqual(2); // 名称与参数都报
  });

  it('api.routes 检出重复与参数命名漂移', async () => {
    const result = await run('api.routes', JSON.stringify({ routes: [{ method: 'GET', path: '/users/:id' }, { method: 'GET', path: '/users/:userId' }, { method: 'GET', path: '/users/:id' }] })); // 漂移 + 重复
    const parsed = JSON.parse(result.output) as { duplicates: string[]; param_naming_drift: string[]; healthy: boolean }; // 解析
    expect(parsed.duplicates.length).toBe(2); // 第二条漂移、第三条重复各记一次
    expect(parsed.param_naming_drift.length).toBe(1); // 一条漂移
    expect(parsed.healthy).toBe(false); // 不健康
  });

  it('url.short 生成 6 位 Base62 短码', async () => {
    const result = await run('url.short', 'https://mim.mixm.top/products?group=dev'); // 长链
    const parsed = JSON.parse(result.output) as { code: string; short_path: string }; // 解析
    expect(parsed.code).toHaveLength(6); // 六位
    expect(/^[0-9a-zA-Z]{6}$/.test(parsed.code)).toBe(true); // Base62 字符
    expect(parsed.short_path).toBe(`/s/${parsed.code}`); // 短路径
  });

  it('url.short 拒绝非绝对地址', async () => {
    await expect(run('url.short', '/relative')).rejects.toThrow(); // 相对地址
  });

  it('layui.table 生成 cols 配置', async () => {
    const result = await run('layui.table', JSON.stringify({ fields: ['id', 'name', 'created_at'] })); // 三个字段
    expect(result.output).toContain("field: 'id'"); // 字段
    expect(result.output).toContain('sort: true'); // 时间列可排序
    expect(result.output).toContain("fixed: 'left'"); // 首列固定
    expect(result.output).toContain('创建时间'); // 中文标题
  });
}); // WEB 组用例结束
