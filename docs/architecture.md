# EventProof Architecture (Phase 1)

## 1. Layering

```text
HTTP layer (interfaces/http)        Express app, routes, controllers, middleware
        │  plain validated DTOs
        ▼
Application layer (application)     Services orchestrate; ports define boundaries
        │  EventSourceProvider / AuditRepository ports
        ▼
Domain layer (domain)               Models, normalization, verification engine
        ▲  normalized OfficialEvent / AnnouncementDraft
        │
Infrastructure layer (infrastructure)
   swytchcode.client ──► @swytchcode/runtime ──► swytchcode CLI binary
   calendar.provider ──► Google Calendar read method
   repositories/audit ──► in-memory record store (dev)
```

Dependency rule: **domain and application never import infrastructure.**
The Swytchcode SDK is referenced only by `swytchcode.client.js`; swapping the
provider (another source, another transport) means implementing the
`EventSourceProvider` port — the engine, services, and routes stay untouched.
Shared kernel (`shared/errors`, `shared/logging`) and `config` are neutral and
imported everywhere.

## 2. Request lifecycle

`POST /api/v1/verifications {eventId, calendarId?, announcement}`:

1. Middleware stamps a server-generated request id, applies security headers,
   CORS, JSON parsing (256 KB cap), and rate limiting.
2. Controller forwards to `VerifyAnnouncementService` (no validation in the
   controller — one validation site).
3. Service validates `eventId`/`calendarId`, then the draft via
   `validateAnnouncementDraft` (400 structural / 422 semantic; throws before
   any fetch — INVARIANT 8).
4. Service builds a UTC window around `draft.eventDate` (±
   `VERIFY_SEARCH_WINDOW_DAYS`) and calls `provider.getEventById`.
5. Provider executes `calendar.event.get1` through the client
   (timeout, demo-guard, retries, error mapping) with the exact
   `{ calendarId, eventId }`, and normalizes the single resource to
   `OfficialEvent` (no window, no scan — listing still uses
   `calendar.event.get`).
6. Service rejects unknown (`EVENT_NOT_FOUND` 404) and cancelled
   (`EVENT_CANCELLED` 409) events — neither can ever verify.
7. `verify(official, draft)` runs the pure engine → `{status, fieldResults,
   summary}`; `buildVerificationResult` stamps id + timestamps.
8. The record is audit-saved (best-effort; failure is logged, result still
   returned) and answered with **201 + Location**.

`GET /api/v1/events*` follows steps 1–2 + `FetchEventsService` (range/limit
validation, provider list/get). `GET /api/v1/verifications/:id` replays the
audit record verbatim. `GET /health` answers from local state only.

## 3. Verification lifecycle

Field comparisons (all pure, deterministic): title (case-insensitive),
eventDate, startTime, endTime, timeZone (ICU-canonicalized), venue (aliases),
registrationUrl (always UNVERIFIABLE — Google exposes no authoritative value).

Status precedence: critical MISMATCH/MISSING_IN_DRAFT → `REVIEW_REQUIRED` ·
critical MISSING_IN_SOURCE/UNVERIFIABLE → `UNVERIFIABLE` · non-critical
MISMATCH → `REVIEW_REQUIRED` · else `VERIFIED`. Cancelled/unknown inputs throw
instead of returning a status (fail-closed).

## 4. External API flow

```text
CalendarProvider ──params/body──► SwytchcodeClient ──exec(tool, stdin)──► CLI kernel
        │ validates response shape         │ timeout · demo-guard · retry · map
        ▼                                  ▼
OfficialEvent[]                    { data, meta } or domain error
```

Retries: only transient classes (network/timeout/429/5xx), ≤
`SWYTCHCODE_MAX_ATTEMPTS` (default 3) with exponential backoff + jitter.
Auth/policy/not-found/validation never retry. Provider HTTP errors arriving
inside exit-0 JSON (`status_code`) map to the same domain codes.

## 5. Error propagation

Every expected failure is an `ApplicationError` carrying `{code, message,
details?}`; `cause` stays server-side. The error middleware is the single
translator to `{success:false, error:{code,message,requestId}}` + status.
Unexpected exceptions log with request id (stack outside production only) and
answer generic 500. Process-level `uncaughtException`/`unhandledRejection`
exit(1) after logging; SIGINT/SIGTERM drain then force-exit after 10 s.

## 6. Audit flow

Verification results (full field evidence + `eventReference{source,
sourceEventId, fetchedAt, sourceUpdatedAt}` + request id) are deep-cloned into
the bounded in-memory store (FIFO at `AUDIT_MAX_RECORDS`, default 500).
Reads clone again, so stored evidence is immutable and requests cannot leak
into each other. **Records do not survive restarts** — the documented Phase 1
limitation; persistence means implementing the same port.

## 7. Phase 2 additions

- **Persistence**: `SQLiteAuditRepository` + `SQLiteFetchLog` on one
  `node:sqlite` handle (`data/eventproof.db`), opened/migrated/closed by the
  composition root. The in-memory repo remains for unit tests only and now
  implements the full port (`list`/`stats`) for conformance testing.
- **Reads**: `HistoryService` (validated list/stats) and `IntegrationService`
  (guarded probes) with `GET /verifications`, `GET /verifications/stats`,
  `GET /integrations/status`.
- **Frontend** (`web/`): React console calling only `/api/v1` (same-origin
  via Vite proxy). No engine duplication: results render backend
  `fieldResults` verbatim; early form validation mirrors (never replaces)
  server validation.
- **Contract change**: audit-save failure → `AUDIT_STORAGE_UNAVAILABLE`
  (503); everything else backwards-compatible.

## 8. Extension points (future)

- Managed database behind the same port for multi-instance production.
- New event source (implement the port; engine untouched).
- New compared fields (add comparator + criticality entry; summary/status
  logic is data-driven).
- Advisory similarity scoring (must stay advisory — never flip a status).
- AuthN/Z + wider bind (config + middleware seams already exist).
