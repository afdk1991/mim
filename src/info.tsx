/* ================= 站点信息落地页 =================
 * 服务于全站页脚的「关于我们 / 招贤纳士 / 商务合作 / 寻求报道 / 协议专区」
 * 以及备案资质类占位链接，路由：#/info/:slug。
 * 仅保留真实、通用的内容；站点相关的事实信息（联系方式、备案号、证照编号、
 * 企业主体等）一律留空待运营方配置，不预置任何演示数据。 */

import { Empty } from './components'

interface InfoSection {
  h?: string
  p?: string[]
  list?: string[]
}

interface InfoLink {
  href: string
  label: string
  desc: string
  external?: boolean
}

interface InfoDoc {
  emoji: string
  title: string
  updated?: string
  intro?: string
  sections: InfoSection[]
  links?: InfoLink[]
}

/* 待运营方配置时的统一提示文案 */
const TODO_NOTICE = '本项内容由站点运营方配置后展示。'

export const INFO_PAGES: Record<string, InfoDoc> = {
  /* ---------- 关于类 ---------- */
  about: {
    emoji: '🏢',
    title: '关于我们',
    intro: 'Mim 是一个技术内容与开发者社区，提供动态、文章、话题与开发者工具等服务。',
    sections: [
      {
        h: '我们在做什么',
        list: [
          '内容社区：动态、专栏文章与超话话题',
          '知识服务：代码片段与资源分享',
          '工具平台：行情监控等开发者效率工具',
        ],
      },
      {
        h: '联系我们',
        p: [TODO_NOTICE],
      },
    ],
  },
  join: {
    emoji: '🧑‍💻',
    title: '招贤纳士',
    intro: '招聘信息暂未发布，正式启动后本页将展示在招职位与投递方式。',
    sections: [],
  },
  coop: {
    emoji: '🤝',
    title: '商务合作',
    intro: '商务合作渠道暂未开通，开通后本页将展示合作方向与联系方式。',
    sections: [],
  },
  media: {
    emoji: '📣',
    title: '寻求报道',
    intro: '媒体对接渠道暂未开通，开通后本页将展示报道申请方式。',
    sections: [],
  },

  /* ---------- 协议专区 ---------- */
  terms: {
    emoji: '📄',
    title: '协议专区',
    intro: '集中展示本站各项协议、规范与资质文件的入口，使用本站服务前请仔细阅读相关条款。',
    links: [
      { href: '#/info/account-rules', label: '账号管理规范', desc: '账号注册、使用行为与违规处理规则' },
      { href: '#/info/disclaimer', label: '版权与免责声明', desc: '用户内容版权归属与平台免责范围' },
      { href: '#/info/appeal', label: '版权申诉', desc: '侵权投诉与反通知的处理流程' },
      { href: '#/info/publish-license', label: '出版物许可证', desc: '网络出版物经营资质信息' },
      { href: '#/info/license', label: '营业执照', desc: '公司主体与经营范围公示' },
    ],
    sections: [
      {
        h: '备案信息',
        p: ['ICP 备案与公安备案信息由站点运营方配置后展示。'],
      },
    ],
  },
  'account-rules': {
    emoji: '📘',
    title: '账号管理规范',
    intro: '为维护社区秩序，请遵守以下规范。违规行为将视情节严重程度受到相应处理。',
    sections: [
      {
        h: '注册与实名',
        list: ['一个自然人/主体原则上注册一个账号', '不得转让、出租、出借账号'],
      },
      {
        h: '行为规范',
        list: [
          '禁止发布违法违规、侵权、虚假信息',
          '禁止恶意刷量、批量注册、垃圾广告与机器行为',
          '尊重他人，禁止人身攻击与骚扰',
        ],
      },
      {
        h: '违规处理',
        p: ['视情节采取内容删除、禁言、降权、封禁等措施；对处理结果有异议的，可通过站点运营方公示的申诉渠道反馈。'],
      },
    ],
  },
  disclaimer: {
    emoji: '⚖️',
    title: '版权与免责声明',
    intro: '本声明适用于 Mim 平台提供的全部内容与服务。',
    sections: [
      {
        h: '内容版权',
        list: [
          '用户发布的内容版权归作者本人所有，发布即视为授权平台在站内展示与推荐',
          '平台原创内容（设计、代码、报告等）未经许可不得转载',
          '转载第三方内容将尽量标注来源，权利人可随时提出异议',
        ],
      },
      {
        h: '免责声明',
        list: [
          '用户内容仅代表作者个人观点，不代表平台立场',
          '外部链接内容由第三方提供，平台不对其准确性、合法性承担责任',
          '因不可抗力或系统维护导致的服务中断，平台不承担由此产生的间接损失',
        ],
      },
    ],
  },
  appeal: {
    emoji: '🛡️',
    title: '版权申诉',
    intro: '如发现站内内容侵犯您的合法权益，请按以下流程提交投诉，我们将在核实后及时处理。',
    sections: [
      {
        h: '投诉材料',
        list: [
          '权属证明：著作权登记证书、首发证明或授权文件等',
          '侵权内容链接（#/article/…、#/post/… 等）',
          '权利人姓名/名称、联系方式与身份证明',
          '构成侵权的初步证明材料',
        ],
      },
      {
        h: '处理流程与时限',
        p: [
          '材料齐全后将进行初审；确认侵权的，将删除或断开链接并通知被投诉方；被投诉方可提交不侵权声明（反通知）。',
        ],
      },
      { h: '投诉渠道', p: [TODO_NOTICE] },
    ],
  },
  'publish-license': {
    emoji: '📜',
    title: '出版物许可证',
    intro: '网络出版相关资质证照由站点运营方持有，证照信息配置后在此公示。',
    sections: [
      {
        h: '证照信息',
        p: [TODO_NOTICE],
      },
    ],
  },

  /* ---------- 备案与资质 ---------- */
  license: {
    emoji: '🧾',
    title: '营业执照',
    intro: '企业主体信息由站点运营方配置后在此公示，正式信息以营业执照原件为准。',
    sections: [
      {
        h: '登记信息',
        p: [TODO_NOTICE],
      },
    ],
  },
  'op-beian': {
    emoji: '🪪',
    title: '经营性网站备案信息',
    intro: '经营性网站备案信息由站点运营方配置后在此公示。',
    sections: [
      {
        h: '备案信息',
        p: [TODO_NOTICE],
      },
    ],
  },
  'bj-report': {
    emoji: '🚨',
    title: '北京互联网违法和不良信息举报中心',
    intro: '如您在本站发现违法和不良信息，欢迎通过以下渠道举报，我们将第一时间核实处置。',
    sections: [
      {
        h: '站内举报',
        p: ['站内举报渠道由站点运营方配置后展示。'],
      },
      {
        h: '官方渠道',
        p: ['也可通过中国互联网违法和不良信息举报中心（www.12377.cn）等官方渠道进行举报。'],
      },
    ],
  },
  parent: {
    emoji: '👨‍👩‍👧',
    title: '家长监护',
    intro: '我们关注未成年人的网络使用安全，提供家长监护工程支持，帮助家长引导孩子健康上网。',
    sections: [
      {
        h: '监护建议',
        list: [
          '控制未成年人每日上网时长，避免长时间连续使用',
          '关注孩子的浏览内容，善用平台的内容举报功能',
          '保管好支付账户与密码，开启消费提醒',
        ],
      },
      {
        h: '联系我们',
        p: ['如需协助处理未成年人账号问题，请通过站点运营方配置的渠道联系。'],
      },
    ],
  },
  'cn-report': {
    emoji: '📢',
    title: '中国互联网举报中心',
    intro: '中国互联网违法和不良信息举报中心是面向全社会的举报受理渠道，本站已接入其举报指引。',
    sections: [
      {
        h: '举报范围',
        list: ['危害国家安全、扰乱社会秩序的违法信息', '淫秽色情、赌博诈骗、网络暴力等不良信息', '侵犯个人权益的违法内容'],
      },
      {
        h: '举报方式',
        p: ['官方举报网站：www.12377.cn（可复制到浏览器访问）。'],
      },
    ],
  },
  police110: {
    emoji: '👮',
    title: '网络110报警服务',
    intro: '遭遇网络诈骗、盗窃、黑客攻击等网络违法犯罪时，请及时通过公安渠道报警，本站将依法配合调查。',
    sections: [
      {
        h: '报警指引',
        list: [
          '保存好证据：聊天记录、转账凭证、涉案网址与账号',
          '通过全国公安机关互联网站安全服务平台（网络110）在线报案',
          '紧急情况可直接拨打 110',
        ],
      },
      {
        h: '平台配合',
        p: ['本站将依据法律法规，配合公安机关提供必要的账号与日志数据。'],
      },
    ],
  },
  chrome: {
    emoji: '🧩',
    title: 'Chrome 商店下载',
    intro: '浏览器扩展暂未上架，正式发布后本页将提供安装指引与下载入口。',
    sections: [],
  },
}

/** 协议专区/信息页：无匹配 slug 时回退 Empty */
export function InfoPage({ slug }: { slug: string }) {
  const info = INFO_PAGES[slug]
  if (!info) return <Empty emoji="📄" text="页面不存在或已下线" />

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">
          {info.emoji} {info.title}
        </h2>
        <div className="card info-card">
          {info.updated && <p className="info-updated">更新日期：{info.updated}</p>}
          {info.intro && <p className="info-intro">{info.intro}</p>}

          {info.links && info.links.length > 0 && (
            <div className="info-links">
              {info.links.map((l) => (
                <a key={l.href} className="info-link" href={l.href}>
                  <b>{l.label}</b>
                  <small>{l.desc}</small>
                </a>
              ))}
            </div>
          )}

          {info.sections.map((s, i) => (
            <section key={i} className="info-sec">
              {s.h && <h3>{s.h}</h3>}
              {s.p?.map((t, j) => (
                <p key={j}>{t}</p>
              ))}
              {s.list && (
                <ul>
                  {s.list.map((li, j) => (
                    <li key={j}>{li}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
