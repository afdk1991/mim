/* ==========================================================================
 * 站点信息静态页 —— #/info/<slug>
 *
 * 数据：全部事实项（主体 / 备案号 / 许可证 / 邮箱 / 域名）来自 core/config 的 SITE_CONFIG。
 * 红线：运营方未配置的法定登记项一律显示「本项内容由站点运营方配置后展示。」，
 *       严禁预置虚构备案号、许可证编号。
 * 状态：静态页无加载态；未知 / 空 slug 走空态，不白屏。
 * ======================================================================== */

import { isSet, SITE_CONFIG } from '../../core/config'
import { Empty } from '../../ui'

export interface InfoPageProps {
  slug: string
}

const PLACEHOLDER = '本项内容由站点运营方配置后展示。'

/** 未配置 → 占位文案；已配置 → 原值 */
function fact(v: string): string {
  return isSet(v) ? v : PLACEHOLDER
}

interface Section {
  title: string
  lines: string[]
}

interface InfoDoc {
  title: string
  emoji: string
  /** 是否附带法定登记信息表 */
  legal: boolean
  sections: Section[]
}

/** 法定登记信息表：行文案只有 SITE_CONFIG 一个真源 */
function legalRows(): Array<[string, string]> {
  return [
    ['主办单位 / 主体名称', fact(SITE_CONFIG.owner)],
    ['ICP 备案号', fact(SITE_CONFIG.icp)],
    ['公安联网备案号', fact(SITE_CONFIG.policeBeian)],
    ['统一社会信用代码', fact(SITE_CONFIG.creditCode)],
    ['正式域名', fact(SITE_CONFIG.domain)],
    ['出版物许可证编号', fact(SITE_CONFIG.publishLicense)],
    ['经营性网站备案编号', fact(SITE_CONFIG.opBeian)],
    ['客服邮箱', fact(SITE_CONFIG.contactEmail)],
    ['联系地址', fact(SITE_CONFIG.address)],
  ]
}

