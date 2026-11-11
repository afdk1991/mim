/**
 * 模块起盘蓝图总表：把 17 个一级分组的 143 条「规划中」模块接入真实能力。
 *
 * 口径（用户 2026-11-11 指令「所有商城模块和功能都要能真正用起来」）：
 * 软件方向类模块不可能各有独立工具，但每个模块都能给出**该条目专属**的交付定义
 * （交付目标 / 技术栈 / 起步代码 / 建议目录 / 验收清单），解锁后即可直接开工，
 * 因此不再是「只有价格与简介」的空条目。
 */
import type { BlueprintGroupMeta, ModuleBlueprint } from './types.js'; // 分组模板与蓝图类型
export type { BlueprintGroupMeta, ModuleBlueprint } from './types.js'; // 类型再导出：服务端 handler 需要按分组模板组织输出
import { OPENHARMONY_BLUEPRINTS } from './openharmony.js'; // OpenHarmony 组 37 条
import { AI_BLUEPRINTS } from './ai.js'; // 人工智能组 11 条
import { INDUSTRY_BLUEPRINTS } from './industry.js'; // 工业软件组 15 条
import { ENTERPRISE_STORE_BLUEPRINTS } from './enterprise-store.js'; // 企业应用 + 建站 + 应用工具 18 条
import { PLATFORM_BLUEPRINTS } from './platform.js'; // 移动开发 + 开发工具 + DevOps 19 条
import { INFRA_BLUEPRINTS } from './infra.js'; // 服务器 + 数据库 + 游戏 17 条
import { EXTENSION_BLUEPRINTS } from './extensions.js'; // 插件 + 其他 + 前沿 + 区块链 + 微信 26 条

/** 全量蓝图清单：7 个数据文件合并，合计 143 条（143 + 已绑定的 62 = 205 全覆盖） */
export const MODULE_BLUEPRINTS: readonly ModuleBlueprint[] = [
  ...OPENHARMONY_BLUEPRINTS, // 37 条
  ...AI_BLUEPRINTS, // 11 条
  ...INDUSTRY_BLUEPRINTS, // 15 条
  ...ENTERPRISE_STORE_BLUEPRINTS, // 18 条
  ...PLATFORM_BLUEPRINTS, // 19 条
  ...INFRA_BLUEPRINTS, // 17 条
  ...EXTENSION_BLUEPRINTS, // 26 条
]; // 全量清单结束

/** 交付物清单（三组通用口径，前端详情面板与生成文档共用同一套说法） */
const DELIVERABLES_ZH = ['可直接运行的起步代码或配置（即上方片段）', '最小可运行目录与依赖清单', '按下方清单逐项打勾的验收记录'] as const; // 中文交付物
const DELIVERABLES_EN = ['Runnable starter code or config', 'Minimal project tree and dependency list', 'Acceptance record checked item by item'] as const; // 英文交付物

/** 通用验收项：四组数据共用的三条底线，外加各分组一条专属检查 */
const CHECKS_COMMON_ZH = ['起步片段在本机可运行或可编译，不依赖任何私有凭证', '目录与命名符合仓库既有约定，模块编码可追溯', '交付物不含他人商标、私有素材与密钥'] as const; // 中文通用验收
const CHECKS_COMMON_EN = ['Starter runs or compiles locally without private credentials', 'Paths and naming follow repo conventions and stay traceable to the module code', 'No third-party trademarks, private assets or secrets included'] as const; // 英文通用验收

/** 构造分组模板：把 17 行差异收敛成一处调用，避免重复写字段名 */
function G(
  slug: string, // 一级分组 slug
  capability: string, // 能力键
  nameZh: string, // 中文能力名
  nameEn: string, // 英文能力名
  hintZh: string, // 中文提示
  placeholderZh: string, // 中文占位
  rootDir: string, // 目录根
  ext: string, // 起步文件后缀
  extraZh: string, // 该组专属验收项（中文）
  extraEn: string, // 该组专属验收项（英文）
): BlueprintGroupMeta {
  return {
    slug, capability, nameZh, nameEn, hintZh,
    hintEn: 'Enter a project name or requirement notes; get the module-specific deliverables, tree, starter code and checklist',
    placeholderZh,
    placeholderEn: 'shop-app / requirement notes',
    rootDir, ext,
    deliverablesZh: [...DELIVERABLES_ZH], // 复制成可写数组，避免下游误改共享常量
    deliverablesEn: [...DELIVERABLES_EN],
    checksZh: [...CHECKS_COMMON_ZH, extraZh], // 通用三条 + 组专属一条
    checksEn: [...CHECKS_COMMON_EN, extraEn],
  }; // 返回分组模板
} // G 结束

