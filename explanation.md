# EventProof — Comprehensive Explanation

*Proof Before Post.* This document explains what EventProof is, who it serves,
how it is built, how the Swytchcode integration was explored and verified, and
what was proven by real execution. Every version number, command result, and
test count below comes from the project's own sources (code, configs,
`tooling.json`, `wrekenfile.yaml`, docs, and terminal evidence). Where evidence
comes from the user's unrestricted terminal rather than the agent sandbox, that
is stated explicitly — nothing simulated is presented as live.

---

## 1. PROJECT OVERVIEW

**What EventProof is.** EventProof is an event-announcement verification
platform. Organizers enter an announcement draft (title, date, times, time
zone, venue, registration URL); EventProof fetches the authoritative event
record from Google Calendar through Swytchcode, compares the two field by
field with a deterministic engine, and returns an evidence-backed decision:
`VERIFIED`, `REVIEW_REQUIRED`, or `UNVERIFIABLE`, plus exact corrections drawn
from the official record. Every verification is stored as a durable audit
record that survives restarts.

**Problem it solves.** Campus announcements circulate across WhatsApp,
Instagram, LinkedIn, posters, and websites. Dates change without updated
posters, venues move after drafts are written, different channels show
different times, registration links rot, and multiple versions of "the truth"
confuse students and organizers alike. Manual cross-checking is slow and
misses exactly the small discrepancies (a wrong date, a moved venue) that
cause the most damage.

**Why it was developed.** To insert a verification layer between event
information and publication: a fast, repeatable, explainable check that
catches incorrect details *before* they spread, while leaving the final
publish decision with the human organizer.

**What makes it different.** (1) The source of truth is fetched live through
Swytchcode from Google Calendar — never typed in, never guessed. (2) The
comparison is deterministic and explainable: every field shows official value,
draft value, outcome, reason, and correction. (3) It is fail-closed: API
failures, cancelled events, unknown events, and unverifiable fields can never
produce `VERIFIED`. (4) It never publishes, modifies calendar data, or calls
write APIs — verification only.

## 2. TARGET USERS AND BENEFITS

- **College students.** See announcements they can trust: correct dates,
  times, and venues mean fewer wasted trips and missed events.
