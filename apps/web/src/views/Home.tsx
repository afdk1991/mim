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
      <section className="home-hero"> {/* 主视觉区：标题 + 副标题 + 进入按钮 */}
        <h1>{isEn ? 'Mim: content, community and commerce' : 'Mim · 内容、社区与交易一体化'}</h1> {/* 主标题按语言分流 */}
        <p>{isEn ? 'Browse discussions, join the community and manage your account from one place.' : '浏览讨论、参与社区，在同一个地方管理你的账号与内容。'}</p> {/* 副标题按语言分流 */}
        <button type="button" className="btn primary" onClick={() => onNavigate('community')}> {/* 主行动按钮：进入社区 */}
          {isEn ? 'Enter Community' : '进入社区'} {/* 按钮文案按语言分流 */}
        </button>
      </section>

      <section className="home-entries"> {/* 三张入口卡：社区 / 聊天 / 个人中心 */}
        {ENTRIES.map((entry) => ( // 按配置表渲染入口卡
          <button key={entry.view} type="button" className="home-entry" onClick={() => onNavigate(entry.view)}> {/* 单张入口卡，点击跳对应视图 */}
            <span className="home-entry-title">{isEn ? entry.titleEn : entry.title}</span> {/* 入口标题按语言分流 */}
            <span className="home-entry-desc">{isEn ? entry.descEn : entry.desc}</span> {/* 入口说明按语言分流 */}
          </button>
        ))}
      </section>

      <section className="home-featured"> {/* 精选帖区：标题 + 栅格卡片 */}
        <div className="home-featured-head"><h2>{isEn ? 'Featured threads' : '精选帖'}</h2></div> {/* 精选区标题 */}
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
  ); // 根容器结束
} // Home 结束
