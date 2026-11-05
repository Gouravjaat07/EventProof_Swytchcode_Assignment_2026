# Phase 2 — Implementation Record

## What changed and why

Phase 2 kept every Phase 1 layer and added a product around it: durable
history, three read endpoints, a status service, and a React console.

### Backend additions (no rewrites, one justified contract change)

- **SQLite audit store** (`src/infrastructure/repositories/sqlite*.js`) behind
  the existing `AuditRepository` port (extended with `list`/`stats`). Uses
  built-in `node:sqlite` — zero new dependencies. Versioned migrations via
  `PRAGMA user_version`, WAL mode, indexes on status/time/event. File:
  `data/eventproof.db` (`AUDIT_DB_PATH`, gitignored contents).
- **Fetch telemetry** (`provider_fetch_log`): success/failure + error category
  per upstream call, best-effort (observability, never product evidence).
- **History service**: validated pagination (1–100/page), status/search/date
  filters, sort, genuine `stats()` aggregates.
- **Integration service + CLI probe**: five independent conditions (backend,
  CLI present, runtime loads, provider auth, last fetch outcomes). Fixed
  command strings only; every probe failure degrades to `unknown`.
- **Endpoints**: `GET /verifications` (list), `GET /verifications/stats`
  (static route registered before `:verificationId`),
  `GET /integrations/status`.
- **Contract change (justified)**: audit-save failure now throws
  `AUDIT_STORAGE_UNAVAILABLE` (503) instead of continuing silently. Rationale:
  history/stats must be complete; a result without its record would corrupt
  both. The old best-effort test was replaced by a 503 assertion. No other
  Phase 1 contract changed.
- **Server**: opens/migrates SQLite at startup (fails fast with a clear
  message — never a silent memory fallback), closes the DB on shutdown.

### Frontend (`web/` — React 19 + Vite 8 + Tailwind v4 + Router 7)

- Pages: Overview dashboard (real stats/activity/discrepancies/status),
  Events (live search + ID lookup, CASE A+B both supported), Verify workspace
  (deep-linkable event, validated draft, result + corrections inline),
  History (filters/pagination/detail), Integrations (honest diagnostics),
  Settings (API base override, demo toggle, about), 404.
- One API client (`lib/api-client.js`): timeout+abort, envelope parsing,
  per-code user messages, request-id propagation. One `useApi` hook with
  abort + stale-response guard. No second verification engine anywhere.
- **Demo mode**: explicit toggle, persistent banner, canned fixtures in
  `lib/demo.js`; never POSTs, never touches real history/stats.
- Design: charcoal sidebar + light content, teal primary, status pills always
  text+icon, tabular numerals, mono IDs, skeletons/error/empty states on every
  data view, reduced-motion support, route-level code splitting.

### Deliberately not done

- No TypeScript migration, no state library, no component framework beyond
  Tailwind, no Playwright (environment-blocked — no bindable server for a
  browser to reach; documented in the validation report), no screenshots
  (no browser to capture them honestly).
