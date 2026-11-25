/**
 * 业务领域门户总览（/domains，匿名可读）。
 *
 * 13 张领域卡按 category 分组展示，顶部给出总数 / 已上线数 / 分组数三项统计；
 * 卡片显示图标字形、中英文名、一句话说明与状态徽标（active 绿 / planned 灰），点击进详情。
 *
 * 数据口径：优先匿名拉取 GET /api/v1/domains 与 /domains/overview；
 * 接口不可达时直接沿用 api/domains.ts 内置的 FALLBACK_DOMAINS 渲完 13 卡，不白屏、不阻断浏览。
 * 样式复用 .page / .page-head / .muted / .hint 等既有类名，专属样式用 mim-domains 前缀隔离，不改共享 styles.css。
 */

import { useEffect, useState } from 'react'; // 状态与副作用：初次挂载拉取公开数据
import { baseOf, navigatePath } from '../router'; // 站内深链接导航：兼容 /mim/ 子路径部署
import { // 领域 API：封装、类型与内置兜底清单
  FALLBACK_DOMAINS, // 13 领域静态清单：离线兜底
  fallbackOverview, // 本地统计兜底
  fetchDomainOverview, // 顶部统计只读接口
  fetchDomains, // 领域清单只读接口
  type DomainOverview, // 概览统计类型
  type DomainSummary, // 领域摘要类型
} from '../api/domains.js'; // 独立端点文件，与 community.ts 同构

/** 分组中文名：后端 category 为稳定编码，界面按字典派生中文展示名。 */
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

/** 领域列表按 category 分桶；保持接口返回顺序，同组卡片连续展示。 */
interface DomainGroup { // 分组结构
  category: string; // 分组名（后台原值）
  items: DomainSummary[]; // 该分组下的领域摘要
} // 结构结束

/** 把平铺列表按分组聚合为分组数组；空分组不渲染。 */
function groupDomains(items: DomainSummary[]): DomainGroup[] { // 分组函数
  const buckets = new Map<string, DomainSummary[]>(); // 分组名 → 卡片列表
  for (const item of items) { // 逐条归桶
    const bucket = buckets.get(item.category) ?? []; // 已有桶复用，否则新建
    bucket.push(item); // 追加当前卡片
    buckets.set(item.category, bucket); // 写回桶（新桶时必须写入）
  } // 遍历结束
  return Array.from(buckets.entries()).map(([category, group]) => ({ category, items: group })); // 转为可直接渲染的数组
} // groupDomains 结束

