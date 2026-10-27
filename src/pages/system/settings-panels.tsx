/* ==========================================================================
 * 设置页子组件 —— 账号安全 / 黑名单 / 青少年模式三个面板
 *
 * 单独成文件的原因：SettingsPage 只保留 Tab 容器与隐私设置，避免单文件膨胀到 500 行。
 * 红线同 SettingsPage：证件号只留局部变量、认证不自批准、注销要二次确认。
 * ======================================================================== */

import { useState } from 'react'
import { isSet, SITE_CONFIG } from '../../core/config'
import { formatDate } from '../../core/utils'
import {
  TEEN_PASSWORD_RE,
  validateIdCard,
  type RealNameState,
  type TeenState,
  type VerifyLevel,
  type VerifyState,
} from '../../domain/identity/model'
import { Badge, Empty, Tag } from '../../ui'

export type ToastFn = (text: string) => void

const LEVEL_OPTIONS: Array<[VerifyLevel, string, string]> = [
  ['orange', '橙V 个人认证', '适用于个人创作者，需与实名信息一致'],
  ['blue', '蓝V 机构认证', '适用于企业 / 组织，需与主体资质一致'],
]

export function AccountPanel(props: {
  realName: RealNameState | null
  verify: VerifyState
  toast: ToastFn
  onClearRealName: () => void
  onSubmitRealName: (name: string, idCard: string) => void
  onApplyVerify: (level: VerifyLevel, desc: string) => void
  onPurge: () => void
}) {
  const { realName, verify, toast } = props
  const [name, setName] = useState('')
  const [idCard, setIdCard] = useState('')
  const [level, setLevel] = useState<VerifyLevel>('orange')
  const [desc, setDesc] = useState('')
  const [purgeText, setPurgeText] = useState('')

  return (
    <>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          实名认证
        </div>
        {realName ? (
          <>
            <div className="kv-table">
              <div className="kv-row">
                <span className="muted">姓名</span>
                <span>{realName.name}</span>
              </div>
              <div className="kv-row">
                <span className="muted">证件号</span>
                <span>{realName.idMasked}</span>
              </div>
              <div className="kv-row">
                <span className="muted">提交时间</span>
                <span>{formatDate(realName.at) || '—'}</span>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              完整证件号不会保存到本机，此处只展示脱敏值。
            </p>
            <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={props.onClearRealName}>
              清除本机实名记录
            </button>
          </>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            <label className="form-field">
              <span className="form-label">真实姓名</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="form-field">
              <span className="form-label">身份证号（仅用于本机校验，不保存原文）</span>
              <input
                className="input"
                value={idCard}
                maxLength={18}
                inputMode="numeric"
                placeholder="18 位身份证号"
                onChange={(e) => setIdCard(e.target.value.trim())}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!name.trim()) {
                  toast('请填写真实姓名')
                  return
                }
                // 校验通过后立刻脱敏，原始证件号只停留在局部变量里
                if (!validateIdCard(idCard)) {
                  toast('身份证号校验未通过，请核对后重试')
                  return
                }
                props.onSubmitRealName(name.trim(), idCard)
                setIdCard('')
              }}
            >
              提交实名
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          橙V / 蓝V 认证
        </div>
        {verify.status === 'none' ? (
          <div className="col" style={{ gap: 10 }}>
            <div className="chip-row">
              {LEVEL_OPTIONS.map(([v, label]) => (
                <button key={v} className={level === v ? 'chip active' : 'chip'} onClick={() => setLevel(v)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {LEVEL_OPTIONS.find(([v]) => v === level)?.[2] ?? ''}
            </p>
            <label className="form-field">
              <span className="form-label">认证说明（领域 / 资质简述）</span>
              <input
                className="input"
                value={desc}
                placeholder="例：科技领域创作者"
                onChange={(e) => setDesc(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!desc.trim()) {
                  toast('请填写认证说明')
                  return
                }
                props.onApplyVerify(level, desc.trim())
                setDesc('')
              }}
            >
              提交认证申请
            </button>
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {verify.level === 'orange' ? <Badge cls="paid">橙V</Badge> : <Badge cls="unpaid">蓝V</Badge>}
              {verify.status === 'pending' ? <Tag>审核中</Tag> : <Tag>已通过</Tag>}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {verify.desc}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              提交时间：{formatDate(verify.appliedAt) || '—'}
              {verify.status === 'approved' ? ` · 通过时间：${formatDate(verify.approvedAt) || '—'}` : ''}
            </div>
            {verify.status === 'pending' ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                审核由运营方在管理后台完成，本页面不会自动通过 —— 长时间未审核请联系
                {isSet(SITE_CONFIG.contactEmail) ? SITE_CONFIG.contactEmail : '运营方'}。
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="card danger-zone">
        <div className="section-title" style={{ marginTop: 0 }}>
          注销与数据清除
        </div>
        <p style={{ margin: '0 0 10px' }}>
          将清除当前身份在本机的全部数据（内容、钱包、成长、VIP、黑名单）。此操作不可恢复；服务端数据需另行联系运营方删除。
        </p>
        <label className="form-field">
          <span className="form-label">请输入「注销」二字以确认</span>
          <input
            className="input"
            value={purgeText}
            placeholder="注销"
            onChange={(e) => setPurgeText(e.target.value)}
          />
        </label>
        <button
          className="btn btn-danger"
          style={{ marginTop: 10 }}
          disabled={purgeText.trim() !== '注销'}
          onClick={props.onPurge}
        >
          确认注销并清除本机数据
        </button>
      </div>
    </>
  )
}

export function BlacklistPanel(props: { list: string[]; onChange: (next: string[]) => void }) {
  const [id, setId] = useState('')

  function add(): void {
    const v = id.trim()
    if (!v || props.list.includes(v)) return
    props.onChange([...props.list, v])
    setId('')
  }

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>
        屏蔽用户
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" value={id} placeholder="输入用户 id" onChange={(e) => setId(e.target.value)} />
        <button className="btn" onClick={add}>
          加入黑名单
        </button>
      </div>

      {props.list.length === 0 ? (
        <Empty emoji="🚫" text="黑名单为空：加入后对方的内容与私信将在本机被过滤" />
      ) : (
        <div className="col" style={{ gap: 8, marginTop: 12 }}>
          {props.list.map((uid) => (
            <div className="notif-row" key={uid}>
              <span className="notif-icon">🚫</span>
              <div className="notif-body">
                <div>{uid}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  已屏蔽（本机生效）
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => props.onChange(props.list.filter((x) => x !== uid))}>
                移出
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TeenPanel(props: {
  teen: TeenState
  toast: ToastFn
  onEnable: (password: string) => void
  onDisable: () => void
}) {
  const [pwd, setPwd] = useState('')

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>
        青少年模式
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <span>{props.teen.enabled ? '已开启' : '未开启'}</span>
        {props.teen.enabled ? <Badge cls="pending">过滤中</Badge> : null}
      </div>

      {props.teen.enabled ? (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          <label className="form-field">
            <span className="form-label">输入 4 位数字密码以关闭</span>
            <input
              className="input"
              type="password"
              value={pwd}
              maxLength={4}
              inputMode="numeric"
              onChange={(e) => setPwd(e.target.value.trim())}
            />
          </label>
          <button
            className="btn"
            onClick={() => {
              if (pwd !== props.teen.password) {
                props.toast('密码不正确')
                return
              }
              props.onDisable()
              setPwd('')
            }}
          >
            关闭青少年模式
          </button>
        </div>
      ) : (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          <label className="form-field">
            <span className="form-label">设置 4 位数字密码</span>
            <input
              className="input"
              type="password"
              value={pwd}
              maxLength={4}
              inputMode="numeric"
              placeholder="••••"
              onChange={(e) => setPwd(e.target.value.trim())}
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!TEEN_PASSWORD_RE.test(pwd)) {
                props.toast('密码须为 4 位数字')
                return
              }
              props.onEnable(pwd)
              setPwd('')
            }}
          >
            开启青少年模式
          </button>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        开启后全站按青少年口径过滤内容；开关写入本机身份域，内容域读取后生效。密码仅保存在本机，忘记后可通过注销本机数据重置。
      </p>
    </div>
  )
}
