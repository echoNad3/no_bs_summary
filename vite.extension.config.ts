import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./apps/extension', import.meta.url));

export default defineConfig({
  root,
  publicDir: 'public',
  build: {
    outDir: fileURLToPath(new URL('./dist/extension', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: fileURLToPath(new URL('./apps/extension/sidepanel.html', import.meta.url)),
        background: fileURLToPath(new URL('./apps/extension/src/background.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
