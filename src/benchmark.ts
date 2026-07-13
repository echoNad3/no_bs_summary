import { performance } from 'node:perf_hooks';
import { cacheKey, TranscriptCache } from './cache.js';
import { createRunContext, isAbortError } from './run-context.js';
import type { TranscriptProvider } from './transcript/provider.js';

/**
 * Runs the benchmark: every video is tested against every selected provider,
 * one run at a time (parallel runs would distort the timing numbers).
 *
 * Phase 2 measures the transcript stage. The Gemini summary stage is added
 * in Phase 3 and shares the same per-run deadline.
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

  // Cached transcript? Then no live request is made and no timing is recorded.
  if (options.useCache) {
    const cached = await options.cache.read(cacheKey(entry.name, video.videoId));
    if (cached) {
      return {
        ...base,
        status: 'success',
        source: 'CACHED',
        language: cached.language,
        transcriptChars: cached.text.length,
      };
    }
  }

  const { ctx, dispose } = createRunContext(options.timeoutMs);
  const startedAt = performance.now();

  try {
    const transcript = await entry.provider.fetchTranscript(video.videoId, ctx);
    const transcriptMs = Math.round(performance.now() - startedAt);

    await options.cache.write(cacheKey(entry.name, video.videoId), transcript);

    const totalMs = Math.round(performance.now() - startedAt);
    return {
      ...base,
      status: 'success',
      source: 'LIVE',
      language: transcript.language,
      transcriptMs,
      totalMs,
      transcriptChars: transcript.text.length,
      retried: ctx.retried,
      withinDeadline: totalMs <= options.timeoutMs,
    };
  } catch (error) {
    const totalMs = Math.round(performance.now() - startedAt);
    const timedOut = isAbortError(error);
    return {
      ...base,
      status: 'failure',
      source: 'LIVE',
      totalMs,
      retried: ctx.retried,
      failureStage: 'transcript',
      failureReason: timedOut
        ? `Ran out of time (${options.timeoutMs} ms deadline) during the transcript stage.`
        : error instanceof Error
          ? error.message
          : String(error),
      withinDeadline: false,
    };
  } finally {
    dispose();
  }
}
