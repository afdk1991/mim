// 账号注销队列视图：待删除账号台账、清理策略概览、手动触发一轮清理与最近执行留痕
import { useState } from 'react'; // 操作中间态与结果提示
import type { Credential } from '../api'; // 后台凭证类型
import { describeError } from '../api'; // 统一错误文案
import { listDeletions, runDeletionPurge } from '../api-privacy'; // 注销域 API
import type { DeletionLastRun, DeletionQueuePayload, PurgeRunResult } from '../api-privacy'; // 队列与结果类型
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 入参
  credential: Credential; // 后台凭证
  permissions: string[]; // 当前身份生效权限码集合
} // Props 结束

/** 触发来源中文映射：与后端 last_run.source 取值一一对应 */
const SOURCE_LABEL: Record<DeletionLastRun['source'], string> = {
  startup: '启动触发', // 服务启动首轮扫描
  interval: '周期调度', // 调度器按间隔扫描
  manual: '手动执行', // 后台管理员手动触发
}; // SOURCE_LABEL 结束

/** 剩余秒数格式化：≥1 天「X 天 Y 小时」；不足一天「Y 小时 Z 分」；≤0「已到期」 */
function formatRemainingSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '已到期'; // 非有限值或零负时长按到期处理
  const days = Math.floor(seconds / 86400); // 整天数（一天 86400 秒）
  if (days > 0) {
    const hours = Math.floor((seconds % 86400) / 3600); // 扣除整天后剩余整小时
    return `${days} 天 ${hours} 小时`; // 超过一天：天 + 小时两档
  }
  const hours = Math.floor(seconds / 3600); // 不足一天：整小时数
  const minutes = Math.floor((seconds % 3600) / 60); // 扣除整小时后剩余整分
  return `${hours} 小时 ${minutes} 分`; // 不足一天：小时 + 分两档
} // formatRemainingSeconds 结束

/** 把 ISO 时间格式化为本地展示串 YYYY-MM-DD HH:mm；空值 / 非法串回落占位符 */
function formatDateTime(iso: string | null): string {
  if (!iso) return '—'; // 空时刻兜底
  const d = new Date(iso); // 解析时间串
  if (!Number.isFinite(d.getTime())) return iso; // 解析失败原样返回，便于排障
  const pad = (n: number) => String(n).padStart(2, '0'); // 两位补零
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; // 年月日 + 时分
} // formatDateTime 结束

