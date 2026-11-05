// services/mim-api/build.mjs — 生产编译脚本（替代 tsx 直接运行 TS）
//
// 使用 esbuild 把 src/index.ts 打包为单文件 ESM 产物 dist/index.js。
// - @mim/* 为 workspace 包、只发 TS 源码，必须打包进产物；
// - 真实 npm 依赖保持 external（运行时由 node_modules 解析）；
// - better-sqlite3 是原生模块，必须 external。
// 产物路径约定：dist 与 src 同为 mim-api 下一级目录，src/config.ts 中
// SRC_DIR/REPO_ROOT/DATA_DIR 的相对层级在编译前后保持一致，无需改代码。

import { build } from 'esbuild';

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
  ],
  // ESM 产物中还原 __dirname / import.meta.url 语义（esbuild 单文件 banner）
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log('[build] dist/index.js 生成完毕');
