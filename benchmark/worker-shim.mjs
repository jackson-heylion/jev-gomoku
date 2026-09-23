import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'deep-worker-thread.mjs');

/**
 * Minimal browser-compatible Worker facade backed by node:worker_threads.
 * Only the surface used by `src/app.js` is implemented:
 * `constructor(url, options)`, `onmessage`, `onerror`, `postMessage`, `terminate`.
 * The optional `ref/unref` methods mirror Node worker_threads so the production
 * persistent pool can keep a worker alive only while a benchmark task is active.
 */
export function createBrowserWorkerClass() {
  return class BrowserWorker {
    constructor(url) {
      this.url = String(url || '/deep-worker.js');
      this.onmessage = null;
      this.onerror = null;
      this._terminated = false;
      this._thread = new NodeWorker(ENTRY, { workerData: { url: this.url } });

      this._thread.on('message', data => {
        if (this._terminated) return;
        this.onmessage?.({ data });
      });

      this._thread.on('error', error => {
        this._fail(error?.message || String(error || 'deep worker thread error'));
      });

      this._thread.on('exit', code => {
        if (code !== 0 && !this._terminated) {
          this._fail('deep worker thread exited with code ' + code);
        }
      });
    }

    _fail(message) {
      if (this._terminated) return;
      this.onerror?.({ message });
    }

    postMessage(message) {
      if (this._terminated) return;
      this._thread.postMessage(message);
    }

    ref() {
      if (!this._terminated) this._thread.ref();
    }

    unref() {
      if (!this._terminated) this._thread.unref();
    }

    terminate() {
      if (this._terminated) return Promise.resolve(0);
      this._terminated = true;
      return this._thread.terminate();
    }
  };
}
