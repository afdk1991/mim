// 聊天点击级 E2E：Edge CDP 真操作 UI —— 建群 / 发图片消息（气泡内预览）/ 撤回
// 只用 Node 22 内置 WebSocket / fetch，不引入第三方依赖。
//
// 可重放前置（三个进程，均为本地）：
//   1) MIM_JOBS=0 MIM_AI_WORKER=0 node services/mim-api/dist/index.js     # API :8787（需先 pnpm --filter @mim/api build）
//   2) node scripts/serve-local.mjs                                          # 静态站 :5188，同源反代 /api → :8787
//   3) msedge --headless=new --remote-debugging-port=9222 --user-data-dir=.tmp/edge-profile-chat about:blank
//   4) npm run verify:chat-flow
//
// 与「接口级契约测试」的区别：本脚本的建群、选成员、发图、撤回全部由页面 DOM 点击驱动（React onClick 真实触发），
// 断言读取的是页面渲染结果（会话标题、气泡内 <img> 的 naturalWidth、撤回后消息消失），而不是接口返回体。
// 产物：.tmp/chat-flow-e2e.json（断言明细）、.tmp/chat-flow-e2e.png（截图）；失败时退出码 1。
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path'; // 文件绝对路径（CDP 选文件只接受绝对路径）

mkdirSync('.tmp', { recursive: true }); // 新克隆仓库可能没有 .tmp 目录

const CDP = process.env.MIM_GATE_CDP || 'http://127.0.0.1:9222'; // Edge 调试端点
const PAGE = process.env.MIM_GATE_PAGE || 'http://127.0.0.1:5188'; // 本地静态站（同源反代 /api）
const API = process.env.MIM_GATE_API || 'http://127.0.0.1:8787/api/v1'; // 直连 API（只用于造登录态与第二个账号）
const SESSION_KEY = 'mim.session.v1'; // 前端会话存储键（与 apps/web 保持一致）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // 轮询间隔

/** 断言收集器：任一失败都会让脚本以 1 退出 */
const checks = [];
function check(name, ok, detail) { // 记录一条断言
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null }); // 入表
  if (!ok) process.exitCode = 1; // 失败标记
}

/** 等待浏览器 page target 就绪 */
async function getTarget() {
  for (let i = 0; i < 40; i += 1) { // 最多等 16 秒
    try {
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
  ws.addEventListener('open', res, { once: true }); // 打开
  ws.addEventListener('error', rej, { once: true }); // 失败
});

let seq = 0; // 命令序号
const pending = new Map(); // 待响应命令
const consoleErrors = []; // 页面控制台错误
ws.addEventListener('message', (ev) => { // 统一分发 CDP 消息
  const msg = JSON.parse(String(ev.data)); // 解析帧
  if (msg.id && pending.has(msg.id)) { // 命令响应
    pending.get(msg.id)(msg); // 唤醒等待方
    pending.delete(msg.id); // 清理
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') { // 仅收集 error 级别
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); // 记入
  }
});

/** 发送 CDP 命令并等响应 */
function send(method, params = {}) {
  const id = ++seq; // 递增序号
  return new Promise((resolve) => { // 等待同 id 响应
    pending.set(id, resolve); // 登记
    ws.send(JSON.stringify({ id, method, params })); // 发送
  });
}

/** 在页面上下文执行表达式，返回值走 JSON 序列化 */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); // 求值
  if (res.result?.exceptionDetails) throw new Error('页面脚本异常: ' + res.result.exceptionDetails.text); // 抛错
  return res.result?.result?.value; // 取值
}

/** 轮询直到表达式返回真值 */
async function waitFor(expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs; // 截止时间
  while (Date.now() < deadline) { // 轮询
    const value = await evaluate(expression); // 求值
    if (value) return value; // 命中即返回
    await sleep(300); // 间隔
  }
  return null; // 超时
}

/** 以 React 受控组件可感知的方式写入 input 值 */
const SET_INPUT = `(function (el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; // 原生 setter
  setter.call(el, value); // 写入
  el.dispatchEvent(new Event('input', { bubbles: true })); // 触发 React onChange
  return el.value; // 回读
})`;

/** 按选择器点击元素（真实 DOM 事件，触发 React onClick） */
async function click(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
}

