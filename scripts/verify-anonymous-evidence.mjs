#!/usr/bin/env node
/**
 * Mim 前端匿名取证脚本
 * ------------------------------------------------------------
 * 目标：用真实无头浏览器 + 匿名 HTTP 请求，一次性覆盖四层验收：
 *   L1 清洁上下文：无 Cookie、无 localStorage、无 sessionStorage
 *   L2 接口层：匿名读白名单 200；匿名写 / 私密读 401 AUTH_UNAUTHORIZED；
 *              /admin/* 匿名访问必须是 401 JSON，而不是 404 或登录页 HTML
 *   L3 页面层：/community 不跳登录且列表有内容；深链 /community/post/:id
 *              路径不被改写且正文非空；匿名点赞跳登录；/admin/ 显示登录页
 *   L4 污染检查：跑完 users 计数与基线一致；匿名浏览不写浏览去重账本
 *
 * 关键对照组：同一路径 GET 放行、POST 拦截。
 * 认证响应头：带 Bearer 的响应若为 public, max-age 判失败（应为 private, no-store）。
 *
 * 设计约束：
 *   - 零第三方依赖，只使用 Node 内置能力（fetch / WebSocket / node:sqlite）
 *   - 不硬编码任何生产口令或令牌，凭据全部从环境变量读取
 *   - 业务侧只发只读请求；两个写请求均为“预期被 401 拒绝”的探测，不会产生业务数据
 *   - 默认启动独立临时用户目录的无头浏览器，确保匿名上下文干净
 *
 * 用法：
 *   node scripts/verify-anonymous-evidence.mjs
 *   MIM_EVIDENCE_WEB_BASE=http://127.0.0.1:5188 node scripts/verify-anonymous-evidence.mjs
 *
 * 环境变量（全部可选，详见 docs/anonymous-evidence.md）：
 *   MIM_EVIDENCE_WEB_BASE      前端站点根地址，默认 https://zy.laal.top
 *   MIM_EVIDENCE_API_BASE      API 根地址，默认 https://api.laal.top/api/v1（前后端独立域名）
 *   MIM_EVIDENCE_BROWSER       浏览器可执行文件路径，默认自动探测 Chrome/Edge
 *   MIM_EVIDENCE_CDP           复用已存在的 CDP 地址（如 http://127.0.0.1:9222），不自动启动浏览器
 *   MIM_EVIDENCE_AUTH_TOKEN    普通用户 Bearer 令牌，用于认证响应头检查
 *   MIM_EVIDENCE_ADMIN_TOKEN   超管引导令牌，用于 users 基线（回退读取 MIM_ADMIN_TOKEN）
 *   MIM_EVIDENCE_DB_PATH       只读 SQLite 库路径，用于精确核对 users 与浏览去重账本
 *   MIM_EVIDENCE_TIMEOUT_MS    单次等待超时，默认 20000
 *   MIM_EVIDENCE_KEEP_BROWSER  设为 1 时保留浏览器进程与临时目录，便于排查
 *
 * 退出码：0 = 无 FAIL（允许 SKIP）；1 = 存在 FAIL；2 = 前置条件 / 配置错误
 */

import { spawn } from 'node:child_process'; // 启动无头浏览器子进程
import { existsSync, mkdtempSync, rmSync } from 'node:fs'; // 探测浏览器路径、创建临时用户目录、收尾清理
import { createServer } from 'node:net'; // 申请空闲端口给 CDP 使用
import { tmpdir } from 'node:os'; // 取系统临时目录
import { join } from 'node:path'; // 拼临时用户目录路径

// ---------- 配置：全部来自环境变量，缺省值只包含公开地址与超时 ----------

const WEB_BASE = (process.env.MIM_EVIDENCE_WEB_BASE || 'https://zy.laal.top').replace(/\/+$/, ''); // 前端站点根地址（生产前端），去掉尾部斜杠避免拼出双斜杠
const API_BASE = (process.env.MIM_EVIDENCE_API_BASE || 'https://api.laal.top/api/v1').replace(/\/+$/, ''); // API 根地址（生产接口独立域名），不再默认从前端同源派生
const AUTH_TOKEN = (process.env.MIM_EVIDENCE_AUTH_TOKEN || '').trim(); // 普通用户令牌：仅用于认证响应头检查，不打印
const ADMIN_TOKEN = (process.env.MIM_EVIDENCE_ADMIN_TOKEN || process.env.MIM_ADMIN_TOKEN || '').trim(); // 超管引导令牌：仅用于 users 基线，不打印
const DB_PATH = (process.env.MIM_EVIDENCE_DB_PATH || '').trim(); // 只读库路径：用于精确污染检查
const BROWSER_BIN = (process.env.MIM_EVIDENCE_BROWSER || '').trim(); // 浏览器可执行文件，显式指定时优先
const CDP_ENDPOINT = (process.env.MIM_EVIDENCE_CDP || '').trim().replace(/\/+$/, ''); // 复用已有 CDP 时使用
const TIMEOUT_MS = Math.max(3000, Number(process.env.MIM_EVIDENCE_TIMEOUT_MS || 20000)); // 单次等待超时，下限 3 秒防止无效配置
const KEEP_BROWSER = process.env.MIM_EVIDENCE_KEEP_BROWSER === '1'; // 调试开关：保留浏览器现场

// ---------- 结果记录与输出 ----------

const results = []; // 逐项结果：{ layer, id, name, status, detail }
const counters = { PASS: 0, FAIL: 0, SKIP: 0 }; // 汇总计数，用于最终退出码

/** 记录一项检查并立即打印，保证长流程中也能看到进度 */
function record(layer, id, name, status, detail = '') {
  const item = { layer, id, name, status, detail }; // 组装结果对象
  results.push(item); // 存入汇总列表，最终再打印失败明细
  counters[status] += 1; // 累加对应状态计数
  const suffix = detail ? ` — ${detail}` : ''; // 详情为空时不输出多余分隔符
  console.log(`[${status}] ${id} ${name}${suffix}`); // 立即打印一行，便于实时观察
}

