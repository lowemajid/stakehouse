#!/usr/bin/env node
/**
 * Dev-only same-origin dogfood server for the Expo web target.
 *
 *   :8090/api/*  → the API server (default :3000)
 *   :8090/*      → the static Expo web export (apps/mobile/dist), SPA fallback
 *
 * The mobile client talks same-origin (`createClient()` with no baseUrl), so
 * the browser loads the app and its API from one origin — exactly the runtime
 * shape the production single-port server provides. Streamed responses (SSE)
 * pass through unbuffered.
 *
 * Usage: node apps/mobile/scripts/web-dogfood-proxy.mjs   (build first:
 * `npx expo export --platform web` in apps/mobile)
 * Env:   PROXY_PORT (8090), API_ORIGIN (http://127.0.0.1:3000),
 *        WEB_DIST (apps/mobile/dist)
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PROXY_PORT ?? 8090);
const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:3000';
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain',
};

http
  .createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      const target = new URL(url, API);
      const upstream = http.request(
        target,
        { method: req.method, headers: { ...req.headers, host: target.host } },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('api upstream unavailable');
      });
      req.pipe(upstream);
      return;
    }

    // Static export with an SPA fallback — unknown paths render the app root.
    const pathname = decodeURIComponent(new URL(url, 'http://x').pathname);
    let file = normalize(join(DIST, pathname));
    if (!file.startsWith(DIST)) file = join(DIST, 'index.html');
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(DIST, 'index.html');
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
    });
    createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    console.log(`dogfood server → :${PORT} (/api → ${API}, static ← ${DIST})`);
  });
