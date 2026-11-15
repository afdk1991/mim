#!/usr/bin/env node
/**
 * scripts/verify-auth-gate.mjs
 * 鉴权边界回归校验（2026-11-15 口径）：匿名可读、写操作需登录、注册已关闭、无访客自动建号。
 *
 * 唯一真源：services/mim-api/src/middleware.ts 的 FORCE_LOGIN_* 与 ANONYMOUS_READ_* 常量。
 *   1. 匿名可读：白名单内的 GET / HEAD / OPTIONS 直接 200，不需要任何令牌；
 *   2. 写操作：同一路径的 POST / PUT / PATCH / DELETE 一律 401，白名单不能把写带出去；
 *   3. 注册已关闭：POST /api/v1/auth/register 返回 403 + AUTH_REGISTER_DISABLED；
 *   4. 无访客建号：/api/v1/auth/guest 不可用（路由已删除 → 404；或仅保留硬拒桩 → 403 AUTH_REGISTER_DISABLED），前端也不再调用；
 *   5. 后台边界：/api/v1/admin/* 不参与全站强制登录，但仍由 requirePermission 兜底 401；
 *   6. 深链接与刷新：路径路由 + 构建期 404.html / 平台 navigationFallback 回退。
 *
 * 校验分两层：
 *   - 静态断言：直接读源码与构建配置，零依赖、失败可定位到具体契约；
 *   - 运行时断言：用 @mim/api 自带的 tsx 在本进程内起一次性 API（内存库 + 随机端口），
 *     真实发请求核对状态码，避免「源码看着对、实际返回错」。
 *
 * 用法：node scripts/verify-auth-gate.mjs
 */
// 文件读取：静态断言直接读仓库源码，不依赖构建产物
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
// 路径拼接：统一以 cwd 为根，便于在仓库根或 CI 工作目录执行
import { join } from 'node:path';
// 子进程：tsx 启动内置 API，取得真实 HTTP 证据
import { spawnSync } from 'node:child_process';

// 仓库根目录：脚本由 npm run verify:auth-gate 在根执行
const ROOT = process.cwd(); // 不做 __dirname 推导，保持与其余 verify 脚本一致
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

// ---------- 1. 后端门禁：匿名可读白名单只放安全方法 ---------- //
const mw = read('services/mim-api/src/middleware.ts'); // 全站强制登录与匿名读白名单
const appServer = read('services/mim-api/src/app.ts'); // 中间件挂载顺序

// 安全方法集合必须是读语义，写方法不得进入白名单
check(
  '后端 SAFE_METHODS 仅含 GET / HEAD / OPTIONS',
  /const SAFE_METHODS = new Set\(\['GET', 'HEAD', 'OPTIONS'\]\)/.test(mw),
  '安全方法集合漂移，写方法可能被匿名放行',
);
// isAnonymousRead 必须在方法判定处直接拒绝写请求
check(
  '后端 isAnonymousRead 拒绝非安全方法',
  /function isAnonymousRead[\s\S]{0,220}?!SAFE_METHODS\.has\(method\.toUpperCase\(\)\)[\s\S]{0,40}?return false/.test(mw),
  '匿名读判定未先校验方法，POST/PUT/DELETE 可能漏过',
);
// 匿名可读精确路径：漏一条就意味着对应公开页面直接 401
const ANON_PATHS = [
  '/api/v1/community/home-setting',
  '/api/v1/community/recommend-weights',
  '/api/v1/community/overview',
  '/api/v1/community/boards',
  '/api/v1/community/threads',
  '/api/v1/vip/plans',
  '/api/v1/vip/prices',
  '/api/v1/shop/products',
  '/api/v1/content/items',
  '/api/v1/announcements',
  '/api/v1/changelog',
  '/api/v1/changelog/versions',
  '/api/v1/promotions',
];
// 正则转义：白名单路径里含 '/' 等字符，交给 RegExp 前必须先转义
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 仅转义正则元字符
} // escapeRe 结束

