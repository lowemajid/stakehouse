import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const distDir = fileURLToPath(new URL('../../dist', import.meta.url));

export interface CreateAppOptions {
  /** Serve the built SPA from dist (off in dev, where Vite middleware takes over). */
  serveSpa?: boolean;
}

export function createApp({ serveSpa = true }: CreateAppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'stakehouse-web' });
  });

  if (serveSpa) {
    app.use(express.static(distDir));
    // SPA fallback: unknown GETs get the app shell; API paths 404 as JSON.
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (req.method !== 'GET' || !req.accepts('html')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'), (err) => {
        if (err) res.status(503).send('SPA bundle missing — run `npm run build` first.');
      });
    });
  }

  return app;
}
