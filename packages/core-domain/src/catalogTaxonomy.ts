/**
 * 模块商城分类树（19 个一级分类 / 205 个二级条目）与页面筛选项清单。
 *
 * 口径（用户 2026-11-10 指令）：**只把二级条目落成模块**，一级分类仅作为导航分组；
 * 条目顺序即页面展示顺序，`sort_order` 由「一级序号 × 100 + 二级序号」推导，
 * 因此新增条目时追加到所属分组末尾即可保持稳定排序，不必手工改权重。
 *
 * 本文件是纯数据契约（服务端种子与前端导航共用同一份定义），不含任何请求逻辑。
 */

/** 一级分类定义：slug 用于模块编码与接口过滤，license/language 是该组模块的默认属性 */
export interface CatalogGroupSeed {
  slug: string; // 一级分类英文标识，参与模块编码 `cat.<slug>.<序号>` 与 /modules?category= 过滤
  name: string; // 一级分类中文名称，导航栏直接展示
  license: string; // 该组模块默认开源许可（演示口径，取值来自 LICENSE_OPTIONS）
  language: string; // 该组模块默认编程语言（演示口径，取值来自 LANGUAGE_OPTIONS）
  items: readonly string[]; // 二级条目名称清单，每一条会生成一个模块
}

/**
 * 19 个一级分类；顺序与用户给定的分类树一致（「全部推荐项目」是导航里的「全部」页签，
 * 不是一个可承载模块的分类，故不在此列表内）。
 */
