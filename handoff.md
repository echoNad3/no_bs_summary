# handoff.md

Current continuation guide. Replace stale text instead of appending.

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

## Current state (verified 2026-07-15)

Everything works **locally**: `npm run build && npm start` serves the PWA and API at
`http://127.0.0.1:8787`. The extension loads unpacked from `dist/extension`. 163 tests across
20 files pass; format, typecheck, all three production builds, and the isolated Playwright
extension smoke test pass. Nothing is deployed yet and the repo has no GitHub remote yet.

Key architecture facts:

- `src/product/service.ts` — `SummaryService`: request validation, backend summary cache
  lookup, in-flight collapse, pipeline call, exact response persistence. Has an internal
  `{ regenerate: true }` seam, not exposed to clients.
- `src/product/summary-cache.ts` — replaceable `SummaryCache` interface keyed by video ID +
  model + prompt version, plus the local `FileSummaryCache` (`.cache/summaries`) development
  implementation. **Cloud deployment swaps this implementation, not the interface.**
- `src/server.ts` — local Node HTTP server: CORS allowlist (localhost + chrome-extension),
  JSON body limits, safe errors, static PWA serving. This is the file the Worker replaces in
  production.
- `src/http.ts`, `src/transcript/transcriptapi.ts`, `src/summary/gemini.ts` — the pipeline is
  already fetch-based, which makes it portable to Cloudflare Workers.
- `apps/shared/` — API client, theme, and safe Markdown-topic rendering shared by both
  clients.
- Benchmark/quality history lives in `MODEL_COMPARISON_REPORT.md`,
  `QUALITY_BENCHMARK_REPORT.md`, `BENCHMARK_REPORT.md`, `PROMPT_QUALITY_COMPARISON.md`, and
  `results/`. Historical evidence only; don't rerun without being asked. Any future model
  comparison must reuse the same cached transcript hashes and current prompt.

Owner's existing logins: Cloudflare (wrangler, kzaumanis@gmail.com), GitHub CLI (`echoNad3`).
Local `.env` holds the real TranscriptAPI and Gemini keys plus now-unneeded Supabase values.
Never print, expose, or commit secrets.

## The plan (phased — do them in order, verify each before the next)

**Phase A — GitHub.** Add MIT `LICENSE`. Secret-scan the full history and working tree (no
real keys have ever been committed; verify anyway). Commit the current work in sensible
commits, create the public `echoNad3/no_bullshit_summary` repo with `gh`, push.

**Phase B — Cloudflare Worker backend.** Port the API of `src/server.ts` to a Worker fetch
handler reusing `SummaryService` unchanged. Summary cache: a `KvSummaryCache` implementing the
existing `SummaryCache` interface on Workers KV. Transcript caching stays local-dev only —
never store full transcripts in the cloud. Secrets (`GEMINI_API_KEY`,
`TRANSCRIPTAPI_API_KEY`, `APP_PASSWORD`) go in via `wrangler secret put`, values never
displayed. Add: app-password check on all API routes, restricted CORS, security headers,
sensible per-client rate limiting, safe error bodies. Serve the built PWA as Worker static
assets at the workers.dev URL. Keep `npm start` local development fully working.

**Phase C — clients.** PWA and extension get a one-time setup screen for backend URL + app
password (stored in extension/browser storage, never in the bundle). They otherwise keep the
exact current UX. Build the extension zip for friends to load unpacked; do not publish to the
Chrome Web Store.

**Phase D — CI.** GitHub Actions running format check, typecheck, tests, and all builds on
push/PR. Deploys stay manual via `wrangler deploy` unless a deploy token can be added without
owner involvement. No Supabase keepalive job — nothing to keep alive.

**Phase E — deploy and smoke test.** Deploy, then verify in production: PWA loads, app
password gate works (wrong password rejected), one fresh video summarizes end-to-end, the
same video returns the identical cached result, and the extension talks to the deployed URL.
Use at most two live TranscriptAPI requests total.

**Phase F — docs.** Rewrite README for the deployed reality: what it is, the URL, friend
setup (URL + password + extension install), local development, self-hosting, secrets, known
limitations. Update this file; end with the owner's exact next manual action.

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
npm run bench              # benchmark (may reuse cached transcripts)
npm run bench:cache-only   # Gemini only; fails on transcript cache miss
npm run bench:no-cache     # live transcripts; costs money
npm run cache:clear        # wipe local transcript + summary caches
npm run smoke:extension    # isolated Playwright cross-client test
```

## Next step

Phase A: secret scan, MIT license, commit, create the public GitHub repo, push.