/** 汇总打印：正常收尾与网络不可达提前收尾共用同一套输出口径 */
function printSummary() {
  console.log(''); // 汇总前留空行
  console.log(`汇总：PASS ${counters.PASS} / FAIL ${counters.FAIL} / SKIP ${counters.SKIP}`); // 打印总体计数

  const failures = results.filter((item) => item.status === 'FAIL'); // 收集失败项
  if (failures.length > 0) {
    console.log('失败明细：'); // 失败明细标题
    for (const item of failures) {
      console.log(` - [${item.layer}] ${item.id} ${item.name}：${item.detail}`); // 逐条打印，含实际状态码与 URL
    }
  }

  const skips = results.filter((item) => item.status === 'SKIP'); // 收集跳过项
  if (skips.length > 0) {
    console.log('跳过明细（需要补充环境变量才能完整取证）：'); // 跳过说明
    for (const item of skips) {
      console.log(` - [${item.layer}] ${item.id} ${item.name}：${item.detail}`); // 逐条打印原因
    }
  }

  const exitCode = failures.length > 0 ? 1 : 0; // 有 FAIL 即退出码 1，SKIP 不改变成功
  console.log(`退出码：${exitCode}`); // 明确打印退出码
  return exitCode; // 交回退出码由调用方 process.exit
}

/** 生成 HTTP 取证串：失败时务必能看到实际状态码与 URL */
function httpEvidence(r) {
  const parts = [`${r.method} ${r.url} -> ${r.status}`]; // 方法、完整 URL、实际状态码
  if (r.contentType) parts.push(`content-type=${r.contentType}`); // 内容类型用于区分 JSON 与 HTML
  if (r.code) parts.push(`code=${r.code}`); // 业务错误码
  if (r.cacheControl) parts.push(`cache-control=${r.cacheControl}`); // 缓存头用于定位认证响应问题
  return parts.join(' '); // 拼成单行证据
}

// ---------- 通用断言 ----------

/** 判断对象是否为普通对象，避免把数组或 null 当对象取字段 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value); // 仅接受非数组对象
}

/** 判断响应是否为预期的 401 + AUTH_UNAUTHORIZED */
function isUnauthorizedJson(r) {
  return r.status === 401 && isObject(r.json) && r.json.code === 'AUTH_UNAUTHORIZED'; // 状态码与错误码同时满足
}

// ---------- HTTP 请求封装 ----------

/**
 * 发起匿名或带凭据的 JSON 请求。
 * 注意：凭据只在内存中使用，绝不写入日志或证据串。
 */
async function apiRequest(method, path, { token = '', adminToken = '', body = null } = {}) {
  const url = `${API_BASE}${path}`; // 拼出完整请求地址
  const headers = { accept: 'application/json' }; // 统一声明期望 JSON，便于识别 HTML 登录页
  if (token) headers.authorization = `Bearer ${token}`; // 普通用户令牌走标准 Bearer
  if (adminToken) headers['x-admin-token'] = adminToken; // 超管引导令牌走专用头
  const payload = body === null ? undefined : JSON.stringify(body); // 仅在有请求体时序列化
  if (payload !== undefined) headers['content-type'] = 'application/json'; // 有请求体才声明 JSON
  const controller = new AbortController(); // 用 AbortController 给单次请求加超时
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS); // 超时后主动中止，避免脚本挂死
  try {
    const res = await fetch(url, { method, headers, body: payload, signal: controller.signal, redirect: 'manual' }); // 不自动跟随重定向，保留真实状态码
    const text = await res.text(); // 先读文本，兼容 JSON 与 HTML
    let json = null; // 默认按非 JSON 处理
    try {
      json = JSON.parse(text); // 尝试解析 JSON 信封
    } catch {
      json = null; // 解析失败保持 null，后续用文本特征判断
    }
    return {
      method, // 回传方法，便于生成证据串
      url, // 回传完整 URL
      status: res.status, // 实际状态码
      contentType: res.headers.get('content-type') || '', // 实际内容类型
      cacheControl: res.headers.get('cache-control') || '', // 缓存头
      code: isObject(json) && typeof json.code === 'string' ? json.code : '', // 顶层业务错误码
      json, // 解析后的响应体
      text, // 原始文本，用于判断是否 HTML
    };
  } catch (error) {
    return {
      method, // 回传方法
      url, // 回传完整 URL
      status: 0, // 0 表示网络层不可达，区别于 HTTP 状态码
      contentType: '', // 无响应头
      cacheControl: '', // 无缓存头
      code: '', // 无业务错误码
      json: null, // 无响应体
      text: '', // 无文本
      unreachable: true, // 标记网络不可达，供主流程归类 SKIP 而非 FAIL
      error: error instanceof Error ? error.message : String(error), // 网络错误明细
    };
  } finally {
    clearTimeout(timer); // 无论成功失败都清理定时器
  }
}

// ---------- 只读 SQLite 封装（可选） ----------

/** 按需打开只读库；不支持或文件缺失时返回 null，由调用方转为 SKIP / 配置错误 */
async function openReadonlyDb() {
  if (!DB_PATH) return null; // 未配置库路径时不启用精确污染检查
  if (!existsSync(DB_PATH)) throw new ConfigError(`MIM_EVIDENCE_DB_PATH 指向的库文件不存在：${DB_PATH}`); // 显式配置错误必须尽早中止
  try {
    const { DatabaseSync } = await import('node:sqlite'); // Node 22+ 内置 SQLite，零外网依赖
    return new DatabaseSync(DB_PATH, { readOnly: true }); // 只读打开，脚本绝不写库
  } catch (error) {
    throw new ConfigError(`无法以只读方式打开 SQLite（需要 Node 22+ 的 node:sqlite）：${error.message}`); // 配置问题走退出码 2
  }
}

/** 读取单值计数，统一返回数字 */
function scalarCount(db, sql, ...params) {
  const row = db.prepare(sql).get(...params); // 预编译并绑定参数，避免拼接 SQL
  return Number(row?.n ?? 0); // COUNT 结果统一转数字
}

// ---------- 浏览器与 CDP ----------

/** 配置类错误：统一走退出码 2，区别于验收 FAIL */
class ConfigError extends Error {}