export const CATALOG_GROUPS: readonly CatalogGroupSeed[] = [
  { slug: 'frontier', name: '前沿技术', license: 'Apache-2.0', language: 'TypeScript', items: ['低代码', '科研论文', '量子计算', 'Web 3.0', '云原生'] }, // 5 项
  { slug: 'openharmony', name: 'OpenHarmony', license: 'Apache-2.0', language: '其他', items: ['按钮(Button)', '文本框(EditText)', '布局(Layout)', '图形图像(Image)', '进度条(Progress)', '菜单(Menu)', '弹窗(Popup)', '选择器(Selector)', '文本组件(TextView)', '列表组件(ListView)', '加载器(Loading)', '提醒(Notification)', '视图切换(View Transition)', '滑杆(Slider)', '图表(Chart)', '绘图组件(Draw)', '计数器(Counter)', '动画(Animate)', '验证码(Captcha)', '多媒体(Multimedia)', '条形码(Barcode)', '高级UI组件', '地图(Map)', 'OpenHarmony 游戏(Gaming)', '网络(Networking)', '通讯(Communication)', '支付(Payment)', '数据库(Database)', '硬件驱动(Drivers)', 'OpenHarmony 教程指南', 'OpenHarmony工具集', 'OpenHarmony 应用', '华为移动服务(HMS)', '权限(Permissions)', '工具包(Toolkit)', '底层组件', '手势控制(Gesture)'] }, // 37 项
  { slug: 'dev', name: '程序开发', license: 'Apache-2.0', language: 'Java', items: ['中英文分词', '支付开发包', '安全开发相关', '常用工具包', 'Excel工具包', '条形码/二维码', '模板引擎', '图形UI组件/框架', '网络开发包', '语音处理', '网络工具', '网络服务', '数据挖掘', '作业/任务调度', '编程语言/脚本语言', '缓存组件', 'Markdown工具包', '搜索引擎', '微服务', '工作流', '图表组件', '权限管理', '报表工具', '代码生成器', 'IoC/AOP框架', '图像处理', '规则引擎', 'JSON工具', '日志工具包', 'Spring Boot 扩展', '验证码', '算法/数学计算', 'Node 扩展', '流程引擎/工具', '动画开发', '移动通信', 'Tauri 插件'] }, // 37 项
  { slug: 'ai', name: '人工智能', license: 'Apache-2.0', language: 'Python', items: ['AI-人工智能', 'VR/AR', '机器学习/深度学习', '计算机视觉/人脸识别', '智能家居', '自然语言处理', '大模型', '推理框架', 'MCP', 'RAG知识库', '数据集'] }, // 11 项
  { slug: 'industry', name: '工业软件', license: 'GPL-3.0', language: 'C++', items: ['智能硬件', 'IOT/物联网/边缘计算', '车载应用', '车载系统', '自动驾驶/无人机', '机器人', '5G/通讯', '芯片开发', '隐私计算', '工程软件', 'CAD/计算机辅助设计', 'CAE/计算机辅助工程', 'MBSE/基于模型的系统工程', 'CAM/计算机辅助制造', 'EDA/电子设计自动化'] }, // 15 项
  { slug: 'blockchain', name: '区块链', license: 'MIT', language: 'Go', items: ['数字货币', 'NFT'] }, // 2 项
  { slug: 'wechat', name: '微信开发', license: 'MIT', language: 'JavaScript', items: ['微信开发包', '微信小程序/小游戏', '微信应用', '微信小游戏'] }, // 4 项
  { slug: 'enterprise', name: '企业应用', license: 'MIT', language: 'Java', items: ['任务/项目管理', '企业应用系统', 'BI-商业智能', '财务/金融/股票证券', 'GIS/地图/导航/定位'] }, // 5 项
  { slug: 'store', name: '建站系统', license: 'GPL-3.0', language: 'PHP', items: ['CMS建站系统', '新零售/网店/商城', 'BBS论坛/问答', '博客系统', '问卷调查/表单系统', 'SNS社交系统', '学校/教学管理', '相册/画廊/照片', 'RSS/Atom工具'] }, // 9 项
  { slug: 'tools', name: '应用工具', license: 'GPL-3.0', language: 'C#', items: ['文件管理工具', '多媒体', '文本编辑', 'IM即时通讯/聊天', '应用软件', 'RPA-机器人过程自动化'] }, // 6 项
  { slug: 'web', name: 'WEB应用开发', license: 'MIT', language: 'JavaScript', items: ['Web开发框架', 'jQuery插件', 'WebUI组件/框架', 'JavaScript工具包', 'RESTful项目', '后台管理框架', '网站主题', 'Vue扩展组件', 'Web爬虫', 'OAuth/单点登录/统一认证', 'Angular扩展', 'Bootstrap扩展插件', 'React 组件', 'RPC开发框架', 'API 网关/接口管理', '短网址', 'layui 组件'] }, // 17 项
  { slug: 'devops', name: 'DevOps/运维/网管', license: 'Apache-2.0', language: 'Shell', items: ['网管工具', '监控系统', 'DevOps工具'] }, // 3 项
  { slug: 'mobile', name: '手机/移动开发', license: 'Apache-2.0', language: 'Kotlin', items: ['Android组件/项目', 'iOS组件', '移动App', '支付宝小程序', '百度小程序', 'PhoneGap/Cordova 插件', '跨平台移动开发', '快应用', 'TV/电视开发', 'uniapp 开源组件'] }, // 10 项
  { slug: 'devtools', name: '开发工具', license: 'MIT', language: 'Java', items: ['版本管理系统', '开发/调试', 'Wiki/文档工具', '编译/构建/部署', 'Maven 插件', 'Gulp 扩展', '测试工具', '代码扫描分析'] }, // 8 项
  { slug: 'server', name: '服务器应用', license: 'Apache-2.0', language: 'Go', items: ['分布式服务/框架', '消息服务器/消息队列', 'Docker相关', '容器/虚拟机', 'Nginx扩展模块', '大数据', '云计算', '一键安装包', 'OpenResty 扩展', '系统性能优化', 'Serverless', '分布式存储系统'] }, // 12 项
  { slug: 'database', name: '数据库相关', license: 'Apache-2.0', language: 'SQL', items: ['数据库开发包', '数据库服务', '数据库管理/监控'] }, // 3 项
  { slug: 'game', name: '游戏/娱乐', license: 'MIT', language: 'C#', items: ['游戏', '游戏开发', '3D引擎'] }, // 3 项
  { slug: 'plugin', name: '插件和扩展', license: 'MIT', language: 'TypeScript', items: ['Chrome扩展', 'WordPress 扩展', 'Eclipse插件', 'IDEA 插件', 'Firefox扩展', 'Safari 插件', 'Visual Studio Code 扩展', 'Jenkins 插件'] }, // 8 项
  { slug: 'misc', name: '其他开源', license: 'MIT', language: '其他', items: ['高仿项目', '图书/手册/教程', 'ACM/OJ 项目', '操作系统', '教学管理', '教程配套代码', 'RISC-V 开发', '生物/医疗/健康', '2020公益黑客马拉松', '新冠病毒相关开源'] }, // 10 项
]; // 分类树结束：合计 19 个一级分类、205 个二级条目

/** 二级条目总数：测试与文档直接引用该常量，避免各处手写数字漂移 */
export const CATALOG_ITEM_TOTAL = CATALOG_GROUPS.reduce((sum, group) => sum + group.items.length, 0); // 当前应为 205

/** 一级分类总数：用于导航断言与后台概览 */
export const CATALOG_GROUP_TOTAL = CATALOG_GROUPS.length; // 当前应为 19

