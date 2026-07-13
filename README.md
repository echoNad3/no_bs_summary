# no-bullshit-summary — feasibility benchmark

A small local benchmark that answers one question: **can captioned YouTube videos
reliably produce useful, brutally concise summaries quickly — 30 seconds at the very
most, ideally much faster?**

For every video it fetches the existing captions (no AI transcription), sends them
to Gemini once, and expects back:

- a verdict: **WATCH**, **SKIM** or **SKIP**
- one short, blunt reason
- the shortest complete summary of the useful information

It measures transcript-provider reliability and end-to-end speed. Summary quality
is reviewed by a human — there is no automated quality score on purpose.

> **Status: Phase 3 done.** The full pipeline works: captions in, blunt summary out,
> everything timed against a 30-second limit per video.

## What you need

- [Node.js](https://nodejs.org) version 24 or newer (the current LTS). Check with:
  ```
  node --version
  ```
- A terminal: on Windows, open "PowerShell" from the Start menu.

## 1. Install dependencies

Open a terminal in this project folder and run:

```
npm install
```

## 2. Add your API keys

1. Copy the file `.env.example` and name the copy `.env` (exactly that, starting with a dot).
2. Open `.env` in any text editor and paste your keys after the `=` signs:
   - `SUPADATA_API_KEY` — from your [Supadata dashboard](https://supadata.ai)
   - `TRANSCRIPTAPI_API_KEY` — from your [TranscriptAPI dashboard](https://transcriptapi.com)
   - `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com/apikey)

A missing key does not crash anything — that provider is simply reported as "skipped".

The `.env` file stays on your machine and is ignored by git. Never share it.

## 3. Choose the videos to benchmark

Copy `videos.example.json` to `videos.json` and replace the example links with the
YouTube videos you want to test. Normal links, `youtu.be` short links and Shorts
links all work. Invalid links stop the run with a clear error — nothing is
silently skipped.

## 4. Choose the transcript provider(s)

In `.env`, set `TRANSCRIPT_PROVIDER` to one of:

- `supadata` — test only Supadata
- `transcriptapi` — test only TranscriptAPI
- `all` — test both independently against every video (recommended for the benchmark)

A provider whose API key is missing is reported as **skipped**, never silently dropped.

## 5. Run the benchmark

```
npm run bench            # normal run (may reuse cached transcripts)
npm run bench:no-cache   # force live transcript requests (real latency numbers)
npm run cache:clear      # delete the local transcript cache
```

Each run fetches the captions, sends them to Gemini once, and prints the verdict
(WATCH / SKIM / SKIP), the one-line reason and the summary for every video.
Everything for one video must finish within the time limit (30 seconds, set by
`END_TO_END_TIMEOUT_MS` in `.env`).

Tip: for honest speed numbers use `npm run bench:no-cache`. A normal run reuses
captions already saved on your computer ("cached"), which is faster but says
nothing about real-world speed. Cached runs still get a fresh summary.

### Reading the terminal report

For each provider you see:

- how many live runs were tried, and how many worked or failed
- **Median** — the typical time (half the runs were faster than this)
- **p95** — almost the worst case (95% of runs were faster than this)
- how many runs finished within the time limit
- which videos failed and why, in one short line each

Cached runs are listed separately and never mixed into the timing numbers.

### Detailed results

Every run also writes a timestamped JSON file into the `results/` folder with the
full per-video measurements, verdicts and summaries.

## Checks and tests

```
npm run typecheck     # TypeScript type checking
npm test              # unit tests (mocked — no API keys or credits used)
npm run format        # auto-format all files
npm run format:check  # verify formatting without changing files
```
