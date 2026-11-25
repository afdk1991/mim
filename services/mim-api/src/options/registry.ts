// 站点选项注册表：以「主题选项后台」的形态统一声明全站可配置项。
// 设计目的：把散落在代码常量里的站点行为（布局宽度、悬浮按钮、移动 Tab、搜索热词、
// 社交分享、邮件发信、自定义 CSS 等）收拢成一份可校验、可持久化、可公开只读的声明式注册表。
// 后台面板直接按本文件渲染，新增一个开关只需要在这里加一条字段，无需再改视图与接口。
// 取值一律落在 site_settings 表的单条 JSON（key = options），因此不影响既有 theme / site / home 配置。

/** 字段类型：决定后台渲染的控件与后端校验口径 */
export type OptionFieldType = 'switch' | 'text' | 'textarea' | 'number' | 'select' | 'url';

/** 单个选项字段定义 */
export interface OptionField {
  key: string; // 字段键：全表唯一，直接作为存储 JSON 的属性名
  label: string; // 后台展示名
  type: OptionFieldType; // 控件类型
  defaultValue: string | number | boolean; // 默认值：未配置时运行时按此兜底，等同「现行行为」
  hint?: string; // 说明文案：解释该开关的实际作用面
  options?: Array<{ value: string; label: string }>; // 仅 select 使用：可选项
  min?: number; // 仅 number 使用：下界
  max?: number; // 仅 number 使用：上界
  publicRead?: boolean; // 是否允许免登录读取（前端启动配置需要，默认 false）
  secretPlaceholder?: boolean; // 密钥类字段：库里只存占位说明，真实值取自环境变量
}

/** 选项分组：对应主题选项后台的一节设置 */
export interface OptionGroup {
  key: string; // 分组键
  label: string; // 分组名
  description?: string; // 分组说明
  fields: OptionField[]; // 该分组下的字段
}

/** 选项页签：对应主题选项后台的一级页签 */
export interface OptionTab {
  key: string; // 页签键
  label: string; // 页签名
  groups: OptionGroup[]; // 页签下的分组
}

/** 全站选项注册表：当前先落地「Global & Features」页签（用户指定的锚点），
 *  其余 9 个页签在本轮以只读清单形式登记在文档中，后续批次逐页迁入本结构。 */
