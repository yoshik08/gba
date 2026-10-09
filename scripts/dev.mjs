import { createServer } from 'vite';

const port = parseInt(process.env.PORT || '5173', 10);
const server = await createServer({
  base: '/',
  optimizeDeps: {
    exclude: ['@thenick775/mgba-wasm']
  },
  server: {
    port,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
});

await server.listen();
server.printUrls();
