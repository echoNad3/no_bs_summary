# handoff.md

Continuation guide for any coding agent. Keep this current; replace stale info instead of appending.

## How to talk to the user (important)

The user has autism and is not tech-savvy. Every reply must be **short**, in
**plain everyday language**, with **as little technical jargon as possible**.
If a technical word is unavoidable, explain it simply right away. Put technical
detail in files like this one — not in chat messages.

## Project goal

Local TypeScript feasibility benchmark: determine whether captioned YouTube videos can
reliably produce useful, brutally concise summaries fast. **User decision (2026-07-13):
the hard per-run limit is 30 seconds (was 15); faster is still the goal.**
Output per video: verdict (WATCH / SKIM / SKIP), one blunt reason, shortest complete
summary. Measures speed and transcript-provider reliability. Summary quality is judged
manually — **no automated quality scoring, no AI judge.**

## Strict scope

Benchmark only. **Do not add:** UI, browser extension, PWA, server, DB, auth, deployment,
yt-dlp/FFmpeg/Whisper, audio/video download, generated-transcript fallback, queues,
analytics, telemetry, Docker, monorepo tooling, alternative AI providers, timestamps in
summaries, extra summary fields, automated quality scores. Ask before adding anything
not explicitly required.

## Work phases (stop and wait for user approval after each)

1. **Research + scaffold** — DONE (this phase).
2. **Transcript benchmark** — URL parsing/normalization, both transcript adapters,
   normalization, caching, timeouts/retries, transcript measurements + report, mocked tests.
   Stop before Gemini; tell user which API keys to add.
3. **End-to-end benchmark** — Gemini provider, blunt prompt, structured-output validation,
   full timing + reporting, real runs only where keys exist, save results. Stop.

## Current status

Phase 3 code complete: Gemini summary provider (blunt prompt, structured JSON,
store=false, thinking minimal, temp 0.2), summary stage wired into the shared per-run
deadline, verdicts printed per video and saved to results JSON. 79 mocked tests pass,
typecheck + format clean.

**First real benchmark run done (2026-07-13, 3 videos, both providers, no cache):**

- 6/6 runs succeeded end-to-end; 100% transcript and summary success; 0 retries
- supadata: median 4120 ms, slowest 5727 ms
- transcriptapi: median 1757 ms, slowest 1765 ms (clearly faster)
- All comfortably within the 30 s limit; all would even fit the original 15 s goal
- All verdicts came back SKIM; summaries correctly flagged sales pitches/padding
- Detailed file: results/benchmark-2026-07-13T19-24-08-313Z.json (gitignored)

Open question: whether the model leans too hard toward SKIM (sample of 3 videos,
all fitness/commentary genre — needs a more varied sample and manual quality review
by the user). Nothing in the automated suite touches the network; all tests use mocks.

## Architecture

- `TranscriptProvider` interface (`src/transcript/provider.ts`): `fetchTranscript(videoId, signal)`
  → normalized `TranscriptResult { provider, videoId, language, text, segments?, metadata? }`.
  Segment times in **milliseconds**. Providers never fall back to each other.
- `SummaryProvider` interface (`src/summary/provider.ts`): `summarize(text, signal)` → `Summary`
  validated by the Zod `summarySchema` (`verdict/reason/summary`).
- One `AbortController` per video/provider run enforces the single end-to-end deadline
  (`END_TO_END_TIMEOUT_MS`, default 30000 ms) across transcript fetch + retry + Gemini.
- Cached transcripts still get a live Gemini summary (fresh RunContext), but cached
  runs never enter the live timing statistics (`withinDeadline` stays undefined).
- Gemini requests: SDK-internal retries disabled (`maxRetries: 0`); our own single
  retry for ApiError 408/429/5xx only, and only if the deadline allows. The abort
  signal is passed via `options.fetchOptions.signal`.
- Transcript cache (Phase 2): local files under `.cache/`, key = provider + videoId +
  language (when known) + cache-format version. Atomic writes (temp file + rename).
  LIVE vs CACHED labeled everywhere; cached runs excluded from live latency stats.
  Gemini summaries are never cached.
- Retries: max 1, only for transient network errors / 408 / 429 / 5xx, inside the same
  deadline; honour Retry-After only if it fits. Never retry auth/payment/malformed/
  transcript-unavailable errors.

## Confirmed API facts (verified 2026-07-13 against official docs)

### Supadata — https://docs.supadata.ai/get-transcript

- `GET https://api.supadata.ai/v1/transcript`, header `x-api-key: <key>`
- Query: `url` (encoded), `mode=native` (**required for this project** — never auto/generate),
  `text=false` to get segments, optional `lang`
- 200 (text=false): `{ content: [{ text, offset, duration, lang }], lang, availableLangs }`
  (`offset`/`duration` in ms)
- 202: `{ jobId }` — async job (docs: videos > 20 min may trigger this). **Do not poll;
  treat as a run failure with a clear reason** (spec forbids async transcription jobs).
- 206: no native transcript available. 404: video unavailable/private.

### TranscriptAPI — https://transcriptapi.com/docs/api/

- `GET https://transcriptapi.com/api/v2/youtube/transcript`, header `Authorization: Bearer <key>`
- Query: `video_url` (full URL or bare video ID), `format=json`, `include_timestamp=true`
  (default), `send_metadata=false` (default — **keep false**, avoids extra latency)
