# no-bullshit-summary - local MVP and quality benchmark

A local TypeScript app and benchmark for blunt, useful summaries from existing YouTube
captions. Each measured request has an end-to-end deadline of **15 seconds (15000 ms)**.

For each video it returns:

- a detailed English summary containing the important facts, names, events, arguments,
  numbers, context, and conclusions
- **WATCH**, **SKIM**, or **SKIP** as a small extra
- one blunt, natural reason that judges the video's quality

Transcript retrieval and Gemini are measured separately. Summary quality is reviewed by a
human; there is no automated quality score or AI judge.

## What you need

- Node.js 24 or newer
- API keys for TranscriptAPI and Gemini

## Setup

1. Run `npm install`.
2. Copy `.env.example` to `.env` and add the API keys.
3. Copy `videos.example.json` to `videos.json` and add objects with `url`, `title`, and the
   requested caption `language`.

TranscriptAPI is the only active transcript provider. The tested Supadata adapter remains
in the source tree but is intentionally disabled. `.env`, `videos.json`, transcript caches,
and result files are ignored by Git.

## Run the local MVP

```text
npm run build
npm start
```

The backend and PWA run at `http://127.0.0.1:8787`. The backend owns both API keys and uses
the existing validated cache, TranscriptAPI adapter, Gemini provider, frozen prompt, and
15000 ms pipeline deadline. Browser code receives only the final verdict, reason, summary,
safe timings, and retry counts.

Both browser clients call that one backend; neither reads another client's state or accesses
cache files. The backend saves complete summary responses by video ID, Gemini model, and prompt
version, so the PWA and extension receive the exact same saved result for the same key. Storage
is behind the `SummaryCache` interface. Its `.cache/summaries` filesystem implementation is for
local development and can be replaced by hosted durable storage without changing either client.
An internal regenerate seam exists, but no regenerate control or public API option is exposed yet.

For the Chrome extension:

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this repository's `dist/extension` directory.
3. Open a YouTube video and click the extension toolbar action to open its side panel.

For an Android share-target smoke test on a USB-connected device, run
`adb reverse tcp:8787 tcp:8787`, open `http://localhost:8787` in Chrome on the phone, and
install the PWA. It will then appear as a target when sharing a YouTube URL. A shared link is
prefilled but never submitted automatically.

This is intentionally a local MVP: there is no deployment, remote server, authentication,
account system, or secret in either browser bundle.

## Run it

```text
npm run bench            # may reuse cached transcripts
npm run bench:cache-only # Gemini only; fails instead of fetching on a cache miss
npm run bench:model-comparison # comparison-only generateContent route; cache only
npm run bench:no-cache   # forces live transcripts; use for honest speed results
npm run cache:clear      # removes local transcript and saved-summary caches
```

Every live video shares one 15000 ms deadline across transcript retrieval, one allowed
transcript retry, Gemini, and one allowed Gemini retry. `GEMINI_PACING_MS` delays the next
video only after the measured run finishes, so quota pacing cannot alter the measurement.
Cached transcript runs are reported separately and never enter live reliability or speed
statistics.

Unknown command options stop immediately. This prevents a mistyped `--no-cache` from
silently running with cache enabled.

## Reporting and saved results

The report keeps separate:

- transcript success, failures, retries, and transcript-only time
- Gemini success, failures, retries, and Gemini-only time
- end-to-end time and deadline success
- cached and live statistics

A Gemini failure never counts as a transcript failure. Each run also saves a timestamped
JSON file under `results/` with execution order, model and package versions, prompt version,
requested and returned language, transcript hash, stage timings/retries, and final output.
It never stores API keys or full transcripts.

The manifest language is sent to TranscriptAPI and checked against its returned language.
Gemini receives the actual caption language and must return English. Prompt v28 treats the
detailed summary as the product and the verdict as a small quality judgment. Summaries must
preserve concrete facts instead of replacing them with vague phrases, and genuinely
multi-topic videos use labeled Markdown bullets. Length follows information density rather
than a tiny fixed word or sentence limit. WATCH includes ordinary videos that are enjoyable,
interesting, informative, useful, well told, entertaining, or worth experiencing. SKIM
requires worthwhile material mixed with noticeable padding or weak sections. SKIP is
reserved for obvious time-wasters; being easy to summarize is not a reason to reject a video.

Validation and generic cleanup enforce separate reason and summary fields, one reason
sentence, plain wording, no repeated ideas, no prompt leakage, no invented runtime, and no
claims about unseen visuals. High character limits remain as safety bounds, not summary
targets. Rejected candidates and their token usage remain auditable in benchmark results.
The cleanup is deliberately video-agnostic.

The current eight-video quality run and every final output are in
[`QUALITY_BENCHMARK_REPORT.md`](QUALITY_BENCHMARK_REPORT.md). The older two-provider evidence
is preserved in [`BENCHMARK_REPORT.md`](BENCHMARK_REPORT.md) as historical evidence only.
The older prompt-tuning comparison is preserved in
[`PROMPT_QUALITY_COMPARISON.md`](PROMPT_QUALITY_COMPARISON.md) as historical evidence.
The 2026-07-14 cached-only model-comparison attempt, costs, availability failure, and current
outputs are in [`MODEL_COMPARISON_REPORT.md`](MODEL_COMPARISON_REPORT.md).

## Checks

```text
npm run build
npm run format:check
npm run typecheck
npm test
```

All tests use mocks and make no paid network requests.
