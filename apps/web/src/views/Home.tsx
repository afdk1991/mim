// React 钩子：副作用拉取精选帖、本地状态
import { useEffect, useState } from 'react';
// 仅类型导入：界面语言
import type { Locale } from '@mim/i18n';
// 业务接口集合：精选帖走公开帖子列表
import { api } from '../api';
// 帖子类型
import type { CommunityThread } from '../api/types';
// 站内深链接跳转：精选帖进入社区详情
import { navigatePath, pathOf } from '../router';
// 首页商品货架：完整展示商城全部商品（只浏览与跳转，不下单）
import { ProductShelf } from '../components/product-shelf';

/** 首页入口卡目标视图：只指向已存在的一级视图 */
type EntryView = 'community' | 'chat' | 'account';

interface HomeProps { // 首页入参
  locale: Locale; // 当前语言
  onNavigate: (view: EntryView) => void; // 入口卡跳转回调
} // 入参接口结束

/** 入口卡配置：文案按语言分流，图标用内联 SVG 路径，不引入额外图标依赖 */
const ENTRIES: Array<{ view: EntryView; title: string; titleEn: string; desc: string; descEn: string }> = [
  { view: 'community', title: '社区', titleEn: 'Community', desc: '论坛讨论、公告动态与付费内容', descEn: 'Threads, announcements and paid posts' }, // 社区入口卡
  { view: 'chat', title: '聊天', titleEn: 'Chat', desc: '站内即时消息与视频通话', descEn: 'Instant messages and video calls' }, // 聊天入口卡
  { view: 'account', title: '个人中心', titleEn: 'Account', desc: '资料、资产与订单记录', descEn: 'Profile, assets and orders' }, // 个人中心入口卡
]; // 入口卡配置结束

/** 入口图标：按视图返回线性图标，统一 24 网格与 1.6 线宽 */
function EntryIcon({ view }: { view: EntryView }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const; // 线性图标共用描边
  return ( // 图标容器：装饰性，屏幕阅读器跳过
    <span className="pd-entry-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" {...common}>
        {view === 'community' && ( // 社区：双人 + 对话
          <>
            <path d="M4 6.5h11.5v8.5H9L4.5 19z" />
            <path d="M8.5 4.5h11v7.5h-2.5" />
          </>
        )}
        {view === 'chat' && ( // 聊天：对话气泡 + 三个点
          <>
            <path d="M3.5 5.5h17v11H8.5L3.5 20.5z" />
            <circle cx="8" cy="11" r="1" />
            <circle cx="12" cy="11" r="1" />
            <circle cx="16" cy="11" r="1" />
          </>
        )}
        {view === 'account' && ( // 个人中心：头像轮廓
          <>
            <circle cx="12" cy="8" r="3.6" />
            <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
          </>
        )}
      </svg>
    </span>
  ); // 图标容器结束
} // EntryIcon 结束

/**
 * 门户首页：hero 主视觉 + 入口卡 + 精选帖。
 * 精选帖复用公开帖子列表（热门排序前 6）；点击进入社区详情深链，不重复实现一套内容渲染。
 */
