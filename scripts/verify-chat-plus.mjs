// 聊天增强点击级 E2E：边缘 CDP 真操作 UI —— 引用回复 / 文件下载 / 群管理（设管理员 + 加人）/ 搜索结果定位。
// 只用 Node 22 内置 WebSocket / fetch，不引入第三方依赖。
//
// 可重放前置（三个本地进程，与 verify-chat-flow 相同）：
//   1) MIM_JOBS=0 MIM_AI_WORKER=0 node services/mim-api/dist/index.js     # API :8787
//   2) node scripts/serve-local.mjs                                       # 静态站 :5188（同源反代 /api）
//   3) msedge --headless=new --remote-debugging-port=9222 --user-data-dir=<abs>/.tmp/edge-profile-chat about:blank
//   4) npm run verify:chat-plus
//
// 与接口契约测试的分工：本脚本的引用、加人、设管理员、搜索跳转全部由页面 DOM 点击驱动，
// 断言读取页面渲染结果（引用块文案、下载链接、角色标签、高亮类名），而不是接口返回体。
// 产物：.tmp/chat-plus-e2e.json（断言明细）、.tmp/chat-plus-e2e.png（截图）；失败时退出码 1。

import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('.tmp', { recursive: true }); // 新克隆仓库可能没有 .tmp 目录

const CDP = process.env.MIM_GATE_CDP || 'http://127.0.0.1:9222'; // Edge 调试端点
const PAGE = process.env.MIM_GATE_PAGE || 'http://127.0.0.1:5188'; // 本地静态站
const API = process.env.MIM_GATE_API || 'http://127.0.0.1:8787/api/v1'; // 直连 API（造账号 / 造消息 / 上传文件）
const SESSION_KEY = 'mim.session.v1'; // 前端会话存储键
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // 轮询间隔

/** 断言收集器：任一失败都会让脚本以 1 退出 */
const checks = []; // 断言明细
function check(name, ok, detail) { // 记录一条断言
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null }); // 入表
  if (!ok) process.exitCode = 1; // 失败标记
} // check 结束

/** 等待浏览器 page target 就绪 */
async function getTarget() {
  for (let i = 0; i < 40; i += 1) { // 最多等 16 秒
    try {
      const list = await (await fetch(CDP + '/json/list')).json(); // 取 target 列表
      const page = list.find((t) => t.type === 'page'); // 取第一个页面
      if (page) return page; // 命中即返回
    } catch { /* 浏览器尚未就绪 */ }
    await sleep(400); // 稍后重试
  } // 轮询结束
  throw new Error('Edge CDP 未就绪'); // 超时抛错
} // getTarget 结束

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
    return; // 响应处理完
  } // 响应分支结束
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') { // 仅收集 error 级别
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); // 记入
  } // 控制台分支结束
}); // 监听结束

/** 发送 CDP 命令并等响应 */
function send(method, params = {}) {
  const id = ++seq; // 递增序号
  return new Promise((resolve) => { // 等同 id 响应
    pending.set(id, resolve); // 登记
    ws.send(JSON.stringify({ id, method, params })); // 发送
  });
} // send 结束

/** 在页面上下文执行表达式，返回值走 JSON 序列化 */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); // 求值
  if (res.result?.exceptionDetails) throw new Error('页面脚本异常: ' + res.result.exceptionDetails.text); // 抛错
  return res.result?.result?.value; // 取值
} // evaluate 结束

/** 轮询直到表达式返回真值 */
async function waitFor(expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs; // 截止时间
  while (Date.now() < deadline) { // 轮询
    const value = await evaluate(expression); // 求值
    if (value) return value; // 命中即返回
    await sleep(300); // 间隔
  } // 循环结束
  return null; // 超时
} // waitFor 结束

/** 以 React 受控组件可感知的方式写入 input / textarea 值 */
const SET_VALUE = `(function (el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; // 按控件类型取原型
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; // 原生 setter
  setter.call(el, value); // 写入
  el.dispatchEvent(new Event('input', { bubbles: true })); // 触发 React onChange
  return el.value; // 回读
})`;

/** 按选择器点击元素（真实 DOM 事件，触发 React onClick） */
async function click(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
} // click 结束

