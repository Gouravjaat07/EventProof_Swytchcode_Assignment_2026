# Phase 1 — Swytchcode Discovery

Sources: official docs (`https://docs.swytchcode.com`, current as of
2026-11-05), the installed CLI itself (`--help`, real runs), the published
`@swytchcode/runtime@1.2.1` tarball (inspected locally), the public
`swytchcode-examples` repo (real `tooling.json`), and the integration catalog
(`https://www.swytchcode.com/apis`). No method, flag, or id below is invented.

## 1. CLI installation (verified)

- Official Windows method per docs: `irm https://cli.swytchcode.com/install.ps1 | iex`
  or `npm install -g swytchcode`. Global install is impossible in this sandbox
  (writes outside the workspace denied), so the documented npm package was
  installed workspace-locally instead:
  `tools/cli` (`npm install swytchcode`, own lockfile).
- Verified version: **`swytchcode version 2.25.5`** (`swy` is the short alias).
- Binary layout: `bin/swytchcode.js` Node launcher → platform package
  `swytchcode-cli-win32-x64` (native `swytchcode.exe`).

## 2. Project initialization (verified)

Command used (non-interactive flags discovered from `init --help`, after two
documented failures taught that `--editor` and `--mode` are both required):

```powershell
swytchcode init --non-interactive --editor none --mode production
```

- `--mode production` = "for live execution" (docs); required because Phase 1
  must perform a genuine API call. Only read-only tools will ever be enabled,
  so the blast radius is nil.
- Generated artifacts (inspected): `.swytchcode/tooling.json`
  (`{editor, integrations:{}, mode:"production", tools:{}, version:"2.25.5"}`),
  `.swytchcode/tooling.json.lock`, empty `.swytchcode/integrations/`.

## 3. Wrekenfile (current terminology, confirmed)

"Wrekenfile" is current, not legacy: `swytchcode get --help` reads
**"Fetch Wrekenfile bundles for a provider"**, and the project-setup doc shows
the on-disk layout `.swytchcode/integrations/{project}/{library}/{version}/`
containing `wrekenfile.yaml` ("Wrekenfile spec with METHODS section") and
`methods.json`. `swy get` populates it but never touches `tooling.json`;
`swy add <canonical_id>` resolves a method from the local Wrekenfile into
`tooling.json.tools` (the trust boundary — **only listed tools execute**).

Status in this workspace: the bundle for `google_calendar` is **not yet
downloaded** — `swy get` needs direct network, which the sandbox blocks (see
the environment audit). The exact user-side command is prepared in the API
execution report. Nothing was fabricated to fill the gap.

## 4. Google Calendar integration (verified from official sources)

| Fact | Source |
|---|---|
| Provider exists in the registry (373 providers total) | `GET /v3/cli/integrations` (fetched live; record: `provider_name "Google Calendar"`, library `calendar`, version `v3`) |
| Manifest slug for `get` | Official page `swytchcode.com/apis/google-calendar`: `swytchcode get google_calendar` |
| Real canonical ids | Published example `langgraph-google-calendar/.swytchcode/tooling.json` (real file, 5 tools) |
| Read method + schema | Same file: `calendar.calendar.events.get`, desc "Returns events on the specified calendar." |

Critical schema finding: **`calendar.calendar.events.get` has LIST semantics**
(inputs: `calendarId` path + `timeMin/timeMax/q/maxResults/pageToken/
singleEvents/orderBy/timeZone` query; output: `{items:[Event…]}`), matching
Google Calendar API v3 `events.list`. There is no separate single-event method
in the example's tooling; Swytchcode's own example resolves "update/delete by
id" as *list → match id client-side*. EventProof's provider does exactly that
(time-scoped list + exact id match, pagination bounded to 3 pages).

Write methods exist in the same bundle (`…events.create/update/delete`) and
are **never enabled** by this project (read-only principle).

## 5. Execution contract (verified against CLI 2.25.5 + SDK 1.2.1)

- Direct: `swytchcode exec <canonical_id> --json` with `ExecArgs` JSON on
  stdin: `{ params: {k: string}, body?: object, headers?: object }`
  (top-level unknown keys also become query params; credentials are never
  passed — managed auth injects them).
- SDK: `@swytchcode/runtime` v1.2.1 exports `exec(canonicalId, input, options)`
  — a thin `spawnSync` wrapper (10 MB cap, optional timeout, Windows-safe
  `.cmd` escaping, `--json` stdout parsing). Note: the docs'
  `SwytchcodeRuntime` class name does not exist in v1.2.1 (exports are `exec`,
  `Swytchcode`, `SwytchcodeError`, …) — the adapter uses the real `exec`.
Packaging caveat (verified by a startup crash): the SDK declares `zod` an
*optional* peer but `dist/schema.js` requires it unconditionally at load, so
`zod@4.6.7` is a real pinned dependency of this project and the composition
test pins the assumption.
- Exit codes (docs + observed): `0` ok · `1` invalid input/config ·
  `2` tool not found · `3` auth failed · `4` network/timeout/unreadable ·
  `5` internal · `6` policy block · `7` human approval. A provider 4xx/5xx
  still exits `0` with `status_code/error_category/retryable` in JSON.
- Failure envelope (observed verbatim, exit 2):
  `{"error":"tool \"…\" is not configured…","category":"not_found",
  "suggested_action":"…","docs_url":"…"}` — the client maps this shape.
- Demo envelope (observed verbatim, `--demo`): stdout carries
  `{"demo":true,"_simulated":true,"data":{…},"summary":"…"}`; stderr says
  `running in demo mode (…)`. Two consequences: (a) stdout stays pure JSON
  (all banners go to stderr); (b) the SDK's demo guard (`"demo_mode"` /
  `"data is simulated"`) does **not** match the real banner text, so
  EventProof guards the parsed payload flags instead (verified by smoke test).

## 6. Auth model (docs + `auth --help`)

- `swy login` (device flow; session in `~/.swytchcode/auth.json`),
  `swy auth connect <provider>` (browser OAuth), `swy auth status`.
  First 2 live commands need no account; dry runs / `--explain` / demos never
  count. Both flows need a browser + direct network → user steps.
- Scopes stay minimal: the provider only ever calls the read method above;
  no create/update/delete/send/publish capability is enabled anywhere.

## 7. What remains for the bundle step

From an unrestricted terminal in this repo root, the user runs
(`tools/cli` copy works — no global install needed):

```powershell
.\tools\cli\node_modules\.bin\swytchcode.cmd get google_calendar
.\tools\cli\node_modules\.bin\swytchcode.cmd list methods
.\tools\cli\node_modules\.bin\swytchcode.cmd add calendar.calendar.events.get
```

then confirms with `swy info calendar.calendar.events.get` and
`swy exec calendar.calendar.events.get --dry-run`. After that, the smoke test's
live section and the backend's real provider path unblock.
