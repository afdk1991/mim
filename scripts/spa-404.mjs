#!/usr/bin/env node
/**
 * scripts/spa-404.mjs
 * 构建后处理：把 apps/web/dist/index.html 复制为 dist/404.html。
 * GitHub Pages 对未命中静态文件的路径会返回 404.html（状态 404），
 * 借此让 /mim/marketplace 等单段深链接（对外路径段为模块功能名称）拿到与首页完全相同的 SPA 入口，
 * 配合 index.html 头部的地址栏规整内联与 router.ts 的路径解析实现刷新可用。
 * 用法：由 apps/web 的 build 脚本在 vite build 之后自动调用，也可手动执行。
 */
// 文件操作：仅需复制与存在性判断，使用 Node 内置模块、零第三方依赖
import { copyFileSync, existsSync } from 'node:fs';
// 路径推导：脚本位置固定，据此定位产物目录，避免依赖调用方 cwd
import { dirname, join } from 'node:path';
// ESM 下没有 __dirname，用 import.meta.url 还原当前文件路径
import { fileURLToPath } from 'node:url';

// 当前脚本所在目录（scripts/）
const HERE = dirname(fileURLToPath(import.meta.url)); // 由文件 URL 转为绝对路径
// 前端产物目录：apps/web/dist
const DIST = join(HERE, '..', 'apps', 'web', 'dist'); // 相对 scripts 上溯一级再进入 apps/web/dist
// 源文件：vite 构建出的 SPA 入口
const SRC = join(DIST, 'index.html'); // 必须已存在
// 目标文件：GitHub Pages 约定的全站 404 回退页
const DST = join(DIST, '404.html'); // 与入口同目录、同内容

// 入口缺失说明构建未执行或产物被清理，直接失败退出并提示
if (!existsSync(SRC)) { // 防御性检查：避免静默产出空部署
  console.error('[spa-404] 缺少 apps/web/dist/index.html，请先执行构建'); // 明确失败原因
  process.exit(1); // 非零退出码让 CI / npm 脚本链路感知失败
} // 存在性检查结束

// 复制入口为 404.html：两份文件字节一致，保证深链接与首页行为一致
copyFileSync(SRC, DST); // 同步复制，构建期一次性操作、无并发问题
// 输出结果供 CI 日志取证
console.log('[spa-404] 已生成 apps/web/dist/404.html（GitHub Pages SPA 回退页）'); // 构建日志可见
