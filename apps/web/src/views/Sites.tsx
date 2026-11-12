// 统一入口配置清单视图：把去重后的 44 个入口按 19 个业务域呈现，含可配置占位标识、
// 核心功能、职责边界、后台/接口职责、相似入口关联区分，并保留运行时能力点与业务条目交互。
// 用户未提供任何具体主机记录值，本视图不展示、不推导真实域名，只展示可配置占位标识。
import { useEffect, useRef, useState } from 'react'; // 本地状态钩子：搜索词、筛选业务域、展开入口、表单输入、忙碌标记；ref/effect 供图表挂载与销毁
import type { FormEvent } from 'react'; // 表单事件类型：搜索与新建表单的 onSubmit 入参
// 语言类型：约束文案取值为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// ECharts：总览面板把入口状态分布画成饼图，卸载时 dispose 释放实例
import * as echarts from 'echarts';
// 接口客户端、错误文案翻译器与会话读取工具（判断匿名态）
import { api, errorText, getSession } from '../api';
// 清单响应类型：能力点、业务条目、业务域与落地状态
import type { EntryImplementation, EntryImplementationStatus, SiteCapability, SiteItem } from '../api';
// 通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';
// 编程式跳转：匿名访客点击写操作时跳登录伪视图；视图标识类型供直达按钮收窄
import { navigate } from '../router';
import type { AppView } from '../router';

// 组件对外契约：清单文案跟随全局语言；onOpenView 供已落地 / 相邻入口直达站内真实模块
interface Props {
  // 当前界面语言
  locale: Locale;
  // 站内视图跳转回调：由 App 注入统一 go，避免清单视图自行持有路由状态
  onOpenView: (view: AppView) => void;
} // Props 结束

// 业务域编码到英文名的映射，覆盖用户清单的 19 组业务用途
const DOMAIN_EN: Record<string, string> = {
  // 主站门户与跳转
  portal: 'Portal & Redirect',
  // 全站运营管理后台
  admin: 'Admin Console',
  // 统一 API 网关与 APP 端接口
  gateway: 'API & APP Gateway',
  // 认证权限与单点登录
  identity: 'Identity & SSO',
  // 用户与会员中心
  member: 'User & Member',
  // 博客 / 资讯 / 自媒体 / WordPress
  content: 'Publishing',
  // 云盘 / 图床 / 素材 / 下载分发
  storage: 'Storage & Assets',
  // B2C / 支付 / 营销 / 多商户 / B2B / C2C / 供应商 / 货源 / 卖家
  commerce: 'Commerce & Trade',
  // UGC 短视频 / 长视频 / 独立播放页
  video: 'Video',
  // 数据开放 / BI / 爬虫采集
  data: 'Data & Crawler',
  // 开发测试环境与接口文档
  dev: 'Dev & Test',
  // 运维监控 / 安全防护 / 服务治理
  ops: 'Ops & Security',
  // 工单客服与帮助中心
  support: 'Support',
  // 全站资源导航站
  navigation: 'Navigation',
  // 低代码生成平台
  lowcode: 'Low-code',
  // 疾风引擎在线工具
  tools: 'Gale Tools',
  // 语音工具服务
  voice: 'Voice Tools',
  // 移动端 H5 与全功能移动站
  mobile: 'Mobile',
  // 企业内部门户
  intranet: 'Intranet',
}; // DOMAIN_EN 结束

// 状态文案：与三类能力的 states 枚举一一对应，中英双语
const STATE_LABEL: Record<string, { zh: string; en: string }> = {
  // 清单默认态：条目生效中
  active: { zh: '生效中', en: 'Active' },
  // 管理 / 记录初始态：待处理
  pending: { zh: '待处理', en: 'Pending' },
  // 记录完成态
  done: { zh: '已完成', en: 'Done' },
  // 归档终态：所有能力共有，流转后不可再变更
  archived: { zh: '已归档', en: 'Archived' },
}; // STATE_LABEL 结束

// 状态徽标样式：复用既有角色徽标配色（绿=生效/完成，紫=待处理，灰=归档）
const STATE_BADGE: Record<string, string> = {
  // 生效中用绿色
  active: 'role-editor',
  // 已完成同样用绿色
  done: 'role-editor',
  // 待处理用紫色（中性）
  pending: 'role-viewer',
  // 已归档用默认灰
  archived: '',
}; // STATE_BADGE 结束

// 按当前语言取状态文案，未知状态原样展示避免脏数据渲染成空白
function stateText(locale: Locale, status: string): string {
  // 查表命中则按语言取值，否则回退原始状态串
  return STATE_LABEL[status]?.[locale === 'en-US' ? 'en' : 'zh'] ?? status;
} // stateText 结束

// 落地状态文案：四态与共享契约 implementation.status 一一对应，中英双语
const IMPL_LABEL: Record<EntryImplementationStatus, { zh: string; en: string }> = {
  // 已有完整对应模块，可直达使用
  implemented: { zh: '已落地', en: 'Built' },
  // 存在相邻真实能力，但缺该入口完整规格 / 独立界面
  partial: { zh: '部分相邻', en: 'Partial' },
  // 当前无对应实现，保留规划占位
  planned: { zh: '规划中', en: 'Planned' },
  // 现有同名 / 相邻实现与备注语义冲突，需按边界区分
  conflict: { zh: '语义冲突', en: 'Conflict' },
}; // IMPL_LABEL 结束

// 落地状态徽标样式：绿=已落地，紫=部分相邻，灰=规划中，橙棕=语义冲突
const IMPL_BADGE: Record<EntryImplementationStatus, string> = {
  implemented: 'role-editor', // 绿色
  partial: 'role-viewer', // 紫色
  planned: '', // 默认灰
  conflict: 'role-conflict', // 淡橙警示底表达语义冲突
}; // IMPL_BADGE 结束

