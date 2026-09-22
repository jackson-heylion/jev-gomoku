/**
 * Node worker_threads shim that emulates a browser dedicated Worker for
 * `public/deep-worker.js`.
 *
 * Production creates `new Worker('/deep-worker.js', { type: 'module' })` and
 * talks to it with `onmessage` / `onerror` / `postMessage` / `terminate`. When
 * `Worker` is undefined, `src/app.js` falls back to an unbounded synchronous
 * deep search. The benchmark must exercise the real, time-budgeted worker path
 * so its timing and deep-search evidence match what the page actually does.
 */
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = String(workerData?.url || '/deep-worker.js');
const sourcePath = path.join(ROOT, 'public', path.basename(requested));

// `public/deep-worker.js` is written for a browser worker scope: it assigns
// `self.onmessage` and calls `self.postMessage`. Map that onto the thread.
globalThis.self = globalThis;
globalThis.onmessage = null;
globalThis.postMessage = message => {
  parentPort.postMessage(message);
};

await import(pathToFileURL(sourcePath).href);

parentPort.on('message', data => {
  const handler = globalThis.onmessage;
  if (typeof handler !== 'function') {
    parentPort.postMessage({
      id: data?.id ?? null,
      ok: false,
      error: 'deep-worker.js did not register onmessage'
    });
    return;
  }
  try {
    handler({ data });
  } catch (error) {
    parentPort.postMessage({
      id: data?.id ?? null,
      ok: false,
      error: String(error?.message || error || 'deep worker thread failed')
    });
  }
});
