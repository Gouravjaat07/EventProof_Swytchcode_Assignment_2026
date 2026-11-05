# Phase 1 — API Execution Report

Honest status first: **a live provider call HAS been executed — by the user on
their Windows machine** (the agent's sandbox still cannot dial out, so
agent-side live re-verification remains BLOCKED; see §2). Operation
`calendar.event.get` against Google Calendar in live production mode returned
HTTP 200 with a valid events collection and an empty `items` array. Nothing in
this report is simulated and then presented as live.

## 1. Genuine executions completed (all offline-capable CLI paths)

Run `node scripts/swytchcode-smoke.js` to reproduce (5 PASS, 0 FAIL, 1 BLOCKED):

| # | Command (real, exit-verified) | Result |
|---|---|---|
| 1 | `swytchcode --version` | `swytchcode version 2.25.5`, exit 0 |
| 2 | `swytchcode doctor` | all checks passed, exit 0 |
| 3 | `swytchcode demo list` | advertises `stripe.create_payment`, exit 0 |
| 4 | `swytchcode exec nonexistent.tool --json` | **exit 2**, stderr classified JSON `{error, category:"not_found", suggested_action, docs_url}` (verbatim envelope asserted) |
| 5 | `swytchcode exec stripe.create_payment --demo --json` (stdin `{amount,currency}`) | exit 0, stdout `{"demo":true,"_simulated":true,"data":{…}}`; the **real** `SwytchcodeClient` refused these bytes with `SWYTCHCODE_SIMULATED_DATA` |

Also genuine (via harness fetch, not the CLI binary): `GET
https://api-v2.swytchcode.com/v3/cli/integrations` → 200, 373 providers,
Google Calendar = library `calendar` v3. Used for discovery only, never as
execution evidence.

## 2. Genuine live execution (user's Windows machine, 2026-11-05)

Executed by the user from an unrestricted terminal (direct network +
authenticated `google_calendar` provider). Agent did not run this command —
the evidence below is the user's reported result, recorded verbatim:

- Operation: `calendar.event.get` (read-only; LIST semantics — response
  carries an `items` array). This replaces the obsolete
  `calendar.calendar.events.get` id previously configured.
- Command: `swytchcode exec calendar.event.get --json`
  (stdin params: `calendarId=primary`).
- Provider: Google Calendar. Mode: live production.
- Result: **HTTP 200**, valid calendar events response,
  **`items: []`** (empty array — no events on the calendar).
- An empty `items` array is a SUCCESSFUL execution, not a failure: the
  backend provider treats missing/empty `items` as an empty list
  (covered by unit tests), and the smoke test's `live-exec` gate asserts
  this shape explicitly.

Backend and smoke test now use the same configured operation id
(`SWYTCHCODE_METHOD_EVENTS=calendar.event.get`, also the code default).
Reproduce any time from the repo root:

```powershell
$env:SWYTCHCODE_SMOKE_LIVE=1; node scripts/swytchcode-smoke.js
npm start  # then GET /api/v1/events?limit=3
```

Agent-side live re-verification is still BLOCKED in this sandbox: (1) the
CLI binary dials out directly and ignores the sandbox proxy
(`bind … forbidden`), (2) OAuth needs an interactive browser, (3) no
credentials may be minted by the agent. The `live-exec` smoke gate therefore
reports BLOCKED here by design — run the command above from an unrestricted
terminal for the live PASS.

## 3. Live-run acceptance (met by the §2 execution)

- Exit `0`, stdout parses as JSON, top level has **no** `demo`/`_simulated` flags.
- HTTP status 200 (or absent `status_code`); payload is `{result|data|bare}`
  wrapping a Google `events` collection (`kind: "calendar#events"`,
  `items: [...]` or omitted/empty, `timeZone: …`).
- Recorded: date, sanitized params, `items.length = 0`. If a future envelope
  differs from these documented shapes, the provider's extractor must be
  re-verified before any verification result is trusted.

## 4. Fallback assessment (no fallback taken)

Google Calendar **is** supported (registry + manifest + example tooling all
confirm), so no alternative integration was selected. The `EventSourceProvider`
port keeps the door open, and the client maps every documented failure class,
but Phase 1 ships against Google Calendar only. No unrelated integration is
claimed to power EventProof.
