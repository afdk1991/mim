/** 契约测试：商城「模块 = 真实能力」覆盖度 —— 每条能力都必须有 handler、绑定编码必须存在于 205 条分类树。 */

import { describe, expect, it } from 'vitest'; // vitest 测试框架
import { MODULE_CAPABILITIES, buildCatalogModuleSeeds } from '@mim/core-domain'; // 能力清单与模块种子
import { CAPABILITY_HANDLERS, handlerOfCapability } from '../src/capabilities.js'; // 执行层注册表

/** 205 条模块编码集合：绑定编码必须命中其中一条 */
const MODULE_CODES = new Set(buildCatalogModuleSeeds().map((seed) => seed.code)); // 取全部 205 条模块编码

describe('商城能力覆盖度', () => {
  // 用例 1：清单非空且键唯一
  it('能力清单非空且键唯一', () => {
    expect(MODULE_CAPABILITIES.length).toBeGreaterThanOrEqual(27); // 本轮至少 27 条真实能力
    const keys = MODULE_CAPABILITIES.map((item) => item.key); // 全部键
    expect(new Set(keys).size).toBe(keys.length); // 不允许重复键
  });

  // 用例 2：每条能力都有实现
  it('每条能力都能找到已注册 handler', () => {
    for (const capability of MODULE_CAPABILITIES) {
      expect(CAPABILITY_HANDLERS[capability.key], `缺少 handler: ${capability.key}`).toBeTypeOf('function'); // 注册表必须命中
    } // 循环结束
  });

  // 用例 3：绑定的模块编码都真实存在于分类树，且一个模块只绑一条能力
  it('绑定编码存在且未被重复绑定', () => {
    const bound = new Set<string>(); // 记录已绑定编码
    for (const capability of MODULE_CAPABILITIES) {
      for (const code of capability.module_codes) {
        expect(MODULE_CODES.has(code), `未知模块编码: ${code}`).toBe(true); // 必须命中 205 条
        expect(bound.has(code), `模块被重复绑定: ${code}`).toBe(false); // 一对一绑定，避免同模块多能力歧义
        bound.add(code); // 登记
      } // 编码循环结束
    } // 能力循环结束
  });
});

