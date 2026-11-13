/**
 * 版本迭代页：把 V0.0.0 → 当前版本的时间线、递增提交与主要变化放到前台可见。
 * 数据来源是仓库 package.json 的递增提交与线上 /health 取证；页面不请求接口，避免历史版本依赖后端种子。
 * 同时提供「能力地图」，把知识付费 / 商城 / 资金 / 论坛 / 圈子 / 用户 / 搜索 / 工具等入口集中到一页。
 */

import type { Locale } from '@mim/i18n'; // 语言类型
import type { AppView } from '../router'; // 视图标识：能力地图跳转用
import { APP_VERSION } from '../version'; // 当前 semver：由构建期 package.json 注入

interface Props { // 视图参数
  locale: Locale; // 当前界面语言
  onOpen: (view: AppView) => void; // 统一跳转：由 App 注入，避免页面直接改地址栏
} // 代码块结束

interface ReleaseItem { // 单个版本记录
  version: string; // 语义版本号
  date: string; // 递增提交日期
  commit: string; // 递增提交短哈希
  titleZh: string; // 中文标题
  titleEn: string; // 英文标题
  stateZh: string; // 中文线上状态
  stateEn: string; // 英文线上状态
  changesZh: string[]; // 中文主要变化
  changesEn: string[]; // 英文主要变化
} // 代码块结束

interface CapabilityItem { // 能力地图条目
  labelZh: string; // 中文能力名
  labelEn: string; // 英文能力名
  descZh: string; // 中文说明
  descEn: string; // 英文说明
  view: AppView; // 对应前台视图
} // 代码块结束

