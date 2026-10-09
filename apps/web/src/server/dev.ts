import { createApp } from './app';
import { bootStore } from './store';
import { createServer } from 'vite';

const port = Number(process.env.PORT ?? 3000);

// One process, one port: Vite middleware serves the SPA in dev, Express owns /api.
const app = createApp({ serveSpa: false, store: bootStore() });
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'spa',
});
app.use(vite.middlewares);

app.listen(port, () => {
  console.log(`stakehouse dev server → http://localhost:${port}`);
});
