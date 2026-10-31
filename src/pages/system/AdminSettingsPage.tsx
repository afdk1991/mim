/* ==========================================================================
 * 后台配置页 —— #/admin/settings
 *
 * 四分区：
 *   1. 支付配置：扫码收款码 URL / 收款备注 / 商户号（只读脱敏回显）
 *   2. 备案与主体：ICP / 公安 / 主体 / 信用代码 / 域名
 *   3. 站点：客服邮箱 / 地址 / 站点头图
 *   4. 部署与 CI：服务器信息与 GitHub Secrets 配置清单（只读核对表）
 *
 * 契约（与后端并行实现的 config_get / admin_config_set 对齐）：
 *   - GET  config_get        → RPC 返回 { data: { key: value, ... } }
 *   - POST admin_config_set → 入参 { p_updates: [{ key, value }] }
 *   - 敏感键（merchant_id 等）由后端在 config_get 时返回脱敏串（如 ****1234），
 *     前端原样回显、不做二次还原；提交时也不回写这些键。
 *
 * 红线：本页不预置任何真实证照 / 商户号，所有敏感信息必须由运营方在后台写入。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { db } from '../../data/client'
import { errText } from '../../core/result'
import { getSiteConfig, applyRuntimeConfigPatch } from '../../core/runtime-config'
import { API_BASE, isBackendConfigured } from '../../core/config'
import { Empty, Skeleton, Tag, useToast } from '../../ui'

interface FieldDef {
  key: string
  label: string
  placeholder?: string
  hint?: string
  /** 敏感只读：不渲染输入框，直接展示后端返回的脱敏串 */
  sensitive?: boolean
}

interface SectionDef {
  title: string
  emoji: string
  fields: FieldDef[]
}

const SECTIONS: SectionDef[] = [
  {
    title: '支付配置',
    emoji: '💳',
    fields: [
      { key: 'payQrCodeUrl', label: '扫码收款码 URL', placeholder: 'https://…/qrcode.png', hint: '留空则扫码支付通道关闭' },
      { key: 'payQrNote', label: '收款备注', placeholder: '付款时请备注 Mim + 用户名' },
      { key: 'merchantId', label: '商户号（只读脱敏）', sensitive: true, hint: '由后端 Secrets 注入，不在此页编辑' },
    ],
  },
  {
    title: '备案与主体',
    emoji: '📜',
    fields: [
      { key: 'owner', label: '主办单位 / 主体名称', placeholder: '待主体填写' },
      { key: 'icp', label: 'ICP 备案号', placeholder: '待主体填写' },
      { key: 'policeBeian', label: '公安联网备案号', placeholder: '待主体填写' },
      { key: 'creditCode', label: '统一社会信用代码', placeholder: '待主体填写' },
      { key: 'domain', label: '正式域名', placeholder: 'example.com' },
    ],
  },
  {
    title: '站点',
    emoji: '🌱',
    fields: [
      { key: 'contactEmail', label: '客服邮箱', placeholder: 'hi@example.com' },
      { key: 'address', label: '联系地址', placeholder: '待主体填写' },
      { key: 'heroImage', label: '站点头图 URL', placeholder: 'https://…/hero.jpg（可留空）' },
    ],
  },
]

