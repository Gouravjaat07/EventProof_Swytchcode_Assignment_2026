# Phase 2 — Validation Report

Every command below was executed in this workspace on 2026-11-05 (Windows,
Node v22.18.0). Statuses: PASS (observed green), BLOCKED (environment wall,
with evidence), FAIL (none outstanding).

## Backend

| Command | Exit | Result |
|---|---|---|
| `npm install` | 0 | PASS, up to date |
| `npm run check` | 0 | PASS — 58 files, 0 failed |
| `npm test` | 0 | PASS — 135/135 (22 backend suites incl. new SQLite/history/status/endpoint tests; all 113 Phase 1 tests preserved, 1 contract test updated for the documented audit-503 change) |
| `node scripts/swytchcode-smoke.js` | 0 | PASS (5) + BLOCKED (1 live exec — sandbox has no direct egress; user-side command documented) |

## Frontend (`cd web`)

| Command | Exit | Result |
|---|---|---|
| `npm install` | 0 | PASS (jsdom pinned to 26.1.0: v31 needs Node ≥22.22; see friction diary) |
| `npm test` | 0 | PASS — 46/46 (4 files: api-client, format/validation, components, journeys) |
| `npm run build` | 0 | PASS — route-split bundles, 335 KB main (gzip 107 KB) |

## Integration (real backend ↔ real frontend code)

- Frontend API client contract verified against the real backend envelope
  shapes (unit-tested with verbatim envelopes) and the mocked journeys assert
  exact request payloads (`eventId` + `announcement`).
- Backend new-endpoint behavior verified over the real Express stack via
  in-process injection (history pagination/filters, stats, status).
- Full production wiring (SQLite `:memory:` in tests, file in prod) composes
  and answers `/health` in the composition test.

## BLOCKED with evidence (not attempted blindly)

1. **Live provider call**: CLI binary cannot dial out (`bind … forbidden`,
   observed). Unblocks with user `login` + `auth connect` + network.
2. **Serving either app live**: `listen()` on an explicit port logs success
   then the process vanishes with an empty event loop; port 0 fails `EACCES`
   (both observed). Hence `npm start` + `npm run dev` + browser rendering +
   screenshots cannot run here. The user-side check is two terminals + the
   health URL (see README).
3. **Playwright E2E**: not installed — a browser cannot reach a server that
   cannot bind, so it would prove nothing here. The jsdom journeys + backend
   integration tests cover the same flows at their respective layers.

## Pre-existing vs new

- No pre-existing failures: the Phase 2 baseline re-verified 113/113 before
  any Phase 2 edit (see `docs/phase2-baseline-audit.md`).
- All Phase 2 failures encountered during development (import paths, test
  strictness, jsdom engines) were fixed in-session; the suites above are the
  final state, re-run after the last edit.
