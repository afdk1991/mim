/* ================= 全站功能页搜索索引 =================
 * 供顶部搜索栏（App.tsx WbHero 下拉联想）与搜索结果页（csdn.tsx SearchPage）共用。
 * 覆盖全项目可直达的功能页/工具台，关键词双向 includes 匹配。 */

export interface SearchPageItem {
  href: string // 形如 #/delivery 的 hash 路由
  name: string // 展示名称
  icon: string
  keywords: string[] // 命中任一即匹配
  group: '内容' | '商城' | '工具台' | '个人'
}

export const SEARCH_PAGES: SearchPageItem[] = [
  /* ---- 内容 ---- */
  { href: '#/feed', name: '首页 / 动态', icon: '🏠', keywords: ['动态', 'feed', '首页'], group: '内容' },
  { href: '#/articles', name: '文章', icon: '📝', keywords: ['文章', '博客', 'blog'], group: '内容' },
  { href: '#/write', name: '写文章', icon: '✍️', keywords: ['写作', '投稿', '编辑器'], group: '内容' },
  { href: '#/topics', name: '超话广场', icon: '🔥', keywords: ['超话', '话题', '排行榜'], group: '内容' },
  { href: '#/snippets', name: '代码片段', icon: '💾', keywords: ['代码', '片段', 'snippet'], group: '内容' },
  { href: '#/resources', name: '资源下载', icon: '📦', keywords: ['资源', '下载'], group: '内容' },
  { href: '#/tags', name: '标签聚合', icon: '🏷️', keywords: ['标签', 'tag'], group: '内容' },
  /* ---- 个人 ---- */
  { href: '#/my', name: '我的主页', icon: '👤', keywords: ['个人', '主页', '我的'], group: '个人' },
  { href: '#/favorites', name: '我的收藏', icon: '⭐', keywords: ['收藏', 'favorite'], group: '个人' },
  { href: '#/history', name: '浏览足迹', icon: '🕐', keywords: ['历史', '足迹', '浏览'], group: '个人' },
  /* ---- 商城 ---- */
  { href: '#/mall', name: '商城中心', icon: '🛒', keywords: ['商城', '购物', '商品'], group: '商城' },
  { href: '#/mall/cart', name: '购物车', icon: '🛒', keywords: ['购物车', 'cart'], group: '商城' },
  { href: '#/mall/orders', name: '我的订单', icon: '📋', keywords: ['订单', '物流'], group: '商城' },
  { href: '#/mall/wallet', name: '钱包', icon: '💰', keywords: ['钱包', '余额', '账单'], group: '商城' },
  { href: '#/vip', name: 'VIP 会员', icon: '👑', keywords: ['vip', '会员', '订阅', '权益'], group: '商城' },
  /* ---- 工具台 ---- */
  { href: '#/delivery', name: '配送调度台', icon: '🚚', keywords: ['配送', '调度', '物流', '快递'], group: '工具台' },
  { href: '#/price', name: '价格监控', icon: '📈', keywords: ['价格', '监控', '比价'], group: '工具台' },
  { href: '#/nav', name: '路线导航', icon: '🗺️', keywords: ['导航', '路线', '地图'], group: '工具台' },
  { href: '#/mail', name: '邮箱聚合', icon: '📮', keywords: ['邮箱', '邮件', '收件箱', 'mail'], group: '工具台' },
  { href: '#/bom', name: '机箱 BOM 工具台', icon: '🧰', keywords: ['bom', '机箱', '装机', '硬件'], group: '工具台' },
  { href: '#/coze', name: '智能体服务', icon: '🤖', keywords: ['智能体', 'coze', '检测'], group: '工具台' },
  { href: '#/ai', name: 'AI 可转载资源库', icon: '📚', keywords: ['ai', '转载', '许可', '署名'], group: '工具台' },
  { href: '#/manju', name: '漫剧', icon: '🎬', keywords: ['漫剧', '短剧', '动画', '追剧'], group: '工具台' },
  { href: '#/ardot', name: '聚合监控', icon: '📡', keywords: ['探针', '审计', '健康'], group: '工具台' },
]

/** 全站功能页匹配：名称或关键词双向 includes（兼容「机箱」搜 BOM、「bom工具」搜 BOM） */
export function matchSearchPages(kw: string): SearchPageItem[] {
  const k = kw.trim().toLowerCase()
  if (!k) return []
  return SEARCH_PAGES.filter(
    (p) =>
      p.name.toLowerCase().includes(k) ||
      p.keywords.some((w) => {
        const lw = w.toLowerCase()
        return lw.includes(k) || k.includes(lw)
      }),
  )
}
