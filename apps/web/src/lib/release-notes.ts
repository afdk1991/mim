/**
 * 版本发布补充信息：2026-11-15 由独立 /releases 页面并入社区「公告动态」页签的更新日志。
 * 更新日志正文仍来自后端 GET /changelog；这里只保留原版本页独有的静态补充
 * （递增提交短哈希、线上状态、主要变化清单）、能力地图与口径说明，避免内容随页面一起消失。
 * 新增版本时：更新日志条目走后台内容运营，同一版本的补充信息在本文件按版本号补一行即可。
 */

export interface ReleaseDetail { // 单个版本的静态补充信息
  date: string; // 递增提交日期
  commit: string; // 递增提交短哈希
  stateZh: string; // 中文线上状态
  stateEn: string; // 英文线上状态
  changesZh: string[]; // 中文主要变化
  changesEn: string[]; // 英文主要变化
} // 代码块结束

/** 按版本号索引（不带 v 前缀，形如 0.0.10），便于与更新日志的版本号对齐。 */
export const RELEASE_DETAILS: Readonly<Record<string, ReleaseDetail>> = {
  '0.0.0': {
    date: '2026-11-03',
    commit: '2a4891d',
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
  '0.0.1': {
    date: '2026-11-12',
    commit: 'fc5b3a0',
    stateZh: '首次 semver 递增',
    stateEn: 'First semver increment',
    changesZh: ['新增匿名看片与登录后「我的作品」播放。', '支持集数切换与断点续播。'],
    changesEn: ['Anonymous watching plus “My Works” playback after sign-in.', 'Episode switching and resume playback.'],
  },
  '0.0.2': {
    date: '2026-11-12',
    commit: 'd258f41',
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
  '0.0.3': {
    date: '2026-11-12',
    commit: '7e1e87c',
    stateZh: '快速迭代',
    stateEn: 'Fast iteration',
    changesZh: [
      '从目录条目升级为真实业务模块：链接目录、服务端可达性探测、失效标记、推荐位、检索。',
      '新增 nav_links 表与 6 个导航端点（该模块已于 2026-11-15 下线）。',
    ],
    changesEn: [
      'Upgraded from a directory entry to a real module: link catalog, probe, broken-link flags, recommendations and search.',
      'Added the nav_links table and six navigation endpoints (removed on 2026-11-15).',
    ],
  },
  '0.0.4': {
    date: '2026-11-12',
    commit: '2bee64f',
    stateZh: '线上曾实测 0.0.4',
    stateEn: 'Observed online as 0.0.4',
    changesZh: [
      '五来源聚合：模块 / 入口 / 导航 / 社区 / 商城（统一搜索模块已于 2026-11-15 下线）。',
      'Meilisearch 未配置时自动降级 SQLite。',
      '验证 28 文件 / 398 例全过。',
    ],
    changesEn: [
      'Five sources: modules, entries, navigation, community and marketplace (search removed on 2026-11-15).',
      'Automatic SQLite fallback when Meilisearch is not configured.',
      'Verified with 28 files / 398 tests.',
    ],
  },
  '0.0.5': {
    date: '2026-11-12',
    commit: 'e9c4cae',
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
      'Shipping, after-sales, reviews, withdrawals, creator earnings, theme/page blocks, badges, DMs and translation.',
      'Verified with 29 files / 407 tests.',
    ],
  },
  '0.0.6': {
    date: '2026-11-12',
    commit: '9b66978',
    stateZh: '线上曾实测 0.0.6',
    stateEn: 'Observed online as 0.0.6',
    changesZh: [
      'Mim ID 改为 QQ 号样式纯数字号，存量全量重排并预留靓号。',
      '同版本追加快递100 可选实时轨迹 74e78c0，未配置回退本地轨迹。',
      '验证 31 文件 / 426 例全过。',
    ],
    changesEn: [
      'Mim ID changed to numeric QQ-style IDs; existing users renumbered and premium IDs reserved.',
      'Same version added optional Kuaidi100 live tracking via 74e78c0, falling back to local tracks.',
      'Verified with 31 files / 426 tests.',
    ],
  },
  '0.0.7': {
    date: '2026-11-13',
    commit: '3e74334',
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
  '0.0.8': {
    date: '2026-11-13',
    commit: '6dec1c4',
    stateZh: '生产 run 43260913823 取证',
    stateEn: 'Production run 43260913823',
    changesZh: ['付费图库 / 视频前台渲染。', 'page_blocks 公共区块与论坛板块权限闭环。', '配套文档 5df4622 记录生产上线取证。'],
    changesEn: [
      'Paid gallery and video rendering on the frontend.',
      'page_blocks public blocks and forum board permission closure.',
      'Documentation commit 5df4622 recorded production evidence.',
    ],
  },
  '0.0.9': {
    date: '2026-11-13',
    commit: '0dd2b9d',
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
  '0.0.10': {
    date: '2026-11-13',
    commit: '7e6dbf6',
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
}; // 版本补充信息结束

export interface CapabilityNote { // 原版本页能力地图条目（仅说明，不再带跳转）
  labelZh: string;
  labelEn: string;
  descZh: string;
  descEn: string;
} // 代码块结束

/** 能力地图：说明各能力现在落在哪个视图，入口统一走侧栏，不在此重复造入口。 */
export const CAPABILITY_NOTES: readonly CapabilityNote[] = [
  { labelZh: '知识付费四件套', labelEn: 'Paid content suite', descZh: '付费阅读 / 下载 / 图库 / 视频与未购隐藏', descEn: 'Paid articles, downloads, galleries and videos' },
  { labelZh: '社区商城', labelEn: 'Shop', descZh: '实物快递、自动发货、手动发货、余额与优惠码结算', descEn: 'Physical goods, auto/manual delivery, balance and coupon checkout' },
  { labelZh: '营销与资金', labelEn: 'Marketing & funds', descZh: '优惠码、批量改价、VIP、余额、积分、卡密、返佣、分成', descEn: 'Coupons, bulk pricing, VIP, wallet, points, cards, referrals and revenue share' },
  { labelZh: '论坛', labelEn: 'Forum', descZh: '板块、付费加入、帖子形态、排序与板块权限', descEn: 'Boards, paid access, post types, sorting and permissions' },
  { labelZh: '圈子', labelEn: 'Circles', descZh: '成员制社群，区别于论坛板块', descEn: 'Membership communities independent from forum boards' },
  { labelZh: '用户体系', labelEn: 'Accounts', descZh: '注册登录、14 家 OAuth、等级、签到、实名、邀请码', descEn: 'Sign-in, 14 OAuth providers, levels, check-in, verification and invites' },
  { labelZh: '内容运营', labelEn: 'Content operations', descZh: '公告、更新日志、社区动态、推广计划与转化回写（均在社区页「公告动态」页签）', descEn: 'Announcements, changelog, community feed and promotions (all in the community tab)' },
  { labelZh: '版本与部署', labelEn: 'Releases & deployments', descZh: '版本迭代并入本页签更新日志；部署汇总属运维信息，仅后台可见', descEn: 'Release history merged into this changelog; deployment inventory is admin-only' },
]; // 能力地图结束

/** 阅读口径：说明版本号与线上状态的关系，随版本页一起并入。 */
export const RELEASE_READING_NOTES: ReadonlyArray<{ zh: string; en: string }> = [
  {
    zh: '代码版本上线 ≠ 第三方通道启用。支付 9 渠道、14 家 OAuth、短信 / 邮箱、腾讯 / 极验验证码、内容审核、Redis、CDN 仍需真实凭据或服务器配置。',
    en: 'Code release does not mean third-party channels are enabled. Payments, OAuth, SMS/email, captcha, content audit, Redis and CDN still require credentials or server configuration.',
  },
  {
    zh: '0.0.0 不是「只有初始化」，早期 RBAC、商城、漫剧、部署汇总等能力都在这个版本号下累积；0.0.1 起才按发布批次递增。',
    en: '0.0.0 was not just initialization: early RBAC, marketplace, comic and deployment work accumulated under it. Increments by release batch started at 0.0.1.',
  },
  {
    zh: '仓库没有 V* git tag，版本以 package.json 递增提交与线上 /health 取证为准；0.0.10 发布期间出现过一次存量库缺列导致的 502，已由 f9769e0 修复并补了升级路径测试。',
    en: 'The repository has no V* git tags; versions are reconstructed from package.json bump commits and online /health evidence. During 0.0.10 a legacy database missing a column caused a 502; f9769e0 fixed it and added upgrade-path tests.',
  },
]; // 阅读口径结束