/** 页面「开源许可」筛选项：48 项，顺序与用户给定清单一致 */
export const LICENSE_OPTIONS: readonly string[] = [
  'MulanPSL-2.0', '0BSD', 'AFL-3.0', 'AGPL-3.0', 'Apache-2.0', 'Artistic-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause',
  'BSL-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'CECILL-2.1', 'CERN-OHL-P-2.0', 'CERN-OHL-S-2.0', 'CERN-OHL-W-2.0', 'ECL-2.0', 'EPL-1.0',
  'EPL-2.0', 'EUPL-1.1', 'EUPL-1.2', 'GFDL-1.3', 'GPL-2.0', 'GPL-3.0', 'ISC', 'LGPL-2.1', 'LGPL-3.0', 'LPPL-1.3c',
  'MIT', 'MIT-0', 'MPL-2.0', 'MS-PL', 'MS-RL', 'MulanPSL-1.0', 'MulanPubL-1.0', 'MulanPubL-2.0', 'NCSA', 'ODbL-1.0',
  'OFL-1.1', 'OSL-3.0', 'PostgreSQL', 'UPL-1.0', 'Unlicense', 'Vim', 'WTFPL', 'Zlib',
]; // 许可清单结束：合计 48 项

/** 页面「编程语言」筛选项：87 项，顺序与用户给定清单一致 */
export const LANGUAGE_OPTIONS: readonly string[] = [
  'Java', 'JavaScript', 'HTML', 'CSS', 'Python', 'Shell', 'TypeScript', 'C', 'C++', 'C#',
  'PHP', 'Go', 'Objective-C', 'Kotlin', 'Android', 'Ruby', 'PowerShell', 'Swift', 'Assembly', 'Dart',
  'Rust', 'NodeJS', 'Lua', 'Perl', 'Matlab', 'HTML/CSS', 'C/C++', 'TeX/LaTeX', 'SQL', 'XML',
  '汇编', '易语言', '微信', '其他', 'Scala', 'Groovy', 'Verilog', 'XSLT', 'R', 'QML',
  'Pascal', 'Docker', 'CoffeeScript', 'FORTRAN', 'Erlang', 'Smalltalk', 'M', 'Emacs Lisp', 'ActionScript', 'VHDL',
  'Delphi', 'Common Lisp', 'Scheme', 'Visual Basic', 'ASP', 'Clojure', 'LiveScript', 'Julia', 'Awk', 'Haskell',
  'Elixir', 'Pawn', 'AutoHotkey', 'D', 'YAML', 'Standard ML', 'Coq', 'Logos', 'Ada', 'OCaml',
  'Prolog', 'Puppet', 'Arduino', 'VimL', 'Haxe', 'Vala', 'Scilab', 'ColdFusion', 'Crystal', 'Racket',
  'Lisp', 'Slash', 'Eiffel', 'eC', 'DOT', 'Zephir', 'Nemerle',
]; // 语言清单结束：合计 87 项

/** 排序方式枚举：接口 sort 参数只接受这三个值 */
export const CATALOG_SORT_MODES = ['stars', 'recommended', 'updated'] as const; // Stars / 最新推荐 / 最近更新

/** 英文名称表：key 为一级 slug，items 与 CATALOG_GROUPS 的同组条目顺序**逐项对齐**（顺序错位会被测试抓到） */
export interface CatalogGroupEn {
  name: string; // 一级分类英文名
  items: readonly string[]; // 二级条目英文名，顺序与中文清单一一对应
}

