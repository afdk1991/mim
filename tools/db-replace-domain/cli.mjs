#!/usr/bin/env node
/**
 * tools/db-replace-domain/cli.mjs
 *
 * 数据库批量替换 / 换域名工具（纯 Node，零新增依赖）。
 *
 * 支持两种输入：
 *   - .sql 文本导出文件：整段文本替换，正确重算 PHP 序列化字符串长度；
 *   - .sqlite / .db / .sqlite3 库：遍历 TEXT 列参数化 UPDATE 写回。
 *
 * 用法:
 *   node tools/db-replace-domain/cli.mjs --input dump.sql --from old.com --to new.com --dry-run
 *   node tools/db-replace-domain/cli.mjs --input dump.sql --from old.com --to new.com --apply [--no-backup]
 *   node tools/db-replace-domain/cli.mjs --input site.sqlite --from old.com --to new.com --apply
 *   node tools/db-replace-domain/cli.mjs --help
 *
 * 参数:
 *   --input <file>    .sql 文本导出 或 SQLite 库（按扩展名 + 文件头识别）
 *   --from <域名>     旧域名（可带协议 / www，按裸域名归一化匹配变体）
 *   --to <域名>       新域名
 *   --dry-run         只统计与预览，不写文件 / 不写库
 *   --apply           真实执行；执行前自动写 <input>.bak 备份（已存在则不覆盖）
 *   --no-backup       apply 时跳过备份（不推荐）
 *
 * 退出码:
 *   0 成功（dry-run 有命中也算成功）
 *   2 参数缺失或非法
 *   4 输入文件读写失败
 *   5 无法识别的输入格式
 *   1 其它运行时错误（错误信息带文件与行号）
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { replaceText, countReplacements } from './lib/replace.mjs';
import { replaceSqlite } from './lib/sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname;

const EXIT = { OK: 0, USAGE: 2, IO: 4, FORMAT: 5, RUNTIME: 1 };
const SQLITE_EXT = ['.sqlite', '.db', '.sqlite3'];

function parseArgs(argv) {
  const out = { input: '', from: '', to: '', dryRun: false, apply: false, noBackup: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--input': out.input = argv[++i]; break;
      case '--from': out.from = argv[++i]; break;
      case '--to': out.to = argv[++i]; break;
      case '--dry-run': out.dryRun = true; break;
      case '--apply': out.apply = true; break;
      case '--no-backup': out.noBackup = true; break;
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

const HELP = `数据库批量替换 / 换域名工具

用法:
  node tools/db-replace-domain/cli.mjs --input <file> --from <old> --to <new> --dry-run
  node tools/db-replace-domain/cli.mjs --input <file> --from <old> --to <new> --apply [--no-backup]

参数:
  --input <file>    .sql 导出 或 SQLite 库（.sqlite/.db/.sqlite3）
  --from <域名>     旧域名（自动匹配 http/https、www/非 www 变体）
  --to <域名>       新域名
  --dry-run         只预览不写
  --apply           真实执行，自动写 .bak 备份
  --no-backup       跳过备份

退出码: 0 成功 | 2 参数非法 | 4 读写失败 | 5 格式不识别 | 1 其它错误`;

/** 识别输入是否为 SQLite 库：扩展名优先，文件头兜底。 */
function detectSqlite(input) {
  if (SQLITE_EXT.includes(extname(input).toLowerCase())) return true;
  const fd = readFileSync(input);
  return fd.subarray(0, 16).toString('utf8').startsWith('SQLite format 3');
}

function backupFile(input) {
  const bak = `${input}.bak`;
  if (!existsSync(bak)) {
    copyFileSync(input, bak);
    return { backup: bak, created: true };
  }
  return { backup: bak, created: false };
}

async function main() {
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
    if (!args.input || !args.from || !args.to) {
      throw Object.assign(new Error('--input / --from / --to 均为必填'), { exit: EXIT.USAGE });
    }
    if (args.dryRun === args.apply) {
      throw Object.assign(new Error('必须二选一：--dry-run 或 --apply'), { exit: EXIT.USAGE });
    }
    if (!existsSync(args.input)) {
      throw Object.assign(new Error(`输入文件不存在：${args.input}`), { exit: EXIT.IO });
    }

    const isSqlite = detectSqlite(args.input);
    let summary;

    if (isSqlite) {
      let backup = null;
      if (args.apply && !args.noBackup) backup = backupFile(args.input);
      const result = await replaceSqlite(args.input, args.from, args.to, { dryRun: args.dryRun });
      summary = { mode: 'sqlite', input: args.input, from: args.from, to: args.to, dryRun: args.dryRun, backup, ...result };
    } else {
      let text;
      try {
        text = readFileSync(args.input, 'utf8');
      } catch (err) {
        throw Object.assign(new Error(`读取失败：${err.message}`), { exit: EXIT.IO });
      }
      const hits = countReplacements(text, args.from, args.to);
      const next = replaceText(text, args.from, args.to);
      let backup = null;
      if (args.apply && !args.noBackup) backup = backupFile(args.input);
      if (args.apply) {
        writeFileSync(args.input, next, 'utf8');
      }
      summary = { mode: 'text', input: args.input, from: args.from, to: args.to, dryRun: args.dryRun, backup, replacements: hits, changed: next !== text };
    }

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (err) {
    const code = err.exit || EXIT.RUNTIME;
    process.stderr.write(`${locate(err)}: ${err.message}\n`);
    process.exit(code);
  }
}

main().catch((err) => {
  process.stderr.write(`${locate(err)}: ${err.message}\n`);
  process.exit(err.exit || EXIT.RUNTIME);
});