export const SITE_OPTION_TABS: OptionTab[] = [
  {
    key: 'global-features', // 与主题后台的 #tab=global-features 对齐
    label: 'Global & Features', // 全局与特性
    groups: [
      {
        key: 'identity', // Logo image 分组
        label: 'Logo 与站点图标',
        description: '站点图标、桌面图标与明暗两套 Logo；留空则前端回落文字品牌名',
        fields: [
          { key: 'site_icon_url', label: '站点图标', type: 'url', defaultValue: '', hint: 'favicon 与分享缩略图，建议 48×48 以上的方形图', publicRead: true },
          { key: 'desktop_icon_url', label: '桌面图标', type: 'url', defaultValue: '', hint: '添加到主屏时使用，建议 148×148', publicRead: true },
          { key: 'logo_light_url', label: 'Logo（浅色）', type: 'url', defaultValue: '', hint: '浅色主题下的文字 Logo 替换，建议透明底 PNG', publicRead: true },
          { key: 'logo_dark_url', label: 'Logo（深色）', type: 'url', defaultValue: '', hint: '深色主题下的文字 Logo 替换', publicRead: true },
        ],
      },
      {
        key: 'seo', // SEO 分组
        label: 'SEO',
        description: '页面标题与描述；未配置时使用前端内置默认文案',
        fields: [
          { key: 'seo_title', label: '站点标题', type: 'text', defaultValue: 'Mim', hint: '浏览器标题栏与分享卡片标题', publicRead: true },
          { key: 'seo_description', label: '站点描述', type: 'textarea', defaultValue: 'Mim —— 社区、内容与交易一体的站点', hint: 'meta description 与分享摘要', publicRead: true },
          { key: 'seo_keywords', label: '关键词', type: 'text', defaultValue: '', hint: '逗号分隔，仅写入 meta keywords' },
          { key: 'seo_og_image', label: '分享大图', type: 'url', defaultValue: '', hint: 'Open Graph 缩略图，建议 1200×630', publicRead: true },
        ],
      },
      {
        key: 'display', // Display & Layout 分组
        label: '显示与布局',
        description: '外壳宽度、右栏与页脚开关；改动即时作用于全站外壳',
        fields: [
          { key: 'layout_width', label: '内容区宽度', type: 'number', defaultValue: 1200, min: 960, max: 1600, hint: '桌面端两栏布局的容器宽度（px）', publicRead: true },
          { key: 'show_right_sidebar', label: '显示右侧栏', type: 'switch', defaultValue: true, hint: '关闭后桌面端只保留主栏', publicRead: true },
          { key: 'show_footer', label: '显示页脚', type: 'switch', defaultValue: true, hint: '关闭后整块隐藏多列页脚', publicRead: true },
          { key: 'sticky_header', label: '吸顶导航', type: 'switch', defaultValue: true, hint: '滚动时顶部导航固定', publicRead: true },
          { key: 'card_radius', label: '卡片圆角', type: 'select', defaultValue: 'md', options: [{ value: 'sm', label: '小' }, { value: 'md', label: '中' }, { value: 'lg', label: '大' }], hint: '作用于全站卡片圆角令牌', publicRead: true },
        ],
      },
      {
        key: 'search', // Search 分组
        label: '搜索',
        description: '占位文案、热门词与默认排序；排序权重仍由自研算法接口管理',
        fields: [
          { key: 'search_placeholder', label: '搜索框占位文案', type: 'text', defaultValue: '搜索帖子、版块、标签', publicRead: true },
          { key: 'search_hot_words', label: '热门搜索词', type: 'textarea', defaultValue: '漫剧\nAI 绘画\n前端', hint: '每行一个，点击即填入搜索框', publicRead: true },
          { key: 'search_default_sort', label: '默认排序', type: 'select', defaultValue: 'relevance', options: [{ value: 'relevance', label: '相关度' }, { value: 'latest', label: '最新' }], publicRead: true },
          { key: 'search_diversify_default', label: '默认去同质', type: 'switch', defaultValue: true, hint: '开启后同作者结果默认折叠', publicRead: true },
        ],
      },
      {
        key: 'mobile_tab', // Mobile Bottom Tab Bar 分组
        label: '移动底部 Tab',
        description: '移动端底部导航的整体开关与最多项数',
        fields: [
          { key: 'mobile_tab_enabled', label: '启用底部 Tab', type: 'switch', defaultValue: true, publicRead: true },
          { key: 'mobile_tab_items_max', label: '最多显示项数', type: 'number', defaultValue: 4, min: 1, max: 6, hint: '取后台一级导航的前 N 项，含未登录时的登录入口', publicRead: true },
        ],
      },
      {
        key: 'floating', // Floating Buttons 分组
        label: '悬浮按钮（右侧）',
        description: '回到顶部与联系入口；关闭后前端不再渲染悬浮层',
        fields: [
          { key: 'floating_enabled', label: '启用悬浮按钮', type: 'switch', defaultValue: true, publicRead: true },
          { key: 'floating_position', label: '位置', type: 'select', defaultValue: 'right', options: [{ value: 'right', label: '右下' }, { value: 'left', label: '左下' }], publicRead: true },
          { key: 'floating_back_to_top', label: '回到顶部', type: 'switch', defaultValue: true, publicRead: true },
          { key: 'floating_contact', label: '联系入口', type: 'switch', defaultValue: false, hint: '开启后展示联系按钮', publicRead: true },
          { key: 'floating_contact_url', label: '联系链接', type: 'url', defaultValue: '', hint: '站内路径或外链，未填则回落到社区版块', publicRead: true },
        ],
      },
      {
        key: 'locale', // Multilingual Translation 分组
        label: '多语言',
        description: '默认语言与前台语言切换入口；词典来自 @mim/i18n',
        fields: [
          { key: 'default_locale', label: '默认语言', type: 'select', defaultValue: 'zh', options: [{ value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }], hint: '登录用户仍按账号语言偏好显示', publicRead: true },
        ],
      },
      {
        key: 'social', // Social sharing 分组
        label: '社交分享',
        description: '分享按钮总开关与逐渠道显隐；分享统一走浏览器原生或站内链接拼接',
        fields: [
          { key: 'share_enabled', label: '启用分享', type: 'switch', defaultValue: true, publicRead: true },
          { key: 'share_wechat', label: '微信', type: 'switch', defaultValue: false, hint: '微信不提供网页直分享，仅展示扫码复制提示', publicRead: true },
          { key: 'share_weibo', label: '微博', type: 'switch', defaultValue: false, publicRead: true },
          { key: 'share_qq', label: 'QQ', type: 'switch', defaultValue: false, publicRead: true },
          { key: 'share_x', label: 'X / Twitter', type: 'switch', defaultValue: false, publicRead: true },
          { key: 'share_copy', label: '复制链接', type: 'switch', defaultValue: true, publicRead: true },
        ],
      },
      {
        key: 'email', // Email 分组
        label: '邮件',
        description: 'SMTP 连接参数；口令不入库，走环境变量，后台只保存非敏感的连接信息',
        fields: [
          { key: 'mail_enabled', label: '启用邮件发信', type: 'switch', defaultValue: false, hint: '关闭时所有发信请求直接返回未启用' },
          { key: 'smtp_host', label: 'SMTP 主机', type: 'text', defaultValue: '', hint: '例如 smtp.example.com' },
          { key: 'smtp_port', label: 'SMTP 端口', type: 'number', defaultValue: 587, min: 1, max: 65535 },
          { key: 'smtp_secure', label: '使用 TLS', type: 'switch', defaultValue: false, hint: '465 端口通常需要开启' },
          { key: 'smtp_user', label: 'SMTP 账号', type: 'text', defaultValue: '' },
          { key: 'smtp_from', label: '发信人地址', type: 'text', defaultValue: '', hint: '多数服务商要求与账号同域' },
          { key: 'smtp_password_ref', label: 'SMTP 口令来源', type: 'text', defaultValue: 'MIM_SMTP_PASSWORD', secretPlaceholder: true, hint: '仅记录环境变量名，明文口令不写入数据库' },
        ],
      },
      {
        key: 'custom', // Custom code 分组
        label: '自定义代码',
        description: '只开放自建 CSS 注入；脚本注入按构建期 CSP 哈希口径管理，不在运行期放开',
        fields: [
          { key: 'custom_css', label: '自定义 CSS', type: 'textarea', defaultValue: '', hint: '注入到全站 <style>，保存后前端下一个请求周期生效', publicRead: true },
        ],
      },
      {
        key: 'beian', // 备案信息分组
        label: '备案信息',
        description: '页脚版权行展示的 ICP 与公安备案号；留空则对应链接不渲染',
        fields: [
          { key: 'beian_icp', label: 'ICP 备案号', type: 'text', defaultValue: '苏ICP备2025161175号-1', hint: '页脚版权行展示，外链指向工信部备案系统', publicRead: true },
          { key: 'beian_police', label: '公安备案号', type: 'text', defaultValue: '苏公网安备32072202010512号', hint: '页脚版权行展示，外链指向公安备案系统', publicRead: true },
        ],
      },
    ],
  },
];

