// 功能模块视图：管理端模块全量列表（含 draft/archived），支持搜索、状态过滤、新建、编辑、调价、软删除与单向状态迁移
import { useState } from 'react'; // 状态钩子：表单、忙碌标记、面板开合等本地状态
import type { FormEvent } from 'react'; // 表单事件类型，提交处理器使用
import type { Credential, ModuleDetail, ModuleManageView, ModulePrice, ModuleStatus } from '../api'; // 仅类型导入：凭证、详情、管理视图、价格行、状态枚举
import { // API 调用：模块管理全方法集
  createModule, // 新建模块
  createModulePrice, // 新增价格行
  deleteModule, // 软删除模块
  deleteModulePrice, // 使价格行失效
  describeError, // 错误转可读文案
  getModule, // 模块详情（含历史价格）
  listModulesManage, // 管理端模块全量列表
  updateModule, // 编辑模块文案/排序/依赖
  updateModulePrice, // 更新价格行
  updateModuleStatus, // 单向状态迁移
} from '../api'; // 结束 API 导入
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
  // 已归档：终态，不可再流转
  archived: '已归档',
}; // 状态文案表结束

// 下一步迁移表：archived 为终态，故意不出现在表内
const NEXT_STATUS: Record<string, { next: ModuleStatus; label: string }> = {
  // 草稿只能上线
  draft: { next: 'active', label: '上线' },
  // 已上线只能归档
  active: { next: 'archived', label: '归档' },
}; // 迁移表结束：未列出的状态即无下一步

// 状态过滤选项：空串表示不过滤
const STATUS_OPTIONS: Array<{ value: '' | ModuleStatus; label: string }> = [
  // 全部状态
  { value: '', label: '全部状态' },
  // 草稿
  { value: 'draft', label: '草稿' },
  // 已上线
  { value: 'active', label: '已上线' },
  // 已归档
  { value: 'archived', label: '已归档' },
]; // 状态选项结束

// 多语言字段取值：入参放宽为 string | undefined，规避 TS2869 不可达分支告警
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 中文优先，其次英文，最后退回编码
  return field['zh-CN'] ?? field.en ?? fallback;
} // 多语言取值函数结束

// 价格格式化：null 表示免费或未定价
function formatPrice(price: ModuleManageView['current_price']): string {
  // 无价格直接标记免费
  if (!price) return '免费';
  // amount_minor 为最小货币单位，除以 100 还原为元
  return `${price.currency} ${(price.amount_minor / 100).toFixed(2)}`;
} // 价格格式化函数结束

// ISO 时间转 datetime-local 输入框值（yyyy-MM-ddTHH:mm，按本地时区）
function isoToLocalInput(iso: string | null): string {
  // 空值直接回空串，输入框显示「未设置」
  if (!iso) return '';
  // 解析为 Date，非法值回空串避免输入框报错
  const date = new Date(iso);
  // 非法日期兜底
  if (Number.isNaN(date.getTime())) return '';
  // 补零工具：月日时分统一两位
  const pad = (n: number) => String(n).padStart(2, '0');
  // 按本地时区拼出输入框需要的格式
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
} // isoToLocalInput 结束

// datetime-local 输入框值转 ISO 字符串；空串返回 undefined 表示不携带
function localInputToIso(value: string): string | undefined {
  // 空串视为未填写
  if (!value) return undefined;
  // 本地时间转 ISO；非法值返回 undefined 由后端兜底报错
  const date = new Date(value);
  // 非法日期不携带
  if (Number.isNaN(date.getTime())) return undefined;
  // 输出标准 ISO
  return date.toISOString();
} // localInputToIso 结束

// 模块表单状态：新建与编辑共用一套字段
interface ModuleFormState {
  // 模块编码（仅新建可填，编辑时锁定）
  code: string;
  // 中文名
  nameZh: string;
  // 英文名（选填）
  nameEn: string;
  // 中文简介（选填）
  summaryZh: string;
  // 英文简介（选填）
  summaryEn: string;
  // 排序权重（字符串态，提交时转数字）
  sortOrder: string;
  // 前置依赖：逗号或空格分隔的模块码
  requires: string;
  // 所属地区
  region: 'cn' | 'global';
} // ModuleFormState 结束

// 空表单常量：新建时重置使用
const EMPTY_MODULE_FORM: ModuleFormState = {
  // 编码
  code: '',
  // 中文名
  nameZh: '',
  // 英文名
  nameEn: '',
  // 中文简介
  summaryZh: '',
  // 英文简介
  summaryEn: '',
  // 排序权重默认 0
  sortOrder: '0',
  // 依赖默认空
  requires: '',
  // 地区默认中国大陆
  region: 'cn',
}; // EMPTY_MODULE_FORM 结束

