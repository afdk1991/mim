#!/usr/bin/env node
/**
 * scripts/verify-auth-gate.mjs
 * 免登录体验回归校验（2026-11-12 起替代原「按需登录」校验）：静态断言 + 可选真实浏览器实测（--live）。
 *
 * 模型：全站不再有「此功能需登录后使用」的门禁。
 *   - 前端启动时若本地无会话，自动调用 POST /api/v1/auth/guest 领取匿名访客会话；
 *   - 访客会话与正式账号走同一套鉴权与业务接口，商城下单、购物车、个人中心、聊天、
 *     漫剧工作台全部直接可用；
 *   - 登录 / 注册只用于把访客身份升级为正式账号，不再是功能开关。
 *
 * 用法：
 *   node scripts/verify-auth-gate.mjs            # 只跑源码 / 静态页 / 文档口径断言
 *   node scripts/verify-auth-gate.mjs --live     # 追加 Edge CDP 真实渲染验证（需先启动 API、静态服务与 Edge 9222）
 *
 * 约定：零第三方依赖，仅用 Node 内置 fs / fetch / WebSocket（Node >= 20）。
 */
// 文件读取：静态断言直接读仓库源码，不依赖构建产物
import { readFileSync, existsSync } from 'node:fs';
// 路径拼接：统一以 cwd 为根，便于在仓库根或 CI 工作目录执行
import { join } from 'node:path';

// 仓库根目录：脚本由 npm run verify:auth-gate 在根执行
const ROOT = process.cwd(); // 不做 __dirname 推导，保持与其余 verify 脚本一致
// 是否启用浏览器实测：命令行出现 --live 才连接 CDP
const LIVE = process.argv.includes('--live'); // 默认只跑静态检查，适合 CI 快速门禁
// 静态服务基址：与 .tmp/serve.mjs 的 5188 端口一致
const BASE = process.env.MIM_GATE_BASE ?? 'http://127.0.0.1:5188/'; // 可用环境变量覆盖
// CDP 端点：Edge --remote-debugging-port=9222
const CDP = process.env.MIM_GATE_CDP ?? 'http://127.0.0.1:9222'; // 可用环境变量覆盖
// 会话键：与 apps/web/src/api.ts 的 SESSION_KEY 保持一致（live 场景注入/清除会话用）
const SESSION_KEY = 'mim.session.v1'; // 免登录体验下仍是前端唯一会话键
// 断言结果累加器：每项含名称、通过与明细
const checks = []; // 最终统一打印并据此决定退出码

// 读取仓库内文件为 UTF-8 文本；缺失时返回空串让断言失败而不是崩溃
function read(rel) {
  // 绝对路径由 ROOT 拼接，避免受调用方 cwd 影响
  const p = join(ROOT, rel); // 相对路径保持仓库内写法
  // 文件不存在时返回空串
  return existsSync(p) ? readFileSync(p, 'utf8') : ''; // 缺文件必然导致相关断言不通过
} // read 结束

// 记录一条断言：ok 为布尔，detail 用于失败时给出可定位的信息
function check(name, ok, detail = '') {
  // 逐项入栈，最终汇总
  checks.push({ name, ok, detail }); // 不做即时抛出，保证一次跑完全部检查
} // check 结束

// 简易等待：浏览器渲染与网络请求都需要留出时间窗口
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // 仅用于轮询间隔

// ---------- 1. 静态断言：源码层免登录体验模型是否完整 ---------- //
const app = read('apps/web/src/App.tsx'); // Web 应用根组件
check('App 已移除 GATED_VIEWS 登录门禁集合', !/GATED_VIEWS/.test(app), '仍存在按视图拦截的登录门禁集合'); // 免登录体验核心
check('App 启动自动领取访客会话', app.includes('ensureGuestSession'), '缺少启动自动建访客会话的钩子'); // 全站可用的前提
check('App 不再以登录卡片替代功能页', !/gated && !session/.test(app), '仍存在匿名态内嵌登录卡片替代功能页'); // 门禁已拆除
check('App 商品 / 购物车 / 个人中心直接渲染', /route\.view === 'products' && session/.test(app) && /route\.view === 'cart' && session/.test(app) && /route\.view === 'account' && session/.test(app), '功能页渲染条件漂移'); // 访客会话即可用
check('App 展示访客身份与登录升级入口', app.includes('is_guest') && app.includes('登录 / 注册正式账号'), '缺少访客标识或升级入口'); // 登录改为身份升级
check('App 已移除整站锁定 early return', !/if \(!session\)[\s\S]{0,240}?return <Login/.test(app), '仍存在未登录整屏锁定分支'); // 不得回退到全站锁定
check('App 登录提示不再有 required 态', !app.includes("'required' | 'expired'"), 'gateNotice 仍保留「需登录」提示类型'); // 提示模型已切换
check('App 订阅会话变更事件', app.includes('SESSION_CHANGED_EVENT'), '缺少登录/退出/失效事件订阅'); // 会话联动
check('App 启动静默校验会话', app.includes('verifySession'), '缺少 /me 启动校验'); // 刷新与直达内页
check('App 退出后落到商城而非登录页', /go\(\{ view: 'store' \}\)/.test(app), '退出后应回到免登录可用的商城'); // 语义保持