/** 17 个分组的输出模板：顺序与分类树一致，便于后台按组展示 */
export const BLUEPRINT_GROUPS: readonly BlueprintGroupMeta[] = [
  // 前沿技术：量子电路与 Web3 需真实算力/链上环境
  G('frontier', 'catalog.frontier', '前沿技术起盘蓝图', 'Frontier stack blueprint', '输入项目名，生成该前沿条目的交付定义与起步代码', 'mim-frontier', 'packages/frontier', 'ts', '量子/链上片段需在模拟器或测试网跑通一次', 'Quantum or on-chain snippet runs once in a simulator or testnet'),
  // OpenHarmony：必须能在 DevEco 里编译
  G('openharmony', 'catalog.openharmony', 'OpenHarmony 组件脚手架', 'OpenHarmony scaffold', '输入组件名或页面需求，生成该 API 的 ArkTS 示例与验收项', 'MimEntry', 'entry/src/main/ets', 'ets', '在 DevEco Studio 模拟器或真机编译运行通过', 'Compiles and runs in DevEco Studio emulator or on device'),
  // 人工智能：密钥走环境变量
  G('ai', 'catalog.ai', 'AI 项目脚手架', 'AI project scaffold', '输入项目名，生成该 AI 方向的训练/推理/服务起步代码', 'mim-ai', 'services/ai', 'py', '离线可跑通，模型密钥只走环境变量', 'Runs offline with model keys supplied only via environment variables'),
  // 工业软件：参数口径与标准一致
  G('industry', 'catalog.industry', '工业软件起盘蓝图', 'Industrial software blueprint', '输入设备/型号/标准，生成该工业条目的配置或算法片段', 'mim-industry', 'packages/industry', 'md', '参数口径与所引标准一致，并在样例数据上验算', 'Parameters match the referenced standard and are validated on sample data'),
  // 区块链：测试网优先
  G('blockchain', 'catalog.blockchain', '区块链合约脚手架', 'Blockchain contract scaffold', '输入资产名称或合约名，生成该链上条目的合约与元数据', 'MimAsset', 'contracts', 'sol', '合约先在测试网部署并跑通一次读写', 'Contract is deployed and exercised on a testnet first'),
  // 微信开发：沙箱与测试号
  G('wechat', 'catalog.wechat', '微信开发脚手架', 'WeChat scaffold', '输入小程序/公众号名称，生成该微信条目的清单与代码', 'mim-wechat', 'apps/wechat', 'js', '在测试号或沙箱环境联调通过', 'Integrated and verified with a test account or sandbox'),
  // 企业应用：表结构与权限
  G('enterprise', 'catalog.enterprise', '企业应用起盘蓝图', 'Enterprise app blueprint', '输入业务域，生成该企业条目的数据模型与查询口径', 'mim-enterprise', 'packages/enterprise', 'sql', '表结构可建库，查询在样例数据上返回预期结果', 'Schema applies cleanly and queries return expected results on sample data'),
  // 建站系统：前台可访问
  G('store', 'catalog.storefront', '建站系统起盘蓝图', 'Site builder blueprint', '输入站点名，生成该建站条目的模型/配置与落地步骤', 'mim-site', 'apps/store', 'ts', '本地起站可访问，核心页面可点击走通', 'Site runs locally and core pages are clickable end to end'),
  // 应用工具：桌面/自动化可执行
  G('tools', 'catalog.tools', '应用工具起盘蓝图', 'Utility blueprint', '输入工具名或目标流程，生成该工具条目的实现骨架', 'mim-tool', 'packages/tools', 'ts', '命令可重复执行且结果一致（幂等）', 'Command is repeatable and idempotent'),
  // DevOps：配置可加载
  G('devops', 'catalog.devops', '运维工具起盘蓝图', 'Ops tooling blueprint', '输入服务名或告警目标，生成该运维条目的配置与验证命令', 'mim-ops', 'deploy', 'yml', '配置可被对应组件加载并重启成功', 'Config loads into the target component and restarts cleanly'),
  // 移动开发：模拟器跑通
  G('mobile', 'catalog.mobile', '移动开发脚手架', 'Mobile scaffold', '输入 App 名或组件名，生成该端条目的工程骨架', 'mim-mobile', 'apps/mobile', 'ts', '在模拟器或开发者工具中跑通一次', 'Runs once in an emulator or vendor devtool'),
  // 开发工具：脚本可直接执行
  G('devtools', 'catalog.devtools', '开发工具起盘蓝图', 'Devtool blueprint', '输入工具链环节，生成该条目的脚本与门禁配置', 'mim-devtools', 'scripts', 'mjs', '脚本可在空目录直接执行且失败时退出码非 0', 'Script runs in a clean checkout and exits non-zero on failure'),
  // 服务器应用：服务可起停
  G('server', 'catalog.server', '服务器组件起盘蓝图', 'Server component blueprint', '输入服务名或端口，生成该服务器条目的配置与运维命令', 'mim-server', 'deploy', 'conf', '服务可起停一次，健康检查返回 200', 'Service starts and stops once; health check returns 200'),
  // 数据库：可建库可备份
  G('database', 'catalog.database', '数据库组件起盘蓝图', 'Database blueprint', '输入库名或实例规格，生成该数据库条目的 DDL/运维口径', 'mim-db', 'db', 'sql', '在空库执行成功，备份文件可恢复', 'Applies cleanly on an empty database and backup restores'),
  // 游戏：玩法闭环
  G('game', 'catalog.game', '游戏开发起盘蓝图', 'Game blueprint', '输入游戏名或玩法关键词，生成该条目的循环/数值/渲染骨架', 'mim-game', 'apps/game', 'ts', '核心玩法闭环可玩，帧率不低于 30fps', 'Core loop is playable and frame rate stays above 30fps'),
  // 插件扩展：宿主可加载
  G('plugin', 'catalog.plugin', '插件扩展脚手架', 'Plugin scaffold', '输入插件名，生成该宿主环境的清单与入口代码', 'mim-plugin', 'extensions', 'json', '宿主可加载插件并触发一次入口命令', 'Host loads the plugin and triggers its entry command once'),
  // 其他开源：交付可演示
  G('misc', 'catalog.misc', '开源项目起盘蓝图', 'Open-source project blueprint', '输入项目名或命题，生成该条目的交付物与里程碑', 'mim-oss', 'packages/misc', 'md', '交付物可在 10 分钟内演示完整流程', 'Deliverable is demoable end to end within 10 minutes'),
]; // 分组模板结束：17 组

/** 按模块编码取蓝图：未登记返回 undefined，路由据此判断是否需要回落 */
export function blueprintOfCode(code: string): ModuleBlueprint | undefined {
  return MODULE_BLUEPRINTS.find((item) => item.code === code); // 线性查找：143 条规模足够
} // blueprintOfCode 结束

/** 按能力键取分组模板：handler 用它拿到目录根、交付物与验收清单 */
export function blueprintGroupOfCapability(capability: string): BlueprintGroupMeta | undefined {
  return BLUEPRINT_GROUPS.find((group) => group.capability === capability); // 能力键与分组一一对应
} // blueprintGroupOfCapability 结束

/** 按模块编码反查所属分组：模块编码前缀 cat.<slug>- 即为分组 slug */
export function blueprintGroupOfCode(code: string): BlueprintGroupMeta | undefined {
  const match = /^cat\.([a-z]+)-\d{2}$/.exec(code); // 严格匹配分类树编码格式
  if (!match) return undefined; // 非分类树编码不归属任何分组
  return BLUEPRINT_GROUPS.find((group) => group.slug === match[1]); // 按 slug 命中分组
} // blueprintGroupOfCode 结束