/** 19 组英文名称：与中文清单同序，供 global 区模块名 / 英文站点导航使用 */
export const CATALOG_GROUP_EN: Record<string, CatalogGroupEn> = {
  frontier: {
    name: 'Frontier technology',
    items: ['Low-code', 'Research papers', 'Quantum computing', 'Web 3.0', 'Cloud native'],
  },
  openharmony: {
    name: 'OpenHarmony',
    items: [
      'Button', 'Text box (EditText)', 'Layout', 'Graphics & images', 'Progress bar', 'Menu', 'Popup', 'Selector',
      'Text component (TextView)', 'List component (ListView)', 'Loader (Loading)', 'Notification', 'View transition', 'Slider',
      'Chart', 'Drawing component (Draw)', 'Counter', 'Animation', 'CAPTCHA', 'Multimedia', 'Barcode', 'Advanced UI components',
      'Map', 'OpenHarmony gaming (Gaming)', 'Networking', 'Communication', 'Payment', 'Database', 'Hardware drivers',
      'OpenHarmony tutorials & guides', 'OpenHarmony toolkit', 'OpenHarmony apps', 'HMS (Huawei Mobile Services)',
      'Permissions', 'Toolkit', 'Low-level components', 'Gesture control',
    ],
  },
  dev: {
    name: 'Software development',
    items: [
      'Chinese/English word segmentation', 'Payment SDK', 'Security development', 'Common utility libraries', 'Excel toolkit',
      'Barcode / QR code', 'Template engine', 'Graphical UI components & frameworks', 'Network development kit', 'Speech processing',
      'Network tools', 'Network services', 'Data mining', 'Job / task scheduling', 'Programming & scripting languages',
      'Cache components', 'Markdown toolkit', 'Search engine', 'Microservices', 'Workflow', 'Chart components',
      'Permission management', 'Reporting tools', 'Code generators', 'IoC / AOP frameworks', 'Image processing', 'Rule engine',
      'JSON tools', 'Logging toolkit', 'Spring Boot extensions', 'CAPTCHA', 'Algorithms & math computation', 'Node extensions',
      'Process engine / tools', 'Animation development', 'Mobile communications', 'Tauri plugins',
    ],
  },
  ai: {
    name: 'Artificial intelligence',
    items: [
      'AI — artificial intelligence', 'VR / AR', 'Machine learning / deep learning', 'Computer vision / face recognition',
      'Smart home', 'Natural language processing', 'Large language models', 'Inference frameworks', 'MCP', 'RAG knowledge base', 'Datasets',
    ],
  },
  industry: {
    name: 'Industrial software',
    items: [
      'Smart hardware', 'IoT / edge computing', 'In-vehicle apps', 'In-vehicle systems', 'Autonomous driving / drones', 'Robotics',
      '5G / communications', 'Chip development', 'Privacy computing', 'Engineering software', 'CAD (computer-aided design)',
      'CAE (computer-aided engineering)', 'MBSE (model-based systems engineering)', 'CAM (computer-aided manufacturing)',
      'EDA (electronic design automation)',
    ],
  },
  blockchain: { name: 'Blockchain', items: ['Digital currency', 'NFT'] },
  wechat: {
    name: 'WeChat development',
    items: ['WeChat SDK', 'WeChat mini programs & mini games', 'WeChat apps', 'WeChat mini games'],
  },
  enterprise: {
    name: 'Enterprise applications',
    items: [
      'Task & project management', 'Enterprise applications', 'BI — business intelligence',
      'Finance · stocks & securities', 'GIS · maps · navigation · positioning',
    ],
  },
  store: {
    name: 'Site builders',
    items: [
      'CMS site builders', 'New retail · online stores', 'BBS forums & Q&A', 'Blog systems', 'Surveys & forms',
      'SNS social systems', 'School & teaching management', 'Photo galleries', 'RSS & Atom tools',
    ],
  },
  tools: {
    name: 'Utilities',
    items: [
      'File management tools', 'Multimedia', 'Text editors', 'IM & chat', 'Application software',
      'RPA — robotic process automation',
    ],
  },
  web: {
    name: 'Web development',
    items: [
      'Web frameworks', 'jQuery plugins', 'WebUI components & frameworks', 'JavaScript toolkits', 'RESTful projects',
      'Admin dashboard frameworks', 'Website themes', 'Vue extensions', 'Web crawlers', 'OAuth · SSO · unified auth',
      'Angular extensions', 'Bootstrap plugins', 'React components', 'RPC frameworks', 'API gateways · interface management',
      'URL shorteners', 'layui components',
    ],
  },
  devops: { name: 'DevOps · operations', items: ['Network administration tools', 'Monitoring systems', 'DevOps tools'] },
  mobile: {
    name: 'Mobile development',
    items: [
      'Android components & projects', 'iOS components', 'Mobile apps', 'Alipay mini programs', 'Baidu mini programs',
      'PhoneGap · Cordova plugins', 'Cross-platform mobile development', 'Quick apps', 'TV development',
      'uniapp open-source components',
    ],
  },
  devtools: {
    name: 'Developer tools',
    items: [
      'Version control systems', 'Development & debugging', 'Wiki & documentation tools', 'Build & deployment',
      'Maven plugins', 'Gulp extensions', 'Testing tools', 'Code scanning & analysis',
    ],
  },
  server: {
    name: 'Server applications',
    items: [
      'Distributed services & frameworks', 'Message servers & queues', 'Docker-related', 'Containers & virtual machines',
      'Nginx modules', 'Big data', 'Cloud computing', 'One-click installers', 'OpenResty extensions',
      'System performance tuning', 'Serverless', 'Distributed storage',
    ],
  },
  database: {
    name: 'Databases',
    items: ['Database SDKs', 'Database services', 'Database management & monitoring'],
  },
  game: { name: 'Games & entertainment', items: ['Games', 'Game development', '3D engines'] },
  plugin: {
    name: 'Plugins & extensions',
    items: [
      'Chrome extensions', 'WordPress plugins', 'Eclipse plugins', 'IDEA plugins', 'Firefox add-ons',
      'Safari extensions', 'Visual Studio Code extensions', 'Jenkins plugins',
    ],
  },
  misc: {
    name: 'Other open source',
    items: [
      'Clone projects', 'Books · manuals · tutorials', 'ACM / OJ projects', 'Operating systems', 'Teaching management',
      'Companion code for tutorials', 'RISC-V development', 'Bio · medical · health', '2020 charity hackathon',
      'COVID-19 open-source projects',
    ],
  },
}; // 英文名称表结束：19 组、205 条，与中文清单逐项同序