// 逐条核对，失败时能直接报出缺失路径；要求是真实条目而不是被注释掉的一行
for (const path of ANON_PATHS) {
  check(
    `匿名读白名单登记 ${path}`,
    new RegExp(`^\\s*'${escapeRe(path)}',`, 'm').test(mw),
    '该公开读接口已从白名单丢失或被注释掉',
  );
}
// 带路径参数的公开读：正则少一条就会让详情页 / 图库 / 自定义页 401
const ANON_PATTERNS = [
  '/^\\/api\\/v1\\/community\\/boards\\/[^/]+\\/tabs$/',
  '/^\\/api\\/v1\\/community\\/threads\\/[^/]+$/',
  '/^\\/api\\/v1\\/community\\/threads\\/[^/]+\\/attachments\\/[^/]+\\/download$/',
  '/^\\/api\\/v1\\/community\\/gallery\\/items$/',
  '/^\\/api\\/v1\\/community\\/gallery\\/collections$/',
  '/^\\/api\\/v1\\/pages\\/[^/]+$/',
];
// 逐条核对正则文本，避免被随手删掉
for (const pattern of ANON_PATTERNS) {
  check(`匿名读白名单登记正则 ${pattern}`, mw.includes(pattern), '带参数公开读接口已从白名单丢失');
}
// 公开路径：健康检查与登录页渲染所需的公开元数据
for (const path of ['/api/v1/healthz', '/api/v1/site/config', '/api/v1/security/status']) {
  check(`强制登录公开路径 ${path}`, mw.includes(`'${path}'`), '登录页 / 探活依赖的公开路径被移除');
}
// 登录链路公开，后台改由 requirePermission 单独兜底
check(
  '强制登录公开前缀含 auth 与 admin',
  mw.includes("'/api/v1/auth/'") && mw.includes("'/api/v1/admin/'"),
  '登录链路或后台前缀不再豁免，会与路由内鉴权重复拦截',
);
// 支付回调只允许 POST，不能顺手把 GET 也放出去
check(
  '支付回调仅 POST 免登录',
  /method === 'POST' && PAYMENT_NOTIFY_PATHS\.some/.test(mw),
  '支付回调的免登录条件未限定 POST',
);
// 中间件必须真实挂到 /api/v1 上，常量再对不挂载也没用
check(
  'app 挂载全站强制登录中间件',
  appServer.includes("app.use('/api/v1', createForceLoginMiddleware())"),
  'createForceLoginMiddleware 未挂载到 /api/v1',
);

