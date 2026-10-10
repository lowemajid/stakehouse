# Ops — hosting Stakehouse on the project sandbox

The hosted app runs on the **project sandbox** (not a repo sandbox) as a single
Node process serving the built SPA and the JSON API on one port:

| Thing            | Value                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Deploy directory | `/home/user/work/stakehouse` (a git clone)                                               |
| Port             | `8817` (tmux session `svc-8817`)                                                         |
| Process          | `tsx apps/web/src/server/main.ts` → `apps/web/dist`                                      |
| Health check     | `GET /api/health` → `{"ok":true,"service":"stakehouse-web"}`                             |
| SQLite database  | `apps/web/data/stakehouse.db` (untracked — survives every deploy)                        |
| Logs             | `/home/user/work/logs/stakehouse-server.log` (server), `stakehouse-deploy.log` (updater) |

## How a merge reaches the hosted app

CI runners cannot reach the project sandbox, so deployment is **pull-based**:
the sandbox runs `ops/deploy-watchdog.sh`, a loop that polls `origin/main`
every two minutes and, on a new commit, runs `ops/deploy.sh`:

1. `git fetch origin main`; skip if `ops/deploy.sh` is not on `origin/main`
   yet (the updater stays idle until this repo lands) or if the SHA is
   unchanged.
2. `git reset --hard origin/main` — untracked `apps/web/data/` (the ledger)
   and `dist/` survive.
3. `npm ci` only when `node_modules` is missing or `package-lock.json`
   changed.
4. Build the SPA into `apps/web/dist-next`; only on success, swap it in
   (`dist` → `dist-prev`, `dist-next` → `dist`). A failed build leaves the
   running build untouched.
5. Restart tmux session `svc-8817` and poll `/api/health` for up to 20s. If
   the new build does not come up healthy, the previous build is restored and
   the script exits nonzero — the watchdog retries next tick and never takes
   the app down.

`ops/start-hosted.sh` is the hosting entrypoint (registered with the wake
path): it re-spawns the watchdog if the sandbox woke without it, then execs
the server in the foreground under `svc-8817`.

## Prove it

```sh
# Watch a full cycle: next merge to main, then on the project sandbox:
tail -f /home/user/work/logs/stakehouse-deploy.log
# Or force the check immediately:
bash /home/user/work/stakehouse/ops/deploy.sh
```

## Manual / bootstrap

The current deployment was bootstrapped by hand (clone, `npm ci`,
`npm run build`, start `svc-8817`, register the hosted service). After this
repo merges, the watchdog owns updates and the manual path is only needed if
the sandbox was destroyed from scratch:

```sh
git clone https://github.com/lowemajid/stakehouse /home/user/work/stakehouse
cd /home/user/work/stakehouse && npm ci && npm run build
tmux new-session -d -s svc-8817 'PORT=8817 bash ops/start-hosted.sh'
```

## Caveat — repo visibility

The updater pulls over unauthenticated HTTPS, which works while
`lowemajid/stakehouse` is public. If the repo is made private, give the
sandbox read access (a read-only deploy key or token) or deploys become
manual — run `ops/deploy.sh` by hand after each merge.
