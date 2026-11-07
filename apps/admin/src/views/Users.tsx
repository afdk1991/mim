// 引入 React 钩子：本视图需要管理关键词、分页偏移与选中用户等多个局部状态
import { useState } from 'react';
// 引入表单事件类型：用于阻止默认提交并读取表单值
import type { FormEvent } from 'react';
// 引入后台 API：查询用户、查询角色、授予与撤销角色
import {
  // 异常转可读文案
  describeError,
  // 授予用户角色
  grantUserRole,
  // 角色列表，供下拉选择
  listRoles,
  // 某用户当前角色授权
  listUserRoles,
  // 用户分页列表
  listUsers,
  // 撤销用户角色
  revokeUserRole,
} from '../api';
// 仅引入类型：编译后类型擦除，不产生运行期依赖
import type { Credential, UserListRow, UserRoleRow } from '../api';
// 通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';

// 每页条数：与后端默认上限对齐，避免单次拉取过多记录拖慢首屏
const PAGE_SIZE = 20;

// 组件入参
interface UsersProps {
  // 当前身份凭证：所有后台请求都必须携带
  credential: Credential;
  // 当前身份生效权限码：决定授予/撤销按钮是否可用
  permissions: string[];
}

// 操作反馈：tone 决定样式，text 为展示文案
interface Feedback {
  // 成功或失败
  tone: 'success' | 'error';
  // 展示文案
  text: string;
}

/**
 * 多语言字段取值：入参故意声明为「可能 undefined」，
 * 因为 tsconfig 关闭了 noUncheckedIndexedAccess，Record<string,string> 索引会被推断为非空，
 * 若直接对非空值使用 ?? 会触发 TS2869（右操作数不可达）。
 */
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 优先简体中文，其次裸 zh，再退到英文，最后用兜底值
  return field['zh-CN'] ?? field.zh ?? field['en-US'] ?? field.en ?? fallback;
}

/**
 * 用户与角色视图：左侧用户分页列表 + 右侧角色授予/撤销面板。
 * 数据来源：GET /admin/users（user:read）、GET/POST/DELETE /admin/users/:id/roles（rbac:read / rbac:write）。
 */
