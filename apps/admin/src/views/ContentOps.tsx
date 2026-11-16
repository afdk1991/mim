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

/** 每页条数：与用户管理保持一致 */
const PAGE_SIZE = 20;

/** 金额分转元 */
function yuan(value: number): string { // 业务步骤
  return `${(value / 100).toFixed(2)} 元`; // 推广预算展示
} // yuan 结束

/** 列表三态：加载中 / 失败 / 空，供三类内容复用，避免静默空列表 */
function ListState({ loading, error, empty }: { loading: boolean; error: unknown; empty: boolean }) {
  if (loading) return <p className="muted">加载中…</p>;
  if (error) return <p className="error">列表加载失败：{describeError(error)}</p>;
  if (empty) return <p className="empty">还没有记录，用上方表单新建一条即可。</p>;
  return null;
}

/** 删除前的二次确认：破坏性操作不可撤销，统一走原生确认框 */
function confirmDelete(kind: string, name: string): boolean {
  return window.confirm(`确认删除${kind}「${name}」？删除后不可恢复。`);
}

/** 分页器：上一页 / 区间文案 / 下一页，与用户管理保持一致 */
function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (next: number) => void }) {
  return (
    <div className="pager">
      <button className="btn ghost" type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
      <span className="muted">{total === 0 ? '0 / 0' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total}`}</span>
      <button className="btn ghost" type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>下一页</button>
    </div>
  );
}

/** 内容运营视图主体 */
export function ContentOps({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('appearance:write'); // 后端 content-ops 复用 appearance:write
  const [tab, setTab] = useState<Tab>('announcements'); // 当前页签
  const [error, setError] = useState(''); // 错误提示
  const [notice, setNotice] = useState(''); // 成功提示
  const [busy, setBusy] = useState(false); // 操作中
  const [annOffset, setAnnOffset] = useState(0); // 公告当前页偏移
  const [logOffset, setLogOffset] = useState(0); // 更新日志当前页偏移
  const [promoOffset, setPromoOffset] = useState(0); // 推广计划当前页偏移
  const announcementsState = useAsync(() => listAdminAnnouncements(credential, { limit: PAGE_SIZE, offset: annOffset }), [credential, annOffset]); // 公告
  const changelogState = useAsync(() => listAdminChangelog(credential, { limit: PAGE_SIZE, offset: logOffset }), [credential, logOffset]); // 更新日志
  const promotionsState = useAsync(() => listAdminPromotions(credential, { limit: PAGE_SIZE, offset: promoOffset }), [credential, promoOffset]); // 推广
  const announcements = announcementsState.data?.items ?? []; // 公告当前页
  const changelog = changelogState.data?.items ?? []; // 日志当前页
  const promotions = promotionsState.data?.items ?? []; // 推广当前页
  const announcementsTotal = announcementsState.data?.total ?? 0; // 公告总数
  const changelogTotal = changelogState.data?.total ?? 0; // 日志总数
  const promotionsTotal = promotionsState.data?.total ?? 0; // 推广总数
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

  return ( // 返回当前函数的处理结果
    <div className="page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h1>内容运营</h1>
        <p className="page-desc">产品公告、更新日志与推广计划：草稿、发布、归档全流程可操作，公开端点立即生效。</p>
      </header>

      {!canWrite && <div className="panel hint">当前账号缺少 appearance:write 权限，仅可查看，不能新建或修改内容。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <div className="tabs">{/* 执行当前业务步骤 */}
        <button type="button" className={`tab${tab === 'announcements' ? ' active' : ''}`} onClick={() => setTab('announcements')}>公告</button>
        <button type="button" className={`tab${tab === 'changelog' ? ' active' : ''}`} onClick={() => setTab('changelog')}>更新日志</button>
        <button type="button" className={`tab${tab === 'promotions' ? ' active' : ''}`} onClick={() => setTab('promotions')}>推广计划</button>
      </div>

      {tab === 'announcements' && (
        <>{/* 执行当前业务步骤 */}
          <section className="panel">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>新建公告</h3></div>
            <div className="form inline">{/* 执行当前业务步骤 */}
              <label className="grow">标题<input value={annForm.title} onChange={(event) => setAnnForm({ ...annForm, title: event.target.value })} /></label>
              <label>级别{/* 执行当前业务步骤 */}
                <select value={annForm.level} onChange={(event) => setAnnForm({ ...annForm, level: event.target.value })}>{/* 执行当前业务步骤 */}
                  <option value="info">info</option><option value="success">success</option><option value="warning">warning</option><option value="danger">danger</option>
                </select>
              </label>
              <label>状态{/* 执行当前业务步骤 */}
                <select value={annForm.status} onChange={(event) => setAnnForm({ ...annForm, status: event.target.value })}>{/* 执行当前业务步骤 */}
                  <option value="published">发布</option><option value="draft">草稿</option><option value="archived">归档</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={annForm.pinned} onChange={(event) => setAnnForm({ ...annForm, pinned: event.target.checked })} />置顶</label>
            </div>
            <label className="field">正文{/* 执行当前业务步骤 */}
              <textarea value={annForm.body} onChange={(event) => setAnnForm({ ...annForm, body: event.target.value })} rows={4} />
            </label>
            <button type="button" className="btn primary" disabled={busy || !canWrite || annForm.title.trim().length === 0} onClick={() => void run(async () => {{/* 执行当前业务步骤 */}
              await createAnnouncement(credential, { title: annForm.title.trim(), body: annForm.body, level: annForm.level, status: annForm.status, pinned: annForm.pinned }); // 创建
              setAnnForm({ title: '', body: '', level: 'info', status: 'published', pinned: false }); // 清空
            }, '公告已创建', announcementsState.reload)}>创建公告</button>
          </section>
          <section className="panel">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>公告列表</h3><span className="muted">{announcementsTotal}</span></div>
            <ListState loading={announcementsState.loading} error={announcementsState.error} empty={announcements.length === 0} />
            {announcements.map((row: AdminAnnouncement) => (
              <div className="deploy-row" key={row.id}>{/* 执行当前业务步骤 */}
                <div className="deploy-kv">{/* 执行当前业务步骤 */}
                  <span>{row.pinned ? '📌 ' : ''}{row.title}</span>
                  <span className={`badge ${row.status === 'published' ? 'success' : 'warning'}`}>{row.status}</span>
                  <span className="muted">{row.level} · {row.created_at.slice(0, 16)}</span>
                </div>
                <div className="deploy-columns">{/* 执行当前业务步骤 */}
                  {row.status !== 'published' && <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updateAnnouncement(credential, row.id, { status: 'published' }), '公告已发布', announcementsState.reload)}>发布</button>}
                  {row.status === 'published' && <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updateAnnouncement(credential, row.id, { status: 'archived' }), '公告已归档', announcementsState.reload)}>归档</button>}
                  <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => { if (confirmDelete('公告', row.title)) void run(() => deleteAnnouncement(credential, row.id), '公告已删除', announcementsState.reload); }}>删除</button>
                </div>
              </div>
            ))}
            <Pager offset={annOffset} total={announcementsTotal} onChange={setAnnOffset} />
          </section>
        </>
      )}

      {tab === 'changelog' && (
        <>{/* 执行当前业务步骤 */}
          <section className="panel">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>新建更新日志</h3></div>
            <div className="form inline">{/* 执行当前业务步骤 */}
              <label>版本号<input value={logForm.version} onChange={(event) => setLogForm({ ...logForm, version: event.target.value })} placeholder="0.0.10" /></label>
              <label className="grow">标题<input value={logForm.title} onChange={(event) => setLogForm({ ...logForm, title: event.target.value })} /></label>
              <label>状态{/* 执行当前业务步骤 */}
                <select value={logForm.status} onChange={(event) => setLogForm({ ...logForm, status: event.target.value })}>{/* 执行当前业务步骤 */}
                  <option value="published">发布</option><option value="draft">草稿</option><option value="archived">归档</option>
                </select>
              </label>
            </div>
            <label className="field">正文<textarea value={logForm.body} onChange={(event) => setLogForm({ ...logForm, body: event.target.value })} rows={3} /></label>
            <label className="field">变更清单（每行一条）<textarea value={logForm.changes} onChange={(event) => setLogForm({ ...logForm, changes: event.target.value })} rows={4} /></label>
            <button type="button" className="btn primary" disabled={busy || !canWrite || logForm.version.trim().length === 0 || logForm.title.trim().length === 0} onClick={() => void run(async () => {{/* 执行当前业务步骤 */}
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
          <section className="panel">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>版本记录</h3><span className="muted">{changelogTotal}</span></div>
            <ListState loading={changelogState.loading} error={changelogState.error} empty={changelog.length === 0} />
            {changelog.map((row: AdminChangelog) => (
              <div className="deploy-row" key={row.id}>{/* 执行当前业务步骤 */}
                <div className="deploy-kv">{/* 执行当前业务步骤 */}
                  <span><strong>{row.version}</strong> · {row.title}</span>
                  <span className={`badge ${row.status === 'published' ? 'success' : 'warning'}`}>{row.status}</span>
                  <span className="muted">{row.published_at?.slice(0, 10) ?? row.created_at.slice(0, 10)}</span>
                </div>
                <div className="deploy-columns">{/* 执行当前业务步骤 */}
                  {row.status !== 'published' && <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updateChangelog(credential, row.id, { status: 'published' }), '更新日志已发布', changelogState.reload)}>发布</button>}
                  <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => { if (confirmDelete('更新日志', `${row.version} ${row.title}`)) void run(() => deleteChangelog(credential, row.id), '更新日志已删除', changelogState.reload); }}>删除</button>
                </div>
              </div>
            ))}
            <Pager offset={logOffset} total={changelogTotal} onChange={setLogOffset} />
          </section>
        </>
      )}

      {tab === 'promotions' && (
        <>{/* 执行当前业务步骤 */}
          <section className="panel">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>新建推广计划</h3></div>
            <div className="form inline">{/* 执行当前业务步骤 */}
              <label>名称<input value={promoForm.name} onChange={(event) => setPromoForm({ ...promoForm, name: event.target.value })} /></label>
              <label>推广码<input value={promoForm.code} onChange={(event) => setPromoForm({ ...promoForm, code: event.target.value })} placeholder="可选" /></label>
              <label>状态{/* 执行当前业务步骤 */}
                <select value={promoForm.status} onChange={(event) => setPromoForm({ ...promoForm, status: event.target.value })}>{/* 执行当前业务步骤 */}
                  <option value="active">进行中</option><option value="draft">草稿</option><option value="paused">暂停</option><option value="archived">归档</option>
                </select>
              </label>
              <label>预算（元）<input value={promoForm.budget} onChange={(event) => setPromoForm({ ...promoForm, budget: event.target.value })} inputMode="decimal" /></label>
            </div>
            <div className="form inline">{/* 执行当前业务步骤 */}
              <label className="grow">摘要<input value={promoForm.summary} onChange={(event) => setPromoForm({ ...promoForm, summary: event.target.value })} /></label>
              <label className="grow">落地页<input value={promoForm.target_url} onChange={(event) => setPromoForm({ ...promoForm, target_url: event.target.value })} placeholder="https://… 或站内路径" /></label>
            </div>
            <button type="button" className="btn primary" disabled={busy || !canWrite || promoForm.name.trim().length === 0} onClick={() => void run(async () => {{/* 执行当前业务步骤 */}
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
          <section className="panel">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>推广计划列表</h3><span className="muted">{promotionsTotal}</span></div>
            <ListState loading={promotionsState.loading} error={promotionsState.error} empty={promotions.length === 0} />
            {promotions.map((row: AdminPromotion) => (
              <div className="deploy-row" key={row.id}>{/* 执行当前业务步骤 */}
                <div className="deploy-kv">{/* 执行当前业务步骤 */}
                  <span>{row.name}{row.code ? ` · ${row.code}` : ''}</span>
                  <span className={`badge ${row.status === 'active' ? 'success' : 'warning'}`}>{row.status}</span>
                  <span className="muted">点击 {row.click_count} · 转化 {row.conversion_count} · 预算 {yuan(row.budget_cents)}</span>
                </div>
                <div className="deploy-columns">{/* 执行当前业务步骤 */}
                  {row.status === 'active' ? <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updatePromotion(credential, row.id, { status: 'paused' }), '推广计划已暂停', promotionsState.reload)}>暂停</button> : <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void run(() => updatePromotion(credential, row.id, { status: 'active' }), '推广计划已启用', promotionsState.reload)}>启用</button>}
                  {row.target_url ? <a className="btn ghost small" href={row.target_url} target="_blank" rel="noreferrer">落地页</a> : null}
                  <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => { if (confirmDelete('推广计划', row.name)) void run(() => deletePromotion(credential, row.id), '推广计划已删除', promotionsState.reload); }}>删除</button>
                </div>
              </div>
            ))}
            <Pager offset={promoOffset} total={promotionsTotal} onChange={setPromoOffset} />
          </section>
        </>
      )}
    </div>
  ); // 执行当前业务步骤
} // ContentOps 结束
