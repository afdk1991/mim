/**
 * 业务领域详情（/domains/:slug，匿名可读）。
 *
 * 单领域视图：顶部返回按钮 + 图标、中英文名、分组、状态徽标、一句话说明、
 * 复用的现有能力与功能点列表。slug 从 App 侧路径段解析后以 props 下发。
 *
 * 数据口径：优先匿名拉取 GET /api/v1/domains/:slug 与 /:slug/features；
 * 接口不可达时按 slug 取 api/domains.ts 内置清单兜底，slug 完全未知才渲染友好空态。
 * 样式复用 .page / .page-head / .muted / .hint / .plain-list 与 EmptyState，专属样式用 mim-domain-detail 前缀隔离。
 */

import { useEffect, useState } from 'react'; // 状态与副作用：按 slug 拉取公开详情
import { baseOf, navigatePath } from '../router'; // 站内深链接导航：返回总览，兼容 /mim/ 子路径部署
import { EmptyState } from '../empty-state'; // 共享空态组件：slug 不存在时给友好提示
import { // 领域 API：封装、类型与内置兜底清单
  fallbackDomain, // 按 slug 取内置领域
  fallbackFeatures, // 按内置功能点名称生成详情列表
  fetchDomain, // 单领域详情只读接口
  fetchDomainFeatures, // 功能点列表只读接口
  type Domain, // 领域详情类型
  type DomainFeature, // 功能点类型
} from '../api/domains.js'; // 独立端点文件，与 community.ts 同构

/** 分组中文名：与总览视图同口径，后端 category 为稳定编码。 */
const CATEGORY_ZH: Record<string, string> = { // 分组编码 → 中文名，与后端 DOMAIN_CATEGORIES 一致
  production: '生产', // 办公 / 效率 / 产品 / 工程
  business: '商业', // 金融 / 营销 / 电商
  knowledge: '知识', // 内容 / 教育科研
  lifestyle: '生活', // 医疗 / 生活休闲
  support: '支撑', // 法律 / 财税
}; // 映射结束

/** 分组英文名：英文界面按同一编码派生英文展示名。 */
const CATEGORY_EN: Record<string, string> = { // 分组编码 → 英文名
  production: 'Production', // 生产
  business: 'Business', // 商业
  knowledge: 'Knowledge', // 知识
  lifestyle: 'Lifestyle', // 生活
  support: 'Support', // 支撑
}; // 映射结束