const SECRETS_CHECKLIST: Array<{ name: string; purpose: string }> = [
  { name: 'EDGEONE_API_TOKEN', purpose: 'EdgeOne Makers 静态站发布 token（.github/workflows/deploy.yml）' },
  { name: 'SSH_PRIVATE_KEY', purpose: '部署到自建 VPS 的 SSH 私钥（deploy.yml）' },
  { name: 'SSH_KNOWN_HOSTS', purpose: '远端主机指纹（TOFU，防中间人）' },
  { name: 'TAURI_SIGNING_PRIVATE_KEY', purpose: 'Tauri updater 签名密钥（build-release.yml）' },
  { name: 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', purpose: 'Tauri 签名密钥口令' },
]

export function AdminSettingsPage() {
  return (
    <AdminGate>
      <SettingsInner />
    </AdminGate>
  )
}

function SettingsInner() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  // 进入页面时拉取当前值（含后端脱敏回显）
  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      const r = await db.rpc<Record<string, unknown>>('config_get', {})
      if (!alive) return
      setLoading(false)
      if (!r.ok) {
        setError(errText(r.error))
        // 失败时仍用本地默认值初始化表单，避免后端临时不可达就什么都改不了
        const cfg = getSiteConfig()
        const init: Record<string, string> = {}
        for (const s of SECTIONS) for (const f of s.fields) {
          init[f.key] = (cfg as unknown as Record<string, string>)[f.key] ?? ''
        }
        setValues(init)
        return
      }
      setError(null)
      const init: Record<string, string> = {}
      for (const s of SECTIONS) for (const f of s.fields) {
        const v = r.data?.[f.key]
        init[f.key] = typeof v === 'string' ? v : ''
      }
      setValues(init)
    })()
    return () => {
      alive = false
    }
  }, [])

  const setField = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }))

  const save = async () => {
    setSaving(true)
    // 只提交非敏感键；敏感键由后端管理，前端不回写
    const p_updates = SECTIONS.flatMap((s) => s.fields)
      .filter((f) => !f.sensitive)
      .map((f) => ({ key: f.key, value: values[f.key] ?? '' }))
    const r = await db.rpc('admin_config_set', { p_updates }, { write: true })
    setSaving(false)
    if (!r.ok) {
      toast(`保存失败：${errText(r.error)}`)
      return
    }
    // 立即应用到前端运行期配置（下次进入信息页 / 页脚直接生效）
    const patch: Record<string, string> = {}
    for (const u of p_updates) patch[u.key] = u.value
    applyRuntimeConfigPatch(patch)
    toast('已保存并即时生效')
  }

  return (
    <div className="page page-grid single">
      <h1 className="page-title">⚙️ 站点配置</h1>

      <p className="muted" style={{ fontSize: 12 }}>
        保存后即时合并到前端运行期配置（默认值真源在 <code>src/core/config.ts</code>）；法定登记信息请按真实证照填写，留空会在信息页显示占位文案。
      </p>

      {loading ? (
        <Skeleton rows={4} height={72} />
      ) : (
        <>
          {error ? (
            <div className="card">
              <Empty emoji="⚠️" text={`读取当前配置失败：${error}`} />
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>已用本地默认值填充表单，保存仍会提交到后端。</p>
            </div>
          ) : null}

          {SECTIONS.map((sec) => (
            <div className="card" key={sec.title}>
              <div className="section-title" style={{ marginTop: 0 }}>
                {sec.emoji} {sec.title}
              </div>
              <div className="col" style={{ gap: 10 }}>
                {sec.fields.map((f) =>
                  f.sensitive ? (
                    <div key={f.key} className="row" style={{ alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 180 }}>{f.label}</span>
                      <Tag>{values[f.key] || '未配置（由后端 Secrets 注入）'}</Tag>
                    </div>
                  ) : (
                    <label key={f.key} className="row" style={{ alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 180 }}>{f.label}</span>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        value={values[f.key] ?? ''}
                        placeholder={f.placeholder}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    </label>
                  ),
                )}
                {sec.fields.some((f) => f.hint) ? (
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                    {sec.fields.filter((f) => f.hint).map((f) => (
                      <span key={f.key} style={{ marginRight: 12 }}>
                        · {f.hint}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            </div>
          ))}

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              🚀 部署与 CI（只读核对表）
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              以下 Secrets 必须在仓库 GitHub → Settings → Secrets and variables → Actions 中配置，前端无法代为写入：
            </p>
            <div className="kv-table">
              <div className="kv-row">
                <span className="muted">后端接口</span>
                <span>{isBackendConfigured() ? API_BASE : '未配置（纯本地模式）'}</span>
              </div>
              {SECRETS_CHECKLIST.map((s) => (
                <div className="kv-row" key={s.name}>
                  <span className="muted">
                    <code>{s.name}</code>
                  </span>
                  <span style={{ fontSize: 12 }}>{s.purpose}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="row">
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存并即时生效'}
            </button>
            <a className="btn btn-ghost" href="#/admin">
              返回后台首页
            </a>
          </div>
        </>
      )}
    </div>
  )
}