/** 按「选择器 + 文案」点击（同一类按钮有多个时按文案挑） */
async function clickByText(selector, text) {
  return evaluate(`(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); // 候选
    const el = els.find((e) => e.textContent.includes(${JSON.stringify(text)})); // 文案匹配
    if (!el) return false; // 未命中
    el.click(); // 真实点击
    return true; // 成功
  })()`);
} // clickByText 结束

/** 写 input / textarea */
async function setValue(selector, value) {
  return evaluate(`(function () { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; return ${SET_VALUE}(el, ${JSON.stringify(value)}); })()`);
} // setValue 结束

/** API 请求助手 */
async function apiPost(path, body, token, idem) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(idem ? { 'idempotency-key': idem } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null; // 响应体
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json }; // 返回
} // apiPost 结束

/** 手机号验证码登录（首登自动注册） */
async function loginPhone(phone) {
  const code = await apiPost('/auth/code', { region: 'cn', provider: 'phone', identifier: phone, purpose: 'login' }); // 取 dev_code
  const devCode = code.body?.dev_code; // 开发模式直接返回
  if (!devCode) throw new Error('验证码通道未返回 dev_code'); // 前置缺失
  const login = await apiPost('/auth/login', { region: 'cn', provider: 'phone', identifier: phone, code: devCode, device: { platform: 'web', name: 'chat-plus-e2e' } }); // 登录
  if (!login.body?.access_token) throw new Error('登录失败: ' + JSON.stringify(login.body).slice(0, 200)); // 前置缺失
  return login.body; // 令牌与用户
} // loginPhone 结束

const stamp = String(Date.now()).slice(-6); // 唯一后缀
const groupName = 'E2E+ 群聊 ' + stamp; // 群名
const phoneA = '136' + String(Date.now()).slice(-8); // 发起人
const phoneB = '135' + String(Date.now() + 7).slice(-8); // 被引用消息的作者
const phoneC = '134' + String(Date.now() + 13).slice(-8); // 待邀请的新成员

await send('Runtime.enable'); // 打开运行时事件
await send('Page.enable'); // 打开页面事件

const sessionB = await loginPhone(phoneB); // 成员 B
const sessionC = await loginPhone(phoneC); // 待邀请 C
const sessionA = await loginPhone(phoneA); // 发起人 A

// 媒体直传受模块权益门禁，先免费解锁（与 verify-chat-flow 一致）
const unlock = await fetch(API + '/entitlements', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sessionA.access_token, 'idempotency-key': 'chat-plus-' + Date.now() },
  body: JSON.stringify({ module_code: 'comic.workbench' }),
});
check('解锁媒体通道（comic.workbench）', unlock.status === 200 || unlock.status === 201 || unlock.status === 409, 'HTTP ' + unlock.status);

// 造群与前置消息：群由 A 创建、B 先发一条「原始问题」，供 A 引用
const created = await apiPost('/im/conversations', { type: 'group', name: groupName, member_user_ids: [sessionB.user.id] }, sessionA.access_token, 'chat-plus-group-' + Date.now());
check('接口建群成功', created.status === 201, 'HTTP ' + created.status);
const conversationId = created.body?.conversation_id;
const bMessage = await apiPost(`/im/conversations/${conversationId}/messages`, { content_type: 'text', content: '原始问题：部署脚本在哪' }, sessionB.access_token, 'chat-plus-msg-' + Date.now());
check('成员 B 发出被引用消息', bMessage.status === 201, 'HTTP ' + bMessage.status);
const bMessageId = bMessage.body?.message?.id;

// 上传一个文本文件并发成文件消息，供文件下载断言使用
const presign = await apiPost('/media/presign/upload', { asset_type: 'text', mime: 'text/plain', size_bytes: 12 }, sessionA.access_token, 'chat-plus-up-' + Date.now());
check('申请文件直传凭证', presign.status === 200 || presign.status === 201, 'HTTP ' + presign.status);
console.log('presign response', presign.status, JSON.stringify(presign.body).slice(0, 240)); // 调试输出：确认响应字段名
const upload = presign.body?.upload; // 上传描述
const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: Buffer.from('mim-e2e-ok\n') }); // 直传字节
check('文件直传成功', put.ok, 'HTTP ' + put.status);
const fileMessage = await apiPost(
  `/im/conversations/${conversationId}/messages`,
  { content_type: 'file', object_key: presign.body.object_key, object_mime: 'text/plain', object_name: 'mim-e2e.txt', object_size: 12 },
  sessionA.access_token,
  'chat-plus-file-' + Date.now(),
);
check('文件消息落库', fileMessage.status === 201, 'HTTP ' + fileMessage.status);

