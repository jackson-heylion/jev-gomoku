(() => {
  'use strict';

  const CACHE_PREFIX = 'jev_gomoku_jev_cache_v4:';
  const CACHE_FAMILY_PREFIX = 'jev_gomoku_jev_cache_v';
  const CACHE_TTL_MS = 45 * 60 * 1000;
  const CACHE_MAX_ENTRIES = 48;
  const CACHE_MAX_TOTAL_BYTES = 1024 * 1024;
  const CACHE_MAX_ENTRY_BYTES = 96 * 1024;
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

  function estimatedBytes(text) {
    // sessionStorage quotas are implementation-specific. Counting UTF-16 bytes
    // is intentionally conservative and keeps the real footprint below the cap.
    return String(text || '').length * 2;
  }

  function cacheKeys() {
    const keys = [];
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(CACHE_FAMILY_PREFIX)) keys.push(key);
      }
    } catch (_) {}
    return keys;
  }

  function removeLegacyCacheEntries() {
    for (const key of cacheKeys()) {
      if (!key.startsWith(CACHE_PREFIX)) {
        try { sessionStorage.removeItem(key); } catch (_) {}
      }
    }
  }

  function pruneCache({ reserveBytes = 0 } = {}) {
    removeLegacyCacheEntries();
    const now = Date.now();
    const entries = [];
    let totalBytes = 0;

    for (const key of cacheKeys()) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const createdAt = Number(parsed?.createdAt);
        const lastAccess = Number(parsed?.lastAccess || createdAt);
        if (!parsed?.data || !Number.isFinite(createdAt) || now - createdAt > CACHE_TTL_MS) {
          sessionStorage.removeItem(key);
          continue;
        }
        const bytes = estimatedBytes(raw);
        entries.push({ key, lastAccess: Number.isFinite(lastAccess) ? lastAccess : createdAt, bytes });
        totalBytes += bytes;
      } catch (_) {
        try { sessionStorage.removeItem(key); } catch (_) {}
      }
    }

    entries.sort((a, b) => a.lastAccess - b.lastAccess);
    while (
      entries.length > CACHE_MAX_ENTRIES ||
      totalBytes + reserveBytes > CACHE_MAX_TOTAL_BYTES
    ) {
      const victim = entries.shift();
      if (!victim) break;
      try { sessionStorage.removeItem(victim.key); } catch (_) {}
      totalBytes -= victim.bytes;
    }

    return { entries: entries.length, totalBytes: Math.max(0, totalBytes) };
  }

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const createdAt = Number(parsed?.createdAt);
      if (!parsed?.data || !Number.isFinite(createdAt) || Date.now() - createdAt > CACHE_TTL_MS) {
        sessionStorage.removeItem(key);
        return null;
      }

      parsed.lastAccess = Date.now();
      try { sessionStorage.setItem(key, JSON.stringify(parsed)); } catch (_) {}

      const result = parsed.data;
      result.__client = {
        ...(result.__client || {}),
        cached: true,
        attempts: 0,
        transport: 'same-origin-server'
      };
      return result;
    } catch (_) {
      try { sessionStorage.removeItem(key); } catch (_) {}
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      const now = Date.now();
      const wrapped = {
        createdAt: now,
        lastAccess: now,
        data
      };
      const raw = JSON.stringify(wrapped);
      const bytes = estimatedBytes(raw);

      // Never let a single unusually large upstream response dominate storage.
      if (bytes > CACHE_MAX_ENTRY_BYTES || bytes > CACHE_MAX_TOTAL_BYTES) return;

      pruneCache({ reserveBytes: bytes });
      try {
        sessionStorage.setItem(key, raw);
      } catch (_) {
        // Quotas can be smaller than expected (private mode / embedded webviews).
        // Evict LRU entries and retry once; failure simply means no cache.
        pruneCache({ reserveBytes: Math.min(CACHE_MAX_TOTAL_BYTES, bytes * 2) });
        try { sessionStorage.setItem(key, raw); } catch (_) {}
      }
      pruneCache();
    } catch (_) {}
  }

  async function request({ payload, signal, useCache = true }) {
    if (!payload || typeof payload !== 'object') throw new Error('缺少 Jev 请求内容');

    const key = cacheKey(payload);
    if (useCache) {
      pruneCache();
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
    for (const key of cacheKeys()) {
      try { sessionStorage.removeItem(key); } catch (_) {}
    }
  }

  function cacheStats() {
    const stats = pruneCache();
    return {
      ...stats,
      maxEntries: CACHE_MAX_ENTRIES,
      maxTotalBytes: CACHE_MAX_TOTAL_BYTES,
      ttlMs: CACHE_TTL_MS
    };
  }

  // Clear older cache formats immediately so stale unbounded entries cannot
  // survive an application upgrade and continue consuming browser storage.
  pruneCache();

  window.JevClient = { request, clearCache, cacheStats };
})();
