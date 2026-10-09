import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { createFakeStore } from '@stakehouse/persistence';
import type { StakehouseStore } from '@stakehouse/persistence';
import { errorMiddleware } from './http';
import { createInMemoryOpsStore } from './opsStore';
import type { LeagueOpsStore } from './opsStore';
import { Broadcaster } from './broadcaster';
import type { ApiContext } from './context';
import { sessionRoutes } from './routes/sessionRoutes';
import { playerRoutes } from './routes/playerRoutes';
import { leagueRoutes } from './routes/leagueRoutes';
import { draftRoutes } from './routes/draftRoutes';
import { seasonRoutes } from './routes/seasonRoutes';
import { opsRoutes } from './routes/opsRoutes';

const distDir = fileURLToPath(new URL('../../dist', import.meta.url));

export interface CreateAppOptions {
  /** Serve the built SPA from dist (off in dev, where Vite middleware takes over). */
  serveSpa?: boolean;
  /** Storage seam — defaults to the persistence package's in-memory fake. */
  store?: StakehouseStore;
  /** League-ops seam (waivers, trades, queues, commissioners). */
  ops?: LeagueOpsStore;
  /** The server clock — injected so tests are deterministic. */
  now?: () => number;
  /** Milliseconds between SSE clock ticks; 0 (default) disables the ticker. */
  tickerMs?: number;
  /** HMAC secret for session cookies; overridable for tests. */
  cookieSecret?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const {
    serveSpa = true,
    store = createFakeStore(),
    ops = createInMemoryOpsStore(),
    now = Date.now,
    tickerMs = 0,
    cookieSecret = process.env.SH_COOKIE_SECRET ?? 'stakehouse-dev-secret',
  } = options;

  const broadcaster = new Broadcaster();
  const ctx: ApiContext = { store, ops, now, broadcaster, cookieSecret };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  const api = express.Router();
  api.use(sessionRoutes(ctx));
  api.use(playerRoutes(ctx));
  api.use(leagueRoutes(ctx));
  api.use(draftRoutes(ctx));
  api.use(seasonRoutes(ctx));
  api.use(opsRoutes(ctx));
  api.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'stakehouse-web' });
  });
  app.use('/api', api);

  // Clock ticks for live draft rooms: an SSE heartbeat that lets every
  // connected client re-derive the countdown without local timers. Disabled
  // in tests (tickerMs: 0) — picks publish their own refreshed view.
  if (tickerMs > 0) {
    const ticker = setInterval(() => {
      broadcaster.publishAll('clock', { at: now() });
    }, tickerMs);
    ticker.unref();
  }

  // Every thrown failure — HttpError, ZodError, DomainError, or the
  // unexpected — leaves as the one error envelope.
  app.use(errorMiddleware);

  if (serveSpa) {
    app.use(express.static(distDir));
    // SPA fallback: unknown GETs get the app shell; API paths 404 as JSON.
    app.use((req: Request, res: Response, next: NextFunction) => {
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