describe('能力执行层真实产出', () => {
  /** 小工具：调用能力并断言 output 非空 */
  async function run(key: string, text: string, options: Record<string, unknown> = {}): Promise<{ output: string; output_kind: string; meta: Record<string, unknown> }> {
    const handler = handlerOfCapability(key); // 取 handler
    expect(handler, `未注册: ${key}`).toBeTypeOf('function'); // 必须存在
    const result = await handler!({ text, options }); // 执行
    expect(typeof result.output).toBe('string'); // 输出必须是字符串
    expect(result.output.length).toBeGreaterThan(0); // 不能是空串
    return result; // 返回结果
  } // run 结束

  // JSON 工具：合法与非法
  it('json.format 格式化与非法输入', async () => {
    const ok = await run('json.format', '{"a":1}', { mode: 'pretty' });
    expect(ok.output).toContain('"a": 1'); // 缩进生效
    await expect(run('json.format', '{bad', { mode: 'pretty' })).rejects.toThrow(); // 非法 JSON 抛错
  });

  // 编解码往返
  it('text.encode 往返一致', async () => {
    const encoded = await run('text.encode', 'Mim 办公', { op: 'base64', direction: 'encode' });
    const decoded = await run('text.encode', encoded.output, { op: 'base64', direction: 'decode' });
    expect(decoded.output).toBe('Mim 办公'); // 解码还原原文
  });

  // 摘要固定值
  it('text.hash md5 与已知值一致', async () => {
    const result = await run('text.hash', 'mim', { algo: 'md5' });
    expect(result.output).toBe('8e7f86260c88346052cadd7d68514184'); // md5("mim") 已知值
  });

  // Markdown 渲染并转义原始 HTML
  it('markdown.render 渲染标题并转义原始 HTML', async () => {
    const result = await run('markdown.render', '# 标题\n\n<script>alert(1)</script>', {});
    expect(result.output).toContain('<h1'); // 标题被解析
    expect(result.output).not.toContain('<script>'); // 原始 HTML 被转义
  });

  // 二维码输出 dataURL
  it('qrcode.generate 输出 PNG dataURL', async () => {
    const result = await run('qrcode.generate', 'https://mim.mixm.top', { size: 128 });
    expect(result.output.startsWith('data:image/png;base64,')).toBe(true); // PNG dataURL 数据
  });

  // cron 解析返回未来时间
  it('cron.describe 返回未来触发时间', async () => {
    const result = await run('cron.describe', '0 9 * * 1-5', { count: 2 });
    const parsed = JSON.parse(result.output) as { next: string[] }; // 解析输出
    expect(parsed.next).toHaveLength(2); // 两条
    expect(parsed.next[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 时间
  });

  // 分词统计
  it('text.segment 统计汉字与单词', async () => {
    const result = await run('text.segment', '你好 Mim office', {});
    const parsed = JSON.parse(result.output) as { cjk: number; words: number };
    expect(parsed.cjk).toBe(2); // 两个汉字
    expect(parsed.words).toBe(2); // 两个英文词
  });

  // 卡号校验
  it('card.luhn 校验公开测试卡号', async () => {
    const result = await run('card.luhn', '4111 1111 1111 1111', {});
    const parsed = JSON.parse(result.output) as { valid: boolean; brand: string };
    expect(parsed.valid).toBe(true); // 合法测试卡号
    expect(parsed.brand).toBe('Visa'); // 识别为 Visa
  });

  // CSV 转 JSON
  it('csv.json 把 CSV 转成对象数组', async () => {
    const result = await run('csv.json', 'name,score\nAlice,92\nBob,88', { mode: 'tojson' });
    const parsed = JSON.parse(result.output) as { rows: Array<{ name: string; score: string }>; total: number };
    expect(parsed.total).toBe(2); // 两行
    expect(parsed.rows[0].name).toBe('Alice'); // 字段映射
  });

  // 模板渲染
  it('template.render 渲染 Mustache 模板', async () => {
    const result = await run('template.render', '{"template":"Hi {{name}}","data":{"name":"Mim"}}', {});
    expect(result.output).toBe('Hi Mim'); // 变量替换
  });

  // URL 解析
  it('url.parse 拆出查询参数', async () => {
    const result = await run('url.parse', 'https://mim.mixm.top/marketplace?tab=dev&q=json', {});
    const parsed = JSON.parse(result.output) as { hostname: string; query: Record<string, string> };
    expect(parsed.hostname).toBe('mim.mixm.top');
    expect(parsed.query.tab).toBe('dev'); // 参数解析
  });

  // CIDR 计算
  it('ip.cidr 计算网络与广播地址', async () => {
    const result = await run('ip.cidr', '192.168.1.10/24', {});
    const parsed = JSON.parse(result.output) as { network: string; broadcast: string; usable_hosts: number };
    expect(parsed.network).toBe('192.168.1.0/24');
    expect(parsed.broadcast).toBe('192.168.1.255');
    expect(parsed.usable_hosts).toBe(254); // /24 可用主机数
  });

  // SVG 图表
  it('chart.svg 生成 SVG', async () => {
    const result = await run('chart.svg', 'month,orders\n1月,120\n2月,180', { chart: 'bar' });
    expect(result.output_kind).toBe('html'); // 按 HTML 渲染
    expect(result.output).toContain('<svg'); // 真是 SVG
  });

  // 报表
  it('report.table 生成 HTML 与 Markdown 两种表格', async () => {
    const html = await run('report.table', 'module,price\ncomic,0', { format: 'html' });
    expect(html.output).toContain('<table');
    const md = await run('report.table', 'module,price\ncomic,0', { format: 'markdown' });
    expect(md.output).toContain('| module | price |'); // Markdown 表头
  });

  // 图片 dataURL
  it('image.dataurl 解析 dataURL 元信息', async () => {
    const result = await run('image.dataurl', 'data:image/png;base64,aGVsbG8=', {});
    const parsed = JSON.parse(result.output) as { mime: string; bytes: number };
    expect(parsed.mime).toBe('image/png');
    expect(parsed.bytes).toBe(5); // "hello" 五字节
  });

  // 日志分析
  it('log.stats 统计日志级别', async () => {
    const result = await run('log.stats', '2026-11-11T09:00:00Z INFO start\n2026-11-11T09:00:05Z ERROR db timeout', {});
    const parsed = JSON.parse(result.output) as { levels: Array<{ level: string; count: number }>; total_lines: number };
    expect(parsed.total_lines).toBe(2);
    expect(parsed.levels.some((item) => item.level === 'ERROR')).toBe(true); // 识别出 ERROR 级别
    expect(parsed.levels.some((item) => item.level === 'INFO')).toBe(true); // 识别出 INFO 级别
  });

  // 验证码
  it('captcha.svg 输出 SVG dataURL 且返回答案', async () => {
    const result = await run('captcha.svg', '', { length: 4 });
    expect(result.output.startsWith('data:image/svg+xml')).toBe(true); // dataURL 数据
    expect(String(result.meta.answer)).toHaveLength(4); // 答案长度
  });

  // 数学求值并拒绝赋值
  it('math.eval 求值且拒绝赋值语句', async () => {
    const result = await run('math.eval', '(12+8)*3 / sqrt(16)', { precision: 2 });
    const parsed = JSON.parse(result.output) as { value: number };
    expect(parsed.value).toBe(15); // 20*3/4
    await expect(run('math.eval', 'a = 3', {})).rejects.toThrow(); // 赋值被拒
  });

  // JSON Schema 推导
  it('json.schema 推导对象 schema', async () => {
    const result = await run('json.schema', '{"title":"Mim","count":3,"tags":["a"]}', {});
    const parsed = JSON.parse(result.output) as { type: string; properties: Record<string, { type: string }> };
    expect(parsed.type).toBe('object');
    expect(parsed.properties.count.type).toBe('integer'); // 整数细分
  });

  // 参考文献
  it('cite.format 生成 GB/T 7714 期刊条目', async () => {
    const result = await run('cite.format', '{"authors":["张三","李四"],"title":"跨平台办公系统设计","year":"2026","journal":"软件学报","volume":"37","issue":"4","pages":"1-12"}', { type: 'journal' });
    expect(result.output).toContain('[J]'); // 期刊标识
    expect(result.output).toContain('软件学报'); // 刊名
  });

  // YAML 互转
  it('yaml.json 解析 YAML', async () => {
    const result = await run('yaml.json', 'kind: Service\nmetadata:\n  name: mim-api', { mode: 'yaml2json' });
    const parsed = JSON.parse(result.output) as { kind: string; metadata: { name: string } };
    expect(parsed.kind).toBe('Service');
    expect(parsed.metadata.name).toBe('mim-api');
  });

  // JWT 解析
  it('jwt.decode 解析载荷并标注未验签', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtaW0iLCJleHAiOjE4MDAwMDAwMDB9.sig'; // 公开样例
    const result = await run('jwt.decode', token, {});
    const parsed = JSON.parse(result.output) as { payload: { sub: string }; signature_verified: boolean };
    expect(parsed.payload.sub).toBe('mim');
    expect(parsed.signature_verified).toBe(false); // 明确未验签
  });

  // 文本差异
  it('diff.text 输出 unified diff', async () => {
    const result = await run('diff.text', '{"a":"line1\\nline2","b":"line1\\nline3"}', {});
    expect(result.output).toContain('-line2'); // 删除行
    expect(result.output).toContain('+line3'); // 新增行
  });

  // 代码统计
  it('code.stats 统计代码行与注释行', async () => {
    const result = await run('code.stats', '// 注释\nconst a = 1;\n\nconsole.log(a);', { lang: 'ts' });
    const parsed = JSON.parse(result.output) as { code_lines: number; comment_lines: number; blank_lines: number };
    expect(parsed.comment_lines).toBe(1); // 一行注释
    expect(parsed.code_lines).toBe(2); // 两行代码
    expect(parsed.blank_lines).toBe(1); // 一行空行
  });

  // SQL 格式化
  it('sql.format 大写关键字并换行', async () => {
    const result = await run('sql.format', 'select id,name from modules where status=1', { dialect: 'sql' });
    expect(result.output).toContain('SELECT'); // 关键字大写
    expect(result.output.split('\n').length).toBeGreaterThan(1); // 多行
  });

  // 文本统计
  it('text.stats 统计字符与行数', async () => {
    const result = await run('text.stats', 'Mim 是跨平台项目。\n第二段。', {});
    const parsed = JSON.parse(result.output) as { cjk: number; lines: number };
    expect(parsed.lines).toBe(2);
    expect(parsed.cjk).toBeGreaterThan(5); // 多个汉字
  });

  // 批量重命名预览
  it('file.rename 返回改名映射且不改磁盘', async () => {
    const result = await run('file.rename', '{"files":["a.txt","b.png"],"pattern":"{n}-{name}{ext}"}', {});
    const parsed = JSON.parse(result.output) as { items: Array<{ from: string; to: string }>; total: number };
    expect(parsed.total).toBe(2);
    expect(parsed.items[0].to).toBe('1-a.txt'); // 序号 + 原名 + 扩展名
  });
});
