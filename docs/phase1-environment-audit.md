# Phase 1 — Environment Audit

Date: 2026-11-05. All findings below were observed by running commands in this
workspace, not assumed.

## 1. Workspace inventory (initial state)

- Working directory: `D:\Downloads\SwtychCode_Assignment`
- The workspace was **empty**: no `package.json`, no lockfile, no backend, no
  frontend, no Swytchcode configuration, no Wrekenfile, no tests, no scripts.
- Only pre-existing entries were hidden runtime directories
  (`.agents`, `.eden`, `.hg`, `.muse`, `.sl`) — none contained project files.
- No Git repository (`git status` → "not a git repository"). No CI, Makefile,
  task files, or linter/analyzer configs existed, so no pre-existing
  verification gates had to be honored.

## 2. Runtime inspection

| Item | Observed value |
|---|---|
| OS | Windows 10.0.26200 (Win32NT) |
| Shell | Windows PowerShell 5.1 (Desktop edition) |
| Node.js | v22.18.0 |
| npm | 10.9.3 |
| Swytchcode CLI | **not installed** (no `swytchcode`/`swy` on PATH) |
| Global npm packages | `@docusaurus/core`, `@expo/ngrok`, `localtunnel`, `nodemon`, `yarn` (irrelevant to this project; left untouched) |
| ICU / time zones | Full ICU present (`Asia/Kolkata`, `America/New_York`, etc. resolve; `Bogus/Zone` throws) |

Framework choice follows from this table: Node 22 supports Express 5,
`node:test`, `crypto.randomUUID`, and WHATWG `URL` with no polyfills, so the
backend uses CommonJS on stock Node with exactly three pinned runtime
dependencies (`express`, `@swytchcode/runtime`, plus `zod` — forced by the
SDK's load-time require, see the friction diary) and one dev-only HTTP
injector (`light-my-request`).

## 3. Sandbox constraints discovered (all verified by probing)

The shell sandbox shapes what can run here; each constraint was proven, not guessed:

1. **Direct outbound TCP is blocked.** The Swytchcode CLI binary dials
   `api-v2.swytchcode.com` directly and fails with
   `bind: An attempt was made to access a socket in a way forbidden by its
   access permissions`. Plain `node:fetch` to the same host fails with
   `EACCES`. Consequence: `swy search/get/login/auth` and live `swy exec`
   cannot run from this sandbox.
2. **Egress works only through proxy-aware clients.** `HTTPS_PROXY`/`HTTP_PROXY`
   point at a localhost proxy whose port rotates between commands. `npm`
   honors it (installs succeed); `curl` tunnels `CONNECT` successfully
   (its later failure is a sandbox schannel/TLS restriction, unrelated to
   connectivity). The Swytchcode binary ignores the proxy env vars.
3. **Listening sockets are blocked** (`EACCES` for both .NET `TcpListener` and
   `node:net` on 127.0.0.1). Consequence: the EventProof server cannot bind
   here, and no localhost relay can front the CLI. API tests therefore inject
   requests in-process (`light-my-request`, no sockets).
4. **Unsandboxed execution is unavailable.** Retrying with `require_escalated`
   is denied because approval prompts are disabled in this session.
5. **Writes outside the workspace are denied.** `npm install -g` fails with
   `EPERM` on the npm cache. Workaround used: workspace-local installs with a
   workspace-local npm cache (`.npm-cache/`, gitignored).

## 4. Baseline validation

There was no pre-existing code, so there were no pre-existing failures,
warnings, or working commands to record. The first green baselines established
in Phase 1:

- `npm run check` — `node --check` over all first-party files: 34 files, 0 failed.
- `npm test` — 111 tests, 111 pass, 0 fail.
- `node scripts/swytchcode-smoke.js` — 5 passed, 0 failed, 1 blocked (live exec).

## 5. Decisions derived from the audit

- Swytchcode CLI installed **workspace-locally** (`tools/cli`, own
  `package.json` + lockfile) instead of globally — reproducible without
  touching the machine. Version pinned by install: **2.25.5**.
- Backend binds `127.0.0.1` by default (safe until Phase 2 defines an auth story).
- Live API execution + provider OAuth are explicit **user steps** run from an
  unrestricted terminal (see `docs/phase1-api-execution-report.md`).
