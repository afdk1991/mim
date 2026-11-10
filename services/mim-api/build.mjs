// services/mim-api/build.mjs — 生产编译脚本（替代 tsx 直接运行 TS）
//
// 使用 esbuild 把 src/index.ts 打包为单文件 ESM 产物 dist/index.js。
// - @mim/* 为 workspace 包、只发 TS 源码，必须打包进产物；
// - 真实 npm 依赖保持 external（运行时由 node_modules 解析）；
// - better-sqlite3 是原生模块，必须 external；
// - sharp 同样是原生模块（运行时靠 @img/sharp-* 平台包加载 .node）。
//   若被 esbuild 内联进 dist/index.js，sharp 会以 dist 目录为基准去找平台包，
//   而 @img/* 实际装在 node_modules/sharp 的兄弟目录里 → 启动即抛
//   `Could not load the "sharp" module using the linux-x64 runtime`。必须 external。
// 产物路径约定：dist 与 src 同为 mim-api 下一级目录，src/config.ts 中
// SRC_DIR/REPO_ROOT/DATA_DIR 的相对层级在编译前后保持一致，无需改代码。

import { build } from 'esbuild';
// fs/promises：把 SQLite 建表脚本随 esbuild 产物搬运，避免运行时 ENOENT（见文件末尾）
import { copyFile, mkdir } from 'node:fs/promises';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // 真实 npm 依赖全部 external；@mim/*（workspace TS 源码）必须内联打包
  external: [
    'bcryptjs',
    'better-sqlite3',
    'express',
    'jsonwebtoken',
    'zod',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    'sharp',
  ],
  // ESM 产物中还原 __dirname / import.meta.url 语义（esbuild 单文件 banner）
  // 别名导入：esbuild 在产物内部（被内联的依赖需要 require 时）会自动注入
  // `import { createRequire } from "node:module"`；若 banner 也叫 createRequire，
  // 单文件 ESM 里就会出现同名标识符重复声明（Node 直接 SyntaxError 起不来）。
  banner: {
    js: "import { createRequire as mimCreateRequire } from 'node:module'; const require = mimCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

// db.ts 以 new URL('./schema.sql', import.meta.url) 读取建表脚本，
// esbuild 不会内联该静态资源；若 dist/ 缺文件，宿主直部署（systemd / Render / npm start）启动即 ENOENT 崩溃。
await mkdir('dist', { recursive: true }); // 幂等创建产物目录，兼容首次构建与 dist 被清理的场景
await copyFile('src/schema.sql', 'dist/schema.sql'); // 与 dist/index.js 同级，import.meta.url 才能正确定位
console.log('[build] dist/index.js 生成完毕'); // 输出构建成功标记，便于 CI 日志核对
console.log('[build] dist/schema.sql 同步完毕'); // 输出资源搬运标记，证明非容器链路也能找到建表脚本
