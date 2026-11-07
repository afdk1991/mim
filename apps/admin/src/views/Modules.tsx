// 功能模块视图：展示公开模块目录，并按单向状态机执行 draft→active→archived 迁移
import { useState } from 'react'; // React 状态钩子：管理忙碌标记与操作提示
import type { Credential, ModuleStatus, ModuleView } from '../api'; // 仅类型导入：凭证、状态枚举、模块视图模型
import { describeError, listModules, updateModuleStatus } from '../api'; // API 调用：错误文案、模块列表、状态迁移（请求自动携带凭证鉴权头）
import { useAsync } from '../hooks'; // 异步数据加载钩子，统一 loading/error/data 三态

// 组件入参：凭证由 App 下发，权限用于控制写操作是否可见
interface ModulesProps {
  // 当前身份凭证
  credential: Credential;
  // 当前身份生效权限码
  permissions: string[];
} // 入参接口结束

// 状态中文文案：与后端枚举一一对应
const STATUS_LABEL: Record<string, string> = {
  // 草稿态：仅后台可见
  draft: '草稿',
  // 已上线：前台目录可见
  active: '已上线',
  // 已下线：终态，不可再流转
  archived: '已下线',
}; // 状态文案表结束

// 下一步迁移表：archived 为终态，故意不出现在表内
const NEXT_STATUS: Record<string, { next: ModuleStatus; label: string }> = {
  // 草稿只能上线
  draft: { next: 'active', label: '上线' },
  // 已上线只能下线
  active: { next: 'archived', label: '下线' },
}; // 迁移表结束：未列出的状态即无下一步

// 多语言字段取值：入参放宽为 string | undefined，规避 TS2869 不可达分支告警
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 中文优先，其次英文，最后退回编码
  return field['zh-CN'] ?? field.en ?? fallback;
} // 多语言取值函数结束

// 价格格式化：null 表示免费或未定价
function formatPrice(price: ModuleView['current_price']): string {
  // 无价格直接标记免费
  if (!price) return '免费';
  // amount_minor 为最小货币单位，除以 100 还原为元
  return `${price.currency} ${(price.amount_minor / 100).toFixed(2)}`;
} // 价格格式化函数结束

