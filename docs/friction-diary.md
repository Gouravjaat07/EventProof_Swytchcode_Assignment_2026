# Friction Diary (Phase 1)

Only real friction encountered, in order. No issue below is manufactured.

## 1. Global npm install blocked (EPERM on npm cache)

- Tried: `npm install -g swytchcode` → `EPERM … open …\_cacache\tmp\…`.
- Cause: sandbox denies writes outside the workspace.
- Fix: workspace-local installs (`tools/cli`) with `npm_config_cache` pointed
  at `.npm-cache/` (gitignored). Escalated execution was requested and denied
  (approval prompts disabled), so no global install was possible at all.

## 2. `swy init --non-interactive` needs two undocumented-together flags

- Tried: bare `--non-interactive` → `error: init requires --editor…`; then
  with `--editor none` → `error: init requires --mode…`.
- Fix: read `init --help`, then used
  `init --non-interactive --editor none --mode production`
  (`production` = "for live execution" per the projects doc). Exit 0.

## 3. CLI registry calls fail: direct dial blocked, proxy ignored

- Tried: `swy search calendar` → `dial tcp [2606:…]:443: bind: … forbidden`.
- Investigation: env carries a rotating localhost `HTTPS_PROXY`; `npm` honors
  it (installs work) but the native CLI binary dials direct. Binary strings
  show no proxy support; `swy config` offers only telemetry/api_url/web_url.
- Attempted fix: transparent localhost relay (`tools/relay/relay.js` +
  `swy.ps1`) to forward CLI→backend through the proxy. **Failed**: the sandbox
  also blocks listening sockets (`EACCES` on 127.0.0.1 for both .NET and Node),
  so no relay can bind. The relay is kept as documented tooling for
  proxy-restricted machines that *can* bind; it is unused here.
- Outcome: registry commands (`search/get/login/auth`) and live `exec` are
  genuine user-side steps (documented with exact commands). Discovery
  continued via docs, the published SDK tarball, and the registry catalog
  fetched through the harness.

## 4. `curl` TLS fails inside the sandbox (schannel)

- Tried: `curl https://api-v2.swytchcode.com/…` → proxy `CONNECT 200`, then
  `schannel: AcquireCredentialsHandle failed … SEC_E_NO_CREDENTIALS`.
- Meaning: connectivity exists; only the TLS stack available to curl is
 Sandbox-restricted. npm/Node TLS works. No workaround needed (fetch via
  npm-capable clients / harness instead).

## 5. Docs-vs-reality gaps found and handled

- SDK class `SwytchcodeRuntime` (docs) does not exist in `@swytchcode/runtime`
  1.2.1 — real surface is `exec()`/`Swytchcode`/`SwytchcodeError` (verified in
  the published tarball). Adapter uses `exec`.
- SDK demo guard strings (`"demo_mode"`, `"data is simulated"`) do not match
  the real CLI 2.25.5 banner (`running in demo mode`) — verified by running
  it. EventProof guards the parsed payload flags (`demo`/`_simulated`)
  instead, and the smoke test proves refusal end to end.
- `calendar.calendar.events.get` *reads* like a single-get but carries LIST
  semantics (verified in the published example tooling.json). The provider
  implements list + exact id match (the example's own pattern) rather than
  assuming a get-by-id that the bundle does not advertise.

## 6. Test-runner papercuts (Windows PowerShell)

- `node --test <directory>` tries to load the directory as a module instead
  of discovering files → `npm test` uses quoted globs.
- `2>&1 | Select-String` fails on merged error records; test output is
  redirected to a workspace scratch file before grepping.
- `$env:TEMP` file creation was denied, so temp fixtures use workspace
  scratch (auto-cleaned) instead.

## 7. `@swytchcode/runtime` requires its "optional" peer `zod` at load

- Found by: running `node src/interfaces/http/server.js` — startup crashed with
  `Cannot find module 'zod'` (required from `dist/schema.js:5`, reached via the
  package root `index.js`). Unit tests missed it because they inject stub
  executors and never load the SDK.
- Fix: `zod@4.6.7` added as a real (pinned) dependency with this note, the
  server gained a testable `compose()` seam, and
  `tests/integration/composition.test.js` now builds the full production
  wiring (real SDK require) plus `/health` on every run.
- Upstream note: the SDK declares `zod` an *optional* peer but requires it
  unconditionally at load — worth a bug report to Swytchcode.

## 8. `listen()` fake-succeeds, then the process vanishes

- Observed: `app.listen(3000, '127.0.0.1')` fired its `listening` callback
  (startup lines logged), yet `Invoke-WebRequest` got "unable to connect" and
  the node process exited silently with code 0 and an empty event loop.
- Meaning: binds are emulated/blocked here (explicit ports fake-succeed,
  port 0 fails `EACCES`). Live-server smoke is environment-blocked; the
  composition test + in-process API tests verify the identical app object.
  The user-side check is simply `npm start` + `GET /api/v1/health` outside
  the sandbox.

## 9. Bugs the tests caught (all fixed, suite green)

- `normalizeText` stripped `\t`/`\n` before collapsing them (they are Cc
  controls): fixed by collapsing whitespace first.
- Draft-frame MATCH showed the UTC rendering instead of the compared frame
  value: fixed to `rendered.time` (consistent with the MISMATCH branch).
- Venue apostrophe regex missed U+2019 (typographic quote survives NFKC):
  added explicit escapes.
- Three test-side mistakes (NFKC ligature arithmetic, async-helper slip,
  missing stub field) corrected with explanations, never by weakening asserts.

## 10. Phase 2: jsdom 31 needs a newer Node than installed

- `npm install` warned `EBADENGINE` (`jsdom@31` requires Node `^22.22.2`,
  installed is `v22.18.0`).
- Fix: pinned `jsdom@26.1.0` (engines `>=18`) in `web/package.json`. Suite and
  build verified green on the older DOM.

## 11. Phase 2: no browser-servable E2E possible in this sandbox

- Playwright was considered and deliberately not installed: with all
  `listen()` calls blocked or emulated, no local server can exist for a
  browser to reach — E2E here would test nothing real.
- Coverage instead: 46 jsdom tests (incl. 8 mocked user journeys asserting
  exact API payloads) + backend integration tests over the real Express stack.
  Real-browser verification is an explicit user-side step.

## 12. Phase 2: audit durability forced a loud contract change

- Best-effort audit writes (Phase 1) would corrupt Phase 2 history/stats, so
  `VerifyAnnouncementService` now throws `AUDIT_STORAGE_UNAVAILABLE` (503)
  when the record cannot be stored. The old continue-on-failure test was
  replaced (not deleted silently) and the change is documented in the
  implementation record and API reference.
