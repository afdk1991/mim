#!/usr/bin/env node
/**
 * scripts/build.mjs
 *
 * 构建产物：把 site/ 静态站点复制到 dist/，供 EdgeOne Pages（OutputDir=dist）部署。
 * 当前站点为零依赖纯静态 HTML，无需打包器；保留本脚本以便未来切换为 Vite/Next 时平滑替换实现。
 *
 * 用法：node scripts/build.mjs
 *
 * 注：刻意不使用 fs.cpSync——本机 Node 在该 API 上出现 0xC0000409 崩溃，
 *     故采用 copyFileSync 手动递归复制，跨平台稳定。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'site');
const DIST = join(ROOT, 'dist');

if (!existsSync(SRC)) {
  console.error(`❌ 源目录不存在: ${SRC}`);
  process.exit(1);
}

// 清理旧产物（幂等）
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true, force: true });
}

mkdirSync(DIST, { recursive: true });
const copied = copyDir(SRC, DIST);
console.log(`✅ 构建完成: ${DIST} (${copied} 个文件)`);

function copyDir(src, dest) {
  let n = 0;
  for (const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const destPath = join(dest, name);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      n += copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      n += 1;
    }
  }
  return n;
}
