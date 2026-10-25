import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { PUBLIC_DIR } from './core/paths.js';
import { appraise, getHistory } from './core/appraise.js';
import { searchAll } from './core/search.js';
import { buildState, loadKits } from './core/state.js';
import { collect } from './sources/index.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = resolve(join(PUBLIC_DIR, normalize(rel)));

  // 防目录穿越
  if (!target.startsWith(PUBLIC_DIR + sep) && target !== PUBLIC_DIR) {
    return send(res, 403, 'forbidden');
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) return send(res, 404, 'not found');
    const body = await readFile(target);
    return send(res, 200, body, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
  } catch {
    return send(res, 404, 'not found');
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (url.pathname === '/api/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim();
        if (!q) return sendJson(res, 400, { error: '缺少 q 参数' });
        if (q.length > 60) return sendJson(res, 400, { error: '关键词太长' });
        const result = await searchAll(q);
        return sendJson(res, 200, result);
      }

      if (url.pathname === '/api/appraise' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await appraise({
          kitId: body.kitId,
          price: body.price,
          currency: body.currency
        });
        return sendJson(res, 200, result);
      }

      if (url.pathname === '/api/history' && req.method === 'GET') {
        const kitId = url.searchParams.get('kitId');
        if (!kitId) return sendJson(res, 400, { error: '缺少 kitId' });
        return sendJson(res, 200, { kitId, history: await getHistory(kitId) });
      }

      if (url.pathname === '/api/state' && req.method === 'GET') {
        const state = await buildState();
        return sendJson(res, 200, state);
      }

      if (url.pathname === '/api/refresh' && (req.method === 'POST' || req.method === 'GET')) {
        const kits = await loadKits();
        const result = await collect(kits);
        const state = await buildState();
        return sendJson(res, 200, {
          ok: true,
          quoteCount: result.quoteCount,
          errors: result.errors,
          state
        });
      }

      if (url.pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'not found' });
      }

      return await serveStatic(req, res, url.pathname);
    } catch (error) {
      console.error('[server]', error);
      return sendJson(res, 500, { error: String(error.message || error) });
    }
  });
}

export function startServer({ port = 5173 } = {}) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`\n  胶价雷达跑了 → http://localhost:${port}\n`);
  });
  return server;
}
