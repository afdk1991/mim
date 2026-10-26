/* 轮 20 打通：设置页（B1 用户域）—— 账号安全（认证/实名/切换/注销）｜隐私设置｜黑名单｜青少年模式。
   全部走 user-domain 数据层（按真实登录身份分 key），弹窗复用共享 Modal，提示复用 emitToast/useToast。 */

import { useEffect, useState } from 'react'
import './settings.css'
import { Empty, Modal, emitToast, useToast } from './components'
import { useAuth } from './auth'
import { useApp } from './store'
import { useRouter } from './router'
import { cx } from './utils'
import {
  maskIdCard,
  purgeIdentityData,
  readVerify,
  syncDiscoveredAccounts,
  toggleBlacklistUser,
  useUserDomain,
  validateIdCard,
  writePrivacy,
  writeRealName,
  writeTeen,
  writeVerify,
} from './user-domain'
import type { PostVisibility, PrivacyPolicy, UdAccount, VerifyLevel } from './user-domain'

type SettingsTab = 'security' | 'privacy' | 'blacklist' | 'teen'

/* ---------- 时间格式化（页面内简单展示用） ---------- */

function fmtDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ================= 设置页入口 ================= */

export function SettingsPage() {
  const { auth } = useAuth()
  const [tab, setTab] = useState<SettingsTab>('security')

  /* 轮 20 打通：挂载时把 localStorage 里扫描到的历史身份合并进多账号清单（幂等） */
  useEffect(() => {
    syncDiscoveredAccounts()
  }, [])

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'security', label: '🔐 账号安全' },
    { key: 'privacy', label: '🙈 隐私设置' },
    { key: 'blacklist', label: '🚫 黑名单' },
    { key: 'teen', label: '🧒 青少年模式' },
  ]

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">⚙️ 设置</h2>
        <p className="set-hint" style={{ marginBottom: 12 }}>
          当前登录身份：{auth.mode === 'cloud' ? `云端账号（${auth.username ?? auth.email ?? auth.userId.slice(0, 8)}…）` : '游客（未登录）'}
          ，以下数据均按该身份隔离存储。
        </p>
        <div className="tabs">
          {tabs.map((t) => (
            <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'security' && (
          <>
            <RealNameCard />
            <VerifyCard />
            <SwitchAccountCard />
            <DangerZone />
          </>
        )}
        {tab === 'privacy' && <PrivacyTab />}
        {tab === 'blacklist' && <BlacklistTab />}
        {tab === 'teen' && <TeenTab />}
      </div>
    </div>
  )
}

/* ================= 账号安全：实名认证 ================= */

