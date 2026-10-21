import { Empty } from './components'

/* 邮箱聚合：多账户统一收件箱。
   原实现为纯 mock（内置假邮件、假新邮件模板、关键词伪造的「AI 摘要」）。
   真实邮箱聚合需要 IMAP/JMAP 服务端与账号授权，前端直连既无免费公开 API 也无法安全保管凭据；
   在未接入真实邮箱服务前，本页只提供空态与接入引导，不伪造任何邮件数据。 */

export function EmailHubPage() {
  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📬 邮箱聚合</h2>
        <div className="card">
          <Empty
            emoji="📭"
            text="尚未接入真实邮箱服务，暂无邮件可展示"
          />
          <p className="muted" style={{ margin: '0 0 8px' }}>
            统一收件箱需要通过 IMAP / JMAP 协议连接你的邮箱账户（如 QQ 邮箱、Gmail、企业邮箱），
            并由服务端完成授权与拉取，浏览器直连无法安全保存邮箱凭据。
          </p>
          <p className="muted" style={{ margin: 0 }}>
            接入方式：部署一个邮箱聚合服务端（授权后代理 IMAP / JMAP），前端通过受控接口拉取邮件列表与正文后，
            本页即可展示真实邮件、已读、标星等信息，不会再出现任何预填演示邮件。
          </p>
        </div>
      </div>
    </div>
  )
}
