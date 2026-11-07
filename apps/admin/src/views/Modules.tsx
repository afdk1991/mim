// 功能模块视图：展示公开模块目录，并按单向状态机执行 draft→active→archived 迁移
import { useState } from 'react';
import type { Credential, ModuleStatus, ModuleView } from '../api';
import { describeError, listModules, updateModuleStatus } from '../api';
import { useAsync } from '../hooks';

// 组件入参：凭证由 App 下发，权限用于控制写操作是否可见
interface ModulesProps {
  // 当前身份凭证
  credential: Credential;
  // 当前身份生效权限码
  permissions: string[];
}

// 状态中文文案：与后端枚举一一对应
const STATUS_LABEL: Record<string, string> = {
  // 草稿态：仅后台可见
  draft: '草稿',
  // 已上线：前台目录可见
  active: '已上线',
  // 已下线：终态，不可再流转
  archived: '已下线',
};

// 下一步迁移表：archived 为终态，故意不出现在表内
const NEXT_STATUS: Record<string, { next: ModuleStatus; label: string }> = {
  // 草稿只能上线
  draft: { next: 'active', label: '上线' },
  // 已上线只能下线
  active: { next: 'archived', label: '下线' },
};

// 多语言字段取值：入参放宽为 string | undefined，规避 TS2869 不可达分支告警
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 中文优先，其次英文，最后退回编码
  return field['zh-CN'] ?? field.en ?? fallback;
}

// 价格格式化：null 表示免费或未定价
function formatPrice(price: ModuleView['current_price']): string {
  // 无价格直接标记免费
  if (!price) return '免费';
  // amount_minor 为最小货币单位，除以 100 还原为元
  return `${price.currency} ${(price.amount_minor / 100).toFixed(2)}`;
}

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
    } catch (error) {
      // 失败时展示 code + message
      setNotice({ kind: 'error', text: describeError(error) });
    } finally {
      // 无论成败都解除忙碌标记
      setBusyCode(null);
    }
  }

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
  });

  // 渲染
  return (
    <div className="page">
      <div className="page-head">
        <h2>功能模块</h2>
        <span className="count">
          共 {rows.length} 个模块 · 状态单向流转 draft → active → archived
        </span>
      </div>
      {notice ? (
        // 操作结果提示条
        <div className={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}</div>
      ) : null}
      {!canWrite ? (
        // 只读提示：权限不足时说明为何按钮不可用
        <div className="hint">当前身份缺少 module:write 权限，状态按钮已禁用</div>
      ) : null}
      {state.loading ? (
        // 首屏加载态
        <div className="empty">加载中…</div>
      ) : state.error ? (
        // 请求失败态
        <div className="error">{describeError(state.error)}</div>
      ) : rows.length === 0 ? (
        // 空列表态
        <div className="empty">暂无模块</div>
      ) : (
        // 数据表容器
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>模块</th>
                <th>状态</th>
                <th>解锁方式</th>
                <th>价格</th>
                <th>地区</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                // 单模块行：code + region 共同构成唯一键
                <tr key={`${row.module.code}:${row.module.region}`}>
                  <td>
                    <code>{row.module.code}</code>
                    <div className="muted">{row.name}</div>
                    <div className="hint">{row.summary}</div>
                  </td>
                  <td>
                    <span className={`badge ${row.module.status}`}>
                      {STATUS_LABEL[row.module.status] ?? row.module.status}
                    </span>
                  </td>
                  <td>{row.module.unlock_mode}</td>
                  <td>{formatPrice(row.module.current_price)}</td>
                  <td>{row.module.region}</td>
                  <td>
                    {row.action ? (
                      // 有下一步时渲染迁移按钮
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={!canWrite || busyCode === row.module.code}
                        onClick={() => void runTransition(row.module, row.action!.next, row.action!.label)}
                      >
                        {row.action.label}
                      </button>
                    ) : (
                      // 终态无可执行动作
                      <span className="muted">终态</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
