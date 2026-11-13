// 权益管理视图：权益全量列表（关键字/状态/区域过滤 + 分页）+ 行内审计事件展开 + 发放/回收双表单，各动作按权限点门禁
import type { FormEvent } from 'react'; // 表单事件类型，提交处理器使用
import { useState } from 'react'; // 表单、分页、展开等本地状态钩子
// 只引入本视图需要的类型与接口函数，避免无谓的打包体积
import type { Credential, EntitlementEventView, EntitlementListPage, EntitlementListRow, EntitlementView } from '../api'; // 凭证 / 事件 / 分页页 / 列表行 / 发放回执类型
import { describeError, grantEntitlement, listEntitlementEvents, listEntitlements, listModules, revokeEntitlement } from '../api'; // 错误转文案 + 权益列表/事件/发放/回收 + 模块下拉五个接口
// 通用异步加载钩子：负责 loading / error / reload
import { useAsync } from '../hooks';

// 每页条数：与后端默认上限对齐，避免单次拉取过多记录拖慢首屏
const PAGE_SIZE = 20;

// 回收成功回执：后端只回最小字段集，故单独声明类型
interface RevokedReceipt {
  // 权益主键
  id: string;
  // 权益归属用户
  user_id: string;
  // 回收后状态，固定 revoked
  status: string;
  // 乐观锁版本号
  version: number;
  // 更新时间
  updated_at: string;
} // RevokedReceipt 类型结束

// 组件入参
interface EntitlementsProps {
  // 当前凭证：引导令牌或 Bearer
  credential: Credential;
  // 当前生效权限码，用于按钮级门禁
  permissions: string[];
} // EntitlementsProps 类型结束

// 权益状态中文文案：与后端枚举一一对应
const STATUS_LABEL: Record<string, string> = {
  // 生效中：权益可用
  active: '生效中',
  // 已过期：到期自然失效
  expired: '已过期',
  // 已回收：被管理端主动收回
  revoked: '已回收',
}; // 状态文案表结束

// 权益状态对应徽章样式：复用 styles.css 现有 badge 修饰类
const STATUS_BADGE: Record<string, string> = {
  // 生效中用绿色 active 样式
  active: 'active',
  // 已过期用灰色 draft 样式（中性退场）
  expired: 'draft',
  // 已回收用红色 danger 样式（人工干预痕迹）
  revoked: 'danger',
}; // 徽章映射结束；未列出的状态回退 builtin

// 列表状态过滤选项：空串表示不过滤
const STATUS_OPTIONS: Array<{ value: '' | 'active' | 'expired' | 'revoked'; label: string }> = [
  // 全部状态
  { value: '', label: '全部状态' },
  // 生效中
  { value: 'active', label: '生效中' },
  // 已过期
  { value: 'expired', label: '已过期' },
  // 已回收
  { value: 'revoked', label: '已回收' },
]; // 状态选项结束

// 列表区域过滤选项：空串表示跨区域（后端缺省行为）
const REGION_OPTIONS: Array<{ value: '' | 'cn' | 'global'; label: string }> = [
  // 跨区域
  { value: '', label: '全部区域' },
  // 中国大陆
  { value: 'cn', label: 'cn（中国大陆）' },
  // 海外
  { value: 'global', label: 'global（海外）' },
]; // 区域选项结束

// 多语言取值：入参放宽为可选值，规避 TS2869「?? 右侧不可达」
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 优先简体中文，其次英文，最后回退到调用方给定值
  return field['zh-CN'] ?? field.en ?? fallback;
} // pickLocale 结束