// 价格表单状态：新增与编辑价格行共用
interface PriceFormState {
  // 币种
  currency: string;
  // 金额（元，字符串态，提交时乘 100 转分）
  amount: string;
  // 生效起始（datetime-local 值，空表示立即生效）
  effectiveFrom: string;
  // 生效结束（datetime-local 值，空表示长期有效）
  effectiveTo: string;
} // PriceFormState 结束

// 空价格表单常量
const EMPTY_PRICE_FORM: PriceFormState = {
  // 默认人民币
  currency: 'CNY',
  // 金额默认空，必填校验拦截
  amount: '',
  // 起始默认空 = 立即生效
  effectiveFrom: '',
  // 结束默认空 = 长期有效
  effectiveTo: '',
}; // EMPTY_PRICE_FORM 结束

// 编辑面板打开态：新建或编辑二选一
type ModulePanel = { mode: 'create' } | { mode: 'edit'; code: string; region: string } | null;

// 模块管理组件
export function Modules({ credential, permissions }: ModulesProps) {
  // 是否具备写权限：无 module:write 时写操作按钮全部禁用
  const canWrite = permissions.includes('module:write');
  // 搜索框输入值（未提交）
  const [keyword, setKeyword] = useState('');
  // 已提交的搜索词：只有点击搜索才生效，避免每次按键都打请求
  const [applied, setApplied] = useState('');
  // 状态过滤：空串表示全部
  const [statusFilter, setStatusFilter] = useState<'' | ModuleStatus>('');
  // 加载管理端模块全量列表，搜索词/状态/凭证变化时重新拉取
  const state = useAsync(
    () => listModulesManage(credential, { q: applied || undefined, status: statusFilter || undefined }),
    [credential, applied, statusFilter],
  );
  // 最近一次操作结果提示
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  // 当前正在执行的行级动作键（如 transition:code / delete:code），防重复提交
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // 删除二次确认：记录已点过一次「删除」的模块码
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);

  // ── 模块新建/编辑面板状态 ──
  // 面板打开态：null 表示关闭
  const [panel, setPanel] = useState<ModulePanel>(null);
  // 表单字段值
  const [form, setForm] = useState<ModuleFormState>(EMPTY_MODULE_FORM);
  // 表单提交在途标记
  const [formBusy, setFormBusy] = useState(false);
  // 表单内错误文案
  const [formError, setFormError] = useState<string | null>(null);

  // ── 调价面板状态 ──
  // 当前打开调价面板的模块（记录编码与地区用于详情请求）
  const [priceTarget, setPriceTarget] = useState<{ code: string; region: string } | null>(null);
  // 调价面板内的模块详情（含历史价格），随目标变化重新拉取
  const detail = useAsync<ModuleDetail | null>(
    () => (priceTarget ? getModule(credential, priceTarget.code, priceTarget.region) : Promise.resolve(null)),
    [credential, priceTarget],
  );
  // 价格表单字段值
  const [priceForm, setPriceForm] = useState<PriceFormState>(EMPTY_PRICE_FORM);
  // 正在编辑的价格行 ID：null 表示新增模式
  const [priceEditingId, setPriceEditingId] = useState<string | null>(null);
  // 价格表单提交在途标记
  const [priceBusy, setPriceBusy] = useState(false);
  // 价格面板内错误文案
  const [priceError, setPriceError] = useState<string | null>(null);

  // 提交搜索：把输入框值落到 applied 触发重新拉取
  function submitSearch(event: FormEvent) {
    // 阻止表单默认跳转
    event.preventDefault();
    // 去掉首尾空白后生效
    setApplied(keyword.trim());
  } // submitSearch 结束

  // 执行状态迁移：成功后刷新列表，失败透出后端文案
  async function runTransition(module: ModuleManageView, next: ModuleStatus, label: string) {
    // 标记该行忙碌
    setBusyKey(`transition:${module.code}`);
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
      setBusyKey(null);
    } // finally 结束
  } // runTransition 结束

  // 打开新建面板：重置表单与错误
  function openCreate() {
    // 面板切到新建模式
    setPanel({ mode: 'create' });
    // 重置表单
    setForm(EMPTY_MODULE_FORM);
    // 清空表单错误
    setFormError(null);
  } // openCreate 结束

  // 打开编辑面板：用行数据回填表单
  function openEdit(module: ModuleManageView) {
    // 面板切到编辑模式，记录编码与地区
    setPanel({ mode: 'edit', code: module.code, region: module.region });
    // 回填表单字段
    setForm({
      // 编码仅展示不可改
      code: module.code,
      // 中文名
      nameZh: module.name['zh-CN'] ?? '',
      // 英文名
      nameEn: module.name.en ?? '',
      // 中文简介
      summaryZh: module.summary['zh-CN'] ?? '',
      // 英文简介
      summaryEn: module.summary.en ?? '',
      // 排序权重转字符串
      sortOrder: String(module.sort_order),
      // 依赖数组转逗号分隔
      requires: module.requires.join(', '),
      // 地区限定已知枚举，未知值回 cn
      region: module.region === 'global' ? 'global' : 'cn',
    });
    // 清空表单错误
    setFormError(null);
  } // openEdit 结束

  // 组装多语言字段：中文必填，英文仅在填写时携带
  function buildLocale(zh: string, en: string): Record<string, string> {
    // 中文固定写入
    const map: Record<string, string> = { 'zh-CN': zh.trim() };
    // 英文非空才写入，避免产生空串语言项
    if (en.trim()) map.en = en.trim();
    // 返回组装结果
    return map;
  } // buildLocale 结束

  // 解析依赖输入：逗号/空格分隔转模块码数组
  function parseRequires(input: string): string[] {
    // 按逗号或空白切分，去空白去空项
    return input
      .split(/[，,\s]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } // parseRequires 结束

  // 提交模块表单：新建走 POST，编辑走 PATCH
  async function submitModuleForm(event: FormEvent) {
    // 阻止表单默认跳转
    event.preventDefault();
    // 清空上轮错误
    setFormError(null);
    // 中文名必填校验
    if (!form.nameZh.trim()) {
      // 提示缺项
      setFormError('请填写中文名称');
      // 提前结束
      return;
    } // 必填校验结束
    // 新建模式下编码必填
    if (panel?.mode === 'create' && !form.code.trim()) {
      // 提示缺项
      setFormError('请填写模块编码');
      // 提前结束
      return;
    } // 编码校验结束
    // 排序权重转数字并校验
    const sortOrder = Number(form.sortOrder);
    // 非有限数或负数拒绝
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      // 提示非法
      setFormError('排序权重必须是非负数字');
      // 提前结束
      return;
    } // 排序校验结束
    // 置为在途
    setFormBusy(true);
    // 统一收尾
    try {
      // 区分新建与编辑
      if (panel?.mode === 'edit') {
        // 编辑：PATCH 仅提交可编辑字段
        await updateModule(credential, panel.code, {
          // 多语言名称
          name: buildLocale(form.nameZh, form.nameEn),
          // 多语言简介
          summary: buildLocale(form.summaryZh, form.summaryEn),
          // 排序权重取整
          sort_order: Math.round(sortOrder),
          // 前置依赖数组
          requires: parseRequires(form.requires),
          // 地区仅用于后端定位模块行
          region: panel.region,
        });
        // 成功提示
        setNotice({ kind: 'success', text: `${panel.code} 已保存` });
      } else {
        // 新建：POST 全量字段
        const created = await createModule(credential, {
          // 模块编码去空白
          code: form.code.trim(),
          // 多语言名称
          name: buildLocale(form.nameZh, form.nameEn),
          // 多语言简介
          summary: buildLocale(form.summaryZh, form.summaryEn),
          // 所属地区
          region: form.region,
          // 排序权重取整
          sort_order: Math.round(sortOrder),
          // 前置依赖数组
          requires: parseRequires(form.requires),
        });
        // 成功提示
        setNotice({ kind: 'success', text: `${created.code} 已创建（草稿）` });
      } // 新建/编辑分支结束
      // 关闭面板
      setPanel(null);
      // 刷新列表
      state.reload();
    } catch (error) { // 请求失败分支
      // 展示后端文案
      setFormError(describeError(error));
    } finally { // 收尾
      // 解除在途
      setFormBusy(false);
    } // try/catch/finally 结束
  } // submitModuleForm 结束

  // 软删除模块：两次点击确认制，第一次点击只武装按钮
  async function removeModule(module: ModuleManageView) {
    // 第一次点击：武装并提示
    if (deleteArmed !== module.code) {
      // 记录武装的模块码
      setDeleteArmed(module.code);
      // 提示再次点击确认
      setNotice({ kind: 'error', text: `再次点击「确认删除」将软删除 ${module.code}（active 须先归档）` });
      // 提前结束
      return;
    } // 武装分支结束
    // 第二次点击：执行删除
    setDeleteArmed(null);
    // 标记忙碌
    setBusyKey(`delete:${module.code}`);
    // 清空提示
    setNotice(null);
    // 调用软删除端点
    try {
      // region 走查询串与模块行一致
      await deleteModule(credential, module.code, module.region);
      // 成功提示
      setNotice({ kind: 'success', text: `${module.code} 已删除（软删除，数据保留）` });
      // 若删除的模块正开着调价/编辑面板，一并关闭
      if (priceTarget?.code === module.code) setPriceTarget(null);
      // 若编辑面板正指向该模块也关闭
      if (panel?.mode === 'edit' && panel.code === module.code) setPanel(null);
      // 刷新列表
      state.reload();
    } catch (error) { // 失败分支
      // 展示后端文案（如 409 须先归档）
      setNotice({ kind: 'error', text: describeError(error) });
    } finally { // 收尾
      // 解除忙碌
      setBusyKey(null);
    } // try/catch/finally 结束
  } // removeModule 结束

  // 打开调价面板：记录目标并重置价格表单
  function openPrices(module: ModuleManageView) {
    // 记录目标模块编码与地区
    setPriceTarget({ code: module.code, region: module.region });
    // 重置价格表单为新增模式
    setPriceForm(EMPTY_PRICE_FORM);
    // 清空编辑标记
    setPriceEditingId(null);
    // 清空错误
    setPriceError(null);
  } // openPrices 结束

  // 回填价格表单进入编辑模式
  function startPriceEdit(price: ModulePrice) {
    // 记录正在编辑的价格行
    setPriceEditingId(price.id);
    // 回填字段
    setPriceForm({
      // 币种
      currency: price.currency,
      // 分转元
      amount: (price.amount_minor / 100).toFixed(2),
      // 起始时间转输入框格式
      effectiveFrom: isoToLocalInput(price.effective_from),
      // 结束时间转输入框格式，null 变空串
      effectiveTo: isoToLocalInput(price.effective_to),
    });
    // 清空错误
    setPriceError(null);
  } // startPriceEdit 结束

  // 提交价格表单：新增走 POST，编辑走 PUT
  async function submitPriceForm(event: FormEvent) {
    // 阻止表单默认跳转
    event.preventDefault();
    // 清空上轮错误
    setPriceError(null);
    // 无目标模块时直接返回（理论上不可达）
    if (!priceTarget) return;
    // 金额转数字并校验
    const amount = Number(priceForm.amount);
    // 非有限数或负数拒绝
    if (!Number.isFinite(amount) || amount < 0) {
      // 提示非法
      setPriceError('金额必须是非负数字');
      // 提前结束
      return;
    } // 金额校验结束
    // 元转分并取整，避免浮点误差
    const amountMinor = Math.round(amount * 100);
    // 置为在途
    setPriceBusy(true);
    // 统一收尾
    try {
      // 区分编辑与新增
      if (priceEditingId) {
        // 编辑：PUT 全量覆盖可改字段；结束时间空串转 null 表示长期有效
        await updateModulePrice(credential, priceEditingId, {
          // 币种
          currency: priceForm.currency,
          // 金额（分）
          amount_minor: amountMinor,
          // 起始时间
          effective_from: localInputToIso(priceForm.effectiveFrom),
          // 结束时间：空串显式传 null
          effective_to: priceForm.effectiveTo ? localInputToIso(priceForm.effectiveTo) : null,
        });
        // 成功提示
        setNotice({ kind: 'success', text: '价格行已更新' });
      } else {
        // 新增：POST 到模块价格集合
        await createModulePrice(credential, priceTarget.code, {
          // 币种
          currency: priceForm.currency,
          // 金额（分）
          amount_minor: amountMinor,
          // 起始时间：空串不携带，后端按立即生效处理
          effective_from: localInputToIso(priceForm.effectiveFrom),
          // 结束时间：空串不携带，后端按长期有效处理
          effective_to: localInputToIso(priceForm.effectiveTo),
        }, priceTarget.region);
        // 成功提示
        setNotice({ kind: 'success', text: '价格行已新增' });
      } // 新增/编辑分支结束
      // 重置回新增模式
      setPriceEditingId(null);
      // 重置表单
      setPriceForm(EMPTY_PRICE_FORM);
      // 刷新详情拿到最新价格历史
      detail.reload();
      // 刷新列表同步当前价格列
      state.reload();
    } catch (error) { // 失败分支
      // 展示后端文案（如 400 窗口倒序）
      setPriceError(describeError(error));
    } finally { // 收尾
      // 解除在途
      setPriceBusy(false);
    } // try/catch/finally 结束
  } // submitPriceForm 结束

  // 使价格行失效：后端软失效 effective_to = now
  async function expirePrice(priceId: string) {
    // 置忙碌标记防重复
    setBusyKey(`price:${priceId}`);
    // 清空提示
    setNotice(null);
    // 调用失效端点
    try {
      // DELETE /modules/prices/:id
      await deleteModulePrice(credential, priceId);
      // 成功提示
      setNotice({ kind: 'success', text: '价格行已失效（保留历史留痕）' });
      // 若正在编辑该行，退出编辑模式
      if (priceEditingId === priceId) {
        // 清空编辑标记
        setPriceEditingId(null);
        // 重置表单
        setPriceForm(EMPTY_PRICE_FORM);
      } // 编辑标记清理结束
      // 刷新详情
      detail.reload();
      // 刷新列表
      state.reload();
    } catch (error) { // 失败分支
      // 展示后端文案（如 404 已过期）
      setNotice({ kind: 'error', text: describeError(error) });
    } finally { // 收尾
      // 解除忙碌
      setBusyKey(null);
    } // try/catch/finally 结束
  } // expirePrice 结束

  // 预计算行数据，便于在 TS 位置逐行注释
  const rows = (state.data ?? []).map((module) => {
    // 名称按中文优先回退
    const name = pickLocale(module.name, module.code);
    // 摘要缺省用破折号占位
    const summary = pickLocale(module.summary, '—');
    // 查表得到下一步动作；终态为 undefined
    const action = NEXT_STATUS[module.status];
    // 当前模块是否处于删除武装态
    const armed = deleteArmed === module.code;
    // 返回渲染所需字段
    return { module, name, summary, action, armed };
  }); // 行数据预计算结束

  // 历史价格行（调价面板）：详情未加载时为空数组
  const priceRows = detail.data?.price_history ?? [];

  // 渲染
  return (
    <div className="page"> {/* 页面根容器 */}
      <div className="page-head"> {/* 页头：标题与新建入口 */}
        <h2>功能模块</h2> {/* 视图标题 */}
        <div className="row"> {/* 右侧操作区 */}
          <span className="count"> {/* 模块总数与状态机规则提示 */}
            共 {rows.length} 个模块 · 状态单向流转 draft → active → archived {/* rows 为预计算行数据 */}
          </span> {/* 计数说明结束 */}
          <button
            className="btn primary" /* 主按钮：新建模块入口 */
            type="button" /* 显式声明普通按钮 */
            disabled={!canWrite} /* 无写权限禁用 */
            onClick={openCreate} /* 点击打开新建面板 */
          > {/* 按钮属性区收尾 */}
            新建模块 {/* 按钮文案 */}
          </button> {/* 新建按钮结束 */}
        </div> {/* 右侧操作区结束 */}
      </div> {/* 页头结束 */}
      <form className="row" onSubmit={submitSearch}> {/* 搜索工具行：提交制搜索 */}
        <label className="field" style={{ maxWidth: 320 }}> {/* 关键字输入字段 */}
          <span>搜索模块编码 / 名称</span> {/* 字段标签 */}
          <input
            value={keyword} /* 受控输入值 */
            onChange={(event) => setKeyword(event.target.value)} /* 同步输入态 */
            placeholder="输入关键字后回车或点搜索" /* 占位提示 */
          /> {/* 输入框结束 */}
        </label> {/* 字段结束 */}
        <label className="field" style={{ maxWidth: 160 }}> {/* 状态过滤字段 */}
          <span>状态</span> {/* 字段标签 */}
          <select
            value={statusFilter} /* 受控选中值 */
            onChange={(event) => setStatusFilter(event.target.value as '' | ModuleStatus)} /* 同步过滤态 */
          > {/* 下拉框属性区收尾 */}
            {STATUS_OPTIONS.map((option) => ( // 逐个渲染状态选项
              <option key={option.value} value={option.value}>{option.label}</option> // 单选项
            ))} {/* 选项 map 收尾 */}
          </select> {/* 下拉框结束 */}
        </label> {/* 状态字段结束 */}
        <button className="btn" type="submit">搜索</button> {/* 提交按钮：触发 applied 更新 */}
      </form> {/* 搜索工具行结束 */}
      {notice ? ( // 存在操作结果时渲染提示条
        // 操作结果提示条
        <div className={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}</div>
      ) : null} {/* 无提示时不占位 */}
      {!canWrite ? ( // 无写权限时展示禁用原因
        // 只读提示：权限不足时说明为何按钮不可用
        <div className="hint">当前身份缺少 module:write 权限，新建/编辑/调价/删除/状态按钮已禁用</div>
      ) : null} {/* 有权限时不渲染 */}
      {panel ? ( // 新建/编辑面板打开时渲染表单
        <div className="panel"> {/* 表单面板容器 */}
          <div className="panel-head"> {/* 面板标题行 */}
            <strong>{panel.mode === 'create' ? '新建模块' : `编辑模块 ${panel.code}`}</strong> {/* 面板标题按模式切换 */}
            <button className="btn ghost" type="button" onClick={() => setPanel(null)}>关闭</button> {/* 关闭面板按钮 */}
          </div> {/* 面板标题行结束 */}
          {formError ? <div className="error">{formError}</div> : null} {/* 表单错误提示 */}
          <form className="form" onSubmit={submitModuleForm}> {/* 模块表单 */}
            <div className="row"> {/* 第一行：编码 + 地区 */}
              <label className="field"> {/* 编码字段 */}
                <span>模块编码（小写字母数字开头，可含 . _ -）</span> {/* 字段标签含格式说明 */}
                <input
                  value={form.code} /* 受控值 */
                  disabled={panel.mode === 'edit'} /* 编辑模式锁定编码 */
                  onChange={(event) => setForm({ ...form, code: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 编码字段结束 */}
              <label className="field"> {/* 地区字段 */}
                <span>所属地区{panel.mode === 'edit' ? '（编辑时不可改）' : ''}</span> {/* 字段标签按模式提示 */}
                <select
                  value={form.region} /* 受控选中值 */
                  disabled={panel.mode === 'edit'} /* 编辑模式锁定地区 */
                  onChange={(event) => setForm({ ...form, region: event.target.value as 'cn' | 'global' })} /* 同步选择 */
                > {/* 下拉框属性区收尾 */}
                  <option value="cn">cn（中国大陆）</option> {/* 中国大陆选项 */}
                  <option value="global">global（国际）</option> {/* 国际选项 */}
                </select> {/* 下拉框结束 */}
              </label> {/* 地区字段结束 */}
              <label className="field"> {/* 排序权重字段 */}
                <span>排序权重（越小越靠前）</span> {/* 字段标签 */}
                <input
                  type="number" /* 数字输入 */
                  min={0} /* 非负约束 */
                  value={form.sortOrder} /* 受控值 */
                  onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 排序字段结束 */}
            </div> {/* 第一行结束 */}
            <div className="row"> {/* 第二行：中英文名称 */}
              <label className="field"> {/* 中文名字段 */}
                <span>中文名称（必填）</span> {/* 字段标签 */}
                <input
                  value={form.nameZh} /* 受控值 */
                  onChange={(event) => setForm({ ...form, nameZh: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 中文名字段结束 */}
              <label className="field"> {/* 英文名字段 */}
                <span>英文名称（选填）</span> {/* 字段标签 */}
                <input
                  value={form.nameEn} /* 受控值 */
                  onChange={(event) => setForm({ ...form, nameEn: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 英文名字段结束 */}
            </div> {/* 第二行结束 */}
            <div className="row"> {/* 第三行：中英文简介 */}
              <label className="field"> {/* 中文简介字段 */}
                <span>中文简介（选填）</span> {/* 字段标签 */}
                <input
                  value={form.summaryZh} /* 受控值 */
                  onChange={(event) => setForm({ ...form, summaryZh: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 中文简介字段结束 */}
              <label className="field"> {/* 英文简介字段 */}
                <span>英文简介（选填）</span> {/* 字段标签 */}
                <input
                  value={form.summaryEn} /* 受控值 */
                  onChange={(event) => setForm({ ...form, summaryEn: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 英文简介字段结束 */}
            </div> {/* 第三行结束 */}
            <div className="row"> {/* 第四行：前置依赖 */}
              <label className="field"> {/* 依赖字段 */}
                <span>前置依赖模块码（逗号或空格分隔，选填）</span> {/* 字段标签含格式说明 */}
                <input
                  value={form.requires} /* 受控值 */
                  placeholder="如：comic.workbench, video.studio" /* 占位示例 */
                  onChange={(event) => setForm({ ...form, requires: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 依赖字段结束 */}
            </div> {/* 第四行结束 */}
            <div className="row"> {/* 提交操作行 */}
              <button className="btn primary" type="submit" disabled={formBusy || !canWrite}> {/* 提交按钮：在途或无权限禁用 */}
                {panel.mode === 'create' ? '创建（默认草稿）' : '保存修改'} {/* 按钮文案按模式切换 */}
              </button> {/* 提交按钮结束 */}
              <button className="btn" type="button" onClick={() => setPanel(null)}>取消</button> {/* 取消按钮 */}
            </div> {/* 提交操作行结束 */}
          </form> {/* 模块表单结束 */}
        </div> // 表单面板结束（回到 panel 三元的 JS 上下文）
      ) : null} {/* 面板关闭时不渲染 */}
      {priceTarget ? ( // 调价面板打开时渲染
        <div className="panel"> {/* 调价面板容器 */}
          <div className="panel-head"> {/* 面板标题行 */}
            <strong>调价：{priceTarget.code}</strong> {/* 面板标题带模块码 */}
            <button className="btn ghost" type="button" onClick={() => setPriceTarget(null)}>关闭</button> {/* 关闭按钮 */}
          </div> {/* 面板标题行结束 */}
          {priceError ? <div className="error">{priceError}</div> : null} {/* 价格表单错误提示 */}
          {detail.loading ? ( // 详情加载分支
            <div className="empty">加载价格历史…</div> // 加载态
          ) : detail.error ? ( // 详情失败分支
            <div className="error">{describeError(detail.error)}</div> // 失败态
          ) : ( // 详情就绪分支
            <table className="table"> {/* 历史价格表 */}
              <thead> {/* 表头 */}
                <tr> {/* 表头行 */}
                  <th>币种</th> {/* 币种列 */}
                  <th>金额</th> {/* 金额列 */}
                  <th>生效起始</th> {/* 起始列 */}
                  <th>生效结束</th> {/* 结束列 */}
                  <th>操作</th> {/* 操作列 */}
                </tr> {/* 表头行结束 */}
              </thead> {/* 表头结束 */}
              <tbody> {/* 表体 */}
                {priceRows.length === 0 ? ( // 无价格历史分支
                  <tr><td colSpan={5}><span className="muted">暂无价格行</span></td></tr> // 空态行
                ) : priceRows.map((price) => ( // 逐行渲染价格
                  <tr key={price.id}> {/* 行唯一键为价格行主键 */}
                    <td>{price.currency}</td> {/* 币种 */}
                    <td>{(price.amount_minor / 100).toFixed(2)}</td> {/* 分转元展示 */}
                    <td>{price.effective_from}</td> {/* 生效起始原值展示 */}
                    <td>{price.effective_to ?? '长期有效'}</td> {/* 结束时间，null 显示长期有效 */}
                    <td> {/* 操作单元格 */}
                      <button
                        className="btn ghost" /* 幽灵按钮 */
                        type="button" /* 普通按钮 */
                        disabled={!canWrite || priceBusy} /* 无权限或在途禁用 */
                        onClick={() => startPriceEdit(price)} /* 点击进入编辑模式 */
                      > {/* 按钮属性区收尾 */}
                        编辑 {/* 按钮文案 */}
                      </button> {/* 编辑按钮结束 */}
                      <button
                        className="btn ghost" /* 幽灵按钮 */
                        type="button" /* 普通按钮 */
                        disabled={!canWrite || busyKey === `price:${price.id}` || price.effective_to !== null} /* 已失效行禁止再次失效 */
                        onClick={() => void expirePrice(price.id)} /* 点击使该行立即失效；void 丢弃 Promise */
                      > {/* 按钮属性区收尾 */}
                        {price.effective_to !== null ? '已失效' : '失效'} {/* 文案按失效态切换 */}
                      </button> {/* 失效按钮结束 */}
                    </td> {/* 操作单元格结束 */}
                  </tr> // 价格行结束（回到 priceRows.map 回调的 JS 上下文）
                ))} {/* 价格行 map 收尾 */}
              </tbody> {/* 表体结束 */}
            </table> // 历史价格表结束（回到详情状态链式三元的 JS 上下文）
          )} {/* 详情分支收尾 */}
          <form className="form" onSubmit={submitPriceForm}> {/* 价格表单：新增/编辑共用 */}
            <div className="row"> {/* 表单行：币种 + 金额 + 起止时间 */}
              <label className="field"> {/* 币种字段 */}
                <span>币种</span> {/* 字段标签 */}
                <select
                  value={priceForm.currency} /* 受控选中值 */
                  onChange={(event) => setPriceForm({ ...priceForm, currency: event.target.value })} /* 同步选择 */
                > {/* 下拉框属性区收尾 */}
                  <option value="CNY">CNY</option> {/* 人民币选项 */}
                  <option value="USD">USD</option> {/* 美元选项 */}
                </select> {/* 下拉框结束 */}
              </label> {/* 币种字段结束 */}
              <label className="field"> {/* 金额字段 */}
                <span>金额（元，0 表示免费）</span> {/* 字段标签 */}
                <input
                  type="number" /* 数字输入 */
                  min={0} /* 非负约束 */
                  step="0.01" /* 两位小数步进 */
                  value={priceForm.amount} /* 受控值 */
                  onChange={(event) => setPriceForm({ ...priceForm, amount: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 金额字段结束 */}
              <label className="field"> {/* 生效起始字段 */}
                <span>生效起始（留空 = 立即生效）</span> {/* 字段标签 */}
                <input
                  type="datetime-local" /* 本地日期时间选择器 */
                  value={priceForm.effectiveFrom} /* 受控值 */
                  onChange={(event) => setPriceForm({ ...priceForm, effectiveFrom: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 起始字段结束 */}
              <label className="field"> {/* 生效结束字段 */}
                <span>生效结束（留空 = 长期有效）</span> {/* 字段标签 */}
                <input
                  type="datetime-local" /* 本地日期时间选择器 */
                  value={priceForm.effectiveTo} /* 受控值 */
                  onChange={(event) => setPriceForm({ ...priceForm, effectiveTo: event.target.value })} /* 同步输入 */
                /> {/* 输入框结束 */}
              </label> {/* 结束字段结束 */}
            </div> {/* 表单行结束 */}
            <div className="row"> {/* 提交操作行 */}
              <button className="btn primary" type="submit" disabled={priceBusy || !canWrite}> {/* 提交按钮：在途或无权限禁用 */}
                {priceEditingId ? '保存价格行' : '新增价格行'} {/* 文案按模式切换 */}
              </button> {/* 提交按钮结束 */}
              {priceEditingId ? ( // 编辑模式下提供取消编辑
                <button
                  className="btn" /* 次按钮 */
                  type="button" /* 普通按钮 */
                  onClick={() => { setPriceEditingId(null); setPriceForm(EMPTY_PRICE_FORM); }} /* 退出编辑模式并重置表单 */
                > {/* 按钮属性区收尾 */}
                  取消编辑 {/* 按钮文案 */}
                </button> // 取消编辑按钮结束（回到 priceEditingId 三元的 JS 上下文）
              ) : null} {/* 新增模式不渲染取消编辑 */}
            </div> {/* 提交操作行结束 */}
          </form> {/* 价格表单结束 */}
        </div> // 调价面板结束（回到 priceTarget 三元的 JS 上下文）
      ) : null} {/* 调价面板关闭时不渲染 */}
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
                <th>排序</th> {/* 排序权重列 */}
                <th>地区</th> {/* 地区列 */}
                <th>操作</th> {/* 操作列：迁移/编辑/调价/删除 */}
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
                    {row.module.requires.length > 0 ? ( // 有前置依赖时展示
                      <div className="hint">依赖：{row.module.requires.join('、')}</div> // 依赖码列表
                    ) : null} {/* 无依赖不渲染 */}
                  </td> {/* 模块单元格结束 */}
                  <td> {/* 状态单元格 */}
                    <span className={`badge ${row.module.status}`}> {/* 状态徽章：类名含状态以切换配色 */}
                      {STATUS_LABEL[row.module.status] ?? row.module.status} {/* 状态中文文案，未知枚举回退原始值 */}
                    </span> {/* 徽章结束 */}
                  </td> {/* 状态单元格结束 */}
                  <td>{row.module.unlock_mode}</td> {/* 解锁方式原值展示 */}
                  <td>{formatPrice(row.module.current_price)}</td> {/* 格式化价格，空值显示免费 */}
                  <td>{row.module.sort_order}</td> {/* 排序权重 */}
                  <td>{row.module.region}</td> {/* 地区码 */}
                  <td> {/* 操作单元格 */}
                    {row.action ? ( // 存在下一步状态时渲染迁移按钮
                      // 有下一步时渲染迁移按钮
                      <button
                        className="btn ghost" /* 幽灵按钮样式：弱化视觉层级 */
                        type="button" /* 显式声明普通按钮，避免表单上下文误提交 */
                        disabled={!canWrite || busyKey === `transition:${row.module.code}`} /* 无权限或本行迁移中时禁用 */
                        onClick={() => void runTransition(row.module, row.action!.next, row.action!.label)} /* 点击执行单向迁移；void 显式丢弃 Promise */
                      > {/* 按钮属性区收尾 */}
                        {row.action.label} {/* 按钮文案：上线 / 归档 */}
                      </button> // 迁移按钮结束（回到 row.action 三元的 JS 上下文）
                    ) : ( // 终态分支：无可执行动作
                      // 终态无可执行动作
                      <span className="muted">终态</span>
                    )} {/* 迁移分支收尾 */}
                    <button
                      className="btn ghost" /* 幽灵按钮 */
                      type="button" /* 普通按钮 */
                      disabled={!canWrite} /* 无权限禁用 */
                      onClick={() => openEdit(row.module)} /* 点击打开编辑面板 */
                    > {/* 按钮属性区收尾 */}
                      编辑 {/* 按钮文案 */}
                    </button> {/* 编辑按钮结束 */}
                    <button
                      className="btn ghost" /* 幽灵按钮 */
                      type="button" /* 普通按钮 */
                      disabled={!canWrite} /* 无权限禁用 */
                      onClick={() => openPrices(row.module)} /* 点击打开调价面板 */
                    > {/* 按钮属性区收尾 */}
                      调价 {/* 按钮文案 */}
                    </button> {/* 调价按钮结束 */}
                    <button
                      className="btn danger" /* 危险按钮：红色文字 */
                      type="button" /* 普通按钮 */
                      disabled={!canWrite || busyKey === `delete:${row.module.code}`} /* 无权限或删除在途禁用 */
                      onClick={() => void removeModule(row.module)} /* 点击进入二次确认或执行删除 */
                    > {/* 按钮属性区收尾 */}
                      {row.armed ? '确认删除' : '删除'} {/* 武装后文案切换为确认删除 */}
                    </button> {/* 删除按钮结束 */}
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
