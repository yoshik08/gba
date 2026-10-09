import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/gba/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        library: resolve('index.html'),
        play: resolve('play/index.html'),
      },
    },
  },
});
