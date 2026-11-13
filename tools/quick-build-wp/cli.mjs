#!/usr/bin/env node
/**
 * tools/quick-build-wp/cli.mjs
 *
 * Quick Build WP — WordPress 一键建站脚本生成器（纯 Node，零新增依赖）。
 *
 * 用法:
 *   node tools/quick-build-wp/cli.mjs --plan [--domain D] [--php-version V] [--wp-version V] [--ssl]
 *   node tools/quick-build-wp/cli.mjs --emit <out.sh> [同上选项]
 *   node tools/quick-build-wp/cli.mjs --verify <file.sh>
 *   node tools/quick-build-wp/cli.mjs --help
 *
 * 子命令 / 参数:
 *   --plan              输出将要执行的步骤清单（JSON 到 stdout）
 *   --emit <out.sh>     生成可在 Linux 上执行的宝塔式安装脚本（幂等、支持 --dry-run）
 *   --verify <file.sh>  对脚本做静态自检，输出检查矩阵 JSON；未通过退出码 3
 *   --domain <域名>     站点域名，默认 example.com
 *   --php-version <ver> PHP 版本，默认 8.2
 *   --wp-version <ver>  WordPress 版本号，默认 latest
 *   --ssl               生成脚本默认开启 HTTPS 证书申请
 *
 * 退出码:
 *   0 成功
 *   2 参数缺失或非法
 *   3 --verify 自检未通过
 *   4 文件读写失败
 *   1 其它运行时错误（错误信息带文件与行号）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { buildPlan } from './lib/plan.mjs';
import { renderScript } from './lib/render.mjs';
import { verifyScript } from './lib/verify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname;

const EXIT = { OK: 0, USAGE: 2, VERIFY_FAIL: 3, IO: 4, RUNTIME: 1 };

/** 解析 CLI 参数：布尔开关 + 取值参数。 */
function parseArgs(argv) {
  const out = { plan: false, emit: null, verify: null, help: false, domain: '', phpVersion: '', wpVersion: '', ssl: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--plan': out.plan = true; break;
      case '--emit': out.emit = argv[++i]; break;
      case '--verify': out.verify = argv[++i]; break;
      case '--ssl': out.ssl = true; break;
      case '--help': case '-h': out.help = true; break;
      case '--domain': out.domain = argv[++i]; break;
      case '--php-version': out.phpVersion = argv[++i]; break;
      case '--wp-version': out.wpVersion = argv[++i]; break;
      default: throw Object.assign(new Error(`未知参数：${a}`), { exit: EXIT.USAGE });
    }
  }
  return out;
}

/** 从堆栈里取 cli.mjs 内的出错行号，错误信息带文件与行号。 */
function locate(err) {
  const frame = String(err.stack || '').split('\n').find((l) => l.includes('cli.mjs')) || '';
  const m = frame.match(/cli\.mjs:(\d+):\d+/);
  return m ? `cli.mjs:${m[1]}` : 'cli.mjs';
}

function printHelp() {
  process.stdout.write(`${__HELP__}\n`);
}

const __HELP__ = `Quick Build WP — WordPress 一键建站脚本生成器

用法:
  node tools/quick-build-wp/cli.mjs --plan [选项]
  node tools/quick-build-wp/cli.mjs --emit <out.sh> [选项]
  node tools/quick-build-wp/cli.mjs --verify <file.sh>
  node tools/quick-build-wp/cli.mjs --help

选项:
  --domain <域名>      站点域名，默认 example.com
  --php-version <ver>  PHP 版本，默认 8.2
  --wp-version <ver>   WordPress 版本号，默认 latest
  --ssl                生成脚本默认开启 HTTPS 证书申请

退出码: 0 成功 | 2 参数非法 | 3 自检未通过 | 4 文件读写失败 | 1 其它错误`;

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${locate(err)}: ${err.message}\n`);
    process.exit(EXIT.USAGE);
  }

  if (args.help) {
    printHelp();
    return;
  }

  const opts = {
    domain: args.domain || undefined,
    phpVersion: args.phpVersion || undefined,
    wpVersion: args.wpVersion || undefined,
    ssl: args.ssl || undefined,
  };

  try {
    if (args.plan) {
      const plan = buildPlan(opts);
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return;
    }

    if (args.emit) {
      if (!args.emit) throw Object.assign(new Error('--emit 需要给出输出文件路径'), { exit: EXIT.USAGE });
      const script = renderScript(opts);
      writeFileSync(args.emit, script, 'utf8');
      const matrix = verifyScript(script);
      process.stdout.write(JSON.stringify({ ok: matrix.ok, emitted: args.emit, steps: buildPlan(opts).steps.length, checks: matrix.checks.length }, null, 2) + '\n');
      return;
    }

    if (args.verify) {
      let source;
      try {
        source = readFileSync(args.verify, 'utf8');
      } catch (err) {
        throw Object.assign(new Error(`读取脚本失败：${err.message}`), { exit: EXIT.IO });
      }
      const matrix = verifyScript(source);
      process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
      if (!matrix.ok) process.exit(EXIT.VERIFY_FAIL);
      return;
    }

    throw Object.assign(new Error('需要 --plan / --emit <file> / --verify <file> 之一，详见 --help'), { exit: EXIT.USAGE });
  } catch (err) {
    const code = err.exit || EXIT.RUNTIME;
    process.stderr.write(`${locate(err)}: ${err.message}\n`);
    process.exit(code);
  }
}

main();