/** 字段类型集合：用于注册表自检，防止拼错类型导致后台渲染空白控件 */
const FIELD_TYPES: OptionFieldType[] = ['switch', 'text', 'textarea', 'number', 'select', 'url'];

/** 展开后的字段清单：一次遍历即拿到全部字段，供校验与默认值构建复用 */
function allFields(): OptionField[] {
  const list: OptionField[] = []; // 累加容器
  for (const tab of SITE_OPTION_TABS) { // 逐页签遍历
    for (const group of tab.groups) { // 逐分组遍历
      for (const field of group.fields) list.push(field); // 收集字段
    }
  }
  return list; // 返回全量字段
}

/** 注册表自检：键唯一、类型合法、select 必须带可选项、number 区间合理。
 *  注册表是运行期唯一真源，写错一条就会让后台渲染出坏控件，因此在模块加载时即抛错。 */
function assertRegistry(): void {
  const seen = new Set<string>(); // 键唯一性集合
  for (const field of allFields()) { // 逐字段检查
    if (seen.has(field.key)) throw new Error(`站点选项键重复：${field.key}`); // 键重复直接失败
    seen.add(field.key); // 登记键
    if (!FIELD_TYPES.includes(field.type)) throw new Error(`站点选项类型非法：${field.key} / ${String(field.type)}`); // 类型非法
    if (field.type === 'select' && (!field.options || field.options.length === 0)) throw new Error(`站点选项缺少候选项：${field.key}`); // 下拉必须有候选项
    if (field.type === 'number' && (typeof field.defaultValue !== 'number')) throw new Error(`数值字段默认值必须是数字：${field.key}`); // 数值默认值口径
  }
} // 自检结束

assertRegistry(); // 模块加载即自检

