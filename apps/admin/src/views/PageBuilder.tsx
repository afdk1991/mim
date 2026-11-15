// 页面搭建：复用站点外观配置与 appearance:write 权限，调整首页 / 论坛区块
// 只做区块级装修（顺序 / 文案 / 可见性 / 入口跳转），不引入低代码平台与第三方依赖
import { useState } from 'react'; // 业务步骤
// 仅需类型：渲染函数返回 React 节点
import type { ReactNode } from 'react'; // 业务步骤
// 管理端接口：区块清单含停用项，写入走原有 appearance 路由
import {
  createPageBlock, // 新增区块
  deletePageBlock, // 删除区块
  describeError, // 统一错误文案
  listPageBlocks, // 读取全部区块（含停用）
  reorderPageBlocks, // 批量排序
  updatePageBlock, // 改配置 / 排序 / 启停
} from '../api'; // 业务步骤
// 仅类型导入，避免运行时多余依赖
import type { AdminPageBlock, Credential } from '../api'; // 业务步骤
// 通用异步加载钩子
import { useAsync } from '../hooks'; // 业务步骤

/** 可装修页面：首页只对未登录访客渲染，论坛页保持现有视图 */
const PAGES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'home', label: '首页', hint: '未登录访客在社区首页看到的区块' }, // 匿名首页
  { key: 'forum', label: '论坛页', hint: '社区论坛列表顶部区块（登录与否均可见）' }, // 论坛页
]; // PAGES 结束

/** 区块类型中文名：未知类型回退显示原始 kind */
const KIND_LABEL: Record<string, string> = {
  hero: '头图主视觉', // 大标题 + 副标题 + 按钮
  features: '特性卡片', // 三列卖点
  tabs: '栏目胶囊', // 标签入口
  notice: '公告条', // 单条公告 + 入口
  announcements: '社区公告', // 公告列表入口
  button: '按钮入口', // 单个跳转按钮
  image_text: '图文区块', // 图片 + 文案 + 入口
  announcement: '公告帖', // 单条公告内容
  product_grid: '商品网格', // 商品推荐
}; // KIND_LABEL 结束

/** 新增区块的默认配置：运营添加后可直接改文案与链接 */
const KIND_TEMPLATE: Record<string, Record<string, unknown>> = {
  hero: { title: 'Mim 社区', subtitle: '在这里交流经验、分享作品', cta: { label: '进入社区', href: '/community' } }, // 头图
  features: { items: [{ title: '真实交流', text: '围绕实际项目展开讨论' }, { title: '资源沉淀', text: '好内容随时可查' }, { title: '开放共建', text: '欢迎每位成员参与' }] }, // 特性
  tabs: { tabs: ['最新', '热门', '精华'] }, // 栏目
  notice: { title: '站点公告', text: '请留意社区规范与更新', href: '/community', link_label: '查看详情' }, // 公告条
  announcements: { title: '社区公告', href: '/community', link_label: '查看社区公告' }, // 公告入口
  button: { label: '进入社区', href: '/community', variant: 'primary' }, // 按钮
  image_text: { title: '图文标题', body: '在这里补充说明', href: '/community', link_label: '了解更多', image_url: '', align: 'left' }, // 图文
  announcement: { title: '公告标题', body: '公告内容', pinned: false }, // 公告帖
  product_grid: {}, // 商品网格无文案
}; // KIND_TEMPLATE 结束

/** 编辑草稿：聚合友好字段与原始 JSON，保存时统一回写 */
interface Draft {
  id: string; // 区块主键
  kind: string; // 区块类型
  config: Record<string, unknown>; // 结构化配置
  itemsText: string; // 特性卡片逐行文本
  tabsText: string; // 栏目逐行文本
  jsonText: string; // 原始 JSON 文本
} // Draft 结束

/** 页面搭建入参 */
interface PageBuilderProps {
  credential: Credential; // 已登录凭证
  permissions: string[]; // 实时权限码
} // PageBuilderProps 结束

/** 取字符串配置：数字 / 布尔等统一转字符串给输入框 */
function textOf(config: Record<string, unknown>, key: string): string {
  const value = config[key]; // 常量 value：保存固定配置或一次性派生值
  return value === undefined || value === null ? '' : String(value); // 空值统一为空串
} // textOf 结束

/** 取 cta 对象：脏数据回落空对象 */
function ctaOf(config: Record<string, unknown>): Record<string, unknown> {
  const value = config.cta; // 常量 value：保存固定配置或一次性派生值
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}; // 仅接受对象
} // ctaOf 结束

