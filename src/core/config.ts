/* ==========================================================================
 * 站点配置与运行期常量 —— 唯一真源
 *
 * 法定登记信息（备案号 / 许可证 / 主体资质）必须由运营方依真实证照填写，
 * 留空时全站信息页显示「本项内容由站点运营方配置后展示。」——禁止预置虚构数据。
 * ======================================================================== */

export const SITE_CONFIG = {
  /** 主办单位 / 主体名称 */
  owner: '个人开发者 afdk1991',
  /** ICP 备案号 */
  icp: '',
  /** 公安联网备案号 */
  policeBeian: '',
  /** 统一社会信用代码 */
  creditCode: '',
  /** 正式域名 */
  domain: 'afdk1991.github.io/mim',
  /** 出版物许可证编号 */
  publishLicense: '',
  /** 经营性网站备案编号 */
  opBeian: '',
  /** 客服邮箱 */
  contactEmail: 'afdk1991@users.noreply.github.com',
  /** 联系地址 */
  address: '',
  /** 邮箱聚合中转服务地址（浏览器无法直连 IMAP 993 / SMTP 465） */
  mailProxyUrl: 'https://mim-mail-proxy.15726833367.workers.dev',
  /** 商城扫码收款码直链；为空则扫码支付通道不可用 */
  payQrCodeUrl: '',
  /** 收款账户备注 */
  payQrNote: '',
  /** 未备案时的如实说明 */
  filingNote: '本站为个人开发学习项目，暂未办理经营性备案。',
} as const

export const isSet = (v: string): boolean => v.trim() !== ''

/* ---------- 后端地址 ---------- */

/** 生产默认地址：与 server/ 部署后的公网入口一致。
 *  公开只读接口，不含任何密钥，写死在前端是安全的（原实现同样如此）。 */
export const PROD_API_BASE = ''

/** 构建期可注入；未注入时回退同源 `/api`（配合 vite proxy / 网关反代）。 */
export const API_BASE: string = (import.meta.env.VITE_MIM_API_BASE as string | undefined)?.replace(/\/+$/, '') || '/api'

export const isBackendConfigured = (): boolean => API_BASE !== ''

/** 功能开关：扫码支付与人工核销依赖运营配置，未配置时通道关闭而非伪造 */
export const FEATURES = {
  qrcodePay: isSet(SITE_CONFIG.payQrCodeUrl),
} as const

/* ---------- 业务常量 ---------- */

export const LIMITS = {
  /** Feed 每页条数 */
  feedPageSize: 10,
  /** 浏览足迹上限 */
  historyMax: 50,
  /** 搜索历史上限 */
  searchHistoryMax: 8,
  /** 钱包流水保留条数 */
  walletTxMax: 50,
  /** VIP 订单保留条数 */
  vipOrderMax: 20,
  /** 弹幕上限 */
  danmakuMax: 100,
  /** 语音条上限 / 会话 */
  voiceMax: 30,
  /** 上传体积上限（3MB） */
  uploadMaxBytes: 3 * 1024 * 1024,
  /** 快拍存活时长 */
  storyTtlMs: 24 * 60 * 60 * 1000,
  /** 秒杀锁库存有效期 */
  seckillLockMs: 15 * 60 * 1000,
  /** 券码最长有效期 */
  voucherMaxDays: 90,
} as const

/** 响应式主断点：≤860px 侧栏转顶部横栏 */
export const BREAKPOINT_MOBILE = 860
