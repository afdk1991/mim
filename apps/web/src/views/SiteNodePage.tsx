// React 状态钩子：节点接口详情、复制反馈等局部状态
import { useState } from 'react'; // 全部交互状态都收敛在本页内
// 仅类型导入：语言枚举
import type { Locale } from '@mim/i18n'; // 用于中英文案切换
// api 命名空间与错误文案工具
import { api, errorText } from '../api'; // listNodes 取全量、getModule 取单节点实时详情
// 仅类型导入：站点模块结构
import type { SiteModuleItem } from '../api'; // 详情请求返回同一结构
// 通用异步加载钩子
import { useAsync } from '../hooks'; // 目录数据一次加载

// 组件入参：语言 + 由 hash 路由解析出的节点键
interface Props {
  locale: Locale; // 当前界面语言
  routeKey: string; // 如 www / root / gy，对应 SiteNodeSpec.key
} // Props 结束

// 节点页「下属栏目」清单：id 与页面 section 的 DOM id 一一对应，文案双语
const SECTIONS: Array<{ id: string; zh: string; en: string }> = [
  // 概览：页头、面包屑与顶部操作区
  { id: 'overview', zh: '概览', en: 'Overview' }, // 默认高亮栏目
  // 域名映射：FQDN、解析记录明细与 HTTPS 入口
  { id: 'domain', zh: '域名映射', en: 'Domain' }, // 逐条记录不遗漏
  // 站点地图条目：DNSPod 备注两段与 record 级备注
  { id: 'remark', zh: '站点地图条目', en: 'Sitemap Entry' }, // 还原站点地图原始条目
  // 模块职责：按职责类型给出的能力清单
  { id: 'duty', zh: '模块职责', en: 'Responsibilities' }, // 可运行能力说明
  // 关联节点：links 指向的其它 45 节点入口
  { id: 'related', zh: '关联节点', en: 'Related' }, // 可点击的关联入口
]; // 栏目清单结束