/** 造登录态：走验证码通道拿 dev_code（本地/预览环境开启），返回令牌与用户信息 */
async function apiPost(path, body, token) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }); // 请求
  let json = null; // 响应体
  try { json = await res.json(); } catch { json = null; } // 容错解析
  return { status: res.status, body: json }; // 返回
}

/** 用手机号登录（首登自动注册），返回 access_token */
async function loginPhone(phone) {
  const code = await apiPost('/auth/code', { region: 'cn', provider: 'phone', identifier: phone, purpose: 'login' }); // 取验证码（provider 必填）
  const devCode = code.body?.dev_code; // 开发模式下直接返回
  if (!devCode) throw new Error('验证码通道未返回 dev_code（' + phone + '）'); // 前置缺失
  const login = await apiPost('/auth/login', { region: 'cn', provider: 'phone', identifier: phone, code: devCode, device: { platform: 'web', name: 'chat-e2e' } }); // 登录
  if (!login.body?.access_token) throw new Error('登录失败: ' + JSON.stringify(login).slice(0, 200)); // 前置缺失
  return login.body; // 令牌与用户
}

const stamp = String(Date.now()).slice(-6); // 本轮唯一后缀，避免群名重复
const groupName = 'E2E 群聊 ' + stamp; // 群名
const phoneA = '139' + String(Date.now()).slice(-8); // 发起人手机号（11 位）
const phoneB = '137' + String(Date.now() + 7).slice(-8); // 被邀请成员手机号（11 位，偏移避免同号）

await send('Runtime.enable'); // 打开运行时事件
await send('Page.enable'); // 打开页面事件

const sessionB = await loginPhone(phoneB); // 先注册成员账号
const sessionA = await loginPhone(phoneA); // 再注册发起人账号

// 媒体直传受模块权益门禁（comic.workbench 提供对象存储通道），E2E 前先免费解锁，否则发图会 403
const unlock = await fetch(API + '/entitlements', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sessionA.access_token, 'idempotency-key': 'chat-e2e-' + Date.now() }, body: JSON.stringify({ module_code: 'comic.workbench' }) }); // 解锁
check('解锁媒体通道（comic.workbench）', unlock.status === 200 || unlock.status === 201 || unlock.status === 409, 'HTTP ' + unlock.status); // 记录

// 注入发起人会话（跳过登录页，聚焦聊天交互本身）
await send('Page.navigate', { url: PAGE + '/chat' }); // 打开聊天页
await sleep(1200); // 等首帧
await evaluate(`localStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(JSON.stringify({ access_token: sessionA.access_token, refresh_token: sessionA.refresh_token, user: sessionA.user }))})`); // 写会话
await send('Page.reload'); // 重载带会话
check('会话注入成功', true, phoneA); // 记录

const ready = await waitFor(`!!document.querySelector('.chat-layout')`, 15000); // 等聊天骨架
check('进入聊天页并渲染聊天布局', Boolean(ready), PAGE + '/chat'); // 断言

// 1) 点击「+ 群聊」进入建群模式
const toggled = await click('.chat-new-group'); // 真点按钮
check('点击「+ 群聊」进入建群模式', toggled); // 断言
const formReady = await waitFor(`!!document.querySelector('.chat-group-form input')`, 5000); // 等建群表单
check('建群表单出现', Boolean(formReady)); // 断言

// 2) 搜索成员并勾选
const searched = await evaluate(`(function () {
  const el = document.querySelector('.chat-search input'); // 顶部搜索框
  if (!el) return false; // 缺失
  ${SET_INPUT}(el, ${JSON.stringify(phoneB)}); // 写入手机号
  return true;
})()`);
check('输入成员手机号', Boolean(searched), phoneB); // 断言
const picked = await waitFor(`(function () {
  if (document.querySelectorAll('.chat-user-item.picked').length > 0) return true; // 已勾选，幂等退出
  const item = document.querySelector('.chat-user-item'); // 首个结果
  if (!item) return false; // 还没出结果
  item.click(); // 勾选（只在未勾选时点一次，避免轮询反复点导致反选）
  return false; // 交给下一轮确认
})()`, 10000);
check('搜索结果出现并勾选成员', Boolean(picked)); // 断言

