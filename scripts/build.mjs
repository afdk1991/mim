#!/usr/bin/env node
/**
 * scripts/build.mjs
 *
 * 根级构建脚本：构建**真实 Mim 前端**（apps/web/dist）并同步到根 dist/，
 * 供本地预览与静态托管使用。同步后会额外生成 SPA 回退载体：
 * `dist/404.html` 与 `dist/<view>/index.html`（视图清单从 router.ts 的 VIEWS 解析），
 * 用于 EdgeOne Pages 这类不支持 history 路由重写的静态托管。
 *
 * 用法：
 *   node scripts/build.mjs          # 构建真实前端 → 根 dist/
 *
 * 环境变量：
 *   VITE_API_ORIGIN  前端调用的 API 源；未设置时默认生产 API 源为 https://mim.mixm.top。
 *
 * 注：刻意不使用 fs.cpSync——本机 Node 在该 API 上出现 0xC0000409 崩溃，
 *     故采用 copyFileSync 手动递归复制，跨平台稳定。
 */

// 文件系统原语：复制 / 判断存在 / 建目录 / 读目录 / 删目录 / 取文件状态
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
// 子进程执行器：用于调用 pnpm 完成 workspace 安装与前端构建
import { spawnSync } from 'node:child_process';
// 路径工具：目录名解析 / 拼接
import { dirname, join } from 'node:path';
// ESM 下取当前文件绝对路径（替代 __filename）
import { fileURLToPath } from 'node:url';

// 当前脚本所在目录（scripts/）
const __dirname = dirname(fileURLToPath(import.meta.url));
// 仓库根目录（scripts 的上一级）
const ROOT = join(__dirname, '..');
// PRD 阅读页源码目录（仅 --site 模式使用）
const SITE_SRC = join(ROOT, 'site');
// 真实前端工作区目录（apps/web）
const WEB_DIR = join(ROOT, 'apps', 'web');
// 根级输出目录：托管平台（EdgeOne Pages OutputDir=dist）读取此处
const DIST = join(ROOT, 'dist');
// 真实前端的构建产物目录（vite build 输出）
const WEB_DIST = join(WEB_DIR, 'dist');
// 是否走「仅站点点预览」模式：命令行出现 --site 即开启
const SITE_ONLY = process.argv.includes('--site');
// Windows 下 pnpm 是可执行批处理，shell 模式更稳；此处仅做统一入口名
const PNPM = 'pnpm';

/**
 * 同步执行命令并把输出透传到当前终端。
 * @param {string[]} args 参数数组（首项为命令）
 * @param {Record<string,string>} [extraEnv] 额外环境变量
 * @returns {number} 退出码；0 表示成功
 */
function run(args, extraEnv = {}) {
  // shell: true 让 Windows 能解析 pnpm.cmd / npx.cmd；stdio 继承以保留构建日志
  const result = spawnSync(args[0], args.slice(1), {
    cwd: ROOT, // 统一在仓库根执行，保证 workspace 解析正确
    stdio: 'inherit', // 日志直通终端，便于 CI/控制台排障
    shell: true, // 允许 shell 解析，兼容 Windows 批处理
    env: { ...process.env, ...extraEnv }, // 合入额外环境变量（如 VITE_API_ORIGIN）
  }); // 代码块结束
  // spawnSync 在命令不存在时 status 为 null，统一折算为 1（失败）
  return result.status ?? 1;
} // 代码块结束

/**
 * 递归复制目录并返回复制的文件数。
 * @param {string} src 源目录
 * @param {string} dest 目标目录（不存在会自动创建）
 * @returns {number} 复制的文件数量
 */
function copyDir(src, dest) {
  // 计数器：累计本层及子层复制的文件数
  let n = 0;
  // 遍历源目录第一层条目（文件名，不含路径）
  for (const name of readdirSync(src)) {
    // 当前条目的绝对源路径
    const srcPath = join(src, name);
    // 当前条目的绝对目标路径
    const destPath = join(dest, name);
    // 目录：递归处理（先建目录，避免 copyFileSync 因父目录缺失报错）
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true }); // 调用 mkdirSync 并处理其返回结果
      // 累加子目录内的文件数
      n += copyDir(srcPath, destPath);
    } else { // 代码块结束
      // 普通文件：直接覆盖复制
      copyFileSync(srcPath, destPath);
      // 文件计数 +1
      n += 1;
    } // 代码块结束
  } // 代码块结束
  // 返回本层累计文件数
  return n;
} // 代码块结束