// 权益管理组件主体
export function Entitlements({ credential, permissions }: EntitlementsProps) {
  // 三个动作的权限门禁互相独立：可能出现只能看列表不能发放/回收的身份
  const canRead = permissions.includes('entitlement:read'); // 列表查看要求 entitlement:read 权限点
  const canGrant = permissions.includes('entitlement:grant'); // 发放动作要求 entitlement:grant 权限点
  const canRevoke = permissions.includes('entitlement:revoke'); // 回收动作要求 entitlement:revoke 权限点
  // 模块列表：发放表单的模块下拉需要 code 与展示名
  const modules = useAsync(() => listModules(credential), [credential]);

  // ── 权益列表状态 ──
  // 搜索框输入值（未提交）
  const [keyword, setKeyword] = useState('');
  // 已提交的关键词：只有点击搜索才生效，避免每次按键都打请求
  const [applied, setApplied] = useState('');
  // 状态过滤：空串表示全部
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'expired' | 'revoked'>('');
  // 区域过滤：空串表示跨区域
  const [regionFilter, setRegionFilter] = useState<'' | 'cn' | 'global'>('');
  // 当前分页偏移量：0 表示第一页
  const [offset, setOffset] = useState(0);
  // 权益列表：无读权限时不发请求，直接回 null 由视图层降级为权限提示
  const listState = useAsync<EntitlementListPage | null>(
    () =>
      canRead
        ? listEntitlements(credential, {
            // 空关键词传 undefined 交给后端忽略
            q: applied || undefined,
            // 状态过滤
            status: statusFilter || undefined,
            // 区域过滤：空串不携带，后端按跨区域处理
            region: regionFilter || undefined,
            // 每页条数
            limit: PAGE_SIZE,
            // 当前偏移
            offset,
          }) // 代码块结束
        : Promise.resolve(null),
    // 依赖：凭证 / 权限 / 已提交关键词 / 状态 / 区域 / 偏移，任一变化重新请求
    [credential, canRead, applied, statusFilter, regionFilter, offset],
  ); // 执行当前业务步骤
  // 当前展开的审计事件行：null 表示全部收起
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 展开行的审计事件：随展开目标变化重新拉取，收起时回 null
  const events = useAsync<EntitlementEventView[] | null>(
    () => (expandedId ? listEntitlementEvents(credential, expandedId) : Promise.resolve(null)),
    [credential, expandedId],
  ); // 执行当前业务步骤

  // ── 发放表单状态 ──
  const [grantUserId, setGrantUserId] = useState(''); // 发放表单：目标用户 ID
  const [grantModule, setGrantModule] = useState(''); // 发放表单：选中的模块码
  const [grantRegion, setGrantRegion] = useState<'cn' | 'global'>('cn'); // 发放表单：数据区域，默认中国大陆
  const [grantExpires, setGrantExpires] = useState(''); // 发放表单：到期时间，留空即永久
  // ── 回收表单状态 ──
  const [revokeId, setRevokeId] = useState(''); // 回收表单：目标权益 ID
  const [revokeReason, setRevokeReason] = useState(''); // 回收表单：回收原因（选填）
  // 同一时刻只允许一个写请求在途，避免重复提交
  const [busy, setBusy] = useState<'grant' | 'revoke' | null>(null);
  // 两个表单各自独立的错误与成功回执
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantReceipt, setGrantReceipt] = useState<EntitlementView | null>(null); // 最近一次发放成功回执
  const [revokeError, setRevokeError] = useState<string | null>(null); // 回收表单错误文案
  const [revokeReceipt, setRevokeReceipt] = useState<RevokedReceipt | null>(null); // 最近一次回收成功回执

  // 列表总数与当前页数据：无权限或加载前按空处理
  const total = listState.data?.total ?? 0;
  // 当前页权益行
  const rows = listState.data?.entitlements ?? [];

  // 模块下拉选项：抽到 TS 位置便于逐项注释
  const moduleOptions = (modules.data ?? []).map((item) => ({
    // 提交值使用模块码
    value: item.code,
    // 展示文案为「中文名（模块码）」
    label: `${pickLocale(item.name, item.code)}（${item.code}）`,
  })); // 下拉选项数组组装完毕

  // 发放回执展示字段：抽成数组后用 map 渲染，避免重复 JSX
  const grantRows = grantReceipt
    ? [ // 有回执时展开为字段数组
        { label: '权益 ID', value: grantReceipt.id }, // 权益主键
        { label: '用户', value: grantReceipt.user_id }, // 归属用户
        { label: '模块', value: grantReceipt.module_code }, // 模块码
        { label: '状态', value: grantReceipt.status }, // 当前状态
        { label: '到期', value: grantReceipt.expires_at ?? '永久' }, // 无到期时间则显示永久
        { label: '版本', value: String(grantReceipt.version) }, // 乐观锁版本号
      ] // 字段数组结束
    : []; // 无回执则不渲染表格

  // 回收回执展示字段
  const revokeRows = revokeReceipt
    ? [ // 有回执时展开为字段数组
        { label: '权益 ID', value: revokeReceipt.id }, // 权益主键
        { label: '用户', value: revokeReceipt.user_id }, // 归属用户
        { label: '状态', value: revokeReceipt.status }, // 回收后固定 revoked
        { label: '版本', value: String(revokeReceipt.version) }, // 乐观锁版本号
        { label: '时间', value: revokeReceipt.updated_at }, // 回收时间
      ] // 字段数组结束
    : []; // 无回执则不渲染表格

  // 提交搜索：把输入框值落到 applied 并回到第一页
  function submitSearch(event: FormEvent) {
    // 阻止表单默认跳转，保持单页体验
    event.preventDefault();
    // 去掉首尾空白后生效
    setApplied(keyword.trim());
    // 条件变化后回到第一页，避免停留在空页
    setOffset(0);
  } // submitSearch 结束

  // 切换状态过滤：立即生效并回到第一页
  function changeStatus(value: string) {
    // 仅接受已知枚举值，其余一律回退为不过滤
    setStatusFilter(value === 'active' || value === 'expired' || value === 'revoked' ? value : '');
    // 回到第一页
    setOffset(0);
  } // changeStatus 结束

  // 切换区域过滤：立即生效并回到第一页
  function changeRegion(value: string) {
    // 仅接受 cn/global，其余一律回退为跨区域
    setRegionFilter(value === 'cn' || value === 'global' ? value : '');
    // 回到第一页
    setOffset(0);
  } // changeRegion 结束

  // 上一页：偏移量不允许为负
  function prevPage() {
    // 回退一页，最小到 0
    setOffset((value) => Math.max(0, value - PAGE_SIZE));
  } // prevPage 结束

  // 下一页：由按钮的 disabled 保证不会越界
  function nextPage() {
    // 推进一页
    setOffset((value) => value + PAGE_SIZE);
  } // nextPage 结束

  // 切换审计事件展开：再次点击同一行即收起
  function toggleEvents(row: EntitlementListRow) {
    // 已展开则收起，否则展开该行并触发事件拉取
    setExpandedId((current) => (current === row.id ? null : row.id));
  } // toggleEvents 结束

  // 把列表行的权益 ID 一键填入回收表单：免手抄，降低误删风险
  function fillRevoke(row: EntitlementListRow) {
    // 填入权益 ID
    setRevokeId(row.id);
    // 清掉上轮错误与回执，避免旧提示误导
    setRevokeError(null);
    setRevokeReceipt(null);
  } // fillRevoke 结束

  // 提交发放：必填校验 → 调用接口 → 保存回执并刷新列表
  async function submitGrant(event: FormEvent) {
    // 阻止表单默认跳转，保持单页体验
    event.preventDefault();
    // 清空上一轮结果，避免旧提示误导
    setGrantError(null);
    setGrantReceipt(null); // 旧回执一并清掉，防止与新结果混淆
    // 前端先做必填校验，减少无效请求
    if (!grantUserId.trim() || !grantModule) {
      // 提示缺项
      setGrantError('请填写用户 ID 并选择模块');
      // 提前结束
      return;
    } // 必填校验失败分支结束
    // 置为在途，禁用按钮
    setBusy('grant');
    // 统一收尾
    try {
      // 调用发放接口：到期时间转为 ISO 字符串，留空表示永久有效
      const receipt = await grantEntitlement(credential, {
        // 去掉首尾空白，避免脏输入
        user_id: grantUserId.trim(),
        // 选中的模块码
        module_code: grantModule,
        // 数据区域
        region: grantRegion,
        // 仅在填写了到期时间时携带
        expires_at: grantExpires ? new Date(grantExpires).toISOString() : undefined,
      }); // 请求体组装完毕；该接口要求 entitlement:grant 权限点
      // 保存回执用于展示
      setGrantReceipt(receipt);
      // 列表同步刷新，新发放的记录立即可见
      listState.reload();
    } catch (error) { // 请求失败分支
      // 失败统一转为可读文案
      setGrantError(describeError(error));
    } finally { // 无论成败都要收尾
      // 无论成败都解除在途
      setBusy(null);
    } // try/catch/finally 结束
  } // submitGrant 结束

  // 提交回收：必填校验 → 调用接口 → 保存回执并刷新列表与展开的事件
  async function submitRevoke(event: FormEvent) {
    // 阻止表单默认跳转
    event.preventDefault();
    // 清空上一轮结果
    setRevokeError(null);
    setRevokeReceipt(null); // 旧回执一并清掉
    // 权益 ID 必填
    if (!revokeId.trim()) {
      // 提示缺项
      setRevokeError('请填写权益 ID');
      // 提前结束
      return;
    } // 校验失败分支结束
    // 置为在途
    setBusy('revoke');
    // 统一收尾
    try {
      // 调用回收接口：原因选填，空字符串按未填处理
      const receipt = await revokeEntitlement(credential, revokeId.trim(), revokeReason.trim() || undefined);
      // 保存回执
      setRevokeReceipt(receipt);
      // 列表同步刷新，状态列立即变为已回收
      listState.reload();
      // 若被回收的行正处于展开态，顺带刷新其审计时间线
      if (expandedId === receipt.id) events.reload();
    } catch (error) { // 请求失败分支
      // 失败提示
      setRevokeError(describeError(error));
    } finally { // 无论成败都要收尾
      // 解除在途
      setBusy(null);
    } // try/catch/finally 结束
  } // submitRevoke 结束

  // 渲染
  return (
    <div className="page"> {/* 页面根容器 */}
      <div className="page-head"> {/* 页头：标题与审计说明 */}
        <h2>权益管理</h2> {/* 页面标题 */}
        <span className="count">发放与回收都会写入 entitlement_events 审计</span> {/* 提示两个动作均落审计表 */}
      </div> {/* 页头结束 */}

      {!canRead ? ( // 无 entitlement:read 权限时列表区整体降级为提示
        // 缺权限时只读提示，不渲染列表
        <div className="hint">当前身份缺少 entitlement:read 权限，无法查看权益列表</div>
      ) : ( // 有权限时渲染权益列表
        <div className="panel"> {/* 列表面板 */}
          <div className="panel-head"> {/* 面板头：标题 + 页码 */}
            <h3>权益列表</h3> {/* 面板标题 */}
            <span className="muted">第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span> {/* 由偏移量换算的当前页码 */}
          </div> {/* 面板头结束 */}
          <form className="row" onSubmit={submitSearch}> {/* 过滤工具行：提交制搜索 + 即时过滤下拉 */}
            <input /* 关键字输入框 */
              value={keyword} /* 受控值 */
              onChange={(event) => setKeyword(event.target.value)} /* 只更新输入态，不触发请求 */
              placeholder="搜索用户 ID / 模块码" /* 搜索范围提示 */
              style={{ maxWidth: 320 }} /* 限宽，避免挤压下拉框 */
            /> {/* 输入框结束 */}
            <select /* 状态下拉框 */
              value={statusFilter} /* 受控值 */
              onChange={(event) => changeStatus(event.target.value)} /* 切换即生效 */
              aria-label="状态过滤" /* 无障碍标签 */
            > {/* 下拉子项开始 */}
              {STATUS_OPTIONS.map((option) => ( // 逐项渲染状态选项
                // 每个状态一个选项
                <option key={option.value} value={option.value}> {/* 以枚举值为 key 与提交值 */}
                  {option.label} {/* 中文文案 */}
                </option> // 选项结束
              ))} {/* 状态选项渲染结束 */}
            </select> {/* 状态下拉结束 */}
            <select /* 区域下拉框 */
              value={regionFilter} /* 受控值 */
              onChange={(event) => changeRegion(event.target.value)} /* 切换即生效 */
              aria-label="区域过滤" /* 无障碍标签 */
            > {/* 下拉子项开始 */}
              {REGION_OPTIONS.map((option) => ( // 逐项渲染区域选项
                // 每个区域一个选项
                <option key={option.value} value={option.value}> {/* 以区域码为 key 与提交值 */}
                  {option.label} {/* 中文文案 */}
                </option> // 选项结束
              ))} {/* 区域选项渲染结束 */}
            </select> {/* 区域下拉结束 */}
            <button className="btn" type="submit">搜索</button> {/* 提交按钮：仅关键字需要点击生效 */}
          </form> {/* 过滤工具行结束 */}

          {listState.loading ? <p className="muted">加载中…</p> : null} {/* 加载中占位 */}
          {listState.error ? ( // 列表加载失败时提示
            // 错误条带重试按钮
            <div className="error">
              {describeError(listState.error)} {/* 错误文案 */}
              <button className="btn ghost" type="button" onClick={() => listState.reload()}>重试</button> {/* 手动重拉 */}
            </div> // 错误条结束
          ) : null} {/* 无错误则不渲染 */}
          {!listState.loading && !listState.error && rows.length === 0 ? ( // 加载完成且无错误但无数据
            // 空态文案
            <div className="empty">没有符合条件的权益记录</div>
          ) : null} {/* 空态渲染结束 */}
          {rows.length > 0 ? ( // 有数据时渲染表格
            // 权益表格
            <table className="table"> {/* 表格容器 */}
              <thead> {/* 表头 */}
                <tr> {/* 表头行 */}
                  <th>用户</th> {/* 用户 ID 列 */}
                  <th>模块</th> {/* 模块名称列 */}
                  <th>状态</th> {/* 状态徽章列 */}
                  <th>到期时间</th> {/* 到期时间列 */}
                  <th>区域</th> {/* 区域列 */}
                  <th>更新时间</th> {/* 更新时间列 */}
                  <th>操作</th> {/* 行级操作列 */}
                </tr> {/* 表头行结束 */}
              </thead> {/* 表头结束 */}
              <tbody> {/* 表体 */}
                {rows.map((row) => ( // 逐行渲染权益
                  // 每行权益渲染为「数据行 + 可选的审计展开行」两段的片段
                  <FragmentRow
                    key={row.id} // 以权益主键为 key
                    row={row} // 行数据
                    expanded={expandedId === row.id} // 是否处于展开态
                    events={expandedId === row.id ? events : null} // 仅展开行透传事件异步态
                    canRevoke={canRevoke} // 回收入口按权限点门禁
                    onToggle={() => toggleEvents(row)} // 点击展开/收起
                    onFillRevoke={() => fillRevoke(row)} // 点击填入回收表单
                  />
                ))} {/* 行渲染结束 */}
              </tbody> {/* 表体结束 */}
            </table> // 权益表格结束
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
        </div> // 列表面板结束
      )} {/* 列表区条件渲染结束 */}

      <div className="split"> {/* 左右双栏：发放 | 回收 */}
        <div className="panel"> {/* 左栏：发放面板 */}
          <div className="panel-head"> {/* 面板标题区 */}
            <h3>发放权益</h3> {/* 发放面板标题 */}
          </div> {/* 面板标题区结束 */}
          {!canGrant ? ( // 无 entitlement:grant 权限时降级为只读提示
            // 缺权限时只读提示，不渲染表单
            <div className="hint">当前身份缺少 entitlement:grant 权限</div>
          ) : ( // 有权限时渲染发放表单
            <form className="form" onSubmit={(event) => void submitGrant(event)}> {/* 发放表单，提交走 submitGrant */}
              <label className="field"> {/* 字段：用户 ID */}
                <span>用户 ID</span> {/* 字段名 */}
                <input /* 用户 ID 输入框 */
                  value={grantUserId} /* 受控值 */
                  onChange={(event) => setGrantUserId(event.target.value)} /* 同步输入到状态 */
                  placeholder="usr_xxx" /* 输入示例提示 */
                  disabled={busy !== null} /* 请求在途时禁用，防重复提交 */
                /> {/* 输入框结束 */}
              </label> {/* 用户 ID 字段结束 */}
              <label className="field"> {/* 字段：模块 */}
                <span>模块</span> {/* 字段名 */}
                <select /* 模块下拉框 */
                  value={grantModule} /* 受控值 */
                  onChange={(event) => setGrantModule(event.target.value)} /* 同步选择到状态 */
                  disabled={busy !== null} /* 在途禁用 */
                > {/* 下拉子项开始 */}
                  <option value="">请选择模块</option> {/* 占位项，值为空以触发必填校验 */}
                  {moduleOptions.map((option) => ( // 逐项渲染模块选项
                    // 每个模块一个选项
                    <option key={option.value} value={option.value}> {/* 以模块码为 key 与提交值 */}
                      {option.label} {/* 展示「中文名（模块码）」 */}
                    </option> // 选项结束
                  ))} {/* 选项列表渲染结束 */}
                </select> {/* 下拉框结束 */}
              </label> {/* 模块字段结束 */}
              <label className="field"> {/* 字段：区域 */}
                <span>区域</span> {/* 字段名 */}
                <select /* 区域下拉框 */
                  value={grantRegion} /* 受控值 */
                  onChange={(event) => setGrantRegion(event.target.value === 'global' ? 'global' : 'cn')} /* 仅接受 cn/global 两值，兜底回 cn */
                  disabled={busy !== null} /* 在途禁用 */
                > {/* 子项开始 */}
                  <option value="cn">cn（中国大陆）</option> {/* 中国大陆区 */}
                  <option value="global">global（海外）</option> {/* 海外区 */}
                </select> {/* 下拉框结束 */}
              </label> {/* 区域字段结束 */}
              <label className="field"> {/* 字段：到期时间 */}
                <span>到期时间（留空永久）</span> {/* 字段名，说明留空语义 */}
                <input /* 到期时间输入框 */
                  type="datetime-local" /* 本地日期时间选择器 */
                  value={grantExpires} /* 受控值 */
                  onChange={(event) => setGrantExpires(event.target.value)} /* 同步选择到状态 */
                  disabled={busy !== null} /* 在途禁用 */
                /> {/* 输入框结束 */}
              </label> {/* 到期字段结束 */}
              {modules.error ? ( // 模块列表加载失败时提示
                // 模块列表拉取失败不影响提交，仅提示可能选不到模块
                <div className="warning">模块列表加载失败：{describeError(modules.error)}</div>
              ) : null} {/* 无错误则不渲染 */}
              {grantError ? ( // 发放失败时提示
                // 发放失败提示
                <div className="error">{grantError}</div>
              ) : null} {/* 无错误则不渲染 */}
              <div className="row"> {/* 按钮行 */}
                <button className="btn primary" type="submit" disabled={busy !== null}> {/* 提交按钮，主样式，在途禁用 */}
                  {busy === 'grant' ? '发放中…' : '发放'} {/* 在途时显示进度文案 */}
                </button> {/* 提交按钮结束 */}
                <button /* 清空按钮 */
                  className="btn ghost" /* 次级幽灵样式 */
                  type="button" /* 显式 button 类型，避免误触发表单提交 */
                  disabled={busy !== null} /* 在途禁用 */
                  onClick={() => { // 点击重置发放表单
                    // 一键重置表单
                    setGrantUserId(''); // 清空用户 ID
                    setGrantModule(''); // 清空模块选择
                    setGrantExpires(''); // 清空到期时间
                    setGrantError(null); // 清空错误提示
                    setGrantReceipt(null); // 清空成功回执
                  }} /* 重置逻辑结束 */
                > {/* 按钮属性区结束 */}
                  清空 {/* 按钮文案 */}
                </button> {/* 清空按钮结束 */}
              </div> {/* 按钮行结束 */}
            </form> // 发放表单结束
          )} {/* 发放区条件渲染结束 */}
          {grantRows.length > 0 ? ( // 有回执时渲染结果表
            // 发放成功回执
            <table className="table"> {/* 回执表格 */}
              <tbody> {/* 表体 */}
                {grantRows.map((row) => ( // 逐字段渲染一行
                  // 每行一个字段
                  <tr key={row.label}> {/* 以字段名为 key */}
                    <th>{row.label}</th> {/* 字段名 */}
                    <td> {/* 字段值 */}
                      <code>{row.value}</code> {/* 等宽字体展示，便于复制 */}
                    </td> {/* 值结束 */}
                  </tr> // 行结束
                ))} {/* 行渲染结束 */}
              </tbody> {/* 表体结束 */}
            </table> // 回执表格结束
          ) : null} {/* 无回执则不渲染 */}
        </div> {/* 发放面板结束 */}
        <div className="panel"> {/* 右栏：回收面板 */}
          <div className="panel-head"> {/* 面板标题区 */}
            <h3>回收权益</h3> {/* 回收面板标题 */}
          </div> {/* 面板标题区结束 */}
          {!canRevoke ? ( // 无 entitlement:revoke 权限时降级为只读提示
            // 缺权限时只读提示
            <div className="hint">当前身份缺少 entitlement:revoke 权限</div>
          ) : ( // 有权限时渲染回收表单
            <form className="form" onSubmit={(event) => void submitRevoke(event)}> {/* 回收表单，提交走 submitRevoke */}
              <label className="field"> {/* 字段：权益 ID */}
                <span>权益 ID</span> {/* 字段名 */}
                <input /* 权益 ID 输入框 */
                  value={revokeId} /* 受控值 */
                  onChange={(event) => setRevokeId(event.target.value)} /* 同步输入到状态 */
                  placeholder="ent_xxx" /* 输入示例提示 */
                  disabled={busy !== null} /* 在途禁用 */
                /> {/* 输入框结束 */}
              </label> {/* 权益 ID 字段结束 */}
              <label className="field"> {/* 字段：回收原因 */}
                <span>回收原因（选填）</span> {/* 字段名 */}
                <input /* 回收原因输入框 */
                  value={revokeReason} /* 受控值 */
                  onChange={(event) => setRevokeReason(event.target.value)} /* 同步输入到状态 */
                  placeholder="如：退款 / 违规 / 人工纠正" /* 常见原因示例 */
                  disabled={busy !== null} /* 在途禁用 */
                /> {/* 输入框结束 */}
              </label> {/* 原因字段结束 */}
              {revokeError ? ( // 回收失败时提示
                // 回收失败提示
                <div className="error">{revokeError}</div>
              ) : null} {/* 无错误则不渲染 */}
              <div className="row"> {/* 按钮行 */}
                <button className="btn danger" type="submit" disabled={busy !== null}> {/* 回收按钮，危险样式警示，在途禁用 */}
                  {busy === 'revoke' ? '回收中…' : '回收'} {/* 在途时显示进度文案 */}
                </button> {/* 回收按钮结束 */}
                <button /* 清空按钮 */
                  className="btn ghost" /* 次级幽灵样式 */
                  type="button" /* 显式 button 类型，避免误触发表单提交 */
                  disabled={busy !== null} /* 在途禁用 */
                  onClick={() => { // 点击重置回收表单
                    // 一键重置表单
                    setRevokeId(''); // 清空权益 ID
                    setRevokeReason(''); // 清空回收原因
                    setRevokeError(null); // 清空错误提示
                    setRevokeReceipt(null); // 清空成功回执
                  }} /* 重置逻辑结束 */
                > {/* 按钮属性区结束 */}
                  清空 {/* 按钮文案 */}
                </button> {/* 清空按钮结束 */}
              </div> {/* 按钮行结束 */}
            </form> // 回收表单结束
          )} {/* 回收区条件渲染结束 */}
          {revokeRows.length > 0 ? ( // 有回执时渲染结果表
            // 回收成功回执
            <table className="table"> {/* 回执表格 */}
              <tbody> {/* 表体 */}
                {revokeRows.map((row) => ( // 逐字段渲染一行
                  // 每行一个字段
                  <tr key={row.label}> {/* 以字段名为 key */}
                    <th>{row.label}</th> {/* 字段名 */}
                    <td> {/* 字段值 */}
                      <code>{row.value}</code> {/* 等宽字体展示，便于复制 */}
                    </td> {/* 值结束 */}
                  </tr> // 行结束
                ))} {/* 行渲染结束 */}
              </tbody> {/* 表体结束 */}
            </table> // 回执表格结束
          ) : null} {/* 无回执则不渲染 */}
        </div> {/* 回收面板结束 */}
      </div> {/* 双栏布局结束 */}
    </div> // 页面根容器结束
  ); // JSX 返回结束
} // Entitlements 组件结束

// 单行权益渲染入参：数据行 + 可选的审计展开行
interface FragmentRowProps {
  // 当前权益行数据
  row: EntitlementListRow;
  // 是否处于展开态
  expanded: boolean;
  // 展开行的事件异步态：非展开行传 null 不渲染事件区
  events: ReturnType<typeof useAsync<EntitlementEventView[] | null>> | null;
  // 是否具备回收权限：决定「填入回收」按钮是否出现
  canRevoke: boolean;
  // 点击展开/收起回调
  onToggle: () => void;
  // 点击填入回收表单回调
  onFillRevoke: () => void;
} // FragmentRowProps 结束

// 单行权益：数据行 + 展开时的审计事件行，两段合为一个片段返回
function FragmentRow({ row, expanded, events, canRevoke, onToggle, onFillRevoke }: FragmentRowProps) {
  // 渲染数据行与可选展开行
  return (
    <> {/* 片段容器：两行共用一个 key 由外部 map 提供 */}
      <tr> {/* 数据行 */}
        <td> {/* 用户列 */}
          <code>{row.user_id}</code> {/* 等宽展示用户 ID，便于复制 */}
        </td> {/* 用户列结束 */}
        <td> {/* 模块列 */}
          {pickLocale(row.module_name, row.module_code)} {/* 优先中文名，缺失回退模块码 */}
          <div className="muted">{row.module_code}</div> {/* 模块码副文案 */}
        </td> {/* 模块列结束 */}
        <td> {/* 状态列 */}
          <span className={`badge ${STATUS_BADGE[row.status] ?? 'builtin'}`}> {/* 状态徽章，未知状态回退 builtin 样式 */}
            {STATUS_LABEL[row.status] ?? row.status} {/* 未知状态直接展示原始值 */}
          </span> {/* 徽章结束 */}
        </td> {/* 状态列结束 */}
        <td>{row.expires_at ?? '永久'}</td> {/* 到期时间列：null 显示永久 */}
        <td>{row.region}</td> {/* 区域列 */}
        <td>{row.updated_at}</td> {/* 更新时间列 */}
        <td> {/* 操作列 */}
          <button className="btn ghost" type="button" onClick={onToggle}> {/* 审计展开/收起按钮 */}
            {expanded ? '收起审计' : '审计'} {/* 按展开态切换文案 */}
          </button> {/* 审计按钮结束 */}
          {canRevoke && row.status === 'active' ? ( // 仅生效中的权益可一键填入回收，其他状态无意义
            // 填入回收按钮
            <button className="btn ghost" type="button" onClick={onFillRevoke}>填入回收</button>
          ) : null} {/* 填入回收条件渲染结束 */}
        </td> {/* 操作列结束 */}
      </tr> {/* 数据行结束 */}
      {expanded ? ( // 展开态时追加审计事件行
        // 审计展开行：跨整表宽
        <tr> {/* 展开行容器 */}
          <td colSpan={7}> {/* 横跨全部 7 列 */}
            {!events || events.loading ? ( // 事件加载中（含刚展开尚未发起请求的瞬态）
              // 加载占位
              <p className="muted">审计事件加载中…</p>
            ) : events.error ? ( // 事件加载失败
              // 错误提示
              <div className="error">{describeError(events.error)}</div>
            ) : (events.data ?? []).length === 0 ? ( // 加载完成但无事件（理论上至少有一条发放事件，兜底展示）
              // 空态
              <p className="muted">暂无审计事件</p>
            ) : ( // 有事件时渲染时间线表
              // 审计事件表
              <table className="table"> {/* 嵌套表格容器 */}
                <thead> {/* 表头 */}
                  <tr> {/* 表头行 */}
                    <th>时间</th> {/* 事件时间列 */}
                    <th>源状态</th> {/* 源状态列 */}
                    <th>目标状态</th> {/* 目标状态列 */}
                    <th>操作者</th> {/* 操作者列 */}
                    <th>原因</th> {/* 原因列 */}
                  </tr> {/* 表头行结束 */}
                </thead> {/* 表头结束 */}
                <tbody> {/* 表体 */}
                  {(events.data ?? []).map((item) => ( // 按写入顺序逐条渲染
                    // 每条事件一行
                    <tr key={item.id}> {/* 以事件主键为 key */}
                      <td>{item.created_at}</td> {/* 事件时间 */}
                      <td>{item.from_status ?? '（无）'}</td> {/* 首次发放源状态为 null，显示（无） */}
                      <td>{item.to_status}</td> {/* 目标状态 */}
                      <td>{item.actor}</td> {/* 操作者 */}
                      <td>{item.reason ?? '—'}</td> {/* 无原因显示占位符 */}
                    </tr> // 事件行结束
                  ))} {/* 事件渲染结束 */}
                </tbody> {/* 表体结束 */}
              </table> // 审计事件表结束
            )} {/* 事件区条件渲染结束 */}
          </td> {/* 展开单元格结束 */}
        </tr> // 展开行结束
      ) : null} {/* 非展开态不渲染 */}
    </> // 片段结束
  ); // 返回值结束
} // FragmentRow 组件结束
