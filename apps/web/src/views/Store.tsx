// 商城视图：两级分类导航（19 个一级分类 / 205 个二级模块）+ 排序 / 开源许可 / 编程语言筛选 + 分页 + 我的权益与订单
import { useEffect, useRef, useState } from 'react'; // 本地状态钩子：分类、排序、筛选项、分页、展开项、忙碌标记等；useRef/useEffect 供依赖链图挂载与销毁 G6 实例
import type { FormEvent } from 'react'; // 表单事件类型：搜索行 onSubmit 入参（仅类型导入，不产生运行时开销）
import { Graph } from '@antv/g6'; // 依赖链可视化：G6 v5 图实例，在详情面板内渲染「前置模块 → 当前模块」有向图
import type { GraphData } from '@antv/g6'; // 图数据类型：nodes / edges 结构，与后端模块编码一一对应
import * as echarts from 'echarts'; // 价格历史折线图：ECharts 6 在详情面板内绘制售价随生效时间的趋势线
// 引入 Locale 类型：约束语言取值为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// 引入核心域常量：排序枚举 / 48 项开源许可 / 87 种编程语言，与后端共用同一份定义避免口径漂移
import { CATALOG_SORT_MODES, LANGUAGE_OPTIONS, LICENSE_OPTIONS, capabilityOfKey } from '@mim/core-domain'; // 追加能力定义：详情面板据此渲染「工具」区块（与后端共用同一份清单）
// 引入接口客户端、错误类型（识别依赖缺失）、错误文案翻译器与会话读取工具（判断匿名态）
import { ApiError, api, errorText, getSession } from '../api';
// 仅类型导入：购物车摘要（页头角标与加购反馈用）
import type { CartSummary } from '../api';
// 引入通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';
// 引入编程式跳转：匿名访客在升级身份时跳转登录伪视图
import { navigate } from '../router';
// 商品视觉：分类封面图 + 按详情实时生成的「商品参数详情图」（SVG data URL）
import { categoryCoverUrl, specPosterUrl } from '../catalogArt';

// 组件对外契约：商城文案跟随全局语言
interface Props {
  // 当前界面语言
  locale: Locale;
}

// 排序方式类型：与后端 sort 参数取值一致
type CatalogSort = 'stars' | 'recommended' | 'updated';

// 每页条数：三列网格取 12 条，避免出现孤行
const PAGE_SIZE = 12;

// 排序方式文案：三档与用户口径一一对应（Stars / 最新推荐 / 最近更新）
const SORT_LABEL: Record<CatalogSort, { zh: string; en: string }> = {
  stars: { zh: 'Stars', en: 'Stars' }, // 按 Star 数从高到低
  recommended: { zh: '最新推荐', en: 'Recommended' }, // 按人工推荐权重
  updated: { zh: '最近更新', en: 'Recently updated' }, // 按创建时间倒序
}; // 排序文案表结束

/** 能力选项定义：不同能力暴露给用户的可调参数；value 直接作为 options 字段值 */
interface CapabilityOptionSpec {
  optionKey: string; // 传入 options 的字段名；'op:direction' 表示拆成 op 与 direction 两个字段
  numeric: boolean; // value 是否按数字下发（尺寸 / 条数）
  items: Array<{ value: string; zh: string; en: string }>; // 下拉项：值 + 中英文文案
} // 选项定义结束

// 六条已实现能力对应的可选参数（与 services/mim-api/src/capabilities.ts 的读取口径一一对应）
const CAPABILITY_OPTIONS: Record<string, CapabilityOptionSpec> = {
  'json.format': { optionKey: 'mode', numeric: false, items: [ // JSON 工具：三种模式
    { value: 'pretty', zh: '格式化', en: 'Pretty-print' }, // 默认缩进输出
    { value: 'minify', zh: '压缩', en: 'Minify' }, // 去掉空白
    { value: 'validate', zh: '仅校验', en: 'Validate only' }, // 只回合法性
  ] }, // JSON 工具结束
  'text.encode': { optionKey: 'op:direction', numeric: false, items: [ // 编解码：方式 × 方向
    { value: 'base64:encode', zh: 'Base64 编码', en: 'Base64 encode' },
    { value: 'base64:decode', zh: 'Base64 解码', en: 'Base64 decode' },
    { value: 'base64url:encode', zh: 'Base64URL 编码', en: 'Base64URL encode' },
    { value: 'base64url:decode', zh: 'Base64URL 解码', en: 'Base64URL decode' },
    { value: 'hex:encode', zh: 'Hex 编码', en: 'Hex encode' },
    { value: 'hex:decode', zh: 'Hex 解码', en: 'Hex decode' },
    { value: 'url:encode', zh: 'URL 编码', en: 'URL encode' },
    { value: 'url:decode', zh: 'URL 解码', en: 'URL decode' },
  ] }, // 编解码结束
  'text.hash': { optionKey: 'algo', numeric: false, items: [ // 摘要算法
    { value: 'sha256', zh: 'SHA-256', en: 'SHA-256' },
    { value: 'sha512', zh: 'SHA-512', en: 'SHA-512' },
    { value: 'sha1', zh: 'SHA-1', en: 'SHA-1' },
    { value: 'md5', zh: 'MD5', en: 'MD5' },
  ] }, // 摘要结束
  'qrcode.generate': { optionKey: 'size', numeric: true, items: [ // 二维码尺寸（像素）
    { value: '256', zh: '256 px', en: '256 px' },
    { value: '512', zh: '512 px', en: '512 px' },
    { value: '1024', zh: '1024 px', en: '1024 px' },
  ] }, // 二维码结束
  'cron.describe': { optionKey: 'count', numeric: true, items: [ // 推算次数
    { value: '3', zh: '未来 3 次', en: 'Next 3 runs' },
    { value: '5', zh: '未来 5 次', en: 'Next 5 runs' },
    { value: '10', zh: '未来 10 次', en: 'Next 10 runs' },
  ] }, // cron 结束
  'csv.json': { optionKey: 'mode', numeric: false, items: [ // CSV/JSON 转换方向
    { value: 'tojson', zh: 'CSV → JSON', en: 'CSV → JSON' }, // 默认方向
    { value: 'tocsv', zh: 'JSON → CSV', en: 'JSON → CSV' }, // 反向
  ] }, // CSV 互转结束
  'yaml.json': { optionKey: 'mode', numeric: false, items: [ // YAML/JSON 转换方向
    { value: 'yaml2json', zh: 'YAML → JSON', en: 'YAML → JSON' },
    { value: 'json2yaml', zh: 'JSON → YAML', en: 'JSON → YAML' },
  ] }, // YAML 互转结束
  'report.table': { optionKey: 'format', numeric: false, items: [ // 报表输出格式
    { value: 'html', zh: 'HTML 表格', en: 'HTML table' },
    { value: 'markdown', zh: 'Markdown 表格', en: 'Markdown table' },
  ] }, // 报表格式结束
  'chart.svg': { optionKey: 'chart', numeric: false, items: [ // 图表类型
    { value: 'bar', zh: '柱状图', en: 'Bar chart' },
    { value: 'line', zh: '折线图', en: 'Line chart' },
  ] }, // 图表类型结束
  'sql.format': { optionKey: 'dialect', numeric: false, items: [ // SQL 方言
    { value: 'sql', zh: '标准 SQL', en: 'Standard SQL' },
    { value: 'mysql', zh: 'MySQL', en: 'MySQL' },
    { value: 'postgresql', zh: 'PostgreSQL', en: 'PostgreSQL' },
    { value: 'sqlite', zh: 'SQLite', en: 'SQLite' },
    { value: 'tsql', zh: 'T-SQL', en: 'T-SQL' },
  ] }, // SQL 方言结束
  'code.stats': { optionKey: 'lang', numeric: false, items: [ // 注释语法按语言切换
    { value: 'ts', zh: 'TypeScript', en: 'TypeScript' },
    { value: 'js', zh: 'JavaScript', en: 'JavaScript' },
    { value: 'py', zh: 'Python', en: 'Python' },
    { value: 'sh', zh: 'Shell', en: 'Shell' },
    { value: 'sql', zh: 'SQL', en: 'SQL' },
  ] }, // 代码语言结束
  'image.dataurl': { optionKey: 'mime', numeric: false, items: [ // Base64 转 dataURL 时的 MIME
    { value: 'image/png', zh: 'PNG', en: 'PNG' },
    { value: 'image/jpeg', zh: 'JPEG', en: 'JPEG' },
    { value: 'image/webp', zh: 'WebP', en: 'WebP' },
    { value: 'image/svg+xml', zh: 'SVG', en: 'SVG' },
  ] }, // MIME 结束
  'math.eval': { optionKey: 'precision', numeric: true, items: [ // 结果保留小数位
    { value: '2', zh: '2 位小数', en: '2 decimals' },
    { value: '6', zh: '6 位小数', en: '6 decimals' },
    { value: '10', zh: '10 位小数', en: '10 decimals' },
  ] }, // 精度结束
  'captcha.svg': { optionKey: 'length', numeric: true, items: [ // 验证码位数
    { value: '4', zh: '4 位', en: '4 chars' },
    { value: '6', zh: '6 位', en: '6 chars' },
    { value: '8', zh: '8 位', en: '8 chars' },
  ] }, // 验证码位数结束
  'diff.text': { optionKey: 'context', numeric: true, items: [ // diff 上下文行数
    { value: '3', zh: '上下文 3 行', en: 'Context 3' },
    { value: '1', zh: '上下文 1 行', en: 'Context 1' },
    { value: '0', zh: '不含上下文', en: 'No context' },
  ] }, // diff 上下文结束
  'cite.format': { optionKey: 'type', numeric: false, items: [ // 文献类型
    { value: 'book', zh: '专著 [M]', en: 'Book [M]' },
    { value: 'journal', zh: '期刊 [J]', en: 'Journal [J]' },
    { value: 'web', zh: '电子资源 [EB/OL]', en: 'Web [EB/OL]' },
  ] }, // 文献类型结束
}; // 能力选项表结束


// 模块卡片结构：与 /modules 接口返回的字段一一对应
interface ModuleCard {
  code: string; // 模块唯一编码，作为列表 key 与解锁入参
  name: Record<string, string>; // 模块名称的多语言映射，键为 locale
  summary: Record<string, string>; // 模块简介的多语言映射
  unlock_mode: 'one_time'; // 解锁方式：当前仅支持一次性买断
  region: string; // 模块归属区域，用于区分中国区与海外区
  status: string; // 模块状态，例如上架 / 下架
  requires: string[]; // 前置模块编码列表：需先解锁这些模块才能购买本模块
  category_slug: string | null; // 所属二级分类标识（分类树改造新增）
  license: string | null; // 开源许可（筛选维度）
  language: string | null; // 编程语言（筛选维度）
  stars: number; // Star 数（Stars 排序依据）
  capability: string | null; // 真实能力键；null 表示该模块功能规划中（不给解锁入口）
  current_price: { currency: string; amount_minor: number } | null; // 当前售价；null 表示免费模块
}

