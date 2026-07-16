import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cacheKey, TranscriptCache } from './cache.js';
import { createRunContext, isAbortError } from './run-context.js';
import type { RunContext } from './run-context.js';
import { SummaryValidationError } from './summary/provider.js';
import type { Summary, SummaryProvider } from './summary/provider.js';
import type { TranscriptProvider, TranscriptResult } from './transcript/provider.js';

/**
 * Runs every video against every selected provider sequentially. LIVE and
 * CACHED records are kept distinct, and transcript/Gemini outcomes are
 * recorded independently so one stage can never distort the other's stats.
 */

export type RunStatus = 'success' | 'failure' | 'skipped';
export type StageStatus = 'success' | 'failure' | 'skipped';
export type FailureStage = 'transcript' | 'cache' | 'summary' | 'deadline';

export interface RunRecord {
  url: string;
  videoId: string;
  title: string;
  provider: string;
  status: RunStatus;
  transcriptStatus: StageStatus;
  summaryStatus: StageStatus;
  /** LIVE = fetched now; CACHED = loaded from the local transcript cache. */
  source?: 'LIVE' | 'CACHED';
  requestedLanguage: string;
  language?: string;
  /** Live transcript request time only. Never includes cache, Gemini, or cached reads. */
  transcriptMs?: number;
  /** Gemini request and validation time only. */
  summaryMs?: number;
  /** Exact token usage reported by Gemini for the accepted summary response. */
  summaryInputTokens?: number;
  summaryOutputTokens?: number;
  summaryThoughtTokens?: number;
  summaryTotalTokens?: number;
  /** Full live run wall time. Cached runs are excluded from live total statistics. */
  totalMs?: number;
  transcriptChars?: number;
  /** SHA-256 of normalized transcript text. Full transcripts are never saved in results. */
  transcriptSha256?: string;
  transcriptRetries: number;
  summaryRetries: number;
  failureStage?: FailureStage;
  failureReason?: string;
  /** True only when a LIVE run succeeds end-to-end inside the shared deadline. */
  withinDeadline?: boolean;
  verdict?: string;
  reason?: string;
  summary?: string;
  /** True when fields contain an auditable candidate rejected by validation. */
  rejectedSummary?: boolean;
}

export interface BenchmarkVideo {
  url: string;
  videoId: string;
  title: string;
  language: string;
}

export interface ProviderEntry {
  name: string;
  /** Undefined when the API key is missing — those runs are marked skipped. */
  provider?: TranscriptProvider;
  skippedReason?: string;
}

export interface BenchmarkOptions {
  videos: BenchmarkVideo[];
  providers: ProviderEntry[];
  cache: TranscriptCache;
  useCache: boolean;
  /** Never fetch a transcript. A missing or invalid cache entry becomes a cache failure. */
  cacheOnly?: boolean;
  timeoutMs: number;
  /** Delay after each measured run. It is never included in transcript, Gemini or totalMs. */
  interRunDelayMs?: number;
  /** Undefined = transcript-only run because GEMINI_API_KEY is missing. */
  summaryProvider?: SummaryProvider;
}

export async function runBenchmark(options: BenchmarkOptions): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  const totalRuns = options.providers.length * options.videos.length;

  for (const entry of options.providers) {
    for (const video of options.videos) {
      records.push(await runOne(entry, video, options));
      if (
        options.summaryProvider &&
        (options.interRunDelayMs ?? 0) > 0 &&
        records.length < totalRuns
      ) {
        await pause(options.interRunDelayMs ?? 0);
      }
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
    title: video.title,
    provider: entry.name,
    status: 'skipped',
    transcriptStatus: 'skipped',
    summaryStatus: 'skipped',
    requestedLanguage: video.language,
    transcriptRetries: 0,
    summaryRetries: 0,
  };

  if (options.useCache) {
    const cached = await options.cache.read(cacheKey(entry.name, video.videoId, video.language), {
      provider: entry.name,
      videoId: video.videoId,
    });
    if (cached) return runSummaryForCached(base, cached, options);
  }

  if (options.cacheOnly) {
    return {
      ...base,
      status: 'failure',
      transcriptStatus: 'failure',
      failureStage: 'cache',
      failureReason:
        'Cache-only mode found no valid cached transcript. No transcript request was made.',
    };
  }

  if (!entry.provider) {
    return {
      ...base,
      failureReason: entry.skippedReason ?? 'API key missing',
    };
  }

  return runLive(base, entry.provider, video, options);
}