function RealNameCard() {
  const toast = useToast()
  const ud = useUserDomain()
  const [name, setName] = useState('')
  const [id, setId] = useState('')

  const submit = () => {
    if (!name.trim()) {
      toast('请填写真实姓名')
      return
    }
    if (!validateIdCard(id.trim())) {
      toast('身份证号格式或校验位不正确，请核对后重试')
      return
    }
    /* 硬约束：完整身份证号不落盘，只存前 3 后 4 的脱敏值 */
    writeRealName({ name: name.trim(), idMasked: maskIdCard(id.trim()), at: Date.now() })
    setName('')
    setId('')
    toast('实名认证完成 ✅')
  }

  return (
    <div className="set-card">
      <h3>🪪 实名认证</h3>
      {ud.realname ? (
        <div className="set-row">
          <div>
            <b>已实名</b>
            <p className="set-hint">
              {ud.realname.name} · 证件号 {ud.realname.idMasked} · 认证于 {fmtDate(ud.realname.at)}
            </p>
          </div>
          <span className="set-chip ok">已实名</span>
        </div>
      ) : (
        <>
          <p className="set-hint">按监管要求，发博/认证前需完成实名认证。演示环境仅做前端校验，证件号脱敏存储。</p>
          <div className="set-form">
            <input
              className="input"
              placeholder="真实姓名"
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input"
              placeholder="18 位身份证号（含校验位）"
              value={id}
              maxLength={18}
              onChange={(e) => setId(e.target.value)}
            />
            <div>
              <button className="btn btn-primary btn-sm" onClick={submit}>提交实名</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ================= 账号安全：认证申请（个人橙V / 机构蓝V） ================= */

function VerifyCard() {
  const toast = useToast()
  const ud = useUserDomain()
  const [level, setLevel] = useState<VerifyLevel>('orange')
  const [desc, setDesc] = useState('')

  const apply = () => {
    if (!ud.realname) {
      toast('认证前需先完成实名认证')
      return
    }
    if (!desc.trim()) {
      toast('请填写认证资料说明')
      return
    }
    writeVerify({ status: 'pending', level, desc: desc.trim(), appliedAt: Date.now() })
    toast('认证申请已提交，模拟审核中…')
    /* 模拟审核：2.6 秒后自动通过（demo 占位真实性，与「未接入真实支付」同级） */
    window.setTimeout(() => {
      const cur = readVerify()
      if (cur.status !== 'pending') return
      writeVerify({
        status: 'approved',
        level: cur.level,
        desc: cur.desc,
        appliedAt: cur.appliedAt,
        approvedAt: Date.now(),
      })
      emitToast(cur.level === 'orange' ? '🎉 恭喜，个人认证审核通过，已点亮橙 V' : '🎉 恭喜，机构认证审核通过，已点亮蓝 V')
    }, 2600)
  }

  return (
    <div className="set-card">
      <h3>✅ 账号认证</h3>
      {ud.verify.status === 'approved' ? (
        <div className="set-row">
          <div>
            <b>
              {ud.verify.level === 'orange' ? '个人认证（橙V）' : '机构认证（蓝V）'}
              <span className={cx('v-badge', ud.verify.level === 'orange' ? 'v-badge-orange' : 'v-badge-blue')}>V</span>
            </b>
            <p className="set-hint">
              {ud.verify.desc} · 通过于 {fmtDate(ud.verify.approvedAt)} · 徽章已在昵称旁展示
            </p>
          </div>
          <span className="set-chip ok">已认证</span>
        </div>
      ) : ud.verify.status === 'pending' ? (
        <div className="set-row">
          <div>
            <b>审核中（{ud.verify.level === 'orange' ? '橙V' : '蓝V'}）</b>
            <p className="set-hint">申请于 {fmtDate(ud.verify.appliedAt)} · 模拟审核稍后自动通过</p>
          </div>
          <span className="set-chip wait">审核中</span>
        </div>
      ) : (
        <>
          <p className="set-hint">
            个人认证点亮橙 V，机构认证点亮蓝 V；需先完成实名认证，资料说明 10 字以上更易通过。
          </p>
          <div className="set-form">
            <div className="set-seg" role="group" aria-label="认证类型">
              <button className={level === 'orange' ? 'active' : ''} onClick={() => setLevel('orange')}>👤 个人 → 橙V</button>
              <button className={level === 'blue' ? 'active' : ''} onClick={() => setLevel('blue')}>🏢 机构 → 蓝V</button>
            </div>
            <textarea
              className="input"
              rows={3}
              placeholder="认证资料说明：如职业身份、所在机构、代表作品等"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <div>
              <button className="btn btn-primary btn-sm" onClick={apply}>提交认证申请</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ================= 账号安全：多账号切换 ================= */

function SwitchAccountCard() {
  const { auth } = useAuth()
  const { navigate } = useRouter()
  const toast = useToast()
  const ud = useUserDomain()

  const sorted = [...ud.accounts].sort((a, b) => b.lastAt - a.lastAt)

  const pick = (acc: UdAccount) => {
    if (acc.uid === auth.userId) {
      toast('当前已是此账号')
      return
    }
    /* 游客身份无法恢复云端会话：引导去登录页重新登录 */
    toast('云端账号需验证登录态，请前往登录页切换')
    navigate('/login')
  }

  return (
    <div className="set-card">
      <h3>👥 切换账号</h3>
      {auth.mode === 'cloud' ? (
        <p className="set-hint">
          云端登录模式下不支持本页一键切换；如需切换账号，请退出登录后在登录页使用其他账号重新登录。
        </p>
      ) : (
        <>
          <p className="set-hint">
            本机使用/登录过的身份会自动登记在下方（含按身份分 key 的数据存档扫描），点击可查看切换方式。
          </p>
          {sorted.length === 0 && <Empty emoji="👥" text="暂无账号记录" />}
          {sorted.map((acc) => (
            <div key={acc.uid} className="set-acct" onClick={() => pick(acc)}>
              <span className="set-acct-mode">{acc.mode === 'cloud' ? '☁️' : '💻'}</span>
              <div className="set-acct-main">
                <b>{acc.label}</b>
                <small>
                  {acc.uid === 'local' ? '游客' : `${acc.uid.slice(0, 8)}…`}
                  {acc.lastAt ? ` · 最近使用 ${fmtDate(acc.lastAt)}` : ' · 历史存档'}
                </small>
              </div>
              {acc.uid === auth.userId ? (
                <span className="set-chip ok">当前</span>
              ) : (
                <span className="set-chip">切换</span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/* ================= 账号安全：危险区（账号注销） ================= */

function DangerZone() {
  const toast = useToast()
  const api = useApp()
  const { auth, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)

  const doPurge = async () => {
    setBusy(true)
    try {
      /* 清除当前身份相关的全部 localStorage key（mim-ud-*、成长/钱包/商城/发布器/VIP 等 <key>:<uid>） */
      purgeIdentityData(auth.userId)
      if (auth.mode === 'cloud') {
        await signOut() // 云端身份登出回游客态
      } else {
        api.resetLocalData() // 游客态：清空本机内容存档
      }
      setOpen(false)
      setWord('')
      toast('账号已注销，本机相关数据已清空')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="set-card set-danger">
      <h3>⚠️ 危险区</h3>
      <p className="set-hint">
        注销将清除当前身份（{auth.mode === 'cloud' ? `${auth.userId.slice(0, 8)}…` : '游客'}）名下的所有本机数据：
        成长、钱包、商城、发布器、VIP、隐私与认证记录等，操作不可恢复。
      </p>
      <button className="set-danger-btn" onClick={() => setOpen(true)}>注销账号</button>

      {open && (
        <Modal title="注销账号" onClose={() => { setOpen(false); setWord('') }}>
          <p className="set-hint" style={{ marginTop: 0 }}>
            此操作会删除该身份在本机的全部数据且无法找回。请输入「<b style={{ color: 'var(--danger)' }}>注销</b>」二字确认。
          </p>
          <input
            className="input"
            placeholder="输入「注销」确认"
            value={word}
            onChange={(e) => setWord(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setOpen(false); setWord('') }}>取消</button>
            <button className="set-danger-btn" disabled={word !== '注销' || busy} onClick={() => void doPurge()}>
              {busy ? '正在注销…' : '确认注销'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ================= 隐私设置 ================= */

const VISIBILITY_OPTS: Array<{ v: PostVisibility; label: string }> = [
  { v: 'public', label: '公开' },
  { v: 'friends', label: '好友圈' },
  { v: 'self', label: '仅自己' },
]

const POLICY_OPTS: Array<{ v: PrivacyPolicy; label: string }> = [
  { v: 'all', label: '所有人' },
  { v: 'following', label: '我关注的人' },
  { v: 'off', label: '关闭' },
]

function PrivacyRow({ label, desc, opts, value, onChange }: {
  label: string
  desc: string
  opts: Array<{ v: string; label: string }>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="set-row">
      <div>
        <b>{label}</b>
        <p className="set-hint">{desc}</p>
      </div>
      <div className="set-seg" role="group" aria-label={label}>
        {opts.map((o) => (
          <button key={o.v} className={value === o.v ? 'active' : ''} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PrivacyTab() {
  const ud = useUserDomain()
  const p = ud.privacy

  /* 账号级默认值（单条动态可见性为 B2 轮规划）；私信开关在私信页发送路径有真实拦截 */
  return (
    <div className="set-card">
      <h3>🙈 隐私设置</h3>
      <PrivacyRow
        label="谁可以看我的动态"
        desc="账号级默认可见范围（单条动态的独立可见性将在后续版本支持）"
        opts={VISIBILITY_OPTS}
        value={p.posts}
        onChange={(v) => writePrivacy({ ...p, posts: v as PostVisibility })}
      />
      <PrivacyRow
        label="谁可以评论我"
        desc="限制互动来源，减少陌生打扰"
        opts={POLICY_OPTS}
        value={p.comments}
        onChange={(v) => writePrivacy({ ...p, comments: v as PrivacyPolicy })}
      />
      <PrivacyRow
        label="谁可以私信我"
        desc="「关闭」后私信页将无法发送消息并提示；「我关注的人」需先关注对方"
        opts={POLICY_OPTS}
        value={p.dm}
        onChange={(v) => writePrivacy({ ...p, dm: v as PrivacyPolicy })}
      />
    </div>
  )
}

/* ================= 黑名单管理 ================= */

function BlacklistTab() {
  const toast = useToast()
  const api = useApp()
  const ud = useUserDomain()

  return (
    <div className="set-card">
      <h3>🚫 黑名单（{ud.blacklist.length}）</h3>
      <p className="set-hint">拉黑后：首页 feed 不再展示 TA 的动态，TA 的私信会被拦截。可在他人主页点击「拉黑」添加。</p>
      {ud.blacklist.length === 0 && <Empty emoji="🚫" text="黑名单是空的" />}
      {ud.blacklist.map((id) => {
        const u = api.user(id)
        return (
          <div key={id} className="set-bl-row">
            <span className="set-bl-avatar" style={{ background: u.color }}>{u.emoji}</span>
            <div className="set-acct-main">
              <b>{u.name}</b>
              <small>@{u.id}</small>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                toggleBlacklistUser(id)
                toast('已移出黑名单')
              }}
            >
              移出黑名单
            </button>
          </div>
        )
      })}
    </div>
  )
}

/* ================= 青少年模式 ================= */

function TeenTab() {
  const toast = useToast()
  const ud = useUserDomain()
  const [openSet, setOpenSet] = useState(false)
  const [openOff, setOpenOff] = useState(false)
  const [pwd, setPwd] = useState('')

  const enable = () => {
    if (!/^\d{4}$/.test(pwd)) {
      toast('请设置 4 位数字密码')
      return
    }
    writeTeen({ enabled: true, password: pwd })
    setOpenSet(false)
    setPwd('')
    /* 开启提示：弹一次（demo 粒度，不做真实使用时长限制） */
    emitToast('青少年模式已开启（演示：仅敏感词过滤，不做真实时长限制）🧒')
  }

  const disable = () => {
    if (pwd !== ud.teen.password) {
      toast('密码不正确')
      return
    }
    writeTeen({ enabled: false, password: '' })
    setOpenOff(false)
    setPwd('')
    toast('已退出青少年模式')
  }

  return (
    <div className="set-card">
      <h3>🧒 青少年模式</h3>
      <div className="set-row">
        <div>
          <b>{ud.teen.enabled ? '已开启' : '未开启'}</b>
          <p className="set-hint">
            开启后全站顶部展示横幅，feed 将过滤含敏感占位词的内容（演示用简单关键词过滤）。
            {ud.teen.enabled ? '演示用：仅做敏感词过滤，不做真实使用时长限制。' : ''}
          </p>
        </div>
        {ud.teen.enabled ? (
          <button className="btn btn-ghost btn-sm" onClick={() => { setOpenOff(true); setPwd('') }}>关闭青少年模式</button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => { setOpenSet(true); setPwd('') }}>开启青少年模式</button>
        )}
      </div>

      {openSet && (
        <Modal title="开启青少年模式" onClose={() => { setOpenSet(false); setPwd('') }}>
          <p className="set-hint" style={{ marginTop: 0 }}>
            请设置 4 位数字密码（演示环境仅需设置一次，关闭时需验证）。
          </p>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="4 位数字密码"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setOpenSet(false); setPwd('') }}>取消</button>
            <button className="btn btn-primary" onClick={enable}>开启</button>
          </div>
        </Modal>
      )}

      {openOff && (
        <Modal title="关闭青少年模式" onClose={() => { setOpenOff(false); setPwd('') }}>
          <p className="set-hint" style={{ marginTop: 0 }}>请输入开启时设置的 4 位数字密码。</p>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="4 位数字密码"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setOpenOff(false); setPwd('') }}>取消</button>
            <button className="btn btn-primary" onClick={disable}>确认关闭</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