// 注入发起人会话并打开聊天页
await send('Page.navigate', { url: PAGE + '/chat' });
await sleep(1200); // 等首帧
await evaluate(`localStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(JSON.stringify({ access_token: sessionA.access_token, refresh_token: sessionA.refresh_token, user: sessionA.user }))})`);
await send('Page.reload'); // 重载带会话
const ready = await waitFor(`!!document.querySelector('.chat-layout')`, 15000);
check('进入聊天页并渲染聊天布局', Boolean(ready), PAGE + '/chat');

// 打开测试群
const opened = await waitFor(`(() => {
  const items = Array.from(document.querySelectorAll('.chat-conv-item')); // 会话项
  const item = items.find((e) => e.textContent.includes(${JSON.stringify(groupName)})); // 按群名找
  if (!item) return false; // 还没加载出来
  if (document.querySelector('.chat-header-title') && document.querySelector('.chat-header-title').textContent.includes(${JSON.stringify(groupName)})) return true; // 已打开，幂等
  item.click(); // 点开会话
  return false; // 交给下一轮确认
})()`, 15000);
check('会话列表出现测试群并可点开', Boolean(opened));

// 1) 引用回复：点消息上的「引用」→ 输入框上方出现引用条 → 发送后气泡带引用块
const quoteClicked = await waitFor(`(() => {
  if (document.querySelector('.chat-reply-bar')) return true; // 已进入引用态
  const btn = document.querySelector('.chat-msg .chat-reply-btn'); // 第一条消息的引用按钮
  if (!btn) return false; // 消息还没渲染
  btn.click(); // 进入引用态
  return false; // 下一轮确认
})()`, 10000);
check('点击消息「引用」进入引用态', Boolean(quoteClicked));
const quoteText = await evaluate(`(() => { const bar = document.querySelector('.chat-reply-quote'); return bar ? bar.textContent.slice(0, 60) : ''; })()`);
check('引用条展示被引用内容', quoteText.includes('部署脚本在哪'), quoteText || '空');
await setValue('.chat-input textarea', '在 deploy/ 目录，脚本是 deploy/release.sh');
await click('.chat-input .btn.primary'); // 发送
const quotedBubble = await waitFor(`(() => {
  const bubbles = Array.from(document.querySelectorAll('.chat-msg.mine .chat-msg-quote')); // 自己的引用块
  const hit = bubbles.find((b) => b.textContent.includes('部署脚本在哪')); // 命中被引用原文
  return hit ? hit.textContent.slice(0, 60) : false; // 返回文案
})()`, 10000);
check('引用回复气泡内渲染引用块', Boolean(quotedBubble), quotedBubble || '未出现');
const quoteCleared = await waitFor(`!(document.querySelector('.chat-reply-bar'))`, 5000);
check('发送后引用态自动清除', Boolean(quoteCleared));

// 2) 文件消息：气泡内有下载按钮且链接可访问
const fileBubble = await waitFor(`(() => {
  const link = document.querySelector('.chat-file-download'); // 下载入口
  return link ? link.getAttribute('href') : false; // 返回直链
})()`, 15000);
check('文件气泡渲染下载按钮', Boolean(fileBubble), fileBubble ? 'href=' + String(fileBubble).slice(0, 40) : '未出现');
if (fileBubble) {
  const dl = await fetch(fileBubble); // 真访问下载直链
  check('下载直链可访问（HTTP 200）', dl.ok, 'HTTP ' + dl.status);
} // 文件校验结束

