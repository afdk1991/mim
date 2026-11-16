// 设置：站点名称、副标题与页脚文案（复用 site_settings 的 site 键）
import { useEffect, useState } from 'react';
import { describeError } from '../api';
import type { Credential } from '../api';
import { getAppearanceOverview, saveAppearanceSetting } from '../api-ops';
import { useAsync } from '../hooks';

/** 入参：凭证与实时权限码 */
interface Props {
  credential: Credential;
  permissions: string[];
}

/** 站点设置在 site_settings.site 里的已知字段 */
interface SiteFields {
  // 站点主名
  title: string;
  // 站点副标题
  subtitle: string;
  // 页脚文案
  footer: string;
}

/** 从设置对象中取出站点三字段，缺失回落空串（保存时保留其余未知键） */
function pickSite(raw: unknown): SiteFields {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    title: typeof source.title === 'string' ? source.title : '',
    subtitle: typeof source.subtitle === 'string' ? source.subtitle : '',
    footer: typeof source.footer === 'string' ? source.footer : '',
  };
}

/** 设置主视图 */
export function Settings({ credential, permissions }: Props) {
  const canWrite = permissions.includes('appearance:write');
  const state = useAsync(() => getAppearanceOverview(credential), [credential]);
  const [form, setForm] = useState<SiteFields>({ title: '', subtitle: '', footer: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // 数据到达后同步表单；只依赖 settings.site，避免编辑中被无谓重置
  const siteRaw = state.data?.settings.site;
  useEffect(() => {
    if (siteRaw === undefined) return;
    setForm(pickSite(siteRaw));
  }, [siteRaw]);

  /** 保存：合并原对象，保留未知字段 */
  async function submit() {
    if (!form.title.trim()) {
      setError('站点主名不能为空');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const origin = siteRaw && typeof siteRaw === 'object' ? (siteRaw as Record<string, unknown>) : {};
      await saveAppearanceSetting(credential, 'site', { ...origin, ...form });
      setNotice('站点设置已保存');
      state.reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h2>设置</h2>
        <p className="page-desc">这里维护站点主名、副标题与页脚文案，保存后前台页头、浏览器标题与页脚会同步更新。</p>
      </header>

      {!canWrite ? <div className="hint">当前身份只有只读权限，无法保存设置。</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="panel">
        <div className="panel-head">
          <h3>站点信息</h3>
          <span className="muted">写入 site_settings.site</span>
        </div>

        {state.loading ? <p className="muted">加载中…</p> : null}
        {state.error ? <div className="error">{describeError(state.error)}</div> : null}

        <div className="form">
          <label className="field">
            <span>站点主名</span>
            <input
              value={form.title}
              disabled={!canWrite}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>副标题</span>
            <input
              value={form.subtitle}
              disabled={!canWrite}
              onChange={(event) => setForm((prev) => ({ ...prev, subtitle: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>页脚文案</span>
            <input
              value={form.footer}
              disabled={!canWrite}
              onChange={(event) => setForm((prev) => ({ ...prev, footer: event.target.value }))}
            />
          </label>
          {canWrite ? (
            <button className="btn primary" type="button" disabled={busy} onClick={submit}>
              {busy ? '保存中…' : '保存设置'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