/** 视图入参签名：语言 + 领域 slug；slug 由 App 从 /domains/:slug 路径段解析后传入。 */
export function DomainDetail({ locale, slug }: { locale: string; slug: string }): JSX.Element { // 组件开始
  const initial = fallbackDomain(slug); // 同步兜底：接口未返回前先按内置清单渲染
  const [domain, setDomain] = useState<Domain | null>(initial); // 当前领域详情，null 表示未知 slug
  const [features, setFeatures] = useState<DomainFeature[]>(fallbackFeatures(initial)); // 功能点列表，先用内置名称占位
  const [loading, setLoading] = useState(initial === null); // 仅未知 slug 时显示加载提示

  useEffect(() => { // 挂载或 slug 变化时拉取详情与功能点；卸载后丢弃异步结果
    let alive = true; // 卸载标记，避免异步回调更新已卸载组件
    const local = fallbackDomain(slug); // 当前 slug 对应的内置领域
    setDomain(local); // slug 切换时重置为对应兜底数据
    setFeatures(fallbackFeatures(local)); // 同步重置功能点兜底
    setLoading(local === null); // 有兜底即可立即渲染，否则等接口
    void fetchDomain(slug) // 详情：匿名 GET，404 / 断网由下方 catch 兜底
      .then((data) => { if (alive && data && data.slug === slug) setDomain(data); }) // 仅回写与当前 slug 一致的结果，防止旧请求覆盖
      .catch(() => { if (alive) setDomain(fallbackDomain(slug)); }) // 失败保持内置清单兜底
      .finally(() => { if (alive) setLoading(false); }); // 无论成败都结束加载态
    void fetchDomainFeatures(slug) // 功能点：匿名 GET，失败由内置名称兜底
      .then((data) => { if (alive && data.length > 0) setFeatures(data); }) // 非空结果覆盖，空结果保留兜底
      .catch(() => { if (alive) setFeatures(fallbackFeatures(fallbackDomain(slug))); }); // 失败回写内置功能点
    return () => { alive = false; }; // 清理卸载标记
  }, [slug]); // slug 变化时重新取数，语言切换不影响领域数据

  /** 返回总览：走站内路径并广播路由事件，兼容子路径部署前缀。 */
  function goBack(): void { // 返回处理
    navigatePath(`${baseOf()}domains`); // 写 /domains 深链接，由 App 渲染总览视图
  } // goBack 结束

  const isEn = locale === 'en-US'; // 英文界面开关，全视图统一口径

  return (
    <div className="page">{/* 页面容器：返回按钮、领域主体、功能点列表 */}
      <div className="page-head">{/* 页面标题行 */}
        <button type="button" className="btn ghost" onClick={goBack}>{isEn ? 'Back to Domains' : '返回领域门户'}</button>{/* 返回按钮：回到总览 */}
      </div>

      {loading && !domain && ( // 未知 slug 且接口尚未返回：轻量加载提示
        <p className="hint">{isEn ? 'Loading…' : '加载中…'}</p>
      )}{/* 加载提示结束 */}

      {!loading && !domain && ( // 接口确认不存在：共享空态 + 返回出口
        <EmptyState // 空态组件
          kind="search" // 用检索空态插图，语义为「未找到该领域」
          title={isEn ? 'Domain not found' : '领域不存在'} // 空态标题
          hint={isEn ? 'The slug may be wrong or the domain is not published yet.' : '领域标识可能有误，或该领域尚未发布。'} // 补充说明
          action={<button type="button" className="btn primary" onClick={goBack}>{isEn ? 'Back to Domains' : '返回领域门户'}</button>} // 操作槽位：返回总览
        />
      )}{/* 空态结束 */}

      {domain && ( // 领域主体：有兜底或接口数据时渲染
        <>
          <div className="panel mim-domain-detail-hero">{/* 主体面板：图标 + 名称 + 状态 */}
            <div className="mim-domain-detail-title"> {/* 标题行 */}
              <span className="mim-domains-icon" aria-hidden="true">{domain.icon}</span>{/* 复用总览的图标字形徽标 */}
              <div>
                <h1>{isEn ? domain.name_en : domain.name_zh}</h1>{/* 主标题：按界面语言取名 */}
                <p className="muted">{isEn ? domain.name_zh : domain.name_en}</p>{/* 副标题：另一语言名 */}
              </div>
            </div>
            <div className="mim-domain-detail-meta">{/* 元信息行：分组 + 状态 */}
              <span className="muted">{isEn ? (CATEGORY_EN[domain.category] ?? domain.category) : (CATEGORY_ZH[domain.category] ?? domain.category)}</span>{/* 分组名按语言派生 */}
              <span className={`mim-domains-badge ${domain.status === 'active' ? 'is-active' : 'is-planned'}`}>{/* 状态徽标：已上线绿 / 规划中灰 */}
                {domain.status === 'active' ? (isEn ? 'Active' : '已上线') : (isEn ? 'Planned' : '规划中')}{/* 徽标文案按语言与状态派生 */}
              </span>
            </div>
            <p className="mim-domain-detail-desc">{domain.description}</p>{/* 一句话说明 */}
          </div>

          <div className="panel">{/* 复用能力面板 */}
            <h2>{isEn ? 'Reused capabilities' : '复用的现有能力'}</h2>{/* 小节标题 */}
            <p className="muted">{domain.reuse || (isEn ? 'No capability mapped yet.' : '暂未映射现有能力。')}</p>{/* 能力清单，缺省给友好文案 */}
          </div>

          <div className="panel">{/* 功能点面板 */}
            <h2>{isEn ? 'Features' : '功能点'}（{features.length}）</h2>{/* 小节标题 + 条目数 */}
            {features.length === 0 ? ( // 功能点为空：友好占位
              <p className="hint">{isEn ? 'Feature list is not published yet.' : '功能点清单尚未发布。'}</p>
            ) : ( // 有功能点：逐条渲染
              <ul className="plain-list mim-domain-detail-features">{/* 沿用无样式列表，挂专属类微调 */}
                {features.map((feature) => ( // 逐个功能点
                  <li key={feature.slug}>{/* 以功能点 slug 为稳定 key */}
                    <strong>{isEn ? (feature.name_en || feature.name_zh) : feature.name_zh}</strong>{/* 功能点名，英文缺则回退中文 */}
                    {feature.description && <span className="muted">{feature.description}</span>}{/* 说明非空才渲染 */}
                  </li>
                ))}{/* 功能点遍历结束 */}
              </ul>
            )}{/* 功能点分支结束 */}
          </div>
        </>
      )}{/* 领域主体结束 */}

      <style>{`/* 专属样式：mim-domain-detail 前缀隔离，不改共享 styles.css */
        .mim-domain-detail-hero { display: flex; flex-direction: column; gap: var(--sp-2, 8px); }/* 主体面板纵向节奏 */
        .mim-domain-detail-title { display: flex; align-items: center; gap: var(--sp-3, 12px); }/* 图标与标题横向对齐 */
        .mim-domain-detail-title h1 { margin: 0; font-size: 1.35rem; }/* 主标题零外边距 */
        .mim-domain-detail-title p { margin: 0; }/* 副标题零外边距 */
        .mim-domain-detail-meta { display: flex; align-items: center; gap: var(--sp-2, 8px); }/* 分组与状态徽标同行 */
        .mim-domain-detail-desc { margin: 0; line-height: 1.6; }/* 说明文案行高 */
        .mim-domain-detail-features li { display: flex; flex-direction: column; gap: 2px; }/* 功能点名称与说明纵向排列 */
      `}</style>
    </div>
  ); // 渲染结束
} // DomainDetail 组件结束
