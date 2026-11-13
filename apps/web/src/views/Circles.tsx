/**
 * 圈子（circle）视图：成员制社群的列表 / 详情 / 加入退出 / 圈主审核与发动态公告。
 *
 * 概念边界：圈子以「人 / 兴趣 / 组织」为中心，是成员制社群；与论坛板块 board（内容分区）
 * 是两个独立概念，本视图只调用 /circles/* 契约，不读取板块接口。
 */

import { useCallback, useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, errorText } from '../api'; // 接口客户端与错误文案翻译
import type { CircleMember, CircleNotice, CirclePost, CircleSummary } from '../api'; // 圈子域类型

interface Props { // 视图参数
  locale: Locale; // 当前界面语言
  hasSession?: boolean; // 是否已有会话（访客 / 正式账号）；未登录时写操作静默引导
} // 代码块结束

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 返回当前函数的处理结果
} // 代码块结束

/** ISO 时间截取日期部分；非法时间回落空串。 */
function fmtDate(iso?: string | null): string {
  if (!iso) return ''; // 条件分支：按判断结果选择后续处理路径
  const time = Date.parse(iso); // 常量 time：保存固定配置或一次性派生值
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10); // 返回当前函数的处理结果
} // 代码块结束

/** 创建圈子表单草稿。 */
interface CircleForm {
  slug: string;
  name: string;
  intro: string;
  category: string;
  visibility: 'public' | 'private';
  join_mode: 'open' | 'approve' | 'invite';
  member_limit: string;
} // 代码块结束

const EMPTY_FORM: CircleForm = { // 常量 EMPTY_FORM：保存固定配置或一次性派生值
  slug: '',
  name: '',
  intro: '',
  category: '',
  visibility: 'public',
  join_mode: 'open',
  member_limit: '0',
}; // 代码块结束

/** 可见性 / 加入方式中文标签。 */
function visibilityLabel(locale: Locale, value: CircleSummary['visibility']): string {
  return value === 'private' ? tr(locale, '私密', 'Private') : tr(locale, '公开', 'Public'); // 返回当前函数的处理结果
} // 代码块结束

function joinModeLabel(locale: Locale, value: CircleSummary['join_mode']): string { // 函数 joinModeLabel：封装一段可复用的处理逻辑
  if (value === 'approve') return tr(locale, '审核加入', 'Approval'); // 条件分支：按判断结果选择后续处理路径
  if (value === 'invite') return tr(locale, '邀请加入', 'Invite only'); // 条件分支：按判断结果选择后续处理路径
  return tr(locale, '自由加入', 'Open'); // 返回当前函数的处理结果
} // 代码块结束

