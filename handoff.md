# handoff.md

Continuation guide for any coding agent. Keep this current; replace stale info instead of appending.

## Project goal

Local TypeScript feasibility benchmark: determine whether captioned YouTube videos can
reliably produce useful, brutally concise summaries in **< 15 seconds end-to-end**.
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

Phase 1 complete: research done, scaffold created, stubs compile, tests pass.
**Waiting for user approval to start Phase 2.**

## Architecture

- `TranscriptProvider` interface (`src/transcript/provider.ts`): `fetchTranscript(videoId, signal)`
  → normalized `TranscriptResult { provider, videoId, language, text, segments?, metadata? }`.
  Segment times in **milliseconds**. Providers never fall back to each other.
- `SummaryProvider` interface (`src/summary/provider.ts`): `summarize(text, signal)` → `Summary`
  validated by the Zod `summarySchema` (`verdict/reason/summary`).
- One `AbortController` per video/provider run enforces the single end-to-end deadline
  (`END_TO_END_TIMEOUT_MS`, default 15000 ms) across transcript fetch + retry + Gemini.
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
README.md               beginner instructions (Phase 2/3 parts marked "coming")
src/
  index.ts              CLI entry (stub; planned flags --no-cache, --clear-cache)
  transcript/
    provider.ts         TranscriptProvider + TranscriptResult + TranscriptSegment
    supadata.ts         stub adapter (throws), API facts in header comment
    transcriptapi.ts    stub adapter (throws), API facts in header comment
  summary/
    provider.ts         SummaryProvider + Zod summarySchema
    gemini.ts           stub adapter (throws), SDK facts in header comment
tests/
  scaffold.test.ts      schema + stub sanity tests
```

Planned Phase 2 additions: `src/config.ts` (Zod-validated env), `src/youtube.ts`
(URL → video ID), `src/cache.ts`, `src/retry.ts` or inline, `src/benchmark.ts`,
`src/report.ts`, plus mocked tests for each.

## Commands

```
npm install
npm run typecheck
npm test
npm run format / format:check
npm run bench            (stub until Phase 2)
```

## Environment variables (see .env.example)

`SUPADATA_API_KEY`, `TRANSCRIPTAPI_API_KEY`, `GEMINI_API_KEY`,
`TRANSCRIPT_PROVIDER` (supadata | transcriptapi | all), `GEMINI_MODEL`,
`END_TO_END_TIMEOUT_MS`. Missing key ⇒ that provider is marked **skipped**, never a crash.
Never log or embed keys anywhere, including error messages.

## Known problems / unresolved decisions

- Supadata may return 202 (async job) for long videos even in native mode — decided:
  fail that run with reason "provider returned async job", do not poll.
- Percentiles on tiny samples: compute consistently anyway and print the sample size.

## Files not to modify without a reason

- `.env` (user's secrets; never commit, never print)
- `videos.json` (user's personal list)
- `results/` output files (benchmark evidence — append new files, never rewrite old ones)