// 按当前语言取落地状态文案，未知状态回退原始状态码
function implText(locale: Locale, status: string): string {
  // 查表命中按语言取值，否则原样返回
  return IMPL_LABEL[status as EntryImplementationStatus]?.[locale === 'en-US' ? 'en' : 'zh'] ?? status;
} // implText 结束

// 入口状态分布饼图：把 by_status 计数画成 ECharts 环形图，标签走 stateText 翻译；无数据不渲染容器。
function StatusPieChart({ byStatus, locale }: { byStatus: Record<string, number>; locale: Locale }) {
  const hostRef = useRef<HTMLDivElement | null>(null); // 图表挂载容器
  // 数据快照键：统计对象每次渲染都是新引用，拼串作 effect 依赖，避免无关重渲染重建图表
  const dataKey = Object.entries(byStatus).map(([status, value]) => `${status}:${value}`).join('|');

  useEffect(() => { // 容器就绪且统计快照变化时（重新）绘图
    const host = hostRef.current; // 取挂载节点
    if (!host || dataKey === '') return; // 无容器或无数据时不建图
    const chart = echarts.init(host); // 初始化 ECharts 实例
    // 映射饼图数据：状态文案按当前语言翻译，未命中回退原始状态码
    const data = Object.entries(byStatus).map(([status, value]) => ({
      name: stateText(locale, status),
      value,
    }));
    chart.setOption({ // 环形饼图配置
      tooltip: { trigger: 'item' }, // 悬停扇区显示名称与占比
      legend: { bottom: 0, textStyle: { fontSize: 10 } }, // 底部图例
      series: [{
        type: 'pie', // 饼图
        radius: ['38%', '62%'], // 环形内外半径
        center: ['50%', '46%'], // 居中偏上给图例留位
        label: { fontSize: 10 }, // 扇区标签字号
        data, // 扇区数据
      }],
    }); // 配置结束
    const onResize = () => chart.resize(); // 视口缩放时自适应重排
    window.addEventListener('resize', onResize);
    return () => { // 卸载或数据变化前清理
      window.removeEventListener('resize', onResize); // 移除缩放监听
      chart.dispose(); // 销毁实例，释放 canvas 与事件
    };
  }, [dataKey, locale, byStatus]); // 依赖：统计快照键 + 语言；原始对象引用不进依赖

  if (dataKey === '') return null; // 无状态计数时不渲染容器
  return <div ref={hostRef} className="deploy-status-pie" />; // 图表挂载容器
} // StatusPieChart 结束

// 把时间格式化为本地可读串；无效输入原样返回，避免抛错
function formatTime(locale: Locale, iso: string): string {
  // 解析 ISO 时间
  const date = new Date(iso);
  // 非法日期原样返回原文，便于排查脏数据
  if (Number.isNaN(date.getTime())) return iso;
  // 按当前语言输出本地时间，关闭 12 小时制避免歧义
  return date.toLocaleString(locale === 'en-US' ? 'en-US' : 'zh-CN', { hour12: false });
} // formatTime 结束