export function Users({ credential, permissions }: UsersProps) {
  // 搜索框的即时输入值：不直接参与请求依赖，避免每敲一个字都发一次请求
  const [keyword, setKeyword] = useState('');
  // 已提交的关键词：只有它变化才触发用户列表重新请求
  const [applied, setApplied] = useState('');
  // 当前分页偏移量：0 表示第一页
  const [offset, setOffset] = useState(0);
  // 选中的用户 ID：右侧面板的主体
  const [selected, setSelected] = useState<string | null>(null);
  // 待授予的角色码：空串表示未选择
  const [roleToGrant, setRoleToGrant] = useState('');
  // 最近一次操作的反馈提示
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // 写权限：授予与撤销角色都需要 rbac:write
  const canWrite = permissions.includes('rbac:write');

  // 用户列表：依赖凭证、已提交关键词与分页偏移，三者任一变化都会重新请求
  const usersState = useAsync(
    () => listUsers(credential, { q: applied || undefined, limit: PAGE_SIZE, offset }),
    [credential, applied, offset],
  );
  // 角色列表：用于右侧下拉，只随凭证变化加载一次
  const rolesState = useAsync(() => listRoles(credential), [credential]);
  // 选中用户的角色授权；未选中时直接返回空数组，避免无意义的网络请求
  const assignedState = useAsync<UserRoleRow[]>(
    () => (selected ? listUserRoles(credential, selected) : Promise.resolve<UserRoleRow[]>([])),
    [credential, selected],
  );

  // 当前页用户：数据未就绪时用空数组，模板无需再做可选链
  const users: UserListRow[] = usersState.data?.users ?? [];
  // 匹配总数：用于分页器与页头计数
  const total = usersState.data?.total ?? 0;
  // 当前选中用户的角色授权列表
  const assigned: UserRoleRow[] = assignedState.data ?? [];
  // 角色下拉选项：把多语言名称压平成单行标签，内置角色加后缀区分
  const roleOptions = (rolesState.data ?? []).map((role) => ({
    // 选项值即角色码
    code: role.code,
    // 展示文案：名称缺失时回退角色码
    label: `${pickLocale(role.name, role.code)}${role.builtin ? '（内置）' : ''}`,
  }));

  // 提交搜索：应用关键词并把分页重置到第一页
  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    // 阻止表单默认提交导致整页刷新
    event.preventDefault();
    // 写入已提交关键词（去掉首尾空白）
    setApplied(keyword.trim());
    // 结果集改变，分页回到第一页
    setOffset(0);
    // 原有选中用户可能已不在结果集中，清空选择
    setSelected(null);
    // 清空上一次提示，避免误导
    setFeedback(null);
  };

  // 重置搜索条件与选择
  const resetSearch = (): void => {
    // 清空输入框
    setKeyword('');
    // 清空已提交关键词
    setApplied('');
    // 回到第一页
    setOffset(0);
    // 取消选中用户
    setSelected(null);
    // 清除提示
    setFeedback(null);
  };

  // 上一页：偏移量不允许为负
  const prevPage = (): void => setOffset((value) => Math.max(0, value - PAGE_SIZE));
  // 下一页：由按钮的 disabled 保证不会越界
  const nextPage = (): void => setOffset((value) => value + PAGE_SIZE);

  // 选中用户：同时重置待授予角色与提示
  const selectUser = (userId: string): void => {
    // 记录选中用户
    setSelected(userId);
    // 下拉回到未选择状态
    setRoleToGrant('');
    // 清空上一轮提示
    setFeedback(null);
  };

  // 提交授予：成功后刷新右侧授权列表与左侧用户行（用户行含角色码）
  const submitGrant = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    // 阻止表单默认提交
    event.preventDefault();
    // 前置校验：必须已选中用户与角色
    if (!selected || !roleToGrant) {
      // 提示用户补齐必填项
      setFeedback({ tone: 'error', text: '请先选择用户与角色' });
      // 结束本次提交
      return;
    }
    // 调用后端授予接口；重复授予时后端返回 created=false 而非报错
    try {
      // 执行授予
      const result = await grantUserRole(credential, selected, roleToGrant);
      // 依据 created 区分「新授予」与「本来就有」
      setFeedback({
        // 两种结果都属成功
        tone: 'success',
        // 文案区分幂等回放
        text: result.created ? `已授予 ${result.role_code}` : `${result.role_code} 此前已授予，无需重复操作`,
      });
      // 授予成功后清空下拉，防止误点重复提交
      setRoleToGrant('');
      // 刷新右侧授权列表
      assignedState.reload();
      // 刷新左侧列表的角色列
      usersState.reload();
    } catch (error) {
      // 失败时展示后端扁平错误信封的内容
      setFeedback({ tone: 'error', text: describeError(error) });
    }
  };

  // 撤销指定角色：按钮直接携带角色码，无需二次确认弹层
  const revoke = async (roleCode: string): Promise<void> => {
    // 未选中用户时不应触发，作防御性返回
    if (!selected) return;
    // 调用删除接口
    try {
      // 执行撤销
      await revokeUserRole(credential, selected, roleCode);
      // 成功提示
      setFeedback({ tone: 'success', text: `已撤销 ${roleCode}` });
      // 刷新右侧授权列表
      assignedState.reload();
      // 刷新左侧列表的角色列
      usersState.reload();
    } catch (error) {
      // 失败提示
      setFeedback({ tone: 'error', text: describeError(error) });
    }
  };

  // 视图渲染
  return (
    <div className="page">
      <div className="page-head">
        <h2>用户与角色</h2>
        <span className="count">{total} 位匹配用户</span>
      </div>

      {!canWrite ? <p className="hint">当前身份缺少 rbac:write 权限，仅可查看用户与角色。</p> : null}

      <form className="form" onSubmit={submitSearch}>
        <div className="row">
          <label className="field">
            <span>搜索用户</span>
            <input
              value={keyword}
              placeholder="用户 ID / 展示名 / 登录标识"
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
          <div className="row">
            <button className="btn primary" type="submit">搜索</button>
            <button className="btn ghost" type="button" onClick={resetSearch}>重置</button>
          </div>
        </div>
      </form>

      {feedback ? <p className={feedback.tone === 'success' ? 'success' : 'error'}>{feedback.text}</p> : null}
      {usersState.error ? <p className="error">{describeError(usersState.error)}</p> : null}

      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <h3>用户列表</h3>
            <span className="muted">第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>
          </div>

          {usersState.loading ? <p className="muted">加载中…</p> : null}

          {!usersState.loading && users.length === 0 ? <p className="empty">没有匹配的用户</p> : null}

          {users.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>用户 ID</th>
                  <th>展示名</th>
                  <th>区域</th>
                  <th>状态</th>
                  <th>角色</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => {
                  // 是否当前选中行：用于高亮
                  const isSelected = row.id === selected;
                  // 单行渲染
                  return (
                    <tr
                      key={`${row.region}:${row.id}`}
                      className={isSelected ? 'active' : undefined}
                      onClick={() => selectUser(row.id)}
                    >
                      <td><code>{row.id}</code></td>
                      <td>{row.display_name.length > 0 ? row.display_name : '—'}</td>
                      <td>{row.region}</td>
                      <td>{row.status}</td>
                      <td>{row.roles.length > 0 ? row.roles.join(', ') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}

          <div className="pager">
            <button className="btn ghost" type="button" disabled={offset === 0} onClick={prevPage}>上一页</button>
            <span className="muted">
              {total === 0 ? '0 / 0' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total}`}
            </span>
            <button
              className="btn ghost"
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={nextPage}
            >
              下一页
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>角色授予</h3>
          </div>

          {!selected ? <p className="empty">从左侧选择一个用户</p> : null}

          {selected ? (
            <>
              <p className="muted">当前用户：<code>{selected}</code></p>

              <form className="form" onSubmit={(event) => void submitGrant(event)}>
                <div className="row">
                  <label className="field">
                    <span>新增角色</span>
                    <select
                      value={roleToGrant}
                      disabled={!canWrite}
                      onChange={(event) => setRoleToGrant(event.target.value)}
                    >
                      <option value="">请选择角色</option>
                      {roleOptions.map((option) => (
                        <option key={option.code} value={option.code}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary" type="submit" disabled={!canWrite}>授予</button>
                </div>
              </form>

              {rolesState.error ? <p className="error">{describeError(rolesState.error)}</p> : null}
              {assignedState.error ? <p className="error">{describeError(assignedState.error)}</p> : null}

              {assignedState.loading ? <p className="muted">加载中…</p> : null}
              {!assignedState.loading && assigned.length === 0 ? <p className="empty">该用户尚未授予任何角色</p> : null}

              {assigned.length > 0 ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>角色</th>
                      <th>授权人</th>
                      <th>授权时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assigned.map((row) => (
                      <tr key={row.role_code}>
                        <td><code>{row.role_code}</code></td>
                        <td>{row.granted_by.length > 0 ? row.granted_by : '系统'}</td>
                        <td>{row.created_at}</td>
                        <td>
                          <button
                            className="btn danger"
                            type="button"
                            disabled={!canWrite}
                            onClick={() => void revoke(row.role_code)}
                          >
                            撤销
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