// 版本时间线：按 package.json 的递增提交还原，0.0.0 阶段包含早期长期累积的功能。
const RELEASES: ReleaseItem[] = [
  {
    version: 'V0.0.0',
    date: '2026-11-03',
    commit: '2a4891d',
    titleZh: '项目初始化与早期能力累积',
    titleEn: 'Initial repository and early capability accumulation',
    stateZh: '基础版本',
    stateEn: 'Base version',
    changesZh: [
      '初始化 docs / scripts / site / 构建脚本。',
      'RBAC、管理后台、商城付费闭环、成片导出、部署汇总、站点矩阵、统一入口等大量能力都在 0.0.0 阶段累积。',
      '这一阶段没有逐功能升 semver，0.0.1 才是第一次真正递增。',
    ],
    changesEn: [
      'Initialized docs, scripts, site and build tooling.',
      'RBAC, admin console, marketplace checkout, film export, deployment summary, site matrix and entry catalog accumulated under 0.0.0.',
      'Semver was not bumped per feature in this phase; 0.0.1 was the first real increment.',
    ],
  },
  {
    version: 'V0.0.1',
    date: '2026-11-12',
    commit: 'fc5b3a0',
    titleZh: '漫剧 / AI 剧放映厅',
    titleEn: 'Comic / AI drama theater',
    stateZh: '首次 semver 递增',
    stateEn: 'First semver increment',
    changesZh: [
      '新增匿名看片与登录后「我的作品」播放。',
      '支持集数切换与断点续播。',
    ],
    changesEn: [
      'Anonymous watching plus “My Works” playback after sign-in.',
      'Episode switching and resume playback.',
    ],
  },
  {
    version: 'V0.0.2',
    date: '2026-11-12',
    commit: 'd258f41',
    titleZh: '统一入口落地状态四态对齐',
    titleEn: 'Entry catalog implementation states',
    stateZh: '快速迭代',
    stateEn: 'Fast iteration',
    changesZh: [
      '把统一入口标注为已落地 / 部分相邻 / 规划中 / 语义冲突四态。',
      '前端入口目录展示落地徽标、已落地功能清单与边界说明。',
    ],
    changesEn: [
      'Classified entries as implemented / adjacent / planned / semantic conflict.',
      'Entry catalog now shows implementation badges, real feature lists and boundaries.',
    ],
  },
  {
    version: 'V0.0.3',
    date: '2026-11-12',
    commit: '7e1e87c',
    titleZh: '导航站业务模块',
    titleEn: 'Navigation module',
    stateZh: '快速迭代',
    stateEn: 'Fast iteration',
    changesZh: [
      '从目录条目升级为真实业务模块：链接目录、服务端可达性探测、失效标记、推荐位、检索。',
      '新增 nav_links 表与 6 个导航端点。',
    ],
    changesEn: [
      'Upgraded from a directory entry to a real module: link catalog, server-side reachability probe, broken-link flags, recommendations and search.',
      'Added the nav_links table and six navigation endpoints.',
    ],
  },
  {
    version: 'V0.0.4',
    date: '2026-11-12',
    commit: '2bee64f',
    titleZh: '统一搜索上线',
    titleEn: 'Unified search',
    stateZh: '线上曾实测 0.0.4',
    stateEn: 'Observed online as 0.0.4',
    changesZh: [
      '五来源聚合：模块 / 入口 / 导航 / 社区 / 商城。',
      'Meilisearch 未配置时自动降级 SQLite。',
      '验证 28 文件 / 398 例全过。',
    ],
    changesEn: [
      'Five sources: modules, entries, navigation, community and marketplace.',
      'Automatic SQLite fallback when Meilisearch is not configured.',
      'Verified with 28 files / 398 tests.',
    ],
  },
  {
    version: 'V0.0.5',
    date: '2026-11-12',
    commit: 'e9c4cae',
    titleZh: '商业化二期',
    titleEn: 'Commerce phase two',
    stateZh: '线上曾实测 0.0.5',
    stateEn: 'Observed online as 0.0.5',
    changesZh: [
      '16 张商业化表：付费阅读 / 下载 / 图库 / 视频四类资产。',
      '支付意图与支付宝当面付 / 微信 Native / 人工 / 沙箱适配。',
      '发货物流售后评价、提现与创作分成、主题 / 页面区块、成长徽章私信、百度翻译。',
      '验证 29 文件 / 407 例全过。',
    ],
    changesEn: [
      'Sixteen commerce tables and four paid asset kinds: article, download, gallery and video.',
      'Payment intents with Alipay, WeChat Native, manual and sandbox adapters.',
      'Shipping, after-sales, reviews, withdrawals, creator earnings, theme/page blocks, badges, DMs and Baidu translation.',
      'Verified with 29 files / 407 tests.',
    ],
  },
  {
    version: 'V0.0.6',
    date: '2026-11-12',
    commit: '9b66978',
    titleZh: 'Mim ID 纯数字号与物流查询',
    titleEn: 'Numeric Mim ID and logistics',
    stateZh: '线上曾实测 0.0.6',
    stateEn: 'Observed online as 0.0.6',
    changesZh: [
      'Mim ID 改为 QQ 号样式纯数字号，存量全量重排并预留靓号。',
      '同版本追加快递100 可选实时轨迹 `74e78c0`，未配置回退本地轨迹。',
      '验证 31 文件 / 426 例全过。',
    ],
    changesEn: [
      'Mim ID changed to numeric QQ-style IDs; existing users renumbered and premium IDs reserved.',
      'Same version added optional Kuaidi100 live tracking via 74e78c0, falling back to local tracks.',
      'Verified with 31 files / 426 tests.',
    ],
  },
  {
    version: 'V0.0.7',
    date: '2026-11-13',
    commit: '3e74334',
    titleZh: 'Mim ID 靓号规则二次收紧',
    titleEn: 'Mim ID premium rules tightened',
    stateZh: '线上有 0.0.7 取证',
    stateEn: 'Online evidence for 0.0.7',
    changesZh: [
      '1–99 整段预留，发号起点改为 102。',
      '新增重复段、阶梯对子、经典号三类判定，靓号由 7 类扩为 11 类。',
      '重排开关升级为 renumber_v2，部署后再重排一次。',
    ],
    changesEn: [
      'Reserved the entire 1–99 range; issuing now starts at 102.',
      'Added repeated blocks, staircase pairs and iconic numbers; premium classes grew from 7 to 11.',
      'Renumber switch upgraded to renumber_v2, causing one more renumber on deploy.',
    ],
  },
  {
    version: 'V0.0.8',
    date: '2026-11-13',
    commit: '6dec1c4',
    titleZh: 'P1 社区闭环与付费资产前台',
    titleEn: 'P1 community closure and paid asset frontend',
    stateZh: '生产 run 43260913823 取证',
    stateEn: 'Production run 43260913823',
    changesZh: [
      '付费图库 / 视频前台渲染。',
      'page_blocks 公共区块与论坛板块权限闭环。',
      '配套文档 5df4622 记录生产上线取证。',
    ],
    changesEn: [
      'Paid gallery and video rendering on the frontend.',
      'page_blocks public blocks and forum board permission closure.',
      'Documentation commit 5df4622 recorded production evidence.',
    ],
  },
  {
    version: 'V0.0.9',
    date: '2026-11-13',
    commit: '0dd2b9d',
    titleZh: 'P2 主体接入',
    titleEn: 'P2 main application integration',
    stateZh: '线上实测 0.0.9',
    stateEn: 'Observed online as 0.0.9',
    changesZh: [
      '商城资金、支付通道、邀请码、实名认证、跨站 SSO、内容运营、安全加固接入主应用。',
      '前端入口由 31f5050 接通；验收文档 9eddf0c；后续 9adf6d3 补 P2 前台入口与线上取证。',
      '验证 50 文件 / 601 例全过；CI run 43269427136 五作业全绿。',
    ],
    changesEn: [
      'Marketplace funds, payment channels, invitations, real-name verification, cross-site SSO, content operations and security hardening integrated into the main app.',
      'Frontend entries connected by 31f5050; acceptance doc 9eddf0c; 9adf6d3 added P2 UI and online evidence.',
      'Verified with 50 files / 601 tests; CI run 43269427136 all five jobs green.',
    ],
  },
  {
    version: 'V0.0.10',
    date: '2026-11-13',
    commit: '7e6dbf6',
    titleZh: '全项目缺口收口与当前线上版本',
    titleEn: 'Project-wide gap closure and current release',
    stateZh: '当前线上 0.0.10',
    stateEn: 'Current online 0.0.10',
    changesZh: [
      '六个包统一升至 0.0.10；补齐独立圈子、商城积分抵扣、可执行自研工具、CDN 回源契约、验证码强制、内容权限点、SSRF 与 Redis 修复。',
      'c1a44de 合并远端后触发生产 P0：存量库缺 announcements.published_at 导致 API 全量 502；f9769e0 补列并兼容新库时序后恢复。',
      '新增 test/upgrade-path.test.ts 覆盖老库升级与二次幂等；当前 56 文件 / 667+ 例全过，CI 43421667478 四作业 success。',
    ],
    changesEn: [
      'All six packages bumped to 0.0.10; independent circles, marketplace points deduction, executable tools, CDN contract, enforced captcha, content permission, SSRF and Redis fixes.',
      'c1a44de triggered a production P0 after merging: legacy databases lacked announcements.published_at, causing API-wide 502. f9769e0 added the column and fixed new-database ordering.',
      'Added test/upgrade-path.test.ts for legacy upgrade and idempotent re-open; currently 56 files / 667+ tests pass, CI 43421667478 four jobs success.',
    ],
  },
]; // 版本时间线结束

