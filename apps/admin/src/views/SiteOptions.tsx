// 站点选项页：按后端注册表 schema 数据驱动渲染「Global & Features」十个分组。
// 设计要点：① 视图不硬编码任何字段，新增选项只改后端注册表；② 保存只提交变动的键，避免整表覆盖；
// ③ 分组级「恢复默认」与整页恢复默认都走后端 reset，保证清洗口径一致。

import { useEffect, useState } from 'react'; // 本地状态与首载
import { describeError } from '../api'; // 统一错误描述
import type { Credential } from '../api'; // 请求凭证
import { diffOptions, getSiteOptions, resetSiteOptions, saveSiteOptions } from '../api-site-options'; // 站点选项读写
import type { OptionField, OptionGroup, OptionTab, OptionValue, OptionValues } from '../api-site-options'; // 结构与取值类型

/** 页签内的分组卡片：渲染分组说明与逐字段控件 */
function GroupCard(props: {
  group: OptionGroup; // 分组结构
  values: OptionValues; // 当前取值
  canWrite: boolean; // 是否可写
  busy: boolean; // 全局保存中
  onChange: (key: string, value: OptionValue) => void; // 字段变更回调
  onResetGroup: (group: OptionGroup) => void; // 分组恢复默认
}) {
  const { group, values, canWrite, busy, onChange, onResetGroup } = props; // 解构入参
  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>{group.label}</h3>
          {group.description ? <p className="page-desc" style={{ margin: '6px 0 0' }}>{group.description}</p> : null}
        </div>
        <button className="btn small" type="button" disabled={!canWrite || busy} onClick={() => onResetGroup(group)}>
          恢复默认
        </button>
      </div>
      <div className="form" style={{ marginTop: 12 }}>
        {group.fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            value={values[field.key]}
            canWrite={canWrite}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
} // GroupCard 结束

/** 单字段控件：按类型选择 switch / number / select / textarea / 文本框 */
function FieldRow(props: {
  field: OptionField; // 字段定义
  value: OptionValue | undefined; // 当前值
  canWrite: boolean; // 是否可写
  onChange: (key: string, value: OptionValue) => void; // 变更回调
}) {
  const { field, value, canWrite, onChange } = props; // 解构入参
  const commonStyle = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--text)' }; // 控件统一样式
  if (field.type === 'switch') {
    return (
      <label className="field" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <input
          type="checkbox"
          checked={value === true}
          disabled={!canWrite}
          onChange={(event) => onChange(field.key, event.target.checked)}
        />
        <span style={{ color: 'var(--text)' }}>
          {field.label}
          {field.hint ? <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>{field.hint}</span> : null}
        </span>
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select
          value={typeof value === 'string' ? value : String(field.defaultValue)}
          disabled={!canWrite}
          style={commonStyle}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {field.hint ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{field.hint}</span> : null}
      </label>
    );
  }
  if (field.type === 'number') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <input
          type="number"
          value={typeof value === 'number' ? value : Number(field.defaultValue)}
          min={field.min}
          max={field.max}
          disabled={!canWrite}
          style={commonStyle}
          onChange={(event) => onChange(field.key, Number(event.target.value))}
        />
        {field.hint ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{field.hint}</span> : null}
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <textarea
          rows={5}
          value={typeof value === 'string' ? value : ''}
          disabled={!canWrite}
          style={{ ...commonStyle, fontFamily: 'inherit', resize: 'vertical' }}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
        {field.hint ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{field.hint}</span> : null}
      </label>
    );
  }
  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        disabled={!canWrite}
        style={commonStyle}
        placeholder={field.secretPlaceholder ? '环境变量名' : ''}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
      {field.hint ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{field.hint}</span> : null}
    </label>
  );
} // FieldRow 结束

/** 站点选项页入参 */
interface Props {
  credential: Credential; // 凭证
  permissions: string[]; // 当前身份权限码
} // Props 结束

