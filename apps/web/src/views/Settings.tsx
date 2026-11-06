// 引入 useEffect / useState：进入页面时回填表单，并维护保存与注销的中间态
import { useEffect, useState } from 'react';
// 引入 FormEvent 类型：为表单提交处理函数的入参做类型标注
import type { FormEvent } from 'react';
// 引入 t 函数：按当前 locale 取 i18n 文案
import { t } from '@mim/i18n';
// 引入 Locale 类型：约束语言取值为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// 引入接口客户端与错误文案翻译器
import { api, errorText } from '../api';
// 引入用户信息类型：保存成功后回传给上层刷新用户态
import type { UserInfo } from '../api';
// 引入通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';

// 组件对外契约：语言来自全局，用户更新后需通知上层
interface Props {
  // 当前界面语言，用于取文案
  locale: Locale;
  // 回调：把更新后的用户信息同步给 App，保持头部显示一致
  onUserUpdated: (user: UserInfo) => void;
}

// 设置页组件：维护账号资料、区域信息与注销申请
export function Settings({ locale, onUserUpdated }: Props) {
  // 拉取当前登录用户资料；依赖数组为空表示仅在挂载时请求一次
  const state = useAsync(() => api.me(), []);
  // 昵称编辑值，进入页面后由接口数据回填
  const [displayName, setDisplayName] = useState('');
  // 语言偏好编辑值，默认简体中文，回填时按后端值收敛为两种合法值
  const [localeValue, setLocaleValue] = useState<Locale>('zh-CN');
  // 时区编辑值，例如 Asia/Shanghai，交给后端校验
  const [timezone, setTimezone] = useState('');
  // 请求进行中标记：禁用按钮，避免重复保存或重复申请
  const [busy, setBusy] = useState(false);
  // 错误提示：提交失败时展示，null 表示无错误
  const [error, setError] = useState<string | null>(null);
  // 成功提示：保存或申请成功后展示，null 表示无提示
  const [message, setMessage] = useState<string | null>(null);

  // 接口返回的聚合数据（含 user 与其它账户信息），未加载完成时为 undefined
  const loaded = state.data;

  // 数据到达后把后端值同步到表单，避免用户看到空白输入框
  useEffect(() => {
    // 还没拿到数据时不做回填，保持初始值
    if (!loaded) return;
    // 回填昵称
    setDisplayName(loaded.user.display_name);
    // 回填语言：仅接受 en-US，其它取值一律收敛为 zh-CN
    setLocaleValue(loaded.user.locale === 'en-US' ? 'en-US' : 'zh-CN');
    // 回填时区
    setTimezone(loaded.user.timezone);
    // 依赖 loaded：数据变化（如注销后 reload）时重新回填
  }, [loaded]);

  // 保存账号资料：提交昵称、语言、时区三项
  async function save(event: FormEvent) {
    // 阻止表单默认提交导致的整页刷新
    event.preventDefault();
    // 标记请求中，按钮进入禁用态
    setBusy(true);
    // 提交前清空旧错误
    setError(null);
    // 提交前清空旧成功提示，保证提示只反映本次操作
    setMessage(null);
    try {
      // 调用更新接口；三项文本均 trim 去掉首尾空格
      const result = await api.updateMe({
        // 昵称
        display_name: displayName.trim(),
        // 语言偏好
        locale: localeValue,
        // 时区标识
        timezone: timezone.trim(),
      });
      // 把后端返回的最新用户信息同步给上层，刷新全局展示
      onUserUpdated(result.user);
      // 展示保存成功提示（勾号表示成功）
      setMessage(`${t(locale, 'settings.save')} ✓`);
    } catch (err) {
      // 保存失败时翻译并展示错误原因
      setError(errorText(locale, err));
    } finally {
      // 解除按钮禁用
      setBusy(false);
    }
  }

  // 申请注销账号：属于不可逆操作，先二次确认再发请求
  async function requestDeletion() {
    // 浏览器原生确认框，用户取消则直接返回不发送请求
    if (!window.confirm(t(locale, 'settings.requestDeletion'))) return;
    // 标记请求中，按钮禁用
    setBusy(true);
    // 清空旧错误
    setError(null);
    // 清空旧成功提示
    setMessage(null);
    try {
      // 调用注销申请接口；后端通常写入一个待执行时间点
      await api.requestDeletion();
      // 展示申请成功提示
      setMessage(`${t(locale, 'settings.requestDeletion')} ✓`);
      // 重新拉取用户资料，让 pending 状态（deletion_scheduled_at）立即生效
      state.reload();
    } catch (err) {
      // 申请失败时展示错误原因
      setError(errorText(locale, err));
    } finally {
      // 解除按钮禁用
      setBusy(false);
    }
  }

  // 撤销注销申请：把待执行的删除任务取消
  async function cancelDeletion() {
    // 标记请求中，按钮禁用
    setBusy(true);
    // 清空旧错误
    setError(null);
    // 清空旧成功提示
    setMessage(null);
    try {
      // 调用撤销接口，清除待执行的注销时间点
      await api.cancelDeletion();
      // 展示撤销成功提示
      setMessage(`${t(locale, 'settings.cancelDeletion')} ✓`);
      // 重新拉取用户资料，让 pending 状态回落为非注销
      state.reload();
    } catch (err) {
      // 撤销失败时展示错误原因
      setError(errorText(locale, err));
    } finally {
      // 解除按钮禁用
      setBusy(false);
    }
  }

  // 首屏加载态：只渲染一行加载提示，避免出现空表单
  if (state.loading) return <div className="hint">{t(locale, 'common.loading')}</div>;
  // 加载失败或数据缺失：统一渲染错误文案，不展示表单
  if (state.error || !state.data) {
    // 错误容器：errorText 负责把异常转成当前语言文案
    return <div className="error">{errorText(locale, state.error)}</div>;
  }

  // 此处起数据一定存在，取别名简化后续访问
  const me = state.data;
  // 是否处于「已申请注销」状态：有待执行时间点即视为 pending
  const pending = me.user.deletion_scheduled_at != null;

  // 渲染设置页主体
  return (
    // 页面容器：统一页面留白与最大宽度
    <div className="page">
      <header className="page-head">{/* 页头：仅一个标题 */}
        <h1>{t(locale, 'nav.settings')}</h1>{/* 标题文案，走 i18n「设置」 */}
      </header>{/* 结束页头 */}

      {error && <p className="error">{error}</p>}{/* 全局错误提示：操作失败时出现 */}
      {message && <p className="success">{message}</p>}{/* 全局成功提示：保存或申请成功后出现 */}
      {pending && ( // 注销待执行提醒：仅在 pending 为真时展示
        <p className="warning">{/* 警告样式提示行 */}
          {t(locale, 'settings.deletionPending')}: {me.user.deletion_scheduled_at?.slice(0, 10)}{/* 提醒文案 + 计划删除日期（YYYY-MM-DD） */}
        </p> // 结束注销提醒行
      )}{/* 结束注销提醒条件渲染 */}

      <div className="split">{/* 双栏布局：左侧资料编辑，右侧区域与注销 */}
        <section className="panel">{/* 左栏：账号资料编辑面板 */}
          <header className="panel-head">{/* 面板标题栏 */}
            <h2>{t(locale, 'settings.account')}</h2>{/* 面板标题：账号 */}
          </header>{/* 结束面板标题栏 */}
          <form className="form" onSubmit={save}>{/* 资料表单：提交交给 save 处理 */}
            <label>{/* 昵称输入项 */}
              <span>{t(locale, 'settings.displayName')}</span>{/* 昵称标题文案 */}
              <input
                // 受控值绑定 displayName
                value={displayName}
                // 每次输入同步回状态
                onChange={(event) => setDisplayName(event.target.value)}
                // 与后端字段长度上限保持一致，避免提交后被拒
                maxLength={40}
              />{/* 昵称输入框结束 */}
            </label>{/* 结束昵称输入项 */}
            <label>{/* 语言偏好选择项 */}
              <span>{t(locale, 'settings.locale')}</span>{/* 语言标题文案 */}
              <select
                // 受控值绑定 localeValue
                value={localeValue}
                // 选中值断言为 Locale，因为选项只有两个合法值
                onChange={(event) => setLocaleValue(event.target.value as Locale)}
              >{/* 语言下拉框开标签 */}
                <option value="zh-CN">中文</option>{/* 简体中文选项 */}
                <option value="en-US">English</option>{/* 英文选项 */}
              </select>{/* 语言下拉框结束 */}
            </label>{/* 结束语言选择项 */}
            <label>{/* 时区输入项 */}
              <span>{t(locale, 'settings.timezone')}</span>{/* 时区标题文案 */}
              <input
                // 受控值绑定 timezone
                value={timezone}
                // 每次输入同步回状态
                onChange={(event) => setTimezone(event.target.value)}
                // 占位示例：中国标准时区
                placeholder="Asia/Shanghai"
              />{/* 时区输入框结束 */}
            </label>{/* 结束时区输入项 */}
            <button type="submit" className="btn primary" disabled={busy}>{/* 保存按钮：请求中禁用，防重复提交 */}
              {t(locale, 'settings.save')}{/* 按钮文案：保存 */}
            </button>{/* 结束保存按钮 */}
          </form>{/* 结束资料表单 */}
        </section>{/* 结束左栏面板 */}

        <section className="panel">{/* 右栏：区域信息 + 注销操作面板 */}
          <header className="panel-head">{/* 区域信息标题栏 */}
            <h2>{t(locale, 'settings.regionInfo')}</h2>{/* 面板标题：区域信息 */}
          </header>{/* 结束区域信息标题栏 */}
          <ul className="plain-list">{/* 区域信息列表 */}
            <li>{/* 单行：区域名称 + 区域徽标 */}
              <span>{t(locale, 'settings.region')}</span>{/* 行标题文案 */}
              <span className="badge">{me.user.region === 'cn' ? '中国区' : 'Global'}</span>{/* 区域徽标：cn 为中国区，其余为 Global */}
            </li>{/* 结束区域信息行 */}
          </ul>{/* 结束区域信息列表 */}

          <header className="panel-head">{/* 同一面板内的注销区块标题栏 */}
            <h2>{t(locale, 'settings.deletion')}</h2>{/* 区块标题：注销账号 */}
          </header>{/* 结束注销标题栏 */}
          <p className="muted">{t(locale, 'settings.deletionTip')}</p>{/* 注销说明：解释计划删除时间 */}
          {pending ? ( // 按是否已申请注销切换操作按钮
            <button type="button" className="btn ghost" onClick={cancelDeletion} disabled={busy}>{/* 已申请：提供撤销入口 */}
              {t(locale, 'settings.cancelDeletion')}{/* 按钮文案：取消注销 */}
            </button> // 结束取消注销按钮
          ) : (
            <button type="button" className="btn danger" onClick={requestDeletion} disabled={busy}>{/* 未申请：危险样式的注销入口 */}
              {t(locale, 'settings.requestDeletion')}{/* 按钮文案：申请注销 */}
            </button> // 结束申请注销按钮
          )}{/* 结束注销按钮条件渲染 */}
        </section>{/* 结束右栏面板 */}
      </div>{/* 结束双栏布局 */}
    </div>
    // 设置页渲染结束，返回 JSX 元素
  );
}
