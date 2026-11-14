// 引入 React 钩子：本视图需要管理关键词、分页偏移与选中用户等多个局部状态
import { Fragment, useState } from 'react';
// 引入表单事件类型：用于阻止默认提交并读取表单值
import type { FormEvent } from 'react';
// 引入后台 API：查询用户、查询角色、授予与撤销角色
import {
  // 异常转可读文案
  describeError,
  // 后台手工建号
  createAdminUser,
  // 授予用户角色
  grantUserRole,
  // 角色列表，供下拉选择
  listRoles,
  // 某用户当前角色授权
  listUserRoles,
  // 用户分页列表
  listUsers,
  // 重置指定账号口令
  resetAdminUserPassword,
  // 撤销用户角色
  revokeUserRole,
} from '../api'; // API 函数引入结束
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
} // UsersProps 结束：凭证 + 权限码即全部入参

// 操作反馈：tone 决定样式，text 为展示文案
interface Feedback {
  // 成功或失败
  tone: 'success' | 'error';
  // 展示文案
  text: string;
} // Feedback 结束

/**
 * 多语言字段取值：入参故意声明为「可能 undefined」，
 * 因为 tsconfig 关闭了 noUncheckedIndexedAccess，Record<string,string> 索引会被推断为非空，
 * 若直接对非空值使用 ?? 会触发 TS2869（右操作数不可达）。
 */
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 优先简体中文，其次裸 zh，再退到英文，最后用兜底值
  return field['zh-CN'] ?? field.zh ?? field['en-US'] ?? field.en ?? fallback;
} // pickLocale 结束

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
  // 新建账号表单：空串表示未选择，提交时再剔除空值
  const [createForm, setCreateForm] = useState({
    // 区域：决定缺省身份类型
    region: 'cn' as 'cn' | 'global',
    // 身份类型：空串表示按区域自动推断
    provider: '' as '' | 'phone' | 'email',
    // 手机号或邮箱
    identifier: '',
    // 初始口令
    password: '',
    // 展示名，选填
    display_name: '',
    // 初始角色码，选填
    roleCode: '',
  }); // createForm 结束
  // 建号请求进行中：按钮禁用，避免重复提交产生孤儿账号
  const [creating, setCreating] = useState(false);
  // 正在重置口令的用户 ID：非空时该行展开口令输入
  const [resetFor, setResetFor] = useState<string | null>(null);
  // 重置口令的新值
  const [resetPassword, setResetPassword] = useState('');
  // 重置请求进行中
  const [resetting, setResetting] = useState(false);
  // 写权限：授予与撤销角色都需要 rbac:write
  const canWrite = permissions.includes('rbac:write');

  // 用户列表：依赖凭证、已提交关键词与分页偏移，三者任一变化都会重新请求
  const usersState = useAsync(
    () => listUsers(credential, { q: applied || undefined, limit: PAGE_SIZE, offset }), // GET /admin/users（user:read）；空关键词传 undefined 交给后端忽略
    [credential, applied, offset], // 依赖：凭证 / 已提交关键词 / 偏移，任一变化重新请求
  ); // 用户列表异步任务注册结束
  // 角色列表：用于右侧下拉，只随凭证变化加载一次
  const rolesState = useAsync(() => listRoles(credential), [credential]);
  // 选中用户的角色授权；未选中时直接返回空数组，避免无意义的网络请求
  const assignedState = useAsync<UserRoleRow[]>(
    () => (selected ? listUserRoles(credential, selected) : Promise.resolve<UserRoleRow[]>([])), // GET /admin/users/:id/roles（rbac:read）；未选中不发请求
    [credential, selected], // 依赖：凭证与选中用户
  ); // 授权列表异步任务注册结束

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
  })); // 角色选项映射结束：code/label 供下拉渲染

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
  }; // submitSearch 结束

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
  }; // resetSearch 结束

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
  }; // selectUser 结束

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
    } // 前置校验失败分支结束
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
      }); // 成功反馈写入结束
      // 授予成功后清空下拉，防止误点重复提交
      setRoleToGrant('');
      // 刷新右侧授权列表
      assignedState.reload();
      // 刷新左侧列表的角色列
      usersState.reload();
    } catch (error) { // 捕获授予失败：含 403 权限不足与网络错误
      // 失败时展示后端扁平错误信封的内容
      setFeedback({ tone: 'error', text: describeError(error) });
    } // catch 结束：失败已转为页面反馈
  }; // submitGrant 结束

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
    } catch (error) { // 捕获撤销失败：含 403 权限不足与网络错误
      // 失败提示
      setFeedback({ tone: 'error', text: describeError(error) });
    } // catch 结束
  }; // revoke 结束

  // 提交建号：成功后清空表单并刷新列表，新账号可立即用该口令登录
  const submitCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    // 阻止表单默认提交
    event.preventDefault();
    // 前置校验：标识与口令均为必填
    if (!createForm.identifier.trim() || !createForm.password) {
      // 提示补齐必填项
      setFeedback({ tone: 'error', text: '请填写登录标识与初始口令' });
      // 结束本次提交
      return;
    } // 前置校验失败分支结束
    // 标记请求进行中
    setCreating(true);
    // 清空上一轮提示，避免旧结果混淆
    setFeedback(null);
    try { // 调用建号接口
      // 执行建号；可选项为空时不传，交给后端按区域推断
      const result = await createAdminUser(credential, {
        // 区域
        region: createForm.region,
        // 身份类型：仅在选择后才传
        provider: createForm.provider || undefined,
        // 登录标识
        identifier: createForm.identifier.trim(),
        // 初始口令
        password: createForm.password,
        // 展示名：仅在有值时传
        display_name: createForm.display_name.trim() || undefined,
        // 角色：仅在选择后传单元素数组
        role_codes: createForm.roleCode ? [createForm.roleCode] : undefined,
      }); // 建号调用结束
      // 成功提示：给出 Mim ID 便于后续检索
      setFeedback({ tone: 'success', text: `已创建账号 ${result.user.member_no ?? '未分配编号'}（${result.user.id}）` });
      // 清空表单，防止误重复提交
      setCreateForm({ region: 'cn', provider: '', identifier: '', password: '', display_name: '', roleCode: '' });
      // 刷新列表，让新账号出现在第一页
      setOffset(0);
      // 触发列表重新拉取
      usersState.reload();
    } catch (error) { // 捕获建号失败：含标识已存在、口令过弱、权限不足
      // 透出后端业务错误码与文案
      setFeedback({ tone: 'error', text: describeError(error) });
    } finally { // 无论成败都解除请求中标记
      // 恢复按钮可用
      setCreating(false);
    } // try/catch 结束
  }; // submitCreate 结束

  // 展开某行的口令重置输入：同时取消选中态冲突并清空旧值
  const startReset = (userId: string): void => {
    // 记录目标用户
    setResetFor(userId);
    // 清空上次输入
    setResetPassword('');
    // 清空上一轮提示
    setFeedback(null);
  }; // startReset 结束

  // 提交口令重置：后端同时吊销该账号全部会话
  const submitReset = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    // 阻止表单默认提交
    event.preventDefault();
    // 未展开目标或未填口令时不发请求
    if (!resetFor || !resetPassword) return;
    // 标记请求进行中
    setResetting(true);
    try { // 调用重置接口
      // 执行重置
      const result = await resetAdminUserPassword(credential, resetFor, resetPassword);
      // 成功提示：回显被吊销的会话数，便于判断是否有在线终端被踢下线
      setFeedback({
        // 成功态
        tone: 'success',
        // 文案含吊销会话数
        text: `已重置 ${result.user_id} 的口令，吊销会话 ${result.sessions_revoked} 个`,
      }); // 成功反馈写入结束
      // 收起输入行
      setResetFor(null);
      // 清空口令，避免明文停留在内存
      setResetPassword('');
    } catch (error) { // 捕获重置失败：含口令过弱、账号不存在、权限不足
      // 透出后端业务错误码与文案
      setFeedback({ tone: 'error', text: describeError(error) });
    } finally { // 无论成败都解除请求中标记
      // 恢复按钮可用
      setResetting(false);
    } // try/catch 结束
  }; // submitReset 结束

  // 视图渲染
  return ( // 返回整体 JSX：页头 + 搜索表单 + 操作反馈 + 左右分栏
    <div className="page"> {/* 页面容器：整页纵向流式布局 */}
      <div className="page-head"> {/* 页头行：标题 + 匹配计数 */}
        <h2>用户与角色</h2> {/* 页面标题 */}
        <span className="count">{total} 位匹配用户</span> {/* 匹配总数：辅助判断是否需要调整关键词 */}
      </div> {/* 页头结束 */}

      {!canWrite ? <p className="hint">当前身份缺少 rbac:write 权限，仅可查看用户与角色。</p> : null} {/* 只读提示：授予与撤销均需 rbac:write 权限 */}

      <form className="form" onSubmit={submitSearch}> {/* 搜索表单：提交时才应用关键词，避免逐字触发请求 */}
        <div className="row"> {/* 表单行：输入框 + 按钮组 */}
          <label className="field"> {/* 字段容器：标签文案 + 输入控件 */}
            <span>搜索用户</span> {/* 输入框标签 */}
            <input // 受控输入框：即时值只进 keyword
              value={keyword} // 绑定即时输入值
              placeholder="用户 ID / 展示名 / 登录标识" // 占位提示可检索的字段
              onChange={(event) => setKeyword(event.target.value)} // 仅更新即时值，不发请求
            /> {/* 输入框结束（自闭合） */}
          </label> {/* 字段容器结束 */}
          <div className="row"> {/* 按钮组：搜索 + 重置 */}
            <button className="btn primary" type="submit">搜索</button> {/* 提交搜索：应用关键词并回到第一页 */}
            <button className="btn ghost" type="button" onClick={resetSearch}>重置</button> {/* 重置：清空关键词并取消选中 */}
          </div> {/* 按钮组结束 */}
        </div> {/* 表单行结束 */}
      </form> {/* 搜索表单结束 */}

      {feedback ? <p className={feedback.tone === 'success' ? 'success' : 'error'}>{feedback.text}</p> : null} {/* 操作反馈条：按 tone 渲染成功/失败样式 */}
      {usersState.error ? <p className="error">{describeError(usersState.error)}</p> : null} {/* 用户列表请求失败时透出后端错误文案 */}

      {canWrite ? ( // 建号面板：注册关闭后唯一的账号创建入口，仅 rbac:write 可见
        <div className="panel"> {/* 面板容器：与下方列表区分 */}
          <div className="panel-head"> {/* 面板头 */}
            <h3>新建账号</h3> {/* 面板标题 */}
            <span className="muted">口令需 8-128 位且同时含字母与数字</span> {/* 与后端 assertPasswordStrength 保持一致 */}
          </div> {/* 面板头结束 */}

          <form className="form" onSubmit={(event) => void submitCreate(event)}> {/* 建号表单；void 显式丢弃 Promise */}
            <div className="row"> {/* 第一行：区域 + 身份类型 + 标识 */}
              <label className="field"> {/* 区域：决定缺省身份类型 */}
                <span>区域</span> {/* 标签 */}
                <select // 受控下拉
                  value={createForm.region} // 绑定区域
                  onChange={(event) => setCreateForm({ ...createForm, region: event.target.value as 'cn' | 'global' })} // 记录区域
                > {/* 选项开始 */}
                  <option value="cn">cn（国内手机号）</option> {/* 默认区域 */}
                  <option value="global">global（邮箱）</option> {/* 海外区域 */}
                </select> {/* 下拉结束 */}
              </label> {/* 字段结束 */}
              <label className="field"> {/* 身份类型：可留空由后端推断 */}
                <span>身份类型</span> {/* 标签 */}
                <select // 受控下拉
                  value={createForm.provider} // 绑定身份类型
                  onChange={(event) => setCreateForm({ ...createForm, provider: event.target.value as '' | 'phone' | 'email' })} // 记录身份类型
                > {/* 选项开始 */}
                  <option value="">自动推断</option> {/* 空值交给后端 */}
                  <option value="phone">手机号</option> {/* 手机号通道 */}
                  <option value="email">邮箱</option> {/* 邮箱通道 */}
                </select> {/* 下拉结束 */}
              </label> {/* 字段结束 */}
              <label className="field"> {/* 登录标识 */}
                <span>登录标识</span> {/* 标签 */}
                <input // 受控输入：手机号或邮箱
                  value={createForm.identifier} // 绑定标识
                  placeholder="手机号或邮箱" // 占位提示
                  onChange={(event) => setCreateForm({ ...createForm, identifier: event.target.value })} // 记录标识
                /> {/* 输入框结束 */}
              </label> {/* 字段结束 */}
            </div> {/* 第一行结束 */}

            <div className="row"> {/* 第二行：初始口令 + 展示名 + 角色 */}
              <label className="field"> {/* 初始口令 */}
                <span>初始口令</span> {/* 标签 */}
                <input // 受控输入：初始口令
                  type="password" // 掩码展示，避免旁人窥屏
                  value={createForm.password} // 绑定口令
                  placeholder="8-128 位，含字母与数字" // 占位提示强度要求
                  onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} // 记录口令
                /> {/* 输入框结束 */}
              </label> {/* 字段结束 */}
              <label className="field"> {/* 展示名 */}
                <span>展示名（选填）</span> {/* 标签 */}
                <input // 受控输入：展示名
                  value={createForm.display_name} // 绑定展示名
                  placeholder="不填则为空" // 占位提示
                  onChange={(event) => setCreateForm({ ...createForm, display_name: event.target.value })} // 记录展示名
                /> {/* 输入框结束 */}
              </label> {/* 字段结束 */}
              <label className="field"> {/* 初始角色 */}
                <span>初始角色（选填）</span> {/* 标签 */}
                <select // 受控下拉：复用角色列表
                  value={createForm.roleCode} // 绑定角色码
                  onChange={(event) => setCreateForm({ ...createForm, roleCode: event.target.value })} // 记录角色码
                > {/* 选项开始 */}
                  <option value="">不分配</option> {/* 空值表示不授予任何角色 */}
                  {roleOptions.map((option) => ( // 渲染可选角色
                    <option key={option.code} value={option.code}>{option.label}</option> // 单个角色选项
                  ))} {/* 角色选项渲染完毕 */}
                </select> {/* 下拉结束 */}
              </label> {/* 字段结束 */}
              <button className="btn primary" type="submit" disabled={creating}>{creating ? '创建中…' : '创建账号'}</button> {/* 提交建号：POST /admin/users，需 rbac:write */}
            </div> {/* 第二行结束 */}
          </form> {/* 建号表单结束 */}
        </div> // 建号面板结束
      ) : null} {/* 无写权限时不渲染建号入口 */}

      <div className="split"> {/* 左右分栏容器：左用户列表，右角色授予 */}
        <div className="panel"> {/* 左侧面板：用户分页列表 */}
          <div className="panel-head"> {/* 面板头：标题 + 页码 */}
            <h3>用户列表</h3> {/* 面板标题 */}
            <span className="muted">第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span> {/* 由偏移量换算的当前页码 */}
          </div> {/* 面板头结束 */}

          {usersState.loading ? <p className="muted">加载中…</p> : null} {/* 加载中占位 */}

          {!usersState.loading && users.length === 0 ? <p className="empty">没有匹配的用户</p> : null} {/* 空结果提示：与加载态互斥 */}

          {users.length > 0 ? ( // 有数据时渲染用户表格
            <table className="table"> {/* 用户表格 */}
              <thead> {/* 表头 */}
                <tr> {/* 表头行 */}
                  <th>用户 ID</th> {/* 列：用户 ID */}
                  <th>展示名</th> {/* 列：展示名 */}
                  <th>区域</th> {/* 列：所属区域 */}
                  <th>状态</th> {/* 列：账号状态 */}
                  <th>角色</th> {/* 列：已授予角色码 */}
                  <th>操作</th> {/* 列：口令重置入口 */}
                </tr> {/* 表头行结束 */}
              </thead> {/* 表头结束 */}
              <tbody> {/* 表体：逐行渲染当前页用户 */}
                {users.map((row) => { // 逐行渲染用户；用块体以便先算选中态
                  // 是否当前选中行：用于高亮
                  const isSelected = row.id === selected;
                  // 是否该行展开了口令重置输入
                  const isResetting = row.id === resetFor;
                  // 单行渲染：行 + 可选的展开输入行，故用带 key 的 Fragment 包裹
                  return ( // 返回该行 JSX
                    <Fragment key={`${row.region}:${row.id}`}> {/* 区域 + ID 组合 key，避免跨区域同 ID 冲突 */}
                      <tr // 行容器：整行可点击选中
                        className={isSelected ? 'active' : undefined} // 选中行加 active 高亮
                        onClick={() => selectUser(row.id)} // 点击选中该用户并联动右侧面板
                      > {/* 属性区结束，进入行内容 */}
                        <td><code>{row.id}</code></td> {/* 用户 ID：等宽字体便于复制 */}
                        <td>{row.display_name.length > 0 ? row.display_name : '—'}</td> {/* 展示名缺失时显示占位符 */}
                        <td>{row.region}</td> {/* 所属区域 */}
                        <td>{row.status}</td> {/* 账号状态 */}
                        <td>{row.roles.length > 0 ? row.roles.join(', ') : '—'}</td> {/* 角色码列表；无角色显示占位符 */}
                        <td> {/* 操作列：展开/收起口令重置 */}
                          <button // 重置口令入口
                            className="btn ghost" // 幽灵按钮：与危险操作区分
                            type="button" // 非提交按钮
                            disabled={!canWrite} // 无 rbac:write 权限时禁用
                            onClick={(event) => { // 阻止冒泡，避免同时触发整行选中
                              // 阻止选中行联动
                              event.stopPropagation();
                              // 再次点击同一行即收起，否则展开该行
                              if (isResetting) setResetFor(null);
                              else startReset(row.id);
                            }} // 点击处理结束
                          > {/* 属性区结束，进入按钮文案 */}
                            {isResetting ? '取消' : '重置口令'} {/* 按展开态切换文案 */}
                          </button> {/* 重置按钮结束 */}
                        </td> {/* 操作列结束 */}
                      </tr> {/* 单行结束 */}
                      {isResetting ? ( // 展开行：口令输入 + 确认/取消
                        <tr> {/* 展开行容器 */}
                          <td colSpan={6}> {/* 跨满 6 列 */}
                            <form className="form" onSubmit={(event) => void submitReset(event)}> {/* 重置表单；void 丢弃 Promise */}
                              <div className="row"> {/* 表单行 */}
                                <label className="field"> {/* 新口令字段 */}
                                  <span>新口令</span> {/* 标签 */}
                                  <input // 受控输入：新口令
                                    type="password" // 掩码展示
                                    autoFocus // 展开即聚焦，减少一次点击
                                    value={resetPassword} // 绑定新口令
                                    placeholder="8-128 位，含字母与数字" // 与后端强度校验一致
                                    onChange={(event) => setResetPassword(event.target.value)} // 记录新口令
                                  /> {/* 输入框结束 */}
                                </label> {/* 字段结束 */}
                                <button className="btn primary" type="submit" disabled={resetting}>{resetting ? '提交中…' : '确认重置'}</button> {/* 提交：POST /admin/users/:id/password */}
                                <button className="btn ghost" type="button" onClick={() => setResetFor(null)}>取消</button> {/* 收起且不提交 */}
                              </div> {/* 表单行结束 */}
                            </form> {/* 重置表单结束 */}
                          </td> {/* 跨列单元格结束 */}
                        </tr> // 展开行结束
                      ) : null} {/* 未展开时不渲染 */}
                    </Fragment> // Fragment 结束（回到 map 回调的 JS 上下文）
                  ); // return 结束
                })} {/* 用户行渲染完毕，回到 tbody 子节点 */}
              </tbody> {/* 表体结束 */}
            </table> // 用户表格结束（回到 users.length 三元的 JS 上下文）
          ) : null} {/* 无数据时不渲染表格 */}

          <div className="pager"> {/* 分页器：上一页 / 区间文案 / 下一页 */}
            <button className="btn ghost" type="button" disabled={offset === 0} onClick={prevPage}>上一页</button> {/* 首页时禁用，防止负偏移 */}
            <span className="muted"> {/* 当前区间文案容器 */}
              {total === 0 ? '0 / 0' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total}`} {/* 显示「起-止 / 总数」；空结果显示 0 / 0 */}
            </span> {/* 区间文案结束 */}
            <button // 下一页按钮
              className="btn ghost" // 幽灵按钮样式
              type="button" // 显式声明非提交按钮，避免触发表单提交
              disabled={offset + PAGE_SIZE >= total} // 已到末页时禁用，防止偏移越界
              onClick={nextPage} // 点击推进一页
            > {/* 属性区结束，进入按钮文案 */}
              下一页 {/* 按钮文案 */}
            </button> {/* 下一页按钮结束 */}
          </div> {/* 分页器结束 */}
        </div> {/* 左侧面板结束 */}

        <div className="panel"> {/* 右侧面板：选中用户的角色授予与撤销 */}
          <div className="panel-head"> {/* 面板头 */}
            <h3>角色授予</h3> {/* 面板标题 */}
          </div> {/* 面板头结束 */}

          {!selected ? <p className="empty">从左侧选择一个用户</p> : null} {/* 未选用户时的空态引导 */}

          {selected ? ( // 已选用户：渲染授予表单与已授权列表
            <> {/* 片段容器：不引入额外 DOM 层级 */}
              <p className="muted">当前用户：<code>{selected}</code></p> {/* 提示当前操作目标用户 */}

              <form className="form" onSubmit={(event) => void submitGrant(event)}> {/* 授予表单；void 显式丢弃 Promise */}
                <div className="row"> {/* 表单行：角色下拉 + 授予按钮 */}
                  <label className="field"> {/* 字段容器：标签 + 下拉框 */}
                    <span>新增角色</span> {/* 下拉框标签 */}
                    <select // 角色下拉框
                      value={roleToGrant} // 受控绑定待授予角色码
                      disabled={!canWrite} // 无 rbac:write 权限时禁用，只读身份不可授予
                      onChange={(event) => setRoleToGrant(event.target.value)} // 记录待授予角色码
                    > {/* 属性区结束，进入选项列表 */}
                      <option value="">请选择角色</option> {/* 占位选项：空值表示未选择 */}
                      {roleOptions.map((option) => ( // 渲染全部可选角色
                        <option key={option.code} value={option.code}>{option.label}</option> // 单个选项：值为角色码，文案为多语言名称
                      ))} {/* 角色选项渲染完毕，回到 select 子节点 */}
                    </select> {/* 下拉框结束 */}
                  </label> {/* 字段容器结束 */}
                  <button className="btn primary" type="submit" disabled={!canWrite}>授予</button> {/* 提交授予：走 POST /admin/users/:id/roles，需 rbac:write */}
                </div> {/* 表单行结束 */}
              </form> {/* 授予表单结束 */}

              {rolesState.error ? <p className="error">{describeError(rolesState.error)}</p> : null} {/* 角色列表加载失败提示 */}
              {assignedState.error ? <p className="error">{describeError(assignedState.error)}</p> : null} {/* 授权列表加载失败提示 */}

              {assignedState.loading ? <p className="muted">加载中…</p> : null} {/* 授权列表加载占位 */}
              {!assignedState.loading && assigned.length === 0 ? <p className="empty">该用户尚未授予任何角色</p> : null} {/* 无授权空态 */}

              {assigned.length > 0 ? ( // 有授权记录：渲染授权表格
                <table className="table"> {/* 授权列表表格 */}
                  <thead> {/* 表头 */}
                    <tr> {/* 表头行 */}
                      <th>角色</th> {/* 列：角色码 */}
                      <th>授权人</th> {/* 列：授权人 */}
                      <th>授权时间</th> {/* 列：授权时间 */}
                      <th>操作</th> {/* 列：撤销入口 */}
                    </tr> {/* 表头行结束 */}
                  </thead> {/* 表头结束 */}
                  <tbody> {/* 表体：逐条渲染授权记录 */}
                    {assigned.map((row) => ( // 逐条渲染授权记录
                      <tr key={row.role_code}> {/* 单行：key 用角色码（同一用户下角色码唯一） */}
                        <td><code>{row.role_code}</code></td> {/* 角色码：等宽字体 */}
                        <td>{row.granted_by.length > 0 ? row.granted_by : '系统'}</td> {/* 授权人；空值视为系统授予 */}
                        <td>{row.created_at}</td> {/* 授权时间 */}
                        <td> {/* 操作列 */}
                          <button // 撤销按钮
                            className="btn danger" // 危险操作红色样式
                            type="button" // 非提交按钮
                            disabled={!canWrite} // 无 rbac:write 权限时禁用
                            onClick={() => void revoke(row.role_code)} // 点击撤销：走 DELETE /admin/users/:id/roles/:code；void 丢弃 Promise
                          > {/* 属性区结束，进入按钮文案 */}
                            撤销 {/* 按钮文案 */}
                          </button> {/* 撤销按钮结束 */}
                        </td> {/* 操作列结束 */}
                      </tr> // 单行结束（回到 map 回调的 JS 上下文）
                    ))} {/* 授权记录渲染完毕，回到 tbody 子节点 */}
                  </tbody> {/* 表体结束 */}
                </table> // 授权表格结束（回到 assigned.length 三元的 JS 上下文）
              ) : null} {/* 无授权记录时不渲染表格 */}
            </> // 片段结束（回到 selected 三元表达式的 JS 上下文）
          ) : null} {/* 未选用户时不渲染右侧内容 */}
        </div> {/* 右侧面板结束 */}
      </div> {/* 分栏容器结束 */}
    </div> // 页面容器结束（回到 return 的 JS 上下文）
  ); // Users 的 JSX 返回结束
} // Users 组件结束
