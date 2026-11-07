// React 状态钩子：分类筛选与关键词搜索
import { useState } from 'react'; // 两个筛选条件均为组件内状态
// 仅类型导入：语言枚举（'zh-CN' | 'en-US'）
import type { Locale } from '@mim/i18n'; // 用于切换中英文案
// api 命名空间与错误文案工具
import { api, errorText } from '../api'; // listNodes 一次取回 45 个节点
// 仅类型导入：单个站点模块结构
import type { SiteModuleItem } from '../api'; // 含 fqdn / records / node 规格
// 通用异步加载钩子
import { useAsync } from '../hooks'; // 统一处理 loading / error / reload

// 组件入参：仅语言，跟随全局 locale
interface Props {
  locale: Locale; // 当前界面语言
} // Props 结束

// 站点目录：按 8 分类列出 45 个可运行节点，每个节点都是 #/site/<key> 的真实入口
export function SiteDirectory({ locale }: Props) {
  // 一次拉取全量节点规格，分类与搜索都在客户端完成
  const state = useAsync(() => api.site.listNodes(), []); // 空依赖：仅挂载时请求一次
  // 分类过滤状态，默认全部
  const [category, setCategory] = useState<string>('all'); // 'all' 表示不过滤
  // 关键词过滤状态，默认空
  const [query, setQuery] = useState(''); // 输入即过滤

  // 加载态：占位文案
  if (state.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>; // 与站点地图一致的加载反馈
  // 错误态：统一错误文案
  if (state.error) return <div className="error">{errorText(locale, state.error)}</div>; // 复用全局错误码翻译

  // 全量节点列表，接口异常时兜底空数组
  const items: SiteModuleItem[] = state.data?.items ?? []; // 45 条，顺序与 DNSPod 备注一致
  // 分类定义（含双语名与该分类节点数）
  const categories = state.data?.categories ?? []; // 8 个分类
  // 预处理关键词：去空格、转小写
  const needle = query.trim().toLowerCase(); // 大小写不敏感匹配

  // 关键词检索范围：导航名 / 主机名 / 完整域名 / 职责 / 备注
  const filtered = items.filter((item) => { // 先分类后关键词
    if (category !== 'all' && item.category !== category) return false; // 分类不匹配直接剔除
    if (!needle) return true; // 无关键词则全部保留
    return [ // 拼接全部可检索字段
      item.node.nav.zh, // 中文导航名
      item.node.nav.en, // 英文导航名
      item.host, // 主机名
      item.fqdn, // 完整域名
      item.node.duty.zh, // 中文职责
      item.node.duty.en, // 英文职责
      item.label, // DNSPod 备注第一段
      item.description, // DNSPod 备注第二段
    ].join(' ').toLowerCase().includes(needle); // 空格拼接避免跨字段误匹配
  }); // 过滤结束

  // 按分类分组并剔除空分组
  const groups = categories
    .map((c) => ({ ...c, nodes: filtered.filter((m) => m.category === c.id) })) // 挂上该分类的命中节点
    .filter((g) => g.nodes.length > 0); // 空分类不渲染

  // 双语分类名
  const categoryName = (name: { zh: string; en: string }) => (locale === 'en-US' ? name.en : name.zh); // 英文取 en，其余取 zh

  // 渲染页面
  return (
    <div className="page">{/* 页面容器 */}
      <header className="page-head">{/* 页头：标题 + 描述 + 命中计数 */}
        <div>{/* 标题与描述 */}
          <h1>{locale === 'en-US' ? 'Site Directory' : '站点目录'}</h1>{/* 标题 */}
          <p className="muted">{/* 描述：说明 45 节点 / 8 分类的来源 */}
            {locale === 'en-US'
              ? `${items.length} runnable nodes in ${categories.length} categories, mapped to mixm.top`
              : `站点地图 ${items.length} 个可运行节点 · ${categories.length} 个分类 · 域名映射 mixm.top`}{/* 描述文案 */}
          </p>{/* 描述结束 */}
        </div>{/* 标题区结束 */}
        <span className="badge">{filtered.length} / {items.length}</span>{/* 命中数 / 总数 */}
      </header>{/* 页头结束 */}

      <div className="form inline">{/* 搜索区 */}
        <label className="grow">{/* 搜索输入框 */}
          {locale === 'en-US' ? 'Search' : '搜索'}{/* 输入框标签 */}
          <input
            value={query} // 受控值
            placeholder={locale === 'en-US' ? 'name / host / domain / duty' : '名称 / 主机 / 域名 / 职责'} // 占位提示
            onChange={(e) => setQuery(e.target.value)} // 输入即更新
          />{/* 输入框结束 */}
        </label>{/* 标签结束 */}
      </div>{/* 搜索区结束 */}

      <div className="row">{/* 分类筛选按钮行 */}
        <button
          type="button" // 普通按钮
          className={`btn small${category === 'all' ? ' primary' : ' ghost'}`} // 选中态样式
          onClick={() => setCategory('all')} // 清除分类过滤
        >
          {locale === 'en-US' ? 'All' : '全部'}{/* 「全部」文案 */}
        </button>{/* 全部按钮结束 */}
        {categories.map((c) => ( // 逐分类渲染按钮
          <button
            key={c.id} // 分类唯一键
            type="button" // 普通按钮
            className={`btn small${category === c.id ? ' primary' : ' ghost'}`} // 选中态样式
            onClick={() => setCategory(c.id)} // 切换分类
          >
            {categoryName(c.name)}{/* 分类双语名 */}
          </button> // 分类按钮结束
        ))}{/* 分类遍历结束 */}
      </div>{/* 筛选行结束 */}

      {groups.length === 0 ? ( // 无匹配结果
        <p className="hint">{locale === 'en-US' ? 'No matching nodes.' : '没有匹配的节点。'}</p> // 空态提示
      ) : (
        groups.map((group) => ( // 逐分类渲染
          <section key={group.id}>{/* 分类分区 */}
            <div className="page-head">{/* 分区头 */}
              <h2>{categoryName(group.name)}</h2>{/* 分类名 */}
              <span className="count">{group.nodes.length}</span>{/* 该分类命中数 */}
            </div>{/* 分区头结束 */}
            <div className="site-node-grid">{/* 节点卡片网格 */}
              {group.nodes.map((item) => ( // 逐节点渲染
                <a
                  key={item.host} // 主机唯一键
                  href={item.node.route} // 真实链接：#/site/<key>，触发 hashchange
                  className="site-node-card" // 卡片样式
                >
                  <div className="panel-head">{/* 卡片头 */}
                    <strong className="site-node-title">{locale === 'en-US' ? item.node.nav.en : item.node.nav.zh}</strong>{/* 导航名 */}
                    <span className="badge">{item.node.kind}</span>{/* 职责类型徽标 */}
                  </div>{/* 卡片头结束 */}
                  <code className="site-node-domain">{item.fqdn}</code>{/* 域名映射 */}
                  <p className="muted">{locale === 'en-US' ? item.node.duty.en : item.node.duty.zh}</p>{/* 模块职责 */}
                  <span className="link">{locale === 'en-US' ? 'Open module →' : '进入模块 →'}</span>{/* 入口提示 */}
                </a> // 节点卡片结束
              ))}{/* 节点遍历结束 */}
            </div>{/* 网格结束 */}
          </section> // 分类分区结束
        ))
      )}{/* 空态 / 分组条件结束 */}
    </div> // 页面容器结束
  ); // 渲染结束
} // SiteDirectory 结束