// History 路由（路径即视图）：pushState 导航、popstate 监听、子路径前缀推断与旧 hash 兼容缺一不可
const router = read('apps/web/src/router.ts'); // 读取路由实现
check('router 使用 history 路由', router.includes('pushState') && router.includes('popstate'), '缺少 pushState / popstate'); // 路径路由核心
check('router 推断子路径部署前缀', router.includes('baseOf') && router.includes('import.meta.url'), '缺少 baseOf / import.meta.url'); // GitHub Pages /mim/ 子路径部署兼容
check('router 兼容旧 hash 链接', router.includes('location.hash') && router.includes('replaceState'), '缺少旧 hash 原地改写'); // 老书签 / 外链不 404

// API 客户端：会话结构校验、失效广播、跨标签页同步、静默校验与访客建号
const api = read('apps/web/src/api.ts'); // 读取完整源码
check('api 导出会话键', api.includes('export const SESSION_KEY'), '前端会话键缺失'); // 键一致性
check('api 校验会话结构', api.includes('isValidSession') && api.includes('function parseSession'), '脏数据不得被当作已登录'); // 防伪造
check('api 失效时广播重登提示', api.includes("clearSession('expired')") && api.includes('SESSION_CHANGED_EVENT'), '401 续期失败必须触发失效广播'); // 失效联动
check('api 监听跨标签页 storage', api.includes("addEventListener('storage'"), '其它标签页退出需同步'); // 多标签页
check('api 提供 /me 静默校验', api.includes('export async function verifySession') && api.includes("request<MeResponse>('/me'"), '启动校验必须打受保护接口'); // 真实鉴权
check('api 续期后同步界面', api.includes("'refresh')") && api.includes('emitSessionChange'), 'refresh 后 App 会话需保持最新令牌'); // 避免写回旧令牌
check('api 提供访客建号接口', api.includes("'/auth/guest'") && api.includes('export async function ensureGuestSession'), '缺少 /auth/guest 客户端封装'); // 免登录链路

// 登录页：只保留失效提示，旧的「此功能需登录后使用」文案必须清零
const login = read('apps/web/src/views/Login.tsx'); // 读取登录组件
check('登录页支持 embedded 内嵌模式', login.includes('embedded') && login.includes('auth-wrap embedded'), '缺少内嵌模式'); // 登录页形态
check('登录页已移除「此功能需登录后使用」', !login.includes('此功能需登录后使用') && !login.includes('Sign in to use this feature'), '旧门禁文案残留'); // 免登录体验核心
check('登录页保留失效提示', login.includes('登录状态已失效'), '令牌失效需提示重新登录'); // 失效文案
check('登录页不再含全站锁定文案', !login.includes('全站已锁定'), '旧全站锁定文案残留'); // 模型已切换
const css = read('apps/web/src/styles.css'); // 读取样式表
check('登录提示有样式', css.includes('.auth-notice'), '缺少 .auth-notice 样式'); // 视觉可用性

// 商城：免登录即可解锁，仅在没有会话时才出现重试入口
const store = read('apps/web/src/views/Store.tsx'); // 读取商城组件
check('商城按登录态跳过权益请求', /authed \? api\.catalog\.getMyEntitlements\(\) : Promise\.resolve\(null\)/.test(store), '无会话时不得请求鉴权接口'); // 降级短路
check('商城降级入口改为重试免登录会话', store.includes('重试免登录会话') && !store.includes('登录后解锁'), '仍以「登录后解锁」作为解锁前置'); // 收费动作不再要求登录

