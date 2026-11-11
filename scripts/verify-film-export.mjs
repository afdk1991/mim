// 成片导出 E2E：Edge CDP 真渲染验证（登录 → 造真实数据 → 成片页 → 导出面板 → 转码降级 → 下载链接）
// 只用 Node 22 内置 WebSocket / fetch，不引入第三方依赖。
//
// 可重放前置（三个进程，均为本地）：
//   1) MIM_JOBS=0 MIM_AI_WORKER=0 node services/mim-api/dist/index.js     # API :8787（需先 pnpm --filter @mim/api build）
//   2) node scripts/serve-local.mjs                                          # 静态站 :5188，同源反代 /api → :8787
// 本地步骤 3) 启动无头 Edge：msedge --headless=new --remote-debugging-port=9222 --user-data-dir=.tmp/edge-profile-export about:blank
// 本地步骤 4) 执行成片导出 E2E：npm run verify:film-export
// 产物：.tmp/film-export-e2e.json（断言明细）、.tmp/film-export-e2e.png（截图）；失败时退出码 1。
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('.tmp', { recursive: true }); // 新克隆仓库可能没有 .tmp 目录，先建再写取证文件

const CDP = 'http://127.0.0.1:9222'; // Edge 调试端口
const BASE = 'http://127.0.0.1:5188'; // 本地静态站（同源反代 /api 到 8787）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // 轮询间隔

async function getTarget() { // 等待浏览器 page target 就绪
  for (let i = 0; i < 30; i += 1) {
    try { // CDP 可能尚未监听
      const list = await (await fetch(CDP + '/json/list')).json(); // 取 target 列表
      const page = list.find((t) => t.type === 'page'); // 取第一个页面
      if (page) return page; // 命中即返回
    } catch { /* 浏览器尚未就绪 */ }
    await sleep(400); // 稍后重试
  }
  throw new Error('Edge CDP 未就绪'); // 超时抛错
}

const target = await getTarget(); // 取调试目标
const ws = new WebSocket(target.webSocketDebuggerUrl); // 建立 CDP WebSocket
await new Promise((res, rej) => { // 等连接打开
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0; // 命令序号
const pending = new Map(); // 待响应命令
const consoleErrors = []; // 页面控制台错误
const exceptions = []; // 未捕获异常
ws.addEventListener('message', (ev) => { // 统一分发 CDP 消息
  const msg = JSON.parse(String(ev.data)); // 解析帧
  if (msg.id && pending.has(msg.id)) { // 命令响应
    pending.get(msg.id)(msg); // 唤醒等待方
    pending.delete(msg.id); // 清理
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') { // 控制台 error
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text); // 运行时异常
});

function send(method, params = {}) { // 发送 CDP 命令
  const id = ++seq; // 递增序号
  return new Promise((resolve) => { // 等待同 id 响应
    pending.set(id, resolve); // 登记
    ws.send(JSON.stringify({ id, method, params })); // 发送
  });
}

async function evaluate(expression) { // 在页面求值，返回字符串或 null
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); // 允许 await Promise
  if (r.result?.exceptionDetails) return null; // 上下文销毁或脚本异常，交给重试
  const v = r.result?.result?.value; // 取返回值
  return typeof v === 'string' ? v : null; // 统一按字符串处理
}

async function waitUntil(fn, timeout = 12000) { // 轮询直到条件成立
  const start = Date.now(); // 起始时间
  while (Date.now() - start < timeout) { // 限时
    const v = await fn(); // 求值
    if (v) return v; // 命中返回
    await sleep(120); // 稍后重试
  }
  return null; // 超时返回 null
}

const checks = []; // 断言结果收集
function check(name, ok, detail = '') { // 记录一条断言
  checks.push({ name, ok: Boolean(ok), detail }); // 入表
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); // 实时输出
}

await send('Page.enable'); // 启用页面域
await send('Runtime.enable'); // 启用运行时域
await send('Log.enable'); // 启用日志域
await send('Network.enable'); // 启用网络域
await send('Network.setCacheDisabled', { cacheDisabled: true }); // 禁用缓存，确保加载本次构建产物

// 1) 打开站点并等待页面可求值（数据准备在此页面上完成）
await send('Page.navigate', { url: BASE + '/' }); // 导航首页
await waitUntil(() => evaluate(`document.body.innerText.includes('Mim') ? 'ready' : null`)); // 等 React 挂载

