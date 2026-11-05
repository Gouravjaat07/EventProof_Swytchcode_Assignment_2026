# EventProof Security (Phase 1)

## Secret management

- No credentials live in the repo: `.env` is gitignored, `.env.example`
  contains only non-secret settings, and provider OAuth tokens stay in
  Swytchcode's own store (`~/.swytchcode`), which the backend never reads as
  values (the CLI injects them server-side at exec time).
- Startup validates config without ever printing values.
- Logs and audit records carry no tokens: the logger redacts credential-like
  keys at any depth plus URL-embedded `user:password@`, and the client logs
  only `{tool, attempts, durationMs}` — never params, bodies, or payloads.

## Input validation

- Single validation site per concern (services + domain models); controllers
  add none, so no path bypasses checks. Types are never coerced; lengths are
  capped (title 300, venue 500, URL 2048, description 5000, body 256 KB);
  dates/times/zones/URLs are strictly parsed (400 vs 422 semantics).
- `eventId`/`calendarId`/`pageToken` reject whitespace/control content and
  enforce length caps.

## Injection protection

- User input never becomes a shell argument: tool ids come from server config
  (regex-validated), and all values travel to the CLI via JSON stdin through
  the SDK's Windows-safe spawner (explicit `cmd.exe` quoting, no `shell:true`
  in app code). No `eval`, no dynamic code execution, no SQL/NoSQL surface.
- Prototype pollution: all parsed bodies/params flow through plain-object
  checks and frozen outputs; `__proto__` keys from JSON never reach
  assignment targets (validators read known fields only).
- Header injection: response headers are framework-set constants; request ids
  are server-generated UUIDs (incoming `X-Request-Id` is ignored).

## HTTP hardening

- `X-Powered-By` removed; `nosniff`, `DENY` framing, `no-referrer`,
  `default-src 'none'` CSP, `same-origin` CORP; HSTS in production.
- CORS: exact-match allowlist, empty by default (same-origin only);
  unknown-origin preflights get a bare 204 (no route leak).
- Fixed-window per-IP rate limiting (default 60/min) with `429` +
  `Retry-After`; `trust proxy` stays disabled so buckets key on the real peer.
- Binds `127.0.0.1` by default; requests bounded at 60 s; graceful shutdown.

## Permissions and exposure

- Only the read-only calendar method is ever executed; no write/publish/send
  tool is enabled in code or config. Phase 1 has no user auth — acceptable
  only because of the localhost bind (documented; Phase 2 must add an auth
  story before any wider exposure).

## Frontend additions (Phase 2)

- Browser calls only `/api/v1` (same-origin via dev proxy; optional override
  setting validated as http(s)). No provider credentials in browser code,
  storage, or URLs; only a non-sensitive API-base string and demo flag live
  in `localStorage`.
- No `dangerouslySetInnerHTML`; untrusted event text renders as text; long
  values wrap (`.ep-break`) instead of breaking layout.
- Registration URLs are validated, displayed as text, never auto-fetched or
  auto-opened.

## Known limitations (accepted, not hidden)

- Audit store is a local SQLite file (durable single-instance, not
  multi-instance — production needs a managed database).
- Rate limiter is per-process (no shared state across instances).
- Logger redaction is key/pattern-based: a secret stored under an
  innocent-looking key would not be caught — callers must not log raw
  auth material (reviewed: none do).
- `Retry-After` from providers is not honored (the CLI JSON surface does not
  expose it); backoff is our own bounded exponential schedule.
