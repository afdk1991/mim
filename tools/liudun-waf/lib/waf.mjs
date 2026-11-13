/**
 * tools/liudun-waf/lib/waf.mjs
 *
 * 流盾 WAF 核心：基于 Node 内置 http 的反向代理网关。
 *
 * 能力：
 *   - CC 限流：IP + 路径滑动窗口（窗口内超阈值返回 429）；
 *   - 规则检测：SQLi / XSS / 路径穿越 / 敏感文件探测（正则签名，命中返回 403）；
 *   - IP 黑白名单：白名单优先放行，黑名单直接拦截；
 *   - 拦截日志：JSONL 落盘（可注入内存 logger 供测试断言）；
 *   - --dry-run：只记录不拦截，请求照常透传。
 *
 * 纯 Node 内置模块，零新增依赖。
 */

import http from 'node:http';
import { URL } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** 编译规则：把字符串正则预编译成 RegExp。 */
export function compileRules(rules) {
  const signatures = (rules.signatures || []).map((s) => ({
    ...s,
    re: new RegExp(s.pattern, s.flags || 'i'),
  }));
  return {
    version: rules.version || '0.0.0',
    rateLimit: rules.rateLimit || { windowMs: 10000, max: 20 },
    whitelist: rules.whitelist || [],
    blacklist: rules.blacklist || [],
    signatures,
  };
}

/**
 * 创建 WAF 代理服务器。
 * @param {object} opts
 * @param {string} opts.upstream 上游地址，如 http://127.0.0.1:8800
 * @param {object} opts.rules 规则对象（见 rules.json）
 * @param {string|null} [opts.logPath] JSONL 日志落盘路径
 * @param {boolean} [opts.dryRun] 只记不拦
 * @param {()=>number} [opts.now] 时钟注入（测试用）
 * @param {(entry:object)=>void} [opts.logger] 内存日志回调（测试用）
 * @returns {http.Server}
 */
export function createWafServer({ upstream, rules, logPath = null, dryRun = false, now = Date.now, logger = null }) {
  const compiled = compileRules(rules);
  const windowMs = compiled.rateLimit.windowMs;
  const max = compiled.rateLimit.max;
  /** 滑动窗口：key = ip|path，值为时间戳数组。 */
  const windows = new Map();

  function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
  }

  /** 判定一次请求：pass / block / ratelimit。 */
  function classify(req, rawBody) {
    const ip = clientIp(req);
    const url = new URL(req.url, upstream);

    if (compiled.whitelist.includes(ip)) {
      return { action: 'pass', reason: 'whitelist', ruleId: 'wl-0', type: 'whitelist', ip };
    }
    if (compiled.blacklist.includes(ip)) {
      return { action: 'block', reason: 'blacklist', ruleId: 'bl-0', type: 'blacklist', ip };
    }

    // 解码后的查询串 + 请求体，避免 URL 编码绕过签名。
    const decodedParams = [...url.searchParams.entries()].map(([k, v]) => `${k}=${v}`).join('&');
    const target = `${url.pathname}?${decodedParams}\n${rawBody || ''}`;
    for (const sig of compiled.signatures) {
      if (sig.re.test(target)) {
        return { action: 'block', reason: sig.reason, ruleId: sig.id, type: sig.type, ip };
      }
    }

    const key = `${ip}|${url.pathname}`;
    const ts = now();
    const arr = (windows.get(key) || []).filter((t) => ts - t < windowMs);
    if (arr.length >= max) {
      return { action: 'ratelimit', reason: 'CC rate limit exceeded', ruleId: 'rl-0', type: 'ratelimit', ip };
    }
    arr.push(ts);
    windows.set(key, arr);
    return { action: 'pass', reason: 'ok', ruleId: null, type: 'pass', ip };
  }

  function log(entry) {
    const line = JSON.stringify(entry);
    if (logger) logger(entry);
    if (logPath) {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${line}\n`, 'utf8');
    }
  }

  /** 透传到上游。 */
  function proxy(req, res, rawBody) {
    let up;
    try {
      up = new URL(upstream);
    } catch {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'BAD_UPSTREAM' }));
      return;
    }
    const proxyReq = http.request(
      {
        hostname: up.hostname,
        port: up.port || (up.protocol === 'https:' ? 443 : 80),
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: 'UPSTREAM_ERROR' }));
    });
    if (rawBody) proxyReq.write(rawBody);
    proxyReq.end();
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', () => res.destroy());
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const verdict = classify(req, rawBody);
      const blocked = verdict.action === 'block' || verdict.action === 'ratelimit';
      const loggedAction = dryRun && blocked ? 'log-only' : verdict.action;

      const url = new URL(req.url, upstream);
      log({
        ts: new Date().toISOString(),
        ip: verdict.ip,
        method: req.method,
        path: url.pathname,
        action: loggedAction,
        reason: verdict.reason,
        ruleId: verdict.ruleId,
        type: verdict.type,
        dryRun,
      });

      if (blocked && !dryRun) {
        res.statusCode = verdict.action === 'ratelimit' ? 429 : 403;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'BLOCKED', reason: verdict.reason, rule: verdict.ruleId }));
        return;
      }
      proxy(req, res, rawBody);
    });
  });

  return server;
}
