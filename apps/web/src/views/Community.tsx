/**
 * 社区论坛与变现中心（二期）：
 *   - Tab：论坛、VIP、钱包、社区商城、推广；状态全部收敛在组件内。
 *   - 论坛排序：最新 / 热度 / 浏览 / 回帖 / 收藏 / 评分六种。
 *   - 板块 chips 展示价格与 joined；付费未加入点击先 joinBoard。
 *   - 发帖按 kind 显示媒体地址或投票选项，并由后端做强校验。
 *   - 详情渲染图片网格、视频播放器、投票条、收藏、五星评分与两种付费墙。
 *   - 钱包页支持充值卡兑换、提现与按 Mim ID 转积分。
 *   - 写请求统一由 api 层带幂等键，错误经 errorText 本地化。
 */

import { useEffect, useMemo, useRef, useState } from 'react'; // 引入依赖、类型或本地模块绑定
import { Avatar } from '../components/Avatar.js'; // 共享头像：四档尺寸 + 角标槽
import type { Locale } from '@mim/i18n'; // 引入依赖、类型或本地模块绑定
import { api, errorText, getSession } from '../api'; // 引入依赖、类型或本地模块绑定
import { coverSrcset, resolvePublicUrl } from '../api/request.js'; // 公开地址归一化 + catalog 封面 2x 档派生
import { cancelWithdrawal, createWithdrawal, getWithdrawalOverview } from '../api/wallet-withdrawal'; // 提现：可提现余额口径与申请（钱包结算层）
import type { WithdrawMethod, WithdrawalOverview } from '../api/wallet-withdrawal'; // 提现类型，全部金额为整数分
import type { // 引入依赖、类型或本地模块绑定
  AfterSalesRequest,
  BoardTab,
  CommunityBoard,
  CommunityPost,
  CommunityThread,
  CommunityThreadDetail,
  CommunityThreadMedia,
  ShopProduct,
  ThreadKind,
  UnifiedOrder,
  VipPlan,
  WalletSnapshot,
  WalletTransaction,
} from '../api';

import { PageBlocks } from './PageBlocks'; // 论坛页区块：后台 Tab / 公告等模块化组合
import { CommunityMoreStyles, ModerationPanel, NotificationBell, ReplyItem, SearchPanel, ThreadTools } from './CommunityMore'; // 社区互动补齐：通知 / 编辑治理 / 搜索 / 举报 / 楼中楼
import { isPinned, postReply, replyLockedOf, threadDetail } from '../api/community.js'; // 置顶标记 / 楼中楼回复 / 回复锁定判定 / 回复分页
import { AnnouncementsPanel } from './AnnouncementsPanel'; // 公告动态页签（2026-11-15 由 /announcements 并入）
import { CommunityGallery } from './CommunityGallery'; // 图库 / 视频页签（2026-11-15：挂在社区层，不恢复独立模块页）
import { CommunityAssets } from './CommunityAssets'; // 付费资产列表 / 详情（2026-11-16：社区层深链接，匿名可读）
import { CommunityGuideBar, ReferralGuestPanel, ShopGuestNote, WalletGuestPanel } from './CommunityGuides'; // 八大板块指南条与匿名访客面板
import { ContentDetail, RichBody } from './ContentDetail'; // 资讯条目详情页与富文本正文渲染
import { EmptyState } from '../empty-state'; // 空态共享组件：插图 + 标题 + 说明 + 操作槽位
import { currentQuery, navigatePath, pathOf, usePathSegments } from '../router'; // 多段深链接解析与站内导航

interface Props { // 接口 Props：约束对象的字段与类型形态
  locale: Locale;
  hasSession?: boolean; // 是否有登录会话：决定公告页签内的运营管理面板与互动入口是否可用
  onRequireLogin?: () => void; // 互动前未登录时的引导入口：由 App 负责跳转登录页
} // 代码块结束

// 页签 id 与媒体 kind 对齐：图库页签是 image 视图，避免与帖子类型 gallery（图集）混淆
type Tab = 'forum' | 'announcements' | 'vip' | 'wallet' | 'shop' | 'referral' | 'images' | 'video'; // 类型别名 Tab：复用一份复合类型定义

/** 八项页签按用途分两组：内容类在前，会员与交易类在后，窄屏换行时仍成组可读 */
const TAB_GROUPS: Array<{ label: string; items: Array<[Tab, string]> }> = [
  { label: '内容', items: [['forum', '论坛'], ['images', '图库'], ['video', '视频'], ['announcements', '公告动态']] },
  { label: '会员与交易', items: [['vip', 'VIP 会员'], ['wallet', '钱包 / 积分'], ['shop', '社区商城'], ['referral', '推广分成']] },
];

/** 数字分页窗口：总页数 ≤7 全列；否则首末页 + 当前页前后各一页，中间省略号折叠 */
function pagerWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1); // 短页全列
  const pages: Array<number | '…'> = [1]; // 首页恒显
  const lo = Math.max(2, current - 1); // 左邻页下限
  const hi = Math.min(total - 1, current + 1); // 右邻页上限
  if (lo > 2) pages.push('…'); // 左侧折叠
  for (let i = lo; i <= hi; i++) pages.push(i); // 当前邻页
  if (hi < total - 1) pages.push('…'); // 右侧折叠
  pages.push(total); // 末页恒显
  return pages;
} // pagerWindow 结束

/** 合法页签集合：用于校验 ?tab= 深链，非法值一律回落论坛 */
const TAB_KEYS: Tab[] = ['forum', 'announcements', 'vip', 'wallet', 'shop', 'referral', 'images', 'video'];

function isTab(value: string): value is Tab {
  return (TAB_KEYS as string[]).includes(value);
}

const KIND_LABEL: Record<ThreadKind, string> = { // 常量 KIND_LABEL：保存固定配置或一次性派生值
  text: '图文',
  video: '视频',
  gallery: '图集',
  series: '剧集',
  qa: '问答',
  poll: '投票',
}; // 代码块结束

const PRODUCT_KIND: Record<ShopProduct['kind'], string> = { // 常量 PRODUCT_KIND：保存固定配置或一次性派生值
  physical: '实物 · 快递',
  virtual_auto: '虚拟 · 自动发卡',
  virtual_manual: '虚拟 · 人工发货',
}; // 代码块结束

const ORDER_STATUS: Record<string, string> = { // 常量 ORDER_STATUS：保存固定配置或一次性派生值
  pending: '待支付',
  paid: '已支付',
  delivered: '已发货',
  refunded: '已退款',
  cancelled: '已取消',
}; // 代码块结束

/** 售后类型文案：与 after_sales_requests.kind 一一对应 */
const AFTER_SALES_KIND: Record<string, string> = {
  refund_only: '仅退款',
  return_refund: '退货退款',
  repair: '维修',
};

/** 售后状态文案：与 after_sales_requests.status 一一对应 */
const AFTER_SALES_STATUS: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销',
};

/** 售后原因选项：提交时作为 reason 落库，后台可直接阅读 */
const AFTER_SALES_REASONS = ['质量问题', '商品与描述不符', '未收到货', '少件或破损', '其他'];

const TX_KIND: Record<WalletTransaction['kind'], string> = { // 常量 TX_KIND：保存固定配置或一次性派生值
  recharge: '充值',
  consume: '消费',
  refund: '退款',
  commission: '分成',
  withdraw: '提现',
  points: '积分',
}; // 代码块结束

/** 提现状态文案：与后端 withdrawal_requests.status 一一对应 */
const WITHDRAW_STATUS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过 · 打款中',
  rejected: '已驳回',
  paid: '已到账',
  cancelled: '已撤销',
};

/** 提现收款方式文案 */
const WITHDRAW_METHOD: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信',
  bank: '银行卡',
};

/** 收款账号脱敏：只保留首 2 位与末 4 位，列表页不展示完整账号 */
function maskAccount(account: string): string {
  if (account.length <= 6) return account; // 太短无法脱敏，原样返回
  return `${account.slice(0, 2)}****${account.slice(-4)}`;
}

/** 板块内置默认 Tab：接口缺失 / 404 时回落这套栏目组合，保证论坛可按口径排序。 */
const DEFAULT_BOARD_TABS: BoardTab[] = [
  { key: 'latest', label: '最新', order: 10, visible: true, sort: 'latest' },
  { key: 'hot', label: '热门', order: 20, visible: true, sort: 'hot' },
  { key: 'recommend', label: '推荐指数', order: 30, visible: true, sort: 'recommend' },
  { key: 'rating', label: '评分', order: 40, visible: true, sort: 'rating' },
  { key: 'favorites', label: '收藏', order: 50, visible: true, sort: 'favorites' },
]; // 执行当前业务步骤

/** 归一化后端 Tab：兼容 sort_order/sort_by 与冻结契约 order/sort 两套字段名。 */
function normalizeBoardTabs(raw: BoardTab[] | undefined): BoardTab[] {
  if (!Array.isArray(raw)) return DEFAULT_BOARD_TABS; // 条件分支：按判断结果选择后续处理路径
  return raw.map((tab, index) => ({ // 返回当前函数的处理结果
    key: typeof tab.key === 'string' ? tab.key : '',
    label: typeof tab.label === 'string' ? tab.label : tab.key,
    order: tab.sort_order ?? tab.order ?? index,
    visible: tab.visible !== false,
    sort: tab.sort_by ?? tab.sort ?? tab.key,
  })).filter((tab) => tab.key);
} // 代码块结束

function yuan(cents: number): string { // 函数 yuan：封装一段可复用的处理逻辑
  return `¥${(cents / 100).toFixed(2)}`; // 返回当前函数的处理结果
} // 代码块结束

function coverSrc(url: string | null): string { // 封面 / 媒体地址统一走归一化：签名链接补 API 源，静态素材补 BASE_URL
  if (!url) return ''; // 条件分支：按判断结果选择后续处理路径
  return resolvePublicUrl(url); // 绝对地址、/api/ 签名链接、/catalog 等静态前缀由解析器分流
} // 代码块结束

/** VIP 等级徽章：等级 ≥2 走紫色 vip-2，其余走金色 vip-1；路径按 BASE_URL 拼接兼容子路径部署。 */
function vipBadge(level: number): string { // 等级 → 徽章素材
  const file = level >= 2 ? 'vip-2.svg' : 'vip-1.svg'; // 高等级紫、普通等级金
  return `${import.meta.env.BASE_URL}zib/img/${file}`; // 静态资源补前缀
} // vipBadge 结束

function dateOnly(iso: string | null): string { // 函数 dateOnly：封装一段可复用的处理逻辑
  return iso ? iso.slice(0, 10) : ''; // 返回当前函数的处理结果
} // 代码块结束

