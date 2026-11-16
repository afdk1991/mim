/**
 * 八大板块的公共指南入口与匿名访客面板。
 *
 * 设计取舍：
 * 1. 指南正文不放在前端，而是落在社区帖子体系（board-guides），这里只提供固定 threadId 的入口，
 *    保证文章能被搜索、能按发布时间展示，也避免另造一套 CMS 或富文本。
 * 2. 匿名面板复用社区现有的卡片类（community-wallet / community-ref-card 等），
 *    不引入第三方 UI 库，也不新增一套视觉语言。
 * 3. 示例内容与真实内容靠帖子标题的【示例】前缀区分，面板内再次说明，避免被误认为真实成交数据。
 */

/** 与社区页签一一对应的板块键，供指南条选择文章 */
export type CommunitySectionKey =
  | 'forum'
  | 'images'
  | 'video'
  | 'announcements'
  | 'vip'
  | 'wallet'
  | 'shop'
  | 'referral';

/** 每个板块对应的指南文章：threadId 与后端种子中的固定主键一致 */
const SECTION_GUIDES: Record<CommunitySectionKey, { threadId: string; title: string; summary: string }> = {
  forum: {
    threadId: 'thread-guide-forum',
    title: '论坛使用指南：发帖、提问与互动规则',
    summary: '板块说明、发帖步骤、提问采纳与举报口径。',
  },
  images: {
    threadId: 'thread-guide-gallery',
    title: '图库使用指南：浏览、检索、收藏与上传',
    summary: '聚合方式、筛选、收藏条件与上传格式。',
  },
  video: {
    threadId: 'thread-guide-video',
    title: '视频使用指南：播放、上传与付费可见性',
    summary: '播放、上传要求与付费帖的可见范围。',
  },
  announcements: {
    threadId: 'thread-guide-announce',
    title: '公告动态使用指南：公告、更新日志与推广计划',
    summary: '四类信息的区别、置顶有效期与历史查询。',
  },
  vip: {
    threadId: 'thread-guide-vip',
    title: 'VIP 会员权益与开通说明',
    summary: '三档权益、续费口径、积分发放与到期处理。',
  },
  wallet: {
    threadId: 'thread-guide-wallet',
    title: '钱包、积分与提现规则',
    summary: '余额与积分口径、充值卡兑换、转积分与提现门槛。',
  },
  shop: {
    threadId: 'thread-guide-shop',
    title: '社区商城下单、发货与售后指引',
    summary: '三类商品、结算顺序、卡密查看与售后流程。',
  },
  referral: {
    threadId: 'thread-guide-referral',
    title: '推广分成规则与结算说明',
    summary: '邀请码绑定、返佣比例、结算与禁止行为。',
  },
};

/** 指南条：八个页签共用，只换当前板块对应的文章入口 */
export function CommunityGuideBar(props: {
  section: CommunitySectionKey; // 当前页签
  onOpen: (threadId: string) => void; // 打开指南文章（复用帖子详情深链接）
}) {
  const guide = SECTION_GUIDES[props.section]; // 取当前板块对应的指南
  return (
    <section className="community-guide-bar" aria-label="板块使用指南">
      <div className="community-guide-copy">
        <span className="community-guide-tag">使用指南</span>
        <strong>{guide.title}</strong>
        <small>{guide.summary}</small>
      </div>
      <button type="button" className="community-guide-open" onClick={() => props.onOpen(guide.threadId)}>
        阅读全文
      </button>
    </section>
  ); // 指南条结束
} // CommunityGuideBar 结束

/** 匿名访客看到的钱包说明：只展示口径与规则，不伪造余额 */
export function WalletGuestPanel(props: {
  onLogin: () => void; // 触发登录
  onOpenGuide: () => void; // 打开钱包规则文章
}) {
  return (
    <div className="community-wallet">
      <div className="community-wallet-cards">
        <div className="community-wallet-card">
          <span>可用余额</span>
          <strong>登录后可见</strong>
          <small>用于付费帖、VIP 与社区商城下单</small>
        </div>
        <div className="community-wallet-card">
          <span>积分</span>
          <strong>登录后可见</strong>
          <small>每日签到 +5 积分</small>
        </div>
        <div className="community-wallet-card">
          <span>可提现余额</span>
          <strong>登录后可见</strong>
          <small>仅佣金与创作分成可提现，充值余额不可提现</small>
        </div>
      </div>
      <div className="community-wallet-actions">
        <button type="button" className="is-primary" onClick={props.onLogin}>登录查看我的钱包</button>
        <button type="button" onClick={props.onOpenGuide}>阅读钱包规则</button>
      </div>
      <h3 className="community-subhead">规则速览</h3>
      <ul className="community-guest-rules">
        <li>余额、积分、可提现余额是三个独立口径，互不混用。</li>
        <li>充值卡一卡一次；演示卡密 MIM-DEMO-100 与 MIM-DEMO-500 仅用于功能演示。</li>
        <li>转积分需要填写接收方 Mim ID，提交后不可撤回。</li>
        <li>提现只针对佣金与创作分成，同一时间只允许一笔处理中的申请。</li>
      </ul>
    </div>
  ); // 匿名钱包面板结束
} // WalletGuestPanel 结束

/** 匿名访客看到的推广分成说明：规则公开，数据留到登录后 */
export function ReferralGuestPanel(props: {
  onLogin: () => void; // 触发登录
  onOpenGuide: () => void; // 打开推广分成规则文章
}) {
  return (
    <div className="community-referral">
      <div className="community-section-head">
        <div>
          <h2>推广分成</h2>
          <p>邀请码绑定后，被邀请人首单按实付 5% 返到你的可提现余额。</p>
        </div>
      </div>
      <div className="community-referral-grid">
        <div className="community-ref-card">
          <span>我的邀请码</span>
          <strong>登录后可见</strong>
          <small>登录后可复制并分享给朋友</small>
        </div>
        <div className="community-ref-card">
          <span>已邀请</span>
          <strong>登录后可见</strong>
        </div>
        <div className="community-ref-card">
          <span>累计佣金</span>
          <strong>登录后可见</strong>
        </div>
      </div>
      <div className="community-wallet-actions">
        <button type="button" className="is-primary" onClick={props.onLogin}>登录查看我的推广数据</button>
        <button type="button" onClick={props.onOpenGuide}>阅读分成规则</button>
      </div>
      <h3 className="community-subhead">规则速览</h3>
      <ul className="community-guest-rules">
        <li>新用户只能绑定一次邀请码，不能绑定自己的邀请码。</li>
        <li>佣金在订单完成且过售后周期后入账，进入可提现余额。</li>
        <li>自邀、虚假交易、批量注册与诱导下单会被取消佣金并限制账号。</li>
      </ul>
    </div>
  ); // 匿名推广面板结束
} // ReferralGuestPanel 结束

/** 商城匿名提示：商品目录公开，下单与订单需要登录 */
export function ShopGuestNote(props: { onLogin: () => void }) {
  return (
    <div className="community-guide-bar" role="note">
      <div className="community-guide-copy">
        <span className="community-guide-tag">灰度演示</span>
        <strong>商品目录可匿名浏览，下单需要登录</strong>
        <small>当前商品与卡密为灰度期演示数据，会标注为示例，不作为真实成交记录。</small>
      </div>
      <button type="button" className="community-guide-open" onClick={props.onLogin}>登录后购买</button>
    </div>
  ); // 商城匿名提示结束
} // ShopGuestNote 结束