- 200: `{ video_id, language, transcript: [{ text, start, duration }] }` (`start`/`duration`
  in **seconds** — convert to ms for `TranscriptSegment`)
- 404 no transcript; 401 bad key; 402 out of credits; retryable per docs: 408/429/503.
  Rate limit 300 req/min.

### Gemini — ai.google.dev

- SDK `@google/genai` (Interactions API from v2.3.0), method `ai.interactions.create`
- Model `gemini-3.1-flash-lite` (GA; 1,048,576 in / 65,536 out tokens), env-overridable
  via `GEMINI_MODEL`
- Exact call shape **confirmed against installed @google/genai 2.11.0 type definitions**
  (`node_modules/@google/genai/dist/genai.d.ts` — interactions surface is all snake_case):
  ```ts
  const interaction = await ai.interactions.create({
    model, // string
    input, // string
    store: false,
    system_instruction: '...', // optional string
    generation_config: { thinking_level: 'minimal', temperature: 0.1 },
    response_format: { type: 'text', mime_type: 'application/json', schema: jsonSchema },
  });
  const text = interaction.output_text; // string | undefined — validate with Zod
  ```
- `thinking_level` values: `"minimal" | "low" | "medium" | "high"`.
  `response_mime_type` is deprecated in favour of `response_format`.

### Docs consulted

- https://docs.supadata.ai/get-transcript and https://docs.supadata.ai/llms-full.txt
- https://transcriptapi.com/docs/api/
- https://ai.google.dev/gemini-api/docs/interactions-overview
- https://ai.google.dev/api/interactions-api
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- https://googleapis.github.io/js-genai/

## File structure

```
package.json            npm scripts: bench, bench:no-cache, cache:clear, typecheck, test, format
tsconfig.json           strict TS, NodeNext ESM, noEmit (tsx runs the code)
.prettierrc.json
.gitignore              ignores .env, node_modules, .cache/, results/, videos.json
.env.example            all required env vars with comments
videos.example.json     { "videos": [ ...urls ] }
README.md               beginner instructions (Phase 3 parts marked "coming")
src/
  index.ts              CLI entry; flags --no-cache, --clear-cache; builds providers,
                        runs benchmark, prints report, saves results JSON
  config.ts             Zod-validated env loading (empty strings = unset; readable errors)
  youtube.ts            extractVideoId(): watch/youtu.be/shorts/live links → 11-char ID
  videos.ts             loads videos.json; lists ALL bad links in one error, never skips
  run-context.ts        RunContext { signal, deadlineAt, retried } + createRunContext()
  http.ts               fetchWithOneRetry(): max 1 retry (network/408/429/5xx only),
                        Retry-After honoured only if it fits the deadline
  cache.ts              TranscriptCache: .cache/v1-<provider>-<videoId>-default.json,
                        atomic writes (tmp file + rename), corrupt file = miss
  benchmark.ts          runBenchmark(): sequential runs, LIVE/CACHED labeling, RunRecord
  stats.ts              median / percentile (nearest rank) / max
  report.ts             computeProviderStats() + formatReport() (per-provider terminal report)
  results.ts            saveResults(): timestamped JSON into results/
  transcript/
    provider.ts         TranscriptProvider interface + TranscriptResult + TranscriptError
    normalize.ts        whitespace cleanup + exact-consecutive-duplicate removal only
    supadata.ts         real adapter (mode=native, text=false; 202 job = failure)
    transcriptapi.ts    real adapter (v2, Bearer auth, seconds→ms conversion)
  summary/
    provider.ts         SummaryProvider interface + Zod summarySchema
    gemini.ts           real adapter: interactions.create, JSON schema generated
                        from summarySchema via z.toJSONSchema, injectable createFn
                        for tests, own one-retry rule (SDK retries off)
tests/                  79 mocked tests — no real API calls, no keys needed
  youtube.test.ts, config.test.ts, videos.test.ts, normalize.test.ts,
  http.test.ts, cache.test.ts, providers.test.ts, benchmark.test.ts,
  gemini.test.ts, stats.test.ts, scaffold.test.ts
```

Remaining work: run a real benchmark once the user supplies `.env` keys and
`videos.json`, review summary quality manually, report honest numbers.

## Commands

```
npm install
npm run typecheck
npm test
npm run format / format:check
npm run bench            (transcript benchmark; needs .env keys + videos.json)
npm run bench:no-cache   (force live requests — the honest latency numbers)
npm run cache:clear      (wipe .cache/)
```

## Environment variables (see .env.example)

`SUPADATA_API_KEY`, `TRANSCRIPTAPI_API_KEY`, `GEMINI_API_KEY`,
`TRANSCRIPT_PROVIDER` (supadata | transcriptapi | all), `GEMINI_MODEL`,
`END_TO_END_TIMEOUT_MS` (default 30000). Missing transcript key ⇒ provider marked
**skipped**; missing `GEMINI_API_KEY` ⇒ transcripts only, clearly noted, never a crash.
Never log or embed keys anywhere, including error messages.

## Known problems / unresolved decisions

- Supadata may return 202 (async job) for long videos even in native mode — decided:
  fail that run with reason "provider returned async job", do not poll.
- Percentiles on tiny samples: compute consistently anyway and print the sample size.

## Files not to modify without a reason

- `.env` (user's secrets; never commit, never print)
- `videos.json` (user's personal list)
- `results/` output files (benchmark evidence — append new files, never rewrite old ones)
