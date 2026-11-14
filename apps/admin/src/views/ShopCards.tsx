// 充值卡密管理视图：批量生成 + 用量统计 + 作废
import { useState } from 'react'; // 表单状态
import type { AdminCard, Credential } from '../api'; // 类型
import {
  createAdminCardBatch,
  describeError,
  listAdminCards,
  voidAdminCard,
} from '../api'; // 卡密 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限集合
} // Props 结束

/** 金额分转元展示 */
function yuan(value: number): string { // 业务步骤
  return `${(value / 100).toFixed(2)} 元`; // 固定两位小数
} // yuan 结束

/** 卡密管理视图主体 */
export function ShopCards({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('commerce:write'); // 写操作权限点
  const listState = useAsync(() => listAdminCards(credential), [credential]); // 卡密列表 + 统计
  const [amountYuan, setAmountYuan] = useState('10'); // 面额（元）
  const [count, setCount] = useState('10'); // 生成张数
  const [lastBatch, setLastBatch] = useState<AdminCard[]>([]); // 最近一批生成的卡密
  const [error, setError] = useState(''); // 错误提示
  const [notice, setNotice] = useState(''); // 成功提示
  const [busy, setBusy] = useState(false); // 操作中

  /** 统一执行写操作：成功后刷新列表 */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      await action(); // 执行
      setNotice(success); // 成功提示
      listState.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // run 结束

  /** 批量生成：面额元转分，张数取整 1-500 */
  function submit() {
    const amount_cents = Math.max(1, Math.round(Number(amountYuan || 0) * 100)); // 元转分兜底 1 分
    const batchCount = Math.min(500, Math.max(1, Math.round(Number(count || 0)))); // 张数限幅
    void run(async () => { // 业务步骤
      const result = await createAdminCardBatch(credential, { amount_cents, count: batchCount }); // 生成批次
      setLastBatch(result.cards); // 保留本批码便于复制分发
    }, `已生成 ${batchCount} 张卡密`); // 成功提示
  } // submit 结束

  /** 作废：二次确认，仅未使用卡密可作废 */
  function remove(row: AdminCard) {
    if (!window.confirm(`确认作废卡密 ${row.code}？作废后不可兑换。`)) return; // 用户取消不动作
    void run(() => voidAdminCard(credential, row.code), '卡密已作废'); // 执行作废
  } // remove 结束

  const cards = listState.data?.cards ?? []; // 列表兜底空数组
  const stats = listState.data?.stats; // 统计行，加载中为 undefined

  return ( // 返回当前视图
    <div className="page">{/* 页面容器 */}
      <header className="page-head">{/* 标题行 */}
        <h1>充值卡密</h1>
        <p className="muted">批量生成面额卡密：未使用可作废，已兑换卡密保留对账记录不可回滚。</p>
      </header>

      {!canWrite && <div className="panel error">当前账号缺少 commerce:write 权限，仅可查看。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">{/* 批量生成面板 */}
        <div className="panel-head"><h3>批量生成</h3></div>
        <div className="form inline">{/* 行内表单 */}
          <label>面额（元）<input value={amountYuan} inputMode="decimal" onChange={(event) => setAmountYuan(event.target.value)} /></label>
          <label>张数（1-500）<input value={count} inputMode="numeric" onChange={(event) => setCount(event.target.value)} /></label>
          <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={submit}>生成卡密</button>
        </div>
        {lastBatch.length > 0 && ( // 本批生成结果直接列出码，便于复制分发
          <label className="field" style={{ marginTop: 12 }}>本批卡密（每行一条）
            <textarea readOnly rows={Math.min(8, lastBatch.length)} value={lastBatch.map((card) => card.code).join('\n')} />
          </label>
        )}
      </section>

      <section className="panel">{/* 统计面板 */}
        <div className="panel-head"><h3>用量统计</h3></div>
        {stats ? ( // 统计就绪后展示四项计数
          <div className="deploy-kv">
            <span className="badge">总数 {stats.total}</span>
            <span className="badge active">可用 {stats.unused}</span>
            <span className="badge">已兑换 {stats.used}</span>
            <span className="badge danger">已作废 {stats.voided}</span>
          </div>
        ) : <p className="muted">加载中…</p>}
      </section>

      <section className="panel">{/* 列表面板 */}
        <div className="panel-head"><h3>卡密列表</h3><span className="muted">{cards.length}</span></div>
        {listState.loading && <p className="muted">加载中…</p>}
        {cards.map((row) => ( // 逐条渲染卡密行
          <div className="deploy-row" key={row.id}>{/* 行容器 */}
            <div className="deploy-kv">{/* 主信息列 */}
              <span><strong>{row.code}</strong> · {yuan(row.amount_cents)}</span>
              <span className={`badge ${row.status === 'used' ? '' : 'active'}`}>{row.status === 'used' ? '已兑换' : '未使用'}</span>
              {row.voided && <span className="badge danger">已作废</span>}
              <span className="muted">{row.used_at ? `兑换于 ${row.used_at.slice(0, 16)}` : row.created_at.slice(0, 16)}</span>
            </div>
            <div className="deploy-columns">{/* 操作列 */}
              {row.status === 'unused' && !row.voided && (
                <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => remove(row)}>作废</button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  ); // 视图返回结束
} // ShopCards 结束
