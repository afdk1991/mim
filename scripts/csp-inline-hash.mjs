#!/usr/bin/env node
/**
 * scripts/csp-inline-hash.mjs
 * 构建后处理：从 apps/web/dist 与 apps/admin/dist 的 index.html 提取真实内联脚本，
 * 分别算出 CSP 要求的 SHA-256，生成各自目录下的 nginx 片段 mim-csp.conf。
 *
 * 为什么需要它（2026-11-15 P0 白屏根因）：
 *   生产 CSP 里曾写死内联脚本哈希，而实际产物内联脚本的哈希是别的值，CSP 不匹配 → 内联脚本被浏览器拦掉。
 *   哈希一旦靠人手同步，改一次内联脚本就必然漂移一次；这里改为「构建产物算什么，响应头就发什么」。
 *
 * 部署链路：deploy/deploy.sh 把 dist 复制到 /opt/mim/web 与 /opt/mim/admin，
 *   deploy/nginx-mim.conf 分别用 `include /opt/mim/web/mim-csp*.conf;` 与
 *   `include /opt/mim/admin/mim-csp*.conf;` 引入。通配 include 在文件缺失时不报错，
 *   因此全新机器的 bootstrap 阶段（还没有构建产物）也不会 nginx -t 失败。
 *
 * 用法：由 apps/web 与 apps/admin 的 build 脚本在 vite build 之后自动调用，也可手动执行。
 *   两个产物目录互不依赖：存在哪个就生成哪个，全都不存在才失败。
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
// 需要生成 CSP 片段的前端产物：用户端与后台各一份（后台 <head> 也有内联主题脚本）
const TARGETS = [
  { name: 'web', dist: join(HERE, '..', 'apps', 'web', 'dist') }, // 发布到 /opt/mim/web
  { name: 'admin', dist: join(HERE, '..', 'apps', 'admin', 'dist') }, // 发布到 /opt/mim/admin
];
// 内联脚本匹配：带 src 的 script 不算内联（负向先行断言排除），其余整块捕获脚本正文
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

// 逐个产物生成：某次只构建了其中一个时，另一个可能还没产物，跳过即可
let generated = 0;
for (const target of TARGETS) {
  // 输入：vite 构建出的入口 HTML（内联脚本就写在这里）
  const entry = join(target.dist, 'index.html');
  // 入口缺失说明该应用本次未构建或产物被清理，跳过并提示，不影响另一个产物
  if (!existsSync(entry)) {
    console.log(`[csp-inline-hash] 跳过 ${target.name}：缺少 ${entry}`);
    continue;
  }

  // 读取入口 HTML：按 UTF-8 读取，保证与浏览器解析到的字节一致（哈希对空白与换行同样敏感）
  const html = readFileSync(entry, 'utf8');
  // 收集去重后的哈希令牌，供 script-src 使用；顺序稳定便于日志与 diff 对比
  const tokens = [];
  // 逐个内联脚本计算哈希：CSP 的 sha256-… 是对脚本元素「文本内容」整体取摘要，不含 script 标签本身
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const body = match[1] ?? ''; // 捕获组 1 即脚本正文；异常情况下兜底空串
    // 空白脚本浏览器不执行、CSP 也不会命中，跳过以免把无意义哈希写进响应头
    if (body.trim() === '') continue;
    // 计算摘要并转 base64：CSP 语法要求 `'sha256-<base64>'`
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    // 同一段脚本出现多次时只保留一条令牌，避免响应头冗长
    const token = `'sha256-${digest}'`;
    // 去重后入列表
    if (!tokens.includes(token)) tokens.push(token);
  }

  // script-src 至少保留 'self'（/assets 下的构建产物与 /spa.js 都属同源），再追加内联脚本哈希
  const scriptSrc = ["'self'", ...tokens].join(' ');
  // 其余指令沿用生产既定策略，避免本次修复顺带放宽其它权限
  const csp = `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'`;
  // 片段内容：先写来源说明注释，再写唯一一条 add_header；include 后恰好等价于原先手写的那一行
  const snippet = [
    '# 由 scripts/csp-inline-hash.mjs 在构建期自动生成，请勿手改。',
    `# 实际内联脚本哈希：${tokens.length > 0 ? tokens.join(' ') : '（本次产物无内联脚本，仅放行同源外链）'}`,
    `add_header Content-Security-Policy "${csp}" always;`,
  ].join('\n') + '\n';

  // 写出片段：dist 会被 deploy.sh 整体复制到对应静态根，nginx 侧按通配 include 引入
  const out = join(target.dist, 'mim-csp.conf');
  writeFileSync(out, snippet, 'utf8');
  generated += 1;

  // 输出结果供 CI 日志取证：哈希值与文件路径都在日志里，线上排查可直接对比
  console.log(`[csp-inline-hash] 已生成 ${out}`);
  console.log(`[csp-inline-hash] ${target.name} script-src = ${scriptSrc}`);
}

// 两个产物都不存在说明构建没执行，直接失败，避免静默发出「不带正确哈希」的部署
if (generated === 0) {
  console.error('[csp-inline-hash] web / admin 均缺少 dist/index.html，请先执行构建');
  process.exit(1);
}
