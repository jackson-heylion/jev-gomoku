import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { sites } from '@openai/sites-vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare(), sites()],
  build: {
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        legacy: resolve('jev-gomoku.html')
      }
    }
  }
});
