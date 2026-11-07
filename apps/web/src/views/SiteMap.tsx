// React 状态钩子：用于分类 / 关键词两个筛选条件
import { useState } from 'react';
// 仅类型导入：语言枚举（'zh-CN' | 'en-US'）
import type { Locale } from '@mim/i18n';
// api 命名空间与错误文案工具
import { api, errorText } from '../api';
// 仅类型导入：模块列表项结构
import type { SiteModuleItem } from '../api';
// 通用异步加载钩子：返回 { data, error, loading, reload }
import { useAsync } from '../hooks';

// 组件入参：仅语言，跟随全局 locale
interface Props {
  // 当前界面语言，用于取标题、描述与分类名
  locale: Locale;
}

// 按 locale 取分类双语名称：英文取 name.en，其余取 name.zh
function categoryName(locale: Locale, name: { zh: string; en: string }): string {
  // 英文环境下返回英文名
  return locale === 'en-US' ? name.en : name.zh;
}

/** 把 DNSPod 备注（label / description）落成可按 zone 过滤的站点模块视图 */
export function SiteMap({ locale }: Props) {
  // 一次性拉取 45 条模块；后续筛选全部在客户端完成，避免频繁请求
  const state = useAsync(() => api.site.listModules(), []);
  // 分类过滤状态，默认全部
  const [category, setCategory] = useState<string>('all');
  // 关键词搜索状态，默认空
  const [query, setQuery] = useState('');

  // 加载态：显示占位文案
  if (state.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  // 错误态：统一错误文案渲染
  if (state.error) return <div className="error">{errorText(locale, state.error)}</div>;

  // 模块列表本体，接口异常时兜底为空数组
  const modules: SiteModuleItem[] = state.data?.items ?? [];
  // 预处理搜索关键词：去空格并转小写，实现大小写不敏感匹配
  const needle = query.trim().toLowerCase();

  // 从模块列表中归并出实际存在的分类（保持接口返回顺序）
  const categories = modules.reduce<Array<{ id: string; name: { zh: string; en: string } }>>(
    (acc, item) => {
      // 该分类尚未收集过则追加
      if (!acc.some((c) => c.id === item.category)) {
        // 记录分类 id 与双语名称
        acc.push({ id: item.category, name: item.category_name });
      }
      // 返回累加器
      return acc;
    },
    [],
  );

  // 执行两级筛选：category → 关键词
  const filtered = modules.filter((item) => {
    // 分类过滤：分类不匹配则剔除
    if (category !== 'all' && item.category !== category) return false;
    // 关键词为空则直接通过
    if (!needle) return true;
    // 关键词检索范围：host / 模块备注 / 记录 fqdn、record 级备注
    return [
      // 主机名
      item.host,
      // 模块级备注第一段
      item.label,
      // 模块级备注第二段
      item.description,
      // 每条记录的 fqdn、record 级备注（覆盖项）
      ...item.records.flatMap((r) => [r.fqdn, r.label ?? '', r.description ?? '']),
    ]
      // 空格拼接避免跨字段误匹配
      .join(' ')
      // 小写化
      .toLowerCase()
      // 包含关键词即命中
      .includes(needle);
  });

  // 按分类分组，并剔除筛选后为空的分类
  const groups = categories
    // 为每个分类挂上筛选后的模块子集
    .map((c) => ({ ...c, items: filtered.filter((m) => m.category === c.id) }))
    // 过滤掉空分组，避免无意义的分区标题
    .filter((g) => g.items.length > 0);

  // 渲染页面
  return (
    // 页面容器
    <div className="page">
      <header className="page-head">{/* 页头：标题 + 描述 + 命中计数徽标 */}
        <div>{/* 左侧标题与描述 */}
          <h1>{locale === 'en-US' ? 'Site Map' : '站点地图'}</h1>{/* 标题：按 locale 切换中英文 */}
          <p className="muted">{/* 描述：数据来源（DNSPod 备注）与规模 */}
            {locale === 'en-US' // 英文描述文案
              ? `${modules.length} modules on mixm.top, grouped by DNSPod remark`
              : `DNSPod 备注结构化的 ${modules.length} 个站点模块（mixm.top）`}{/* 描述文案结束 */}
          </p>{/* 结束描述段落 */}
        </div>{/* 结束左侧标题区 */}
        <span className="badge">{filtered.length} / {modules.length}</span>{/* 命中数 / 总数 */}
      </header>{/* 结束页头 */}

      <div className="form inline">{/* 筛选区：搜索框 */}
        <label className="grow">{/* 搜索输入框：占满剩余宽度 */}
          {locale === 'en-US' ? 'Search' : '搜索'}{/* 输入框标题文案 */}
          <input
            // 受控值：绑定 query
            value={query}
            // 占位提示：可搜主机 / 备注
            placeholder={locale === 'en-US' ? 'host / remark' : '主机 / 备注'}
            // 输入即更新关键词
            onChange={(e) => setQuery(e.target.value)}
          />{/* 搜索框结束 */}
        </label>{/* 结束搜索标签 */}
      </div>{/* 结束筛选区 */}

      <div className="row">{/* 分类筛选按钮行 */}
        <button
          // 「全部」按钮：普通按钮
          type="button"
          // 选中时 primary，否则 ghost
          className={`btn small${category === 'all' ? ' primary' : ' ghost'}`}
          // 点击清除分类过滤
          onClick={() => setCategory('all')}
        >
          {locale === 'en-US' ? 'All' : '全部'}{/* 「全部」文案 */}
        </button>{/* 结束「全部」按钮 */}
        {categories.map((c) => ( // 遍历实际存在的分类
          <button
            // 分类唯一键
            key={c.id}
            // 普通按钮
            type="button"
            // 选中态样式
            className={`btn small${category === c.id ? ' primary' : ' ghost'}`}
            // 点击切换分类
            onClick={() => setCategory(c.id)}
          >
            {categoryName(locale, c.name)}{/* 分类双语名 */}
          </button> // 结束分类按钮
        ))}{/* 结束分类遍历 */}
      </div>{/* 结束分类筛选行 */}

      {groups.length === 0 ? ( // 空结果提示 / 分组卡片列表
        <p className="hint">{locale === 'en-US' ? 'No matching modules.' : '没有匹配的模块。'}</p> // 无匹配模块时的占位文案
      ) : (
        groups.map((group) => ( // 逐分组渲染
          <section key={group.id}>{/* 单分类分区 */}
            <div className="page-head">{/* 分区头：分类名 + 条目数 */}
              <h2>{categoryName(locale, group.name)}</h2>{/* 分类名 */}
              <span className="count">{group.items.length}</span>{/* 该分类下命中数量 */}
            </div>{/* 结束分区头 */}
            <div className="cards">{/* 卡片网格 */}
              {group.items.map((item) => { // 遍历该分类下的模块
                // 当前卡片要展示的记录：单一 zone（mixm.top）的全部记录
                const records = item.records;
                // 返回单模块卡片
                return (
                  <article key={item.host} className="panel">{/* 卡片容器 */}
                    <div className="panel-head">{/* 卡片头：模块备注名 + 主机名 */}
                      <strong>{item.label}</strong>{/* 模块级备注第一段（备用名） */}
                      <code>{item.host}</code>{/* 主机名，如 gy / api / @ */}
                    </div>{/* 结束卡片头 */}
                    <p className="muted">{item.description}</p>{/* 模块级备注第二段：站点说明 */}
                    {records.map((r) => ( // 逐条解析记录展示
                      <div key={r.zone}>{/* 记录容器，以 zone 区分 */}
                        <div className="row">{/* 记录信息行：外链 + zone / 类型 */}
                          <a href={`https://${r.fqdn}`} target="_blank" rel="noreferrer">{/* https 入口外链，新标签打开 */}
                            {r.fqdn}{/* 完整域名 */}
                          </a>{/* 结束外链 */}
                          <span className="badge">{r.zone}</span>{/* zone 徽标 */}
                          <span className="badge">{r.record_type}</span>{/* 记录类型徽标（A / CNAME） */}
                        </div>{/* 结束记录信息行 */}
                        {(r.label || r.description) && ( // record 级备注：仅 gy@mixm.top 这类覆盖项存在
                          <p className="muted">{/* 备注段落 */}
                            {[r.label, r.description].filter(Boolean).join(' · ')}{/* 有 label 用 label，有 description 用 description，用 · 连接 */}
                          </p> // 结束备注段落
                        )}{/* 结束备注条件渲染 */}
                      </div> // 结束记录容器
                    ))}{/* 结束记录遍历 */}
                    {/* 节点入口：从站点地图卡片跳到该节点的可运行模块页（#/site/<key>） */}
                    <a className="btn ghost small" href={item.node.route}>{/* 与站点目录使用同一路由，保证链接一致 */}
                      {locale === 'en-US' ? 'Open module →' : '进入模块 →'}{/* 按钮文案随语言切换 */}
                    </a>{/* 节点入口结束 */}
                  </article> // 结束模块卡片
                );
              })} {/* 结束模块遍历 */}
            </div>{/* 结束卡片网格 */}
          </section> /* 结束单分类分区 */
        ))
      )}{/* 结束空结果 / 分组条件渲染 */}
    </div>
    // 站点地图渲染结束，返回 JSX 元素
  );
}
