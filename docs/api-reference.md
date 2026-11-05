# EventProof API Reference (Phase 1)

Base URL: `http://127.0.0.1:3000/api/v1` (host/port configurable).
No authentication in Phase 1 — the server binds localhost by default.

## Envelopes

Success: `{ "success": true, "data": {…}, "meta": { "requestId": "…" } }`
Error: `{ "success": false, "error": { "code": "…", "message": "…", "requestId": "…", "details?": {…} } }`

Every response carries `X-Request-Id`. Error `details` are safe hints only
(field names, retry hints) — never secrets or stacks.

## `GET /health`

Liveness probe. Performs **no** upstream calls.

- 200 `data`: `{ status:"ok", service, version, uptimeSeconds, swytchcode:{ configured } }`
- `configured` = a tool id is set in config (presence, not connectivity).

## `GET /events`

Lists authoritative events on a calendar.

Query params (all optional): `calendarId` (default `primary`; no whitespace) ·
`timeMin`/`timeMax` (ISO-8601; `timeMin ≤ timeMax`; range ≤ 366 days) ·
`query` (≤256 chars, provider free-text search) · `limit` (1–250, default 50) ·
`pageToken` (opaque).

- 200 `data`: `{ events: [OfficialEvent…], nextPageToken: string|null, calendarId }`
- 400 `INVALID_REQUEST` (bad limit/token/calendarId), 422 `INVALID_DATE`
  (bad instant, inverted or excessive range)
- 401/403/429/502/503/504 on upstream auth/rate/failure classes.

`OfficialEvent`: `{ id, source, sourceEventId, title|null, description|null
(≤2000 chars), startDate, endDate|null, startTime|null, endTime|null,
startInstantMs/endInstantMs|null, timeZone|null, timeZoneSource
("event"|"calendar"|"utc-fallback"|null), allDay, location|null, status|null,
sourceUpdatedAt|null, fetchedAt, sourceReference:{calendarId, htmlLink|null} }`

## `GET /events/:eventId`

Fetches one event by exact id (searches a bounded upcoming window; recurring
instances match by full instance id).

- 200 `data`: `{ event }` — cancelled events are returned with
  `status:"cancelled"` (informational read; only verification rejects them).
- 400 `INVALID_EVENT_ID`, 404 `EVENT_NOT_FOUND`.

## `POST /verifications`

Verifies an announcement draft against the freshly fetched official record.

Request: `{ "eventId": "…", "calendarId?": "…", "announcement": {
"title": "…(required, ≤300)", "eventDate": "YYYY-MM-DD (required, real date)",
"startTime?": "HH:MM|h:MM AM/PM", "endTime?": "same (≠ start; overnight ok)",
"timeZone?": "IANA", "venue?": "…(≤500)", "registrationUrl?": "http(s) URL
(≤2048, no credentials)", "description?": "…(≤5000, accepted, not compared)"
} }`

- **201** + `Location: /api/v1/verifications/:id`, `data`:
  `{ verificationId, status, eventReference:{source, sourceEventId,
  fetchedAt, sourceUpdatedAt}, summary:{totalFields, matchingFields,
  mismatchingFields, unverifiableFields}, fieldResults:[
  {field, official, draft, state, explanation, correction, critical}…],
  verifiedAt }`
- `status`: `VERIFIED` · `REVIEW_REQUIRED` · `UNVERIFIABLE`
  (`INVALID_INPUT` exists at engine level; over HTTP invalid drafts are 400/422).
- `state` per field: `MATCH` · `MISMATCH` · `MISSING_IN_DRAFT` ·
  `MISSING_IN_SOURCE` · `UNVERIFIABLE` · `NOT_APPLICABLE`.
- 400 `INVALID_EVENT_ID`/`INVALID_REQUEST`/`MISSING_REQUIRED_FIELD`,
  404 `EVENT_NOT_FOUND`, 409 `EVENT_CANCELLED`, 413 `PAYLOAD_TOO_LARGE`,
  422 `INVALID_DATE`/`INVALID_TIME`/`INVALID_TIMEZONE`/
  `INVALID_REGISTRATION_URL`, 429/502/503/504 upstream classes.

## `GET /verifications/:verificationId`

Replays the stored audit record verbatim.

- 200 `data`: the record (same contract as POST `data`, plus `requestId`).
- 404 `VERIFICATION_NOT_FOUND`. History is never fabricated: unknown ids 404.

## `GET /verifications`

Paginated audit history (durable). Query params: `status` (one of
`VERIFIED|REVIEW_REQUIRED|UNVERIFIABLE`), `q` (≤256 chars; matches
verification ID, source event ID, event title), `from`/`to` (ISO-8601),
`page` (≥1, default 1), `pageSize` (1–100, default 20), `sort`
(`asc|desc` on verification time, default `desc`).

- 200 `data`: `{ records: [verification…], page, pageSize, total, totalPages }`
- 400 bad page/pageSize/status/sort/q, 422 bad from/to range.

## `GET /verifications/stats`

Genuine aggregates for the dashboard. No params.

- 200 `data`: `{ total, verified, reviewRequired, unverifiable }`
- (Register before `/verifications/:verificationId`; Express matches in order.)

## `GET /integrations/status`

Safe diagnostics (no tokens, paths, or env values). Never throws for probe
failures — unknowns are reported as `unknown`.

- 200 `data`: `{ backend: "online", swytchcode: { cliAvailable,
  cliVersion|null, runtimeLoads, method }, provider: { auth:
  "connected"|"not_connected"|"unknown", authCheckedAt|null, lastSuccessAt|null,
  lastFailureAt|null, lastErrorCategory|null } }`

## Status-code map

200 ok · 201 verification created · 400 malformed · 404 unknown ·
409 cancelled/approval-wait · 413 oversized · 422 semantically invalid ·
429 rate-limited · 500 server/config · 502 bad upstream · 503 upstream down /
audit store unavailable · 504 upstream timeout.
