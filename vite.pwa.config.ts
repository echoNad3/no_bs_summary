import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./apps/pwa', import.meta.url)),
  publicDir: 'public',
  build: {
    outDir: fileURLToPath(new URL('./dist/pwa', import.meta.url)),
    emptyOutDir: true,
  },
});