async function runLive(
  base: RunRecord,
  provider: TranscriptProvider,
  video: BenchmarkVideo,
  options: BenchmarkOptions,
): Promise<RunRecord> {
  const { ctx, dispose } = createRunContext(options.timeoutMs);
  const startedAt = performance.now();

  try {
    let transcript: TranscriptResult;
    try {
      transcript = await provider.fetchTranscript(video.videoId, ctx, video.language);
    } catch (error) {
      const transcriptMs = elapsed(startedAt);
      return {
        ...base,
        ...retryCounts(ctx),
        status: 'failure',
        transcriptStatus: 'failure',
        source: 'LIVE',
        transcriptMs,
        totalMs: transcriptMs,
        failureStage: 'transcript',
        failureReason: describeFailure(error, 'transcript', options.timeoutMs),
        withinDeadline: false,
      };
    }

    const transcriptMs = elapsed(startedAt);
    const transcriptFields = transcriptEvidence(transcript);
    if (ctx.signal.aborted || transcriptMs > options.timeoutMs) {
      return {
        ...base,
        ...transcriptFields,
        ...retryCounts(ctx),
        status: 'failure',
        transcriptStatus: 'failure',
        source: 'LIVE',
        transcriptMs,
        totalMs: transcriptMs,
        failureStage: 'deadline',
        failureReason: deadlineFailure(options.timeoutMs),
        withinDeadline: false,
      };
    }

    try {
      await options.cache.write(cacheKey(provider.name, video.videoId, video.language), transcript);
    } catch (error) {
      return {
        ...base,
        ...transcriptFields,
        ...retryCounts(ctx),
        status: 'failure',
        transcriptStatus: 'success',
        source: 'LIVE',
        transcriptMs,
        totalMs: elapsed(startedAt),
        failureStage: 'cache',
        failureReason: describeFailure(error, 'cache', options.timeoutMs),
        withinDeadline: false,
      };
    }

    if (ctx.signal.aborted || elapsed(startedAt) > options.timeoutMs) {
      return {
        ...base,
        ...transcriptFields,
        ...retryCounts(ctx),
        status: 'failure',
        transcriptStatus: 'success',
        source: 'LIVE',
        transcriptMs,
        totalMs: elapsed(startedAt),
        failureStage: 'deadline',
        failureReason: deadlineFailure(options.timeoutMs),
        withinDeadline: false,
      };
    }

    if (!options.summaryProvider) {
      const totalMs = elapsed(startedAt);
      return {
        ...base,
        ...transcriptFields,
        ...retryCounts(ctx),
        status: 'success',
        transcriptStatus: 'success',
        source: 'LIVE',
        transcriptMs,
        totalMs,
        withinDeadline: totalMs <= options.timeoutMs,
      };
    }

    const summaryStartedAt = performance.now();
    try {
      const summary = await options.summaryProvider.summarize(transcript.text, ctx, {
        title: video.title,
        transcriptLanguage: transcript.language,
      });
      const totalMs = elapsed(startedAt);
      const summaryMs = elapsed(summaryStartedAt);
      if (ctx.signal.aborted || totalMs > options.timeoutMs) {
        return {
          ...base,
          ...transcriptFields,
          ...retryCounts(ctx),
          status: 'failure',
          transcriptStatus: 'success',
          summaryStatus: 'success',
          source: 'LIVE',
          transcriptMs,
          summaryMs,
          totalMs,
          failureStage: 'deadline',
          failureReason: deadlineFailure(options.timeoutMs),
          withinDeadline: false,
          verdict: summary.verdict,
          reason: summary.reason,
          summary: summary.summary,
          ...summaryUsageEvidence(summary),
        };
      }
      return {
        ...base,
        ...transcriptFields,
        ...retryCounts(ctx),
        status: 'success',
        transcriptStatus: 'success',
        summaryStatus: 'success',
        source: 'LIVE',
        transcriptMs,
        summaryMs,
        totalMs,
        withinDeadline: totalMs <= options.timeoutMs,
        verdict: summary.verdict,
        reason: summary.reason,
        summary: summary.summary,
        ...summaryUsageEvidence(summary),
      };
    } catch (error) {
      return {
        ...base,
        ...transcriptFields,
        ...retryCounts(ctx),
        status: 'failure',
        transcriptStatus: 'success',
        summaryStatus: 'failure',
        source: 'LIVE',
        transcriptMs,
        summaryMs: elapsed(summaryStartedAt),
        totalMs: elapsed(startedAt),
        failureStage: 'summary',
        failureReason: describeFailure(error, 'summary', options.timeoutMs),
        withinDeadline: false,
        ...rejectedSummaryEvidence(error),
      };
    }
  } finally {
    dispose();
  }
}

