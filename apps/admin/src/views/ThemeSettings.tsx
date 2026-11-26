// 主题设置面板：对齐 zibll 子比主题设置面板形态 —— 左侧分组导航 + 右侧设置面板，
// 开关 / 下拉 / 颜色 / 数值 / 文本 / 图片上传全部在同一屏内完成，不再跳转到多个独立页面。
// 数据来源有三处且都是既有后端配置：
//   ① site_settings.site（站点名 / 副标题 / 页脚）；② site_settings.theme（主色 / 底色 / 圆角 / 明暗）；
//   ③ site_settings.options（注册表驱动的全站选项，含本批新增的注册与登录、商城与付费开关）。
import { useEffect, useMemo, useState } from 'react'; // 本地状态与首载
import { describeError } from '../api'; // 统一错误描述
import type { Credential } from '../api'; // 请求凭证
import { getAppearanceOverview, saveAppearanceSetting } from '../api-ops'; // 站点信息与主题读写
import { getSiteOptions, resetSiteOptions, saveSiteOptions, uploadSiteImage } from '../api-site-options'; // 站点选项读写与图片上传
import type { OptionField, OptionGroup, OptionValue, OptionValues } from '../api-site-options'; // 选项结构与取值类型

/** 控件类型：在注册表六种类型之外补一个 color（主色 / 底色用原生取色器） */
type PanelFieldType = 'switch' | 'text' | 'textarea' | 'number' | 'select' | 'url' | 'color';

/** 字段来源：决定保存时走哪个接口 */
type GroupSource = 'site' | 'theme' | 'options';

/** 面板字段：把三处数据源的字段统一成同一结构，右侧面板只认这一种 */
interface PanelField {
  key: string; // 字段键：options 用注册表键，site / theme 用原对象属性名
  label: string; // 展示名
  type: PanelFieldType; // 控件类型
  defaultValue: OptionValue; // 默认值：恢复默认时使用
  hint?: string; // 说明文案
  options?: Array<{ value: string; label: string }>; // 下拉候选项
  min?: number; // 数值下界
  max?: number; // 数值上界
} // PanelField 结束

/** 面板分组：左侧导航的一项 */
interface PanelGroup {
  key: string; // 分组键（唯一）
  label: string; // 分组名
  description: string; // 分组说明
  source: GroupSource; // 数据来源
  fields: PanelField[]; // 字段清单
} // PanelGroup 结束

/** 站点信息三字段：与 site_settings.site 的既有键一一对应 */
interface SiteFields {
  title: string; // 站点主名
  subtitle: string; // 副标题
  footer: string; // 页脚文案
} // SiteFields 结束

/** 主题四字段：与 site_settings.theme 的既有键一一对应 */
interface ThemeFields {
  accent: string; // 主色
  background: string; // 页面底色
  radius: number; // 圆角 px
  mode: string; // 默认明暗
} // ThemeFields 结束

/** 圆角档位：与「外观」页保持同一套档位，避免运营填出不可控数值 */
const RADIUS_OPTIONS = [
  { value: '0', label: '0 · 直角' }, // 无圆角
  { value: '4', label: '4 · 微圆' }, // 紧凑控件
  { value: '8', label: '8 · 小圆' }, // 列表与输入框
  { value: '12', label: '12 · 标准' }, // 令牌默认值
  { value: '16', label: '16 · 中圆' }, // 卡片更柔和
  { value: '20', label: '20 · 大圆' }, // 强视觉风格
  { value: '24', label: '24 · 超大圆' }, // 极简风上限
]; // RADIUS_OPTIONS 结束

/** 站点信息分组：固定三项，不依赖后端注册表 */
const SITE_GROUP: PanelGroup = {
  key: 'site', // 分组键
  label: '站点信息', // 对应 zibll「全局 & 功能 → 站点信息」
  description: '站点主名、副标题与页脚版权文案；保存后前台页头、浏览器标题与页脚同步更新。', // 用途说明
  source: 'site', // 写入 site_settings.site
  fields: [
    { key: 'title', label: '站点主名', type: 'text', defaultValue: '', hint: '展示在前台页头与浏览器标题，不能为空' }, // 主名
    { key: 'subtitle', label: '副标题', type: 'text', defaultValue: '', hint: '跟在主名下方的一句话介绍' }, // 副标题
    { key: 'footer', label: '页脚文案', type: 'text', defaultValue: '', hint: '全站页脚版权行' }, // 页脚
  ], // 字段结束
}; // SITE_GROUP 结束