// ---------- 2. 注册已关闭 + 无访客建号 ---------- //
const authRoute = read('services/mim-api/src/routes/auth.ts'); // 登录 / 注册路由
// 注册关闭必须有显式闸门与专用错误码
check(
  '后端注册关闭闸门存在',
  authRoute.includes('assertRegistrationEnabled') && authRoute.includes('AUTH_REGISTER_DISABLED'),
  '注册关闭闸门或错误码缺失',
);
// 错误码必须是 403，避免被当成参数错误
check(
  '错误码 AUTH_REGISTER_DISABLED 为 403',
  /AUTH_REGISTER_DISABLED:\s*403/.test(read('packages/core-domain/src/errors.ts')),
  '注册关闭错误码状态位漂移',
);
// 访客建号必须没有实现：路由已整体删除，或仅保留「注册关闭」硬拒桩（任何情况下都不得落库建号）
const guestRouteDefined = authRoute.includes("'/auth/guest'");
check(
  '后端无访客自动建号实现',
  !guestRouteDefined || /\/auth\/guest[\s\S]{0,400}?AUTH_REGISTER_DISABLED/.test(authRoute),
  '访客建号路由仍在且没有走注册关闭硬拒',
);
// 渠道能力必须如实告诉前端注册已关闭
check(
  '渠道能力上报 register=false',
  /register:\s*isRegistrationEnabled\(/.test(authRoute),
  '/auth/channels 未按注册开关上报能力',
);

// ---------- 3. 前端：不再自动建号，匿名可读、写操作引导登录 ---------- //
const appWeb = read('apps/web/src/App.tsx'); // Web 根组件
const apiClient = [
  read('apps/web/src/api.ts'),
  read('apps/web/src/api/request.ts'),
  read('apps/web/src/api/endpoints.ts'),
  read('apps/web/src/api/types.ts'),
].join('\n'); // 聚合拆分后的全部 API 客户端源码

check('前端不再自动领取访客会话', !appWeb.includes('ensureGuestSession'), '仍存在启动自动建访客号的钩子');
check('前端客户端无 /auth/guest 封装', !apiClient.includes("'/auth/guest'") && !apiClient.includes('"/auth/guest"'), '仍保留访客建号请求');
check('前端启动清理历史访客会话', /session\?\.user\.is_guest\) clearSession\(\)/.test(appWeb), '旧访客会话未被作废，会残留半登录态');
check('匿名可读社区不跳登录', /route\.view === 'community'\) return/.test(appWeb), '社区列表 / 帖子详情被误加登录门禁');
check(
  '需要身份的视图集中登记',
  /const needsSession =\s*route\.view === 'account' \|\|[\s\S]{0,160}?route\.view === 'circles'[\s\S]{0,160}?route\.view === 'checkout'[\s\S]{0,160}?route\.view === 'payreturn'/.test(appWeb),
  'needsSession 口径漂移（应只剩 account / circles / checkout / payreturn）',
);
check('未登录写操作跳登录页并记住来源', appWeb.includes('rememberLoginNext') && appWeb.includes("go({ view: 'login' })"), '登录守卫缺失，写操作会静默失败');
check('退出登录回到匿名可读社区', /go\(\{ view: 'community' \}\)/.test(appWeb), '退出后落点不是匿名可读页面');
check("登录提示只保留 'expired' 态", appWeb.includes("useState<'expired' | null>(null)") && !appWeb.includes("'required' | 'expired'"), '「需登录」旧提示类型仍在');
check('前端展示注册已关闭说明', appWeb.includes('注册已关闭'), '登录页缺少注册关闭说明');
check('App 订阅会话变更事件', appWeb.includes('SESSION_CHANGED_EVENT'), '缺少登录 / 退出 / 失效事件订阅');
check('App 启动静默校验会话', appWeb.includes('verifySession'), '缺少 /me 启动校验');
check('api 提供 /me 静默校验', apiClient.includes('export async function verifySession') && apiClient.includes("request<MeResponse>('/me'"), '启动校验必须打受保护接口');
check('api 失效时广播重登提示', apiClient.includes("clearSession('expired')"), '401 续期失败必须触发失效广播');
check('api 监听跨标签页 storage', apiClient.includes("addEventListener('storage'"), '其它标签页退出需同步');

// 登录页不得再出现旧的「功能门禁」文案（注册关闭是唯一提示）
const loginView = read('apps/web/src/views/Login.tsx'); // 登录页
check('登录页无「此功能需登录」旧口径', !loginView.includes('此功能需登录'), '旧功能门禁文案仍在');
check('登录页无「全站已锁定」旧口径', !loginView.includes('全站已锁定'), '旧整站锁定文案仍在');

// ---------- 4. 后台鉴权边界不受匿名读影响 ---------- //
const adminApp = read('apps/admin/src/App.tsx'); // 后台根组件
const adminRoute = read('services/mim-api/src/routes/admin.ts'); // 后台路由
const shopAdminRoute = read('services/mim-api/src/routes/shop-admin.ts'); // 商城后台路由
check('后台无凭证时渲染登录页', /if \(!credential\) return <Login/.test(adminApp), '后台未拦住无凭证访问');
check('后台 401 自动退出登录态', /error\.status === 401/.test(adminApp), '后台令牌失效未回登录页');
check(
  '后台接口逐个 requirePermission',
  adminRoute.includes("requirePermission('rbac:read')") && shopAdminRoute.includes('requirePermission('),
  '后台接口缺少路由级权限校验，匿名读前缀会变成缺口',
);