// 2) 页面内走真实 API：登录 → 自助解锁 → 建工程/分镜/compose/成片 → 写会话
const prepare = await evaluate(`(async () => {
  const phone = '139' + Math.floor(10000000 + Math.random() * 89999999);
  const j = async (path, opts = {}) => {
    const res = await fetch('/api/v1' + path, opts);
    const text = await res.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  };
  const post = (path, body, token, key) => j(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });
  let n = 0; const K = () => 'e2e-export-' + Date.now() + '-' + (++n);
  const code = await post('/auth/code', { region: 'cn', provider: 'phone', identifier: phone });
  if (code.status !== 201) return JSON.stringify({ ok: false, step: 'code', code });
  const login = await post('/auth/login', { region: 'cn', provider: 'phone', identifier: phone, code: code.body.dev_code, device: { platform: 'web', name: 'e2e' } });
  if (login.status !== 200) return JSON.stringify({ ok: false, step: 'login', login });
  const token = login.body.access_token;
  localStorage.setItem('mim.session.v1', JSON.stringify({ access_token: token, refresh_token: login.body.refresh_token, user: login.body.user }));
  const unlock = await post('/entitlements', { module_code: 'comic.workbench' }, token, K());
  const project = await post('/comic/projects', { title: 'E2E 导出工程' }, token, K());
  if (project.status !== 201) return JSON.stringify({ ok: false, step: 'project', project, unlock });
  const pid = project.body.project.id;
  const story = await post('/comic/projects/' + pid + '/storyboard', { shots: [{ index: 1, description: '开场镜头' }], confirm: true }, token, K());
  const job = await post('/comic/projects/' + pid + '/jobs', { job_type: 'compose' }, token, K());
  const jid = job.body.job.id;
  await post('/comic/jobs/' + jid + '/start', {}, token, K());
  const done = await post('/comic/jobs/' + jid + '/complete', { result: { object_key: 'films/e2e-export-demo.mp4' } }, token, K());
  const film = await post('/comic/projects/' + pid + '/films', { title: 'E2E 导出成片', object_key: 'films/e2e-export-demo.mp4' }, token, K());
  return JSON.stringify({ ok: film.status === 201, phone, unlock: unlock.status, story: story.status, done: done.status, film: film.status, filmId: film.body.film?.id });
})()`);
const prep = prepare ? JSON.parse(prepare) : null; // 解析准备结果
check('真实 API 登录 + 解锁 + 造出成片', prep?.ok, prepare ?? 'no result'); // 断言数据准备
const boot = await evaluate(`JSON.stringify({ title: document.title, root: !!document.querySelector('#root'), inner: document.body.innerText.slice(0, 60) })`); // 首页渲染快照
check('首页真实渲染（#root + title）', boot && JSON.parse(boot).root && JSON.parse(boot).title.includes('Mim'), boot ?? 'no boot'); // 断言挂载

// 3) 进入 /comic-studio（history 路径路由，漫剧 AI 剧的对外模块功能名），选中工程，切到成片标签
await send('Page.navigate', { url: BASE + '/comic-studio' }); // 直达深链接
const workbench = await waitUntil(() => evaluate(`document.body.innerText.includes('漫剧 AI 剧工作台') ? JSON.stringify({ ok: true, text: document.body.innerText.slice(0, 300) }) : null`)); // 等 React 与列表
check('/comic-studio 深链接真实渲染', workbench && JSON.parse(workbench).ok, workbench ? JSON.parse(workbench).text.slice(0, 80) : 'no render'); // 断言深链接

const selected = await waitUntil(() => evaluate(`(() => {
  const rows = [...document.querySelectorAll('li.list-item')].filter(e => e.textContent?.includes('E2E 导出工程'));
  const el = rows.pop(); // 取本轮最新创建的工程，避免命中历史同名行
  if (!el) return null;
  el.click();
  return JSON.stringify({ ok: true, text: el.textContent?.slice(0, 40) });
})()`)); // 点击工程行（onClick 绑在 li 上）
check('选中 E2E 工程', Boolean(selected), selected ?? 'project row missing'); // 断言选中

const filmsTab = await waitUntil(() => evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '成片');
  if (!btn) return null;
  btn.click();
  return JSON.stringify({ ok: true });
})()`)); // 切成片标签
check('切换到「成片」标签', Boolean(filmsTab)); // 断言切换

const filmRow = await waitUntil(() => evaluate(`(() => {
  const ok = document.body.innerText.includes('E2E 导出成片');
  const exportBtns = [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === '导出').length;
  return ok && exportBtns > 0 ? JSON.stringify({ ok, exportBtns }) : null;
})()`)); // 等成片行与导出入口真正出现
check('成片列表渲染且出现「导出」按钮', filmRow && JSON.parse(filmRow).ok && JSON.parse(filmRow).exportBtns > 0, filmRow ?? 'no film row'); // 断言导出入口

// 4) 展开导出面板，选 mov/720p 触发转码不可用降级
const opened = await waitUntil(() => evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '导出');
  if (!btn) return null;
  btn.click();
  return JSON.stringify({ ok: true });
})()`)); // 展开面板
const panel = await waitUntil(() => evaluate(`(() => {
  const ok = document.body.innerText.includes('导出成片') && document.querySelectorAll('select[aria-label="导出格式"]').length === 1;
  const hint = document.body.innerText.includes('MP4 / 1080p 可直接下载原片');
  return ok && hint ? JSON.stringify({ ok, hint }) : null;
})()`)); // 等面板与能力说明真正出现
check('导出面板真实渲染（选项 + 能力说明）', opened && panel && JSON.parse(panel).ok && JSON.parse(panel).hint, panel ?? 'no panel'); // 断言面板