// 模块管理组件
export function Modules({ credential, permissions }: ModulesProps) {
  // 是否具备写权限：无 module:write 时按钮全部禁用
  const canWrite = permissions.includes('module:write');
  // 加载模块目录，凭证变化时重新拉取
  const state = useAsync(() => listModules(credential), [credential]);
  // 当前正在迁移的模块码，用于逐行禁用按钮防重复提交
  const [busyCode, setBusyCode] = useState<string | null>(null);
  // 最近一次操作结果提示
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // 执行状态迁移：成功后刷新列表，失败透出后端文案
  async function runTransition(module: ModuleView, next: ModuleStatus, label: string) {
    // 标记该行忙碌
    setBusyCode(module.code);
    // 清空历史提示
    setNotice(null);
    // 调用后端单向迁移端点
    try {
      // region 必须与模块行一致，避免跨区域误改
      await updateModuleStatus(credential, module.code, next, module.region);
      // 成功提示
      setNotice({ kind: 'success', text: `${module.code} 已${label}` });
      // 刷新列表拿到最新状态
      state.reload();
    } catch (error) { // 捕获后端拒绝或网络异常
      // 失败时展示 code + message
      setNotice({ kind: 'error', text: describeError(error) });
    } finally { // 收尾块：成功失败都会执行
      // 无论成败都解除忙碌标记
      setBusyCode(null);
    } // finally 结束
  } // runTransition 结束

  // 预计算行数据，便于在 TS 位置逐行注释
  const rows = (state.data ?? []).map((module) => {
    // 名称按中文优先回退
    const name = pickLocale(module.name, module.code);
    // 摘要缺省用破折号占位
    const summary = pickLocale(module.summary, '—');
    // 查表得到下一步动作；终态为 undefined
    const action = NEXT_STATUS[module.status];
    // 返回渲染所需字段
    return { module, name, summary, action };
  }); // 行数据预计算结束

  // 渲染
  return (
    <div className="page"> {/* 页面根容器 */}
      <div className="page-head"> {/* 页头：标题与计数说明 */}
        <h2>功能模块</h2> {/* 视图标题 */}
        <span className="count"> {/* 模块总数与状态机规则提示 */}
          共 {rows.length} 个模块 · 状态单向流转 draft → active → archived {/* rows 为预计算行数据 */}
        </span> {/* 计数说明结束 */}
      </div> {/* 页头结束 */}
      {notice ? ( // 存在操作结果时渲染提示条
        // 操作结果提示条
        <div className={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}</div>
      ) : null} {/* 无提示时不占位 */}
      {!canWrite ? ( // 无写权限时展示禁用原因
        // 只读提示：权限不足时说明为何按钮不可用
        <div className="hint">当前身份缺少 module:write 权限，状态按钮已禁用</div>
      ) : null} {/* 有权限时不渲染 */}
      {state.loading ? ( // 首屏加载分支
        // 首屏加载态
        <div className="empty">加载中…</div>
      ) : state.error ? ( // 请求失败分支
        // 请求失败态
        <div className="error">{describeError(state.error)}</div>
      ) : rows.length === 0 ? ( // 空列表分支
        // 空列表态
        <div className="empty">暂无模块</div>
      ) : ( // 正常数据分支
        // 数据表容器
        <div className="panel"> {/* 面板容器，承载数据表 */}
          <table className="table"> {/* 模块数据表 */}
            <thead> {/* 表头 */}
              <tr> {/* 表头行 */}
                <th>模块</th> {/* 模块列：编码 + 名称 + 摘要 */}
                <th>状态</th> {/* 状态列 */}
                <th>解锁方式</th> {/* 解锁方式列 */}
                <th>价格</th> {/* 价格列 */}
                <th>地区</th> {/* 地区列 */}
                <th>操作</th> {/* 操作列：状态迁移按钮 */}
              </tr> {/* 表头行结束 */}
            </thead> {/* 表头结束 */}
            <tbody> {/* 表体 */}
              {rows.map((row) => ( // 逐行渲染模块
                // 单模块行：code + region 共同构成唯一键
                <tr key={`${row.module.code}:${row.module.region}`}> {/* 行唯一键：编码 + 地区 */}
                  <td> {/* 模块单元格 */}
                    <code>{row.module.code}</code> {/* 模块编码，等宽字体展示 */}
                    <div className="muted">{row.name}</div> {/* 本地化名称，弱化显示 */}
                    <div className="hint">{row.summary}</div> {/* 摘要，提示级样式 */}
                  </td> {/* 模块单元格结束 */}
                  <td> {/* 状态单元格 */}
                    <span className={`badge ${row.module.status}`}> {/* 状态徽章：类名含状态以切换配色 */}
                      {STATUS_LABEL[row.module.status] ?? row.module.status} {/* 状态中文文案，未知枚举回退原始值 */}
                    </span> {/* 徽章结束 */}
                  </td> {/* 状态单元格结束 */}
                  <td>{row.module.unlock_mode}</td> {/* 解锁方式原值展示 */}
                  <td>{formatPrice(row.module.current_price)}</td> {/* 格式化价格，空值显示免费 */}
                  <td>{row.module.region}</td> {/* 地区码 */}
                  <td> {/* 操作单元格 */}
                    {row.action ? ( // 存在下一步状态时渲染迁移按钮
                      // 有下一步时渲染迁移按钮
                      <button
                        className="btn ghost" /* 幽灵按钮样式：弱化视觉层级 */
                        type="button" /* 显式声明普通按钮，避免表单上下文误提交 */
                        disabled={!canWrite || busyCode === row.module.code} /* 无 module:write 权限或本行迁移中时禁用，防越权与重复提交 */
                        onClick={() => void runTransition(row.module, row.action!.next, row.action!.label)} /* 点击执行单向迁移；void 显式丢弃 Promise */
                      > {/* 按钮属性区收尾 */}
                        {row.action.label} {/* 按钮文案：上线 / 下线 */}
                      </button> // 迁移按钮结束（回到 row.action 三元的 JS 上下文）
                    ) : ( // 终态分支：无可执行动作
                      // 终态无可执行动作
                      <span className="muted">终态</span>
                    )} {/* 操作分支收尾 */}
                  </td> {/* 操作单元格结束 */}
                </tr> // 模块行结束（回到 rows.map 回调的 JS 上下文）
              ))} {/* 行 map 收尾 */}
            </tbody> {/* 表体结束 */}
          </table> {/* 数据表结束 */}
        </div> // 面板容器结束（回到状态链式三元的 JS 上下文）
      )} {/* 加载/错误/空/数据 分支收尾 */}
    </div> // 页面根容器结束（回到 return 表达式的 JS 上下文）
  ); // 组件 JSX 返回结束
} // Modules 组件结束
