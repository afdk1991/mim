// 角色与权限视图：角色 CRUD、权限矩阵勾选、用户角色授予入口
import type { FormEvent } from 'react';
import { useState } from 'react';
// 只引入本视图用到的类型与接口函数
import type { Credential, PermissionView, RoleView } from '../api';
import { createRole, deleteRole, describeError, listPermissions, listRoles, replaceRolePermissions, updateRole } from '../api';
// 通用异步加载钩子
import { useAsync } from '../hooks';

// 组件入参
interface RolesProps {
  // 当前凭证
  credential: Credential;
  // 当前生效权限码，决定按钮是否可用
  permissions: string[];
}

// 一次并行加载的角色 + 权限点集合
interface RolesData {
  // 全部角色
  roles: RoleView[];
  // 全部权限点
  permissions: PermissionView[];
}

// 多语言取值：入参放宽为可选值，规避 TS2869
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 优先简体中文，其次英文，最后回退
  return field['zh-CN'] ?? field.en ?? fallback;
}

// 勾选/取消一个权限码，返回新数组（保持不可变更新）
function toggleCode(list: string[], code: string): string[] {
  // 已选中则移除
  if (list.includes(code)) return list.filter((item) => item !== code);
  // 未选中则追加并排序，展示更稳定
  return [...list, code].sort();
}

