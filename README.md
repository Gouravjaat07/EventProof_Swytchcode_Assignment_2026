# EventProof — Proof Before Post.

EventProof verifies campus event announcements against authoritative event
records **before** organizers publish them. It fetches the official record
through [Swytchcode](https://swytchcode.com), compares it field-by-field
against an announcement draft with a deterministic engine, and returns an
evidence-backed `VERIFIED` / `REVIEW_REQUIRED` / `UNVERIFIABLE` decision.
EventProof never publishes anything — the organizer always approves and posts.

## Product status (Phases 1 + 2 complete)

Backend foundation plus a complete React console: dashboard, event search,
verification workspace with evidence + corrections, durable history, and
integration diagnostics. Durable SQLite audit store, 135 backend + 46
frontend tests, CI-ready. **Still user-side**: provider OAuth + live API call,
real-browser visual pass, `git push`, deployment.

## Architecture

```text
React console (web/) ── /api/v1 (same-origin proxy) ──► Express 5 API
HTTP (/api/v1) → Application services → Domain engine → Infrastructure
                                                      ├── Swytchcode client → CLI kernel → Google Calendar (read-only)
                                                      └── SQLite audit store (data/eventproof.db)
```

Domain/application layers never import infrastructure: the provider is a
swappable port. See [`docs/architecture.md`](docs/architecture.md).

## Requirements

- Node.js ≥ 22, npm, PowerShell (Windows) or any POSIX shell.
- Swytchcode CLI 2.25.5: global install (`npm install -g swytchcode`) **or**
  the repo-local copy in `tools/cli` (no install needed to *run* it).

## Quick start

Backend (terminal 1):

```powershell
npm install
copy .env.example .env   # adjust if needed; never commit .env
npm run check            # syntax gate
npm test                 # 135 tests, fully offline
node scripts/swytchcode-smoke.js   # real CLI checks (live exec: BLOCKED until auth, see below)
npm start                # serves http://127.0.0.1:3000
```

Frontend (terminal 2):

```powershell
cd web
npm install
npm test                 # 46 tests (jsdom, offline)
npm run build            # production bundle check
npm run dev              # serves http://127.0.0.1:5173, proxies /api to the backend
```

Then open `http://127.0.0.1:5173` in a browser. Health check:
`GET /api/v1/health` (local only, no upstream calls).

## Swytchcode setup (one-time, unrestricted terminal)

The CLI needs direct network + a browser for these steps (sandboxed shells
cannot dial out — see [`docs/phase1-environment-audit.md`](docs/phase1-environment-audit.md)):

```powershell
.\tools\cli\node_modules\.bin\swytchcode.cmd login
.\tools\cli\node_modules\.bin\swytchcode.cmd get google_calendar
.\tools\cli\node_modules\.bin\swytchcode.cmd add calendar.event.get
.\tools\cli\node_modules\.bin\swytchcode.cmd add calendar.event.get1
.\tools\cli\node_modules\.bin\swytchcode.cmd auth connect google_calendar
```

Verify: `swy info calendar.event.get`, then
`swy exec calendar.event.get --dry-run`, then set
`SWYTCHCODE_SMOKE_LIVE=1` and re-run the smoke test for the genuine call.
Only the read method is ever enabled — no create/update/delete/send anywhere.
Full findings: [`docs/phase1-swytchcode-discovery.md`](docs/phase1-swytchcode-discovery.md);
execution evidence + blockers: [`docs/phase1-api-execution-report.md`](docs/phase1-api-execution-report.md).

## Console pages

Overview dashboard (real stats/activity/discrepancies) · Events (live search +
ID lookup) · Verify workspace (draft → evidence → corrections) · History
(filters, pagination, durable detail) · Integrations (honest CLI/auth/fetch
diagnostics) · Settings (API base, explicit demo mode). Demo mode renders
labeled synthetic fixtures and never touches real history.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/health` | liveness (no upstream calls) |
| GET | `/api/v1/events?timeMin&timeMax&query&limit&pageToken` | list official events |
| GET | `/api/v1/events/:eventId` | one event (cancelled shown, not filtered) |
| POST | `/api/v1/verifications` | verify a draft → 201 + `Location` |
| GET | `/api/v1/verifications` | paginated history (`status/q/from/to/page/pageSize/sort`) |
| GET | `/api/v1/verifications/stats` | genuine aggregates |
| GET | `/api/v1/verifications/:verificationId` | replay audit record |
| GET | `/api/v1/integrations/status` | safe diagnostics |

```jsonc
// POST /api/v1/verifications
{ "eventId": "abc123", "announcement": {
  "title": "Hacknite 2026", "eventDate": "2026-08-07",
  "startTime": "10:00", "endTime": "18:00",
  "timeZone": "Asia/Kolkata", "venue": "SVSU Campus" } }
// → { status: "VERIFIED" | "REVIEW_REQUIRED" | "UNVERIFIABLE",
//     summary, fieldResults: [{ field, official, draft, state,
//     explanation, correction, critical }] }
```

Contract details: [`docs/api-reference.md`](docs/api-reference.md).

## Verification rules (short)

Critical fields (title, date, start time, venue) must MATCH for `VERIFIED`;
any critical mismatch/gap → `REVIEW_REQUIRED`; missing authoritative data →
`UNVERIFIABLE` (never guessed). Cancelled/unknown events throw (409/404) —
never verify. Times render in the event's own zone; UTC fallback is explicit
and degrades date/time/zone to unverifiable unless the instant is known and
the draft names its zone. Registration URLs are always `UNVERIFIABLE`
(Google exposes no authoritative value) — never marked verified.

## Project layout

```text
src/config            env validation + app constants
src/domain            text/time utils, event + draft models, verification engine
src/application       services + ports (provider/audit boundaries)
src/infrastructure    swytchcode client, calendar provider, audit store
src/interfaces/http   app factory, server, routes, controllers, middleware
src/shared            error taxonomy, redacting JSON logger
tests/unit|integration|fixtures   node:test suite (synthetic fixtures labeled)
scripts               check.js (syntax gate), swytchcode-smoke.js (real CLI)
tools/cli             local Swytchcode CLI install · tools/relay  proxy-relay dev tool
web/                  React console (Vite): app shell, pages, API client, tests
data/                 SQLite audit database at runtime (gitignored contents)
docs                  audits, discovery, execution report, architecture, api, testing, security, deployment, friction
AI-usage.md           AI assistance disclosure
```

## Data & persistence

Verification audits persist in SQLite (`data/eventproof.db`, gitignored) with
versioned migrations; history survives restarts. Single-instance only —
multi-instance production needs a managed database (same repository port).
Back up the `.db` file while stopped. Docs: `docs/deployment.md`.

## Known limitations

- Live provider call pending user auth/network (tracked, commands ready).
- No UI screenshots captured (no browser in the build sandbox).
- Rate limiter is per-process; server binds localhost with no user auth
  (no public exposure without an auth model).
- `getEventById` searches a bounded window (verification: ±3 days around the
  draft date; bare lookup: past 30 d → future 365 d, ≤3 pages).

## Troubleshooting

- `SWYTCHCODE_NOT_INSTALLED`: install globally or set `SWYTCHCODE_BIN`.
- `SWYTCHCODE_OPERATION_NOT_FOUND`: run the `get`/`add` setup above.
- `AUTH_REQUIRED`/`AUTH_EXPIRED`: re-run `swy auth connect google_calendar`.
- `CONFIGURATION_ERROR` naming the calendar: check `CALENDAR_ID`.
- `AUDIT_STORAGE_UNAVAILABLE`: check `AUDIT_DB_PATH` is writable (or delete a corrupt `.db` to re-migrate empty).
- Frontend can't reach backend: confirm `npm start` is up, then check Settings → API base (empty = dev proxy).
- Everything returns `{code, message, requestId}` — correlate with the JSON logs.