/** 取一级分类英文名：缺失时回落中文名，保证渲染不断链 */
export function catalogGroupNameEn(slug: string): string {
  return CATALOG_GROUP_EN[slug]?.name ?? slug; // 回落口径：未登记英文名时返回 slug，便于暴露缺口
} // catalogGroupNameEn 结束

/** 取二级条目英文名：按组内下标对齐，越界或缺失时回落中文条目名 */
export function catalogItemNameEn(groupSlug: string, index: number, fallback: string): string {
  return CATALOG_GROUP_EN[groupSlug]?.items[index] ?? fallback; // 回落中文名，避免出现空名
} // catalogItemNameEn 结束

/** 排序方式联合类型：路由与前端共用，传错值编译期即可发现 */
export type CatalogSortMode = (typeof CATALOG_SORT_MODES)[number];

/** 单个二级条目派生出的模块定义：编码、名称、默认属性与排序权重都在这里一次算清 */
export interface CatalogModuleSeed {
  code: string; // 模块编码 `cat.<一级slug>.<两位序号>`，区域内唯一
  group_slug: string; // 所属一级分类 slug
  item_slug: string; // 二级条目 slug（一级slug + 序号，供 ?category= 精确过滤）
  name: string; // 二级条目中文名，作为模块 zh-CN 名称
  name_en: string; // 二级条目英文名，作为模块 en-US 名称（取自 CATALOG_GROUP_EN，缺失回落中文）
  license: string; // 开源许可（演示口径）
  language: string; // 编程语言（演示口径）
  sort_order: number; // 排序权重：一级序号 × 100 + 二级序号
  stars: number; // 演示用「Star 数」：由序号的确定性算式得出，保证同一份数据每次结果一致
}

/**
 * 展开成模块种子清单：纯函数，服务端建库与测试共用，避免两处各自拼装编码。
 * 编码/序号规则全在此实现，新增分类或条目只需改 CATALOG_GROUPS。
 */
export function buildCatalogModuleSeeds(): CatalogModuleSeed[] {
  const seeds: CatalogModuleSeed[] = []; // 结果收集器
  CATALOG_GROUPS.forEach((group, groupIndex) => { // 遍历一级分类，索引从 0 开始
    const groupNo = groupIndex + 1; // 一级序号从 1 开始，便于人工阅读权重
    group.items.forEach((item, itemIndex) => { // 遍历二级条目
      const itemNo = itemIndex + 1; // 二级序号从 1 开始
      const itemSlug = `${group.slug}-${String(itemNo).padStart(2, '0')}`; // 二级标识，如 `store-02`
      seeds.push({ // 生成一条模块种子
        code: `cat.${itemSlug}`, // 模块编码，如 `cat.store-02`
        group_slug: group.slug, // 归属一级分类
        item_slug: itemSlug, // 二级标识，供分类过滤使用
        name: item, // 模块名即二级条目名
        name_en: catalogItemNameEn(group.slug, itemIndex, item), // 英文名按组内下标对齐取，缺失回落中文
        license: group.license, // 继承一级分类的默认许可
        language: group.language, // 继承一级分类的默认语言
        sort_order: groupNo * 100 + itemNo, // 稳定权重：分组内按条目顺序
        stars: (((groupNo * 7 + itemNo * 13) % 90) + 10) * 100, // 1000–10000 之间的确定性演示值
      }); // 单条结束
    }); // 二级遍历结束
  }); // 一级遍历结束
  return seeds; // 返回完整清单（205 条）
} // buildCatalogModuleSeeds 结束