// 能力地图：把用户要求的模块收敛到可直接打开的现有前台视图，避免“代码有、入口找不到”。
const CAPABILITIES: CapabilityItem[] = [
  { labelZh: '知识付费四件套', labelEn: 'Paid content suite', descZh: '付费阅读 / 下载 / 图库 / 视频与未购隐藏', descEn: 'Paid articles, downloads, galleries and videos', view: 'community' },
  { labelZh: '独立商城', labelEn: 'Marketplace', descZh: '实物快递、自动发货、手动发货、购物车与订单', descEn: 'Physical goods, auto/manual delivery, cart and orders', view: 'store' },
  { labelZh: '营销与资金', labelEn: 'Marketing & funds', descZh: '优惠码、批量改价、VIP、余额、积分、卡密、返佣、分成', descEn: 'Coupons, bulk pricing, VIP, wallet, points, cards, referrals and revenue share', view: 'community' },
  { labelZh: '交易链路', labelEn: 'Payment & fulfillment', descZh: '支付渠道、物流、售后退款退货评价', descEn: 'Payment channels, logistics, after-sales and reviews', view: 'commerce' },
  { labelZh: '论坛', labelEn: 'Forum', descZh: '板块、付费加入、帖子形态、排序与板块权限', descEn: 'Boards, paid access, post types, sorting and permissions', view: 'community' },
  { labelZh: '圈子', labelEn: 'Circles', descZh: '成员制社群，区别于论坛板块', descEn: 'Membership communities independent from forum boards', view: 'circles' },
  { labelZh: '用户体系', labelEn: 'Accounts', descZh: '注册登录、14 家 OAuth、等级、徽章、签到、实名、邀请码', descEn: 'Sign-in, 14 OAuth providers, levels, badges, check-in, verification and invites', view: 'account' },
  { labelZh: '搜索与多语言', labelEn: 'Search & i18n', descZh: '统一搜索、Meilisearch/SQLite 双引擎、前后台语言', descEn: 'Unified search, Meilisearch/SQLite engines and locale settings', view: 'search' },
  { labelZh: '内容运营', labelEn: 'Content operations', descZh: '公告、更新日志、推广计划与转化回写', descEn: 'Announcements, changelog, promotions and conversion write-back', view: 'content' },
  { labelZh: '自研工具', labelEn: 'In-house tools', descZh: 'Quick Build WP、换域名插件、流盾 WAF', descEn: 'Quick Build WP, domain replacement plugin and Liudun WAF', view: 'tools' },
  { labelZh: '外观与页面', labelEn: 'Appearance & pages', descZh: '导航、配色、列表样式、页面区块', descEn: 'Navigation, palette, list styles and page blocks', view: 'commerce' },
  { labelZh: '版本与部署', labelEn: 'Releases & deployments', descZh: '版本迭代、CI 与部署汇总', descEn: 'Release history, CI and deployment summary', view: 'deployments' },
]; // 能力地图结束

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 返回当前语言的文案
} // 代码块结束

