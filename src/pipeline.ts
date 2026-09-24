import { performance } from 'node:perf_hooks';
import type { SummarizeResponse } from './product/schema.js';
import {
  createRequestContext,
  requestDeadlineReached,
  requestTimedOut,
  withinDeadline,
} from './request-context.js';
import type { RequestContext } from './request-context.js';
import type { SummaryProvider } from './summary/provider.js';
import { cacheKey, type TranscriptStore } from './transcript/store.js';
import type { TranscriptProvider, TranscriptResult } from './transcript/provider.js';
import { SUMMARY_OUTPUT_VERSION } from './product/schema.js';

export type PipelineStage =
  | 'transcript'
  | 'transcript-timeout'
  | 'transcript-cache'
  | 'transcript-cache-timeout'
  | 'summary'
  | 'summary-timeout'
  | 'deadline';

export class PipelineError extends Error {
  constructor(
    readonly stage: PipelineStage,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'PipelineError';
  }
}

export interface PipelineInput {
  videoId: string;
  language: string;
}

export interface PipelineOptions {
  transcriptProvider: TranscriptProvider;
  summaryProvider: SummaryProvider;
  transcriptCache: TranscriptStore;
  timeoutMs: number;
  context?: RequestContext;
}

export async function runSummaryPipeline(
  input: PipelineInput,
  options: PipelineOptions,
): Promise<SummarizeResponse> {
  const owned = options.context ? undefined : createRequestContext(options.timeoutMs);
  const context = options.context ?? owned!.context;
  try {
    const transcriptKey = cacheKey(options.transcriptProvider.name, input.videoId, input.language);
    let cached: TranscriptResult | undefined;
    try {
      cached = await withinDeadline(
        options.transcriptCache.read(transcriptKey, {
          provider: options.transcriptProvider.name,
          videoId: input.videoId,
        }),
        context,
        2_000,
      );
    } catch (error) {
      if (requestDeadlineReached(context, error)) throw deadlineError(options.timeoutMs);
      if (requestTimedOut(error, context)) {
        throw new PipelineError(
          'transcript-cache-timeout',
          'Caption cache did not respond in time.',
          error,
        );
      }
      throw new PipelineError('transcript-cache', 'Could not read cached captions.');
    }

    if (cached) return summarizeCached(input, cached, options, context);
    return fetchAndSummarize(input, transcriptKey, options, context);
  } finally {
    owned?.dispose();
  }
}

async function fetchAndSummarize(
  input: PipelineInput,
  transcriptKey: string,
  options: PipelineOptions,
  context: RequestContext,
): Promise<SummarizeResponse> {
  const startedAt = performance.now();
  let transcript: TranscriptResult;
  try {
    const stage = stageContext(context, 15_000);
    try {
      transcript = await withinDeadline(
        options.transcriptProvider.fetchTranscript(input.videoId, stage.context, input.language),
        stage.context,
      );
    } finally {
      context.transcriptRetries = stage.context.transcriptRetries;
      stage.dispose();
    }
  } catch (error) {
    if (requestDeadlineReached(context, error)) throw deadlineError(options.timeoutMs);
    if (requestTimedOut(error, context)) {
      throw new PipelineError('transcript-timeout', 'Captions did not arrive in time.', error);
    }
    throw new PipelineError('transcript', describe(error, 'Could not retrieve captions.'), error);
  }

  const transcriptMs = elapsed(startedAt);
  assertWithinDeadline(context.deadlineAt, options.timeoutMs);

  try {
    await withinDeadline(options.transcriptCache.write(transcriptKey, transcript), context, 250);
  } catch (error) {
    if (requestDeadlineReached(context, error)) throw deadlineError(options.timeoutMs);
    // The captions are already in memory. A failed cache write must not waste
    // the quota reservation or prevent a valid summary from being generated.
    console.warn(
      JSON.stringify({
        event: 'transcript_cache_write_failed',
        videoId: input.videoId,
        error: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
  }
  assertWithinDeadline(context.deadlineAt, options.timeoutMs);

  const summaryStartedAt = performance.now();
  try {
    const summary = await withinDeadline(
      options.summaryProvider.summarize(transcript.text, context, {
        transcriptLanguage: transcript.language,
      }),
      context,
    );
    assertWithinDeadline(context.deadlineAt, options.timeoutMs);
    return {
      outputVersion: SUMMARY_OUTPUT_VERSION,
      verdict: summary.verdict,
      reason: summary.reason,
      summary: summary.summary,
      videoId: input.videoId,
      language: transcript.language,
      source: 'LIVE',
      timing: {
        transcriptMs,
        summaryMs: elapsed(summaryStartedAt),
        totalMs: elapsed(startedAt),
      },
      retries: {
        transcript: context.transcriptRetries,
        summary: context.summaryRetries,
      },
    };
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    if (requestDeadlineReached(context, error)) throw deadlineError(options.timeoutMs);
    if (requestTimedOut(error, context) || isProviderTimeout(error)) {
      throw new PipelineError(
        'summary-timeout',
        'The summary model did not respond in time.',
        error,
      );
    }
    throw new PipelineError('summary', describe(error, 'Could not summarize captions.'), error);
  }
}

async function summarizeCached(
  input: PipelineInput,
  transcript: TranscriptResult,
  options: PipelineOptions,
  context: RequestContext,
): Promise<SummarizeResponse> {
  const startedAt = performance.now();
  try {
    const summary = await withinDeadline(
      options.summaryProvider.summarize(transcript.text, context, {
        transcriptLanguage: transcript.language,
      }),
      context,
    );
    assertWithinDeadline(context.deadlineAt, options.timeoutMs);
    return {
      outputVersion: SUMMARY_OUTPUT_VERSION,
      verdict: summary.verdict,
      reason: summary.reason,
      summary: summary.summary,
      videoId: input.videoId,
      language: transcript.language,
      source: 'CACHED',
      timing: { summaryMs: elapsed(startedAt) },
      retries: { transcript: 0, summary: context.summaryRetries },
    };
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    if (requestDeadlineReached(context, error)) throw deadlineError(options.timeoutMs);
    if (requestTimedOut(error, context) || isProviderTimeout(error)) {
      throw new PipelineError(
        'summary-timeout',
        'The summary model did not respond in time.',
        error,
      );
    }
    throw new PipelineError('summary', describe(error, 'Could not summarize captions.'), error);
  }
}

function stageContext(
  parent: RequestContext,
  maxMs: number,
): { context: RequestContext; dispose: () => void } {
  const controller = new AbortController();
  const deadlineAt = Math.min(parent.deadlineAt, Date.now() + maxMs);
  const onParentAbort = () => controller.abort();
  parent.signal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));
  return {
    context: { ...parent, signal: controller.signal, deadlineAt },
    dispose: () => {
      clearTimeout(timer);
      parent.signal.removeEventListener('abort', onParentAbort);
    },
  };
}

function assertWithinDeadline(deadlineAt: number, timeoutMs: number): void {
  if (Date.now() >= deadlineAt) throw deadlineError(timeoutMs);
}

function deadlineError(timeoutMs: number): PipelineError {
  return new PipelineError('deadline', `Timed out after ${timeoutMs} ms.`);
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isProviderTimeout(error: unknown): boolean {
  return error instanceof Error && /(?:Timeout|Aborted)Error$/u.test(error.name);
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