// 3) 填群名并点击「创建群聊」
const named = await evaluate(`(function () {
  const el = document.querySelector('.chat-group-form input'); // 群名输入
  if (!el) return false; // 缺失
  ${SET_INPUT}(el, ${JSON.stringify(groupName)}); // 写入群名
  return true;
})()`);
check('填写群名称', Boolean(named), groupName); // 断言
const created = await waitFor(`(function () {
  const title = (document.querySelector('.chat-header-title') || {}).textContent || ''; // 右侧会话标题
  if (title.includes(${JSON.stringify(groupName)})) return true; // 已建好，幂等退出
  const btn = Array.from(document.querySelectorAll('.chat-group-form .btn')).find((b) => b.textContent.includes('创建群聊')); // 建群按钮
  if (!btn || btn.disabled) return false; // 不可点
  btn.click(); // 点击
  return false; // 交给下一轮确认
})()`, 10000);
check('点击「创建群聊」', Boolean(created)); // 断言

const groupTitle = await waitFor(`(function () {
  const header = document.querySelector('.chat-header-title'); // 会话标题
  const text = header ? header.textContent : ''; // 取文本
  return text.includes(${JSON.stringify(groupName)}) ? text.slice(0, 60) : false; // 命中群名
})()`, 6000);
check('新群出现在会话区且标题为群名', Boolean(groupTitle), groupTitle || '标题未命中'); // 断言

// 4) 发图片：写一张最小 PNG 到磁盘，再用 CDP 塞进隐藏 file input（等价于用户选文件）
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=', 'base64'); // 8×8 PNG
const pngPath = process.env.MIM_E2E_PNG || '.tmp/chat-e2e.png'; // 本地路径
writeFileSync(pngPath, png); // 落盘（CDP 只能从磁盘选文件）
await send('DOM.enable'); // 打开 DOM 域
const doc = await send('DOM.getDocument', { depth: 1 }); // 取文档根
const inputNode = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' }); // 找隐藏 file input
check('定位到隐藏文件选择框', Boolean(inputNode.result?.nodeId)); // 断言
await send('DOM.setFileInputFiles', { nodeId: inputNode.result.nodeId, files: [resolve(pngPath)] }); // 选中文件（触发 onChange → 直传 → 发消息）

const imageBubble = await waitFor(`(function () {
  const img = document.querySelector('.chat-image img'); // 气泡内预览图
  if (!img) return false; // 还没渲染
  return img.complete && img.naturalWidth > 0 ? img.naturalWidth : false; // 真加载出像素
})()`, 20000);
check('图片消息在气泡内渲染出真实像素', Boolean(imageBubble), imageBubble ? 'naturalWidth=' + imageBubble : '未加载'); // 断言

// 5) 撤回刚发的图片消息
const recalled = await waitFor(`(function () {
  const btns = document.querySelectorAll('.chat-recall'); // 所有撤回按钮
  if (btns.length === 0) return false; // 没有可撤回消息
  btns[btns.length - 1].click(); // 点最后一条
  return true;
})()`, 8000);
check('点击消息气泡上的「撤回」', Boolean(recalled)); // 断言

const afterRecall = await waitFor(`(function () {
  const imgs = document.querySelectorAll('.chat-image'); // 图片气泡
  const msgs = document.querySelectorAll('.chat-msg'); // 消息条数
  return imgs.length === 0 ? 'recalled:' + msgs.length : false; // 图片气泡消失即视为撤回成功（返回字符串，避免 0 条被当成假值）
})()`, 10000);
check('撤回后图片气泡从列表移除', Boolean(afterRecall), afterRecall || '气泡仍在'); // 断言

// 6) 截图与结果落盘
const shot = await send('Page.captureScreenshot', { format: 'png' }); // 截图
if (shot.result?.data) writeFileSync('.tmp/chat-flow-e2e.png', Buffer.from(shot.result.data, 'base64')); // 落盘

check('页面无控制台 error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ')); // 断言

const failed = checks.filter((c) => !c.ok); // 失败项
writeFileSync('.tmp/chat-flow-e2e.json', JSON.stringify({ ok: failed.length === 0, total: checks.length, failed: failed.length, checks, console_errors: consoleErrors }, null, 2)); // 明细
for (const c of checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  [' + c.detail + ']' : '')); // 逐条打印
console.log('TOTAL=' + checks.length + ' FAILED=' + failed.length); // 汇总
ws.close(); // 收尾
if (failed.length > 0) process.exit(1); // 失败退出
