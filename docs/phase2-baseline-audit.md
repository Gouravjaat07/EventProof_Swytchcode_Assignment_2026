# Phase 2 — Baseline Audit (STAGE A)

Date: 2026-11-05. Verified by inspection + execution, not from memory.

## 1. Repository state

- Phase 1 files intact: `src/`, `tests/`, `scripts/`, `docs/`, `tools/`,
  `package.json`/`package-lock.json`, `README.md`, `.env.example`, `.gitignore`.
- No `web/`, no `data/`, no git repo, no CI. `.swytchcode/` unchanged
  (empty `integrations/`, empty `tools:{}`, `mode:"production"`, plus a
  `workspace.json` naming workspace `swtychcode_assignment`).
- No Wrekenfile yet — `swy get google_calendar` still awaits a networked run.
- `.env` exists and is a plain copy of `.env.example` (keys verified, no
  secrets present).

## 2. Baseline commands (all executed now)

| Command | Exit | Result |
|---|---|---|
| `npm install` | 0 | up to date |
| `npm run check` | 0 | 48 files, 0 failed |
| `npm test` | 0 | **113 tests, 113 pass, 0 fail** (22 suites) |
| `node scripts/swytchcode-smoke.js` | 0 | 5 passed, 0 failed, 1 blocked (live exec) |

No pre-existing failures. Baseline = 113 passing backend tests to preserve.

## 3. API contracts confirmed in source (frontend will bind to these)

- Base `/api/v1`; envelopes `{success,data,meta:{requestId}}` /
  `{success:false,error:{code,message,requestId,details?}}`.
- `GET /health` (local only) · `GET /events` (query: calendarId, timeMin,
  timeMax, query, limit 1–250, pageToken) · `GET /events/:eventId`
  (cancelled returned, not filtered) · `POST /verifications`
  (`{eventId, calendarId?, announcement}` → 201 + Location) ·
  `GET /verifications/:verificationId` (verbatim replay, else 404).
- Verification statuses: `VERIFIED|REVIEW_REQUIRED|UNVERIFIABLE`
  (`INVALID_INPUT` is engine-level; HTTP uses 400/422). Field states:
  `MATCH|MISMATCH|MISSING_IN_DRAFT|MISSING_IN_SOURCE|UNVERIFIABLE|NOT_APPLICABLE`.
- Provider method: `calendar.calendar.events.get` (LIST semantics).

## 4. Gaps Phase 2 must close (confirmed, not assumed)

1. Audit store is in-memory (`persistent:false`, cap 500) → SQLite via
   built-in `node:sqlite` (verified working on Node 22.18.0; zero new deps).
2. No history list/stats endpoints → add `GET /verifications` (paginated,
   filtered), `GET /verifications/stats`, `GET /integrations/status`.
3. `auth status` is local-only but sandbox-blocked here (lock-file EACCES) →
   status service must degrade to `unknown`, never guess.
4. Audit-save failure is currently best-effort-continue; Phase 2 history
   durability requires fail-loud instead (justified contract change, will be
   tested + documented).
5. No frontend, no persistence tests, no CI, no git.

## 5. Constraints carried forward

- Sandbox still blocks direct egress, binds, and non-workspace writes: live
  provider calls, `listen()` smoke, and dev-server runs stay user-side.
- Demo data (if any) must stay labeled and isolated from real history.
