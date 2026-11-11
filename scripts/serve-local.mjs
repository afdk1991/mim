// 本地真渲染验证用静态服务器：托管 apps/web/dist，并把 /api/* 与 /health 反代到本地 API（:8787）。
// 只使用 Node 内置模块，不依赖 packages/* 源码；供 scripts/verify-film-export.mjs 与按需登录 --live 复用。
// 用法（仓库根目录）：pnpm --filter @mim/web build && node scripts/serve-local.mjs  → http://127.0.0.1:5188
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve('apps/web/dist');
const API = 'http://127.0.0.1:8787';
const PORT = 5188;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;

  if (path.startsWith('/api/') || path === '/health') {
    try {
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!['connection', 'content-length', 'transfer-encoding'].includes(k)) headers[k] = v;
      }
      // 透传原始公网 Host：fetch 会丢弃 Host 头（forbidden header），改用 X-Forwarded-Host 告知上游，
      // 否则媒体预签名会按 :8787 拼绝对 URL，浏览器端变成跨域 PUT 被 CORS 拦下，本地“发图”必定失败
      const host = req.headers.host || '127.0.0.1:5188';
      headers['x-forwarded-host'] = host;
      headers['x-forwarded-proto'] = 'http';
      let body;
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = Buffer.concat(chunks);
      }
      const upstream = await fetch(API + path + url.search, { method: req.method, headers, body });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  let file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
  } catch {
    file = join(ROOT, 'index.html');
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`static+proxy listening on http://127.0.0.1:${PORT}`));
