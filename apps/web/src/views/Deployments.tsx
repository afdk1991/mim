// 部署汇总视图：只保留 8 列核对表，页面不再展示总览统计、分布图、筛选与覆盖说明
import type { Locale } from '@mim/i18n'; // 语言类型：约束文案取值为 'zh-CN' | 'en-US'
// 接口客户端与错误文案翻译器
import { api, errorText } from '../api';
// 部署汇总共享类型：单项、结果
import type { DeploymentItem, DeploymentResult } from '../api';
// 通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';

// 组件对外契约：部署汇总文案跟随全局语言
interface Props {
  // 当前界面语言
  locale: Locale;
} // Props 结束

// 按语言取文案：集中管理双语字符串，避免散落在 JSX 里
function tr(locale: Locale, zh: string, en: string): string {
  // 英文环境取英文，其余取中文
  return locale === 'en-US' ? en : zh;
} // tr 结束

// 部署状态 → 徽标样式 + 文案；失败与未取证不共用同一标识
const STATUS_STYLE: Record<string, { cls: string; zh: string; en: string }> = {
  // 配置完整且本轮取证通过
  OK: { cls: 'ok', zh: '✅ 正常', en: '✅ OK' },
  // 存在阻断性缺陷
  BROKEN: { cls: 'fail', zh: '🔴 阻断 / 失败', en: '🔴 Broken' },
  // 链路已配置但本轮无可信取证
  UNVERIFIED: { cls: 'warn', zh: '🟡 未取证', en: '🟡 Unverified' },
  // 仅手工直传
  MANUAL: { cls: 'warn', zh: '🟡 手工直传', en: '🟡 Manual' },
  // 候选池 / 排除项
  NOT_APPLICABLE: { cls: 'muted', zh: '⚪ 不适用', en: '⚪ N/A' },
}; // STATUS_STYLE 结束

// 部署结果 → 徽标样式 + 文案；空数据（result === null）单独处理
const VERDICT_STYLE: Record<string, { cls: string; zh: string; en: string }> = {
  // 本轮取证通过
  PASS: { cls: 'ok', zh: '✅ 通过', en: '✅ Pass' },
  // 可达但内容层不可核验
  DEGRADED: { cls: 'warn', zh: '🟡 降级可用', en: '🟡 Degraded' },
  // 明确失败 / 不可达
  FAIL: { cls: 'fail', zh: '🔴 失败', en: '🔴 Fail' },
  // 本轮未发起探测
  NOT_TESTED: { cls: 'warn', zh: '🟡 未测', en: '🟡 Not tested' },
  // 探测已发起但无记录
  EMPTY: { cls: 'muted', zh: '⚪ 无记录', en: '⚪ Empty' },
}; // VERDICT_STYLE 结束

// 空值统一显示占位符：避免空白单元格被误读为「漏填」或「0」
function dash(value: string | number | null | undefined): string {
  // null / undefined / 空串统一为破折号
  return value === null || value === undefined || value === '' ? '—' : String(value);
} // dash 结束

// 渲染部署状态徽标：未知状态原样展示，避免脏数据渲染成空白
function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  // 查表命中按语言取值，未命中原样展示
  const s = STATUS_STYLE[status];
  // 未命中时返回中性徽标
  if (!s) return <span className="deploy-badge muted">{status}</span>;
  // 命中时返回对应配色徽标
  return <span className={`deploy-badge ${s.cls}`}>{tr(locale, s.zh, s.en)}</span>;
} // StatusBadge 结束

// 渲染部署结果：空数据、失败、降级、通过必须彼此可区分
function ResultBadge({ result, locale }: { result: DeploymentResult | null; locale: Locale }) {
  // result 为 null 属于「空数据」，不填充 0、不冒充成功
  if (result === null) {
    // 空数据徽标 + 明确说明
    return <span className="deploy-badge empty">{tr(locale, '⚪ 空数据（本轮无取证）', '⚪ Empty (no evidence)')}</span>;
  } // 空数据分支结束
  // 查表命中按语言取值
  const v = VERDICT_STYLE[result.verdict] ?? { cls: 'muted', zh: result.verdict, en: result.verdict };
  // 返回徽标 + HTTP / 字节数，便于与 curl 输出直接核对
  return (
    <span className={`deploy-badge ${v.cls}`}>{/* 执行当前业务步骤 */}
      {tr(locale, v.zh, v.en)} · {dash(result.http_code)} / {dash(result.bytes)}B
    </span>
  ); // 执行当前业务步骤
} // ResultBadge 结束

