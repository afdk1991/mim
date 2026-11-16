/** 成长私信：运营按条件或指定用户，发送一条系统身份私信。
 *
 * 复用点：沿用现有 IM 会话与消息表、现有 RBAC（messaging:write）与现有后台外壳；
 * 本页只负责挑选受众、预览人数、幂等发送与查看批次台账。
 */

import { useState } from 'react'; // 本地状态
import type { Credential, GrowthDmAudienceInput, GrowthDmPreview, UserListRow } from '../api'; // 接口类型
import {
  ApiError, // 结构化错误
  describeError, // 错误文案
  listGrowthDmCampaigns, // 批次台账
  listUsers, // 复用现有用户检索
  previewGrowthDm, // 受众预览
  sendGrowthDm, // 幂等发送
} from '../api'; // 接口方法
import { useAsync } from '../hooks'; // 异步加载

/** 界面入参：当前凭证与权限集合 */
interface Props {
  credential: Credential; // 后台凭证
  permissions: string[]; // 当前身份权限码
} // Props 结束

/** 生成一个可读的幂等键：日期 + 随机串，运营可改，重复提交同一键不会二次群发 */
function makeDedupeKey(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // 日期片段
  const rand = Math.random().toString(36).slice(2, 8); // 随机片段
  return `growthdm:${day}:${rand}`; // 形如 growthdm:20261115:ab12cd
} // makeDedupeKey 结束

