/* ==========================================================================
 * 导航数据 —— 单态架构：全部业务入口一级平铺，个人账户/权益/营收归入二级
 *
 * 与「双态」方案无关的历史约束已作废（见项目规则边界.md），
 * 这里不再做任何视图过滤，admin 角色在末尾追加管理后台。
 * ======================================================================== */

export type BadgeKey = 'notif' | 'msg'

export interface NavItem {
  href: string
  /** 用于高亮的前缀匹配串 */
  match: string
  label: string
  icon?: string
  badgeKey?: BadgeKey
  children?: NavItem[]
}

const MY_CHILDREN: NavItem[] = [
  { href: '#/my', match: '/my', label: '我的主页', icon: '👤' },
  { href: '#/blog', match: '/blog', label: '我的博客', icon: '📰' },
  { href: '#/favorites', match: '/favorites', label: '收藏', icon: '⭐' },
  { href: '#/history', match: '/history', label: '足迹', icon: '👣' },
  { href: '#/following', match: '/following', label: '关注列表', icon: '🫂' },
  { href: '#/publish', match: '/publish', label: '发布器', icon: '📮' },
  { href: '#/wallet', match: '/wallet', label: '统一钱包', icon: '💰' },
  { href: '#/vip', match: '/vip', label: 'VIP 会员', icon: '👑' },
  { href: '#/growth', match: '/growth', label: '成长引擎', icon: '🌱' },
  { href: '#/settings', match: '/settings', label: '设置', icon: '⚙️' },
]

const MALL_CHILDREN: NavItem[] = [
  { href: '#/mall', match: '/mall', label: '商城中心', icon: '🛒' },
  { href: '#/mall/cart', match: '/mall/cart', label: '购物车', icon: '🧺' },
  { href: '#/mall/orders', match: '/mall/orders', label: '订单', icon: '📋' },
  { href: '#/mall/wallet', match: '/mall/wallet', label: '钱包', icon: '💳' },
]

export const NAV: NavItem[] = [
  { href: '#/feed', match: '/feed', label: '首页', icon: '🏠' },
  { href: '#/articles', match: '/articles', label: '文章', icon: '📝' },
  { href: '#/write', match: '/write', label: '写文章', icon: '✍️' },
  { href: '#/topics', match: '/topics', label: '超话', icon: '🔥' },
  { href: '#/notifications', match: '/notifications', label: '通知', icon: '🔔', badgeKey: 'notif' },
  { href: '#/messages', match: '/messages', label: '私信', icon: '✉️', badgeKey: 'msg' },
  { href: '#/my', match: '/my', label: '我的', icon: '👤', children: MY_CHILDREN },
  { href: '#/mall', match: '/mall', label: '商城', icon: '🛒', children: MALL_CHILDREN },
  { href: '#/live', match: '/live', label: '直播开播', icon: '📡' },
  { href: '#/snippets', match: '/snippets', label: '代码片段', icon: '💻' },
  { href: '#/resources', match: '/resources', label: '资源下载', icon: '📦' },
  { href: '#/tags', match: '/tags', label: '标签', icon: '🏷️' },
  { href: '#/delivery', match: '/delivery', label: '配送台', icon: '🚚' },
  { href: '#/price', match: '/price', label: '价格监控', icon: '📈' },
  { href: '#/nav', match: '/nav', label: '路线导航', icon: '🗺️' },
  { href: '#/mail', match: '/mail', label: '邮箱', icon: '📬' },
  { href: '#/bom', match: '/bom', label: 'BOM 工具台', icon: '🖥️' },
  { href: '#/coze', match: '/coze', label: '智能体', icon: '🤖' },
  { href: '#/ai', match: '/ai', label: 'AI 资源', icon: '📚' },
  { href: '#/manju', match: '/manju', label: '漫剧', icon: '🎬' },
  { href: '#/ardot', match: '/ardot', label: '聚合监控', icon: '📊' },
  { href: '#/mall/youxuan', match: '/mall/youxuan', label: '优选商城', icon: '🛍️' },
  { href: '#/mall/live', match: '/mall/live', label: '直播带货', icon: '📺' },
  { href: '#/mall/mix', match: '/mall/mix', label: '本地生活', icon: '🍜' },
  { href: '#/mall/laal', match: '/mall/laal', label: '出行服务', icon: '🚗' },
  { href: '#/mall/gexm', match: '/mall/gexm', label: '秒杀特惠', icon: '⚡' },
]

export const ADMIN_NAV: NavItem = {
  href: '#/admin',
  match: '/admin',
  label: '管理后台',
  icon: '🛡️',
  children: [
    { href: '#/admin/products', match: '/admin/products', label: '商品管理', icon: '📦' },
    { href: '#/admin/recharge', match: '/admin/recharge', label: '充值核销', icon: '🪙' },
    { href: '#/admin/audit', match: '/admin/audit', label: '审计日志', icon: '📜' },
    { href: '#/admin/roles', match: '/admin/roles', label: '角色管理', icon: '🔐' },
  ],
}

/** 当前路径是否命中该项（含子项） */
export function navMatches(item: NavItem, path: string): boolean {
  if (path === item.match || path.startsWith(`${item.match}/`)) return true
  return (item.children ?? []).some((c) => navMatches(c, path))
}

/** 该分组是否需要展开 */
export function groupExpanded(item: NavItem, path: string): boolean {
  return navMatches(item, path)
}