function buildDocs(): Record<string, InfoDoc> {
  const mail = fact(SITE_CONFIG.contactEmail)
  const domain = fact(SITE_CONFIG.domain)
  return {
    about: {
      title: '关于我们',
      emoji: '🌱',
      legal: true,
      sections: [
        {
          title: '站点定位',
          lines: [
            'Mim 是一个内容聚合社区：动态、文章、代码片段、资源下载、商城与工具台共用一套账号与钱包。',
            '本项目以学习与自托管为目标，不承诺商业级可用性。',
          ],
        },
        {
          title: '数据存放',
          lines: [
            '未登录时，内容只保存在你当前浏览器的本机存储中，换设备或清理浏览器数据即丢失。',
            '登录后内容写入自托管后端；后端未部署时，各页面会明确提示“后端未就绪”，不会伪造数据。',
          ],
        },
      ],
    },
    terms: {
      title: '服务条款',
      emoji: '📜',
      legal: false,
      sections: [
        {
          title: '账号',
          lines: [
            '注册即表示你保证所填信息真实，并对该账号下的全部行为负责。',
            '请勿批量注册、冒用他人身份或以任何方式干扰服务正常运行。',
          ],
        },
        {
          title: '内容',
          lines: [
            '你发布的内容由你负责，不得包含违法、侵权、骚扰或误导性信息。',
            '违规内容将被扣分（成长值 -50）并可能被移除，多次违规将限制账号功能。',
          ],
        },
        {
          title: '交易与虚拟权益',
          lines: [
            '商城订单、钱包余额与 VIP 时长均以服务端记录为准；已支付费用不予退回，另有法定要求的除外。',
            '钱包不提供自助充值：充值须扫码付款后由运营方人工核销入账。',
          ],
        },
        {
          title: '服务变更',
          lines: ['本站为个人开发项目，可能随时调整或停止部分功能，恕不另行逐一通知。'],
        },
      ],
    },
    privacy: {
      title: '隐私政策',
      emoji: '🔒',
      legal: false,
      sections: [
        {
          title: '收集哪些信息',
          lines: [
            '账号信息：用户名与密码哈希（密码不明文存储，运营方无法读取你的密码）。',
            '内容信息：你主动发布的动态、文章、评论、私信与上传文件。',
            '运行信息：审计日志会记录后台操作，用于追溯滥用。',
          ],
        },
        {
          title: '实名信息',
          lines: [
            '实名认证只保存脱敏后的证件号（前 3 后 4），完整证件号不会写入本机存储。',
            '实名信息仅用于认证审核，不对外展示。',
          ],
        },
        {
          title: '你的控制权',
          lines: [
            '在「设置 → 隐私设置」可调整动态可见范围、评论与私信权限。',
            '在「设置 → 账号安全」的注销区可清除本机数据。',
          ],
        },
      ],
    },
    disclaimer: {
      title: '免责声明',
      emoji: '⚠️',
      legal: true,
      sections: [
        {
          title: '备案状态',
          lines: [SITE_CONFIG.filingNote],
        },
        {
          title: '内容责任',
          lines: [
            '站内用户发布的内容仅代表作者本人，不代表站点立场。',
            '第三方链接与资源的可用性、合法性由提供方负责。',
          ],
        },
        {
          title: '免责范围',
          lines: [
            '本站按“现状”提供，不对数据的完整性、及时性与特定用途适用性作任何担保。',
            '因网络、设备或第三方服务导致的损失，本站不承担责任。',
          ],
        },
      ],
    },
    contact: {
      title: '联系我们',
      emoji: '✉️',
      legal: true,
      sections: [
        {
          title: '联系方式',
          lines: [`客服邮箱：${mail}`, `正式域名：${domain}`],
        },
        {
          title: '受理范围',
          lines: [
            '账号与登录问题、内容侵权投诉、支付与核销核对、功能建议。',
            '侵权投诉请附：你的身份说明、被投诉内容的链接、权属证明。',
          ],
        },
      ],
    },
    'account-rules': {
      title: '账号规则',
      emoji: '🧾',
      legal: false,
      sections: [
        {
          title: '注册与使用',
          lines: [
            '一个手机号 / 邮箱对应一个账号；用户名注册后不可自行更改，如需变更请联系运营方。',
            '请妥善保管密码；因密码泄露导致的损失由账号本人承担。',
          ],
        },
        {
          title: '违规处理',
          lines: [
            '发布违法、侵权、骚扰或误导内容将被扣分（成长值 -50）并移除内容。',
            '情节严重或反复违规的，将限制发布、评论或登录功能；处理决定由运营方人工作出。',
          ],
        },
      ],
    },
    appeal: {
      title: '申诉与举报',
      emoji: '📮',
      legal: false,
      sections: [
        {
          title: '申诉渠道',
          lines: [`邮箱：${mail}`, '请说明被处理的内容、处理时间与你申诉的理由，并附上相关证明。'],
        },
        {
          title: '处理说明',
          lines: [
            '申诉由运营方人工复核，本站不承诺具体办结时限，复核结论以邮件回复为准。',
            '举报他人内容同样请提供链接与理由；涉及侵权的，请同时提供权属证明。',
          ],
        },
      ],
    },
    'publish-license': {
      title: '出版物与资质',
      emoji: '📚',
      legal: true,
      sections: [
        {
          title: '资质说明',
          lines: [
            '涉及出版、网络视听、经营性信息服务的资质需由运营方依真实证照填写，未填写的项一律留空。',
            '本站不会展示任何未经核实的许可证编号，也不以占位编号代替。',
          ],
        },
      ],
    },
    license: {
      title: '资质与许可',
      emoji: '🏷️',
      legal: true,
      sections: [
        {
          title: '登记与许可',
          lines: [
            '下列项目需由运营方依真实证照填写；未填写的不展示任何编号，也不会以占位编号代替。',
            '若你需要核验本站资质，请先通过上方联系方式索取。',
          ],
        },
      ],
    },
  }
}

const DOCS = buildDocs()

export function InfoPage({ slug }: InfoPageProps) {
  const doc = DOCS[slug]

  if (!doc) {
    return (
      <div className="page">
        <Empty emoji="📄" text={`没有找到「${slug || '空'}」对应的信息页，请从页脚重新选择`} />
      </div>
    )
  }

  return (
    <div className="page page-grid single">
      <h1 className="page-title">
        {doc.emoji} {doc.title}
      </h1>

      {doc.sections.map((s) => (
        <div className="card" key={s.title}>
          <div className="section-title" style={{ marginTop: 0 }}>
            {s.title}
          </div>
          {s.lines.map((line) => (
            <p key={line} style={{ margin: '0 0 8px' }}>
              {line}
            </p>
          ))}
        </div>
      ))}

      {doc.legal ? (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            法定登记信息
          </div>
          <div className="kv-table">
            {legalRows().map(([label, value]) => (
              <div className="kv-row" key={label}>
                <span className="muted">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            标注「{PLACEHOLDER}」的项目表示运营方尚未配置，本站不会以任何占位编号代替真实证照信息。
          </p>
        </div>
      ) : null}
    </div>
  )
}