/** 成长私信页面 */
export function GrowthDm({ credential, permissions }: Props) {
  const canWrite = permissions.includes('messaging:write'); // 是否具备发送权限
  const [title, setTitle] = useState(''); // 批次标题
  const [body, setBody] = useState(''); // 私信正文
  const [linkUrl, setLinkUrl] = useState(''); // 跳转地址
  const [linkLabel, setLinkLabel] = useState(''); // 跳转按钮文案
  const [dedupeKey, setDedupeKey] = useState(makeDedupeKey()); // 幂等键
  const [mode, setMode] = useState<'filters' | 'users'>('filters'); // 受众模式
  const [region, setRegion] = useState<'' | 'cn' | 'global'>(''); // 地区筛选
  const [createdAfter, setCreatedAfter] = useState(''); // 注册时间下界
  const [createdBefore, setCreatedBefore] = useState(''); // 注册时间上界
  const [query, setQuery] = useState(''); // 昵称 / Mim ID 关键词
  const [limit, setLimit] = useState(500); // 单批上限
  const [userQuery, setUserQuery] = useState(''); // 指定用户检索词
  const [userResults, setUserResults] = useState<UserListRow[]>([]); // 检索结果
  const [selected, setSelected] = useState<UserListRow[]>([]); // 已选用户
  const [preview, setPreview] = useState<GrowthDmPreview | null>(null); // 预览结果
  const [busy, setBusy] = useState(false); // 请求进行中
  const [error, setError] = useState<string | null>(null); // 错误文案
  const [notice, setNotice] = useState<string | null>(null); // 成功提示
  const campaignsState = useAsync(() => listGrowthDmCampaigns(credential, 20), [credential]); // 批次台账

  /** 组装受众条件：指定名单优先，否则用筛选条件；空条件返回 null 避免误发全量 */
  const buildAudience = (): GrowthDmAudienceInput | null => {
    if (mode === 'users') {
      if (selected.length === 0) return null; // 未选人
      return { user_ids: selected.map((u) => u.id) };
    }
    const audience: GrowthDmAudienceInput = { limit };
    if (region) audience.region = region;
    if (createdAfter) audience.created_after = `${createdAfter}T00:00:00.000Z`; // 当天零点
    if (createdBefore) audience.created_before = `${createdBefore}T23:59:59.999Z`; // 当天终点
    if (query.trim()) audience.query = query.trim();
    const hasCondition = Boolean(region || createdAfter || createdBefore || query.trim()); // 至少一个条件
    return hasCondition ? audience : null;
  }; // buildAudience 结束

  /** 统一执行异步动作并处理错误与提示 */
  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : describeError(err));
    } finally {
      setBusy(false);
    }
  }; // run 结束

  /** 预览受众：只读，不写库 */
  const handlePreview = () =>
    run(async () => {
      const audience = buildAudience();
      if (!audience) throw new Error('请先选择用户或填写至少一个筛选条件');
      setPreview(await previewGrowthDm(credential, audience));
    });

  /** 发送：dedupe_key 相同即幂等，重复点击只回执既有批次 */
  const handleSend = () =>
    run(async () => {
      const audience = buildAudience();
      if (!audience) throw new Error('请先选择用户或填写至少一个筛选条件');
      if (!title.trim() || !body.trim()) throw new Error('标题与正文不能为空');
      // 二次确认：群发不可撤回，先把受众规模告诉运营
      const size = preview ? `预计 ${preview.count} 人` : mode === 'users' ? `指定 ${selected.length} 人` : '按当前筛选条件';
      if (!window.confirm(`确认发送系统私信？受众：${size}。发送后不可撤回。`)) return;
      const result = await sendGrowthDm(credential, {
        dedupe_key: dedupeKey.trim(),
        title: title.trim(),
        body: body.trim(),
        link_url: linkUrl.trim() || undefined,
        link_label: linkLabel.trim() || undefined,
        audience,
      });
      setNotice(
        result.duplicate
          ? `幂等命中：该请求此前已发送过，本次未重复发信（批次 ${result.campaign.id}）`
          : `已发送 ${result.sent_count} 条系统私信（批次 ${result.campaign.id}）`,
      );
      setPreview(null); // 发送后清空预览
      campaignsState.reload(); // 刷新台账
    });

  /** 指定用户检索：复用现有用户列表接口 */
  const handleSearchUsers = () =>
    run(async () => {
      const page = await listUsers(credential, { q: userQuery.trim() || undefined, limit: 10 });
      setUserResults(page.users);
    });

  /** 勾选 / 取消勾选用户 */
  const toggleUser = (user: UserListRow) => {
    setSelected((prev) => (prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]));
  }; // toggleUser 结束

  return (
    <div className="page">
      <header className="page-head">
        <h1>成长私信</h1>
        <p className="page-desc">
          复用现有 IM 会话：以系统身份向用户发送一对一私信，支持跳转与群发幂等。发件方固定显示为「成长私信」，不暴露管理员个人账号。
        </p>
      </header>
      {!canWrite && <div className="panel error">当前账号缺少 messaging:write 权限，仅可查看批次台账。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">
        <div className="panel-head"><h3>编写私信</h3></div>
        <div className="form inline">
          <label className="grow">批次标题<input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="仅后台台账展示" /></label>
          <label className="grow">幂等键<input value={dedupeKey} onChange={(e) => setDedupeKey(e.target.value)} /></label>
          <button type="button" className="btn ghost small" onClick={() => setDedupeKey(makeDedupeKey())}>重新生成</button>
        </div>
        <label className="field">正文<textarea value={body} maxLength={1000} rows={4} onChange={(e) => setBody(e.target.value)} placeholder="用户将在会话中看到的系统私信内容" /></label>
        <div className="form inline">
          <label className="grow">跳转地址<input value={linkUrl} maxLength={500} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/pages/... 或 https://..." /></label>
          <label className="grow">按钮文案<input value={linkLabel} maxLength={24} onChange={(e) => setLinkLabel(e.target.value)} placeholder="查看详情" /></label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>选择受众</h3></div>
        <div className="tabs">
          <button type="button" className={mode === 'filters' ? 'tab active' : 'tab'} onClick={() => setMode('filters')}>按条件</button>
          <button type="button" className={mode === 'users' ? 'tab active' : 'tab'} onClick={() => setMode('users')}>指定用户</button>
        </div>
        {mode === 'filters' ? (
          <div className="form inline">
            <label>地区
              <select value={region} onChange={(e) => setRegion(e.target.value as '' | 'cn' | 'global')}>
                <option value="">不限</option>
                <option value="cn">cn</option>
                <option value="global">global</option>
              </select>
            </label>
            <label>注册起<input type="date" value={createdAfter} onChange={(e) => setCreatedAfter(e.target.value)} /></label>
            <label>注册止<input type="date" value={createdBefore} onChange={(e) => setCreatedBefore(e.target.value)} /></label>
            <label className="grow">关键词<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="昵称或 Mim ID" /></label>
            <label>上限<input type="number" min={1} max={2000} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} /></label>
          </div>
        ) : (
          <>
            <div className="form inline">
              <label className="grow">检索用户<input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="ID / 昵称 / 登录标识" /></label>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void handleSearchUsers()}>搜索</button>
            </div>
            {userResults.length > 0 && (
              <div className="deploy-columns">
                {userResults.map((u) => (
                  <label className="check" key={u.id}>
                    <input type="checkbox" checked={selected.some((s) => s.id === u.id)} onChange={() => toggleUser(u)} />
                    {u.display_name}（{u.id.slice(0, 8)}）
                  </label>
                ))}
              </div>
            )}
            <p className="muted">已选 {selected.length} 人：{selected.map((u) => u.display_name).join('、') || '无'}</p>
          </>
        )}
        <div className="deploy-columns">
          <button type="button" className="btn ghost" disabled={busy || !canWrite} onClick={() => void handlePreview()}>预览人数</button>
          <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void handleSend()}>发送私信</button>
        </div>
        {preview && (
          <div className="panel hint">
            <div>命中 {preview.count} 人</div>
            <div className="muted">
              {preview.sample.map((u) => `${u.display_name}${u.member_no ? `（${u.member_no}）` : ''}`).join('、') || '无样本'}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>批次台账</h3><span className="muted">{campaignsState.data?.length ?? 0}</span></div>
        {campaignsState.loading && <p className="muted">加载中…</p>}
        {campaignsState.error !== null && <p className="error">{describeError(campaignsState.error)}</p>}
        {!campaignsState.loading && campaignsState.error === null && (campaignsState.data ?? []).length === 0 ? (
          <p className="empty">还没有发送记录，发送成功后批次会在此留账。</p>
        ) : null}
        {(campaignsState.data ?? []).map((row) => (
          <div className="deploy-row" key={row.id}>
            <div className="deploy-kv">
              <strong>{row.title}</strong>
              <span className="muted">{row.sent_count}/{row.target_count} · {row.status} · {row.created_at.slice(0, 16)}</span>
              <span className="muted">{row.body.slice(0, 60)}</span>
            </div>
            <div className="deploy-columns">
              <span className="muted">{row.dedupe_key}</span>
              {row.link_url && <span className="muted">{row.link_url}</span>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
} // GrowthDm 结束
