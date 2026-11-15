/**
 * 社区互动补齐组件（2026-11-15）：
 *   - NotificationBell：站内通知铃铛，未读数 / 已读 / 点击跳帖；
 *   - ThreadTools：作者编辑、锁定与隐藏、版主置顶、帖子举报；
 *   - SearchPanel：全文搜索（标题 / 摘要 / 正文）与 <mark> 高亮片段；
 *   - ModerationPanel：板块举报队列与处理动作；
 *   - ReplyItem：楼中楼引用、删除、举报、采纳答案。
 *
 * 全部能力独立成文件，Community.tsx 只插入调用点：
 *   - 不改 endpoints.ts / types.ts 的共享契约（并行线正在改它们）；
 *   - 样式用内联 <style> 与现有 community-* 类，避免动 styles.css。
 */

import { useEffect, useRef, useState } from 'react'; // 引入依赖、类型或本地模块绑定
import type { ReactNode } from 'react'; // 弹层子节点类型
import type { Locale } from '@mim/i18n'; // 语言标识
import { errorText } from '../api'; // 统一错误本地化
import type { CommunityPost, CommunityThreadDetail } from '../api'; // 详情 / 回复既有类型
import { // 社区补齐端点
  boardReports,
  createReport,
  deletePost,
  isPinned,
  markNotificationsRead,
  moderateThread,
  notifications,
  replyLockedOf,
  resolveReport,
  searchThreads,
  updateThread,
  type CommunityNotification,
  type CommunityReportItem,
  type CommunitySearchItem,
  type ThreadExtras,
} from '../api/community.js';

/** 通知事件的中文名：未知类型原样回退。 */
const NOTIFY_KIND: Record<string, string> = { // 事件文案
  reply: '回复', // 有人回复了我
  accept: '采纳', // 我的回复被采纳
  like: '点赞', // 有人赞了我的帖子
  favorite: '收藏', // 有人收藏了我的帖子
  report: '举报', // 举报处理结果
}; // 常量结束

/** 举报原因的中文名。 */
const REPORT_REASON: Record<string, string> = { // 原因文案
  spam: '垃圾广告', // 广告刷屏
  abuse: '辱骂攻击', // 人身攻击
  illegal: '违法信息', // 违法内容
  porn: '色情低俗', // 色情低俗
  other: '其他', // 其他
}; // 常量结束

/** 时间只展示到日，和社区其他位置一致。 */
function day(iso: string | null): string { // 日期截取
  return iso ? iso.slice(0, 10) : ''; // 空值回空串
} // 函数结束

/** 弹层通用容器：遮罩点击即关，点面板内部不冒泡。 */
function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) { // 轻量弹层
  return (
    <div className="mim-cm-mask" onClick={props.onClose} role="presentation">
      <div className="mim-cm-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={props.title}>
        <div className="mim-cm-sheet-head">
          <strong>{props.title}</strong>
          <button type="button" onClick={props.onClose}>关闭</button>
        </div>
        {props.children}
      </div>
    </div>
  );
} // 组件结束

