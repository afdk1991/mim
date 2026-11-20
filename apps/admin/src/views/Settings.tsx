// 设置：站点名称、副标题与页脚文案（复用 site_settings 的 site 键）
// 引入 React 钩子：useEffect 在数据到达后同步表单，useState 维护表单与提示状态
import { useEffect, useState } from 'react';
// 引入错误文案翻译器：把后端错误对象翻译成界面可读提示
import { describeError } from '../api';
// 引入凭证类型：约束组件入参的会话凭证结构
import type { Credential } from '../api';
// 引入外观概览读取与设置保存接口
import { getAppearanceOverview, saveAppearanceSetting } from '../api-ops';
// 引入异步数据钩子：封装加载中 / 错误 / 数据三态请求编排
import { useAsync } from '../hooks';

/** 入参：凭证与实时权限码 */
interface Props {
  // 当前会话凭证：随接口请求带上鉴权信息
  credential: Credential;
  // 实时权限码列表：据此判断是否可写站点设置
  permissions: string[];
}

/** 站点设置在 site_settings.site 里的已知字段 */
interface SiteFields {
  // 站点主名：展示在前台页头与浏览器标题
  title: string;
  // 站点副标题：跟在主名下方的一句话介绍
  subtitle: string;
  // 页脚文案：展示在前台全站页脚
  footer: string;
}

/** 从设置对象中取出站点三字段，缺失回落空串（保存时保留其余未知键） */
function pickSite(raw: unknown): SiteFields {
  // 归一化原始值：非对象时按空记录处理，避免读取 undefined 抛错
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  // 逐字段取字符串值，类型不符或缺字段统一回落空串
  return {
    title: typeof source.title === 'string' ? source.title : '',
    subtitle: typeof source.subtitle === 'string' ? source.subtitle : '',
    footer: typeof source.footer === 'string' ? source.footer : '',
  };
}

/** 设置主视图 */
export function Settings({ credential, permissions }: Props) {
  // 写权限判定：缺少 appearance:write 时表单禁用、不显示保存按钮
  const canWrite = permissions.includes('appearance:write');
  // 异步拉取站点外观概览：凭证变化时重新请求
  const state = useAsync(() => getAppearanceOverview(credential), [credential]);
  // 表单三字段状态：初始空串，数据到达后由 effect 回填
  const [form, setForm] = useState<SiteFields>({ title: '', subtitle: '', footer: '' });
  // 提交进行中标记：保存期间禁用按钮，避免重复点击
  const [busy, setBusy] = useState(false);
  // 成功提示文案：保存成功后展示，空串表示无提示
  const [notice, setNotice] = useState('');
  // 错误提示文案：校验或保存失败时展示，空串表示无错误
  const [error, setError] = useState('');

  // 数据到达后同步表单；只依赖 settings.site，避免编辑中被无谓重置
  const siteRaw = state.data?.settings.site;
  useEffect(() => {
    // 原始字段尚未返回时不回填，等待下一次数据到达
    if (siteRaw === undefined) return;
    // 把后端原始对象归一化为表单三字段
    setForm(pickSite(siteRaw));
  }, [siteRaw]);

  /** 保存：合并原对象，保留未知字段 */
  async function submit() {
    // 主名为必填：去空白后为空则拦截并提示，不发起请求
    if (!form.title.trim()) {
      setError('站点主名不能为空');
      return;
    }
    // 进入提交态：关闭旧提示，避免成功失败文案叠加
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // 保留原对象中的未知键，仅覆盖表单三字段，避免清掉其它配置
      const origin = siteRaw && typeof siteRaw === 'object' ? (siteRaw as Record<string, unknown>) : {};
      // 调保存接口：写回 site_settings.site 整对象合并结果
      await saveAppearanceSetting(credential, 'site', { ...origin, ...form });
      // 保存成功：展示成功提示并重新拉取概览刷新界面
      setNotice('站点设置已保存');
      state.reload();
    } catch (err) {
      // 失败：翻译错误文案展示，提交态在 finally 中复位
      setError(describeError(err));
    } finally {
      // 无论成败都退出提交态，恢复按钮可点
      setBusy(false);
    }
  }

  return (
    <div className="page">
      {/* 页头：标题与用途说明 */}
      <header className="page-head">
        <h1>设置</h1>
        <p className="page-desc">这里维护站点主名、副标题与页脚文案，保存后前台页头、浏览器标题与页脚会同步更新。</p>
      </header>

      {/* 只读权限提示：无写权限时提示无法保存 */}
      {!canWrite ? <div className="hint">当前身份只有只读权限，无法保存设置。</div> : null}
      {/* 成功提示条：保存成功后展示 */}
      {notice ? <div className="success">{notice}</div> : null}
      {/* 错误提示条：校验或请求失败时展示 */}
      {error ? <div className="error">{error}</div> : null}

      <div className="panel">
        {/* 面板头：标题与落库位置说明 */}
        <div className="panel-head">
          <h3>站点信息</h3>
          <span className="muted">写入 site_settings.site</span>
        </div>

        {/* 加载中占位：概览数据未返回前展示 */}
        {state.loading ? <p className="muted">加载中…</p> : null}
        {/* 概览读取失败提示 */}
        {state.error ? <div className="error">{describeError(state.error)}</div> : null}

        <div className="form">
          {/* 字段：站点主名，只读权限下禁用输入 */}
          <label className="field">
            <span>站点主名</span>
            <input
              value={form.title}
              disabled={!canWrite}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </label>
          {/* 字段：副标题，只读权限下禁用输入 */}
          <label className="field">
            <span>副标题</span>
            <input
              value={form.subtitle}
              disabled={!canWrite}
              onChange={(event) => setForm((prev) => ({ ...prev, subtitle: event.target.value }))}
            />
          </label>
          {/* 字段：页脚文案，只读权限下禁用输入 */}
          <label className="field">
            <span>页脚文案</span>
            <input
              value={form.footer}
              disabled={!canWrite}
              onChange={(event) => setForm((prev) => ({ ...prev, footer: event.target.value }))}
            />
          </label>
          {/* 保存按钮：仅写权限可见；提交中禁用并切换文案 */}
          {canWrite ? (
            <button className="btn primary" type="button" disabled={busy} onClick={submit}>
              {busy ? '保存中…' : '保存设置'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