/** 视图入参签名：仅语言；英文界面按 locale === 'en-US' 切换文案。 */
export function Domains({ locale }: { locale: string }): JSX.Element { // 组件开始
  // 首帧就用内置清单渲染，接口返回后再覆盖；网络失败时保留兜底数据
  const [domains, setDomains] = useState<DomainSummary[]>(FALLBACK_DOMAINS); // 领域卡片数据，初值为 13 项兜底清单
  const [overview, setOverview] = useState<DomainOverview>(fallbackOverview); // 顶部统计，初值按兜底清单派生
  const [offline, setOffline] = useState(false); // 接口不可达标记：仅提示，不影响渲染

  useEffect(() => { // 挂载后拉取公开统计与清单；卸载后丢弃异步结果
    let alive = true; // 卸载标记，避免异步回调更新已卸载组件
    void fetchDomainOverview() // 顶部统计：匿名 GET，失败由下方 catch 兜底
      .then((data) => { if (alive) setOverview(data); }) // 成功则覆盖本地统计
      .catch(() => { if (alive) setOffline(true); }); // 失败保留兜底统计并标记离线
    void fetchDomains() // 领域清单：匿名 GET，失败由下方 catch 兜底
      .then((data) => { if (alive && data.length > 0) setDomains(data); }) // 非空结果才覆盖，空结果保留兜底清单
      .catch(() => { if (alive) setOffline(true); }); // 失败保留兜底清单并标记离线
    return () => { alive = false; }; // 清理卸载标记
  }, []); // 仅挂载一次：语言切换不影响领域数据本身

  /** 打开领域详情：写 /domains/:slug 深链接并广播路由事件，由 App 解析 slug 后渲染详情视图。 */
  function openDomain(slug: string): void { // 卡片点击处理
    navigatePath(`${baseOf()}domains/${encodeURIComponent(slug)}`); // baseOf 兼容根部署与 /mim/ 子路径部署
  } // openDomain 结束

  const groups = groupDomains(domains); // 按分组聚合，供下方分组区块渲染
  const isEn = locale === 'en-US'; // 英文界面开关，全视图统一口径

  return (
    <div className="page">{/* 页面容器：标题、统计、分组卡片网格自上而下 */}
      <div className="page-head">{/* 页面标题行 */}
        <div>
          <h1>{isEn ? 'Business Domains' : '业务领域'}</h1>{/* 主标题：英文 / 中文 */}
          <p className="muted">{isEn ? '13 domains on one platform: browse by category and open details.' : '13 个业务领域统一门户：按分组浏览，点击卡片查看领域详情与复用能力。'}</p>{/* 副标题：口径说明 */}
        </div>
      </div>

      {/* 概览统计：总数 / 已上线 / 分组数，接口不可达时仍由内置清单给出正确数字 */}
      <div className="mim-domains-stats">
        <div className="mim-domains-stat"><strong>{overview.total}</strong><span>{isEn ? 'Domains' : '领域总数'}</span></div>{/* 统计一：领域总数 */}
        <div className="mim-domains-stat"><strong>{overview.active}</strong><span>{isEn ? 'Active' : '已上线'}</span></div>{/* 统计二：已上线领域数 */}
        <div className="mim-domains-stat"><strong>{overview.categories}</strong><span>{isEn ? 'Groups' : '分组数'}</span></div>{/* 统计三：分组数量 */}
      </div>

      {offline && ( // 接口不可达提示：使用内置清单兜底，用户仍可完整浏览
        <p className="hint">{isEn ? 'Live data is unavailable; showing the built-in catalog.' : '实时数据暂不可用，当前展示内置领域清单。'}</p>
      )}{/* 离线提示结束 */}

      {/* 分组卡片网格：每组一个标题 + 若干领域卡 */}
      {groups.map((group) => ( // 逐组渲染
        <section key={group.category} className="mim-domains-group">{/* 分组区块 */}
          <div className="community-section-head">{/* 沿用既有区块标题样式 */}
            <h2>{isEn ? (CATEGORY_EN[group.category] ?? group.category) : (CATEGORY_ZH[group.category] ?? group.category)}（{group.items.length}）</h2>{/* 分组名按语言派生 + 卡片数 */}
          </div>
          <div className="mim-domains-grid">{/* 卡片网格：自适应列宽 */}
            {group.items.map((domain) => ( // 逐张卡片渲染
              <button // 卡片本体是可点击按钮，天然支持键盘可达
                key={domain.slug} // 以 slug 为稳定 key
                type="button" // 不触发表单提交
                className="mim-domains-card" // 专属卡片样式
                onClick={() => openDomain(domain.slug)} // 点击进详情深链接
              >
                <span className="mim-domains-icon" aria-hidden="true">{domain.icon}</span>{/* 图标字形徽标，装饰性不朗读 */}
                <span className="mim-domains-names">{/* 中英文名纵向排列 */}
                  <strong>{isEn ? domain.name_en : domain.name_zh}</strong>{/* 主标题：按界面语言取名 */}
                  <small>{isEn ? domain.name_zh : domain.name_en}</small>{/* 副标题：另一语言名 */}
                </span>
                <span className="muted mim-domains-desc">{domain.description}</span>{/* 一句话说明，复用 muted 次要色 */}
                <span className={`mim-domains-badge ${domain.status === 'active' ? 'is-active' : 'is-planned'}`}>{/* 状态徽标：已上线绿 / 规划中灰 */}
                  {domain.status === 'active' ? (isEn ? 'Active' : '已上线') : (isEn ? 'Planned' : '规划中')}{/* 徽标文案按语言与状态派生 */}
                </span>
              </button>
            ))}{/* 卡片遍历结束 */}
          </div>
        </section>
      ))}{/* 分组遍历结束 */}

      <style>{`/* 专属样式：mim-domains 前缀隔离，不改共享 styles.css */
        .mim-domains-stats { display: flex; flex-wrap: wrap; gap: var(--sp-3, 12px); }/* 统计条横向排列，窄屏换行 */
        .mim-domains-stat { display: flex; flex-direction: column; align-items: flex-start; min-width: 96px; padding: var(--sp-3, 12px); border: 1px solid var(--border); border-radius: var(--card-radius-sm, 8px); background: var(--surface); }/* 单个统计块表面 */
        .mim-domains-stat strong { font-size: 1.5rem; line-height: 1.2; }/* 统计数字强调 */
        .mim-domains-stat span { color: var(--text-muted, #888); font-size: .8rem; }/* 统计说明次要色 */
        .mim-domains-group { display: flex; flex-direction: column; gap: var(--sp-2, 8px); }/* 分组区块纵向节奏 */
        .mim-domains-group h2 { margin: 0; font-size: 1rem; }/* 分组标题零外边距 */
        .mim-domains-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--sp-3, 12px); }/* 自适应卡片网格 */
        .mim-domains-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: var(--card-pad, 16px); border: 1px solid var(--border); border-radius: var(--card-radius-lg, 14px); background: var(--surface); text-align: left; cursor: pointer; }/* 卡片表面与可点击态 */
        .mim-domains-card:hover { border-color: var(--primary); box-shadow: var(--shadow-sm); }/* 悬停强调边框与轻投影 */
        .mim-domains-icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--card-radius-sm, 8px); background: var(--primary-soft, #eef5ff); color: var(--primary); font-size: 1.05rem; font-weight: 700; }/* 图标字形圆形徽标 */
        .mim-domains-names { display: flex; flex-direction: column; gap: 2px; }/* 中英文名纵向排列 */
        .mim-domains-names strong { font-size: 1rem; }/* 主标题字号 */
        .mim-domains-names small { color: var(--text-muted, #888); font-size: .75rem; }/* 副标题次要色 */
        .mim-domains-desc { font-size: .875rem; line-height: 1.5; }/* 说明文案行高 */
        .mim-domains-badge { margin-top: auto; padding: 2px 8px; border-radius: 999px; font-size: .72rem; font-weight: 600; }/* 状态徽标基础样式 */
        .mim-domains-badge.is-active { color: var(--success, #1a8a4a); background: var(--success-soft, #e8f7ee); }/* 已上线：绿色系 */
        .mim-domains-badge.is-planned { color: var(--text-muted, #888); background: var(--surface-muted, #f2f2f5); }/* 规划中：灰色系 */
      `}</style>
    </div>
  ); // 渲染结束
} // Domains 组件结束