// 统一入口配置清单：44 个去重入口逐项可查、职责与关联可展开、已落地模块可直达、业务条目可新增与流转
export function Sites({ locale, onOpenView }: Props) {
  // 是否已登录：匿名态跳过写操作，改为展示登录后操作引导
  const authed = Boolean(getSession());
  // 全站汇总：入口 / 能力 / 业务域 / 占位状态 / 条目与状态分布
  const overview = useAsync(() => api.sites.overview(), []);
  // 清单总览：去重整理口径、关联条数、@ 记录与空白字段合并结果
  const manifest = useAsync(() => api.entries.overview(), []);
  // 占位标识清单：46 项（44 入口 + @ 根域名 + 空白占位）的配置状态
  const placeholders = useAsync(() => api.entries.placeholders(), []);
  // 搜索框输入值（未提交）：按键不触发请求
  const [keyword, setKeyword] = useState('');
  // 已提交的搜索词：只有点击搜索 / 回车才生效
  const [applied, setApplied] = useState('');
  // 当前业务域筛选值：空串表示全部 19 个业务域
  const [group, setGroup] = useState('');
  // 当前展开的入口占位键：null 表示全部收起
  const [expandedHost, setExpandedHost] = useState<string | null>(null);
  // 展开模块内当前选中的能力编码：null 表示展示全部能力
  const [activeCap, setActiveCap] = useState<string | null>(null);
  // 当前展开模块的详情（备注原文、行号、能力点、条目统计）
  const detail = useAsync(
    () => (expandedHost ? api.sites.detail(expandedHost) : Promise.resolve(null)),
    [expandedHost],
  );
  // 当前能力下的业务条目：同时受展开模块与选中能力驱动
  const itemsState = useAsync(
    () => (expandedHost ? api.sites.listItems(expandedHost, { capability: activeCap ?? undefined }) : Promise.resolve(null)),
    [expandedHost, activeCap],
  );
  // 模块列表：搜索词或分组变化即重新拉取
  const listState = useAsync(
    () => api.sites.list({ q: applied || undefined, group: group || undefined }),
    [applied, group],
  );
  // 新建表单标题
  const [title, setTitle] = useState('');
  // 新建表单说明
  const [detailText, setDetailText] = useState('');
  // 忙碌标记：区分新建（create）与逐条流转（transition:<id>），避免整页卡住
  const [busy, setBusy] = useState<string | null>(null);
  // 错误提示：写操作失败时展示
  const [error, setError] = useState<string | null>(null);
  // 成功提示：写操作成功后展示
  const [message, setMessage] = useState<string | null>(null);

  // 提交搜索：把输入框值落到 applied，触发列表重新拉取
  function submitSearch(event: FormEvent) {
    // 阻止表单默认跳转，保持单页体验
    event.preventDefault();
    // 去掉首尾空白后生效；空串等价于清除过滤
    setApplied(keyword.trim());
  } // submitSearch 结束

  // 切换模块展开：再次点击同一卡片即收起，切换模块时重置能力选择
  function toggleModule(host: string) {
    // 清空旧错误与提示，避免跨模块残留
    setError(null);
    // 清空旧成功提示
    setMessage(null);
    // 清空新建表单，避免把上一个模块的输入带到新模块
    setTitle('');
    // 清空新建表单说明
    setDetailText('');
    // 能力选择回到「全部」
    setActiveCap(null);
    // 已展开则收起，否则展开该模块
    setExpandedHost((current) => (current === host ? null : host));
  } // toggleModule 结束

  // 切换能力筛选：再次点击同一能力回到全部
  function toggleCapability(code: string) {
    // 用函数式更新避免依赖可能滞后的状态值
    setActiveCap((current) => (current === code ? null : code));
  } // toggleCapability 结束

  // 新建业务条目：写入当前展开模块 + 选中能力（未选能力时用第一个能力）
  async function handleCreate(host: string, capabilities: SiteCapability[]) {
    // 取本次提交使用的能力编码：未选能力时回落到首个能力
    const code = activeCap ?? capabilities[0]?.code ?? '';
    // 能力为空说明契约异常，直接给出可读提示
    if (!code) {
      // 按语言设置错误文案
      setError(locale === 'en-US' ? 'No capability available.' : '该模块暂无可用功能点。');
      // 提前返回，不发起请求
      return;
    } // 能力兜底分支结束
    // 标题去空白后校验，空标题不发请求
    const trimmed = title.trim();
    // 空标题给出提示
    if (!trimmed) {
      // 按语言设置错误文案
      setError(locale === 'en-US' ? 'Title is required.' : '请填写条目标题。');
      // 提前返回
      return;
    } // 标题校验结束
    // 标记新建中，禁用提交按钮
    setBusy('create');
    // 清空旧错误
    setError(null);
    // 清空旧提示
    setMessage(null);
    try {
      // 调用新建接口；写操作由 request 自动带幂等键
      await api.sites.createItem(host, { capability: code, title: trimmed, detail: detailText.trim() });
      // 成功后清空标题，便于连续录入
      setTitle('');
      // 成功后清空说明
      setDetailText('');
      // 按语言展示成功提示
      setMessage(locale === 'en-US' ? 'Item created ✓' : '条目已创建 ✓');
      // 刷新条目列表与模块列表（条目数变化）
      itemsState.reload();
      // 刷新列表卡片上的条目计数
      listState.reload();
      // 刷新全站汇总的条目总数
      overview.reload();
    } catch (err) {
      // 失败展示本地化可读文案
      setError(errorText(locale, err));
    } finally {
      // 解除忙碌态
      setBusy(null);
    } // try/catch/finally 结束
  } // handleCreate 结束

  // 进入已落地 / 相邻模块：优先站内视图直达，其次独立后台外链；规划中入口无直达
  function openModule(impl: EntryImplementation) {
    // 站内视图优先：收窄为 AppView 后交给 App 统一跳转
    if (impl.view) {
      onOpenView(impl.view as AppView);
      return; // 已跳转，不再走外链
    }
    // 独立后台等站外路径：整页跳转（/admin/）
    if (impl.href) window.location.href = impl.href;
  } // openModule 结束

  // 状态流转：把指定条目推进到目标状态
  async function handleTransition(host: string, item: SiteItem, status: string) {
    // 用带前缀的忙碌标记，避免与新建按钮互相干扰
    setBusy(`transition:${item.id}`);
    // 清空旧错误
    setError(null);
    // 清空旧提示
    setMessage(null);
    try {
      // 调用流转接口；后端校验目标状态是否属于该能力的 states
      await api.sites.transitionItem(host, item.id, status);
      // 按语言展示成功提示
      setMessage(locale === 'en-US' ? `Status → ${stateText(locale, status)} ✓` : `状态已更新为「${stateText(locale, status)}」✓`);
      // 刷新条目列表，让徽标立即反映新状态
      itemsState.reload();
    } catch (err) {
      // 失败展示本地化可读文案（如同态重复提交 / 归档终态）
      setError(errorText(locale, err));
    } finally {
      // 解除忙碌态
      setBusy(null);
    } // try/catch/finally 结束
  } // handleTransition 结束

  // 列表加载失败：展示错误 + 重试入口，避免一次请求失败即永久空白
  if (listState.error) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>{locale === 'en-US' ? 'Unified Entry Catalog' : '统一入口配置清单'}</h1>
        </header>
        <p className="error">{errorText(locale, listState.error)}</p>
        <p className="muted">
          {locale === 'en-US'
            ? 'Cannot reach the entry catalog service. Check your network or ad-blocker, then retry.'
            : '无法连接入口配置清单服务，请检查网络或广告拦截插件后重试。'}
        </p>
        <button type="button" className="btn primary" onClick={() => listState.reload()}>
          {locale === 'en-US' ? 'Retry' : '重试'}
        </button>
      </div>
    );
  } // 错误态结束

  // 从响应中取分组与模块，接口未返回时兜底为空数组
  const groups = listState.data?.groups ?? [];
  // 模块列表本体
  const modules = listState.data?.modules ?? [];
  // 汇总数据，未返回时为 null
  const ov = overview.data;
  // 首屏加载态：列表仍在加载时只渲染一行提示
  const loading = listState.loading;

  // 主渲染：概览 + 筛选 + 模块卡片网格
  return (
    // 页面容器：统一留白与最大宽度
    <div className="page">
      <header className="page-head">{/* 页头：标题 + 依据与边界说明 */}
        <h1>{locale === 'en-US' ? 'Unified Entry Catalog' : '统一入口配置清单'}</h1>{/* 标题按语言切换 */}
        <p className="muted">{/* 说明一：划分依据与去重口径 */}
          {locale === 'en-US'
            ? '44 deduplicated entries in 19 business domains, split by the note "entry | business system" pair. Duplicate notes, @ records and blank fields are merged by identical purpose.'
            : '按备注「入口｜业务系统/模块说明」划分 44 个去重入口、19 个业务域；重复备注、@ 记录与空白字段按「完全相同且用途一致按一项」整理。'}{/* 说明一结束 */}
        </p>{/* 说明一结束 */}
        <p className="muted">{/* 说明二：不补写具体主机值 */}
          {locale === 'en-US'
            ? 'No concrete host values were provided, so every entry uses a configurable placeholder; core functions, boundaries and relations are implementation-derived, not note text.'
            : '未提供具体主机值，入口一律使用可配置占位标识；核心功能、职责边界与关联区分均为实现推导，非备注原文。'}{/* 说明二结束 */}
        </p>{/* 说明二结束 */}
      </header>{/* 页头结束 */}

      {manifest.data && ( // 去重整理面板：@ 记录、空白字段与重复备注的合并口径
        <section className="panel entry-intake">{/* 整理面板 */}
          <div className="panel-head">{/* 面板标题行 */}
            <h3>{locale === 'en-US' ? 'Source intake' : '来源整理'}</h3>{/* 标题 */}
          </div>{/* 标题行结束 */}
          <p className="muted">{/* 合并规则原文 */}
            {String(manifest.data.dedupe.rule)}{/* 完全相同且用途一致的条目按一项处理 */}
          </p>{/* 规则结束 */}
          <div className="site-stats">{/* 整理统计网格 */}
            <div className="site-stat">{/* 原始业务备注行 */}
              <span className="site-stat-value">{String(manifest.data.dedupe.businessNoteRows)}</span>
              <span className="muted">{locale === 'en-US' ? 'Raw note rows' : '原始备注行'}</span>
            </div>
            <div className="site-stat">{/* 合并后入口数 */}
              <span className="site-stat-value">{manifest.data.entries}</span>
              <span className="muted">{locale === 'en-US' ? 'Merged entries' : '合并后入口'}</span>
            </div>
            <div className="site-stat">{/* 业务域数 */}
              <span className="site-stat-value">{manifest.data.domains}</span>
              <span className="muted">{locale === 'en-US' ? 'Domains' : '业务域'}</span>
            </div>
            <div className="site-stat">{/* 相似模块关联条数 */}
              <span className="site-stat-value">{manifest.data.relations}</span>
              <span className="muted">{locale === 'en-US' ? 'Relations' : '关联区分'}</span>
            </div>
            <div className="site-stat">{/* @ 记录合并 */}
              <span className="site-stat-value">1</span>
              <span className="muted">{locale === 'en-US' ? '@ merged' : '@ 合并项'}</span>
            </div>
            <div className="site-stat">{/* 空白字段合并 */}
              <span className="site-stat-value">1</span>
              <span className="muted">{locale === 'en-US' ? 'Blank merged' : '空白合并项'}</span>
            </div>
          </div>{/* 整理统计结束 */}
          <ul className="plain-list">{/* 两个不建模块的占位项 */}
            <li>{/* @ 根域名占位 */}
              <code>{String(manifest.data.atRecord.placeholder)}</code>{' · '}
              {locale === 'en-US' ? 'root @ records merged; no business module' : '@ 记录合并为根域名占位，不建业务模块'}
            </li>
            <li>{/* 空白字段占位 */}
              <code>{String(manifest.data.blankRecord.placeholder)}</code>{' · '}
              {locale === 'en-US' ? 'blank notes merged; no business module' : '空白备注合并为占位，不建业务模块'}
            </li>
          </ul>{/* 占位项列表结束 */}
        </section>
      )}{/* 去重整理面板结束 */}

      <section className="panel">{/* 概览面板：注册表规模 + 库内条目统计 */}
        <div className="panel-head">{/* 面板标题行 */}
          <h3>{locale === 'en-US' ? 'Overview' : '总览'}</h3>{/* 区块标题 */}
        </div>{/* 标题行结束 */}
        <div className="site-stats">{/* 统计数字网格 */}
          <div className="site-stat">{/* 去重后入口数 */}
            <span className="site-stat-value">{ov?.modules ?? '—'}</span>{/* 数值：未加载时占位 */}
            <span className="muted">{locale === 'en-US' ? 'Entries' : '入口'}</span>{/* 标签 */}
          </div>{/* 入口数结束 */}
          <div className="site-stat">{/* 业务域数 */}
            <span className="site-stat-value">{ov?.domains ?? '—'}</span>{/* 数值 */}
            <span className="muted">{locale === 'en-US' ? 'Domains' : '业务域'}</span>{/* 标签 */}
          </div>{/* 业务域数结束 */}
          <div className="site-stat">{/* 运行时功能点数 */}
            <span className="site-stat-value">{ov?.capabilities ?? '—'}</span>{/* 数值 */}
            <span className="muted">{locale === 'en-US' ? 'Capabilities' : '功能点'}</span>{/* 标签 */}
          </div>{/* 功能点数结束 */}
          <div className="site-stat">{/* 占位标识总数 */}
            <span className="site-stat-value">{ov?.placeholders ?? '—'}</span>{/* 数值 */}
            <span className="muted">{locale === 'en-US' ? 'Placeholders' : '占位标识'}</span>{/* 标签 */}
          </div>{/* 占位标识结束 */}
          <div className="site-stat">{/* 已配置实际主机值的入口数 */}
            <span className="site-stat-value">{ov?.configured ?? '—'}</span>{/* 数值 */}
            <span className="muted">{locale === 'en-US' ? 'Configured' : '已配置'}</span>{/* 标签 */}
          </div>{/* 已配置结束 */}
          <div className="site-stat">{/* 业务条目数 */}
            <span className="site-stat-value">{ov?.items ?? '—'}</span>{/* 数值 */}
            <span className="muted">{locale === 'en-US' ? 'Items' : '业务条目'}</span>{/* 标签 */}
          </div>{/* 业务条目数结束 */}
        </div>{/* 统计网格结束 */}
        {ov && Object.keys(ov.by_status).length > 0 && ( // 有状态分布时才渲染徽标行
          <p className="muted">{/* 状态分布说明行 */}
            {locale === 'en-US' ? 'By status: ' : '状态分布：'}{/* 前缀 */}
            {Object.entries(ov.by_status).map(([status, count], index) => ( // 逐状态渲染
              <span key={status}>{/* 以状态为 key */}
                {index > 0 && ' · '}{/* 非首项前加分隔符 */}
                {stateText(locale, status)} {count}{/* 状态文案 + 条数 */}
              </span> // 单项结束
            ))}{/* 分布遍历结束 */}
          </p> // 分布行结束
        )}{/* 分布条件渲染结束 */}
        {/* 状态分布环形图：与上方文字罗列互为补充，直观对比各状态占比 */}
        {ov && <StatusPieChart byStatus={ov.by_status} locale={locale} />}
      </section>{/* 概览面板结束 */}

      <form className="form inline" onSubmit={submitSearch}>{/* 筛选行：关键词 + 业务域 + 提交 */}
        <label className="grow">{/* 关键词输入：占满剩余宽度 */}
          {locale === 'en-US' ? 'Search entries' : '搜索入口'}{/* 字段标签 */}
          <input
            // 受控输入框
            value={keyword}
            // 同步输入值到本地状态
            onChange={(event) => setKeyword(event.target.value)}
            // 占位提示按语言切换
            placeholder={locale === 'en-US' ? 'Placeholder / system / note / responsibility' : '占位标识 / 系统名 / 备注 / 职责'}
          />
        </label>{/* 关键词字段结束 */}
        <label>{/* 业务域下拉：19 组业务用途 */}
          {locale === 'en-US' ? 'Domain' : '业务域'}{/* 字段标签 */}
          <select
            // 受控下拉
            value={group}
            // 切换业务域即触发列表重拉
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="">{locale === 'en-US' ? 'All domains' : '全部业务域'}</option>{/* 默认项 */}
            {groups.map((g) => ( // 逐业务域渲染选项
              <option key={g.code} value={g.code}>{/* 选项值即业务域编码 */}
                {locale === 'en-US' ? (DOMAIN_EN[g.code] ?? g.code) : g.name}{` (${g.count})`}{/* 选项文案按语言切换并附入口数 */}
              </option> // 选项结束
            ))}{/* 业务域遍历结束 */}
          </select>
        </label>{/* 业务域字段结束 */}
        <button type="submit" className="btn primary">{/* 搜索按钮 */}
          {locale === 'en-US' ? 'Search' : '搜索'}{/* 按钮文案 */}
        </button>{/* 搜索按钮结束 */}
        {(applied || group) && ( // 有过滤条件时展示计数与清除入口
          <>
            <span className="count">{/* 命中计数 */}
              {locale === 'en-US' ? `${modules.length} result(s)` : `${modules.length} 个结果`}{/* 计数文案 */}
            </span>{/* 计数结束 */}
            <button
              // 清除过滤
              type="button"
              // 幽灵按钮
              className="btn ghost"
              // 同时清空输入框、已提交词与分组
              onClick={() => { setKeyword(''); setApplied(''); setGroup(''); }}
            >
              {locale === 'en-US' ? 'Clear' : '清除'}{/* 清除按钮文案 */}
            </button>
          </>
        )}{/* 过滤状态区结束 */}
      </form>{/* 筛选行结束 */}

      {error && <p className="error">{error}</p>}{/* 写操作失败提示 */}
      {message && <p className="success">{message}</p>}{/* 写操作成功提示 */}

      {loading ? ( // 列表加载中：只渲染一行提示
        <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p> // 加载态
      ) : modules.length === 0 ? ( // 无模块命中时展示空态
        <p className="hint">{/* 空态：区分搜索无结果与分组无模块 */}
          {applied
            ? locale === 'en-US' ? 'No modules match this keyword.' : '没有匹配该关键词的模块。'
            : locale === 'en-US' ? 'No entries in this domain.' : '该业务域下暂无入口。'}{/* 空态文案结束 */}
        </p> // 空态结束
      ) : (
        <div className="cards">{/* 模块卡片网格 */}
          {modules.map((m) => { // 逐模块渲染卡片
            // 本卡片是否处于展开态
            const expanded = expandedHost === m.host;
            // 按语言取分组名
            const groupName = groups.find((g) => g.code === m.group)?.name ?? m.group;
            // 返回单张模块卡片
            return (
              <section key={m.id} className="panel site-card">{/* 卡片容器：以入口序号为唯一 key */}
                <div className="panel-head">{/* 卡片头部：占位键 + 业务域徽标 + 落地状态徽标 */}
                  <h3>{m.entryKey}</h3>{/* 稳定入口标识（占位键），不是具体主机值 */}
                  <span className="badge">{/* 业务域徽标 */}
                    {locale === 'en-US' ? (DOMAIN_EN[m.domain] ?? m.domain) : groupName}{/* 业务域文案 */}
                  </span>{/* 业务域徽标结束 */}
                  <span className={`badge ${IMPL_BADGE[m.implementation.status] ?? ''}`}>{/* 落地状态徽标 */}
                    {implText(locale, m.implementation.status)}{/* 落地状态文案 */}
                  </span>{/* 落地状态徽标结束 */}
                </div>{/* 卡片头部结束 */}
                <p className="site-system">{m.system}</p>{/* 备注后半段：业务系统/模块说明 */}
                <p className="muted site-note">{m.note}</p>{/* 备注原文，作为唯一比对基准 */}
                <div className="task-meta">{/* 元信息：可配置占位标识 + 配置状态 + 来源行号 */}
                  <code>{m.placeholder}</code>{/* 可配置占位标识，不展示任何真实域名 */}
                  <span className={`badge ${m.configured ? 'role-editor' : ''}`}>{/* 配置状态徽标 */}
                    {m.configured
                      ? locale === 'en-US' ? 'configured' : '已配置'
                      : locale === 'en-US' ? 'placeholder only' : '未配置'}{/* 配置状态文案 */}
                  </span>{/* 配置状态结束 */}
                  <span>{/* 来源定位 */}
                    {m.sheet}:{m.rows.join(',')}{/* 工作表 + 两行行号 */}
                  </span>{/* 来源定位结束 */}
                </div>{/* 元信息结束 */}
                <p className="site-detail-title">{/* 核心功能小节标题 */}
                  {locale === 'en-US' ? 'Core functions' : '核心功能'}{/* 标题文案 */}
                </p>{/* 小节标题结束 */}
                <ul className="plain-list entry-functions">{/* 核心功能列表 */}
                  {m.coreFunctions.map((fn) => ( // 逐条渲染核心功能
                    <li key={fn}>{fn}</li> // 功能说明
                  ))}{/* 核心功能遍历结束 */}
                </ul>{/* 核心功能列表结束 */}
                <p className="muted entry-boundary">{/* 职责边界摘要 */}
                  <strong>{locale === 'en-US' ? 'Boundary: ' : '职责边界：'}</strong>
                  {m.responsibility.outOfScope.join(locale === 'en-US' ? '; ' : '；')}{/* 明确排除的范围 */}
                </p>{/* 职责边界结束 */}
                <div className="row">{/* 操作行：数量信息 + 直达按钮 + 展开按钮 */}
                  <span className="muted">{/* 功能点与条目数 */}
                    {m.capability_count} {locale === 'en-US' ? 'capabilities' : '个功能点'} · {m.item_count} {locale === 'en-US' ? 'items' : '条记录'}{/* 数量文案 */}
                  </span>{/* 数量结束 */}
                  {(m.implementation.view || m.implementation.href) && ( // 已有真实模块可直达才展示入口按钮
                    <button
                      // 直达按钮：主色小按钮
                      type="button"
                      className="btn primary small"
                      // 点击进入对应站内视图或独立后台
                      onClick={() => openModule(m.implementation)}
                    >
                      {m.implementation.status === 'conflict' // 冲突入口文案区分：查看相邻实现
                        ? locale === 'en-US' ? 'View adjacent' : '查看相邻实现'
                        : locale === 'en-US' ? 'Open module' : '进入模块'}{/* 按钮文案 */}
                    </button> // 直达按钮结束
                  )}{/* 直达条件渲染结束 */}
                  <button
                    // 展开按钮
                    type="button"
                    // 幽灵小按钮
                    className="btn ghost small"
                    // 点击展开 / 收起
                    onClick={() => toggleModule(m.host)}
                  >
                    {expanded // 按展开态与语言切换文案
                      ? locale === 'en-US' ? 'Hide' : '收起'
                      : locale === 'en-US' ? 'Open' : '展开'}{/* 按钮文案结束 */}
                  </button>{/* 展开按钮结束 */}
                </div>{/* 操作行结束 */}

                {expanded && ( // 展开态渲染详情块
                  <div className="site-detail">{/* 详情容器 */}
                    <p className="site-detail-title">{/* 入口标识小节标题 */}
                      {locale === 'en-US' ? 'Entry identifier' : '入口标识'}
                    </p>{/* 小节标题结束 */}
                    <div className="entry-config">{/* 占位标识与注入键 */}
                      <code>{m.placeholder}</code>{/* 可配置占位标识 */}
                      <span className="muted">{m.envKey}</span>{/* 运行期配置注入键 */}
                      <span className={`badge ${m.configured ? 'role-editor' : ''}`}>{/* 配置状态 */}
                        {m.configured
                          ? locale === 'en-US' ? 'configured' : '已配置'
                          : locale === 'en-US' ? 'placeholder only' : '未配置'}
                      </span>{/* 配置状态结束 */}
                    </div>{/* 占位标识结束 */}
                    <p className="site-detail-title">{/* 职责边界小节标题 */}
                      {locale === 'en-US' ? 'Responsibility boundary' : '职责边界'}
                    </p>{/* 小节标题结束 */}
                    <ul className="plain-list entry-functions">{/* 负责范围 */}
                      {m.responsibility.inScope.map((s) => ( // 逐条渲染负责范围
                        <li key={`in-${s}`}>{locale === 'en-US' ? 'In scope: ' : '负责：'}{s}</li>
                      ))}{/* 负责范围遍历结束 */}
                      {m.responsibility.outOfScope.map((s) => ( // 逐条渲染排除范围
                        <li key={`out-${s}`}>{locale === 'en-US' ? 'Out of scope: ' : '不负责：'}{s}</li>
                      ))}{/* 排除范围遍历结束 */}
                    </ul>{/* 职责边界列表结束 */}
                    <p className="site-detail-title">{/* 后台 / 接口职责小节标题 */}
                      {locale === 'en-US' ? 'Admin & API duties' : '后台与接口职责'}
                    </p>{/* 小节标题结束 */}
                    <ul className="plain-list entry-functions">{/* 两项职责 */}
                      <li>{locale === 'en-US' ? 'Admin: ' : '后台管理：'}{m.adminRole}</li>
                      <li>{locale === 'en-US' ? 'API: ' : '接口职责：'}{m.apiRole}</li>
                    </ul>{/* 两项职责结束 */}
                    {m.implementation.realFeatures.length > 0 && ( // 已有真实能力才渲染已落地功能区块
                      <>
                        <p className="site-detail-title">{/* 已落地功能小节标题 */}
                          {locale === 'en-US' ? 'Implemented features' : '已落地功能'}
                        </p>{/* 标题结束 */}
                        <ul className="plain-list entry-functions">{/* 现有真实能力清单 */}
                          {m.implementation.realFeatures.map((fn) => ( // 逐条渲染真实能力
                            <li key={fn}>{fn}</li> // 能力说明
                          ))}{/* 真实能力遍历结束 */}
                        </ul>{/* 真实能力清单结束 */}
                        <p className="muted entry-boundary">{/* 对齐 / 冲突边界说明 */}
                          <strong>{locale === 'en-US' ? 'Boundary: ' : '落地边界：'}</strong>
                          {m.implementation.boundary}{/* 边界文案 */}
                        </p>{/* 边界说明结束 */}
                      </>
                    )}{/* 已落地功能条件渲染结束 */}
                    {m.implementation.status === 'planned' && ( // 规划中入口：明确标注尚无实现，不展示演示条目冒充
                      <p className="muted entry-boundary">{/* 规划中空态说明 */}
                        <strong>{locale === 'en-US' ? 'Planned: ' : '规划中：'}</strong>
                        {m.implementation.boundary}
                      </p>
                    )}{/* 规划中条件渲染结束 */}
                    <p className="site-detail-title">{/* 相似模块关联与区分小节标题 */}
                      {locale === 'en-US' ? 'Related entries & distinctions' : '相似模块关联与区分'}
                    </p>{/* 小节标题结束 */}
                    <ul className="plain-list entry-relations">{/* 关联清单 */}
                      {m.related.map((r) => ( // 逐条渲染关联与区分
                        <li key={`${m.id}-${r.entryKey}`}>{/* 关联项 */}
                          <code>{r.entryKey}</code>{' — '}{r.distinction}{/* 占位键 + 区分说明 */}
                        </li> // 关联项结束
                      ))}{/* 关联遍历结束 */}
                    </ul>{/* 关联清单结束 */}
                    {detail.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}{/* 详情加载态 */}
                    {detail.error !== null && <p className="error">{errorText(locale, detail.error)}</p>}{/* 详情加载失败 */}
                    {detail.data && detail.data.module.host === m.host && ( // 详情数据就绪且属于当前模块
                      <>
                        <p className="site-detail-title">{locale === 'en-US' ? 'Capabilities' : '功能点'}</p>{/* 小节标题 */}
                        <div className="row site-cap-row">{/* 能力筛选按钮行 */}
                          <button
                            // 「全部」按钮
                            type="button"
                            // 选中时用主按钮，否则幽灵按钮
                            className={`btn small ${activeCap === null ? 'primary' : 'ghost'}`}
                            // 点击回到全部能力
                            onClick={() => setActiveCap(null)}
                          >
                            {locale === 'en-US' ? 'All' : '全部'}{/* 按钮文案 */}
                          </button>{/* 全部按钮结束 */}
                          {detail.data.module.capabilities.map((cap) => ( // 逐能力渲染筛选按钮
                            <button
                              // 以能力编码为 key
                              key={cap.code}
                              // 普通按钮
                              type="button"
                              // 选中态高亮
                              className={`btn small ${activeCap === cap.code ? 'primary' : 'ghost'}`}
                              // 点击切换能力筛选
                              onClick={() => toggleCapability(cap.code)}
                            >
                              {cap.name}{/* 能力展示名 */}
                            </button> // 能力按钮结束
                          ))}{/* 能力遍历结束 */}
                        </div>{/* 能力行结束 */}
                        <ul className="plain-list">{/* 能力说明清单 */}
                          {detail.data.module.capabilities.map((cap) => ( // 逐能力渲染说明
                            <li key={cap.code}>{/* 以能力编码为 key */}
                              <span>{/* 左侧：能力名 + 实体名 */}
                                {cap.name}{/* 能力名 */}
                                <span className="muted">（{cap.itemKind}）</span>{/* 实体名 */}
                              </span>{/* 左侧结束 */}
                              <span className="muted">{/* 右侧：状态机枚举 */}
                                {cap.states.map((s) => stateText(locale, s)).join(' → ')}{/* 允许状态链 */}
                              </span>{/* 右侧结束 */}
                            </li> // 能力行结束
                          ))}{/* 能力说明遍历结束 */}
                        </ul>{/* 能力说明清单结束 */}

                        {m.implementation.status !== 'planned' ? ( // 已落地 / 相邻 / 冲突入口才展示业务条目与新建表单
                        <>
                        <p className="site-detail-title">{locale === 'en-US' ? 'Items' : '业务条目'}</p>{/* 小节标题 */}
                        {itemsState.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}{/* 条目加载态 */}
                        {itemsState.error !== null && <p className="error">{errorText(locale, itemsState.error)}</p>}{/* 条目加载失败 */}
                        {itemsState.data && (itemsState.data.items.length === 0 ? ( // 条目为空时展示说明
                          <p className="muted">{locale === 'en-US' ? 'No items yet.' : '暂无条目。'}</p> // 空态
                        ) : (
                          <ul className="plain-list">{/* 条目清单 */}
                            {itemsState.data.items.map((item) => { // 逐条渲染
                              // 该条目所属能力的定义，用于生成可流转状态按钮
                              const cap = detail.data!.module.capabilities.find((c) => c.code === item.capability);
                              // 允许的目标状态：排除当前状态；归档为终态，不再提供流转
                              const targets = item.status === 'archived' ? [] : (cap?.states ?? []).filter((s) => s !== item.status);
                              // 返回单条条目行
                              return (
                                <li key={item.id} className="wrap">{/* 以条目主键为 key，wrap 允许纵向换行 */}
                                  <div className="site-item-head">{/* 条目头：标题 + 状态徽标 */}
                                    <span>{item.title}</span>{/* 条目标题 */}
                                    <span className={`badge ${STATE_BADGE[item.status] ?? ''}`}>{/* 状态徽标 */}
                                      {stateText(locale, item.status)}{/* 状态文案 */}
                                    </span>{/* 状态徽标结束 */}
                                  </div>{/* 条目头结束 */}
                                  {item.detail && <p className="muted">{item.detail}</p>}{/* 条目说明，非空才渲染 */}
                                  <div className="task-meta">{/* 条目元信息 */}
                                    <code>{item.capability}</code>{/* 能力编码 */}
                                    <span className="muted">{/* 创建者 + 时间 */}
                                      {item.created_by === 'system' ? (locale === 'en-US' ? 'demo' : '演示数据') : item.created_by}
                                      {' · '}{formatTime(locale, item.created_at)}{/* 分隔符 + 创建时间 */}
                                    </span>{/* 创建者时间结束 */}
                                  </div>{/* 元信息结束 */}
                                  {authed && targets.length > 0 && ( // 已登录且存在可流转状态才展示按钮
                                    <div className="row">{/* 状态流转操作行 */}
                                      {targets.map((status) => ( // 逐目标状态渲染按钮
                                        <button
                                          // 以目标状态为 key
                                          key={status}
                                          // 普通按钮
                                          type="button"
                                          // 幽灵小按钮
                                          className="btn ghost small"
                                          // 本条目流转中禁用
                                          disabled={busy === `transition:${item.id}`}
                                          // 点击推进到该状态
                                          onClick={() => void handleTransition(m.host, item, status)}
                                        >
                                          {locale === 'en-US' ? '→ ' : '设为 '}{stateText(locale, status)}{/* 按钮文案 */}
                                        </button> // 流转按钮结束
                                      ))}{/* 目标状态遍历结束 */}
                                    </div> // 操作行结束
                                  )}{/* 流转按钮条件渲染结束 */}
                                </li> // 条目行结束
                              );
                            })}{/* 条目遍历结束 */}
                          </ul> // 条目清单结束
                        ))}{/* 条目空态 / 清单条件渲染结束 */}

                        <p className="site-detail-title">{locale === 'en-US' ? 'New item' : '新建条目'}</p>{/* 小节标题 */}
                        {authed ? ( // 已登录：渲染新建表单
                          <form className="form inline" onSubmit={(event) => { // 提交制：阻止默认跳转后调用创建
                            // 阻止表单默认跳转
                            event.preventDefault();
                            // 调用新建处理函数
                            void handleCreate(m.host, detail.data!.module.capabilities);
                          }}>
                            <label className="grow">{/* 标题字段 */}
                              {locale === 'en-US' ? 'Title' : '标题'}{/* 字段标签 */}
                              <input
                                // 受控输入
                                value={title}
                                // 同步输入值
                                onChange={(event) => setTitle(event.target.value)}
                                // 占位提示
                                placeholder={locale === 'en-US' ? 'Item title' : '条目标题'}
                              />
                            </label>{/* 标题字段结束 */}
                            <label className="grow">{/* 说明字段 */}
                              {locale === 'en-US' ? 'Detail' : '说明'}{/* 字段标签 */}
                              <input
                                // 受控输入
                                value={detailText}
                                // 同步输入值
                                onChange={(event) => setDetailText(event.target.value)}
                                // 占位提示
                                placeholder={locale === 'en-US' ? 'Optional' : '选填'}
                              />
                            </label>{/* 说明字段结束 */}
                            <button
                              // 提交按钮
                              type="submit"
                              // 主按钮
                              className="btn primary"
                              // 新建中禁用
                              disabled={busy === 'create'}
                            >
                              {busy === 'create' // 忙碌态与语言切换文案
                                ? locale === 'en-US' ? 'Creating…' : '创建中…'
                                : locale === 'en-US' ? 'Create' : '新建'}{/* 按钮文案结束 */}
                            </button>{/* 提交按钮结束 */}
                          </form> // 新建表单结束
                        ) : ( // 匿名：展示登录后操作引导，与商城按需登录模型一致
                          <button
                            // 引导按钮
                            type="button"
                            // 幽灵小按钮
                            className="btn ghost small"
                            // 点击跳转登录伪视图
                            onClick={() => navigate({ view: 'login' })}
                          >
                            {locale === 'en-US' ? 'Sign in to edit' : '登录后操作'}{/* 引导文案 */}
                          </button> // 引导按钮结束
                        )}{/* 新建区域条件渲染结束 */}
                        </>
                        ) : ( // 规划中入口：不展示演示条目与新建表单，明确标注尚无业务记录
                          <p className="muted">{locale === 'en-US' ? 'This entry is planned; no business records yet.' : '该入口规划中，暂无业务条目。'}</p>
                        )}{/* 条目区条件分支结束 */}
                      </>
                    )}{/* 详情数据渲染结束 */}
                  </div> // 详情容器结束
                )}{/* 展开态条件渲染结束 */}
              </section> // 卡片结束
            );
          })}{/* 模块遍历结束 */}
        </div> // 卡片网格结束
      )}{/* 加载 / 空态 / 网格条件渲染结束 */}
    </div> // 页面容器结束
  ); // 站点模块矩阵渲染结束
} // Sites 组件结束
