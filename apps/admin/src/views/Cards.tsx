// 充值卡密管理：批量生成、用量统计、作废未兑换卡密；用户在前台充值页输入卡密兑换余额
import { useState } from 'react'; // 批量生成表单与最近一批回显
import { describeError } from '../api'; // 统一错误文案
import type { Credential } from '../api'; // 凭证类型
import { createAdminCardBatch, listAdminCards, voidAdminCard } from '../api-shop-admin'; // 卡密三类操作
import type { AdminCard } from '../api-shop-admin'; // 卡密视图类型
import { useAsync } from '../hooks'; // 统一异步加载

/** 入参：凭证与实时权限码 */
interface Props {
  credential: Credential; // 凭证
  permissions: string[]; // 实时权限码
}

/** 单批生成上限：与后端 cardBatchSchema 的 count.max(500) 一致 */
const MAX_BATCH = 500;

/** 分转元，保留两位小数 */
function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`; // 金额统一走分存储
}

/** 元串转分：非法或非正数返回 null */
function toCents(raw: string): number | null {
  const value = Number(raw); // 先按数字解析
  if (!Number.isFinite(value) || value <= 0) return null; // 面额必须为正
  return Math.round(value * 100); // 统一按分四舍五入
}

/** 单张卡密的状态文案与徽标：作废优先于兑换 */
function cardState(row: AdminCard): { label: string; className: string } {
  if (row.voided) return { label: '已作废', className: 'badge danger' }; // 作废态
  if (row.status === 'used') return { label: '已兑换', className: 'badge archived' }; // 已核销
  return { label: '未使用', className: 'badge active' }; // 可兑换
}

/** 字段级错误提示：紧跟输入框，避免提交后才知道哪里错 */
function FieldError({ text }: { text?: string }) {
  if (!text) return null; // 无错误不占位
  return <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{text}</span>; // 就地红字
}

/** 卡密面板：嵌在商品管理的「卡密」页签内 */
export function Cards({ credential, permissions }: Props) {
  const canWrite = permissions.includes('commerce:write'); // 与后端 requireCommerceWrite 对齐
  const state = useAsync(() => listAdminCards(credential), [credential]); // 最近 500 张 + 统计
  const [busy, setBusy] = useState(false); // 写操作进行中
  const [notice, setNotice] = useState(''); // 成功提示
  const [error, setError] = useState(''); // 接口错误
  const [amount, setAmount] = useState(''); // 面额（元）
  const [count, setCount] = useState('10'); // 生成张数
  const [errors, setErrors] = useState<Record<string, string>>({}); // 字段错误
  const [batch, setBatch] = useState<AdminCard[]>([]); // 最近一批生成的卡密
  const cards = state.data?.cards ?? []; // 最近 500 张
  const stats = state.data?.stats; // 用量统计

  /** 统一执行写操作：成功后提示并刷新列表，失败统一转文案 */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空接口错误
    setNotice(''); // 清空旧提示
    try {
      await action(); // 执行写请求
      setNotice(success); // 成功文案
      state.reload(); // 刷新列表与统计
    } catch (err) {
      setError(describeError(err)); // 业务错误直接展示
    } finally {
      setBusy(false); // 退出忙碌态
    }
  }

  /** 批量生成：先就地校验面额与张数，通过后再发请求 */
  function submitBatch() {
    const nextErrors: Record<string, string> = {}; // 收集字段错误
    const cents = toCents(amount.trim()); // 元转分
    if (cents === null || cents < 1) nextErrors.amount = '面额需为不小于 0.01 元的金额'; // 后端下限 1 分
    const total = Number(count.trim()); // 张数
    if (!Number.isInteger(total) || total < 1 || total > MAX_BATCH) nextErrors.count = `张数需为 1-${MAX_BATCH} 的整数`;
    setErrors(nextErrors); // 渲染错误
    if (Object.keys(nextErrors).length > 0) return; // 有错不发请求
    void run(async () => {
      const result = await createAdminCardBatch(credential, { amount_cents: cents as number, count: total }); // 批量生成
      setBatch(result.cards); // 回显本批卡密，方便立即复制分发
      setAmount(''); // 成功后清空面额，避免误触重复生成
    }, `已生成 ${total} 张面额 ${formatYuan(cents as number)} 的卡密`); // 成功文案
  }

  /** 作废：破坏性操作先二次确认；已兑换卡密后端会拒绝 */
  function voidCard(row: AdminCard) {
    const ok = window.confirm(`确认作废卡密「${row.code}」？作废后不可再兑换，且不可撤销。`); // 二次确认
    if (!ok) return; // 用户取消
    void run(() => voidAdminCard(credential, row.code), `卡密 ${row.code} 已作废`); // 执行作废
  }

  return (
    <>
      {!canWrite ? <div className="hint">当前身份缺少 commerce:write 权限，只能查看卡密，不能生成或作废。</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <div className="panel-head">
          <h3>批量生成卡密</h3>
          <span className="muted">单批最多 {MAX_BATCH} 张，生成后立即生效</span>
        </div>
        <div className="form inline">
          <label>
            面额（元）
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="10.00"
              inputMode="decimal"
              aria-invalid={Boolean(errors.amount)}
            />
            <FieldError text={errors.amount} />
          </label>
          <label>
            生成张数
            <input
              value={count}
              onChange={(event) => setCount(event.target.value)}
              placeholder="10"
              inputMode="numeric"
              aria-invalid={Boolean(errors.count)}
            />
            <FieldError text={errors.count} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={submitBatch}>
            批量生成
          </button>
        </div>

        {batch.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="panel-head">
              <h3>最近一批 · 共 {batch.length} 张</h3>
              <span className="muted">刷新页面后本批回显会消失，卡密仍保存在下方列表</span>
            </div>
            <textarea readOnly value={batch.map((card) => card.code).join('\n')} rows={Math.min(batch.length, 6)} />
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>卡密列表</h3>
          <span className="muted">
            {stats ? `共 ${stats.total} 张 · 未使用 ${stats.unused} · 已兑换 ${stats.used} · 已作废 ${stats.voided}` : '统计加载中…'}
          </span>
        </div>

        {state.loading ? <p className="muted">加载中…</p> : null}
        {state.error ? <p className="error">列表加载失败：{describeError(state.error)}</p> : null}
        {!state.loading && !state.error && cards.length === 0 ? (
          <div className="empty">
            还没有卡密，因为从未批量生成过。
            <br />
            下一步：在上方填写面额与张数点「批量生成」，把生成的卡密发给用户，用户可在充值页输入兑换余额。
          </div>
        ) : null}

        {cards.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>卡密</th>
                <th>面额</th>
                <th>状态</th>
                <th>生成时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((row) => {
                const view = cardState(row); // 状态文案与徽标
                const locked = row.voided || row.status === 'used'; // 已作废或已兑换不可再作废
                return (
                  <tr key={row.id}>
                    <td>
                      <code>{row.code}</code>
                    </td>
                    <td>{formatYuan(row.amount_cents)}</td>
                    <td>
                      <span className={view.className}>{view.label}</span>
                      {row.used_at ? <div className="muted">兑换于 {row.used_at.slice(0, 16)}</div> : null}
                      {row.voided_at ? <div className="muted">作废于 {row.voided_at.slice(0, 16)}</div> : null}
                    </td>
                    <td>{row.created_at.slice(0, 16)}</td>
                    <td>
                      {canWrite ? (
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={busy || locked}
                          title={locked ? '已兑换或已作废的卡密不能再次作废' : '作废后不可再兑换'}
                          onClick={() => voidCard(row)}
                        >
                          作废
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

        {cards.length > 0 ? <div className="hint">仅展示最近 500 张；更早的卡密请按需在数据库中检索。</div> : null}
      </section>
    </>
  );
}
