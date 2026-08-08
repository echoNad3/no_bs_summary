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
  /** Runs after a cache miss, before paid work. */
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

  async summarize(rawInput: unknown): Promise<SummarizeResponse> {
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

    const pending = this.generateAndSave(parsed.data, videoId, identity);
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
  ): Promise<SummarizeResponse> {
    await this.options.beforeGenerate?.();

    let generated: SummarizeResponse;
    try {
      generated = await runSummaryPipeline(
        {
          videoId,
          title: input.title ?? 'YouTube video',
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
    } catch {
      throw new ProductError(503, 'SUMMARY_CACHE_FAILED', 'Could not save the summary.');
    }
    return response;
  }
}

function productErrorFromPipeline(error: PipelineError): ProductError {
  if (error.stage === 'deadline') {
    return new ProductError(504, 'DEADLINE_EXCEEDED', error.message);
  }
  if (error.stage === 'transcript') {
    return new ProductError(502, 'TRANSCRIPT_FAILED', error.message);
  }
  if (error.stage === 'summary') {
    return new ProductError(502, 'SUMMARY_FAILED', error.message);
  }
  return new ProductError(503, 'TRANSCRIPT_CACHE_FAILED', error.message);
}