// 角色与权限组件主体
export function Roles({ credential, permissions }: RolesProps) {
  // 权限门禁：无 rbac:write 时全部写操作禁用
  const canWrite = permissions.includes('rbac:write');
  // 并行加载角色与权限点，减少首屏等待
  const state = useAsync<RolesData>(async () => {
    // 两个请求互不依赖，Promise.all 并发
    const [roles, allPermissions] = await Promise.all([listRoles(credential), listPermissions(credential)]);
    // 合并成一个结果对象
    return { roles, permissions: allPermissions };
  }, [credential]);
  // ── 新建角色表单 ──
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newSelected, setNewSelected] = useState<string[]>([]);
  // ── 编辑权限态：同一时刻只编辑一个角色 ──
  const [editing, setEditing] = useState<string | null>(null);
  // 编辑中的权限草稿
  const [draft, setDraft] = useState<string[]>([]);
  // ── 改名态：同样只允许一个 ──
  const [renaming, setRenaming] = useState<string | null>(null);
  // 改名输入框草稿
  const [renameValue, setRenameValue] = useState('');
  // 在途请求标记，值为角色码或特殊标记
  const [busy, setBusy] = useState<string | null>(null);
  // 错误与成功提示
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 全部角色与权限点：加载完成前为空数组
  const roles = state.data?.roles ?? [];
  const allPermissions = state.data?.permissions ?? [];

  // 开始编辑某角色的权限
  function startEdit(role: RoleView) {
    // 记录正在编辑的角色码
    setEditing(role.code);
    // 用当前权限初始化草稿
    setDraft([...role.permissions]);
    // 清空提示
    setError(null);
    setNotice(null);
  }

  // 提交权限覆盖
  async function savePermissions(code: string) {
    // 清空提示
    setError(null);
    setNotice(null);
    // 置为在途
    setBusy(code);
    // 统一收尾
    try {
      // PUT 整体覆盖
      const next = await replaceRolePermissions(credential, code, draft);
      // 成功提示
      setNotice(`角色 ${code} 权限已更新为 ${next.length} 项`);
      // 退出编辑态
      setEditing(null);
      // 重新拉取列表
      state.reload();
    } catch (err) {
      // 失败提示
      setError(describeError(err));
    } finally {
      // 解除在途
      setBusy(null);
    }
  }

  // 提交改名
  async function saveRename(code: string) {
    // 清空提示
    setError(null);
    setNotice(null);
    // 名称必填
    if (!renameValue.trim()) {
      // 提示缺项
      setError('角色名称不能为空');
      // 提前结束
      return;
    }
    // 置为在途
    setBusy(code);
    // 统一收尾
    try {
      // PATCH 只改 name，保留英文键为角色码便于排查
      await updateRole(credential, code, { name: { 'zh-CN': renameValue.trim(), en: renameValue.trim() } });
      // 成功提示
      setNotice(`角色 ${code} 名称已更新`);
      // 退出改名态
      setRenaming(null);
      // 刷新列表
      state.reload();
    } catch (err) {
      // 失败提示
      setError(describeError(err));
    } finally {
      // 解除在途
      setBusy(null);
    }
  }

  // 删除角色
  async function remove(code: string) {
    // 清空提示
    setError(null);
    setNotice(null);
    // 置为在途
    setBusy(code);
    // 统一收尾
    try {
      // DELETE 角色
      await deleteRole(credential, code);
      // 成功提示
      setNotice(`角色 ${code} 已删除`);
      // 刷新列表
      state.reload();
    } catch (err) {
      // 被用户引用时后端返回 409，这里直接透出原因
      setError(describeError(err));
    } finally {
      // 解除在途
      setBusy(null);
    }
  }

  // 新建角色
  async function submitCreate(event: FormEvent) {
    // 阻止表单跳转
    event.preventDefault();
    // 清空提示
    setError(null);
    setNotice(null);
    // 角色码与名称必填
    if (!newCode.trim() || !newName.trim()) {
      // 提示缺项
      setError('角色码与名称均不能为空');
      // 提前结束
      return;
    }
    // 置为在途
    setBusy('create');
    // 统一收尾
    try {
      // 创建角色并带上初始权限
      await createRole(credential, {
        // 角色码去空白
        code: newCode.trim(),
        // 中英文名称
        name: { 'zh-CN': newName.trim(), en: newName.trim() },
        // 初始权限集合
        permissions: newSelected,
      });
      // 成功提示
      setNotice(`角色 ${newCode.trim()} 已创建`);
      // 重置表单
      setNewCode('');
      setNewName('');
      setNewSelected([]);
      // 刷新列表
      state.reload();
    } catch (err) {
      // 失败提示（409 同码、400 未知权限）
      setError(describeError(err));
    } finally {
      // 解除在途
      setBusy(null);
    }
  }

  // 渲染
  return (
    <div className="page">
      <div className="page-head">
        <h2>角色与权限</h2>
        <span className="count">{roles.length} 个角色 / {allPermissions.length} 个权限点</span>
      </div>
      {error ? (
        // 全局错误条
        <div className="error">{error}</div>
      ) : null}
      {notice ? (
        // 全局成功条
        <div className="success">{notice}</div>
      ) : null}
      {!canWrite ? (
        // 只读身份提示
        <div className="hint">当前身份缺少 rbac:write 权限，本页为只读</div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h3>角色列表</h3>
        </div>
        {state.loading ? (
          // 首屏加载占位
          <div className="empty">加载中…</div>
        ) : state.error ? (
          // 加载失败
          <div className="error">{describeError(state.error)}</div>
        ) : roles.length === 0 ? (
          // 空态
          <div className="empty">暂无角色</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>角色码</th>
                <th>名称</th>
                <th>权限</th>
                <th>类型</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                // 每个角色一行
                <tr key={role.code}>
                  <td>
                    <code>{role.code}</code>
                  </td>
                  <td>
                    {renaming === role.code ? (
                      // 改名输入框
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        disabled={busy !== null}
                      />
                    ) : (
                      // 普通展示
                      pickLocale(role.name, role.code)
                    )}
                  </td>
                  <td>
                    <span className="badge">{role.permissions.length} 项</span>
                  </td>
                  <td>
                    {role.builtin ? (
                      // 内置角色不可改删
                      <span className="badge builtin">内置</span>
                    ) : (
                      // 自定义角色
                      <span className="badge draft">自定义</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      {renaming === role.code ? (
                        // 改名保存 / 取消
                        <>
                          <button
                            className="btn primary"
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void saveRename(role.code)}
                          >
                            保存
                          </button>
                          <button
                            className="btn ghost"
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setRenaming(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        // 常规操作按钮组
                        <>
                          <button
                            className="btn ghost"
                            type="button"
                            disabled={!canWrite || busy !== null}
                            onClick={() => startEdit(role)}
                          >
                            编辑权限
                          </button>
                          <button
                            className="btn ghost"
                            type="button"
                            disabled={!canWrite || role.builtin || busy !== null}
                            onClick={() => {
                              // 进入改名态并预填当前名称
                              setRenaming(role.code);
                              setRenameValue(pickLocale(role.name, role.code));
                              // 清空提示
                              setError(null);
                              setNotice(null);
                            }}
                          >
                            改名
                          </button>
                          <button
                            className="btn danger"
                            type="button"
                            disabled={!canWrite || role.builtin || busy !== null}
                            onClick={() => void remove(role.code)}
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? (
        // 权限矩阵面板：仅在进入编辑态时渲染
        <div className="panel">
          <div className="panel-head">
            <h3>编辑权限 · {editing}</h3>
            <div className="row">
              <button
                className="btn primary"
                type="button"
                disabled={busy !== null || editing === 'superadmin'}
                onClick={() => void savePermissions(editing)}
              >
                保存权限
              </button>
              <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => setEditing(null)}>
                取消
              </button>
            </div>
          </div>
          {editing === 'superadmin' ? (
            // superadmin 固定全权限，后端也会拒绝覆盖
            <div className="hint">superadmin 为内置超管角色，权限不可调整</div>
          ) : null}
          <div className="perm-grid">
            {allPermissions.map((permission) => (
              // 每个权限点一个复选项
              <label className="perm-item" key={permission.code}>
                <input
                  type="checkbox"
                  checked={draft.includes(permission.code)}
                  disabled={editing === 'superadmin' || busy !== null}
                  onChange={() => setDraft((current) => toggleCode(current, permission.code))}
                />
                <span>
                  <code>{permission.code}</code>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h3>新建角色</h3>
        </div>
        <form className="form" onSubmit={(event) => void submitCreate(event)}>
          <div className="row">
            <label className="field">
              <span>角色码（小写字母开头，3-32 位）</span>
              <input
                value={newCode}
                onChange={(event) => setNewCode(event.target.value)}
                placeholder="content-editor"
                disabled={!canWrite || busy !== null}
              />
            </label>
            <label className="field">
              <span>名称</span>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="内容编辑"
                disabled={!canWrite || busy !== null}
              />
            </label>
          </div>
          <div className="perm-grid">
            {allPermissions.map((permission) => (
              // 初始权限勾选
              <label className="perm-item" key={permission.code}>
                <input
                  type="checkbox"
                  checked={newSelected.includes(permission.code)}
                  disabled={!canWrite || busy !== null}
                  onChange={() => setNewSelected((current) => toggleCode(current, permission.code))}
                />
                <span>
                  <code>{permission.code}</code>
                </span>
              </label>
            ))}
          </div>
          <div className="row">
            <button className="btn primary" type="submit" disabled={!canWrite || busy !== null}>
              {busy === 'create' ? '创建中…' : '创建角色'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
