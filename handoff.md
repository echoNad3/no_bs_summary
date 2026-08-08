# No BS Summary handoff

Current continuation guide. Keep it accurate after every meaningful change.

## Owner and fixed product decisions

The owner is a beginner and wants blunt, practical explanations with no corporate padding. Do not
expose secrets.

No BS Summary turns existing YouTube captions into a detailed English summary plus a small
WATCH / SKIM / SKIP verdict and one blunt reason.

- PWA: installable web app and Android Web Share Target.
- Chrome extension: Manifest V3 side panel for the active YouTube video.
- Backend: Cloudflare Worker; TranscriptAPI captions; `gemini-3.1-flash-lite` summary.
- Users: owner plus trusted friends. One shared password; no accounts or public signup.
- Prompt `summary-first-v31-2026-07-15`, model, verdict rules, summary behavior, validation, and
  dark-only design are frozen without explicit owner approval.
- Do not run paid benchmarks or model/provider comparisons without approval.
- No analytics, ads, subscriptions, social features, admin panel, custom domain, or paid
  infrastructure unless asked.

Production app/API: https://no-bullshit-summary.echonad3.workers.dev

The production site is still the earlier release. This audit build is local only. Do not deploy,
push, or submit the Web Store draft without explicit approval.

## Cloud storage and limits

Completed summaries are already stored in Cloudflare KV without automatic expiry. The cache key is
video ID + caption language + model + prompt version. It is shared by the PWA and extension across
users and devices. Repeats return the same saved result without another TranscriptAPI or Gemini
request. Full transcripts are never persisted in the cloud.

This is a shared backend cache, not a user account or a synced visible history. Each client only
restores its own latest result locally. The extension password and text-size preference use Chrome
Sync; its result uses Chrome local storage. The PWA stores password, text size, and latest result
in that browser.

TranscriptAPI does not document a credit-balance endpoint. Its API exposes per-minute rate
headers; actual plan credits are in https://transcriptapi.com/dashboard/billing. Both clients link
there. Do not claim the app can show exact paid-plan credits.

## Audit build completed locally on 2026-08-08

Implemented owner-approved QOL:

- restore latest result in both clients;
- PWA native result sharing while Copy stays plain text;
- cancel, retry, elapsed timer, reading time, and word count;
- three text sizes;
- password/backend test and remaining app daily new-summary budget;
- rate-limit countdown and `Retry-After` propagation;
- safe diagnostics excluding password, URL, captions, and summary;
- extension video lock/unlock;
- YouTube thumbnail preview;
- information dialogs for setup, cache, credits, and Android/ReVanced sharing;
- explicit PWA update prompt;
- automated Axe checks and gzip bundle budgets in CI.

Rejected/deferred: pins, clear-data button, history library, shortcuts, reading/compact modes,
themes, editable/translated output, custom prompts, search, exports, accounts, notifications,
background work, provider fallback, admin UI, analytics, public status, and synced history.

## Backend corrections

- Persistent summary cache is checked before `beforeGenerate`, so cached results remain usable when
  the live-generation budget is exhausted.
- Authenticated `GET /api/status` reports cache type and the app's daily generation budget.
- The KV daily counter increments only on a cache miss entering the paid pipeline. Previously the
  route counted cached requests too.
- Product errors can carry `retryAfterSeconds`; Worker/local server return `Retry-After`.
- Per-client limit: 20 requests/minute. Default live-generation cap: 300/day, reset UTC midnight.
- Summary cache v2 includes caption language; compatible v1 entries are read only if language
  matches.
- CSP permits thumbnails only from `https://i.ytimg.com`.

## Android/ReVanced share target

Manifest target `/share` is standards-correct and inside PWA scope. It accepts shared `text`,
`url`, and `title`; 192, 512, and maskable 512 PNG icons are present.

Android registers the share target only for a real Chrome-installed PWA/WebAPK, not a normal
home-screen shortcut. After deployment:

1. Uninstall the existing No BS Summary app/shortcut.
2. Open production in Chrome and choose **Install app**.
3. In ReVanced choose **Share**, then **More** for the full Android system share sheet.
4. Disable ReVanced's custom **Change share sheet** patch/setting if present.

Automation proves the `/share` intake flow. Only the owner's Android/ReVanced build can prove the
native OS listing.

## Current local release

- Extension version: `0.3.0`.
- PWA service-worker cache: `nbs-shell-v3`.
- Production dependency audit: zero known vulnerabilities.
- `.claude/` is pre-existing user-owned untracked data; do not touch it.
- Format check and all three TypeScript configurations pass.
- 193 tests in 23 files pass.
- Final server, PWA, and extension builds pass.
- Bundle gates pass: PWA JS 6.49 KiB gzip / 12 KiB; PWA CSS 2.47 / 8; extension JS
  5.65 / 16; extension CSS 2.40 / 8.
- Axe reports no violations in the tested PWA, dialog, and 320 px extension surfaces.
- Isolated Chromium cross-client smoke passes all 30 checks with zero TranscriptAPI calls.
- In-app browser visual review of the desktop PWA and information dialog is clean.
- Wrangler dry-run passes: 13 assets; 1448.41 KiB upload / 205.82 KiB gzip; expected KV,
  assets, model, timeout, and daily-limit bindings present.
- Refreshed store screenshot/promo generated and visually checked.
- Extension ZIP has 9 entries, forward-slash paths, and root `manifest.json`. SHA-256:
  `14C0C9C0ACBC4EEEBB9F5ED960390A2F8441E209FD822796B9B3B24AE05B6063`.
- Frontend build/ZIP secret scan: clean.

Run: `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run check:bundles`, `npm run smoke:a11y`, `npm run smoke:extension` with the local server,
and `npx wrangler deploy --dry-run --outdir build-check`.

Key files: `src/worker.ts`, `src/server.ts`, `src/product/service.ts`,
`src/product/kv-summary-cache.ts`, `apps/shared/api-client.ts`,
`apps/shared/client-state.ts`, `apps/pwa/src/main.ts`, `apps/pwa/public/sw.js`,
`apps/extension/src/sidepanel.ts`, and the three scripts under `scripts/` for cross-client smoke,
accessibility, and bundle budgets.

Manual checks automation cannot replace: click the toolbar icon in normal Chrome once; install the
deployed PWA on the owner's Android phone and test ReVanced's system share sheet.

## Release work requiring owner approval

1. Deploy audited Worker/PWA with `npm run deploy`.
2. Reinstall/test the Android PWA.
3. Upload extension `0.3.0` ZIP/assets to Web Store draft
   `kijehbnmlengaokipdbenipccfidlecc`.
4. Owner uploads files and verifies publisher contact email.
5. Ask for action-time confirmation immediately before **Submit for review**.

Leave duplicate draft `mmmblkdkmfhpjegmcklmcbcbocomikdm` untouched. Intended visibility is
unlisted. Package inputs are `dist/no-bs-summary-extension.zip`, the 128 px extension icon,
`store/screenshot-1280x800.png`, `store/small-promo-440x280.png`, `store/listing.md`, and the
hosted policy source. Never put the shared password in source, listing, ZIP, chat, or reviewer
notes.
