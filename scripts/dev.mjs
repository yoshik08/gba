import { createServer } from 'vite';

const port = parseInt(process.env.PORT || '5173', 10);
const server = await createServer({
  base: '/',
  server: { port },
});
await server.listen();
server.printUrls();
