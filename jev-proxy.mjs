import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HOST = '127.0.0.1';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const REQUESTED_PORT = process.env.JEV_PROXY_PORT ? Number(process.env.JEV_PROXY_PORT) : null;
const PORTS = REQUESTED_PORT ? [REQUESTED_PORT] : Array.from({ length: 11 }, (_, i) => 8787 + i);
const MAX_BODY = 2 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([429, 529]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function json(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safePath(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, 'http://local').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = resolve(ROOT, relative);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

async function serveStatic(req, res) {
  const path = safePath(req.url || '/');
  if (!path) return json(res, 400, { error: 'Bad path' });
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  } catch {
    json(res, 404, { error: 'Not Found' });
  }
}

function retryDelayMs(response, attempt) {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15000, seconds * 1000);
    const when = Date.parse(header);
    if (Number.isFinite(when)) return Math.max(0, Math.min(15000, when - Date.now()));
  }
  return Math.min(8000, 650 * (2 ** attempt));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callTypeSafe(payload, apiKey) {
  let lastResponse;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    lastResponse = response;
    if (!RETRYABLE.has(response.status) || attempt === MAX_ATTEMPTS - 1) return response;
    await sleep(retryDelayMs(response, attempt));
  }
  return lastResponse;
}

async function proxyJev(req, res) {
  try {
    const apiKey = String(process.env.JEV_API_KEY || '').trim();
    if (!apiKey) {
      json(res, 503, { error: 'Jev service not configured' });
      return;
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      json(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }

    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const upstream = await callTypeSafe(payload, apiKey);
    const retryAfter = upstream.headers.get('retry-after');
    if (!upstream.ok) {
      json(
        res,
        upstream.status,
        { error: 'TypeSafe request failed', status: upstream.status },
        retryAfter ? { 'Retry-After': retryAfter } : {}
      );
      return;
    }

    const raw = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': raw.length
    });
    res.end(raw);
  } catch (err) {
    json(res, err?.status || 502, {
      error: err?.status === 413 ? 'Request body too large' : 'TypeSafe request failed'
    });
  }
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, {
      ok: true,
      jevConfigured: Boolean(String(process.env.JEV_API_KEY || '').trim())
    });
    return;
  }
  if (req.url === '/api/jev') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
      return;
    }
    await proxyJev(req, res);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res);
    return;
  }
  json(res, 405, { error: 'Method Not Allowed' });
}

function canBind(port) {
  return new Promise(resolveCheck => {
    const tester = net.createServer();
    tester.once('error', () => resolveCheck(false));
    tester.listen(port, HOST, () => tester.close(() => resolveCheck(true)));
  });
}

async function choosePort() {
  for (const port of PORTS) {
    if (Number.isInteger(port) && port > 0 && port < 65536 && await canBind(port)) return port;
  }
  return await new Promise((resolvePort, reject) => {
    const tester = net.createServer();
    tester.once('error', reject);
    tester.listen(0, HOST, () => {
      const port = tester.address().port;
      tester.close(() => resolvePort(port));
    });
  });
}

function openBrowser(url) {
  if (process.env.JEV_PROXY_OPEN === '0') return;
  const options = { detached: true, stdio: 'ignore' };
  if (process.platform === 'darwin') spawn('open', [url], options).unref();
  else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], options).unref();
  else spawn('xdg-open', [url], options).unref();
}

const port = await choosePort();
const server = http.createServer((req, res) => {
  handle(req, res).catch(() => json(res, 500, { error: 'Internal Server Error' }));
});

server.listen(port, HOST, () => {
  const url = `http://${HOST}:${port}/`;
  console.log('Jev 五子棋本地代理已启动');
  console.log(`页面：${url}`);
  console.log(`代理：${url}api/jev`);
  console.log(process.env.JEV_API_KEY ? 'Jev Secret：已从 JEV_API_KEY 加载' : 'Jev Secret：未配置，将自动使用本地引擎降级');
  console.log('按 Ctrl+C 退出。');
  openBrowser(url);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
