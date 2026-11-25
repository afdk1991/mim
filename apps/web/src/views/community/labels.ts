/**
 * 社区视图文案标签与页签配置（2026-11-25 由 Community.tsx 拆分）：
 * 页签分组 / 帖子类型 / 商品类型 / 订单与售后 / 钱包流水 / 提现口径的静态文案映射，
 * 以及板块 Tab 的默认组合与归一化。纯数据 + 纯函数，不依赖 React。
 */

// 业务类型：与后端枚举一一对应
import type { BoardTab, ShopProduct, ThreadKind, WalletTransaction } from '../../api';

// 页签 id 与媒体 kind 对齐：图库页签是 image 视图，避免与帖子类型 gallery（图集）混淆
export type Tab = 'forum' | 'announcements' | 'vip' | 'wallet' | 'shop' | 'referral' | 'images' | 'video';

/** 八项页签按用途分两组：内容类在前，会员与交易类在后，窄屏换行时仍成组可读 */
export const TAB_GROUPS: Array<{ label: string; items: Array<[Tab, string]> }> = [
  { label: '内容', items: [['forum', '论坛'], ['images', '图库'], ['video', '视频'], ['announcements', '公告动态']] },
  { label: '会员与交易', items: [['vip', 'VIP 会员'], ['wallet', '钱包 / 积分'], ['shop', '社区商城'], ['referral', '推广分成']] },
];

/** 合法页签集合：用于校验 ?tab= 深链，非法值一律回落论坛 */
export const TAB_KEYS: Tab[] = ['forum', 'announcements', 'vip', 'wallet', 'shop', 'referral', 'images', 'video'];

export function isTab(value: string): value is Tab {
  return (TAB_KEYS as string[]).includes(value);
}

export const KIND_LABEL: Record<ThreadKind, string> = {
  text: '图文',
  video: '视频',
  gallery: '图集',
  series: '剧集',
  qa: '问答',
  poll: '投票',
};

export const PRODUCT_KIND: Record<ShopProduct['kind'], string> = {
  physical: '实物 · 快递',
  virtual_auto: '虚拟 · 自动发卡',
  virtual_manual: '虚拟 · 人工发货',
};

export const ORDER_STATUS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  delivered: '已发货',
  refunded: '已退款',
  cancelled: '已取消',
};

/** 售后类型文案：与 after_sales_requests.kind 一一对应 */
export const AFTER_SALES_KIND: Record<string, string> = {
  refund_only: '仅退款',
  return_refund: '退货退款',
  repair: '维修',
};

/** 售后状态文案：与 after_sales_requests.status 一一对应 */
export const AFTER_SALES_STATUS: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销',
};

/** 售后原因选项：提交时作为 reason 落库，后台可直接阅读 */
export const AFTER_SALES_REASONS = ['质量问题', '商品与描述不符', '未收到货', '少件或破损', '其他'];

export const TX_KIND: Record<WalletTransaction['kind'], string> = {
  recharge: '充值',
  consume: '消费',
  refund: '退款',
  commission: '分成',
  withdraw: '提现',
  points: '积分',
};

/** 提现状态文案：与后端 withdrawal_requests.status 一一对应 */
export const WITHDRAW_STATUS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过 · 打款中',
  rejected: '已驳回',
  paid: '已到账',
  cancelled: '已撤销',
};

/** 提现收款方式文案 */
export const WITHDRAW_METHOD: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信',
  bank: '银行卡',
};

/** 板块内置默认 Tab：接口缺失 / 404 时回落这套栏目组合，保证论坛可按口径排序。 */
export const DEFAULT_BOARD_TABS: BoardTab[] = [
  { key: 'latest', label: '最新', order: 10, visible: true, sort: 'latest' },
  { key: 'hot', label: '热门', order: 20, visible: true, sort: 'hot' },
  { key: 'recommend', label: '推荐指数', order: 30, visible: true, sort: 'recommend' },
  { key: 'rating', label: '评分', order: 40, visible: true, sort: 'rating' },
  { key: 'favorites', label: '收藏', order: 50, visible: true, sort: 'favorites' },
];

/** 归一化后端 Tab：兼容 sort_order/sort_by 与冻结契约 order/sort 两套字段名。 */
export function normalizeBoardTabs(raw: BoardTab[] | undefined): BoardTab[] {
  if (!Array.isArray(raw)) return DEFAULT_BOARD_TABS; // 条件分支：按判断结果选择后续处理路径
  return raw.map((tab, index) => ({ // 返回当前函数的处理结果
    key: typeof tab.key === 'string' ? tab.key : '',
    label: typeof tab.label === 'string' ? tab.label : tab.key,
    order: tab.sort_order ?? tab.order ?? index,
    visible: tab.visible !== false,
    sort: tab.sort_by ?? tab.sort ?? tab.key,
  })).filter((tab) => tab.key);
}
