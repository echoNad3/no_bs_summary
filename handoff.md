# handoff.md

Current continuation guide. Replace stale text instead of appending.

**Keep this file current at every step.** Update it after every meaningful change — finished
phase, new decision, new blocker, changed architecture — not just at the end of a session.
Any AI must be able to take over from this file alone at any point.

## How to talk to the owner

The owner is autistic, a complete beginner at programming and infrastructure, and wants zero
bullshit. In every reply: talk like a blunt lifelong best friend. Short, direct, practical,
simple. Swear naturally. No corporate tone, no polished assistant voice, no fluff, no
unnecessary disclaimers, no fancy wording. Say the useful shit first. Explain things clearly
and concretely; use steps only when they actually help. Saving their time matters more than
sounding nice. Deep technical detail belongs in this file and in code, not in chat.

## What this product is

A YouTube summary tool. You give it a YouTube link, it reads the video's existing captions and
returns a detailed English summary (the main product) plus a small WATCH / SKIM / SKIP verdict
with one blunt reason. Two clients, one backend:

- **PWA** — installable web app; on Android it appears as a Share target for YouTube links.
- **Chrome extension** — Manifest V3 side panel that detects the active YouTube tab.

Backend pipeline: TranscriptAPI fetches captions → Gemini (`gemini-3.1-flash-lite`) summarizes
→ result is validated, cached, and returned. 15,000 ms end-to-end deadline, one retry per
stage. Clients never see API keys or transcripts.

## Who it's for (decided 2026-07-16 with the owner)

- **Users:** the owner plus a few trusted friends. Nothing more.
- **No public signups, no accounts, no per-user API keys.** The owner's own Gemini and
  TranscriptAPI keys pay for all usage.
- **Hosting:** Cloudflare free tier. Owner accepts the small per-video API cost.
- **Repo:** public on GitHub as `echoNad3/no_bullshit_summary`, MIT license.
- **Both clients matter equally** (phone share target and desktop side panel).

## Rejected direction (do not resurrect without the owner asking)

An earlier ChatGPT-written plan called for Supabase email/password auth, strict RLS,
per-user encrypted API key storage, account deletion flows, and a Monday/Thursday keepalive
cron to stop the free Supabase project from pausing. That was over-engineered for a
friends-only tool: nobody signs up for a service that demands their own API keys, and needing
a cron job to keep the database awake means the tool choice was wrong. **Supabase is dropped
entirely.** The owner created a Supabase project during earlier setup; it is unused and can be
deleted from the Supabase dashboard (its values in `.env` can then be removed too).

Access control is instead one shared app password: a single secret the owner gives to friends,
entered once in the PWA/extension and sent with each API request. Stored as a Cloudflare
Worker secret, never in the repo or browser bundles.

## Frozen behavior (do not change without owner approval)

- Prompt `summary-first-v31-2026-07-15`, model `gemini-3.1-flash-lite`, verdict logic,
  detailed-summary behavior, validation/cleanup rules, and the dark-only UI.
- TranscriptAPI is the only active transcript provider; the Supadata adapter stays disabled.
- No model or provider comparisons without a new owner-approved run.
- No analytics, subscriptions, admin panels, social features, custom domains, or paid
  resources.

## Current state (2026-07-16)

Phases A–D are **done and pushed** to the public repo
`https://github.com/echoNad3/no_bullshit_summary` (branch `main`, CI green). Phase E (deploy)
is **in progress and blocked on one owner click** — see "Next step".

Everything works **locally**: `npm run build && npm start` serves the PWA and API at
`http://127.0.0.1:8787`. The extension loads unpacked from `dist/extension`. 175 tests across
21 files pass; format, typecheck, all builds, the Worker dry-run bundle, and the isolated
Playwright extension smoke test pass.

Done so far:

- **Phase A — GitHub.** MIT LICENSE. Secret scan of full git history + pushable tree against
  every real `.env` value and generic key patterns: clean. Public repo created and pushed.
- **Phase B — Worker backend.** `src/worker.ts` is the production backend (mirrors
  `src/server.ts` routes). Storage contracts were split runtime-neutral:
  `src/transcript/store.ts` (`TranscriptStore` + `MemoryTranscriptStore`, per-isolate only —
  full transcripts never persist in the cloud) and `src/product/summary-store.ts`
  (`SummaryCache` contract) with `src/product/kv-summary-cache.ts` (Workers KV impl) and
  `FileSummaryCache` staying the local implementation. Hardening: `X-App-Password` gate with
  constant-time compare (fails closed if the secret is unset), CORS allowlist (own origin +
  chrome-extension + localhost), per-IP sliding-window rate limit (20/min), KV daily meter
  (`DAILY_SUMMARY_LIMIT`, default 300/day) bounding API spend, safe error bodies, security
  headers + CSP on assets. `wrangler.jsonc`: nodejs_compat, KV binding `SUMMARIES`
  (id 5787832cee5f4475bc64d748b574b4f0), PWA assets with SPA fallback + run_worker_first,
  observability on. Worker env uses structural types on purpose (one tsconfig, Node-testable).
