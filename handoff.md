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

**No BS Summary** is a YouTube summary tool. You give it a YouTube link, it reads the video's
existing captions and
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

**All phases (A–F) are done. The product is live in production:**

- App + API: `https://no-bullshit-summary.echonad3.workers.dev`
- Repo: `https://github.com/echoNad3/no_bullshit_summary` (public, `main`, CI green)
- Worker secrets set (never in the repo): `GEMINI_API_KEY`, `TRANSCRIPTAPI_API_KEY`,
  `APP_PASSWORD`. The app password was generated fresh at deploy time and given to the owner
  in chat; it exists only as a Worker secret. To rotate it:
  `npx wrangler secret put APP_PASSWORD`, then everyone re-enters it in their clients.
- Production smoke (2026-07-16): health 200; PWA served with CSP + security headers; wrong
  password → 401; disallowed web origin → 403; chrome-extension CORS preflight → 204 with the
  right allow headers; one live summarize of `dQw4w9WgXcQ` (WATCH, 1.8 s, source LIVE — the
  only paid TranscriptAPI call, budget was ≤ 2); immediate repeat returned a byte-identical
  KV-cached response; `/share` SPA fallback 200.
- Chrome Web Store package: `dist/no-bs-summary-extension.zip` (version `0.1.1`,
  manifest at ZIP root). The listing is not submitted yet; package, copy, privacy
  disclosures, and images are ready.

Everything works **locally**: `npm run build && npm start` serves the PWA and API at
`http://127.0.0.1:8787`. The extension loads unpacked from `dist/extension`. 176 tests across
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
  Extension: production backend fixed in `apps/extension/src/settings.ts`; password in the
  fallback `<details>`, saved via `chrome.storage.sync` (`storage` permission). Self-hosted
  builds replace `DEFAULT_BACKEND_URL` before build.
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

## Completed phases E and F (2026-07-16)

- **Phase E — deploy.** Deployed via `npm run deploy` under the owner's wrangler login.
  Extension `DEFAULT_BACKEND_URL` (`apps/extension/src/settings.ts`) points at production.
  `preview_urls` disabled in wrangler.jsonc — one stable URL. The extension smoke script
  keeps the shipped production URL and intercepts it with the already-proven local cached
  payload, so smoke needs no release-only localhost permission and makes no paid call. All
  production checks above passed.
- **Phase F — docs.** README rewritten for the deployed reality (live URL, friend setup,
  extension install, local dev, self-hosting, costs, limits).

Deploy blockers hit (each was a one-time owner dashboard action, both done 2026-07-16):
Cloudflare email verification; workers.dev subdomain registration (`echonad3`).

Incident note: the generated app password briefly landed in a local commit
(`.app-password.tmp` swept up by `git add -A`); it was amended out before any push and the
file is now gitignored. Nothing secret has ever been pushed. Lesson: stage explicitly when a
secret-bearing temp file exists.

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

## Next task: finish the Chrome Web Store dashboard submission (unlisted)

Decided with the owner 2026-07-16. Chrome forbids installing extensions from arbitrary
websites — the Web Store is the only one-click install path. Goal: an **unlisted** store
listing (only people with the link find it) so friends install with one click and updates
push automatically. The owner paid the $5 developer fee and signed into the dashboard. Google did
not flag the old name specifically; its validation dialog lists unfinished listing, privacy, and
contact requirements. The owner still chose the safer public brand **No BS Summary**. The updated
package and signed-in dashboard flow are in progress.

**Finished 2026-07-16:**

- Manifest version `0.1.1`; public name `No BS Summary`; primary button `Cut the BS`; PNG icons at
  16, 32, 48, and 128 px; toolbar icons set. The 128 px store icon has the required transparent
  padding.
- Removed `activeTab` and the localhost host permission. Exact host permissions remain for
  supported YouTube hosts (persistent URL/title detection while the panel stays open) and
  the production Worker (cross-origin API fetch). Removed the now-invalid custom backend URL
  field from the shipped UI; self-hosted builds replace `DEFAULT_BACKEND_URL` before build.
- Added an in-product pre-submit disclosure for the video URL/title, caption language, and
  app password sent to the backend.
- Hosted privacy policy is live at
  `https://no-bullshit-summary.echonad3.workers.dev/privacy` (deploy version
  `4a78af83-bd85-4b7a-96dd-a8009d05909b`). It discloses Chrome Sync, Cloudflare,
  TranscriptAPI, Gemini, summary-cache retention, and Chrome Web Store Limited Use.
- Listing copy/permission justifications/data disclosures: `store/listing.md`.
- Required images: `store/screenshot-1280x800.png` and
  `store/small-promo-440x280.png`. Generators live in
  `scripts/generate-extension-icons.mjs` and `scripts/generate-store-assets.mjs`.
- Release ZIP: `dist/no-bs-summary-extension.zip`; 11 ZIP entries, forward-slash
  paths, `manifest.json` at root, four icons, no wrapper directory. SHA-256:
  `DF1385206AD3EB77B178AD57701340D52B17B50C2B827F13927111C6E3D06532`. Frontend secret scan:
  clean; old public-brand scan clean.
- Verification: format check, typecheck, 176 tests/21 files, full build, Worker dry-run,
  live `/privacy` + homepage + web manifest checks, and isolated extension smoke all pass. The live
  pages say `No BS Summary` and contain no old public name. Smoke used the saved local summary plus
  a mocked production URL, made zero TranscriptAPI calls, and covered detection,
  loading/success/error states, cross-client output, and network errors.
- Web Store fields saved in draft `kijehbnmlengaokipdbenipccfidlecc`: detailed description,
  category `Tools` (the current dashboard puts this under Productivity), language `English`,
  homepage/support URLs, all permission justifications, remote code `No`, Authentication
  information + Web history + Website content disclosures, all three Limited Use certifications,
  privacy URL, visibility `Unlisted`, and all regions.
- Google's validation list is down from 13 blockers to four: store icon, one screenshot, publisher
  contact email, and contact-email verification. The Codex in-app browser does not support file
  uploads, so the owner must select the package and image files through the visible dashboard.

**Exact continuation:**

1. Use Web Store draft `kijehbnmlengaokipdbenipccfidlecc`, which is the item the owner opened.
   Leave duplicate draft `mmmblkdkmfhpjegmcklmcbcbocomikdm` untouched unless the owner explicitly
   asks to delete it.
2. Owner selects `dist/no-bs-summary-extension.zip` in Build -> Package -> Upload new package.
3. Owner uploads `apps/extension/public/icons/icon-128.png` as the store icon,
   `store/screenshot-1280x800.png` as the required screenshot, and optionally
   `store/small-promo-440x280.png` as the small promo tile. These cannot be uploaded by the in-app
   browser automation.
4. Owner adds the public publisher contact email on Settings and completes Google's email
   verification. Do not enter the shared app password there. If Google later asks for test
   credentials, the owner must enter the app password without posting it in chat or committing it.
5. AI shows the owner the final dashboard state and asks for action-time confirmation before
   the irreversible "Submit for review" click.
6. After approval: replace README's zip/Load-unpacked friend instructions with the store
   link, update this file, and verify one-click install + side panel against production.

## Other known follow-ups (only if asked)

- Optional manual check: click the extension's toolbar button in regular Chrome once to
  confirm native side-panel placement (Playwright can't click browser chrome).
- Raise `DAILY_SUMMARY_LIMIT` in wrangler.jsonc if friends hit the cap.
- Rotate `APP_PASSWORD` via `npx wrangler secret put APP_PASSWORD` if it leaks.