// React 首屏：地址栏归一化外置为 public/spa.js（绕开生产 CSP script-src 'self'），index.html 须引用它并保留前置规整内联，且不得再含内联门禁
const webIndex = read('apps/web/index.html'); // 读取首屏 HTML
check('index.html 引用外置归一化脚本', webIndex.includes('%BASE_URL%spa.js'), '缺少 %BASE_URL%spa.js 引用'); // spa.js 承载地址归一化
check('index.html 保留地址栏前置规整', webIndex.includes("'?tads'") && webIndex.includes('replaceState'), '缺少 ?tads 清理与多段折叠内联'); // 须在相对资源加载前执行
check('index.html 已移除内联门禁', !webIndex.includes('data-auth-gate') && !webIndex.includes('全站会话门禁'), '内联门禁脚本残留'); // 免登录体验下不得整页替换
// 外置脚本本体：只做地址归一化，不得再含门禁标记
const spaGate = read('apps/web/public/spa.js'); // 读取外置脚本
check('spa.js 保留地址归一化', spaGate.includes("'?tads'") && spaGate.includes('history.replaceState'), '地址归一化逻辑缺失'); // WAF 注入清理
check('spa.js 已移除会话门禁', !spaGate.includes('data-auth-gate') && !spaGate.includes('全站已锁定'), '外置门禁逻辑残留'); // 门禁已拆除
// 静态 HTML 入口：三份静态文档的同款内联门禁必须清零，匿名可直读
const gatedFiles = ['site/index.html', 'site/prd.html', 'Mim-PRD.html']; // 三份静态文档
for (const rel of gatedFiles) { // 逐个检查
  if (!existsSync(join(ROOT, rel))) { // 文件不在工作树
    check(`静态页 ${rel} 已移除（文件不存在，按缺失登记）`, true, ''); // 显式登记缺失状态，不以空串冒充内容检查
    continue; // 跳过内容级断言
  } // 缺失分支结束
  const html = read(rel); // 读取文件内容
  check(`静态页 ${rel} 已移除门禁`, !html.includes('data-auth-gate') && !html.includes('全站会话门禁'), '静态页门禁脚本残留'); // 零遗漏
} // 静态入口遍历结束

// 独立管理后台：原本即为全站凭证门禁（后台属管理面，免登录体验不影响它），确认未被本轮改动破坏
const admin = read('apps/admin/src/App.tsx'); // 读取后台根组件
check('管理后台无凭证只渲染登录页', /if \(!credential\) return <Login/.test(admin), 'admin 门禁退化'); // 后台保持凭证门禁
check('管理后台 401 自动退出', admin.includes('error.status === 401'), '凭证失效需自动回登录页'); // 失效联动

// 文档口径：README 与运维手册须同步为免登录体验
const readme = read('README.md'); // 读取 README
check('README 同步为免登录体验', readme.includes('免登录体验'), 'README 口径过期'); // 铁律三
const runbook = read('docs/wiki/05-runbook.md'); // 读取运维手册
check('05-runbook 同步免登录体验', runbook.includes('免登录体验'), '门禁模型段落过期'); // 文档一致性

// ---------- 2. 可选浏览器实测 ---------- //
// 连接 CDP：复用 Node 内置 WebSocket，等待 Edge 就绪
async function getTarget() {
  // 最多重试 30 次，覆盖浏览器冷启动
  for (let i = 0; i < 30; i++) { // 固定次数避免无限等待
    try { // CDP 端口可能尚未监听
      // 取 page 类型 target
      const list = await (await fetch(CDP + '/json/list')).json(); // /json/list 返回全部标签
      // 找到第一个页面即可
      const page = list.find((t) => t.type === 'page'); // 只用已存在的空白页
      // 命中即返回
      if (page) return page; // 返回含 webSocketDebuggerUrl 的对象
    } catch { /* 浏览器尚未就绪，继续重试 */ } // 网络错误按未就绪处理
    // 间隔 400ms 再试
    await sleep(400); // 控制轮询密度
  } // 重试结束
  // 超时抛出，交由外层记为失败
  throw new Error('Edge CDP 未就绪'); // 明确失败原因
} // getTarget 结束

