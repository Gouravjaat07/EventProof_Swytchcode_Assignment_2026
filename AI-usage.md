# AI Usage Disclosure

This project was built with AI assistance (Muse Code, an agentic coding
assistant) under direct human direction. Everything below describes actual
usage — no marketing assets were produced by AI in this repo (deferred
deliverables were explicitly excluded and do not exist here).

## What the AI did

- **Phase 1**: investigated the empty workspace and runtime; researched
  current Swytchcode docs/CLI/SDK; designed and implemented the backend
  (domain models, verification engine, services, Swytchcode client, calendar
  provider, Express API, error taxonomy, logging, config); wrote 113 backend
  tests + the real-CLI smoke test; wrote all Phase 1 docs.
- **Phase 2**: re-verified the 113-test baseline; implemented SQLite audit
  persistence + history/stats/integration-status endpoints; designed and built
  the React console (7 routes, design system, API client, demo mode); wrote
  22 more backend tests and 46 frontend tests; updated docs; prepared CI and
  git readiness. No code was pushed, deployed, or published (awaiting human
  approval).

## What the human did / must do

- Authored both master prompts (requirements, scope, quality bars, explicit
  exclusions) and the product direction.
- Owns all account actions the AI cannot and must not perform: `swy login`,
  `swy auth connect`, live API execution, `git push`, deployment, and the
  Swytchcode submission form + marketing posts.
- Must still: run the 4-command auth/bundle step, re-run the gated live
  smoke, visually review the UI in a real browser, and approve any
  push/deploy.

## Verification posture

- No AI claim in this repo is self-certified without execution: every test
  count, build result, and CLI behavior cited was observed by running the
  command in this workspace (see `docs/phase2-validation-report.md`).
- Blocked items (live provider call, served-browser checks) are labeled
  BLOCKED with evidence — never simulated, never presented as done.
- Synthetic fixtures are labeled as such in code (`tests/fixtures`,
  `web/src/lib/demo.js`) and in every UI surface that renders them.
