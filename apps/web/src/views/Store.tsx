// 商城视图：两级分类导航（19 个一级分类 / 205 个二级模块）+ 排序 / 开源许可 / 编程语言筛选 + 分页 + 我的权益与订单
import { useState } from 'react'; // 本地状态钩子：分类、排序、筛选项、分页、展开项、忙碌标记等
import type { FormEvent } from 'react'; // 表单事件类型：搜索行 onSubmit 入参（仅类型导入，不产生运行时开销）
// 引入 Locale 类型：约束语言取值为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// 引入核心域常量：排序枚举 / 48 项开源许可 / 87 种编程语言，与后端共用同一份定义避免口径漂移
import { CATALOG_SORT_MODES, LANGUAGE_OPTIONS, LICENSE_OPTIONS } from '@mim/core-domain';
// 引入接口客户端、错误类型（识别依赖缺失）、错误文案翻译器与会话读取工具（判断匿名态）
import { ApiError, api, errorText, getSession } from '../api';
// 引入通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';
// 引入编程式跳转：匿名访客点击「登录后解锁」时跳转登录伪视图
import { navigate } from '../router';
// 引入站点入口契约的门户条目：备注「主站常规访问入口｜官方门户网站」的数据化落点
import { PORTAL_ENTRY } from '../data/siteDirectory';

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
  // 错误提示：解锁失败时展示，null 表示无错误
  const [error, setError] = useState<string | null>(null);
  // 成功提示：解锁成功后展示，null 表示无提示
  const [message, setMessage] = useState<string | null>(null);

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

        <div className="store-main">{/* 右侧主区：入口卡片 + 搜索 + 筛选 + 列表 + 分页 */}
          <section className="panel">{/* 主站入口卡片：文案与链接改由站点入口契约（xls 备注）驱动，渲染结果与改造前逐字一致 */}
            <p className="muted">{/* 单行信息串：名称 · 主机 · 说明 · 链接，格式与用户确认稿一致 */}
              {PORTAL_ENTRY.label}{' '}{/* 文案取自契约 www 条目，分隔点后的空格让链接与上文留出呼吸 */}
              <a
                // 主站外链：指向官方门户网站
                href={PORTAL_ENTRY.href}
                // 新窗口打开，避免跳出当前商城会话
                target="_blank"
                // 禁传 referrer/ opener，防止目标站拿到本页引用与 window.opener
                rel="noopener noreferrer"
              >
                {PORTAL_ENTRY.href}{/* 链接文案与地址一致，所见即所得 */}
              </a>{/* 主站链接结束 */}
            </p>{/* 信息串结束 */}
          </section>{/* 主站入口卡片结束 */}

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
                  // 返回单个模块卡片
                  return (
                    <section key={m.code} className="panel">{/* 卡片容器：复用面板样式，以模块编码作为唯一 key */}
                      <div className="panel-head">{/* 卡片头部：模块名 + 已解锁徽标 */}
                        <h3>{pick(locale, m.name, m.code)}</h3>{/* 模块名：缺失时退化为模块编码 */}
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
                        {!owned && authed && ( // 已登录且未拥有时才提供购买/解锁按钮
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
                        {!owned && !authed && ( // 匿名访客：解锁属收费动作，展示登录入口按钮替代解锁按钮
                          <button
                            // 登录后解锁按钮：普通按钮，避免触发表单提交
                            type="button"
                            // 幽灵小按钮：引导级操作，样式弱于主解锁按钮
                            className="btn ghost small"
                            // 点击跳转登录伪视图，登录成功后回到商城可继续解锁
                            onClick={() => navigate({ view: 'login' })}
                          >
                            {locale === 'en-US' ? 'Sign in to unlock' : '登录后解锁'}{/* 匿名解锁引导文案，随语言切换 */}
                          </button> // 结束登录后解锁按钮
                        )}{/* 结束匿名引导条件渲染 */}
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
                              <div>{/* 依赖链区块 */}
                                <p className="store-detail-title">{locale === 'en-US' ? 'Dependencies' : '依赖链'}</p>{/* 小节标题 */}
                                {detail.data.requires.length === 0 ? ( // 无依赖时展示说明
                                  <p className="muted">{locale === 'en-US' ? 'None' : '无前置依赖'}</p> // 无依赖文案
                                ) : (
                                  <ul className="plain-list">{/* 依赖清单 */}
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
                                  </ul> // 依赖清单结束
                                )}{/* 结束依赖条件渲染 */}
                              </div>{/* 依赖链区块结束 */}
                              <div>{/* 价格历史区块 */}
                                <p className="store-detail-title">{locale === 'en-US' ? 'Price history' : '价格历史'}</p>{/* 小节标题 */}
                                {detail.data.price_history.length === 0 ? ( // 无历史价格时展示说明
                                  <p className="muted">{locale === 'en-US' ? 'No pricing yet' : '暂无定价记录'}</p> // 无定价文案
                                ) : (
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
