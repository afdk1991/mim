#!/usr/bin/env node
/**
 * scripts/csp-inline-hash.mjs
 * 构建后处理：从 apps/web/dist/index.html 提取真实内联脚本，算出 CSP 要求的 SHA-256，
 * 生成 nginx 片段 apps/web/dist/mim-csp.conf（内容是一条 add_header Content-Security-Policy）。
 *
 * 为什么需要它（2026-11-15 P0 白屏根因）：
 *   生产 CSP 里曾写死内联脚本哈希 sha256-dx7A4PPWeWC48rajsnmlSYohErc75pUzV9+8bdWoB0k=，
 *   而实际产物内联脚本的哈希是别的值，CSP 不匹配 → 内联脚本被浏览器拦掉。
 *   哈希一旦靠人手同步，改一次内联脚本就必然漂移一次；这里改为「构建产物算什么，响应头就发什么」。
 *
 * 部署链路：deploy/deploy.sh 会把 dist 整体复制到 /opt/mim/web，
 *   而 deploy/nginx-mim.conf 用 `include /opt/mim/web/mim-csp*.conf;` 引入本文件。
 *   通配 include 在文件缺失时不报错，因此全新机器的 bootstrap 阶段（还没有构建产物）也不会 nginx -t 失败。
 *
 * 用法：由 apps/web 的 build 脚本在 vite build、spa-404.mjs 之后自动调用，也可手动执行。
 */
// 哈希算法：SHA-256 是 CSP `sha256-…` 语法唯一支持的算法，用 Node 内置 crypto 实现零第三方依赖
import { createHash } from 'node:crypto';
// 文件操作：读入口 HTML、写 nginx 片段，并做存在性判断
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
// 路径推导：脚本位置固定，据此定位产物目录，不依赖调用方 cwd
import { dirname, join } from 'node:path';
// ESM 下没有 __dirname，用 import.meta.url 还原当前文件绝对路径
import { fileURLToPath } from 'node:url';

// 当前脚本所在目录（scripts/）
const HERE = dirname(fileURLToPath(import.meta.url)); // 由文件 URL 转为绝对路径
// 前端产物目录：apps/web/dist
const DIST = join(HERE, '..', 'apps', 'web', 'dist'); // 相对 scripts 上溯一级再进入 apps/web/dist
// 输入：vite 构建出的入口 HTML（内联脚本就写在这里）
const ENTRY = join(DIST, 'index.html'); // 必须已存在
// 输出：被 deploy/nginx-mim.conf 通配 include 的 CSP 片段
const OUT = join(DIST, 'mim-csp.conf'); // 与 dist 一起发布到 /opt/mim/web
// 内联脚本匹配：带 src 的 script 不算内联（负向先行断言排除），其余整块捕获脚本正文
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

// 入口缺失说明构建未执行或产物被清理，直接失败并提示，避免静默发出「不带正确哈希」的部署
if (!existsSync(ENTRY)) { // 防御性检查：与 spa-404.mjs 保持同一失败口径
  console.error('[csp-inline-hash] 缺少 apps/web/dist/index.html，请先执行构建'); // 明确失败原因
  process.exit(1); // 非零退出码让 CI / npm 脚本链路感知失败
} // 存在性检查结束

// 读取入口 HTML：按 UTF-8 读取，保证与浏览器解析到的字节一致（哈希对空白与换行同样敏感）
const html = readFileSync(ENTRY, 'utf8'); // 同步读取，构建期一次性操作
// 收集去重后的哈希令牌，供 script-src 使用；顺序稳定便于日志与 diff 对比
const tokens = [];
// 逐个内联脚本计算哈希：CSP 的 sha256-… 是对脚本元素「文本内容」整体取摘要，不含 script 标签本身
for (const match of html.matchAll(INLINE_SCRIPT)) { // matchAll 返回全部匹配，避免只取第一段
  const body = match[1] ?? ''; // 捕获组 1 即脚本正文；异常情况下兜底空串
  // 空白脚本浏览器不执行、CSP 也不会命中，跳过以免把无意义哈希写进响应头
  if (body.trim() === '') continue; // 空脚本直接忽略
  // 计算摘要并转 base64：CSP 语法要求 `'sha256-<base64>'`
  const digest = createHash('sha256').update(body, 'utf8').digest('base64'); // 缓冲区默认按字节摘要
  // 同一段脚本出现多次时只保留一条令牌，避免响应头冗长
  const token = `'sha256-${digest}'`; // 带引号的 CSP 源表达式
  // 去重后入列表
  if (!tokens.includes(token)) tokens.push(token); // 保持首次出现顺序
} // 内联脚本遍历结束

// script-src 至少保留 'self'（/assets 下的构建产物与 /spa.js 都属同源），再追加内联脚本哈希
const scriptSrc = ["'self'", ...tokens].join(' '); // 空格分隔的源表达式列表
// 其余指令沿用生产既定策略，避免本次修复顺带放宽其它权限
const csp = `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'`; // 单行 CSP 策略
// 片段内容：先写来源说明注释，再写唯一一条 add_header；include 后恰好等价于原先手写的那一行
const snippet = [
  '# 由 scripts/csp-inline-hash.mjs 在构建期自动生成，请勿手改。', // 说明来源，避免有人当配置手写维护
  `# 实际内联脚本哈希：${tokens.length > 0 ? tokens.join(' ') : '（本次产物无内联脚本，仅放行同源外链）'}`, // 构建日志之外的第二处取证
  `add_header Content-Security-Policy "${csp}" always;`, // always 保证错误响应也带 CSP
].join('\n') + '\n'; // 末尾补换行，保持文本文件惯例
// 写出片段：dist 会被 deploy.sh 整体复制到 /opt/mim/web，nginx 侧按通配 include 引入
writeFileSync(OUT, snippet, 'utf8'); // 覆盖写，重复构建幂等

// 输出结果供 CI 日志取证：哈希值与文件路径都在日志里，线上排查可直接对比
console.log(`[csp-inline-hash] 已生成 ${OUT}`); // 产物路径
console.log(`[csp-inline-hash] script-src = ${scriptSrc}`); // 实际写入响应头的 script-src