// 模块详情类型：由接口方法返回类型推导，字段与后端保持一致、不易漂移
type ModuleDetail = Awaited<ReturnType<typeof api.catalog.getModule>>;

// 分类导航节点类型：由分类接口返回类型推导
type TaxonomyGroup = Awaited<ReturnType<typeof api.catalog.getTaxonomy>>['groups'][number];

// 从多语言映射中挑选当前语言的文案，缺失时逐级兜底
function pick(locale: Locale, map: Record<string, string> | undefined, fallback = ''): string {
  // 映射为空时直接返回兜底值，避免后续取值报错
  if (!map) return fallback;
  // 优先当前语言，其次中文、英文，再退化为任意一种语言，最后用兜底值
  return map[locale] ?? map['zh-CN'] ?? map['en-US'] ?? Object.values(map)[0] ?? fallback;
}

// 分类名称：英文站点优先用接口的 name_en，缺失才回落中文名（不做空文案兜底，便于暴露翻译缺口）
function categoryName(locale: Locale, name: string, nameEn: string | null | undefined): string {
  // 中文站点始终用中文名
  if (locale !== 'en-US') return name;
  // 英文站点优先英文名，未登记时回落中文名
  return nameEn && nameEn.trim().length > 0 ? nameEn : name;
}

// 权益状态文案：与后端枚举一一对应，中英双语
const ENT_STATUS_LABEL: Record<string, { zh: string; en: string }> = {
  // 生效中：权益可用
  active: { zh: '生效中', en: 'Active' },
  // 已过期：到期自然失效
  expired: { zh: '已过期', en: 'Expired' },
  // 已回收：被管理端收回
  revoked: { zh: '已回收', en: 'Revoked' },
}; // 权益状态文案表结束

// 权益状态徽标样式：复用角色徽标配色（绿=正常、紫=中性退场、灰=回收）
const ENT_STATUS_BADGE: Record<string, string> = {
  // 生效中用绿色
  active: 'role-editor',
  // 已过期用紫色（中性）
  expired: 'role-viewer',
  // 已回收用默认灰
  revoked: '',
}; // 权益徽标映射结束；未列出状态回退默认样式

// 模块状态文案：目录接口理论上只返回已上架，详情面板仍做完整映射
const MODULE_STATUS_LABEL: Record<string, { zh: string; en: string }> = { // 草稿：仅后台可见
  draft: { zh: '草稿', en: 'Draft' },
  // 已上架
  active: { zh: '已上架', en: 'Active' },
  // 已下架：终态
  archived: { zh: '已下架', en: 'Archived' },
}; // 模块状态文案表结束

// 订单状态文案：与 module_orders.status 的 CHECK 约束一一对应
const ORDER_STATUS_LABEL: Record<string, { zh: string; en: string }> = {
  // 待结算：已下单但尚未完成支付/人工结算
  pending: { zh: '待结算', en: 'Pending settlement' },
  // 已结算：权益已发放
  paid: { zh: '已结算', en: 'Settled' },
  // 已取消：用户主动取消，可重新下单
  cancelled: { zh: '已取消', en: 'Cancelled' },
}; // 订单状态文案表结束

// 订单状态徽标样式：待结算用中性灰、已结算复用绿色、已取消用默认灰
const ORDER_STATUS_BADGE: Record<string, string> = {
  // 待结算：尚未完成，弱化展示
  pending: '',
  // 已结算：与「已解锁」同色，表达可用
  paid: 'role-editor',
  // 已取消：默认灰
  cancelled: '',
}; // 订单徽标映射结束

// 把时间格式化为本地可读串；无效输入原样返回，避免抛错
function formatTime(locale: Locale, iso: string): string {
  // 解析 ISO 时间
  const date = new Date(iso);
  // 非法日期原样返回原文，便于排查脏数据
  if (Number.isNaN(date.getTime())) return iso;
  // 按当前语言输出本地时间，关闭 12 小时制避免歧义
  return date.toLocaleString(locale === 'en-US' ? 'en-US' : 'zh-CN', { hour12: false });
}

// 搜索帮助浮窗条目：固定 12 条，与用户给定的清单逐条对应（纯静态文案，不依赖接口）
const SEARCH_HELP: Array<{ zh: string; en: string; href: string }> = [
  // 1. Git 命令在线学习
  { zh: 'Git 命令在线学习', en: 'Learn Git commands online', href: 'https://git-scm.com/book/zh/v2' },
  // 2. 如何在 Gitee 导入 GitHub 仓库
  { zh: '如何在 Gitee 导入 GitHub 仓库', en: 'Import a GitHub repo into Gitee', href: 'https://help.gitee.com/repo/import' },
  // 3. Git 仓库基础操作
  { zh: 'Git 仓库基础操作', en: 'Git repository basics', href: 'https://git-scm.com/docs' },
  // 4. 企业版和社区版功能对比
  { zh: '企业版和社区版功能对比', en: 'Enterprise vs community edition', href: 'https://help.gitee.com' },
  // 5. SSH 公钥设置
  { zh: 'SSH 公钥设置', en: 'Set up an SSH public key', href: 'https://help.gitee.com/base/account/ssh' },
  // 6. 如何处理代码冲突
  { zh: '如何处理代码冲突', en: 'How to resolve code conflicts', href: 'https://git-scm.com/book/zh/v2' },
  // 7. 仓库体积过大如何减小
  { zh: '仓库体积过大如何减小', en: 'Reduce an oversized repository', href: 'https://git-scm.com/docs/git-gc' },
  // 8. 如何找回被删除的仓库数据
  { zh: '如何找回被删除的仓库数据', en: 'Recover deleted repository data', href: 'https://git-scm.com/docs/git-reflog' },
  // 9. Gitee 产品配额说明
  { zh: 'Gitee 产品配额说明', en: 'Gitee product quotas', href: 'https://help.gitee.com' },
  // 10. GitHub 仓库快速导入 Gitee 及同步更新
  { zh: 'GitHub 仓库快速导入 Gitee 及同步更新', en: 'Import from GitHub and keep synced', href: 'https://help.gitee.com/repo/import' },
  // 11. 什么是 Release（发行版）
  { zh: '什么是 Release（发行版）', en: 'What is a release', href: 'https://git-scm.com/book/zh/v2' },
  // 12. 将 PHP 项目自动发布到 packagist.org
  { zh: '将 PHP 项目自动发布到 packagist.org', en: 'Auto-publish a PHP project to packagist.org', href: 'https://packagist.org/about' },
]; // 搜索帮助清单结束

// 多选筛选器契约：许可 48 项、语言 87 项共用一个可折叠面板实现
interface FilterPopProps {
  locale: Locale; // 当前语言，决定标题与提示文案
  title: string; // 面板标题（如「开源许可」）
  options: readonly string[]; // 全部可选项
  selected: string[]; // 已选项
  onChange: (next: string[]) => void; // 选择变化回调，由父组件触发列表重拉
}

// 可折叠多选筛选面板：默认收起，展开后是带滚动条的复选框清单，避免 48/87 项撑爆页面
function FilterPop({ locale, title, options, selected, onChange }: FilterPopProps) {
  // 切换单个选项：已选则移除，未选则追加（保持已选顺序稳定）
  function toggle(value: string) {
    // 命中则过滤掉，未命中则追加到末尾
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }
  // 返回筛选面板
  return (
    <details className="filter-pop">{/* 折叠容器：点击摘要行展开选项清单 */}
      <summary>{/* 摘要行：标题 + 已选计数 */}
        {title}{/* 面板标题 */}
        {selected.length > 0 && <span className="count">{selected.length}</span>}{/* 已选数量徽标 */}
      </summary>{/* 摘要行结束 */}
      <div className="filter-pop-body">{/* 选项清单容器（限高滚动） */}
        {options.map((option) => ( // 逐项渲染复选框
          <label key={option} className="filter-option">{/* 单选项：整行可点 */}
            <input
              // 复选框：反映当前是否已选
              type="checkbox"
              // 勾选状态
              checked={selected.includes(option)}
              // 点击切换
              onChange={() => toggle(option)}
            />
            <span>{option}</span>{/* 选项名称 */}
          </label> // 单选项结束
        ))}{/* 结束选项遍历 */}
        {selected.length > 0 && ( // 有选择时提供「清空」入口
          <button type="button" className="btn ghost small" onClick={() => onChange([])}>
            {locale === 'en-US' ? 'Clear' : '清空'}{/* 清空文案 */}
          </button> // 清空按钮结束
        )}{/* 结束清空入口 */}
      </div>{/* 选项容器结束 */}
    </details> // 折叠容器结束
  );
} // FilterPop 结束

// 依赖链图组件：用 G6 v5 在详情面板内把「前置模块 → 当前模块」渲染成有向小图；已解锁前置绿色、未解锁灰色、当前模块蓝色
interface DependencyGraphProps {
  currentCode: string; // 当前展开模块编码
  requires: string[]; // 前置模块编码列表
  unlocked: Set<string>; // 已解锁模块编码集合
  nameOf: (code: string) => string; // 编码 → 展示名解析（与列表同一口径，跨页依赖回落编码）
  locale: Locale; // 界面语言（无障碍标签随语言切换）
}