/** 在常见安装路径中探测 Chrome / Edge */
function detectBrowser() {
  if (BROWSER_BIN) return BROWSER_BIN; // 显式指定优先
  const candidates = []; // 按平台收集候选路径
  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files'; // 64 位程序目录
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'; // 32 位程序目录
    const localAppData = process.env.LOCALAPPDATA || ''; // 用户级安装目录
    candidates.push(
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), // Edge 系统安装
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), // Edge 32 位目录
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), // Chrome 系统安装
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), // Chrome 32 位目录
    );
    if (localAppData) {
      candidates.push(
        join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), // Edge 用户级安装
        join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), // Chrome 用户级安装
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS Chrome
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', // macOS Edge
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome', // Linux Chrome
      '/usr/bin/chromium', // Linux Chromium
      '/usr/bin/chromium-browser', // Debian 系 Chromium
      '/usr/bin/microsoft-edge', // Linux Edge
    );
  }
  const found = candidates.find((candidate) => existsSync(candidate)); // 取第一个真实存在的路径
  if (!found) throw new ConfigError('未找到 Chrome/Edge，请通过 MIM_EVIDENCE_BROWSER 指定浏览器可执行文件'); // 环境缺依赖
  return found; // 返回可用路径
}

/** 申请一个本地空闲端口 */
async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); // 创建临时 TCP 服务
    server.once('error', reject); // 端口申请失败直接拒绝
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; // 系统分配的空闲端口
      server.close(() => resolve(port)); // 关闭后把端口交给浏览器
    });
  });
}

/** 轻量 CDP 客户端：只实现本脚本需要的命令与事件 */
class CdpClient {
  constructor(ws) {
    this.ws = ws; // 原生 WebSocket 实例
    this.nextId = 1; // CDP 消息自增 ID
    this.pending = new Map(); // ID → { resolve, reject, timer }
    this.documentResponses = []; // 当前导航产生的 Document 响应，失败时用于打印状态码
    this.ws.addEventListener('message', (event) => this.handleMessage(event)); // 统一处理命令响应与事件
  }

  /** 建立连接并等待 open */
  static async connect(url) {
    const ws = new WebSocket(url); // Node 22+ 提供全局 WebSocket
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ConfigError(`连接 CDP 超时：${url}`)), TIMEOUT_MS); // 防止连接悬挂
      ws.addEventListener('open', () => {
        clearTimeout(timer); // 连接成功清理超时
        resolve(); // 继续初始化
      }, { once: true });
      ws.addEventListener('error', (event) => {
        clearTimeout(timer); // 连接失败清理超时
        reject(new ConfigError(`连接 CDP 失败：${event.message || url}`)); // 归类为环境问题
      }, { once: true });
    });
    return new CdpClient(ws); // 返回封装后的客户端
  }

  /** 处理来自浏览器的消息 */
  handleMessage(event) {
    const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'); // 兼容文本与二进制帧
    let message; // 声明显式变量便于后续分支
    try {
      message = JSON.parse(raw); // CDP 消息固定为 JSON
    } catch {
      return; // 非法消息直接忽略，避免影响主流程
    }
    if (message.id) { // 有 id 说明是命令响应
      const waiter = this.pending.get(message.id); // 取出等待中的 Promise
      if (!waiter) return; // 已超时或未知 ID，忽略
      this.pending.delete(message.id); // 先移除，避免重复结算
      clearTimeout(waiter.timer); // 清理命令超时
      if (message.error) waiter.reject(new Error(`${message.method || 'CDP'} ${message.error.message}`)); // 浏览器返回错误
      else waiter.resolve(message.result); // 正常返回结果
      return; // 命令响应处理结束
    }
    if (message.method === 'Network.responseReceived') { // 记录主文档响应，供失败证据使用
      const params = message.params || {}; // 事件参数
      if (params.type === 'Document' && params.response) {
        this.documentResponses.push({ url: params.response.url, status: params.response.status }); // 保留 URL 与实际状态码
      }
    }
  }

  /** 发送 CDP 命令并等待响应 */
  send(method, params = {}) {
    const id = this.nextId++; // 分配唯一 ID
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); // 超时后移除，避免内存泄漏
        reject(new Error(`CDP 命令超时：${method}`)); // 明确是命令超时
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer }); // 登记等待者
      this.ws.send(JSON.stringify({ id, method, params })); // 发送命令
    });
  }

  /** 求值页面表达式并返回值 */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, // 待执行表达式
      returnByValue: true, // 直接返回值而非远程对象
      awaitPromise: true, // 支持 Promise 表达式
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || '页面表达式执行失败'); // 把页面异常转成普通错误
    }
    return result.result?.value; // 取出实际值
  }

  /** 轮询等待表达式为真，超时返回 null */
  async waitFor(expression, timeout = TIMEOUT_MS, interval = 150) {
    const deadline = Date.now() + timeout; // 计算截止时间
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate(expression); // 每次尝试求值
        if (value) return value; // 真值即成功
      } catch {
        // 导航切换瞬间执行上下文可能不存在，忽略后重试
      }
      await new Promise((resolve) => setTimeout(resolve, interval)); // 控制轮询频率
    }
    return null; // 超时返回 null 由调用方判定
  }

  /** 导航到指定 URL，并等待文档完成与可选的就绪表达式 */
  async goto(url, readyExpression = '', timeout = TIMEOUT_MS) {
    this.documentResponses = []; // 每次导航重置文档响应记录
    const navigation = await this.send('Page.navigate', { url }); // 发起导航
    if (navigation.errorText) throw new Error(`导航失败：${navigation.errorText} (${url})`); // 网络级失败直接报错
    await this.waitFor("document.readyState === 'complete'", timeout); // 等待 document 完成
    if (readyExpression) await this.waitFor(readyExpression, timeout); // 等待业务就绪标记
    return this.lastDocument(); // 回传最后一次主文档响应
  }

  /** 取最后一次主文档响应，供失败证据使用 */
  lastDocument() {
    return this.documentResponses.length > 0 ? this.documentResponses[this.documentResponses.length - 1] : null;
  }

  /** 关闭 CDP 连接 */
  close() {
    try {
      this.ws.close(); // 主动关闭 WebSocket
    } catch {
      // 关闭失败不影响退出
    }
  }
}

