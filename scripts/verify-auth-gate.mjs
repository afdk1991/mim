#!/usr/bin/env node
/**
 * scripts/verify-auth-gate.mjs
 * 鉴权边界回归校验（2026-11-16 口径）：匿名默认可读、只拦个人与资金、写操作需登录、注册开关双态。
 *
 * 唯一真源：services/mim-api/src/middleware.ts 的安全方法默认放行模型。
 *   1. 匿名读：安全方法（GET / HEAD / OPTIONS）默认 200，只对 AUTH_REQUIRED_READ_* 显式拦截；
 *   2. 写操作：POST / PUT / PATCH / DELETE 默认 401，只放行 ANONYMOUS_WRITE_EXCEPTIONS（支付回调、签名媒体）；
 *   3. 个人与交易：/me、/wallet、/shop/orders、/commerce/orders、/payments、/im 等一律 401，
 *      不得退化成 403 或静默成功；
 *   4. 付费预览契约：付费帖匿名可读但正文为空、locked=true、媒体为空；图库付费项 locked=true 且 url=''；
 *   5. 注册开关：MIM_REGISTRATION_ENABLED 默认关闭（403 AUTH_REGISTER_DISABLED），打开后可真建号；
 *   6. 后台边界：/api/v1/admin/* 不参与全站门禁，仍由 requirePermission 兜底 401；
 *   7. 深链接与刷新：路径路由 + 构建期 404.html / 平台 navigationFallback 回退。
 *
 * 校验分两层：
 *   - 静态断言：直接读源码与构建配置，零依赖、失败可定位到具体契约；
 *   - 运行时断言：用 @mim/api 自带的 tsx 在本进程内起一次性 API（内存库 + 随机端口），
 *     真实发请求核对状态码与响应体，避免「源码看着对、实际返回错」。
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

// 正则转义：把字面量路径转成可用于匹配源码的安全正则
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 仅转义正则元字符
} // escapeRe 结束

// ---------- 1. 后端门禁：安全方法默认放行，只拦个人与资金 ---------- //
const mw = read('services/mim-api/src/middleware.ts'); // 全站门禁与拦截 / 放行唯一清单
const appServer = read('services/mim-api/src/app.ts'); // 中间件挂载顺序

// 安全方法集合必须只含读语义，写方法不得进入该集合
check(
  '后端 SAFE_METHODS 仅含 GET / HEAD / OPTIONS',
  /const SAFE_METHODS = new Set\(\['GET', 'HEAD', 'OPTIONS'\]\)/.test(mw),
  '安全方法集合漂移，写方法可能被默认放行',
);
// isAnonymousRead 必须先排除写方法，再按「非个人 / 非资金」默认放行
check(
  '后端 isAnonymousRead 默认放行安全方法',
  /function isAnonymousRead[\s\S]{0,260}?!SAFE_METHODS\.has\(method\.toUpperCase\(\)\)[\s\S]{0,80}?return !isAuthRequiredRead\(pathname\)/.test(mw),
  '匿名读判定未按「安全方法默认放行 + 个人路径例外」实现',
);
// 个人 / 资金读路径的精确清单：漏一条就意味着对应数据对匿名开放
const AUTH_READ_PATHS = [
  '/api/v1/me',
  '/api/v1/me/oauth',
  '/api/v1/wallet',
  '/api/v1/wallet/withdrawals',
  '/api/v1/shop/orders',
  '/api/v1/after-sales',
  '/api/v1/referral',
  '/api/v1/reports/mine',
  '/api/v1/assets',
  '/api/v1/assets/mine/list',
  '/api/v1/community/favorites',
  '/api/v1/community/notifications',
  '/api/v1/commerce/orders',
  '/api/v1/commerce/orders/summary',
  '/api/v1/im/conversations',
  '/api/v1/im/users',
];
// 逐条核对：要求是真实条目而不是被注释掉的一行
for (const path of AUTH_READ_PATHS) {
  check(
    `需登录读路径登记 ${path}`,
    new RegExp(`^\\s*'${escapeRe(path)}',`, 'm').test(mw),
    '该个人 / 资金读接口未登记，匿名可读会泄露个人数据或交易信息',
  );
}
// 带路径参数的需登录读：少一条就会让订单详情 / 支付 / 私信被匿名读穿
const AUTH_READ_PREFIXES = [
  '/^\\/api\\/v1\\/me\\//',
  '/^\\/api\\/v1\\/wallet\\//',
  '/^\\/api\\/v1\\/shop\\/orders\\//',
  '/^\\/api\\/v1\\/after-sales\\//',
  '/^\\/api\\/v1\\/referral\\//',
  '/^\\/api\\/v1\\/reports\\//',
  '/^\\/api\\/v1\\/assets\\//',
  '/^\\/api\\/v1\\/community\\/favorites/',
  '/^\\/api\\/v1\\/community\\/notifications/',
  '/^\\/api\\/v1\\/commerce\\/orders\\//',
  '/^\\/api\\/v1\\/payments\\//',
  '/^\\/api\\/v1\\/im\\//',
  '/^\\/api\\/v1\\/messaging\\//',
];
// 逐条核对正则文本，避免被随手删掉
for (const pattern of AUTH_READ_PREFIXES) {
  check(`需登录读路径正则 ${pattern}`, mw.includes(pattern), '带参数的个人 / 资金读接口已从拦截清单丢失');
}
// 匿名写例外：只允许渠道回调与签名媒体，且必须按方法精确匹配
check(
  '匿名写例外登记支付回调 POST',
  mw.includes('pattern: /^\\/api\\/v1\\/payments\\/[a-z0-9_]+\\/notify$/'),
  '支付渠道异步通知会被写操作默认拦截误伤，扣款成功但订单不到账',
);
check(
  '匿名写例外登记签名媒体 PUT / DELETE',
  mw.includes('pattern: /^\\/api\\/v1\\/media\\/objects\\/.+$/') && /method: 'PUT'[\s\S]{0,200}?method: 'DELETE'/.test(mw),
  '预签名上传 / 删除会被写操作默认拦截，媒体链路不可用',
);
check(
  '匿名写例外按方法精确匹配',
  /ANONYMOUS_WRITE_EXCEPTIONS\.some\(\(item\) => item\.method === upper/.test(mw),
  '写例外未校验方法，可能把整条路径的所有写方法放开',
);
// 旧的白名单放行模型必须彻底作废，否则两套口径会互相掩盖
check(
  '旧匿名读白名单模型已移除',
  !mw.includes('ANONYMOUS_READ_PATHS') && !mw.includes('ANONYMOUS_READ_PATTERNS'),
  '旧 ANONYMOUS_READ_* 白名单仍存在，默认放行模型会被旧口径覆盖',
);
check(
  '旧支付回调常量已并入匿名写例外',
  !mw.includes('PAYMENT_NOTIFY_PATHS'),
  '旧 PAYMENT_NOTIFY_PATHS 残留，支付回调放行出现第二个真源',
);
// 登录链路与后台前缀仍需在门禁公开清单里
check(
  '门禁公开前缀含 auth 与 admin',
  mw.includes("'/api/v1/auth/'") && mw.includes("'/api/v1/admin/'"),
  '登录链路或后台前缀不再豁免，匿名登录 / 后台校验会被门禁重复拦截',
);
// 中间件必须真实挂到 /api/v1 上，常量再对不挂载也没用
check(
  'app 挂载全站强制登录中间件',
  appServer.includes("app.use('/api/v1', createForceLoginMiddleware())"),
  'createForceLoginMiddleware 未挂载到 /api/v1',
);

// ---------- 2. 注册开关：默认关闭，打开后走完整注册流程 ---------- //
const authRoute = read('services/mim-api/src/routes/auth.ts'); // 登录 / 注册路由
const configSrc = read('services/mim-api/src/config.ts'); // 开关读取实现
// 开关名必须写死在代码里，文档与运维照着它操作
check(
  '注册开关名 MIM_REGISTRATION_ENABLED',
  configSrc.includes("'MIM_REGISTRATION_ENABLED'"),
  '注册开关名缺失或改名，运维无法在不翻代码的情况下打开注册',
);
// 默认关闭：只有显式 1 才开启，避免误配置把注册放开
check(
  '注册开关默认关闭且仅 1 打开',
  /isRegistrationEnabled[\s\S]{0,400}?=== '1'/.test(configSrc),
  '注册开关判定漂移，可能出现未配置即放开的危险默认值',
);
// 关闭态必须给出专用错误码，而不是笼统的参数错误
check(
  '后端注册关闭闸门存在',
  authRoute.includes('assertRegistrationEnabled') && authRoute.includes('AUTH_REGISTER_DISABLED'),
  '注册关闭闸门或错误码缺失',
);
// 错误码必须是 403，避免被当成参数错误或被前端当成登录失效
check(
  '错误码 AUTH_REGISTER_DISABLED 为 403',
  /AUTH_REGISTER_DISABLED:\s*403/.test(read('packages/core-domain/src/errors.ts')),
  '注册关闭错误码状态位漂移',
);
// 打开态必须复用与后台手工建号同一套建号入口（Mim ID 号码规则一致）
check(
  '打开态复用统一建号入口',
  /\/auth\/register[\s\S]{0,2600}?createUser\(deps\.db/.test(authRoute),
  '自助注册未走 createUser，可能与后台手工建号的号码规则分叉',
);
// 渠道能力必须如实上报开关状态，前端据此显示 / 隐藏注册入口
check(
  '渠道能力上报 register 开关态',
  /register:\s*isRegistrationEnabled\(/.test(authRoute),
  '/auth/channels 未按注册开关上报能力',
);
// 注册关闭时验证码门禁必须让路：否则关闭态会被拦成「图形验证码错误」，
// 既不符合「关闭态 403 AUTH_REGISTER_DISABLED」契约，也会让运维误判成验证码故障。
check(
  '注册关闭态先于验证码返回 403',
  /scene === 'register' && !isRegistrationEnabled\([\s\S]{0,120}?next\(\)/.test(read('services/mim-api/src/middleware.ts')),
  '验证码中间件未在注册关闭时让路，关闭态会返回验证码错误而不是 AUTH_REGISTER_DISABLED',
);

// ---------- 3. 前端：注册入口随开关、匿名可读、写操作引导登录 ---------- //
const appWeb = read('apps/web/src/App.tsx'); // Web 根组件
const loginView = read('apps/web/src/views/Login.tsx'); // 登录页
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
check('登录页注册分段受 channels.register 控制', loginView.includes('channels?.register &&') && loginView.includes("mode === 'register'"), '注册入口未按服务端开关显示 / 隐藏');
check('登录页注册调用统一注册接口', loginView.includes('api.register('), '注册分段存在但没有提交到 /auth/register');
check('登录页关闭态提示注册已关闭', loginView.includes('注册功能已关闭'), '关闭态缺少说明，用户会反复找入口');
check('登录页无「此功能需登录」旧口径', !loginView.includes('此功能需登录'), '旧功能门禁文案仍在');
check('登录页无「全站已锁定」旧口径', !loginView.includes('全站已锁定'), '旧整站锁定文案仍在');
check('App 订阅会话变更事件', appWeb.includes('SESSION_CHANGED_EVENT'), '缺少登录 / 退出 / 失效事件订阅');
check('App 启动静默校验会话', appWeb.includes('verifySession'), '缺少 /me 启动校验');
check('api 提供 /me 静默校验', apiClient.includes('export async function verifySession') && apiClient.includes("request<MeResponse>('/me'"), '启动校验必须打受保护接口');
check('api 失效时广播重登提示', apiClient.includes("clearSession('expired')"), '401 续期失败必须触发失效广播');
check('api 监听跨标签页 storage', apiClient.includes("addEventListener('storage'"), '其它标签页退出需同步');

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
// 用一次性内存库 + 随机端口跑真实 Express，核对状态码与响应体而不是只读源码。
const RUNNER_REL = 'services/mim-api/.verify-auth-gate.runner.ts'; // 临时运行器：跑完即删
const RUNNER_SRC = String.raw`import { createServer } from 'node:http';
import { createDatabase } from './src/db.js';
import { createApp } from './src/app.js';
import { isAnonymousRead, isPublicUnderForceLogin } from './src/middleware.js';

const READ_PATHS = [
  '/api/v1/healthz',
  '/api/v1/site/config',
  '/api/v1/security/status',
  '/api/v1/community/home-setting',
  '/api/v1/community/recommend-weights',
  '/api/v1/community/overview',
  '/api/v1/community/boards',
  '/api/v1/community/threads',
  '/api/v1/community/threads/thread-quick-build',
  '/api/v1/community/boards/general/tabs',
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

const AUTH_READ_PATHS = [
  '/api/v1/me',
  '/api/v1/me/oauth',
  '/api/v1/wallet',
  '/api/v1/wallet/withdrawals',
  '/api/v1/shop/orders',
  '/api/v1/after-sales',
  '/api/v1/referral',
  '/api/v1/reports/mine',
  '/api/v1/assets',
  '/api/v1/community/favorites',
  '/api/v1/community/notifications',
  '/api/v1/commerce/orders',
  '/api/v1/commerce/orders/summary',
  '/api/v1/payments/channels',
  '/api/v1/im/conversations',
];

const WRITE_CASES = [
  ['POST', '/api/v1/community/threads'],
  ['POST', '/api/v1/community/threads/thread-quick-build/posts'],
  ['POST', '/api/v1/community/threads/thread-quick-build/like'],
  ['POST', '/api/v1/community/threads/thread-quick-build/favorite'],
  ['POST', '/api/v1/reports'],
  ['POST', '/api/v1/media/presign/upload'],
  ['POST', '/api/v1/payments/intents'],
  ['POST', '/api/v1/commerce/orders'],
  ['POST', '/api/v1/shop/orders'],
  ['POST', '/api/v1/wallet/withdrawals'],
  ['PATCH', '/api/v1/me'],
  ['DELETE', '/api/v1/community/threads/thread-quick-build'],
];

const env = { MIM_CAPTCHA_MODE: 'off' };
const db = createDatabase(':memory:');
const now = new Date().toISOString();
db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, sort_order, created_at, mime) VALUES (?, ?, ?, ?, NULL, 0, ?, ?)')
  .run('gate-media-paid', 'thread-paid-store', 'image', '/catalog/gate-paid.png', now, 'image/png');
db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, sort_order, created_at, mime) VALUES (?, ?, ?, ?, NULL, 0, ?, ?)')
  .run('gate-media-free', 'thread-quick-build', 'image', '/catalog/gate-free.png', now, 'image/png');

const app = createApp({ db, jwtSecret: 'verify-auth-gate-local-secret', env });
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
for (const path of AUTH_READ_PATHS) await probe('个人 / 交易读 ' + path + ' 返回 401', 'GET', path, 401);
for (const item of WRITE_CASES) await probe('写操作 ' + item[0] + ' ' + item[1] + ' 返回 401', item[0], item[1], 401);

const notify = await request('POST', '/api/v1/payments/sandbox/notify', '{}');
results.push({
  name: '匿名写例外 POST /api/v1/payments/sandbox/notify 不被 401 拦截',
  ok: notify.status !== 401,
  detail: 'status ' + notify.status,
});
// 门禁判定的直接证据：写例外必须在判定函数层面命中，才不会被写方法默认拦截
results.push({
  name: '门禁判定：签名媒体 PUT / DELETE 属公开写例外',
  ok:
    isPublicUnderForceLogin('PUT', '/api/v1/media/objects/gate-object') === true &&
    isPublicUnderForceLogin('DELETE', '/api/v1/media/objects/gate-object') === true &&
    isPublicUnderForceLogin('POST', '/api/v1/payments/sandbox/notify') === true,
  detail: '写例外未在判定函数命中，签名媒体 / 支付回调会被默认拦成 401',
});
results.push({
  name: '门禁判定：普通写方法仍默认拦截',
  ok: isPublicUnderForceLogin('POST', '/api/v1/community/threads') === false && isAnonymousRead('POST', '/api/v1/community/threads') === false,
  detail: '写默认拦截失效，匿名发帖会被放行',
});
// 签名媒体端点自己会因缺签名回 401（存储层校验），与门禁 401 必须区分：
// 门禁拒绝的文案是 missing bearer token，能读到签名相关提示说明请求已穿过门禁。
const signedPut = await request('PUT', '/api/v1/media/objects/gate-object', 'x');
const signedPutMsg = signedPut.body && typeof signedPut.body.message === 'string' ? signedPut.body.message : '';
results.push({
  name: '匿名写例外 PUT /api/v1/media/objects/* 到达存储层而非被门禁拦截',
  ok: signedPutMsg !== 'missing bearer token',
  detail: 'status ' + signedPut.status + (signedPutMsg ? ' / ' + signedPutMsg : ''),
});

const paidDetail = await request('GET', '/api/v1/community/threads/thread-paid-store');
const paidThread = paidDetail.body && paidDetail.body.thread ? paidDetail.body.thread : {};
results.push({
  name: '付费帖匿名可读但只给预览（200 + 正文为空 + locked:true）',
  ok: paidDetail.status === 200 && paidThread.body === '' && paidThread.locked === true,
  detail: 'status ' + paidDetail.status + ' / bodyLen ' + String(paidThread.body ? paidThread.body.length : -1) + ' / locked ' + String(paidThread.locked),
});
results.push({
  name: '付费帖匿名预览不下发媒体（media 为空）',
  ok: paidDetail.status === 200 && Array.isArray(paidThread.media) && paidThread.media.length === 0,
  detail: 'mediaLen ' + String(Array.isArray(paidThread.media) ? paidThread.media.length : -1),
});

const gallery = await request('GET', '/api/v1/community/gallery/items?limit=60');
const galleryItems = gallery.body && Array.isArray(gallery.body.items) ? gallery.body.items : [];
const paidItem = galleryItems.find(function (item) { return item.thread_id === 'thread-paid-store'; });
const freeItem = galleryItems.find(function (item) { return item.thread_id === 'thread-quick-build'; });
results.push({
  name: '图库匿名可读返回 200',
  ok: gallery.status === 200 && Array.isArray(gallery.body && gallery.body.items),
  detail: 'status ' + gallery.status,
});
results.push({
  name: '图库付费媒体 locked:true 且 url 为空',
  ok: !!paidItem && paidItem.locked === true && paidItem.url === '',
  detail: paidItem ? 'locked ' + String(paidItem.locked) + ' / url ' + String(paidItem.url) : '未找到 thread-paid-store 媒体',
});
results.push({
  name: '图库免费媒体仍可正常下发地址',
  ok: !!freeItem && freeItem.locked === false && typeof freeItem.url === 'string' && freeItem.url.length > 0,
  detail: freeItem ? 'locked ' + String(freeItem.locked) + ' / url ' + String(freeItem.url) : '未找到 thread-quick-build 媒体',
});

const closedReg = await request('POST', '/api/v1/auth/register', JSON.stringify({ region: 'cn', provider: 'phone', identifier: '13900000001', password: 'test-pass-123' }));
results.push({
  name: '注册关闭态 POST /api/v1/auth/register 返回 403 AUTH_REGISTER_DISABLED',
  ok: closedReg.status === 403 && codeOf(closedReg.body) === 'AUTH_REGISTER_DISABLED',
  detail: 'status ' + closedReg.status + ' / code ' + String(codeOf(closedReg.body)),
});
const closedChannels = await request('GET', '/api/v1/auth/channels');
results.push({
  name: '注册关闭态 channels.register=false',
  ok: closedChannels.status === 200 && closedChannels.body && closedChannels.body.register === false,
  detail: 'status ' + closedChannels.status + ' / register ' + String(closedChannels.body && closedChannels.body.register),
});

env.MIM_REGISTRATION_ENABLED = '1';
const openChannels = await request('GET', '/api/v1/auth/channels');
results.push({
  name: '注册打开态 channels.register=true',
  ok: openChannels.status === 200 && openChannels.body && openChannels.body.register === true,
  detail: 'status ' + openChannels.status + ' / register ' + String(openChannels.body && openChannels.body.register),
});
const openReg = await request('POST', '/api/v1/auth/register', JSON.stringify({ region: 'cn', provider: 'phone', identifier: '13900000001', password: 'test-pass-123', display_name: '门禁注册验证' }));
const createdId = openReg.body && openReg.body.user ? String(openReg.body.user.id) : '';
const memberNo = openReg.body && openReg.body.user ? String(openReg.body.user.member_no) : '';
results.push({
  name: '注册打开态 POST /api/v1/auth/register 真建号并自动登录（201）',
  ok: openReg.status === 201 && !!createdId && typeof openReg.body.access_token === 'string',
  detail: 'status ' + openReg.status + ' / code ' + String(codeOf(openReg.body)),
});
results.push({
  name: '注册打开态按 Mim ID 规则分配纯数字号码',
  ok: /^\d+$/.test(memberNo),
  detail: 'member_no ' + memberNo,
});
const relogin = await request('POST', '/api/v1/auth/password', JSON.stringify({ region: 'cn', provider: 'phone', identifier: '13900000001', password: 'test-pass-123' }));
results.push({
  name: '注册打开态建出的账号可用口令登录',
  ok: relogin.status === 200 && relogin.body && relogin.body.user && String(relogin.body.user.id) === createdId,
  detail: 'status ' + relogin.status,
});
if (createdId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(createdId);
  db.prepare('DELETE FROM credentials WHERE user_id = ?').run(createdId);
  db.prepare('DELETE FROM identities WHERE user_id = ?').run(createdId);
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(createdId);
  db.prepare('DELETE FROM users WHERE id = ?').run(createdId);
}

const guestRes = await request('POST', '/api/v1/auth/guest', '{}');
const guestCode = codeOf(guestRes.body);
results.push({
  name: '访客建号 POST /api/v1/auth/guest 不可用（404 已删除 / 403 AUTH_REGISTER_DISABLED 硬拒）',
  ok: guestRes.status === 404 || (guestRes.status === 403 && guestCode === 'AUTH_REGISTER_DISABLED'),
  detail: 'status ' + guestRes.status + ' / code ' + String(guestCode),
});
await probe('后台 GET /api/v1/admin/me 返回 401', 'GET', '/api/v1/admin/me', 401);
await probe('后台 GET /api/v1/admin/shop/products 返回 401', 'GET', '/api/v1/admin/shop/products', 401);

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
if (failed.length === 0) console.log('全部通过：匿名读 200、个人 / 交易 401、写操作 401、付费预览 locked 且 url 为空、注册开关双态均符合当前口径。');
process.exit(failed.length === 0 ? 0 : 1);