// 建立 WebSocket 并注册消息分发，返回 send / evaluate / waitUntil 三个工具
async function connect() {
  // 等待 Edge 目标页
  const target = await getTarget(); // 含调试地址
  // 建立连接
  const ws = new WebSocket(target.webSocketDebuggerUrl); // Node 内置 WebSocket
  // 等待 open
  await new Promise((res, rej) => { // 只监听一次
    ws.addEventListener('open', res, { once: true }); // 连接就绪
    ws.addEventListener('error', rej, { once: true }); // 连接异常
  }); // Promise 结束
  // 自增消息 id
  let seq = 0; // 从 1 开始
  // 待响应回调表
  const pending = new Map(); // id 转 resolve
  // 控制台错误与未捕获异常收集
  const consoleErrors = []; // 用于最终断言
  // 未捕获异常收集
  const exceptions = []; // 用于最终断言
  // 消息分发
  ws.addEventListener('message', (ev) => { // CDP 事件与响应共用通道
    // 解析 JSON
    const msg = JSON.parse(String(ev.data)); // 字符串化后解析
    // 响应：命中待响应表即回调
    if (msg.id && pending.has(msg.id)) { // 只处理自己发出的请求
      // 取出并删除
      const resolve = pending.get(msg.id); // 保存回调
      // 移除
      pending.delete(msg.id); // 防止重复
      // 回调
      resolve(msg); // 交回调用方
      // 提前返回
      return; // 不进入事件分支
    } // 响应分支结束
    // console.error 计入错误
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') { // 只看 error 级
      // 拼出可读文本
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')); // 保留描述
    } // 控制台分支结束
    // 未捕获异常计入错误
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text); // 记录文本
  }); // 消息监听结束
  // 发送 CDP 命令
  function send(method, params = {}) { // 返回 Promise<响应>
    // 分配 id
    const id = ++seq; // 单调递增
    // 包装为 Promise
    return new Promise((resolve) => { // 由消息分发回调
      // 登记
      pending.set(id, resolve); // 等待响应
      // 发送
      ws.send(JSON.stringify({ id, method, params })); // 标准 CDP 帧
    }); // Promise 结束
  } // send 结束
  // 执行页面表达式并返回字符串结果
  async function evaluate(expression) { // 统一用 JSON.stringify 承载结果
    // 发起求值
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); // 支持 Promise
    // 导航瞬间上下文可能销毁
    if (r.result?.exceptionDetails) return null; // 交给 waitUntil 重试
    // 取值
    const v = r.result?.result?.value; // returnByValue 下为原始值
    // 只接受字符串
    return typeof v === 'string' ? v : null; // 其余按未就绪
  } // evaluate 结束
  // 轮询等待条件成立
  async function waitUntil(fn, timeout = 8000) { // 默认 8 秒
    // 记录起点
    const start = Date.now(); // 毫秒时间戳
    // 循环直到超时
    while (Date.now() - start < timeout) { // 每次轮询
      // 求值
      const v = await fn(); // 返回真值即成功
      // 命中
      if (v) return v; // 立即返回
      // 间隔
      await sleep(100); // 控制轮询密度
    } // 轮询结束
    // 超时返回 null
    return null; // 由调用方判定
  } // waitUntil 结束
  // 返回工具集合
  return { send, evaluate, waitUntil, consoleErrors, exceptions, ws }; // 供场景复用
} // connect 结束