/** Cached transcripts get a fresh Gemini deadline but never enter live statistics. */
async function runSummaryForCached(
  base: RunRecord,
  cached: TranscriptResult,
  options: BenchmarkOptions,
): Promise<RunRecord> {
  const cachedBase: RunRecord = {
    ...base,
    ...transcriptEvidence(cached),
    status: 'success',
    transcriptStatus: 'success',
    source: 'CACHED',
  };

  if (!options.summaryProvider) return cachedBase;

  const { ctx, dispose } = createRunContext(options.timeoutMs);
  const startedAt = performance.now();
  try {
    const summary = await options.summaryProvider.summarize(cached.text, ctx, {
      title: base.title,
      transcriptLanguage: cached.language,
    });
    const summaryMs = elapsed(startedAt);
    if (ctx.signal.aborted || summaryMs > options.timeoutMs) {
      return {
        ...cachedBase,
        ...retryCounts(ctx),
        status: 'failure',
        summaryStatus: 'success',
        summaryMs,
        failureStage: 'deadline',
        failureReason: deadlineFailure(options.timeoutMs),
        verdict: summary.verdict,
        reason: summary.reason,
        summary: summary.summary,
        ...summaryUsageEvidence(summary),
      };
    }
    return {
      ...cachedBase,
      ...retryCounts(ctx),
      summaryStatus: 'success',
      summaryMs,
      verdict: summary.verdict,
      reason: summary.reason,
      summary: summary.summary,
      ...summaryUsageEvidence(summary),
    };
  } catch (error) {
    return {
      ...cachedBase,
      ...retryCounts(ctx),
      status: 'failure',
      summaryStatus: 'failure',
      summaryMs: elapsed(startedAt),
      failureStage: 'summary',
      failureReason: describeFailure(error, 'summary', options.timeoutMs),
      ...rejectedSummaryEvidence(error),
    };
  } finally {
    dispose();
  }
}

function transcriptEvidence(transcript: TranscriptResult): Partial<RunRecord> {
  return {
    language: transcript.language,
    transcriptChars: transcript.text.length,
    transcriptSha256: createHash('sha256').update(transcript.text, 'utf8').digest('hex'),
  };
}

function summaryUsageEvidence(summary: Summary): Partial<RunRecord> {
  if (!summary.usage) return {};
  return {
    summaryInputTokens: summary.usage.inputTokens,
    summaryOutputTokens: summary.usage.outputTokens,
    summaryThoughtTokens: summary.usage.thoughtTokens,
    summaryTotalTokens: summary.usage.totalTokens,
  };
}

function rejectedSummaryEvidence(error: unknown): Partial<RunRecord> {
  if (!(error instanceof SummaryValidationError) || !error.candidate) return {};
  return {
    verdict: error.candidate.verdict,
    reason: error.candidate.reason,
    summary: error.candidate.summary,
    rejectedSummary: true,
    ...(error.usage
      ? {
          summaryInputTokens: error.usage.inputTokens,
          summaryOutputTokens: error.usage.outputTokens,
          summaryThoughtTokens: error.usage.thoughtTokens,
          summaryTotalTokens: error.usage.totalTokens,
        }
      : {}),
  };
}

function retryCounts(ctx: RunContext): Pick<RunRecord, 'transcriptRetries' | 'summaryRetries'> {
  return {
    transcriptRetries: ctx.transcriptRetries,
    summaryRetries: ctx.summaryRetries,
  };
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function describeFailure(error: unknown, stage: FailureStage, timeoutMs: number): string {
  if (isAbortError(error)) {
    return `Ran out of time (${timeoutMs} ms deadline) during the ${stage} stage.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function deadlineFailure(timeoutMs: number): string {
  return `The run completed after the hard ${timeoutMs} ms deadline.`;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