function formatSize(bytes: number): string { // 函数 formatSize：把字节数转成附件列表可读的大小
  if (!bytes || bytes <= 0) return '未知大小'; // 0 表示服务端未记录，直接提示未知
  if (bytes < 1024) return `${bytes} B`; // 不足 1KB 按字节展示
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; // 不足 1MB 按 KB 展示
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`; // 其余按 MB 展示
} // 代码块结束

/** 列表骨架：结构与 .community-card 一致（10:7 封面 + 元信息 / 两行标题 / 摘要 / 数据行），加载完成后原位替换不跳动。 */
function ThreadSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="community-skeleton-card">
          <div className="skeleton community-skeleton-cover" />
          <div className="community-skeleton-body">
            <span className="skeleton skeleton-line short" />
            <span className="skeleton skeleton-line tall" />
            <span className="skeleton skeleton-line tall mid" />
            <span className="skeleton skeleton-line thin" />
            <span className="skeleton skeleton-line thin mid" />
            <span className="skeleton skeleton-line short" />
          </div>
        </div>
      ))}
    </>
  );
} // ThreadSkeleton 结束

/** 社区与变现页 */
export function Community({ locale, hasSession = false, onRequireLogin }: Props) {
  // 多段深链接：/community/post/:id 论坛帖子详情、/community/news/:kind/:id 资讯条目详情。
  // 视图仍由首段 community 命中，多出的段只决定视图内部渲染哪一层，刷新与直达均可用。
  const segments = usePathSegments(); // 地址栏全部非空段
  const postId = segments[0] === 'community' && segments[1] === 'post' ? (segments[2] ?? '') : ''; // 帖子 id
  const newsKind = segments[0] === 'community' && segments[1] === 'news' ? (segments[2] ?? '') : ''; // 资讯形态
  const newsId = newsKind ? (segments[3] ?? '') : ''; // 资讯条目 id
  // 付费资产：/community/assets 列表、/community/assets/:code 详情；挂在社区视图下才能匿名可读
  const assetRoute = segments[0] === 'community' && segments[1] === 'assets'; // 是否资产深链接
  const assetCode = assetRoute ? (segments[2] ?? '') : ''; // 资产编码；空串表示列表页
  const listScrollRef = useRef(0); // 进入详情前的列表滚动位置
  // 从资讯详情返回时带 ctab：直接打开「公告动态」并落到对应子页签
  const initialContentTab = currentQuery().get('ctab');
  // ?tab= 深链：分享 / 刷新时直达对应板块，非法值回落论坛
  const initialSectionTab = currentQuery().get('tab') ?? '';
  const [tab, setTab] = useState<Tab>(initialContentTab ? 'announcements' : isTab(initialSectionTab) ? initialSectionTab : 'forum'); // 赋值：更新变量 const 的取值
  const [boards, setBoards] = useState<CommunityBoard[]>([]); // 赋值：更新变量 const 的取值
  const [stats, setStats] = useState({ threads: 0, views: 0, likes: 0 }); // 赋值：更新变量 const 的取值
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null); // 赋值：更新变量 const 的取值
  const [vipLevel, setVipLevel] = useState(0); // 赋值：更新变量 const 的取值
  const [userLevel, setUserLevel] = useState(1); // 赋值：更新变量 const 的取值
  const [vipExpires, setVipExpires] = useState<string | null>(null); // 赋值：更新变量 const 的取值
  const [loading, setLoading] = useState(true); // 赋值：更新变量 const 的取值
  const [error, setError] = useState<string | null>(null); // 赋值：更新变量 const 的取值
  const [notice, setNotice] = useState<string | null>(null); // 赋值：更新变量 const 的取值

  const [board, setBoard] = useState('all'); // 赋值：更新变量 const 的取值
  // 付费板块页内门禁壳：未加入时点 chip 不整页跳登录，先在论坛页内展开说明与操作入口
  const [gateBoard, setGateBoard] = useState<CommunityBoard | null>(null); // 赋值：更新变量 const 的取值
  const [gateBusy, setGateBusy] = useState(false); // 门禁壳加入请求中，防重复点击
  const [kind, setKind] = useState('all'); // 赋值：更新变量 const 的取值
  const [sort, setSort] = useState<'latest' | 'hot' | 'views' | 'replies' | 'favorites' | 'rating' | 'recommend'>('latest'); // 赋值：更新变量 const 的取值
  const [boardTabs, setBoardTabs] = useState<BoardTab[]>(DEFAULT_BOARD_TABS); // 赋值：更新变量 const 的取值
  const [tabsDirty, setTabsDirty] = useState(false); // 栏目显隐是否有待保存改动
  const [query, setQuery] = useState(''); // 赋值：更新变量 const 的取值
  const [threads, setThreads] = useState<CommunityThread[]>([]); // 赋值：更新变量 const 的取值
  const [hotThreads, setHotThreads] = useState<CommunityThread[]>([]); // 右栏热门帖：按热门排序取前 5
  // 帖子列表形态：grid 网格卡片 / list 左图右文横排；localStorage 持久化，默认网格（不改动后端排序口径）
  const [threadLayout, setThreadLayout] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('mim.community.layout') === 'list' ? 'list' : 'grid'; } // 读取上次选择
    catch { return 'grid'; } // 隐私模式 / 存储不可用时回落网格
  });
  /** 切换列表形态并写入本地存储；存储失败不影响主流程 */
  function switchThreadLayout(next: 'grid' | 'list') {
    setThreadLayout(next); // 写入目标形态
    try { localStorage.setItem('mim.community.layout', next); } catch { /* 忽略 */ }
  } // switchThreadLayout 结束
  const [selected, setSelected] = useState<{ thread: CommunityThreadDetail; posts: CommunityPost[]; liked: boolean; unlocked: boolean; favorited: boolean } | null>(null); // 赋值：更新变量 const 的取值

  const [composerOpen, setComposerOpen] = useState(false); // 赋值：更新变量 const 的取值
  const [draftBoard, setDraftBoard] = useState('general'); // 赋值：更新变量 const 的取值
  const [draftKind, setDraftKind] = useState<ThreadKind>('text'); // 赋值：更新变量 const 的取值
  const [draftTitle, setDraftTitle] = useState(''); // 赋值：更新变量 const 的取值
  const [draftSummary, setDraftSummary] = useState(''); // 赋值：更新变量 const 的取值
  const [draftBody, setDraftBody] = useState(''); // 赋值：更新变量 const 的取值
  const [draftPrice, setDraftPrice] = useState('0'); // 赋值：更新变量 const 的取值
  const [draftMedia, setDraftMedia] = useState(''); // 赋值：更新变量 const 的取值
  const [draftPoll, setDraftPoll] = useState(''); // 赋值：更新变量 const 的取值
  const [draftEpisodes, setDraftEpisodes] = useState(''); // 剧集目录：每行「标题|视频地址」
  const [draftAttachments, setDraftAttachments] = useState<Array<{ name: string; object_key: string; mime: string; size_bytes: number }>>([]); // 已上传待随帖提交的附件
  const [attachmentBusy, setAttachmentBusy] = useState(false); // 附件上传中，防重复点击
  const [draftUploads, setDraftUploads] = useState<CommunityThreadMedia[]>([]); // 已上传待随帖提交的图片 / 视频（对象键 + 元数据）
  const [mediaBusy, setMediaBusy] = useState(false); // 媒体上传中，防重复点击
  const [boardOpen, setBoardOpen] = useState(false); // 创建板块表单
  const [boardDraft, setBoardDraft] = useState({ slug: '', name: '', description: '', visibility: 'public' as 'public' | 'followers', minLevel: '0', price: '0' }); // 赋值：更新变量 const 的取值
  const [reply, setReply] = useState('');; // 赋值：更新变量 const 的取值
  const [replyTo, setReplyTo] = useState(''); // 楼中楼：正在回复的楼层 id
  const [replyToName, setReplyToName] = useState(''); // 楼中楼：被回复人昵称
  const [postsTotal, setPostsTotal] = useState(0); // 详情回复总数（服务端分页口径）
  const [listTotal, setListTotal] = useState(0); // 列表命中总数（数字分页口径）
  const [listBusy, setListBusy] = useState(false); // 列表翻页加载中
  const [page, setPage] = useState(1); // 当前页码（1 起算）
  const PAGE_SIZE = 20; // 每页帖数：与数字分页器页长一致
  const [listLoading, setListLoading] = useState(true); // 列表首屏 / 筛选加载中：用于骨架占位，避免空态先闪一下
  const [listFailed, setListFailed] = useState(false); // 列表加载失败：与「筛选后为空」区分，给出重试入口
  const [searchOpen, setSearchOpen] = useState(false); // 全文搜索面板
  const [moderationOpen, setModerationOpen] = useState(false); // 版主举报工作台

  const [plans, setPlans] = useState<VipPlan[]>([]); // 赋值：更新变量 const 的取值
  const [walletDetail, setWalletDetail] = useState<{ checked_in_today: boolean; transactions: WalletTransaction[] } | null>(null); // 赋值：更新变量 const 的取值
  const [redeemCode, setRedeemCode] = useState(''); // 赋值：更新变量 const 的取值
  const [transferTo, setTransferTo] = useState(''); // 赋值：更新变量 const 的取值
  const [transferAmount, setTransferAmount] = useState(''); // 赋值：更新变量 const 的取值
  // ── 提现（钱包结算层）──
  const [withdrawal, setWithdrawal] = useState<WithdrawalOverview | null>(null); // 可提现余额快照 + 申请记录
  const [wdAmount, setWdAmount] = useState(''); // 提现金额输入（元，提交前换算成整数分）
  const [wdMethod, setWdMethod] = useState<WithdrawMethod>('alipay'); // 收款方式
  const [wdName, setWdName] = useState(''); // 收款人
  const [wdAccount, setWdAccount] = useState(''); // 收款账号
  const [wdBusy, setWdBusy] = useState(false); // 提交中，防重复点击
  const [favoritesOpen, setFavoritesOpen] = useState(false); // 赋值：更新变量 const 的取值
  const [favorites, setFavorites] = useState<CommunityThread[]>([]); // 赋值：更新变量 const 的取值

  const [products, setProducts] = useState<ShopProduct[]>([]); // 赋值：更新变量 const 的取值
  const [orders, setOrders] = useState<UnifiedOrder[]>([]); // 赋值：更新变量 const 的取值
  const [buying, setBuying] = useState<string | null>(null); // 赋值：更新变量 const 的取值
  const [quantity, setQuantity] = useState(1); // 赋值：更新变量 const 的取值
  const [coupon, setCoupon] = useState(''); // 赋值：更新变量 const 的取值
  const [shipName, setShipName] = useState(''); // 赋值：更新变量 const 的取值
  const [shipPhone, setShipPhone] = useState(''); // 赋值：更新变量 const 的取值
  const [shipAddress, setShipAddress] = useState(''); // 赋值：更新变量 const 的取值
  const [lastOrder, setLastOrder] = useState<{ order_id: string; payable_cents: number; delivery_kind: string } | null>(null); // 赋值：更新变量 const 的取值
  // ── 售后（用户侧）──
  const [afterSales, setAfterSales] = useState<AfterSalesRequest[]>([]); // 我的售后申请
  const [asOrder, setAsOrder] = useState<string | null>(null); // 正在申请售后的订单 id
  const [asKind, setAsKind] = useState<'refund_only' | 'return_refund' | 'repair'>('refund_only'); // 售后类型
  const [asReason, setAsReason] = useState('质量问题'); // 申请原因（下拉选项）
  const [asDetail, setAsDetail] = useState(''); // 问题说明
  const [asEvidence, setAsEvidence] = useState(''); // 凭证说明文字（不上传文件）
  const [asBusy, setAsBusy] = useState(false); // 提交中，防重复点击

  const [referral, setReferral] = useState<{ code: string; invited: { count: number; commission: number }; commission_cents: number } | null>(null); // 赋值：更新变量 const 的取值
  const [bindCode, setBindCode] = useState(''); // 赋值：更新变量 const 的取值

  /** 未登录时统一拦下写动作：不发请求，只提示并引导去登录页（浏览不受影响） */
  function requireSession(): boolean {
    if (hasSession) return true; // 已登录直接放行
    setNotice(locale === 'en-US' ? 'Sign in before interacting.' : '请先登录后再互动。'); // 非阻断提示
    onRequireLogin?.(); // 交给 App 跳登录，并保留登录后回跳
    return false; // 调用方据此提前返回，避免发出匿名写请求
  }

  /** 切换页签：八个板块都允许匿名进入，数据类面板各自决定登录后的可见范围 */
  function switchTab(next: Tab) {
    setTab(next); // 先切换页签，保证无会话时也能看到公开内容
    // 同步 ?tab= 深链：刷新、分享与浏览器回退都能直达当前板块；帖子详情页不改写地址
    if (!postId && !newsKind) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      url.searchParams.delete('ctab');
      window.history.replaceState(null, '', url.toString());
    }
  }

  async function loadOverview() { // 函数 loadOverview：封装一段可复用的处理逻辑
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.community.overview(); // 常量 data：保存固定配置或一次性派生值
      setBoards(data.boards);
      setStats(data.stats);
      setWallet(hasSession ? data.wallet : null); // 匿名返回的是零值快照，不当作余额展示
      setVipLevel(data.vip_level);
      setVipExpires(data.vip?.expires_at ?? null);
      setError(null);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setLoading(false);
    } // 代码块结束
  } // 代码块结束

  async function loadThreads(targetPage = 1) { // 函数 loadThreads：封装一段可复用的处理逻辑
    setListLoading(true); // 进入加载态：首次 / 换筛选都先占位，加载完成后原位替换
    setListFailed(false); // 重试时清掉上一次的失败标记
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.community.threads({ board, kind, sort, q: query, limit: PAGE_SIZE, offset: (targetPage - 1) * PAGE_SIZE }); // 按页长与页码算偏移
      setThreads(data.items);
      setListTotal(data.total);
      setPage(targetPage); // 记录当前页，分页器据此高亮
      setError(null);
    } catch (err) {
      setListFailed(true); // 失败与空结果分开：空列表不显示重试，失败才显示
      setError(errorText(locale, err));
    } finally {
      setListLoading(false); // 结束加载态
    } // 代码块结束
  } // 代码块结束

  /** 翻页：页码夹在 1..totalPages 区间，加载中防重复点击。 */
  async function goPage(next: number) {
    const totalPages = Math.max(1, Math.ceil(listTotal / PAGE_SIZE)); // 总页数：空列表回落 1
    const target = Math.min(Math.max(next, 1), totalPages); // 边界收敛
    if (target === page || listBusy) return; // 同页 / 加载中直接返回
    setListBusy(true);
    try {
      await loadThreads(target);
      setError(null);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setListBusy(false);
    }
  }

  async function loadWallet() { // 函数 loadWallet：封装一段可复用的处理逻辑
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.wallet.get(); // 常量 data：保存固定配置或一次性派生值
      setWallet(data.wallet);
      setWalletDetail({ checked_in_today: data.checked_in_today, transactions: data.transactions });
      setVipLevel(data.vip_level);
      if (vipExpires === null) setVipExpires(null); // 条件分支：按判断结果选择后续处理路径
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  /** 读取可提现余额口径与申请记录（钱包结算层） */
  async function loadWithdrawals() {
    try {
      setWithdrawal(await getWithdrawalOverview());
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  /** 提交提现申请：界面输入「元」，这里换算成整数分，后端再做整数校验 */
  async function submitWithdrawal() {
    if (!requireSession()) return; // 未登录先引导登录
    const yuanValue = Number(wdAmount.trim()); // 允许 "20" / "20.50" 两种写法
    if (!Number.isFinite(yuanValue) || yuanValue <= 0) {
      setNotice('请输入大于 0 的提现金额。');
      return;
    }
    const amountCents = Math.round(yuanValue * 100); // 四舍五入到整数分，杜绝浮点尾差
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setNotice('提现金额必须是有效的正整数分。');
      return;
    }
    setWdBusy(true);
    try {
      await createWithdrawal({ amount_cents: amountCents, method: wdMethod, account_name: wdName.trim(), account_no: wdAccount.trim() });
      setWdAmount('');
      setNotice('提现申请已提交，等待后台审核。');
      await Promise.all([loadWithdrawals(), loadWallet()]); // 刷新冻结额度与钱包卡
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setWdBusy(false);
    }
  }

  /** 撤销本人待审申请，释放冻结额度 */
  async function revokeWithdrawal(id: string) {
    setWdBusy(true);
    try {
      await cancelWithdrawal(id);
      setNotice('申请已撤销。');
      await Promise.all([loadWithdrawals(), loadWallet()]);
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setWdBusy(false);
    }
  }

  async function loadShop() { // 函数 loadShop：封装一段可复用的处理逻辑
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const p = await api.shop.products(); // 商品目录公开可读，匿名也能看到货架
      setProducts(p.products);
      if (!hasSession) return; // 订单 / 售后是私密读，匿名不请求
      const [o, a] = await Promise.all([api.commerce.orders({ source: 'shop' }), api.shop.myAfterSales()]); // 订单读取切统一只读接口，售后读用户侧新接口
      setOrders(o.items);
      setAfterSales(a.items);
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function loadPlans() { // 函数 loadPlans：封装一段可复用的处理逻辑
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.vip.plans(); // 常量 data：保存固定配置或一次性派生值
      setPlans(data.plans);
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function loadReferral() { // 函数 loadReferral：封装一段可复用的处理逻辑
    try { // 异常捕获起点：包裹可能抛出错误的操作
      setReferral(await api.referral.get());
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  useEffect(() => {
    void loadOverview(); // 执行当前业务步骤
    void loadPlans(); // 执行当前业务步骤
  }, []);

  useEffect(() => {
    if (tab === 'forum') void loadThreads(1); // 条件分支：按判断结果选择后续处理路径
  }, [board, kind, sort]);

  // 右栏热门帖：独立按热门排序取前 5，不随当前筛选切换；卸载后拒绝回写
  useEffect(() => {
    if (tab !== 'forum') return;
    let alive = true;
    api.community.threads({ sort: 'hot', limit: 5 })
      .then((data) => { if (alive) setHotThreads(data.items); })
      .catch(() => { /* 挂件失败不阻断主列表 */ });
    return () => { alive = false; };
  }, [tab]);

  // 作者榜：在热门帖 + 当前页内按「点赞 + 回复」聚合取前 5；无公开作者档案接口，分数为前端侧口径
  const authorRank = useMemo(() => {
    const map = new Map<string, { name: string; posts: number; score: number }>(); // 聚合累加器
    for (const t of [...hotThreads, ...threads]) {
      const key = t.author_name ?? 'official'; // 列表项无作者 ID 字段，按昵称兜底聚合
      const cur = map.get(key) ?? { name: t.author_name || 'Mim 官方', posts: 0, score: 0 };
      cur.posts += 1;
      cur.score += t.likes + t.reply_count; // 互动分：点赞 + 回复
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 5); // 按互动分降序取前 5
  }, [hotThreads, threads]);

  useEffect(() => {
    if (tab === 'shop') void loadShop(); // 商城货架匿名可读，订单只在登录后补充
    if (!hasSession) return; // 钱包 / 推广是私密读，匿名不发请求
    if (tab === 'wallet') { void loadWallet(); void loadWithdrawals(); } // 钱包页同时拉余额流水与可提现口径
    if (tab === 'referral') void loadReferral(); // 条件分支：按判断结果选择后续处理路径
  }, [tab, hasSession]);

  useEffect(() => {
    if (!favoritesOpen || !hasSession) return; // 收藏是私密读，匿名不请求
    api.community
      .favorites()
      .then((data) => setFavorites(data.items))
      .catch((err) => setError(errorText(locale, err)));
  }, [favoritesOpen, hasSession]);

  // 板块栏目：切换板块时拉取 Tab 配置；接口缺失 / 404 回落内置默认 Tab，不报错。
  useEffect(() => {
    if (board === 'all') { // 条件分支：按判断结果选择后续处理路径
      setBoardTabs(DEFAULT_BOARD_TABS);
      setTabsDirty(false);
      return; // 返回当前函数的处理结果
    } // 代码块结束
    let cancelled = false; // 卸载 / 切板块后丢弃过期结果
    api.community
      .boardTabs(board)
      .then((data) => { if (!cancelled) { setBoardTabs(normalizeBoardTabs(data.tabs)); setTabsDirty(false); } })
      .catch(() => { if (!cancelled) { setBoardTabs(DEFAULT_BOARD_TABS); setTabsDirty(false); } });
    return () => { cancelled = true; }; // 返回当前函数的处理结果
  }, [board]);

  /** 待展示栏目：按 order / sort_order 升序，仅渲染可见项。 */
  const visibleBoardTabs = [...boardTabs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).filter((tab) => tab.visible);

  /** 切换栏目显隐（版主本地编辑，保存后落库）。 */
  function toggleTabVisible(key: string) {
    setBoardTabs((prev) => prev.map((tab) => (tab.key === key ? { ...tab, visible: !tab.visible } : tab)));
    setTabsDirty(true);
  } // 代码块结束

  /** 保存栏目组合：顺序 / 显隐 / 排序口径整体提交。 */
  async function saveBoardTabs() {
    if (!requireSession()) return; // 匿名不提交栏目配置
    if (board === 'all') return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.community.saveBoardTabs(board, boardTabs.map((tab) => ({ // 异步等待：挂起至 Promise 落定后再继续
        key: tab.key,
        label: tab.label,
        visible: tab.visible,
        sort_order: tab.order,
        sort_by: tab.sort,
      })));
      setTabsDirty(false);
      setNotice(locale === 'en-US' ? 'Tabs saved' : '栏目已保存');
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function loadThread(id: string) { // 仅拉取详情，不改地址栏（深链接刷新与卡片进入共用）
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.community.thread(id); // 常量 data：保存固定配置或一次性派生值
      setSelected(data);
      setPostsTotal((data as { posts_total?: number }).posts_total ?? data.posts.length); // 回复总数（服务端分页口径）
      setReply('');
      setReplyTo('');
      setReplyToName('');
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function openThread(id: string) { // 卡片 / 收藏行点击：记录滚动位置后进入详情深链接
    listScrollRef.current = window.scrollY; // 记下列表滚动位置
    await loadThread(id); // 先取详情
    navigatePath(pathOf('community', `post/${encodeURIComponent(id)}`)); // 地址栏变为 /community/post/:id
  } // 代码块结束

  function closeThread() { // 返回列表：回到 /community 并恢复原来的滚动位置与筛选状态
    setSelected(null); // 清空详情
    navigatePath(pathOf('community')); // 回到社区列表
    const y = listScrollRef.current; // 原先的滚动位置
    window.requestAnimationFrame(() => window.scrollTo(0, y)); // 等列表渲染后恢复
  } // 代码块结束

  async function copyShareLink() { // 分享 / 复制当前详情深链接
    const url = window.location.href; // 当前地址
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await navigator.clipboard?.writeText(url); // 优先剪贴板
      setNotice('链接已复制');
    } catch {
      setNotice(url); // 降级：把地址显示在提示条
    } // 代码块结束
  } // 代码块结束

  // 概览刷新后若目标板块已加入 / 已是 VIP，关闭可能残留的门禁壳，避免壳遮挡新板块列表
  useEffect(() => {
    if (!gateBoard) return; // 门禁壳未展开时不处理
    const fresh = boards.find((b) => b.slug === gateBoard.slug); // 取最新板块对象，joined / vip 状态以服务端为准
    if (fresh && (fresh.joined || vipLevel > 0)) setGateBoard(null); // 已具备准入：收起壳
  }, [boards, gateBoard, vipLevel]); // 依赖：板块列表、壳目标、VIP 等级

  // 深链接进入 /community/post/:id：地址栏粘贴或刷新时主动拉取详情，避免空白
  useEffect(() => {
    if (!postId) return; // 列表态不处理
    if (selected?.thread.id === postId) return; // 已加载同一条
    void loadThread(postId); // 拉取详情
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  // 从详情回到列表（关闭按钮或浏览器后退）：恢复列表滚动位置
  useEffect(() => {
    if (postId) return; // 仍在详情
    const y = listScrollRef.current; // 进入详情前记住的位置
    if (y > 0) window.requestAnimationFrame(() => window.scrollTo(0, y)); // 列表渲染后恢复
  }, [postId]);

  async function unlockThread(id: string) { // 函数 unlockThread：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 解锁是付费写操作，匿名先登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.community.unlock(id); // 常量 result：保存固定配置或一次性派生值
      setNotice(result.via === 'vip' ? 'VIP 权益直接解锁' : result.charged_cents > 0 ? `已扣 ${yuan(result.charged_cents)} 解锁` : '已解锁');
      await Promise.all([openThread(id), loadOverview()]); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function submitReply() { // 函数 submitReply：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 评论必须登录
    if (!selected || !reply.trim()) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await postReply(selected.thread.id, reply.trim(), replyTo || undefined); // 异步等待：挂起至 Promise 落定后再继续
      setReply('');
      setReplyTo('');
      setReplyToName('');
      await openThread(selected.thread.id); // 异步等待：挂起至 Promise 落定后再继续
      setNotice('回复已发布');
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  /** 回复加载更多：按 post_offset 取下一页并追加到当前详情。 */
  async function loadMoreReplies() {
    if (!selected) return;
    try {
      const data = await threadDetail(selected.thread.id, { post_limit: 50, post_offset: selected.posts.length });
      setSelected({ ...selected, posts: [...selected.posts, ...data.posts.filter((item) => !selected.posts.some((row) => row.id === item.id))] });
      setPostsTotal(data.posts_total ?? data.posts.length);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function toggleLike() { // 函数 toggleLike：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 点赞必须登录
    if (!selected) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.community.like(selected.thread.id); // 常量 result：保存固定配置或一次性派生值
      setSelected({ ...selected, liked: result.liked, thread: { ...selected.thread, likes: selected.thread.likes + (result.liked ? 1 : -1) } });
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function toggleFavorite() { // 函数 toggleFavorite：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 收藏必须登录
    if (!selected) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.community.favorite(selected.thread.id); // 常量 result：保存固定配置或一次性派生值
      setSelected({ ...selected, favorited: result.favorited });
      setNotice(result.favorited ? '已加入收藏' : '已取消收藏');
      await loadOverview(); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function rateThread(rating: number) { // 函数 rateThread：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 评分必须登录
    if (!selected) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.community.rate(selected.thread.id, rating); // 异步等待：挂起至 Promise 落定后再继续
      await openThread(selected.thread.id); // 异步等待：挂起至 Promise 落定后再继续
      setNotice(`已评 ${rating} 星`);
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function vote(optionId: string) { // 函数 vote：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 投票必须登录
    if (!selected) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.community.vote(selected.thread.id, optionId); // 异步等待：挂起至 Promise 落定后再继续
      await openThread(selected.thread.id); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  /** 板块 chip / 侧栏导航统一入口：付费未加入且非 VIP 时展开页内门禁壳，不整页跳登录。 */
  function selectBoard(target: CommunityBoard) { // 函数 selectBoard：封装一段可复用的处理逻辑
    const paidLocked = target.price_cents > 0 && !target.joined && vipLevel === 0; // 付费门槛：未加入且当前非 VIP
    if (paidLocked) { // 条件分支：付费未加入
      setGateBoard(target); // 页内展开门禁壳：保留当前列表与筛选，不发任何写请求、不跳路由
      return; // 返回当前函数的处理结果
    } // 条件分支结束
    if (target.visibility === 'followers' && !target.followed && !target.is_moderator) { // 条件分支：关注可见板块
      void followBoard(target.slug); // 沿用既有关注链路，行为与本轮改动前一致
      return; // 返回当前函数的处理结果
    } // 条件分支结束
    setGateBoard(null); // 已加入 / VIP / 免费板块：关闭可能残留的门禁壳后直接切板块
    setBoard(target.slug); // 写入当前板块筛选
  } // selectBoard 结束

  /** 门禁壳「登录并加入」：先把目标板块写进返回路径，再交给 App 记下来源并跳登录页。 */
  function gateLoginNext() { // 函数 gateLoginNext：封装一段可复用的处理逻辑
    if (!gateBoard) return; // 无门禁壳时不动作
    const url = new URL(window.location.href); // 当前地址：保留既有查询串与 hash
    url.searchParams.set('board', gateBoard.slug); // 回跳落点带上目标板块，登录成功后直达该板块
    window.history.replaceState(null, '', url.toString()); // 原地替换地址栏，不新增浏览历史记录
    if (onRequireLogin) onRequireLogin(); // App 记录当前路径（含 ?board=paid）后跳 /signin
    else requireSession(); // 无上层回调时回落组件内既有登录引导
  } // gateLoginNext 结束

  /** 门禁壳「确认加入」：已登录才真正调加入接口；未登录先走带返回路径的登录引导。 */
  async function gateJoin() { // 函数 gateJoin：封装一段可复用的处理逻辑
    if (!gateBoard) return; // 无门禁壳时不动作
    if (!hasSession) { // 条件分支：匿名点击
      gateLoginNext(); // 匿名不发写请求：带返回路径去登录，登录后回本页再加入
      return; // 返回当前函数的处理结果
    } // 条件分支结束
    setGateBusy(true); // 进入加载态，防重复点击
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await joinBoard(gateBoard.slug); // 复用既有扣费 / 刷新 / 通知逻辑，错误由 joinBoard 统一落地提示
      setGateBoard(null); // 加入成功关闭门禁壳；失败保留壳与错误提示，便于重试
    } finally { // 代码块结束
      setGateBusy(false); // 无论成败复位加载态
    } // 代码块结束
  } // gateJoin 结束

  async function joinBoard(slug: string) { // 函数 joinBoard：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 加入板块必须登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.community.joinBoard(slug); // 常量 result：保存固定配置或一次性派生值
      setNotice(result.charged_cents > 0 ? `已扣 ${yuan(result.charged_cents)} 加入板块` : '已加入板块');
      setBoard(slug);
      setGateBoard(null); // 加入成功关闭页内门禁壳，避免壳残留遮挡新板块列表
      await Promise.all([loadOverview(), loadThreads()]); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function followBoard(slug: string) { // 函数 followBoard：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 关注板块必须登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.community.followBoard(slug); // 常量 result：保存固定配置或一次性派生值
      setNotice(result.followed ? '已关注板块' : '已取消关注');
      setBoard(slug);
      await Promise.all([loadOverview(), loadThreads()]); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function createBoard() { // 函数 createBoard：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 创建板块必须登录
    if (!boardDraft.slug.trim() || !boardDraft.name.trim()) { // 条件分支：按判断结果选择后续处理路径
      setError('板块 slug 与名称必填');
      return; // 返回当前函数的处理结果
    } // 代码块结束
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.community.createBoard({ // 异步等待：挂起至 Promise 落定后再继续
        slug: boardDraft.slug.trim(),
        name: boardDraft.name.trim(),
        description: boardDraft.description.trim(),
        visibility: boardDraft.visibility,
        post_min_level: Math.max(0, Number(boardDraft.minLevel) || 0),
        price_cents: Math.max(0, Math.round(Number(boardDraft.price || '0') * 100)),
      });
      setBoardOpen(false);
      setBoardDraft({ slug: '', name: '', description: '', visibility: 'public', minLevel: '0', price: '0' });
      setNotice('板块已创建，你已成为版主');
      await Promise.all([loadOverview(), loadThreads()]); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function acceptPost(postId: string) { // 函数 acceptPost：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 采纳答案必须登录
    if (!selected) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.community.acceptPost(selected.thread.id, postId); // 异步等待：挂起至 Promise 落定后再继续
      setNotice('已采纳该回复');
      await openThread(selected.thread.id); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function deleteThread() { // 函数 deleteThread：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 删除帖子必须登录
    if (!selected) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.community.deleteThread(selected.thread.id); // 异步等待：挂起至 Promise 落定后再继续
      closeThread(); // 删除后回到列表并恢复滚动位置
      setNotice('帖子已删除');
      await loadThreads(); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束


  async function transferPoints() { // 函数 transferPoints：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 转积分必须登录
    const points = Number(transferAmount); // 常量 points：保存固定配置或一次性派生值
    if (!transferTo.trim() || !Number.isInteger(points) || points <= 0) { // 条件分支：按判断结果选择后续处理路径
      setError('请填写接收方 Mim ID 与正整数积分');
      return; // 返回当前函数的处理结果
    } // 代码块结束
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.wallet.transferPoints({ to_member_no: transferTo.trim(), points }); // 常量 result：保存固定配置或一次性派生值
      setNotice(`已转 ${result.points} 积分给 ${result.to}`);
      setTransferTo('');
      setTransferAmount('');
      await loadWallet(); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束
  /** 上传附件：复用媒体预签名直传，拿到 object_key 后由发帖接口落库（下载时再签短时地址） */
  async function uploadAttachment(file: File) { // 函数 uploadAttachment：附件只上传不直链
    if (!requireSession()) return; // 上传必须登录
    if (draftAttachments.length >= 6) { setError('单帖最多 6 个附件'); return; } // 与服务端上限保持一致
    setAttachmentBusy(true); // 进入上传态
    setError(null); // 清空旧错误
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const mime = file.type || 'application/octet-stream'; // MIME 兜底，避免空类型
      const presign = await api.media.presignUpload({ asset_type: 'final', mime, size_bytes: file.size }); // 复用媒体域上传凭证（final = 通用产物）
      const put = await fetch(presign.upload.url, { method: presign.upload.method, headers: presign.upload.headers, body: file }); // 按服务端签名直传字节
      if (!put.ok) throw new Error(`附件上传失败：${put.status}`); // 直传失败即中止
      setDraftAttachments((prev) => [...prev, { name: file.name, object_key: presign.object_key, mime, size_bytes: file.size }].slice(0, 6)); // 记录对象键，提交时才写库
    } catch (err) { // 异常捕获：统一转成用户可读提示
      setError(errorText(locale, err)); // 复用现有错误文案映射
    } finally { // 无论成败都要复位上传态
      setAttachmentBusy(false); // 退出上传态
    } // 代码块结束
  } // 代码块结束

  /** 读取本地媒体的分辨率 / 时长：只在浏览器内探测，不读取文件内容上传。 */
  function probeMedia(file: File): Promise<{ width: number; height: number; duration_seconds: number }> { // 定义函数 probeMedia
    return new Promise((resolve) => { // 回调式 API 包装成 Promise
      const url = URL.createObjectURL(file); // 本地临时地址
      const done = (width: number, height: number, duration_seconds: number) => { URL.revokeObjectURL(url); resolve({ width, height, duration_seconds }); }; // 统一释放
      if (file.type.startsWith('video/')) { // 视频：读元数据
        const el = document.createElement('video'); // 离屏 video
        el.preload = 'metadata'; // 只取元数据
        el.onloadedmetadata = () => done(el.videoWidth, el.videoHeight, Math.round(el.duration || 0)); // 读取宽高与时长
        el.onerror = () => done(0, 0, 0); // 探测失败不阻塞上传
        el.src = url; // 绑定本地地址
        return; // 结束
      } // 结束条件分支
      if (file.type.startsWith('image/')) { // 图片：读自然尺寸
        const img = new Image(); // 离屏图片
        img.onload = () => done(img.naturalWidth, img.naturalHeight, 0); // 读取宽高
        img.onerror = () => done(0, 0, 0); // 探测失败不阻塞上传
        img.src = url; // 绑定本地地址
        return; // 结束
      } // 结束条件分支
      done(0, 0, 0); // 其他类型不探测
    }); // 结束 Promise
  } // 函数结束

  /** 上传图片 / 视频：复用媒体预签名，提交时只带对象键与元数据，读接口再签短时地址。 */
  async function uploadDraftMedia(file: File) { // 定义函数 uploadDraftMedia
    if (!requireSession()) return; // 上传必须登录
    if (draftUploads.length >= 12) { setError('单帖最多 12 个媒体'); return; } // 与服务端上限一致
    const kind: CommunityThreadMedia['kind'] | null = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null; // 只接受图片 / 视频
    if (!kind) { setError('仅支持图片或视频文件'); return; } // 拒绝其他类型
    if (file.size > 64 * 1024 * 1024) { setError('单个媒体不超过 64MB'); return; } // 与预签名上限一致
    setMediaBusy(true); // 进入上传态
    setError(null); // 清空旧错误
    try { // 异常捕获起点
      const mime = file.type || 'application/octet-stream'; // MIME 兜底
      const probe = await probeMedia(file); // 读取时长 / 分辨率
      const presign = await api.media.presignUpload({ asset_type: 'final', mime, size_bytes: file.size }); // 复用媒体域上传凭证
      const put = await fetch(presign.upload.url, { method: presign.upload.method, headers: presign.upload.headers, body: file }); // 按签名直传字节
      if (!put.ok) throw new Error(`媒体上传失败：${put.status}`); // 直传失败即中止
      setDraftUploads((prev) => [...prev, { url: '', kind, object_key: presign.object_key, mime, size_bytes: file.size, ...probe }].slice(0, 12)); // 只记对象键与元数据；url 由读接口现签
    } catch (err) { // 异常捕获
      setError(errorText(locale, err)); // 统一文案
    } finally { // 无论成败
      setMediaBusy(false); // 退出上传态
    } // 结束异常处理
  } // 函数结束

  /** 给已上传的视频补封面：同样走预签名，只记录 poster_key。 */
  async function uploadDraftPoster(index: number, file: File) { // 定义函数 uploadDraftPoster
    if (!requireSession()) return; // 上传必须登录
    if (!file.type.startsWith('image/')) { setError('封面需要图片文件'); return; } // 封面只接受图片
    if (file.size > 64 * 1024 * 1024) { setError('封面不超过 64MB'); return; } // 与预签名上限一致
    setMediaBusy(true); // 进入上传态
    setError(null); // 清空旧错误
    try { // 异常捕获起点
      const mime = file.type || 'image/jpeg'; // MIME 兜底
      const presign = await api.media.presignUpload({ asset_type: 'final', mime, size_bytes: file.size }); // 预签名
      const put = await fetch(presign.upload.url, { method: presign.upload.method, headers: presign.upload.headers, body: file }); // 直传
      if (!put.ok) throw new Error(`封面上传失败：${put.status}`); // 直传失败即中止
      setDraftUploads((prev) => prev.map((item, i) => (i === index ? { ...item, poster_key: presign.object_key } : item))); // 只更新目标视频
    } catch (err) { // 异常捕获
      setError(errorText(locale, err)); // 统一文案
    } finally { // 无论成败
      setMediaBusy(false); // 退出上传态
    } // 结束异常处理
  } // 函数结束

  /** 申请附件下载：服务端按帖子权限签发 5 分钟地址，前端只负责打开 */
  async function downloadAttachment(attachmentId: string) { // 函数 downloadAttachment：绝不拼公开直链
    if (!postId) return; // 详情 id 缺失时不发请求
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.community.downloadAttachment(postId, attachmentId); // 拿签名地址
      window.open(result.download.url, '_blank', 'noopener'); // 新标签打开签名地址触发下载
    } catch (err) { // 异常捕获：未登录 / 未解锁 / 对象缺失统一提示
      setError(errorText(locale, err)); // 复用现有错误文案映射
    } // 代码块结束
  } // 代码块结束

  async function createThread() { // 函数 createThread：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 发帖必须登录
    if (!draftTitle.trim() || !draftBody.trim()) { // 条件分支：按判断结果选择后续处理路径
      setError('标题与正文必填');
      return; // 返回当前函数的处理结果
    } // 代码块结束
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const mediaLines = draftMedia // 常量 mediaLines：保存固定配置或一次性派生值
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const pollLines = draftPoll // 常量 pollLines：保存固定配置或一次性派生值
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const media: CommunityThreadMedia[] = [ // 媒体：直链与预签名直传两种来源合并提交
        ...mediaLines.map((url) => ({ // 旧的文本地址仍兼容
          kind: draftKind === 'video' && /\.(mp4|mov|m3u8|webm)(\?|$)/i.test(url) ? ('video' as const) : ('image' as const),
          url,
        })), // 结束映射
        ...draftUploads, // 文件直传：对象键 + 时长 / 分辨率 / 封面
      ]; // 结束合并
      const episodes = draftKind === 'series' // 常量 episodes：保存固定配置或一次性派生值
        ? draftEpisodes.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
          const [title, mediaUrl] = line.split('|').map((part) => part.trim()); // 赋值：更新变量 const 的取值
          return { title: title || '未命名剧集', media_url: mediaUrl || '' }; // 返回当前函数的处理结果
        }).filter((item) => item.media_url.length > 0)
        : undefined;
      const created = await api.community.createThread({ // 常量 created：保存固定配置或一次性派生值
        board_slug: draftBoard,
        title: draftTitle.trim(),
        summary: draftSummary.trim(),
        body: draftBody.trim(),
        kind: draftKind,
        price_cents: Math.max(0, Math.round(Number(draftPrice || '0') * 100)),
        media,
        poll_options: draftKind === 'poll' ? pollLines : undefined,
        episodes,
        attachments: draftAttachments.length > 0 ? draftAttachments : undefined, // 附件随帖提交，服务端校验归属与存在性
      }); // 发帖请求结束
      setDraftTitle('');
      setDraftSummary('');
      setDraftBody('');
      setDraftPrice('0');
      setDraftMedia('');
      setDraftPoll('');
      setDraftEpisodes('');
      setDraftAttachments([]); // 发布成功清空附件暂存
      setDraftUploads([]); // 发布成功清空媒体暂存
      setComposerOpen(false);
      setNotice('帖子已发布');
      await loadThreads(); // 异步等待：挂起至 Promise 落定后再继续
      await openThread(created.thread_id); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function subscribe(code: string) { // 函数 subscribe：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 开通 VIP 必须登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.vip.subscribe(code); // 常量 result：保存固定配置或一次性派生值
      setNotice(`开通成功，VIP ${result.level} 到期 ${dateOnly(result.expires_at)}`);
      await Promise.all([loadOverview(), loadWallet()]); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function checkin() { // 函数 checkin：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 签到必须登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.wallet.checkin(); // 常量 result：保存固定配置或一次性派生值
      setNotice(`签到 +${result.points} 积分`);
      await loadWallet(); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function redeem() { // 函数 redeem：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 兑换必须登录
    if (!redeemCode.trim()) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.wallet.redeem(redeemCode.trim()); // 常量 result：保存固定配置或一次性派生值
      setNotice(`充值成功 ${yuan(result.amount_cents)}`);
      setRedeemCode('');
      await loadWallet(); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function placeOrder(product: ShopProduct) { // 函数 placeOrder：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 下单支付必须登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const payload: { product_code: string; quantity: number; coupon_code?: string; shipping?: { name: string; phone: string; address: string } } = { // 常量 payload：保存固定配置或一次性派生值
        product_code: product.code,
        quantity,
      }; // 代码块结束
      if (coupon.trim()) payload.coupon_code = coupon.trim(); // 条件分支：按判断结果选择后续处理路径
      if (product.kind === 'physical') { // 条件分支：按判断结果选择后续处理路径
        if (!shipName.trim() || !shipPhone.trim() || !shipAddress.trim()) { // 条件分支：按判断结果选择后续处理路径
          setError('实物商品请填写收货人、手机号与地址');
          return; // 返回当前函数的处理结果
        } // 代码块结束
        payload.shipping = { name: shipName.trim(), phone: shipPhone.trim(), address: shipAddress.trim() };
      } // 代码块结束
      const result = await api.shop.order(payload); // 常量 result：保存固定配置或一次性派生值
      setLastOrder(result);
      setNotice(result.discount_cents > 0 ? `下单成功，优惠 ${yuan(result.discount_cents)}` : '下单成功');
      setBuying(null);
      setCoupon('');
      setQuantity(1);
      await Promise.all([loadShop(), loadWallet()]); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function confirmOrder(id: string) { // 函数 confirmOrder：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 确认收货必须登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.shop.confirm(id); // 异步等待：挂起至 Promise 落定后再继续
      setNotice('已确认收货');
      await loadShop(); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  async function refundOrder(id: string) { // 函数 refundOrder：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 退款申请必须登录
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.shop.refund(id); // 常量 result：保存固定配置或一次性派生值
      setNotice(`已退款 ${yuan(result.refunded_cents)} 到余额`);
      await Promise.all([loadShop(), loadWallet()]); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  /** 提交售后申请：原因 + 说明 + 可选的凭证说明文字，落库后回到「我的售后」查看进度。 */
  async function submitAfterSales() { // 函数 submitAfterSales：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 售后申请必须登录
    if (!asOrder) return; // 未选择订单时不提交
    if (asReason === '其他' && !asDetail.trim()) { // 其他原因必须补充说明
      setError('选择「其他」时请填写问题说明'); // 本地前置校验，避免无效请求
      return; // 提前返回：不发起请求
    } // 代码块结束
    setAsBusy(true); // 提交中：锁住按钮防重复
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.shop.afterSales(asOrder, { // 异步等待：挂起至 Promise 落定后再继续
        kind: asKind, // 售后类型
        reason: asReason, // 申请原因
        detail: asDetail.trim() || undefined, // 问题说明
        evidence: asEvidence.trim() || undefined, // 凭证说明文字
      }); // 调用结束：参数列表与链式调用收尾
      setNotice('售后申请已提交，等待后台处理'); // 成功提示
      setAsOrder(null); // 关闭表单
      setAsDetail(''); // 清空说明
      setAsEvidence(''); // 清空凭证说明
      await loadShop(); // 重新拉取订单与售后列表
    } catch (err) {
      setError(errorText(locale, err)); // 重复提交 / 状态不符等统一走本地化错误
    } finally { // 异常收束：无论成败都执行清理
      setAsBusy(false); // 解锁按钮
    } // 代码块结束
  } // 代码块结束

  async function bindReferral() { // 函数 bindReferral：封装一段可复用的处理逻辑
    if (!requireSession()) return; // 绑定推广码必须登录
    if (!bindCode.trim()) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.referral.bind(bindCode.trim()); // 异步等待：挂起至 Promise 落定后再继续
      setNotice('邀请码绑定成功');
      setBindCode('');
      await loadReferral(); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  const currentBoard = boards.find((b) => b.slug === board); // 常量 currentBoard：保存固定配置或一次性派生值
  /** 当前板块是否可管理栏目（版主 / 创建者）。 */
  const canManageTabs = !!currentBoard?.is_moderator;

  return ( // 返回当前函数的处理结果
    <section className="community-wrap" data-theme-section={newsId ? newsKind : assetRoute ? 'assets' : tab}>{/* 板块色相作用域：随当前栏目切换整套派生色 */}
      {newsId ? (
        // 资讯条目独立详情页：深链接 /community/news/:kind/:id 直接可用
        <ContentDetail locale={locale} kind={newsKind} id={newsId} />
      ) : assetRoute ? (
        // 付费资产：列表与详情匿名可读，购买与「我的资产」在组件内部按登录态引导
        <CommunityAssets locale={locale} hasSession={hasSession} code={assetCode} onRequireLogin={onRequireLogin} />
      ) : (
        <>
      <header className="community-hero">{/* 执行当前业务步骤 */}
        <div>{/* 执行当前业务步骤 */}
          <p className="community-kicker">MIM COMMUNITY</p>
          <h1>Mim 社区</h1>
          <p className="community-sub">在这里发布图文、视频与图集作品，开通付费阅读，逛逛社区商城，和同好一起交流。</p>
        </div>
        <div className="community-hero-side">{/* 执行当前业务步骤 */}
          <div className="community-stat"><span>帖子</span><strong>{stats.threads}</strong></div>
          <div className="community-stat"><span>浏览</span><strong>{stats.views}</strong></div>
          <div className="community-stat"><span>余额</span><strong>{wallet ? yuan(wallet.balance_cents) : '—'}</strong></div>
          <div className="community-stat"><span>积分</span><strong>{wallet?.points ?? 0}</strong></div>
          <div className={`community-vip-chip${vipLevel > 0 ? ' is-on' : ''}`}>{/* 执行当前业务步骤 */}
            {vipLevel > 0 && <img className="community-vip-badge" src={vipBadge(vipLevel)} alt="" aria-hidden="true" loading="lazy" />}
            {vipLevel > 0 ? `VIP ${vipLevel}${vipExpires ? ` · ${dateOnly(vipExpires)}` : ''}` : '未开通 VIP'}
          </div>
        </div>
      </header>

      {(error || notice) && (
        <div className="community-flash">{/* 执行当前业务步骤 */}
          {error && <span className="is-error">{error}</span>}
          {notice && <span>{notice}</span>}
          <button type="button" onClick={() => { setError(null); setNotice(null); }}>关闭</button>
        </div>
      )}

      <nav className="community-tabs" aria-label="社区板块">{/* 八项分两组：内容 / 会员与交易 */}
        {TAB_GROUPS.map((group) => (
          <div key={group.label} className="community-tabs-group">
            <span className="community-tabs-label">{group.label}</span>
            {group.items.map(([key, label]) => (
              <button key={key} type="button" className={tab === key ? 'is-active' : ''} onClick={() => switchTab(key)}>{label}</button>
            ))}
          </div>
        ))}
        {/* 付费资产是深链接视图（列表 / 详情各有地址），不占用页签状态，单独给一个入口 */}
        <div className="community-tabs-group">
          <span className="community-tabs-label">资产</span>
          <button type="button" onClick={() => navigatePath(pathOf('community', 'assets'))}>付费资产</button>
        </div>
      </nav>

      {/* 指南条：每个板块都能直达对应的规则 / 使用说明文章，文章本身落在 community_threads */}
      {!postId && !newsKind && (
        <CommunityGuideBar section={tab} onOpen={(threadId) => { setTab('forum'); void openThread(threadId); }} />
      )}

      {loading && (
        <div className="community-list" role="status" aria-label="正在加载社区数据">
          <ThreadSkeleton />
        </div>
      )}

      {!loading && tab === 'announcements' && (
        <AnnouncementsPanel
          locale={locale}
          hasSession={hasSession}
          initialTab={initialContentTab === 'changelog' ? 'changelog' : initialContentTab === 'feed' ? 'feed' : initialContentTab === 'promotions' ? 'promotions' : 'announcements'}
        />
      )}

      {/* 图库 / 视频各自独立实例（key），筛选状态不串台 */}
      {!loading && (tab === 'images' || tab === 'video') && (
        <CommunityGallery
          key={tab}
          locale={locale}
          kind={tab === 'video' ? 'video' : 'image'}
          hasSession={hasSession}
          boards={boards}
          onOpenThread={(threadId) => { setTab('forum'); void openThread(threadId); }}
          onRequireLogin={() => { if (onRequireLogin) onRequireLogin(); else requireSession(); }}
        />
      )}

      {!loading && tab === 'forum' && (
        <div className="community-forum">{/* 执行当前业务步骤 */}
          {!postId && (
            <>
          <div className="community-main">
          <div className="community-toolbar">{/* 执行当前业务步骤 */}
            <div className="community-chips">{/* 执行当前业务步骤 */}
              <button type="button" className={board === 'all' ? 'is-active' : ''} onClick={() => setBoard('all')}>全部</button>
              {boards.map((b) => (
                <button
                  key={b.slug}
                  type="button" // 赋值：更新变量 type 的取值
                  className={`${board === b.slug ? 'is-active' : ''}${b.price_cents > 0 && !b.joined ? ' is-locked' : ''}`}
                  onClick={() => selectBoard(b)}
                  title={b.price_cents > 0 && !b.joined ? `付费板块：${yuan(b.price_cents)} 加入` : b.visibility === 'followers' && !b.followed ? '关注后可见' : b.description}
                >
                  {b.icon} {b.name} <em>{b.thread_count}</em>
                  {b.price_cents > 0 && <span className="community-board-price">{b.joined ? '已加入' : yuan(b.price_cents)}</span>}
                  {b.visibility === 'followers' && <span className="community-board-price">{b.followed ? '已关注' : '关注可见'}</span>}
                  {b.is_moderator ? <span className="community-board-price">版主</span> : null}
                </button>
              ))}
              <button type="button" className={favoritesOpen ? 'is-active' : ''} onClick={() => { if (!requireSession()) return; setFavoritesOpen((v) => !v); }}>我的收藏</button>
            </div>
            <div className="community-layout-toggle" role="group" aria-label="列表形态切换">{/* 网格 / 列表横排切换 */}
              <button
                type="button"
                className={threadLayout === 'grid' ? 'is-active' : ''}
                aria-pressed={threadLayout === 'grid'}
                onClick={() => switchThreadLayout('grid')}
              >网格</button>
              <button
                type="button"
                className={threadLayout === 'list' ? 'is-active' : ''}
                aria-pressed={threadLayout === 'list'}
                onClick={() => switchThreadLayout('list')}
              >列表</button>
            </div>
            {/* 板块栏目：读后台 Tab 配置，按 order/visible/sort 渲染；版主可切换显隐并保存。接口缺失时回落内置默认 Tab。 */}
            {board !== 'all' && (
              <div className="community-chips board-tabs">{/* 执行当前业务步骤 */}
                {visibleBoardTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button" // 赋值：更新变量 type 的取值
                    className={sort === tab.sort ? 'is-active' : ''}
                    onClick={() => setSort(tab.sort as typeof sort)}
                  >
                    {tab.label}
                  </button>
                ))}
                {canManageTabs && (
                  <>{/* 执行当前业务步骤 */}
                    {boardTabs.map((tab) => (
                      <button
                        key={`eye-${tab.key}`}
                        type="button" // 赋值：更新变量 type 的取值
                        className="board-tab-eye"
                        title={`${tab.visible ? '隐藏' : '显示'} ${tab.label}`}
                        onClick={() => toggleTabVisible(tab.key)}
                      >
                        {tab.visible ? '👁' : '🚫'}
                      </button>
                    ))}
                    <button type="button" className="btn ghost small" disabled={!tabsDirty} onClick={() => void saveBoardTabs()}>{/* 执行当前业务步骤 */}
                      {locale === 'en-US' ? 'Save tabs' : '保存栏目'}
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="community-filters">{/* 执行当前业务步骤 */}
              <select value={kind} onChange={(e) => setKind(e.target.value)}>{/* 执行当前业务步骤 */}
                <option value="all">全部形态</option>
                {(Object.keys(KIND_LABEL) as ThreadKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <button type="button" className={sort === 'latest' ? 'is-active' : ''} onClick={() => setSort('latest')}>最新</button>
              <button type="button" className={sort === 'hot' ? 'is-active' : ''} onClick={() => setSort('hot')}>热门</button>
              <button type="button" className={sort === 'views' ? 'is-active' : ''} onClick={() => setSort('views')}>浏览</button>
              <button type="button" className={sort === 'replies' ? 'is-active' : ''} onClick={() => setSort('replies')}>回帖</button>
              <button type="button" className={sort === 'favorites' ? 'is-active' : ''} onClick={() => setSort('favorites')}>收藏</button>
              <button type="button" className={sort === 'rating' ? 'is-active' : ''} onClick={() => setSort('rating')}>评分</button>
              <button type="button" className={sort === 'recommend' ? 'is-active' : ''} onClick={() => setSort('recommend')}>推荐指数</button>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void loadThreads(); }} placeholder="搜索帖子…" />
              <button type="button" onClick={() => void loadThreads()}>搜索</button>
              <button type="button" className="is-primary" onClick={() => { if (!requireSession()) return; setComposerOpen((v) => !v); }}>发帖</button>
              <button type="button" onClick={() => { if (!requireSession()) return; setBoardOpen((v) => !v); }}>创建板块</button>
              <NotificationBell locale={locale} hasSession={hasSession} onOpenThread={(id) => void openThread(id)} />
              <button type="button" className={searchOpen ? 'is-active' : ''} onClick={() => setSearchOpen((v) => !v)}>全文搜索</button>
              {board !== 'all' && (
                <button type="button" className={moderationOpen ? 'is-active' : ''} onClick={() => { if (!requireSession()) return; setModerationOpen((v) => !v); }}>举报处理</button>
              )}
            </div>
          </div>
          {/* 付费板块页内门禁壳：匿名 / 已登录未加入均停留在 /community，不再整页跳 /signin */}
          {gateBoard && (
            <div className="community-gate-panel" role="dialog" aria-label={`${gateBoard.name} 加入门槛`}>{/* 执行当前业务步骤 */}
              <div className="community-gate-head">{/* 板块名 + 图标 + 价格一行 */}
                <span className="community-gate-icon" aria-hidden="true">{gateBoard.icon}</span>
                <div className="community-gate-title">
                  <strong>{gateBoard.name}</strong>
                  <p>{gateBoard.description}</p>
                </div>
                <em className="community-gate-price">{yuan(gateBoard.price_cents)} · {gateBoard.price_cents} 积分</em>
              </div>
              <ul className="community-gate-conditions">{/* 加入条件与可见内容概述，按登录态分条说明 */}
                {!hasSession && <li>未登录：需先登录账号，登录后回到本页即可加入；未登录不会产生任何扣费。</li>}
                {hasSession && <li>已登录未加入：确认加入将从钱包余额扣除 {yuan(gateBoard.price_cents)}（{gateBoard.price_cents} 积分）。</li>}
                <li>VIP 会员可免加入直接浏览板块内容；普通成员加入后可阅读全部帖子与回复。</li>
                <li>加入后可见该板块 {gateBoard.thread_count} 篇帖子，以及帖内图集 / 视频。</li>
              </ul>
              <div className="community-gate-actions">{/* 主操作按登录态切换；次操作关闭壳、不回跳 */}
                {!hasSession ? (
                  <button type="button" className="is-primary" onClick={gateLoginNext}>登录并加入</button>
                ) : (
                  <button type="button" className="is-primary" disabled={gateBusy} onClick={() => void gateJoin()}>
                    {gateBusy ? '加入中…' : `确认加入（扣 ${yuan(gateBoard.price_cents)} 积分）`}
                  </button>
                )}
                <button type="button" className="btn ghost" onClick={() => setGateBoard(null)}>返回论坛</button>
              </div>
            </div>
          )}
          <CommunityMoreStyles />
          {searchOpen && (
            <SearchPanel locale={locale} board={board} onOpenThread={(id) => { setSearchOpen(false); void openThread(id); }} />
          )}
          {moderationOpen && board !== 'all' && (
            <ModerationPanel
              locale={locale}
              boardSlug={board}
              onNotice={(message) => setNotice(message)}
              onError={(err) => setError(errorText(locale, err))}
            />
          )}

          {boardOpen && (
            <div className="community-composer">{/* 执行当前业务步骤 */}
              <div className="community-form-row">{/* 执行当前业务步骤 */}
                <label>slug{/* 执行当前业务步骤 */}
                  <input value={boardDraft.slug} onChange={(e) => setBoardDraft({ ...boardDraft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="小写字母 / 数字 / 连字符" />
                </label>
                <label>板块名称{/* 执行当前业务步骤 */}
                  <input value={boardDraft.name} onChange={(e) => setBoardDraft({ ...boardDraft, name: e.target.value })} placeholder="例如 摄影圈子" />
                </label>
                <label>可见性{/* 执行当前业务步骤 */}
                  <select value={boardDraft.visibility} onChange={(e) => setBoardDraft({ ...boardDraft, visibility: e.target.value as 'public' | 'followers' })}>{/* 执行当前业务步骤 */}
                    <option value="public">公开</option>
                    <option value="followers">关注后可见</option>
                  </select>
                </label>
                <label>发帖最低等级{/* 执行当前业务步骤 */}
                  <input value={boardDraft.minLevel} onChange={(e) => setBoardDraft({ ...boardDraft, minLevel: e.target.value })} inputMode="numeric" />
                </label>
                <label>加入价格（元）{/* 执行当前业务步骤 */}
                  <input value={boardDraft.price} onChange={(e) => setBoardDraft({ ...boardDraft, price: e.target.value })} inputMode="decimal" />
                </label>
              </div>
              <input value={boardDraft.description} onChange={(e) => setBoardDraft({ ...boardDraft, description: e.target.value })} placeholder="板块说明（可选）" />
              <div className="community-actions">{/* 执行当前业务步骤 */}
                <button type="button" className="is-primary" onClick={() => void createBoard()}>创建</button>
                <button type="button" onClick={() => setBoardOpen(false)}>取消</button>
              </div>
            </div>
          )}

          {!hasSession ? <PageBlocks page="home" hideHero /> : null}{/* 匿名访客首页装修：hero 大卡与顶部聚合头重复，只保留聚合头 */}
          <PageBlocks page="forum" />{/* 论坛页区块：Tab 栏目 / 公告等由后台 page_blocks 组合 */}

          {composerOpen && (
            <div className="community-composer">{/* 执行当前业务步骤 */}
              <div className="community-form-row">{/* 执行当前业务步骤 */}
                <label>板块{/* 执行当前业务步骤 */}
                  <select value={draftBoard} onChange={(e) => setDraftBoard(e.target.value)}>{/* 执行当前业务步骤 */}
                    {boards.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                  </select>
                </label>
                <label>形态{/* 执行当前业务步骤 */}
                  <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as ThreadKind)}>{/* 执行当前业务步骤 */}
                    {(Object.keys(KIND_LABEL) as ThreadKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </label>
                <label>付费价格（元，0 为免费）{/* 执行当前业务步骤 */}
                  <input value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} inputMode="decimal" />
                </label>
              </div>
              <input className="community-title-input" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="标题（4–80 字）" maxLength={80} />
              <input value={draftSummary} onChange={(e) => setDraftSummary(e.target.value)} placeholder="摘要（可选）" maxLength={200} />
              <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} placeholder="正文（至少 10 字）" rows={6} />
              {(draftKind === 'gallery' || draftKind === 'video' || draftKind === 'series') && (
                <textarea
                  value={draftMedia}
                  onChange={(e) => setDraftMedia(e.target.value)}
                  placeholder="媒体地址，每行一个：图集填图片 URL；视频帖填 .mp4/.m3u8 直链（站内路径以 / 开头）"
                  rows={3}
                />
              )}
              {(draftKind === 'gallery' || draftKind === 'video' || draftKind === 'text') && (
                <div className="community-attachment-picker">{/* 媒体位：图片 / 视频走预签名直传，提交对象键与元数据 */}
                  <label className="community-attachment-add">
                    {mediaBusy ? '上传中…' : '+ 添加图片 / 视频'}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      disabled={mediaBusy}
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadDraftMedia(file); e.target.value = ''; }}
                    />
                  </label>
                  <em>单个最大 64MB，最多 12 个；视频会自动读取时长与分辨率，付费帖同样受解锁限制</em>
                </div>
              )}
              {draftUploads.length > 0 && (
                <ul className="community-attachment-draft">
                  {draftUploads.map((item, index) => (
                    <li key={String(item.object_key ?? index)}>
                      <span>{item.kind === 'video' ? '视频' : '图片'}{item.duration_seconds ? ` · ${Math.floor(item.duration_seconds / 60)}:${String(item.duration_seconds % 60).padStart(2, '0')}` : ''}{item.width && item.height ? ` · ${item.width}×${item.height}` : ''}</span>
                      <em>{formatSize(item.size_bytes ?? 0)}</em>
                      {item.kind === 'video' && (
                        <label className="community-attachment-add">
                          {item.poster_key ? '已选封面' : '选封面'}
                          <input
                            type="file"
                            accept="image/*"
                            disabled={mediaBusy}
                            onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadDraftPoster(index, file); e.target.value = ''; }}
                          />
                        </label>
                      )}
                      <button type="button" onClick={() => setDraftUploads((prev) => prev.filter((_, i) => i !== index))}>移除</button>
                    </li>
                  ))}
                </ul>
              )}
              {draftKind === 'poll' && (
                <textarea value={draftPoll} onChange={(e) => setDraftPoll(e.target.value)} placeholder="投票选项，每行一个（2–10 个）" rows={3} />
              )}
              {draftKind === 'series' && (
                <textarea value={draftEpisodes} onChange={(e) => setDraftEpisodes(e.target.value)} placeholder="剧集目录，每行：集标题|视频地址（mp4 / m3u8）" rows={4} />
              )}
              <div className="community-attachment-picker">{/* 附件位：上传后仅展示元数据，下载时服务端按帖子权限签名 */}
                <label className="community-attachment-add">
                  {attachmentBusy ? '上传中…' : '+ 添加附件'}
                  <input
                    type="file"
                    disabled={attachmentBusy}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAttachment(file); e.target.value = ''; }}
                  />
                </label>
                <em>支持文档 / 压缩包等任意文件，单个最大 64MB，最多 6 个</em>
              </div>
              {draftAttachments.length > 0 && (
                <ul className="community-attachment-draft">
                  {draftAttachments.map((item) => (
                    <li key={item.object_key}>
                      <span>{item.name}</span>
                      <em>{formatSize(item.size_bytes)}</em>
                      <button type="button" onClick={() => setDraftAttachments((prev) => prev.filter((x) => x.object_key !== item.object_key))}>移除</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="community-actions">{/* 执行当前业务步骤 */}
                <button type="button" className="is-primary" onClick={() => void createThread()}>发布</button>
                <button type="button" onClick={() => setComposerOpen(false)}>取消</button>
              </div>
            </div>
          )}

          {favoritesOpen && (
            <div className="community-favorites">{/* 执行当前业务步骤 */}
              <div className="community-section-head"><div><h3>我的收藏</h3><p>共 {favorites.length} 篇</p></div></div>
              {favorites.length === 0 && (
                <EmptyState kind="love" title="还没有收藏" hint="详情页点「收藏」即可加入。" />
              )}
              {favorites.map((t) => (
                <button key={t.id} type="button" className="community-favorite-row" onClick={() => void openThread(t.id)}>{/* 执行当前业务步骤 */}
                  <span>{t.board_name}</span>
                  <strong>{t.title}</strong>
                  <em>{dateOnly((t as CommunityThread & { favorited_at?: string }).favorited_at ?? t.last_activity_at)}</em>
                </button>
              ))}
            </div>
          )}

          {threads.length === 0 && listLoading && (
            <div className="community-list" role="status" aria-label="正在加载帖子列表">
              <ThreadSkeleton />
            </div>
          )}
          {threads.length === 0 && !listLoading && listFailed && (
            <EmptyState
              kind="set"
              title="帖子列表加载失败"
              hint="网络或服务暂时不可用，请稍后重试。"
              action={(
                <button type="button" className="btn small" onClick={() => void loadThreads()}>重试</button>
              )}
            />
          )}
          {threads.length === 0 && !listLoading && !listFailed && (
            <EmptyState kind="post" title="这个筛选下还没有帖子" hint="换个板块或排序，也可以发一篇试试。" />
          )}
          {threads.length > 0 && (
            <div className={`community-list${threadLayout === 'list' ? ' is-list' : ' is-grid'}`}>{/* 执行当前业务步骤 */}
              {threads.map((t) => (
              <article key={t.id} className="community-card" onClick={() => void openThread(t.id)}>{/* 执行当前业务步骤 */}
                <div className="community-cover">{/* 执行当前业务步骤 */}
                  {t.cover_url ? (
                    <img src={coverSrc(t.cover_url)} srcSet={coverSrcset(t.cover_url)} alt={t.title} loading="lazy" />
                  ) : (
                    <span>{t.locked ? (t.board_visibility === 'followers' && !t.board_followed ? '关注后可见' : '加入后可见') : KIND_LABEL[t.kind]}</span>
                  )}
                  <em className={`community-kind kind-${t.kind}`}>{KIND_LABEL[t.kind]}</em>
                  {t.price_cents > 0 && <em className="community-price">{yuan(t.price_cents)}</em>}
                </div>
                <div className="community-card-body">{/* 执行当前业务步骤 */}
                  <div className="community-card-meta">{/* 执行当前业务步骤 */}
                    <span className="tag-sm">{t.board_name}</span>
                    <span>{t.author_name || 'Mim 官方'}</span>
                    <span>{dateOnly(t.last_activity_at)}</span>
                  </div>
                  <h3>{isPinned(t) && <span className="community-lock">置顶</span>}{t.title}{t.locked && <span className="community-lock">{t.board_visibility === 'followers' && !t.board_followed ? '关注可见' : '付费'}</span>}</h3>
                  <p>{t.summary || '—'}</p>
                  <div className="community-card-foot">{/* 执行当前业务步骤 */}
                    <span>{t.views} 浏览</span>
                    <span>{t.likes} 赞</span>
                    <span>{t.reply_count} 回复</span>
                    {typeof t.favorite_count === 'number' && <span>{t.favorite_count} 收藏</span>}
                    {t.rating_avg ? <span>{t.rating_avg} 分</span> : null}
                    <span className="community-more">查看 →</span>
                  </div>
                </div>
              </article>
            ))}
            </div>
          )}
          {listTotal > 0 && Math.ceil(listTotal / PAGE_SIZE) > 1 && (() => {
            const totalPages = Math.max(1, Math.ceil(listTotal / PAGE_SIZE)); // 总页数
            return (
              <nav className="community-pager" aria-label="帖子分页">
                <button type="button" disabled={page <= 1 || listBusy} onClick={() => void goPage(page - 1)}>上一页</button>
                {pagerWindow(page, totalPages).map((p, idx) => p === '…' ? (
                  <span key={`ellipsis-${idx}`} className="community-pager-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={p === page ? 'is-active' : ''}
                    aria-current={p === page ? 'page' : undefined}
                    disabled={listBusy}
                    onClick={() => void goPage(p)}
                  >{p}</button>
                ))}
                <button type="button" disabled={page >= totalPages || listBusy} onClick={() => void goPage(page + 1)}>下一页</button>
              </nav>
            );
          })()}
          </div>

          <aside className="community-aside" aria-label="社区挂件">
            <div className="community-widget">
              <div className="community-widget-head"><h3>热门帖</h3></div>
              {hotThreads.length === 0 && <p className="community-widget-empty">暂无热门内容</p>}
              <ol className="community-widget-list">
                {hotThreads.map((t, i) => (
                  <li key={t.id}>
                    <button type="button" className="community-widget-link" onClick={() => void openThread(t.id)}>
                      <em className={`community-widget-rank rank-${i + 1}`}>{i + 1}</em>
                      <span className="community-widget-title">{t.title}</span>
                      <span className="community-widget-meta">{t.views} 浏览 · {t.reply_count} 回复</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <div className="community-widget">
              <div className="community-widget-head"><h3>板块导航</h3></div>
              <ul className="community-widget-list">
                {boards.map((b) => (
                  <li key={b.slug}>
                    <button type="button" className="community-widget-link" onClick={() => selectBoard(b)}>
                      <span className="community-widget-title">{b.icon} {b.name}</span>
                      <span className="community-widget-meta">{b.thread_count} 帖</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="community-widget">
              <div className="community-widget-head"><h3>作者榜</h3></div>
              {authorRank.length === 0 && <p className="community-widget-empty">暂无上榜作者</p>}
              <ol className="community-widget-list">
                {authorRank.map((a, i) => (
                  <li key={`${a.name}-${i}`}>
                    <div className="community-widget-link">
                      <em className={`community-widget-rank rank-${i + 1}`}>{i + 1}</em>
                      <span className="community-widget-title">{a.name}</span>
                      <span className="community-widget-meta">{a.posts} 帖 · 互动 {a.score}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
            </>
          )}

          {selected && postId && (
            <div className="community-detail">{/* 执行当前业务步骤 */}
              <div className="community-detail-head">{/* 执行当前业务步骤 */}
                <div>{/* 执行当前业务步骤 */}
                  <span className="community-card-meta">{selected.thread.board_name} · {KIND_LABEL[selected.thread.kind]} · {selected.thread.author_name || 'Mim 官方'}</span>
                  <h2>{selected.thread.title}</h2>
                  <p>{selected.thread.summary}</p>
                  {selected.thread.board_locked ? <span className="community-lock">板块受限</span> : null}
                </div>
                <button type="button" onClick={closeThread}>← 返回列表</button>
                <button type="button" onClick={() => void copyShareLink()}>复制链接</button>
                {selected.thread.can_moderate && <button type="button" className="is-danger" onClick={() => void deleteThread()}>删除</button>}
                {hasSession && (
                  <ThreadTools
                    locale={locale}
                    thread={selected.thread}
                    isModerator={!!boards.find((item) => item.slug === selected.thread.board_slug)?.is_moderator}
                    onChanged={() => void openThread(selected.thread.id)}
                    onNotice={(message) => setNotice(message)}
                    onError={(err) => setError(errorText(locale, err))}
                  />
                )}
              </div>
              {selected.thread.cover_url && <img className="community-detail-cover" src={coverSrc(selected.thread.cover_url)} srcSet={coverSrcset(selected.thread.cover_url)} alt={selected.thread.title} />}
              <div className="community-author-card">
                <Avatar name={selected.thread.author_name || 'Mim 官方'} size="xl" />
                <div className="community-author-body">
                  <div className="community-author-name">{selected.thread.author_name || 'Mim 官方'}</div>
                  <div className="community-author-stats">
                    <span>{selected.thread.views} 浏览</span>
                    <span>{selected.thread.likes} 赞</span>
                    <span>{selected.thread.reply_count} 回复</span>
                  </div>
                </div>
              </div>
              {selected.unlocked && (selected.thread.media?.length ?? 0) > 0 && (
                <div className="community-media">{/* 执行当前业务步骤 */}
                  {selected.thread.media!.map((item, index) => (
                    <div key={`${item.url}-${index}`} className={`community-media-item is-${item.kind}`}>{/* 执行当前业务步骤 */}
                      {item.kind === 'video' ? (
                        <>
                          <video src={coverSrc(item.url)} poster={item.poster_url ? coverSrc(item.poster_url) : undefined} controls playsInline preload="metadata" />
                          {(item.duration_seconds || (item.width && item.height)) && (
                            <div className="community-media-meta">
                              {item.duration_seconds ? `${Math.floor(item.duration_seconds / 60)}:${String(item.duration_seconds % 60).padStart(2, '0')}` : ''}
                              {item.duration_seconds && item.width && item.height ? ' · ' : ''}
                              {item.width && item.height ? `${item.width}×${item.height}` : ''}
                            </div>
                          )}
                        </>
                      ) : (
                        <img src={coverSrc(item.url)} alt={`${selected.thread.title} ${index + 1}`} loading="lazy" />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!selected.unlocked && selected.thread.board_locked && (selected.thread.board_price_cents ?? 0) > 0 && (
                <div className="community-gate-hint">{/* 锁帖媒体位：页内说明替代空图位 / 破图，不加载任何媒体地址 */}
                  <strong>图集 / 视频加入板块后可见</strong>
                  <p>该板块需加入后查看帖内图集与视频；未加入时不会加载任何媒体地址。</p>
                </div>
              )}
              {(selected.unlocked && (selected.thread.attachments?.length ?? 0) > 0) && (
                <div className="community-attachments">{/* 附件位：与正文同受解锁闸门约束 */}
                  <div className="community-section-head"><div><h3>附件</h3><p>共 {selected.thread.attachments!.length} 个文件</p></div></div>
                  {selected.thread.attachments!.map((item) => (
                    <button key={item.id} type="button" className="community-attachment-row" onClick={() => void downloadAttachment(item.id)}>
                      <span className="community-attachment-name">{item.name}</span>
                      <em>{formatSize(item.size_bytes)}</em>
                      <span className="community-attachment-dl">下载</span>
                    </button>
                  ))}
                </div>
              )}
              {(selected.thread.episodes?.length ?? 0) > 0 && (
                <div className="community-series">{/* 执行当前业务步骤 */}
                  <div className="community-section-head"><div><h3>剧集目录</h3><p>共 {selected.thread.episodes!.length} 集</p></div></div>
                  {selected.thread.episodes!.map((episode, index) => (
                    <div className="community-media-item is-video" key={episode.id}>{/* 执行当前业务步骤 */}
                      <div className="community-card-meta"><span>第 {index + 1} 集</span><span>{episode.title}</span></div>
                      <video src={coverSrc(episode.media_url)} poster={episode.poster_url ? coverSrc(episode.poster_url) : undefined} controls playsInline preload="metadata" />
                    </div>
                  ))}
                </div>
              )}
              {selected.unlocked ? (
                <div className="community-detail-body">{/* 执行当前业务步骤 */}
                  {selected.thread.poll && (
                    <div className="community-poll">{/* 执行当前业务步骤 */}
                      <div className="community-poll-head"><strong>投票</strong><span>{selected.thread.poll.total} 票</span></div>
                      {selected.thread.poll.options.map((option) => {
                        const percent = selected.thread.poll!.total > 0 ? Math.round((option.votes / selected.thread.poll!.total) * 100) : 0; // 常量 percent：保存固定配置或一次性派生值
                        return ( // 返回当前函数的处理结果
                          <button key={option.id} type="button" className={`community-poll-option${option.mine ? ' is-mine' : ''}`} onClick={() => void vote(option.id)}>{/* 执行当前业务步骤 */}
                            <span className="community-poll-bar" style={{ width: `${percent}%` }} />
                            <span className="community-poll-label">{option.label}{option.mine ? ' ✓' : ''}</span>
                            <em>{option.votes} 票 · {percent}%</em>
                          </button>
                        ); // 执行当前业务步骤
                      })}
                    </div>
                  )}
                  <div className="community-detail-article">
                    <RichBody text={selected.thread.body} />
                  </div>
                  <div className="community-detail-engage">{/* 互动面：与正文面拉开一档，工具条与回复同处次级表面 */}
                    <div className="community-detail-actions">{/* 执行当前业务步骤 */}
                      <button type="button" className={selected.liked ? 'is-active' : ''} onClick={() => void toggleLike()}>{/* 执行当前业务步骤 */}
                        {selected.liked ? '已赞' : '点赞'} · {selected.thread.likes}
                      </button>
                      <button type="button" className={selected.favorited ? 'is-active' : ''} onClick={() => void toggleFavorite()}>{/* 执行当前业务步骤 */}
                        {selected.favorited ? '已收藏' : '收藏'}
                      </button>
                      <span className="community-rating">{/* 执行当前业务步骤 */}
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button key={star} type="button" className={(selected.thread.my_rating ?? 0) >= star ? 'is-active' : ''} onClick={() => void rateThread(star)} aria-label={`${star} 星`}>{/* 执行当前业务步骤 */}
                            ★
                          </button>
                        ))}
                        <em>{selected.thread.rating_avg ? `${selected.thread.rating_avg} 分` : '暂无评分'}{selected.thread.rating_count ? ` · ${selected.thread.rating_count} 人` : ''}</em>
                      </span>
                      <span>{selected.thread.views} 浏览</span>
                    </div>
                    <div className="community-replies">{/* 执行当前业务步骤 */}
                      <h4>回复 · {Math.max(postsTotal, selected.posts.length)}</h4>
                      {selected.posts.map((p) => (
                        <ReplyItem
                          key={p.id}
                          locale={locale}
                          post={p}
                          posts={selected.posts}
                          isAccepted={selected.thread.accepted_post_id === p.id}
                          canAccept={selected.thread.kind === 'qa' && getSession()?.user.id === selected.thread.author_id && selected.thread.accepted_post_id !== p.id}
                          canModerate={!!selected.thread.can_moderate}
                          currentUserId={getSession()?.user.id ?? ''}
                          onAccept={() => void acceptPost(p.id)}
                          onReply={(postId, authorName) => { if (!requireSession()) return; setReplyTo(postId); setReplyToName(authorName); }}
                          onDeleted={() => void openThread(selected.thread.id)}
                          onNotice={(message) => setNotice(message)}
                          onError={(err) => setError(errorText(locale, err))}
                        />
                      ))}
                      {postsTotal > selected.posts.length && (
                        <button type="button" className="community-more" onClick={() => void loadMoreReplies()}>加载更多回复（{selected.posts.length}/{postsTotal}）</button>
                      )}
                      {replyLockedOf(selected.thread) ? (
                        <p className="mim-cm-hint">该帖已被锁定，暂不接受新回复。</p>
                      ) : (
                        <div className="community-reply-form">{/* 执行当前业务步骤 */}
                          {replyTo && <div className="mim-cm-quote">正在回复 @{replyToName} <button type="button" onClick={() => { setReplyTo(''); setReplyToName(''); }}>取消</button></div>}
                          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder={replyTo ? `回复 @${replyToName}…` : '写下你的回复…'} />
                          <button type="button" className="is-primary" onClick={() => void submitReply()}>回复</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="community-paywall">{/* 执行当前业务步骤 */}
                  <strong>{selected.thread.board_locked ? (selected.thread.board_visibility === 'followers' && !selected.thread.board_followed ? '该板块关注后可见' : '该板块需要加入后查看') : '这是一篇付费内容'}</strong>
                  <p>{selected.thread.board_locked ? (selected.thread.board_visibility === 'followers' && !selected.thread.board_followed ? '关注板块后可阅读全部帖子与回复。' : '加入板块后可阅读全部帖子与回复；VIP 会员可直接加入。') : '解锁后可阅读全文与全部回复；VIP 会员可直接查看。'}</p>
                  {selected.thread.board_locked ? (
                    selected.thread.board_visibility === 'followers' && !selected.thread.board_followed ? (
                      <button type="button" className="is-primary" onClick={() => void followBoard(selected.thread.board_slug)}>关注板块</button>
                    ) : (
                      <button type="button" className="is-primary" onClick={() => void joinBoard(selected.thread.board_slug)}>{/* 执行当前业务步骤 */}
                        {yuan(selected.thread.board_price_cents ?? 0)} 加入板块
                      </button>
                    ) // 执行当前业务步骤
                  ) : (
                    <button type="button" className="is-primary" onClick={() => void unlockThread(selected.thread.id)}>{/* 执行当前业务步骤 */}
                      {yuan(selected.thread.price_cents)} 解锁
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'vip' && (
        <div className="community-vip">{/* 执行当前业务步骤 */}
          <div className="community-section-head">{/* 执行当前业务步骤 */}
            <div>{/* 执行当前业务步骤 */}
              <h2>VIP 会员</h2>
              <p>付费帖直接查看、积分每月发放、专属徽章与答疑优先级。</p>
            </div>
            {vipLevel > 0 && <span className="community-vip-current">当前 VIP {vipLevel}{vipExpires ? `，到期 ${dateOnly(vipExpires)}` : ''}</span>}
          </div>
          <div className="community-plan-grid">{/* 执行当前业务步骤 */}
            {plans.map((p) => (
              <article key={p.code} className={`community-plan${vipLevel >= p.level ? ' is-current' : ''}`}>{/* 执行当前业务步骤 */}
                <span className="community-plan-level">LV {p.level}</span>
                <h3>{p.name}</h3>
                <strong className="community-plan-price">{yuan(p.price_cents)}<small> / {p.duration_days} 天</small></strong>
                <ul>{p.perks.map((perk) => <li key={perk}>{perk}</li>)}</ul>
                <button type="button" className="is-primary" onClick={() => void subscribe(p.code)}>{vipLevel >= p.level ? '续费' : '开通'}</button>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* 匿名访客：钱包金额不可见，但口径与规则必须可读，避免空白页 */}
      {!loading && tab === 'wallet' && !hasSession && (
        <WalletGuestPanel
          onLogin={() => { if (onRequireLogin) onRequireLogin(); else requireSession(); }}
          onOpenGuide={() => { setTab('forum'); void openThread('thread-guide-wallet'); }}
        />
      )}

      {!loading && tab === 'wallet' && hasSession && wallet && (
        <div className="community-wallet">{/* 执行当前业务步骤 */}
          <div className="community-wallet-cards">{/* 执行当前业务步骤 */}
            <div className="community-wallet-card">{/* 执行当前业务步骤 */}
              <span>可用余额</span>
              <strong>{yuan(wallet.balance_cents)}</strong>
              <small>余额可用于付费帖、VIP 与商城下单</small>
            </div>
            <div className="community-wallet-card">{/* 执行当前业务步骤 */}
              <span>积分</span>
              <strong>{wallet.points}</strong>
              <small>每日签到 +5 积分</small>
            </div>
            <div className="community-wallet-card">{/* 可提现余额：充值余额与分成收益分开算，独立口径 */}
              <span>可提现余额</span>
              <strong>{yuan(withdrawal?.available_cents ?? 0)}</strong>
              <small>
                仅佣金与创作分成可提现，充值余额不可提现
                {withdrawal && withdrawal.reserved_cents > 0 ? `，另有 ${yuan(withdrawal.reserved_cents)} 处理中` : ''}
              </small>
            </div>
          </div>
          <div className="community-wallet-actions">{/* 执行当前业务步骤 */}
            <button type="button" className="is-primary" disabled={walletDetail?.checked_in_today} onClick={() => void checkin()}>{/* 执行当前业务步骤 */}
              {walletDetail?.checked_in_today ? '今天已签到' : '签到领 5 积分'}
            </button>
            <div className="community-inline-form">{/* 执行当前业务步骤 */}
              <input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value)} placeholder="输入充值卡密，如 MIM-DEMO-100" />
              <button type="button" onClick={() => void redeem()}>兑换</button>
            </div>
            <div className="community-inline-form">{/* 执行当前业务步骤 */}
              <input value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="接收方 Mim ID（数字）" />
              <input value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} inputMode="numeric" placeholder="积分" />
              <button type="button" onClick={() => void transferPoints()}>转积分</button>
            </div>
          </div>
          <h3 className="community-subhead">提现</h3>
          <div className="community-inline-form">{/* 提现申请：金额按元输入，提交前换算成整数分 */}
            <input value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} inputMode="decimal" placeholder={`金额（元），最低 ${yuan(withdrawal?.min_withdraw_cents ?? 1000)}`} />
            <select value={wdMethod} onChange={(e) => setWdMethod(e.target.value as WithdrawMethod)}>
              {(withdrawal?.methods ?? [{ value: 'alipay' as WithdrawMethod, label: '支付宝' }]).map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input value={wdName} onChange={(e) => setWdName(e.target.value)} placeholder="收款人姓名" />
            <input value={wdAccount} onChange={(e) => setWdAccount(e.target.value)} placeholder="支付宝 / 微信 / 银行卡号" />
            <button type="button" className="is-primary" disabled={wdBusy} onClick={() => void submitWithdrawal()}>
              {wdBusy ? '提交中…' : '申请提现'}
            </button>
          </div>
          <p className="community-hint">可提现余额只累计佣金与创作分成；充值余额仅用于站内消费，不可提现。同一时间只允许一笔处理中的申请。</p>
          <h3 className="community-subhead">提现记录</h3>
          <div className="community-table">{/* 执行当前业务步骤 */}
            <div className="community-table-head"><span>金额</span><span>方式</span><span>收款账号</span><span>状态</span><span>时间</span></div>
            {(withdrawal?.items ?? []).map((w) => (
              <div key={w.id} className="community-table-row">
                <span>{yuan(w.amount_cents)}</span>
                <span>{WITHDRAW_METHOD[w.method] ?? w.method}</span>
                <span>{maskAccount(w.account_no)}</span>
                <span>
                  {WITHDRAW_STATUS[w.status] ?? w.status}
                  {w.status === 'rejected' && w.review_note ? `：${w.review_note}` : ''}
                  {w.status === 'pending' && (
                    <button type="button" disabled={wdBusy} onClick={() => void revokeWithdrawal(w.id)}>撤销</button>
                  )}
                </span>
                <span>{dateOnly(w.created_at)}</span>
              </div>
            ))}
            {!withdrawal?.items.length && <EmptyState kind="order" title="还没有提现申请" />}
          </div>
          <p className="community-hint">演示卡密：<code>MIM-DEMO-100</code>（¥100）、<code>MIM-DEMO-500</code>（¥500），每张仅可使用一次。</p>
          <div className="community-table">{/* 执行当前业务步骤 */}
            <div className="community-table-head"><span>类型</span><span>金额</span><span>积分</span><span>说明</span><span>时间</span></div>
            {(walletDetail?.transactions ?? []).map((t) => (
              <div key={t.id} className="community-table-row">{/* 执行当前业务步骤 */}
                <span>{TX_KIND[t.kind]}</span>
                <span className={t.amount_cents < 0 ? 'is-down' : t.amount_cents > 0 ? 'is-up' : ''}>{t.amount_cents === 0 ? '—' : yuan(t.amount_cents)}</span>
                <span>{t.points > 0 ? `+${t.points}` : '—'}</span>
                <span>{t.note}</span>
                <span>{dateOnly(t.created_at)}</span>
              </div>
            ))}
            {!walletDetail?.transactions.length && <EmptyState kind="money" title="还没有流水" hint="先签到或用演示卡密充值。" />}
          </div>
        </div>
      )}

      {!loading && tab === 'shop' && (
        <div className="community-shop">{/* 执行当前业务步骤 */}
          <div className="community-section-head">{/* 执行当前业务步骤 */}
            <div><h2>社区商城</h2><p>实物快递、自动发卡密、人工发货三类商品，统一走余额与优惠码。</p></div>
          </div>
          {/* 匿名访客：货架公开，下单与订单需要登录 */}
          {!hasSession && (
            <ShopGuestNote onLogin={() => { if (onRequireLogin) onRequireLogin(); else requireSession(); }} />
          )}
          <div className="community-shop-grid">{/* 执行当前业务步骤 */}
            {products.length === 0 && <EmptyState kind="cart" title="商品正在加载" hint="稍后再看看。" />}
            {products.map((p) => (
              <article key={p.code} className="community-product">{/* 执行当前业务步骤 */}
                {p.cover_url && <img src={coverSrc(p.cover_url)} srcSet={coverSrcset(p.cover_url)} alt={p.name} loading="lazy" />}
                <div className="community-product-body">{/* 执行当前业务步骤 */}
                  <span className={`community-product-kind kind-${p.kind}`}>{PRODUCT_KIND[p.kind]}</span>
                  <h3>{p.name}</h3>
                  <p>{p.summary}</p>
                  <div className="community-product-meta"><strong>{yuan(p.price_cents)}</strong><span>可售 {p.available}</span></div>
                  <small>{p.delivery_note}</small>
                  {buying === p.code ? (
                    <div className="community-buy-form">{/* 执行当前业务步骤 */}
                      <label>数量<input value={quantity} onChange={(e) => setQuantity(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} inputMode="numeric" /></label>
                      <label>优惠码<input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="MIM10 / VIP20" /></label>
                      <small className="community-buy-note">余额 {wallet ? yuan(wallet.balance_cents) : '—'} · 积分 {wallet?.points ?? 0}（社区商城下单不支持积分抵扣，按余额与优惠码结算）</small>
                      {p.kind === 'physical' && (
                        <>{/* 执行当前业务步骤 */}
                          <input value={shipName} onChange={(e) => setShipName(e.target.value)} placeholder="收货人" />
                          <input value={shipPhone} onChange={(e) => setShipPhone(e.target.value)} placeholder="手机号" />
                          <input value={shipAddress} onChange={(e) => setShipAddress(e.target.value)} placeholder="详细地址" />
                        </>
                      )}
                      <div className="community-actions">{/* 执行当前业务步骤 */}
                        <button type="button" className="is-primary" onClick={() => void placeOrder(p)}>确认下单</button>
                        <button type="button" onClick={() => setBuying(null)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="is-primary" disabled={p.available <= 0} onClick={() => { if (!hasSession) { requireSession(); return; } setBuying(p.code); setQuantity(1); }}>{p.available <= 0 ? '已售罄' : hasSession ? '立即购买' : '登录后购买'}</button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {lastOrder && (
            <div className="community-order-result">{/* 执行当前业务步骤 */}
              订单 <code>{lastOrder.order_id.slice(0, 18)}…</code> 已创建，实付 {yuan(lastOrder.payable_cents)}。
              {lastOrder.delivery_kind === 'virtual_auto' ? ' 卡密见下方订单列表。' : ''}
            </div>
          )}
          {/* 订单与售后是私密数据，匿名只保留公开货架 */}
          {hasSession && (
            <>
          <h3 className="community-subhead">我的订单</h3>
          <div className="community-orders">{/* 执行当前业务步骤 */}
            {orders.length === 0 && <EmptyState kind="order" title="还没有订单" />}
            {orders.map((o) => (
              <article key={o.id} className="community-order">{/* 执行当前业务步骤 */}
                <div className="community-order-main">{/* 执行当前业务步骤 */}
                  <strong>{o.items[0]?.title ?? o.product_code ?? o.id}</strong>
                  <span>{ORDER_STATUS[o.status] ?? o.status} · {o.delivery_kind ?? ''} · {dateOnly(o.created_at)}</span>
                  <span>原价 {yuan(o.total_cents)}，优惠 {yuan(o.discount_cents)}，实付 {yuan(o.payable_cents)}</span>
                  {o.after_sales_status && <span>售后：{AFTER_SALES_STATUS[o.after_sales_status] ?? o.after_sales_status}</span>}
                  {o.delivered_content && <code>{o.delivered_content}</code>}
                </div>
                <div className="community-order-actions">{/* 执行当前业务步骤 */}
                  {o.status === 'paid' && <button type="button" onClick={() => void confirmOrder(o.source_id)}>确认收货</button>}
                  {(o.status === 'paid' || o.status === 'delivered') && (
                    <button type="button" onClick={() => { if (!requireSession()) return; setAsOrder(asOrder === o.source_id ? null : o.source_id); setNotice(null); }}>申请售后</button>
                  )}
                  {o.status !== 'refunded' && o.status !== 'cancelled' && <button type="button" onClick={() => void refundOrder(o.source_id)}>退款</button>}
                </div>
                {asOrder === o.source_id && (
                  <div className="community-buy-form">
                    <label>售后类型
                      <select value={asKind} onChange={(e) => setAsKind(e.target.value as 'refund_only' | 'return_refund' | 'repair')}>
                        <option value="refund_only">仅退款</option>
                        <option value="return_refund">退货退款</option>
                        <option value="repair">维修</option>
                      </select>
                    </label>
                    <label>申请原因
                      <select value={asReason} onChange={(e) => setAsReason(e.target.value)}>
                        {AFTER_SALES_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                      </select>
                    </label>
                    <label>问题说明
                      <textarea value={asDetail} maxLength={300} placeholder="描述遇到的问题，便于后台核实" onChange={(e) => setAsDetail(e.target.value)} />
                    </label>
                    <label>凭证说明（选填）
                      <input value={asEvidence} maxLength={300} placeholder="例如：已拍摄外包装破损照片，可联系客服提供" onChange={(e) => setAsEvidence(e.target.value)} />
                    </label>
                    <small className="community-buy-note">提交后由后台审批；同一订单同类型申请在处理完成前不能重复提交。</small>
                    <div className="community-actions">
                      <button type="button" className="is-primary" disabled={asBusy} onClick={() => void submitAfterSales()}>{asBusy ? '提交中…' : '提交申请'}</button>
                      <button type="button" onClick={() => { setAsOrder(null); setAsDetail(''); setAsEvidence(''); }}>取消</button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>

          <h3 className="community-subhead">我的售后</h3>
          <div className="community-orders">
            {afterSales.length === 0 && <EmptyState kind="order" title="还没有售后申请" />}
            {afterSales.map((a) => (
              <article key={a.id} className="community-order">
                <div className="community-order-main">
                  <strong>{a.product_name ?? a.order_id}</strong>
                  <span>{AFTER_SALES_KIND[a.kind] ?? a.kind} · {AFTER_SALES_STATUS[a.status] ?? a.status} · {dateOnly(a.created_at)}</span>
                  <span>申请内容：{a.reason}</span>
                  {a.admin_note && <span>处理结果：{a.admin_note}{a.handled_at ? `（${dateOnly(a.handled_at)}）` : ''}</span>}
                </div>
              </article>
            ))}
          </div>
            </>
          )}
        </div>
      )}

      {!loading && tab === 'referral' && !hasSession && (
        <ReferralGuestPanel
          onLogin={() => { if (onRequireLogin) onRequireLogin(); else requireSession(); }}
          onOpenGuide={() => { setTab('forum'); void openThread('thread-guide-referral'); }}
        />
      )}

      {!loading && tab === 'referral' && hasSession && (
        <div className="community-referral">{/* 执行当前业务步骤 */}
          <div className="community-section-head"><div><h2>推广分成</h2><p>邀请码绑定后，被邀请人首单按实付 5% 返到你的余额。</p></div></div>
          <div className="community-referral-grid">{/* 执行当前业务步骤 */}
            <div className="community-ref-card">{/* 执行当前业务步骤 */}
              <span>我的邀请码</span>
              <strong>{referral?.code ?? '—'}</strong>
              <button type="button" onClick={() => { if (referral) void navigator.clipboard?.writeText(referral.code); setNotice('邀请码已复制'); }}>复制</button>
            </div>
            <div className="community-ref-card"><span>已邀请</span><strong>{referral?.invited.count ?? 0} 人</strong></div>
            <div className="community-ref-card"><span>累计佣金</span><strong>{yuan(referral?.commission_cents ?? 0)}</strong></div>
          </div>
          <div className="community-inline-form">{/* 执行当前业务步骤 */}
            <input value={bindCode} onChange={(e) => setBindCode(e.target.value)} placeholder="输入朋友的邀请码" />
            <button type="button" onClick={() => void bindReferral()}>绑定邀请码</button>
          </div>
          <p className="community-hint">当前板块：{currentBoard?.name ?? '全部'}。推广绑定仅一次，不能绑定自己的邀请码。</p>
        </div>
      )}
        </>
      )}
    </section>
  ); // 执行当前业务步骤
} // 代码块结束