/**
 * 用指定源目录重建根 dist/（先清空，保持幂等）。
 * @param {string} src 源目录
 * @param {string} label 日志标签（说明产物性质）
 */
function emitDist(src, label) {
  // 源目录缺失说明上游步骤失败，直接报错退出，避免发布空站
  if (!existsSync(src)) {
    console.error(`❌ 源目录不存在: ${src}`); // 向控制台输出运行日志或错误信息
    process.exit(1); // 执行当前业务步骤
  } // 代码块结束
  // 清理旧产物，避免上一轮文件残留（幂等）
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true, force: true }); // 调用 rmSync 并处理其返回结果
  } // 代码块结束
  // 预建输出目录
  mkdirSync(DIST, { recursive: true });
  // 递归复制并统计
  const copied = copyDir(src, DIST);
  // 打印结果，便于 CI 日志核对
  console.log(`✅ 构建完成（${label}）: ${DIST} (${copied} 个文件)`);
} // 代码块结束

/**
 * 确保 pnpm 可用：优先系统 pnpm，缺失时用 npx 临时拉取锁定版本。
 * @returns {{cmd: string, prefix: string[]}} 可用的命令前缀
 */
function ensurePnpm() {
  // 探测系统 pnpm（--version 成功即视为可用）
  const probe = spawnSync(PNPM, ['--version'], { cwd: ROOT, shell: true, stdio: 'ignore' });
  // 退出码 0 表示系统已装 pnpm（版本由 packageManager 字段约束，无需强制检查）
  if ((probe.status ?? 1) === 0) return { cmd: PNPM, prefix: [] };
  // 兜底：EdgeOne / 纯 npm 环境没有 pnpm，用 npx 临时拉取与 packageManager 一致的版本
  console.log('ℹ️ 未检测到 pnpm，回退 npx pnpm@9.12.0');
  return { cmd: 'npx', prefix: ['--yes', 'pnpm@9.12.0'] }; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 从 apps/web/src/router.ts 解析 SPA 对外路径段清单，避免构建脚本与前端路由两处手写清单漂移。
 * 2026-11-11 起视图标识与对外路径段解耦：对外地址一律用模块功能名称（如 /marketplace），
 * 因此这里解析的是 VIEW_SEGMENTS 映射表的值，而不是内部视图标识。
 * @returns {string[]} 路径段数组（如 ['marketplace', 'entry-catalog', ...]）
 */
function readSpaPaths() {
  // 路由源码路径：路径段映射表定义在此
  const routerPath = join(WEB_DIR, 'src', 'router.ts');
  // 源码缺失说明仓库结构异常，直接失败以免产出缺目录的部署
  if (!existsSync(routerPath)) {
    console.error(`❌ 未找到路由源码: ${routerPath}`); // 向控制台输出运行日志或错误信息
    process.exit(1); // 执行当前业务步骤
  } // 代码块结束
  // 读取源码文本，用正则抓 VIEW_SEGMENTS 的对象字面量
  const text = readFileSync(routerPath, 'utf8');
  // 匹配形如 `const VIEW_SEGMENTS: Record<AppView, string> = { store: 'marketplace', ... };`
  const match = text.match(/const VIEW_SEGMENTS[^=]*=\s*\{([\s\S]*?)\n\};/);
  // 未命中说明路由实现已改结构，宁可失败也不静默产出错误目录
  if (!match) {
    console.error('❌ 未能从 apps/web/src/router.ts 解析 VIEW_SEGMENTS 映射表'); // 向控制台输出运行日志或错误信息
    process.exit(1); // 执行当前业务步骤
  } // 代码块结束
  // 提取所有「键: '值'」中的值作为对外路径段
  const paths = [...match[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  // 路径段为空同样视为解析失败，避免生成 0 个目录却静默通过
  if (paths.length === 0) {
    console.error('❌ VIEW_SEGMENTS 解析结果为空，无法生成 SPA 深链接目录'); // 向控制台输出运行日志或错误信息
    process.exit(1); // 执行当前业务步骤
  } // 代码块结束
  return paths; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 为不支持 SPA 前端路由重写的静态托管（EdgeOne Pages 等）生成回退产物：
 * 1) dist/404.html —— 与 index.html 逐字节一致的兜底页；
 * 2) dist/<view>/index.html —— 每个视图一个同名目录，使刷新 /marketplace、/chat 等深链接
 *    能直接命中真实静态文件（实测这是 EdgeOne 上最可靠的深链接方案）。
 * 只作用于根 dist/（EdgeOne 的 OutputDir），不改动 apps/web/dist，
 * 避免 GitHub Pages 等以 apps/web/dist 为上传源、且会补斜杠的平台上相对资源解析失效。
 */
function emitSpaFallback() {
  // 根 dist 的入口页：所有回退副本都以它为内容源
  const indexHtml = join(DIST, 'index.html');
  // 入口缺失说明复制步骤失败，直接终止
  if (!existsSync(indexHtml)) {
    console.error(`❌ 根 dist 缺少 index.html: ${indexHtml}`); // 向控制台输出运行日志或错误信息
    process.exit(1); // 执行当前业务步骤
  } // 代码块结束
  // 生成 404.html 兜底页（与入口同内容）
  copyFileSync(indexHtml, join(DIST, '404.html'));
  // 逐个对外路径段建目录并放入同名入口副本（目录名即模块功能名，如 marketplace）
  for (const segment of readSpaPaths()) {
    // 路径段目录绝对路径，如 dist/comic-studio
    const viewDir = join(DIST, segment);
    // 递归建目录（已存在时幂等）
    mkdirSync(viewDir, { recursive: true });
    // 写入该路径段的入口副本
    copyFileSync(indexHtml, join(viewDir, 'index.html'));
  } // 代码块结束
  // 输出取证日志，便于平台构建日志核对
  console.log(`✅ SPA 回退产物就绪: 404.html + ${readSpaPaths().length} 个路径段目录（${readSpaPaths().join(' / ')}）`);
} // 代码块结束

// --site 模式：只复制 PRD 阅读页，供离线预览（不再用于任何生产托管平台）
if (SITE_ONLY) {
  // 输出 site/ 内容到 dist/，与历史行为保持一致
  emitDist(SITE_SRC, 'PRD 阅读页 site → dist');
  process.exit(0); // 站点模式到此结束，不再构建前端
} // 代码块结束

// 默认模式：构建真实前端 → 根 dist/
const pnpm = ensurePnpm(); // 解析可用的 pnpm 入口
// 只安装 @mim/web 及其 workspace 依赖（含 @mim/core-domain / @mim/i18n），
// 避免在无原生编译能力的构建机上安装后端 better-sqlite3 等重型依赖。
const installCode = run([pnpm.cmd, ...pnpm.prefix, 'install', '--filter', '@mim/web...', '--frozen-lockfile']);
// 首次安装失败（如锁文件与 package.json 不一致）时降级为不校验锁文件重试一次
if (installCode !== 0) {
  console.warn('⚠️ 冻结锁文件安装失败，降级为普通安装重试'); // 向控制台输出运行日志或错误信息
  // 第二次安装：允许 pnpm 更新锁文件解析结果
  const retryCode = run([pnpm.cmd, ...pnpm.prefix, 'install', '--filter', '@mim/web...']);
  // 仍失败则终止，避免用残缺依赖继续构建
  if (retryCode !== 0) {
    console.error('❌ 依赖安装失败'); // 向控制台输出运行日志或错误信息
    process.exit(retryCode); // 执行当前业务步骤
  } // 代码块结束
} // 代码块结束
// 构建期 API 源：托管平台（EdgeOne）无同源后端，默认直连生产 API；可用 VITE_API_ORIGIN 覆盖
const apiOrigin = (process.env.VITE_API_ORIGIN ?? 'https://mim.mixm.top').replace(/\/+$/, '');
// 执行前端构建（tsc --noEmit + vite build），产物落在 apps/web/dist
const buildCode = run([pnpm.cmd, ...pnpm.prefix, '--filter', '@mim/web', 'build'], { VITE_API_ORIGIN: apiOrigin });
// 构建失败直接退出，阻断后续托管平台发布
if (buildCode !== 0) {
  console.error('❌ 前端构建失败'); // 向控制台输出运行日志或错误信息
  process.exit(buildCode); // 执行当前业务步骤
} // 代码块结束
// 把真实前端产物同步到根 dist/，供 EdgeOne Pages 等 OutputDir=dist 的平台读取
emitDist(WEB_DIST, `真实前端 apps/web/dist → dist，API=${apiOrigin}`);
// 为不支持 SPA 重写的静态托管补齐回退载体（404.html + 每个视图一个同名目录）
emitSpaFallback();
