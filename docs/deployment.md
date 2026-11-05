# EventProof Deployment Notes (preparation only — no deployment performed)

> Do not expose this service publicly without adding user authentication and
> authorization. Phase 2 has no login; the backend is a localhost tool with a
> privileged calendar integration.

## Commands

- Backend: `npm install` then `node src/interfaces/http/server.js`
  (or `npm start`). Binds `HOST` (default `127.0.0.1`) and `PORT` (3000).
- Frontend dev: `cd web && npm install && npm run dev`
  → `http://127.0.0.1:5173` (proxies `/api` to `EVENTPROOF_BACKEND`,
  default `http://127.0.0.1:3000`).
- Frontend static: `cd web && npm run build` → serve `web/dist/` from any
  static host pointed at the API base (set `VITE_API_BASE_URL` at build time
  or the in-app override in Settings).

## Environment

Backend: `NODE_ENV=production`, `HOST`, `PORT`, `CALENDAR_ID`,
`SWYTCHCODE_BIN` (if the CLI is not on PATH), `SWYTCHCODE_TIMEOUT_MS`,
`VERIFY_SEARCH_WINDOW_DAYS`, `CORS_ORIGINS` (exact frontend origin when the
browser calls the API directly instead of through the dev proxy),
`RATE_LIMIT_MAX/_WINDOW_MS`, `AUDIT_DB_PATH` (durable volume path),
`VENUE_ALIASES`, `LOG_LEVEL`. See `.env.example`. No secrets belong in any
of these; provider OAuth stays in Swytchcode's store.

## Persistence

- Default: SQLite file at `AUDIT_DB_PATH` with WAL. Back it up by copying
  the `.db` (+`-wal`/`-shm`) while the server is stopped, or via
  `sqlite3 .backup`. Migrations run automatically and idempotently at boot.
- Ephemeral filesystems (serverless, scratch containers) make SQLite
  non-durable — do not claim otherwise. Multi-instance production needs a
  managed database behind the existing `AuditRepository` port.

## Provider OAuth

Run once per server identity from a terminal with a browser:
`swytchcode login`, `swytchcode get google_calendar`,
`swytchcode add calendar.event.get`, `swytchcode add calendar.event.get1`,
`swytchcode auth connect google_calendar`. Verify with the dry run, then the
integrations page (`/integrations`) and `SWYTCHCODE_SMOKE_LIVE=1`.

## Health checks

- Liveness: `GET /api/v1/health` (no upstream calls, safe for load
  balancers). Integration truth comes from `GET /api/v1/integrations/status`,
  never from liveness alone.

## Production limitations (must fix before public exposure)

1. No user authentication/authorization.
2. Single-process rate limiting and single-file audit store.
3. CORS allowlist must be set explicitly; never `*` with credentials (the API
   uses no cookies, and credentials stay disabled).