// ---------- 5. 深链接与刷新 ---------- //
const router = read('apps/web/src/router.ts'); // 路径路由
check('router 使用 history 路由', router.includes('pushState') && router.includes('popstate'), '缺少 pushState / popstate');
check('router 推断子路径部署前缀', router.includes('baseOf') && router.includes('import.meta.url'), '缺少 baseOf / import.meta.url');
check('router 兼容旧 hash 链接', router.includes('location.hash') && router.includes('replaceState'), '缺少旧 hash 原地改写');
check(
  'router 视图段完整',
  /login: 'signin'/.test(router) && router.includes('community:') && router.includes('account:'),
  'VIEW_SEGMENTS 视图段缺失',
);
check(
  'router 保留旧路径别名',
  /cart: 'account'/.test(router) && /profile: 'account'/.test(router) && /settings: 'account'/.test(router),
  '旧链接别名被移除，老书签会落到未知视图',
);
// GitHub Pages 靠 404.html 兜底，构建脚本必须生成
check(
  'web 构建生成 404.html 深链接回退',
  read('apps/web/package.json').includes('spa-404.mjs'),
  '构建未生成 404.html，刷新深链接会 404',
);
// Azure SWA 靠 navigationFallback 回退
check(
  'Azure SWA 配置 navigationFallback',
  read('.github/workflows/azure-static-web-apps.yml').includes('navigationFallback'),
  '平台未配置深链接回退',
);
// 若本地产物存在，再核对 404.html 与 index.html 同内容（刷新深链接拿到的就是首屏）
const distIndex = join(ROOT, 'apps/web/dist/index.html');
const dist404 = join(ROOT, 'apps/web/dist/404.html');
if (existsSync(distIndex)) {
  check(
    '本地产物 404.html 与 index.html 一致',
    existsSync(dist404) && readFileSync(dist404, 'utf8') === readFileSync(distIndex, 'utf8'),
    '产物 404.html 缺失或内容不一致，深链接刷新会白屏',
  );
} // 产物存在才校验

// ---------- 6. 运行时断言：真实起 API 发请求 ---------- //
// 用一次性内存库 + 随机端口跑真实 Express，核对状态码而不是只读源码。
const RUNNER_REL = 'services/mim-api/.verify-auth-gate.runner.ts'; // 临时运行器：跑完即删
const RUNNER_SRC = String.raw`import { createServer } from 'node:http';
import { createDatabase } from './src/db.js';
import { createApp } from './src/app.js';

const READ_PATHS = [
  '/api/v1/healthz',
  '/api/v1/site/config',
  '/api/v1/security/status',
  '/api/v1/community/home-setting',
  '/api/v1/community/recommend-weights',
  '/api/v1/community/overview',
  '/api/v1/community/boards',
  '/api/v1/community/threads',
  '/api/v1/vip/plans',
  '/api/v1/vip/prices',
  '/api/v1/shop/products',
  '/api/v1/content/items',
  '/api/v1/announcements',
  '/api/v1/changelog',
  '/api/v1/changelog/versions',
  '/api/v1/promotions',
  '/api/v1/community/gallery/items',
  '/api/v1/community/gallery/collections',
];

const WRITE_CASES = [
  ['POST', '/api/v1/community/boards'],
  ['POST', '/api/v1/community/threads'],
  ['POST', '/api/v1/shop/products'],
  ['POST', '/api/v1/vip/plans'],
  ['POST', '/api/v1/announcements'],
  ['POST', '/api/v1/content/items'],
  ['PUT', '/api/v1/community/threads/verify-gate-id'],
  ['DELETE', '/api/v1/community/threads/verify-gate-id'],
];

const env = { MIM_CAPTCHA_MODE: 'off' };
const app = createApp({ db: createDatabase(':memory:'), jwtSecret: 'verify-auth-gate-local-secret', env });
const server = createServer(app);
await new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(null); }); });
const addr = server.address();
const port = addr && typeof addr === 'object' ? addr.port : 0;
const base = 'http://127.0.0.1:' + port;
const results = [];

function codeOf(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.code === 'string') return body.code;
  if (body.error && typeof body.error.code === 'string') return body.error.code;
  return null;
}

async function request(method, path, payload) {
  const init = { method: method };
  if (payload !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = payload;
  }
  const res = await fetch(base + path, init);
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body: body };
}

async function probe(name, method, path, expect) {
  const res = await request(method, path, method === 'GET' ? undefined : '{}');
  results.push({ name: name, ok: res.status === expect, detail: res.status === expect ? '' : 'expect ' + expect + ', got ' + res.status + (codeOf(res.body) ? ' / ' + codeOf(res.body) : '') });
}

for (const path of READ_PATHS) await probe('匿名可读 ' + path + ' 返回 200', 'GET', path, 200);
for (const item of WRITE_CASES) await probe('写操作 ' + item[0] + ' ' + item[1] + ' 返回 401', item[0], item[1], 401);
const guestRes = await request('POST', '/api/v1/auth/guest', '{}');
const guestCode = codeOf(guestRes.body);
results.push({
  name: '访客建号 POST /api/v1/auth/guest 不可用（404 已删除 / 403 AUTH_REGISTER_DISABLED 硬拒）',
  ok: guestRes.status === 404 || (guestRes.status === 403 && guestCode === 'AUTH_REGISTER_DISABLED'),
  detail: 'status ' + guestRes.status + ' / code ' + String(guestCode),
});
await probe('未登录 GET /api/v1/me 返回 401', 'GET', '/api/v1/me', 401);
await probe('后台 GET /api/v1/admin/me 返回 401', 'GET', '/api/v1/admin/me', 401);
await probe('后台 GET /api/v1/admin/shop/products 返回 401', 'GET', '/api/v1/admin/shop/products', 401);

const registerRes = await request('POST', '/api/v1/auth/register', JSON.stringify({ provider: 'phone', identifier: '13800000000', code: '000000', password: 'verify-gate' }));
results.push({
  name: '注册 POST /api/v1/auth/register 返回 403 AUTH_REGISTER_DISABLED',
  ok: registerRes.status === 403 && codeOf(registerRes.body) === 'AUTH_REGISTER_DISABLED',
  detail: 'status ' + registerRes.status + ' / code ' + String(codeOf(registerRes.body)),
});

const channelsRes = await request('GET', '/api/v1/auth/channels');
results.push({
  name: '渠道能力 GET /api/v1/auth/channels 上报 register=false',
  ok: channelsRes.status === 200 && channelsRes.body && channelsRes.body.register === false,
  detail: 'status ' + channelsRes.status + ' / register ' + String(channelsRes.body && channelsRes.body.register),
});

server.close();
console.log('__AUTH_GATE_RESULT__' + JSON.stringify(results));
process.exit(0);
`; // 运行器源码结束（无模板插值，保持可直接写入）

