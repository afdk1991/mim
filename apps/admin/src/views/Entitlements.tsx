// 权益管理视图：发放与回收模块权益，两个动作各自按权限点门禁
import type { FormEvent } from 'react';
import { useState } from 'react'; // 表单状态钩子
// 只引入本视图需要的类型与接口函数，避免无谓的打包体积
import type { Credential, EntitlementView } from '../api';
import { describeError, grantEntitlement, listModules, revokeEntitlement } from '../api'; // 错误转文案 + 权益发放/回收/模块列表三个接口
// 通用异步加载钩子：负责 loading / error / reload
import { useAsync } from '../hooks';

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

// 多语言取值：入参放宽为可选值，规避 TS2869「?? 右侧不可达」
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 优先简体中文，其次英文，最后回退到调用方给定值
  return field['zh-CN'] ?? field.en ?? fallback;
} // pickLocale 结束

// 权益管理组件主体
export function Entitlements({ credential, permissions }: EntitlementsProps) {
  // 两个动作的权限门禁互相独立：可能出现只能发放不能回收的身份
  const canGrant = permissions.includes('entitlement:grant');
  const canRevoke = permissions.includes('entitlement:revoke'); // 回收动作要求 entitlement:revoke 权限点
  // 模块列表：发放表单的模块下拉需要 code 与展示名
  const modules = useAsync(() => listModules(credential), [credential]);
  // ── 发放表单状态 ──
  const [grantUserId, setGrantUserId] = useState(''); // 发放表单：目标用户 ID
  const [grantModule, setGrantModule] = useState(''); // 发放表单：选中的模块码
  const [grantRegion, setGrantRegion] = useState<'cn' | 'global'>('cn'); // 发放表单：数据区域，默认中国大陆
  const [grantExpires, setGrantExpires] = useState(''); // 发放表单：到期时间，留空即永久
  // ── 回收表单状态 ──
  const [revokeId, setRevokeId] = useState(''); // 回收表单：目标权益 ID
  const [revokeReason, setRevokeReason] = useState(''); // 回收表单：回收原因（选填）
  // 同一时刻只允许一个请求在途，避免重复提交
  const [busy, setBusy] = useState<'grant' | 'revoke' | null>(null);
  // 两个表单各自独立的错误与成功回执
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantReceipt, setGrantReceipt] = useState<EntitlementView | null>(null); // 最近一次发放成功回执
  const [revokeError, setRevokeError] = useState<string | null>(null); // 回收表单错误文案
  const [revokeReceipt, setRevokeReceipt] = useState<RevokedReceipt | null>(null); // 最近一次回收成功回执

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

  // 提交发放：必填校验 → 调用接口 → 保存回执
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
    } catch (error) { // 请求失败分支
      // 失败统一转为可读文案
      setGrantError(describeError(error));
    } finally { // 无论成败都要收尾
      // 无论成败都解除在途
      setBusy(null);
    } // try/catch/finally 结束
  } // submitGrant 结束

  // 提交回收：必填校验 → 调用接口 → 保存回执
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
      <p className="muted"> {/* 页脚弱化说明 */}
        说明：后端暂未提供权益列表接口，本页仅回显最近一次操作结果；查询权益请在数据库或后续版本的分页列表中使用。 {/* 能力边界说明，避免用户误以为可在此查询全量权益 */}
      </p> {/* 页脚结束 */}
    </div> // 页面根容器结束
  ); // JSX 返回结束
} // Entitlements 组件结束
