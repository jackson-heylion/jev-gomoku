(() => {
  'use strict';

  const CACHE_PREFIX = 'jev_gomoku_jev_cache_v2:';
  const MAX_ATTEMPTS = 3;
  const RETRYABLE = new Set([429, 529]);

  function hash(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function cacheKey(endpoint, payload) {
    return CACHE_PREFIX + hash(endpoint + '|' + JSON.stringify(payload));
  }

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      parsed.__client = { ...(parsed.__client || {}), cached: true, attempts: 0 };
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify(data));
    } catch (_) {}
  }

  function parseRetryAfter(response, attempt) {
    const header = response.headers.get('retry-after');
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15000, seconds * 1000);
      const when = Date.parse(header);
      if (Number.isFinite(when)) return Math.max(0, Math.min(15000, when - Date.now()));
    }
    return Math.min(8000, 650 * (2 ** attempt));
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(done, ms);
      function done() {
        signal?.removeEventListener('abort', abort);
        resolve();
      }
      function abort() {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new DOMException('Aborted', 'AbortError'));
      }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async function request({ endpoint, apiKey, payload, signal, useCache = true }) {
    if (!endpoint) throw new Error('缺少 Jev Endpoint');
    if (!apiKey) throw new Error('缺少 Jev API Key');

    const key = cacheKey(endpoint, payload);
    if (useCache) {
      const cached = readCache(key);
      if (cached) return cached;
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal
      });

      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) {}

      if (response.ok) {
        const result = data || {};
        result.__client = { attempts: attempt + 1, cached: false };
        if (useCache) writeCache(key, result);
        return result;
      }

      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(parseRetryAfter(response, attempt), signal);
        continue;
      }

      const detail = data?.detail || data?.message || data?.error || raw || `HTTP ${response.status}`;
      const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      err.httpStatus = response.status;
      err.retryAfter = response.headers.get('retry-after');
      throw err;
    }

    throw new Error('Jev request failed after retries');
  }

  function clearCache() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
      }
      keys.forEach(key => sessionStorage.removeItem(key));
    } catch (_) {}
  }

  window.JevClient = { request, clearCache };
})();