/** 外观分组：主色 / 底色 / 圆角 / 明暗，写入令牌输入变量 */
const THEME_GROUP: PanelGroup = {
  key: 'theme', // 分组键
  label: '外观与配色', // 对应 zibll「全局 & 功能 → 显示 & 布局」中的配色部分
  description: '主色与圆角写入 --theme-* 输入变量，前台刷新后生效；访客仍可自行切换明暗。', // 用途说明
  source: 'theme', // 写入 site_settings.theme
  fields: [
    { key: 'accent', label: '主色', type: 'color', defaultValue: '#3b6ef5', hint: '品牌蓝派生全套色阶，改动后全站按钮 / 链接 / 徽标同步' }, // 主色
    { key: 'background', label: '页面底色', type: 'color', defaultValue: '#f5f6f7', hint: '浅色模式下的页面背景' }, // 底色
    { key: 'radius', label: '圆角档位', type: 'select', defaultValue: 12, options: RADIUS_OPTIONS, hint: '卡片与面板的主圆角' }, // 圆角
    { key: 'mode', label: '默认明暗', type: 'select', defaultValue: 'light', options: [{ value: 'light', label: '浅色' }, { value: 'dark', label: '暗色' }], hint: '首次访问的默认模式' }, // 明暗
  ], // 字段结束
}; // THEME_GROUP 结束

/** 注册表分组 → 面板分组：只做结构映射，字段定义仍以服务端注册表为唯一真源 */
function toPanelGroup(group: OptionGroup): PanelGroup {
  return {
    key: `options:${group.key}`, // 前缀避免与 site / theme 撞键
    label: group.label, // 组名沿用注册表
    description: group.description ?? '保存后立即生效', // 无说明时给一句兜底
    source: 'options', // 走站点选项接口
    fields: group.fields.map((field: OptionField): PanelField => ({
      key: field.key, // 注册表键
      label: field.label, // 展示名
      type: field.type, // 控件类型
      defaultValue: field.defaultValue, // 默认值
      hint: field.hint, // 说明
      options: field.options, // 下拉候选项
      min: field.min, // 下界
      max: field.max, // 上界
    })), // 映射结束
  }; // 返回面板分组
} // toPanelGroup 结束

/** 图片类 url 字段：键名含 icon / logo / image 的一律按图片处理，给预览与上传按钮 */
function isImageField(field: PanelField): boolean {
  return field.type === 'url' && /icon|logo|image|cover/i.test(field.key); // 只有图片字段才显示上传
} // isImageField 结束

/** 面板入参 */
interface Props {
  credential: Credential; // 凭证
  permissions: string[]; // 实时权限码
} // Props 结束