/** 把特性卡片配置转成逐行文本，便于运营直接编辑 */
function itemsToText(value: unknown): string {
  if (!Array.isArray(value)) return ''; // 非数组按空处理
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return ''; // 非对象项跳过
      const row = item as Record<string, unknown>; // 收窄单项
      return `${String(row.title ?? '')}|${String(row.text ?? '')}`.trim(); // 标题|说明
    })
    .filter(Boolean) // 去掉空行
    .join('\n'); // 逐行拼接
} // itemsToText 结束

/** 把栏目配置转成逐行文本 */
function tabsToText(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item)).join('\n') : ''; // 数组逐行展开
} // tabsToText 结束

/** 解析特性卡片逐行文本，返回渲染器认识的 items 结构 */
function parseItems(text: string): Array<{ title: string; text: string }> {
  return text
    .split('\n') // 按行拆分
    .map((line) => line.trim()) // 去首尾空白
    .filter(Boolean) // 去掉空行
    .map((line) => {
      const [title, ...rest] = line.split('|'); // 首个竖线前为标题
      return { title: title.trim(), text: rest.join('|').trim() }; // 其余合并为说明
    }); // 逐行映射结束
} // parseItems 结束

/** 解析栏目光本：支持换行或英文逗号分隔 */
function parseTabs(text: string): string[] {
  return text
    .split(/[\n,，]/) // 换行 / 中英文逗号都视为分隔
    .map((item) => item.trim()) // 去首尾空白
    .filter(Boolean); // 去掉空项
} // parseTabs 结束

/** 区块配置摘要：优先显示标题 / 按钮文案 */
function summaryOf(block: AdminPageBlock): string {
  const title = textOf(block.config, 'title') || textOf(block.config, 'label') || textOf(block.config, 'text'); // 依次尝试常见文案字段
  return title || '未填写文案'; // 空配置给出提示
} // summaryOf 结束

/** 入口地址摘要：兼容顶层 href 与 cta.href */
function hrefOf(block: AdminPageBlock): string {
  return textOf(block.config, 'href') || textOf(ctaOf(block.config), 'href'); // 先顶层后 cta
} // hrefOf 结束

