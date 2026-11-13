// 批量改价管理视图：提交固定价 / 百分比 / 金额增减三类调价，并展示批次快照与回滚入口
import { useState } from 'react'; // 表单与提示状态
import type { PriceBatchDirection, PriceBatchMode, PriceBatchTarget, PriceBatchView, Credential } from '../api'; // 本视图使用的类型
import { createPriceBatch, describeError, listPriceBatches, rollbackPriceBatch } from '../api'; // 调价 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 组件入参
  credential: Credential; // 当前后台凭证
  permissions: string[]; // 当前权限集合
} // Props 结束

/** 分转元：列表展示保留两位小数 */
function yuan(value: number | null, currency: string | null = 'CNY'): string { // 业务步骤
  if (value === null) return '—'; // 无价格行
  return `${(value / 100).toFixed(2)} ${currency ?? 'CNY'}`; // 币种缺省 CNY
} // yuan 结束

/** 生成批次幂等键：只要求操作人作用域内唯一 */
function batchKey(): string { // 业务步骤
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; // 浏览器兜底
  return `admin-batch-${random}`; // 前缀便于审计检索
} // batchKey 结束

/** 批量改价视图主体 */
export function PriceBatches({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('commerce:write'); // 与后端 requirePermission 一致
  const batchesState = useAsync(() => (canWrite ? listPriceBatches(credential) : Promise.resolve<PriceBatchView[]>([])), [credential, canWrite]); // 最近批次
  const [target, setTarget] = useState<PriceBatchTarget>('shop_product'); // 目标类型：商品更常用
  const [mode, setMode] = useState<PriceBatchMode>('percent'); // 默认按百分比
  const [direction, setDirection] = useState<PriceBatchDirection>('decrease'); // 默认下调
  const [value, setValue] = useState('10'); // 默认 10%
  const [region, setRegion] = useState('cn'); // 模块区域
  const [category, setCategory] = useState(''); // 分类筛选
  const [codes, setCodes] = useState(''); // 显式编码，逗号或换行分隔
  const [includeInactive, setIncludeInactive] = useState(false); // 是否纳入下架目标
  const [notice, setNotice] = useState(''); // 成功提示
  const [error, setError] = useState(''); // 失败提示
  const [busy, setBusy] = useState(false); // 提交中

  /** 提交一批调价：金额统一按元输入、按分提交 */
  async function submit() {
    setBusy(true); // 进入提交态
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try { // 业务步骤
      const numeric = mode === 'percent' ? Number(value) : Math.round(Number(value) * 100); // 百分比取整数，金额元转分
      if (!Number.isFinite(numeric) || numeric < 0) throw new Error('调价参数必须是非负数字'); // 本地前置校验
      const batch = await createPriceBatch(credential, { // 业务步骤
        target_type: target, // 目标类型
        mode, // 调价模式
        direction: mode === 'fixed' ? 'set' : direction, // 固定价方向固定 set
        value: numeric, // 模式参数
        filter: {
          region: target === 'module' ? region : undefined, // 区域仅模块有效
          category_slug: target === 'module' && category.trim() ? category.trim() : undefined, // 分类仅模块有效
          codes: codes.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean), // 编码清单
          include_inactive: includeInactive, // 是否含下架
        }, // 代码块结束
        idempotency_key: batchKey(), // 批次幂等键
      });
      setNotice(`批次已执行：命中 ${batch.total}，改动 ${batch.changed}，跳过 ${batch.skipped}`); // 结果摘要
      batchesState.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 统一错误文案
    } finally {
      setBusy(false); // 退出提交态
    } // 业务步骤
  } // submit 结束

  return ( // 返回当前函数的处理结果
    <div className="page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h1>批量改价</h1>
        <p className="muted">模块与独立商城商品统一调价，事务化执行并保留改前快照，可按批次一键回滚。</p>
      </header>

      {!canWrite && <div className="panel error">当前账号缺少 commerce:write 权限，无法提交调价。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">{/* 执行当前业务步骤 */}
        <div className="panel-head"><h3>新建调价批次</h3></div>
        <div className="form inline">{/* 执行当前业务步骤 */}
          <label>目标{/* 执行当前业务步骤 */}
            <select value={target} onChange={(event) => setTarget(event.target.value as PriceBatchTarget)}>{/* 执行当前业务步骤 */}
              <option value="shop_product">独立商城商品</option>
              <option value="module">功能模块</option>
            </select>
          </label>
          <label>模式{/* 执行当前业务步骤 */}
            <select value={mode} onChange={(event) => setMode(event.target.value as PriceBatchMode)}>{/* 执行当前业务步骤 */}
              <option value="percent">按百分比</option>
              <option value="amount">按金额（元）</option>
              <option value="fixed">固定价（元）</option>
            </select>
          </label>
          {mode !== 'fixed' && (
            <label>方向{/* 执行当前业务步骤 */}
              <select value={direction} onChange={(event) => setDirection(event.target.value as PriceBatchDirection)}>{/* 执行当前业务步骤 */}
                <option value="decrease">下调</option>
                <option value="increase">上调</option>
              </select>
            </label>
          )}
          <label>{mode === 'percent' ? '百分点' : '金额（元）'}{/* 执行当前业务步骤 */}
            <input value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" />
          </label>
        </div>
        <div className="form inline">{/* 执行当前业务步骤 */}
          {target === 'module' && (
            <label>区域{/* 执行当前业务步骤 */}
              <select value={region} onChange={(event) => setRegion(event.target.value)}>{/* 执行当前业务步骤 */}
                <option value="cn">cn</option>
                <option value="global">global</option>
              </select>
            </label>
          )}
          {target === 'module' && (
            <label>分类 slug{/* 执行当前业务步骤 */}
              <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="可留空" />
            </label>
          )}
          <label className="grow">指定编码{/* 执行当前业务步骤 */}
            <input value={codes} onChange={(event) => setCodes(event.target.value)} placeholder="多个编码用逗号或换行分隔；留空按筛选条件全量" />
          </label>
          <label className="check"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />含下架 / 归档</label>
          <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void submit()}>{busy ? '执行中…' : '执行调价'}</button>
        </div>
        <p className="hint">0 价免费商品自动跳过；百分比只能 1–100；金额与固定价按元填写、后端按分落库。</p>
      </section>

      <section className="panel">{/* 执行当前业务步骤 */}
        <div className="panel-head"><h3>最近批次</h3><button type="button" className="btn ghost" onClick={batchesState.reload}>刷新</button></div>
        {batchesState.loading && <p className="muted">加载中…</p>}
        {Boolean(batchesState.error) && <p className="error">{describeError(batchesState.error)}</p>}
        {(batchesState.data ?? []).length === 0 && !batchesState.loading ? <p className="empty">暂无调价批次</p> : null}
        {(batchesState.data ?? []).map((batch) => (
          <article className="panel" key={batch.id} style={{ marginBottom: 12 }}>{/* 执行当前业务步骤 */}
            <div className="panel-head">{/* 执行当前业务步骤 */}
              <h3>{batch.target_type === 'module' ? '模块' : '商品'} · {batch.mode} · {batch.direction}</h3>
              <span className={`badge ${batch.rolled_back_at ? 'danger' : 'success'}`}>{batch.rolled_back_at ? '已回滚' : '已生效'}</span>
            </div>
            <div className="deploy-kv">{/* 执行当前业务步骤 */}
              <span>参数 {batch.value}{batch.mode === 'percent' ? '%' : ' 分'}</span>
              <span>命中 {batch.total} / 改动 {batch.changed} / 跳过 {batch.skipped}</span>
              <span>{batch.created_at.slice(0, 16)}</span>
            </div>
            {batch.items.length > 0 && (
              <div className="table-wrap">{/* 执行当前业务步骤 */}
                <table className="table">{/* 执行当前业务步骤 */}
                  <thead><tr><th>编码</th><th>改前</th><th>改后</th><th>结果</th></tr></thead>
                  <tbody>{/* 执行当前业务步骤 */}
                    {batch.items.map((item, index) => (
                      <tr key={`${batch.id}-${item.target_id}-${index}`}>{/* 执行当前业务步骤 */}
                        <td>{item.target_code ?? item.target_id}</td>
                        <td>{yuan(item.before_amount_minor, item.currency)}</td>
                        <td>{yuan(item.after_amount_minor, item.currency)}</td>
                        <td>{item.skipped ? <span className="badge warning">{item.reason ?? '跳过'}</span> : <span className="badge success">已改</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!batch.rolled_back_at && (
              <button type="button" className="btn ghost" disabled={!canWrite || busy} onClick={() => void (async () => {{/* 执行当前业务步骤 */}
                setBusy(true); // 回滚期间禁用按钮
                setError(''); // 清空旧错误
                try { // 业务步骤
                  await rollbackPriceBatch(credential, batch.id); // 按快照回滚
                  setNotice('批次已回滚'); // 成功提示
                  batchesState.reload(); // 刷新列表
                } catch (err) {
                  setError(describeError(err)); // 统一错误
                } finally {
                  setBusy(false); // 退出忙碌态
                } // 业务步骤
              })()}>按快照回滚</button>
            )}
          </article>
        ))}
      </section>
    </div>
  ); // 执行当前业务步骤
} // PriceBatches 结束