/** 主题设置面板主视图 */
export function ThemeSettings({ credential, permissions }: Props) {
  const canWrite = permissions.includes('appearance:write'); // 统一复用外观写权限
  const [groups, setGroups] = useState<PanelGroup[]>([]); // 左侧分组（站点 / 外观 / 注册表）
  const [active, setActive] = useState<string>('site'); // 当前分组
  const [optionValues, setOptionValues] = useState<OptionValues>({}); // 选项草稿
  const [optionBaseline, setOptionBaseline] = useState<OptionValues>({}); // 选项已保存值
  const [site, setSite] = useState<SiteFields>({ title: '', subtitle: '', footer: '' }); // 站点信息草稿
  const [siteBaseline, setSiteBaseline] = useState<SiteFields>({ title: '', subtitle: '', footer: '' }); // 站点信息已保存值
  const [theme, setTheme] = useState<ThemeFields>({ accent: '#3b6ef5', background: '#f5f6f7', radius: 12, mode: 'light' }); // 主题草稿
  const [themeBaseline, setThemeBaseline] = useState<ThemeFields>({ accent: '#3b6ef5', background: '#f5f6f7', radius: 12, mode: 'light' }); // 主题已保存值
  const [themeOthers, setThemeOthers] = useState<Record<string, unknown>>({}); // theme 中本面板不管的字段，保存时原样带回
  const [siteOrigin, setSiteOrigin] = useState<Record<string, unknown>>({}); // site 中本面板不管的字段
  const [loading, setLoading] = useState(true); // 首载中
  const [busy, setBusy] = useState(false); // 保存 / 重置 / 上传中
  const [error, setError] = useState<string | null>(null); // 错误文案
  const [notice, setNotice] = useState<string | null>(null); // 成功提示
  const [updatedAt, setUpdatedAt] = useState<string | null>(null); // 选项最后保存时间

  useEffect(() => {
    let cancelled = false; // 卸载后丢弃异步结果
    setLoading(true); // 进入加载态
    Promise.all([getSiteOptions(credential), getAppearanceOverview(credential)]) // 三处配置并行拉取
      .then(([options, appearance]) => {
        if (cancelled) return; // 已卸载不写状态
        const siteRaw = appearance.settings.site; // 站点信息原对象
        const themeRaw = appearance.settings.theme; // 主题原对象
        const siteObj = siteRaw && typeof siteRaw === 'object' ? { ...(siteRaw as Record<string, unknown>) } : {}; // 复制站点对象
        const themeObj = themeRaw && typeof themeRaw === 'object' ? { ...(themeRaw as Record<string, unknown>) } : {}; // 复制主题对象
        const nextSite: SiteFields = {
          title: typeof siteObj.title === 'string' ? siteObj.title : '', // 主名
          subtitle: typeof siteObj.subtitle === 'string' ? siteObj.subtitle : '', // 副标题
          footer: typeof siteObj.footer === 'string' ? siteObj.footer : '', // 页脚
        }; // 站点草稿结束
        const nextTheme: ThemeFields = {
          accent: typeof themeObj.accent === 'string' ? themeObj.accent : '#3b6ef5', // 主色
          background: typeof themeObj.background === 'string' ? themeObj.background : '#f5f6f7', // 底色
          radius: typeof themeObj.radius === 'number' && Number.isFinite(themeObj.radius) ? themeObj.radius : 12, // 圆角
          mode: themeObj.mode === 'dark' ? 'dark' : 'light', // 明暗
        }; // 主题草稿结束
        delete siteObj.title; // 主名交给面板
        delete siteObj.subtitle; // 副标题交给面板
        delete siteObj.footer; // 页脚交给面板
        delete themeObj.accent; // 主色交给面板
        delete themeObj.background; // 底色交给面板
        delete themeObj.radius; // 圆角交给面板
        delete themeObj.mode; // 明暗交给面板
        setSiteOrigin(siteObj); // 保留站点其余键
        setThemeOthers(themeObj); // 保留主题其余键
        setSite(nextSite); // 站点草稿
        setSiteBaseline(nextSite); // 站点基准
        setTheme(nextTheme); // 主题草稿
        setThemeBaseline(nextTheme); // 主题基准
        setOptionValues(options.values); // 选项草稿
        setOptionBaseline(options.values); // 选项基准
        setUpdatedAt(options.updated_at); // 最后保存时间
        setGroups([SITE_GROUP, THEME_GROUP, ...options.tabs.flatMap((tab) => tab.groups.map(toPanelGroup))]); // 站点 + 外观 + 注册表全部组
        setError(null); // 清错误
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err)); // 展示失败原因
      })
      .finally(() => {
        if (!cancelled) setLoading(false); // 结束加载态
      });
    return () => {
      cancelled = true; // 标记过期
    }; // 清理结束
  }, [credential]); // 凭证变化重新加载

  // 当前分组：找不到时回落到第一组；调用处已保证 groups 非空，故类型收窄为非空
  const current = useMemo<PanelGroup>(() => groups.find((group) => group.key === active) ?? groups[0], [groups, active]);

  /** 读取单个字段的当前值：按来源从三份草稿中取 */
  function valueOf(group: PanelGroup | undefined, key: string): OptionValue | undefined {
    if (!group) return undefined; // 无分组
    if (group.source === 'site') return site[key as keyof SiteFields]; // 站点信息
    if (group.source === 'theme') return theme[key as keyof ThemeFields]; // 主题
    return optionValues[key]; // 站点选项
  } // valueOf 结束

  /** 读取单个字段的已保存值：用于计算改动数 */
  function baselineOf(group: PanelGroup | undefined, key: string): OptionValue | undefined {
    if (!group) return undefined; // 无分组
    if (group.source === 'site') return siteBaseline[key as keyof SiteFields]; // 站点基准
    if (group.source === 'theme') return themeBaseline[key as keyof ThemeFields]; // 主题基准
    return optionBaseline[key]; // 选项基准
  } // baselineOf 结束

  /** 当前分组的改动条数：保存按钮与「待保存」提示共用 */
  function dirtyCountOf(group: PanelGroup | undefined): number {
    if (!group) return 0; // 无分组
    return group.fields.filter((field) => valueOf(group, field.key) !== baselineOf(group, field.key)).length; // 逐字段比对
  } // dirtyCountOf 结束

  /** 字段变更：只改本地草稿，点保存才落库 */
  function changeField(group: PanelGroup, field: PanelField, value: OptionValue) {
    if (group.source === 'site') setSite((prev) => ({ ...prev, [field.key]: String(value) })); // 站点信息只接受字符串
    else if (group.source === 'theme') setTheme((prev) => ({ ...prev, [field.key]: field.key === 'radius' ? Number(value) : String(value) })); // 圆角保持数值
    else setOptionValues((prev) => ({ ...prev, [field.key]: value })); // 选项原样保存
    setNotice(null); // 有改动即清掉上一次成功提示
  } // changeField 结束

  /** 保存当前分组：只提交本组改动，未知字段原样带回 */
  async function saveGroup(group: PanelGroup | undefined) {
    if (!group || !canWrite) return; // 无分组或无权限直接返回
    setBusy(true); // 防重复点击
    setNotice(null); // 清旧提示
    try {
      if (group.source === 'site') {
        if (!site.title.trim()) throw new Error('站点主名不能为空'); // 主名必填，避免前台标题空白
        await saveAppearanceSetting(credential, 'site', { ...siteOrigin, ...site }); // 合并未知键后整对象写回
        setSiteBaseline(site); // 同步基准
        setNotice('「站点信息」已保存'); // 成功提示
      } else if (group.source === 'theme') {
        await saveAppearanceSetting(credential, 'theme', { ...themeOthers, ...theme }); // 主题其余字段原样带回
        setThemeBaseline(theme); // 同步基准
        setNotice('「外观与配色」已保存，前台刷新后生效'); // 成功提示
      } else {
        const keys = group.fields.map((field) => field.key); // 本组字段
        const patch: Record<string, OptionValue> = {}; // 只挑本组改动
        for (const key of keys) if (optionValues[key] !== optionBaseline[key]) patch[key] = optionValues[key]; // 逐键比对
        if (Object.keys(patch).length === 0) {
          setNotice('本组没有改动'); // 无改动直接提示
        } else {
          const result = await saveSiteOptions(credential, patch); // 局部写入
          setOptionBaseline(result.values); // 基准同步为服务端结果
          setOptionValues(result.values); // 草稿同步
          setUpdatedAt(result.updated_at); // 保存时间
          setNotice(`「${group.label}」已保存 ${result.changed.length} 项`); // 提示改动数
        } // 有改动分支结束
      } // 来源分支结束
      setError(null); // 清错误
    } catch (err) {
      setError(describeError(err)); // 展示失败原因
    } finally {
      setBusy(false); // 恢复按钮
    } // finally 结束
  } // saveGroup 结束

  /** 恢复当前分组默认值：站点 / 主题走本地默认并保存，选项走服务端 reset */
  async function resetGroup(group: PanelGroup | undefined) {
    if (!group || !canWrite) return; // 无分组或无权限直接返回
    setBusy(true); // 防重复点击
    setNotice(null); // 清旧提示
    try {
      if (group.source === 'site') {
        const defaults: SiteFields = { title: '', subtitle: '', footer: '' }; // 站点无注册表默认值，按空串
        setSite(defaults); // 草稿回默认
        setNotice('已填入默认值，点保存后生效'); // 站点不直接落库，避免误清线上文案
      } else if (group.source === 'theme') {
        const defaults: ThemeFields = { accent: '#3b6ef5', background: '#f5f6f7', radius: 12, mode: 'light' }; // 令牌默认值
        setTheme(defaults); // 草稿回默认
        setNotice('已填入默认值，点保存后生效'); // 主题同样需确认保存
      } else {
        const result = await resetSiteOptions(credential, group.fields.map((field) => field.key)); // 只重置本组键
        setOptionBaseline(result.values); // 同步基准
        setOptionValues(result.values); // 同步草稿
        setUpdatedAt(result.updated_at); // 保存时间
        setNotice(`「${group.label}」已恢复默认（${result.changed.length} 项变更）`); // 提示
      } // 来源分支结束
      setError(null); // 清错误
    } catch (err) {
      setError(describeError(err)); // 展示失败原因
    } finally {
      setBusy(false); // 恢复按钮
    } // finally 结束
  } // resetGroup 结束

  /** 图片上传：读成 data URL 交给后端落盘，成功即回填字段值 */
  async function uploadImage(group: PanelGroup, field: PanelField, file: File) {
    if (!canWrite) return; // 无权限不上传
    setBusy(true); // 上传期间禁用整组控件
    setNotice(null); // 清旧提示
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('图片不能超过 2MB'); // 前端先拦，避免白传
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); // 浏览器本地读取，不经过网络
        reader.onload = () => resolve(String(reader.result ?? '')); // 读取完成
        reader.onerror = () => reject(new Error('图片读取失败')); // 读取失败
        reader.readAsDataURL(file); // 以 data URL 形态读取
      }); // Promise 结束
      const uploaded = await uploadSiteImage(credential, dataUrl); // 后端落盘
      changeField(group, field, uploaded.url); // 回填公开地址
      setNotice(`图片已上传（${Math.round(uploaded.size / 1024)} KB），记得保存本组`); // 提示需保存
      setError(null); // 清错误
    } catch (err) {
      setError(describeError(err)); // 展示失败原因
    } finally {
      setBusy(false); // 恢复按钮
    } // finally 结束
  } // uploadImage 结束

  /** 渲染单个控件：开关 / 下拉 / 颜色 / 数值 / 文本 / 多行文本 / 图片 */
  function renderControl(group: PanelGroup, field: PanelField) {
    const value = valueOf(group, field.key); // 当前值
    const disabled = !canWrite || busy; // 只读或忙时禁用
    if (field.type === 'switch') {
      return (
        <label className="set-switch"> {/* 开关：整行可点 */}
          <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => changeField(group, field, event.target.checked)} /> {/* 真实布尔落库 */}
          <span className="set-switch-track" aria-hidden="true" /> {/* 自绘轨道，零第三方依赖 */}
        </label>
      ); // 开关结束
    } // switch 分支结束
    if (field.type === 'select') {
      return (
        <select className="set-input" value={String(value ?? field.defaultValue)} disabled={disabled} onChange={(event) => changeField(group, field, field.key === 'radius' ? Number(event.target.value) : event.target.value)}> {/* 下拉：圆角保持数值 */}
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option> // 候选项
          ))}
        </select>
      ); // 下拉结束
    } // select 分支结束
    if (field.type === 'color') {
      return (
        <div className="set-color"> {/* 颜色：取色器 + 十六进制文本，二者同步 */}
          <input type="color" value={String(value ?? field.defaultValue)} disabled={disabled} onChange={(event) => changeField(group, field, event.target.value)} /> {/* 取色器 */}
          <input className="set-input set-color-text" value={String(value ?? field.defaultValue)} disabled={disabled} onChange={(event) => changeField(group, field, event.target.value)} /> {/* 手动输入 hex */}
        </div>
      ); // 颜色结束
    } // color 分支结束
    if (field.type === 'number') {
      // 数值：min / max 由注册表声明，服务端会再夹一次区间
      return (
        <input className="set-input" type="number" value={Number(value ?? field.defaultValue)} min={field.min} max={field.max} disabled={disabled} onChange={(event) => changeField(group, field, Number(event.target.value))} />
      ); // 数值结束
    } // number 分支结束
    if (field.type === 'textarea') {
      // 多行文本：热门词、SMTP 说明、自定义 CSS 等长文本
      return (
        <textarea className="set-input set-textarea" rows={5} value={String(value ?? '')} disabled={disabled} onChange={(event) => changeField(group, field, event.target.value)} />
      ); // 多行文本结束
    } // textarea 分支结束
    if (isImageField(field)) {
      const url = String(value ?? ''); // 当前图片地址
      return (
        <div className="set-image"> {/* 图片：预览 + 地址 + 上传 + 清除 */}
          <div className="set-image-preview">{url ? <img src={url} alt={field.label} /> : <span className="muted">无图片</span>}</div> {/* 预览：无图时给文字占位，不留空框 */}
          <div className="set-image-actions"> {/* 操作行 */}
            <input className="set-input" value={url} placeholder="图片地址，或点右侧上传" disabled={disabled} onChange={(event) => changeField(group, field, event.target.value)} /> {/* 地址可直接粘贴 */}
            <label className={disabled ? 'btn small disabled' : 'btn small'}> {/* 上传按钮：原生 file 输入隐藏在外层 label 后 */}
              上传图片
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(group, field, file); event.target.value = ''; }} /> {/* 选中即上传，清空值以便重复选同一文件 */}
            </label>
            {url ? <button className="btn small" type="button" disabled={disabled} onClick={() => changeField(group, field, '')}>移除</button> : null} {/* 有图才给移除 */}
          </div>
        </div>
      ); // 图片结束
    } // 图片分支结束
    // 单行文本：其余文本类字段统一走这里
    return (
      <input className="set-input" type="text" value={String(value ?? '')} disabled={disabled} onChange={(event) => changeField(group, field, event.target.value)} />
    ); // 文本结束
  } // renderControl 结束

  if (loading) {
    return (
      <div className="page">
        <header className="page-head"><h1>主题设置</h1></header> {/* 加载态保留页头，避免标题跳动 */}
        <p className="muted">正在读取站点设置…</p>
      </div>
    ); // 加载态结束
  } // loading 分支结束

  if (groups.length === 0) {
    return (
      <div className="page">
        <header className="page-head"><h1>主题设置</h1></header>
        <p className="error">{error ?? '站点设置读取失败'}</p> {/* 读取失败给出原因 */}
      </div>
    ); // 失败态结束
  } // 空结构分支结束

  const dirty = dirtyCountOf(current); // 当前分组待保存条数

  return (
    <div className="page set-page">
      <header className="page-head">
        <h1>主题设置</h1>
        <span className="count">{updatedAt ? `最后保存 ${new Date(updatedAt).toLocaleString()}` : '尚未保存过选项'}</span> {/* 与 zibll 面板同位置的保存时间 */}
      </header>
      <p className="page-desc">左侧选分组、右侧改设置，全部在同一屏完成；所有值读写现有后端配置，保存即生效。</p>

      {!canWrite ? <div className="panel hint">当前账号缺少 appearance:write 权限，只能查看不能保存。</div> : null} {/* 只读提示 */}
      {error ? <div className="panel error">{error}</div> : null} {/* 错误条 */}
      {notice ? <div className="panel hint">{notice}</div> : null} {/* 成功条 */}

      <div className="set-shell">
        <nav className="set-nav" aria-label="设置分组"> {/* 左侧分组导航：对应 zibll 的中栏列表 */}
          {groups.map((group) => {
            const count = dirtyCountOf(group); // 组内待保存数
            return (
              <button
                key={group.key}
                type="button"
                className={group.key === current.key ? 'set-nav-item active' : 'set-nav-item'}
                onClick={() => { setActive(group.key); setError(null); setNotice(null); }} // 切组清掉上一组提示
              >
                <span>{group.label}</span> {/* 组名 */}
                {count > 0 ? <span className="set-nav-dot" aria-label={`${count} 项待保存`} /> : null} {/* 未保存点：与 zibll 的角标同义 */}
              </button>
            ); // 导航项结束
          })}
        </nav>

        <section className="set-panel"> {/* 右侧设置面板 */}
          <div className="set-panel-head"> {/* 面板头：标题 + 保存 / 恢复默认 */}
            <div>
              <h2>{current.label}</h2> {/* 当前组名 */}
              <p className="page-desc" style={{ margin: '4px 0 0' }}>{current.description}</p> {/* 组说明 */}
            </div>
            <div className="set-panel-actions"> {/* 操作按钮 */}
              {dirty > 0 ? <span className="badge draft">{dirty} 项待保存</span> : null} {/* 改动计数 */}
              <button className="btn small" type="button" disabled={!canWrite || busy} onClick={() => void resetGroup(current)}>恢复默认</button> {/* 只重置本组 */}
              <button className="btn primary" type="button" disabled={!canWrite || busy || dirty === 0} onClick={() => void saveGroup(current)}>{busy ? '处理中…' : '保存'}</button> {/* 与 zibll 的「保存」同位 */}
            </div>
          </div>

          <div className="set-fields"> {/* 字段区：逐行「标签 + 说明」在左，「控件」在右 */}
            {current.fields.map((field) => (
              <div className="set-row" key={field.key}> {/* 单字段行 */}
                <div className="set-row-label"> {/* 标签列 */}
                  <span>{field.label}</span> {/* 字段名 */}
                  {field.hint ? <span className="set-hint">{field.hint}</span> : null} {/* 字段说明，替代 zibll 的灰色小字 */}
                </div> {/* 标签列结束 */}
                <div className="set-row-control">{renderControl(current, field)}</div> {/* 控件列 */}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  ); // 主体结束
} // ThemeSettings 结束
