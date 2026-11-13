// 内容运营视图：公告 / 更新日志 / 推广计划三类内容的创建、状态流转与删除
import { useState } from 'react'; // 表单与页签状态
import type { AdminAnnouncement, AdminChangelog, AdminPromotion, Credential } from '../api'; // 类型
import { // 业务步骤
  createAnnouncement,
  createChangelog,
  createPromotion,
  deleteAnnouncement,
  deleteChangelog,
  deletePromotion,
  describeError,
  listAdminAnnouncements,
  listAdminChangelog,
  listAdminPromotions,
  updateAnnouncement,
  updateChangelog,
  updatePromotion,
} from '../api'; // 内容 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限
} // Props 结束

/** 页签类型 */
type Tab = 'announcements' | 'changelog' | 'promotions'; // 三类内容

/** 金额分转元 */
function yuan(value: number): string { // 业务步骤
  return `${(value / 100).toFixed(2)} 元`; // 推广预算展示
} // yuan 结束

/** 内容运营视图主体 */
export function ContentOps({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('appearance:write'); // 后端 content-ops 复用 appearance:write
  const [tab, setTab] = useState<Tab>('announcements'); // 当前页签
  const [error, setError] = useState(''); // 错误提示
  const [notice, setNotice] = useState(''); // 成功提示
  const [busy, setBusy] = useState(false); // 操作中
  const announcementsState = useAsync(() => listAdminAnnouncements(credential), [credential]); // 公告
  const changelogState = useAsync(() => listAdminChangelog(credential), [credential]); // 更新日志
  const promotionsState = useAsync(() => listAdminPromotions(credential), [credential]); // 推广
  const [annForm, setAnnForm] = useState({ title: '', body: '', level: 'info', status: 'published', pinned: false }); // 公告草稿
  const [logForm, setLogForm] = useState({ version: '', title: '', body: '', changes: '', status: 'published' }); // 日志草稿
  const [promoForm, setPromoForm] = useState({ name: '', summary: '', target_url: '', code: '', status: 'active', budget: '0' }); // 推广草稿

  /** 统一执行写操作：成功后刷新对应列表 */
  async function run(action: () => Promise<unknown>, success: string, reload: () => void) {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      await action(); // 执行
      setNotice(success); // 成功提示
      reload(); // 刷新
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // run 结束

  return (
    <div className="page">
      <header className="page-head">
        <h1>内容运营</h1>
        <p className="muted">产品公告、更新日志与推广计划：草稿、发布、归档全流程可操作，公开端点立即生效。</p>
      </header>

      {!canWrite && <div className="panel error">当前账号缺少 appearance:write 权限，仅可查看。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <div className="tabs">
        <button type="button" className={`btn ghost${tab === 'announcements' ? ' active' : ''}`} onClick={() => setTab('announcements')}>公告</button>
        <button type="button" className={`btn ghost${tab === 'changelog' ? ' active' : ''}`} onClick={() => setTab('changelog')}>更新日志</button>
        <button type="button" className={`btn ghost${tab === 'promotions' ? ' active' : ''}`} onClick={() => setTab('promotions')}>推广计划</button>
      </div>

      {tab === 'announcements' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>新建公告</h3></div>
            <div className="form inline">
              <label className="grow">标题<input value={annForm.title} onChange={(event) => setAnnForm({ ...annForm, title: event.target.value })} /></label>
              <label>级别
                <select value={annForm.level} onChange={(event) => setAnnForm({ ...annForm, level: event.target.value })}>
                  <option value="info">info</option><option value="success">success</option><option value="warning">warning</option><option value="danger">danger</option>
                </select>
              </label>
              <label>状态
                <select value={annForm.status} onChange={(event) => setAnnForm({ ...annForm, status: event.target.value })}>
                  <option value="published">发布</option><option value="draft">草稿</option><option value="archived">归档</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={annForm.pinned} onChange={(event) => setAnnForm({ ...annForm, pinned: event.target.checked })} />置顶</label>
            </div>
            <label className="field">正文
              <textarea value={annForm.body} onChange={(event) => setAnnForm({ ...annForm, body: event.target.value })} rows={4} />
            </label>
            <button type="button" className="btn primary" disabled={busy || !canWrite || annForm.title.trim().length === 0} onClick={() => void run(async () => {
              await createAnnouncement(credential, { title: annForm.title.trim(), body: annForm.body, level: annForm.level, status: annForm.status, pinned: annForm.pinned }); // 创建
              setAnnForm({ title: '', body: '', level: 'info', status: 'published', pinned: false }); // 清空
            }, '公告已创建', announcementsState.reload)}>创建公告</button>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>公告列表</h3><span className="muted">{(announcementsState.data ?? []).length}</span></div>
            {announcementsState.loading && <p className="muted">加载中…</p>}
            {(announcementsState.data ?? []).map((row: AdminAnnouncement) => (
              <div className="deploy-row" key={row.id}>
                <div className="deploy-kv">
                  <span>{row.pinned ? '📌 ' : ''}{row.title}</span>
                  <span className={`badge ${row.status === 'published' ? 'success' : 'warning'}`}>{row.status}</span>
                  <span className="muted">{row.level} · {row.created_at.slice(0, 16)}</span>
                </div>
                <div className="deploy-columns">
                  {row.status !== 'published' && <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updateAnnouncement(credential, row.id, { status: 'published' }), '公告已发布', announcementsState.reload)}>发布</button>}
                  {row.status === 'published' && <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updateAnnouncement(credential, row.id, { status: 'archived' }), '公告已归档', announcementsState.reload)}>归档</button>}
                  <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => deleteAnnouncement(credential, row.id), '公告已删除', announcementsState.reload)}>删除</button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {tab === 'changelog' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>新建更新日志</h3></div>
            <div className="form inline">
              <label>版本号<input value={logForm.version} onChange={(event) => setLogForm({ ...logForm, version: event.target.value })} placeholder="0.0.10" /></label>
              <label className="grow">标题<input value={logForm.title} onChange={(event) => setLogForm({ ...logForm, title: event.target.value })} /></label>
              <label>状态
                <select value={logForm.status} onChange={(event) => setLogForm({ ...logForm, status: event.target.value })}>
                  <option value="published">发布</option><option value="draft">草稿</option><option value="archived">归档</option>
                </select>
              </label>
            </div>
            <label className="field">正文<textarea value={logForm.body} onChange={(event) => setLogForm({ ...logForm, body: event.target.value })} rows={3} /></label>
            <label className="field">变更清单（每行一条）<textarea value={logForm.changes} onChange={(event) => setLogForm({ ...logForm, changes: event.target.value })} rows={4} /></label>
            <button type="button" className="btn primary" disabled={busy || !canWrite || logForm.version.trim().length === 0 || logForm.title.trim().length === 0} onClick={() => void run(async () => {
              await createChangelog(credential, { // 业务步骤
                version: logForm.version.trim(), // 语义版本
                title: logForm.title.trim(), // 标题
                body: logForm.body, // 正文
                changes: logForm.changes.split('\n').map((item) => item.trim()).filter(Boolean), // 逐行变更
                status: logForm.status, // 状态
              });
              setLogForm({ version: '', title: '', body: '', changes: '', status: 'published' }); // 清空
            }, '更新日志已创建', changelogState.reload)}>创建</button>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>版本记录</h3><span className="muted">{(changelogState.data ?? []).length}</span></div>
            {changelogState.loading && <p className="muted">加载中…</p>}
            {(changelogState.data ?? []).map((row: AdminChangelog) => (
              <div className="deploy-row" key={row.id}>
                <div className="deploy-kv">
                  <span><strong>{row.version}</strong> · {row.title}</span>
                  <span className={`badge ${row.status === 'published' ? 'success' : 'warning'}`}>{row.status}</span>
                  <span className="muted">{row.published_at?.slice(0, 10) ?? row.created_at.slice(0, 10)}</span>
                </div>
                <div className="deploy-columns">
                  {row.status !== 'published' && <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updateChangelog(credential, row.id, { status: 'published' }), '更新日志已发布', changelogState.reload)}>发布</button>}
                  <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => deleteChangelog(credential, row.id), '更新日志已删除', changelogState.reload)}>删除</button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {tab === 'promotions' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>新建推广计划</h3></div>
            <div className="form inline">
              <label>名称<input value={promoForm.name} onChange={(event) => setPromoForm({ ...promoForm, name: event.target.value })} /></label>
              <label>推广码<input value={promoForm.code} onChange={(event) => setPromoForm({ ...promoForm, code: event.target.value })} placeholder="可选" /></label>
              <label>状态
                <select value={promoForm.status} onChange={(event) => setPromoForm({ ...promoForm, status: event.target.value })}>
                  <option value="active">进行中</option><option value="draft">草稿</option><option value="paused">暂停</option><option value="archived">归档</option>
                </select>
              </label>
              <label>预算（元）<input value={promoForm.budget} onChange={(event) => setPromoForm({ ...promoForm, budget: event.target.value })} inputMode="decimal" /></label>
            </div>
            <div className="form inline">
              <label className="grow">摘要<input value={promoForm.summary} onChange={(event) => setPromoForm({ ...promoForm, summary: event.target.value })} /></label>
              <label className="grow">落地页<input value={promoForm.target_url} onChange={(event) => setPromoForm({ ...promoForm, target_url: event.target.value })} placeholder="https://… 或站内路径" /></label>
            </div>
            <button type="button" className="btn primary" disabled={busy || !canWrite || promoForm.name.trim().length === 0} onClick={() => void run(async () => {
              await createPromotion(credential, { // 业务步骤
                name: promoForm.name.trim(), // 名称
                summary: promoForm.summary, // 摘要
                target_url: promoForm.target_url, // 落地页
                code: promoForm.code.trim() || null, // 推广码
                status: promoForm.status, // 状态
                budget_cents: Math.round(Number(promoForm.budget || 0) * 100), // 元转分
              });
              setPromoForm({ name: '', summary: '', target_url: '', code: '', status: 'active', budget: '0' }); // 清空
            }, '推广计划已创建', promotionsState.reload)}>创建</button>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>推广计划列表</h3><span className="muted">{(promotionsState.data ?? []).length}</span></div>
            {promotionsState.loading && <p className="muted">加载中…</p>}
            {(promotionsState.data ?? []).map((row: AdminPromotion) => (
              <div className="deploy-row" key={row.id}>
                <div className="deploy-kv">
                  <span>{row.name}{row.code ? ` · ${row.code}` : ''}</span>
                  <span className={`badge ${row.status === 'active' ? 'success' : 'warning'}`}>{row.status}</span>
                  <span className="muted">点击 {row.click_count} · 转化 {row.conversion_count} · 预算 {yuan(row.budget_cents)}</span>
                </div>
                <div className="deploy-columns">
                  {row.status === 'active' ? <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updatePromotion(credential, row.id, { status: 'paused' }), '推广计划已暂停', promotionsState.reload)}>暂停</button> : <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updatePromotion(credential, row.id, { status: 'active' }), '推广计划已启用', promotionsState.reload)}>启用</button>}
                  {row.target_url ? <a className="btn ghost small" href={row.target_url} target="_blank" rel="noreferrer">落地页</a> : null}
                  <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => deletePromotion(credential, row.id), '推广计划已删除', promotionsState.reload)}>删除</button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
} // ContentOps 结束
