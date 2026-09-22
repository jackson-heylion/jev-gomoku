(() => {
  'use strict';

  const CACHE_PREFIX = 'jev_gomoku_jev_cache_v3:';
  const ENDPOINT = '/api/jev';
  const inflight = new Map();

  function hash(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function cacheKey(payload) {
    return CACHE_PREFIX + hash(JSON.stringify(payload));
  }

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      parsed.__client = {
        ...(parsed.__client || {}),
        cached: true,
        attempts: 0,
        transport: 'same-origin-server'
      };
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

  async function request({ payload, signal, useCache = true }) {
    if (!payload || typeof payload !== 'object') throw new Error('缺少 Jev 请求内容');

    const key = cacheKey(payload);
    if (useCache) {
      const cached = readCache(key);
      if (cached) return cached;
    }

    // Reuse an identical request already in progress. This prevents UI races
    // or repeated clicks from paying for the same Jev inference twice.
    if (useCache && inflight.has(key)) return inflight.get(key);

    const pending = (async () => {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal
      });

      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) {}

      if (!response.ok) {
        const detail = data?.detail || data?.message || data?.error || raw || `HTTP ${response.status}`;
        const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
        err.httpStatus = response.status;
        err.retryAfter = response.headers.get('retry-after');
        throw err;
      }

      const result = data || {};
      result.__client = {
        attempts: 1,
        cached: false,
        transport: 'same-origin-server'
      };
      if (useCache) writeCache(key, result);
      return result;
    })();

    if (useCache) inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (useCache && inflight.get(key) === pending) inflight.delete(key);
    }
  }

  function clearCache() {
    inflight.clear();
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