// 单节点模块页：把站点地图的每个节点落成可运行的页面（职责 / 域名映射 / 关联 / 实时接口）
export function SiteNodePage({ locale, routeKey }: Props) {
  // 目录数据：45 节点 + 8 分类 + 能力清单，一次拉取供本页全部区块复用
  const state = useAsync(() => api.site.listNodes(), []); // 空依赖：仅挂载时请求
  // 实时接口详情：点击「读取节点接口详情」后写入
  const [detail, setDetail] = useState<SiteModuleItem | null>(null); // 未读取时为 null
  // 详情请求进行中标记
  const [detailBusy, setDetailBusy] = useState(false); // 控制按钮禁用与加载文案
  // 详情请求失败标记
  const [detailErr, setDetailErr] = useState(false); // 失败时给出可重试提示
  // 域名复制成功反馈
  const [copied, setCopied] = useState(false); // 短暂显示「已复制」
  // 当前栏目高亮：默认概览，点击栏目按钮时同步更新导航状态
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id); // 仅影响本页栏目导航

  // 栏目跳转：滚动到对应区块并更新高亮；不使用 hash 片段，避免污染 #/site/<key> 路由
  function jumpTo(id: string) { // 栏目按钮点击触发
    setActiveSection(id); // 先更新高亮，保证即时反馈
    const el = document.getElementById(id); // 按 id 定位目标区块
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); // 浏览器原生平滑滚动，无第三方依赖
  } // jumpTo 结束

  // 加载态：占位文案
  if (state.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>; // 与目录页一致
  // 错误态：统一错误文案
  if (state.error) return <div className="error">{errorText(locale, state.error)}</div>; // 复用全局错误码翻译

  // 全量节点列表（45 条）
  const items: SiteModuleItem[] = state.data?.items ?? []; // 接口异常时兜底空数组
  // 按路由键定位当前节点：'@' 已在后端映射为 'root'
  const index = items.findIndex((i) => i.node.key === routeKey); // 找不到时为 -1
  // 当前节点；未命中时保持 null
  const item = index >= 0 ? items[index] : null; // 供下方各区块使用
  // 能力清单：按职责类型取 3 条双语说明
  const capabilities = state.data?.capabilities ?? {}; // 键为 SiteNodeKind
  // 当前节点的职责清单
  const caps = item ? capabilities[item.node.kind] ?? [] : []; // 未知类型回落空数组

  // 读取单节点实时接口详情：真实调用 GET /site/modules/:host，验证节点可用
  async function loadDetail() { // 按钮点击触发，非自动请求，避免无谓流量
    if (!item) return; // 节点不存在时直接返回
    setDetailBusy(true); // 进入请求态
    setDetailErr(false); // 清掉上一次错误
    try { // 网络失败不应影响页面其余部分
      const res = await api.site.getModule(item.host); // host 含 '@' 时内部会 encodeURIComponent
      setDetail(res.module); // 写入详情，展示原始域名映射字段
    } catch { // 统一收敛失败
      setDetailErr(true); // 仅标记，页面其余区块照常可用
    } finally { // 无论成败都退出请求态
      setDetailBusy(false); // 恢复按钮
    } // try/catch/finally 结束
  } // loadDetail 结束

  // 复制完整域名到剪贴板：非安全上下文不可用，失败时静默回落
  async function copyDomain() { // 按钮点击触发
    if (!item) return; // 无节点时直接返回
    try { // clipboard API 在 http 环境可能被禁用
      await navigator.clipboard.writeText(item.fqdn); // 写入 fqdn
      setCopied(true); // 显示反馈
      window.setTimeout(() => setCopied(false), 1600); // 1.6 秒后复位
    } catch { // 失败不弹错误，用户仍可手动选中
      setCopied(false); // 保持原状态
    } // 异常处理结束
  } // copyDomain 结束

  // 未知路由键：给出明确提示与返回目录入口，避免白屏
  if (!item) { // index === -1 分支
    return (
      <div className="page">{/* 页面容器 */}
        <h1>{locale === 'en-US' ? 'Node not found' : '节点不存在'}</h1>{/* 标题 */}
        <p className="muted">{routeKey}</p>{/* 回显未知键，便于排查 */}
        <a className="btn ghost" href="#/directory">{locale === 'en-US' ? '← Back to directory' : '← 返回站点目录'}</a>{/* 返回入口 */}
      </div> // 页面容器结束
    ); // 渲染结束
  } // 未知节点分支结束

  // 关联节点：按 links 里的 host 回查目录，过滤掉悬空项（后端已断言，此处再兜底）
  const related = item.node.links
    .map((host) => items.find((i) => i.host === host)) // host → 节点
    .filter((n): n is SiteModuleItem => Boolean(n)); // 类型收窄，去掉 undefined
  // 上一个节点（按站点地图顺序）
  const prev = index > 0 ? items[index - 1] : null; // 首个节点无上一项
  // 下一个节点
  const next = index < items.length - 1 ? items[index + 1] : null; // 末节点无下一项
  // 当前分类双语名
  const categoryName = locale === 'en-US' ? item.category_name.en : item.category_name.zh; // 接口已返回双语分类名
  // 当前导航名
  const navName = locale === 'en-US' ? item.node.nav.en : item.node.nav.zh; // 双语导航名
  // 当前职责一句话
  const duty = locale === 'en-US' ? item.node.duty.en : item.node.duty.zh; // 双语职责

  // 渲染节点模块页
  return (
    <div className="page">{/* 页面容器 */}
      <div className="site-crumb">{/* 面包屑：站点地图 → 目录 → 分类 → 节点，四个层级均可回跳 */}
        <a href="#/sitemap">{locale === 'en-US' ? 'Site Map' : '站点地图'}</a>{/* 站点地图原始备注视图 */}
        <span>/</span>{/* 分隔符 */}
        <a href="#/directory">{locale === 'en-US' ? 'Site Directory' : '站点目录'}</a>{/* 8 分类 / 45 节点目录 */}
        <span>/</span>{/* 分隔符 */}
        <span>{categoryName}</span>{/* 分类层级 */}
        <span>/</span>{/* 分隔符 */}
        <strong>{navName}</strong>{/* 当前节点 */}
      </div>{/* 面包屑结束 */}

      <header className="page-head" id="overview">{/* 概览栏目：页头与顶部操作区 */}
        <div>{/* 标题区 */}
          <h1>{navName}</h1>{/* 节点标题 */}
          <p className="muted">{duty}</p>{/* 模块职责一句话 */}
        </div>{/* 标题区结束 */}
        <span className="badge">{locale === 'en-US' ? 'Module ready' : '模块骨架已就绪'}</span>{/* 状态徽标 */}
      </header>{/* 页头结束 */}

      <div className="site-actions">{/* 顶部操作区 */}
        <a className="btn primary" href={item.urls[0]} target="_blank" rel="noreferrer">{/* 线上站点外链 */}
          {locale === 'en-US' ? 'Open site ↗' : '打开线上站点 ↗'}{/* 按钮文案 */}
        </a>{/* 外链结束 */}
        <button type="button" className="btn ghost" onClick={() => void copyDomain()}>{/* 复制域名 */}
          {copied ? (locale === 'en-US' ? 'Copied ✓' : '已复制 ✓') : (locale === 'en-US' ? 'Copy domain' : '复制域名')}{/* 反馈文案 */}
        </button>{/* 复制按钮结束 */}
        <button type="button" className="btn ghost" disabled={detailBusy} onClick={() => void loadDetail()}>{/* 实时接口详情 */}
          {detailBusy ? (locale === 'en-US' ? 'Loading…' : '读取中…') : (locale === 'en-US' ? 'Fetch node API' : '读取节点接口详情')}{/* 按钮文案 */}
        </button>{/* 详情按钮结束 */}
        <a className="btn ghost" href="#/directory">{locale === 'en-US' ? 'All nodes' : '全部节点'}</a>{/* 返回目录 */}
        <a className="btn ghost" href="#/sitemap">{locale === 'en-US' ? 'Site Map' : '站点地图'}</a>{/* 回到站点地图卡片视图 */}
      </div>{/* 操作区结束 */}

      <nav className="site-sec-nav">{/* 本模块下属栏目导航：点击滚动到对应区块并高亮当前栏目 */}
        {SECTIONS.map((sec) => ( // 按栏目清单逐项渲染
          <button
            // 栏目唯一键，与 section 的 DOM id 一致
            key={sec.id} // 用于 React 复用判断
            // 普通按钮，不提交表单
            type="button" // 避免触发表单默认行为
            // 当前栏目高亮 active，保证导航状态可见
            className={`site-sec-btn${activeSection === sec.id ? ' active' : ''}`} // 选中态与侧栏导航同款命名
            // 点击滚动到该栏目
            onClick={() => jumpTo(sec.id)} // 不改写地址栏 hash
          >
            {/* 栏目双语名称 */}
            {locale === 'en-US' ? sec.en : sec.zh}{/* 随全局语言切换 */}
          </button> // 栏目按钮结束
        ))}{/* 栏目遍历结束 */}
      </nav>{/* 栏目导航结束 */}

      <section className="panel" id="domain">{/* 域名映射面板 */}
        <div className="panel-head">{/* 面板头 */}
          <h2>{locale === 'en-US' ? 'Domain mapping' : '域名映射'}</h2>{/* 标题 */}
          <span className="badge">{item.node.route}</span>{/* 站内路由 */}
        </div>{/* 面板头结束 */}
        <div className="site-kv">{/* 键值表 */}
          <div className="site-kv-row"><span className="site-kv-key">{locale === 'en-US' ? 'Host' : '主机名'}</span><code>{item.host}</code></div>{/* 主机名 */}
          <div className="site-kv-row"><span className="site-kv-key">FQDN</span><code>{item.fqdn}</code></div>{/* 完整域名 */}
          {item.records.map((rec) => ( // 逐条解析记录渲染，不遗漏任何 zone 的下属条目
            <div className="site-kv-row" key={rec.zone}>{/* 每条记录一行，zone 为唯一键 */}
              <span className="site-kv-key">{locale === 'en-US' ? 'Record' : '解析记录'} · {rec.zone}</span>{/* 记录所属 zone */}
              <code>{rec.fqdn} · {rec.record_type} · TTL {rec.ttl}s</code>{/* 域名 / 类型 / TTL 三要素 */}
            </div> // 记录行结束
          ))}{/* 记录遍历结束 */}
          {item.urls.map((url, i) => ( // 逐条 HTTPS 入口渲染，与 records 一一对应
            <div className="site-kv-row" key={url}>{/* 地址本身唯一，直接作键 */}
              <span className="site-kv-key">{locale === 'en-US' ? 'HTTPS entry' : 'HTTPS 入口'} · {i + 1}</span>{/* 入口序号 */}
              <a href={url} target="_blank" rel="noreferrer">{url}</a>{/* 可点击的线上入口 */}
            </div> // 入口行结束
          ))}{/* 入口遍历结束 */}
          <div className="site-kv-row"><span className="site-kv-key">{locale === 'en-US' ? 'Category' : '所属分类'}</span><code>{categoryName} · {item.category}</code></div>{/* 分类层级 */}
        </div>{/* 键值表结束 */}
        <p className="muted">{locale === 'en-US' ? 'Resolution targets are intentionally not exposed.' : '按站点地图口径，不对外暴露解析目标值（IP / CNAME 目标）。'}</p>{/* 边界说明 */}
        {detailErr && <p className="error">{locale === 'en-US' ? 'Node API request failed, please retry.' : '节点接口读取失败，可重试。'}</p>}{/* 详情失败提示 */}
        {detail && (<pre className="dev-code">{JSON.stringify({ host: detail.host, fqdn: detail.fqdn, node: detail.node.key, records: detail.records.length }, null, 2)}</pre>)}{/* 实时接口返回摘要 */}
      </section>{/* 域名映射面板结束 */}

      <section className="panel" id="remark">{/* 站点地图条目：还原 DNSPod 备注列的下属条目 */}
        <div className="panel-head">{/* 面板头 */}
          <h2>{locale === 'en-US' ? 'Sitemap entry' : '站点地图条目'}</h2>{/* 标题 */}
          <span className="badge">{index + 1} / {items.length}</span>{/* 该节点在 45 节点目录中的序号 */}
        </div>{/* 面板头结束 */}
        <div className="site-kv">{/* 原始条目键值表 */}
          <div className="site-kv-row"><span className="site-kv-key">{locale === 'en-US' ? 'Remark · label' : '备注 · 模块定位'}</span><code>{item.label}</code></div>{/* 备注第一段 */}
          <div className="site-kv-row"><span className="site-kv-key">{locale === 'en-US' ? 'Remark · description' : '备注 · 站点说明'}</span><code>{item.description}</code></div>{/* 备注第二段 */}
          <div className="site-kv-row"><span className="site-kv-key">{locale === 'en-US' ? 'Category' : '分类层级'}</span><code>{categoryName} · {item.category}</code></div>{/* 8 分类中的归属 */}
          {item.records.filter((rec) => rec.label || rec.description).map((rec) => ( // 仅 gy 等带 record 级覆盖的节点会渲染
            <div className="site-kv-row" key={`remark-${rec.zone}`}>{/* 记录级备注按 zone 区分 */}
              <span className="site-kv-key">{locale === 'en-US' ? 'Record remark' : '记录级备注'} · {rec.zone}</span>{/* 覆盖项所属 zone */}
              <code>{[rec.label, rec.description].filter(Boolean).join(' · ')}</code>{/* 覆盖的两段备注 */}
            </div> // 记录级备注行结束
          ))}{/* 记录级备注遍历结束 */}
        </div>{/* 原始条目键值表结束 */}
        <p className="muted">{locale === 'en-US' ? 'Source: DNSPod export remark column; resolution targets stay private.' : '条目来自 DNSPod 导出「备注」列；解析目标值按站点地图口径不对外暴露。'}</p>{/* 数据来源与边界 */}
      </section>{/* 站点地图条目面板结束 */}

      <section className="panel" id="duty">{/* 模块职责面板 */}
        <div className="panel-head">{/* 面板头 */}
          <h2>{locale === 'en-US' ? 'Module responsibilities' : '模块职责'}</h2>{/* 标题 */}
          <span className="badge">{item.node.kind}</span>{/* 职责类型 */}
        </div>{/* 面板头结束 */}
        <ul className="site-cap">{/* 能力清单 */}
          {caps.map((cap, i) => ( // 逐条渲染
            <li key={i}>{locale === 'en-US' ? cap.en : cap.zh}</li> // 双语能力说明
          ))}{/* 遍历结束 */}
        </ul>{/* 清单结束 */}
        <p className="muted">{locale === 'en-US' ? 'Skeleton, navigation, routing and domain mapping are live; business capabilities plug into this contract.' : '页面、路由、导航入口与域名映射已可运行；业务能力按上述职责清单接入本模块契约。'}</p>{/* 交付边界，避免夸大实现范围 */}
      </section>{/* 职责面板结束 */}

      <section className="panel" id="related">{/* 关联节点面板 */}
        <div className="panel-head">{/* 面板头 */}
          <h2>{locale === 'en-US' ? 'Related nodes' : '关联节点'}</h2>{/* 标题 */}
          <span className="count">{related.length}</span>{/* 关联数 */}
        </div>{/* 面板头结束 */}
        <div className="site-related">{/* 关联链接列表 */}
          {related.map((r) => ( // 逐条渲染
            <a key={r.host} href={r.node.route} className="btn ghost small">{/* 可点击的节点入口 */}
              {locale === 'en-US' ? r.node.nav.en : r.node.nav.zh}{/* 关联节点导航名 */}
            </a> // 链接结束
          ))}{/* 遍历结束 */}
        </div>{/* 列表结束 */}
      </section>{/* 关联面板结束 */}

      <div className="site-pager">{/* 上一 / 下一节点 */}
        {prev ? (<a href={prev.node.route}>← {locale === 'en-US' ? prev.node.nav.en : prev.node.nav.zh}</a>) : <span />}{/* 上一节点 */}
        {next ? (<a href={next.node.route}>{locale === 'en-US' ? next.node.nav.en : next.node.nav.zh} →</a>) : <span />}{/* 下一节点 */}
      </div>{/* 翻页结束 */}
    </div> // 页面容器结束
  ); // 渲染结束
} // SiteNodePage 结束
