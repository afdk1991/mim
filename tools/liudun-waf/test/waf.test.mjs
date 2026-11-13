/**
 * tools/liudun-waf/test/waf.test.mjs
 *
 * 流盾 WAF 测试（node:test，零新增依赖，不联网）：
 *   起真实本地 upstream + 真实 WAF 代理，断言：
 *     1. 正常请求透传 200；
 *     2. SQLi / XSS / 路径穿越 / 敏感文件探测拦截 403；
 *     3. 超限流阈值返回 429；
 *     4. 白名单放行；
 *     5. dry-run 只记不拦；
 *     6. 日志条目是合法 JSON 且字段齐全；
 *     7. nginx 配置渲染包含 limit_req 与 proxy_pass。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { createWafServer } from '../lib/waf.mjs';
import { renderNginx } from '../lib/nginx.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES = JSON.parse(readFileSync(join(__dirname, '..', 'rules.json'), 'utf8'));

/** 起本地 upstream + WAF 代理，回调拿到网关基址，结束后关闭。 */
async function withWaf({ rules: rulesOverride = {}, dryRun = false, logger = null, fn }) {
  const up = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`ok:${req.url}`);
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const upPort = up.address().port;

  const rules = { ...DEFAULT_RULES, ...rulesOverride };
  const waf = createWafServer({
    upstream: `http://127.0.0.1:${upPort}`,
    rules,
    dryRun,
    logger,
  });
  await new Promise((r) => waf.listen(0, '127.0.0.1', r));
  const wafPort = waf.address().port;

  try {
    await fn(`http://127.0.0.1:${wafPort}`);
  } finally {
    waf.close();
    up.close();
  }
}

async function get(base, path) {
  const r = await fetch(base + path);
  const body = await r.text();
  return { status: r.status, body };
}

test('正常请求透传 200，回源 body 带路径', async () => {
  await withWaf({
    fn: async (base) => {
      const res = await get(base, '/health');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('/health'));
    },
  });
});

test('SQLi 特征拦截 403', async () => {
  await withWaf({
    fn: async (base) => {
      const res = await get(base, '/search?q=1%20union%20select%20username%20from%20users');
      assert.equal(res.status, 403);
      const json = JSON.parse(res.body);
      assert.equal(json.error, 'BLOCKED');
      assert.equal(json.rule, 'sqli-1');
    },
  });
});

test('XSS 特征拦截 403', async () => {
  await withWaf({
    fn: async (base) => {
      const res = await get(base, '/comment?x=javascript:alert(1)');
      assert.equal(res.status, 403);
      assert.equal(JSON.parse(res.body).rule, 'xss-1');
    },
  });
});

test('路径穿越拦截 403', async () => {
  await withWaf({
    fn: async (base) => {
      const res = await get(base, '/file?path=../../etc/passwd');
      assert.equal(res.status, 403);
      assert.equal(JSON.parse(res.body).rule, 'traversal-1');
    },
  });
});

test('敏感文件探测拦截 403', async () => {
  await withWaf({
    fn: async (base) => {
      const res = await get(base, '/.env');
      assert.equal(res.status, 403);
      assert.equal(JSON.parse(res.body).rule, 'sensitive-1');
    },
  });
});

test('CC 限流：窗口内超阈值返回 429', async () => {
  await withWaf({
    rules: { rateLimit: { windowMs: 60000, max: 3 } },
    fn: async (base) => {
      const statuses = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await get(base, '/rate');
        statuses.push(res.status);
      }
      assert.equal(statuses.slice(0, 3).every((s) => s === 200), true, `前三应透传: ${statuses}`);
      assert.ok(statuses.slice(3).includes(429), `后续应出现 429: ${statuses}`);
    },
  });
});

test('白名单 IP 放行：命中 SQLi 也透传 200', async () => {
  await withWaf({
    rules: { whitelist: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] },
    fn: async (base) => {
      const res = await get(base, '/search?q=1%20union%20select%20from%20users');
      assert.equal(res.status, 200);
    },
  });
});

test('dry-run 只记不拦：SQLi 照常透传，日志标记 log-only', async () => {
  const entries = [];
  await withWaf({
    dryRun: true,
    logger: (e) => entries.push(e),
    fn: async (base) => {
      const res = await get(base, '/comment?x=javascript:alert(1)');
      assert.equal(res.status, 200, 'dry-run 不得拦截');
      const hit = entries.find((e) => e.ruleId === 'xss-1');
      assert.ok(hit, '应记录到 XSS 命中');
      assert.equal(hit.action, 'log-only');
      assert.equal(hit.dryRun, true);
    },
  });
});

test('日志条目是合法 JSON 且字段齐全', async () => {
  const entries = [];
  await withWaf({
    logger: (e) => entries.push(e),
    fn: async (base) => {
      await get(base, '/health');
      await get(base, '/.env');
      assert.ok(entries.length >= 2);
      for (const e of entries) {
        const roundTrip = JSON.parse(JSON.stringify(e));
        for (const field of ['ts', 'ip', 'method', 'path', 'action', 'reason', 'ruleId', 'dryRun']) {
          assert.ok(field in roundTrip, `日志缺字段 ${field}`);
        }
        assert.match(roundTrip.ts, /^\d{4}-\d{2}-\d{2}T/);
      }
    },
  });
});

test('nginx 配置渲染：含 limit_req_zone / 规则 map / proxy_pass', () => {
  const conf = renderNginx({ listen: 8801, upstream: 'http://127.0.0.1:8800', rules: DEFAULT_RULES });
  assert.match(conf, /limit_req_zone/);
  assert.match(conf, /map \$request_uri \$waf_sqli/);
  assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:8800/);
  assert.match(conf, /return 403/);
});
