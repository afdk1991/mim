/**
 * 公告置顶条：读取置顶公告在内容区顶部横向展示；接口 404 / 空数组时静默不渲染。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api } from '../api'; // 接口客户端
import type { AnnouncementItem } from '../api'; // 公告条目类型

interface Props { // 组件参数
  locale: Locale; // 当前界面语言
  onOpen: () => void; // 点击「全部」跳转公告栏目页
} // 代码块结束

export function AnnouncementBar({ locale, onOpen }: Props) { // 导出函数 AnnouncementBar：对外暴露的调用入口
  const [items, setItems] = useState<AnnouncementItem[]>([]); // 置顶公告（最多 3 条）

  useEffect(() => {
    let cancelled = false; // 卸载后丢弃结果
    api.content
      .announcements(5)
      .then((data) => { if (!cancelled) setItems(data.items.filter((item) => item.pinned).slice(0, 3)); })
      .catch(() => { /* 接口不可达时整条置顶条隐藏，不影响页面 */ });
    return () => { cancelled = true; }; // 返回当前函数的处理结果
  }, []);

  if (items.length === 0) return null; // 无置顶公告不占位

  return ( // 返回当前函数的处理结果
    <div className="announcement-bar">{/* 执行当前业务步骤 */}
      <span className="announcement-bar-label" aria-hidden="true">📢</span>
      <div className="announcement-bar-items">{/* 执行当前业务步骤 */}
        {items.map((item) => <span key={item.id}>{item.title}</span>)}
      </div>
      <button type="button" className="link announcement-bar-more" onClick={onOpen}>{/* 执行当前业务步骤 */}
        {locale === 'en-US' ? 'All' : '全部'}
      </button>
    </div>
  ); // 执行当前业务步骤
} // 代码块结束