/** 举报表单：帖子与回复共用。 */
export function ReportDialog(props: { // 举报弹窗
  locale: Locale; // 语言
  targetType: 'thread' | 'post'; // 对象类型
  targetId: string; // 对象主键
  onClose: () => void; // 关闭
  onDone: (message: string) => void; // 成功回调
}) { // 组件开始
  const [reason, setReason] = useState<'spam' | 'abuse' | 'illegal' | 'porn' | 'other'>('spam'); // 原因
  const [detail, setDetail] = useState(''); // 补充说明
  const [busy, setBusy] = useState(false); // 提交中
  const [error, setError] = useState<string | null>(null); // 局部错误

  async function submit() { // 提交举报
    setBusy(true); // 防重复
    try { // 捕获服务端错误
      await createReport({ target_type: props.targetType, target_id: props.targetId, reason, detail: detail.trim() || undefined }); // 落举报单
      props.onDone('举报已提交，版主会尽快处理'); // 提示并关闭
      props.onClose(); // 关闭弹窗
    } catch (err) { // 失败留在弹窗
      setError(errorText(props.locale, err)); // 展示原因
    } finally { // 无论成败都解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  return (
    <Sheet title={props.targetType === 'thread' ? '举报帖子' : '举报回复'} onClose={props.onClose}>
      <label className="mim-cm-field">原因
        <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          {Object.entries(REPORT_REASON).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="mim-cm-field">补充说明
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={500} placeholder="可留空；写清具体问题便于版主判断" />
      </label>
      {error && <p className="mim-cm-error">{error}</p>}
      <div className="mim-cm-actions">
        <button type="button" onClick={props.onClose}>取消</button>
        <button type="button" className="is-primary" disabled={busy} onClick={() => void submit()}>{busy ? '提交中…' : '提交举报'}</button>
      </div>
    </Sheet>
  );
} // 组件结束

/** 站内通知铃铛：未读数、最近 20 条、全部已读、点击跳帖。 */
export function NotificationBell(props: { // 通知铃铛
  locale: Locale; // 语言
  hasSession?: boolean; // 未登录不请求、不渲染
  onOpenThread: (threadId: string) => void; // 打开关联帖子
}) { // 组件开始
  const [open, setOpen] = useState(false); // 面板开合
  const [items, setItems] = useState<CommunityNotification[]>([]); // 最近通知
  const [unread, setUnread] = useState(0); // 未读数
  const [busy, setBusy] = useState(false); // 请求中
  const [error, setError] = useState<string | null>(null); // 错误
  const mounted = useRef(true); // 卸载后不再 setState

  async function refresh() { // 拉取通知
    try { // 捕获网络错误
      const data = await notifications({ limit: 20 }); // 首屏 20 条
      if (!mounted.current) return; // 已卸载
      setItems(data.items); // 覆盖列表
      setUnread(data.unread); // 同步未读
      setError(null); // 清空错误
    } catch (err) { // 失败提示
      if (mounted.current) setError(errorText(props.locale, err)); // 展示原因
    } // 结束
  } // 函数结束

  useEffect(() => { // 登录后拉一次，用于未读角标
    mounted.current = true; // 标记挂载
    if (props.hasSession) void refresh(); // 匿名不请求
    return () => { mounted.current = false; }; // 卸载清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.hasSession]);

  if (!props.hasSession) return null; // 未登录不占位

  async function markAll() { // 全部已读
    setBusy(true); // 防重复
    try { // 捕获错误
      const data = await markNotificationsRead(); // 不传 ids = 全部
      setUnread(data.unread); // 更新角标
      setItems((prev) => prev.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() }))); // 本地同步已读
    } catch (err) { // 失败提示
      setError(errorText(props.locale, err)); // 展示原因
    } finally { // 解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  async function openItem(item: CommunityNotification) { // 点击一条通知
    if (!item.read_at) { // 未读才写已读
      try { // 已读失败不阻断跳转
        const data = await markNotificationsRead([item.id]); // 精确标已读
        setUnread(data.unread); // 更新角标
        setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row))); // 本地同步
      } catch { /* 静默：跳转优先 */ } // 结束
    } // 结束
    setOpen(false); // 收起面板
    if (item.thread_id) props.onOpenThread(item.thread_id); // 打开帖子
  } // 函数结束

  return (
    <span className="mim-cm-bell">
      <button type="button" onClick={() => { setOpen((v) => !v); if (!open) void refresh(); }} aria-label="通知">
        通知{unread > 0 ? <em className="mim-cm-badge">{unread > 99 ? '99+' : unread}</em> : null}
      </button>
      {open && (
        <div className="mim-cm-pop">
          <div className="mim-cm-pop-head">
            <strong>通知 · {unread} 条未读</strong>
            <span>
              <button type="button" disabled={busy || unread === 0} onClick={() => void markAll()}>全部已读</button>
              <button type="button" onClick={() => setOpen(false)}>收起</button>
            </span>
          </div>
          {error && <p className="mim-cm-error">{error}</p>}
          {items.length === 0 && !error && <p className="mim-cm-empty">暂无通知</p>}
          {items.map((item) => (
            <button key={item.id} type="button" className={`mim-cm-notify${item.read_at ? '' : ' is-unread'}`} onClick={() => void openItem(item)}>
              <span className="mim-cm-notify-kind">{NOTIFY_KIND[item.kind] ?? item.kind}</span>
              <span className="mim-cm-notify-body">
                <strong>{item.actor_name || 'Mim 用户'}</strong>
                <em>{item.content || item.thread_title || ''}</em>
                <span>{day(item.created_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
} // 组件结束

/** 帖子工具条：作者编辑 / 举报 / 版主治理。 */
export function ThreadTools(props: { // 工具条
  locale: Locale; // 语言
  thread: CommunityThreadDetail & ThreadExtras; // 当前帖子
  isModerator?: boolean; // 是否该板块版主
  onChanged: () => void; // 操作后刷新详情
  onNotice: (message: string) => void; // 成功提示
  onError: (error: unknown) => void; // 失败提示
}) { // 组件开始
  const [mode, setMode] = useState<'none' | 'menu' | 'edit' | 'report' | 'moderate'>('none'); // 当前面板
  const [pinned, setPinned] = useState(isPinned(props.thread)); // 置顶态
  const [replyLocked, setReplyLocked] = useState(replyLockedOf(props.thread)); // 回复锁定态
  const [busy, setBusy] = useState(false); // 提交中
  const [form, setForm] = useState({ title: '', summary: '', body: '', price: '0' }); // 编辑草稿

  useEffect(() => { // 帖子切换时重新同步治理态
    setPinned(isPinned(props.thread)); // 置顶
    setReplyLocked(replyLockedOf(props.thread)); // 锁定回复
    setMode('none'); // 收起面板
  }, [props.thread.id, props.thread.pinned, props.thread.reply_locked]);

  function openEdit() { // 打开编辑并回填
    setForm({ title: props.thread.title, summary: props.thread.summary ?? '', body: props.thread.body ?? '', price: String((props.thread.price_cents ?? 0) / 100) }); // 元为单位
    setMode('edit'); // 切面板
  } // 函数结束

  async function saveEdit() { // 保存编辑
    setBusy(true); // 防重复
    try { // 捕获服务端校验
      const patch: { title?: string; summary?: string; body?: string; price_cents?: number } = {}; // 只提交改动
      if (form.title !== props.thread.title) patch.title = form.title.trim(); // 标题变了
      if (form.summary !== (props.thread.summary ?? '')) patch.summary = form.summary.trim(); // 摘要变了
      if (form.body !== (props.thread.body ?? '')) patch.body = form.body; // 正文变了
      const cents = Math.round(Number(form.price) * 100); // 元 → 分
      if (Number.isFinite(cents) && cents !== props.thread.price_cents) patch.price_cents = Math.max(0, cents); // 定价变了
      if (Object.keys(patch).length === 0) { props.onNotice('没有需要保存的修改'); setMode('none'); return; } // 空改动直接关
      await updateThread(props.thread.id, patch); // PATCH
      props.onNotice('帖子已更新'); // 成功提示
      setMode('none'); // 收起
      props.onChanged(); // 刷新详情
    } catch (err) { // 失败提示
      props.onError(err); // 交给页面统一渲染
    } finally { // 解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  async function moderate(action: 'pin' | 'unpin' | 'hide' | 'restore' | 'lock' | 'unlock') { // 治理动作
    setBusy(true); // 防重复
    try { // 捕获权限错误
      await moderateThread(props.thread.id, action); // 服务端判定归属
      if (action === 'pin') setPinned(true); // 本地同步
      if (action === 'unpin') setPinned(false); // 本地同步
      if (action === 'lock') setReplyLocked(true); // 本地同步
      if (action === 'unlock') setReplyLocked(false); // 本地同步
      props.onNotice(action === 'hide' ? '帖子已隐藏' : action === 'restore' ? '帖子已恢复展示' : '操作已完成'); // 提示
      setMode('none'); // 收起
      props.onChanged(); // 刷新详情
    } catch (err) { // 失败提示
      props.onError(err); // 统一错误
    } finally { // 解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  return (
    <span className="mim-cm-tools">
      <button type="button" className={mode === 'none' ? '' : 'is-active'} onClick={() => setMode(mode === 'none' ? 'menu' : 'none')}>管理</button>
      {mode === 'menu' && (
        <div className="mim-cm-pop is-anchored">
          {props.thread.can_edit && <button type="button" onClick={openEdit}>编辑帖子</button>}
          <button type="button" onClick={() => setMode('report')}>举报</button>
          {(props.isModerator || props.thread.can_edit) && <button type="button" onClick={() => setMode('moderate')}>治理</button>}
          <button type="button" onClick={() => setMode('none')}>收起</button>
        </div>
      )}
      {mode === 'edit' && (
        <Sheet title="编辑帖子" onClose={() => setMode('none')}>
          <label className="mim-cm-field">标题<input value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="mim-cm-field">摘要<input value={form.summary} maxLength={200} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label>
          <label className="mim-cm-field">正文<textarea value={form.body} rows={8} maxLength={8000} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          <label className="mim-cm-field">定价（元，0 为免费）<input value={form.price} inputMode="decimal" onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
          <div className="mim-cm-actions">
            <button type="button" onClick={() => setMode('none')}>取消</button>
            <button type="button" className="is-primary" disabled={busy} onClick={() => void saveEdit()}>{busy ? '保存中…' : '保存'}</button>
          </div>
        </Sheet>
      )}
      {mode === 'report' && (
        <ReportDialog locale={props.locale} targetType="thread" targetId={props.thread.id} onClose={() => setMode('none')} onDone={props.onNotice} />
      )}
      {mode === 'moderate' && (
        <Sheet title="帖子治理" onClose={() => setMode('none')}>
          {props.isModerator && (
            <button type="button" className="mim-cm-row" disabled={busy} onClick={() => void moderate(pinned ? 'unpin' : 'pin')}>{pinned ? '取消置顶' : '置顶帖子'}</button>
          )}
          <button type="button" className="mim-cm-row" disabled={busy} onClick={() => void moderate(replyLocked ? 'unlock' : 'lock')}>{replyLocked ? '解除回复锁定' : '锁定回复（只读）'}</button>
          {props.isModerator && <button type="button" className="mim-cm-row is-danger" disabled={busy} onClick={() => void moderate('hide')}>隐藏帖子</button>}
          <button type="button" className="mim-cm-row" disabled={busy} onClick={() => void moderate('restore')}>恢复展示</button>
        </Sheet>
      )}
    </span>
  );
} // 组件结束

/** 全文搜索面板：命中标题 / 摘要 / 正文，片段由服务端高亮。 */
export function SearchPanel(props: { // 搜索面板
  locale: Locale; // 语言
  board: string; // 当前板块（all 表示全部）
  onOpenThread: (threadId: string) => void; // 打开命中帖子
}) { // 组件开始
  const [q, setQ] = useState(''); // 关键词
  const [items, setItems] = useState<CommunitySearchItem[]>([]); // 命中
  const [total, setTotal] = useState(0); // 总数
  const [busy, setBusy] = useState(false); // 请求中
  const [searched, setSearched] = useState(false); // 是否已搜过
  const [error, setError] = useState<string | null>(null); // 错误

  async function run(offset: number, append: boolean) { // 搜索 / 加载更多
    const keyword = q.trim(); // 去空白
    if (!keyword) { setError('请输入搜索关键词'); return; } // 空词不发请求
    setBusy(true); // 防重复
    try { // 捕获网络错误
      const data = await searchThreads({ q: keyword, board: props.board, limit: 20, offset }); // 分页搜索
      setItems((prev) => (append ? [...prev, ...data.items] : data.items)); // 追加或覆盖
      setTotal(data.total); // 同步总数
      setSearched(true); // 标记已搜
      setError(null); // 清空错误
    } catch (err) { // 失败提示
      setError(errorText(props.locale, err)); // 展示原因
    } finally { // 解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  return (
    <div className="mim-cm-search">
      <div className="mim-cm-search-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(0, false); }} placeholder="全文搜索：标题 / 摘要 / 正文…" />
        <button type="button" className="is-primary" disabled={busy} onClick={() => void run(0, false)}>{busy ? '搜索中…' : '搜索'}</button>
      </div>
      {error && <p className="mim-cm-error">{error}</p>}
      {searched && !error && items.length > 0 && <p className="mim-cm-hint">共 {total} 条命中</p>}
      {items.map((item) => (
        <button key={item.id} type="button" className="mim-cm-hit" onClick={() => props.onOpenThread(item.id)}>
          <span className="mim-cm-hit-meta">{item.board_name} · {item.views} 浏览 · {item.reply_count} 回复{item.locked ? ' · 付费' : ''}</span>
          <strong>{item.title}</strong>
          <span className="mim-cm-hit-snippet" dangerouslySetInnerHTML={{ __html: item.snippet }} />
        </button>
      ))}
      {searched && items.length === 0 && !error && (
        <div className="mim-cm-empty">
          <strong>没有找到相关帖子</strong>
          <span>换个关键词，或缩短搜索词再试一次。</span>
        </div>
      )}
      {items.length > 0 && items.length < total && (
        <button type="button" className="mim-cm-row" disabled={busy} onClick={() => void run(items.length, true)}>加载更多（{items.length}/{total}）</button>
      )}
    </div>
  );
} // 组件结束

/** 版主举报工作台：按板块读取待处理举报并处理。 */
export function ModerationPanel(props: { // 举报处理
  locale: Locale; // 语言
  boardSlug: string; // 板块 slug
  onNotice: (message: string) => void; // 成功提示
  onError: (error: unknown) => void; // 失败提示
}) { // 组件开始
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open'); // 队列状态
  const [items, setItems] = useState<CommunityReportItem[]>([]); // 举报
  const [total, setTotal] = useState(0); // 总数
  const [busy, setBusy] = useState(false); // 请求中
  const [error, setError] = useState<string | null>(null); // 权限 / 网络错误

  async function load(next: 'open' | 'resolved' | 'dismissed') { // 读取队列
    setBusy(true); // 防重复
    try { // 非版主会 403
      const data = await boardReports(props.boardSlug, { status: next, limit: 50 }); // 一页 50 条足够工作台
      setItems(data.items); // 覆盖
      setTotal(data.total); // 总数
      setError(null); // 清空错误
    } catch (err) { // 展示错误
      setError(errorText(props.locale, err)); // 统一文案
    } finally { // 解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  useEffect(() => { setStatus('open'); void load('open'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [props.boardSlug, props.locale]);

  async function act(id: string, action: 'dismiss' | 'hide_thread' | 'delete_post') { // 处理一条
    setBusy(true); // 防重复
    try { // 捕获权限错误
      await resolveReport(id, action); // 服务端同时回执举报人
      props.onNotice(action === 'dismiss' ? '已忽略该举报' : action === 'hide_thread' ? '帖子已隐藏' : '回复已删除'); // 提示
      await load(status); // 刷新当前队列
    } catch (err) { // 失败提示
      props.onError(err); // 统一错误
    } finally { // 解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  return (
    <div className="mim-cm-moderation">
      <div className="mim-cm-search-row">
        {(['open', 'resolved', 'dismissed'] as const).map((key) => (
          <button key={key} type="button" className={status === key ? 'is-active' : ''} onClick={() => { setStatus(key); void load(key); }}>
            {key === 'open' ? '待处理' : key === 'resolved' ? '已处理' : '已忽略'}
          </button>
        ))}
        <span className="mim-cm-hint">共 {total} 条</span>
      </div>
      {error && <p className="mim-cm-error">{error}</p>}
      {!error && items.length === 0 && <p className="mim-cm-empty">当前队列为空</p>}
      {items.map((item) => (
        <div key={item.id} className="mim-cm-report">
          <div className="mim-cm-hit-meta">
            {item.target_type === 'thread' ? '帖子' : '回复'} · {REPORT_REASON[item.reason] ?? item.reason} · {item.reporter_name || '匿名'} · {day(item.created_at)}
          </div>
          <strong>{item.thread_title || item.target_id}</strong>
          {item.detail && <p>{item.detail}</p>}
          {status === 'open' && (
            <div className="mim-cm-actions">
              <button type="button" disabled={busy} onClick={() => void act(item.id, 'dismiss')}>忽略</button>
              {item.target_type === 'thread' && <button type="button" className="is-danger" disabled={busy} onClick={() => void act(item.id, 'hide_thread')}>隐藏帖子</button>}
              {item.target_type === 'post' && <button type="button" className="is-danger" disabled={busy} onClick={() => void act(item.id, 'delete_post')}>删除回复</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
} // 组件结束

/** 单条回复：楼中楼引用、采纳、删除、举报。 */
export function ReplyItem(props: { // 回复行
  locale: Locale; // 语言
  post: CommunityPost & { author_id?: string | null; parent_id?: string | null }; // 回复（扩展列运行时存在）
  posts: Array<CommunityPost & { author_id?: string | null; parent_id?: string | null }>; // 本页楼层，用于找父楼
  isAccepted?: boolean; // 是否已采纳
  canAccept?: boolean; // 楼主可采纳
  canModerate?: boolean; // 版主 / 作者可删任意楼层
  currentUserId?: string; // 当前用户，用于「我」标记与本人删除
  onAccept: () => void; // 采纳
  onReply: (postId: string, authorName: string) => void; // 回复该楼
  onDeleted: () => void; // 删除后刷新
  onNotice: (message: string) => void; // 成功提示
  onError: (error: unknown) => void; // 失败提示
}) { // 组件开始
  const [reporting, setReporting] = useState(false); // 举报弹窗
  const [busy, setBusy] = useState(false); // 删除中
  const parent = props.post.parent_id ? props.posts.find((row) => row.id === props.post.parent_id) : undefined; // 父楼
  const canDelete = Boolean(props.canModerate || (props.post.author_id && props.post.author_id === props.currentUserId)); // 本人或治理者可删

  async function remove() { // 删除回复
    if (!window.confirm('确定删除这条回复？')) return; // 二次确认
    setBusy(true); // 防重复
    try { // 捕获权限错误
      await deletePost(props.post.id); // 软删
      props.onNotice('回复已删除'); // 提示
      props.onDeleted(); // 刷新详情
    } catch (err) { // 失败提示
      props.onError(err); // 统一错误
    } finally { // 解锁
      setBusy(false); // 恢复按钮
    } // 结束
  } // 函数结束

  return (
    <div className={`community-reply${props.isAccepted ? ' is-accepted' : ''}`}>
      <strong>{props.post.author_name || 'Mim 用户'}{props.currentUserId && props.post.author_id === props.currentUserId ? '（我）' : ''}</strong>
      <span>{props.post.author_member_no || ''} · {day(props.post.created_at)}</span>
      {parent && <div className="mim-cm-quote">回复 @{parent.author_name || 'Mim 用户'}：{parent.content.slice(0, 60)}</div>}
      <p>{props.post.content}</p>
      <div className="mim-cm-reply-actions">
        <button type="button" onClick={() => props.onReply(props.post.id, props.post.author_name || 'Mim 用户')}>回复</button>
        <button type="button" onClick={() => setReporting(true)}>举报</button>
        {props.canAccept && <button type="button" className="is-primary" onClick={props.onAccept}>采纳为答案</button>}
        {canDelete && <button type="button" className="is-danger" disabled={busy} onClick={() => void remove()}>删除</button>}
      </div>
      {reporting && (
        <ReportDialog locale={props.locale} targetType="post" targetId={props.post.id} onClose={() => setReporting(false)} onDone={props.onNotice} />
      )}
    </div>
  );
} // 组件结束

/** 组件自带样式：不依赖 styles.css 的并行改动，类名统一 mim-cm- 前缀。 */
export function CommunityMoreStyles() { // 样式表
  return (
    <style>{`
.mim-cm-bell { position: relative; display: inline-block; }
.mim-cm-badge { margin-left: 4px; padding: 0 5px; border-radius: var(--radius-sm); background: var(--danger); color: var(--on-primary); font-size: var(--fs-xs); font-style: normal; line-height: 16px; }
.mim-cm-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; width: 320px; max-height: 420px; overflow: auto; padding: 8px; border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-lg); text-align: left; }
.mim-cm-pop.is-anchored { position: static; width: 100%; box-shadow: none; border: 0; padding: 4px 0; }
.mim-cm-pop button { display: block; width: 100%; text-align: left; margin: 0 0 2px; }
.mim-cm-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px 8px; border-bottom: 1px solid var(--border); }
.mim-cm-pop-head span { display: inline-flex; gap: 4px; }
.mim-cm-pop-head button { width: auto; margin: 0; }
.mim-cm-notify { display: flex !important; gap: 8px; align-items: flex-start; padding: 7px 6px !important; border-radius: var(--radius-sm); }
.mim-cm-notify.is-unread { background: var(--primary-soft); }
.mim-cm-notify-kind { flex: none; padding: 1px 6px; border-radius: var(--radius-xs); background: var(--primary-soft); font-size: var(--fs-xs); }
.mim-cm-notify-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mim-cm-notify-body strong { font-size: var(--fs-sm); }
.mim-cm-notify-body em { font-style: normal; color: var(--text-secondary); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px; }
.mim-cm-notify-body span { color: var(--text-subtle); font-size: var(--fs-xs); }
.mim-cm-mask { position: fixed; inset: 0; z-index: 90; background: var(--mask); display: flex; align-items: center; justify-content: center; padding: 20px; }
.mim-cm-sheet { width: min(560px, 100%); max-height: 82vh; overflow: auto; background: var(--surface); border-radius: var(--radius-md); padding: 14px; text-align: left; }
.mim-cm-sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.mim-cm-field { display: block; margin: 0 0 9px; }
.mim-cm-field input, .mim-cm-field textarea, .mim-cm-field select, .mim-cm-search-row input { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); font: inherit; }
.mim-cm-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-top: 8px; }
.mim-cm-row { display: block; width: 100%; text-align: left; margin: 0 0 6px; }
.mim-cm-search { padding: var(--card-pad-tight); border-radius: var(--card-radius-sm); background: var(--surface-2); margin-bottom: var(--card-pad-tight); }
.mim-cm-search-row { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap; }
.mim-cm-search-row input { flex: 1 1 220px; margin-top: 0; height: var(--field-h); min-height: var(--field-h); padding: 0 10px; border-color: transparent; border-radius: var(--control-radius); background: var(--surface); }
.mim-cm-search-row button { height: var(--control-h); border-radius: var(--control-radius); }
.mim-cm-hit { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; padding: 9px; margin-top: 8px; border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--border); }
.mim-cm-hit-meta { color: var(--text-muted); font-size: var(--fs-xs); }
.mim-cm-hit-snippet { color: var(--text); font-size: var(--fs-sm); }
.mim-cm-hit-snippet mark { background: var(--amber-border); color: inherit; padding: 0 1px; }
.mim-cm-hint { color: var(--text-muted); font-size: var(--fs-xs); margin: 6px 0 0; }
.mim-cm-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px 16px; border-radius: var(--card-radius-sm); background: var(--surface-3); color: var(--text-muted); font-size: var(--fs-sm); line-height: var(--lh-base); text-align: center; margin: 8px 0; }
.mim-cm-empty strong { color: var(--text); font-size: var(--fs-base); font-weight: var(--fw-semibold); }
.mim-cm-error { color: var(--danger); font-size: var(--fs-sm); margin: 6px 0; }
.mim-cm-tools { position: relative; display: inline-block; }
.mim-cm-quote { margin: 8px 0; padding: 8px 12px; border-left: 3px solid var(--primary-ring); border-radius: 0 var(--card-radius-sm) var(--card-radius-sm) 0; background: var(--primary-soft); color: var(--text-secondary); font-size: var(--fs-xs); line-height: var(--lh-base); }
.mim-cm-reply-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.mim-cm-reply-actions button { font-size: var(--fs-xs); }
.mim-cm-report { padding: 9px; margin-top: 8px; border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--border); }
.mim-cm-report p { margin: 5px 0; color: var(--text-secondary); font-size: var(--fs-sm); }
`}</style>
  );
} // 组件结束
