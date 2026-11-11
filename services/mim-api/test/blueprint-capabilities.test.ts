/** 契约测试：模块起盘蓝图 —— 143 条软件方向模块逐条产出专属文档，且 205 条模块不再有「规划中」残留。 */

import { describe, expect, it } from 'vitest'; // vitest 测试框架
import { BLUEPRINT_GROUPS, MODULE_BLUEPRINTS, blueprintGroupOfCode, buildCatalogModuleSeeds, capabilityOfModule } from '@mim/core-domain'; // 蓝图数据 + 能力绑定 + 模块种子
import { handlerOfCapability } from '../src/capabilities.js'; // 服务端能力注册表

/** 205 条模块种子：编码到中文名的映射，测试据此断言文档里出现正确条目名 */
const SEEDS = buildCatalogModuleSeeds(); // 与建库种子同源，避免两处清单漂移

/** 编码 → 条目中文名 */
const NAME_OF = new Map(SEEDS.map((seed) => [seed.code, seed.name])); // 便于逐条比对

describe('蓝图数据完整性', () => {
  // 用例 1：数据量与唯一性
  it('143 条蓝图编码唯一且全部命中 205 条分类树', () => {
    expect(MODULE_BLUEPRINTS.length).toBe(143); // 62 条工具能力 + 143 条蓝图 = 205 全覆盖
    const codes = MODULE_BLUEPRINTS.map((item) => item.code); // 全部编码
    expect(new Set(codes).size).toBe(codes.length); // 不允许同一模块登记两条蓝图
    for (const code of codes) expect(NAME_OF.has(code), `未知模块编码: ${code}`).toBe(true); // 必须存在于分类树
  });

  // 用例 2：分组模板与能力一一对应
  it('17 个分组各自绑定一条已登记能力，且基准目录与扩展名齐备', () => {
    expect(BLUEPRINT_GROUPS.length).toBe(17); // 除「程序开发 / WEB应用开发」外的一级分组数
    const capabilities = new Set(BLUEPRINT_GROUPS.map((group) => group.capability)); // 能力键集合
    expect(capabilities.size).toBe(17); // 能力键不得重复
    for (const group of BLUEPRINT_GROUPS) {
      expect(group.rootDir.length, `${group.slug} 缺目录根`).toBeGreaterThan(0); // 目录根必须给出
      expect(group.ext.length, `${group.slug} 缺扩展名`).toBeGreaterThan(0); // 扩展名必须给出
      expect(group.checksZh.length, `${group.slug} 缺验收项`).toBeGreaterThanOrEqual(3); // 验收清单至少三条
      expect(group.deliverablesZh.length, `${group.slug} 缺交付物`).toBeGreaterThanOrEqual(3); // 交付物至少三条
    }
  });

  // 用例 3：商城不再有「规划中」模块
  it('205 条模块全部登记能力，无「规划中」残留', () => {
    const missing = SEEDS.filter((seed) => capabilityOfModule(seed.code) === undefined).map((seed) => seed.code); // 未绑定能力的模块
    expect(missing, `仍有规划中模块: ${missing.join(', ')}`).toEqual([]); // 必须为空
  });

  // 用例 4：蓝图编码归属分组与绑定能力一致
  it('每条蓝图的分组归属与其能力键一致', () => {
    for (const blueprint of MODULE_BLUEPRINTS) {
      const group = blueprintGroupOfCode(blueprint.code); // 按编码反查分组
      expect(group, `编码无法归属分组: ${blueprint.code}`).toBeDefined(); // 编码格式必须规范
      const capability = capabilityOfModule(blueprint.code); // 该模块绑定的能力
      expect(capability?.key, `能力绑定不一致: ${blueprint.code}`).toBe(group!.capability); // 两处口径必须一致
    }
  });
});

describe('蓝图能力真实产出', () => {
  // 用例 5：逐条调用，产出必须带着该条目自己的内容
  it('143 条蓝图逐条产出专属文档（条目名 / 模块码 / 起步代码 / 验收清单）', async () => {
    for (const blueprint of MODULE_BLUEPRINTS) {
      const group = blueprintGroupOfCode(blueprint.code)!; // 所属分组
      const handler = handlerOfCapability(group.capability); // 该分组的能力实现
      expect(handler, `缺少 handler: ${group.capability}`).toBeTypeOf('function'); // 必须已注册
      const result = await handler!({ text: 'mim-demo', options: { module_code: blueprint.code } }); // 按模块码调用
      const name = NAME_OF.get(blueprint.code)!; // 该条目的中文名
      expect(result.output_kind).toBe('text'); // 文档以纯文本（Markdown）返回
      expect(result.output).toContain(name); // 首段必须写明是哪个条目
      expect(result.output).toContain(`- 模块编码：${blueprint.code}`); // 编码可回溯
      expect(result.output).toContain(blueprint.starter.split('\n')[0]!); // 起步代码首行必须真实落入文档
      expect(result.output).toContain('## 验收清单'); // 验收清单必须存在
      expect(result.output).toContain('## 交付物'); // 交付物必须存在
      expect(result.output).not.toContain('功能规划中'); // 不应再出现规划中文案
      expect(result.output.length).toBeGreaterThan(400); // 文档必须是有内容的交付物而非占位
      expect((result.meta as { module_code?: string }).module_code).toBe(blueprint.code); // 元信息回传模块码
    }
  });

  // 用例 6：缺模块码、未知模块码与跨组调用都必须被拒绝
  it('缺模块码 / 未知模块码 / 跨组调用被拒绝', async () => {
    const aiHandler = handlerOfCapability('catalog.ai')!; // 取人工智能分组 handler
    await expect(aiHandler({ text: 'mim-demo', options: {} })).rejects.toThrow(); // 缺 module_code
    await expect(aiHandler({ text: 'mim-demo', options: { module_code: 'cat.ai-99' } })).rejects.toThrow(); // 不存在的编码
    await expect(aiHandler({ text: 'mim-demo', options: { module_code: 'cat.openharmony-01' } })).rejects.toThrow(); // 跨组串用
  });

  // 用例 7：项目名与需求补充进入文档，空输入回落默认项目名
  it('项目名与需求补充进入文档，空输入回落默认值', async () => {
    const handler = handlerOfCapability('catalog.openharmony')!; // 取 OpenHarmony 分组 handler
    const named = await handler({ text: 'my-app\n需要支持深色模式', options: { module_code: 'cat.openharmony-01' } }); // 首行项目名 + 次行补充
    expect(named.output).toContain('- 项目名：my-app'); // 项目名生效
    expect(named.output).toContain('需要支持深色模式'); // 需求补充生效
    const fallback = await handler({ text: '   ', options: { module_code: 'cat.openharmony-01' } }); // 纯空白输入
    expect(fallback.output).toContain('- 项目名：ets'); // 回落分组目录末段
  });
});
