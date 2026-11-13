// 社区运营视图：待审板块、论坛首页指向、建板块审核开关、推荐权重与板块 Tab 配置
import { useState } from 'react'; // 表单状态
import type { BoardTab, Credential, PendingBoard, RecommendWeights } from '../api'; // 类型
import { // 业务步骤
  approveBoard,
  describeError,
  getBoardTabs,
  getCommunityHome,
  getCommunityReview,
  getRecommendWeights,
  listPendingBoards,
  rejectBoard,
  saveBoardTabs,
  setCommunityHome,
  setCommunityReview,
  setRecommendWeights,
} from '../api'; // 社区运营 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限
} // Props 结束

/** 社区运营主体 */
export function CommunityAdmin({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('appearance:write'); // 社区运营复用 appearance:write
  const pendingState = useAsync(() => (canWrite ? listPendingBoards(credential) : Promise.resolve<PendingBoard[]>([])), [credential, canWrite]); // 待审板块
  const homeState = useAsync(() => (canWrite ? getCommunityHome(credential) : Promise.resolve<'community' | 'portal'>('portal')), [credential, canWrite]); // 首页指向
  const reviewState = useAsync(() => (canWrite ? getCommunityReview(credential) : Promise.resolve(false)), [credential, canWrite]); // 审核开关
  const weightsState = useAsync(() => getRecommendWeights(credential), [credential]); // 推荐权重
  const [error, setError] = useState(''); // 错误
  const [notice, setNotice] = useState(''); // 提示
  const [busy, setBusy] = useState(false); // 操作中
  const [rejecting, setRejecting] = useState<{ slug: string; note: string } | null>(null); // 驳回表单
  const [weights, setWeights] = useState<RecommendWeights | null>(null); // 权重编辑态
  const [tabSlug, setTabSlug] = useState(''); // 板块 slug
  const [tabs, setTabs] = useState<BoardTab[] | null>(null); // Tab 编辑态
  const [tabsText, setTabsText] = useState(''); // 原始 JSON 文本，便于一次调整多项

  /** 统一执行写操作：成功后刷新对应数据 */
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

  /** 载入板块 Tab 配置 */
  async function loadTabs() {
    if (!tabSlug.trim()) return; // 无 slug 直接返回
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    try { // 业务步骤
      const loaded = await getBoardTabs(credential, tabSlug.trim()); // 读取
      setTabs(loaded); // 保存结构化配置
      setTabsText(JSON.stringify(loaded, null, 2)); // 回显可编辑 JSON
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // loadTabs 结束

  /** 保存板块 Tab 配置：先做 JSON 解析，避免把坏格式发给后端 */
  async function saveTabs() {
    try { // 业务步骤
      const parsed = JSON.parse(tabsText) as BoardTab[]; // 解析
      if (!Array.isArray(parsed)) throw new Error('Tab 配置必须是数组'); // 结构校验
      await run(() => saveBoardTabs(credential, tabSlug.trim(), parsed), '板块 Tab 已保存', () => { setTabs(parsed); }); // 保存
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Tab 配置不是合法 JSON' : describeError(err)); // 解析错误单独提示
    } // 业务步骤
  } // saveTabs 结束

  const currentWeights = weights ?? weightsState.data?.weights ?? null; // 优先编辑态，其次已加载值

  return (
    <div className="page">
      <header className="page-head">
        <h1>社区运营</h1>
        <p className="muted">板块审核、论坛首页、发帖审核开关、推荐指数与 Tab 栏目配置：全部落到公开端点即时生效。</p>
      </header>

      {!canWrite && <div className="panel error">当前账号缺少 appearance:write 权限，运营操作不可用。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">
        <div className="panel-head"><h3>待审板块</h3><span className="muted">{(pendingState.data ?? []).length}</span><button type="button" className="btn ghost" onClick={pendingState.reload}>刷新</button></div>
        {pendingState.loading && <p className="muted">加载中…</p>}
        {(pendingState.data ?? []).length === 0 && !pendingState.loading ? <p className="empty">暂无待审板块</p> : null}
        {(pendingState.data ?? []).map((board) => (
          <article className="deploy-row" key={board.id}>
            <div className="deploy-kv">
              <strong>{board.icon ?? '📁'} {board.name}</strong>
              <span className="muted">/{board.slug} · 创建人 {board.creator_name ?? board.created_by ?? '—'}</span>
              <span className="badge warning">pending</span>
            </div>
            <p className="muted">{board.description || '无简介'} · 价格 {(board.price_cents / 100).toFixed(2)} 元 · 可见性 {board.visibility}</p>
            <div className="deploy-columns">
              <button type="button" className="btn primary small" disabled={busy || !canWrite} onClick={() => void run(() => approveBoard(credential, board.slug), `已通过 ${board.slug}`, pendingState.reload)}>通过</button>
              <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => setRejecting({ slug: board.slug, note: '' })}>驳回</button>
            </div>
            {rejecting?.slug === board.slug && (
              <div className="form inline" style={{ marginTop: 8 }}>
                <label className="grow">驳回原因<input value={rejecting.note} onChange={(event) => setRejecting({ ...rejecting, note: event.target.value })} /></label>
                <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void run(async () => {
                  await rejectBoard(credential, board.slug, rejecting.note); // 提交驳回
                  setRejecting(null); // 收起
                }, `已驳回 ${board.slug}`, pendingState.reload)}>确认</button>
                <button type="button" className="btn ghost" onClick={() => setRejecting(null)}>取消</button>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>论坛设为首页</h3></div>
        {homeState.loading ? <p className="muted">加载中…</p> : (
          <div className="form inline">
            <label>首页指向
              <select value={homeState.data ?? 'portal'} disabled={busy || !canWrite} onChange={(event) => void run(() => setCommunityHome(credential, event.target.value as 'community' | 'portal'), '首页指向已更新', homeState.reload)}>
                <option value="portal">门户首页（商城）</option>
                <option value="community">论坛首页</option>
              </select>
            </label>
            <span className="muted">论坛首页会启用 Tab 栏目 + 模块化区块组合。</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>建板块审核</h3></div>
        {reviewState.loading ? <p className="muted">加载中…</p> : (
          <label className="check">
            <input type="checkbox" checked={reviewState.data ?? false} disabled={busy || !canWrite} onChange={(event) => void run(() => setCommunityReview(credential, event.target.checked), '审核开关已更新', reviewState.reload)} />
            新建板块必须经过运营审核后才上架
          </label>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>推荐指数权重</h3><span className="muted">默认 {JSON.stringify(weightsState.data?.defaults ?? {})}</span></div>
        {currentWeights && (
          <div className="form inline">
            {(['views', 'replies', 'favorites', 'rating', 'halfLifeDays'] as const).map((key) => (
              <label key={key}>{key}
                <input value={String(currentWeights[key])} inputMode="decimal" onChange={(event) => setWeights({ ...currentWeights, [key]: Number(event.target.value) || 0 })} />
              </label>
            ))}
            <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void run(() => setRecommendWeights(credential, currentWeights), '推荐权重已保存', weightsState.reload)}>保存权重</button>
            <button type="button" className="btn ghost" onClick={() => setWeights(null)}>重置编辑</button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>板块 Tab 配置</h3></div>
        <div className="form inline">
          <label>板块 slug<input value={tabSlug} onChange={(event) => setTabSlug(event.target.value)} placeholder="例如 general" /></label>
          <button type="button" className="btn ghost" disabled={busy || !tabSlug.trim()} onClick={() => void loadTabs()}>读取配置</button>
        </div>
        {tabs && (
          <>
            <p className="muted">共 {tabs.length} 项，字段：key / label / visible / sort_order / sort_by。</p>
            <label className="field">Tab JSON<textarea value={tabsText} onChange={(event) => setTabsText(event.target.value)} rows={10} spellCheck={false} /></label>
            <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void saveTabs()}>保存 Tab 配置</button>
          </>
        )}
      </section>
    </div>
  );
} // CommunityAdmin 结束
