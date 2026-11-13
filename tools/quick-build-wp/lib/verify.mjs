/**
 * tools/quick-build-wp/lib/verify.mjs
 *
 * 对生成的 bash 安装脚本做静态自检，输出结构化矩阵：
 *   1. 必需能力齐全（nginx / mysql / php / curl / wordpress / 伪静态 rewrite）；
 *   2. 无高危命令（rm -rf 根目录、mkfs、dd 覆写、fork 炸弹）；
 *   3. 可配置变量全部以 ${VAR:-default} 形式带默认值；
 *   4. 写操作全部走 _run / _write_conf 封装，dry-run 路径不直接落盘。
 *
 * 纯静态分析，不执行脚本；零新增依赖。
 */

import { REQUIRED_CAPABILITIES } from './plan.mjs';

/** 高危命令黑名单。 */
const DANGEROUS = [
  { id: 'rm-root', label: '禁止 rm -rf 根目录 / 家目录 / 通配根', pattern: /rm\s+-rf\s+(\/|\*|\/\*|\$HOME|\$HOME\/)(\s|$)/ },
  { id: 'mkfs', label: '禁止 mkfs 格式化磁盘', pattern: /\bmkfs\b/ },
  { id: 'dd-wipe', label: '禁止 dd 覆写磁盘', pattern: /\bdd\s+if=/ },
  { id: 'fork-bomb', label: '禁止 fork 炸弹', pattern: /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;/ },
];

/** 可能产生写操作的命令词。 */
const MUTATION = /\b(apt-get|mysql|curl|wget|tar|mkdir|chown|chmod|ln|systemctl|certbot|tee|cat\s*>)\b/;

/** 必须带默认值的可配置变量。 */
const CONFIG_VARS = ['DOMAIN', 'PHP_VERSION', 'WP_VERSION', 'DB_NAME', 'DB_USER', 'DB_PASS', 'WEB_ROOT', 'INSTALL_SSL'];

/**
 * 静态自检。
 * @param {string} source 脚本文本
 * @returns {{ok:boolean, checks:Array<object>, capabilityHits:object, variables:Array<object>, dryRunRouting:object, dangerous:Array<object>}}
 */
export function verifyScript(source) {
  const checks = [];
  const lines = source.split('\n');

  // 1. 必需能力
  const capabilityHits = {
    nginx: /nginx/i.test(source),
    mysql: /mysql/i.test(source),
    php: /php/i.test(source),
    curl: /curl/i.test(source),
    wordpress: /wp-load\.php|wordpress\.org/i.test(source),
    rewrite: /try_files/.test(source),
  };
  for (const cap of REQUIRED_CAPABILITIES) {
    const pass = capabilityHits[cap];
    checks.push({ id: `cap-${cap}`, label: `必需能力：${cap}`, pass, detail: pass ? '命中' : '缺失' });
  }

  // 2. 高危命令
  const dangerous = DANGEROUS.map((d) => ({ id: d.id, label: d.label, hit: d.pattern.test(source) }));
  for (const d of dangerous) {
    checks.push({ id: `danger-${d.id}`, label: d.label, pass: !d.hit, detail: d.hit ? '检出危险命令' : '未检出' });
  }

  // 3. 变量默认值
  const variables = CONFIG_VARS.map((name) => {
    const re = new RegExp(`${name}="\\\$\\{${name}:-`);
    const pass = re.test(source);
    return { name, pass };
  });
  for (const v of variables) {
    checks.push({ id: `var-${v.name}`, label: `变量 ${v.name} 带默认值`, pass: v.pass, detail: v.pass ? '${VAR:-default} 形式' : '缺少默认值' });
  }

  // 4. dry-run 路由：逐行跟踪 runner 函数体与 heredoc 正文，其余位置的写操作必须走封装。
  let inRunner = false;
  let inHeredoc = false;
  let mutations = 0;
  let routed = 0;
  const unrouted = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const t = raw.trim();
    if (inHeredoc) {
      if (/^\w+_EOF\s*$/.test(t)) inHeredoc = false;
      continue;
    }
    if (/<<\s*'?\w+_EOF'?/.test(raw)) {
      inHeredoc = true;
      continue;
    }
    if (/^_(run|write_conf)\(\)\s*\{/.test(t)) {
      inRunner = true;
      continue;
    }
    if (inRunner) {
      if (t === '}') inRunner = false;
      continue;
    }
    if (!t || t.startsWith('#') || /^info\b/.test(t)) continue;
    if (MUTATION.test(t)) {
      mutations += 1;
      const isRouted = /^(_run|_write_conf)\b/.test(t) || /^(if|elif|else|fi|for|while|case|esac)\b/.test(t);
      if (isRouted) routed += 1;
      else unrouted.push({ line: i + 1, text: t });
    }
  }
  checks.push({
    id: 'dry-run-routing',
    label: '写操作均走 dry-run 封装',
    pass: unrouted.length === 0,
    detail: `mutations=${mutations} routed=${routed} unrouted=${unrouted.length}`,
  });

  const ok = checks.every((c) => c.pass);
  return { ok, checks, capabilityHits, variables, dryRunRouting: { mutations, routed, unrouted }, dangerous };
}