/** 账号注销视图主体 */
export function Deletions({ credential, permissions }: Props) {
  const canRead = permissions.includes('user:read'); // 队列读权限（对齐后端 GET /admin/deletions 门禁）
  const canWrite = permissions.includes('privacy:write'); // 手动清理写权限（对齐后端 POST /admin/deletions/run 门禁）
  const queueState = useAsync<DeletionQueuePayload | null>( // 队列 + 策略 + 留痕一次性拉取
    () => (canRead ? listDeletions(credential) : Promise.resolve<DeletionQueuePayload | null>(null)), // 无读权限不拉请求，回落空态
    [credential, canRead], // 凭证或读权限变化时重新加载
  ); // queueState 结束
  const [busy, setBusy] = useState(false); // 手动清理操作中间态
  const [error, setError] = useState(''); // 错误提示
  const [notice, setNotice] = useState(''); // 成功提示
  const [lastResult, setLastResult] = useState<PurgeRunResult | null>(null); // 最近一次手动触发的回收回执

  const payload = queueState.data; // 队列总览响应
  const items = payload?.items ?? []; // 队列行清单
  const policy = payload?.policy; // 当前生效清理策略
  const lastRun = payload?.last_run; // 最近一次调度 / 手动执行留痕

  /** 立即执行一轮清理：二次确认后调用写接口，成功后展示回收条数并刷新队列 */
  async function runPurge() {
    if (!canWrite) return; // 无写权限直接拦截，按钮本已禁用，此处兜底防误触
    if (!window.confirm('确认立即执行一轮到期账号清理？已到期账号将被物理删除，数据不可恢复。')) return; // 不可逆操作先二次确认
    setBusy(true); // 进入忙碌态
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await runDeletionPurge(credential); // 触发清理引擎跑一轮
      setLastResult(result); // 保存本次回执用于展示
      setNotice(`本轮扫描 ${result.scanned} 个账号，回收 ${result.purged} 个。`); // 回收条数提示
      queueState.reload(); // 刷新队列与留痕
    } catch (err) {
      setError(describeError(err)); // 统一错误文案
    } finally {
      setBusy(false); // 退出忙碌态
    } // try 结束
  } // runPurge 结束

  return ( // 返回当前视图的处理结果
    <div className="page">{/* 页面容器 */}
      <header className="page-head">{/* 页头标题与说明 */}
        <h1>账号注销</h1>
        <p className="page-desc">查看申请注销并处于冷静期的账号；到期后由清理引擎物理删除，撤销需在到期前完成。</p>
      </header>

      {/* 权限提示：读权限缺失时无法查看队列；写权限缺失时仅可只读 */}
      {!canRead && <div className="panel hint">当前账号缺少 user:read 权限，无法查看注销队列。</div>}
      {canRead && !canWrite && <div className="panel hint">当前账号缺少 privacy:write 权限，仅可查看队列，不能手动触发清理。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      {/* 清理策略卡片：冷静期 / 扫描间隔 / 批大小 / 自动清理开关 */}
      <section className="panel">{/* 策略面板 */}
        <div className="panel-head"><h3>清理策略</h3></div>
        {queueState.loading ? <p className="muted">加载中…</p> : policy ? (
          <div className="deploy-kv">{/* 策略键值行 */}
            <span>冷静期：{policy.grace_days} 天</span>
            <span>扫描间隔：{policy.sweep_minutes} 分钟</span>
            <span>单批大小：{policy.batch_size} 个账号</span>
            <span>自动清理：<span className={`badge ${policy.auto_purge_enabled ? 'success' : 'muted'}`}>{policy.auto_purge_enabled ? '已开启' : '已关闭'}</span></span>
          </div>
        ) : <p className="muted">暂无策略数据。</p>}
      </section>

      {/* 待删除队列表：Mim ID / 昵称 / 区域 / 预约时间 / 剩余 / 逾期 */}
      <section className="panel">{/* 队列面板 */}
        <div className="panel-head">
          <h3>待删除队列</h3>
          <span className="muted">{items.length} 条</span>
          <button type="button" className="btn ghost" onClick={queueState.reload}>刷新</button>
        </div>
        {queueState.loading && <p className="muted">加载中…</p>}
        {Boolean(queueState.error) && <p className="error">{describeError(queueState.error)}</p>}
        {items.length === 0 && !queueState.loading && !queueState.error ? <p className="empty">暂无待删除账号</p> : null}
        {items.length > 0 && (
          <div className="table-wrap">{/* 表格外壳：宽内容横向滚动 */}
            <table className="table">{/* 队列数据表 */}
              <thead><tr><th>Mim ID</th><th>昵称</th><th>区域</th><th>预约时间</th><th>剩余</th><th>逾期</th></tr></thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.user_id}>{/* 行主键用内部用户 ID */}
                    <td><strong>{row.member_no || '—'}</strong></td>
                    <td>{row.display_name || '—'}</td>
                    <td>{row.region}</td>
                    <td>{formatDateTime(row.deletion_scheduled_at)}</td>
                    <td>{formatRemainingSeconds(row.remaining_seconds)}</td>
                    <td>{row.overdue ? <span className="badge danger">已逾期</span> : <span className="badge success">未逾期</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 手动清理操作区：触发按钮 + 本次回执 + 最近一次执行留痕 */}
      <section className="panel">{/* 手动清理面板 */}
        <div className="panel-head"><h3>手动清理</h3></div>
        <div className="deploy-columns">{/* 操作行：按钮与回执并排 */}
          <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void runPurge()}>
            {busy ? '执行中…' : '立即执行清理'}
          </button>
          {lastResult ? (
            <span className="muted">上次手动触发：扫描 {lastResult.scanned} · 回收 {lastResult.purged} · 审计 {lastResult.audit_id}</span>
          ) : null}
        </div>
        <div className="deploy-kv">{/* 留痕键值行 */}
          {lastRun ? (
            <span>最近一次执行：{formatDateTime(lastRun.at)} · 回收 {lastRun.purged} 个 · 来源 {SOURCE_LABEL[lastRun.source] ?? lastRun.source}</span>
          ) : (
            <span>最近一次执行：尚未执行过清理</span>
          )}
        </div>
      </section>
    </div>
  ); // 视图 JSX 返回结束
} // Deletions 结束