export function Releases({ locale, onOpen }: Props) { // 导出函数 Releases：版本迭代页入口
  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr(locale, '版本迭代', 'Release History')}</h1>
        <p className="muted">
          {tr(
            locale,
            `V0.0.0 → V${APP_VERSION}，共 11 个 semver 版本。仓库没有 V* git tag，版本以 package.json 递增提交与线上 /health 取证为准。`,
            `V0.0.0 → V${APP_VERSION}, 11 semver releases. The repository has no V* git tags; versions are reconstructed from package.json bump commits and online /health evidence.`,
          )}
        </p>
        <div className="commerce-badges">
          <span className="badge">{tr(locale, `当前 V${APP_VERSION}`, `Current V${APP_VERSION}`)}</span>
          <span className="badge">{tr(locale, '11 个版本', '11 releases')}</span>
          <span className="badge">{tr(locale, '0.0.0 长期累积', '0.0.0 accumulated early work')}</span>
        </div>
      </header>

      <section className="panel">
        <h2>{tr(locale, '版本时间线', 'Release timeline')}</h2>
        <p className="muted">
          {tr(
            locale,
            '0.0.0 不是“只有初始化”，早期 RBAC、商城、漫剧、部署汇总等能力都在这个版本号下累积；0.0.1 起才按发布批次递增。',
            '0.0.0 was not just initialization: early RBAC, marketplace, comic and deployment work accumulated under it. Increments by release batch started at 0.0.1.',
          )}
        </p>
        <ol className="changelog-timeline">
          {RELEASES.map((item) => (
            <li key={item.version} className="changelog-entry">
              <div className="changelog-version">
                <strong>{item.version}</strong>
                <span className="badge">{item.date}</span>
                <code>{item.commit}</code>
                <span className="badge">{tr(locale, item.stateZh, item.stateEn)}</span>
              </div>
              <h3>{tr(locale, item.titleZh, item.titleEn)}</h3>
              <ul className="plain-list">
                {(locale === 'en-US' ? item.changesEn : item.changesZh).map((change) => (
                  <li key={change} className="wrap">
                    {change}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2>{tr(locale, '能力地图', 'Capability map')}</h2>
        <p className="muted">
          {tr(
            locale,
            '如果某个能力在导航里找不到，从下面直接进入对应视图。这里只列已有前台页面的能力，不把未实现页面伪装成入口。',
            'If a capability is hard to find in navigation, open its view below. Only capabilities with existing frontend pages are listed; unimplemented pages are not presented as entries.',
          )}
        </p>
        <div className="commerce-grid">
          {CAPABILITIES.map((item) => (
            <div key={`${item.view}-${item.labelZh}`} className="panel">
              <strong>{tr(locale, item.labelZh, item.labelEn)}</strong>
              <span className="muted">{tr(locale, item.descZh, item.descEn)}</span>
              <button type="button" className="btn ghost" onClick={() => onOpen(item.view)}>
                {tr(locale, '打开', 'Open')}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2>{tr(locale, '口径说明', 'How to read this')}</h2>
        <ul className="plain-list">
          <li className="wrap">
            {tr(
              locale,
              '代码版本上线 ≠ 第三方通道启用。支付 9 渠道、14 家 OAuth、短信 / 邮箱、腾讯 / 极验验证码、百度审核、Redis、Meilisearch、CDN 仍需真实凭据或服务器配置。',
              'Code release does not mean third-party channels are enabled. Payments, OAuth, SMS/email, captcha, content audit, Redis, Meilisearch and CDN still require credentials or server configuration.',
            )}
          </li>
          <li className="wrap">
            {tr(
              locale,
              '0.0.7 是独立代码版本并有在线取证；0.0.10 发布期间出现过一次存量库缺列导致的 502，已由 f9769e0 修复并补了升级路径测试。',
              '0.0.7 is a distinct code release with online evidence. During 0.0.10 a legacy database missing a column caused a 502; f9769e0 fixed it and added upgrade-path tests.',
            )}
          </li>
          <li className="wrap">
            {tr(
              locale,
              '版本页数据是仓库事实，不跟随内容运营的更新日志种子；公告动态里的 0.0.7 / 0.0.8 只是运营条目，不代表完整版本历史。',
              'This page reflects repository facts, not the content-operations changelog seeds. The 0.0.7 / 0.0.8 entries under News are editorial items, not the full history.',
            )}
          </li>
        </ul>
      </section>
    </div>
  ); // 返回页面结构
} // Releases 结束