// 渲染访问域名：只展示域名（省略协议与路径），点击在新窗口打开完整入口地址
function EntryLink({ entryUrl }: { entryUrl: string | null }) {
  // 空入口：显示占位符并保留说明，避免空白被误读为漏填
  if (!entryUrl) return <span className="muted">—</span>;
  // 解析失败（注册表里可能是非标准地址）时原样展示，不吞掉信息
  let host = entryUrl;
  try { // 异常捕获起点：包裹可能抛出错误的操作
    host = new URL(entryUrl).host; // 优先只展示主机（含端口），列宽可控
  } catch {
    host = entryUrl; // 解析失败保留原文
  } // 代码块结束
  return ( // 返回当前函数的处理结果
    <a className="link" href={entryUrl} target="_blank" rel="noreferrer" title={entryUrl}>{/* 执行当前业务步骤 */}
      {host}
    </a>
  ); // 执行当前业务步骤
} // EntryLink 结束

// 部署汇总主视图：仅一张 8 列核对表（规范 ID / 名称 · 仓库标识 · 平台 / 层级 · 交付链路 · 访问域名 · 部署状态 · 部署结果 · 异常说明）
export function Deployments({ locale }: Props) {
  // 全量清单：页面已无筛选，固定拉取注册表全部部署项
  const list = useAsync(() => api.deployments.list(), []);
  // 清单加载失败：展示错误 + 重试入口，避免一次请求失败即永久空白
  if (list.error) {
    return ( // 返回当前函数的处理结果
      <div className="page">{/* 执行当前业务步骤 */}
        <p className="error">{errorText(locale, list.error)}</p>
        <p className="muted">{tr(locale, '无法连接部署汇总服务，请检查网络或接口可用性后重试。', 'Cannot reach the deployment summary service. Retry after checking connectivity.')}</p>
        <button type="button" className="btn primary" onClick={() => list.reload()}>{tr(locale, '重试', 'Retry')}</button>
      </div>
    ); // 执行当前业务步骤
  } // 错误态结束
  // 清单数据，未返回时兜底为空数组
  const items: DeploymentItem[] = list.data?.items ?? [];
  // 主渲染：加载态 / 空态 / 8 列表格
  return (
    <div className="page">{/* 执行当前业务步骤 */}
      {list.loading ? (
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : items.length === 0 ? (
        <p className="hint">{tr(locale, '暂无部署项。', 'No deployment items.')}</p>
      ) : (
        <div className="deploy-table-wrap">{/* 执行当前业务步骤 */}
          <table className="deploy-table">{/* 执行当前业务步骤 */}
            <thead>{/* 执行当前业务步骤 */}
              <tr>{/* 执行当前业务步骤 */}
                <th>{tr(locale, '规范 ID / 名称', 'ID / Name')}</th>
                <th>{tr(locale, '仓库标识', 'Repository')}</th>
                <th>{tr(locale, '平台 / 层级', 'Platform / Layer')}</th>
                <th>{tr(locale, '交付链路', 'Delivery')}</th>
                <th>{tr(locale, '访问域名', 'Domain')}</th>
                <th>{tr(locale, '部署状态', 'Deploy status')}</th>
                <th>{tr(locale, '部署结果', 'Deploy result')}</th>
                <th>{tr(locale, '异常说明', 'Anomalies')}</th>
              </tr>
            </thead>
            <tbody>{/* 执行当前业务步骤 */}
              {items.map((item) => (
                <tr key={item.id} className="deploy-row">{/* 执行当前业务步骤 */}
                  <td>{/* 执行当前业务步骤 */}
                    <code>{item.id}</code>
                    <div className="muted">{item.name}</div>
                  </td>
                  <td><code>{dash(item.repository.id)}</code><div className="muted">{dash(item.repository.role)}</div></td>
                  <td>{item.platform}<div className="muted">{item.layer} / {item.kind}</div></td>
                  <td><code>{item.delivery.mode}</code><div className="muted">{dash(item.delivery.ci_job)}{item.delivery.artifact_in_head === true && item.delivery.artifact_in_worktree === false ? ' · ⚠ 漂移' : ''}</div></td>
                  <td><EntryLink entryUrl={item.entry_url} /></td>
                  <td><StatusBadge status={item.status} locale={locale} /></td>
                  <td><ResultBadge result={item.result} locale={locale} /></td>
                  <td>{/* 执行当前业务步骤 */}
                    {item.anomalies.length === 0
                      ? <span className="muted">—</span>
                      : <span className="deploy-badge warn">{item.anomalies.length} {tr(locale, '项', 'items')}</span>}
                    <div className="muted">{item.anomalies[0]?.code ?? '—'}</div>
                    {item.missing_fields.length > 0 && (
                      <div><span className="deploy-badge missing">⚠ {tr(locale, '缺失', 'missing')} {item.missing_fields.length}</span></div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  ); // 执行当前业务步骤
} // Deployments 组件结束
