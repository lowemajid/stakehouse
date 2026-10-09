const { getDefaultConfig } = require('expo/metro-config');
const httpProxy = require('http-proxy');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// One Metro graph across the npm-workspaces monorepo: watch the whole
// workspace and resolve imports from both node_modules roots so that
// @stakehouse/* sources and hoisted deps (react, react-native) all resolve.
const workspaceRoot = path.resolve(__dirname, '../..');
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Fonts ship as assets; woff2 is not in metro's default asset extensions.
config.resolver.assetExts.push('woff2');

// Dev-only same-origin proxy: /api/* forwards to the single-port Stakehouse
// server so the signed session cookie just works — no CORS and no server-side
// changes. The product runtime stays single-origin per the spec; this exists
// only under `expo start`, never in a deployed build.
const apiTarget = process.env.STAKEHOUSE_API_URL ?? 'http://localhost:3000';
const proxy = httpProxy.createProxyServer({ target: apiTarget });
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (req.url.startsWith('/api/')) {
      proxy.web(req, res);
      return;
    }
    middleware(req, res, next);
  },
};

module.exports = config;