/** 选项取值类型：统一为标量，便于 JSON 落库与前端直接消费 */
export type OptionValue = string | number | boolean;
/** 选项映射：字段键 → 取值 */
export type OptionValues = Record<string, OptionValue>;

/** 默认值集合：等于各字段声明的 defaultValue，也是「未配置时」的运行时行为 */
export const OPTION_DEFAULTS: OptionValues = (() => {
  const values: OptionValues = {}; // 结果容器
  for (const field of allFields()) values[field.key] = field.defaultValue; // 逐字段落默认值
  return values; // 返回默认集合
})();

/** 公开字段清单：免登录可读的键集合，前端启动配置按此裁剪 */
export const PUBLIC_OPTION_KEYS: string[] = allFields().filter((field) => field.publicRead).map((field) => field.key);

/** 按字段声明清洗单值：类型不符一律回落默认值，避免脏数据把前端打崩 */
function sanitizeField(field: OptionField, input: unknown): OptionValue {
  switch (field.type) {
    case 'switch':
      return typeof input === 'boolean' ? input : field.defaultValue; // 只接受布尔
    case 'number': {
      const num = typeof input === 'number' ? input : Number.NaN; // 仅接受数字型入参
      if (!Number.isFinite(num)) return field.defaultValue; // 非有限数回落默认
      const min = field.min ?? Number.NEGATIVE_INFINITY; // 下界
      const max = field.max ?? Number.POSITIVE_INFINITY; // 上界
      return Math.min(Math.max(num, min), max); // 夹到声明区间
    }
    case 'select': {
      const allowed = (field.options ?? []).map((item) => item.value); // 候选项集合
      return typeof input === 'string' && allowed.includes(input) ? input : field.defaultValue; // 不在候选内回落默认
    }
    case 'url':
    case 'text':
    case 'textarea': {
      if (typeof input !== 'string') return field.defaultValue as string; // 非字符串回落默认
      const max = field.type === 'textarea' ? 20000 : field.type === 'url' ? 2048 : 500; // 各类型长度上限
      return input.slice(0, max); // 截断超长输入
    }
    default:
      return field.defaultValue; // 兜底
  }
} // 清洗函数结束

/** 合并存储值与默认值：缺失键补默认，类型不符回落默认，未知键丢弃（防止旧键泄漏到公开接口） */
export function mergeOptionValues(stored: Record<string, unknown> | null | undefined): OptionValues {
  const values: OptionValues = {}; // 结果容器
  for (const field of allFields()) { // 按注册表顺序逐字段取值
    const raw = stored ? stored[field.key] : undefined; // 取存储值
    values[field.key] = raw === undefined ? field.defaultValue : sanitizeField(field, raw); // 缺失补默认，存在则清洗
  }
  return values; // 返回合并结果
} // 合并函数结束

/** 校验并合并一次写入：只接受注册表内字段，返回「最终完整取值」与「本次真正改动的键」 */
export function applyOptionPatch(current: OptionValues, patch: Record<string, unknown>): { values: OptionValues; changed: string[] } {
  const values: OptionValues = { ...current }; // 以当前值为基底
  const changed: string[] = []; // 改动清单
  for (const field of allFields()) { // 只遍历注册表字段，未知键自动忽略
    if (!Object.prototype.hasOwnProperty.call(patch, field.key)) continue; // 未提交的键跳过
    const nextValue = sanitizeField(field, patch[field.key]); // 清洗入参
    if (nextValue !== current[field.key]) { // 仅在值确实变化时登记
      values[field.key] = nextValue; // 写入新值
      changed.push(field.key); // 登记改动
    }
  }
  return { values, changed }; // 返回结果
} // 合并写入结束

/** 裁剪公开视图：只保留 publicRead 字段，供 /site/options 免登录读取 */
export function pickPublicOptions(values: OptionValues): OptionValues {
  const out: OptionValues = {}; // 结果容器
  for (const key of PUBLIC_OPTION_KEYS) out[key] = values[key]; // 逐键复制公开字段
  return out; // 返回公开集合
} // 裁剪结束

/** 后台渲染用的注册表 schema：直接回传页签 / 分组 / 字段结构与默认值，前端不再硬编码 */
export function optionSchema(): { tabs: OptionTab[]; defaults: OptionValues; public_keys: string[] } {
  return { tabs: SITE_OPTION_TABS, defaults: OPTION_DEFAULTS, public_keys: PUBLIC_OPTION_KEYS }; // 结构原样回传
} // schema 结束
