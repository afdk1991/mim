// 外观设置页：主色 / 圆角档位 / 暗色开关，复用 appearance:write 与 PUT /appearance/settings
import { useEffect, useState } from 'react'; // 本地状态与首次加载
import { describeError } from '../api'; // 统一错误描述
import type { Credential } from '../api'; // 请求凭证
import { getAppearanceOverview, saveAppearanceSetting } from '../api-ops'; // 外观读取与保存

/** 圆角档位：值对应 --theme-radius 的 px 数，固定档位避免运营填入不可控数值 */
const RADIUS_STEPS = [
  { value: 0, label: '0 · 直角' }, // 无圆角
  { value: 4, label: '4 · 微圆' }, // 紧凑控件
  { value: 8, label: '8 · 小圆' }, // 列表与输入框
  { value: 12, label: '12 · 标准' }, // 令牌默认值
  { value: 16, label: '16 · 中圆' }, // 卡片更柔和
  { value: 20, label: '20 · 大圆' }, // 强视觉风格
  { value: 24, label: '24 · 超大圆' }, // 极简风上限
]; // RADIUS_STEPS 结束

/** 主题对象的最小结构：其余字段原样保留，保存时不覆盖 */
interface ThemeDraft {
  accent: string; // 主色 hex
  background: string; // 页面底色 hex
  radius: number; // 圆角 px
  mode: 'light' | 'dark'; // 站点默认明暗
} // ThemeDraft 结束

/** 从任意 JSON 中安全取出主题草稿；缺失字段回落到令牌默认值 */
function toDraft(raw: unknown): ThemeDraft {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}; // 只接受对象
  return {
    accent: typeof source.accent === 'string' ? source.accent : '#3b6ef5', // 令牌主色
    background: typeof source.background === 'string' ? source.background : '#f5f6f7', // 令牌底色
    radius: typeof source.radius === 'number' && Number.isFinite(source.radius) ? source.radius : 12, // 令牌圆角
    mode: source.mode === 'dark' ? 'dark' : 'light', // 缺省浅色
  }; // 返回草稿
} // toDraft 结束

/** 外观页入参 */
interface Props {
  credential: Credential; // 凭证
  permissions: string[]; // 当前身份权限码
} // Props 结束