/** 站点选项页：页签 → 分组 → 字段，保存只提交改动键 */
export function SiteOptions({ credential, permissions }: Props) {
  const canWrite = permissions.includes('appearance:write'); // 写权限决定控件可用性
  const [tabs, setTabs] = useState<OptionTab[]>([]); // 页签结构
  const [activeTab, setActiveTab] = useState<string>(''); // 当前页签
  const [baseline, setBaseline] = useState<OptionValues>({}); // 已保存的取值（用于差异计算）
  const [values, setValues] = useState<OptionValues>({}); // 编辑中的取值
  const [updatedAt, setUpdatedAt] = useState<string | null>(null); // 最后保存时间
  const [loading, setLoading] = useState(true); // 首次加载
  const [busy, setBusy] = useState(false); // 保存 / 重置中
  const [error, setError] = useState<string | null>(null); // 错误
  const [notice, setNotice] = useState<string | null>(null); // 成功提示

  useEffect(() => {
    let cancelled = false; // 卸载后丢弃异步结果
    setLoading(true); // 进入加载态
    getSiteOptions(credential)
      .then((payload) => {
        if (cancelled) return; // 已卸载不写状态
        setTabs(payload.tabs); // 页签结构
        setActiveTab(payload.tabs[0]?.key ?? ''); // 默认第一个页签
        setBaseline(payload.values); // 基准值
        setValues(payload.values); // 编辑值
        setUpdatedAt(payload.updated_at); // 保存时间
        setError(null); // 清错误
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err)); // 展示失败原因
      })
      .finally(() => {
        if (!cancelled) setLoading(false); // 结束加载态
      });
    return () => {
      cancelled = true; // 标记过期
    }; // 清理结束
  }, [credential]); // 凭证变化重新加载

  const patch = diffOptions(baseline, values); // 本次改动
  const dirtyCount = Object.keys(patch).length; // 改动条目数

  /** 字段变更：只改本地草稿，不立即落库 */
  function changeField(key: string, value: OptionValue) {
    setValues((prev) => ({ ...prev, [key]: value })); // 合并单键
    setNotice(null); // 有改动即清掉上一次成功提示
  } // changeField 结束

  /** 保存：只提交改动键，后端按注册表清洗合并 */
  async function save() {
    if (dirtyCount === 0) return; // 无改动不请求
    setBusy(true); // 防重复点击
    try {
      const result = await saveSiteOptions(credential, patch); // 局部写入
      setBaseline(result.values); // 基准同步为服务端最终值（含被清洗的字段）
      setValues(result.values); // 编辑值同步
      setUpdatedAt(result.updated_at); // 保存时间
      setNotice(`已保存 ${result.changed.length} 项`); // 提示改动数
      setError(null); // 清错误
    } catch (err) {
      setError(describeError(err)); // 展示失败原因
    } finally {
      setBusy(false); // 恢复按钮
    }
  } // save 结束

  /** 分组恢复默认：只重置该分组字段，其它分组不受影响 */
  async function resetGroup(group: OptionGroup) {
    setBusy(true); // 防重复点击
    try {
      const result = await resetSiteOptions(credential, group.fields.map((field) => field.key)); // 按分组键重置
      setBaseline(result.values); // 同步基准
      setValues(result.values); // 同步编辑值
      setUpdatedAt(result.updated_at); // 保存时间
      setNotice(`「${group.label}」已恢复默认（${result.changed.length} 项变更）`); // 提示
      setError(null); // 清错误
    } catch (err) {
      setError(describeError(err)); // 展示失败原因
    } finally {
      setBusy(false); // 恢复按钮
    }
  } // resetGroup 结束

  /** 整页恢复默认：一次把所有字段回到注册表默认值 */
  async function resetAll() {
    setBusy(true); // 防重复点击
    try {
      const result = await resetSiteOptions(credential); // 全量重置
      setBaseline(result.values); // 同步基准
      setValues(result.values); // 同步编辑值
      setUpdatedAt(result.updated_at); // 保存时间
      setNotice(`已恢复全部默认（${result.changed.length} 项变更）`); // 提示
      setError(null); // 清错误
    } catch (err) {
      setError(describeError(err)); // 展示失败原因
    } finally {
      setBusy(false); // 恢复按钮
    }
  } // resetAll 结束

  if (loading) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>站点选项</h1>
          <p className="page-desc">Global & Features：站点图标、SEO、布局、搜索、移动 Tab、悬浮按钮、多语言、社交分享、邮件与自定义代码。</p>
        </header>
        <p className="muted">正在读取站点选项…</p>
      </div>
    ); // 加载态保留页头
  } // 加载分支结束

  if (tabs.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>站点选项</h1>
          <p className="page-desc">Global & Features：站点图标、SEO、布局、搜索、移动 Tab、悬浮按钮、多语言、社交分享、邮件与自定义代码。</p>
        </header>
        <p className="error">{error ?? '站点选项读取失败'}</p>
      </div>
    ); // 失败态保留页头
  } // 空结构分支结束

  const current = tabs.find((tab) => tab.key === activeTab) ?? tabs[0]; // 当前页签

  return (
    <div className="page">
      <header className="page-head">
        <h1>站点选项</h1>
        <p className="page-desc">Global & Features：站点图标、SEO、布局、搜索、移动 Tab、悬浮按钮、多语言、社交分享、邮件与自定义代码。保存即时生效，前台按公开字段渲染。</p>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={tab.key === current.key ? 'btn primary small' : 'btn small'}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
          {updatedAt ? `最后保存 ${new Date(updatedAt).toLocaleString()}` : '尚未保存过'}
          {dirtyCount > 0 ? ` · 待保存 ${dirtyCount} 项` : ''}
        </span>
        <button className="btn primary" type="button" disabled={!canWrite || busy || dirtyCount === 0} onClick={save}>
          保存改动
        </button>
        <button className="btn" type="button" disabled={!canWrite || busy} onClick={resetAll}>
          全部恢复默认
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="cards" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {current.groups.map((group) => (
          <GroupCard
            key={group.key}
            group={group}
            values={values}
            canWrite={canWrite}
            busy={busy}
            onChange={changeField}
            onResetGroup={resetGroup}
          />
        ))}
      </div>
    </div>
  ); // 主体结束
} // SiteOptions 结束
