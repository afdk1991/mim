#!/usr/bin/env node
/**
 * scripts/build.mjs
 *
 * 根级构建脚本：构建**真实 Mim 前端**（apps/web/dist）并同步到根 dist/，
 * 供本地预览与静态托管使用。
 *
 * 用法：
 *   node scripts/build.mjs          # 构建真实前端 → 根 dist/
 *
 * 环境变量：
 *   VITE_API_ORIGIN  前端调用的 API 源；未设置时默认生产 API https://mim.mixm.top。
 *
 * 注：刻意不使用 fs.cpSync——本机 Node 在该 API 上出现 0xC0000409 崩溃，
 *     故采用 copyFileSync 手动递归复制，跨平台稳定。
 */

// 文件系统原语：复制 / 判断存在 / 建目录 / 读目录 / 删目录 / 取文件状态
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
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
  });
  // spawnSync 在命令不存在时 status 为 null，统一折算为 1（失败）
  return result.status ?? 1;
}

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
      mkdirSync(destPath, { recursive: true });
      // 累加子目录内的文件数
      n += copyDir(srcPath, destPath);
    } else {
      // 普通文件：直接覆盖复制
      copyFileSync(srcPath, destPath);
      // 文件计数 +1
      n += 1;
    }
  }
  // 返回本层累计文件数
  return n;
}

/**
 * 用指定源目录重建根 dist/（先清空，保持幂等）。
 * @param {string} src 源目录
 * @param {string} label 日志标签（说明产物性质）
 */
function emitDist(src, label) {
  // 源目录缺失说明上游步骤失败，直接报错退出，避免发布空站
  if (!existsSync(src)) {
    console.error(`❌ 源目录不存在: ${src}`);
    process.exit(1);
  }
  // 清理旧产物，避免上一轮文件残留（幂等）
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true, force: true });
  }
  // 预建输出目录
  mkdirSync(DIST, { recursive: true });
  // 递归复制并统计
  const copied = copyDir(src, DIST);
  // 打印结果，便于 CI 日志核对
  console.log(`✅ 构建完成（${label}）: ${DIST} (${copied} 个文件)`);
}

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
  return { cmd: 'npx', prefix: ['--yes', 'pnpm@9.12.0'] };
}

// --site 模式：只复制 PRD 阅读页，供离线预览（不再用于任何生产托管平台）
if (SITE_ONLY) {
  // 输出 site/ 内容到 dist/，与历史行为保持一致
  emitDist(SITE_SRC, 'PRD 阅读页 site → dist');
  process.exit(0); // 站点模式到此结束，不再构建前端
}

// 默认模式：构建真实前端 → 根 dist/
const pnpm = ensurePnpm(); // 解析可用的 pnpm 入口
// 只安装 @mim/web 及其 workspace 依赖（含 @mim/core-domain / @mim/i18n），
// 避免在无原生编译能力的构建机上安装后端 better-sqlite3 等重型依赖。
const installCode = run([pnpm.cmd, ...pnpm.prefix, 'install', '--filter', '@mim/web...', '--frozen-lockfile']);
// 首次安装失败（如锁文件与 package.json 不一致）时降级为不校验锁文件重试一次
if (installCode !== 0) {
  console.warn('⚠️ 冻结锁文件安装失败，降级为普通安装重试');
  // 第二次安装：允许 pnpm 更新锁文件解析结果
  const retryCode = run([pnpm.cmd, ...pnpm.prefix, 'install', '--filter', '@mim/web...']);
  // 仍失败则终止，避免用残缺依赖继续构建
  if (retryCode !== 0) {
    console.error('❌ 依赖安装失败');
    process.exit(retryCode);
  }
}
// 构建期 API 源：托管平台（EdgeOne）无同源后端，默认直连生产 API；可用 VITE_API_ORIGIN 覆盖
const apiOrigin = (process.env.VITE_API_ORIGIN ?? 'https://mim.mixm.top').replace(/\/+$/, '');
// 执行前端构建（tsc --noEmit + vite build），产物落在 apps/web/dist
const buildCode = run([pnpm.cmd, ...pnpm.prefix, '--filter', '@mim/web', 'build'], { VITE_API_ORIGIN: apiOrigin });
// 构建失败直接退出，阻断后续托管平台发布
if (buildCode !== 0) {
  console.error('❌ 前端构建失败');
  process.exit(buildCode);
}
// 把真实前端产物同步到根 dist/，供 EdgeOne Pages 等 OutputDir=dist 的平台读取
emitDist(WEB_DIST, `真实前端 apps/web/dist → dist，API=${apiOrigin}`);