/** 轮询 CDP HTTP 端点，直到浏览器就绪 */
async function waitForCdpHttp(endpoint, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout; // 计算截止时间
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/json/list`); // 列出可调试目标
      if (res.ok) return await res.json(); // 返回目标列表
    } catch {
      // 浏览器尚未监听端口时忽略
    }
    await new Promise((resolve) => setTimeout(resolve, 200)); // 稍后重试
  }
  throw new ConfigError(`浏览器 CDP 端口未就绪：${endpoint}`); // 超时视为环境问题
}

/** 启动无头浏览器或连接已有 CDP，返回页面级客户端与收尾函数 */
async function startBrowser() {
  if (CDP_ENDPOINT) {
    const targets = await waitForCdpHttp(CDP_ENDPOINT); // 复用已有浏览器的目标列表
    const page = targets.find((target) => target.type === 'page'); // 取第一个页面目标
    if (!page?.webSocketDebuggerUrl) throw new ConfigError('CDP 端点没有可用的 page 目标'); // 没有页面目标无法继续
    const client = await CdpClient.connect(page.webSocketDebuggerUrl); // 连接页面级 WebSocket
    return { client, close: async () => client.close() }; // 复用模式不关闭外部浏览器
  }

  const executable = detectBrowser(); // 自动探测浏览器
  const port = await pickFreePort(); // 申请调试端口
  const profileDir = mkdtempSync(join(tmpdir(), 'mim-anon-evidence-')); // 每次使用全新临时用户目录，保证清洁上下文
  const args = [
    '--headless=new', // 新版无头模式，兼容 Chrome/Edge 109+
    '--disable-gpu', // 无头环境不需要 GPU
    '--no-first-run', // 跳过首次运行向导
    '--no-default-browser-check', // 跳过默认浏览器提示
    '--disable-extensions', // 禁用扩展，避免注入
    '--disable-background-networking', // 关闭后台网络请求，减少无关流量
    '--disable-sync', // 关闭账号同步，避免污染匿名上下文
    '--disable-dev-shm-usage', // 容器环境避免共享内存耗尽
    `--remote-debugging-port=${port}`, // 暴露 CDP 端口
    `--user-data-dir=${profileDir}`, // 指向全新临时用户目录
    'about:blank', // 初始空白页
  ];
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] }); // 启动浏览器进程
  let stderr = ''; // 收集少量 stderr 便于失败诊断
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString(); // 累积输出
    if (stderr.length > 8000) stderr = stderr.slice(-8000); // 只保留尾部，避免无限增长
  });
  const endpoint = `http://127.0.0.1:${port}`; // CDP HTTP 入口
  let targets; // 目标列表
  try {
    targets = await waitForCdpHttp(endpoint); // 等待浏览器暴露调试端口
  } catch (error) {
    child.kill(); // 启动失败时清理进程
    throw new ConfigError(`${error.message}\n浏览器 stderr 尾部：\n${stderr}`); // 附带浏览器诊断
  }
  const page = targets.find((target) => target.type === 'page'); // 取默认 about:blank 页面
  if (!page?.webSocketDebuggerUrl) {
    child.kill(); // 没有页面目标则清理
    throw new ConfigError('浏览器没有创建 page 目标，无法执行页面验收'); // 环境异常
  }
  const client = await CdpClient.connect(page.webSocketDebuggerUrl); // 连接页面级 CDP

  const close = async () => {
    client.close(); // 先断开 CDP
    if (KEEP_BROWSER) {
      console.log(`[INFO] 已保留浏览器现场：profile=${profileDir} cdp=${endpoint}`); // 调试提示
      return; // 不杀进程、不删目录
    }
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve(); // 进程已退出
      const timer = setTimeout(() => {
        child.kill('SIGKILL'); // 兜底强制结束
        resolve(); // 继续清理
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer); // 正常退出清理定时器
        resolve(); // 继续清理
      });
      child.kill(); // 先发送默认终止信号
    });
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); // Windows 文件锁需要重试
    } catch {
      // 清理失败不影响验收结论
    }
  };
  return { client, close }; // 返回页面客户端与收尾函数
}

// ---------- 主流程 ----------

