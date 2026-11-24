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
  // 论坛页签：帖子列表与互动
  | 'forum'
  // 图库页签：图片聚合与收藏
  | 'images'
  // 视频页签：视频播放与上传
  | 'video'
  // 公告动态页签：公告 / 日志 / 推广
  | 'announcements'
  // VIP 页签：会员权益与开通
  | 'vip'
  // 钱包页签：余额 / 积分 / 提现
  | 'wallet'
  // 商城页签：商品下单与售后
  | 'shop'
  // 推广页签：邀请码与返佣
  | 'referral';

/** 每个板块对应的指南文章：threadId 与后端种子中的固定主键一致 */
const SECTION_GUIDES: Record<CommunitySectionKey, { threadId: string; title: string; summary: string }> = {
  // 论坛板块指南：发帖、提问与互动规则
  forum: {
    threadId: 'thread-guide-forum', // 指南帖子固定主键
    title: '论坛使用指南：发帖、提问与互动规则', // 指南标题，展示在指南条
    summary: '板块说明、发帖步骤、提问采纳与举报口径。', // 指南摘要，展示在标题下方
  },
  // 图库板块指南：浏览、检索、收藏与上传
  images: {
    threadId: 'thread-guide-gallery', // 指南帖子固定主键
    title: '图库使用指南：浏览、检索、收藏与上传', // 指南标题，展示在指南条
    summary: '聚合方式、筛选、收藏条件与上传格式。', // 指南摘要，展示在标题下方
  },
  // 视频板块指南：播放、上传与付费可见性
  video: {
    threadId: 'thread-guide-video', // 指南帖子固定主键
    title: '视频使用指南：播放、上传与付费可见性', // 指南标题，展示在指南条
    summary: '播放、上传要求与付费帖的可见范围。', // 指南摘要，展示在标题下方
  },
  // 公告动态板块指南：公告、日志与推广计划
  announcements: {
    threadId: 'thread-guide-announce', // 指南帖子固定主键
    title: '公告动态使用指南：公告、更新日志与推广计划', // 指南标题，展示在指南条
    summary: '四类信息的区别、置顶有效期与历史查询。', // 指南摘要，展示在标题下方
  },
  // VIP 板块指南：三档权益与开通说明
  vip: {
    threadId: 'thread-guide-vip', // 指南帖子固定主键
    title: 'VIP 会员权益与开通说明', // 指南标题，展示在指南条
    summary: '三档权益、续费口径、积分发放与到期处理。', // 指南摘要，展示在标题下方
  },
  // 钱包板块指南：余额、积分与提现规则
  wallet: {
    threadId: 'thread-guide-wallet', // 指南帖子固定主键
    title: '钱包、积分与提现规则', // 指南标题，展示在指南条
    summary: '余额与积分口径、充值卡兑换、转积分与提现门槛。', // 指南摘要，展示在标题下方
  },
  // 商城板块指南：下单、发货与售后指引
  shop: {
    threadId: 'thread-guide-shop', // 指南帖子固定主键
    title: '社区商城下单、发货与售后指引', // 指南标题，展示在指南条
    summary: '三类商品、结算顺序、卡密查看与售后流程。', // 指南摘要，展示在标题下方
  },
  // 推广板块指南：邀请码绑定与返佣规则
  referral: {
    threadId: 'thread-guide-referral', // 指南帖子固定主键
    title: '推广分成规则与结算说明', // 指南标题，展示在指南条
    summary: '邀请码绑定、返佣比例、结算与禁止行为。', // 指南摘要，展示在标题下方
  },
};

/** 指南条：八个页签共用，只换当前板块对应的文章入口 */
export function CommunityGuideBar(props: {
  section: CommunitySectionKey; // 当前页签
  onOpen: (threadId: string) => void; // 打开指南文章（复用帖子详情深链接）
}) {
  // 按当前板块键取出对应指南文章的入口信息
  const guide = SECTION_GUIDES[props.section]; // 取当前板块对应的指南
  return (
    <section className="community-guide-bar" aria-label="板块使用指南">
      {/* 指南文案区：标签 + 标题 + 摘要 */}
      <div className="community-guide-copy">
        <span className="community-guide-tag">使用指南</span>
        <strong>{guide.title}</strong>
        <small>{guide.summary}</small>
      </div>
      {/* 打开全文按钮：回调把 threadId 交给上层跳帖子详情 */}
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
      {/* 三张口径卡片：余额 / 积分 / 可提现余额，匿名态统一提示登录后可见 */}
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
      {/* 操作区：登录查看钱包 / 阅读规则文章 */}
      <div className="community-wallet-actions">
        <button type="button" className="is-primary" onClick={props.onLogin}>登录查看我的钱包</button>
        <button type="button" onClick={props.onOpenGuide}>阅读钱包规则</button>
      </div>
      {/* 规则速览标题 */}
      <h3 className="community-subhead">规则速览</h3>
      {/* 规则条目列表：公开口径，不涉及个人数据 */}
      <ul className="community-guest-rules">
        <li>余额、积分、可提现余额是三个独立口径，互不混用。</li>
        <li>充值卡一卡一次，由运营发放；兑换成功后余额立即到账。</li>{/* 不点名演示卡密：避免在公开页面给出可直接领取余额的编号 */}
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
      {/* 板块头：标题与返佣口径一句话说明 */}
      <div className="community-section-head">
        <div>
          <h2>推广分成</h2>
          <p>邀请码绑定后，被邀请人首单按实付 5% 返到你的可提现余额。</p>
        </div>
      </div>
      {/* 推广数据卡片：邀请码 / 已邀请 / 累计佣金，匿名态登录后可见 */}
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
      {/* 操作区：登录查看推广数据 / 阅读分成规则 */}
      <div className="community-wallet-actions">
        <button type="button" className="is-primary" onClick={props.onLogin}>登录查看我的推广数据</button>
        <button type="button" onClick={props.onOpenGuide}>阅读分成规则</button>
      </div>
      {/* 规则速览标题 */}
      <h3 className="community-subhead">规则速览</h3>
      {/* 规则条目列表：绑定限制、入账条件与违规处置 */}
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
      {/* 提示文案区：灰度标签 + 标题 + 演示数据说明 */}
      <div className="community-guide-copy">
        <span className="community-guide-tag">灰度演示</span>
        <strong>商品目录可匿名浏览，下单需要登录</strong>
        <small>当前商品与卡密为灰度期演示数据，会标注为示例，不作为真实成交记录。</small>
      </div>
      {/* 登录购买按钮：回调触发登录流程 */}
      <button type="button" className="community-guide-open" onClick={props.onLogin}>登录后购买</button>
    </div>
  ); // 商城匿名提示结束
} // ShopGuestNote 结束
