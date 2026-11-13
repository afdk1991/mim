#!/usr/bin/env node
/**
 * tools/liudun-waf/cli.mjs
 *
 * 流盾 WAF — Node 反向代理网关（纯 Node，零新增依赖）。
 *
 * 用法:
 *   node tools/liudun-waf/cli.mjs --listen 8801 --upstream http://127.0.0.1:8800 [--rules rules.json] [--log a.jsonl] [--dry-run]
 *   node tools/liudun-waf/cli.mjs --emit-nginx <out.conf> [--listen 8801] --upstream http://127.0.0.1:8800
 *   node tools/liudun-waf/cli.mjs --help
 *
 * 参数:
 *   --listen <port>       网关监听端口，默认 8801
 *   --upstream <url>      上游地址，默认 http://127.0.0.1:8800
 *   --rules <file>        规则 JSON，默认随包 rules.json
 *   --log <file>          拦截日志 JSONL 落盘路径，默认 ./logs/liudun-waf.jsonl
 *   --dry-run             只记录不拦截（请求照常透传）
 *   --emit-nginx <file>   生成等价 nginx 配置后退出，不起网关
 *
 * 退出码:
 *   0 成功
 *   2 参数缺失或非法
 *   4 规则 / 配置文件读写或解析失败
 *   1 其它运行时错误（错误信息带文件与行号）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWafServer } from './lib/waf.mjs';
import { renderNginx } from './lib/nginx.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES = join(__dirname, 'rules.json');

const EXIT = { OK: 0, USAGE: 2, IO: 4, RUNTIME: 1 };

function parseArgs(argv) {
  const out = {
    listen: '8801',
    upstream: 'http://127.0.0.1:8800',
    rules: '',
    log: '',
    dryRun: false,
    emitNginx: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--listen': out.listen = argv[++i]; break;
      case '--upstream': out.upstream = argv[++i]; break;
      case '--rules': out.rules = argv[++i]; break;
      case '--log': out.log = argv[++i]; break;
      case '--dry-run': out.dryRun = true; break;
      case '--emit-nginx': out.emitNginx = argv[++i]; break;
      case '--help': case '-h': out.help = true; break;
      default: throw Object.assign(new Error(`未知参数：${a}`), { exit: EXIT.USAGE });
    }
  }
  return out;
}

function locate(err) {
  const frame = String(err.stack || '').split('\n').find((l) => l.includes('cli.mjs')) || '';
  const m = frame.match(/cli\.mjs:(\d+):\d+/);
  return m ? `cli.mjs:${m[1]}` : 'cli.mjs';
}

const HELP = `流盾 WAF — Node 反向代理网关

用法:
  node tools/liudun-waf/cli.mjs --listen 8801 --upstream http://127.0.0.1:8800 [--dry-run]
  node tools/liudun-waf/cli.mjs --emit-nginx <out.conf> --upstream http://127.0.0.1:8800

参数:
  --listen <port>       监听端口，默认 8801
  --upstream <url>      上游地址，默认 http://127.0.0.1:8800
  --rules <file>        规则 JSON，默认 rules.json
  --log <file>          JSONL 日志路径
  --dry-run             只记不拦
  --emit-nginx <file>   生成等价 nginx 配置

退出码: 0 成功 | 2 参数非法 | 4 规则读写/解析失败 | 1 其它错误`;

function loadRules(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw Object.assign(new Error(`读取规则失败：${err.message}`), { exit: EXIT.IO });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw Object.assign(new Error(`规则 JSON 解析失败：${err.message}`), { exit: EXIT.IO });
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${locate(err)}: ${err.message}\n`);
    process.exit(EXIT.USAGE);
  }
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  try {
    const rulesPath = args.rules || DEFAULT_RULES;
    const rules = loadRules(rulesPath);

    if (args.emitNginx) {
      const conf = renderNginx({ listen: args.listen, upstream: args.upstream, rules });
      writeFileSync(args.emitNginx, conf, 'utf8');
      process.stdout.write(JSON.stringify({ ok: true, emitted: args.emitNginx, upstream: args.upstream, listen: args.listen }, null, 2) + '\n');
      return;
    }

    const logPath = args.log || join(__dirname, 'logs', 'liudun-waf.jsonl');
    const server = createWafServer({
      upstream: args.upstream,
      rules,
      logPath,
      dryRun: args.dryRun,
    });

    server.listen(Number(args.listen), () => {
      process.stdout.write(JSON.stringify({
        ok: true,
        gateway: `0.0.0.0:${args.listen}`,
        upstream: args.upstream,
        dryRun: args.dryRun,
        log: logPath,
      }) + '\n');
    });

    const shutdown = () => server.close(() => process.exit(EXIT.OK));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    const code = err.exit || EXIT.RUNTIME;
    process.stderr.write(`${locate(err)}: ${err.message}\n`);
    process.exit(code);
  }
}

main();