function DependencyGraph({ currentCode, requires, unlocked, nameOf, locale }: DependencyGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null); // 画布挂载容器 ref
  const graphRef = useRef<Graph | null>(null); // G6 实例引用，卸载时据此销毁释放 canvas

  // 依赖快照键：Set 与数组每次渲染都是新引用，拼成排序字符串作为 effect 依赖，避免无关重渲染重建图
  const unlockedKey = [...unlocked].sort().join('|'); // 已解锁编码排序拼接
  const requiresKey = [...requires].sort().join('|'); // 前置编码排序拼接

  useEffect(() => { // 容器就绪且依赖快照变化时（重新）建图
    const container = containerRef.current; // 取挂载节点
    if (!container) return; // 容器尚未挂载（如详情收起态）时不建图

    // 前置节点：颜色按解锁态区分，标签用展示名
    const prerequisiteNodes = requires.map((req) => { // 逐个前置模块构造节点
      const owned = unlocked.has(req); // 是否已解锁
      return { // 节点数据
        id: req, // 节点 ID 即模块编码，边引用同一编码
        data: { kind: owned ? 'owned' : 'locked' }, // 自定义数据：样式映射与后续悬停取值用
        style: { // 节点内联样式
          fill: owned ? '#16a34a' : '#cbd5e1', // 已解锁绿、未解锁灰
          labelText: nameOf(req), // 节点标签取展示名
          labelFill: owned ? '#ffffff' : '#334155', // 标签字色随底色取对比色
          size: [150, 40] as [number, number], // 节点宽高（元组类型，对齐 g6 Size 定义）
          radius: 10, // 圆角半径
        }, // 样式结束
      }; // 前置节点结束
    }); // 前置节点构造结束

    // 当前节点：主色蓝，作为边的终点
    const currentNode = { // 当前模块节点
      id: currentCode, // 节点 ID 即当前模块编码
      data: { kind: 'current' }, // 标记为当前节点
      style: { // 节点内联样式
        fill: '#2563eb', // 当前模块主色蓝
        labelText: nameOf(currentCode), // 标签取当前模块展示名
        labelFill: '#ffffff', // 白字
        size: [150, 40] as [number, number], // 节点宽高（元组类型，对齐 g6 Size 定义）
        radius: 10, // 圆角半径
      }, // 样式结束
    }; // 当前节点结束

    // 边：从前置指向当前，表示「先解锁前置，才能购买当前模块」
    const edges = requires.map((req) => ({ source: req, target: currentCode })); // 每条前置对应一条有向边
    const data: GraphData = { nodes: [currentNode, ...prerequisiteNodes], edges }; // 汇总图数据

    const graph = new Graph({ // 新建 G6 实例
      container, // 挂载到 ref 容器
      width: container.clientWidth || 320, // 容器宽度兜底 320px
      height: 168, // 画布固定高度，适配详情面板纵向空间
      data, // 图数据
      layout: { type: 'dagre' }, // 有向分层布局，一层前置即可清晰铺开
      autoFit: 'view', // 视图自适应，避免节点被裁切
      animation: false, // 静态预览关闭全局动画，减少首屏开销
    }); // 实例配置结束
    graphRef.current = graph; // 留存实例引用
    void graph.render(); // render 为异步方法，不阻塞卸载清理

    return () => { // 卸载或依赖变化前清理
      graph.destroy(); // 销毁实例，释放 canvas 与事件监听
      graphRef.current = null; // 清空引用
    }; // 清理结束
  }, [currentCode, requiresKey, unlockedKey, locale]); // 依赖：当前编码 + 前置/解锁两个快照键 + 语言；原始集合/数组/函数引用每次渲染都变，不进依赖以免无关重建

  return <div ref={containerRef} className="dep-graph" aria-label={locale === 'en-US' ? 'Dependency graph' : '依赖链图'} />; // 画布容器
} // DependencyGraph 结束

// 价格历史行：与后端 price_history 定价窗口字段一一对应
interface PriceHistoryRow {
  effective_from: string; // 窗口起始时间
  effective_to: string | null; // 窗口结束时间，空表示至今有效
  currency: string; // 币种
  amount_minor: number; // 金额（分）
}

// 价格历史折线图组件：用 ECharts 把各定价窗口的售价按生效时间串成趋势线，卸载时 dispose 释放实例。
function PriceHistoryChart({ rows, locale }: { rows: PriceHistoryRow[]; locale: Locale }) {
  const hostRef = useRef<HTMLDivElement | null>(null); // 图表挂载容器
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null); // ECharts 实例引用

  // 数据快照键：价格行数组每次渲染都是新引用，拼成串作为 effect 依赖，避免无关重渲染重建图表
  const rowsKey = rows.map((r) => `${r.effective_from}:${r.amount_minor}:${r.currency}`).join('|');

  useEffect(() => { // 容器就绪且价格快照变化时（重新）绘图
    const host = hostRef.current; // 取挂载节点
    if (!host || rows.length === 0) return; // 无容器或无数据时不建图

    const chart = echarts.init(host); // 初始化 ECharts 实例
    chartRef.current = chart; // 留存实例引用
    const times = rows.map((row) => formatTime(locale, row.effective_from)); // x 轴：各窗口生效时间（按语言格式化）
    const values = rows.map((row) => Number((row.amount_minor / 100).toFixed(2))); // y 轴：分转元后的售价

    chart.setOption({ // 折线图配置
      grid: { left: 44, right: 16, top: 16, bottom: 28 }, // 内边距，给坐标轴标签留位
      tooltip: { trigger: 'axis' }, // 悬停按 x 轴刻度联动提示
      xAxis: { type: 'category', data: times, axisLabel: { fontSize: 10 } }, // 类别轴：生效时间
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } }, // 数值轴：售价（元）
      series: [{ type: 'line', data: values, smooth: true, symbolSize: 6 }], // 平滑折线 + 数据点
    }); // 配置结束

    const onResize = () => chart.resize(); // 窗口尺寸变化时自适应重排
    window.addEventListener('resize', onResize); // 监听视口缩放
    return () => { // 卸载或数据变化前清理
      window.removeEventListener('resize', onResize); // 移除缩放监听
      chart.dispose(); // 销毁实例，释放 canvas 与事件
      chartRef.current = null; // 清空引用
    };
  }, [rowsKey, locale, rows.length]); // 依赖：价格快照键 + 语言 + 行数；原始数组引用不进依赖

  if (rows.length === 0) return null; // 无定价记录时不渲染容器
  return <div ref={hostRef} className="price-history-chart" />; // 图表挂载容器
} // PriceHistoryChart 结束

