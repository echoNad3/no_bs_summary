# no-bullshit-summary

Blunt, useful summaries of captioned YouTube videos. Paste a link (or share one from your
phone), get a detailed English summary with the important facts, names, numbers, and
conclusions — plus a small **WATCH / SKIM / SKIP** verdict with one blunt reason.

**Live app:** https://no-bullshit-summary.echonad3.workers.dev

Two clients, one backend:

- **PWA** — installable web app; on Android it appears in the share sheet for YouTube links.
- **Chrome extension** — side panel that detects the YouTube video you're watching.

The backend fetches the video's existing captions (TranscriptAPI), summarizes them with
Gemini (`gemini-3.1-flash-lite`), validates the output, and caches the final summary so every
user gets the identical result for the same video. Full transcripts are never stored in the
cloud, and API keys never reach the browser.

## Using the hosted app

You need the shared **app password** from the owner.

**Phone (Android):**

1. Open https://no-bullshit-summary.echonad3.workers.dev in Chrome.
2. Install it: browser menu → "Add to home screen" / "Install app".
3. Open "Options and app password" in the app and enter the password once — it's remembered.
4. Share any YouTube video to the app from the share sheet, or paste a link.

**Chrome extension (desktop):**

1. Get the extension: either the `no-bullshit-summary-extension.zip` from the owner
   (unzip it), or build it yourself with `npm run build` (output in `dist/extension`).
2. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select the
   extension directory.
3. Open a YouTube video, click the extension's toolbar button to open the side panel.
4. First time: open "Settings, another link, or caption language" and enter the app
   password. The backend URL is already set to the hosted app.

## Security and limits

- All summarize requests require the shared app password (`X-App-Password` header).
- Restricted CORS, security headers, and a strict CSP on the web app.
- Per-IP rate limit (20 requests/minute) plus a global daily cap (`DAILY_SUMMARY_LIMIT`,
  default 300/day) that bounds worst-case API spend.
- Summaries are cached in Cloudflare KV keyed by video + model + prompt version. Cached
  repeats are free and byte-identical. Transcripts are never written to cloud storage.
- Errors never include keys or transcript content.

Each request has a hard **15 second** end-to-end deadline with one retry per stage.

## Local development

Requirements: Node.js 24+, API keys for [TranscriptAPI](https://transcriptapi.com) and
[Gemini](https://aistudio.google.com/apikey).

1. `npm install`
2. Copy `.env.example` to `.env` and add the API keys.
3. `npm run build && npm start` — backend + PWA at `http://127.0.0.1:8787`.

The local server uses filesystem caches under `.cache/` (transcripts and summaries) and does
not require the app password. To point the extension at the local server, change the backend
URL in its settings to `http://127.0.0.1:8787`.

```text
npm run format:check       # formatting
npm run typecheck          # all TypeScript targets
npm test                   # unit + integration tests (no paid requests; all mocked)
npm run build              # server, PWA, extension
npm run smoke:extension    # Playwright cross-client test; needs `npm start` running
```

GitHub Actions runs the same checks plus a Worker dry-run bundle on every push.

## Self-hosting (deploy your own)

The backend is a Cloudflare Worker (free tier works).

1. `npx wrangler login`
2. `npx wrangler kv namespace create SUMMARIES` and put the returned id in `wrangler.jsonc`.
3. Set the three secrets (each command prompts for the value):

   ```text
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put TRANSCRIPTAPI_API_KEY
   npx wrangler secret put APP_PASSWORD
   ```

4. `npm run deploy` — builds the PWA and deploys Worker + assets.
5. Put your workers.dev URL in `DEFAULT_BACKEND_URL` in `apps/extension/src/settings.ts`
   and rebuild the extension.

Config lives in `wrangler.jsonc` (`GEMINI_MODEL`, `END_TO_END_TIMEOUT_MS`,
`DAILY_SUMMARY_LIMIT`). For `npm run dev:worker`, copy `.dev.vars.example` to `.dev.vars`.

## Costs

Hosting is free (Cloudflare Workers + KV free tier). Summarizing a new video costs real API
money on your keys: roughly half a cent per video (Gemini ≈ $0.004, TranscriptAPI per its
plan). Cached repeats cost nothing.

## Benchmarks and quality history

The repo doubles as the quality benchmark used to tune the summarizer:

```text
npm run bench            # may reuse cached transcripts
npm run bench:cache-only # Gemini only; fails instead of fetching on a cache miss
npm run bench:no-cache   # forces live transcripts; costs money
npm run cache:clear      # removes local transcript and saved-summary caches
```

Historical evidence: [`QUALITY_BENCHMARK_REPORT.md`](QUALITY_BENCHMARK_REPORT.md),
[`MODEL_COMPARISON_REPORT.md`](MODEL_COMPARISON_REPORT.md),
[`BENCHMARK_REPORT.md`](BENCHMARK_REPORT.md),
[`PROMPT_QUALITY_COMPARISON.md`](PROMPT_QUALITY_COMPARISON.md).

## Known limitations

- Only works for videos that already have captions (auto or manual). No captions, no summary.
- The extension is not on the Chrome Web Store — friends load it unpacked.
- The daily cap and rate limits are deliberately conservative; raise `DAILY_SUMMARY_LIMIT`
  in `wrangler.jsonc` if you hit them.
- One shared password, no per-user accounts — by design, for a friends-only tool.

MIT licensed. See [`handoff.md`](handoff.md) for the full continuation guide.
