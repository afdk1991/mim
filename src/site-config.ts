/* ================= 站点事实配置（单一数据源） =================
 * ICP 备案号、公安备案号、企业主体、证照编号等是法定登记信息，只能由站点
 * 运营方依据真实证照填写，禁止预置虚构数据。在此填一处，全站信息页
 * （#/info/**）自动生效；字段留空（''）时对应位置显示
 * 「本项内容由站点运营方配置后展示。」 */

export const SITE_CONFIG = {
  /** 主办单位/公司名称（营业执照全称；个人主体填姓名） */
  owner: '个人开发者 afdk1991',
  /** ICP 备案号，如「粤ICP备12345678号」（未备案留空） */
  icp: '',
  /** 公安联网备案号，如「粤公网安备 44030002000001号」（未备案留空） */
  policeBeian: '',
  /** 统一社会信用代码（个人无主体登记留空） */
  creditCode: '',
  /** 站点正式访问域名（当前为 GitHub Pages 路径） */
  domain: 'afdk1991.github.io/mim',
  /** 出版物许可证编号（未取得留空） */
  publishLicense: '',
  /** 经营性网站备案编号（无则留空） */
  opBeian: '',
  /** 客服/联系邮箱 */
  contactEmail: 'afdk1991@users.noreply.github.com',
  /** 联系地址（可只到城市） */
  address: '',
  /** 邮箱聚合代理 Worker 地址（部署中转 Worker 后填写，如 https://mim-mail-proxy.<子域>.workers.dev） */
  mailProxyUrl: 'https://mim-mail-proxy.15726833367.workers.dev',
  /** 商城扫码收款码图片直链（未配置时商城「扫码支付」通道不可用） */
  payQrCodeUrl: '',
  /** 收款账户备注（展示给付款方核对，如昵称/账号） */
  payQrNote: '',
  /** 人工确认收款口令（仅站点运营方知晓；留空则商城订单「管理员核销」入口关闭） */
  payConfirmKey: '',
  /** 未备案时的如实说明（配置了 ICP/公安备案号后本字段不再展示） */
  filingNote:
    '本站为个人开发学习项目，由 afdk1991 维护，托管于 GitHub Pages（境外托管），暂未办理 ICP 备案与公安联网备案。',
} as const

/** 是否已配置（空串/空白视为未配置） */
export const isSet = (v: string): boolean => v.trim() !== ''