const setSelect = `(label, value) => {
  const el = document.querySelector('select[aria-label="' + label + '"]');
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`; // React 受控 select 需用原生 setter 触发
const picked = await evaluate(`(() => { const f = ${setSelect}; return JSON.stringify({ a: f('导出格式', 'mov'), b: f('导出分辨率', '720p') }); })()`); // 选转码参数
check('选择 MOV / 720p', picked && JSON.parse(picked).a && JSON.parse(picked).b, picked ?? 'no selects'); // 断言选择

const triggered = await waitUntil(() => evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('生成下载链接'));
  if (!btn) return null;
  btn.click();
  return JSON.stringify({ ok: true });
})()`)); // 发起导出
const degraded = await waitUntil(() => evaluate(`(() => {
  const ok = document.body.innerText.includes('服务器未配置转码');
  const fallback = [...document.querySelectorAll('button')].some(b => b.textContent?.includes('直接下载原片'));
  return ok && fallback ? JSON.stringify({ ok, fallback }) : null;
})()`)); // 等降级 UI 真正出现
check('转码不可用时展示本地化降级入口', triggered && degraded && JSON.parse(degraded).ok && JSON.parse(degraded).fallback, degraded ?? 'no degrade UI'); // 断言降级

// 5) 点击一键降级，断言拿到真实预签名下载链接
const fallbackClicked = await waitUntil(() => evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('直接下载原片'));
  if (!btn) return null;
  btn.click();
  return JSON.stringify({ ok: true });
})()`)); // 一键降级
const link = await waitUntil(() => evaluate(`(() => {
  const a = [...document.querySelectorAll('a')].find(x => x.textContent?.trim() === '下载成片');
  if (!a) return null;
  return JSON.stringify({ href: a.getAttribute('href'), meta: a.parentElement?.innerText ?? '', visible: a.getBoundingClientRect().width > 0 });
})()`)); // 等下载入口
const linkInfo = link ? JSON.parse(link) : null; // 解析链接
check('原片直下成功，生成可见下载链接', fallbackClicked && linkInfo?.href?.includes('/api/v1/media/objects/') && linkInfo?.href?.includes('e2e-export-demo.mp4') && linkInfo?.visible, linkInfo?.href ?? 'no link'); // 断言链接
check('结果元信息含版本/格式/原片直下', linkInfo?.meta?.includes('v1') && linkInfo?.meta?.includes('MP4') && linkInfo?.meta?.includes('1080p') && linkInfo?.meta?.includes('原片直下'), linkInfo?.meta ?? 'no meta'); // 断言元信息
const formState = await evaluate(`JSON.stringify({ format: document.querySelector('select[aria-label="导出格式"]')?.value, resolution: document.querySelector('select[aria-label="导出分辨率"]')?.value })`); // 降级后的表单状态
const form = formState ? JSON.parse(formState) : null; // 解析
check('降级后表单回写实际格式/分辨率', form?.format === 'mp4' && form?.resolution === '1080p', formState ?? 'no form'); // 断言交互一致性

// 6) 布局与控制台健康
const layout = await evaluate(`JSON.stringify({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, exportPanelCount: [...document.querySelectorAll('h3')].filter(h => h.textContent === '导出成片').length, title: document.title })`); // 布局快照
const layoutInfo = layout ? JSON.parse(layout) : null; // 解析
check('页面无横向溢出（CSS/Layout）', layoutInfo && layoutInfo.scrollW <= layoutInfo.clientW + 1, layout ?? 'no layout'); // 断言布局
check('浏览器控制台零错误 / 零异常', consoleErrors.length === 0 && exceptions.length === 0, `errors=${consoleErrors.length} exceptions=${exceptions.length} ${consoleErrors.slice(0, 2).join(' | ')}`); // 断言健康

// 7) 截图留证
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); // 截图
if (shot.result?.data) writeFileSync('.tmp/film-export-e2e.png', Buffer.from(shot.result.data, 'base64')); // 落盘

const passed = checks.filter((c) => c.ok).length; // 通过数
const summary = { passed, total: checks.length, checks, consoleErrors, exceptions, screenshot: '.tmp/film-export-e2e.png' }; // 汇总
writeFileSync('.tmp/film-export-e2e.json', JSON.stringify(summary, null, 2)); // 落盘证据
console.log(`\n=== 成片导出 E2E：${passed}/${checks.length} 通过 ===`); // 汇总输出
ws.close(); // 关闭调试连接
process.exit(passed === checks.length ? 0 : 1); // 以退出码表达结果
