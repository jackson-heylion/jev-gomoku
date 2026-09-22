const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const RETRYABLE = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(status, value, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
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
  let lastResponse = null;

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
    if (!RETRYABLE.has(response.status) || attempt === MAX_ATTEMPTS - 1) {
      return response;
    }

    await sleep(retryDelayMs(response, attempt));
  }

  return lastResponse;
}

async function handleJev(request, env) {
  const apiKey = String(env?.JEV_API_KEY || '').trim();
  if (!apiKey) {
    return json(503, { error: 'Jev service not configured' });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json(415, { error: 'Content-Type must be application/json' });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(413, { error: 'Request body too large' });
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json(400, { error: 'Unable to read request body' });
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json(413, { error: 'Request body too large' });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  try {
    const upstream = await callTypeSafe(payload, apiKey);
    const body = await upstream.text();
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    };
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) headers['Retry-After'] = retryAfter;

    if (upstream.ok) {
      return new Response(body, { status: upstream.status, headers });
    }

    return json(
      upstream.status,
      { error: 'TypeSafe request failed', status: upstream.status },
      retryAfter ? { 'Retry-After': retryAfter } : {}
    );
  } catch {
    return json(502, { error: 'TypeSafe request failed' });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/jev') {
      if (request.method !== 'POST') {
        return json(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
      }
      return handleJev(request, env);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json(200, { ok: true, jevConfigured: Boolean(String(env?.JEV_API_KEY || '').trim()) });
    }

    if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
