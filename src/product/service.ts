import type { TranscriptStore } from '../transcript/store.js';
import { runBenchmark } from '../benchmark.js';
import type { RunRecord } from '../benchmark.js';
import type { SummaryProvider } from '../summary/provider.js';
import type { TranscriptProvider } from '../transcript/provider.js';
import { extractVideoId } from '../youtube.js';
import {
  summarizeRequestSchema,
  summarizeResponseSchema,
  type SummarizeRequest,
  type SummarizeResponse,
} from './schema.js';
import { summaryCacheKey, type SummaryCache, type SummaryCacheIdentity } from './summary-store.js';

export interface SummaryServiceOptions {
  transcriptProvider: TranscriptProvider;
  summaryProvider: SummaryProvider;
  cache: TranscriptStore;
  summaryCache: SummaryCache;
  summaryModel: string;
  summaryPromptVersion: string;
  timeoutMs: number;
}

export interface SummaryExecutionOptions {
  /** Internal seam for a future explicit regenerate API. Not exposed by either client yet. */
  regenerate?: boolean;
}

export class ProductError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductError';
  }
}

export class SummaryService {
  private readonly inFlight = new Map<string, Promise<SummarizeResponse>>();

  constructor(private readonly options: SummaryServiceOptions) {}

  async summarize(
    rawInput: unknown,
    execution: SummaryExecutionOptions = {},
  ): Promise<SummarizeResponse> {
    const parsed = summarizeRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ProductError(400, 'INVALID_REQUEST', issue?.message ?? 'Invalid request.');
    }

    let videoId: string;
    try {
      videoId = extractVideoId(parsed.data.url);
    } catch (error) {
      throw new ProductError(
        400,
        'INVALID_YOUTUBE_URL',
        error instanceof Error ? error.message : 'Invalid YouTube URL.',
      );
    }

    const identity: SummaryCacheIdentity = {
      videoId,
      model: this.options.summaryModel,
      promptVersion: this.options.summaryPromptVersion,
    };
    const key = summaryCacheKey(identity);

    if (!execution.regenerate) {
      const cached = await this.readSavedSummary(identity);
      if (cached) return cached;

      const pending = this.inFlight.get(key);
      if (pending) return pending;
    }

    const pending = this.generateAndSave(parsed.data, videoId, identity);
    if (!execution.regenerate) this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (!execution.regenerate && this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  private async readSavedSummary(
    identity: SummaryCacheIdentity,
  ): Promise<SummarizeResponse | undefined> {
    try {
      return await this.options.summaryCache.read(identity);
    } catch {
      throw new ProductError(503, 'SUMMARY_CACHE_FAILED', 'Could not read the saved summary.');
    }
  }

  private async generateAndSave(
    input: SummarizeRequest,
    videoId: string,
    identity: SummaryCacheIdentity,
  ): Promise<SummarizeResponse> {
    const [record] = await runBenchmark({
      videos: [
        {
          url: input.url,
          videoId,
          title: input.title ?? 'YouTube video',
          language: input.language,
        },
      ],
      providers: [
        {
          name: this.options.transcriptProvider.name,
          provider: this.options.transcriptProvider,
        },
      ],
      cache: this.options.cache,
      useCache: true,
      timeoutMs: this.options.timeoutMs,
      summaryProvider: this.options.summaryProvider,
    });

    if (!record || record.status !== 'success' || !record.verdict || !record.reason) {
      throw failureFromRecord(record);
    }

    const response = summarizeResponseSchema.parse({
      verdict: record.verdict,
      reason: record.reason,
      summary: record.summary,
      videoId: record.videoId,
      language: record.language,
      source: record.source,
      timing: {
        transcriptMs: record.transcriptMs,
        summaryMs: record.summaryMs,
        totalMs: record.totalMs,
      },
      retries: {
        transcript: record.transcriptRetries,
        summary: record.summaryRetries,
      },
    });

    try {
      await this.options.summaryCache.write(identity, response);
    } catch {
      throw new ProductError(503, 'SUMMARY_CACHE_FAILED', 'Could not save the summary.');
    }
    return response;
  }
}

function failureFromRecord(record: RunRecord | undefined): ProductError {
  if (!record)
    return new ProductError(500, 'EMPTY_RESULT', 'The summary pipeline returned no result.');
  if (record.failureStage === 'deadline') {
    return new ProductError(504, 'DEADLINE_EXCEEDED', record.failureReason ?? 'Timed out.');
  }
  if (record.failureStage === 'transcript') {
    return new ProductError(
      502,
      'TRANSCRIPT_FAILED',
      record.failureReason ?? 'Could not retrieve captions.',
    );
  }
  if (record.failureStage === 'summary') {
    return new ProductError(
      502,
      'SUMMARY_FAILED',
      record.failureReason ?? 'Could not summarize the captions.',
    );
  }
  return new ProductError(500, 'PIPELINE_FAILED', record.failureReason ?? 'The pipeline failed.');
}