// 商城视图：展示可解锁的功能模块，并提供一次性解锁入口
export function Store({ locale }: Props) {
  // 是否已登录：匿名态跳过权益接口（该接口需鉴权），并把解锁按钮替换为登录提示
  const authed = Boolean(getSession());
  // 搜索框输入值（未提交）：按键不触发请求
  const [keyword, setKeyword] = useState('');
  // 已提交的搜索词：只有点击搜索/回车才生效，驱动列表重新拉取
  const [applied, setApplied] = useState('');
  // 当前分类：'all' 表示「全部推荐项目」，其余为一级或二级分类 slug
  const [category, setCategory] = useState('all');
  // 排序方式：默认「最新推荐」
  const [sort, setSort] = useState<CatalogSort>('recommended');
  // 已选开源许可（多选）
  const [licenses, setLicenses] = useState<string[]>([]);
  // 已选编程语言（多选）
  const [languages, setLanguages] = useState<string[]>([]);
  // 当前页码：筛选变化时回到第 1 页
  const [page, setPage] = useState(1);
  // 已展开的一级分类（二级条目在导航里按需展开，避免一次渲染 205 行）
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  // 热门项目时间窗：今日 / 本周（右侧卡片切换按钮的状态）
  const [hotRange, setHotRange] = useState<'today' | 'week'>('today');
  // 搜索帮助浮窗开关：右下角固定按钮点开 12 条帮助清单
  const [helpOpen, setHelpOpen] = useState(false);

  // 拉取分类导航树：19 个一级分类 + 二级条目 + 每个分类下的模块数
  const taxonomyState = useAsync(() => api.catalog.getTaxonomy(), []);
  // 拉取模块目录：任一筛选条件变化即重新请求（licenses/languages 用逗号串作为依赖键）
  const modulesState = useAsync(
    () => api.catalog.getModules({ q: applied || undefined, category, sort, licenses, languages, page, pageSize: PAGE_SIZE }),
    [applied, category, sort, licenses.join(','), languages.join(','), page],
  );
  // 拉取右侧「热门项目」：跟随当前分类与今日/本周时间窗，取前 5 条
  const hotState = useAsync(
    () => api.catalog.getHotModules({ range: hotRange, category, limit: 5 }),
    [hotRange, category],
  );
  // 拉取当前用户已购权益，用于在卡片上标注「已解锁」；匿名时不发请求、权益视为空，登录态变化时重新拉取
  const entState = useAsync(() => (authed ? api.catalog.getMyEntitlements() : Promise.resolve(null)), [authed]);  // 拉取我的订单：付费模块下单后在这里展示「待结算 / 已结算 / 已取消」并提供取消入口；匿名时不发请求
  const ordersState = useAsync(() => (authed ? api.catalog.getMyOrders() : Promise.resolve(null)), [authed]);
  // 当前展开详情的模块编码：null 表示全部收起
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  // 展开项的详情（含历史价格与依赖链）：随展开目标变化重新拉取，收起时回 null 不发请求
  const detail = useAsync<ModuleDetail | null>(
    () => (expandedCode ? api.catalog.getModule(expandedCode) : Promise.resolve(null)),
    [expandedCode],
  );
  // 正在解锁的模块编码：用于只禁用被点击的那一个按钮
  const [busyCode, setBusyCode] = useState<string | null>(null);
  // 工具面板输入文本：切换模块时清空，避免把上一个模块的输入带过去
  const [toolText, setToolText] = useState('');
  // 工具面板下拉选项：空串表示用该能力的第一个默认项
  const [toolOption, setToolOption] = useState('');
  // 工具面板执行中标记：只禁用「执行」按钮
  const [toolBusy, setToolBusy] = useState(false);
  // 工具面板错误：能力调用失败（未解锁 / 输入非法 / 规划中）时展示
  const [toolError, setToolError] = useState<string | null>(null);
  // 工具面板结果：带模块码，避免切换模块后还显示上一个模块的结果
  const [toolResult, setToolResult] = useState<{ code: string; output: string; output_kind: string } | null>(null);
  // 错误提示：解锁失败时展示，null 表示无错误
  const [error, setError] = useState<string | null>(null);
  // 成功提示：解锁成功后展示，null 表示无提示
  const [message, setMessage] = useState<string | null>(null);
  // 购物车摘要：仅已登录时拉取，用于页头角标与「加入购物车」后的即时反馈
  const [cart, setCart] = useState<CartSummary | null>(null);

  // 购物车角标数据：登录态变化时重拉；匿名不发请求
  useEffect(() => {
    if (!authed) { setCart(null); return; } // 匿名清空角标
    void api.cart.get().then(setCart).catch(() => setCart(null)); // 失败静默，不阻塞浏览
  }, [authed]); // 依赖登录态

  // 模块列表本体（当前页），接口未返回时兜底为空数组
  const modules = (modulesState.data?.modules ?? []) as ModuleCard[];
  // 过滤后的总条数：分页与「结果数」文案都读它，不能用当前页长度代替
  const total: number = modulesState.data?.total ?? 0;
  // 总页数：后端按过滤结果算好，前端只负责渲染
  const totalPages: number = modulesState.data?.total_pages ?? 1;
  // 分类导航树：未加载完成时为空数组，导航区显示占位
  const groups: TaxonomyGroup[] = taxonomyState.data?.groups ?? [];
  // 已解锁模块编码集合：用 Set 让卡片内的判断保持 O(1)
  const unlocked = new Set((entState.data?.entitlements ?? []).map((e) => e.module_code));
  // 我的权益列表：仅登录态有数据
  const entitlements = entState.data?.entitlements ?? [];
  // 我的订单列表：仅登录态有数据
  const orders = ordersState.data?.orders ?? [];
  // 待结算订单按模块编码索引：卡片据此提示「已有待结算订单」，避免用户重复下单
  const pendingOrders = new Map(orders.filter((order) => order.status === 'pending').map((order) => [order.module_code, order]));
  // 三个接口任一仍在加载即视为整体加载中（匿名态权益/订单请求立即完成，不阻塞），避免出现半屏数据
  const loading = modulesState.loading || entState.loading || ordersState.loading;

  // 当前分类的展示名：'all' 显示「全部推荐项目」，二级 slug 显示条目名，一级 slug 显示分类名
  function categoryLabel(): string {
    // 全部分类固定文案
    if (category === 'all') return locale === 'en-US' ? 'All recommended projects' : '全部推荐项目';
    // 先按一级分类匹配
    const group = groups.find((item) => item.slug === category);
    // 命中一级分类：按语言取中/英文名
    if (group) return categoryName(locale, group.name, group.name_en);
    // 再按二级条目匹配
    for (const item of groups) {
      // 在该分类的二级条目里查找
      const child = item.items.find((sub) => sub.slug === category);
      // 命中即返回「一级 / 二级」形式，让用户知道自己在哪一层
      if (child) return `${categoryName(locale, item.name, item.name_en)} / ${categoryName(locale, child.name, child.name_en)}`;
    } // 二级匹配结束
    // 兜底回显原始 slug，便于排查脏数据
    return category;
  }

  // 任意二级 slug 的展示名：详情页显示模块归属，与当前筛选状态无关
  function categoryLabelOf(slug: string | null): string {
    // 老数据可能没有分类，给出可读兜底而非空白
    if (!slug) return locale === 'en-US' ? 'Uncategorized' : '未归类';
    // 遍历一级分类下的二级条目查找同名条目
    for (const group of groups) {
      // 命中二级条目即返回「一级 / 二级」形式
      const child = group.items.find((sub) => sub.slug === slug);
      // 命中即返回
      if (child) return `${categoryName(locale, group.name, group.name_en)} / ${categoryName(locale, child.name, child.name_en)}`;
    } // 遍历结束
    // 兜底回显原始 slug，便于排查脏数据
    return slug;
  }

  // 切换分类：同时回到第 1 页，避免停留在越界页
  function selectCategory(next: string) {    // 设置当前分类
    setCategory(next);
    // 重置分页
    setPage(1);
  }

  // 点击一级分类：既作为筛选条件，又切换二级条目的展开态
  function toggleGroup(slug: string) {
    // 选中该一级分类并回到首页
    selectCategory(slug);
    // 展开态取反
    setOpenGroups((current) => (current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]));
  }

  // 按模块编码解析展示名：当前页里有就用多语言名称，没有（如跨页依赖）则退化为编码本身
  function nameOf(code: string): string {
    // 在当前页目录中查找该模块
    const found = modules.find((item) => item.code === code);
    // 命中则按语言挑名称，缺失退回编码
    return found ? pick(locale, found.name, code) : code;
  }

  // 是否付费模块：有价格且金额大于 0 才必须走下单结算；免费/未定价模块仍直接解锁
  function isPaid(item: ModuleCard): boolean {
    // current_price 为 null 视为免费，金额 0 同样视为免费
    return Boolean(item.current_price && item.current_price.amount_minor > 0);
  }

  // 提交搜索：把输入框值落到 applied，触发目录重新拉取
  function submitSearch(event: FormEvent) {
    // 阻止表单默认跳转，保持单页体验
    event.preventDefault();
    // 去掉首尾空白后生效；空串等价于清除过滤
    setApplied(keyword.trim());
    // 搜索同样回到第 1 页
    setPage(1);
  }

  // 清空全部筛选（保留搜索词以外的分类、排序、许可、语言）
  function resetFilters() {
    // 回到全部分类
    setCategory('all');
    // 排序回到默认
    setSort('recommended');
    // 清空许可
    setLicenses([]);
    // 清空语言
    setLanguages([]);
    // 回到第 1 页
    setPage(1);
  }

  // 切换详情展开：再次点击同一卡片即收起
  function toggleDetail(code: string) {
    // 已展开则收起，否则展开该卡片并触发详情请求
    setExpandedCode((current) => (current === code ? null : code));
    // 工具面板按模块隔离：切换展开目标时清空输入与结果，避免串味
    setToolText('');
    setToolOption('');
    setToolError(null);
    setToolResult(null);
  }

  // 调用当前模块绑定的真实能力：门禁（登录 / 已上架 / 有实现 / 已解锁）全部由服务端判定
  async function handleInvoke(code: string, capability: string) {
    // 进入执行态，清空上一次的错误与结果
    setToolBusy(true);
    setToolError(null);
    setToolResult(null);
    try {
      // 按能力定义组选项：组合值（op:direction）拆成两个字段，数字类转 Number
      const spec = CAPABILITY_OPTIONS[capability];
      const options: Record<string, string | number | boolean> = {};
      if (spec) {
        const value = toolOption || spec.items[0].value; // 未选时用第一个默认项
        if (spec.optionKey === 'op:direction') {
          const [op, direction] = value.split(':'); // 组合值拆分
          options.op = op; // 编码方式
          options.direction = direction; // 方向
        } else {
          options[spec.optionKey] = spec.numeric ? Number(value) : value; // 其余能力单字段下发
        }
      }
      // 发起调用：输入文本原样提交，服务端限长并校验
      const result = await api.catalog.invokeModule(code, toolText, options);
      // 只保留渲染需要的字段，并带上模块码用于隔离
      setToolResult({ code: result.module_code, output: result.output, output_kind: result.output_kind });
    } catch (err) {
      // 未解锁 / 规划中 / 输入非法分别有独立错误码，统一走本地化文案
      setToolError(errorText(locale, err));
    } finally {
      // 无论成功失败都退出执行态
      setToolBusy(false);
    }
  }

  // 加入购物车：已在车中由后端回放（added=false），成功后刷新角标
  async function handleAddToCart(code: string) {
    // 仅禁用当前卡片按钮
    setBusyCode(code);
    // 清空旧错误
    setError(null);
    // 清空旧提示
    setMessage(null);
    try {
      // 加购接口：同名模块重复加购不产生重复条目
      const result = await api.cart.add(code);
      // 用响应里的最新购物车覆盖角标
      setCart(result.cart);
      // 回放与新建两种语义给出不同提示
      setMessage(
        result.added
          ? locale === 'en-US'
            ? 'Added to cart ✓'
            : '已加入购物车 ✓'
          : locale === 'en-US'
            ? 'Already in cart'
            : '已在购物车中',
      );
    } catch (err) {
      // 已解锁（409）或未上架等业务错误统一翻译
      setError(errorText(locale, err));
    } finally {
      // 解除按钮忙碌态
      setBusyCode(null);
    }
  }

  // 解锁指定模块：一次性买断，成功后刷新权益列表
  async function handleUnlock(code: string) {
    // 记录当前解锁的模块编码，驱动按钮进入加载态
    setBusyCode(code);
    // 清空旧错误
    setError(null);
    // 清空旧成功提示
    setMessage(null);
    try {
      // 调用解锁接口；后端校验前置依赖与区域可用性
      await api.catalog.unlockModule(code);
      // 按语言展示解锁成功提示
      setMessage(locale === 'en-US' ? 'Unlocked ✓' : '解锁成功 ✓');
      // 重新拉取权益，让卡片立即变为「已解锁」并隐藏按钮
      entState.reload();
    } catch (err) {
      // 依赖未满足时后端回 FEATURE_NOT_AVAILABLE 并在 details.required 给出缺失模块码
      if (err instanceof ApiError && err.code === 'FEATURE_NOT_AVAILABLE') {
        // 把 unknown 详情收窄为键值对象，避免直接索引未知类型（TS7053）
        const details = err.details as Record<string, unknown> | null | undefined; // 详情可能为 null
        // 取出 details 里的 required 字段并收窄为字符串数组（防御异常负载）
        const raw = details?.['required']; // 索引安全，结果仍按 unknown 处理
        // 仅保留字符串项，过滤脏数据
        const missing = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
        // 有缺失清单时给出「先解锁谁」的精确引导，否则退回通用错误文案
        setError(
          missing.length > 0
            ? locale === 'en-US' // 按语言拼装引导文案
              ? `Unlock prerequisites first: ${missing.map(nameOf).join(', ')}` // 英文引导：列出缺失前置模块名
              : `缺少前置模块，请先解锁：${missing.map(nameOf).join('、')}` // 中文引导：顿号连接缺失模块名
            : errorText(locale, err), // 无清单时用通用翻译
        );
      } else {
        // 其它失败（区域不可用、网络异常等）展示通用可读文案
        setError(errorText(locale, err));
      }
    } finally {
      // 解除按钮加载态，允许操作其它模块
      setBusyCode(null);
    }
  }

  // 付费模块下单：金额由后端按下单时刻价格快照；重复点击会回放同一张待结算订单
  async function handlePurchase(code: string) {
    // 仅禁用当前卡片按钮，避免整页交互被卡住
    setBusyCode(code);
    // 清空旧错误
    setError(null);
    // 清空旧提示
    setMessage(null);
    try {
      // 下单：免费模块会被后端拒绝（400），付费模块返回 pending 订单
      const result = await api.catalog.createOrder(code);
      // 展示订单号前 8 位与金额，便于用户凭单号对账（当前为人工结算）
      const amount = (result.order.amount_minor / 100).toFixed(2);
      // 按语言拼装提示
      setMessage(
        locale === 'en-US'
          ? `Order ${result.order.id.slice(0, 8)} created (${amount} ${result.order.currency}); unlock activates after settlement`
          : `已生成订单 ${result.order.id.slice(0, 8)}（${amount} ${result.order.currency}），结算后自动解锁`,
      );
      // 刷新订单列表，让面板与卡片徽标立即反映待结算状态
      ordersState.reload();
    } catch (err) {
      // 已解锁冲突：提示后刷新权益，让卡片回到「已解锁」正确状态
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        // 先刷新权益，再用通用文案提示
        entState.reload();
      } // 冲突分支结束
      // 其余错误（依赖缺失、网络异常）统一走可读文案
      setError(errorText(locale, err));
    } finally {
      // 解除按钮加载态
      setBusyCode(null);
    }
  }

  // 取消待结算订单：取消后可重新下单；已结算订单后端禁止取消
  async function handleCancelOrder(id: string) {
    // 用带前缀的忙碌标记，避免与模块解锁按钮的 busyCode 互相干扰
    setBusyCode(`order:${id}`);
    // 清空旧错误
    setError(null);
    // 清空旧提示
    setMessage(null);
    try {
      // 调用取消接口
      await api.catalog.cancelOrder(id);
      // 成功提示
      setMessage(locale === 'en-US' ? 'Order cancelled' : '订单已取消');
      // 刷新订单列表
      ordersState.reload();
    } catch (err) {
      // 失败展示可读文案（如已结算订单不可取消）
      setError(errorText(locale, err));
    } finally {
      // 解除忙碌态
      setBusyCode(null);
    }
  }

  // 首屏加载态：只渲染一行提示，避免空白页面
  if (loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  // 目录加载失败：展示错误 + 排查提示 + 重试入口，避免一次请求失败即永久空白且无恢复路径
  if (modulesState.error) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>{locale === 'en-US' ? 'Module Store' : '功能模块商城'}</h1>
        </header>
        <p className="error">{errorText(locale, modulesState.error)}</p>
        <p className="muted">
          {locale === 'en-US'
            ? 'Cannot reach the catalog service. Check your network or ad-blocker, then retry.'
            : '无法连接模块目录服务，请检查网络或广告拦截插件后重试。'}
        </p>
        <button type="button" className="btn primary" onClick={() => modulesState.reload()}>
          {locale === 'en-US' ? 'Retry' : '重试'}
        </button>
      </div>
    );
  }

  // 渲染商城页面
  return (
    // 页面容器：统一页面留白与最大宽度
    <div className="page">
      <header className="page-head">{/* 页头：标题 + 解锁规则说明 */}
        <h1>{locale === 'en-US' ? 'Module Store' : '功能模块商城'}</h1>{/* 标题：按语言切换中英文 */}
        <div className="products-pager">{/* 配套入口：商品列表 / 购物车（角标显示待购数量） */}
          <button type="button" className="btn ghost" onClick={() => navigate({ view: 'products' })}>
            {locale === 'en-US' ? 'Products' : '商品列表'}
          </button>
          <button type="button" className="btn ghost" onClick={() => navigate({ view: 'cart' })}>
            {locale === 'en-US' ? 'Cart' : '购物车'}
            {cart && cart.count > 0 ? <span className="cart-badge">{cart.count}</span> : null}
          </button>
        </div>
        <p className="muted">{/* 说明文案：两级分类导航 + 一次性解锁 */}
          {locale === 'en-US' // 按语言选择对应的规则说明
            ? '19 top-level categories, 205 second-level modules; unlock once per module'
            : '19 个一级分类、205 个二级模块；按模块一次性解锁'}{/* 规则说明文案结束 */}
        </p>{/* 结束说明文案 */}
      </header>{/* 结束页头 */}

      <div className="store-layout">{/* 两栏布局：左侧分类导航，右侧列表与筛选 */}
        <aside className="store-nav panel">{/* 分类导航：一级分类 + 可展开的二级条目 */}
          <div className="panel-head">{/* 导航标题行 */}
            <h3>{locale === 'en-US' ? 'Categories' : '分类导航'}</h3>{/* 区块标题 */}
            <span className="count">{groups.length}</span>{/* 一级分类数量 */}
          </div>{/* 标题行结束 */}
          <button
            // 全部推荐项目：等价于不过滤分类
            type="button"
            // 当前选中态加高亮修饰类
            className={`store-nav-entry ${category === 'all' ? 'active' : ''}`}
            // 点击回到全部
            onClick={() => selectCategory('all')}
          >
            <span>{locale === 'en-US' ? 'All recommended' : '全部推荐项目'}</span>{/* 入口文案 */}
            <span className="count">{taxonomyState.data?.total_modules ?? 0}</span>{/* 模块总数徽标 */}
          </button>{/* 全部入口结束 */}
          {groups.map((group) => ( // 逐一级分类渲染
            <div key={group.slug} className="store-nav-group">{/* 单个一级分类容器 */}
              <button
                // 一级分类按钮：既筛选该分类，也切换二级展开
                type="button"
                // 选中或展开时高亮
                className={`store-nav-entry ${category === group.slug ? 'active' : ''}`}
                // 点击处理
                onClick={() => toggleGroup(group.slug)}
              >
                <span>
                  {openGroups.includes(group.slug) ? '▾' : '▸'} {categoryName(locale, group.name, group.name_en)}{/* 展开指示 + 分类名（按语言取中英文） */}
                </span>
                <span className="count">{group.count}</span>{/* 该分类模块数 */}
              </button>{/* 一级分类按钮结束 */}
              {openGroups.includes(group.slug) && ( // 展开时才渲染二级条目
                <ul className="store-nav-items">{/* 二级条目清单 */}
                  {group.items.map((item) => ( // 逐二级条目渲染
                    <li key={item.slug}>{/* 单条容器 */}
                      <button
                        // 二级条目按钮：精确筛选该条目
                        type="button"
                        // 精确选中时高亮
                        className={`store-nav-entry sub ${category === item.slug ? 'active' : ''}`}
                        // 点击筛选该二级条目
                        onClick={() => selectCategory(item.slug)}
                      >
                        <span>{categoryName(locale, item.name, item.name_en)}</span>{/* 条目名称（按语言取中英文） */}
                        <span className="count">{item.count}</span>{/* 该条目模块数 */}
                      </button>{/* 二级条目按钮结束 */}
                    </li> // 单条结束
                  ))}{/* 结束二级条目遍历 */}
                </ul> // 二级清单结束
              )}{/* 结束展开条件渲染 */}
            </div> // 一级分类容器结束
          ))}{/* 结束一级分类遍历 */}
        </aside>{/* 分类导航结束 */}

        <div className="store-main">{/* 右侧主区：搜索 + 筛选 + 列表 + 分页 */}
          <form className="form inline" onSubmit={submitSearch}>{/* 搜索行：提交制，避免按键即请求 */}
            <label className="grow">{/* 关键词输入：占满剩余宽度 */}
              {locale === 'en-US' ? 'Search modules' : '搜索模块'}{/* 字段标签 */}
              <input
                // 受控输入框
                value={keyword}
                // 同步输入值到本地状态
                onChange={(event) => setKeyword(event.target.value)}
                // 占位提示按语言切换
                placeholder={locale === 'en-US' ? 'Name or code' : '名称或编码'}
              />
            </label>{/* 关键词字段结束 */}
            <button type="submit" className="btn primary">{/* 搜索按钮：提交表单 */}
              {locale === 'en-US' ? 'Search' : '搜索'}{/* 按钮文案 */}
            </button>{/* 搜索按钮结束 */}
            {applied !== '' && ( // 已应用过滤时展示结果计数与清除入口
              <>
                <span className="count">{/* 命中计数 */}
                  {locale === 'en-US' ? `${total} result(s)` : `${total} 个结果`}{/* 计数文案 */}
                </span>{/* 计数结束 */}
                <button
                  // 清除搜索：回到无关键词列表
                  type="button"
                  // 幽灵按钮，弱化次级操作
                  className="btn ghost"
                  // 点击同时清空输入框与已提交词
                  onClick={() => { setKeyword(''); setApplied(''); setPage(1); }}
                >
                  {locale === 'en-US' ? 'Clear' : '清除'}{/* 清除按钮文案 */}
                </button>
              </>
            )}{/* 结束过滤状态区 */}
          </form>{/* 搜索行结束 */}

          <section className="panel store-filters">{/* 筛选区：排序 + 开源许可 + 编程语言 */}
            <div className="filter-row">{/* 第一行：排序与分类归属 */}
              <label className="filter-inline">{/* 排序下拉 */}
                {locale === 'en-US' ? 'Sort' : '排序'}{/* 字段标签 */}
                <select
                  // 受控选择器
                  value={sort}
                  // 变更后回到第 1 页，避免越界
                  onChange={(event) => { setSort(event.target.value as CatalogSort); setPage(1); }}
                >
                  {CATALOG_SORT_MODES.map((mode) => ( // 渲染三档排序
                    <option key={mode} value={mode}>{SORT_LABEL[mode][locale === 'en-US' ? 'en' : 'zh']}</option> // 排序项
                  ))}{/* 结束排序遍历 */}
                </select>{/* 排序下拉结束 */}
              </label>{/* 排序结束 */}
              <span className="muted grow">{/* 当前分类提示 */}
                {locale === 'en-US' ? 'Category' : '当前分类'}: {categoryLabel()}{/* 当前分类名 */}
              </span>{/* 分类提示结束 */}
              {(category !== 'all' || licenses.length > 0 || languages.length > 0 || sort !== 'recommended') && ( // 有任意筛选时提供重置
                <button type="button" className="btn ghost small" onClick={resetFilters}>
                  {locale === 'en-US' ? 'Reset filters' : '重置筛选'}{/* 重置文案 */}
                </button> // 重置按钮结束
              )}{/* 结束重置入口 */}
            </div>{/* 第一行结束 */}
            <div className="filter-row">{/* 第二行：许可与语言多选 */}
              <FilterPop
                // 语言
                locale={locale}
                // 标题
                title={locale === 'en-US' ? 'License' : '开源许可'}
                // 48 项许可
                options={LICENSE_OPTIONS}
                // 已选集合
                selected={licenses}
                // 变化即回到首页并重拉
                onChange={(next) => { setLicenses(next); setPage(1); }}
              />{/* 许可筛选结束 */}
              <FilterPop
                // 语言
                locale={locale}
                // 标题
                title={locale === 'en-US' ? 'Language' : '编程语言'}
                // 87 种语言
                options={LANGUAGE_OPTIONS}
                // 已选集合
                selected={languages}
                // 变化即回到首页并重拉
                onChange={(next) => { setLanguages(next); setPage(1); }}
              />{/* 语言筛选结束 */}
              {(licenses.length > 0 || languages.length > 0) && ( // 已选条件以芯片形式回显
                <span className="row chips">{/* 芯片容器 */}
                  {licenses.map((option) => ( // 逐许可渲染
                    <span key={`l-${option}`} className="chip">
                      {option}{/* 许可名 */}
                      <button type="button" onClick={() => { setLicenses(licenses.filter((item) => item !== option)); setPage(1); }}>×</button>{/* 移除 */}
                    </span> // 芯片结束
                  ))}{/* 结束许可芯片 */}
                  {languages.map((option) => ( // 逐语言渲染
                    <span key={`g-${option}`} className="chip">
                      {option}{/* 语言名 */}
                      <button type="button" onClick={() => { setLanguages(languages.filter((item) => item !== option)); setPage(1); }}>×</button>{/* 移除 */}
                    </span> // 芯片结束
                  ))}{/* 结束语言芯片 */}
                </span> // 芯片容器结束
              )}{/* 结束芯片回显 */}
            </div>{/* 第二行结束 */}
          </section>{/* 筛选区结束 */}

          <section className="panel store-hot">{/* 热门项目卡片：跟随当前分类，可在今日/本周间切换 */}
            <div className="panel-head">{/* 标题行 */}
              <h3>{locale === 'en-US' ? 'Popular today' : '热门项目'}</h3>{/* 区块标题 */}
              <span className="row">{/* 时间窗切换按钮组 */}
                <button
                  // 今日：默认档位
                  type="button"
                  // 选中态用主色实心，未选中用幽灵按钮
                  className={hotRange === 'today' ? 'btn small' : 'btn ghost small'}
                  // 切档后重新请求热门列表
                  onClick={() => setHotRange('today')}
                >
                  {locale === 'en-US' ? 'Today' : '今日'}{/* 档位文案 */}
                </button>
                <button
                  // 本周
                  type="button"
                  // 同上：选中态实心
                  className={hotRange === 'week' ? 'btn small' : 'btn ghost small'}
                  // 切档后重新请求
                  onClick={() => setHotRange('week')}
                >
                  {locale === 'en-US' ? 'This week' : '本周'}{/* 档位文案 */}
                </button>
              </span>{/* 按钮组结束 */}
            </div>{/* 标题行结束 */}
            {hotState.data && hotState.data.items.length > 0 ? ( // 有数据时渲染榜单
              <ul className="hot-list">{/* 热门榜清单 */}
                {hotState.data.items.map((item, index) => ( // 逐条渲染，index 即名次
                  <li key={item.code}>{/* 以模块编码为 key */}
                    <button
                      // 点击条目直接落到该条目所属分类，形成「看热门→进分类」的闭环
                      type="button"
                      // 整行按钮，便于点击
                      className="hot-item"
                      // 切换分类并清空搜索词，回到该分类首页
                      onClick={() => { selectCategory(item.category_slug ?? 'all'); setKeyword(''); setApplied(''); }}
                    >
                      <span className="hot-rank">{index + 1}</span>{/* 名次 */}
                      <span className="grow">{item.name[locale === 'en-US' ? 'en-US' : 'zh-CN'] ?? item.name['zh-CN'] ?? item.code}</span>{/* 名称 */}
                      <span className="muted">★ {item.stars}</span>{/* Star 数 */}
                    </button>{/* 条目按钮结束 */}
                  </li> // 单条结束
                ))}{/* 结束榜单遍历 */}
              </ul> // 榜单结束
            ) : (
              <p className="hint">{hotState.loading ? (locale === 'en-US' ? 'Loading…' : '加载中…') : (locale === 'en-US' ? 'No popular items yet' : '暂无热门项目')}</p> // 空态/加载态
            )}{/* 结束榜单条件渲染 */}
          </section>{/* 热门项目卡片结束 */}

          {taxonomyState.error !== null && <p className="error">{errorText(locale, taxonomyState.error)}</p>}{/* 分类树加载失败提示（不影响列表）；用布尔判断避免把 unknown 直接渲染成子节点 */}
          {error && <p className="error">{error}</p>}{/* 解锁失败提示（含依赖缺失引导） */}
          {message && <p className="success">{message}</p>}{/* 解锁成功提示 */}

          {authed && entitlements.length > 0 && ( // 登录且已有权益时展示「我的权益」区块
            <section className="panel">{/* 权益面板 */}
              <div className="panel-head">{/* 面板标题行 */}
                <h3>{locale === 'en-US' ? 'My Entitlements' : '我的权益'}</h3>{/* 区块标题 */}
                <span className="count">{entitlements.length}</span>{/* 权益数量徽标 */}
              </div>{/* 面板标题行结束 */}
              <ul className="plain-list">{/* 权益清单 */}
                {entitlements.map((ent) => { // 逐条权益渲染一行
                  // 状态文案：未知状态原样展示
                  const statusText = ENT_STATUS_LABEL[ent.status]?.[locale === 'en-US' ? 'en' : 'zh'] ?? ent.status;
                  // 状态徽标修饰类：未知状态用默认灰
                  const badgeClass = ENT_STATUS_BADGE[ent.status] ?? '';
                  // 返回单行权益
                  return (
                    <li key={ent.id}>{/* 以权益主键作为 key */}
                      <span>{/* 左侧：模块名 + 编码 */}
                        {nameOf(ent.module_code)}{/* 模块展示名 */}
                        <span className="muted">（{ent.module_code}）</span>{/* 括号内附模块编码 */}
                      </span>{/* 左侧结束 */}
                      <span className="row">{/* 右侧：状态徽标 + 到期时间 */}
                        <span className={`badge ${badgeClass}`}>{statusText}</span>{/* 状态徽标 */}
                        <span className="muted">{/* 到期时间：null 表示永久 */}
                          {ent.expires_at
                            ? `${locale === 'en-US' ? 'Expires' : '到期'} ${formatTime(locale, ent.expires_at)}` // 有到期时间则展示
                            : locale === 'en-US' ? 'No expiry' : '永久有效'}{/* 永久文案 */}
                        </span>{/* 到期时间结束 */}
                      </span>{/* 右侧结束 */}
                    </li> // 单行权益结束
                  );
                })}{/* 结束权益遍历 */}
              </ul>{/* 权益清单结束 */}
            </section> // 权益面板结束
          )}{/* 结束我的权益区块 */}

          {authed && orders.length > 0 && ( // 有订单时展示订单面板：待结算可取消，已结算保留对账记录
            <section className="panel">{/* 订单面板 */}
              <div className="panel-head">{/* 面板标题行 */}
                <h3>{locale === 'en-US' ? 'My Orders' : '我的订单'}</h3>{/* 区块标题 */}
                <span className="count">{orders.length}</span>{/* 订单数量徽标 */}
              </div>{/* 标题行结束 */}
              <ul className="plain-list">{/* 订单清单 */}
                {orders.map((order) => { // 逐条订单渲染一行
                  // 状态文案：未知状态原样展示，避免脏数据渲染成空白
                  const statusText = ORDER_STATUS_LABEL[order.status]?.[locale === 'en-US' ? 'en' : 'zh'] ?? order.status;
                  // 状态徽标修饰类：未知状态回退默认样式
                  const badgeClass = ORDER_STATUS_BADGE[order.status] ?? '';
                  // 金额文案：分转元并保留两位
                  const amount = (order.amount_minor / 100).toFixed(2);
                  // 返回单行订单
                  return (
                    <li key={order.id}>{/* 以订单主键作为 key */}
                      <span>{/* 左侧：模块名 + 订单号前 8 位（便于对账） */}
                        {nameOf(order.module_code)}{/* 模块展示名 */}
                        <span className="muted">（{order.id.slice(0, 8)}）</span>{/* 短单号 */}
                      </span>{/* 左侧结束 */}
                      <span className="row">{/* 右侧：金额 + 状态 + 取消入口 */}
                        <span className="muted">{amount} {order.currency}</span>{/* 成交金额 */}
                        <span className={`badge ${badgeClass}`}>{statusText}</span>{/* 状态徽标 */}
                        {order.status === 'pending' && ( // 仅待结算订单可取消
                          <button
                            // 取消按钮：普通按钮，避免触发表单提交
                            type="button"
                            // 幽灵小按钮：次级操作
                            className="btn ghost small"
                            // 取消中禁用，避免重复点击
                            disabled={busyCode === `order:${order.id}`}
                            // 点击取消该订单
                            onClick={() => handleCancelOrder(order.id)}
                          >
                            {locale === 'en-US' ? 'Cancel' : '取消'}{/* 取消按钮文案 */}
                          </button> // 取消按钮结束
                        )}{/* 结束取消入口 */}
                      </span>{/* 右侧结束 */}
                    </li> // 订单行结束
                  );
                })}{/* 结束订单遍历 */}
              </ul>{/* 订单清单结束 */}
            </section> // 订单面板结束
          )}{/* 结束订单面板 */}

          {modules.length === 0 ? ( // 无可用模块时展示占位文案，否则渲染卡片网格
            <p className="hint">{/* 空态：区分「本区无模块」与「筛选无结果」 */}
              {applied || category !== 'all' || licenses.length > 0 || languages.length > 0
                ? locale === 'en-US'
                  ? 'No modules match the current filters.'
                  : '当前筛选条件下没有模块。' // 筛选无结果
                : locale === 'en-US'
                  ? 'No modules available in this region.'
                  : '本区暂无可用模块。'}{/* 区域空态 */}
            </p> // 空态结束
          ) : (
            <>
              <div className="cards">{/* 卡片网格容器 */}
                {modules.map((m) => { // 逐个模块渲染卡片
                  // 是否已拥有该模块：决定隐藏解锁按钮并显示徽标
                  const owned = unlocked.has(m.code);
                  // 价格展示文案：有价格时按「元 + 币种」格式化，免费模块显示 Free / 免费
                  const price = m.current_price
                    ? `${(m.current_price.amount_minor / 100).toFixed(2)} ${m.current_price.currency}`
                    : locale === 'en-US' ? 'Free' : '免费';
                  // 本卡片是否处于展开态
                  const expanded = expandedCode === m.code;
                  // 商品名：卡片标题、图片 alt 与参数图共用同一份展示名
                  const title = pick(locale, m.name, m.code);
                  // 分类封面：19 个一级分类各一张，二级模块按一级 slug 复用
                  const cover = categoryCoverUrl(m.category_slug);
                  // 一级分类展示名：同时作为图片角标
                  const groupName = categoryLabelOf(m.category_slug).split(' / ')[0];
                  // 返回单个模块卡片
                  return (
                    <section key={m.code} className={`panel store-card${expanded ? ' is-expanded' : ''}`}>{/* 卡片容器：展开时横跨整行，给参数表与参数图足够宽度 */}
                      <div className="store-card-media">{/* 商品封面区：图在上、信息在下，形成电商卡片视觉 */}
                        <img src={cover} alt={`${title} ${locale === 'en-US' ? 'cover' : '商品封面'}`} loading="lazy" />{/* 商品分类封面图 */}
                        <span className="store-card-category">{groupName}</span>{/* 左上角分类角标 */}
                        <span className="store-card-price">{price}</span>{/* 右上角价格角标：免费 / 金额 */}
                      </div>{/* 封面区结束 */}
                      <div className="panel-head">{/* 卡片头部：模块名 + 已解锁徽标 */}
                        <h3>{title}</h3>{/* 模块名：缺失时退化为模块编码 */}
                        {owned && <span className="badge role-editor">✓ {locale === 'en-US' ? 'Owned' : '已解锁'}</span>}{/* 已解锁徽标（绿色） */}
                        {!owned && pendingOrders.has(m.code) && <span className="badge">{locale === 'en-US' ? 'Order pending' : '待结算'}</span>}{/* 待结算徽标：提示已下单未结算，避免重复购买 */}
                      </div>{/* 结束卡片头部 */}
                      <p className="muted">{pick(locale, m.summary)}</p>{/* 模块简介：按语言挑选 */}
                      <div className="task-meta">{/* 卡片元信息：模块编码、许可、语言、Star 数与价格 */}
                        <code>{m.code}</code>{/* 模块编码，等宽字体便于识别 */}
                        {m.language && <span className="badge">{m.language}</span>}{/* 编程语言徽标 */}
                        {m.license && <span className="badge">{m.license}</span>}{/* 许可徽标 */}
                        <span className="muted">★ {m.stars}</span>{/* Star 数 */}
                        <span>{price}</span>{/* 价格文案 */}
                      </div>{/* 结束元信息 */}
                      {m.requires.length > 0 && ( // 前置依赖提示：仅在存在前置模块时展示
                        <p className="muted">{/* 弱化的说明行 */}
                          {locale === 'en-US' ? 'Requires' : '前置'}: {m.requires.map(nameOf).join(locale === 'en-US' ? ', ' : '、')}{/* 「前置」+ 依赖模块展示名 */}
                        </p> // 结束前置依赖提示
                      )}{/* 结束前置依赖条件渲染 */}
                      <div className="row">{/* 操作行：详情切换 + 解锁 */}
                        <button
                          // 详情切换按钮
                          type="button"
                          // 幽灵小按钮：次级操作
                          className="btn ghost small"
                          // 点击展开/收起本卡片详情
                          onClick={() => toggleDetail(m.code)}
                        >
                          {expanded // 按展开态与语言切换文案
                            ? locale === 'en-US' ? 'Hide details' : '收起详情'
                            : locale === 'en-US' ? 'Details' : '详情'}{/* 详情按钮文案结束 */}
                        </button>{/* 详情按钮结束 */}
                        {(!owned && !m.capability && m.code.startsWith('cat.')) && ( // 仅导航条目（cat.*）在无真实能力时算「规划中」：交易型商品（生成包 / 存储 / 模板包）不适用
                          <span className="badge">{locale === 'en-US' ? 'Planned' : '规划中'}</span> // 规划中徽标
                        )}{/* 规划中徽标结束 */}
                        {!owned && authed && (m.code.startsWith('cat.') ? m.capability !== null : true) && ( // 已登录且未拥有：导航条目需有真实能力，交易型商品（配套权益包）本身即可购买
                          <button
                            // 购买/解锁按钮：普通按钮，避免触发表单提交
                            type="button"
                            // 主按钮样式
                            className="btn primary small"
                            // 仅禁用当前卡片按钮，其它卡片仍可操作
                            disabled={busyCode === m.code}
                            // 付费模块走下单，免费模块走直接解锁；分支在后端同样有门禁，前端只是前置引导
                            onClick={() => (isPaid(m) ? handlePurchase(m.code) : handleUnlock(m.code))}
                          >
                            {busyCode === m.code // 按钮文案：本模块处理中优先，其次按付费/免费与语言分支
                              ? isPaid(m)
                                ? locale === 'en-US' ? 'Creating order…' : '生成订单中…' // 付费模块按下单态展示
                                : locale === 'en-US' ? 'Unlocking…' : '解锁中…' // 免费模块按解锁态展示
                              : isPaid(m) // 非处理中：付费模块显示「购买 + 金额」，已存在待结算订单则提示待结算
                                ? pendingOrders.has(m.code)
                                  ? locale === 'en-US' ? 'Order pending' : '待结算' // 已有待结算订单：再次点击只会回放同一张单
                                  : `${locale === 'en-US' ? 'Buy' : '购买'} ${(m.current_price!.amount_minor / 100).toFixed(2)} ${m.current_price!.currency}` // 有价格必定非空，非空断言安全
                                : locale === 'en-US' ? 'Unlock' : '解锁'}{/* 按钮文案结束 */}
                          </button> // 结束购买/解锁按钮
                        )}{/* 结束购买/解锁按钮条件渲染 */}
                        {!owned && authed && (m.code.startsWith('cat.') ? m.capability !== null : true) && ( // 已登录且未拥有的模块：提供加购入口（结算语义与直接购买一致；配套权益包同样可加购）
                          <button
                            // 普通按钮，避免触发表单提交
                            type="button"
                            // 幽灵小按钮：次级操作，购买按钮仍为主操作
                            className="btn ghost small"
                            // 加购中禁用，防重复点击
                            disabled={busyCode === m.code}
                            // 加购：已拥有会被后端 409 拒绝，已在车中则回放
                            onClick={() => void handleAddToCart(m.code)}
                          >
                            {locale === 'en-US' ? 'Add to cart' : '加入购物车'}{/* 加购按钮文案 */}
                          </button> // 结束加购按钮
                        )}{/* 结束加购按钮条件渲染 */}
                        {!owned && !authed && ( // 会话未就绪的降级入口：正常情况访客会话已在启动时自动建立，此处仅覆盖离线 / 限流
                          <button
                            // 重试按钮：普通按钮，避免触发表单提交
                            type="button"
                            // 幽灵小按钮：引导级操作
                            className="btn ghost small"
                            // 重新加载页面即会再次自动领取免登录会话，随后可正常解锁
                            onClick={() => window.location.reload()}
                          >
                            {locale === 'en-US' ? 'Retry guest session' : '重试免登录会话'}{/* 降级引导文案，随语言切换 */}
                          </button> // 结束降级重试按钮
                        )}{/* 降级条件渲染结束 */}
                      </div>{/* 操作行结束 */}
                      {expanded && ( // 展开态渲染详情块
                        <div className="store-detail">{/* 详情容器 */}
                          {detail.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}{/* 详情加载态 */}
                          {detail.error !== null && <p className="error">{errorText(locale, detail.error)}</p>}{/* 详情加载失败：用布尔判断避免渲染 unknown */}
                          {detail.data && ( // 详情数据就绪
                            <>
                              <p className="muted">{/* 状态与区域行 */}
                                {locale === 'en-US' ? 'Status' : '状态'}: {MODULE_STATUS_LABEL[detail.data.status]?.[locale === 'en-US' ? 'en' : 'zh'] ?? detail.data.status}
                                {' · '}{/* 分隔符 */}
                                {locale === 'en-US' ? 'Region' : '区域'}: {detail.data.region}{/* 区域值 */}
                              </p>{/* 状态区域行结束 */}
                              <p className="muted">{/* 元信息行：分类归属 / 开源许可 / 编程语言 / Stars，全部来自列表同源字段 */}
                                {locale === 'en-US' ? 'Category' : '分类'}: {categoryLabelOf(detail.data.category_slug)}
                                {' · '}{/* 分隔符 */}
                                {locale === 'en-US' ? 'License' : '许可'}: {detail.data.license ?? '—'}
                                {' · '}{/* 分隔符 */}
                                {locale === 'en-US' ? 'Language' : '语言'}: {detail.data.language ?? '—'}
                                {' · '}★ {detail.data.stars}
                              </p>{/* 元信息行结束 */}
                              {(() => { {/* 商品详情视觉块：封面 + 参数表 + 参数详情图，数据全部来自 detail.data */}
                                const data = detail.data!; // 已判空，闭包内断言非空
                                const title = pick(locale, data.name, data.code); // 商品名
                                const category = categoryLabelOf(data.category_slug); // 一级 / 二级分类
                                const groupName = category.split(' / ')[0]; // 一级分类名（封面角标口径）
                                const priceText = data.current_price // 价格文案与卡片同口径
                                  ? `${(data.current_price.amount_minor / 100).toFixed(2)} ${data.current_price.currency}`
                                  : locale === 'en-US' ? 'Free' : '免费';
                                const requiresText = data.requires.length > 0 ? data.requires.map(nameOf).join(locale === 'en-US' ? ', ' : '、') : (locale === 'en-US' ? 'None' : '无');
                                const capabilityText = data.capability ?? (data.code.startsWith('cat.') ? (locale === 'en-US' ? 'Planned' : '功能规划中') : (locale === 'en-US' ? 'Add-on entitlement' : '配套权益商品'));
                                const statusText = MODULE_STATUS_LABEL[data.status]?.[locale === 'en-US' ? 'en' : 'zh'] ?? data.status;
                                // 参数行：详情页以键值表完整展示，避免只有一行逗号文案
                                const specRows: Array<[string, string]> = [
                                  [locale === 'en-US' ? 'Module code' : '模块编码', data.code],
                                  [locale === 'en-US' ? 'Category' : '所属分类', category],
                                  [locale === 'en-US' ? 'License' : '开源许可', data.license ?? '—'],
                                  [locale === 'en-US' ? 'Language' : '编程语言', data.language ?? '—'],
                                  [locale === 'en-US' ? 'Stars' : 'Star 数', `★ ${data.stars}`],
                                  [locale === 'en-US' ? 'Region' : '区域', data.region],
                                  [locale === 'en-US' ? 'Status' : '上架状态', statusText],
                                  [locale === 'en-US' ? 'Unlock mode' : '解锁方式', locale === 'en-US' ? 'One-time purchase' : '一次性买断'],
                                  [locale === 'en-US' ? 'Price' : '价格', priceText],
                                  [locale === 'en-US' ? 'Requires' : '前置依赖', requiresText],
                                  [locale === 'en-US' ? 'Capability' : '能力绑定', capabilityText],
                                ];
                                return (
                                  <>
                                    <div className="store-detail-hero">{/* 商品封面 + 参数表并排，详情区第一屏就能看到图 */}
                                      <img src={categoryCoverUrl(data.category_slug)} alt={`${title} ${locale === 'en-US' ? 'cover' : '商品封面'}`} loading="lazy" />{/* 与卡片同一张分类封面 */}
                                      <dl className="store-spec-grid">{/* 参数键值表 */}
                                        {specRows.map(([label, value]) => (
                                          <div key={label} className="store-spec-row">
                                            <dt>{label}</dt>{/* 参数名 */}
                                            <dd>{value}</dd>{/* 参数值 */}
                                          </div>
                                        ))}
                                      </dl>
                                    </div>{/* 封面与参数表结束 */}
                                    <p className="store-detail-title">{locale === 'en-US' ? 'Product spec sheet' : '商品参数详情图'}</p>{/* 参数图小节标题 */}
                                    <img
                                      className="store-spec-image"
                                      src={specPosterUrl({
                                        name: title,
                                        code: data.code,
                                        groupName,
                                        categoryName: category,
                                        license: data.license,
                                        language: data.language,
                                        stars: data.stars,
                                        priceText,
                                        region: data.region,
                                        statusText,
                                        requiresText,
                                        capabilityText,
                                        locale: locale === 'en-US' ? 'en-US' : 'zh-CN',
                                      })}
                                      alt={`${title} ${locale === 'en-US' ? 'spec sheet' : '商品参数详情图'}`}
                                      loading="lazy"
                                    />{/* 可保存/可右键另存的参数长图 */}
                                  </>
                                );
                              })()}{/* 商品详情视觉块结束 */}
                              <div>{/* 工具区块：登记了能力的模块可真正执行；未登记则标注「功能规划中」 */}
                                <p className="store-detail-title">{locale === 'en-US' ? 'Tool' : '工具'}{/* 小节标题 */}</p>
                                {(() => { {/* 立即执行函数：把能力分支的局部变量收在一处，避免污染外层 */}
                                  const data = detail.data!; // 外层已判空，这里断言非空以便在闭包内保住类型收窄
                                  const capability = data.capability; // 当前模块绑定的能力键（可能为 null）
                                  const seed = capability ? capabilityOfKey(capability) : undefined; // 能力定义：名称 / 提示 / 占位
                                  const spec = capability ? CAPABILITY_OPTIONS[capability] : undefined; // 该能力的可选参数
                                  if (!capability || !seed) { // 无能力：区分「导航条目未实现」与「交易型配套商品」
                                    if (!data.code.startsWith('cat.')) { // 交易型配套商品（漫剧生成包 / 素材存储扩容 / 模板包 / 工作台）本就不提供 invoke 工具
                                      return ( // 配套商品说明
                                        <p className="muted">{locale === 'en-US' ? 'Add-on entitlement — takes effect inside its parent feature after unlock.' : '配套权益商品，解锁后在对应功能中生效。'}</p>
                                      ); // 配套商品说明结束
                                    } // 配套商品分支结束
                                    return ( // 规划中提示
                                      <p className="muted">{locale === 'en-US' ? 'Planned feature — not open for unlock yet.' : '功能规划中，暂不开放解锁。'}</p>
                                    ); // 规划中提示结束
                                  } // 无能力分支结束
                                  return ( // 有能力：按是否已解锁决定给工具还是给提示
                                    <>
                                      <p className="muted">{seed.hint[locale === 'en-US' ? 'en-US' : 'zh-CN']}{/* 能力说明，来自 core-domain 同一份定义 */}</p>
                                      {!owned ? ( // 未解锁：只提示先解锁，不暴露调用入口
                                        <p className="muted">{locale === 'en-US' ? 'Unlock this module to use its tool.' : '解锁本模块后即可使用该工具。'}</p>
                                      ) : ( // 已解锁：渲染输入 + 执行 + 结果
                                        <>
                                          {spec && ( // 有能力私有参数时给下拉
                                            <label className="filter-inline">{/* 复用筛选行样式，视觉上与商城一致 */}
                                              {locale === 'en-US' ? 'Option' : '选项'}
                                              <select
                                                // 受控下拉：空串表示用默认第一项
                                                value={toolOption}
                                                // 同步选中值
                                                onChange={(event) => setToolOption(event.target.value)}
                                              >
                                                {spec.items.map((item) => ( // 逐项渲染下拉选项
                                                  <option key={item.value} value={item.value}>{item[locale === 'en-US' ? 'en' : 'zh']}</option> // 中英文文案二选一
                                                ))}{/* 选项遍历结束 */}
                                              </select>
                                            </label>
                                          )}{/* 下拉结束 */}
                                          <label className="grow">{/* 输入区：多行文本，限制展示高度 */}
                                            {locale === 'en-US' ? 'Input' : '输入'}
                                            <textarea
                                              // 受控输入
                                              value={toolText}
                                              // 同步输入文本
                                              onChange={(event) => setToolText(event.target.value)}
                                              // 占位示例来自能力定义
                                              placeholder={seed.placeholder[locale === 'en-US' ? 'en-US' : 'zh-CN']}
                                              // 四行高度，长内容内部滚动
                                              rows={4}
                                            />
                                          </label>{/* 输入区结束 */}
                                          <div className="row">{/* 执行行 */}
                                            <button
                                              // 普通按钮，避免表单提交
                                              type="button"
                                              // 主按钮强调主操作
                                              className="btn primary small"
                                              // 执行中或输入为空时禁用
                                              disabled={toolBusy || toolText.trim() === ''}
                                              // 点击调用能力
                                              onClick={() => handleInvoke(data.code, capability)}
                                            >
                                              {toolBusy // 执行中优先展示进行态
                                                ? locale === 'en-US' ? 'Running…' : '执行中…'
                                                : locale === 'en-US' ? 'Run' : '执行'}{/* 按钮文案结束 */}
                                            </button>
                                          </div>{/* 执行行结束 */}
                                          {toolError !== null && <p className="error">{toolError}</p>}{/* 调用失败提示 */}
                                          {toolResult && toolResult.code === data.code && ( // 只展示当前模块的结果，避免切换后串味
                                            toolResult.output_kind === 'image' ? ( // 图片：dataURL 直接渲染
                                              <img className="store-tool-image" src={toolResult.output} alt={locale === 'en-US' ? 'Tool output' : '工具输出'} />
                                            ) : toolResult.output_kind === 'html' ? ( // HTML：服务端已转义原始 HTML，可安全渲染
                                              <div className="store-tool-html" dangerouslySetInnerHTML={{ __html: toolResult.output }} />
                                            ) : ( // 文本 / JSON：等宽字体预格式展示
                                              <pre className="store-tool-output">{toolResult.output}</pre>
                                            )
                                          )}{/* 结果展示结束 */}
                                        </>
                                      )}{/* 已解锁分支结束 */}
                                    </>
                                  ); // 有能力分支返回结束
                                })()}{/* 能力区块结束 */}
                              </div>{/* 工具区块结束 */}
                              <div>{/* 依赖链区块 */}
                                <p className="store-detail-title">{locale === 'en-US' ? 'Dependencies' : '依赖链'}</p>{/* 小节标题 */}
                                {detail.data.requires.length === 0 ? ( // 无依赖时展示说明
                                  <p className="muted">{locale === 'en-US' ? 'None' : '无前置依赖'}</p> // 无依赖文案
                                ) : (
                                  <> {/* 有依赖：上方 G6 有向图可视化，下方保留编码 + 解锁状态文字清单作为可读兜底 */}
                                    <DependencyGraph // 依赖链有向图
                                      currentCode={detail.data.code} // 当前模块编码
                                      requires={detail.data.requires} // 前置模块编码列表
                                      unlocked={unlocked} // 已解锁集合
                                      nameOf={nameOf} // 编码解析展示名
                                      locale={locale} // 界面语言
                                    />{/* 图组件结束 */}
                                    <ul className="plain-list dep-graph-legend">{/* 图下状态清单：编码与解锁态，便于核对 */}
                                      {detail.data.requires.map((req) => ( // 逐个前置模块渲染
                                        <li key={req}>{/* 以模块码为 key */}
                                          <span>{nameOf(req)}<span className="muted">（{req}）</span></span>{/* 依赖名 + 编码 */}
                                          <span className="muted">{/* 该依赖的拥有状态 */}
                                            {unlocked.has(req)
                                              ? locale === 'en-US' ? '✓ Owned' : '✓ 已解锁' // 已拥有
                                              : locale === 'en-US' ? 'Not unlocked' : '未解锁'}{/* 未拥有 */}
                                          </span>{/* 拥有状态结束 */}
                                        </li> // 依赖行结束
                                      ))}{/* 结束依赖遍历 */}
                                    </ul> // 状态清单结束
                                  </> // 片段结束
                                )}{/* 结束依赖条件渲染 */}
                              </div>{/* 依赖链区块结束 */}
                              <div>{/* 价格历史区块 */}
                                <p className="store-detail-title">{locale === 'en-US' ? 'Price history' : '价格历史'}</p>{/* 小节标题 */}
                                {detail.data.price_history.length === 0 ? ( // 无历史价格时展示说明
                                  <p className="muted">{locale === 'en-US' ? 'No pricing yet' : '暂无定价记录'}</p> // 无定价文案
                                ) : (
                                  <> {/* 有定价：上方 ECharts 趋势折线，下方保留清单便于逐窗口核对 */}
                                    <PriceHistoryChart rows={detail.data.price_history} locale={locale} />{/* 价格趋势折线图 */}
                                    <ul className="plain-list">{/* 历史价格清单 */}
                                    {detail.data.price_history.map((row, index) => ( // 逐条价格窗口渲染
                                      <li key={`${row.effective_from}-${index}`}>{/* 生效时间 + 序号组合 key，避免同刻重复 */}
                                        <span>{/* 左侧：金额 */}
                                          {(row.amount_minor / 100).toFixed(2)} {row.currency}{/* 分转元 + 币种 */}
                                        </span>{/* 金额结束 */}
                                        <span className="muted">{/* 右侧：生效时间窗口 */}
                                          {formatTime(locale, row.effective_from)}{/* 起始时间 */}
                                          {' → '}{/* 窗口箭头 */}
                                          {row.effective_to ? formatTime(locale, row.effective_to) : locale === 'en-US' ? 'now' : '至今'}{/* 结束时间，空表示至今有效 */}
                                        </span>{/* 时间窗口结束 */}
                                      </li> // 价格行结束
                                    ))}{/* 结束价格遍历 */}
                                    </ul> // 历史价格清单结束
                                  </> // 片段结束
                                )}{/* 结束价格条件渲染 */}
                              </div>{/* 价格历史区块结束 */}
                            </>
                          )}{/* 结束详情数据渲染 */}
                        </div> // 详情容器结束
                      )}{/* 结束展开态条件渲染 */}
                    </section> // 结束模块卡片
                  );
                })}{/* 结束模块遍历 */}
              </div>{/* 结束卡片网格 */}

              <div className="pager">{/* 分页条：上一页 / 页码 / 下一页 + 总数 */}
                <button
                  // 上一页：首页禁用
                  type="button"
                  // 幽灵小按钮
                  className="btn ghost small"
                  // 首页或加载中禁用
                  disabled={page <= 1}
                  // 点击回到上一页
                  onClick={() => setPage(Math.max(1, page - 1))}
                >
                  {locale === 'en-US' ? 'Prev' : '上一页'}{/* 上一页文案 */}
                </button>{/* 上一页结束 */}
                <span className="muted">{/* 页码信息 */}
                  {locale === 'en-US' ? `Page ${page} / ${totalPages}` : `第 ${page} / ${totalPages} 页`}{/* 页码 */}
                </span>{/* 页码结束 */}
                <button
                  // 下一页：末页禁用
                  type="button"
                  // 幽灵小按钮
                  className="btn ghost small"
                  // 末页或加载中禁用
                  disabled={page >= totalPages}
                  // 点击进入下一页
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                >
                  {locale === 'en-US' ? 'Next' : '下一页'}{/* 下一页文案 */}
                </button>{/* 下一页结束 */}
                <span className="count">{locale === 'en-US' ? `${total} modules` : `共 ${total} 个模块`}</span>{/* 总数徽标 */}
              </div>{/* 分页条结束 */}
            </>
          )}{/* 结束空态 / 网格条件渲染 */}
        </div>{/* 右侧主区结束 */}
      </div>{/* 两栏布局结束 */}

      <div className="store-help">{/* 搜索帮助浮窗：右下角固定按钮 + 可展开的 12 条清单 */}
        {helpOpen && ( // 展开态才渲染面板，收起时只留按钮
          <div className="store-help-panel panel">{/* 帮助面板主体 */}
            <div className="panel-head">{/* 面板标题行 */}
              <h3>{locale === 'en-US' ? 'Search help' : '搜索帮助'}</h3>{/* 标题 */}
              <button
                // 关闭按钮
                type="button"
                // 幽灵小按钮，弱化视觉
                className="btn ghost small"
                // 点击收起面板
                onClick={() => setHelpOpen(false)}
              >
                ×{/* 关闭符号 */}
              </button>{/* 关闭按钮结束 */}
            </div>{/* 标题行结束 */}
            <ul className="plain-list">{/* 12 条帮助清单 */}
              {SEARCH_HELP.map((item) => ( // 逐条渲染，文案随语言切换
                <li key={item.zh}>{/* 以中文标题为 key，清单固定不变 */}
                  <a href={item.href} target="_blank" rel="noopener noreferrer">{locale === 'en-US' ? item.en : item.zh}</a>{/* 外链，新窗口打开 */}
                </li> // 单条帮助结束
              ))}{/* 结束帮助遍历 */}
            </ul>{/* 帮助清单结束 */}
          </div> // 帮助面板结束
        )}{/* 结束展开态 */}
        <button
          // 悬浮球式触发按钮：任何滚动位置都可见
          type="button"
          // 主按钮样式，与右下角固定定位配合
          className="btn primary store-help-toggle"
          // 点击在展开/收起间切换
          onClick={() => setHelpOpen(!helpOpen)}
        >
          {helpOpen
            ? (locale === 'en-US' ? 'Hide help' : '收起帮助') // 展开态提示收起
            : (locale === 'en-US' ? 'Search help' : '搜索帮助')}{/* 收起态提示展开 */}
        </button>{/* 触发按钮结束 */}
      </div>{/* 搜索帮助浮窗结束 */}
    </div>
    // 商城页渲染结束，返回 JSX 元素
  );
}
