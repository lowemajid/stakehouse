# Stakehouse

Demo-money fantasy sports leagues where the ledger is the product — transparent pots, live
snake drafts, AI managers, and season-end payouts, built red-green-refactor behind a
CI-gated pipeline.

> **Demo money only.** Checkout is clearly labeled as simulated; no real payment processor
> exists in this build. All players are fictional.

## Layout (npm workspaces)

| Path                  | Package                  | Purpose                                                                     |
| --------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `apps/web`            | `@stakehouse/web`        | Express + React/Vite — one Node process serving the API and SPA on one port |
| `apps/mobile`         | `@stakehouse/mobile`     | Placeholder — the Expo/React Native client lands in its own slice           |
| `packages/domain`     | `@stakehouse/domain`     | Pure league engine (scoring, draft, simulation, ledger) — no I/O            |
| `packages/api-client` | `@stakehouse/api-client` | Typed HTTP client shared by web and mobile — placeholder for now            |
| `packages/theme`      | `@stakehouse/theme`      | Shared design tokens: dark felt, brass reserved for money, cream text       |

## Getting started

```bash
npm install
npm run dev        # one process on one port (default 3000)
```

## Scripts (root)

| Script              | Does                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `npm run dev`       | Express + Vite middleware — API and SPA on a single port             |
| `npm run build`     | Builds the web SPA into `apps/web/dist`                              |
| `npm start`         | Serves the built SPA + API from one Node process                     |
| `npm run test`      | Builds the SPA, then runs vitest (smoke test serves the real bundle) |
| `npm run lint`      | Prettier check + ESLint                                              |
| `npm run typecheck` | `tsc --noEmit` over all workspaces (strict)                          |
| `npm run format`    | Prettier write                                                       |

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci` → `lint` → `typecheck` → `test`
on every PR and every push to `main`. Squash merges only.

## TDD

Red-green-refactor is the delivery contract: tests land before the code they cover, and
CI history shows the red run before the green one.