export function Circles({ locale, hasSession = false }: Props) { // 导出函数 Circles：对外暴露的调用入口
  const [items, setItems] = useState<CircleSummary[]>([]); // 圈子清单
  const [detail, setDetail] = useState<CircleSummary | null>(null); // 当前圈子详情
  const [posts, setPosts] = useState<CirclePost[]>([]); // 圈内动态
  const [notices, setNotices] = useState<CircleNotice[]>([]); // 圈内公告
  const [members, setMembers] = useState<CircleMember[]>([]); // 正式成员
  const [pending, setPending] = useState<CircleMember[]>([]); // 待审成员（owner / admin 可见）
  const [loading, setLoading] = useState(true); // 首屏加载态
  const [error, setError] = useState<string | null>(null); // 页面错误
  const [busy, setBusy] = useState(false); // 提交忙碌态
  const [notice, setNotice] = useState<string | null>(null); // 成功提示
  const [inviteCode, setInviteCode] = useState(''); // invite 模式加入码
  const [postBody, setPostBody] = useState(''); // 动态草稿
  const [noticeBody, setNoticeBody] = useState(''); // 公告草稿
  const [createOpen, setCreateOpen] = useState(false); // 创建面板展开态
  const [form, setForm] = useState<CircleForm>(EMPTY_FORM); // 创建表单草稿

  /** 拉取公开圈子清单；失败保留空态并记录错误。 */
  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.circles.list(); // 常量 data：保存固定配置或一次性派生值
      setItems(data.items);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setLoading(false);
    } // 代码块结束
  }, [locale]);

  useEffect(() => { void loadList(); }, [loadList]);

  /** 拉取圈子详情与成员可见的动态 / 公告 / 名单；非成员访问私密圈时子流静默留空。 */
  async function openDetail(slug: string): Promise<void> {
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.circles.detail(slug); // 常量 data：保存固定配置或一次性派生值
      setDetail(data.circle);
      setInviteCode('');
      setPostBody('');
      setNoticeBody('');
      const [postRes, noticeRes, memberRes] = await Promise.allSettled([ // 赋值：更新变量 const 的取值
        api.circles.posts(slug),
        api.circles.notices(slug),
        api.circles.members(slug),
      ]);
      setPosts(postRes.status === 'fulfilled' ? postRes.value.items : []);
      setNotices(noticeRes.status === 'fulfilled' ? noticeRes.value.items : []);
      if (memberRes.status === 'fulfilled') { // 条件分支：按判断结果选择后续处理路径
        setMembers(memberRes.value.items);
        setPending(memberRes.value.pending ?? []);
      } else { // 代码块结束
        setMembers([]);
        setPending([]);
      } // 代码块结束
    } catch (err) {
      setError(errorText(locale, err));
      setDetail(null);
    } // 代码块结束
  } // 代码块结束

  /** 详情操作后回读：刷新详情、动态、公告与名单。 */
  async function refreshDetail(slug: string): Promise<void> {
    await openDetail(slug); // 异步等待：挂起至 Promise 落定后再继续
  } // 代码块结束

  /** 加入圈子：invite 模式先取邀请码；open / approve 直接提交。 */
  async function doJoin(): Promise<void> {
    if (!detail || busy) return; // 条件分支：按判断结果选择后续处理路径
    setBusy(true);
    setNotice(null);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.circles.join(detail.slug, detail.join_mode === 'invite' ? inviteCode || undefined : undefined); // 常量 result：保存固定配置或一次性派生值
      setNotice(result.status === 'pending' ? tr(locale, '已提交，等待圈主审核', 'Request submitted, pending review') : tr(locale, '已加入圈子', 'Joined'));
      await refreshDetail(detail.slug); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  /** 退出圈子。 */
  async function doLeave(): Promise<void> {
    if (!detail || busy) return; // 条件分支：按判断结果选择后续处理路径
    setBusy(true);
    setNotice(null);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.circles.leave(detail.slug); // 异步等待：挂起至 Promise 落定后再继续
      setNotice(tr(locale, '已退出圈子', 'Left the circle'));
      await refreshDetail(detail.slug); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  /** 通过 / 拒绝待审成员。 */
  async function decide(target: CircleMember, approve: boolean): Promise<void> {
    if (!detail || busy) return; // 条件分支：按判断结果选择后续处理路径
    setBusy(true);
    setNotice(null);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      if (approve) await api.circles.approve(detail.slug, target.user_id); // 条件分支：按判断结果选择后续处理路径
      else await api.circles.reject(detail.slug, target.user_id); // 兜底分支：前面所有条件均不满足时执行
      setNotice(approve ? tr(locale, '已通过加入申请', 'Approved') : tr(locale, '已拒绝加入申请', 'Rejected'));
      await refreshDetail(detail.slug); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  /** 发圈内动态。 */
  async function submitPost(): Promise<void> {
    if (!detail || !postBody.trim() || busy) return; // 条件分支：按判断结果选择后续处理路径
    setBusy(true);
    setNotice(null);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.circles.createPost(detail.slug, postBody.trim()); // 异步等待：挂起至 Promise 落定后再继续
      setPostBody('');
      await refreshDetail(detail.slug); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  /** 发圈内公告（owner / admin）。 */
  async function submitNotice(): Promise<void> {
    if (!detail || !noticeBody.trim() || busy) return; // 条件分支：按判断结果选择后续处理路径
    setBusy(true);
    setNotice(null);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.circles.createNotice(detail.slug, noticeBody.trim()); // 异步等待：挂起至 Promise 落定后再继续
      setNoticeBody('');
      await refreshDetail(detail.slug); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  /** 创建圈子：成功后进入新圈子详情。 */
  async function submitCreate(): Promise<void> {
    if (busy) return; // 条件分支：按判断结果选择后续处理路径
    setBusy(true);
    setNotice(null);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const limit = Number.parseInt(form.member_limit, 10); // 常量 limit：保存固定配置或一次性派生值
      const created = await api.circles.create({ // 常量 created：保存固定配置或一次性派生值
        slug: form.slug.trim(),
        name: form.name.trim(),
        intro: form.intro.trim(),
        category: form.category.trim() || null,
        visibility: form.visibility,
        join_mode: form.join_mode,
        member_limit: Number.isFinite(limit) && limit >= 0 ? limit : 0,
      });
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      await openDetail(created.circle.slug); // 异步等待：挂起至 Promise 落定后再继续
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  const canManage = !!detail && (detail.my_role === 'owner' || detail.my_role === 'admin'); // 常量 canManage：保存固定配置或一次性派生值

  // ===== 详情视图 =====
  if (detail) {
    return ( // 返回当前函数的处理结果
      <div className="page circles-page">{/* 执行当前业务步骤 */}
        <header className="page-head">{/* 执行当前业务步骤 */}
          <button type="button" className="btn ghost small" onClick={() => { setDetail(null); void loadList(); }}>{/* 执行当前业务步骤 */}
            {tr(locale, '返回圈子清单', 'Back to circles')}
          </button>
          <h2>{detail.name}</h2>
          <p className="muted">{detail.intro || tr(locale, '暂无简介', 'No intro')}</p>
          <div className="row">{/* 执行当前业务步骤 */}
            <span className="deploy-badge">{visibilityLabel(locale, detail.visibility)}</span>
            <span className="deploy-badge">{joinModeLabel(locale, detail.join_mode)}</span>
            <span className="deploy-badge">{tr(locale, '成员', 'Members')} {detail.member_count}</span>
            {detail.category ? <span className="deploy-badge">{detail.category}</span> : null}
          </div>
        </header>

        {error && <p className="error">{error}</p>}
        {notice && <p className="hint">{notice}</p>}

        {/* 准入操作：未加入按加入方式展示按钮；owner 不可退出 */}
        {!detail.i_am_member && hasSession && (
          <section className="panel">{/* 执行当前业务步骤 */}
            {detail.join_mode === 'invite' && (
              <input
                type="text" // 赋值：更新变量 type 的取值
                               placeholder={tr(locale, '输入邀请码', 'Invite code')}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            )}
            <button type="button" className="btn primary" disabled={busy} onClick={() => void doJoin()}>{/* 执行当前业务步骤 */}
              {detail.join_mode === 'approve' ? tr(locale, '申请加入', 'Request to join') : tr(locale, '加入圈子', 'Join')}
            </button>
          </section>
        )}
        {detail.i_am_member && detail.my_role !== 'owner' && (
          <section className="panel">{/* 执行当前业务步骤 */}
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void doLeave()}>{/* 执行当前业务步骤 */}
              {tr(locale, '退出圈子', 'Leave')}
            </button>
          </section>
        )}

        {/* 待审名单：仅 owner / admin */}
        {canManage && pending.length > 0 && (
          <section className="panel">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>{tr(locale, '待审核', 'Pending review')}</h3></div>
            <ul className="plain-list">{/* 执行当前业务步骤 */}
              {pending.map((member) => (
                <li className="deploy-row" key={member.user_id}>{/* 执行当前业务步骤 */}
                  <span>{member.name || member.member_no || member.user_id.slice(0, 8)}</span>
                  <div className="row">{/* 执行当前业务步骤 */}
                    <button type="button" className="btn primary small" disabled={busy} onClick={() => void decide(member, true)}>{/* 执行当前业务步骤 */}
                      {tr(locale, '通过', 'Approve')}
                    </button>
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => void decide(member, false)}>{/* 执行当前业务步骤 */}
                      {tr(locale, '拒绝', 'Reject')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 圈内公告 */}
        <section className="panel">{/* 执行当前业务步骤 */}
          <div className="panel-head"><h3>{tr(locale, '圈内公告', 'Notices')}</h3></div>
          {notices.length === 0 ? <p className="muted">{tr(locale, '暂无公告', 'No notices yet')}</p> : (
            <ul className="plain-list">{/* 执行当前业务步骤 */}
              {notices.map((item) => (
                <li className="deploy-row" key={item.id}>{/* 执行当前业务步骤 */}
                  <span>{item.body}</span>
                  <span className="muted">{item.author_name ?? ''} · {fmtDate(item.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <div className="tool-form">{/* 执行当前业务步骤 */}
              <textarea className="input" rows={2} placeholder={tr(locale, '发布公告…', 'Post a notice…')} value={noticeBody} onChange={(e) => setNoticeBody(e.target.value)} />
              <button type="button" className="btn primary" disabled={busy || !noticeBody.trim()} onClick={() => void submitNotice()}>{/* 执行当前业务步骤 */}
                {tr(locale, '发布公告', 'Post notice')}
              </button>
            </div>
          )}
        </section>

        {/* 圈内动态 */}
        <section className="panel">{/* 执行当前业务步骤 */}
          <div className="panel-head"><h3>{tr(locale, '圈内动态', 'Circle posts')}</h3></div>
          {posts.length === 0 ? <p className="muted">{tr(locale, '暂无动态', 'No posts yet')}</p> : (
            <ul className="plain-list">{/* 执行当前业务步骤 */}
              {posts.map((item) => (
                <li className="deploy-row" key={item.id}>{/* 执行当前业务步骤 */}
                  <span>{item.body}</span>
                  <span className="muted">{item.author_name ?? ''} · {fmtDate(item.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {detail.i_am_member && (
            <div className="tool-form">{/* 执行当前业务步骤 */}
              <textarea className="input" rows={2} placeholder={tr(locale, '分享圈内动态…', 'Share an update…')} value={postBody} onChange={(e) => setPostBody(e.target.value)} />
              <button type="button" className="btn primary" disabled={busy || !postBody.trim()} onClick={() => void submitPost()}>{/* 执行当前业务步骤 */}
                {tr(locale, '发布动态', 'Post')}
              </button>
            </div>
          )}
        </section>

        {/* 成员名单 */}
        <section className="panel">{/* 执行当前业务步骤 */}
          <div className="panel-head"><h3>{tr(locale, '成员名单', 'Members')}</h3></div>
          {members.length === 0 ? <p className="muted">{tr(locale, '暂无成员', 'No members yet')}</p> : (
            <ul className="plain-list">{/* 执行当前业务步骤 */}
              {members.map((member) => (
                <li className="deploy-row" key={member.user_id}>{/* 执行当前业务步骤 */}
                  <span>{member.name || member.member_no || member.user_id.slice(0, 8)}</span>
                  <span className="muted">{member.role === 'owner' ? tr(locale, '圈主', 'Owner') : member.role === 'admin' ? tr(locale, '管理员', 'Admin') : tr(locale, '成员', 'Member')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    ); // 执行当前业务步骤
  } // 代码块结束

  // ===== 列表视图 =====
  return (
    <div className="page circles-page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h2>{tr(locale, '圈子', 'Circles')}</h2>
        <p className="muted">{tr(locale, '以人、兴趣或组织为中心的成员制社群，区别于论坛板块。', 'Member communities centered on people, interests or organizations — distinct from forum boards.')}</p>
      </header>

      {error && <p className="error">{error}</p>}
      {notice && <p className="hint">{notice}</p>}

      {hasSession && (
        <section className="panel">{/* 执行当前业务步骤 */}
          <button type="button" className="btn ghost" onClick={() => setCreateOpen((v) => !v)}>{/* 执行当前业务步骤 */}
            {createOpen ? tr(locale, '收起创建表单', 'Close form') : tr(locale, '创建圈子', 'Create circle')}
          </button>
          {createOpen && (
            <div className="tool-form">{/* 执行当前业务步骤 */}
              <input className="input" placeholder={tr(locale, '标识 slug（小写字母 / 数字 / 连字符）', 'Slug (lowercase letters / digits / hyphen)')} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
              <input className="input" placeholder={tr(locale, '圈子名称', 'Name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <textarea className="input" rows={2} placeholder={tr(locale, '简介', 'Intro')} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
              <input className="input" placeholder={tr(locale, '分类（可选）', 'Category (optional)')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as CircleForm['visibility'] })}>{/* 执行当前业务步骤 */}
                <option value="public">{tr(locale, '公开', 'Public')}</option>
                <option value="private">{tr(locale, '私密', 'Private')}</option>
              </select>
              <select className="input" value={form.join_mode} onChange={(e) => setForm({ ...form, join_mode: e.target.value as CircleForm['join_mode'] })}>{/* 执行当前业务步骤 */}
                <option value="open">{tr(locale, '自由加入', 'Open')}</option>
                <option value="approve">{tr(locale, '审核加入', 'Approval')}</option>
                <option value="invite">{tr(locale, '邀请加入', 'Invite only')}</option>
              </select>
              <input className="input" type="number" min={0} placeholder={tr(locale, '成员上限（0 不限）', 'Member limit (0 = unlimited)')} value={form.member_limit} onChange={(e) => setForm({ ...form, member_limit: e.target.value })} />
              <button type="button" className="btn primary" disabled={busy} onClick={() => void submitCreate()}>{/* 执行当前业务步骤 */}
                {tr(locale, '提交创建', 'Create')}
              </button>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : items.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无圈子', 'No circles yet')}</div>
      ) : (
        <div className="commerce-grid tools-grid">{/* 执行当前业务步骤 */}
          {items.map((circle) => (
            <article className="panel tool-card" key={circle.slug}>{/* 执行当前业务步骤 */}
              <div className="panel-head">{/* 执行当前业务步骤 */}
                <h3>{circle.name}</h3>
                <span className="deploy-badge">{visibilityLabel(locale, circle.visibility)}</span>
              </div>
              <p className="muted">{circle.intro || tr(locale, '暂无简介', 'No intro')}</p>
              <div className="row">{/* 执行当前业务步骤 */}
                <span className="muted">{joinModeLabel(locale, circle.join_mode)} · {tr(locale, '成员', 'Members')} {circle.member_count}</span>
              </div>
              <div className="row">{/* 执行当前业务步骤 */}
                <button type="button" className="btn ghost small" onClick={() => void openDetail(circle.slug)}>{/* 执行当前业务步骤 */}
                  {tr(locale, '详情', 'Details')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  ); // 执行当前业务步骤
} // 代码块结束