// 真实浏览器场景：免登录自动访客 → 全功能可用 → 登录升级 → 刷新后再次免登录
async function live() {
  // 建立连接
  const c = await connect(); // CDP 工具集合
  // 启用页面与运行时域
  await c.send('Page.enable'); // 支持导航
  await c.send('Runtime.enable'); // 支持求值
  await c.send('Log.enable'); // 支持日志
  await c.send('Network.enable'); // 支持缓存控制
  await c.send('Network.setCacheDisabled', { cacheDisabled: true }); // 禁用缓存，确保加载最新构建产物
  // 打开应用根并等待首屏
  await c.send('Page.navigate', { url: BASE }); // 打开应用根
  // 等待首屏出现主布局（免登录体验下不应出现登录页）
  await c.waitUntil(async () => c.evaluate(`(document.querySelector('.layout') ? 'ready' : '')`), 12000); // 首屏就绪
  // 清除会话并重新加载，保证从纯访客态开始
  await c.evaluate(`localStorage.removeItem('${SESSION_KEY}'); location.reload(); 'ok'`); // 强制访客态
  // 等待自动建号完成：本地出现 is_guest=true 的会话
  const guest = await c.waitUntil(async () => c.evaluate(`(() => { const raw = localStorage.getItem('${SESSION_KEY}'); if (!raw) return ''; try { const s = JSON.parse(raw); return s.user && s.user.is_guest === true ? 'guest' : ''; } catch { return ''; } })()`), 15000); // 访客会话落盘
  check('live 匿名首屏自动领取访客会话', guest === 'guest', '未自动建立 is_guest 会话'); // 免登录体验核心
  // 主布局可浏览，且没有登录卡片
  const browsable = await c.evaluate(`(document.querySelector('.layout') && document.querySelector('.sidebar') && !document.querySelector('.auth-wrap') ? 'browsable' : '')`); // 主布局 + 无登录卡片
  check('live 匿名首屏直接渲染主布局（无登录卡片）', browsable === 'browsable', '匿名应看到完整主布局'); // 门禁已拆除
  // 侧栏显示访客身份与登录升级入口
  const footer = await c.evaluate(`(() => document.querySelector('.sidebar-footer')?.innerText ?? '')()`); // 侧栏底部文本
  check('live 侧栏显示访客身份', String(footer).includes('访客'), `实际：${footer}`); // 身份标识
  check('live 侧栏提供登录升级入口', String(footer).includes('登录 / 注册'), `实际：${footer}`); // 升级而非门禁

  // 逐个访问原本「需登录」的功能视图：均应渲染真实页面而非登录卡片
  const gatedViews = ['products', 'cart', 'account', 'chat']; // 四个原门禁视图
  for (const view of gatedViews) { // 逐个导航
    await c.evaluate(`history.pushState(null,'','/${view}'); window.dispatchEvent(new Event('mim:route')); 'ok'`); // 编程式导航（router.ts 的 ROUTE_EVENT）
    const rendered = await c.waitUntil(async () => c.evaluate(`(document.querySelector('.layout') && !document.querySelector('.auth-wrap') && document.body.innerText.trim().length > 20 ? 'ok' : '')`), 8000); // 有内容且无登录卡片
    check(`live /${view} 免登录可用`, rendered === 'ok', `未渲染为可用页面`); // 功能可用
  } // 视图遍历结束
  // 聊天页不应停留在只读演示条
  await c.evaluate(`history.pushState(null,'','/chat'); window.dispatchEvent(new Event('mim:route')); 'ok'`); // 回到聊天
  const chatReady = await c.waitUntil(async () => c.evaluate(`(document.body.innerText.includes('只读演示') || document.body.innerText.includes('Read-only demo') ? '' : (document.querySelector('.chat-main') ? 'chat' : ''))`), 8000); // Chat 组件而非 ChatPreview
  check('live 聊天页为可收发状态（非只读演示）', chatReady === 'chat', '仍停留在只读演示'); // 聊天不再是门禁

  // 登录页：只有登录表单，不再出现「此功能需登录后使用」
  await c.send('Page.navigate', { url: BASE + 'signin' }); // 打开登录页
  const signin = await c.waitUntil(async () => c.evaluate(`(document.querySelector('.auth-wrap') ? 'form' : '')`), 10000); // 登录表单
  check('live 登录页展示登录表单', signin === 'form', '登录页未渲染表单'); // 登录仍可用（用于升级）
  const gateText = await c.evaluate(`(document.body.innerText.includes('此功能需登录后使用') ? 'leaked' : 'clean')`); // 全站文案检查
  check('live 登录页无「需登录」提示文案', gateText === 'clean', '旧门禁文案仍在页面'); // 免登录体验核心

  // 通过真实 API 注册 / 登录取正式会话（验证码通道在测试环境为开发态直返）
  let session = null; // 待注入的会话
  const phone = '138' + String(Date.now()).slice(-8); // 每次运行换号，避免命中发码限流
  const codeRes = await fetch(BASE + 'api/v1/auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region: 'cn', provider: 'phone', identifier: phone }) }); // 公开接口
  const codeData = await codeRes.json(); // 含 dev_code
  const loginRes = await fetch(BASE + 'api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region: 'cn', provider: 'phone', identifier: phone, code: String(codeData.dev_code ?? '') }) }); // 登录接口
  const loginData = await loginRes.json(); // 含 access_token / refresh_token / user
  if (loginData.access_token) session = { access_token: loginData.access_token, refresh_token: loginData.refresh_token, user: loginData.user }; // 只保留会话三字段
  check('live 真实 API 登录取到正式会话', !!session, `code=${codeRes.status} login=${loginRes.status}`); // 后续场景依赖它
  if (!session) { c.ws.close(); return; } // 提前收尾

  // 注入正式会话并回到原来需要登录的功能视图：原地可用，侧栏显示退出
  await c.evaluate(`localStorage.setItem('${SESSION_KEY}', ${JSON.stringify(JSON.stringify(session))}); 'ok'`); // 正式会话落盘
  await c.send('Page.navigate', { url: BASE + 'account' }); // 打开个人中心
  const upgraded = await c.waitUntil(async () => c.evaluate(`(document.querySelector('.layout') && !document.querySelector('.auth-wrap') && Array.from(document.querySelectorAll('.sidebar-footer button')).some((b) => b.textContent.includes('退出')) ? 'member' : '')`), 15000); // 正式账号：有退出按钮
  check('live 登录后升级为正式账号且功能保持可用', upgraded === 'member', '应显示退出按钮并保留个人中心'); // 登录是升级不是门禁
  // 退出登录后刷新，应再次自动进入免登录可用态
  await c.evaluate(`Array.from(document.querySelectorAll('.sidebar-footer button')).find((b) => b.textContent.includes('退出'))?.click(); 'ok'`); // 真实 handleLogout
  await c.waitUntil(async () => c.evaluate(`(!localStorage.getItem('${SESSION_KEY}') ? 'out' : '')`), 10000); // 等待会话清除
  await c.send('Page.navigate', { url: BASE + 'cart' }); // 重新加载购物车
  const reGuest = await c.waitUntil(async () => c.evaluate(`(() => { const raw = localStorage.getItem('${SESSION_KEY}'); if (!raw) return ''; try { const s = JSON.parse(raw); return s.user && s.user.is_guest === true && !document.querySelector('.auth-wrap') ? 'reguest' : ''; } catch { return ''; } })()`), 15000); // 再次自动建访客
  check('live 退出登录后重新加载自动回到免登录可用态', reGuest === 'reguest', '未再次自动建访客会话'); // 门禁不会回弹

  // 失效令牌：仍应展示失效提示（这是唯一保留的登录提示）
  const broken = { ...session, access_token: 'invalid.access.token', refresh_token: 'invalid.refresh.token' }; // 构造失效会话
  await c.evaluate(`localStorage.setItem('${SESSION_KEY}', ${JSON.stringify(JSON.stringify(broken))}); 'ok'`); // 失效态落盘
  await c.send('Page.navigate', { url: BASE + 'signin' }); // 打开登录页触发启动校验
  const expired = await c.waitUntil(async () => c.evaluate(`((document.querySelector('.auth-notice')?.textContent ?? '').includes('登录状态已失效') ? 'expired' : '')`), 15000); // 失效提示
  check('live 登录状态失效展示重登提示', expired === 'expired', '应显示「登录状态已失效」'); // 失效联动

  // 控制台错误与资源失败
  check('live 无未捕获异常', c.exceptions.length === 0, c.exceptions.join(' | ')); // 运行期健康
  check('live 无 console.error', c.consoleErrors.length === 0, c.consoleErrors.slice(0, 3).join(' | ')); // 运行期健康
  // 关闭连接
  c.ws.close(); // 释放 WebSocket
} // live 结束

// 执行浏览器实测：失败记为一条断言而不是让进程直接崩溃
if (LIVE) { // 仅在 --live 时执行
  try { // 服务或浏览器未就绪时仍需输出静态断言结果
    await live(); // 运行全部场景
  } catch (e) { // 捕获连接 / 断言链路异常
    check('live 浏览器实测完成', false, String(e)); // 记为失败
  } // try/catch 结束
} // LIVE 分支结束

// 汇总输出：逐项打印，并给出总数与通过数
let passed = 0; // 通过计数
for (const item of checks) { // 逐项输出
  // 标记
  const mark = item.ok ? 'PASS' : 'FAIL'; // 统一前缀便于 grep
  // 通过则累加
  if (item.ok) passed += 1; // 计数
  // 打印明细（失败时附 detail）
  console.log(`[${mark}] ${item.name}${item.ok || !item.detail ? '' : ' :: ' + item.detail}`); // 单行结果
} // 汇总结束
// 总结行
console.log(`\n=== 免登录体验校验：${passed}/${checks.length} 通过（${LIVE ? '静态 + 浏览器实测' : '静态断言'}）===`); // 便于 CI 日志
// 有失败即退出 1
process.exit(passed === checks.length ? 0 : 1); // 门禁语义