export function Home({ locale, onNavigate }: HomeProps) {
  const isEn = locale === 'en-US'; // 语言判定
  const [featured, setFeatured] = useState<CommunityThread[]>([]); // 精选帖列表

  // 拉取精选帖：独立于当前筛选；卸载后拒绝回写，失败静默留空态
  useEffect(() => {
    let alive = true; // 卸载标记：防止组件销毁后回写状态
    api.community.threads({ sort: 'hot', limit: 6 }) // 热门排序取前 6 条作为精选
      .then((data) => { if (alive) setFeatured(data.items); }) // 存活期内才回写精选列表
      .catch(() => { /* 精选拉取失败不阻断首页 */ });
    return () => { alive = false; }; // 清理：标记组件已卸载
  }, []); // 仅首屏拉取一次，不随筛选变化重复请求

  /** 进入精选帖详情：与社区同一深链接口径 /community/post/:id */
  function openFeatured(id: string): void {
    navigatePath(pathOf('community', `post/${encodeURIComponent(id)}`)); // 拼社区详情深链并跳转
  } // openFeatured 结束

  return ( // 首页视图根容器
    <div className="home-view">
      <section className="home-hero"> {/* 主视觉区：标签 + 标题 + 副标题 + 双按钮 + 指标条 */}
        <span className="pd-eyebrow">{isEn ? 'Mim Platform' : 'Mim · 一站式内容平台'}</span> {/* 主视觉上方小标签 */}
        <h1>{isEn ? 'Content, community and commerce in one place' : '内容、社区与交易，一处完成'}</h1> {/* 主标题按语言分流 */}
        <p>{isEn ? 'Browse public discussions without signing in, then join the community and manage your account in the same place.' : '无需登录即可浏览公开讨论；需要参与时再登录，社区与账号在同一处管理。'}</p> {/* 副标题按语言分流 */}
        <div className="pd-hero-actions"> {/* 按钮行：主行动 + 次行动 */}
          <button type="button" className="btn primary" onClick={() => onNavigate('community')}> {/* 主行动：进入社区 */}
            {isEn ? 'Enter Community' : '进入社区'} {/* 按钮文案按语言分流 */}
          </button>
          <button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('circles'))}> {/* 次行动：浏览圈子 */}
            {isEn ? 'Browse Circles' : '浏览圈子'} {/* 次按钮文案 */}
          </button>
        </div>
        <div className="pd-hero-stats"> {/* 指标条：真实结构信息，不编造业务数据 */}
          <div className="pd-hero-stat"><strong>3</strong><span>{isEn ? 'Core entries' : '核心入口'}</span></div> {/* 三个一级入口 */}
          <div className="pd-hero-stat"><strong>0</strong><span>{isEn ? 'Read barriers' : '阅读门槛'}</span></div> {/* 匿名可读，无需登录 */}
          <div className="pd-hero-stat"><strong>8</strong><span>{isEn ? 'Views' : '页面视图'}</span></div> {/* 路由内的视图总数 */}
        </div>
      </section>

      <section className="home-entries"> {/* 三张入口卡：社区 / 聊天 / 个人中心 */}
        {ENTRIES.map((entry) => ( // 按配置表渲染入口卡
          <button key={entry.view} type="button" className="home-entry" onClick={() => onNavigate(entry.view)}> {/* 单张入口卡，点击跳对应视图 */}
            <EntryIcon view={entry.view} /> {/* 入口图标 */}
            <span className="home-entry-title">{isEn ? entry.titleEn : entry.title}</span> {/* 入口标题按语言分流 */}
            <span className="home-entry-desc">{isEn ? entry.descEn : entry.desc}</span> {/* 入口说明按语言分流 */}
            <span className="pd-entry-arrow" aria-hidden="true">→</span> {/* 悬停右移的指示箭头 */}
          </button>
        ))}
      </section>

      {/* 商城货架：首页完整展示全部在售商品；进入商城统一走 ?tab=shop 深链，首页不出现下单按钮 */}
      <ProductShelf
        locale={locale}
        onOpenShop={() => navigatePath(pathOf('community', '', 'tab=shop'))}
      />

      <section className="home-featured"> {/* 精选帖区：标题 + 栅格卡片 */}
        <div className="home-featured-head"> {/* 精选区标题行 */}
          <h2>{isEn ? 'Featured threads' : '精选帖'}</h2>
          <button type="button" className="btn ghost small" onClick={() => onNavigate('community')}>{isEn ? 'View all' : '查看全部'}</button> {/* 右侧切到社区 */}
        </div>
        {featured.length === 0 && <p className="home-featured-empty">{isEn ? 'No featured content yet.' : '暂无精选内容。'}</p>} {/* 精选为空时的占位文案 */}
        <div className="home-featured-grid"> {/* 精选帖栅格容器 */}
          {featured.map((t) => ( // 逐条渲染精选卡片
            <button key={t.id} type="button" className="home-card" onClick={() => openFeatured(t.id)}> {/* 单张精选卡，点击进详情 */}
              <div className="home-card-meta"> {/* 卡片元信息行：板块 + 作者 */}
                <span className="tag-sm">{t.board_name}</span> {/* 板块名小号方标签 */}
                <span>{t.author_name || 'Mim 官方'}</span> {/* 作者昵称，缺省回落官方 */}
              </div>
              <h3>{t.title}</h3> {/* 帖子标题 */}
              <p>{t.summary || '—'}</p> {/* 帖子摘要，缺省显示占位符 */}
              <div className="home-card-foot"> {/* 卡片统计行：浏览 / 赞 / 回复 */}
                <span>{t.views} 浏览</span> {/* 浏览量 */}
                <span>{t.likes} 赞</span> {/* 点赞数 */}
                <span>{t.reply_count} 回复</span> {/* 回复数 */}
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
} // Home 结束