- **Event organizers.** Catch their own mistakes before posting. A wrong date
  in a draft becomes a precise correction ("official record says 7 August
  2026") instead of an embarrassing re-announcement.
- **Student clubs and communities.** Keep every channel consistent: one
  verification pass produces the corrected details to paste into WhatsApp,
  Instagram, posters, and mail, ending version drift.
- **College administration.** Fewer complaints and less confusion around
  official events; the audit trail shows what was verified, when, and against
  which record.
- **Event participants.** Spend less effort double-checking logistics and
  more time participating; registration links shown as unverifiable signal
  "confirm manually" instead of failing silently.

## 3. REAL-WORLD IMPACT

EventProof reduces incorrect announcements by comparing every draft against
the live calendar record at verification time, so outdated posters and stale
copies are caught instead of circulated. It reduces outdated information
because each verification fetches fresh data — a venue changed yesterday is
flagged today. It reduces communication confusion by producing one corrected,
source-backed set of details for all channels. And it reduces manual
verification work: the check that used to mean opening the calendar and
eyeballing six fields becomes one form submission with a complete evidence
table. No impact statistics are claimed — the project has not run a measured
deployment study, and this document invents none.

## 4. COMPLETE TECHNOLOGY STACK

| Layer | Technology | Version | Role |
|---|---|---|---|
| Frontend | React + React DOM | 19.3.1 | UI components and rendering |
| Frontend | React Router | 7.18.5 | Client-side routing (dashboard, events, verify, history, integrations, settings) |
| Frontend | Tailwind CSS (+ Vite plugin) | 4.3.4 | Utility-first styling |
| Frontend | Lucide React | 1.69.0 | Icon set (no emoji icons) |
| Frontend | Vite (+ React plugin) | 8.3.6 / 6.2.1 | Dev server, HMR, production bundler |
| Backend | Node.js | ≥22 (observed v22.18.0, npm 10.9.3) | Runtime |
| Backend | Express | 5.3.0 | HTTP API (`/api/v1`, 8 endpoints) |
| Backend | @swytchcode/runtime | 1.2.1 | SDK `exec()` used by the Swytchcode client |
| Backend | zod | 4.6.7 | Required (pinned) because the SDK loads it unconditionally |
| Database | SQLite via `node:sqlite` (`DatabaseSync`) | Node built-in | Durable audit store (`data/eventproof.db`); in-memory repo exists for tests only |
| APIs | Google Calendar API v3 via Swytchcode | provider lib `calendar` v3 | Authoritative event source (read-only) |
| Swytchcode | CLI (`swytchcode` / `swy` alias) | 2.25.5 | Tool discovery, auth, execution kernel |
| Auth | Google OAuth2 via Swytchcode managed auth | — | `swy login` (device flow) + `swy auth connect google_calendar` (browser OAuth); tokens live in Swytchcode's store, never in the app |
| Testing | `node:test` + `node:assert/strict` | Node built-in | Backend unit/integration/contract tests |
| Testing | light-my-request | 6.8.0 | In-process HTTP injection for API tests (no sockets) |
| Testing | Vitest + Testing Library + User Event + jsdom | 5.1.0 / 16.3.3 / 14.6.8 / 26.1.0 | Frontend component, API-client, and journey tests (jsdom pinned: v31 needs a newer Node) |
| Build/dev | `scripts/check.js` syntax gate, `scripts/swytchcode-smoke.js` | — | Static gate (58 files) and real-CLI smoke test |
| Build/dev | npm scripts (`start`, `test`, `check`, `test:smoke`; web: `dev`, `build`, `preview`, `test`) | — | Reproducible workflows |

No AI APIs, paid services, message queues, caches, containers, or
microservices are used. The dependency tree is deliberately small.

## 5. PROJECT ARCHITECTURE

```text
React console (web/) ── /api/v1 (same-origin proxy) ──► Express 5 API
HTTP (/api/v1) → Application services → Domain engine → Infrastructure
                                                      ├── Swytchcode client → CLI kernel → Google Calendar (read-only)
                                                      └── SQLite audit store (data/eventproof.db)
```

- **Frontend (`web/`).** React 19 console built with Vite: dashboard, event
  search/selection, verification workspace, results with corrections,
  persistent history, integration diagnostics, settings. One centralized API
  client (`web/src/lib/api-client.js`) owns base-URL resolution, timeouts,
  abort, envelope parsing, and error normalization; components never call
  `fetch` directly and never touch provider credentials or Google APIs.
- **HTTP layer (`src/interfaces/http`).** Versioned routes, thin controllers,
  request IDs, security headers, CORS allowlist, body limits, rate limiting,
  and a central error middleware that maps domain errors to stable HTTP
  statuses without leaking stacks or secrets.
- **Application services (`src/application`).** `FetchEventsService`
  (validated listing + single-event reads), `VerifyAnnouncementService`
  (validate draft → fetch official record → run engine → persist audit →
  return result), `HistoryService`, `IntegrationService`. Services depend only
  on the `EventSourceProvider` port, so the calendar backend is swappable.
- **Domain verification engine (`src/domain`).** Pure, deterministic logic
  with no I/O: text/date/time/venue/URL normalization, field comparators
  (`MATCH`, `MISMATCH`, `MISSING_IN_DRAFT`, `MISSING_IN_SOURCE`,
  `UNVERIFIABLE`, `NOT_APPLICABLE`), and the decision function (`VERIFIED` /
  `REVIEW_REQUIRED` / `UNVERIFIABLE` / `INVALID_INPUT`) with precedence rules.
  Fully testable on synthetic fixtures.
- **Swytchcode integration (`src/infrastructure/swytchcode`).**
  `SwytchcodeClient` is the only module allowed to invoke Swytchcode: tool-id
  validation, stdin params (user input never becomes a shell argument),
  15s timeouts, demo-payload refusal, exit-code/error-envelope mapping, and
  bounded retries for transient failures only. `CalendarProvider` implements
  the port: listing via `calendar.event.get`, exact retrieval via
  `calendar.event.get1`, response validation, and normalization into the
  stable `OfficialEvent` model.
- **Persistent database.** SQLite behind the `AuditRepository` interface:
  versioned migrations, indexed queries, paginated history, transaction-safe
  inserts. Verification records survive backend restarts; if storage fails,
  the API returns `AUDIT_STORAGE_UNAVAILABLE` (503) instead of silently
  dropping history. Local SQLite suits single-instance use; a managed
  database is documented as the path for multi-instance production.

## 6. HOW EVENTPROOF WORKS

1. **Official Google Calendar event.** The organizer's calendar holds the
   authoritative record (title, date/times, time zone, venue, status).
2. **Swytchcode API.** The backend calls Google Calendar only through
   Swytchcode tools, with OAuth credentials injected by Swytchcode's managed
   auth — the app never sees tokens.
3. **Event selection.** The user searches the calendar (or pastes an event
   ID); the UI lists real records with title, date, time, venue, and source
   ID, and the selection carries the exact Google `items[].id`.
4. **Announcement draft.** The user enters what they plan to publish. The
   frontend validates early; the backend re-validates authoritatively.
5. **Backend verification.** `POST /api/v1/verifications` fetches the
   official event by exact ID (`calendar.event.get1`) and runs the
   deterministic engine — no window, no guessing, no AI-generated values.
6. **Field comparisons.** Title, date, start/end time, time zone, venue, and
   registration URL (only if the source provides one) are each compared with
   documented normalization and an explicit outcome state.
7. **Verification decision.** `VERIFIED` only when every verifiable critical
   field matches a freshly fetched record; otherwise `REVIEW_REQUIRED` or
   `UNVERIFIABLE`, each with per-field explanations.
8. **Correction suggestions.** Every `MISMATCH` with an authoritative value
   yields an exact correction; fields without source values are marked for
   manual confirmation. Corrections can be previewed, applied to the draft,
   or copied — never auto-published.
9. **Persistent history.** The result, field evidence, source reference, and
   request ID are stored in SQLite and remain browsable (search, filter,
   pagination, detail replay) across restarts.

## 7. ALL IMPLEMENTED FEATURES

- **Dashboard.** Real statistics (total attempts, verified, review-required,
  unverifiable) from persistent records — genuine zeros render as `0`, load
  failures render as errors, never as `0`. Recent activity, open
  discrepancies needing attention, and a live integration summary.
- **Event retrieval.** Live calendar search (query + date range + pagination)
  and direct lookup by event ID — the same exact-get operation verification
  uses. Handles not-found, cancelled, private, and missing-field cases with
  explicit messaging.
- **Verification workspace.** Three-step flow: load the official record →
  enter the draft → submit. Inline validation, double-submit prevention,
  draft preservation across failures, and clear error recovery.
- **Mismatch detection.** Side-by-side official/draft comparison with
  Critical markers, state badges (icon + text, never color-only),
  human-readable explanations, and source-derived corrections.
- **Correction assistant.** Deterministic fixes from the official record
  only: corrected preview, apply-to-draft, copy-to-clipboard with permission
  fallback, and a "needs manual confirmation" list for unverifiable fields.
- **History.** Durable audit trail with status filter, text search, date
  range, pagination, sorting, and full detail replay of any record.
- **Integration status.** Five independently reported conditions: backend
  reachability, Swytchcode CLI presence/version, runtime health, provider
  authorization (`connected` / `authorization required` / `not yet
  verified`), and last successful/failed fetch timestamps — no tokens shown.
- **Audit records.** Every verification persists its id, status, field
  results, source reference, timestamps, and request ID. Nothing sensitive
  (tokens, passwords, auth headers) is ever stored or logged.

## 8. SWYTCHCODE EXPLORATION AND CLI COMMANDS

**Attribution.** Entries marked *agent-observed* were executed in this
environment with captured output (see `docs/friction-diary.md`,
`docs/phase1-swytchcode-discovery.md`, and the smoke test). Entries marked
*user-terminal* were performed on the user's unrestricted Windows machine and
are recorded from their reports. The two are never mixed.

**Installation.** The official Windows methods are
`irm https://cli.swytchcode.com/install.ps1 | iex` or
`npm install -g swytchcode`. The global install failed in the sandbox
(`EPERM` on the npm cache — outside the workspace), so the documented npm
package was installed workspace-locally at `tools/cli` with its own
lockfile and a workspace-local npm cache. On the user's machine either the
global install or the repo-local copy
(`.\tools\cli\node_modules\.bin\swytchcode.cmd`) works; the commands below
are identical apart from that path. `swy` is the CLI's short alias.

**Initialization.** `swytchcode init --non-interactive --editor none --mode
production` (exit 0). The bare `--non-interactive` flag alone failed twice
first (`error: init requires --editor…`, then `error: init requires
--mode…`); reading `init --help` revealed both required flags. `--mode
production` means "for live execution" per the projects doc. Generated
artifacts (inspected): `.swytchcode/tooling.json`
(`{editor, integrations:{}, mode:"production", tools:{}, version:"2.25.5"}`),
`.swytchcode/tooling.json.lock`, and empty `.swytchcode/integrations/`.

| Command | Purpose | Observed result |
|---|---|---|
| `swy --version` | Prove the binary resolves and report its version | *Agent-observed:* `swytchcode version 2.25.5`, exit 0 |
| `swy doctor` | Project health checks | *Agent-observed:* all checks passed, exit 0 |
| `swy login` | Device-flow login; session in `~/.swytchcode/auth.json` | *User-terminal:* required before provider auth |
| `swy auth status` | Show provider authorization state | *User-terminal:* used to confirm Google auth state |
| `swy auth connect google_calendar` | Browser OAuth connecting the Google provider | *User-terminal:* completed; hit the OAuth unverified-app warning (see §11) |
| `swy search calendar` | Registry search for calendar providers | *Agent-observed:* failed — `dial tcp [2606:…]:443: bind: … forbidden` (CLI dials direct, ignores the sandbox proxy) |
| `swy get google_calendar` | Fetch the provider's Wrekenfile bundle locally | *User-terminal:* downloaded the bundle (agent-side: blocked, same dial failure) |
| `swy discover "list events on my calendar"` | Natural-language tool discovery | *User-terminal:* an unsupported discover flag variant failed; the corrected discovery workflow succeeded |
| `swy list methods` | List methods available in the local bundle | *User-terminal:* used during exploration |
| `swy list integrations` | List installed integrations | *User-terminal:* used during exploration |
| `swy info calendar.event.get` | Show the list tool's schema | *User-terminal:* confirmed LIST inputs/outputs |
| `swy info calendar.event.get1` | Show the single-get tool's schema | *User-terminal:* confirmed `{calendarId, eventId}` inputs |
| `swy add calendar.event.get` | Enable the list method (project setup uses `swytchcode add <canonical_id>`) | *User-terminal:* resolved into `tooling.json.tools` |
| `swy add calendar.event.get1` | Enable the single-get method | *User-terminal:* resolved into `tooling.json.tools` |
| `swy exec calendar.event.get --json` | Execute the list call (JSON stdin params, `--json` stdout) | *User-terminal:* HTTP 200, valid events collection (see §10). *Agent-observed:* only offline envelopes (exit-2 classified error; `--demo` payload refused as `SWYTCHCODE_SIMULATED_DATA`) |

**Unsupported `--project` flag discovery (user-terminal, reported).** An
initialization/workflow attempt using a `--project` flag was rejected by the
CLI as unsupported. The corrected workflow drops the flag and runs project
commands from the repo root (or via the repo-local binary path), with
`SWYTCHCODE_PROJECT_DIR` defaulting to the working directory — which is how
the backend and smoke test locate `.swytchcode/tooling.json` today.

**Local vs global paths.** Agent-side runs used the repo-local binary
(`tools/cli/node_modules/.bin/swytchcode`); the smoke test resolves
`SWYTCHCODE_BIN` → repo-local copy → `PATH`. User-side runs may use any of
these; behavior is identical.

## 9. WREKENFILE AND INTEGRATION EXPLORATION

**Terminology (verified).** "Wrekenfile" is current, not legacy:
`swytchcode get --help` reads "Fetch Wrekenfile bundles for a provider."
There is no file literally named `Wrekenfile`; the on-disk equivalent is
`.swytchcode/integrations/{project}/{library}/{version}/wrekenfile.yaml`
(Wrekenfile spec with a `METHODS` section) plus `methods.json`. `swy get`
populates this bundle but never touches `tooling.json`; `swy add
<canonical_id>` resolves a method from the local Wrekenfile into
`tooling.json.tools` — the trust boundary, since **only listed tools can
execute**.

**Present in this workspace** (inspected on disk):
`.swytchcode/integrations/Google Calendar/calendar/v3/wrekenfile.yaml` and
`methods.json`, plus the Stripe demo bundle files. `tooling.json` enables
exactly one integration — `Google Calendar.calendar@v3`, mode
`production` — and exactly two tools:

- `calendar.event.get` — "Returns events on the specified calendar."
  `GET /calendars/{calendarId}/events` on base
  `https://www.googleapis.com/calendar/v3`, bearer-token auth. Inputs:
  `calendarId` (path, required) + query params (`q`, `timeMin`, `timeMax`,
  `maxResults` default 250, `pageToken`, `singleEvents`, `orderBy`
  startTime/updated, `timeZone`, …). Returns `STRUCT(Events)`, HTTP 200 —
  the `{ kind, items: [...], timeZone, … }` collection.
- `calendar.event.get1` — "Returns an event based on its Google Calendar
  ID." `GET /calendars/{calendarId}/events/{eventId}`. Inputs: `calendarId`
  + `eventId` (both path, both required). Returns `STRUCT(Event)`, HTTP
  200 — one event resource. (For iCalendar IDs, the method's own docs point
  back to list + `iCalUID` — EventProof instead uses exact Google IDs.)

**Why Google Calendar.** The registry catalog (373 providers, fetched live)
confirms Google Calendar as a first-class supported provider (library
`calendar`, v3); campus organizers already keep authoritative event data
there; its read API cleanly separates list from single-get. No alternative
integration was needed, so none was selected.

**Why these two read-only operations.** The bundle also contains write
methods (`calendar.event.create/update/delete`, `calendar.calendar.create`,
…), which are **never enabled** — only the two GET tools are listed in
`tooling.json`, so by construction EventProof cannot create, modify,
delete, publish, or send anything. Listing powers search and browsing;
single-get powers exact, window-free retrieval for verification.

## 10. ACTUAL API EXECUTION EVIDENCE

All live results below were produced on the user's unrestricted Windows
machine (direct network + authenticated provider) and are recorded from
their reports. Agent-side live execution remains impossible (the sandbox
blocks outbound dialing and interactive OAuth), so the agent claims no
live run of its own. Email addresses, private event IDs, and calendar
contents are redacted throughout (`<redacted>`).

- **Provider:** Google Calendar (library `calendar`, v3).
- **Authentication:** OAuth2 via Swytchcode managed auth (`swy login` +
  `swy auth connect google_calendar`); tokens stay in Swytchcode's store.
- **Operation:** `calendar.event.get`.
- **Endpoint:** `GET /calendars/{calendarId}/events`
  (`https://www.googleapis.com/calendar/v3`, per the Wrekenfile).
- **Parameters used:** `calendarId=primary`, `maxResults`, `singleEvents`,
  `orderBy=startTime`, `timeMin`, `timeMax` (all JSON stdin params; the
  backend sends `calendarId`, `timeMin`, `timeMax`, `q`, `maxResults`,
  `pageToken`, `singleEvents=true`, `orderBy=startTime`).
- **Execution path:** Swytchcode CLI (`swytchcode exec calendar.event.get
  --json`), live production mode — never a direct Google HTTP call from the
  app, never a fixture.
- **Result:** HTTP status **200** with a valid events collection:
  `{ kind: "calendar#events", etag, summary, timeZone, items: [...] }`.
  The first production run returned an **empty `items` array** (no events
  on the calendar) — a successful execution, explicitly asserted as such
  by the provider, its unit tests, and the smoke gate.
- **Response structure (shape):** top-level collection fields plus `items`
  entries carrying `id`, `status`, `summary`, `description`, `location`,
  `start`/`end` (`dateTime` + `timeZone`, or all-day `date`), `updated`,
  `htmlLink`, attendees, and conference data. EventProof normalizes `id →
  sourceEventId`, `summary → title`, `location → venue`, and the
  start/end/time-zone fields into `OfficialEvent`.
- **Subsequent live smoke test (user terminal):** re-running
  `$env:SWYTCHCODE_SMOKE_LIVE=1; node scripts/swytchcode-smoke.js` passed
  the `live-exec` gate with **`items=1`** — exit 0, live (non-demo) shape,
  status ok, items array present.
- **Final smoke-test result (user terminal): 6 passed, 0 failed,
  0 blocked.**

**`calendar.event.get1`** retrieves one exact event:
`GET /calendars/{calendarId}/events/{eventId}` with required path params
`calendarId` + `eventId`, returning a single `STRUCT(Event)`, HTTP 200
(404 when the event does not exist, which the provider maps to "not
found"). Both tools are enabled in the project's `tooling.json`.

## 11. TROUBLESHOOTING AND FRICTION

Chronological, condensed from `docs/friction-diary.md` (agent-observed,
items 1–6) and user-terminal reports (items 7–11). No error below is
invented; user-reported items are labeled as such.

**1. Global npm installation permission error** *(agent-observed).*
Attempted `npm install -g swytchcode`; expected a global binary; got
`EPERM … open …\_cacache\tmp\…` (sandbox denies writes outside the
workspace; escalation denied). Resolved with a workspace-local install in
`tools/cli` plus a workspace-local npm cache. Status: resolved; repo-local
binary works everywhere.

**2. Swytchcode initialization flags** *(agent-observed).* Bare
`init --non-interactive` failed (`error: init requires --editor…`), then
with `--editor none` failed (`error: init requires --mode…`). Reading
`init --help` gave the working form
`init --non-interactive --editor none --mode production` (exit 0).
Status: resolved; artifacts inspected.

**3. Provider bundle fetching / registry dial failure** *(agent-observed).*
`swy search calendar` failed with
`dial tcp [2606:…]:443: bind: … forbidden` — the native binary dials
direct and ignores the sandbox proxy (binary strings show no proxy
support). A localhost relay workaround also failed (`EACCES` on
`127.0.0.1` — listening sockets blocked too). Registry commands and live
exec became documented user-side steps; discovery continued via docs, the
SDK tarball, and the harness-fetched catalog. Status: worked around by
design; user-side execution succeeded later.

**4. Incorrect operation ID** *(agent-observed, then fixed).* Discovery
from the published example tooling used `calendar.calendar.events.get`;
the user's live environment showed the correct id is `calendar.event.get`
(with `calendar.event.get1` for single-get). All active references
(backend default, `.env.example`, smoke test, tests, living docs) were
migrated; the user's `.env` and `tooling.json` already carried the correct
ids. Status: fixed and green.

**5. Exact-event lookup failure from date-window scanning**
*(agent-observed symptom: "Official event not found").* `getEventById` was
a time-windowed list scan (Load record: now−30d…now+365d; verification:
draft date ±3d, max 3×250 pages). Existing events outside the window —
notably drafts with badly wrong dates — missed the scan and wrongly
reported not-found. Fixed by switching single-event lookup to exact
`calendar.event.get1` retrieval with `{calendarId, eventId}` and removing
the window logic; listing still uses `calendar.event.get`. Regression
tests added for exact retrieval and id-faithful event selection. Status:
fixed and green.

**6. Smoke-test failure from stale operation ID** *(agent-observed).*
After the id migration, the smoke live gate still referenced the obsolete
id. Fixed in the same change; the gate now asserts the live shape
explicitly (exit 0, non-demo, status ok, `items` absent-or-array, item
count reported). Status: fixed; offline part 5 PASS, live gate BLOCKED in
sandbox by design.

**7. Unsupported `--project` flag** *(user-terminal, reported).* A
`--project` flag attempt was rejected as unsupported; corrected by running
project commands from the repo root with `SWYTCHCODE_PROJECT_DIR`
defaulting to the working directory. Status: resolved.

**8. Unsupported discover flag variant** *(user-terminal, reported).* A
`discover` invocation with an unsupported flag failed; the corrected
discovery workflow (`swy discover "…"`, `list methods`, `list
integrations`, `info`) succeeded. Status: resolved.

**9. Google OAuth unverified-app warning** *(user-terminal, reported).*
`swy auth connect google_calendar` surfaced Google's unverified-app
consent warning during browser OAuth; the user acknowledged it and
completed authorization. No credentials were ever handled in chat or
stored in the repo. Status: resolved; provider `connected`.

**10. Initial provider bundle fetching error** *(user-terminal,
reported).* The first `swy get google_calendar` attempt errored before
the bundle downloaded; retrying from the unrestricted terminal with login
completed succeeded, producing `wrekenfile.yaml` + `methods.json`
(inspected on disk). Status: resolved.

**11. Final successful live execution** *(user-terminal, reported).*
`swy exec calendar.event.get --json` → HTTP 200, valid collection, first
`items: []` then `items=1`; smoke test 6/6. Status: verified live.

(Also recorded in the diary but unrelated to Swytchcode: a curl/schannel
TLS quirk, docs-vs-SDK gaps fixed in the adapter, a missing `zod` peer
fixed by pinning, sandboxed `listen()` behavior, PowerShell test-runner
papercuts, the jsdom pin, and the audit-durability contract change.)

## 12. TESTING AND VALIDATION

Latest verified results (all executed, none assumed):

- **Backend:** `npm test` → **137/137 pass** (30 suites) — unit, integration,
  and contract tests over normalization, engine, services, provider, HTTP
  routes, SQLite, and error handling. Includes the empty-`items` test and
  the exact-get regression tests.
- **Frontend:** `npm run test` (Vitest + Testing Library + User Event,
  jsdom) → **48/48 pass** (4 files) — components, API client (all error
  classes), validation, and mocked user journeys asserting exact API
  payloads, including id-faithful event selection.
- **Syntax gate:** `npm run check` → 58 files, 0 failed.
- **Production build:** `npm run build` (Vite) → success.
- **Persistent history testing:** records verified to survive database
  close + reopen and serve correctly through the API; storage failure
  yields loud 503, never silent loss.
- **Real browser verification:** 22 screenshots plus scripted DOM
  interactions in headless Chrome covering every page (demo + live modes),
  form fill, demo verification with exact badge counts (Mismatch×2,
  Match×4, Critical×4), copy-failure toast, mobile menu, and responsive
  layouts at 1440/768/500px with zero console errors and zero horizontal
  overflow.

Functional behaviors proven by tests:

- **Correct announcement → VERIFIED.** Matching draft against the official
  record yields `VERIFIED` with full field evidence (JOURNEY 2).
- **Wrong date → REVIEW_REQUIRED.** A differing `eventDate` yields
  `REVIEW_REQUIRED` with a date `MISMATCH` and the official date as the
  correction (JOURNEY 3).
- **Wrong venue → REVIEW_REQUIRED.** A differing venue yields
  `REVIEW_REQUIRED` with a venue `MISMATCH` (JOURNEY 4/5).
- **History persistence.** Saved verifications are listed, filtered,
  paginated, and replayed verbatim from durable storage (JOURNEY 8 + SQLite
  tests + restart probe).

## 13. SECURITY AND RELIABILITY

- **OAuth.** Google authorization is completed in the browser via Swytchcode
  (`swy login` + `swy auth connect`); tokens live only in Swytchcode's own
  store. The app never requests, receives, or stores credentials.
- **Read-only integration.** Only the two GET tools are enabled in
  `tooling.json`; write methods exist in the bundle but can never execute.
  Minimum scope by construction.
- **Secret protection.** The logger redacts credential-like keys to
  `[REDACTED]` and scrubs `user:password@` from URLs; `.env` is gitignored
  and carries no secrets; API responses never include stacks or tokens;
  the browser never sees provider credentials.
- **Validation.** Request size limits, strict field/type/length checks,
  IANA time-zone and http(s)-URL validation, and 400/422 rejection before
  any fetch or comparison. User input never becomes a shell argument
  (tool ids come from config; values travel via stdin).
- **Error handling.** A stable taxonomy (config, auth, Swytchcode, event
  source, validation, verification, infrastructure) maps to documented
  HTTP statuses; unknown failures log with a request ID and return a
  generic 500.
- **Timeouts and retries.** 15s per Swytchcode call, 60s per HTTP request,
  bounded retries with backoff + jitter for transient failures only —
  auth, policy, validation, and not-found errors never retry.
- **Audit persistence.** Transaction-safe SQLite inserts; a verification
  without its stored record is refused (503) rather than half-recorded.
- **Never publishes.** This is architectural, not a promise: no code path
  calls any write operation, and the enabled toolset makes publishing
  impossible.

## 14. SWYTCHCODE EXPLANATION

*(196 words)* Swytchcode is an integration platform that turns third-party
APIs into typed, policy-guarded tools a developer can call from code or the
command line. The problem it solves is integration toil: normally every
provider means new OAuth flows, SDKs, HTTP plumbing, pagination quirks, and
error shapes. Swytchcode replaces that with one workflow — connect a
provider once, enable only the methods you need, then execute them through
a single CLI or runtime with managed authentication, schemas, and
guardrails. EventProof uses Swytchcode as its only path to Google Calendar.
The backend never holds OAuth tokens and never calls Google directly: it
invokes the read-only calendar.event.get and calendar.event.get1 tools
through the Swytchcode runtime, which injects the stored credentials,
performs the HTTPS request, and returns structured JSON the verification
engine can trust. A practical example from this project: listing events is
a single call — swytchcode exec calendar.event.get with calendarId=primary
— returning HTTP 200 and an items array that EventProof normalizes into
authoritative records. Because tooling.json acts as a trust boundary, only
the two read-only calendar tools can execute; write methods exist in the
bundle but are never enabled, so the integration cannot create, edit, or
delete anything by construction.

## 15. LIMITATIONS AND FUTURE SCOPE

**Implemented (verified):** deterministic verification engine; Express API
(8 endpoints); Swytchcode read-only integration (list + exact get) with
genuine live execution; React console (dashboard, events, verify, history,
integrations, settings, demo mode); durable SQLite audit history;
137 backend + 48 frontend tests; production build; real-browser QA pass.

**Known limitations (honest):** live execution requires the user's OAuth +
unrestricted terminal (agent sandbox cannot dial out or complete browser
OAuth); the dev backend binds localhost with no production auth, so it must
not be publicly exposed as-is; local SQLite suits single-instance use (a
managed database is needed for multi-instance production); verification
quality follows the calendar — if the official record itself is wrong or
missing a venue/URL, the field reports `MISMATCH`/`UNVERIFIABLE` rather
than guessing; one calendar per request (`calendarId` selectable, no
cross-calendar merge).

**Proposed future improvements (not implemented):** production
authentication/authorization + hosted deployment guide; managed database
backend behind the existing repository port; multi-calendar comparison;
recurring-instance edge-case UX; notification hooks (e.g. "announcement
verified" receipts); organizer workspaces; measured deployment study with
real impact statistics. None of these are claimed as present.
