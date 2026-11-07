// 角色与权限视图：角色 CRUD、权限矩阵勾选、用户角色授予入口
import type { FormEvent } from 'react';
import { useState } from 'react'; // 表单、编辑态、在途标记等局部状态全部由 useState 承载
// 只引入本视图用到的类型与接口函数
import type { Credential, PermissionView, RoleView } from '../api';
import { createRole, deleteRole, describeError, listPermissions, listRoles, replaceRolePermissions, updateRole } from '../api'; // RBAC 接口集：角色增删改查与权限点读取（读需 rbac:read、写需 rbac:write），describeError 统一错误文案
// 通用异步加载钩子
import { useAsync } from '../hooks';

// 组件入参
interface RolesProps {
  // 当前凭证
  credential: Credential;
  // 当前生效权限码，决定按钮是否可用
  permissions: string[];
} // RolesProps 结束

// 一次并行加载的角色 + 权限点集合
interface RolesData {
  // 全部角色
  roles: RoleView[];
  // 全部权限点
  permissions: PermissionView[];
} // RolesData 结束

// 多语言取值：入参放宽为可选值，规避 TS2869
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 优先简体中文，其次英文，最后回退
  return field['zh-CN'] ?? field.en ?? fallback;
} // pickLocale 结束

// 勾选/取消一个权限码，返回新数组（保持不可变更新）
function toggleCode(list: string[], code: string): string[] {
  // 已选中则移除
  if (list.includes(code)) return list.filter((item) => item !== code);
  // 未选中则追加并排序，展示更稳定
  return [...list, code].sort();
} // toggleCode 结束

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
  }, [credential]); // 依赖凭证：登录身份切换后自动重拉角色与权限点
  // ── 新建角色表单 ──
  const [newCode, setNewCode] = useState(''); // 新建表单：角色码输入值
  const [newName, setNewName] = useState(''); // 新建表单：角色名称输入值
  const [newSelected, setNewSelected] = useState<string[]>([]); // 新建表单：已勾选的初始权限码集合
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
  const [notice, setNotice] = useState<string | null>(null); // 成功提示文案，null 表示无提示

  // 全部角色与权限点：加载完成前为空数组
  const roles = state.data?.roles ?? [];
  const allPermissions = state.data?.permissions ?? []; // 全部权限点：编辑矩阵与新建表单的勾选来源

  // 开始编辑某角色的权限
  function startEdit(role: RoleView) {
    // 记录正在编辑的角色码
    setEditing(role.code);
    // 用当前权限初始化草稿
    setDraft([...role.permissions]);
    // 清空提示
    setError(null); // 清掉上一次的失败提示
    setNotice(null); // 清掉上一次的成功提示
  } // startEdit 结束

  // 提交权限覆盖
  async function savePermissions(code: string) {
    // 清空提示
    setError(null); // 清掉旧错误
    setNotice(null); // 清掉旧成功提示
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
    } catch (err) { // 覆盖失败（如无权限 403）
      // 失败提示
      setError(describeError(err));
    } finally { // 无论成败都解除在途
      // 解除在途
      setBusy(null);
    } // finally 结束
  } // savePermissions 结束

  // 提交改名
  async function saveRename(code: string) {
    // 清空提示
    setError(null); // 清掉旧错误
    setNotice(null); // 清掉旧成功提示
    // 名称必填
    if (!renameValue.trim()) {
      // 提示缺项
      setError('角色名称不能为空');
      // 提前结束
      return;
    } // 必填校验失败分支结束
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
    } catch (err) { // 改名失败（如同码冲突）
      // 失败提示
      setError(describeError(err));
    } finally { // 无论成败都解除在途
      // 解除在途
      setBusy(null);
    } // finally 结束
  } // saveRename 结束

  // 删除角色
  async function remove(code: string) {
    // 清空提示
    setError(null); // 清掉旧错误
    setNotice(null); // 清掉旧成功提示
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
    } catch (err) { // 删除失败分支
      // 被用户引用时后端返回 409，这里直接透出原因
      setError(describeError(err));
    } finally { // 无论成败都解除在途
      // 解除在途
      setBusy(null);
    } // finally 结束
  } // remove 结束

  // 新建角色
  async function submitCreate(event: FormEvent) {
    // 阻止表单跳转
    event.preventDefault();
    // 清空提示
    setError(null); // 清掉旧错误
    setNotice(null); // 清掉旧成功提示
    // 角色码与名称必填
    if (!newCode.trim() || !newName.trim()) {
      // 提示缺项
      setError('角色码与名称均不能为空');
      // 提前结束
      return;
    } // 必填校验失败分支结束
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
      }); // 创建请求（POST /roles，需 rbac:write）结束
      // 成功提示
      setNotice(`角色 ${newCode.trim()} 已创建`);
      // 重置表单
      setNewCode(''); // 清空角色码输入
      setNewName(''); // 清空名称输入
      setNewSelected([]); // 清空初始权限勾选
      // 刷新列表
      state.reload();
    } catch (err) { // 创建失败分支
      // 失败提示（409 同码、400 未知权限）
      setError(describeError(err));
    } finally { // 无论成败都解除在途
      // 解除在途
      setBusy(null);
    } // finally 结束
  } // submitCreate 结束

  // 渲染
  return (
    <div className="page"> {/* 页面根容器 */}
      <div className="page-head"> {/* 页头：标题 + 计数概览 */}
        <h2>角色与权限</h2> {/* 视图标题 */}
        <span className="count">{roles.length} 个角色 / {allPermissions.length} 个权限点</span> {/* 规模概览：角色数与权限点数 */}
      </div> {/* 页头结束 */}
      {error ? ( // 有错误时渲染错误条
        // 全局错误条
        <div className="error">{error}</div>
      ) : null} {/* 无错误不占位 */}
      {notice ? ( // 有成功提示时渲染
        // 全局成功条
        <div className="success">{notice}</div>
      ) : null} {/* 无提示不占位 */}
      {!canWrite ? ( // 无 rbac:write 权限时给出只读原因
        // 只读身份提示
        <div className="hint">当前身份缺少 rbac:write 权限，本页为只读</div>
      ) : null} {/* 有写权限时不渲染 */}

      <div className="panel"> {/* 面板：角色列表 */}
        <div className="panel-head"> {/* 面板头 */}
          <h3>角色列表</h3> {/* 面板标题 */}
        </div> {/* 面板头结束 */}
        {state.loading ? ( // 首屏加载分支
          // 首屏加载占位
          <div className="empty">加载中…</div>
        ) : state.error ? ( // 加载失败分支
          // 加载失败
          <div className="error">{describeError(state.error)}</div>
        ) : roles.length === 0 ? ( // 空列表分支
          // 空态
          <div className="empty">暂无角色</div>
        ) : ( // 正常数据分支
          <table className="table"> {/* 角色数据表 */}
            <thead> {/* 表头 */}
              <tr> {/* 表头行 */}
                <th>角色码</th> {/* 角色码列 */}
                <th>名称</th> {/* 名称列 */}
                <th>权限</th> {/* 权限数量列 */}
                <th>类型</th> {/* 类型列：内置 / 自定义 */}
                <th>操作</th> {/* 操作列：编辑权限 / 改名 / 删除 */}
              </tr> {/* 表头行结束 */}
            </thead> {/* 表头结束 */}
            <tbody> {/* 表体：逐角色一行 */}
              {roles.map((role) => ( // 遍历角色渲染行
                // 每个角色一行
                <tr key={role.code}> {/* 以角色码作行 key */}
                  <td> {/* 角色码单元格 */}
                    <code>{role.code}</code> {/* 等宽展示角色码 */}
                  </td> {/* 角色码单元格结束 */}
                  <td> {/* 名称单元格 */}
                    {renaming === role.code ? ( // 改名态渲染输入框
                      // 改名输入框
                      <input
                        value={renameValue} /* 受控值：改名草稿 */
                        onChange={(event) => setRenameValue(event.target.value)} /* 输入同步到草稿 */
                        disabled={busy !== null} /* 有在途请求时禁止编辑 */
                      /> // 改名输入框结束（回到 renaming 三元分支的 JS 上下文）
                    ) : ( // 非改名态展示本地化名称
                      // 普通展示
                      pickLocale(role.name, role.code)
                    )} {/* 名称分支收尾 */}
                  </td> {/* 名称单元格结束 */}
                  <td> {/* 权限数量单元格 */}
                    <span className="badge">{role.permissions.length} 项</span> {/* 权限点数徽章 */}
                  </td> {/* 权限数量单元格结束 */}
                  <td> {/* 类型单元格 */}
                    {role.builtin ? ( // 内置角色分支
                      // 内置角色不可改删
                      <span className="badge builtin">内置</span>
                    ) : ( // 自定义角色分支
                      // 自定义角色
                      <span className="badge draft">自定义</span>
                    )} {/* 类型分支收尾 */}
                  </td> {/* 类型单元格结束 */}
                  <td> {/* 操作单元格 */}
                    <div className="row"> {/* 按钮行容器 */}
                      {renaming === role.code ? ( // 改名态：保存 / 取消
                        // 改名保存 / 取消
                        <>
                          <button /* 保存改名按钮 */
                            className="btn primary" /* 主按钮：保存改名 */
                            type="button" /* 防表单上下文误提交 */
                            disabled={busy !== null} /* 在途时禁用，防重复提交 */
                            onClick={() => void saveRename(role.code)} /* 提交改名（PATCH，需 rbac:write）；void 显式丢弃 Promise */
                          > {/* 保存按钮属性区结束 */}
                            保存 {/* 按钮文案 */}
                          </button> {/* 保存按钮结束 */}
                          <button /* 取消改名按钮 */
                            className="btn ghost" /* 幽灵按钮：取消改名 */
                            type="button" /* 防误提交 */
                            disabled={busy !== null} /* 在途时禁用 */
                            onClick={() => setRenaming(null)} /* 退出改名态 */
                          > {/* 取消按钮属性区结束 */}
                            取消 {/* 按钮文案 */}
                          </button> {/* 取消按钮结束 */}
                        </> /* 改名按钮组结束 */
                      ) : ( // 常规态：编辑权限 / 改名 / 删除
                        // 常规操作按钮组
                        <>
                          <button /* 编辑权限按钮 */
                            className="btn ghost" /* 幽灵按钮：进入权限编辑 */
                            type="button" /* 防误提交 */
                            disabled={!canWrite || busy !== null} /* 无 rbac:write 或在途时禁用 */
                            onClick={() => startEdit(role)} /* 进入该角色的权限编辑态 */
                          > {/* 编辑权限按钮属性区结束 */}
                            编辑权限 {/* 按钮文案 */}
                          </button> {/* 编辑权限按钮结束 */}
                          <button /* 改名按钮 */
                            className="btn ghost" /* 幽灵按钮：进入改名态 */
                            type="button" /* 防误提交 */
                            disabled={!canWrite || role.builtin || busy !== null} /* 无权限 / 内置角色 / 在途时禁用 */
                            onClick={() => { // 点击进入改名态
                              // 进入改名态并预填当前名称
                              setRenaming(role.code);
                              setRenameValue(pickLocale(role.name, role.code)); // 预填当前显示名，方便就地修改
                              // 清空提示
                              setError(null); // 清掉旧错误
                              setNotice(null); // 清掉旧成功提示
                            }} /* onClick 结束 */
                          > {/* 改名按钮属性区结束 */}
                            改名 {/* 按钮文案 */}
                          </button> {/* 改名按钮结束 */}
                          <button /* 删除角色按钮 */
                            className="btn danger" /* 危险按钮：删除角色 */
                            type="button" /* 防误提交 */
                            disabled={!canWrite || role.builtin || busy !== null} /* 无权限 / 内置角色 / 在途时禁用 */
                            onClick={() => void remove(role.code)} /* 删除角色（DELETE，需 rbac:write）；被用户引用时后端返回 409 */
                          > {/* 删除按钮属性区结束 */}
                            删除 {/* 按钮文案 */}
                          </button> {/* 删除按钮结束 */}
                        </> /* 常规按钮组结束 */
                      )} {/* 操作分支收尾 */}
                    </div> {/* 按钮行容器结束 */}
                  </td> {/* 操作单元格结束 */}
                </tr> // 角色行结束（回到 roles.map 回调的 JS 上下文）
              ))} {/* 行渲染结束 */}
            </tbody> {/* 表体结束 */}
          </table> // 角色数据表结束（回到状态链式三元的 JS 上下文）
        )} {/* 列表分支收尾 */}
      </div> {/* 角色列表面板结束 */}

      {editing ? ( // 仅编辑态渲染权限矩阵面板
        // 权限矩阵面板：仅在进入编辑态时渲染
        <div className="panel"> {/* 面板：权限矩阵 */}
          <div className="panel-head"> {/* 面板头：标题 + 操作按钮 */}
            <h3>编辑权限 · {editing}</h3> {/* 标题带当前编辑的角色码 */}
            <div className="row"> {/* 面板头按钮行 */}
              <button /* 保存权限覆盖按钮 */
                className="btn primary" /* 主按钮：保存权限覆盖 */
                type="button" /* 防误提交 */
                disabled={busy !== null || editing === 'superadmin'} /* 在途或超管时禁用；superadmin 权限固定不可改 */
                onClick={() => void savePermissions(editing)} /* PUT 整体覆盖该角色权限（需 rbac:write） */
              > {/* 保存权限按钮属性区结束 */}
                保存权限 {/* 按钮文案 */}
              </button> {/* 保存权限按钮结束 */}
              <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => setEditing(null)}> {/* 取消按钮：在途时禁用，点击退出编辑态 */}
                取消 {/* 按钮文案 */}
              </button> {/* 取消按钮结束 */}
            </div> {/* 面板头按钮行结束 */}
          </div> {/* 面板头结束 */}
          {editing === 'superadmin' ? ( // 超管角色给出不可调整说明
            // superadmin 固定全权限，后端也会拒绝覆盖
            <div className="hint">superadmin 为内置超管角色，权限不可调整</div>
          ) : null} {/* 非超管不渲染提示 */}
          <div className="perm-grid"> {/* 权限点勾选网格 */}
            {allPermissions.map((permission) => ( // 遍历内置权限点（catalog:read/write、rbac:read/write 等共 8 个）渲染复选项
              // 每个权限点一个复选项
              <label className="perm-item" key={permission.code}> {/* 单项容器，权限码作 key */}
                <input /* 编辑态权限勾选框 */
                  type="checkbox" /* 复选框 */
                  checked={draft.includes(permission.code)} /* 勾选态取自权限草稿 */
                  disabled={editing === 'superadmin' || busy !== null} /* 超管或在途时禁用 */
                  onChange={() => setDraft((current) => toggleCode(current, permission.code))} /* 不可变方式勾选/取消该权限码 */
                /> {/* 复选框结束 */}
                <span> {/* 文案容器 */}
                  <code>{permission.code}</code> {/* 权限码等宽展示，如 catalog:read */}
                </span> {/* 文案容器结束 */}
              </label> // 单项容器结束（回到 allPermissions.map 回调的 JS 上下文）
            ))} {/* 权限点遍历结束 */}
          </div> {/* 权限点网格结束 */}
        </div> // 权限矩阵面板结束（回到 editing 三元分支的 JS 上下文）
      ) : null} {/* 非编辑态不渲染 */}

      <div className="panel"> {/* 面板：新建角色 */}
        <div className="panel-head"> {/* 面板头 */}
          <h3>新建角色</h3> {/* 面板标题 */}
        </div> {/* 面板头结束 */}
        <form className="form" onSubmit={(event) => void submitCreate(event)}> {/* 新建表单：提交走 createRole（POST，需 rbac:write） */}
          <div className="row"> {/* 字段行：角色码 + 名称 */}
            <label className="field"> {/* 角色码字段 */}
              <span>角色码（小写字母开头，3-32 位）</span> {/* 字段标签，附格式约束说明 */}
              <input /* 角色码输入框 */
                value={newCode} /* 受控值：新角色码 */
                onChange={(event) => setNewCode(event.target.value)} /* 输入同步到状态 */
                placeholder="content-editor" /* 占位示例 */
                disabled={!canWrite || busy !== null} /* 无写权限或在途时禁用 */
              /> {/* 角色码输入框结束 */}
            </label> {/* 角色码字段结束 */}
            <label className="field"> {/* 名称字段 */}
              <span>名称</span> {/* 字段标签 */}
              <input /* 角色名称输入框 */
                value={newName} /* 受控值：新角色名称 */
                onChange={(event) => setNewName(event.target.value)} /* 输入同步到状态 */
                placeholder="内容编辑" /* 占位示例 */
                disabled={!canWrite || busy !== null} /* 无写权限或在途时禁用 */
              /> {/* 名称输入框结束 */}
            </label> {/* 名称字段结束 */}
          </div> {/* 字段行结束 */}
          <div className="perm-grid"> {/* 初始权限勾选网格 */}
            {allPermissions.map((permission) => ( // 遍历权限点渲染复选项
              // 初始权限勾选
              <label className="perm-item" key={permission.code}> {/* 单项容器，权限码作 key */}
                <input /* 新建表单初始权限勾选框 */
                  type="checkbox" /* 复选框 */
                  checked={newSelected.includes(permission.code)} /* 勾选态取自 newSelected */
                  disabled={!canWrite || busy !== null} /* 无写权限或在途时禁用 */
                  onChange={() => setNewSelected((current) => toggleCode(current, permission.code))} /* 不可变方式勾选/取消该权限码 */
                /> {/* 复选框结束 */}
                <span> {/* 文案容器 */}
                  <code>{permission.code}</code> {/* 权限码等宽展示 */}
                </span> {/* 文案容器结束 */}
              </label> // 单项容器结束（回到 allPermissions.map 回调的 JS 上下文）
            ))} {/* 权限点遍历结束 */}
          </div> {/* 初始权限网格结束 */}
          <div className="row"> {/* 提交按钮行 */}
            <button className="btn primary" type="submit" disabled={!canWrite || busy !== null}> {/* 提交按钮：无 rbac:write 或在途时禁用 */}
              {busy === 'create' ? '创建中…' : '创建角色'} {/* 在途时切换为进度文案，提示勿重复点击 */}
            </button> {/* 提交按钮结束 */}
          </div> {/* 提交按钮行结束 */}
        </form> {/* 新建表单结束 */}
      </div> {/* 新建角色面板结束 */}
    </div> // 页面根容器结束（回到 return 表达式的 JS 上下文）
  ); // return 结束
} // Roles 组件结束
