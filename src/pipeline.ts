import { performance } from 'node:perf_hooks';
import type { SummarizeResponse } from './product/schema.js';
import { createRequestContext, requestTimedOut } from './request-context.js';
import type { SummaryProvider } from './summary/provider.js';
import { cacheKey, type TranscriptStore } from './transcript/store.js';
import type { TranscriptProvider, TranscriptResult } from './transcript/provider.js';

export type PipelineStage = 'transcript' | 'transcript-cache' | 'summary' | 'deadline';

export class PipelineError extends Error {
  constructor(
    readonly stage: PipelineStage,
    message: string,
  ) {
    super(message);
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
}

export async function runSummaryPipeline(
  input: PipelineInput,
  options: PipelineOptions,
): Promise<SummarizeResponse> {
  const transcriptKey = cacheKey(options.transcriptProvider.name, input.videoId, input.language);
  let cached: TranscriptResult | undefined;
  try {
    cached = await options.transcriptCache.read(transcriptKey, {
      provider: options.transcriptProvider.name,
      videoId: input.videoId,
    });
  } catch {
    throw new PipelineError('transcript-cache', 'Could not read cached captions.');
  }

  if (cached) return summarizeCached(input, cached, options);
  return fetchAndSummarize(input, transcriptKey, options);
}

async function fetchAndSummarize(
  input: PipelineInput,
  transcriptKey: string,
  options: PipelineOptions,
): Promise<SummarizeResponse> {
  const { context, dispose } = createRequestContext(options.timeoutMs);
  const startedAt = performance.now();
  try {
    let transcript: TranscriptResult;
    try {
      transcript = await options.transcriptProvider.fetchTranscript(
        input.videoId,
        context,
        input.language,
      );
    } catch (error) {
      if (requestTimedOut(error, context)) throw deadlineError(options.timeoutMs);
      throw new PipelineError('transcript', describe(error, 'Could not retrieve captions.'));
    }

    const transcriptMs = elapsed(startedAt);
    assertWithinDeadline(context.deadlineAt, options.timeoutMs);

    try {
      await options.transcriptCache.write(transcriptKey, transcript);
    } catch {
      throw new PipelineError('transcript-cache', 'Could not cache captions.');
    }
    assertWithinDeadline(context.deadlineAt, options.timeoutMs);

    const summaryStartedAt = performance.now();
    try {
      const summary = await options.summaryProvider.summarize(transcript.text, context, {
        transcriptLanguage: transcript.language,
      });
      assertWithinDeadline(context.deadlineAt, options.timeoutMs);
      return {
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
      if (requestTimedOut(error, context)) throw deadlineError(options.timeoutMs);
      throw new PipelineError('summary', describe(error, 'Could not summarize captions.'));
    }
  } finally {
    dispose();
  }
}

async function summarizeCached(
  input: PipelineInput,
  transcript: TranscriptResult,
  options: PipelineOptions,
): Promise<SummarizeResponse> {
  const { context, dispose } = createRequestContext(options.timeoutMs);
  const startedAt = performance.now();
  try {
    try {
      const summary = await options.summaryProvider.summarize(transcript.text, context, {
        transcriptLanguage: transcript.language,
      });
      assertWithinDeadline(context.deadlineAt, options.timeoutMs);
      return {
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
      if (requestTimedOut(error, context)) throw deadlineError(options.timeoutMs);
      throw new PipelineError('summary', describe(error, 'Could not summarize captions.'));
    }
  } finally {
    dispose();
  }
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

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