/** 外观设置页：只改 theme 键中的主色 / 圆角 / 明暗，其余字段与设置键原样保留 */
export function Appearance({ credential, permissions }: Props) {
  const canWrite = permissions.includes('appearance:write'); // 写权限决定按钮可用性
  const [draft, setDraft] = useState<ThemeDraft | null>(null); // 编辑草稿：加载完成前为 null
  const [others, setOthers] = useState<Record<string, unknown>>({}); // theme 中非本页管理的字段，保存时合并
  const [loading, setLoading] = useState(true); // 首次加载中
  const [busy, setBusy] = useState(false); // 保存中
  const [error, setError] = useState<string | null>(null); // 错误提示
  const [notice, setNotice] = useState<string | null>(null); // 成功提示

  useEffect(() => {
    let cancelled = false; // 卸载后丢弃异步结果
    setLoading(true); // 进入加载态
    getAppearanceOverview(credential)
      .then((data) => {
        if (cancelled) return; // 已卸载不写入状态
        const theme = data.settings.theme; // 取 theme 设置
        setDraft(toDraft(theme)); // 主色 / 圆角 / 明暗
        const rest = theme && typeof theme === 'object' ? { ...(theme as Record<string, unknown>) } : {}; // 复制原对象
        delete rest.accent; // 交给本页字段
        delete rest.background; // 交给本页字段
        delete rest.radius; // 交给本页字段
        delete rest.mode; // 交给本页字段
        setOthers(rest); // 保留导航布局 / 列表样式 / 字体等
        setError(null); // 成功后清错误
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err)); // 展示失败原因
      })
      .finally(() => {
        if (!cancelled) setLoading(false); // 结束加载态
      });
    return () => {
      cancelled = true; // 标记过期
    }; // 清理函数结束
  }, [credential]); // 凭证变化时重新加载

  /** 保存：合并 others，避免覆盖运营在别处调过的导航 / 列表 / 字体 */
  async function save() {
    if (!draft) return; // 未加载完不保存
    setBusy(true); // 防重复点击
    setNotice(null); // 清上一条成功提示
    try {
      await saveAppearanceSetting(credential, 'theme', {
        ...others, // 未在本页暴露的字段原样带回
        accent: draft.accent, // 主色
        background: draft.background, // 底色
        radius: draft.radius, // 圆角档位
        mode: draft.mode, // 站点默认明暗
      });
      setNotice('外观已保存，前台刷新后生效'); // 成功提示
      setError(null); // 清错误
    } catch (err) {
      setError(describeError(err)); // 展示失败原因
    } finally {
      setBusy(false); // 恢复按钮
    }
  } // save 结束

  if (loading) return <div className="page"><p className="hint">正在读取外观配置…</p></div>; // 首屏占位
  if (!draft) return <div className="page"><p className="error">{error ?? '外观配置读取失败'}</p></div>; // 加载失败

  const radiusOptions = RADIUS_STEPS.some((item) => item.value === draft.radius) // 存量库里可能是非档位值
    ? RADIUS_STEPS // 命中档位直接使用
    : [...RADIUS_STEPS, { value: draft.radius, label: `${draft.radius} · 当前值` }]; // 非档位值时补一条，避免下拉显示空白

  return (
    <div className="page">
      <header className="page-head">
        <h1>外观</h1>
        <p className="page-desc">调整站点主色、圆角与默认明暗；保存后前台刷新即生效，访客仍可自行切换明暗。</p>
      </header>
      {!canWrite ? <div className="panel error">当前账号缺少 appearance:write 权限，只能查看不能保存。</div> : null}
      {error ? <div className="panel error">{error}</div> : null}
      {notice ? <div className="panel hint">{notice}</div> : null}

      <section className="panel">
        <div className="panel-head">
          <h3>主题</h3>
          <button className="btn primary" type="button" disabled={busy || !canWrite} onClick={() => void save()}>
            {busy ? '保存中…' : '保存外观'}
          </button>
        </div>
        <div className="row">
          <label className="field">
            <span>主色</span>
            <input
              type="color"
              value={draft.accent}
              disabled={busy || !canWrite}
              onChange={(event) => setDraft({ ...draft, accent: event.target.value })}
            />
          </label>
          <label className="field">
            <span>页面底色</span>
            <input
              type="color"
              value={draft.background}
              disabled={busy || !canWrite}
              onChange={(event) => setDraft({ ...draft, background: event.target.value })}
            />
          </label>
          <label className="field">
            <span>圆角档位</span>
            <select
              value={draft.radius}
              disabled={busy || !canWrite}
              onChange={(event) => setDraft({ ...draft, radius: Number(event.target.value) })}
            >
              {radiusOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>默认明暗</span>
            <select
              value={draft.mode}
              disabled={busy || !canWrite}
              onChange={(event) => setDraft({ ...draft, mode: event.target.value === 'dark' ? 'dark' : 'light' })}
            >
              <option value="light">浅色</option>
              <option value="dark">暗色</option>
            </select>
          </label>
        </div>
        <p className="hint">主色与圆角写入令牌的 --theme-* 输入变量；导航布局、列表样式、字体等未在此页展示的项会原样保留。</p>
        <div className="row">
          <span className="badge" style={{ background: draft.accent, color: 'var(--on-primary)' }}>主色预览</span>
          <span className="badge" style={{ background: 'var(--surface)', borderRadius: draft.radius }}>圆角预览</span>
          <span className="muted">当前：{draft.accent} · {draft.radius}px · {draft.mode === 'dark' ? '暗色' : '浅色'}</span>
        </div>
      </section>
    </div>
  );
} // Appearance 结束
