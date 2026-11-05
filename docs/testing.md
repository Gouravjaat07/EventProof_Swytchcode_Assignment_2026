# EventProof Testing (Phase 1)

## Commands

| Command | What it runs |
|---|---|
| `npm run check` | `node --check` over all first-party files (syntax gate) |
| `npm test` | Full suite: `node --test` over `tests/unit/**` + `tests/integration` |
| `node scripts/swytchcode-smoke.js` | Real-CLI smoke (offline checks + gated live exec) |

No test framework dependency: stock `node:test` + `node:assert/strict`, plus
`light-my-request` (dev-only) to inject HTTP without opening sockets (the
sandbox blocks `listen`; the app factory never binds, so this is faithful).

## Results (2026-11-05, this machine)

- `npm run check`: 58 files, 0 failed.
- `npm test`: **135 tests, 135 pass, 0 fail** (all 113 Phase 1 tests preserved;
  22 added: SQLite conformance + durability, history/integration services,
  CLI probe, new endpoints, audit-503 contract).
- Smoke: **5 passed, 0 failed, 1 blocked** (live exec — needs unrestricted
  network + `swy login` + `swy auth connect`; run with
  `SWYTCHCODE_SMOKE_LIVE=1` from a normal terminal).

Frontend (`cd web`: `npm test` / `npm run build`):

- `npm test` (Vitest + jsdom): **46 tests, 46 pass, 0 fail** — API client
  (envelopes, all HTTP classes, timeout/abort, overrides), formatters, draft
  validation mirror, components (badges, toasts, stale-guard), and 8 mocked
  user journeys (dashboard, verify, mismatch+copy, venue, missing-source,
  failure-preserves-draft, history).
- `npm run build`: PASS (route-split bundles).
- Not run here (environment-blocked, documented in
  `docs/phase2-validation-report.md`): dev-server serving, real-browser
  rendering/screenshots, Playwright E2E.

## Categories and what they pin

- **Text** (`tests/unit/domain/text.test.js`): whitespace/control/unicode
  handling, NFKC, case-insensitive titles, venue punctuation + aliases,
  `Room 1.5 ≠ Room 15`, unknown aliases unresolved.
- **Date/time** (`datetime.test.js`): strict dates, leap years, 12/24-hour
  edges (noon/midnight), invalid zones, ICU canonicalization, DST rendering,
  midnight-as-`00:xx`, search windows.
- **Draft validation** (`announcement.test.js`): required/optional fields, no
  type coercion, 422 semantics, overnight accepted / zero-length rejected,
  strict URL rules (scheme, host, no embedded creds), length caps.
- **Event model** (`event-model.test.js`): timed/all-day/floating/offset
  parsing, visible UTC fallback, exclusive all-day end, cancellation
  preserved, structural corruption → `SWYTCHCODE_INVALID_RESPONSE`.
- **Engine** (`engine.test.js`): VERIFIED path, every critical/non-critical
  mismatch, missing-source/draft gaps, all-day rules, cancelled/missing
  fail-closed throws, UTC-fallback draft-frame comparison, status precedence,
  registration never MATCH, evidence fields (originals + corrections).
- **Services** (`tests/unit/application`): validation-before-fetch
  (INVARIANT 8, provider-call counting), 404/409 mapping, audit best-effort.
- **Client** (`tests/unit/infrastructure/client.test.js`, stubbed executor):
  envelope extraction, param coercion, demo-guard refusal without retry,
  exit-code + classified-error mapping, timeout/ENOENT, bounded backoff
  ranges, attempt cap (no indefinite retries).
- **Provider** (`provider.test.js`, stubbed client): param passing, omitted
  `items` = empty, partial-vs-total parse failure, list-404 → config error,
  exact-id match across ≤3 pages, cancelled passthrough.
- **Errors/logging** (`tests/unit/shared`): status derivation, cause/stack
  exclusion from JSON, key + URL-credential redaction, circular safety.
- **Config** (`tests/unit/config`): defaults, override validation, `.env`
  subset parsing with real-env precedence.
- **Composition** (`tests/integration/composition.test.js`): real SDK entry
  loads (pins the `zod` packaging assumption) and the full production wiring
  composes; `/health` answers on the composed app. No network, no CLI spawn.
- **API** (`tests/integration/api.test.js`): all five routes, envelope +
  request-id consistency, validation→status mapping, 201+Location, audit
  replay, malformed/oversized bodies, no-stack guarantee, 404 routes, CORS
  allowlist behavior, rate-limit 429 + `Retry-After`.

## Fixtures vs reality

- `tests/fixtures/synthetic.js` is **hand-written synthetic data**, labeled as
  such in the file header — engine/service/API tests run fully offline.
- Mocked-integration tests (stubbed executor/client) are the documented seam:
  they assert mapping/retry/guard logic, not provider bytes.
- **Real-behavior anchors**: the smoke test executes the genuine CLI binary
  (version, doctor, demo list, exit-2 classified envelope, demo bytes through
  the real client guard). The one un-runnable check here — a live provider
  call — is reported BLOCKED, never simulated.