/** 页面搭建视图：管理端能力位，无 appearance:write 时不渲染操作 */
export function PageBuilder({ credential, permissions }: PageBuilderProps) {
  const canWrite = permissions.includes('appearance:write'); // 与后端路由同一权限码
  const [page, setPage] = useState('home'); // 默认装修首页
  const [addKind, setAddKind] = useState('hero'); // 新增区块类型
  const [draft, setDraft] = useState<Draft | null>(null); // 当前编辑草稿
  const [busy, setBusy] = useState(false); // 写操作进行中
  const [error, setError] = useState(''); // 操作错误
  const [notice, setNotice] = useState(''); // 操作成功提示
  // 区块清单：切换页面时重新拉取；无权限时不发起请求
  const state = useAsync(() => (canWrite ? listPageBlocks(credential, page) : Promise.resolve([])), [credential, page, canWrite]);
  const blocks = state.data ?? []; // 空数据兜底

  /** 统一执行写操作：成功提示 + 刷新清单，失败落到错误条 */
  async function run(action: () => Promise<unknown>, success: string, after?: () => void): Promise<void> {
    setBusy(true); // 进入忙碌态
    setError(''); // 清掉旧错误
    setNotice(''); // 清掉旧提示
    try {
      await action(); // 执行写操作
      setNotice(success); // 提示成功
      state.reload(); // 刷新清单，确保顺序 / 启停一致
      if (after) after(); // 额外回调（例如关闭编辑器）
    } catch (err) {
      setError(describeError(err)); // 统一错误文案
    } finally {
      setBusy(false); // 退出忙碌态
    } // try 结束
  } // run 结束

  /** 打开编辑器：把配置拆成友好字段与原始 JSON */
  function openEdit(block: AdminPageBlock): void {
    setError(''); // 清错误
    setNotice(''); // 清提示
    setDraft({
      id: block.id, // 主键
      kind: block.kind, // 类型
      config: { ...block.config }, // 复制配置，取消时不污染原值
      itemsText: itemsToText(block.config.items), // 特性卡片文本
      tabsText: tabsToText(block.config.tabs), // 栏目文本
      jsonText: JSON.stringify(block.config, null, 2), // 原始 JSON
    }); // setDraft 结束
  } // openEdit 结束

  /** 修改草稿顶层字段 */
  function patch(key: string, value: unknown): void {
    setDraft((prev) => (prev ? { ...prev, config: { ...prev.config, [key]: value } } : prev)); // 仅替换目标键
  } // patch 结束

  /** 修改草稿 cta 字段 */
  function patchCta(key: string, value: unknown): void {
    setDraft((prev) => {
      if (!prev) return prev; // 无草稿直接返回
      return { ...prev, config: { ...prev.config, cta: { ...ctaOf(prev.config), [key]: value } } }; // 合并 cta
    }); // setDraft 结束
  } // patchCta 结束

  /** 应用原始 JSON：解析失败留在编辑器并提示 */
  function applyJson(): void {
    if (!draft) return; // 无草稿直接返回
    try {
      const parsed: unknown = JSON.parse(draft.jsonText); // 解析文本
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置必须是 JSON 对象'); // 拒绝非对象
      const config = parsed as Record<string, unknown>; // 收窄类型
      setDraft({
        ...draft, // 保留主键与类型
        config, // 使用新配置
        itemsText: itemsToText(config.items), // 同步友好字段
        tabsText: tabsToText(config.tabs), // 同步友好字段
        jsonText: JSON.stringify(config, null, 2), // 格式化回显
      }); // setDraft 结束
      setError(''); // 清掉解析错误
      setNotice('JSON 已应用，记得点击保存'); // 提示仍需保存
    } catch (err) {
      setError(describeError(err)); // 展示解析错误
    } // try 结束
  } // applyJson 结束

  /** 保存当前草稿：友好字段回填后再提交 */
  function saveDraft(): void {
    if (!draft) return; // 无草稿直接返回
    const config: Record<string, unknown> = { ...draft.config }; // 复制配置
    if (draft.kind === 'features') config.items = parseItems(draft.itemsText); // 特性卡片回填
    if (draft.kind === 'tabs') config.tabs = parseTabs(draft.tabsText); // 栏目回填
    void run(
      () => updatePageBlock(credential, page, draft.id, { config }), // 走原有 PUT 接口
      '区块已保存，前台刷新后生效', // 成功提示
      () => setDraft(null), // 关闭编辑器
    ); // run 结束
  } // saveDraft 结束

  /** 新增区块：按模板初始化，随后提示进入编辑 */
  function addBlock(): void {
    const template = KIND_TEMPLATE[addKind] ?? {}; // 未知类型用空配置
    const sort = blocks.reduce((max, block) => Math.max(max, block.sort_order), 0) + 10; // 追加到末尾并留出间隔
    void run(
      () => createPageBlock(credential, page, { kind: addKind, sort_order: sort, config: template }), // 新建接口
      '区块已新增，请点击「编辑」补充文案', // 成功提示
    ); // run 结束
  } // addBlock 结束

  /** 上移 / 下移：把当前页面全部区块的最终顺序一次性提交 */
  function move(block: AdminPageBlock, direction: -1 | 1): void {
    const ids = blocks.map((item) => item.id); // 当前展示顺序
    const index = ids.indexOf(block.id); // 当前区块位置
    const target = index + direction; // 目标位置
    if (index < 0 || target < 0 || target >= ids.length) return; // 越界不处理
    [ids[index], ids[target]] = [ids[target], ids[index]]; // 交换位置
    void run(() => reorderPageBlocks(credential, page, ids), '顺序已更新'); // 提交新顺序
  } // move 结束

  /** 切换可见性：停用后公开接口不再返回该区块 */
  function toggle(block: AdminPageBlock): void {
    void run(
      () => updatePageBlock(credential, page, block.id, { enabled: !block.enabled }), // 反转启停
      block.enabled ? '区块已隐藏，前台不再展示' : '区块已恢复展示', // 成功提示
    ); // run 结束
  } // toggle 结束

  /** 删除区块：二次确认后提交 */
  function remove(block: AdminPageBlock): void {
    if (!window.confirm(`确认删除「${summaryOf(block)}」？删除后需重新创建。`)) return; // 二次确认
    void run(() => deletePageBlock(credential, page, block.id), '区块已删除', () => setDraft(null)); // 删除并关闭编辑器
  } // remove 结束

  /** 渲染按区块类型定制的友好字段 */
  function renderFields(): ReactNode {
    if (!draft) return null; // 无草稿不渲染
    const { kind, config } = draft; // 解构便于阅读
    if (kind === 'hero') {
      return (
        <>
          <label className="field">
            <span>主标题</span>
            <input value={textOf(config, 'title')} onChange={(event) => patch('title', event.target.value)} placeholder="例如：Mim 社区" />
          </label>
          <label className="field">
            <span>副标题</span>
            <input value={textOf(config, 'subtitle')} onChange={(event) => patch('subtitle', event.target.value)} placeholder="一句话介绍" />
          </label>
          <div className="row">
            <label className="field">
              <span>按钮文案</span>
              <input value={textOf(ctaOf(config), 'label')} onChange={(event) => patchCta('label', event.target.value)} placeholder="进入社区" />
            </label>
            <label className="field">
              <span>按钮跳转</span>
              <input value={textOf(ctaOf(config), 'href')} onChange={(event) => patchCta('href', event.target.value)} placeholder="/community 或 https://..." />
            </label>
          </div>
        </>
      ); // hero 字段结束
    } // hero 分支结束
    if (kind === 'features') {
      return (
        <label className="field">
          <span>卡片（每行：标题|说明）</span>
          <textarea rows={4} value={draft.itemsText} onChange={(event) => setDraft({ ...draft, itemsText: event.target.value })} />
        </label>
      ); // features 字段结束
    } // features 分支结束
    if (kind === 'tabs') {
      return (
        <label className="field">
          <span>栏目（每行一个，或用逗号分隔）</span>
          <textarea rows={3} value={draft.tabsText} onChange={(event) => setDraft({ ...draft, tabsText: event.target.value })} />
        </label>
      ); // tabs 字段结束
    } // tabs 分支结束
    if (kind === 'notice') {
      return (
        <>
          <div className="row">
            <label className="field">
              <span>标题</span>
              <input value={textOf(config, 'title')} onChange={(event) => patch('title', event.target.value)} />
            </label>
            <label className="field">
              <span>正文</span>
              <input value={textOf(config, 'text')} onChange={(event) => patch('text', event.target.value)} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>入口文案</span>
              <input value={textOf(config, 'link_label')} onChange={(event) => patch('link_label', event.target.value)} placeholder="查看详情" />
            </label>
            <label className="field">
              <span>入口跳转</span>
              <input value={textOf(config, 'href')} onChange={(event) => patch('href', event.target.value)} placeholder="/community 或 https://..." />
            </label>
          </div>
        </>
      ); // notice 字段结束
    } // notice 分支结束
    if (kind === 'announcements') {
      return (
        <div className="row">
          <label className="field">
            <span>入口文案</span>
            <input value={textOf(config, 'link_label')} onChange={(event) => patch('link_label', event.target.value)} placeholder="查看社区公告" />
          </label>
          <label className="field">
            <span>入口跳转</span>
            <input value={textOf(config, 'href')} onChange={(event) => patch('href', event.target.value)} placeholder="/community" />
          </label>
        </div>
      ); // announcements 字段结束
    } // announcements 分支结束
    if (kind === 'button') {
      return (
        <>
          <div className="row">
            <label className="field">
              <span>按钮文案</span>
              <input value={textOf(config, 'label')} onChange={(event) => patch('label', event.target.value)} />
            </label>
            <label className="field">
              <span>按钮跳转</span>
              <input value={textOf(config, 'href')} onChange={(event) => patch('href', event.target.value)} placeholder="/community 或 https://..." />
            </label>
          </div>
          <label className="field">
            <span>样式</span>
            <select value={textOf(config, 'variant') || 'primary'} onChange={(event) => patch('variant', event.target.value)}>
              <option value="primary">主按钮</option>
              <option value="ghost">次按钮</option>
            </select>
          </label>
        </>
      ); // button 字段结束
    } // button 分支结束
    if (kind === 'image_text') {
      return (
        <>
          <label className="field">
            <span>标题</span>
            <input value={textOf(config, 'title')} onChange={(event) => patch('title', event.target.value)} />
          </label>
          <label className="field">
            <span>正文</span>
            <textarea rows={2} value={textOf(config, 'body')} onChange={(event) => patch('body', event.target.value)} />
          </label>
          <label className="field">
            <span>图片地址</span>
            <input value={textOf(config, 'image_url')} onChange={(event) => patch('image_url', event.target.value)} placeholder="https://..." />
          </label>
          <div className="row">
            <label className="field">
              <span>入口文案</span>
              <input value={textOf(config, 'link_label')} onChange={(event) => patch('link_label', event.target.value)} />
            </label>
            <label className="field">
              <span>入口跳转</span>
              <input value={textOf(config, 'href')} onChange={(event) => patch('href', event.target.value)} placeholder="/community 或 https://..." />
            </label>
          </div>
        </>
      ); // image_text 字段结束
    } // image_text 分支结束
    if (kind === 'announcement') {
      return (
        <>
          <label className="field">
            <span>标题</span>
            <input value={textOf(config, 'title')} onChange={(event) => patch('title', event.target.value)} />
          </label>
          <label className="field">
            <span>正文</span>
            <textarea rows={3} value={textOf(config, 'body')} onChange={(event) => patch('body', event.target.value)} />
          </label>
        </>
      ); // announcement 字段结束
    } // announcement 分支结束
    return null; // 其余类型只提供原始 JSON
  } // renderFields 结束

  return (
    <div className="page">
      <header className="page-head">
        <h1>页面搭建</h1>
        <p className="muted">复用外观配置与 appearance:write：调整首页 / 论坛区块的顺序、文案、可见性与入口跳转，保存后公开接口即时生效。</p>
      </header>
      {!canWrite ? <div className="panel error">当前账号缺少 appearance:write 权限，页面搭建不可用。</div> : null}
      {error ? <div className="panel error">{error}</div> : null}
      {notice ? <div className="panel hint">{notice}</div> : null}

      <section className="panel">
        <div className="panel-head">
          <h3>选择页面</h3>
        </div>
        <div className="row">
          {PAGES.map((item) => (
            <button
              key={item.key}
              className={`btn ${page === item.key ? 'primary' : 'ghost'}`}
              disabled={busy}
              onClick={() => {
                setDraft(null); // 切页时关闭编辑器
                setPage(item.key); // 切换页面
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="hint">{PAGES.find((item) => item.key === page)?.hint}</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>新增区块</h3>
        </div>
        <div className="row">
          <label className="field">
            <span>区块类型</span>
            <select value={addKind} onChange={(event) => setAddKind(event.target.value)} disabled={busy || !canWrite}>
              {Object.keys(KIND_TEMPLATE).map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind] ?? kind}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" onClick={addBlock} disabled={busy || !canWrite}>
            添加到当前页面
          </button>
        </div>
        <p className="hint">新增后按模板生成占位文案，点击「编辑」即可替换；不需要时可直接隐藏或删除。</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>区块清单</h3>
          <span className="muted">{state.loading ? '加载中…' : `${blocks.length} 个`}</span>
          <button className="btn ghost" onClick={state.reload} disabled={busy || !canWrite}>
            刷新
          </button>
        </div>
        {state.error ? <p className="error">加载失败：{describeError(state.error)}</p> : null}
        {!state.loading && !state.error && blocks.length === 0 ? (
          <p className="empty">当前页面还没有区块；未登录访客会看到内置默认首页（头图 / 特性 / 公告）。</p>
        ) : null}
        {blocks.map((block, index) => (
          <article className="deploy-row" key={block.id}>
            <div className="deploy-kv">
              <strong>
                {index + 1}. {KIND_LABEL[block.kind] ?? block.kind}
              </strong>
              <span className="badge builtin">{block.kind}</span>
              <span className={`badge ${block.enabled ? 'active' : 'draft'}`}>{block.enabled ? '可见' : '已隐藏'}</span>
              <span className="muted">{summaryOf(block)}</span>
            </div>
            <p className="hint">
              入口：{hrefOf(block) || '未配置'} · 更新于 {block.updated_at}
            </p>
            <div className="row">
              <button className="btn ghost" disabled={busy || index === 0} onClick={() => move(block, -1)}>
                上移
              </button>
              <button className="btn ghost" disabled={busy || index === blocks.length - 1} onClick={() => move(block, 1)}>
                下移
              </button>
              <button className="btn" disabled={busy || !canWrite} onClick={() => openEdit(block)}>
                编辑
              </button>
              <button className="btn" disabled={busy || !canWrite} onClick={() => toggle(block)}>
                {block.enabled ? '隐藏' : '恢复可见'}
              </button>
              <button className="btn danger" disabled={busy || !canWrite} onClick={() => remove(block)}>
                删除
              </button>
            </div>
            {draft?.id === block.id ? (
              <div className="form" style={{ marginTop: 10 }}>
                {renderFields()}
                <label className="field">
                  <span>原始 JSON（高级）</span>
                  <textarea rows={6} value={draft.jsonText} onChange={(event) => setDraft({ ...draft, jsonText: event.target.value })} />
                </label>
                <div className="row">
                  <button className="btn" disabled={busy} onClick={applyJson}>
                    应用 JSON
                  </button>
                  <button className="btn primary" disabled={busy} onClick={saveDraft}>
                    保存
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => setDraft(null)}>
                    取消
                  </button>
                </div>
                <p className="hint">站内跳转以 / 开头（如 /community），站外用 https:// 开头；隐藏的区块不会出现在公开接口。</p>
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  ); // return 结束
} // PageBuilder 结束
