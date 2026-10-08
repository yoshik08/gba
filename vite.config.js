import { defineConfig } from 'vite';

export default defineConfig({
  base: '/gba/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        library: './src/library/index.html',
        play: './src/play/index.html'
      }
    }
  }
});