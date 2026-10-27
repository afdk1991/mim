/* ==========================================================================
 * 设置 —— 账号安全 / 隐私设置 / 黑名单 / 青少年模式
 *
 * 数据：全部写本机（mim.identity.<uid>.<field>），经 identity-store 读写。
 * 红线：
 *  1. 完整身份证号不得落盘 —— 表单里的原始值用完即弃，只存 maskIdCard() 结果。
 *  2. 认证 pending → approved 必须由运营方在后台审核，页面绝不自批准（不做假自动审批）。
 *  3. 注销要输入「注销」二字二次确认，确认后清除该身份下全部本机隔离键。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { EVT, subscribe } from '../../core/events'
import { useRouter } from '../../app/router'
import { isSignedIn, signOut } from '../../data/session'
import {
  maskIdCard,
  type PostVisibility,
  type PrivacyPolicy,
  type PrivacyState,
  type RealNameState,
  type TeenState,
  type VerifyState,
} from '../../domain/identity/model'
import { useToast } from '../../ui'
import {
  clearIdentityLocal,
  clearRealName,
  getBlacklist,
  getPrivacy,
  getRealName,
  getTeen,
  getVerify,
  setBlacklist,
  setPrivacy,
  setRealName,
  setTeen,
  setVerify,
} from '@/app/state/identity'
import { AccountPanel, BlacklistPanel, TeenPanel } from './settings-panels'

type Tab = 'account' | 'privacy' | 'blacklist' | 'teen'

const TABS: Array<[Tab, string]> = [
  ['account', '账号安全'],
  ['privacy', '隐私设置'],
  ['blacklist', '黑名单'],
  ['teen', '青少年模式'],
]

const POST_OPTIONS: Array<[PostVisibility, string]> = [
  ['public', '公开（所有人可见）'],
  ['friends', '仅关注的人可见'],
  ['self', '仅自己可见'],
]

const POLICY_OPTIONS: Array<[PrivacyPolicy, string]> = [
  ['all', '所有人'],
  ['following', '仅我关注的人'],
  ['off', '关闭'],
]

export function SettingsPage() {
  const { navigate } = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('account')

  const [realName, setRealNameState] = useState<RealNameState | null>(getRealName)
  const [verify, setVerifyState] = useState<VerifyState>(getVerify)
  const [privacy, setPrivacyState] = useState<PrivacyState>(getPrivacy)
  const [teen, setTeenState] = useState<TeenState>(getTeen)
  const [blacklist, setBlacklistState] = useState<string[]>(getBlacklist)

  // 身份域事件是本页与其它域共享的唯一同步通道，任何一处写入都要能刷新到这里
  useEffect(
    () =>
      subscribe(EVT.identity, () => {
        setRealNameState(getRealName())
        setVerifyState(getVerify())
        setPrivacyState(getPrivacy())
        setTeenState(getTeen())
        setBlacklistState(getBlacklist())
      }),
    [],
  )

  return (
    <div className="page page-grid single">
      <h1 className="page-title">⚙️ 设置</h1>

      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'tab-btn active' : 'tab-btn'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'account' ? (
        <AccountPanel
          realName={realName}
          verify={verify}
          toast={toast}
          onClearRealName={() => {
            clearRealName()
            toast('已清除本机实名记录')
          }}
          onSubmitRealName={(name, idCard) => {
            setRealName({ name, idMasked: maskIdCard(idCard), at: Date.now() })
            toast('实名信息已保存（仅保存脱敏证件号）')
          }}
          onApplyVerify={(level, desc) => {
            setVerify({ status: 'pending', level, desc, appliedAt: Date.now() })
            toast('已提交认证申请，等待运营方审核')
          }}
          onPurge={() => {
            const n = clearIdentityLocal()
            void (async () => {
              if (isSignedIn()) await signOut()
              toast(`已清除 ${n} 项本机数据`)
              navigate('#/feed')
            })()
          }}
        />
      ) : null}

      {tab === 'privacy' ? (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            动态可见范围
          </div>
          <select
            className="input"
            value={privacy.posts}
            onChange={(e) => {
              setPrivacy({ ...privacy, posts: e.target.value as PostVisibility })
              toast('已保存')
            }}
          >
            {POST_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>

          <div className="section-title">谁可以评论我</div>
          <select
            className="input"
            value={privacy.comments}
            onChange={(e) => {
              setPrivacy({ ...privacy, comments: e.target.value as PrivacyPolicy })
              toast('已保存')
            }}
          >
            {POLICY_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>

          <div className="section-title">谁可以私信我</div>
          <select
            className="input"
            value={privacy.dm}
            onChange={(e) => {
              setPrivacy({ ...privacy, dm: e.target.value as PrivacyPolicy })
              toast('已保存')
            }}
          >
            {POLICY_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>

          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            隐私设置保存在本机，服务端过滤仍需后端按同一口径下发，跨设备不会自动同步。
          </p>
        </div>
      ) : null}

      {tab === 'blacklist' ? (
        <BlacklistPanel
          list={blacklist}
          onChange={(next) => {
            setBlacklist(next)
            toast('已更新黑名单')
          }}
        />
      ) : null}

      {tab === 'teen' ? (
        <TeenPanel
          teen={teen}
          toast={toast}
          onEnable={(password) => {
            setTeen({ enabled: true, password })
            toast('青少年模式已开启')
          }}
          onDisable={() => {
            setTeen({ enabled: false, password: '' })
            toast('青少年模式已关闭')
          }}
        />
      ) : null}
    </div>
  )
}