// 写入临时运行器，执行完无论成功失败都要清掉，避免污染工作区
const runnerPath = join(ROOT, RUNNER_REL);
const tsxCli = join(ROOT, 'services/mim-api/node_modules/tsx/dist/cli.mjs');
let runtimeResults = [];
let runtimeError = '';
try {
  // 运行器放在 services/mim-api 内，才能按该包的 tsconfig / node_modules 解析依赖
  writeFileSync(runnerPath, RUNNER_SRC, 'utf8');
  if (!existsSync(tsxCli)) {
    runtimeError = '未找到 services/mim-api 的 tsx，无法启动内置 API';
  } else {
    // cwd 设为 @mim/api 根，保证相对导入与依赖解析一致
    const run = spawnSync(process.execPath, [tsxCli, runnerPath], {
      cwd: join(ROOT, 'services/mim-api'),
      encoding: 'utf8',
      timeout: 180000,
    });
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    // 运行器只用一行标记输出结果，其余日志忽略
    const line = output.split(/\r?\n/).find((item) => item.startsWith('__AUTH_GATE_RESULT__'));
    if (line) runtimeResults = JSON.parse(line.slice('__AUTH_GATE_RESULT__'.length));
    else runtimeError = output.trim().split(/\r?\n/).slice(-6).join(' | ').slice(0, 500);
  }
} catch (error) {
  runtimeError = String(error && error.message ? error.message : error);
} finally {
  rmSync(runnerPath, { force: true });
}

if (runtimeResults.length === 0) {
  check('运行时：内置 API 起服并完成请求探测', false, runtimeError || '未取得任何探测结果');
} else {
  for (const item of runtimeResults) check(item.name, item.ok, item.detail);
}

// ---------- 汇总 ---------- //
const failed = checks.filter((item) => !item.ok);
const passed = checks.length - failed.length;
console.log(`\n=== 鉴权边界校验：${passed}/${checks.length} 通过（静态断言 + 内置 API 实测）===`);
for (const item of failed) console.log(`FAIL  ${item.name}${item.detail ? ` —— ${item.detail}` : ''}`);
if (failed.length === 0) console.log('全部通过：匿名可读 200、写操作 401、注册关闭、无访客建号、后台边界与深链接均符合当前口径。');
process.exit(failed.length === 0 ? 0 : 1);
