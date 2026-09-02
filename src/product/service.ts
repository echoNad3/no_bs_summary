import type { TranscriptStore } from '../transcript/store.js';
import { PipelineError, runSummaryPipeline } from '../pipeline.js';
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

export interface SummaryRequestOptions {
  /** Runs after a persistent cache miss, before any paid work. */
  beforeGenerate?: () => Promise<void>;
}

export class ProductError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
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
    requestOptions: SummaryRequestOptions = {},
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
      language: parsed.data.language,
      model: this.options.summaryModel,
      promptVersion: this.options.summaryPromptVersion,
    };
    const key = summaryCacheKey(identity);

    const cached = await this.readSavedSummary(identity);
    if (cached) return cached;

    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    const pending = this.generateAndSave(parsed.data, videoId, identity, requestOptions);
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
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
    requestOptions: SummaryRequestOptions,
  ): Promise<SummarizeResponse> {
    await requestOptions.beforeGenerate?.();

    let generated: SummarizeResponse;
    try {
      generated = await runSummaryPipeline(
        {
          videoId,
          language: input.language,
        },
        {
          transcriptProvider: this.options.transcriptProvider,
          summaryProvider: this.options.summaryProvider,
          transcriptCache: this.options.cache,
          timeoutMs: this.options.timeoutMs,
        },
      );
    } catch (error) {
      if (error instanceof PipelineError) throw productErrorFromPipeline(error);
      throw error;
    }

    const response = summarizeResponseSchema.parse(generated);

    try {
      await this.options.summaryCache.write(identity, response);
    } catch (error) {
      // Paid work already succeeded. Returning the result is more useful than
      // making the user pay again because an optional cache write failed.
      console.warn(
        JSON.stringify({
          event: 'summary_cache_write_failed',
          videoId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
    return response;
  }
}

function productErrorFromPipeline(error: PipelineError): ProductError {
  if (error.stage === 'deadline') {
    return new ProductError(
      504,
      'DEADLINE_EXCEEDED',
      'This video took too long to process. Try again.',
    );
  }
  if (error.stage === 'transcript') {
    return new ProductError(502, 'TRANSCRIPT_FAILED', error.message);
  }
  if (error.stage === 'summary') {
    return new ProductError(502, 'SUMMARY_FAILED', error.message);
  }
  return new ProductError(503, 'TRANSCRIPT_CACHE_FAILED', error.message);
}