// 3) 群管理：打开群信息 → 设管理员 → 邀请新成员
await clickByText('.chat-header .btn', '群信息');
const panelOpen = await waitFor(`!!document.querySelector('.chat-panel')`, 8000);
check('打开群信息面板', Boolean(panelOpen));
const rowsReady = await waitFor(`document.querySelectorAll('.chat-member-chip').length >= 2`, 10000);
check('群成员列表加载完成', Boolean(rowsReady));
const promoted = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('.chat-member-chip')); // 成员行
  const row = rows.find((r) => (r.querySelector('.chat-member-role') || {}).textContent !== '群主' && Array.from(r.querySelectorAll('button')).some((b) => b.textContent.includes('设管理员'))); // 首个非群主成员行（按角色列判定，避免「转让群主」按钮文案干扰）
  if (!row) return false; // 未找到可提升成员
  const btn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent.includes('设管理员')); // 提升按钮
  btn.click(); // 提升
  return true; // 点击成功
})()`);
check('群主点击「设管理员」', Boolean(promoted));
const roleLabel = await waitFor(`(() => {
  const roles = Array.from(document.querySelectorAll('.chat-member-role')); // 仅角色标签列
  return roles.some((r) => r.textContent.trim() === '管理员') ? 'admin' : false; // 角色标签已更新
})()`, 10000);
check('成员角色标签更新为管理员', Boolean(roleLabel));

await setValue('.chat-panel-block input', phoneC); // 搜索待邀请成员
const candidateClicked = await waitFor(`(() => {
  if (document.querySelector('.chat-panel-block .chat-user-item.picked')) return true; // 已勾选，幂等退出
  const items = Array.from(document.querySelectorAll('.chat-panel-block .chat-user-item')); // 候选行
  const item = items[0]; // 取首个候选（展示名可能为空，按位置取）
  if (!item) return false; // 还没出结果
  item.click(); // 勾选一次
  return false; // 交给下一轮确认勾选态
})()`, 10000);
check('加人搜索命中待邀请成员并勾选', Boolean(candidateClicked));
const invited = await waitFor(`(() => {
  const rows = Array.from(document.querySelectorAll('.chat-panel-row')); // 面板信息行
  if (rows.some((r) => r.textContent.includes('成员 3 人'))) return true; // 已经是 3 人，幂等退出
  const btn = Array.from(document.querySelectorAll('.chat-panel-block .btn')).find((b) => b.textContent.includes('邀请入群')); // 邀请按钮
  if (!btn || btn.disabled) return false; // 未勾选 / 按钮未就绪
  btn.click(); // 触发邀请
  return false; // 下一轮确认成员数
})()`, 12000);
check('邀请后群成员数变为 3', Boolean(invited));
console.log('invite debug', JSON.stringify(await evaluate(`(() => ({
  rows: Array.from(document.querySelectorAll('.chat-panel-row')).map((r) => r.textContent.trim()), // 面板信息行
  chips: document.querySelectorAll('.chat-member-chip').length, // 成员行数
  picked: document.querySelectorAll('.chat-panel-block .chat-user-item.picked').length, // 已勾选数
  error: (document.querySelector('.chat-error') || {}).textContent || '', // 面板错误提示
}))()`)));

// 4) 会话内搜索定位：搜索关键词 → 点结果 → 目标消息高亮
await setValue('.chat-msg-search', '部署脚本');
await evaluate(`(() => {
  const el = document.querySelector('.chat-msg-search'); // 搜索框
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); // 模拟回车触发搜索
  return true; // 已派发
})()`);
const resultBar = await waitFor(`!!document.querySelector('.chat-msg-result-bar')`, 8000);
check('搜索结果条出现', Boolean(resultBar));
const jumped = await waitFor(`(() => {
  if (document.querySelector('.chat-msg.highlight')) return true; // 已高亮
  const btn = document.querySelector('.chat-msg-result-item'); // 第一条结果
  if (!btn) return false; // 还没结果
  btn.click(); // 点击定位
  return false; // 下一轮确认高亮
})()`, 10000);
check('点击搜索结果定位并高亮目标消息', Boolean(jumped));

// 截图与结果落盘
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) writeFileSync('.tmp/chat-plus-e2e.png', Buffer.from(shot.result.data, 'base64'));
check('页面无控制台 error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
writeFileSync('.tmp/chat-plus-e2e.json', JSON.stringify({ checks, conversationId, bMessageId: bMessageId ?? null }, null, 2));
for (const c of checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  [' + c.detail + ']' : ''));
const failed = checks.filter((c) => !c.ok).length; // 失败数
console.log('TOTAL=' + checks.length + ' FAILED=' + failed);
ws.close(); // 收尾关闭连接
