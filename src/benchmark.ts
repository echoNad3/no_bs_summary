import { performance } from 'node:perf_hooks';
import { cacheKey, TranscriptCache } from './cache.js';
import { createRunContext, isAbortError } from './run-context.js';
import type { SummaryProvider } from './summary/provider.js';
import type { TranscriptProvider, TranscriptResult } from './transcript/provider.js';

/**
 * Runs the benchmark: every video is tested against every selected provider,
 * one run at a time (parallel runs would distort the timing numbers).
 *
 * A LIVE run = transcript fetch + summary, both inside ONE shared deadline.
 * A CACHED run reuses the stored transcript and only the summary happens
 * live; cached runs never count toward the live timing statistics.
 */

export type RunStatus = 'success' | 'failure' | 'skipped';
export type FailureStage = 'transcript' | 'summary';

export interface RunRecord {
  url: string;
  videoId: string;
  provider: string;
  status: RunStatus;
  /** LIVE = really fetched now; CACHED = reused from disk. Unset when skipped/failed early. */
  source?: 'LIVE' | 'CACHED';
  language?: string;
  transcriptMs?: number;
  summaryMs?: number;
  totalMs?: number;
  transcriptChars?: number;
  retried: boolean;
  failureStage?: FailureStage;
  failureReason?: string;
  /** Only meaningful for LIVE runs: did everything finish inside the deadline? */
  withinDeadline?: boolean;
  verdict?: string;
  reason?: string;
  summary?: string;
}

export interface BenchmarkVideo {
  url: string;
  videoId: string;
}

export interface ProviderEntry {
  name: string;
  /** Undefined when the API key is missing — those runs are marked "skipped". */
  provider?: TranscriptProvider;
  skippedReason?: string;
}

export interface BenchmarkOptions {
  videos: BenchmarkVideo[];
  providers: ProviderEntry[];
  cache: TranscriptCache;
  useCache: boolean;
  timeoutMs: number;
  /** Undefined = no summaries (e.g. GEMINI_API_KEY missing); transcript-only run. */
  summaryProvider?: SummaryProvider;
}

export async function runBenchmark(options: BenchmarkOptions): Promise<RunRecord[]> {
  const records: RunRecord[] = [];

  for (const entry of options.providers) {
    for (const video of options.videos) {
      records.push(await runOne(entry, video, options));
    }
  }

  return records;
}

async function runOne(
  entry: ProviderEntry,
  video: BenchmarkVideo,
  options: BenchmarkOptions,
): Promise<RunRecord> {
  const base: RunRecord = {
    url: video.url,
    videoId: video.videoId,
    provider: entry.name,
    status: 'skipped',
    retried: false,
  };

  if (!entry.provider) {
    return {
      ...base,
      failureReason: entry.skippedReason ?? 'API key missing',
    };
  }

  // Cached transcript? Then only the summary happens live, on a fresh
  // deadline, and nothing from this run enters the live timing statistics.
  if (options.useCache) {
    const cached = await options.cache.read(cacheKey(entry.name, video.videoId));
    if (cached) {
      return runSummaryForCached(base, cached, options);
    }
  }

  const { ctx, dispose } = createRunContext(options.timeoutMs);
  const startedAt = performance.now();
  let stage: FailureStage = 'transcript';

  try {
    const transcript = await entry.provider.fetchTranscript(video.videoId, ctx);
    const transcriptMs = Math.round(performance.now() - startedAt);

    await options.cache.write(cacheKey(entry.name, video.videoId), transcript);

    let summary: Partial<RunRecord> = {};
    let summaryMs: number | undefined;
    if (options.summaryProvider) {
      stage = 'summary';
      const summaryStartedAt = performance.now();
      const verdict = await options.summaryProvider.summarize(transcript.text, ctx);
      summaryMs = Math.round(performance.now() - summaryStartedAt);
      summary = { verdict: verdict.verdict, reason: verdict.reason, summary: verdict.summary };
    }

    const totalMs = Math.round(performance.now() - startedAt);
    return {
      ...base,
      ...summary,
      status: 'success',
      source: 'LIVE',
      language: transcript.language,
      transcriptMs,
      summaryMs,
      totalMs,
      transcriptChars: transcript.text.length,
      retried: ctx.retried,
      withinDeadline: totalMs <= options.timeoutMs,
    };
  } catch (error) {
    const totalMs = Math.round(performance.now() - startedAt);
    return {
      ...base,
      status: 'failure',
      source: 'LIVE',
      totalMs,
      retried: ctx.retried,
      failureStage: stage,
      failureReason: describeFailure(error, stage, options.timeoutMs),
      withinDeadline: false,
    };
  } finally {
    dispose();
  }
}

/** Summarize a transcript that came from the cache (summary is still live). */
async function runSummaryForCached(
  base: RunRecord,
  cached: TranscriptResult,
  options: BenchmarkOptions,
): Promise<RunRecord> {
  const cachedBase: RunRecord = {
    ...base,
    status: 'success',
    source: 'CACHED',
    language: cached.language,
    transcriptChars: cached.text.length,
  };

  if (!options.summaryProvider) return cachedBase;

  const { ctx, dispose } = createRunContext(options.timeoutMs);
  const startedAt = performance.now();
  try {
    const verdict = await options.summaryProvider.summarize(cached.text, ctx);
    return {
      ...cachedBase,
      summaryMs: Math.round(performance.now() - startedAt),
      retried: ctx.retried,
      verdict: verdict.verdict,
      reason: verdict.reason,
      summary: verdict.summary,
    };
  } catch (error) {
    return {
      ...cachedBase,
      status: 'failure',
      summaryMs: Math.round(performance.now() - startedAt),
      retried: ctx.retried,
      failureStage: 'summary',
      failureReason: describeFailure(error, 'summary', options.timeoutMs),
    };
  } finally {
    dispose();
  }
}

function describeFailure(error: unknown, stage: FailureStage, timeoutMs: number): string {
  if (isAbortError(error)) {
    return `Ran out of time (${timeoutMs} ms deadline) during the ${stage} stage.`;
  }
  return error instanceof Error ? error.message : String(error);
}