- **Phase C — clients.** Shared api-client sends optional `X-App-Password`. PWA: password
  field under "Options and app password", saved in localStorage, auto-opens on 401.
  Extension: backend URL + password in the fallback `<details>`, saved via
  `chrome.storage.sync` (new `storage` permission), URL normalized with local-dev default
  `http://127.0.0.1:8787` in `apps/extension/src/settings.ts` (`DEFAULT_BACKEND_URL` — bake
  the deployed URL here after deploy).
- **Phase D — CI.** `.github/workflows/ci.yml`: format check, typecheck, tests, builds,
  Worker dry-run bundle on push/PR. Deploys stay manual (`npm run deploy`).

Owner's logins: Cloudflare (wrangler, kzaumanis@gmail.com — email now verified), GitHub CLI
(`echoNad3`). Local `.env` holds the real TranscriptAPI and Gemini keys plus leftover
Supabase values (unused; the Supabase project can be deleted). Never print, expose, or
commit secrets. `.dev.vars.example` documents Worker dev secrets.

Key architecture facts:

- `src/product/service.ts` — `SummaryService`: request validation, backend summary cache
  lookup, in-flight collapse, pipeline call, exact response persistence. Has an internal
  `{ regenerate: true }` seam, not exposed to clients.
- `src/server.ts` — local Node dev server; `src/worker.ts` — production. Same API shape.
- Benchmark/quality history lives in `MODEL_COMPARISON_REPORT.md`,
  `QUALITY_BENCHMARK_REPORT.md`, `BENCHMARK_REPORT.md`, `PROMPT_QUALITY_COMPARISON.md`, and
  `results/`. Historical evidence only; don't rerun without being asked. Any future model
  comparison must reuse the same cached transcript hashes and current prompt.

## Remaining plan

**Phase E — deploy and smoke test (in progress).** After the owner registers the workers.dev
subdomain: `npm run deploy`; set secrets `GEMINI_API_KEY`, `TRANSCRIPTAPI_API_KEY` (values
from local `.env`, never displayed) and a freshly generated `APP_PASSWORD` via
`npx wrangler secret put`; give the app password to the owner in chat (they must know it —
it is the shared friend password, not an API key). Bake the deployed URL into
`DEFAULT_BACKEND_URL` in `apps/extension/src/settings.ts`, rebuild, redeploy, zip the
extension for friends. Production checks: PWA loads with CSP, wrong password → 401, one
fresh video summarizes end-to-end (≤ 2 live TranscriptAPI requests total), repeat returns the
identical KV-cached result, CORS preflight for a chrome-extension origin passes.

**Phase F — docs.** Rewrite README for the deployed reality: what it is, the URL, friend
setup (URL + password + extension install), local development, self-hosting, secrets, known
limitations. Update this file; end with the owner's exact next manual action.

Deploy blockers hit so far (each was a one-time owner action): Cloudflare email verification
(done 2026-07-16); workers.dev subdomain registration (pending, dashboard-only).

## Standard verification after any change

```text
npm run format:check
npm run typecheck
npm test
npm run build
npm run smoke:extension
git diff --check
```

## Commands

```text
npm start                  # build output server + PWA at http://127.0.0.1:8787
npm run dev:api            # dev API server via tsx
npm run dev:worker         # wrangler dev (needs .dev.vars, see .dev.vars.example)
npm run deploy             # build PWA + wrangler deploy to Cloudflare
npm run bench              # benchmark (may reuse cached transcripts)
npm run bench:cache-only   # Gemini only; fails on transcript cache miss
npm run bench:no-cache     # live transcripts; costs money
npm run cache:clear        # wipe local transcript + summary caches
npm run smoke:extension    # needs `npm start` running in another terminal
```

## Next step

Owner action: register the workers.dev subdomain at
https://dash.cloudflare.com/be852ace91fb2c92a73a263bf61090a0/workers/onboarding
(one click + pick any name). Then finish Phase E: deploy, secrets, bake URL into the
extension default, production smoke tests, extension zip, then Phase F docs.