/** 主流程：所有检查按层执行，最终统一汇总 */
async function main() {
  // 前置校验：Node 能力与地址合法性
  if (typeof fetch !== 'function') throw new ConfigError('当前 Node 不支持全局 fetch，请使用 Node 18+'); // fetch 是基础依赖
  if (typeof WebSocket !== 'function') throw new ConfigError('当前 Node 不支持全局 WebSocket，请使用 Node 22+ 或加 --experimental-websocket'); // CDP 依赖原生 WebSocket
  try {
    new URL(WEB_BASE); // 校验站点地址可解析
    new URL(API_BASE); // 校验 API 地址可解析
  } catch {
    throw new ConfigError(`地址格式非法：WEB_BASE=${WEB_BASE} API_BASE=${API_BASE}`); // 配置错误
  }

  console.log('=== Mim 前端匿名取证 ==='); // 打印标题
  console.log(`站点：${WEB_BASE}`); // 打印公开站点，不包含任何凭据
  console.log(`接口：${API_BASE}`); // 打印公开接口
  console.log(`凭据：Bearer=${AUTH_TOKEN ? '已提供' : '未提供'} 超管令牌=${ADMIN_TOKEN ? '已提供' : '未提供'} 只读库=${DB_PATH ? '已配置' : '未配置'}`); // 只打印是否存在，绝不打印值
  console.log(''); // 空行分隔

  const db = await openReadonlyDb(); // 可选打开只读库，失败即配置错误

  // ---------- 可达性预检：网络不可达时整轮 SKIP 放行，不把环境问题误判成语义 FAIL ----------

  const health = await apiRequest('GET', '/healthz'); // 探活：健康检查是最轻量的可达性证据
  const networkDown = health.unreachable === true || health.status === 0; // 网络层失败 / 连接被拒 / 超时都算不可达
  if (networkDown) {
    const reason = health.error ?? `HTTP ${health.status}`; // 取网络错误明细，缺省回落到状态码
    record('L2', 'NET-1', '目标可达性预检 GET /healthz', 'SKIP', `API 目标不可达：${reason}（${API_BASE}）；网络不可达时整轮 SKIP，不判 FAIL`);
    record('L1', 'NET-2', '清洁上下文（浏览器层）', 'SKIP', 'API 目标不可达，跳过浏览器清洁上下文验收');
    record('L3', 'NET-3', '页面层匿名验收', 'SKIP', 'API 目标不可达，跳过页面层验收');
    record('L4', 'NET-4', '污染检查', 'SKIP', 'API 目标不可达，跳过前后污染对比');
    if (db) db.close(); // 收尾只读库
    process.exit(printSummary()); // SKIP 不阻断门禁，退出码 0
  }

  // ---------- L2 接口层 ----------

  const list = await apiRequest('GET', '/community/threads?limit=12'); // 匿名读列表：白名单核心入口
  record('L2', 'L2-1', '匿名读列表白名单 GET /community/threads', list.status === 200 ? 'PASS' : 'FAIL', httpEvidence(list)); // 200 才算放行

  const items = isObject(list.json) && Array.isArray(list.json.items) ? list.json.items : []; // 提取列表项，异常时给空数组
  let target = null; // 选中用于深链与浏览计数的免费帖子
  let targetDetail = null; // 选中帖子的匿名详情响应
  let sawDetail200 = false; // 是否至少有一条详情返回 200

  for (const item of items.slice(0, 8)) {
    if (!item?.id) continue; // 缺少 ID 的脏数据跳过
    const detail = await apiRequest('GET', `/community/threads/${encodeURIComponent(item.id)}`); // 匿名读详情：白名单第二入口
    if (detail.status === 200) sawDetail200 = true; // 记录详情白名单已通过
    if (!target && detail.status === 200 && detail.json?.unlocked === true && typeof detail.json?.thread?.body === 'string' && detail.json.thread.body.trim()) {
      target = item; // 选中真正可读的免费帖子，保证深链正文断言可执行
      targetDetail = detail; // 保存基线响应，避免重复请求
      break; // 找到即停止
    }
  }

  if (!sawDetail200) {
    const fallback = items[0]?.id ? await apiRequest('GET', `/community/threads/${encodeURIComponent(items[0].id)}`) : null; // 兜底再试首条，确保有失败证据
    record('L2', 'L2-2', '匿名读详情白名单 GET /community/threads/:id', 'FAIL', fallback ? httpEvidence(fallback) : '列表为空，无详情可测'); // 无 200 即失败
  } else {
    record('L2', 'L2-2', '匿名读详情白名单 GET /community/threads/:id', 'PASS', targetDetail ? httpEvidence(targetDetail) : '至少一条详情返回 200'); // 详情白名单通过
  }

  record('L2', 'L2-3', '对照组 GET 同一路径放行', list.status === 200 ? 'PASS' : 'FAIL', httpEvidence(list)); // 与下方 POST 形成同路径对照

  const createProbe = await apiRequest('POST', '/community/threads', { body: {} }); // 匿名创建帖子：预期在写入门禁被拦截
  if (isUnauthorizedJson(createProbe)) {
    record('L2', 'L2-4', '对照组 POST 同一路径拦截', 'PASS', httpEvidence(createProbe)); // 401 + AUTH_UNAUTHORIZED 才算正确
  } else {
    record('L2', 'L2-4', '对照组 POST 同一路径拦截', 'FAIL', `${httpEvidence(createProbe)}（期望 401 code=AUTH_UNAUTHORIZED）`); // 打印实际状态码与 URL
  }

  if (target) {
    const likeProbe = await apiRequest('POST', `/community/threads/${encodeURIComponent(target.id)}/like`, { body: {} }); // 匿名点赞：预期 401
    record('L2', 'L2-5', '匿名写动作 POST /community/threads/:id/like', isUnauthorizedJson(likeProbe) ? 'PASS' : 'FAIL', isUnauthorizedJson(likeProbe) ? httpEvidence(likeProbe) : `${httpEvidence(likeProbe)}（期望 401 code=AUTH_UNAUTHORIZED）`); // 写动作必须被拦截
  } else {
    record('L2', 'L2-5', '匿名写动作 POST /community/threads/:id/like', 'SKIP', '没有可用的免费帖子 ID，无法构造点赞探测'); // 缺少前置数据
  }

  const me = await apiRequest('GET', '/me'); // 匿名私密读：当前用户资料
  record('L2', 'L2-6', '匿名私密读 GET /me', isUnauthorizedJson(me) ? 'PASS' : 'FAIL', isUnauthorizedJson(me) ? httpEvidence(me) : `${httpEvidence(me)}（期望 401 code=AUTH_UNAUTHORIZED）`); // 私密读必须 401

  const favorites = await apiRequest('GET', '/community/favorites'); // 匿名私密读：我的收藏
  record('L2', 'L2-7', '匿名私密读 GET /community/favorites', isUnauthorizedJson(favorites) ? 'PASS' : 'FAIL', isUnauthorizedJson(favorites) ? httpEvidence(favorites) : `${httpEvidence(favorites)}（期望 401 code=AUTH_UNAUTHORIZED）`); // 私密读必须 401

  const adminProbe = await apiRequest('GET', '/admin/users?limit=1&offset=0'); // 匿名访问管理接口：预期 401 JSON
  const adminIsJson = /application\/json/i.test(adminProbe.contentType); // 必须明确是 JSON
  const adminIsNotHtml = !/text\/html/i.test(adminProbe.contentType) && !/<!doctype|<html/i.test(adminProbe.text); // 不能回落到登录页 HTML
  if (isUnauthorizedJson(adminProbe) && adminIsJson && adminIsNotHtml) {
    record('L2', 'L2-8', '匿名 /admin/* 返回 401 JSON', 'PASS', httpEvidence(adminProbe)); // 状态码、错误码、内容类型全部正确
  } else {
    const hint = adminProbe.status === 404 ? '（实际 404，说明管理路由未注册或反代未转发）' : '（期望 401 JSON，不能是 404 或登录页 HTML）'; // 针对常见误判给出提示
    record('L2', 'L2-8', '匿名 /admin/* 返回 401 JSON', 'FAIL', `${httpEvidence(adminProbe)}${hint}`); // 打印实际状态码与 URL
  }

  if (AUTH_TOKEN) {
    const meAuthed = await apiRequest('GET', '/me', { token: AUTH_TOKEN }); // 先验证令牌真实有效
    if (meAuthed.status === 200) {
      record('L2', 'L2-9', '已认证 Bearer 令牌有效性 GET /me', 'PASS', httpEvidence(meAuthed)); // 令牌有效才能继续判断缓存头
      const cached = await apiRequest('GET', '/community/threads?limit=1', { token: AUTH_TOKEN }); // 带 Bearer 访问匿名读接口
      const cache = cached.cacheControl.toLowerCase(); // 缓存头统一小写便于匹配
      const isPrivate = /\bprivate\b/.test(cache); // 必须声明 private
      const isNoStore = /\bno-store\b/.test(cache); // 必须声明 no-store
      const isPublicMaxAge = /\bpublic\b/.test(cache) && /\bmax-age=/.test(cache); // 典型的可共享缓存配置
      if (cached.status === 200 && isPrivate && isNoStore && !isPublicMaxAge) {
        record('L2', 'L2-10', '已认证响应 Cache-Control 为 private, no-store', 'PASS', httpEvidence(cached)); // 符合预期
      } else {
        const reason = isPublicMaxAge ? '（出现 public + max-age，认证响应可能被共享缓存）' : '（期望 private, no-store）'; // 明确指出失败形态
        const actualCache = cached.cacheControl || '（缺失）'; // 头缺失也要显式打印，避免只剩「期望」看不到实际值
        record('L2', 'L2-10', '已认证响应 Cache-Control 为 private, no-store', 'FAIL', `${httpEvidence(cached)} 实际 cache-control=${actualCache}${reason}`); // 打印实际缓存头
      }
    } else {
      record('L2', 'L2-9', '已认证 Bearer 令牌有效性 GET /me', 'FAIL', `${httpEvidence(meAuthed)}（令牌可能过期或无效）`); // 令牌问题必须明确
      record('L2', 'L2-10', '已认证响应 Cache-Control 为 private, no-store', 'SKIP', 'Bearer 令牌无效，无法判断认证响应头'); // 避免误报为缓存配置问题
    }
  } else {
    record('L2', 'L2-9', '已认证 Bearer 令牌有效性 GET /me', 'SKIP', '未提供 MIM_EVIDENCE_AUTH_TOKEN'); // 无凭据时不伪造
    record('L2', 'L2-10', '已认证响应 Cache-Control 为 private, no-store', 'SKIP', '未提供 MIM_EVIDENCE_AUTH_TOKEN'); // 无凭据时不伪造
  }

  // ---------- L4 污染检查：浏览器动作前的基线 ----------

  const usersBefore = db ? scalarCount(db, 'SELECT COUNT(*) AS n FROM users') : null; // 只读库优先，精确且不受鉴权影响
  const anonLedgerBefore = db ? scalarCount(db, "SELECT COUNT(*) AS n FROM community_thread_views WHERE user_id = ''") : null; // 匿名去重账本基线
  const viewsBefore = targetDetail?.json?.thread?.views ?? null; // 浏览计数基线：用于无库时的弱证据判断

  let adminUsersBefore = null; // 无库时回退用超管接口
  let adminUsersError = null; // 记录回退接口失败原因
  if (!db && ADMIN_TOKEN) {
    const adminBefore = await apiRequest('GET', '/admin/users?limit=1&offset=0', { adminToken: ADMIN_TOKEN }); // 超管读取 users 总数
    if (adminBefore.status === 200 && isObject(adminBefore.json) && typeof adminBefore.json.total === 'number') {
      adminUsersBefore = adminBefore.json.total; // 记录基线
    } else {
      adminUsersError = httpEvidence(adminBefore); // 保留失败证据
    }
  }

  // ---------- L1 / L3 浏览器验收 ----------

  let browser; // 浏览器句柄
  let browserFailure = null; // 记录浏览器启动失败原因
  try {
    browser = await startBrowser(); // 启动独立无头浏览器或连接显式 CDP
    const { client } = browser; // 取出 CDP 客户端
    await client.send('Page.enable'); // 启用页面域
    await client.send('Runtime.enable'); // 启用运行时求值
    await client.send('Network.enable'); // 启用网络事件，用于失败时回传主文档状态码
    await client.send('Network.setCacheDisabled', { cacheDisabled: true }); // 关闭缓存，确保看到真实响应
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); // 固定桌面视口

    const communityUrl = `${WEB_BASE}/community`; // 社区列表页
    const communityDoc = await client.goto(communityUrl, "document.querySelectorAll('.community-card').length > 0"); // 等待列表卡片出现
    const communityPath = await client.evaluate('location.pathname'); // 读取最终路径
    const normalizedCommunityPath = communityPath.replace(/\/+$/, ''); // 去掉尾部斜杠，避免 /community/ 被误判
    const expectedCommunityPath = new URL(communityUrl).pathname.replace(/\/+$/, ''); // 期望路径同样归一化

    if (normalizedCommunityPath === expectedCommunityPath) {
      record('L3', 'L3-1', '/community 不跳登录', 'PASS', `最终路径 ${communityPath}`); // 路径未被改写
    } else {
      const doc = communityDoc?.status ? ` 主文档 ${communityDoc.status} ${communityDoc.url}` : ''; // 附带主文档状态
      record('L3', 'L3-1', '/community 不跳登录', 'FAIL', `实际路径 ${communityPath}，期望 ${expectedCommunityPath}${doc}`); // 打印实际路径与状态
    }

    // L1 清洁上下文必须在任何点击前完成：新开临时用户目录 + 应用自身不写 Cookie/localStorage
    const cookies = await client.send('Network.getAllCookies'); // 读取浏览器全部 Cookie（含 HttpOnly）
    const cookieNames = (cookies.cookies || []).map((cookie) => cookie.name); // 只展示名称，不展示值
    const storage = await client.evaluate('({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie })'); // 读取 Web Storage 与脚本可见 Cookie

    if (cookieNames.length === 0 && storage.cookie === '') {
      record('L1', 'L1-1', '清洁上下文：无 Cookie', 'PASS', '浏览器 Cookie 罐与 document.cookie 均为空'); // Cookie 为空
    } else {
      record('L1', 'L1-1', '清洁上下文：无 Cookie', 'FAIL', `实际 Cookie 名称=${JSON.stringify(cookieNames)} document.cookie 长度=${storage.cookie.length}`); // 只打印名称，避免泄露值
    }

    if (storage.local.length === 0) {
      record('L1', 'L1-2', '清洁上下文：无 localStorage', 'PASS', 'localStorage 键数量 0'); // localStorage 为空
    } else {
      record('L1', 'L1-2', '清洁上下文：无 localStorage', 'FAIL', `实际键=${JSON.stringify(storage.local)}`); // 打印键名
    }

    if (storage.session.length === 0) {
      record('L1', 'L1-3', '清洁上下文：无 sessionStorage', 'PASS', 'sessionStorage 键数量 0'); // sessionStorage 为空
    } else {
      record('L1', 'L1-3', '清洁上下文：无 sessionStorage', 'FAIL', `实际键=${JSON.stringify(storage.session)}`); // 打印键名
    }

    const cardCount = await client.evaluate("document.querySelectorAll('.community-card').length"); // 列表卡片数量
    const bodyTextLength = await client.evaluate('(document.body.innerText || "").trim().length'); // 页面正文长度，避免只看骨架
    if (cardCount > 0 && bodyTextLength > 50) {
      record('L3', 'L3-2', '/community 列表有内容', 'PASS', `卡片 ${cardCount} 个，正文 ${bodyTextLength} 字符`); // 列表真实渲染
    } else {
      const doc = communityDoc?.status ? ` 主文档 ${communityDoc.status} ${communityDoc.url}` : ''; // 附带主文档状态
      record('L3', 'L3-2', '/community 列表有内容', 'FAIL', `卡片 ${cardCount} 个，正文 ${bodyTextLength} 字符${doc}`); // 可能接口失败或页面报错
    }

    if (target) {
      const detailUrl = `${WEB_BASE}/community/post/${target.id}`; // 深链地址
      const detailDoc = await client.goto(detailUrl, "document.querySelector('.community-detail') !== null"); // 等待详情容器渲染
      const actualPath = await client.evaluate('location.pathname'); // 读取实际路径
      const expectedPath = new URL(detailUrl).pathname; // 期望路径
      if (actualPath === expectedPath || actualPath.endsWith(`/community/post/${target.id}`)) {
        record('L3', 'L3-3', '深链 /community/post/:id 路径不被改写', 'PASS', `最终路径 ${actualPath}`); // 路径保持
      } else {
        const doc = detailDoc?.status ? ` 主文档 ${detailDoc.status} ${detailDoc.url}` : ''; // 附带主文档状态
        record('L3', 'L3-3', '深链 /community/post/:id 路径不被改写', 'FAIL', `实际路径 ${actualPath}，期望 ${expectedPath}${doc}`); // 打印实际路径
      }

      const detailBody = await client.evaluate("(document.querySelector('.community-detail-body')?.innerText || '').trim()"); // 详情正文
      if (detailBody.length > 0) {
        record('L3', 'L3-4', '深链正文非空', 'PASS', `正文 ${detailBody.length} 字符`); // 正文真实返回
      } else {
        const doc = detailDoc?.status ? ` 主文档 ${detailDoc.status} ${detailDoc.url}` : ''; // 附带主文档状态
        record('L3', 'L3-4', '深链正文非空', 'FAIL', `正文长度 0，帖子 ${target.id}${doc}`); // 可能接口失败或解锁逻辑异常
      }

      const clickResult = await client.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('.community-detail-actions button'));
        const like = buttons.find((button) => /点赞|已赞/.test(button.textContent || ''));
        if (!like) return 'missing';
        like.click();
        return 'clicked';
      })()`); // 匿名点击点赞按钮
      if (clickResult === 'clicked') {
        const reached = await client.waitFor("location.pathname.replace(/\\/+$/, '').endsWith('/signin')", 5000); // 等待跳转登录页
        const finalPath = await client.evaluate('location.pathname'); // 读取最终路径
        if (reached) {
          record('L3', 'L3-5', '匿名点赞跳登录', 'PASS', `最终路径 ${finalPath}`); // 成功跳转
        } else {
          const hasAuth = await client.evaluate("document.querySelector('.auth-wrap') !== null"); // 兜底识别登录卡片
          record('L3', 'L3-5', '匿名点赞跳登录', hasAuth ? 'PASS' : 'FAIL', hasAuth ? `已显示登录卡片，路径 ${finalPath}` : `最终路径 ${finalPath}，未出现 /signin 或 .auth-wrap`); // 打印实际路径
        }
      } else {
        record('L3', 'L3-5', '匿名点赞跳登录', 'FAIL', '详情页未找到包含「点赞 / 已赞」的按钮'); // 选择器失配或页面未渲染
      }
    } else {
      record('L3', 'L3-3', '深链 /community/post/:id 路径不被改写', 'SKIP', '没有可用的帖子 ID'); // 缺少前置数据
      record('L3', 'L3-4', '深链正文非空', 'SKIP', '没有可用的免费帖子（前 8 条均锁定或无正文）'); // 避免把付费锁误判为页面故障
      record('L3', 'L3-5', '匿名点赞跳登录', 'SKIP', '没有可用的帖子 ID，无法进入详情页'); // 缺少前置数据
    }

    const adminUrl = `${WEB_BASE}/admin/`; // 管理后台入口
    const adminDoc = await client.goto(adminUrl, "document.querySelector('.login-card') !== null"); // 等待登录卡片
    const adminPath = await client.evaluate('location.pathname'); // 实际路径
    const adminLogin = await client.evaluate("document.querySelector('.login-card') !== null && /Mim 管理后台/.test(document.body.innerText || '')"); // 登录页特征
    if (adminPath.startsWith('/admin') && adminLogin) {
      record('L3', 'L3-6', '匿名打开 /admin/ 显示登录页', 'PASS', `最终路径 ${adminPath}`); // 登录页正常
    } else {
      const doc = adminDoc?.status ? ` 主文档 ${adminDoc.status} ${adminDoc.url}` : ''; // 附带主文档状态
      record('L3', 'L3-6', '匿名打开 /admin/ 显示登录页', 'FAIL', `最终路径 ${adminPath}，登录卡片=${adminLogin}${doc}`); // 打印实际路径与状态
    }
  } catch (error) {
    browserFailure = error; // 记录异常，稍后统一归类（truthy 时 L4 污染检查整体 SKIP）
    if (error instanceof ConfigError) {
      // 浏览器 / CDP 等环境依赖缺失（CI  runner 常无 Chrome/Edge）：浏览器层整体 SKIP 放行，
      // 已跑完的 L2 接口层结论不受影响；不再上抛退出码 2 把环境问题误判成门禁红灯。
      record('L1', 'L1-0', '清洁上下文（浏览器层）', 'SKIP', `浏览器环境不可用：${error.message}`);
      record('L3', 'L3-0', '页面层匿名验收', 'SKIP', `浏览器环境不可用：${error.message}`);
      console.error(`[SKIP] 浏览器验收跳过（环境依赖不可用）：${error.message}`);
    } else {
      record('L3', 'L3-0', '无头浏览器验收执行', 'FAIL', `执行中断：${error.message}`); // 中断本身就是失败，不能静默退出 0
      console.error(`[ERROR] 浏览器验收中断：${error.message}`); // 同时打印到 stderr 便于排查
    }
  } finally {
    if (browser) await browser.close(); // 无论成功失败都清理浏览器
  }

  // ---------- L4 污染检查：浏览器动作后的对比 ----------

  if (browserFailure) {
    record('L4', 'L4-1', 'users 计数与基线一致', 'SKIP', '浏览器验收中断，无法证明匿名浏览的写入副作用'); // 无法闭环时不伪造结论
    record('L4', 'L4-2', '匿名浏览不写浏览去重账本', 'SKIP', '浏览器验收中断，无法证明匿名浏览的写入副作用'); // 同上
  } else {
    if (db) {
      const usersAfter = scalarCount(db, 'SELECT COUNT(*) AS n FROM users'); // 跑完后用户总数
      if (usersAfter === usersBefore) {
        record('L4', 'L4-1', 'users 计数与基线一致', 'PASS', `基线 ${usersBefore}，跑完 ${usersAfter}`); // 数量一致
      } else {
        record('L4', 'L4-1', 'users 计数与基线一致', 'FAIL', `基线 ${usersBefore}，跑完 ${usersAfter}（差值 ${usersAfter - usersBefore}）`); // 明确差值
      }
      const anonLedgerAfter = scalarCount(db, "SELECT COUNT(*) AS n FROM community_thread_views WHERE user_id = ''"); // 匿名去重账本终值
      if (anonLedgerAfter === anonLedgerBefore) {
        record('L4', 'L4-2', '匿名浏览不写浏览去重账本', 'PASS', `匿名账本基线 ${anonLedgerBefore}，跑完 ${anonLedgerAfter}`); // 无新增匿名行
      } else {
        record('L4', 'L4-2', '匿名浏览不写浏览去重账本', 'FAIL', `匿名账本基线 ${anonLedgerBefore}，跑完 ${anonLedgerAfter}（新增 ${anonLedgerAfter - anonLedgerBefore}）`); // 明确新增数量
      }
    } else {
      if (ADMIN_TOKEN) {
        const adminAfter = await apiRequest('GET', '/admin/users?limit=1&offset=0', { adminToken: ADMIN_TOKEN }); // 回退接口读取总数
        if (adminAfter.status === 200 && isObject(adminAfter.json) && typeof adminAfter.json.total === 'number' && adminUsersBefore !== null) {
          if (adminAfter.json.total === adminUsersBefore) {
            record('L4', 'L4-1', 'users 计数与基线一致', 'PASS', `基线 ${adminUsersBefore}，跑完 ${adminAfter.json.total}`); // 数量一致
          } else {
            record('L4', 'L4-1', 'users 计数与基线一致', 'FAIL', `基线 ${adminUsersBefore}，跑完 ${adminAfter.json.total}（差值 ${adminAfter.json.total - adminUsersBefore}）`); // 明确差值
          }
        } else if (adminUsersError) {
          record('L4', 'L4-1', 'users 计数与基线一致', 'FAIL', `基线读取失败：${adminUsersError}`); // 凭据存在但接口失败
        } else {
          record('L4', 'L4-1', 'users 计数与基线一致', 'FAIL', httpEvidence(adminAfter)); // 跑完后读取失败
        }
      } else {
        record('L4', 'L4-1', 'users 计数与基线一致', 'SKIP', '未提供 MIM_EVIDENCE_DB_PATH 或超管令牌，无法读取 users 计数'); // 明确缺什么
      }

      if (target) {
        const detailAfter = await apiRequest('GET', `/community/threads/${encodeURIComponent(target.id)}`); // 复读同一帖详情
        const viewsAfter = detailAfter.json?.thread?.views; // 跑完后浏览计数
        if (detailAfter.status !== 200 || typeof viewsAfter !== 'number') {
          record('L4', 'L4-2', '匿名浏览不写浏览去重账本', 'FAIL', `${httpEvidence(detailAfter)}（无法读取浏览计数）`); // 读不到就无法证明
        } else if (typeof viewsBefore === 'number' && viewsAfter > viewsBefore) {
          record('L4', 'L4-2', '匿名浏览不写浏览去重账本', 'FAIL', `浏览量基线 ${viewsBefore}，跑完 ${viewsAfter}（匿名浏览触发了计数）`); // 强证据：计数被增加
        } else {
          record('L4', 'L4-2', '匿名浏览不写浏览去重账本', 'SKIP', `浏览量保持 ${viewsBefore}，但未配置只读库，无法排除历史匿名账本行导致计数不增`); // 弱证据，诚实标注
        }
      } else {
        record('L4', 'L4-2', '匿名浏览不写浏览去重账本', 'SKIP', '没有可用的帖子 ID，无法验证账本'); // 缺少前置数据
      }
    }
  }

  if (db) db.close(); // 关闭只读库连接

  // ---------- 汇总与退出码 ----------

  process.exit(printSummary()); // 统一走汇总函数：有 FAIL 退出 1，仅 SKIP 退出 0
}

// 顶层错误兜底：配置 / 环境问题统一退出码 2
main().catch((error) => {
  console.error(''); // 与正常输出分隔
  console.error(`[配置错误] ${error.message}`); // 只打印原因，不打印任何凭据
  process.exit(2); // 前置条件不满足
});
